/**
 * 대상 지역 일일 재판정 (서버 전용). 라우트 /api/internal/region/rejudge 가 부른다 — n8n "AiNews briefing schedule" 의
 * 00:00·09:50·14:50 KST 일정(수집 09:00·14:00·23:00 KST 가 끝난 뒤, 00:10 데일리 생성 전).
 *
 *  1. 대상: 공개 기사 중 created_at >= since(기본 72시간 전) 이고 아직 백필 방식으로 판정되지 않은 행
 *     (region_version 이 NULL 또는 n8n-v1 등 BACKFILL_METHOD_VERSIONS 밖). includeVersions 로 시험용 판본을 더할 수 있다.
 *     → 시각을 따로 기억하지 않아도 같은 행을 두 번 보지 않는다 (재판정한 행은 rejudge-*-v1 로 찍힌다).
 *  2. 판정: region-judge.ts rejudgeRegions (백필과 같은 함수: 고신뢰 규칙 → LLM)
 *  3. 저장: 지역 세 열만, 읽은 뒤 바뀌지 않은 행만 (subject_region·region_tags·region_version 이 읽은 값과 같을 때).
 *     값이 같아도 판본을 찍는다(다시 고르지 않게, 감시 분모). 갱신과 기록(region_rejudge_log)은 한 문장(CTE).
 *     판정 못 한 행은 그대로 두고 다음 실행에서 다시 본다.
 *  4. 실행 요약 region_rejudge_runs (dryRun 은 기록하지 않는다 — LLM 은 부르고 쓰지 않는다)
 * 같은 시각 실행 두 개는 advisory lock 으로 막는다 (locked).
 */
import { randomUUID } from "node:crypto";
import pool from "./db";
import { PUBLIC_NEWS_WHERE } from "./news-query";
import { BACKFILL_METHOD_VERSIONS, REGION_VERSION } from "./region";
import { inIngestWindow, rejudgeRegions, type JudgeStage } from "./region-judge";

export const REJUDGE_DEFAULT_HOURS = 72;
export const REJUDGE_DEFAULT_LIMIT = 600;
export const REJUDGE_MAX_LIMIT = 3000;
const MAX_COST = Number(process.env.REGION_REJUDGE_MAX_COST_USD || "0.10");
const LOCK_KEY = "region_rejudge";

export interface RejudgeOptions {
  /** ISO 시각. 없으면 지금부터 72시간 전 */
  since?: string;
  limit?: number;
  dryRun?: boolean;
  /** 시험용: 이미 백필 방식으로 판정된 이 판본들도 다시 본다 (예: ["rule-v1","llm-v1"]) */
  includeVersions?: string[];
  /** 수집 시간대 검사 건너뛰기 (CLI·시험) */
  ignoreIngestWindow?: boolean;
}

export interface RejudgeChange {
  id: string;
  title_kr: string;
  stage: JudgeStage;
  old: { subject_region: string | null; region_tags: string[]; region_version: string | null };
  new: { subject_region: string; region_tags: string[]; region_version: string };
}

export interface RejudgeResult {
  runId: string;
  outcome: "done" | "dry_run" | "nothing_to_do" | "locked" | "skipped_ingest_window" | "failed";
  since: string;
  selected: number;
  rules: number;
  llm: number;
  /** 대표 지역이 바뀐 행 (dryRun 은 바뀔 행) */
  changed: number;
  tagsChanged: number;
  unchanged: number;
  failed: number;
  conflicts: number;
  /** 판정 전 판본별 행 수 / 그중 대표 지역이 바뀐 수 */
  byOldVersion: Record<string, { n: number; changed: number }>;
  llmCalls: number;
  costUsd: number;
  /** n8n 경고 조건: 판정 못 한 행이 5건 넘고 20% 넘음, 또는 LLM 오류 */
  alert: boolean;
  examples: RejudgeChange[];
  message?: string;
}

interface Row {
  id: string;
  title_kr: string | null;
  title_cn: string | null;
  summary_kr: string | null;
  subject_region: string | null;
  region_tags: string[];
  region_version: string | null;
}

const sameTags = (a: readonly string[], b: readonly string[]) => a.length === b.length && [...a].sort().join(",") === [...b].sort().join(",");

/** 요청 본문 → 옵션 (라우트 단위 테스트용, DB 없음) */
export function parseRejudgeBody(body: unknown): RejudgeOptions | { error: string } {
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const out: RejudgeOptions = {};
  if (b.since !== undefined) {
    if (typeof b.since !== "string" || Number.isNaN(Date.parse(b.since))) return { error: "since must be an ISO timestamp" };
    out.since = new Date(b.since).toISOString();
  }
  if (b.limit !== undefined) {
    const n = Number(b.limit);
    if (!Number.isInteger(n) || n < 1 || n > REJUDGE_MAX_LIMIT) return { error: `limit must be an integer 1..${REJUDGE_MAX_LIMIT}` };
    out.limit = n;
  }
  if (b.dryRun !== undefined) {
    if (typeof b.dryRun !== "boolean") return { error: "dryRun must be boolean" };
    out.dryRun = b.dryRun;
  }
  if (b.includeVersions !== undefined) {
    if (!Array.isArray(b.includeVersions) || !b.includeVersions.every((v) => typeof v === "string" && /^[a-z0-9.-]{1,40}$/.test(v)))
      return { error: "includeVersions must be an array of version strings" };
    out.includeVersions = b.includeVersions as string[];
  }
  return out;
}

export async function runRejudge(opts: RejudgeOptions = {}): Promise<RejudgeResult> {
  const runId = `rj-${new Date().toISOString().replace(/[-:]/g, "").slice(0, 15)}-${randomUUID().slice(0, 6)}`;
  const since = opts.since ?? new Date(Date.now() - REJUDGE_DEFAULT_HOURS * 3600_000).toISOString();
  const empty: RejudgeResult = {
    runId, outcome: "nothing_to_do", since, selected: 0, rules: 0, llm: 0, changed: 0, tagsChanged: 0, unchanged: 0, failed: 0,
    conflicts: 0, byOldVersion: {}, llmCalls: 0, costUsd: 0, alert: false, examples: [],
  };
  if (!opts.ignoreIngestWindow && inIngestWindow()) {
    return { ...empty, outcome: "skipped_ingest_window", message: "수집 시간대(22:45–23:45 / 08:45–09:45 KST)에는 재판정하지 않습니다" };
  }
  const client = await pool.connect();
  try {
    const { rows: lk } = await client.query("SELECT pg_try_advisory_lock(hashtext($1)) AS ok", [LOCK_KEY]);
    if (!lk[0]?.ok) return { ...empty, outcome: "locked", message: "다른 재판정이 실행 중" };
    try {
      const skip = BACKFILL_METHOD_VERSIONS.filter((v) => !(opts.includeVersions ?? []).includes(v));
      const limit = Math.min(opts.limit ?? REJUDGE_DEFAULT_LIMIT, REJUDGE_MAX_LIMIT);
      const { rows } = await client.query(
        `SELECT id::text, title_kr, title_cn, summary_kr, subject_region, region_tags, region_version
           FROM ai_news_ex
          WHERE ${PUBLIC_NEWS_WHERE} AND created_at >= $1::timestamptz
            AND (region_version IS NULL OR NOT (region_version = ANY($2::text[])))
          ORDER BY created_at, id LIMIT $3`,
        [since, skip, limit]
      );
      const todo = rows as Row[];
      if (!todo.length) return empty;

      const judged = await rejudgeRegions(todo, { capUsd: MAX_COST, caller: "region-rejudge" });
      const res: RejudgeResult = { ...empty, outcome: opts.dryRun ? "dry_run" : "done", selected: todo.length, llmCalls: judged.usage.calls, costUsd: judged.usage.costUsd };
      if (!opts.dryRun) {
        await client.query(`INSERT INTO region_rejudge_runs (run_id, since, dry_run) VALUES ($1, $2::timestamptz, false)`, [runId, since]);
      }
      for (const r of todo) {
        const ov = r.region_version ?? "(none)";
        res.byOldVersion[ov] ??= { n: 0, changed: 0 };
        res.byOldVersion[ov].n++;
        const j = judged.got.get(r.id);
        if (!j) {
          res.failed++;
          continue;
        }
        if (j.stage === "rule") res.rules++;
        else res.llm++;
        const version = j.stage === "rule" ? REGION_VERSION.rejudgeRule : REGION_VERSION.rejudgeLlm;
        const changed = j.value.subject_region !== r.subject_region;
        const tagsChanged = !sameTags(j.value.region_tags, r.region_tags ?? []);
        if (!opts.dryRun) {
          const { rowCount } = await client.query(
            `WITH u AS (
               UPDATE ai_news_ex SET subject_region = $2, region_tags = $3::text[], region_version = $4
                WHERE id = $1::uuid AND subject_region IS NOT DISTINCT FROM $5 AND region_tags = $6::text[]
                  AND region_version IS NOT DISTINCT FROM $7
                RETURNING id)
             INSERT INTO region_rejudge_log (run_id, article_id, stage, old_subject, old_tags, old_version, new_subject, new_tags, new_version, changed, tags_changed)
             SELECT $8, u.id, $9, $5, $6::text[], $7, $2, $3::text[], $4, $10, $11 FROM u`,
            [r.id, j.value.subject_region, j.value.region_tags, version, r.subject_region, r.region_tags ?? [], r.region_version, runId, j.stage, changed, tagsChanged]
          );
          if (!rowCount) {
            res.conflicts++;
            continue;
          }
        }
        if (changed) {
          res.changed++;
          res.byOldVersion[ov].changed++;
        } else if (tagsChanged) res.tagsChanged++;
        else res.unchanged++;
        if ((changed || tagsChanged) && res.examples.length < 15)
          res.examples.push({
            id: r.id, title_kr: (r.title_kr ?? "").slice(0, 60), stage: j.stage,
            old: { subject_region: r.subject_region, region_tags: r.region_tags ?? [], region_version: r.region_version },
            new: { ...j.value, region_version: version },
          });
      }
      res.alert = judged.usage.errors.length > 0 || (res.failed > 5 && res.failed / res.selected > 0.2);
      if (judged.usage.errors.length) res.message = `LLM 오류 ${judged.usage.errors.length}건: ${judged.usage.errors[0].slice(0, 200)}`;
      if (!opts.dryRun) {
        await client.query(
          `UPDATE region_rejudge_runs SET finished_at = now(), selected = $2, by_rule = $3, by_llm = $4, changed = $5, tags_changed = $6,
                  failed = $7, conflicts = $8, llm_calls = $9, cost_usd = $10, error = $11 WHERE run_id = $1`,
          [runId, res.selected, res.rules, res.llm, res.changed, res.tagsChanged, res.failed, res.conflicts, res.llmCalls, res.costUsd, res.message ?? null]
        );
      }
      return res;
    } finally {
      await client.query("SELECT pg_advisory_unlock(hashtext($1))", [LOCK_KEY]);
    }
  } finally {
    client.release();
  }
}

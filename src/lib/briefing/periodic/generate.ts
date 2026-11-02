/**
 * 주간 리포트 생성 — 데일리 generate.ts 와 같은 뼈대 (설계 검토서 §3.2, Gate 2).
 * CLI(scripts/briefing-generate.ts weekly)와 관리자 "다시 생성"이 이 함수 하나를 부른다.
 *
 *  1. 기간 잠금 periodic:weekly:2026-W44
 *  2. 공용 지표 computePeriodMetrics(start, end, 지난주, population 'ai') — 결손일·같은 요일 비교 포함
 *  3. 결손일이 있으면 force 없이는 생성하지 않는다 (수집 보충이 끝나지 않은 기간). force 로 만든 판은
 *     content.meta.data_quality 에 결손일이 남고, 발행할 때 관리자 확인(acknowledgeDataQuality)이 필요하다.
 *  4. period_metrics 스냅숏 저장 (fingerprint 가 같으면 기존 행 재사용)
 *  5. 이야기 후보 S01.. → input_hash 가 이전 판과 같으면 건너뜀 (force 제외)
 *  6. ko 1회 생성 → 검증 → 치명·방향 충돌·제목 길이·한자가 있으면 수리 1회 → 남은 치명 항목 삭제,
 *     headline·dek 가 빠지면 결정적 문장으로 대체 → 큰 흐름 2개 미만이면 failed
 *  7. daily_briefings 에 edition_type='weekly', edition_date=period_start, status draft (발행은 관리자)
 * MVP 는 한국어판만 만든다 (번역은 v2).
 */
import { createHash } from "node:crypto";
import pool from "@/lib/db";
import { computePeriodMetrics, isoWeekOf, isoWeekRange, addDays, type PeriodMetrics, type PeriodStory } from "@/lib/metrics/period";
import { BRIEFING_MODEL, LlmError, chat, parseJsonContent } from "../llm";
import { articleText } from "../validate";
import { BudgetExceeded, CostTracker, beijingToday, sumUsage } from "../generate";
import { finishGenerating, insertBriefing, latestBriefing, withDateLock } from "../repository";
import type { CandidateArticle, LlmUsage } from "../types";
import {
  WEEKLY_HEADLINE_MAX,
  WEEKLY_PROMPT_VERSION,
  buildFacts,
  buildStoryPool,
  buildWeeklyRepairPrompt,
  buildWeeklySystemPrompt,
  buildWeeklyUserPrompt,
  fallbackDek,
  fallbackHeadline,
} from "./prompt";
import type { PeriodicValidationReport, StoredWeeklyContent, StoryPoolItem, WeeklyContent, WeeklyMeta } from "./types";
import {
  citedSids,
  dropFatalPeriodic,
  needsRepair,
  normalizeWeekly,
  repairProblems,
  validateWeekly,
  type PeriodicValidationContext,
} from "./validate";

const PERIODIC_MAX_COST = Number(process.env.PERIODIC_MAX_COST_USD || "0.05");
const MIN_BIG_PICTURE = 2;

export interface WeeklyGenerateOptions {
  /** "2026-W44". 없으면 start, 둘 다 없으면 베이징 기준 지난주 */
  isoWeek?: string;
  /** 그 주 월요일 YYYY-MM-DD */
  start?: string;
  force?: boolean;
  /** LLM 을 부르지 않고 지표·프롬프트 크기만 */
  dryRun?: boolean;
}

export interface WeeklyGenerateResult {
  week: string;
  start: string | null;
  end: string | null;
  outcome: "generated" | "failed" | "skipped_same_input" | "locked" | "dry_run" | "blocked_data_quality" | "invalid_week";
  id: string | null;
  version: number | null;
  status: string | null;
  metricsId: string | null;
  incompleteDays: string[];
  fatal: number;
  warn: number;
  repaired: boolean;
  dropped: string[];
  fallbacks: string[];
  inputHash: string | null;
  costUsd: number;
  message?: string;
}

/** 주 지정 해석: 형식·미래·진행 중인 주를 거른다 (끝 날짜가 베이징 오늘 이후면 아직 끝나지 않은 주) */
export function resolveWeek(opts: { isoWeek?: string; start?: string }, today = beijingToday()): { week: string; start: string; end: string } | { error: string } {
  let week = opts.isoWeek;
  if (!week && opts.start) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(opts.start)) return { error: "start 형식이 틀렸습니다 (YYYY-MM-DD)" };
    week = isoWeekOf(opts.start);
    if (isoWeekRange(week)?.start !== opts.start) return { error: "start 는 월요일이어야 합니다" };
  }
  if (!week) week = isoWeekOf(addDays(today, -7));
  const range = isoWeekRange(week);
  if (!range) return { error: `주 형식이 틀렸습니다: ${week} (예: 2026-W44)` };
  if (range.end >= today) return { error: `${week} 는 아직 끝나지 않은 주입니다 (끝 ${range.end}, 베이징 오늘 ${today})` };
  return { week, ...range };
}

/** 스냅숏 저장 — fingerprint 가 같은 행이 있으면 그 id. 저장본은 스토리 본문을 빼 ~30KB */
async function upsertPeriodMetrics(m: PeriodMetrics): Promise<string> {
  const { rows } = await pool.query(
    `INSERT INTO period_metrics (period_type, period_start, period_end, baseline_start, baseline_end, population,
                                 metrics_version, fingerprint, metrics, data_quality)
     VALUES ($1, $2::date, $3::date, $4::date, $5::date, $6, $7, $8, $9::jsonb, $10::jsonb)
     ON CONFLICT (period_type, period_start, population, metrics_version, fingerprint)
     DO UPDATE SET period_end = EXCLUDED.period_end
     RETURNING id`,
    [
      m.kind, m.period.start, m.period.end, m.baseline?.start ?? null, m.baseline?.end ?? null, m.population,
      m.metrics_version, m.fingerprint, JSON.stringify(m), JSON.stringify(m.data_quality),
    ]
  );
  return rows[0].id as string;
}

/** S id → 근거 텍스트 (묶음 기사 전체). 데일리와 같은 articleText */
async function loadSourceText(poolItems: StoryPoolItem[]): Promise<Map<string, string>> {
  const ids = [...new Set(poolItems.flatMap((p) => p.ids))];
  const { rows } = await pool.query(
    `SELECT id, COALESCE(title_cn, '') AS title_cn, COALESCE(title_kr, '') AS title_kr,
            COALESCE(summary_kr, '') AS summary_kr, COALESCE(ai_insights_kr, '') AS ai_insights_kr
       FROM ai_news_ex WHERE id = ANY($1::uuid[])`,
    [ids]
  );
  const byId = new Map((rows as CandidateArticle[]).map((a) => [a.id, articleText(a)]));
  return new Map(poolItems.map((p) => [p.sid, p.ids.map((id) => byId.get(id) ?? "").join(" ")]));
}

export function validationContext(m: PeriodMetrics, sourceText: Map<string, string>): PeriodicValidationContext {
  return {
    kind: "weekly",
    sourceText,
    facts: buildFacts(m),
    entityNames: new Map(m.entities.map((e) => [e.key, e.name_ko])),
    terms: new Set(m.terms.top.map((t) => t.term)),
    headlineMax: WEEKLY_HEADLINE_MAX,
  };
}

export function computeWeeklyInputHash(m: PeriodMetrics, poolItems: StoryPoolItem[]): string {
  return createHash("sha256")
    .update(JSON.stringify({ v: WEEKLY_PROMPT_VERSION, model: BRIEFING_MODEL, fp: m.fingerprint, pool: poolItems.map((p) => `${p.sid}:${p.ids.join(",")}`) }))
    .digest("hex");
}

/** S id → uuid (묶음 기사 전부) */
export function toStoredWeekly(
  c: WeeklyContent,
  poolItems: StoryPoolItem[],
  meta: WeeklyMeta
): { content: StoredWeeklyContent; articleIds: string[] } {
  const bySid = new Map(poolItems.map((p) => [p.sid, p.ids]));
  const many = (rs: string[]) => [...new Set(rs.flatMap((r) => bySid.get(r) ?? []))];
  const content: StoredWeeklyContent = {
    headline: c.headline,
    dek: c.dek,
    dek_refs: many(c.dek_refs),
    dek_metrics: c.dek_metrics,
    big_picture: c.big_picture.map((b) => ({ ...b, refs: many(b.refs) })),
    movers: c.movers.map((b) => ({ ...b, refs: many(b.refs) })),
    money: c.money ? { ...c.money, refs: many(c.money.refs) } : null,
    china_lens: c.china_lens ? { ...c.china_lens, refs: many(c.china_lens.refs) } : null,
    watch_next: c.watch_next.map((w) => ({ ...w, refs: many(w.refs) })),
    term: c.term,
    meta,
  };
  return { content, articleIds: many([...new Set(citedSids(c))]) };
}

interface KoOutcome {
  status: "draft" | "failed";
  content: WeeklyContent | null;
  validation: Record<string, unknown>;
  report: PeriodicValidationReport | null;
  repaired: boolean;
  dropped: string[];
  fallbacks: string[];
  error?: string;
}

async function generateWeeklyKo(m: PeriodMetrics, poolItems: StoryPoolItem[], ctx: PeriodicValidationContext, cost: CostTracker): Promise<KoOutcome> {
  const system = buildWeeklySystemPrompt();
  const user = buildWeeklyUserPrompt(m, ctx.facts, poolItems);
  const validation: Record<string, unknown> = { prompt_version: WEEKLY_PROMPT_VERSION, prompt_chars: system.length + user.length };
  const track = (u: LlmUsage) => cost.add(u);

  cost.check();
  const first = await chat({ system, messages: [{ role: "user", content: user }], maxTokens: 6000 }, track);
  const p1 = normalizeWeekly(parseJsonContent(first.content));
  let content = p1.content;
  let report = validateWeekly(content, ctx, p1.issues);
  validation.initial = report;
  let repaired = false;

  if (needsRepair(report)) {
    try {
      cost.check();
      const second = await chat(
        {
          system,
          messages: [
            { role: "user", content: user },
            { role: "assistant", content: first.content },
            { role: "user", content: buildWeeklyRepairPrompt(content, repairProblems(report), []) },
          ],
          maxTokens: 6000,
        },
        track
      );
      const p2 = normalizeWeekly(parseJsonContent(second.content));
      const r2 = validateWeekly(p2.content, ctx, p2.issues);
      validation.repair = r2;
      // 수리본이 더 나쁘면(치명 증가·큰 흐름 감소) 원본 유지
      if (r2.fatal.length <= report.fatal.length && r2.stats.bigPicture >= Math.min(report.stats.bigPicture, MIN_BIG_PICTURE)) {
        content = p2.content;
        report = r2;
        repaired = true;
        validation.used = "repair";
      } else validation.used = "initial";
    } catch (e) {
      if (e instanceof BudgetExceeded) throw e;
      validation.repair_error = (e as Error).message;
      validation.used = "initial";
    }
  }

  let dropped: string[] = [];
  const fallbacks: string[] = [];
  if (report.fatal.length) {
    const d = dropFatalPeriodic(content, report.fatal);
    content = d.content;
    dropped = d.dropped;
    if (d.needsFallback.includes("dek")) {
      const fb = fallbackDek(m);
      content.dek = fb.text;
      content.dek_refs = [];
      content.dek_metrics = fb.metrics;
      fallbacks.push("dek");
    }
    if (d.needsFallback.includes("headline")) {
      content.headline = fallbackHeadline(m);
      fallbacks.push("headline");
    }
    report = validateWeekly(content, ctx);
  }
  validation.dropped_items = dropped;
  validation.fallbacks = fallbacks;
  validation.final = report;
  if (report.fatal.length) return { status: "failed", content, validation, report, repaired, dropped, fallbacks, error: "재검증 후에도 치명 위반이 남음" };
  if (content.big_picture.length < MIN_BIG_PICTURE)
    return { status: "failed", content, validation, report, repaired, dropped, fallbacks, error: `큰 흐름 ${content.big_picture.length}개 < ${MIN_BIG_PICTURE}개` };
  return { status: "draft", content, validation, report, repaired, dropped, fallbacks };
}

export async function generateWeekly(opts: WeeklyGenerateOptions = {}): Promise<WeeklyGenerateResult> {
  const base = {
    id: null, version: null, status: null, metricsId: null, incompleteDays: [] as string[], fatal: 0, warn: 0,
    repaired: false, dropped: [] as string[], fallbacks: [] as string[], inputHash: null, costUsd: 0,
  };
  const wk = resolveWeek(opts);
  if ("error" in wk) return { ...base, week: opts.isoWeek ?? opts.start ?? "", start: null, end: null, outcome: "invalid_week", message: wk.error };
  const { week, start, end } = wk;
  const head = { ...base, week, start, end };

  const result = await withDateLock(
    start,
    async (): Promise<WeeklyGenerateResult> => {
      const prevStart = addDays(start, -7);
      const prevEnd = addDays(start, -1);
      const { metrics: m, stories } = await computePeriodMetrics(pool, { kind: "weekly", start, end, prevStart, prevEnd, population: "ai" });
      const incompleteDays = m.data_quality.incomplete_days;
      const h = { ...head, incompleteDays };
      if (incompleteDays.length && !opts.force && !opts.dryRun) {
        return {
          ...h,
          outcome: "blocked_data_quality",
          message: `수집 미완 날짜 ${incompleteDays.join(", ")} — 보충이 끝난 뒤 생성하거나 --force 로 만든 뒤 발행 때 데이터 알림을 확인하십시오`,
        };
      }
      const poolItems = buildStoryPool(stories as PeriodStory[], m.money_table);
      const inputHash = computeWeeklyInputHash(m, poolItems);
      if (opts.dryRun) {
        const facts = buildFacts(m);
        const chars = buildWeeklySystemPrompt().length + buildWeeklyUserPrompt(m, facts, poolItems).length;
        return { ...h, inputHash, outcome: "dry_run", message: `기사 ${m.volume.total}건, 후보 ${poolItems.length}개, 지표 ${Object.keys(facts).length}개, 프롬프트 ${chars}자` };
      }

      const prev = await latestBriefing(start, "ko", "weekly");
      if (!opts.force && prev && prev.input_hash === inputHash && ["draft", "published"].includes(prev.status)) {
        return { ...h, inputHash, outcome: "skipped_same_input", id: prev.id, version: prev.version, status: prev.status, metricsId: prev.metrics_id, message: `입력이 같아 건너뜀 (v${prev.version} ${prev.status})` };
      }

      const metricsId = await upsertPeriodMetrics(m);
      const sourceText = await loadSourceText(poolItems);
      const ctx = validationContext(m, sourceText);
      const inputArticleIds = [...new Set(poolItems.flatMap((p) => p.ids))];
      const row = await insertBriefing({
        editionType: "weekly", date: start, periodStart: start, periodEnd: end, metricsId,
        locale: "ko", status: "generating", mode: "normal", content: {}, articleIds: [], inputArticleIds,
        candidateCount: m.volume.total, inputHash, model: BRIEFING_MODEL, promptVersion: WEEKLY_PROMPT_VERSION,
      });
      const cost = new CostTracker(PERIODIC_MAX_COST);
      let ko: KoOutcome;
      try {
        ko = await generateWeeklyKo(m, poolItems, ctx, cost);
      } catch (e) {
        const msg = e instanceof LlmError || e instanceof BudgetExceeded ? e.message : `예상치 못한 오류: ${(e as Error).message}`;
        const u = sumUsage(cost.usages);
        await finishGenerating(row.id, { status: "failed", content: {}, articleIds: [], validation: null, model: BRIEFING_MODEL, promptVersion: WEEKLY_PROMPT_VERSION, ...u, error: msg });
        return { ...h, inputHash, metricsId, outcome: "failed", id: row.id, version: row.version, status: "failed", costUsd: u.costUsd, message: msg };
      }
      const meta: WeeklyMeta = {
        edition_type: "weekly", iso_week: week, period_start: start, period_end: end, locale: "ko",
        prompt_version: WEEKLY_PROMPT_VERSION, metrics_id: metricsId, metrics_version: m.metrics_version,
        candidate_count: m.volume.total, story_count: poolItems.length,
        data_quality: { incomplete_days: incompleteDays }, fallbacks: ko.fallbacks, ai_generated: true,
      };
      const stored = ko.content ? toStoredWeekly(ko.content, poolItems, meta) : null;
      const u = sumUsage(cost.usages);
      await finishGenerating(row.id, {
        status: ko.status, content: stored?.content ?? {}, articleIds: stored?.articleIds ?? [], validation: ko.validation,
        model: BRIEFING_MODEL, promptVersion: WEEKLY_PROMPT_VERSION, ...u, error: ko.error ?? null,
      });
      return {
        ...h, inputHash, metricsId, outcome: ko.status === "draft" ? "generated" : "failed", id: row.id, version: row.version,
        status: ko.status, fatal: ko.report?.fatal.length ?? 0, warn: ko.report?.warn.length ?? 0, repaired: ko.repaired,
        dropped: ko.dropped, fallbacks: ko.fallbacks, costUsd: u.costUsd, message: ko.error,
      };
    },
    "weekly",
    week
  );
  return result ?? { ...head, outcome: "locked", message: "같은 주를 다른 실행이 생성 중" };
}

/**
 * briefing_reviews 저장소 (scripts/2026-11-02-briefing-reviews.sql).
 */
import pool from "@/lib/db";
import type { EditionType } from "../repository";
import type { Decision } from "./policy";
import type { ReviewResult } from "./types";

export async function insertReview(r: ReviewResult, extra: { parentReviewId?: string | null; decision?: Decision | null } = {}): Promise<string> {
  const { rows } = await pool.query(
    `INSERT INTO briefing_reviews
       (briefing_id, version, edition_type, edition_date, round, trigger, model, prompt_version, status, verdict, llm_verdict, score,
        counts, claims, fixes, omissions, translation, structure, summary, decision, parent_review_id, llm_request_ids,
        input_tokens, output_tokens, cost_usd, latency_ms, error, raw_response)
     VALUES ($1::uuid, $2, $3, $4::date, $5, $6, $7, $8, $9, $10, $11, $12,
             $13::jsonb, $14::jsonb, $15::jsonb, $16::jsonb, $17::jsonb, $18::jsonb, $19, $20::jsonb, $21::uuid, $22::text[],
             $23, $24, $25, $26, $27, $28)
     RETURNING id`,
    [
      r.briefingId, r.version, r.editionType, r.editionDate, r.round, r.trigger, r.model, r.promptVersion, r.status, r.verdict, r.llmVerdict, r.score,
      // readability(why 쉬움 점검)는 열을 늘리지 않고 counts JSON 에 함께 둔다 (판정·점수와 무관한 기록)
      JSON.stringify(r.counts ? { ...r.counts, breakdown: r.breakdown, schema_issues: r.schemaIssues, readability: r.readability ?? [] } : null),
      JSON.stringify(r.claims), JSON.stringify(r.fixes), JSON.stringify(r.omissions), JSON.stringify(r.translation), JSON.stringify(r.structure),
      r.summary || null, extra.decision ? JSON.stringify(extra.decision) : null, extra.parentReviewId ?? null, r.requestIds,
      r.inputTokens, r.outputTokens, r.costUsd, r.latencyMs, r.error ?? null, r.rawResponse ?? null,
    ]
  );
  return rows[0].id as string;
}

/** 판정·수정 결과를 나중에 붙인다 (검토 → 수정 → 결정 순서라) */
export async function updateReviewDecision(id: string, patch: { decision?: unknown; fixedBriefingId?: string | null }): Promise<void> {
  await pool.query(
    `UPDATE briefing_reviews SET decision = COALESCE($2::jsonb, decision), fixed_briefing_id = COALESCE($3::uuid, fixed_briefing_id) WHERE id = $1::uuid`,
    [id, patch.decision === undefined ? null : JSON.stringify(patch.decision), patch.fixedBriefingId ?? null]
  );
}

export interface StoredReview {
  id: string;
  briefing_id: string;
  version: number;
  edition_type: EditionType;
  edition_date: string;
  round: number;
  trigger: string;
  model: string;
  prompt_version: string;
  status: string;
  verdict: string | null;
  llm_verdict: string | null;
  score: string | null;
  counts: (Record<string, number> & { breakdown?: string[]; schema_issues?: string[]; readability?: { sid: string; path: string; issue: string }[] }) | null;
  claims: ReviewResult["claims"] | null;
  fixes: ReviewResult["fixes"] | null;
  omissions: ReviewResult["omissions"] | null;
  translation: ReviewResult["translation"] | null;
  structure: string[] | null;
  summary: string | null;
  decision: (Record<string, unknown> & { summary?: string; publish?: boolean; eligible?: boolean }) | null;
  parent_review_id: string | null;
  fixed_briefing_id: string | null;
  cost_usd: string | null;
  latency_ms: number | null;
  error: string | null;
  created_at: string;
}

const COLS = `id, briefing_id, version, edition_type, to_char(edition_date, 'YYYY-MM-DD') AS edition_date, round, trigger, model,
  prompt_version, status, verdict, llm_verdict, score, counts, claims, fixes, omissions, translation, structure, summary, decision,
  parent_review_id, fixed_briefing_id, cost_usd, latency_ms, error, created_at`;

/** 판 한 버전의 검토 기록 (최신순) — 관리자 상세 화면 */
export async function reviewsOf(briefingId: string, limit = 10): Promise<StoredReview[]> {
  const { rows } = await pool.query(`SELECT ${COLS} FROM briefing_reviews WHERE briefing_id = $1::uuid ORDER BY created_at DESC LIMIT $2`, [briefingId, limit]);
  return rows as StoredReview[];
}

/** 이 버전을 고쳐 만든 검토 (fixed_briefing_id = 이 버전) — 수정본 상세 화면에서 "어디서 왔나" */
export async function reviewThatProduced(briefingId: string): Promise<StoredReview | null> {
  const { rows } = await pool.query(`SELECT ${COLS} FROM briefing_reviews WHERE fixed_briefing_id = $1::uuid ORDER BY created_at DESC LIMIT 1`, [briefingId]);
  return (rows[0] as StoredReview) ?? null;
}

/** 판(유형·날짜)의 가장 최근 정기·수동 검토 (보정·dry_run 제외) — 상태 API 알림 요약 */
export async function latestReviewFor(editionType: EditionType, editionDate: string): Promise<StoredReview | null> {
  const { rows } = await pool.query(
    `SELECT ${COLS} FROM briefing_reviews WHERE edition_type = $1 AND edition_date = $2::date AND trigger IN ('pipeline', 'manual')
      ORDER BY created_at DESC LIMIT 1`,
    [editionType, editionDate]
  );
  return (rows[0] as StoredReview) ?? null;
}

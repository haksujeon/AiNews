/**
 * daily_briefings 저장소.
 *
 *  - 동시 실행 방지: 날짜별 pg_try_advisory_lock (세션 잠금이라 같은 client 로 풀어야 한다)
 *  - 발행본은 절대 덮어쓰지 않는다: 재생성은 언제나 version+1 의 새 행.
 *    UPDATE 는 'generating' 행을 마무리할 때만 쓴다.
 *  - news_date 는 "베이징 날짜의 00:00 UTC" 로 저장되어 있다 (n8n-hash.ts 참고) → UTC 기준 범위로 조회.
 */
import type { PoolClient } from "pg";
import pool from "@/lib/db";
import { PUBLIC_NEWS_WHERE } from "@/lib/news-query";
import { scopeCategorySql } from "@/lib/categories";
import type { BriefingLocale, BriefingStatus, CandidateArticle, EditionMode } from "./types";

/** 판 유형. 데일리·주간·월간이 같은 테이블·상태 기계·관리자 화면을 쓴다 (Gate 2) */
export type EditionType = "daily" | "weekly" | "monthly";
export const EDITION_TYPES: EditionType[] = ["daily", "weekly", "monthly"];
/** 기본 유형 (인자를 주지 않은 호출 = 데일리) */
export const EDITION_TYPE: EditionType = "daily";

export function isEditionType(v: unknown): v is EditionType {
  return typeof v === "string" && (EDITION_TYPES as string[]).includes(v);
}

export interface BriefingRow {
  id: string;
  edition_type: EditionType;
  edition_date: string; // YYYY-MM-DD (주간·월간 = period_start)
  period_start: string | null;
  period_end: string | null;
  metrics_id: string | null;
  locale: BriefingLocale;
  version: number;
  status: BriefingStatus;
  mode: EditionMode;
  schema_version: number;
  content: Record<string, unknown>;
  article_ids: string[];
  input_article_ids: string[];
  candidate_count: number;
  input_hash: string;
  validation: Record<string, unknown> | null;
  source_briefing_id: string | null;
  model: string | null;
  prompt_version: string | null;
  llm_request_ids: string[] | null;
  input_tokens: number | null;
  output_tokens: number | null;
  cost_usd: string | null;
  latency_ms: number | null;
  error: string | null;
  needs_review: boolean;
  edited_by: string | null;
  created_at: string;
  updated_at: string;
  published_at: string | null;
}

export const ROW_COLUMNS = `id, edition_type, to_char(edition_date, 'YYYY-MM-DD') AS edition_date,
  to_char(period_start, 'YYYY-MM-DD') AS period_start, to_char(period_end, 'YYYY-MM-DD') AS period_end, metrics_id,
  locale, version, status, mode,
  schema_version, content, article_ids, input_article_ids, candidate_count, input_hash, validation, source_briefing_id,
  model, prompt_version, llm_request_ids, input_tokens, output_tokens, cost_usd, latency_ms, error, needs_review,
  edited_by, created_at, updated_at, published_at`;

/** 그날(베이징 news_date) 공개 범위 내(AI) 기사 — 분류 목록은 categories.ts. endDate 를 주면 date~endDate (주말 합본) */
export async function loadCandidateArticles(date: string, endDate: string = date): Promise<CandidateArticle[]> {
  const { rows } = await pool.query(
    `SELECT id, source_name, source_url, category,
            COALESCE(title_cn, '') AS title_cn, COALESCE(title_kr, '') AS title_kr,
            COALESCE(summary_kr, '') AS summary_kr, COALESCE(ai_insights_kr, '') AS ai_insights_kr,
            COALESCE(key_terms, '[]'::jsonb) AS key_terms,
            COALESCE(summary_cn, '') AS summary_cn, to_char((news_date AT TIME ZONE 'UTC')::date, 'YYYY-MM-DD') AS news_date
       FROM ai_news_ex
      WHERE ${PUBLIC_NEWS_WHERE}
        AND ${scopeCategorySql()}
        AND news_date >= ($1::date)::timestamp AT TIME ZONE 'UTC'
        AND news_date <  ($2::date + 1)::timestamp AT TIME ZONE 'UTC'
      ORDER BY id`,
    [date, endDate]
  );
  return rows.map((r) => ({ ...r, key_terms: Array.isArray(r.key_terms) ? r.key_terms : [] })) as CandidateArticle[];
}

/** 잠금 키. 데일리는 예전 키를 그대로 써서 옛 코드와도 서로 막는다. 주간·월간은 periodic:weekly:2026-W44 처럼 */
export function lockKey(date: string, editionType: EditionType = EDITION_TYPE, label?: string): string {
  return editionType === "daily" ? `daily_briefing:${date}` : `periodic:${editionType}:${label ?? date}`;
}

/** 판별 잠금. 이미 다른 실행이 잡고 있으면 null */
export async function withDateLock<T>(
  date: string,
  fn: () => Promise<T>,
  editionType: EditionType = EDITION_TYPE,
  label?: string
): Promise<T | null> {
  const client: PoolClient = await pool.connect();
  const key = lockKey(date, editionType, label);
  try {
    const { rows } = await client.query("SELECT pg_try_advisory_lock(hashtext($1)) AS ok", [key]);
    if (!rows[0]?.ok) return null;
    try {
      return await fn();
    } finally {
      await client.query("SELECT pg_advisory_unlock(hashtext($1))", [key]);
    }
  } finally {
    client.release();
  }
}

export async function latestBriefing(date: string, locale: BriefingLocale, editionType: EditionType = EDITION_TYPE): Promise<BriefingRow | null> {
  const { rows } = await pool.query(
    `SELECT ${ROW_COLUMNS} FROM daily_briefings
      WHERE edition_type = $1 AND edition_date = $2::date AND locale = $3
      ORDER BY version DESC LIMIT 1`,
    [editionType, date, locale]
  );
  return (rows[0] as BriefingRow) ?? null;
}

/** 직전 판(발행본 우선, 없으면 최신 초안)의 헤드라인·주요 기사 제목 — 같은 사건 반복을 "후속" 으로 쓰게 프롬프트에 넣는다 */
export interface PreviousEdition {
  date: string;
  headline: string;
  titles: string[];
}

export async function previousEditionSummary(date: string): Promise<PreviousEdition | null> {
  const { rows } = await pool.query(
    `SELECT to_char(edition_date, 'YYYY-MM-DD') AS date, content->>'headline' AS headline,
            COALESCE((SELECT array_agg(x->>'title') FROM jsonb_array_elements(
              CASE WHEN jsonb_typeof(content->'top_stories') = 'array' THEN content->'top_stories' ELSE '[]'::jsonb END) x), '{}') AS titles
       FROM daily_briefings
      WHERE edition_type = 'daily' AND locale = 'ko' AND edition_date < $1::date AND edition_date >= $1::date - 4
        AND status IN ('published', 'draft')
      ORDER BY edition_date DESC, (status = 'published') DESC, version DESC
      LIMIT 1`,
    [date]
  );
  const r = rows[0] as { date: string; headline: string | null; titles: string[] } | undefined;
  return r && r.headline ? { date: r.date, headline: r.headline, titles: (r.titles ?? []).filter(Boolean) } : null;
}

export interface NewBriefing {
  /** 기본 'daily' */
  editionType?: EditionType;
  date: string;
  /** 기본: date ~ date (데일리) */
  periodStart?: string;
  periodEnd?: string;
  metricsId?: string | null;
  locale: BriefingLocale;
  status: BriefingStatus;
  mode: EditionMode;
  content: unknown;
  articleIds: string[];
  inputArticleIds: string[];
  candidateCount: number;
  inputHash: string;
  validation?: unknown;
  sourceBriefingId?: string | null;
  model?: string | null;
  promptVersion?: string | null;
  llmRequestIds?: string[];
  inputTokens?: number;
  outputTokens?: number;
  costUsd?: number;
  latencyMs?: number;
  error?: string | null;
}

/** 새 버전 행 추가 (version = 그 판·언어의 최대 + 1). 잠금 안에서 부른다. */
export async function insertBriefing(b: NewBriefing): Promise<{ id: string; version: number }> {
  const { rows } = await pool.query(
    `INSERT INTO daily_briefings
       (edition_type, edition_date, locale, version, status, mode, content, article_ids, input_article_ids,
        candidate_count, input_hash, validation, source_briefing_id, model, prompt_version, llm_request_ids,
        input_tokens, output_tokens, cost_usd, latency_ms, error, period_start, period_end, metrics_id)
     SELECT $1, $2::date, $3,
            COALESCE((SELECT MAX(version) FROM daily_briefings WHERE edition_type = $1 AND edition_date = $2::date AND locale = $3), 0) + 1,
            $4, $5, $6::jsonb, $7::uuid[], $8::uuid[], $9, $10, $11::jsonb, $12, $13, $14, $15::text[], $16, $17, $18, $19, $20,
            $21::date, $22::date, $23::uuid
     RETURNING id, version`,
    [
      b.editionType ?? EDITION_TYPE, b.date, b.locale, b.status, b.mode, JSON.stringify(b.content ?? {}), b.articleIds, b.inputArticleIds,
      b.candidateCount, b.inputHash, b.validation === undefined ? null : JSON.stringify(b.validation),
      b.sourceBriefingId ?? null, b.model ?? null, b.promptVersion ?? null, b.llmRequestIds ?? [],
      b.inputTokens ?? null, b.outputTokens ?? null, b.costUsd ?? null, b.latencyMs ?? null, b.error ?? null,
      b.periodStart ?? b.date, b.periodEnd ?? b.date, b.metricsId ?? null,
    ]
  );
  return rows[0] as { id: string; version: number };
}

/** 'generating' 행 마무리. 다른 상태(특히 published)는 건드리지 않는다. */
export async function finishGenerating(
  id: string,
  patch: Omit<NewBriefing, "date" | "locale" | "inputHash" | "candidateCount" | "inputArticleIds" | "mode" | "editionType" | "periodStart" | "periodEnd"> & {
    /** 삭제 뒤 최소 개수에 못 미쳐 짧은 판으로 내릴 때만 (없으면 그대로) */
    mode?: EditionMode;
  }
): Promise<boolean> {
  const { rowCount } = await pool.query(
    `UPDATE daily_briefings
        SET status = $2, content = $3::jsonb, article_ids = $4::uuid[], validation = $5::jsonb,
            model = $6, prompt_version = $7, llm_request_ids = $8::text[], input_tokens = $9, output_tokens = $10,
            cost_usd = $11, latency_ms = $12, error = $13, mode = COALESCE($14, mode), updated_at = now()
      WHERE id = $1 AND status = 'generating'`,
    [
      id, patch.status, JSON.stringify(patch.content ?? {}), patch.articleIds,
      patch.validation === undefined ? null : JSON.stringify(patch.validation),
      patch.model ?? null, patch.promptVersion ?? null, patch.llmRequestIds ?? [],
      patch.inputTokens ?? null, patch.outputTokens ?? null, patch.costUsd ?? null, patch.latencyMs ?? null,
      patch.error ?? null, patch.mode ?? null,
    ]
  );
  return rowCount === 1;
}

/**
 * is_hidden 전파: 기사를 숨기면 그 기사를 인용한 판(초안·발행본)에 needs_review 를 켠다.
 * (렌더링 단계에서는 PUBLIC_NEWS_WHERE 조인으로 숨긴 기사 링크와 그것만 근거로 둔 항목이 자동으로 빠진다.)
 * 현재 코드베이스에는 관리자 숨김 경로가 없어(숨김은 SQL 로 직접 처리) 이 함수를 부르는 곳은 아직 없다.
 */
export async function markBriefingsCitingArticle(articleId: string): Promise<number> {
  const { rowCount } = await pool.query(
    `UPDATE daily_briefings SET needs_review = TRUE, updated_at = now()
      WHERE article_ids @> ARRAY[$1::uuid] AND status IN ('draft', 'published') AND needs_review = FALSE`,
    [articleId]
  );
  return rowCount ?? 0;
}

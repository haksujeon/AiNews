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
import type { BriefingLocale, BriefingStatus, CandidateArticle, EditionMode } from "./types";

export const EDITION_TYPE = "daily";

export interface BriefingRow {
  id: string;
  edition_type: string;
  edition_date: string; // YYYY-MM-DD
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

const ROW_COLUMNS = `id, edition_type, to_char(edition_date, 'YYYY-MM-DD') AS edition_date, locale, version, status, mode,
  schema_version, content, article_ids, input_article_ids, candidate_count, input_hash, validation, source_briefing_id,
  model, prompt_version, llm_request_ids, input_tokens, output_tokens, cost_usd, latency_ms, error, needs_review,
  edited_by, created_at, updated_at, published_at`;

/** 그날(베이징 news_date) 공개 AI 기사 */
export async function loadCandidateArticles(date: string): Promise<CandidateArticle[]> {
  const { rows } = await pool.query(
    `SELECT id, source_name, source_url, category,
            COALESCE(title_cn, '') AS title_cn, COALESCE(title_kr, '') AS title_kr,
            COALESCE(summary_kr, '') AS summary_kr, COALESCE(ai_insights_kr, '') AS ai_insights_kr,
            COALESCE(key_terms, '[]'::jsonb) AS key_terms
       FROM ai_news_ex
      WHERE ${PUBLIC_NEWS_WHERE}
        AND category LIKE 'ai-%'
        AND news_date >= ($1::date)::timestamp AT TIME ZONE 'UTC'
        AND news_date <  ($1::date + 1)::timestamp AT TIME ZONE 'UTC'
      ORDER BY id`,
    [date]
  );
  return rows.map((r) => ({ ...r, key_terms: Array.isArray(r.key_terms) ? r.key_terms : [] })) as CandidateArticle[];
}

/** 날짜별 잠금. 이미 다른 실행이 잡고 있으면 null */
export async function withDateLock<T>(date: string, fn: () => Promise<T>): Promise<T | null> {
  const client: PoolClient = await pool.connect();
  const key = `daily_briefing:${date}`;
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

export async function latestBriefing(date: string, locale: BriefingLocale): Promise<BriefingRow | null> {
  const { rows } = await pool.query(
    `SELECT ${ROW_COLUMNS} FROM daily_briefings
      WHERE edition_type = $1 AND edition_date = $2::date AND locale = $3
      ORDER BY version DESC LIMIT 1`,
    [EDITION_TYPE, date, locale]
  );
  return (rows[0] as BriefingRow) ?? null;
}

export interface NewBriefing {
  date: string;
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
        input_tokens, output_tokens, cost_usd, latency_ms, error)
     SELECT $1, $2::date, $3,
            COALESCE((SELECT MAX(version) FROM daily_briefings WHERE edition_type = $1 AND edition_date = $2::date AND locale = $3), 0) + 1,
            $4, $5, $6::jsonb, $7::uuid[], $8::uuid[], $9, $10, $11::jsonb, $12, $13, $14, $15::text[], $16, $17, $18, $19, $20
     RETURNING id, version`,
    [
      EDITION_TYPE, b.date, b.locale, b.status, b.mode, JSON.stringify(b.content ?? {}), b.articleIds, b.inputArticleIds,
      b.candidateCount, b.inputHash, b.validation === undefined ? null : JSON.stringify(b.validation),
      b.sourceBriefingId ?? null, b.model ?? null, b.promptVersion ?? null, b.llmRequestIds ?? [],
      b.inputTokens ?? null, b.outputTokens ?? null, b.costUsd ?? null, b.latencyMs ?? null, b.error ?? null,
    ]
  );
  return rows[0] as { id: string; version: number };
}

/** 'generating' 행 마무리. 다른 상태(특히 published)는 건드리지 않는다. */
export async function finishGenerating(
  id: string,
  patch: Omit<NewBriefing, "date" | "locale" | "inputHash" | "candidateCount" | "inputArticleIds" | "mode">
): Promise<boolean> {
  const { rowCount } = await pool.query(
    `UPDATE daily_briefings
        SET status = $2, content = $3::jsonb, article_ids = $4::uuid[], validation = $5::jsonb,
            model = $6, prompt_version = $7, llm_request_ids = $8::text[], input_tokens = $9, output_tokens = $10,
            cost_usd = $11, latency_ms = $12, error = $13, updated_at = now()
      WHERE id = $1 AND status = 'generating'`,
    [
      id, patch.status, JSON.stringify(patch.content ?? {}), patch.articleIds,
      patch.validation === undefined ? null : JSON.stringify(patch.validation),
      patch.model ?? null, patch.promptVersion ?? null, patch.llmRequestIds ?? [],
      patch.inputTokens ?? null, patch.outputTokens ?? null, patch.costUsd ?? null, patch.latencyMs ?? null,
      patch.error ?? null,
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

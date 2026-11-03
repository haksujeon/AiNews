/**
 * "쉬운 AI 설명" 저장·읽기 (briefing_easy_terms, scripts/2026-11-03-briefing-easy-terms.sql).
 * 읽기는 화면(public.ts hydrate)이 쓴다 — 테이블이 없는 DB(마이그레이션 전 서버)에서도 판은 그대로 보이고 상자만 없다.
 */
import pool from "@/lib/db";
import type { BriefingLocale, EasyTerm } from "./types";
import { EASY_LOCALES, EASY_TERMS_PROMPT_VERSION, type EasyLocale } from "./easy-terms";

const UNDEFINED_TABLE = "42P01";

/** 기사 uuid 들의 그 언어 용어. 테이블이 없거나 읽기에 실패하면 빈 Map (판 화면을 막지 않는다) */
export async function loadEasyTerms(articleIds: string[], locale: BriefingLocale): Promise<Map<string, EasyTerm[]>> {
  if (!articleIds.length) return new Map();
  try {
    const { rows } = await pool.query(
      `SELECT article_id::text AS id, terms FROM briefing_easy_terms WHERE article_id = ANY($1::uuid[]) AND locale = $2`,
      [articleIds, locale]
    );
    return new Map((rows as { id: string; terms: EasyTerm[] }[]).filter((r) => Array.isArray(r.terms) && r.terms.length).map((r) => [r.id, r.terms]));
  } catch (e) {
    if ((e as { code?: string }).code !== UNDEFINED_TABLE) console.error("[easy-terms] 읽기 실패", (e as Error).message);
    return new Map();
  }
}

/** 기사별 3개 언어 저장 (같은 기사·언어는 덮어쓴다) */
export async function saveEasyTerms(
  editionDate: string,
  byArticle: Map<string, Record<EasyLocale, EasyTerm[]>>,
  model: string,
  costUsd: number
): Promise<number> {
  let n = 0;
  const perRow = byArticle.size ? costUsd / (byArticle.size * EASY_LOCALES.length) : 0;
  for (const [articleId, byLocale] of byArticle)
    for (const l of EASY_LOCALES) {
      await pool.query(
        `INSERT INTO briefing_easy_terms (article_id, locale, edition_date, terms, model, prompt_version, cost_usd)
         VALUES ($1::uuid, $2, $3::date, $4::jsonb, $5, $6, $7)
         ON CONFLICT (article_id, locale) DO UPDATE
           SET edition_date = EXCLUDED.edition_date, terms = EXCLUDED.terms, model = EXCLUDED.model,
               prompt_version = EXCLUDED.prompt_version, cost_usd = EXCLUDED.cost_usd, created_at = now()`,
        [articleId, l, editionDate, JSON.stringify(byLocale[l]), model, EASY_TERMS_PROMPT_VERSION, perRow]
      );
      n++;
    }
  return n;
}

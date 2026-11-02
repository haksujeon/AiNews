/**
 * 관련 기사 — 상세 페이지(supabase.ts fetchRelatedNews)와 모달(/api/news/related)이 같은 함수를 쓴다 (P0-5, Gate 2).
 * 예전에는 상세가 "같은 국가+분류 최신 4건", 모달이 "같은 분류 최신 4건"으로 서로 달랐고 p@5 가 0.02 였다.
 *
 * findRelated(newsId)  = 후보 읽기(DB) → rankRelated(순수) → 목록 필드 읽기(DB, 순서 유지)
 *  - 기준 기사는 공개 조건 없이 id 로 읽는다 (숨긴 기사도 상세는 열린다). 후보만 PUBLIC_NEWS_WHERE.
 *  - 후보 기간: 기준 기사 news_date 앞뒤 RELATED_WINDOW_DAYS 일 (지금 날짜가 아니라 기준 기사 기준 — 옛 기사도 관련 기사가 나온다).
 *
 * rankRelated(seed, candidates) 가 "관련 기사 검토 결과"를 넣을 자리다. 검토 결론(어휘 기반 또는 bge 임베딩)이 나오면
 * 이 함수만 바꾸고, 회귀 기준은 tests/integration/related-p5.test.ts (라벨 p@5) 와 tests/news/related.test.ts.
 *
 * v1 순위 (계획서 P0-5): 공유 실체 수(briefing/entities.ts) → 제목 바이그램 Jaccard(news-rank bigrams) → 같은 분류 → 최신 → id.
 * 실체도 제목 유사도도 없는 후보는 내지 않는다 (같은 분류라는 이유만으로 채우지 않음). 전재(같은 글)는 dedupeReposts 로 뺀다.
 */
import pool from "./db";
import { PUBLIC_NEWS_WHERE } from "./news-query";
import { LIST_FIELDS } from "./news-fields";
import { bigrams, dedupeReposts, jaccard, type RankableArticle } from "./news-rank";
import { findEntities } from "./briefing/entities";
import type { NewsItem } from "./news-types";

export const RELATED_LIMIT = 4;
export const RELATED_MAX_LIMIT = 20;
export const RELATED_WINDOW_DAYS = 30;
/** 공유 실체가 없을 때 후보로 인정할 최소 제목 바이그램 Jaccard */
export const RELATED_MIN_JACCARD = 0.1;
/** 전재 묶기를 돌릴 상위 후보 수 (dedupeReposts 는 O(n²)) */
const DEDUPE_POOL = 60;

export interface RelatedCandidate extends RankableArticle {
  /** YYYY-MM-DD */
  day: string;
}

export interface RankedRelated<T extends RelatedCandidate> {
  item: T;
  sharedEntities: string[];
  jaccard: number;
  sameCategory: boolean;
}

const s = (v: string | null | undefined) => v ?? "";
const entityKeys = (a: RankableArticle) =>
  new Set(findEntities(`${s(a.title_kr)} ${s(a.title_cn)} ${s(a.summary_kr)}`).map((e) => e.key));

/**
 * 점수만 매기는 순수 함수 (DB 없음). 결정적: 같은 입력이면 언제나 같은 순서.
 * 반환은 전재를 뺀 상위 limit 건.
 */
export function rankRelated<T extends RelatedCandidate>(seed: T, candidates: T[], limit = RELATED_LIMIT): RankedRelated<T>[] {
  const seedEnts = entityKeys(seed);
  const seedGrams = bigrams(seed.title_cn);
  const scored: RankedRelated<T>[] = [];
  for (const c of candidates) {
    if (c.id === seed.id) continue;
    const ents = entityKeys(c);
    const shared = [...seedEnts].filter((k) => ents.has(k)).sort();
    const j = jaccard(seedGrams, bigrams(c.title_cn));
    if (!shared.length && j < RELATED_MIN_JACCARD) continue;
    scored.push({ item: c, sharedEntities: shared, jaccard: Math.round(j * 1000) / 1000, sameCategory: !!c.category && c.category === seed.category });
  }
  scored.sort(
    (a, b) =>
      b.sharedEntities.length - a.sharedEntities.length ||
      b.jaccard - a.jaccard ||
      Number(b.sameCategory) - Number(a.sameCategory) ||
      b.item.day.localeCompare(a.item.day) ||
      a.item.id.localeCompare(b.item.id)
  );

  // 전재 제거: 기준 기사와 같은 글은 모두 빼고, 후보끼리 같은 글이면 순위가 높은 하나만 남긴다
  const head = scored.slice(0, DEDUPE_POOL);
  const groups = dedupeReposts([seed, ...head.map((r) => r.item)]);
  const keep = new Set<string>();
  for (const g of groups) {
    if (g.some((a) => a.id === seed.id)) continue;
    keep.add(g[0].id); // dedupeReposts 는 입력(=순위) 순서를 지키므로 첫 기사가 가장 높은 순위
  }
  return head.filter((r) => keep.has(r.item.id)).slice(0, limit);
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SLIM = `id, source_name, category, title_cn, title_kr, summary_kr, to_char(news_date AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS day`;

export interface RelatedOptions {
  limit?: number;
}

/** 관련 기사 (목록 카드 필드). 기준 기사가 없거나 id 형식이 틀리면 [] */
export async function findRelated(newsId: string, opts: RelatedOptions = {}): Promise<NewsItem[]> {
  if (!UUID_RE.test(newsId)) return [];
  const limit = Math.min(RELATED_MAX_LIMIT, Math.max(1, Math.floor(opts.limit ?? RELATED_LIMIT) || RELATED_LIMIT));
  const seedRes = await pool.query(`SELECT ${SLIM} FROM ai_news_ex WHERE id = $1`, [newsId]);
  const seed = seedRes.rows[0] as RelatedCandidate | undefined;
  if (!seed) return [];
  const { rows } = await pool.query(
    `SELECT ${SLIM} FROM ai_news_ex
      WHERE ${PUBLIC_NEWS_WHERE} AND id <> $1
        AND news_date >= ($2::date - $3::int)::timestamp AT TIME ZONE 'UTC'
        AND news_date <  ($2::date + $3::int + 1)::timestamp AT TIME ZONE 'UTC'
      ORDER BY id`,
    [newsId, seed.day, RELATED_WINDOW_DAYS]
  );
  const ranked = rankRelated(seed, rows as RelatedCandidate[], limit);
  if (!ranked.length) return [];
  const { rows: items } = await pool.query(
    `SELECT ${LIST_FIELDS} FROM ai_news_ex WHERE id = ANY($1::uuid[]) AND ${PUBLIC_NEWS_WHERE}`,
    [ranked.map((r) => r.item.id)]
  );
  const byId = new Map((items as NewsItem[]).map((r) => [r.id, r]));
  return ranked.flatMap((r) => (byId.has(r.item.id) ? [byId.get(r.item.id)!] : []));
}

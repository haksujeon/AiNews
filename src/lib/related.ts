/**
 * 관련 기사 v2 — 상세 페이지(supabase.ts fetchRelatedNews)와 모달(/api/news/related)이 같은 함수 findRelated 를 쓴다 (Gate 2).
 * 점수·묶음은 src/lib/related-rank.ts rankRelated (순수 함수, 관련 기사 검토의 어휘 방식).
 *
 * 미리 계산 (표 related_articles, scripts/2026-11-02-related-articles.sql):
 *  - 기사마다 묶음 행(section = same_event | flow | company) + 계산 표시 행 1개(related_id = news_id, section = '_meta').
 *    표시 행이 있어야 "관련 기사 0건" 도 계산된 것으로 본다(없으면 매번 다시 계산).
 *  - 표시 행이 없으면: 그 자리에서 계산해 저장하고 돌려준다.
 *  - 24시간이 지났거나, 계산 뒤 후보 창(±90일)에 새 공개 기사가 들어왔으면(계산 10분 뒤부터): 저장된 결과를 돌려주고
 *    응답 뒤(after)에 다시 계산.
 *  - 읽을 때 PUBLIC_NEWS_WHERE 로 다시 거른다 → 계산 뒤 숨긴 기사는 바로 빠진다.
 *  - 날짜 차이(gap)는 읽을 때 기준 기사 날짜로 센다.
 * 일괄 계산: scripts/related-backfill.ts (같은 computeAndStore 를 쓴다).
 */
import pool from "./db";
import { LIST_NEWS_WHERE, PUBLIC_NEWS_WHERE } from "./news-query";
import { LIST_FIELDS } from "./news-fields";
import type { NewsItem } from "./news-types";
import { EMPTY_RELATED, type RelatedItem, type RelatedSections } from "./related-types";
import { RELATED_WINDOW_DAYS, attachFeatures, extractFeatures, rankRelated, type Features, type RelatedDoc, type RelatedRanking, type RelatedSection } from "./related-rank";

export { rankRelated, RELATED_WINDOW_DAYS } from "./related-rank";
export type { RelatedDoc, RelatedSection } from "./related-rank";

/** 다시 계산할 나이 */
export const RELATED_TTL_HOURS = 24;
/**
 * "계산 뒤 새 기사" 로 다시 계산하는 최소 간격. 수집이 몇 분마다 한 건씩 들어오므로, 간격이 없으면
 * 최근 기사는 볼 때마다 다시 계산된다. 10분 안에 들어온 새 기사는 다음 계산에 함께 반영한다.
 */
export const RELATED_MIN_RECOMPUTE_MINUTES = 10;

export { EMPTY_RELATED, hasRelated } from "./related-types";
export type { RelatedItem, RelatedSections } from "./related-types";

const DB_SECTION: Record<RelatedSection, string> = { sameEvent: "same_event", flow: "flow", company: "company" };
const FROM_DB: Record<string, RelatedSection> = { same_event: "sameEvent", flow: "flow", company: "company" };
const META = "_meta";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** rankRelated 가 읽는 필드 (RelatedDoc). 백필·시험 자료 내보내기도 이 SELECT 를 쓴다 */
export const RELATED_DOC_FIELDS = `id, source_name, category, title_cn, title_kr, title_en,
  left(summary_kr, 220) AS summary_kr, summary_cn, summary_en,
  CASE WHEN jsonb_typeof(key_terms) = 'array'
       THEN ARRAY(SELECT e->>'term' FROM jsonb_array_elements(key_terms) e WHERE jsonb_typeof(e) = 'object' AND e->>'term' <> '')
       ELSE '{}'::text[] END AS terms,
  to_char(news_date AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS day`;

/** 점수에 쓰는 본문이 바뀌었는지 보는 지문 (특징 캐시 무효화) */
const DOC_SIG = `md5(concat_ws('|', title_cn, title_kr, title_en, left(summary_kr, 220), summary_cn, summary_en, key_terms::text))`;
const WINDOW_WHERE = `${LIST_NEWS_WHERE}
        AND news_date >= ($1::date - $2::int)::timestamp AT TIME ZONE 'UTC'
        AND news_date <  ($1::date + $2::int + 1)::timestamp AT TIME ZONE 'UTC'`;

/**
 * 기사 특징 캐시 (프로세스 안). 후보 창은 ~4,000건이라 매번 본문을 읽고 특징을 뽑으면 1초 가까이 걸린다.
 * 창을 읽을 때 지문(DOC_SIG)만 먼저 받고, 캐시에 없거나 지문이 바뀐 기사만 본문을 읽는다.
 */
const FEATURE_CACHE = new Map<string, { sig: string; f: Features }>();
const FEATURE_CACHE_MAX = 30_000;

/** 후보 창 [day − 90, day + 90] 의 공개 기사 (기준 기사 제외 안 함 — rankRelated 가 뺀다) */
export async function loadWindow(day: string): Promise<RelatedDoc[]> {
  const { rows: heads } = await pool.query(
    `SELECT id, source_name, category, to_char(news_date AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS day, ${DOC_SIG} AS sig
       FROM ai_news_ex WHERE ${WINDOW_WHERE} ORDER BY id`,
    [day, RELATED_WINDOW_DAYS]
  );
  const missing = (heads as { id: string; sig: string }[]).filter((h) => FEATURE_CACHE.get(h.id)?.sig !== h.sig).map((h) => h.id);
  if (missing.length) {
    const { rows } = await pool.query(`SELECT ${RELATED_DOC_FIELDS}, ${DOC_SIG} AS sig FROM ai_news_ex WHERE id = ANY($1::uuid[])`, [missing]);
    for (const r of rows as (RelatedDoc & { sig: string })[]) {
      FEATURE_CACHE.delete(r.id);
      FEATURE_CACHE.set(r.id, { sig: r.sig, f: extractFeatures(r) });
    }
    while (FEATURE_CACHE.size > FEATURE_CACHE_MAX) FEATURE_CACHE.delete(FEATURE_CACHE.keys().next().value!);
  }
  const out: RelatedDoc[] = [];
  for (const h of heads as { id: string; source_name: string | null; category: string | null; day: string; sig: string }[]) {
    const hit = FEATURE_CACHE.get(h.id);
    if (!hit || hit.sig !== h.sig) continue; // 두 쿼리 사이에 바뀐 기사 — 다음 계산 때 들어온다
    // 본문 없이 머리 필드만 — 특징은 붙여 둔다 (rankRelated 는 붙은 특징을 쓴다)
    const d: RelatedDoc = { id: h.id, source_name: h.source_name, category: h.category, day: h.day, title_cn: null, title_kr: null, title_en: null, summary_kr: null, summary_cn: null, summary_en: null, terms: null };
    attachFeatures(d, hit.f);
    out.push(d);
  }
  return out;
}

async function loadSeed(newsId: string): Promise<RelatedDoc | null> {
  // 기준 기사는 공개 조건 없이 읽는다 (숨긴 기사도 상세는 열린다). 후보만 PUBLIC_NEWS_WHERE.
  const { rows } = await pool.query(`SELECT ${RELATED_DOC_FIELDS} FROM ai_news_ex WHERE id = $1 AND news_date IS NOT NULL`, [newsId]);
  return (rows[0] as RelatedDoc | undefined) ?? null;
}

/** 순위 결과를 표에 쓴다. 겹치는 요청이 있어도 충돌하지 않게 upsert 후 남은 행을 지운다 */
export async function storeRanking(newsId: string, ranking: RelatedRanking<RelatedDoc>): Promise<void> {
  const ids: string[] = [newsId];
  const sections: string[] = [META];
  const scores: number[] = [0];
  for (const sec of Object.keys(DB_SECTION) as RelatedSection[]) {
    for (const r of ranking.sections[sec]) {
      ids.push(r.item.id);
      sections.push(DB_SECTION[sec]);
      scores.push(Math.round(r.score.raw * 1000) / 1000);
    }
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `INSERT INTO related_articles (news_id, related_id, section, score, computed_at)
       SELECT $1::uuid, r, s, sc, now() FROM unnest($2::uuid[], $3::text[], $4::real[]) AS t(r, s, sc)
       ON CONFLICT (news_id, related_id) DO UPDATE SET section = EXCLUDED.section, score = EXCLUDED.score, computed_at = EXCLUDED.computed_at`,
      [newsId, ids, sections, scores]
    );
    await client.query(`DELETE FROM related_articles WHERE news_id = $1 AND NOT (related_id = ANY($2::uuid[]))`, [newsId, ids]);
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

/** 한 기사 계산 + 저장. candidates 를 주면(백필) DB 에서 창을 다시 읽지 않는다 */
export async function computeAndStore(newsId: string, candidates?: RelatedDoc[]): Promise<RelatedRanking<RelatedDoc> | null> {
  const seed = await loadSeed(newsId);
  if (!seed) return null;
  const ranking = rankRelated(seed, candidates ?? (await loadWindow(seed.day)));
  await storeRanking(newsId, ranking);
  return ranking;
}

const inflight = new Map<string, Promise<unknown>>();
/** 같은 기사를 한 프로세스에서 동시에 두 번 계산하지 않는다 */
function computeOnce(newsId: string): Promise<unknown> {
  let p = inflight.get(newsId);
  if (!p) {
    p = computeAndStore(newsId).finally(() => inflight.delete(newsId));
    inflight.set(newsId, p);
  }
  return p;
}

/** 응답 뒤에 돌린다 (요청 밖 — 스크립트·시험 — 에서는 그냥 띄워 둔다) */
export async function runAfterResponse(job: () => Promise<unknown>): Promise<void> {
  const safe = () => job().catch((e) => console.error("[related] background compute failed", e));
  try {
    const { after } = await import("next/server");
    after(safe);
  } catch {
    void safe();
  }
}

/** 새로 들어온 기사의 관련 기사를 응답 뒤에 계산한다 (upsert API) */
export function scheduleRelatedCompute(newsIds: string[]): Promise<void> {
  const ids = newsIds.filter((id) => UUID_RE.test(id));
  if (!ids.length) return Promise.resolve();
  return runAfterResponse(async () => {
    for (const id of ids) await computeOnce(id);
  });
}

interface CachedRow extends Partial<NewsItem> {
  section: string;
  related_id: string;
  score: number;
  stale: boolean;
  gap: number | null;
  is_pub: boolean;
  related_day?: unknown;
}

async function readCached(newsId: string): Promise<CachedRow[]> {
  const { rows } = await pool.query(
    `WITH seed AS (SELECT id, news_date FROM ai_news_ex WHERE id = $1)
     SELECT r.section, r.related_id::text AS related_id, r.score,
            (r.section = '${META}' AND (
               r.computed_at < now() - make_interval(hours => $2::int)
               OR (r.computed_at < now() - make_interval(mins => $4::int) AND EXISTS (SELECT 1 FROM ai_news_ex x, seed
                           WHERE ${PUBLIC_NEWS_WHERE.replace(/(is_\w+)/g, "x.$1")}
                             AND x.created_at > r.computed_at AND x.id <> seed.id
                             AND x.news_date >= seed.news_date - make_interval(days => $3::int)
                             AND x.news_date <= seed.news_date + make_interval(days => $3::int)))
            )) AS stale,
            (n.id IS NOT NULL) AS is_pub,
            (n.related_day - (seed.news_date AT TIME ZONE 'UTC')::date) AS gap,
            n.*
       FROM related_articles r
       CROSS JOIN seed
       LEFT JOIN LATERAL (SELECT ${LIST_FIELDS}, (news_date AT TIME ZONE 'UTC')::date AS related_day FROM ai_news_ex
                           WHERE id = r.related_id AND r.section <> '${META}' AND ${LIST_NEWS_WHERE}) n ON TRUE
      WHERE r.news_id = $1`,
    [newsId, RELATED_TTL_HOURS, RELATED_WINDOW_DAYS, RELATED_MIN_RECOMPUTE_MINUTES]
  );
  return rows as CachedRow[];
}

function toSections(rows: CachedRow[]): RelatedSections {
  const out: RelatedSections = { sameEvent: [], flow: [], company: [] };
  const scored: Record<RelatedSection, { item: RelatedItem; score: number }[]> = { sameEvent: [], flow: [], company: [] };
  for (const r of rows) {
    const sec = FROM_DB[r.section];
    if (!sec || !r.is_pub) continue;
    const { section, related_id, score, stale, is_pub, related_day, ...rest } = r;
    void section; void related_id; void stale; void is_pub; void related_day;
    scored[sec].push({ item: { ...(rest as NewsItem), gap: Number(r.gap ?? 0) }, score: Number(score) });
  }
  const byScore = (a: { item: RelatedItem; score: number }, b: { item: RelatedItem; score: number }) =>
    b.score - a.score || (a.item.id < b.item.id ? -1 : 1);
  // 순서는 rankRelated 와 같게: 같은 사건·같은 기업 = 점수순, 흐름 = 최신순(날짜 차이가 큰 쪽 먼저)
  out.sameEvent = scored.sameEvent.sort(byScore).map((x) => x.item);
  out.company = scored.company.sort(byScore).map((x) => x.item);
  out.flow = scored.flow.sort((a, b) => b.item.gap - a.item.gap || byScore(a, b)).map((x) => x.item);
  return out;
}

/** 관련 기사 세 묶음. 기준 기사가 없거나 id 형식이 틀리면 빈 묶음 */
export async function findRelated(newsId: string): Promise<RelatedSections> {
  if (!UUID_RE.test(newsId)) return EMPTY_RELATED;
  let rows = await readCached(newsId);
  const meta = rows.find((r) => r.section === META);
  if (!meta) {
    const done = await computeOnce(newsId);
    if (!done) return EMPTY_RELATED;
    rows = await readCached(newsId);
  } else if (meta.stale) {
    await runAfterResponse(() => computeOnce(newsId));
  }
  return toSections(rows);
}

/** 화면에 보이는 순서대로 id (시험·비교용) */
export function relatedIds(s: RelatedSections): Record<RelatedSection, string[]> {
  return { sameEvent: s.sameEvent.map((x) => x.id), flow: s.flow.map((x) => x.id), company: s.company.map((x) => x.id) };
}

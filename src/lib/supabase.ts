import { cache } from 'react';
import pool from './db';
export type { NewsItem } from './news-types';
export { NEWS_PAGE_SIZE } from './news-types';
export type { RankedNewsItem, NewsDay, NewsDaysPage, NewsDayRest } from './news-types';
import type { NewsItem, NewsDaysPage, NewsDayRest, RankedNewsItem } from './news-types';
import { NEWS_PAGE_SIZE, NEWS_DAYS_PER_PAGE, NEWS_DAY_TOP } from './news-types';
import { buildNewsWhere, EMPTY_FILTERS, PUBLIC_NEWS_WHERE, type NewsFilters } from './news-query';
import { citedRanksFromTopStories, splitDay, type DaySplit, type RankableArticle } from './news-rank';
import { EDITION_TYPE } from './briefing/repository';
import { buildWeeklyTrend, type StatisticsData } from './statistics-utils';

const LIST_FIELDS = `id,
  to_char(created_at::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS created_at,
  source_name, source_url,
  to_char(news_date::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS news_date,
  title_cn, title_kr, title_en, summary_cn, summary_kr, summary_en,
  sentiment, category, thumbnail_url, og_image_url, country`;

// content_cn(원문 전문)은 의도적으로 제외한다 — 공개 페이지/RSC 페이로드에 실리지 않도록.
// is_hidden 은 상세 페이지가 noindex 여부를 정하는 데 쓴다.
const DETAIL_FIELDS = `${LIST_FIELDS},
  content_kr, content_en,
  ai_insights_cn, ai_insights_kr, ai_insights_en, key_terms, is_hidden`;

/** 일별 추이 차트가 보여 줄 최대 일수. 데이터 기간이 이보다 짧으면 전체 기간. */
export const STATS_DAILY_WINDOW_DAYS = 90;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface NewsPage {
  items: NewsItem[];
  total: number;
}

/**
 * 필터가 적용된 뉴스 목록 한 페이지 + 필터 조건에 맞는 전체 건수.
 * total 이 있어야 UI가 "N건 중 30건 로드됨" 을 정확히 표시할 수 있다.
 */
export async function fetchNewsPage(
  filters: NewsFilters = EMPTY_FILTERS,
  offset = 0,
  limit: number = NEWS_PAGE_SIZE
): Promise<NewsPage> {
  const { where, values } = buildNewsWhere(filters);

  const [list, count] = await Promise.all([
    pool.query(
      `SELECT ${LIST_FIELDS} FROM ai_news_ex
       WHERE ${where}
       ORDER BY news_date DESC, id DESC
       OFFSET $${values.length + 1} LIMIT $${values.length + 2}`,
      [...values, offset, limit]
    ),
    pool.query(`SELECT COUNT(*)::int AS total FROM ai_news_ex WHERE ${where}`, values),
  ]);

  return { items: list.rows, total: count.rows[0]?.total ?? 0 };
}

// ─── 날짜별 목록 (주요 4건 + 펼치기) ─────────────────────────
// 날짜 키는 베이징 날짜. news_date 는 "베이징 날짜의 00:00 UTC" 로 저장되어 있어 UTC 날짜가 곧 베이징 날짜다
// (briefing/repository.ts 의 loadCandidateArticles 와 같은 규칙).
const DAY_KEY = `to_char(news_date AT TIME ZONE 'UTC', 'YYYY-MM-DD')`;
const DAY_RANGE = (from: string, toExclusive: string) =>
  `news_date >= (${from}::date)::timestamp AT TIME ZONE 'UTC' AND news_date < (${toExclusive}::date + 1)::timestamp AT TIME ZONE 'UTC'`;
const RANK_FIELDS = `id, source_name, category, title_cn, title_kr, summary_kr, ${DAY_KEY} AS day`;

type RankRow = RankableArticle & { day: string };

/** 그 날짜들의 발행 브리핑 주요 기사 순위. 화면 언어판 우선, 없으면 ko → 그 밖 언어판. 발행본만. */
async function loadCitedRanks(dates: string[], locale: string): Promise<Map<string, Map<string, number>>> {
  const out = new Map<string, Map<string, number>>();
  if (!dates.length) return out;
  const { rows } = await pool.query(
    `SELECT DISTINCT ON (edition_date) to_char(edition_date, 'YYYY-MM-DD') AS d, content->'top_stories' AS ts
       FROM daily_briefings
      WHERE status = 'published' AND edition_type = $1 AND edition_date = ANY($2::date[])
      ORDER BY edition_date, (locale = $3) DESC, (locale = 'ko') DESC, locale`,
    [EDITION_TYPE, dates, locale]
  );
  for (const r of rows) out.set(r.d, citedRanksFromTopStories(r.ts));
  return out;
}

/**
 * 날짜들의 기사를 공용 순위 함수(splitDay)로 나눈다. 필터가 있으면 걸러진 기사들 안에서 순위를 매긴다.
 * dates 는 내림차순(최신 먼저)이며 연속된 데이터 날짜여야 한다 (첫·끝 날짜 범위로 한 번에 읽는다).
 */
async function splitDays(
  filters: NewsFilters,
  locale: string,
  dates: string[]
): Promise<Map<string, DaySplit<RankRow>>> {
  const out = new Map<string, DaySplit<RankRow>>();
  if (!dates.length) return out;
  const { where, values } = buildNewsWhere(filters);
  const n = values.length;
  const [{ rows }, cited] = await Promise.all([
    pool.query(
      `SELECT ${RANK_FIELDS} FROM ai_news_ex
        WHERE ${where} AND ${DAY_RANGE(`$${n + 1}`, `$${n + 2}`)}
        ORDER BY id`,
      [...values, dates[dates.length - 1], dates[0]]
    ),
    loadCitedRanks(dates, locale),
  ]);
  const byDay = new Map<string, RankRow[]>();
  for (const r of rows as RankRow[]) {
    if (!byDay.has(r.day)) byDay.set(r.day, []);
    byDay.get(r.day)!.push(r);
  }
  for (const d of dates) out.set(d, splitDay(byDay.get(d) ?? [], { cited: cited.get(d), topCount: NEWS_DAY_TOP }));
  return out;
}

/** id 목록 → 목록 필드 (주어진 순서 유지, 공개 조건 재확인) */
async function loadListItems(ranked: { item: RankRow; outletCount: number }[]): Promise<RankedNewsItem[]> {
  if (!ranked.length) return [];
  const { rows } = await pool.query(
    `SELECT ${LIST_FIELDS} FROM ai_news_ex WHERE id = ANY($1::uuid[]) AND ${PUBLIC_NEWS_WHERE}`,
    [ranked.map((r) => r.item.id)]
  );
  const byId = new Map((rows as NewsItem[]).map((r) => [r.id, r]));
  return ranked.flatMap((r) => {
    const item = byId.get(r.item.id);
    return item ? [{ ...item, outlet_count: r.outletCount }] : [];
  });
}

/**
 * 날짜별 목록 한 페이지: 최신 날부터 limit 일. cursor(YYYY-MM-DD)가 있으면 그 날짜보다 이전 날부터.
 * 각 날은 { date, total, top(주요 4건) } — 나머지는 fetchNewsDayRest 로 펼칠 때 받는다.
 */
export async function fetchNewsDays(
  filters: NewsFilters = EMPTY_FILTERS,
  locale = "ko",
  cursor: string | null = null,
  limit: number = NEWS_DAYS_PER_PAGE
): Promise<NewsDaysPage> {
  const { where, values } = buildNewsWhere(filters);
  const n = values.length;
  const cursorClause = cursor ? `AND news_date < ($${n + 2}::date)::timestamp AT TIME ZONE 'UTC'` : "";
  const [daysRes, countRes] = await Promise.all([
    pool.query(
      `SELECT ${DAY_KEY} AS d, COUNT(*)::int AS total FROM ai_news_ex
        WHERE ${where} ${cursorClause}
        GROUP BY 1 ORDER BY 1 DESC LIMIT $${n + 1}`,
      cursor ? [...values, limit + 1, cursor] : [...values, limit + 1]
    ),
    pool.query(`SELECT COUNT(*)::int AS total FROM ai_news_ex WHERE ${where}`, values),
  ]);
  const dayRows = daysRes.rows as { d: string; total: number }[];
  const hasMore = dayRows.length > limit;
  const pageDays = dayRows.slice(0, limit);
  const splits = await splitDays(filters, locale, pageDays.map((r) => r.d));

  const allTop = pageDays.flatMap((r) => splits.get(r.d)?.top ?? []);
  const items = await loadListItems(allTop);
  const byId = new Map(items.map((i) => [i.id, i]));

  return {
    days: pageDays.map((r) => ({
      date: r.d,
      total: r.total,
      top: (splits.get(r.d)?.top ?? []).flatMap((t) => (byId.has(t.item.id) ? [byId.get(t.item.id)!] : [])),
    })),
    total: countRes.rows[0]?.total ?? 0,
    nextCursor: hasMore && pageDays.length ? pageDays[pageDays.length - 1].d : null,
  };
}

/**
 * 펼치기: 그날의 기사 중 exclude(화면에 이미 보이는 주요 기사) 를 뺀 전부, 공용 순위 순.
 * 첫 화면 이후 새 기사가 들어와 순위가 바뀌어도 이미 보인 기사가 두 번 나오지 않도록 id 로 뺀다.
 */
export async function fetchNewsDayRest(
  filters: NewsFilters,
  locale: string,
  date: string,
  exclude: string[]
): Promise<NewsDayRest> {
  const split = (await splitDays(filters, locale, [date])).get(date)!;
  const skip = new Set(exclude);
  const ordered = [...split.top, ...split.rest];
  const items = await loadListItems(ordered.filter((r) => !skip.has(r.item.id)));
  return { date, total: ordered.length, items };
}

/** 필터 드롭다운 선택지. 로드된 페이지가 아니라 테이블 전체에서 뽑는다. */
export async function fetchNewsFacets(): Promise<{
  countries: string[];
  categories: string[];
}> {
  const { rows } = await pool.query(
    `SELECT
       ARRAY(SELECT DISTINCT country  FROM ai_news_ex
             WHERE ${PUBLIC_NEWS_WHERE} AND country  IS NOT NULL ORDER BY country)  AS countries,
       ARRAY(SELECT DISTINCT category FROM ai_news_ex
             WHERE ${PUBLIC_NEWS_WHERE} AND category IS NOT NULL ORDER BY category) AS categories`
  );
  return {
    countries: rows[0]?.countries ?? [],
    categories: rows[0]?.categories ?? [],
  };
}

export async function fetchNewsList(): Promise<NewsItem[]> {
  const { items } = await fetchNewsPage();
  return items;
}

/**
 * 통계 페이지용 집계. 예전에는 최근 1000행을 브라우저로 보내 클라이언트에서 셌기 때문에
 * "총 뉴스"가 1000 으로 고정되고(홈은 ~5400) 차트도 그 1000행 기간만 보였다.
 * 이제 공개 조건(PUBLIC_NEWS_WHERE) 전체를 SQL 로 집계해 홈 총계와 같은 모집단을 쓴다.
 * 날짜 키는 기존 표시와 같게 news_date 의 UTC 날짜를 쓴다.
 */
export async function fetchNewsStatistics(): Promise<StatisticsData> {
  const DAY = `(news_date AT TIME ZONE 'UTC')::date`;
  const TODAY = `(now() AT TIME ZONE 'UTC')::date`;

  const [kpiRes, catRes, sentRes, srcRes, kwRes, dailyRes] = await Promise.all([
    pool.query(
      `SELECT COUNT(*)::int                                          AS total,
              COUNT(*) FILTER (WHERE ${DAY} = ${TODAY})::int          AS today,
              COUNT(DISTINCT category)::int                          AS categories,
              COUNT(DISTINCT source_name)::int                       AS sources,
              COUNT(DISTINCT ${DAY})::int                            AS days,
              COUNT(*) FILTER (WHERE category LIKE 'ai-%')::int      AS ai
         FROM ai_news_ex WHERE ${PUBLIC_NEWS_WHERE}`
    ),
    pool.query(
      `SELECT COALESCE(category, 'other') AS name, COUNT(*)::int AS value
         FROM ai_news_ex WHERE ${PUBLIC_NEWS_WHERE}
        GROUP BY 1 ORDER BY value DESC, name`
    ),
    pool.query(
      `SELECT COALESCE(sentiment, 'neutral') AS name, COUNT(*)::int AS value
         FROM ai_news_ex WHERE ${PUBLIC_NEWS_WHERE}
        GROUP BY 1 ORDER BY value DESC, name`
    ),
    pool.query(
      `SELECT COALESCE(source_name, 'Unknown') AS name, COUNT(*)::int AS value
         FROM ai_news_ex WHERE ${PUBLIC_NEWS_WHERE}
        GROUP BY 1 ORDER BY value DESC, name LIMIT 10`
    ),
    // 기사 1건에 같은 용어가 여러 번 있어도 1회로 센다(기존 클라이언트 계산과 달리 중복 가산 방지).
    pool.query(
      `SELECT kt.term, COUNT(DISTINCT n.id)::int AS count
         FROM (SELECT id, key_terms FROM ai_news_ex WHERE ${PUBLIC_NEWS_WHERE}) n
         CROSS JOIN LATERAL jsonb_array_elements(
           CASE WHEN jsonb_typeof(n.key_terms) = 'array' THEN n.key_terms ELSE '[]'::jsonb END
         ) AS e
         CROSS JOIN LATERAL (SELECT NULLIF(btrim(e->>'term'), '') AS term) kt
        WHERE kt.term IS NOT NULL
        GROUP BY kt.term ORDER BY count DESC, kt.term LIMIT 15`
    ),
    // 일별 건수: 기사가 없는 날도 0 으로 채워 차트에서 공백이 보이게 한다.
    // 구간은 최근 STATS_DAILY_WINDOW_DAYS 일(주간 집계가 깔끔하도록 월요일부터 시작),
    // 데이터가 그보다 짧으면 첫 기사 날짜부터.
    pool.query(
      `WITH bounds AS (
         SELECT GREATEST(${TODAY}, MAX(${DAY})) AS end_day,
                MIN(${DAY})                     AS first_day
           FROM ai_news_ex WHERE ${PUBLIC_NEWS_WHERE}
       ), win AS (
         SELECT GREATEST(first_day,
                  date_trunc('week', end_day - ($1::int - 1))::date) AS start_day,
                end_day
           FROM bounds WHERE first_day IS NOT NULL
       ), counts AS (
         SELECT ${DAY} AS day, COUNT(*)::int AS count
           FROM ai_news_ex, win
          WHERE ${PUBLIC_NEWS_WHERE}
            AND news_date >= win.start_day::timestamp AT TIME ZONE 'UTC'
          GROUP BY 1
       )
       SELECT to_char(d::date, 'YYYY-MM-DD') AS date, COALESCE(c.count, 0)::int AS count
         FROM win
        CROSS JOIN LATERAL generate_series(win.start_day, win.end_day, interval '1 day') AS d
         LEFT JOIN counts c ON c.day = d::date
        ORDER BY d`,
      [STATS_DAILY_WINDOW_DAYS]
    ),
  ]);

  const k = kpiRes.rows[0] ?? { total: 0, today: 0, categories: 0, sources: 0, days: 0, ai: 0 };
  const daily = dailyRes.rows as { date: string; count: number }[];

  return {
    kpis: {
      totalNews: k.total,
      todayNews: k.today,
      categoryCount: k.categories,
      sourceCount: k.sources,
      avgPerDay: k.days > 0 ? Math.round((k.total / k.days) * 10) / 10 : 0,
      aiRatio: k.total > 0 ? Math.round((k.ai / k.total) * 100) : 0,
    },
    categories: catRes.rows,
    sentiments: sentRes.rows,
    sources: srcRes.rows,
    keywords: kwRes.rows,
    daily,
    weekly: buildWeeklyTrend(daily),
  };
}

// React cache(): 같은 요청 안에서 generateMetadata 와 page 가 한 번만 조회하도록.
export const fetchNewsById = cache(async (id: string): Promise<NewsItem | null> => {
  // id 컬럼이 uuid 라 형식이 틀린 값은 DB 오류(500)가 되므로 미리 걸러 404 로 처리한다.
  if (!UUID_RE.test(id)) return null;
  const { rows } = await pool.query(
    `SELECT ${DETAIL_FIELDS} FROM ai_news_ex WHERE id = $1 LIMIT 1`,
    [id]
  );
  return rows[0] ?? null;
});

export async function fetchRelatedNews(
  newsId: string,
  country: string | null,
  category: string | null
): Promise<NewsItem[]> {
  const values: unknown[] = [newsId];
  let sql = `SELECT ${LIST_FIELDS} FROM ai_news_ex
             WHERE id != $1 AND ${PUBLIC_NEWS_WHERE}`;
  if (country) {
    values.push(country);
    sql += ` AND country = $${values.length}`;
  }
  if (category) {
    values.push(category);
    sql += ` AND category = $${values.length}`;
  }
  sql += ` ORDER BY news_date DESC LIMIT 4`;

  const { rows } = await pool.query(sql, values);
  return rows;
}

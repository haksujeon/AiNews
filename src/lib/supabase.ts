import { cache } from 'react';
import pool from './db';
export type { NewsItem } from './news-types';
export { NEWS_PAGE_SIZE } from './news-types';
export type { RankedNewsItem, NewsDay, NewsDaysPage, NewsDayRest } from './news-types';
import type { NewsItem, NewsDaysPage, NewsDayRest, RankedNewsItem } from './news-types';
import { NEWS_PAGE_SIZE, NEWS_DAYS_PER_PAGE, NEWS_DAY_TOP } from './news-types';
import { buildNewsWhere, EMPTY_FILTERS, PUBLIC_NEWS_WHERE, type NewsFilters } from './news-query';
import { VISIBLE_CATEGORIES, publicCategoriesOf } from './categories';
import { LIST_FIELDS } from './news-fields';
import { findRelated, type RelatedSections } from './related';
import { citedRanksFromTopStories, splitDay, type DaySplit, type RankableArticle } from './news-rank';
import { loadDayEditionRows } from './briefing/public';
import { pickLinkEdition, pickRankEdition, toDayBriefingRef, type DayBriefingRef } from './briefing/day-select';
import { isEditionPending } from './briefing/sla';
import { buildWeeklyTrend, type StatisticsData } from './statistics-utils';
import { addDays, countBy, countByDay, dayBounds, fillDays, mondayOf, regionCounts, termCounts, volumeSummary, type RegionCounts } from './metrics/period';

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

interface DayBriefing {
  /** 순위용 판의 주요 기사 순위 (브리핑 인용 우선 규칙) */
  cited?: Map<string, number>;
  /** 날짜 옆 링크 (보는 언어판만) */
  link: DayBriefingRef | null;
}

/**
 * 그 날짜들의 발행 데일리 판 — 순위("주요 4건" 의 인용 우선)와 날짜 옆 브리핑 링크가 이 조회 하나를 쓴다 (Gate 2).
 * 판이 덮는 기간(period_start~period_end)으로 맞추므로 일요일 묶음은 토요일 합본을 쓴다
 * (예전 loadCitedRanks 는 edition_date 만 맞춰 일요일 묶음에 인용 우선 규칙이 빠졌다).
 * 판 고르기 규칙은 briefing/day-select.ts.
 */
async function loadDayBriefings(dates: string[], locale: string): Promise<Map<string, DayBriefing>> {
  const out = new Map<string, DayBriefing>();
  if (!dates.length) return out;
  const sorted = [...dates].sort();
  const rows = await loadDayEditionRows(sorted[0], sorted[sorted.length - 1]);
  for (const d of dates) {
    const rank = pickRankEdition(rows, d, locale);
    const link = pickLinkEdition(rows, d, locale);
    out.set(d, { cited: rank ? citedRanksFromTopStories(rank.top_stories) : undefined, link: link ? toDayBriefingRef(link) : null });
  }
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
): Promise<{ splits: Map<string, DaySplit<RankRow>>; briefings: Map<string, DayBriefing> }> {
  const out = new Map<string, DaySplit<RankRow>>();
  if (!dates.length) return { splits: out, briefings: new Map() };
  const { where, values } = buildNewsWhere(filters);
  const n = values.length;
  const [{ rows }, briefings] = await Promise.all([
    pool.query(
      `SELECT ${RANK_FIELDS} FROM ai_news_ex
        WHERE ${where} AND ${DAY_RANGE(`$${n + 1}`, `$${n + 2}`)}
        ORDER BY id`,
      [...values, dates[dates.length - 1], dates[0]]
    ),
    loadDayBriefings(dates, locale),
  ]);
  const byDay = new Map<string, RankRow[]>();
  for (const r of rows as RankRow[]) {
    if (!byDay.has(r.day)) byDay.set(r.day, []);
    byDay.get(r.day)!.push(r);
  }
  for (const d of dates) out.set(d, splitDay(byDay.get(d) ?? [], { cited: briefings.get(d)?.cited, topCount: NEWS_DAY_TOP }));
  return { splits: out, briefings };
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
 * 각 날은 { date, total, top(주요 4건), briefing(그날 브리핑 링크), briefingPending } — 나머지는 fetchNewsDayRest 로 펼칠 때 받는다.
 * 첫 화면(홈 서버 렌더)과 /api/news/days(무한 스크롤·필터)가 이 함수 하나를 쓴다 (Gate 2).
 * now 는 "발행 예정" 판정 시각 (sla.ts isEditionPending). 시험에서만 넘긴다.
 */
export async function fetchNewsDays(
  filters: NewsFilters = EMPTY_FILTERS,
  locale = "ko",
  cursor: string | null = null,
  limit: number = NEWS_DAYS_PER_PAGE,
  now: Date = new Date()
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
  const { splits, briefings } = await splitDays(filters, locale, pageDays.map((r) => r.d));

  const allTop = pageDays.flatMap((r) => splits.get(r.d)?.top ?? []);
  const items = await loadListItems(allTop);
  const byId = new Map(items.map((i) => [i.id, i]));

  return {
    days: pageDays.map((r) => ({
      date: r.d,
      total: r.total,
      top: (splits.get(r.d)?.top ?? []).flatMap((t) => (byId.has(t.item.id) ? [byId.get(t.item.id)!] : [])),
      briefing: briefings.get(r.d)?.link ?? null,
      briefingPending: !briefings.get(r.d)?.link && isEditionPending(r.d, now),
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
  const split = (await splitDays(filters, locale, [date])).splits.get(date)!;
  const skip = new Set(exclude);
  const ordered = [...split.top, ...split.rest];
  const items = await loadListItems(ordered.filter((r) => !skip.has(r.item.id)));
  return { date, total: ordered.length, items };
}

/** 분류 칩을 내보낼 최소 공개 기사 수 (행 몇 건만 생긴 분류가 칩으로 튀어나오지 않게) */
export const FACET_MIN_COUNT = 5;

export interface NewsFacets {
  countries: string[];
  categories: string[];
  /** 지역 칩별 공개 기사 수 (통계·주간 지표와 같은 regionCounts). 판정된 기사가 없으면 화면이 칩을 그리지 않는다 */
  regions: RegionCounts;
}

/**
 * 필터 드롭다운 선택지. 로드된 페이지가 아니라 테이블 전체에서 뽑는다.
 * 분류 = 노출 분류(categories.ts VISIBLE_CATEGORIES = 범위 − 숨김) ∩ DB 에 FACET_MIN_COUNT 건 이상 있는 분류, PUBLIC_CATEGORIES 순서.
 * 국가는 값 그대로 — 1개 이하면 화면(news-filter)이 선택 칸을 그리지 않는다.
 */
export async function fetchNewsFacets(): Promise<NewsFacets> {
  const { rows } = await pool.query(
    `SELECT
       ARRAY(SELECT DISTINCT country FROM ai_news_ex
             WHERE ${PUBLIC_NEWS_WHERE} AND country IS NOT NULL ORDER BY country) AS countries,
       ARRAY(SELECT category FROM ai_news_ex
             WHERE ${PUBLIC_NEWS_WHERE} AND category = ANY($1::text[])
             GROUP BY category HAVING COUNT(*) >= $2) AS categories`,
    [VISIBLE_CATEGORIES, FACET_MIN_COUNT]
  );
  return {
    countries: rows[0]?.countries ?? [],
    categories: publicCategoriesOf(rows[0]?.categories ?? []),
    regions: await regionCounts(pool, { population: "all" }),
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
 *
 * 집계 함수는 주간·월간 리포트와 같은 src/lib/metrics/period.ts 를 쓴다 (Gate 2). 통계 페이지 모집단 = 'all'(공개 전체),
 * 리포트 모집단 = 'ai'. 기간 없이 부르면 전체 기간.
 */
export async function fetchNewsStatistics(): Promise<StatisticsData> {
  const all = { population: "all" as const };
  // 일별 건수: 최근 STATS_DAILY_WINDOW_DAYS 일(주간 집계가 깔끔하도록 월요일부터 시작),
  // 데이터가 그보다 짧으면 첫 기사 날짜부터. 끝은 오늘과 마지막 기사 날짜 중 늦은 날. 기사 없는 날은 0.
  const bounds = await dayBounds(pool, "all");
  const endDay = bounds.last && bounds.last > bounds.today ? bounds.last : bounds.today;
  const windowMonday = mondayOf(addDays(endDay, -(STATS_DAILY_WINDOW_DAYS - 1)));
  const startDay = bounds.first && bounds.first > windowMonday ? bounds.first : windowMonday;

  const [k, categories, sentiments, sources, keywords, sparseDaily, regions] = await Promise.all([
    volumeSummary(pool, all),
    countBy(pool, "category", all),
    countBy(pool, "sentiment", all),
    countBy(pool, "source_name", { ...all, limit: 10 }),
    // 기사 1건에 같은 용어가 여러 번 있어도 1회로 센다
    termCounts(pool, { ...all, limit: 15 }),
    bounds.first ? countByDay(pool, { ...all, range: { start: startDay } }) : Promise.resolve([]),
    regionCounts(pool, all),
  ]);
  const daily = bounds.first ? fillDays(startDay, endDay, sparseDaily) : [];

  return {
    kpis: {
      totalNews: k.total,
      todayNews: k.today,
      categoryCount: k.categories,
      sourceCount: k.sources,
      avgPerDay: k.days > 0 ? Math.round((k.total / k.days) * 10) / 10 : 0,
      aiRatio: k.total > 0 ? Math.round((k.ai / k.total) * 100) : 0,
    },
    categories,
    sentiments,
    sources,
    keywords: keywords.map(({ term, count }) => ({ term, count })),
    daily,
    weekly: buildWeeklyTrend(daily),
    regions,
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

/**
 * 상세 페이지 관련 기사 세 묶음. 모달(/api/news/related)과 같은 src/lib/related.ts findRelated 를 쓴다 (Gate 2).
 */
export async function fetchRelatedNews(newsId: string): Promise<RelatedSections> {
  return findRelated(newsId);
}

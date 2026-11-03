/**
 * 기업·이슈 메뉴 데이터 (2026-11-03, ~/ainews-reports/home-ui-2026-11/REVIEW.md 3차).
 * 주간·월간 리포트와 같은 함수로 센다 (Gate 2):
 *  - 기사 = loadPeriodArticles (모집단 "ai"), 기업 언급 = entityMentions (제목 ko·cn + 요약, 기사당 1회)
 *  - 주별 비중 = monthWeeks + periodDailyPoints (수집 미완 주 판정 포함)
 *  - 큰 이슈 = crossSourceStories (전재 묶기 + 사건 묶기)
 * 리포트 스냅숏(period_metrics)은 쓰지 않는다 — 발행 전 판의 숫자가 새지 않게, 상위 15개만 있는 한계 없이 54개 모두.
 * 비교 구간은 "마지막 완전한 날"에서 끝나는 최근 7일 대 그 전 7일. 둘 중 수집 미완 날이 있으면 증감은 기사 100건당 비중으로 잰다.
 * 한 번 계산해 1시간 캐시 (기업 페이지마다 다시 세지 않는다).
 */
import pool from "./db";
import {
  addDays,
  articleEntityKeys,
  changePct,
  crossSourceStories,
  dayBounds,
  entityMentions,
  loadPeriodArticles,
  mondayOf,
  monthWeeks,
  periodDailyPoints,
  MIN_COUNT_FOR_CHANGE,
  type PeriodArticle,
} from "./metrics/period";
import { ENTITIES, entityMentioned, findEntities } from "./briefing/entities";
import { companyEntity } from "./company-names";

export const TREND_WEEKS = 12;
export const CO_DAYS = 28;
const TTL_MS = 60 * 60 * 1000;

export interface CompanyStat {
  key: string;
  chinese: boolean;
  cur: number;
  prev: number;
  /** 증감 %. 건수가 적으면(MIN_COUNT_FOR_CHANGE 미만) null */
  change_pct: number | null;
  sources: number;
}

export interface CompanyWeek {
  key: string;
  start: string;
  end: string;
  total: number;
  /** 수집 미완(축소·부분 수집일 포함) 또는 아직 끝나지 않은 주 */
  incomplete: boolean;
  counts: Record<string, number>;
}

export interface CompanyEvent {
  primary_id: string;
  ids: string[];
  sources: string[];
  days: string[];
  /** 대표 기사 제목에 나온 기업 (리포트 stories.entities 와 같은 규칙) */
  entities: string[];
}

export interface CompaniesSnapshot {
  window: {
    start: string;
    end: string;
    prevStart: string;
    prevEnd: string;
    total: number;
    prevTotal: number;
    /** 두 구간 중 수집 미완 날이 있다 → 증감은 비중 기준 */
    shareBasis: boolean;
  };
  companies: CompanyStat[];
  weeks: CompanyWeek[];
  /** 최근 CO_DAYS 일 함께 언급: key → 상위 */
  co: Record<string, { key: string; n: number }[]>;
  /** 최근 CO_DAYS 일 기업별 기사 수 (함께 언급의 분모) */
  coBase: Record<string, number>;
  /** 최근 7일 사건 (매체 2곳 이상, 매체 수 순) */
  events: CompanyEvent[];
  /** 최근 CO_DAYS 일 사건 (기업 페이지 최근 이슈) */
  recentEvents: CompanyEvent[];
  computedAt: string;
}

const inRange = (a: PeriodArticle, s: string, e: string) => a.day >= s && a.day <= e;

/** 함께 언급 (같은 기사에 같이 나온 횟수) — 순수 */
export function coMentions(arts: Pick<PeriodArticle, "title_kr" | "title_cn" | "summary_kr">[], top = 8) {
  const pair = new Map<string, Map<string, number>>();
  const base: Record<string, number> = {};
  for (const a of arts) {
    const keys = [...new Set(articleEntityKeys(a))];
    for (const k of keys) {
      base[k] = (base[k] ?? 0) + 1;
      const m = pair.get(k) ?? new Map<string, number>();
      for (const o of keys) if (o !== k) m.set(o, (m.get(o) ?? 0) + 1);
      pair.set(k, m);
    }
  }
  const co: Record<string, { key: string; n: number }[]> = {};
  for (const [k, m] of pair)
    co[k] = [...m.entries()]
      .map(([key, n]) => ({ key, n }))
      .sort((a, b) => b.n - a.n || a.key.localeCompare(b.key))
      .slice(0, top);
  return { co, base };
}

/** 기사 100건당 비중 기준 증감 % (구간 기사 수가 달라도 비교 가능) */
export function shareChangePct(cur: number, curTotal: number, prev: number, prevTotal: number): number | null {
  if (cur < MIN_COUNT_FOR_CHANGE || prev < MIN_COUNT_FOR_CHANGE || !curTotal || !prevTotal) return null;
  return Math.round(((cur / curTotal) / (prev / prevTotal) - 1) * 100);
}

/** 비교 구간의 끝: 마지막 기사 날이 수집 미완(오늘처럼 진행 중)이면 그 전날 */
export function pickWindowEnd(last: string, lastIncomplete: boolean): string {
  return lastIncomplete ? addDays(last, -1) : last;
}

function toEvents(arts: PeriodArticle[], limit: number): CompanyEvent[] {
  const byId = new Map(arts.map((a) => [a.id, a]));
  return crossSourceStories(arts)
    .events.filter((e) => e.sources.length >= 2)
    .sort((a, b) => b.sources.length - a.sources.length || b.ids.length - a.ids.length)
    .slice(0, limit)
    .map((e) => {
      const p = byId.get(e.primary_id);
      return {
        primary_id: e.primary_id,
        ids: e.ids,
        sources: e.sources,
        days: e.days,
        entities: p ? findEntities(`${p.title_kr} ${p.title_cn}`).map((x) => x.key) : [],
      };
    });
}

async function compute(): Promise<CompaniesSnapshot> {
  const { last, today } = await dayBounds(pool, "ai");
  const lastDay = last ?? today;
  const tail = await periodDailyPoints(pool, lastDay, lastDay);
  const end = pickWindowEnd(lastDay, Boolean(tail[0]?.incomplete));
  const start = addDays(end, -6);
  const prevEnd = addDays(start, -1);
  const prevStart = addDays(prevEnd, -6);
  const trendStart = mondayOf(addDays(end, -7 * (TREND_WEEKS - 1)));
  const coStart = addDays(end, -(CO_DAYS - 1));

  const arts = await loadPeriodArticles(pool, { population: "ai", range: { start: trendStart, end } });
  const daily = await periodDailyPoints(pool, trendStart, end);

  const cur = arts.filter((a) => inRange(a, start, end));
  const prev = arts.filter((a) => inRange(a, prevStart, prevEnd));
  const shareBasis = daily.some((d) => d.day >= prevStart && d.day <= end && d.incomplete);
  const companies: CompanyStat[] = entityMentions(cur, prev, ENTITIES.length).map((m) => ({
    key: m.key,
    chinese: m.chinese,
    cur: m.cur,
    prev: m.prev,
    change_pct: shareBasis ? shareChangePct(m.cur, cur.length, m.prev, prev.length) : changePct(m.cur, m.prev),
    sources: m.sources,
  }));

  const keys = ENTITIES.map((e) => e.key);
  const weeks: CompanyWeek[] = monthWeeks(daily, arts, keys).map((w) => ({
    key: w.key,
    start: w.start,
    end: w.end,
    total: w.total,
    incomplete: w.coverage !== "full" || w.complete_days < 7,
    counts: w.entities,
  }));

  const recent = arts.filter((a) => inRange(a, coStart, end));
  const { co, base } = coMentions(recent);

  return {
    window: { start, end, prevStart, prevEnd, total: cur.length, prevTotal: prev.length, shareBasis },
    companies,
    weeks,
    co,
    coBase: base,
    events: toEvents(cur, 10),
    recentEvents: toEvents(recent, 80),
    computedAt: new Date().toISOString(),
  };
}

let cache: { at: number; p: Promise<CompaniesSnapshot>; ready: CompaniesSnapshot | null } | null = null;

/**
 * 1시간 캐시 + 만료 뒤에는 지난 값을 바로 주고 뒤에서 다시 센다 (첫 계산 약 6초 — 재시작 뒤 첫 요청만 기다린다).
 */
export function getCompaniesSnapshot(): Promise<CompaniesSnapshot> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.ready ? Promise.resolve(cache.ready) : cache.p;
  const stale = cache?.ready ?? null;
  const p = compute();
  const entry: { at: number; p: Promise<CompaniesSnapshot>; ready: CompaniesSnapshot | null } = { at: Date.now(), p, ready: stale };
  cache = entry;
  p.then(
    (v) => {
      if (cache === entry) entry.ready = v;
    },
    () => {
      // 실패: 지난 값이 있으면 그대로 두고 5분 뒤 다시 시도, 없으면 다음 요청이 다시 센다
      if (cache === entry) cache = stale ? { at: Date.now() - TTL_MS + 5 * 60 * 1000, p: Promise.resolve(stale), ready: stale } : null;
    }
  );
  return stale ? Promise.resolve(stale) : p;
}

/** 화면에 보일 기사 제목 (언어별 getTitle 은 호출자) */
export async function fetchArticleTitles(ids: string[]): Promise<Map<string, { title_cn: string; title_kr: string; title_en: string }>> {
  if (!ids.length) return new Map();
  const { rows } = await pool.query(
    `SELECT id::text AS id, COALESCE(title_cn,'') AS title_cn, COALESCE(title_kr,'') AS title_kr, COALESCE(title_en,'') AS title_en
       FROM ai_news_ex WHERE id = ANY($1::uuid[])`,
    [ids]
  );
  return new Map(rows.map((r: { id: string; title_cn: string; title_kr: string; title_en: string }) => [r.id, r]));
}

/** 최근 발행 데일리 브리핑(그 언어) 중 이 기업이 머리·리드·주요 기사에 나온 판 */
export async function briefingAppearances(key: string, locale: string, limit = 7): Promise<{ total: number; dates: string[] }> {
  const e = companyEntity(key);
  if (!e) return { total: 0, dates: [] };
  const { rows } = await pool.query(
    `SELECT to_char(edition_date, 'YYYY-MM-DD') AS date,
            concat_ws(' ', content->>'headline', content->>'lede', (content->'top_stories')::text) AS text
       FROM daily_briefings
      WHERE status = 'published' AND edition_type = 'daily' AND locale = $1
      ORDER BY edition_date DESC LIMIT $2`,
    [locale, limit]
  );
  const dates = (rows as { date: string; text: string }[]).filter((r) => entityMentioned(e, r.text ?? "")).map((r) => r.date);
  return { total: rows.length, dates };
}

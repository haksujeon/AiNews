/**
 * 기간 지표 — 통계 페이지(fetchNewsStatistics)와 주간·월간 리포트가 같은 함수를 쓴다 (Gate 2).
 *
 *  - SQL 집계 함수(countBy / countByDay / termCounts / volumeSummary / dayBounds)는 Queryable 을 인자로 받는다.
 *    이 파일은 DB 풀을 import 하지 않는다 → 단위 테스트가 DATABASE_URL 없이 돌고, 통합 시험은 READ ONLY 트랜잭션 client 를 넘긴다.
 *  - 기사 단위 함수(entityMentions / chinaVsOverseas / moneyTable / crossSourceStories)는 불러온 행을 받는 순수 함수.
 *  - 모집단(population): 'all' = 공개 기사 전체(통계 페이지), 'ai' = 공개 기사 중 범위 내 분류(categories.ts scopeCategorySql, 브리핑·리포트).
 *    범위 분류 목록이 바뀌면(로봇 추가 등) METRICS_VERSION 을 올린다.
 *  - 날짜 = news_date 의 UTC 날짜 = 베이징 날짜 (news_date 는 "베이징 날짜 00:00 UTC" 로 저장됨).
 *
 * 수치 규칙(설계 검토서 §1.4):
 *  - 결손일: 같은 요일군(평일/주말) 중앙값의 50% 미만. 기준선은 수집이 완전해진 2026-10-13 이후, 기간 끝에서 8주 이내.
 *    중앙값은 정렬 후 floor(n/2) 번째(위쪽 중앙값) — 프로토타입과 같게 (W44 주말 중앙값 43).
 *  - 기사 수 증감은 같은 요일끼리, 양쪽 주 모두 완전한 요일만.
 *  - 증감 % 는 양쪽 모두 MIN_COUNT_FOR_CHANGE(5)건 이상일 때만.
 *  - 용어 증감: 이번 기간 4건 이상이고 ±3건 이상.
 */
import { createHash } from "node:crypto";
import { PUBLIC_NEWS_WHERE } from "../news-query";
import { scopeCategorySql } from "../categories";
import { rankStories, type RankableArticle } from "../news-rank";
import { ENTITIES, findEntities } from "../briefing/entities";
import { groupPeriodStories, isPolitical } from "../briefing/select";
import type { CandidateArticle, KeyTerm } from "../briefing/types";

// ───────────────────────── 공통

export interface Queryable {
  query: (sql: string, values?: unknown[]) => Promise<{ rows: unknown[] }>;
}

export type Population = "ai" | "all";

/** 포함 범위 [start, end] (YYYY-MM-DD). 빠지면 그쪽 제한 없음 */
export interface DateRange {
  start?: string;
  end?: string;
}

export interface MetricOptions {
  population: Population;
  range?: DateRange;
}

export interface CountRow {
  name: string;
  value: number;
}

/** 수집이 완전해진 첫날 (결손일 기준선의 시작) */
export const COMPLETE_SINCE = "2026-10-13";
export const MIN_COUNT_FOR_CHANGE = 5;
export const TERM_MIN = 4;
export const TERM_DELTA = 3;
export const MISSING_RATIO = 0.5;
export const METRICS_VERSION = "period-v1-2026-11-02";

export const DAY_SQL = `(news_date AT TIME ZONE 'UTC')::date`;

export function populationWhere(p: Population): string {
  return p === "ai" ? `${PUBLIC_NEWS_WHERE} AND ${scopeCategorySql()}` : PUBLIC_NEWS_WHERE;
}

/** WHERE 절 (모집단 + 기간). values 는 $1.. 부터 */
function whereOf(opts: MetricOptions, startIndex = 0): { where: string; values: unknown[] } {
  const clauses = [populationWhere(opts.population)];
  const values: unknown[] = [];
  let i = startIndex;
  if (opts.range?.start) {
    values.push(opts.range.start);
    clauses.push(`news_date >= ($${++i}::date)::timestamp AT TIME ZONE 'UTC'`);
  }
  if (opts.range?.end) {
    values.push(opts.range.end);
    clauses.push(`news_date < ($${++i}::date + 1)::timestamp AT TIME ZONE 'UTC'`);
  }
  return { where: clauses.join(" AND "), values };
}

// ───────────────────────── 날짜 (순수)

const DAY_MS = 86_400_000;
const toDay = (t: number) => new Date(t).toISOString().slice(0, 10);
const dayMs = (d: string) => Date.parse(`${d}T00:00:00Z`);

export function addDays(day: string, n: number): string {
  return toDay(dayMs(day) + n * DAY_MS);
}

export function daysBetween(start: string, end: string): string[] {
  const out: string[] = [];
  for (let t = dayMs(start); t <= dayMs(end); t += DAY_MS) out.push(toDay(t));
  return out;
}

/** 0=일 … 6=토 */
export const weekdayOf = (day: string) => new Date(`${day}T00:00:00Z`).getUTCDay();
export const isWeekend = (day: string) => {
  const w = weekdayOf(day);
  return w === 0 || w === 6;
};

/** 그 날짜가 속한 주의 월요일 */
export function mondayOf(day: string): string {
  return addDays(day, -((weekdayOf(day) + 6) % 7));
}

const ISO_WEEK_RE = /^(\d{4})-W(\d{2})$/;

/** "2026-W44" → { start: 월요일, end: 일요일 }. 형식이 틀리면 null */
export function isoWeekRange(week: string): { start: string; end: string } | null {
  const m = ISO_WEEK_RE.exec(week);
  if (!m) return null;
  const year = Number(m[1]);
  const w = Number(m[2]);
  if (w < 1 || w > 53) return null;
  // ISO 1주 = 1월 4일이 든 주
  const week1Monday = mondayOf(`${year}-01-04`);
  const start = addDays(week1Monday, (w - 1) * 7);
  if (isoWeekOf(start) !== week) return null; // 53주가 없는 해
  return { start, end: addDays(start, 6) };
}

/** 날짜 → "YYYY-Www" (ISO 8601) */
export function isoWeekOf(day: string): string {
  const thursday = addDays(mondayOf(day), 3);
  const year = Number(thursday.slice(0, 4));
  const week1Monday = mondayOf(`${year}-01-04`);
  const w = Math.round((dayMs(mondayOf(day)) - dayMs(week1Monday)) / (7 * DAY_MS)) + 1;
  return `${year}-W${String(w).padStart(2, "0")}`;
}

// ───────────────────────── 증감·비율 (순수)

/** 증감 %. 어느 쪽이든 min 건 미만이면 null (작은 수의 % 는 오해를 부른다) */
export function changePct(cur: number, prev: number, min = MIN_COUNT_FOR_CHANGE): number | null {
  if (cur < min || prev < min || prev === 0) return null;
  return Math.round(((cur - prev) / prev) * 100);
}

/** 최소 건수 제한 없는 증감 % (기사 수 같은 큰 수 전용) */
export function rawChangePct(cur: number, prev: number): number | null {
  return prev === 0 ? null : Math.round(((cur - prev) / prev) * 100);
}

export const signedPct = (p: number | null) => (p === null ? "—" : `${p > 0 ? "+" : ""}${p}%`);
export const sharePct = (n: number, total: number) => (total ? Math.round((n / total) * 1000) / 10 : 0);
export const countLabel = (n: number) => `${n.toLocaleString("en-US")}건`;

export function upperMedian(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : 0;
}

// ───────────────────────── SQL 집계 (통계 페이지·리포트 공용)

export type CountField = "category" | "sentiment" | "source_name";
const COUNT_DEFAULT: Record<CountField, string> = { category: "other", sentiment: "neutral", source_name: "Unknown" };

/** 그룹별 기사 수. 정렬: 건수 내림차순 → 이름 */
export async function countBy(q: Queryable, field: CountField, opts: MetricOptions & { limit?: number }): Promise<CountRow[]> {
  const { where, values } = whereOf(opts);
  const limit = opts.limit ? ` LIMIT ${Math.max(1, Math.floor(opts.limit))}` : "";
  const { rows } = await q.query(
    `SELECT COALESCE(${field}, '${COUNT_DEFAULT[field]}') AS name, COUNT(*)::int AS value
       FROM ai_news_ex WHERE ${where}
      GROUP BY 1 ORDER BY value DESC, name${limit}`,
    values
  );
  return rows as CountRow[];
}

export interface DayCount {
  date: string;
  count: number;
}

/** 날짜별 기사 수 (기사 없는 날은 빠짐 — fillDays 로 채운다) */
export async function countByDay(q: Queryable, opts: MetricOptions): Promise<DayCount[]> {
  const { where, values } = whereOf(opts);
  const { rows } = await q.query(
    `SELECT to_char(${DAY_SQL}, 'YYYY-MM-DD') AS date, COUNT(*)::int AS count
       FROM ai_news_ex WHERE ${where} GROUP BY 1 ORDER BY 1`,
    values
  );
  return rows as DayCount[];
}

/** [start, end] 의 모든 날짜를 0 으로 채운 연속 일자 */
export function fillDays(start: string, end: string, sparse: DayCount[]): DayCount[] {
  const m = new Map(sparse.map((d) => [d.date, d.count]));
  return daysBetween(start, end).map((date) => ({ date, count: m.get(date) ?? 0 }));
}

/** 모집단의 첫·마지막 기사 날짜와 오늘(UTC 날짜) */
export async function dayBounds(q: Queryable, population: Population): Promise<{ first: string | null; last: string | null; today: string }> {
  const { rows } = await q.query(
    `SELECT to_char(MIN(${DAY_SQL}), 'YYYY-MM-DD') AS first, to_char(MAX(${DAY_SQL}), 'YYYY-MM-DD') AS last,
            to_char((now() AT TIME ZONE 'UTC')::date, 'YYYY-MM-DD') AS today
       FROM ai_news_ex WHERE ${populationWhere(population)}`
  );
  const r = rows[0] as { first: string | null; last: string | null; today: string };
  return r;
}

export interface VolumeSummary {
  total: number;
  today: number;
  categories: number;
  sources: number;
  days: number;
  ai: number;
}

/** 총계·오늘·분야 수·매체 수·날짜 수·범위 내(AI) 분야 수 */
export async function volumeSummary(q: Queryable, opts: MetricOptions): Promise<VolumeSummary> {
  const { where, values } = whereOf(opts);
  const { rows } = await q.query(
    `SELECT COUNT(*)::int                                                         AS total,
            COUNT(*) FILTER (WHERE ${DAY_SQL} = (now() AT TIME ZONE 'UTC')::date)::int AS today,
            COUNT(DISTINCT category)::int                                         AS categories,
            COUNT(DISTINCT source_name)::int                                      AS sources,
            COUNT(DISTINCT ${DAY_SQL})::int                                       AS days,
            COUNT(*) FILTER (WHERE ${scopeCategorySql()})::int                     AS ai
       FROM ai_news_ex WHERE ${where}`,
    values
  );
  return (rows[0] as VolumeSummary) ?? { total: 0, today: 0, categories: 0, sources: 0, days: 0, ai: 0 };
}

export interface TermCount {
  term: string;
  count: number;
  /** pinyin 모드: 가장 많이 쓴 병음 표기 */
  pinyin?: string;
  /** pinyin 모드: 기사마다 다른 병음 표기 수 */
  pinyin_variants?: number;
  explanation_kr?: string;
}

/**
 * 용어별 기사 수 (기사 1건에 같은 용어가 여러 번 있어도 1회). 정렬: 건수 내림차순 → 용어.
 * pinyin 모드는 기사마다 그 용어의 첫 표기를 세어 최빈 병음과 표기 변형 수를 붙인다.
 */
export async function termCounts(q: Queryable, opts: MetricOptions & { limit?: number; pinyin?: boolean }): Promise<TermCount[]> {
  const { where, values } = whereOf(opts);
  const limit = opts.limit ? ` LIMIT ${Math.max(1, Math.floor(opts.limit))}` : "";
  const deduped = `
    SELECT DISTINCT ON (n.id, kt.term) n.id, kt.term,
           NULLIF(btrim(x.e->>'pinyin'), '') AS pinyin, NULLIF(btrim(x.e->>'explanation_kr'), '') AS expl
      FROM (SELECT id, key_terms FROM ai_news_ex WHERE ${where}) n
      CROSS JOIN LATERAL jsonb_array_elements(
        CASE WHEN jsonb_typeof(n.key_terms) = 'array' THEN n.key_terms ELSE '[]'::jsonb END
      ) WITH ORDINALITY AS x(e, ord)
      CROSS JOIN LATERAL (SELECT NULLIF(btrim(x.e->>'term'), '') AS term) kt
     WHERE kt.term IS NOT NULL
     ORDER BY n.id, kt.term, x.ord`;
  const { rows } = await q.query(
    `WITH e AS (${deduped})
     SELECT term, COUNT(*)::int AS count FROM e GROUP BY term ORDER BY count DESC, term${limit}`,
    values
  );
  const out = rows as TermCount[];
  if (!opts.pinyin || !out.length) return out;
  const { rows: py } = await q.query(
    `WITH e AS (${deduped})
     SELECT term, pinyin, COUNT(*)::int AS n, MIN(expl) AS expl
       FROM e WHERE term = ANY($${values.length + 1}::text[]) GROUP BY term, pinyin`,
    [...values, out.map((t) => t.term)]
  );
  const byTerm = new Map<string, { pinyin: string | null; n: number; expl: string | null }[]>();
  for (const r of py as { term: string; pinyin: string | null; n: number; expl: string | null }[]) {
    if (!byTerm.has(r.term)) byTerm.set(r.term, []);
    byTerm.get(r.term)!.push(r);
  }
  return out.map((t) => {
    const list = byTerm.get(t.term) ?? [];
    const named = list.filter((x) => x.pinyin).sort((a, b) => b.n - a.n || String(a.pinyin).localeCompare(String(b.pinyin)));
    return {
      ...t,
      pinyin: named[0]?.pinyin ?? "",
      pinyin_variants: named.length,
      explanation_kr: list.map((x) => x.expl).find((x): x is string => !!x) ?? "",
    };
  });
}

export interface SentimentShare {
  name: "positive" | "neutral" | "negative";
  n: number;
  share_pct: number;
  display: string;
}

/** 논조 비중 (countBy 를 그대로 씀) */
export async function sentimentShare(q: Queryable, opts: MetricOptions): Promise<SentimentShare[]> {
  return toSentimentShare(await countBy(q, "sentiment", opts));
}

export function toSentimentShare(rows: CountRow[]): SentimentShare[] {
  const total = rows.reduce((s, r) => s + r.value, 0);
  return (["positive", "neutral", "negative"] as const).map((name) => {
    const n = rows.find((r) => r.name === name)?.value ?? 0;
    return { name, n, share_pct: sharePct(n, total), display: `${sharePct(n, total)}%` };
  });
}

/** 논조 변화가 모두 ±1%p 안쪽이면 true ("흐름 아님") */
export function sentimentFlat(cur: SentimentShare[], prev: SentimentShare[] | null): boolean {
  if (!prev) return false;
  return cur.every((c) => Math.abs(c.share_pct - (prev.find((p) => p.name === c.name)?.share_pct ?? 0)) < 1);
}

// ───────────────────────── 결손일 · 같은 요일 비교 (순수)

export interface DailyPoint {
  day: string;
  count: number;
  weekend: boolean;
  expected: number;
  incomplete: boolean;
}

export interface MissingDayBaseline {
  weekday_median: number;
  weekend_median: number;
  since: string;
  until: string;
}

/** 기준선 일별 건수 → 평일·주말 중앙값 (위쪽 중앙값) */
export function baselineFrom(series: DayCount[], since: string, until: string): MissingDayBaseline {
  const inRange = series.filter((d) => d.date >= since && d.date <= until);
  return {
    weekday_median: upperMedian(inRange.filter((d) => !isWeekend(d.date)).map((d) => d.count)),
    weekend_median: upperMedian(inRange.filter((d) => isWeekend(d.date)).map((d) => d.count)),
    since,
    until,
  };
}

/** 일별 건수에 결손일 판정을 붙인다: 같은 요일군 중앙값의 50% 미만 */
export function detectMissingDays(series: DayCount[], baseline: MissingDayBaseline): DailyPoint[] {
  return series.map((d) => {
    const weekend = isWeekend(d.date);
    const expected = weekend ? baseline.weekend_median : baseline.weekday_median;
    return { day: d.date, count: d.count, weekend, expected, incomplete: expected > 0 && d.count < expected * MISSING_RATIO };
  });
}

export interface LikeForLike {
  days: number;
  excluded_days: string[];
  cur: number;
  prev: number;
  change_pct: number | null;
  display: string;
  display_change: string;
}

/** 같은 요일끼리 비교: 두 기간을 요일 순서로 맞추고, 어느 쪽이든 결손인 요일은 양쪽에서 뺀다 */
export function sameWeekdayComparison(cur: DailyPoint[], prev: DailyPoint[]): LikeForLike {
  const n = Math.min(cur.length, prev.length);
  let a = 0;
  let b = 0;
  let days = 0;
  const excluded: string[] = [];
  for (let i = 0; i < n; i++) {
    if (cur[i].incomplete || prev[i].incomplete) {
      excluded.push(cur[i].day);
      continue;
    }
    a += cur[i].count;
    b += prev[i].count;
    days++;
  }
  const p = rawChangePct(a, b);
  return { days, excluded_days: excluded, cur: a, prev: b, change_pct: p, display: `${countLabel(a)} 대 ${countLabel(b)}`, display_change: signedPct(p) };
}

/** 결손일을 뺀 하루 평균 */
export function avgPerCompleteDay(points: DailyPoint[]): number {
  const ok = points.filter((x) => !x.incomplete);
  return ok.length ? Math.round(ok.reduce((s, x) => s + x.count, 0) / ok.length) : 0;
}

// ───────────────────────── 기사 행 (리포트용)

export interface PeriodArticle extends RankableArticle {
  id: string;
  day: string;
  source_name: string;
  category: string;
  sentiment: string;
  title_cn: string;
  title_kr: string;
  summary_kr: string;
  ai_insights_kr: string;
  key_terms: KeyTerm[];
}

export async function loadPeriodArticles(q: Queryable, opts: MetricOptions): Promise<PeriodArticle[]> {
  const { where, values } = whereOf(opts);
  const { rows } = await q.query(
    `SELECT id, to_char(${DAY_SQL}, 'YYYY-MM-DD') AS day, source_name, category,
            COALESCE(sentiment, 'neutral') AS sentiment, COALESCE(title_cn, '') AS title_cn, COALESCE(title_kr, '') AS title_kr,
            COALESCE(summary_kr, '') AS summary_kr, COALESCE(ai_insights_kr, '') AS ai_insights_kr,
            CASE WHEN jsonb_typeof(key_terms) = 'array' THEN key_terms ELSE '[]'::jsonb END AS key_terms
       FROM ai_news_ex WHERE ${where} ORDER BY id`,
    values
  );
  return rows as PeriodArticle[];
}

const asCandidate = (a: PeriodArticle) => a as unknown as CandidateArticle;

// ───────────────────────── 실체 언급 (순수)

const NAME_KO_OVERRIDE: Record<string, string> = { meta: "메타", amd: "AMD", intel: "인텔", cn_gov: "중국 정부·기관" };

export function entityNameKo(key: string): string {
  if (NAME_KO_OVERRIDE[key]) return NAME_KO_OVERRIDE[key];
  const e = ENTITIES.find((x) => x.key === key);
  const first = e?.aliases.find((a): a is string => typeof a === "string");
  return first ?? key;
}

export interface EntityMention {
  key: string;
  name_ko: string;
  chinese: boolean;
  cur: number;
  prev: number;
  title_mentions: number;
  sources: number;
  active_days: number;
  change_pct: number | null;
  display: string;
  display_change: string;
  sample_ids: string[];
}

const entityText = (a: PeriodArticle) => `${a.title_kr} ${a.title_cn} ${a.summary_kr}`;

interface EntityTally {
  n: number;
  ids: string[];
  sources: Set<string>;
  days: Set<string>;
  titleHits: number;
}

function tallyEntities(arts: PeriodArticle[]): Map<string, EntityTally> {
  const m = new Map<string, EntityTally>();
  for (const a of arts) {
    const inTitle = new Set(findEntities(`${a.title_kr} ${a.title_cn}`).map((e) => e.key));
    for (const e of findEntities(entityText(a))) {
      const r = m.get(e.key) ?? { n: 0, ids: [], sources: new Set<string>(), days: new Set<string>(), titleHits: 0 };
      r.n++;
      r.ids.push(a.id);
      r.sources.add(a.source_name);
      r.days.add(a.day);
      if (inTitle.has(e.key)) r.titleHits++;
      m.set(e.key, r);
    }
  }
  return m;
}

/** 실체 이름표(entities.ts)를 제목+요약에 적용, 기사당 1회. 언급 수는 보도량이지 점유율이 아니다 */
export function entityMentions(cur: PeriodArticle[], prev: PeriodArticle[] | null, limit = 15): EntityMention[] {
  const ec = tallyEntities(cur);
  const ep = prev ? tallyEntities(prev) : new Map<string, EntityTally>();
  return [...ec.entries()]
    .map(([key, r]) => {
      const p = ep.get(key)?.n ?? 0;
      const ch = prev ? changePct(r.n, p) : null;
      return {
        key,
        name_ko: entityNameKo(key),
        chinese: ENTITIES.find((e) => e.key === key)!.chinese,
        cur: r.n,
        prev: p,
        title_mentions: r.titleHits,
        sources: r.sources.size,
        active_days: r.days.size,
        change_pct: ch,
        display: countLabel(r.n),
        display_change: signedPct(ch),
        sample_ids: r.ids.slice(0, 12),
      };
    })
    .sort((a, b) => b.cur - a.cur || b.prev - a.prev || a.key.localeCompare(b.key))
    .slice(0, limit);
}

// ───────────────────────── 그룹 비교 (분야·매체)

export interface GroupCompare {
  name: string;
  cur: number;
  prev: number;
  share_pct: number;
  change_pct: number | null;
  display: string;
  display_share: string;
  display_change: string;
}

export function compareGroups(cur: CountRow[], prev: CountRow[] | null): GroupCompare[] {
  const total = cur.reduce((s, r) => s + r.value, 0);
  const names = [...new Set([...cur.map((r) => r.name), ...(prev ?? []).map((r) => r.name)])];
  return names
    .map((name) => {
      const c = cur.find((r) => r.name === name)?.value ?? 0;
      const p = prev?.find((r) => r.name === name)?.value ?? 0;
      const ch = prev ? changePct(c, p) : null;
      return {
        name,
        cur: c,
        prev: p,
        share_pct: sharePct(c, total),
        change_pct: ch,
        display: countLabel(c),
        display_share: `${sharePct(c, total)}%`,
        display_change: signedPct(ch),
      };
    })
    .sort((a, b) => b.cur - a.cur || b.prev - a.prev || a.name.localeCompare(b.name));
}

// ───────────────────────── 용어 증감 (순수)

export interface TermMetric {
  term: string;
  cur: number;
  prev: number;
  delta: number;
  pinyin: string;
  pinyin_variants: number;
  explanation_kr: string;
  display: string;
}

export function termMovement(cur: TermCount[], prev: TermCount[] | null, top = 12): { top: TermMetric[]; rising: TermMetric[]; falling: TermMetric[] } {
  const prevMap = new Map((prev ?? []).map((t) => [t.term, t]));
  const curMap = new Map(cur.map((t) => [t.term, t]));
  const toMetric = (term: string): TermMetric => {
    const c = curMap.get(term);
    const p = prevMap.get(term);
    const n = c?.count ?? 0;
    const pn = p?.count ?? 0;
    return {
      term,
      cur: n,
      prev: pn,
      delta: n - pn,
      pinyin: c?.pinyin || p?.pinyin || "",
      pinyin_variants: c?.pinyin_variants ?? p?.pinyin_variants ?? 0,
      explanation_kr: c?.explanation_kr || p?.explanation_kr || "",
      display: countLabel(n),
    };
  };
  const all = cur.map((t) => toMetric(t.term));
  if (!prev) return { top: all.slice(0, top), rising: [], falling: [] };
  const rising = all
    .filter((t) => t.cur >= TERM_MIN && t.delta >= TERM_DELTA)
    .sort((a, b) => b.delta - a.delta || b.cur - a.cur || a.term.localeCompare(b.term))
    .slice(0, 6);
  const falling = (prev ?? [])
    .map((t) => toMetric(t.term))
    .filter((t) => t.prev >= TERM_MIN && -t.delta >= TERM_DELTA)
    .sort((a, b) => a.delta - b.delta || b.prev - a.prev || a.term.localeCompare(b.term))
    .slice(0, 6);
  return { top: all.slice(0, top), rising, falling };
}

// ───────────────────────── 중국 대 해외 (순수)

const CHINA_PLACE_RE = /중국|中国|国产|베이징|상하이|선전|항저우/;

export interface ChinaVsOverseas {
  total: number;
  china_only: number;
  foreign_only: number;
  both: number;
  neither: number;
  /** 중국 실체·지명이 나온 기사 비중 (둘 다 나온 기사 포함) */
  china_pct: number;
  /** 해외 실체가 나온 기사 비중 (둘 다 나온 기사 포함) */
  foreign_pct: number;
}

/** 기사 단위: 중국 실체(chinese=true) 또는 중국 지명 → 중국, 해외 실체 → 해외. 둘 다면 양쪽 모두 */
export function chinaVsOverseas(arts: PeriodArticle[]): ChinaVsOverseas {
  let cn = 0;
  let fo = 0;
  let both = 0;
  let none = 0;
  for (const r of arts) {
    const t = `${r.title_kr} ${r.title_cn} ${r.summary_kr}`;
    const es = findEntities(t);
    const a = es.some((x) => x.chinese) || CHINA_PLACE_RE.test(t);
    const b = es.some((x) => !x.chinese);
    if (a && b) both++;
    else if (a) cn++;
    else if (b) fo++;
    else none++;
  }
  const n = arts.length;
  const p = (x: number) => (n ? Math.round((x / n) * 1000) / 10 : 0);
  return {
    total: n,
    china_only: cn,
    foreign_only: fo,
    both,
    neither: none,
    china_pct: Math.round((p(cn) + p(both)) * 10) / 10,
    foreign_pct: Math.round((p(fo) + p(both)) * 10) / 10,
  };
}

// ───────────────────────── 돈의 흐름 (순수)

/** 1차: 제목·요약에 거래 낱말 */
const FUND_RE_BROAD = /투자 유치|투자를 유치|펀딩|라운드|시리즈 [A-F]|인수|상장|IPO|融资|轮|收购|上市|증자|조달/;
const AMT_RE_BROAD = /\d[\d,.]*\s?(?:억|만|조)?\s?(?:위안|달러|원|홍콩달러|엔)/g;
/** 2차: 제목에 거래 낱말 + 금액 (정밀도 우선) */
const FUND_RE_TITLE = /투자 유치|투자를 유치|펀딩|라운드|시리즈 [A-F]|인수|상장|IPO|증자|조달|투자/;
/** "5억 8700만 달러", "1조 2000억 위안" 처럼 큰 단위가 이어진 금액을 한 덩어리로 */
export const AMOUNT_RE = /\d[\d,.]*\s?(?:조\s?(?:\d[\d,.]*\s?억\s?)?|억\s?(?:\d[\d,.]*\s?만\s?)?|만\s?)?(?:위안|달러|홍콩달러)/g;
/** 금액 앞뒤 8자에 이 낱말이 있으면 거래가 아니라 실적·가치 금액 → 표에서 뺀다 */
export const NON_DEAL_RE = /매출|손실|흑자|기업가치|가치|시가|현금화|급락|컴퓨팅|베팅/;
const KIND_RULES: [RegExp, string][] = [
  [/인수/, "인수"],
  [/부채|채권|차입|차용/, "부채 조달"],
  [/IPO|상장|투자설명서|증권신고서/, "상장"],
  [/투자 유치|융자|라운드|투자를 유치|펀딩/, "투자 유치"],
  [/투자/, "투자"],
  [/조달/, "자금 조달"],
];

/** 금액의 역할: 앞뒤 8자 창에 매출·손실·가치 낱말이 있으면 'value' */
export function amountRole(title: string, amount: string): "deal" | "value" {
  const i = title.indexOf(amount);
  const win = title.slice(Math.max(0, i - 8), i + amount.length + 8);
  return NON_DEAL_RE.test(win) ? "value" : "deal";
}

export function dealKind(title: string): string {
  return KIND_RULES.find(([re]) => re.test(title))?.[1] ?? "기타";
}

export interface MoneyRow {
  id: string;
  day: string;
  source: string;
  kind: string;
  amount: string;
  title_kr: string;
  entities: string[];
}

/** 제목에 거래 낱말과 금액이 함께 있는 기사. 금액은 제목 그대로 — 합산·환산·서열 없음 */
export function moneyTable(arts: PeriodArticle[]): MoneyRow[] {
  const seen = new Set<string>();
  return arts
    .filter((a) => {
      const both = `${a.title_kr} ${a.summary_kr}`;
      return FUND_RE_BROAD.test(both) && (both.match(AMT_RE_BROAD) ?? []).length > 0 && !isPolitical(asCandidate(a));
    })
    .filter((a) => FUND_RE_TITLE.test(a.title_kr) && (a.title_kr.match(AMOUNT_RE) ?? []).length > 0)
    .map((a) => {
      const amount = a.title_kr.match(AMOUNT_RE)![0];
      return {
        row: {
          id: a.id,
          day: a.day,
          source: a.source_name,
          kind: dealKind(a.title_kr),
          amount,
          title_kr: a.title_kr,
          entities: findEntities(`${a.title_kr} ${a.title_cn}`).map((e) => e.key),
        },
        role: amountRole(a.title_kr, amount),
      };
    })
    .filter((x) => x.role === "deal")
    .map((x) => x.row)
    .filter((r) => {
      const k = r.title_kr.slice(0, 14);
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .sort((a, b) => a.day.localeCompare(b.day));
}

// ───────────────────────── 여러 매체가 함께 다룬 이야기 (순수)

export interface PeriodStory {
  ids: string[];
  primary_id: string;
  title_kr: string;
  title_cn: string;
  summary_kr: string;
  category: string;
  sources: string[];
  days: string[];
  score: number;
  entities: string[];
}

export interface PeriodEventSummary {
  primary_id: string;
  title_kr: string;
  ids: string[];
  sources: string[];
  days: string[];
  groups: number;
}

/**
 * 1단계: 전재 묶기(news-rank 의 rankStories, 데일리·홈과 같은 함수)를 기간 전체에 적용 (정치 기사 제외).
 * 2단계: groupPeriodStories (같은 실체 + 같은 제품 토큰/제목 유사 + ±2일).
 * stories 정렬: 매체 수 → 점수 (LLM 후보 순서).
 */
export function crossSourceStories(arts: PeriodArticle[]): { stories: PeriodStory[]; events: PeriodEventSummary[] } {
  const kept = arts.filter((a) => !isPolitical(asCandidate(a)));
  const stories: PeriodStory[] = rankStories(kept).map((st) => {
    const members = [st.primary, ...st.siblings];
    return {
      ids: members.map((m) => m.id),
      primary_id: st.primary.id,
      title_kr: st.primary.title_kr,
      title_cn: st.primary.title_cn,
      summary_kr: st.primary.summary_kr,
      category: st.primary.category,
      sources: st.sources,
      days: [...new Set(members.map((m) => m.day))].sort(),
      score: st.score,
      entities: findEntities(`${st.primary.title_kr} ${st.primary.title_cn}`).map((e) => e.key),
    };
  });
  // rankStories 는 점수 순 — 매체 수를 앞에 둔다 (안정 정렬이라 같은 매체 수 안에서는 점수 순 유지)
  stories.sort((a, b) => b.sources.length - a.sources.length);
  const events = groupPeriodStories(stories).map((ev) => ({
    primary_id: ev.lead.primary_id,
    title_kr: ev.lead.title_kr,
    ids: ev.ids,
    sources: ev.sources,
    days: ev.days,
    groups: ev.members.length,
  }));
  return { stories, events };
}

// ───────────────────────── 기간 지표 묶음 (리포트 스냅숏)

export interface PeriodMetrics {
  metrics_version: string;
  kind: "weekly" | "monthly" | "custom";
  population: Population;
  period: { start: string; end: string; days: number };
  baseline: { start: string; end: string } | null;
  computed_at: string;
  data_quality: {
    incomplete_days: string[];
    expected_weekday_median: number;
    expected_weekend_median: number;
    baseline_since: string;
    baseline_until: string;
  };
  volume: {
    total: number;
    prev_total: number | null;
    display: string;
    display_prev: string | null;
    avg_per_complete_day: number;
    prev_avg_per_complete_day: number | null;
    daily: DailyPoint[];
    prev_daily: DailyPoint[];
    like_for_like: LikeForLike | null;
  };
  categories: GroupCompare[];
  sources: GroupCompare[];
  sentiment: { cur: SentimentShare[]; prev: SentimentShare[] | null; flat: boolean };
  entities: EntityMention[];
  terms: { top: TermMetric[]; rising: TermMetric[]; falling: TermMetric[] };
  china_vs_overseas: { cur: ChinaVsOverseas; prev: ChinaVsOverseas | null };
  money_table: MoneyRow[];
  stories: {
    group_count: number;
    multi_source_count: number;
    event_count: number;
    event_multi_source_count: number;
    /** 사건 단위 상위 (매체 2곳 이상 먼저) — 타임라인 */
    events_top: PeriodEventSummary[];
  };
  /** 지문: 일별 건수 + 기사 id·본문 지문 (같으면 같은 입력) */
  fingerprint: string;
}

export interface PeriodInputs {
  metrics: PeriodMetrics;
  /** LLM 후보용 1단계 묶음 (스냅숏에는 넣지 않는다) */
  stories: PeriodStory[];
  articles: PeriodArticle[];
}

/** 기사 본문 지문 (select.ts computeInputHash 와 같은 필드) */
export function articleFingerprint(a: Pick<PeriodArticle, "id" | "title_kr" | "title_cn" | "summary_kr" | "ai_insights_kr" | "category">): string {
  const fp = createHash("sha256")
    .update([a.title_kr, a.title_cn, a.summary_kr, a.ai_insights_kr, a.category].join("\u0001"))
    .digest("hex")
    .slice(0, 16);
  return `${a.id}:${fp}`;
}

export function periodFingerprint(daily: DayCount[], arts: PeriodArticle[], extra: string): string {
  return createHash("sha256")
    .update(JSON.stringify({ v: METRICS_VERSION, extra, daily: daily.map((d) => `${d.date}=${d.count}`), rows: arts.map(articleFingerprint).sort() }))
    .digest("hex");
}

/**
 * 기간 지표 계산 (결정적). prev 기간이 있으면 증감·같은 요일 비교를 붙인다.
 * 결손일 기준선은 COMPLETE_SINCE ~ 기간 끝의 같은 모집단 일별 건수.
 */
export async function computePeriodMetrics(
  q: Queryable,
  opts: { kind: PeriodMetrics["kind"]; start: string; end: string; prevStart?: string; prevEnd?: string; population: Population }
): Promise<PeriodInputs> {
  const { start, end, population } = opts;
  const cur: MetricOptions = { population, range: { start, end } };
  const prev: MetricOptions | null = opts.prevStart && opts.prevEnd ? { population, range: { start: opts.prevStart, end: opts.prevEnd } } : null;
  // 기준선: 수집 완전 구간 중 기간 끝에서 8주 이내 (W44 → 10-13 ~ 11-01)
  const eightWeeks = addDays(end, -55);
  const since = eightWeeks > COMPLETE_SINCE ? eightWeeks : COMPLETE_SINCE;

  // 순차 실행: q 가 단일 client(READ ONLY 트랜잭션 등)일 수 있어 한 연결에 쿼리를 겹쳐 보내지 않는다
  const arts = await loadPeriodArticles(q, cur);
  const prevArts = prev ? await loadPeriodArticles(q, prev) : null;
  const baseSeries = await countByDay(q, { population, range: { start: since, end } });
  const catCur = await countBy(q, "category", cur);
  const catPrev = prev ? await countBy(q, "category", prev) : null;
  const srcCur = await countBy(q, "source_name", cur);
  const srcPrev = prev ? await countBy(q, "source_name", prev) : null;
  const sentCur = await countBy(q, "sentiment", cur);
  const sentPrev = prev ? await countBy(q, "sentiment", prev) : null;
  const termCur = await termCounts(q, { ...cur, pinyin: true });
  const termPrev = prev ? await termCounts(q, { ...prev, pinyin: true }) : null;

  const baseline = baselineFrom(baseSeries, since, end);
  const curDays = fillDays(start, end, await countByDay(q, cur));
  const daily = detectMissingDays(curDays, baseline);
  const prevDaily = prev ? detectMissingDays(fillDays(opts.prevStart!, opts.prevEnd!, await countByDay(q, prev)), baseline) : [];
  const lfl = prev ? sameWeekdayComparison(daily, prevDaily) : null;
  const sentC = toSentimentShare(sentCur);
  const sentP = sentPrev ? toSentimentShare(sentPrev) : null;
  const { stories, events } = crossSourceStories(arts);
  const total = arts.length;
  const prevTotal = prevArts ? prevArts.length : null;

  const metrics: PeriodMetrics = {
    metrics_version: METRICS_VERSION,
    kind: opts.kind,
    population,
    period: { start, end, days: daily.length },
    baseline: prev ? { start: opts.prevStart!, end: opts.prevEnd! } : null,
    computed_at: new Date().toISOString(),
    data_quality: {
      incomplete_days: daily.filter((d) => d.incomplete).map((d) => d.day),
      expected_weekday_median: baseline.weekday_median,
      expected_weekend_median: baseline.weekend_median,
      baseline_since: baseline.since,
      baseline_until: baseline.until,
    },
    volume: {
      total,
      prev_total: prevTotal,
      display: countLabel(total),
      display_prev: prevTotal === null ? null : countLabel(prevTotal),
      avg_per_complete_day: avgPerCompleteDay(daily),
      prev_avg_per_complete_day: prev ? avgPerCompleteDay(prevDaily) : null,
      daily,
      prev_daily: prevDaily,
      like_for_like: lfl,
    },
    categories: compareGroups(catCur, catPrev),
    sources: compareGroups(srcCur, srcPrev),
    sentiment: { cur: sentC, prev: sentP, flat: sentimentFlat(sentC, sentP) },
    entities: entityMentions(arts, prevArts),
    terms: termMovement(termCur, termPrev),
    china_vs_overseas: { cur: chinaVsOverseas(arts), prev: prevArts ? chinaVsOverseas(prevArts) : null },
    money_table: moneyTable(arts),
    stories: {
      group_count: stories.length,
      multi_source_count: stories.filter((s) => s.sources.length >= 2).length,
      event_count: events.length,
      event_multi_source_count: events.filter((e) => e.sources.length >= 2).length,
      events_top: events.slice(0, 30),
    },
    fingerprint: periodFingerprint(
      [...curDays, ...(prev ? prevDaily.map((d) => ({ date: d.day, count: d.count })) : [])],
      [...arts, ...(prevArts ?? [])],
      `${population}|${start}|${end}|${opts.prevStart ?? ""}|${opts.prevEnd ?? ""}`
    ),
  };
  return { metrics, stories, articles: arts };
}

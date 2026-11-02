/**
 * 주간·월간 리포트 읽기 — 공개 페이지(/briefing/weekly[/2026-W44], /briefing/monthly[/2026-10])와 관리자 미리보기가
 * 같은 함수를 쓴다 (Gate 2). 주간·월간은 edition_type 과 기간 키 해석만 다르다.
 *
 *  - 공개: status='published' 인 판만. 차트는 판이 가리키는 period_metrics 스냅숏(metrics_id)으로만 그린다
 *    (수집 보충 뒤에도 문장과 그림이 일치).
 *  - 인용 기사는 데일리와 같은 loadBriefingRefs(PUBLIC_NEWS_WHERE 조인)로 붙이고, 근거가 모두 사라진 항목은 뺀다.
 */
import pool from "@/lib/db";
import { PUBLIC_NEWS_WHERE } from "@/lib/news-query";
import { isoWeekOf, isoWeekRange, monthRange, type PeriodMetrics } from "@/lib/metrics/period";
import { loadBriefingRefs, type BriefingArticleRef } from "../public";
import type { BriefingLocale } from "../types";
import type { PeriodicKind, StoredPeriodicContent } from "./types";

export interface WeeklyDailyCell {
  date: string;
  /** 그날 데일리 브리핑이 (요청 언어 또는 ko 로) 발행됐는가 */
  published: boolean;
}

/** 월간 레일: 달 안의 주와 그 주 주간 리포트 발행 여부 */
export interface MonthlyWeekCell {
  key: string;
  iso_week: string;
  start: string;
  end: string;
  published: boolean;
}

export interface PublicPeriodic {
  id: string;
  edition_type: PeriodicKind;
  /** 기간 키: 주간 2026-W44, 월간 2026-10 */
  period_key: string;
  /** 주간 키 (예전 이름 — 월간이면 빈 문자열) */
  iso_week: string;
  period_start: string;
  period_end: string;
  locale: BriefingLocale;
  version: number;
  status: string;
  published_at: string;
  needs_review: boolean;
  available_locales: BriefingLocale[];
  content: StoredPeriodicContent;
  articles: Record<string, BriefingArticleRef>;
  metrics: PeriodMetrics;
  metrics_computed_at: string;
  dailies: WeeklyDailyCell[];
  /** 월간: 주별 주간 리포트 (주간이면 빈 배열) */
  weeklies: MonthlyWeekCell[];
  /** 스냅숏(돈 표·여러 매체 이야기)의 기사 중 지금도 공개인 것 — 숨긴 기사 행은 화면에서 뺀다 */
  snapshot_visible_ids: string[];
}
/** 예전 이름 (주간 MVP) */
export type PublicWeekly = PublicPeriodic;

interface RawRow {
  id: string;
  edition_type: PeriodicKind;
  edition_date: string;
  period_start: string;
  period_end: string;
  locale: BriefingLocale;
  version: number;
  status: string;
  published_at: string | null;
  needs_review: boolean;
  content: StoredPeriodicContent;
  article_ids: string[];
  metrics: PeriodMetrics | null;
  metrics_computed_at: string | null;
}

const COLUMNS = `b.id, b.edition_type, to_char(b.edition_date, 'YYYY-MM-DD') AS edition_date,
  to_char(COALESCE(b.period_start, b.edition_date), 'YYYY-MM-DD') AS period_start,
  to_char(COALESCE(b.period_end, b.edition_date + 6), 'YYYY-MM-DD') AS period_end,
  b.locale, b.version, b.status, b.published_at, b.needs_review, b.content, b.article_ids,
  m.metrics, to_char(m.computed_at AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI') AS metrics_computed_at`;
const FROM = `daily_briefings b LEFT JOIN period_metrics m ON m.id = b.metrics_id`;

/** 기간 키 → 시작일 (edition_date). 형식이 틀리면 undefined */
export function periodStartOf(kind: PeriodicKind, key: string): string | undefined {
  return kind === "weekly" ? isoWeekRange(key)?.start : monthRange(key)?.start;
}

/** 저장 행의 기간 키 (meta.period_key → 예전 판의 iso_week → 날짜에서 계산) */
export function periodKeyOf(kind: PeriodicKind, content: Partial<StoredPeriodicContent> | null | undefined, editionDate: string): string {
  const meta = content?.meta;
  if (meta?.period_key) return meta.period_key;
  if (kind === "weekly") return meta?.iso_week ?? isoWeekOf(editionDate);
  return meta?.month ?? editionDate.slice(0, 7);
}

/** 보이는 기사만 남긴다. 근거 기사가 모두 사라진 항목은 빼고, 지표로 선 큰 흐름·주별 흐름은 남긴다 (순수 함수) */
export function pruneWeeklyToVisible(content: StoredPeriodicContent, visible: Set<string>): StoredPeriodicContent {
  const keep = (refs: string[]) => (refs ?? []).filter((r) => visible.has(r));
  const c: StoredPeriodicContent = structuredClone(content);
  c.dek_refs = keep(c.dek_refs);
  c.big_picture = (c.big_picture ?? []).map((b) => ({ ...b, refs: keep(b.refs) })).filter((b) => b.refs.length > 0 || (b.metrics ?? []).length > 0);
  c.movers = (c.movers ?? []).map((b) => ({ ...b, refs: keep(b.refs) })).filter((b) => b.refs.length > 0);
  c.money = c.money && keep(c.money.refs).length ? { ...c.money, refs: keep(c.money.refs) } : null;
  c.china_lens = c.china_lens && keep(c.china_lens.refs).length ? { ...c.china_lens, refs: keep(c.china_lens.refs) } : null;
  c.watch_next = (c.watch_next ?? []).map((w) => ({ ...w, refs: keep(w.refs) })).filter((w) => w.refs.length > 0);
  c.month_arc = (c.month_arc ?? []).map((b) => ({ ...b, refs: keep(b.refs) })).filter((b) => b.refs.length > 0 || (b.metrics ?? []).length > 0);
  return c;
}

async function hydrate(row: RawRow, viewerLocale: BriefingLocale): Promise<PublicPeriodic | null> {
  if (!row.metrics || !row.content || !Array.isArray(row.content.big_picture)) return null;
  const kind = row.edition_type;
  const snapshotIds = [
    ...row.metrics.money_table.map((r) => r.id),
    ...row.metrics.stories.events_top.map((e) => e.primary_id),
  ];
  const [{ articles, available_locales }, { rows: days }, { rows: vis }, { rows: wk }] = await Promise.all([
    loadBriefingRefs(row),
    pool.query(
      `SELECT DISTINCT to_char(edition_date, 'YYYY-MM-DD') AS d FROM daily_briefings
        WHERE edition_type = 'daily' AND status = 'published' AND locale IN ($1, 'ko')
          AND edition_date BETWEEN $2::date AND $3::date`,
      [viewerLocale, row.period_start, row.period_end]
    ),
    pool.query(`SELECT id FROM ai_news_ex WHERE id = ANY($1::uuid[]) AND ${PUBLIC_NEWS_WHERE}`, [snapshotIds]),
    kind === "monthly"
      ? pool.query(
          `SELECT DISTINCT to_char(edition_date, 'YYYY-MM-DD') AS d FROM daily_briefings
            WHERE edition_type = 'weekly' AND status = 'published' AND locale IN ($1, 'ko')
              AND edition_date BETWEEN ($2::date - 6) AND $3::date`,
          [viewerLocale, row.period_start, row.period_end]
        )
      : Promise.resolve({ rows: [] as { d: string }[] }),
  ]);
  const published = new Set((days as { d: string }[]).map((d) => d.d));
  const weeklyStarts = new Set((wk as { d: string }[]).map((d) => d.d));
  // 기사를 숨기면 그 링크와 그것만 근거로 둔 항목은 빠지지만, 지표·차트는 스냅숏 그대로 둔다
  const visible = new Set(Object.keys(articles));
  const key = periodKeyOf(kind, row.content, row.edition_date);
  return {
    id: row.id,
    edition_type: kind,
    period_key: key,
    iso_week: kind === "weekly" ? key : "",
    period_start: row.period_start,
    period_end: row.period_end,
    locale: row.locale,
    version: row.version,
    status: row.status,
    published_at: row.published_at ?? "",
    needs_review: row.needs_review,
    available_locales,
    content: pruneWeeklyToVisible({ ...row.content, month_arc: row.content.month_arc ?? [] }, visible),
    articles,
    metrics: row.metrics,
    metrics_computed_at: row.metrics_computed_at ?? "",
    dailies: row.metrics.volume.daily.map((d) => ({ date: d.day, published: published.has(d.day) })),
    weeklies: (row.metrics.weeks ?? []).map((w) => ({
      key: w.key,
      iso_week: w.iso_week,
      start: w.start,
      end: w.end,
      published: weeklyStarts.has(isoWeekRange(w.iso_week)?.start ?? ""),
    })),
    snapshot_visible_ids: (vis as { id: string }[]).map((v) => v.id),
  };
}

/** 최신 발행본(key 없음) 또는 그 기간 발행본 */
export async function getPublishedPeriodic(kind: PeriodicKind, locale: BriefingLocale, key?: string): Promise<PublicPeriodic | null> {
  const start = key ? periodStartOf(kind, key) : undefined;
  if (key && !start) return null;
  const { rows } = await pool.query(
    `SELECT ${COLUMNS} FROM ${FROM}
      WHERE b.status = 'published' AND b.edition_type = $3 AND b.locale = $1 AND ($2::date IS NULL OR b.edition_date = $2::date)
      ORDER BY b.edition_date DESC LIMIT 1`,
    [locale, start ?? null, kind]
  );
  const row = rows[0] as RawRow | undefined;
  return row ? hydrate(row, locale) : null;
}

/** 관리자 미리보기: 상태와 관계없이 id 로 (공개 페이지와 같은 hydrate) */
export async function getPeriodicForReview(id: string): Promise<PublicPeriodic | null> {
  const { rows } = await pool.query(`SELECT ${COLUMNS} FROM ${FROM} WHERE b.id = $1::uuid AND b.edition_type IN ('weekly', 'monthly')`, [id]);
  const row = rows[0] as RawRow | undefined;
  return row ? hydrate(row, row.locale) : null;
}

/** 그 기간(없으면 가장 최근 기간)에 발행된 언어판 — 요청 언어판이 없을 때 안내용 */
export async function getPublishedPeriodicLocales(kind: PeriodicKind, key?: string): Promise<{ key: string; start: string; locales: BriefingLocale[] } | null> {
  const start = key ? periodStartOf(kind, key) : undefined;
  if (key && !start) return null;
  const { rows } = await pool.query(
    `SELECT to_char(edition_date, 'YYYY-MM-DD') AS d, array_agg(locale ORDER BY locale) AS locales, (array_agg(content))[1] AS content
       FROM daily_briefings
      WHERE status = 'published' AND edition_type = $2 AND ($1::date IS NULL OR edition_date = $1::date)
      GROUP BY edition_date ORDER BY edition_date DESC LIMIT 1`,
    [start ?? null, kind]
  );
  return rows[0] ? { key: periodKeyOf(kind, rows[0].content, rows[0].d), start: rows[0].d, locales: rows[0].locales } : null;
}

export interface PeriodicSummary {
  edition_type: PeriodicKind;
  /** 기간 키 */
  key: string;
  locale: BriefingLocale;
  published_at: string | null;
  headline: string;
  dek: string;
}

/** 발행된 주간·월간 판 목록(모든 언어, 최신순) — sitemap·브리핑 RSS 가 쓴다. 조건은 getPublishedPeriodic 과 같다 */
export async function listPublishedPeriodics(kind: PeriodicKind, limit = 1000): Promise<PeriodicSummary[]> {
  const { rows } = await pool.query(
    `SELECT to_char(edition_date, 'YYYY-MM-DD') AS d, locale, content->'meta' AS meta,
            COALESCE(content->>'headline', '') AS headline, COALESCE(content->>'dek', '') AS dek,
            to_char(published_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS published_at
       FROM daily_briefings
      WHERE status = 'published' AND edition_type = $2
      ORDER BY edition_date DESC, locale LIMIT $1`,
    [limit, kind]
  );
  return (rows as { d: string; locale: BriefingLocale; meta: StoredPeriodicContent["meta"] | null; headline: string; dek: string; published_at: string | null }[]).map(
    (r) => ({
      edition_type: kind,
      key: periodKeyOf(kind, r.meta ? { meta: r.meta } : null, r.d),
      locale: r.locale,
      published_at: r.published_at,
      headline: r.headline,
      dek: r.dek,
    })
  );
}

// ───────────────────────── 주간 이름 (예전 호출부 호환)

export const getPublishedWeekly = (locale: BriefingLocale, isoWeek?: string) => getPublishedPeriodic("weekly", locale, isoWeek);
export const getWeeklyForReview = getPeriodicForReview;

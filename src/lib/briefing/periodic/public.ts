/**
 * 주간 리포트 읽기 — 공개 페이지(/briefing/weekly[/2026-W44])와 관리자 미리보기가 같은 함수를 쓴다 (Gate 2).
 *
 *  - 공개: status='published' 인 판만. 차트는 판이 가리키는 period_metrics 스냅숏(metrics_id)으로만 그린다
 *    (수집 보충 뒤에도 문장과 그림이 일치).
 *  - 인용 기사는 데일리와 같은 loadBriefingRefs(PUBLIC_NEWS_WHERE 조인)로 붙이고, 근거가 모두 사라진 항목은 뺀다.
 */
import pool from "@/lib/db";
import { PUBLIC_NEWS_WHERE } from "@/lib/news-query";
import { isoWeekRange, type PeriodMetrics } from "@/lib/metrics/period";
import { loadBriefingRefs, type BriefingArticleRef } from "../public";
import type { BriefingLocale } from "../types";
import type { StoredWeeklyContent } from "./types";

export interface WeeklyDailyCell {
  date: string;
  /** 그날 데일리 브리핑이 (요청 언어 또는 ko 로) 발행됐는가 */
  published: boolean;
}

export interface PublicWeekly {
  id: string;
  iso_week: string;
  period_start: string;
  period_end: string;
  locale: BriefingLocale;
  version: number;
  status: string;
  published_at: string;
  needs_review: boolean;
  available_locales: BriefingLocale[];
  content: StoredWeeklyContent;
  articles: Record<string, BriefingArticleRef>;
  metrics: PeriodMetrics;
  metrics_computed_at: string;
  dailies: WeeklyDailyCell[];
  /** 스냅숏(돈 표·여러 매체 이야기)의 기사 중 지금도 공개인 것 — 숨긴 기사 행은 화면에서 뺀다 */
  snapshot_visible_ids: string[];
}

interface RawWeeklyRow {
  id: string;
  edition_type: "weekly";
  edition_date: string;
  period_start: string;
  period_end: string;
  locale: BriefingLocale;
  version: number;
  status: string;
  published_at: string | null;
  needs_review: boolean;
  content: StoredWeeklyContent;
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

/** 보이는 기사만 남긴다. 근거 기사가 모두 사라진 항목은 빼고, 지표로 선 큰 흐름은 남긴다 (순수 함수) */
export function pruneWeeklyToVisible(content: StoredWeeklyContent, visible: Set<string>): StoredWeeklyContent {
  const keep = (refs: string[]) => (refs ?? []).filter((r) => visible.has(r));
  const c: StoredWeeklyContent = structuredClone(content);
  c.dek_refs = keep(c.dek_refs);
  c.big_picture = (c.big_picture ?? []).map((b) => ({ ...b, refs: keep(b.refs) })).filter((b) => b.refs.length > 0 || (b.metrics ?? []).length > 0);
  c.movers = (c.movers ?? []).map((b) => ({ ...b, refs: keep(b.refs) })).filter((b) => b.refs.length > 0);
  c.money = c.money && keep(c.money.refs).length ? { ...c.money, refs: keep(c.money.refs) } : null;
  c.china_lens = c.china_lens && keep(c.china_lens.refs).length ? { ...c.china_lens, refs: keep(c.china_lens.refs) } : null;
  c.watch_next = (c.watch_next ?? []).map((w) => ({ ...w, refs: keep(w.refs) })).filter((w) => w.refs.length > 0);
  return c;
}

async function hydrateWeekly(row: RawWeeklyRow, viewerLocale: BriefingLocale): Promise<PublicWeekly | null> {
  if (!row.metrics || !row.content || !Array.isArray(row.content.big_picture)) return null;
  const snapshotIds = [
    ...row.metrics.money_table.map((r) => r.id),
    ...row.metrics.stories.events_top.map((e) => e.primary_id),
  ];
  const [{ articles, available_locales }, { rows: days }, { rows: vis }] = await Promise.all([
    loadBriefingRefs(row),
    pool.query(
      `SELECT DISTINCT to_char(edition_date, 'YYYY-MM-DD') AS d FROM daily_briefings
        WHERE edition_type = 'daily' AND status = 'published' AND locale IN ($1, 'ko')
          AND edition_date BETWEEN $2::date AND $3::date`,
      [viewerLocale, row.period_start, row.period_end]
    ),
    pool.query(`SELECT id FROM ai_news_ex WHERE id = ANY($1::uuid[]) AND ${PUBLIC_NEWS_WHERE}`, [snapshotIds]),
  ]);
  const published = new Set((days as { d: string }[]).map((d) => d.d));
  // 기사를 숨기면 그 링크와 그것만 근거로 둔 항목은 빠지지만, 지표·차트는 스냅숏 그대로 둔다
  const visible = new Set(Object.keys(articles));
  return {
    id: row.id,
    iso_week: row.content.meta?.iso_week ?? "",
    period_start: row.period_start,
    period_end: row.period_end,
    locale: row.locale,
    version: row.version,
    status: row.status,
    published_at: row.published_at ?? "",
    needs_review: row.needs_review,
    available_locales,
    content: pruneWeeklyToVisible(row.content, visible),
    articles,
    metrics: row.metrics,
    metrics_computed_at: row.metrics_computed_at ?? "",
    dailies: row.metrics.volume.daily.map((d) => ({ date: d.day, published: published.has(d.day) })),
    snapshot_visible_ids: (vis as { id: string }[]).map((v) => v.id),
  };
}

/** 최신 발행본(week 없음) 또는 그 주 발행본 */
export async function getPublishedWeekly(locale: BriefingLocale, isoWeek?: string): Promise<PublicWeekly | null> {
  const start = isoWeek ? isoWeekRange(isoWeek)?.start : undefined;
  if (isoWeek && !start) return null;
  const { rows } = await pool.query(
    `SELECT ${COLUMNS} FROM ${FROM}
      WHERE b.status = 'published' AND b.edition_type = 'weekly' AND b.locale = $1 AND ($2::date IS NULL OR b.edition_date = $2::date)
      ORDER BY b.edition_date DESC LIMIT 1`,
    [locale, start ?? null]
  );
  const row = rows[0] as RawWeeklyRow | undefined;
  return row ? hydrateWeekly(row, locale) : null;
}

/** 관리자 미리보기: 상태와 관계없이 id 로 (공개 페이지와 같은 hydrate) */
export async function getWeeklyForReview(id: string): Promise<PublicWeekly | null> {
  const { rows } = await pool.query(`SELECT ${COLUMNS} FROM ${FROM} WHERE b.id = $1::uuid AND b.edition_type = 'weekly'`, [id]);
  const row = rows[0] as RawWeeklyRow | undefined;
  return row ? hydrateWeekly(row, row.locale) : null;
}

/** 그 주(없으면 가장 최근 주)에 발행된 언어판 — 요청 언어판이 없을 때 안내용 */
export async function getPublishedWeeklyLocales(isoWeek?: string): Promise<{ week: string; start: string; locales: BriefingLocale[] } | null> {
  const start = isoWeek ? isoWeekRange(isoWeek)?.start : undefined;
  if (isoWeek && !start) return null;
  const { rows } = await pool.query(
    `SELECT to_char(edition_date, 'YYYY-MM-DD') AS d, MAX(content->'meta'->>'iso_week') AS week, array_agg(locale ORDER BY locale) AS locales
       FROM daily_briefings
      WHERE status = 'published' AND edition_type = 'weekly' AND ($1::date IS NULL OR edition_date = $1::date)
      GROUP BY edition_date ORDER BY edition_date DESC LIMIT 1`,
    [start ?? null]
  );
  return rows[0] ? { week: rows[0].week, start: rows[0].d, locales: rows[0].locales } : null;
}

export interface WeeklySummary {
  iso_week: string;
  locale: BriefingLocale;
  published_at: string | null;
  headline: string;
  dek: string;
}

/** 발행된 주간 판 목록(모든 언어, 최신순) — sitemap·브리핑 RSS 가 쓴다. 조건은 getPublishedWeekly 와 같다 */
export async function listPublishedWeeklies(limit = 1000): Promise<WeeklySummary[]> {
  const { rows } = await pool.query(
    `SELECT content->'meta'->>'iso_week' AS iso_week, locale,
            COALESCE(content->>'headline', '') AS headline, COALESCE(content->>'dek', '') AS dek,
            to_char(published_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS published_at
       FROM daily_briefings
      WHERE status = 'published' AND edition_type = 'weekly' AND content->'meta'->>'iso_week' IS NOT NULL
      ORDER BY edition_date DESC, locale LIMIT $1`,
    [limit]
  );
  return rows as WeeklySummary[];
}

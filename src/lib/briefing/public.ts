/**
 * 공개 읽기 — GET /api/briefing 과 (다음 단계의) 브리핑 페이지·홈 띠·헤더가 모두 이 함수를 쓴다 (Gate 2).
 *
 * 인용 기사는 ai_news_ex 를 PUBLIC_NEWS_WHERE 로 조인해 가져온다. 숨긴(is_hidden)·중복 기사는 여기서 빠지고,
 * 그 기사만 근거로 둔 항목도 함께 빠진다 (설계 검토서 §4 is_hidden 처리 1·3).
 */
import pool from "@/lib/db";
import { PUBLIC_NEWS_WHERE } from "@/lib/news-query";
import type { BriefingLocale, StoredBriefingContent } from "./types";
import { EDITION_TYPE, type EditionType } from "./repository";
import { briefingFixtureRows, type FixtureBriefingRow } from "./fixture";
import type { DayEditionRow } from "./day-select";

export interface BriefingArticleRef {
  id: string;
  title: string; // 요청 언어 제목 (없으면 ko → cn 순으로 대체)
  title_cn: string;
  source_name: string;
  source_url: string | null;
  news_date: string | null;
}

export interface PublicBriefing {
  id: string;
  edition_date: string;
  /** 판이 다루는 기간의 끝 (주말 합본 = 일요일, 그 밖은 edition_date) */
  period_end: string;
  locale: BriefingLocale;
  version: number;
  mode: string;
  published_at: string;
  needs_review: boolean;
  available_locales: BriefingLocale[]; // 같은 날짜에 발행된 언어판 (hreflang 용)
  content: StoredBriefingContent;
  articles: Record<string, BriefingArticleRef>;
}

/** 보이는 기사만 남기고, 근거가 모두 사라진 항목은 뺀다 (순수 함수) */
export function pruneToVisible(content: StoredBriefingContent, visible: Set<string>): StoredBriefingContent {
  const keep = (refs: string[]) => refs.filter((r) => visible.has(r));
  const c: StoredBriefingContent = structuredClone(content);
  c.lede_refs = keep(c.lede_refs ?? []);
  c.top_stories = (c.top_stories ?? [])
    .map((s) => {
      const refs = keep(s.refs);
      return { ...s, refs, primary_ref: refs.includes(s.primary_ref) ? s.primary_ref : refs[0] ?? "" };
    })
    .filter((s) => s.refs.length > 0)
    .map((s, i) => ({ ...s, rank: i + 1 }));
  c.sections = (c.sections ?? [])
    .map((sec) => ({ ...sec, items: sec.items.map((it) => ({ ...it, refs: keep(it.refs) })).filter((it) => it.refs.length > 0) }))
    .filter((sec) => sec.items.length > 0);
  c.key_numbers = (c.key_numbers ?? []).filter((k) => visible.has(k.ref));
  c.companies_to_watch = (c.companies_to_watch ?? []).map((co) => ({ ...co, refs: keep(co.refs) })).filter((co) => co.refs.length > 0);
  if (c.term_of_the_day && !visible.has(c.term_of_the_day.ref)) c.term_of_the_day = null;
  c.clusters = (c.clusters ?? []).map((cl) => ({ ...cl, ids: keep(cl.ids) })).filter((cl) => cl.ids.length > 1);
  c.excluded = []; // 내부용
  return c;
}

const TITLE_COL: Record<BriefingLocale, string> = { ko: "title_kr", en: "title_en", zh: "title_cn" };

interface RawBriefingRow {
  id: string;
  edition_type: EditionType;
  edition_date: string;
  period_end: string | null;
  locale: BriefingLocale;
  version: number;
  mode: string;
  published_at: string | null;
  needs_review: boolean;
  content: StoredBriefingContent;
  article_ids: string[];
}

const RAW_COLUMNS = `id, edition_type, to_char(edition_date, 'YYYY-MM-DD') AS edition_date,
  to_char(period_end, 'YYYY-MM-DD') AS period_end, locale, version, mode, published_at,
  needs_review, content, article_ids`;

// ───────────────────────── e2e 시험 데이터 이음매 (fixture.ts). 꺼져 있으면 아래 함수들은 모두 DB 를 읽는다.

/** 시험 데이터의 데일리 발행본 (조건에 맞는 것만) */
function fixturePublished(rows: FixtureBriefingRow[], where: (r: FixtureBriefingRow) => boolean = () => true) {
  return rows.filter((r) => r.edition_type === EDITION_TYPE && r.status === "published" && where(r));
}

const byDateDesc = (a: { edition_date: string }, b: { edition_date: string }) => b.edition_date.localeCompare(a.edition_date);

/**
 * 인용 기사(보이는 것만)와 같은 판의 발행 언어판. 데일리·주간·월간이 같은 함수로 기사를 붙인다 (Gate 2).
 */
export async function loadBriefingRefs(row: {
  article_ids: string[];
  locale: BriefingLocale;
  edition_type: EditionType;
  edition_date: string;
}): Promise<{ articles: Record<string, BriefingArticleRef>; available_locales: BriefingLocale[] }> {
  const titleCol = TITLE_COL[row.locale] ?? "title_kr";
  const fx = row.edition_type === EDITION_TYPE ? briefingFixtureRows() : null;
  const [{ rows: arts }, { rows: locs }] = await Promise.all([
    pool.query(
      `SELECT id, COALESCE(NULLIF(${titleCol}, ''), NULLIF(title_kr, ''), title_cn, '') AS title,
              COALESCE(title_cn, '') AS title_cn, source_name, source_url,
              to_char(news_date AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS news_date
         FROM ai_news_ex
        WHERE id = ANY($1::uuid[]) AND ${PUBLIC_NEWS_WHERE}`,
      [row.article_ids ?? []]
    ),
    fx
      ? Promise.resolve({
          rows: fixturePublished(fx, (r) => r.edition_date === row.edition_date)
            .map((r) => ({ locale: r.locale }))
            .sort((a, b) => a.locale.localeCompare(b.locale)),
        })
      : pool.query(
          `SELECT locale FROM daily_briefings
            WHERE status = 'published' AND edition_type = $1 AND edition_date = $2::date ORDER BY locale`,
          [row.edition_type, row.edition_date]
        ),
  ]);
  const articles: Record<string, BriefingArticleRef> = {};
  for (const a of arts) articles[a.id] = a as BriefingArticleRef;
  return { articles, available_locales: locs.map((l) => l.locale) };
}

/**
 * 행 → 화면용 판. 공개 페이지와 관리자 검토 화면이 같은 함수로 인용 기사를 붙이고 숨긴 기사를 걸러낸다 (Gate 2).
 * available_locales 는 같은 날짜에 발행된 언어판.
 */
async function hydrate(row: RawBriefingRow): Promise<PublicBriefing> {
  const { articles, available_locales } = await loadBriefingRefs(row);
  return {
    id: row.id,
    edition_date: row.edition_date,
    period_end: row.period_end ?? row.edition_date,
    locale: row.locale,
    version: row.version,
    mode: row.mode,
    published_at: row.published_at ?? "",
    needs_review: row.needs_review,
    available_locales,
    content: pruneToVisible(row.content as StoredBriefingContent, new Set(Object.keys(articles))),
    articles,
  };
}

/**
 * 최신 발행본(date 없음) 또는 그 날짜 발행본. 없으면 null.
 * 브리핑 페이지·홈 띠·GET /api/briefing 이 모두 이 함수를 쓴다 (Gate 2).
 */
export async function getPublishedBriefing(locale: BriefingLocale, date?: string): Promise<PublicBriefing | null> {
  const fx = briefingFixtureRows();
  if (fx) {
    const row = fixturePublished(fx, (r) => r.locale === locale && (!date || r.edition_date === date)).sort(byDateDesc)[0];
    return row ? hydrate(row) : null;
  }
  const { rows } = await pool.query(
    `SELECT ${RAW_COLUMNS}
       FROM daily_briefings
      WHERE status = 'published' AND edition_type = $1 AND locale = $2 AND ($3::date IS NULL OR edition_date = $3::date)
      ORDER BY edition_date DESC LIMIT 1`,
    [EDITION_TYPE, locale, date ?? null]
  );
  const row = rows[0] as RawBriefingRow | undefined;
  return row ? hydrate(row) : null;
}

/** 관리자 검토용: 상태와 관계없이 id 로 한 판 (발행 화면과 같은 hydrate) */
export async function getBriefingForReview(id: string): Promise<PublicBriefing | null> {
  const { rows } = await pool.query(`SELECT ${RAW_COLUMNS} FROM daily_briefings WHERE id = $1::uuid AND edition_type = $2`, [
    id,
    EDITION_TYPE,
  ]);
  const row = rows[0] as RawBriefingRow | undefined;
  if (!row || !row.content || !(row.content as Partial<StoredBriefingContent>).top_stories) return null;
  return hydrate(row);
}

/**
 * 그 날짜(없으면 가장 최근 날짜)에 발행된 언어판 목록. 요청한 언어판이 없을 때 안내용.
 * date 없이 부르면 { date, locales } 의 date 는 어느 언어든 가장 최근 발행 날짜.
 */
export async function getPublishedLocales(date?: string): Promise<{ date: string; locales: BriefingLocale[] } | null> {
  const fx = briefingFixtureRows();
  if (fx) {
    const pub = fixturePublished(fx, (r) => !date || r.edition_date === date).sort(byDateDesc);
    if (!pub.length) return null;
    const d = pub[0].edition_date;
    return { date: d, locales: pub.filter((r) => r.edition_date === d).map((r) => r.locale).sort() };
  }
  const { rows } = await pool.query(
    `SELECT to_char(edition_date, 'YYYY-MM-DD') AS d, array_agg(locale ORDER BY locale) AS locales
       FROM daily_briefings
      WHERE status = 'published' AND edition_type = $1 AND ($2::date IS NULL OR edition_date = $2::date)
      GROUP BY edition_date ORDER BY edition_date DESC LIMIT 1`,
    [EDITION_TYPE, date ?? null]
  );
  return rows[0] ? { date: rows[0].d, locales: rows[0].locales } : null;
}

export interface EditionSummary {
  edition_date: string;
  headline: string;
  lede: string;
  top_count: number;
}

/** 아카이브: 그 언어로 발행된 판 목록 (최신순) */
export async function listPublishedEditions(locale: BriefingLocale, limit = 120): Promise<EditionSummary[]> {
  const fx = briefingFixtureRows();
  if (fx) {
    return fixturePublished(fx, (r) => r.locale === locale)
      .sort(byDateDesc)
      .slice(0, limit)
      .map((r) => ({
        edition_date: r.edition_date,
        headline: r.content.headline,
        lede: r.content.lede,
        top_count: r.content.top_stories?.length ?? 0,
      }));
  }
  const { rows } = await pool.query(
    `SELECT to_char(edition_date, 'YYYY-MM-DD') AS edition_date, content->>'headline' AS headline,
            content->>'lede' AS lede, COALESCE(jsonb_array_length(content->'top_stories'), 0) AS top_count
       FROM daily_briefings
      WHERE status = 'published' AND edition_type = $1 AND locale = $2
      ORDER BY edition_date DESC LIMIT $3`,
    [EDITION_TYPE, locale, limit]
  );
  return rows as EditionSummary[];
}

/** 이전·다음 발행판 날짜 (같은 언어) */
export async function getAdjacentEditions(locale: BriefingLocale, date: string): Promise<{ prev: string | null; next: string | null }> {
  const fx = briefingFixtureRows();
  if (fx) {
    const dates = fixturePublished(fx, (r) => r.locale === locale).map((r) => r.edition_date).sort();
    return { prev: dates.filter((d) => d < date).pop() ?? null, next: dates.find((d) => d > date) ?? null };
  }
  const { rows } = await pool.query(
    `SELECT
       (SELECT to_char(MAX(edition_date), 'YYYY-MM-DD') FROM daily_briefings
         WHERE status = 'published' AND edition_type = $1 AND locale = $2 AND edition_date < $3::date) AS prev,
       (SELECT to_char(MIN(edition_date), 'YYYY-MM-DD') FROM daily_briefings
         WHERE status = 'published' AND edition_type = $1 AND locale = $2 AND edition_date > $3::date) AS next`,
    [EDITION_TYPE, locale, date]
  );
  return { prev: rows[0]?.prev ?? null, next: rows[0]?.next ?? null };
}

/**
 * 날짜 목록(홈) 한 페이지의 기간 [from, to] 과 겹치는 데일리 발행본 — 모든 언어판.
 * 어느 판을 쓸지(같은 날짜 우선·주말 합본·언어 우선순위)는 day-select.ts 의 순수 함수가 고른다.
 */
export async function loadDayEditionRows(from: string, to: string): Promise<DayEditionRow[]> {
  const fx = briefingFixtureRows();
  if (fx) {
    return fixturePublished(fx, (r) => r.period_start <= to && r.period_end >= from).map((r) => ({
      edition_date: r.edition_date,
      period_start: r.period_start,
      period_end: r.period_end,
      locale: r.locale,
      status: r.status,
      headline: r.content.headline ?? "",
      top_stories: r.content.top_stories ?? [],
    }));
  }
  const { rows } = await pool.query(
    `SELECT to_char(edition_date, 'YYYY-MM-DD') AS edition_date,
            to_char(COALESCE(period_start, edition_date), 'YYYY-MM-DD') AS period_start,
            to_char(COALESCE(period_end, edition_date), 'YYYY-MM-DD') AS period_end,
            locale, status, COALESCE(content->>'headline', '') AS headline, content->'top_stories' AS top_stories
       FROM daily_briefings
      WHERE status = 'published' AND edition_type = $1
        AND COALESCE(period_start, edition_date) <= $3::date AND COALESCE(period_end, edition_date) >= $2::date`,
    [EDITION_TYPE, from, to]
  );
  return rows as DayEditionRow[];
}

/**
 * 그 날짜·언어의 데일리 판이 지금은 발행 중이 아니고 철회된 적이 있는가.
 * 홈에서 링크를 연 사이에 판이 철회되면 팝업이 404 대신 정정 안내를 보여 준다.
 */
export async function isEditionWithdrawn(locale: BriefingLocale, date: string): Promise<boolean> {
  const fx = briefingFixtureRows();
  if (fx) {
    const same = fx.filter((r) => r.edition_type === EDITION_TYPE && r.locale === locale && r.edition_date === date);
    return same.some((r) => r.status === "withdrawn") && !same.some((r) => r.status === "published");
  }
  const { rows } = await pool.query(
    `SELECT bool_or(status = 'withdrawn') AND NOT bool_or(status = 'published') AS withdrawn
       FROM daily_briefings
      WHERE edition_type = $1 AND locale = $2 AND edition_date = $3::date`,
    [EDITION_TYPE, locale, date]
  );
  return Boolean(rows[0]?.withdrawn);
}

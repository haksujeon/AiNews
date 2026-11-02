/**
 * 데일리 브리핑 발행 일정·SLA — 생성 스케줄(n8n), 생성 라우트의 기본 날짜, 관리자 SLA 띠, 상태 API(알림),
 * 홈 배너의 날짜 칩이 모두 이 파일의 규칙 하나를 쓴다 (Gate 2).
 *
 * 일정 (KST 기준, 판 날짜는 베이징 날짜) — 2026-11-02 사용자 결정: 하루가 끝난 자정 뒤에 생성
 *  - 평일판 D(월~금): D+1 00:10 KST(= 베이징 D 23:10) 생성, 00:40 KST 재시도 → D+1 09:00 KST 까지 ko 발행.
 *    마지막 수집이 23:00 KST 에 시작해 길면 40분 걸리므로 자정 정각 대신 10분 여유를 둔다.
 *    재시도까지 베이징 날짜가 D 로 남아(01:00 KST 에 넘어감) 옛 코드(베이징 오늘 기준)와도 같은 판을 가리킨다.
 *  - 주말 합본(결정 D7): 판 날짜 = 토요일, 기간 = 토~일 (edition_date = period_start, 주간판과 같은 규칙).
 *    월요일 00:10 KST 에 생성하고 월요일 09:00 KST 까지 발행한다.
 *  - 일요일 00:10 실행(토요일 하루가 끝난 때)은 생성하지 않는다(다음 날 합본에 들어감). 일요일 날짜로 따로 만든 판은 없다.
 *  - 실행일(run day) = 생성 호출 시각에서 RUN_LAG(3시간)를 뺀 KST 날짜 = 방금 끝난 날. 00:10·00:40·수동 02:00 모두 전날.
 *  - 금요일판 마감은 토요일 09:00 KST (규칙 그대로. 주말 검토를 없애려면 여기서 바꾼다).
 *
 * 알림: 09:30 KST 상태 확인에서 마감이 지났는데 ko 발행본이 없으면 1회 (마감 뒤 24시간 안에서만 notify).
 *
 * 순수 함수(날짜 계산·판정)는 DB 없이 단위 테스트한다. DB 를 읽는 것은 briefingSlaStatus 하나.
 */
import pool from "@/lib/db";
import { EDITION_TYPE } from "./repository";
import { beijingDate } from "@/lib/metrics/period";

const DAY_MS = 86_400_000;
const KST_OFFSET_MS = 9 * 3_600_000;
/** 생성 시각: 실행일 다음 날 00:10 KST (분) */
export const GENERATE_MINUTE_KST = 10;
/** 정기 실행이 가리키는 실행일 = (지금 − RUN_LAG) 의 KST 날짜. 00:10 생성·00:40 재시도·새벽 수동 실행이 모두 전날 */
export const RUN_LAG_MS = 3 * 3_600_000;
/** 발행 마감 09:00 KST (분) */
export const DUE_MINUTE_KST = 9 * 60;
/** 발행률을 보는 기간 (일) */
export const RATE_WINDOW_DAYS = 14;
/** 마감 뒤 알림을 보내는 시간 범위 — 09:30 하루 1회 확인이면 판마다 1회 */
const NOTIFY_WINDOW_MS = DAY_MS;

// ───────────────────────── 날짜 도우미 (YYYY-MM-DD, UTC 자정 기준 계산)

const toDay = (d: string) => Date.parse(`${d}T00:00:00Z`);
const fromMs = (ms: number) => new Date(ms).toISOString().slice(0, 10);
export const addDays = (d: string, n: number) => fromMs(toDay(d) + n * DAY_MS);
/** 0=일 … 6=토 */
export const weekday = (d: string) => new Date(toDay(d)).getUTCDay();

/** KST 날짜 YYYY-MM-DD 와 그날 0시부터의 분 */
export function kstClock(now: Date): { date: string; minute: number } {
  const k = new Date(now.getTime() + KST_OFFSET_MS);
  return { date: k.toISOString().slice(0, 10), minute: k.getUTCHours() * 60 + k.getUTCMinutes() };
}

/** 그 KST 날짜의 hh:mm (분) 시각 */
function kstAt(date: string, minute: number): Date {
  return new Date(toDay(date) + minute * 60_000 - KST_OFFSET_MS);
}

/** 베이징 날짜 — generate.ts beijingToday·주간·월간과 같은 함수 */
export { beijingDate };

// ───────────────────────── 판 규칙

export interface EditionPeriod {
  editionDate: string;
  periodStart: string;
  periodEnd: string;
  weekend: boolean;
}

/**
 * 판 날짜 → 다루는 기사 기간. 토요일 = 토·일 합본, 그 밖은 하루.
 * (일요일 날짜를 직접 넣으면 하루짜리 — 옛 판·관리자 강제 재생성용)
 */
export function editionPeriod(editionDate: string): EditionPeriod {
  const weekend = weekday(editionDate) === 6;
  return { editionDate, periodStart: editionDate, periodEnd: weekend ? addDays(editionDate, 1) : editionDate, weekend };
}

/** 그 실행일(그날이 끝난 뒤 자정 실행)이 만드는 판. 토요일은 null(일요일이 끝난 뒤 합본 생성), 일요일은 토요일 합본 */
export function scheduledEditionFor(runDate: string): string | null {
  const wd = weekday(runDate);
  if (wd === 6) return null;
  if (wd === 0) return addDays(runDate, -1);
  return runDate;
}

/** 판의 실행일 (그날이 끝난 뒤 자정에 생성한다). 토요일 판 = 일요일 */
export function generationDayOf(editionDate: string): string {
  return weekday(editionDate) === 6 ? addDays(editionDate, 1) : editionDate;
}

/** 정기 생성 시각: 실행일 다음 날 00:10 KST */
export function generateAtOf(editionDate: string): Date {
  return kstAt(addDays(generationDayOf(editionDate), 1), GENERATE_MINUTE_KST);
}

/** 발행 마감: 생성일 다음 날 09:00 KST */
export function dueAtOf(editionDate: string): Date {
  return kstAt(addDays(generationDayOf(editionDate), 1), DUE_MINUTE_KST);
}

/** 바로 앞 정기 판 (월 → 토 합본, 토 → 금, 그 밖 → 전날. 일요일 날짜는 판이 아니므로 토로) */
export function previousEdition(editionDate: string): string {
  const wd = weekday(editionDate);
  if (wd === 1) return addDays(editionDate, -2);
  return scheduledEditionFor(addDays(editionDate, -1)) ?? addDays(editionDate, -2);
}

/** 지금 시각 기준 "현재 판": 정기 생성 시각이 지난 가장 최근 판 (마감 전이면 검토 중인 판) */
export function currentEdition(now: Date): string {
  const { date, minute } = kstClock(now);
  // 가장 최근 정기 실행(00:10 KST)이 가리킨 실행일 = 그 실행 날짜의 전날
  const runDay = addDays(minute >= GENERATE_MINUTE_KST ? date : addDays(date, -1), -1);
  return scheduledEditionFor(runDay) ?? addDays(runDay, -1);
}

/** 마감이 지난 가장 최근 판 — 독자가 지금쯤 볼 수 있어야 하는 판 */
export function lastDueEdition(now: Date): string {
  const cur = currentEdition(now);
  return now.getTime() >= dueAtOf(cur).getTime() ? cur : previousEdition(cur);
}

/** 정기 실행의 실행일: (지금 − 3시간)의 KST 날짜 = 방금 끝난 날 */
export function runDayOf(now: Date): string {
  return kstClock(new Date(now.getTime() - RUN_LAG_MS)).date;
}

/** n8n 정기 실행(날짜를 주지 않은 생성 호출)이 만들 판. 토요일이 끝난 직후(일요일 00:10)면 null */
export function scheduledRunEdition(now: Date): string | null {
  return scheduledEditionFor(runDayOf(now));
}

/**
 * 홈 배너 판정 (순수 함수). 발행본이 없으면 숨김, 있으면 보이고,
 * 마감이 지난 최근 판보다 오래된 발행본이면 날짜 칩을 단다.
 */
export function bannerState(latestPublishedDate: string | null, now: Date): { show: false } | { show: true; dated: boolean } {
  if (!latestPublishedDate) return { show: false };
  return { show: true, dated: latestPublishedDate < lastDueEdition(now) };
}

// ───────────────────────── 상태 판정

/** 판 하나의 ko 행 요약 (DB 에서 읽은 것) */
export interface EditionFacts {
  edition_date: string;
  /** 최신 ko 버전의 상태 */
  latest_status: string | null;
  /** 지금 발행 중인 ko 행이 있는가 */
  published_now: boolean;
  /** 한 번이라도 발행된 적이 있는가 (철회·교체 포함) — 첫 발행 시각 */
  first_published_at: string | null;
  /** 생성된 본문이 있는 ko 행이 있는가 (draft·published·superseded·withdrawn) */
  has_content: boolean;
}

export interface SlaRate {
  /** 분모: 마감이 지난 정기 판 수 (최근 14일, 토·일은 합본 1판). 물량 부족으로 생략(skipped)된 판은 뺀다 */
  eligible: number;
  /** 한 번이라도 ko 가 발행된 판 (철회·교체 포함) */
  published: number;
  /** 마감 안에 발행된 판 */
  onTime: number;
  /** published / eligible (분모 0 이면 null) */
  rate: number | null;
}

export interface BriefingSlaStatus {
  now: string;
  editionDate: string;
  periodStart: string;
  periodEnd: string;
  weekend: boolean;
  generateAt: string;
  dueAt: string;
  /** 사람이 읽는 마감 (KST) */
  dueAtKst: string;
  generated: boolean;
  koStatus: string | null;
  published: boolean;
  overdue: boolean;
  /** 알림을 보낼 때인가 (overdue 이고 마감 뒤 24시간 안) */
  notify: boolean;
  lastPublished: { editionDate: string; publishedAt: string | null } | null;
  rate14d: SlaRate;
}

function fmtKst(d: Date): string {
  const k = new Date(d.getTime() + KST_OFFSET_MS).toISOString();
  return `${k.slice(0, 10)} ${k.slice(11, 16)} KST`;
}

/** 최근 14일 안의 마감 지난 정기 판 날짜 (최신순) */
export function dueEditionsInWindow(now: Date, days = RATE_WINDOW_DAYS): string[] {
  const from = addDays(kstClock(now).date, -days);
  const out: string[] = [];
  for (let e = lastDueEdition(now); e > from; e = previousEdition(e)) out.push(e);
  return out;
}

/** 순수 판정: DB 에서 읽은 사실 → 상태 */
export function evaluateSla(
  now: Date,
  facts: EditionFacts[],
  lastPublished: { editionDate: string; publishedAt: string | null } | null
): BriefingSlaStatus {
  const byDate = new Map(facts.map((f) => [f.edition_date, f]));
  const editionDate = currentEdition(now);
  const period = editionPeriod(editionDate);
  const dueAt = dueAtOf(editionDate);
  const cur = byDate.get(editionDate);
  const published = Boolean(cur?.published_now);
  const skipped = cur?.latest_status === "skipped" && !cur.has_content;
  const overdue = !published && !skipped && now.getTime() >= dueAt.getTime();
  const notify = overdue && now.getTime() - dueAt.getTime() < NOTIFY_WINDOW_MS;

  let eligible = 0;
  let pub = 0;
  let onTime = 0;
  for (const d of dueEditionsInWindow(now)) {
    const f = byDate.get(d);
    if (f?.latest_status === "skipped" && !f.has_content && !f.first_published_at) continue;
    eligible++;
    if (f?.first_published_at) {
      pub++;
      if (Date.parse(f.first_published_at) <= dueAtOf(d).getTime()) onTime++;
    }
  }

  return {
    now: now.toISOString(),
    editionDate,
    periodStart: period.periodStart,
    periodEnd: period.periodEnd,
    weekend: period.weekend,
    generateAt: generateAtOf(editionDate).toISOString(),
    dueAt: dueAt.toISOString(),
    dueAtKst: fmtKst(dueAt),
    generated: Boolean(cur?.has_content),
    koStatus: cur?.latest_status ?? null,
    published,
    overdue,
    notify,
    lastPublished,
    rate14d: { eligible, published: pub, onTime, rate: eligible ? pub / eligible : null },
  };
}

// ───────────────────────── DB

/**
 * 지금 시각의 발행 SLA 상태. 관리자 SLA 띠와 GET /api/internal/briefing/status 가 이 함수 하나를 쓴다 (Gate 2).
 */
export async function briefingSlaStatus(now: Date = new Date()): Promise<BriefingSlaStatus> {
  const from = addDays(kstClock(now).date, -(RATE_WINDOW_DAYS + 2));
  const [{ rows }, { rows: last }] = await Promise.all([
    pool.query(
      `SELECT to_char(edition_date, 'YYYY-MM-DD') AS edition_date,
              (array_agg(status ORDER BY version DESC))[1] AS latest_status,
              bool_or(status = 'published') AS published_now,
              min(published_at) AS first_published_at,
              bool_or(status IN ('draft', 'published', 'superseded', 'withdrawn')) AS has_content
         FROM daily_briefings
        WHERE edition_type = $1 AND locale = 'ko' AND edition_date >= $2::date
        GROUP BY edition_date`,
      [EDITION_TYPE, from]
    ),
    pool.query(
      `SELECT to_char(edition_date, 'YYYY-MM-DD') AS edition_date, published_at
         FROM daily_briefings
        WHERE edition_type = $1 AND locale = 'ko' AND status = 'published'
        ORDER BY edition_date DESC LIMIT 1`,
      [EDITION_TYPE]
    ),
  ]);
  const facts: EditionFacts[] = rows.map((r) => ({
    edition_date: r.edition_date,
    latest_status: r.latest_status ?? null,
    published_now: Boolean(r.published_now),
    first_published_at: r.first_published_at ? new Date(r.first_published_at).toISOString() : null,
    has_content: Boolean(r.has_content),
  }));
  const lp = last[0]
    ? { editionDate: last[0].edition_date as string, publishedAt: last[0].published_at ? new Date(last[0].published_at).toISOString() : null }
    : null;
  return evaluateSla(now, facts, lp);
}

/**
 * 주간·월간 기간 키 해석 (순수 — DB 를 import 하지 않는다, 단위 테스트 대상).
 * CLI(scripts/briefing-generate.ts)·내부 API(n8n 일정)·관리자 "다시 생성"이 모두 이 함수로 기간을 정한다 (Gate 2).
 *
 * 기간은 베이징 날짜 기준이다 (news_date = 베이징 날짜). 그래서 정기 실행은 베이징 자정(= 01:00 KST) 이후여야 한다:
 *  - 주간: 월요일 01:30 KST(베이징 월 00:30) → 직전 월~일. 01:00 KST 전(예: 00:30)에 부르면 베이징은 아직 일요일이라
 *          "지난주" 가 지지난주가 된다 (scheduledPeriod 시험이 이것을 못박는다).
 *  - 월간: 1일 02:00 KST(베이징 1일 01:00) → 직전 달.
 *  - 순서: 데일리 00:10 → 데일리 재시도 00:40 → 주간 01:30 → 월간 02:00 (겹치지 않게).
 */
import { addDays, beijingDate, isoWeekOf, isoWeekRange, monthOf, monthRange, prevMonth } from "@/lib/metrics/period";
import type { PeriodicKind } from "./types";

export interface ResolvedPeriod {
  kind: PeriodicKind;
  /** 주간 "2026-W44", 월간 "2026-10" */
  key: string;
  start: string;
  end: string;
}

/** 주 지정 해석: 형식·미래·진행 중인 주를 거른다 (끝 날짜가 베이징 오늘 이후면 아직 끝나지 않은 주) */
export function resolveWeek(opts: { isoWeek?: string; start?: string }, today = beijingDate()): { week: string; start: string; end: string } | { error: string } {
  let week = opts.isoWeek;
  if (!week && opts.start) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(opts.start)) return { error: "start 형식이 틀렸습니다 (YYYY-MM-DD)" };
    week = isoWeekOf(opts.start);
    if (isoWeekRange(week)?.start !== opts.start) return { error: "start 는 월요일이어야 합니다" };
  }
  if (!week) week = isoWeekOf(addDays(today, -7));
  const range = isoWeekRange(week);
  if (!range) return { error: `주 형식이 틀렸습니다: ${week} (예: 2026-W44)` };
  if (range.end >= today) return { error: `${week} 는 아직 끝나지 않은 주입니다 (끝 ${range.end}, 베이징 오늘 ${today})` };
  return { week, ...range };
}

/** 월 지정 해석: "2026-10" 또는 그 달 1일(start). 없으면 베이징 기준 지난달. 끝나지 않은 달은 거른다 */
export function resolveMonth(opts: { month?: string; start?: string }, today = beijingDate()): { month: string; start: string; end: string } | { error: string } {
  let month = opts.month;
  if (!month && opts.start) {
    if (!/^\d{4}-\d{2}-01$/.test(opts.start)) return { error: "start 는 그 달 1일이어야 합니다 (YYYY-MM-01)" };
    month = opts.start.slice(0, 7);
  }
  if (!month) month = prevMonth(monthOf(today));
  const range = monthRange(month);
  if (!range) return { error: `월 형식이 틀렸습니다: ${month} (예: 2026-10)` };
  if (range.end >= today) return { error: `${month} 는 아직 끝나지 않은 달입니다 (끝 ${range.end}, 베이징 오늘 ${today})` };
  return { month, ...range };
}

export function resolvePeriod(
  kind: PeriodicKind,
  opts: { key?: string; start?: string },
  today = beijingDate()
): ResolvedPeriod | { error: string } {
  if (kind === "weekly") {
    const r = resolveWeek({ isoWeek: opts.key, start: opts.start }, today);
    return "error" in r ? r : { kind, key: r.week, start: r.start, end: r.end };
  }
  const r = resolveMonth({ month: opts.key, start: opts.start }, today);
  return "error" in r ? r : { kind, key: r.month, start: r.start, end: r.end };
}

/** 정기 실행 시각(now)에 기간 키 없이 부르면 만들어질 기간 — n8n 일정 검증용 */
export function scheduledPeriod(kind: PeriodicKind, now: Date): ResolvedPeriod | { error: string } {
  return resolvePeriod(kind, {}, beijingDate(now));
}

/** 비교 기간: 직전 같은 길이 기간. 주간 = 지난주, 월간 = 지난달 */
export function previousPeriod(p: ResolvedPeriod): { start: string; end: string } {
  if (p.kind === "weekly") return { start: addDays(p.start, -7), end: addDays(p.start, -1) };
  const r = monthRange(prevMonth(p.key))!;
  return r;
}

// ───────────────────────── 내부 API body (POST /api/internal/briefing/generate)

export type GenerateRequest =
  | { editionType: "daily"; date?: string; force: boolean; dryRun: boolean }
  | { editionType: "weekly"; isoWeek?: string; force: boolean; dryRun: boolean }
  | { editionType: "monthly"; month?: string; force: boolean; dryRun: boolean };

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const WEEK_RE = /^\d{4}-W\d{2}$/;
const MONTH_RE = /^\d{4}-\d{2}$/;

/**
 * body 검사. editionType 기본 'daily' (기존 n8n 데일리 호출은 그대로).
 * isoWeek 는 weekly 에만, month 는 monthly 에만, date 는 daily 에만 쓸 수 있다 — 섞이면 400.
 * 기간이 끝났는지(미래·진행 중)는 resolvePeriod 가 본다 (생성 함수 안).
 */
export function parseGenerateBody(body: unknown): GenerateRequest | { error: string } {
  const b = (body && typeof body === "object" && !Array.isArray(body) ? body : {}) as Record<string, unknown>;
  const editionType = b.editionType ?? b.edition_type ?? "daily";
  if (editionType !== "daily" && editionType !== "weekly" && editionType !== "monthly") return { error: "editionType must be daily, weekly or monthly" };
  for (const k of ["force", "dryRun"] as const) if (b[k] !== undefined && typeof b[k] !== "boolean") return { error: `${k} must be boolean` };
  const force = b.force === true;
  const dryRun = b.dryRun === true;
  const str = (k: string) => (typeof b[k] === "string" && b[k] ? (b[k] as string) : undefined);
  for (const k of ["date", "isoWeek", "month"]) if (b[k] !== undefined && b[k] !== null && b[k] !== "" && typeof b[k] !== "string") return { error: `${k} must be a string` };
  const date = str("date");
  const isoWeek = str("isoWeek");
  const month = str("month");
  const allowed: Record<string, string> = { daily: "date", weekly: "isoWeek", monthly: "month" };
  for (const [k, v] of Object.entries({ date, isoWeek, month })) {
    if (v !== undefined && allowed[editionType] !== k) return { error: `${k} is only valid for editionType ${Object.keys(allowed).find((t) => allowed[t] === k)}` };
  }
  if (editionType === "daily") {
    if (date !== undefined && !DATE_RE.test(date)) return { error: "date must be YYYY-MM-DD" };
    return { editionType, date, force, dryRun };
  }
  if (editionType === "weekly") {
    if (isoWeek !== undefined && !WEEK_RE.test(isoWeek)) return { error: "isoWeek must be YYYY-Www (e.g. 2026-W44)" };
    return { editionType, isoWeek, force, dryRun };
  }
  if (month !== undefined && !MONTH_RE.test(month)) return { error: "month must be YYYY-MM (e.g. 2026-10)" };
  return { editionType, month, force, dryRun };
}

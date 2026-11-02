/**
 * 월간 기간 계산·정기 일정·내부 API body 검사·축소 수집일 판정 단위 테스트 (DB 없음) — 실행: npm run test:unit
 * 2026-11-02 은 월요일, 2026-11-01 은 일요일.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  COMPLETE_SINCE,
  baselineFrom,
  beijingDate,
  detectMissingDays,
  fillDays,
  monthRange,
  monthWeekSlices,
  monthWeeks,
  prevMonth,
  type PeriodArticle,
} from "../../src/lib/metrics/period";
import { parseGenerateBody, previousPeriod, resolveMonth, resolvePeriod, resolveWeek, scheduledPeriod } from "../../src/lib/briefing/periodic/period-key";
import { buildFacts, compactDays, dataQualityLine, fallbackDek } from "../../src/lib/briefing/periodic/prompt";
import { normalizeWeekly, validateWeekly, dropFatalPeriodic, type PeriodicValidationContext } from "../../src/lib/briefing/periodic/validate";
import type { PeriodMetrics } from "../../src/lib/metrics/period";

const kst = (s: string) => new Date(`${s}+09:00`);

// ───────────────────────── 월 경계

test("monthRange: 달 끝(30·31·윤년 2월·12월), 잘못된 형식은 null", () => {
  assert.deepEqual(monthRange("2026-10"), { start: "2026-10-01", end: "2026-10-31" });
  assert.deepEqual(monthRange("2026-11"), { start: "2026-11-01", end: "2026-11-30" });
  assert.deepEqual(monthRange("2026-12"), { start: "2026-12-01", end: "2026-12-31" });
  assert.deepEqual(monthRange("2028-02"), { start: "2028-02-01", end: "2028-02-29" });
  assert.deepEqual(monthRange("2027-02"), { start: "2027-02-01", end: "2027-02-28" });
  for (const bad of ["2026-13", "2026-00", "2026-1", "202610", "2026-10-01"]) assert.equal(monthRange(bad), null, bad);
  assert.equal(prevMonth("2027-01"), "2026-12");
  assert.equal(prevMonth("2026-10"), "2026-09");
});

test("monthWeekSlices: 2026-10 = W40(10-01~04) … W44(10-26~31), 달 안으로 자른다", () => {
  const s = monthWeekSlices("2026-10-01", "2026-10-31");
  assert.deepEqual(
    s.map((w) => `${w.key}:${w.start}~${w.end}`),
    ["W40:2026-10-01~2026-10-04", "W41:2026-10-05~2026-10-11", "W42:2026-10-12~2026-10-18", "W43:2026-10-19~2026-10-25", "W44:2026-10-26~2026-10-31"]
  );
  assert.equal(s[4].iso_week, "2026-W44");
  // 2027-01: 1일이 금요일 → 첫 조각은 2026-W53 (ISO 연도 경계)
  const j = monthWeekSlices("2027-01-01", "2027-01-31");
  assert.equal(j[0].iso_week, "2026-W53");
  assert.equal(j[0].start, "2027-01-01");
});

test("베이징 날짜: 01:00 KST 에 넘어간다", () => {
  assert.equal(beijingDate(kst("2026-11-02T00:59:00")), "2026-11-01");
  assert.equal(beijingDate(kst("2026-11-02T01:00:00")), "2026-11-02");
});

test("resolveMonth: 끝나지 않은 달·형식 오류는 거르고, 기본값은 베이징 기준 지난달", () => {
  assert.deepEqual(resolveMonth({}, "2026-11-01"), { month: "2026-10", start: "2026-10-01", end: "2026-10-31" });
  assert.deepEqual(resolveMonth({ month: "2026-10" }, "2026-11-01"), { month: "2026-10", start: "2026-10-01", end: "2026-10-31" });
  assert.ok("error" in resolveMonth({ month: "2026-11" }, "2026-11-02"), "진행 중인 달");
  assert.ok("error" in resolveMonth({ month: "2026-10" }, "2026-10-31"), "마지막 날 당일은 아직 안 끝남");
  assert.ok("error" in resolveMonth({ month: "2026-13" }, "2026-11-02"));
  assert.ok("error" in resolveMonth({ start: "2026-10-02" }, "2026-11-02"), "start 는 1일");
  assert.deepEqual(resolveMonth({ start: "2026-10-01" }, "2026-11-02"), { month: "2026-10", start: "2026-10-01", end: "2026-10-31" });
});

test("비교 기간: 주간 = 지난주, 월간 = 지난달 (12월 → 11월, 1월 → 전년 12월)", () => {
  const w = resolvePeriod("weekly", { key: "2026-W44" }, "2026-11-02");
  assert.ok(!("error" in w));
  if (!("error" in w)) assert.deepEqual(previousPeriod(w), { start: "2026-10-19", end: "2026-10-25" });
  const m = resolvePeriod("monthly", { key: "2027-01" }, "2027-02-01");
  if (!("error" in m)) assert.deepEqual(previousPeriod(m), { start: "2026-12-01", end: "2026-12-31" });
});

// ───────────────────────── 정기 일정

test("정기 주간: 월요일 01:30 KST(베이징 00:30) → 직전 월~일 (2026-W44)", () => {
  const r = scheduledPeriod("weekly", kst("2026-11-02T01:30:00"));
  assert.deepEqual(r, { kind: "weekly", key: "2026-W44", start: "2026-10-26", end: "2026-11-01" });
  // 01:00 KST 정각부터 맞다
  assert.equal((scheduledPeriod("weekly", kst("2026-11-02T01:00:00")) as { key: string }).key, "2026-W44");
});

test("정기 주간을 01:00 KST 전(00:30)에 부르면 베이징은 아직 일요일 → 지지난주(W43)가 된다 (그래서 일정은 01:30)", () => {
  const r = scheduledPeriod("weekly", kst("2026-11-02T00:30:00"));
  assert.equal((r as { key: string }).key, "2026-W43");
  // 그 주(W44)를 직접 지정해도 아직 끝나지 않은 주
  assert.ok("error" in resolveWeek({ isoWeek: "2026-W44" }, beijingDate(kst("2026-11-02T00:30:00"))));
});

test("정기 월간: 1일 02:00 KST → 직전 달, 2027-01-01 → 2026-12", () => {
  assert.deepEqual(scheduledPeriod("monthly", kst("2026-11-01T02:00:00")), { kind: "monthly", key: "2026-10", start: "2026-10-01", end: "2026-10-31" });
  assert.deepEqual(scheduledPeriod("monthly", kst("2027-01-01T02:00:00")), { kind: "monthly", key: "2026-12", start: "2026-12-01", end: "2026-12-31" });
  // 1일 00:30 KST 는 베이징 말일 23:30 → 그 달이 아직 안 끝나 지지난달
  assert.equal((scheduledPeriod("monthly", kst("2026-11-01T00:30:00")) as { key: string }).key, "2026-09");
});

// ───────────────────────── 내부 API body

test("parseGenerateBody: 기본 daily, 유형별 기간 키만 허용, 형식 오류는 error", () => {
  assert.deepEqual(parseGenerateBody({}), { editionType: "daily", date: undefined, force: false, dryRun: false });
  assert.deepEqual(parseGenerateBody(null), { editionType: "daily", date: undefined, force: false, dryRun: false });
  assert.deepEqual(parseGenerateBody({ date: "2026-10-30", force: true }), { editionType: "daily", date: "2026-10-30", force: true, dryRun: false });
  assert.deepEqual(parseGenerateBody({ editionType: "weekly" }), { editionType: "weekly", isoWeek: undefined, force: false, dryRun: false });
  assert.deepEqual(parseGenerateBody({ editionType: "weekly", isoWeek: "2026-W44", dryRun: true }), { editionType: "weekly", isoWeek: "2026-W44", force: false, dryRun: true });
  assert.deepEqual(parseGenerateBody({ editionType: "monthly", month: "2026-10" }), { editionType: "monthly", month: "2026-10", force: false, dryRun: false });
  const err = (b: unknown) => "error" in parseGenerateBody(b);
  assert.ok(err({ editionType: "yearly" }));
  assert.ok(err({ editionType: "weekly", month: "2026-10" }), "월 키를 주간에");
  assert.ok(err({ editionType: "monthly", isoWeek: "2026-W44" }), "주 키를 월간에");
  assert.ok(err({ editionType: "weekly", date: "2026-10-26" }), "date 는 daily 만");
  assert.ok(err({ month: "2026-10" }), "기본 daily 에 month");
  assert.ok(err({ editionType: "weekly", isoWeek: "2026-44" }));
  assert.ok(err({ editionType: "monthly", month: "2026-1" }));
  assert.ok(err({ date: "2026/10/30" }));
  assert.ok(err({ force: "yes" }));
  assert.ok(err({ editionType: "monthly", month: 202610 }));
});

// ───────────────────────── 축소 수집일 · 월간 주별

const days = (pairs: [string, number][]) => pairs.map(([date, count]) => ({ date, count }));

test("축소 수집일: COMPLETE_SINCE 이전은 건수와 관계없이 결손(reduced), 이후는 중앙값 50% 미만만 부분 수집(partial)", () => {
  assert.equal(COMPLETE_SINCE, "2026-10-13");
  const series = days([
    ["2026-10-11", 23], // 일요일, 주말 중앙값 43 의 50% 를 넘지만 축소 수집
    ["2026-10-12", 22],
    ["2026-10-13", 121], ["2026-10-14", 106], ["2026-10-15", 102], ["2026-10-16", 113], ["2026-10-17", 43], ["2026-10-18", 33],
    ["2026-10-31", 16],
  ]);
  const base = baselineFrom(series, COMPLETE_SINCE, "2026-10-31");
  const pts = detectMissingDays(series, base);
  const by = new Map(pts.map((p) => [p.day, p]));
  assert.equal(by.get("2026-10-11")!.reduced, true);
  assert.equal(by.get("2026-10-11")!.incomplete, true);
  assert.equal(by.get("2026-10-12")!.reduced, true);
  assert.equal(by.get("2026-10-13")!.incomplete, false);
  assert.equal(by.get("2026-10-31")!.partial, true);
  assert.equal(by.get("2026-10-31")!.reduced, false);
  assert.equal(compactDays(["2026-10-01", "2026-10-02", "2026-10-03", "2026-10-31"]), "2026-10-01~2026-10-03, 2026-10-31");
});

test("monthWeeks: 평일 평균은 완전한 평일만, 1천 건당 언급, 축소 수집 주 표시", () => {
  const series = fillDays(
    "2026-10-05",
    "2026-10-18",
    days([
      ["2026-10-05", 11], ["2026-10-06", 12], ["2026-10-07", 16], ["2026-10-08", 25], ["2026-10-09", 29], ["2026-10-10", 21], ["2026-10-11", 23],
      ["2026-10-12", 22], ["2026-10-13", 121], ["2026-10-14", 106], ["2026-10-15", 102], ["2026-10-16", 113], ["2026-10-17", 43], ["2026-10-18", 33],
    ])
  );
  const pts = detectMissingDays(series, baselineFrom(series, COMPLETE_SINCE, "2026-10-18"));
  const art = (id: string, day: string, title: string) =>
    ({ id, day, title_kr: title, title_cn: "", summary_kr: "", source_name: "36Kr", category: "ai-biz", sentiment: "neutral", ai_insights_kr: "", key_terms: [] }) as unknown as PeriodArticle;
  const arts = [art("a", "2026-10-06", "딥시크 신모델"), art("b", "2026-10-14", "딥시크 투자"), art("c", "2026-10-15", "오픈AI 발표"), art("d", "2026-10-16", "기타")];
  const w = monthWeeks(pts, arts, ["deepseek"]);
  assert.deepEqual(w.map((x) => x.key), ["W41", "W42"]);
  assert.equal(w[0].coverage, "reduced");
  assert.equal(w[0].weekday_avg, null, "W41 은 완전한 평일이 없다");
  assert.equal(w[0].complete_days, 0);
  assert.equal(w[1].coverage, "reduced", "W42 는 10-12 하루가 축소 수집");
  assert.equal(w[1].weekday_avg, Math.round((121 + 106 + 102 + 113) / 4));
  assert.equal(w[1].entities.deepseek, 1);
  assert.equal(w[1].entities_per_1k.deepseek, Math.round((1 / 3) * 1000));
  assert.equal(w[0].entities_per_1k.deepseek, 1000);
});

// ───────────────────────── 지표 사전 · 데이터 알림 줄 · month_arc 검증

function fakeMonthly(): PeriodMetrics {
  const daily = [
    { day: "2026-10-12", count: 22, weekend: false, expected: 104, incomplete: true, reduced: true, partial: false },
    { day: "2026-10-13", count: 121, weekend: false, expected: 104, incomplete: false, reduced: false, partial: false },
    { day: "2026-10-31", count: 16, weekend: true, expected: 43, incomplete: true, reduced: false, partial: true },
  ];
  return {
    metrics_version: "t",
    kind: "monthly",
    population: "ai",
    period: { start: "2026-10-01", end: "2026-10-31", days: 31 },
    baseline: null,
    computed_at: "",
    data_quality: { incomplete_days: ["2026-10-12", "2026-10-31"], reduced_days: ["2026-10-12"], partial_days: ["2026-10-31"], expected_weekday_median: 104, expected_weekend_median: 43, baseline_since: "", baseline_until: "" },
    volume: { total: 159, prev_total: null, display: "159건", display_prev: null, avg_per_complete_day: 121, prev_avg_per_complete_day: null, daily, prev_daily: [], like_for_like: null },
    categories: [],
    sources: [],
    sentiment: { cur: [], prev: null, flat: false },
    entities: [{ key: "deepseek", name_ko: "딥시크", chinese: true, cur: 3, prev: 0, title_mentions: 3, sources: 1, active_days: 2, change_pct: null, display: "3건", display_change: "—", sample_ids: [] }],
    terms: { top: [], rising: [], falling: [] },
    china_vs_overseas: { cur: { total: 0, china_only: 0, foreign_only: 0, both: 0, neither: 0, china_pct: 0, foreign_pct: 0 }, prev: null },
    money_table: [],
    stories: { group_count: 0, multi_source_count: 0, event_count: 0, event_multi_source_count: 0, events_top: [] },
    weeks: [
      { key: "W42", iso_week: "2026-W42", start: "2026-10-12", end: "2026-10-18", days: 7, complete_days: 6, total: 540, weekday_avg: 111, avg_per_complete_day: 86, coverage: "reduced", reduced_days: ["2026-10-12"], partial_days: [], entities: { deepseek: 2 }, entities_per_1k: { deepseek: 4 } },
      { key: "W41", iso_week: "2026-W41", start: "2026-10-05", end: "2026-10-11", days: 7, complete_days: 0, total: 137, weekday_avg: null, avg_per_complete_day: null, coverage: "reduced", reduced_days: [], partial_days: [], entities: { deepseek: 1 }, entities_per_1k: { deepseek: 7 } },
    ],
    fingerprint: "x",
  };
}

test("buildFacts(월간): 지난달 키 없음, 평일 평균은 완전한 평일이 있는 주만, 1천 건당 키, 축소 수집 표시", () => {
  const F = buildFacts(fakeMonthly());
  assert.equal(F["week.W42.weekday_avg"], "W42 평일 하루 평균 111건");
  assert.equal(F["week.W41.weekday_avg"], undefined);
  assert.equal(F["week.W41.total"], "W41 137건 (축소 수집)");
  assert.equal(F["week.W42.ent.deepseek.per1k"], "딥시크 W42 1천 건당 4건");
  assert.ok(!Object.keys(F).some((k) => k.endsWith(".prev") || k.endsWith(".chg")), "비교 기간이 없으면 증감 키 없음");
  assert.ok(!Object.values(F).some((x) => x.includes("지난주")), "월간 지표에 '지난주' 낱말이 새지 않는다");
  assert.equal(F["vol.lfl_change"], undefined);
  assert.match(F["dq.reduced_days"], /2026-10-12 \(1일, 보충 수집 상한\)/);
  const line = dataQualityLine(fakeMonthly());
  assert.match(line, /축소 수집\(보충 수집, 매체별 하루 상한 36Kr ≤12건, ITHome ≤6건\)/);
  assert.match(line, /2026-10-31 부분 수집/);
  assert.match(line, /추세를 추론하지 말 것/);
});

test("month_arc: 정규화·검증 대상이고, 없는 주 키는 치명(unknown_week), 원 건수 비교는 치명, 치명 항목은 뺀다", () => {
  const m = fakeMonthly();
  const ctx: PeriodicValidationContext = {
    kind: "monthly",
    sourceText: new Map([["S01", "딥시크 신모델 공개"]]),
    facts: buildFacts(m),
    entityNames: new Map([["deepseek", "딥시크"]]),
    terms: new Set(),
    headlineMax: 36,
    weekKeys: new Set(["W41", "W42"]),
  };
  const raw = {
    headline: "10월 중국 AI",
    dek: "딥시크 신모델이 화제였다.",
    dek_refs: ["S01"],
    big_picture: [],
    month_arc: [
      { week: "W42", text: "W42 평일 하루 평균 111건, 딥시크 신모델이 나왔다.", refs: ["S01"], metrics: ["week.W42.weekday_avg"] },
      { week: "W99", text: "딥시크 신모델.", refs: ["S01"], metrics: [] },
      { week: "W41", text: "주별 기사 수 137→540건으로 늘었다.", refs: ["S01"], metrics: ["week.W41.total", "week.W42.total"] },
    ],
  };
  const { content, issues } = normalizeWeekly(raw);
  assert.equal(content.month_arc.length, 3);
  const r = validateWeekly(content, ctx, issues);
  const at = (p: string) => r.fatal.filter((f) => f.path === p).map((f) => f.rule);
  assert.deepEqual(at("month_arc[0]"), []);
  assert.ok(at("month_arc[1]").includes("unknown_week"));
  assert.ok(at("month_arc[2]").includes("volume_week_unadjusted"));
  const d = dropFatalPeriodic(content, r.fatal);
  assert.deepEqual(d.content.month_arc.map((a) => a.week), ["W42"]);
});

test("결정적 대체 dek: 축소 수집일을 밝히고, 그 문장도 검증을 통과한다", () => {
  const m = fakeMonthly();
  const fb = fallbackDek(m);
  assert.match(fb.text, /축소 수집일 1일이 섞여 있어 기사 수로 흐름을 비교하지 않았다/);
  const ctx: PeriodicValidationContext = {
    kind: "monthly",
    sourceText: new Map(),
    facts: buildFacts(m),
    entityNames: new Map([["deepseek", "딥시크"]]),
    terms: new Set(),
    headlineMax: 36,
  };
  const { content } = normalizeWeekly({ headline: "10월 중국 AI", dek: fb.text, dek_metrics: fb.metrics, big_picture: [] });
  const r = validateWeekly(content, ctx);
  assert.deepEqual(r.fatal.filter((f) => f.path === "dek"), []);
});

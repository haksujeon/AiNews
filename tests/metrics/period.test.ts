/**
 * 기간 지표 순수 함수 단위 테스트 (DB 없음) — 실행: npm run test:unit
 * W44 수치(2026-10-19 ~ 11-01 AI 공개 기사 일별 건수)는 2026-11-02 개발 DB 실측값.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  AMOUNT_RE,
  amountRole,
  baselineFrom,
  changePct,
  chinaVsOverseas,
  dealKind,
  detectMissingDays,
  fillDays,
  isoWeekOf,
  isoWeekRange,
  moneyTable,
  sameWeekdayComparison,
  signedPct,
  termMovement,
  type PeriodArticle,
} from "../../src/lib/metrics/period";
import { groupPeriodStories, productTokens, sameEvent, type PeriodStoryInput } from "../../src/lib/briefing/select";

const W44_DAYS: [string, number][] = [
  ["2026-10-13", 121], ["2026-10-14", 106], ["2026-10-15", 102], ["2026-10-16", 113], ["2026-10-17", 43], ["2026-10-18", 33],
  ["2026-10-19", 104], ["2026-10-20", 97], ["2026-10-21", 87], ["2026-10-22", 99], ["2026-10-23", 94], ["2026-10-24", 47], ["2026-10-25", 40],
  ["2026-10-26", 109], ["2026-10-27", 115], ["2026-10-28", 92], ["2026-10-29", 114], ["2026-10-30", 84], ["2026-10-31", 2], ["2026-11-01", 46],
];
const series = W44_DAYS.map(([date, count]) => ({ date, count }));

test("ISO 주: 2026-W44 = 10-26(월) ~ 11-01(일), 왕복 변환, 잘못된 주는 null", () => {
  assert.deepEqual(isoWeekRange("2026-W44"), { start: "2026-10-26", end: "2026-11-01" });
  assert.equal(isoWeekOf("2026-10-26"), "2026-W44");
  assert.equal(isoWeekOf("2026-11-01"), "2026-W44");
  assert.equal(isoWeekOf("2026-01-01"), "2026-W01"); // 2026-01-01 은 목요일
  assert.equal(isoWeekOf("2027-01-01"), "2026-W53"); // 2026 은 53주가 있는 해
  assert.equal(isoWeekRange("2027-W53"), null);
  assert.equal(isoWeekRange("2026-44"), null);
  assert.equal(isoWeekRange("2026-W00"), null);
});

test("결손일: 같은 요일군 위쪽 중앙값(평일 104, 주말 43)의 50% 미만 → 10-31 만", () => {
  const base = baselineFrom(series, "2026-10-13", "2026-11-01");
  assert.equal(base.weekday_median, 104);
  assert.equal(base.weekend_median, 43);
  const cur = detectMissingDays(fillDays("2026-10-26", "2026-11-01", series), base);
  assert.deepEqual(cur.filter((d) => d.incomplete).map((d) => d.day), ["2026-10-31"]);
  assert.equal(cur.find((d) => d.day === "2026-10-31")!.expected, 43);
  // 기준선 밖(수집이 완전해지기 전) 날짜는 중앙값에 넣지 않는다
  assert.equal(baselineFrom([{ date: "2026-10-01", count: 1 }, ...series], "2026-10-13", "2026-11-01").weekend_median, 43);
});

test("같은 요일 비교: 원 건수 562 대 568(-1%) 이지만 결손 토요일을 양쪽에서 빼면 560 대 521(+7%)", () => {
  const base = baselineFrom(series, "2026-10-13", "2026-11-01");
  const cur = detectMissingDays(fillDays("2026-10-26", "2026-11-01", series), base);
  const prev = detectMissingDays(fillDays("2026-10-19", "2026-10-25", series), base);
  assert.equal(cur.reduce((s, d) => s + d.count, 0), 562);
  assert.equal(prev.reduce((s, d) => s + d.count, 0), 568);
  const lfl = sameWeekdayComparison(cur, prev);
  assert.equal(lfl.cur, 560);
  assert.equal(lfl.prev, 521);
  assert.equal(lfl.days, 6);
  assert.deepEqual(lfl.excluded_days, ["2026-10-31"]);
  assert.equal(lfl.display_change, "+7%");
  // 지난주 쪽 결손도 양쪽에서 뺀다
  const prevGap = prev.map((d, i) => (i === 0 ? { ...d, incomplete: true } : d));
  assert.equal(sameWeekdayComparison(cur, prevGap).days, 5);
});

test("최소 건수: 어느 쪽이든 5건 미만이면 증감 % 없음", () => {
  assert.equal(changePct(101, 89), 13);
  assert.equal(changePct(7, 4), null);
  assert.equal(changePct(4, 7), null);
  assert.equal(changePct(5, 5), 0);
  assert.equal(signedPct(null), "—");
  assert.equal(signedPct(-71), "-71%");
});

test("용어 증감: 이번 주 4건 이상이고 +3 이상만 '뜨는 용어', 지난주 4건 이상에서 -3 이상만 '식는 용어'", () => {
  const cur = [
    { term: "具身智能", count: 73, pinyin: "jùshēn zhìnéng", pinyin_variants: 3 },
    { term: "算力", count: 54 },
    { term: "智能体", count: 52 },
    { term: "招股书", count: 3 },
  ];
  const prev = [
    { term: "具身智能", count: 59 },
    { term: "算力", count: 38 },
    { term: "智能体", count: 84 },
    { term: "招股书", count: 0 },
    { term: "入口", count: 3 },
  ];
  const m = termMovement(cur, prev);
  assert.deepEqual(m.rising.map((t) => t.term), ["算力", "具身智能"]);
  assert.deepEqual(m.falling.map((t) => `${t.term}${t.prev}→${t.cur}`), ["智能体84→52"]);
  assert.equal(m.top[0].pinyin, "jùshēn zhìnéng");
});

const art = (over: Partial<PeriodArticle>): PeriodArticle => ({
  id: over.id ?? "00000000-0000-0000-0000-000000000000",
  day: "2026-10-28",
  source_name: "36Kr",
  category: "ai-biz",
  sentiment: "neutral",
  title_cn: "",
  title_kr: "",
  summary_kr: "",
  ai_insights_kr: "",
  key_terms: [],
  ...over,
});

test("금액 정규식: '5억 8700만 달러', '1조 2000억 위안' 을 한 덩어리로", () => {
  assert.deepEqual("시리즈 B 5억 8700만 달러 투자 유치".match(AMOUNT_RE), ["5억 8700만 달러"]);
  assert.deepEqual("1조 2000억 위안 규모 펀드".match(AMOUNT_RE), ["1조 2000억 위안"]);
  assert.deepEqual("1,000억 달러 규모 자금 조달 추진".match(AMOUNT_RE), ["1,000억 달러"]);
  assert.deepEqual("400억 달러 부채".match(AMOUNT_RE), ["400억 달러"]);
});

test("돈 흐름 표: 매출·기업가치·베팅 금액은 거래가 아니라 뺀다 (W44 실제 제목)", () => {
  assert.equal(amountRole("Anthropic, 상반기 매출 163억 달러 돌파", "163억 달러"), "value");
  assert.equal(amountRole("기업가치 3000억 달러로 평가", "3000억 달러"), "value");
  assert.equal(amountRole("역대 최대 IPO, 역대 최대 차용증: Anthropic의 2조 달러 베팅", "2조 달러"), "value");
  assert.equal(amountRole("머스크, SpaceX GPU 구매 위해 400억 달러 부채 조달 완료 확인", "400억 달러"), "deal");
  assert.equal(dealKind("머스크, SpaceX GPU 구매 위해 400억 달러 부채 조달 완료 확인"), "부채 조달");
  assert.equal(dealKind("10억 달러 A라운드 투자 유치, Flapping Airplanes"), "투자 유치");

  const rows = moneyTable([
    art({ id: "a", day: "2026-10-26", title_kr: "머스크, SpaceX GPU 구매 위해 400억 달러 부채 조달 완료 확인" }),
    art({ id: "b", day: "2026-10-27", title_kr: "역대 최대 IPO, 역대 최대 차용증: Anthropic의 2조 달러 베팅" }),
    art({ id: "c", day: "2026-10-27", title_kr: "Anthropic 상장 준비, 상반기 매출 163억 달러" }),
    art({ id: "d", day: "2026-10-29", title_kr: "스타트업, 시리즈 B 5억 8700만 달러 투자 유치" }),
    art({ id: "e", day: "2026-10-29", title_kr: "AI 칩 업계 동향 정리" }), // 금액 없음
  ]);
  assert.deepEqual(rows.map((r) => [r.id, r.amount, r.kind]), [
    ["a", "400억 달러", "부채 조달"],
    ["d", "5억 8700만 달러", "투자 유치"],
  ]);
});

test("중국 대 해외: 기사 단위, 둘 다 나오면 양쪽에 센다", () => {
  const r = chinaVsOverseas([
    art({ title_kr: "딥시크 신모델" }),
    art({ title_kr: "앤트로픽 상장" }),
    art({ title_kr: "엔비디아, 중국 시장 칩 공급" }),
    art({ title_kr: "AI 일반 동향" }),
  ]);
  assert.deepEqual([r.china_only, r.foreign_only, r.both, r.neither], [1, 1, 1, 1]);
  assert.equal(r.china_pct, 50);
  assert.equal(r.foreign_pct, 50);
});

test("2단계 사건 묶기: 같은 실체 + 같은 제품 토큰 + ±2일이면 같은 사건, 실체가 다르거나 날짜가 멀면 따로", () => {
  const s = (o: Partial<PeriodStoryInput>): PeriodStoryInput => ({
    ids: [o.primary_id ?? "x"], primary_id: "x", title_kr: "", title_cn: "", sources: ["36Kr"], days: ["2026-10-29"], entities: [], score: 1, ...o,
  });
  const a = s({ primary_id: "a", title_kr: "Gemini 4 Carbon 발표, 구글 세계 1위 탈환", entities: ["google"], sources: ["36Kr", "Huxiu"] });
  const b = s({ primary_id: "b", title_kr: "구글 Gemini 4 Carbon, 지능 지수 1위 주장", entities: ["google"], sources: ["Qbitai"], days: ["2026-10-30"] });
  const c = s({ primary_id: "c", title_kr: "Carbon 배출권 시장 동향", entities: ["byd"] });
  const d = s({ primary_id: "d", title_kr: "구글 Gemini 4 Carbon 후속 평가", entities: ["google"], days: ["2026-11-05"] });
  assert.ok(productTokens(a.title_kr).has("carbon"));
  assert.equal(productTokens(a.title_kr).has("gemini"), false); // 실체 별칭은 제품 토큰이 아니다
  assert.equal(sameEvent(a, b), true);
  assert.equal(sameEvent(a, c), false);
  assert.equal(sameEvent(a, d), false);
  const ev = groupPeriodStories([a, b, c, d]);
  assert.equal(ev.length, 3);
  assert.deepEqual(ev[0].sources.sort(), ["36Kr", "Huxiu", "Qbitai"]);
});

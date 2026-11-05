/** "한 장 요약" 카드 그림 명세 검사 (card-spec.ts) — 기사에 없는 숫자·단위 섞임·장식 그림을 막는다 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { bigTrend, unitShape, validateCardSpec, validateFigure } from "../../src/lib/briefing/card-spec";

const GROUND = `딥시크, 두 번째 투자 유치 규모 1055억 위안
두 번째 투자 유치 라운드 규모가 1055억 위안으로 늘었고 약 30개 투자자가 참여했다. 반년 사이 두 차례 합계는 약 1500억 위안이다.
기업가치 6155억 위안. 치엔원 오피스 월 이용권이 0.01위안에 판매돼 30분 만에 약 10만 건이 팔렸다. fal 기업가치 160억 달러. 11월 4일 테스트, 정식 배포는 12월 예정.`;

test("단위 꼴은 숫자·'약'을 빼고 비교한다", () => {
  assert.equal(unitShape("1055억 위안"), unitShape("약 1500억 위안"));
  assert.notEqual(unitShape("1055억 위안"), unitShape("160억 달러"));
});

test("같은 단위 막대: 통과하면 파서가 막대 값을 채운다", () => {
  const v = validateFigure(
    { kind: "bars", unit: "억 위안", items: [{ label: "2차 라운드", raw: "1055억 위안" }, { label: "두 차례 합계", raw: "약 1500억 위안" }, { label: "기업가치", raw: "6155억 위안" }] },
    GROUND
  );
  assert.ok(v.ok);
  if (v.ok && v.figure.kind === "bars") assert.deepEqual(v.figure.items.map((i) => i.value), [1055e8, 1500e8, 6155e8]);
});

test("막대: 위안과 달러를 섞으면 버린다", () => {
  const v = validateFigure({ kind: "bars", unit: "", items: [{ label: "딥시크", raw: "1055억 위안" }, { label: "fal", raw: "160억 달러" }] }, GROUND);
  assert.equal(v.ok, false);
});

test("막대: 기사에 없는 숫자(계산한 값)는 버린다", () => {
  const v = validateFigure({ kind: "bars", unit: "억 위안", items: [{ label: "1차", raw: "445억 위안" }, { label: "2차", raw: "1055억 위안" }] }, GROUND);
  assert.equal(v.ok, false);
});

test("숫자 사슬: 단위가 달라도 되지만 표기는 기사 그대로", () => {
  assert.ok(validateFigure({ kind: "chain", items: [{ label: "가격", raw: "0.01위안" }, { label: "판매 시간", raw: "30분" }, { label: "판매량", raw: "약 10만 건" }] }, GROUND).ok);
  assert.equal(validateFigure({ kind: "chain", items: [{ label: "가격", raw: "0.01위안" }, { label: "판매량", raw: "10만 건 완판" }] }, GROUND).ok, false);
});

test("일정 줄: 때가 기사에 있어야 하고, 항목은 2~4개", () => {
  assert.ok(validateFigure({ kind: "timeline", items: [{ when: "11월 4일", label: "개발자 테스트" }, { when: "12월", label: "정식 배포" }] }, GROUND).ok);
  assert.equal(validateFigure({ kind: "timeline", items: [{ when: "11월 4일", label: "테스트" }] }, GROUND).ok, false);
  assert.equal(validateFigure({ kind: "timeline", items: [{ when: "2027년", label: "확대" }, { when: "12월", label: "배포" }] }, GROUND).ok, false);
});

test("라벨에 기사에 없는 숫자를 만들면 버린다", () => {
  assert.equal(validateFigure({ kind: "chain", items: [{ label: "3배 성장", raw: "0.01위안" }, { label: "판매량", raw: "약 10만 건" }] }, GROUND).ok, false);
});

test("기사별 명세: 버린 그림·숫자는 큰 숫자 없이/그림 없이 남기고, 빠진 기사도 채운다", () => {
  const content = {
    top_stories: [
      { rank: 1, title: "딥시크, 두 번째 투자 유치 규모 1055억 위안", what: GROUND, why: "", refs: ["a"] },
      { rank: 2, title: "애플", what: "11월 4일 테스트, 정식 배포는 12월 예정.", why: "", refs: ["b"] },
    ],
    key_numbers: [],
  } as never;
  const spec = validateCardSpec(
    content,
    {
      stories: [
        { rank: 1, big: { raw: "6155억 위안", label: "기업가치" }, figure: { kind: "bars", unit: "", items: [{ label: "x", raw: "1055억 위안" }, { label: "y", raw: "160억 달러" }] }, note: "약 30개 투자자 참여" },
      ],
    },
    { edition_date: "2026-11-04", locale: "ko" }
  );
  assert.equal(spec.stories.length, 2);
  assert.equal(spec.stories[0].big?.raw, "6155억 위안");
  assert.equal(spec.stories[0].figure.kind, "none");
  assert.equal(spec.stories[0].note, "약 30개 투자자 참여");
  assert.deepEqual(spec.stories[1], { rank: 2, big: null, figure: { kind: "none" }, note: "" });
  assert.equal(spec.dropped.length, 1);
});

test("큰 숫자와 같은 값의 막대에 강조 (표기가 '약'으로 달라도 값으로)", () => {
  const content = { top_stories: [{ rank: 1, title: "딥시크", what: GROUND, why: "", refs: ["a"] }], key_numbers: [] } as never;
  const spec = validateCardSpec(
    content,
    { stories: [{ rank: 1, big: { raw: "약 1500억 위안", label: "합계" }, figure: { kind: "bars", unit: "억 위안", emphasis: 0, items: [{ label: "2차", raw: "1055억 위안" }, { label: "합계", raw: "1500억 위안" }] } }] },
    { edition_date: "2026-11-04", locale: "ko" }
  );
  assert.equal(spec.stories[0].big?.raw, "약 1500억 위안");
  assert.equal(spec.stories[0].figure.kind === "bars" && spec.stories[0].figure.emphasis, 1);
});

test("퍼센트 큰 숫자: 바로 뒤 표현으로 증가·감소, 아니면 비율 미터 (코드가 정함)", () => {
  assert.deepEqual(bigTrend({ raw: "47%", label: "3분기 매출" }, "3분기 매출은 전분기 대비 47% 늘었다"), { dir: "up" });
  assert.deepEqual(bigTrend({ raw: "40.1%", label: "투자" }, "전월 대비 40.1% 감소했다"), { dir: "down" });
  assert.deepEqual(bigTrend({ raw: "50% 이상", label: "토큰 사용량 감소" }, "토큰 사용량을 50% 이상 줄였다"), { dir: "down" });
  assert.deepEqual(bigTrend({ raw: "25%", label: "구독자에게 복구한 월간 한도" }, "월간 한도의 25%를 복구했다"), { meter: 25 });
  assert.deepEqual(bigTrend({ raw: "104.2%", label: "매출" }, "매출이 104.2%였다"), {});
  assert.deepEqual(bigTrend({ raw: "160억 달러", label: "기업가치" }, "160억 달러"), {});
});

test("중국어·영어: 증감 말이 숫자 앞에 와도 증가·감소로 본다", () => {
  assert.deepEqual(bigTrend({ raw: "47%", label: "三季度营收" }, "三季度营收同比增长47%"), { dir: "up" });
  assert.deepEqual(bigTrend({ raw: "40.1%", label: "投资" }, "投资环比下降40.1%"), { dir: "down" });
  assert.deepEqual(bigTrend({ raw: "47%", label: "Q3 revenue" }, "Q3 revenue rose 47% from the previous quarter"), { dir: "up" });
  assert.deepEqual(bigTrend({ raw: "50%", label: "token use" }, "cut token use by more than 50%"), { dir: "down" });
  assert.deepEqual(bigTrend({ raw: "25%", label: "monthly quota restored" }, "restored 25% of the monthly quota"), { meter: 25 });
});

test("영어 카드: 낱말로 시작하는 수량은 크게 쓰고, 버전 이름은 버린다 · 라벨 길이는 언어별", () => {
  const ground = "Qwen Office monthly plan sold about 100,000 units in 30 minutes at 0.01 yuan. Apple tested it in iOS 27.3.";
  const content = { top_stories: [{ rank: 1, title: "Qwen Office plan", what: ground, why: "", refs: [] }], key_numbers: [] };
  const ok = validateCardSpec(content as never, { stories: [{ rank: 1, big: { raw: "about 100,000 units", label: "Monthly plans sold in 30 minutes" } }] } as never, { edition_date: "2026-11-04", locale: "en" });
  assert.equal(ok.stories[0].big?.raw, "about 100,000 units");
  const ver = validateCardSpec(content as never, { stories: [{ rank: 1, big: { raw: "iOS 27.3", label: "version" } }] } as never, { edition_date: "2026-11-04", locale: "en" });
  assert.equal(ver.stories[0].big, null);
  const fig = { kind: "chain" as const, items: [{ label: "Monthly plan price", raw: "0.01 yuan" }, { label: "Time to sell out", raw: "30 minutes" }] };
  assert.ok(validateFigure(fig, ground, "en").ok);
  assert.equal(validateFigure(fig, ground, "ko").ok, false); // 한국어 기준(14자)으로는 길다
});

test("타임라인: 때가 모두 같으면 버린다", () => {
  assert.equal(validateFigure({ kind: "timeline", items: [{ when: "12월", label: "배포" }, { when: "12월", label: "정식 배포" }] }, GROUND).ok, false);
});

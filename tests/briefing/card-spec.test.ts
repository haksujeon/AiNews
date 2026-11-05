/** "한 장 요약" 카드 그림 명세 검사 (card-spec.ts) — 기사에 없는 숫자·단위 섞임·장식 그림을 막는다 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { unitShape, validateCardSpec, validateFigure } from "../../src/lib/briefing/card-spec";

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

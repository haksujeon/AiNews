import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeKoNames } from "../../src/lib/text/ko-names";
import { glossHanText } from "../../src/lib/briefing/validate";

test("문샷AI: 음차·띄어쓰기·맨 이름을 하나로", () => {
  assert.equal(normalizeKoNames("월지암면, 상장 결승권 진입"), "문샷AI, 상장 결승권 진입");
  assert.equal(normalizeKoNames("월지암(Moonshot AI)발 규칙 재편"), "문샷AI(Moonshot AI)발 규칙 재편");
  assert.equal(normalizeKoNames("문샷 AI 최강 모델"), "문샷AI 최강 모델");
  assert.equal(normalizeKoNames("딥시크와 문샷의 생존법"), "딥시크와 문샷AI의 생존법");
});

test("문샷AI: 받침 조사를 고친다 (이·은·을·과·으로)", () => {
  assert.equal(normalizeKoNames("월지암면이 투자를 받았고 월지암면은 상장, 월지암면을 두고 월지암면과 딥시크"), "문샷AI가 투자를 받았고 문샷AI는 상장, 문샷AI를 두고 문샷AI와 딥시크");
  assert.equal(normalizeKoNames("월지암면으로 옮겼다"), "문샷AI로 옮겼다");
  assert.equal(normalizeKoNames("문샷AI이번 주"), "문샷AI이번 주");
});

test("문샷AI: 멱등", () => {
  const once = normalizeKoNames("문샷AI와 월지암면, 문샷 AI");
  assert.equal(once, "문샷AI와 문샷AI, 문샷AI");
  assert.equal(normalizeKoNames(once), once);
});

test("문샷AI: 한자 사전과 함께 — 문샷(月之暗面) 겹침 없음, 한자 없는 글도 고침 (glossHanText)", () => {
  assert.equal(glossHanText("문샷(月之暗面)이 투자 유치"), "문샷AI가 투자 유치");
  assert.equal(glossHanText("月之暗面 투자"), "문샷AI 투자");
  assert.equal(glossHanText("월지암면 투자"), "문샷AI 투자");
});

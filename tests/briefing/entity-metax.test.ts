/**
 * 2026-11-11: 11월 10일 데일리가 en·zh 번역 3회 실패로 발행되지 못했다 — "메타엑스(MetaX)"가 Meta 실체("메타", 저커버그·Muse Wonder)에 걸려
 * 번역 이름표에 Meta 줄이 들어가고, 이름 검사가 zh 에 "扎克伯格 or Muse Wonder" 를 요구했다.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { findEntities } from "../../src/lib/briefing/entities";
import { nameGlossaryLinesOf, nameIssues } from "../../src/lib/briefing/translate";

test("메타엑스는 Meta 가 아니라 MetaX", () => {
  const keys = findEntities("메타엑스, 상장 후 첫 실적 발표").map((e) => e.key);
  assert.ok(keys.includes("metax"), keys.join(","));
  assert.ok(!keys.includes("meta"), keys.join(","));
  assert.ok(!nameGlossaryLinesOf("메타엑스가 GPU 를 공개했다").some((l) => /Muse Wonder|저커버그/.test(l)));
  assert.deepEqual(nameIssues("메타엑스가 GPU 를 공개했다", "MetaX unveiled a GPU", "en"), []);
  assert.deepEqual(nameIssues("메타엑스가 GPU 를 공개했다", "沐曦发布了GPU", "zh"), []);
});

test("메타 단독·조사는 그대로 Meta", () => {
  assert.ok(findEntities("메타가 새 모델을 냈다").some((e) => e.key === "meta"));
  assert.ok(findEntities("메타의 라마").some((e) => e.key === "meta"));
  assert.ok(!findEntities("메타버스 시장").some((e) => e.key === "meta"));
});

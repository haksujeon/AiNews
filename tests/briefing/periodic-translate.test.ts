import { test } from "node:test";
import assert from "node:assert/strict";
import { mergePeriodicTranslation, periodicTranslateFields } from "../../src/lib/briefing/periodic/translate";
import type { PeriodicContent } from "../../src/lib/briefing/periodic/types";

// 주간·월간 영어·중국어판 (2026-11-10 사용자 결정) — 칸을 평평하게 보내고 ko 구조에 얹는다

const ko: PeriodicContent = {
  headline: "로봇, 편의점에 들어가다",
  dek: "애지봇 로봇 여섯 대가 편의점에서 일했다.",
  dek_refs: ["a"], dek_metrics: [],
  big_picture: [{ title: "로봇 현장 투입", text: "창고 로봇 135대가 28시간 동안 주문을 처리했다.", easy: "로봇이 가게에서 일을 배워요.", why: "사람 일을 나눠 맡을 수 있어요.", key: { value: "135대", label: "창고 로봇 수" }, refs: ["a"], metrics: ["m"] }],
  movers: [], money: null, china_lens: null, watch_next: [], term: { term: "人形机器人", why: "로봇 이야기가 많았다.", metrics: [] }, month_arc: [],
};

test("번역 칸: 사실·쉽게 풀어보기·핵심 숫자·용어 풀이, 원어 용어와 refs 는 옮기지 않는다", () => {
  const paths = periodicTranslateFields(ko).map((f) => f.path);
  assert.deepEqual(paths, ["headline", "dek", "big_picture[0].title", "big_picture[0].text", "big_picture[0].easy", "big_picture[0].why", "big_picture[0].key.value", "big_picture[0].key.label", "term.why"]);
});

test("번역 얹기: 구조·refs·지표·원어 용어는 그대로, 숫자 빠지면 문제", () => {
  const good = {
    headline: "Robots enter convenience stores", dek: "Six AgiBot robots worked in a convenience store.",
    "big_picture[0].title": "Robots on site", "big_picture[0].text": "135 warehouse robots handled orders for 28 hours.",
    "big_picture[0].easy": "Robots are learning to work in shops.", "big_picture[0].why": "They may share some jobs with people.",
    "big_picture[0].key.value": "135 units", "big_picture[0].key.label": "Warehouse robots", "term.why": "Robots were a big topic.",
  };
  const r = mergePeriodicTranslation(ko, good, "en");
  assert.deepEqual(r.problems, []);
  assert.equal(r.content.big_picture[0].key?.value, "135 units");
  assert.deepEqual(r.content.big_picture[0].refs, ["a"]);
  assert.equal(r.content.term?.term, "人形机器人");
  const bad = mergePeriodicTranslation(ko, { ...good, "big_picture[0].text": "Warehouse robots handled orders." }, "en");
  assert.ok(bad.problems.some((p) => p.startsWith("big_picture[0].text: number set differs")));
  const missing = mergePeriodicTranslation(ko, { ...good, dek: "" }, "en");
  assert.ok(missing.problems.includes("dek: empty translation"));
});

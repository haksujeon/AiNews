import { test } from "node:test";
import assert from "node:assert/strict";
import { cleanPeriodicEasy, easyIssuesPeriodic, normalizeWeekly } from "../../src/lib/briefing/periodic/validate";
import { applySegmentEdits, segmentContent } from "../../src/lib/briefing/review/segments";

// 주간 v7 큰 흐름 쉽게 풀어보기 (2026-11-10 사용자 결정)

const ground = "알리바바 큐원 오피스가 쌍십일 라이브 방송에서 0.01위안에 판매됐다. 30분 만에 약 10만 건이 팔렸다.";

test("쉽게 풀어보기 검사: 근거에 없는 숫자·한자·이름·길이", () => {
  assert.deepEqual(easyIssuesPeriodic("가게에서 아주 싼 값에 파는 셈이에요.", ground, "easy"), []);
  assert.match(easyIssuesPeriodic("하루에 50만 명이 샀어요.", ground, "easy").join(), /근거에 없는 숫자/);
  assert.match(easyIssuesPeriodic("大模型 같은 거예요.", ground, "easy").join(), /한자/);
  assert.match(easyIssuesPeriodic("가".repeat(161), ground, "why").join(), /161\/160자/);
});

test("검사에 걸린 칸만 비우고 사실 문장은 남긴다", () => {
  const { content } = normalizeWeekly({
    headline: "h", dek: "d",
    big_picture: [{ title: "쌍십일에 토큰을 팔다", text: "큐원 오피스가 0.01위안에 팔렸다.", easy: "하루에 50만 명이 샀어요.", why: "AI 를 물건처럼 사고파는 시대가 올 수 있어요.", refs: ["S01"], metrics: [] }],
  });
  const r = cleanPeriodicEasy(content, { sourceText: new Map([["S01", ground]]), facts: {} });
  assert.equal(r.content.big_picture[0].easy, undefined);
  assert.equal(r.content.big_picture[0].why, "AI 를 물건처럼 사고파는 시대가 올 수 있어요.");
  assert.equal(r.content.big_picture[0].text, "큐원 오피스가 0.01위안에 팔렸다.");
  assert.equal(r.edits[0].action, "easy_clear");
});

test("AI 검토 문장 지우기: 쉽게 말하면을 다 지워도 큰 흐름 항목은 남는다", () => {
  const c = {
    headline: "h", dek: "d.",
    big_picture: [{ title: "t", text: "사실 문장이다.", easy: "쉬운 설명이에요.", why: "중요해요.", refs: ["x"], metrics: [] }],
    movers: [], watch_next: [],
  };
  const segs = segmentContent(c, "weekly");
  const easy = segs.find((s) => s.path === "big_picture[0].easy")!;
  assert.equal(easy.optional, true);
  const out = applySegmentEdits(c, "weekly", segs, [{ sid: easy.sid, action: "delete" }]);
  const bp = (out.content.big_picture as { text: string; easy: string }[])[0];
  assert.equal(bp.text, "사실 문장이다.");
  assert.equal(bp.easy, "");
  assert.deepEqual(out.dropped, []);
});

test("주간 한눈에 보기: 큰 흐름마다 칸, 큰 숫자는 지표 값 그대로", async () => {
  const { buildPeriodicGlance, splitFact } = await import("../../src/lib/briefing/periodic/glance");
  assert.deepEqual(splitFact("数据中心 6건→33건"), { label: "데이터센터", raw: "6건→33건" });
  assert.deepEqual(splitFact("대표 지역이 중국인 기사 43.3%"), { label: "대표 지역이 중국인 기사", raw: "43.3%" });
  assert.equal(splitFact("없음"), null);
  const g = buildPeriodicGlance(
    { big_picture: [{ title: "a", text: "", refs: [], metrics: ["x", "term.数据中心.rise"] }, { title: "b", text: "", refs: [], metrics: [] }] },
    { "term.数据中心.rise": "数据中心 6건→33건" }
  );
  assert.equal(g.length, 2);
  assert.deepEqual(g[0].big, { raw: "6건→33건", label: "데이터센터" });
  assert.equal(g[1].big, null);
});

test("큰 흐름 핵심 숫자: 문장에 있는 값만, 한자 없는 짧은 이름표", async () => {
  const { keyNumberProblem } = await import("../../src/lib/briefing/periodic/validate");
  const text = "점수가 7.9%에서 48.1%로 올랐다.";
  assert.equal(keyNumberProblem({ value: "48.1%", label: "수학 시험 점수" }, text), null);
  assert.match(keyNumberProblem({ value: "50%", label: "점수" }, text)!, /문장에 없음/);
  assert.match(keyNumberProblem({ value: "48.1%", label: "数学" }, text)!, /한자/);
});

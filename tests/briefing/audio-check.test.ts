/** NotebookLM 음성 숫자 대조 (audio-check.ts) — 시험에서 나온 실제 오류("1,070억"·"iOS 18.2")를 잡는다 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { audioDateLabel, audioInstructions, audioSourceMarkdown, checkTranscript, confirmedUnknown, linesFromJson, linesFromTranscript, retimeByLength, transcriptText } from "../../src/lib/briefing/audio-check";

const SOURCE = `### 5. Anthropic, 3분기 영업손실 5억 6700만 달러로 적자 전환
무슨 일: 3분기 매출은 약 170억 달러로 전분기 대비 47% 늘었고 컴퓨팅 약정은 약 8954억 달러다.
### 2. 애플 중국판 AI
무슨 일: 11월 4일 새벽 iOS 27.3 개발자 테스트 버전으로 공개됐다.`;

test("자료에 없는 숫자를 잡는다 (170억 → 1,070억, iOS 27.3 → 18.2)", () => {
  const tx = `A: 0:10 첫째, 3분기 매출은 약 1,070억 달러로 47% 늘었습니다.\nA: 0:30 둘째, iOS 18.2 개발자 테스트 버전입니다.`;
  const c = checkTranscript(tx, SOURCE, 2);
  assert.equal(c.ok, false);
  assert.ok(c.unknownNumbers.length >= 2, c.unknownNumbers.join(","));
});

test("숫자가 맞고 기사마다 서수가 있으면 통과 (시각 표기는 숫자 비교에서 뺀다)", () => {
  const tx = `A: 0:00 아침 브리핑입니다.\nA: 0:12 첫째, 3분기 매출은 약 170억 달러로 47% 늘었습니다.\nA: 1:05 둘째, iOS 27.3 개발자 테스트 버전입니다.`;
  const c = checkTranscript(tx, SOURCE, 2);
  assert.deepEqual(c.unknownNumbers, []);
  assert.equal(c.chaptersFound, 2);
  assert.equal(c.ok, true);
});

test("서수가 빠진 기사가 있으면 실패", () => {
  const c = checkTranscript(`A: 0:12 첫째, 매출 약 170억 달러.`, SOURCE, 2);
  assert.equal(c.ok, false);
  assert.equal(c.chaptersFound, 1);
});

test("받아쓰기 JSON → 시각 순 줄, 거꾸로 간 시각은 앞 줄에 맞춘다", () => {
  const lines = linesFromJson({ lines: [{ t: 0, text: "인사" }, { t: 24, text: "첫째" }, { t: 20, text: "이어서" }, { t: "x", text: "버림" }, { t: 30, text: "" }] });
  assert.deepEqual(lines.map((l) => l.t), [0, 24, 24]);
  assert.equal(transcriptText(lines), "A: 0:00 인사\nA: 0:24 첫째\nA: 0:24 이어서");
});

test("자료는 그 판 내용만 (주요 기사 what·why, 숫자, 그 밖의 소식, 주목할 기업)", () => {
  const md = audioSourceMarkdown(
    {
      headline: "H",
      lede: "L",
      top_stories: [{ rank: 1, title: "T", what: "W", why: "Y" }] as never,
      key_numbers: [{ value: "8시간", label: "작업", ref: "a" }],
      sections: [{ section: "robotics", items: [{ text: "S", refs: [] }] }],
      companies_to_watch: [{ name: "C", why: "Z", refs: [] }],
    },
    "11월 4일"
  );
  assert.match(md, /### 1\. T\n무슨 일: W\n왜 중요한가: Y/);
  assert.match(md, /- 8시간: 작업/);
  assert.match(md, /- C: Z/);
  assert.doesNotMatch(md, /story_context|timeline/);
});

test("시각은 글자 수 비율로 다시 매긴다 (뭉개진 받아쓰기 시각 대신)", () => {
  const lines = [{ t: 0, text: "가".repeat(10) }, { t: 59, text: "나".repeat(30) }, { t: 59, text: "다".repeat(60) }];
  assert.deepEqual(retimeByLength(lines, 100).map((l) => l.t), [0, 10, 40]);
  assert.deepEqual(linesFromTranscript("A: 0:00 인사\nA: 1:05 둘째\n잡음"), [{ t: 0, text: "인사" }, { t: 65, text: "둘째" }]);
});

test("두 번 받아써 양쪽에 다 나온 숫자만 오류로 본다", () => {
  assert.deepEqual(confirmedUnknown(["89500000000", "1070"], ["1070", "5"]), ["1070"]);
  assert.deepEqual(confirmedUnknown(["89500000000"], []), []);
});

test("음성 지시문의 서수는 그 판의 주요 기사 수만큼 (8개 판 = 여덟째·第八·Eighth)", () => {
  assert.match(audioInstructions("ko", 8), /주요 기사 8개를 하나도 빼지 말고 1번부터 순서대로 "첫째, 둘째, 셋째, 넷째, 다섯째, 여섯째, 일곱째, 여덟째"/);
  assert.doesNotMatch(audioInstructions("ko", 8), /아홉째|\{ORDINALS\}/);
  assert.match(audioInstructions("zh", 8), /全部 8 条.*“第八，”开头/);
  assert.match(audioInstructions("en", 7), /all 7 top stories.*"Seventh,"\./);
  assert.doesNotMatch(audioInstructions("en", 7), /Eighth/);
  assert.match(audioInstructions("ko"), /"첫째, 둘째, 셋째, 넷째, 다섯째"/); // 기본 5개 (이전과 같음)
});

test("자료 날짜에 연도, 자료의 '백만'은 받아쓰기 '100만'과 같다 (2026-11-13 시험: 2026·1000000 이 잘못 걸림)", () => {
  assert.equal(audioDateLabel("2026-11-12", "ko"), "2026년 11월 12일");
  assert.equal(audioDateLabel("2026-11-12", "zh"), "2026年11月12日");
  assert.equal(audioDateLabel("2026-11-12", "en"), "Nov 12, 2026");
  const src = audioSourceMarkdown(
    { headline: "H", lede: "L", top_stories: [{ rank: 1, title: "T", what: "백만 입력 토큰당 0.10달러", why: "Y" }] as never, key_numbers: [], sections: [], companies_to_watch: [] },
    audioDateLabel("2026-11-12", "ko")
  );
  const ok = checkTranscript("A: 0:00 2026년 11월 12일 브리핑\nA: 0:05 첫째, 100만 입력 토큰당 0.10달러입니다.", src, 1);
  assert.deepEqual(ok.unknownNumbers, []);
  // 다른 숫자는 여전히 잡는다
  assert.ok(checkTranscript("A: 0:05 첫째, 200만 입력 토큰당 0.10달러", src, 1).unknownNumbers.length > 0);
});

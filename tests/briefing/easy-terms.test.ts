/** "쉬운 AI 설명" (easy-terms.ts) — 후보 고르기·모델 출력 검사·화면에 붙이기 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { attachEasyTerms, buildCandidates, checkEasyTerms, type StoryInput } from "../../src/lib/briefing/easy-terms";
import type { KeyTerm } from "../../src/lib/briefing/types";

const kt = (term: string, pinyin = "p"): KeyTerm => ({ term, pinyin, explanation_kr: `${term} 설명`, explanation_en: `${term} en`, explanation_zh: `${term} zh` });

test("후보: 근거 기사 key_terms 를 합치고, 기업·제품 이름과 설명 없는 용어는 빼고, 같은 용어는 앞 순위 기사에만", () => {
  const keyTerms = new Map<string, KeyTerm[]>([
    ["a1", [kt("推理"), kt("通义千问"), { term: "算力", pinyin: "suan li" }]],
    ["a2", [kt("推理"), kt("端侧")]],
    ["b1", [kt("推理"), kt("看门狗")]],
  ]);
  const c = buildCandidates(
    [
      { rank: 2, refs: ["b1"] },
      { rank: 1, refs: ["a1", "a2"] },
    ],
    keyTerms
  );
  assert.deepEqual(c.get(1)!.map((x) => x.term), ["推理", "端侧"]);
  assert.deepEqual(c.get(2)!.map((x) => x.term), ["看门狗"]);
});

const story: StoryInput = {
  articleId: "a1",
  rank: 1,
  title: "t",
  what: "w",
  why: "y",
  candidates: [
    { term: "推理", pinyin: "tuī lǐ", detail: { ko: "추론 설명", en: "inf", zh: "推理说明" } },
    { term: "算力", pinyin: "suàn lì", detail: { ko: "연산 설명", en: "comp", zh: "算力说明" } },
    { term: "端侧", pinyin: "duān cè", detail: { ko: "기기 설명", en: "dev", zh: "端侧说明" } },
  ],
};
const good = (term: string, ko = "공부를 마친 AI에게 질문을 넣으면 답을 만들어 내는 과정이에요.") => ({
  term,
  name: { ko: "추론", en: "inference", zh: term },
  easy: { ko, en: "It is the process where a trained AI is given a question and then produces an answer.", zh: "它是学好的AI收到问题后给出答案的过程。" },
});

test("검사: 통과한 용어는 병음·자세히를 DB 에서 복사하고, 영어 이름 첫 글자를 대문자로", () => {
  const { byArticle, problems } = checkEasyTerms([story], { stories: [{ id: "S1", terms: [good("推理"), good("算力 (suàn lì)")] }] });
  assert.equal(problems.length, 0);
  const r = byArticle.get("a1")!;
  assert.deepEqual(r.ko.map((x) => x.term), ["推理", "算力"]);
  assert.equal(r.ko[1].pinyin, "suàn lì");
  assert.equal(r.en[0].name, "Inference");
  assert.equal(r.zh[0].detail, "推理说明");
});

test("검사: 후보 밖 용어·숫자·한국어 한자·기업 이름은 빼고, 2개 미만이면 상자 없음", () => {
  const { byArticle, problems } = checkEasyTerms([story], {
    stories: [
      {
        id: "S1",
        terms: [
          good("大模型"),
          good("推理", "공부를 마친 AI가 3초 만에 답을 만들어 내는 과정이에요."),
          good("算力", "컴퓨터가 계산하는 힘이에요. 推理 와 함께 쓰이는 말이에요."),
          good("端侧", "딥시크 같은 회사가 휴대폰 안에서 AI를 돌리는 방식이에요."),
        ],
      },
    ],
  });
  assert.equal(byArticle.size, 0);
  assert.deepEqual(
    problems.map((p) => p.reason),
    ["후보에 없는 용어", "ko 숫자", "ko 한자", "ko 기업 이름", "통과 용어 0개 (< 2) — 상자 없음"]
  );
});

test("화면: 근거 기사 키로 붙인다 (숨김으로 primary_ref 가 바뀌어도)", () => {
  const rows = new Map([["a2", [{ term: "推理", pinyin: "", name: "추론", easy: "e", detail: "d" }]]]);
  const out = attachEasyTerms(
    [
      { refs: ["a2"], primary_ref: "a2" },
      { refs: ["x"], primary_ref: "x" },
    ],
    rows
  );
  assert.equal(out[0].easy_terms?.[0].name, "추론");
  assert.equal(out[1].easy_terms, undefined);
});

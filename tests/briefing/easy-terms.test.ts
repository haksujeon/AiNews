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

import { ensureEasyTerms, missingStories, type EasyRunDeps } from "../../src/lib/briefing/easy-terms-run";
import type { StoredBriefingContent } from "../../src/lib/briefing/types";

test("자동 생성: 이미 용어가 있는 기사는 건너뛴다 (사람이 고친 행을 덮어쓰지 않음)", () => {
  const s2 = { ...story, articleId: "a2", rank: 2 };
  assert.deepEqual(missingStories([story, s2], new Set(["a1"])).map((s) => s.articleId), ["a2"]);
});

function runDeps(over: Partial<EasyRunDeps> = {}) {
  const log = { generate: 0, saved: 0, runs: [] as string[] };
  const content = {
    top_stories: [{ rank: 1, title: "t", what: "w", why: "y", refs: ["a1"], primary_ref: "a1" }],
  } as unknown as StoredBriefingContent;
  const deps: EasyRunDeps = {
    loadPublished: async () => ({ id: "b1", date: "2026-11-03", content }),
    hasRun: async () => false,
    keyTerms: async () => new Map([["a1", [kt("推理"), kt("算力")]]]),
    existing: async () => new Set(),
    generate: async () => (log.generate++, { raw: { stories: [{ id: "S1", terms: [good("推理"), good("算力")] }] }, costUsd: 0.01 }),
    save: async (_d, by) => ((log.saved += by.size * 3), by.size * 3),
    recordRun: async (_id, _d, r) => void log.runs.push(r.status),
    ...over,
  };
  return { deps, log };
}

test("자동 생성: 판 하나당 한 번만 — 기록이 있으면 LLM 을 부르지 않고, 만들 기사가 없어도 기록", async () => {
  const a = runDeps();
  const r = await ensureEasyTerms({}, a.deps);
  assert.equal(r.status, "generated");
  assert.equal(a.log.saved, 3);
  assert.deepEqual(a.log.runs, ["generated"]);

  const b = runDeps({ hasRun: async () => true });
  assert.equal((await ensureEasyTerms({}, b.deps)).status, "skipped");
  assert.equal(b.log.generate, 0);

  const c = runDeps({ existing: async () => new Set(["a1"]) });
  assert.equal((await ensureEasyTerms({}, c.deps)).status, "none");
  assert.equal(c.log.generate, 0);
  assert.deepEqual(c.log.runs, ["none"]);
});

test("자동 생성: LLM 오류는 기록하지 않아 다음 스윕이 다시 한다, --force 는 기록을 무시", async () => {
  const a = runDeps({ generate: async () => { throw new Error("timeout"); } });
  const r = await ensureEasyTerms({}, a.deps);
  assert.equal(r.status, "error");
  assert.deepEqual(a.log.runs, []);

  const f = runDeps({ hasRun: async () => true });
  assert.equal((await ensureEasyTerms({ force: true }, f.deps)).status, "generated");
});

/**
 * 2026-11-03: 번역 이름표 오탐 2건 + Haiku 번역 실패 시 Sonnet 5.5 재시도.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { nameIssues, translateBriefing } from "../../src/lib/briefing/translate";
import type { BriefingContent } from "../../src/lib/briefing/types";

test("이름표: '스타더스트 인텔리전트' 는 인텔이 아니다, 창업자 '량원펑' 은 DeepSeek 표기를 요구하지 않는다", () => {
  assert.deepEqual(nameIssues("스타더스트 인텔리전트, 10억 위안 신규 융자 발표", "星尘智能宣布新一轮10亿元融资", "zh"), []);
  assert.deepEqual(nameIssues("후룬 부자 순위에서 량원펑 2,800억 위안", "Liang Wenfeng at 280 billion yuan", "en"), []);
  // 진짜 누락은 그대로 잡는다
  assert.equal(nameIssues("인텔, 새 칩 발표", "某公司发布新芯片", "zh").length, 1);
  assert.equal(nameIssues("딥시크의 이번 라운드", "The scale of this round", "en").length, 1);
});

const ko: BriefingContent = {
  headline: "딥시크, 새 모델 공개",
  lede: "딥시크가 새 모델을 공개했다.",
  lede_refs: ["A01"],
  top_stories: [],
  sections: [],
  key_numbers: [],
  companies_to_watch: [],
  term_of_the_day: null,
  clusters: [],
  excluded: [],
};

test("번역: 번역 모델이 수리 뒤에도 검사를 못 넘으면 재시도 모델(Sonnet 5.5)로 다시 번역", async () => {
  process.env.LITELLM_BASE_URL = "http://litellm.test";
  process.env.LITELLM_API_KEY = "test";
  const realFetch = globalThis.fetch;
  const models: string[] = [];
  globalThis.fetch = (async (_u: unknown, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body));
    models.push(body.model);
    const good = body.model.includes("sonnet");
    const out = good ? { ...ko, headline: "DeepSeek releases a new model", lede: "DeepSeek released a new model." } : { ...ko, headline: "딥시크 releases", lede: "딥시크 released." };
    return new Response(JSON.stringify({ id: "x", usage: { prompt_tokens: 1, completion_tokens: 1 }, choices: [{ finish_reason: "stop", message: { content: JSON.stringify(out) } }] }), {
      status: 200, headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;
  try {
    const r = await translateBriefing(ko, "en", [], () => {});
    assert.deepEqual(models, ["anthropic-api-haiku-5-5", "anthropic-api-haiku-5-5", "anthropic-api-sonnet-5-5"]);
    assert.ok(r.content, JSON.stringify(r.problems));
    assert.equal(r.fallback, true);
    assert.equal(r.content!.headline, "DeepSeek releases a new model");
  } finally {
    globalThis.fetch = realFetch;
  }
});

/**
 * LiteLLM 오류 처리 — 2026-10-31~11-01 Anthropic permission_error 장애 회귀.
 * permission_error 는 재시도해도 같으므로 바로 LlmError(재시도 안 함)로 올라가고, 메시지에 원인이 남아야
 * generate 가 failed 행의 error 컬럼에 기록해 관리자 화면에 보인다.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { LlmError, chat } from "../../src/lib/briefing/llm";

test("permission_error(403)는 재시도 없이 LlmError, 메시지에 원인 포함", async () => {
  process.env.LITELLM_BASE_URL = "http://litellm.test";
  process.env.LITELLM_API_KEY = "test";
  const realFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async () => {
    calls++;
    return new Response(
      JSON.stringify({ error: { message: 'AnthropicException - {"type":"error","error":{"type":"permission_error","message":"Your API key does not have permission"}}', type: "permission_error" } }),
      { status: 403, headers: { "Content-Type": "application/json" } }
    );
  }) as typeof fetch;
  try {
    await assert.rejects(chat({ system: "s", messages: [{ role: "user", content: "u" }] }), (e: unknown) => {
      assert.ok(e instanceof LlmError);
      assert.equal(e.retryable, false);
      assert.match(e.message, /HTTP 403/);
      assert.match(e.message, /permission_error/);
      return true;
    });
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = realFetch;
  }
});

// 2026-11-03 모델 비교: Sonnet 5.5·Opus 5.5 는 thinking disabled 를 보내면 400 — 모델별 사고 설정
import { costOf, thinkingOn, thinkingParams } from "../../src/lib/briefing/llm";

test("thinkingParams: 끌 수 있는 모델은 effort 없으면 사고 끔, 못 끄는 모델은 adaptive", () => {
  assert.deepEqual(thinkingParams("anthropic-api-haiku-5-5"), { thinking: { type: "disabled" } });
  assert.deepEqual(thinkingParams("anthropic-api-sonnet-4-6"), { thinking: { type: "disabled" } });
  assert.deepEqual(thinkingParams("anthropic-api-haiku-5-5", "medium"), { thinking: { type: "adaptive" }, output_config: { effort: "medium" } });
  assert.deepEqual(thinkingParams("anthropic-api-sonnet-5-5"), { thinking: { type: "adaptive" } });
  assert.deepEqual(thinkingParams("anthropic-api-opus-5-5", "high"), { thinking: { type: "adaptive" }, output_config: { effort: "high" } });
  assert.equal(thinkingOn("anthropic-api-haiku-5-5"), false);
  assert.equal(thinkingOn("anthropic-api-opus-5-5"), true);
});

test("요청 본문: 기본(haiku)은 예전과 같이 thinking disabled·max_tokens 그대로, 사고 모델은 출력 상한 확대", async () => {
  process.env.LITELLM_BASE_URL = "http://litellm.test";
  process.env.LITELLM_API_KEY = "test";
  const realFetch = globalThis.fetch;
  const bodies: Record<string, unknown>[] = [];
  globalThis.fetch = (async (_u: unknown, init?: RequestInit) => {
    bodies.push(JSON.parse(String(init?.body)));
    return new Response(JSON.stringify({ id: "x", usage: { prompt_tokens: 1, completion_tokens: 1 }, choices: [{ finish_reason: "stop", message: { content: "{}" } }] }), {
      status: 200, headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;
  try {
    await chat({ system: "s", messages: [{ role: "user", content: "u" }], maxTokens: 8000, model: "anthropic-api-haiku-5-5" });
    await chat({ system: "s", messages: [{ role: "user", content: "u" }], maxTokens: 8000, model: "anthropic-api-opus-5-5", effort: "medium" });
    assert.deepEqual(bodies[0].thinking, { type: "disabled" });
    assert.equal(bodies[0].max_tokens, 8000);
    assert.equal("output_config" in bodies[0], false);
    assert.deepEqual(bodies[1].thinking, { type: "adaptive" });
    assert.deepEqual(bodies[1].output_config, { effort: "medium" });
    assert.equal(bodies[1].max_tokens, 32000);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("요금표: Sonnet 5.5 $2/$10, Opus 5.5 $4/$20 (haiku 요금으로 떨어지지 않음)", () => {
  assert.equal(costOf(1_000_000, 0, "anthropic-api-sonnet-5-5"), 2);
  assert.equal(costOf(0, 1_000_000, "anthropic-api-opus-5-5"), 20);
  assert.equal(costOf(1_000_000, 1_000_000, "anthropic-api-haiku-5-5"), 0.6);
});

test("단계별 기본 모델 (결정 D2): 일간 Sonnet 5.5 medium, 주간·월간 Opus 5.5 medium, 번역 Haiku 사고 끔", async () => {
  const m = await import("../../src/lib/briefing/llm");
  if (!process.env.BRIEFING_MODEL) {
    assert.equal(m.BRIEFING_MODEL, "anthropic-api-sonnet-5-5");
    assert.equal(m.BRIEFING_EFFORT, "medium");
  }
  if (!process.env.PERIODIC_MODEL) {
    assert.equal(m.PERIODIC_MODEL, "anthropic-api-opus-5-5");
    assert.equal(m.PERIODIC_EFFORT, "medium");
  }
  if (!process.env.BRIEFING_TRANSLATE_MODEL) {
    assert.equal(m.TRANSLATE_MODEL, "anthropic-api-haiku-5-5");
    assert.equal(m.TRANSLATE_EFFORT, undefined);
  }
  assert.equal(m.modelTag("x", "medium"), "x@medium");
  assert.equal(m.modelTag("x"), "x");
});

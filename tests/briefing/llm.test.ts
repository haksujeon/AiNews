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

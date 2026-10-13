/**
 * LiteLLM (OpenAI 호환 /v1/chat/completions) 클라이언트.
 *
 * 프로토타입에서 배운 것 (설계 검토서 요약 2, §3.7):
 *  - anthropic-api-haiku-5-5 는 thinking 이 기본으로 켜져 있어, thinking:{type:"disabled"} 를 빼면
 *    출력 토큰이 사고 과정에 다 쓰이고 본문이 빈 채로 과금된다 → 반드시 명시.
 *  - temperature 는 보내지 않는다 (n8n 과 동일).
 *  - finish_reason === "stop" 이고 content 가 비어 있지 않을 때만 성공.
 *  - 요금: LiteLLM_SpendLogs 실측 입력 $0.10/M, 출력 $0.50/M.
 */
import type { LlmUsage } from "./types";

export const BRIEFING_MODEL = process.env.BRIEFING_MODEL || "anthropic-api-haiku-5-5";
const PRICE_IN_PER_M = 0.1;
const PRICE_OUT_PER_M = 0.5;

export class LlmError extends Error {
  constructor(
    message: string,
    public readonly usage: LlmUsage | null = null,
    public readonly retryable = false
  ) {
    super(message);
    this.name = "LlmError";
  }
}

export interface ChatRequest {
  system: string;
  messages: { role: "user" | "assistant"; content: string }[];
  maxTokens?: number;
  timeoutMs?: number;
}

export interface ChatResponse {
  content: string;
  usage: LlmUsage;
}

export function costOf(inputTokens: number, outputTokens: number): number {
  return Math.round(((inputTokens * PRICE_IN_PER_M + outputTokens * PRICE_OUT_PER_M) / 1e6) * 1e6) / 1e6;
}

function config() {
  const base = process.env.LITELLM_BASE_URL;
  const key = process.env.LITELLM_API_KEY;
  if (!base || !key) throw new LlmError("LITELLM_BASE_URL / LITELLM_API_KEY 미설정");
  return { base: base.replace(/\/+$/, ""), key };
}

async function chatOnce(req: ChatRequest): Promise<ChatResponse> {
  const { base, key } = config();
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), req.timeoutMs ?? 180_000);
  let res: Response;
  try {
    res = await fetch(`${base}/v1/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: BRIEFING_MODEL,
        max_tokens: req.maxTokens ?? 8000,
        thinking: { type: "disabled" },
        messages: [{ role: "system", content: req.system }, ...req.messages],
      }),
      signal: controller.signal,
    });
  } catch (e) {
    throw new LlmError(`LiteLLM 연결 실패: ${(e as Error).message}`, null, true);
  } finally {
    clearTimeout(timer);
  }
  const latencyMs = Date.now() - started;
  const data: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const err = (data as { error?: { message?: unknown } | string } | null)?.error;
    const msg = typeof err === "string" ? err : typeof err?.message === "string" ? err.message : `HTTP ${res.status}`;
    throw new LlmError(`LiteLLM HTTP ${res.status}: ${msg.slice(0, 300)}`, null, res.status >= 500 || res.status === 429);
  }
  const d = data as {
    id?: string;
    model?: string;
    usage?: { prompt_tokens?: number; completion_tokens?: number };
    choices?: { finish_reason?: string; message?: { content?: string | null } }[];
  };
  const inputTokens = d.usage?.prompt_tokens ?? 0;
  const outputTokens = d.usage?.completion_tokens ?? 0;
  const choice = d.choices?.[0];
  const usage: LlmUsage = {
    requestId: d.id ?? null,
    model: BRIEFING_MODEL,
    inputTokens,
    outputTokens,
    costUsd: costOf(inputTokens, outputTokens),
    latencyMs,
    finishReason: choice?.finish_reason ?? null,
  };
  const content = choice?.message?.content ?? "";
  if (usage.finishReason !== "stop") {
    // 'length' 는 같은 요청을 반복해도 같은 결과라 재시도하지 않는다.
    throw new LlmError(`finish_reason=${usage.finishReason} (출력 ${outputTokens} 토큰)`, usage, false);
  }
  if (!content.trim()) throw new LlmError("빈 응답 (finish_reason=stop)", usage, true);
  return { content, usage };
}

/**
 * 지수 백오프 재시도 2회. 실패한 시도의 사용량도 onUsage 로 넘겨 비용 기록에 넣는다.
 */
export async function chat(req: ChatRequest, onUsage?: (u: LlmUsage) => void): Promise<ChatResponse> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const r = await chatOnce(req);
      onUsage?.(r.usage);
      return r;
    } catch (e) {
      lastErr = e;
      if (e instanceof LlmError && e.usage) onUsage?.(e.usage);
      if (!(e instanceof LlmError) || !e.retryable || attempt === 2) break;
      await new Promise((r) => setTimeout(r, 2000 * 2 ** attempt));
    }
  }
  throw lastErr;
}

/** 코드 펜스를 벗기고 JSON 파싱. 실패하면 LlmError */
export function parseJsonContent<T = unknown>(content: string): T {
  let txt = content.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  // 앞뒤 설명이 붙은 경우 첫 { ~ 마지막 } 만
  const first = txt.indexOf("{");
  const last = txt.lastIndexOf("}");
  if (first > 0 || (last >= 0 && last < txt.length - 1)) txt = txt.slice(first, last + 1);
  try {
    return JSON.parse(txt) as T;
  } catch (e) {
    throw new LlmError(`JSON 파싱 실패: ${(e as Error).message}`);
  }
}

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

const PRICE_IN_PER_M = 0.1;
const PRICE_OUT_PER_M = 0.5;
/** 모델별 요금 ($/M 토큰, LiteLLM_SpendLogs 실측·Anthropic 공시). 없는 모델은 Haiku 요금 */
export const MODEL_PRICES: Record<string, { in: number; out: number }> = {
  "anthropic-api-sonnet-4-6": { in: 3, out: 15 },
  "anthropic-api-sonnet-5-5": { in: 2, out: 10 },
  "anthropic-api-opus-5-5": { in: 4, out: 20 },
};

export type Effort = "low" | "medium" | "high" | "xhigh" | "max";

/**
 * 사고(thinking)를 끌 수 있는 모델. 나머지(Sonnet 5.5·Opus 5.5 등)는 {type:"disabled"} 를 보내면 400 이라
 * adaptive + output_config.effort 로 보낸다 (2026-11-03 LiteLLM 경유 실측). reasoning_effort 는 LiteLLM 이
 * thinking.type.enabled 로 바꿔 400 이 나므로 쓰지 않는다.
 */
const THINKING_OFF_OK = /haiku-5-5|haiku-4-5|sonnet-4-6/;

/** 요청 본문의 사고 설정 (순수 — 테스트용 export) */
export function thinkingParams(model: string, effort?: Effort): Record<string, unknown> {
  if (!effort && THINKING_OFF_OK.test(model)) return { thinking: { type: "disabled" } };
  return { thinking: { type: "adaptive" }, ...(effort ? { output_config: { effort } } : {}) };
}

/** 사고가 켜지는 요청인가 (출력 상한·시간 초과를 넓힌다 — 사고 토큰도 max_tokens 에 들어간다) */
export function thinkingOn(model: string, effort?: Effort): boolean {
  return (thinkingParams(model, effort).thinking as { type: string }).type !== "disabled";
}

const EFFORTS = new Set(["low", "medium", "high", "xhigh", "max"]);
/** env 값 → Effort (없거나 틀리면 undefined) */
export function effortFromEnv(v: string | undefined): Effort | undefined {
  return v && EFFORTS.has(v) ? (v as Effort) : undefined;
}
/** 사고를 끌 수 있는 모델은 effort 를 주지 않으면 사고를 끄고, 못 끄는 모델은 medium (실험한 설정) */
function defaultEffort(model: string, env: string | undefined): Effort | undefined {
  return effortFromEnv(env) ?? (THINKING_OFF_OK.test(model) ? undefined : "medium");
}

/**
 * 단계별 모델 (2026-11-03 사용자 결정 D2 — ~/ainews-reports/model-compare-2026-11/REPORT.md).
 * 실험(같은 입력, Sonnet 5.5 검토기 채점): 일간 Haiku(사고 끔) 6.72점 → Sonnet 5.5 medium 9.33점,
 * 주간 Haiku 4.03점(4판 중 3판 생성 실패) → Opus 5.5 medium 7.85점. 번역은 검사기가 숫자·이름을 대조하므로 Haiku 유지.
 * 운영 서버(.env 없이 main 으로 빌드)도 같은 값이 되게 코드 기본값으로 둔다. env 로 덮어쓸 수 있다.
 */
/** 일간 ko 생성 (BRIEFING_MODEL / BRIEFING_EFFORT). chat() 에 model 을 주지 않으면 이 모델 (han-backfill 은 import 전에 env 로 Haiku 지정) */
export const BRIEFING_MODEL = process.env.BRIEFING_MODEL || "anthropic-api-sonnet-5-5";
export const BRIEFING_EFFORT = defaultEffort(BRIEFING_MODEL, process.env.BRIEFING_EFFORT);
/** 주간·월간 ko 생성 (PERIODIC_MODEL / PERIODIC_EFFORT) */
export const PERIODIC_MODEL = process.env.PERIODIC_MODEL || "anthropic-api-opus-5-5";
export const PERIODIC_EFFORT = defaultEffort(PERIODIC_MODEL, process.env.PERIODIC_EFFORT);
/** 일간 en/zh 번역 (BRIEFING_TRANSLATE_MODEL / BRIEFING_TRANSLATE_EFFORT) */
export const TRANSLATE_MODEL = process.env.BRIEFING_TRANSLATE_MODEL || "anthropic-api-haiku-5-5";
export const TRANSLATE_EFFORT = defaultEffort(TRANSLATE_MODEL, process.env.BRIEFING_TRANSLATE_EFFORT);
/**
 * 번역 재시도 모델 — 번역 모델(Haiku)이 1회 수리 뒤에도 검사를 못 넘으면 이 모델로 한 번 더 (2026-11-03 사용자 결정).
 * 실측: 2026-11-03 생성 12개 언어판 중 Haiku 7개가 검사 실패. "off" 면 재시도하지 않는다.
 */
export const TRANSLATE_FALLBACK_MODEL =
  process.env.BRIEFING_TRANSLATE_FALLBACK_MODEL === "off" ? null : process.env.BRIEFING_TRANSLATE_FALLBACK_MODEL || "anthropic-api-sonnet-5-5";
export const TRANSLATE_FALLBACK_EFFORT = TRANSLATE_FALLBACK_MODEL ? defaultEffort(TRANSLATE_FALLBACK_MODEL, process.env.BRIEFING_TRANSLATE_FALLBACK_EFFORT) : undefined;

/** 입력 해시·기록용 "모델@effort" (effort 를 바꾸면 같은 입력도 다시 생성) */
export function modelTag(model: string, effort?: Effort): string {
  return effort ? `${model}@${effort}` : model;
}

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
  /** 기본 BRIEFING_MODEL (생성). AI 검토는 더 강한 모델을 따로 준다 (review/llm) */
  model?: string;
  /** 시도 횟수 (기본 3 = 재시도 2회). 긴 응답(검토)은 시간 초과 재시도가 비싸서 줄인다 */
  maxAttempts?: number;
  /** 사고 깊이. 없으면 끌 수 있는 모델은 사고를 끄고, 못 끄는 모델은 모델 기본값 */
  effort?: Effort;
}

export interface ChatResponse {
  content: string;
  usage: LlmUsage;
}

export function costOf(inputTokens: number, outputTokens: number, model: string = BRIEFING_MODEL): number {
  const p = MODEL_PRICES[model] ?? { in: PRICE_IN_PER_M, out: PRICE_OUT_PER_M };
  return Math.round(((inputTokens * p.in + outputTokens * p.out) / 1e6) * 1e6) / 1e6;
}

function config() {
  const base = process.env.LITELLM_BASE_URL;
  const key = process.env.LITELLM_API_KEY;
  if (!base || !key) throw new LlmError("LITELLM_BASE_URL / LITELLM_API_KEY 미설정");
  return { base: base.replace(/\/+$/, ""), key };
}

async function chatOnce(req: ChatRequest): Promise<ChatResponse> {
  const { base, key } = config();
  const model = req.model ?? BRIEFING_MODEL;
  const started = Date.now();
  const controller = new AbortController();
  const think = thinkingOn(model, req.effort);
  // 사고 토큰도 max_tokens 에 들어가 'length' 로 끝나지 않게 넓힌다. 사고 모델은 응답이 느려 시간 초과도 늘린다
  const maxTokens = think ? Math.max(req.maxTokens ?? 8000, 32_000) : req.maxTokens ?? 8000;
  // 시간 초과: 생성·검토 라우트 maxDuration 300초·n8n 300초 안에 들어가게 사고 모델도 기본 240초 (실측 최대 1회 약 90초).
  // 더 길게 기다릴 호출(CLI 실험)은 timeoutMs 를 직접 준다
  const timeoutMs = req.timeoutMs ?? (think ? 240_000 : 180_000);
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetch(`${base}/v1/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        ...thinkingParams(model, req.effort),
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
    model,
    inputTokens,
    outputTokens,
    costUsd: costOf(inputTokens, outputTokens, model),
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
  const attempts = Math.max(1, req.maxAttempts ?? 3);
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      const r = await chatOnce(req);
      onUsage?.(r.usage);
      return r;
    } catch (e) {
      lastErr = e;
      if (e instanceof LlmError && e.usage) onUsage?.(e.usage);
      if (!(e instanceof LlmError) || !e.retryable || attempt === attempts - 1) break;
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

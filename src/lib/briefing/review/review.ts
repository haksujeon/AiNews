/**
 * reviewBriefing(id) — 판 한 버전(ko)을 생성 모델보다 강한 별도 모델로 검토한다.
 *
 *  모델: BRIEFING_REVIEW_MODEL (기본 anthropic-api-sonnet-4-6, LiteLLM). temperature 를 보내지 않는다.
 *  thinking: 끈다 (이 별칭은 기본 꺼짐 — 명시). 근거를 그대로 인용하게 해 근거 대조를 강제하고, 사고 토큰 비용(출력 단가 $15/M)을 아낀다.
 *  finish_reason=stop 만 성공 (llm.ts). 시간 초과 280초, 재시도 1회(긴 응답의 재시도는 비싸다).
 *  점수·판정은 코드(score.ts)가 계산하고, 모델 판정과 다르면 엄격한 쪽을 쓴다.
 *  근거 인용(e)이 인용 기사 본문에 그대로 있는지 코드가 확인해 evidence_verified 로 남긴다.
 */
import { LlmError, chat, parseJsonContent, type ChatRequest, type ChatResponse } from "../llm";
import type { LlmUsage } from "../types";
import { loadReviewInput, type ReviewInput } from "./evidence";
import { quoteMatch } from "./fix";
import { buildHints } from "./hints";
import { policyFromEnv, minScoreFor, type ReviewPolicy } from "./policy";
import { REVIEW_PROMPT_VERSION, buildReviewSystemPrompt, buildReviewUserPrompt } from "./prompt";
import { ReviewSchemaError, claimTypeOf, parseReviewJson } from "./schema";
import { scoreReview, stricter } from "./score";
import { insertReview } from "./store";
import type { ReviewResult, ReviewTrigger, Segment } from "./types";

export const REVIEW_MODEL = process.env.BRIEFING_REVIEW_MODEL || "anthropic-api-sonnet-4-6";
const REVIEW_MAX_TOKENS = 20_000;
const REVIEW_TIMEOUT_MS = 280_000;

export interface ReviewDeps {
  chat: (req: ChatRequest, onUsage?: (u: LlmUsage) => void) => Promise<ChatResponse>;
  loadInput: (id: string, opts: { includeTranslations?: boolean }) => Promise<ReviewInput>;
  store: (r: ReviewResult, extra: { parentReviewId?: string | null }) => Promise<string>;
}

export const defaultDeps: ReviewDeps = { chat, loadInput: loadReviewInput, store: (r, e) => insertReview(r, e) };

export interface ReviewOptions {
  trigger?: ReviewTrigger;
  round?: number;
  parentReviewId?: string | null;
  /** 데일리 en/zh 번역 일관성 검사 (기본 true, 보정은 비용 때문에 끈다) */
  includeTranslations?: boolean;
  /** briefing_reviews 에 저장 (기본 true) */
  store?: boolean;
  policy?: ReviewPolicy;
  /** 이미 읽어 둔 입력 (수정 루프에서 메모리 수정본을 검토할 때) */
  input?: ReviewInput;
  /** 같은 프롬프트 버전으로 저장해 둔 응답 원문을 다시 읽는다 (파싱 실패 복구 — 모델을 다시 부르지 않음, 비용 0) */
  rawOverride?: string;
}

/** 인용 기사 본문(전체) 중 이 문장의 근거 + (주간·월간) FACTS */
export function corpusFor(input: ReviewInput, seg: Segment, refIds: string[] = []): string {
  const ids = [...new Set([...seg.refs, ...refIds.filter((r) => seg.refs.includes(r) || !seg.refs.length)])];
  const text = (ids.length ? ids : [...input.fullText.keys()]).map((id) => input.fullText.get(id) ?? "").join(" ");
  const facts = input.facts ? Object.values(input.facts).join(" ") : "";
  return `${text} ${facts}`;
}

/**
 * JSON 파싱 — 모델이 문자열 안에 줄바꿈·탭을 그대로 넣는 일이 있다(보정 10-29: Bad control character).
 * 제어 문자는 JSON 의 토큰 사이에서도 공백과 같으므로 모두 공백으로 바꿔 한 번 더 읽는다.
 */
export function parseLenient(content: string): unknown {
  try {
    return parseJsonContent(content);
  } catch {
    const flat = content.replace(/[\u0000-\u001f]+/g, " ");
    try {
      return parseJsonContent(flat);
    } catch {
      return parseWithStrayCloserRepair(escapeInnerQuotes(flat));
    }
  }
}

/**
 * 모델이 배열 끝에서 객체를 일찍 닫는 일이 있다 (보정 07-15 v2: `...}]},\n"omissions":` → Unexpected non-whitespace after JSON).
 * "after JSON at position N" 이면 N 앞의 닫는 괄호 하나를 지우고 다시 읽는다 (최대 3번).
 */
function parseWithStrayCloserRepair(text: string): unknown {
  let t = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const first = t.indexOf("{");
  const last = t.lastIndexOf("}");
  if (first >= 0 && last > first) t = t.slice(first, last + 1);
  for (let attempt = 0; ; attempt++) {
    try {
      return JSON.parse(t);
    } catch (e) {
      const m = /after JSON at position (\d+)/.exec((e as Error).message);
      if (!m || attempt >= 3) return parseJsonContent(t);
      let i = Number(m[1]) - 1;
      while (i >= 0 && /\s/.test(t[i])) i--;
      if (i < 0 || (t[i] !== "}" && t[i] !== "]")) return parseJsonContent(t);
      t = t.slice(0, i) + t.slice(i + 1);
    }
  }
}

/**
 * 문자열 안에 이스케이프하지 않은 큰따옴표("…" 인용)를 고친다 (보정 W44: Expected ',' or '}').
 * 문자열 안의 " 뒤에(공백을 건너) , } ] : 가 오지 않으면 문자열 끝이 아니라 글자로 본다.
 */
export function escapeInnerQuotes(text: string): string {
  let out = "";
  let inStr = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (!inStr) {
      if (ch === '"') inStr = true;
      out += ch;
      continue;
    }
    if (ch === "\\") {
      out += ch + (text[i + 1] ?? "");
      i++;
      continue;
    }
    if (ch === '"') {
      let j = i + 1;
      while (j < text.length && /\s/.test(text[j])) j++;
      const next = text[j];
      if (next === undefined || next === "," || next === "}" || next === "]" || next === ":") {
        inStr = false;
        out += ch;
      } else out += '\\"';
      continue;
    }
    out += ch;
  }
  return out;
}

export async function reviewBriefing(
  briefingId: string,
  opts: ReviewOptions = {},
  deps: ReviewDeps = defaultDeps
): Promise<{ result: ReviewResult; input: ReviewInput | null }> {
  const policy = opts.policy ?? policyFromEnv();
  const usages: LlmUsage[] = [];
  const started = Date.now();
  let input: ReviewInput | null = opts.input ?? null;
  const base = (): ReviewResult => ({
    id: null, briefingId, version: input?.row.version ?? 0, editionType: input?.editionType ?? "daily", editionDate: input?.row.edition_date ?? "1970-01-01",
    round: opts.round ?? 0, trigger: opts.trigger ?? "pipeline", model: REVIEW_MODEL, promptVersion: REVIEW_PROMPT_VERSION, status: "error",
    verdict: null, llmVerdict: null, score: null, counts: null, breakdown: [], claims: [], fixes: [], omissions: [], translation: [], structure: [],
    summary: "", schemaIssues: [], costUsd: 0, latencyMs: 0, inputTokens: 0, outputTokens: 0, requestIds: [],
  });
  const finish = async (r: ReviewResult) => {
    r.costUsd = Math.round(usages.reduce((s, u) => s + u.costUsd, 0) * 1e6) / 1e6;
    r.inputTokens = usages.reduce((s, u) => s + u.inputTokens, 0);
    r.outputTokens = usages.reduce((s, u) => s + u.outputTokens, 0);
    r.requestIds = usages.map((u) => u.requestId).filter((x): x is string => Boolean(x));
    r.latencyMs = Date.now() - started;
    if (opts.store !== false && input) r.id = await deps.store(r, { parentReviewId: opts.parentReviewId ?? null });
    return { result: r, input };
  };

  try {
    input = input ?? (await deps.loadInput(briefingId, { includeTranslations: opts.includeTranslations }));
  } catch (e) {
    const r = base();
    r.error = `입력 읽기 실패: ${(e as Error).message}`;
    return { result: r, input: null };
  }
  const withTr = input.translations.length > 0;
  const dq = (input.meta.data_quality ?? {}) as { incomplete_days?: string[] };
  const system = buildReviewSystemPrompt(input.editionType, withTr);
  const user = buildReviewUserPrompt({
    editionType: input.editionType, editionDate: input.row.edition_date, periodStart: input.periodStart, periodEnd: input.periodEnd,
    version: input.row.version, segments: input.segments, labelOf: input.labelOf, articles: input.articles, facts: input.facts,
    candidates: input.candidates, translations: input.translations,
    hints: buildHints(input.segments, input.fullText, input.labelOf, input.periodStart),
    genLog: input.genLog,
    dataQualityNote: dq.incomplete_days?.length ? `수집 미완 날짜 ${dq.incomplete_days.join(", ")} (본문에 데이터 알림이 필요)` : null,
  });

  let raw: unknown;
  let rawText: string | undefined;
  try {
    const res = opts.rawOverride !== undefined ? { content: opts.rawOverride } : await deps.chat(
      { model: REVIEW_MODEL, system, messages: [{ role: "user", content: user }], maxTokens: REVIEW_MAX_TOKENS, timeoutMs: REVIEW_TIMEOUT_MS, maxAttempts: 2 },
      (u) => usages.push(u)
    );
    rawText = res.content;
    raw = parseLenient(res.content);
  } catch (e) {
    const r = base();
    r.error = e instanceof LlmError ? e.message : `검토 호출 실패: ${(e as Error).message}`;
    r.rawResponse = rawText;
    return finish(r);
  }

  let parsed;
  try {
    parsed = parseReviewJson(raw, { segments: input.segments, refLabels: input.refLabels, candidates: input.candidates, claimTypeOf });
  } catch (e) {
    const r = base();
    r.error = e instanceof ReviewSchemaError ? `스키마 오류: ${e.message}` : (e as Error).message;
    return finish(r);
  }
  // 근거 인용 확인 (오류 주장만 — correct 는 인용을 생략한다)
  const bySid = new Map(input.segments.map((s) => [s.sid, s]));
  const all = [...input.fullText.values()].join(" ") + (input.facts ? Object.values(input.facts).join(" ") : "");
  for (const c of parsed.claims) {
    if (c.label === "correct" || !c.evidence) continue;
    const seg = bySid.get(c.sid)!;
    c.evidence_verified = quoteMatch(c.evidence, corpusFor(input, seg, c.ref_ids)) !== "none" || quoteMatch(c.evidence, all) !== "none";
  }
  const sc = scoreReview(parsed.claims, parsed.omissions, parsed.structure.length, { passScore: minScoreFor(policy, input.editionType) });
  const r = base();
  Object.assign(r, {
    status: "done",
    verdict: stricter(sc.rubricVerdict, parsed.llmVerdict),
    llmVerdict: parsed.llmVerdict,
    score: sc.score,
    counts: sc.counts,
    breakdown: sc.breakdown,
    claims: parsed.claims,
    fixes: parsed.fixes,
    omissions: parsed.omissions,
    translation: parsed.translation,
    structure: parsed.structure,
    summary: parsed.summary,
    schemaIssues: parsed.schemaIssues,
  });
  return finish(r);
}

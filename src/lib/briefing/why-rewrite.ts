/**
 * 주요 기사 "왜 중요한가"(top_stories[].why)만 규칙 19·20(WHY_RULES)으로 다시 쓰기 — 한 곳에서 (Gate 2).
 * 쓰는 곳:
 *  - scripts/briefing-why-rewrite.ts : 발행본 why 를 새 규칙으로 다시 쓰기 (수동)
 *  - generate.ts                     : 생성 직후 why 에 숫자가 남은 기사 (규칙 20 "숫자 금지")
 *  - review/pipeline.ts              : AI 검토 자동 수정이 why 문장을 지운 기사 — 지우기만 하면 "그래서" 의미가 사라지고
 *                                      사실 한 줄만 남는다 (2026-11-12 사용자 지적: 11-11 판 4·7번)
 * 제목·what·refs 는 바꾸지 않는다. 근거는 그 기사의 ARTICLES 뿐 — 새 문장은 이어지는 AI 검토가 다시 확인한다.
 */
import { WHY_RULES, clipBody } from "./prompt";
import { WHY_MAX } from "./validate";
import { chat, parseJsonContent, BRIEFING_MODEL, BRIEFING_EFFORT } from "./llm";
import type { LlmUsage } from "./types";
import { normalizeKoNames } from "../text/ko-names";

export interface WhyArticle {
  title_kr?: string | null;
  summary_kr?: string | null;
  content_kr?: string | null;
}

export interface WhyStory {
  rank: number;
  subject?: string;
  title: string;
  what: string;
  why: string;
  articles: WhyArticle[];
  /** AI 검토가 문제로 본 내용 — 새 문장에 다시 쓰지 않게 알려 준다 */
  avoid?: string[];
}

/**
 * why 에 숫자(금액·%·배수·횟수·기간)가 있는가 — 규칙 20: why 에는 숫자를 쓰지 않는다.
 * 영문 이름에 붙은 숫자(GLM-6, Qwen4, GPT Image 2.6, Claude Haiku 5.5)는 이름이라 세지 않는다.
 */
export function whyHasNumber(why: string): boolean {
  return /(?<![A-Za-z0-9.\-]|[A-Za-z0-9] )\d/.test(why ?? "");
}

/** 새 why 를 받아도 되는가 (비었거나, 길거나, 숫자가 남았으면 안 됨) */
export function acceptableWhy(why: unknown): why is string {
  return typeof why === "string" && why.trim().length > 0 && why.trim().length <= WHY_MAX && !whyHasNumber(why);
}

export function whySystemPrompt(): string {
  return `당신은 '중국 AI 뉴스' 데일리 브리핑 편집자입니다. 주요 기사마다 "왜 중요한가(why)" 한 칸만 아래 규칙으로 다시 씁니다.
제목·what 은 바꾸지 않습니다. 근거는 각 기사의 ARTICLES(title_kr·summary_kr·body_kr)뿐입니다. 사전 지식으로 사실·수치·인물·날짜를 보태지 마십시오.
why 는 1~2문장 ${WHY_MAX}자 이내(공백 포함, 엄수). why 에는 숫자를 쓰지 않습니다.
avoid 가 있으면 그 내용은 앞선 검토에서 근거가 없거나 지나치다고 본 것입니다. 그 내용을 다시 쓰지 말고, 기사에 있는 말로만 의미를 씁니다.

${WHY_RULES}

출력: JSON 하나만. {"why":{"1":"...","2":"..."}} (키는 rank)`;
}

export function whyUserMessage(stories: WhyStory[]): string {
  return stories
    .map((s) =>
      JSON.stringify({
        rank: s.rank,
        ...(s.subject ? { subject: s.subject } : {}),
        title: s.title,
        what: s.what,
        why_old: s.why,
        ...(s.avoid?.length ? { avoid: s.avoid } : {}),
        ARTICLES: s.articles.map((a) => ({ title_kr: a.title_kr ?? "", summary_kr: a.summary_kr ?? "", body_kr: clipBody(a.content_kr || "") })),
      })
    )
    .join("\n");
}

/** LLM 한 번으로 여러 기사의 why 를 다시 쓴다. 받은 그대로 돌려준다 — 받을지는 호출하는 쪽이 acceptableWhy·재검증으로 정한다 */
export async function rewriteWhys(stories: WhyStory[], track: (u: LlmUsage) => void = () => {}): Promise<Record<number, string>> {
  if (!stories.length) return {};
  const res = await chat(
    { model: BRIEFING_MODEL, effort: BRIEFING_EFFORT, system: whySystemPrompt(), messages: [{ role: "user", content: whyUserMessage(stories) }], maxTokens: 4000 },
    track
  );
  const out = (parseJsonContent(res.content) as { why?: Record<string, unknown> }).why ?? {};
  const r: Record<number, string> = {};
  for (const s of stories) {
    const w = out[String(s.rank)];
    if (typeof w === "string" && w.trim()) r[s.rank] = normalizeKoNames(w.replace(/\s+/g, " ").trim());
  }
  return r;
}

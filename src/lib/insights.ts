/**
 * AI 인사이트 두 단계 (2026-11-04, 제안 2 — 실험 ~/ainews-reports/insight-easy-2026-11/TWO-LEVEL.md).
 *
 *  - ai_insights_*        = 쉬운 단계 (기본 표시, 일반 독자)
 *  - ai_insights_detail_* = "자세히" 단계 (업계 시사점, 펼쳐서 봄)
 *  - key_terms            = 원문에 나온 어려운 중국어 용어 2~3개, 쉬운 설명
 *
 * 생성은 n8n 수집 워크플로 「AI Agent - Insights」가 한다. 프롬프트 원본은 이 파일(INSIGHT_SYSTEM)이고,
 * n8n 노드에는 scripts/n8n-insight-prompt.ts 가 이 문구를 넣는다 — 밤 보정(scripts/insight-fix.ts)도 같은 문구·같은 입력
 * (insightUserMessage)을 쓴다 (Gate 2: 같은 결과 = 같은 함수).
 *
 * 저장 때 검사(/api/news/upsert → cleanInsightItem + insightFlags):
 *  - 한국어·영어 필드의 괄호 속 한자 병기 "(座舱)" 는 지운다(결정적, 안전).
 *  - 남은 한자·원문에 없는 숫자·숫자 표기 오류·길이 초과·원문에 없는 용어는 지우지 않고 insight_flags 에 표시만 한다.
 *    → 밤 보정이 다시 만든다. 수집 흐름을 늦추지 않으려고 n8n 안에서 재시도하지 않는다.
 *
 * 이 파일은 DB 를 부르지 않는다(단위 테스트·스크립트용).
 */

import { dropHanInsideParens, HAN_RE } from "./text/han";

export const INSIGHT_VERSION = "ins-v2";

export const INSIGHT_SYSTEM = `You write for a news site whose strength is explaining Chinese AI news so that general readers understand it, while still giving industry readers real substance.

Respond ONLY in valid JSON (no markdown) with exactly these fields:
ai_insights_kr, ai_insights_en, ai_insights_cn, ai_insights_detail_kr, ai_insights_detail_en, ai_insights_detail_cn, key_terms.

A) ai_insights_* = EASY level (shown by default). 2-3 sentences. Korean 110-190 characters (hard limit 200).
  - Sentence 1: the core point in plain words with the single most important concrete fact (who did what; at most ONE number, written exactly as in the article and attached to exactly the thing the article attaches it to).
  - Sentence 2: what changes and for whom (users, developers, companies, investors, workers), only as far as the article supports.
  - Optional sentence 3: the main limitation or open question the article itself raises.
  - No jargon or English abbreviations (token, parameter, SoC, TOPS, OTA, API, CPI, retention, routing, valuation, round ...). No filler ("일반 독자에게 중요합니다", "관심을 가질 만합니다", "살펴볼 필요가 있습니다").
B) ai_insights_detail_* = DETAIL level (shown when the reader taps "more"). 3-4 sentences. Korean 180-320 characters (hard limit 340).
  - For readers who want depth: mechanism, key numbers (up to 4), who gains or loses in the industry, and what to watch next.
  - Industry terms are allowed, but explain each on first use in a few words in parentheses.
  - Do NOT repeat the easy level; add new information.
  - Everything must be grounded in the article. Forecasts, judgments and comparisons must be the article's own and attributed ("기사는 ~라고 본다"). Never invent facts, numbers, causes or industry-wide trends. Do not turn "one of the reasons" into "mainly because".
  - Copy every number exactly as written in the article (same digits, same unit, same thing it refers to). Never merge two numbers ("15、19层" is "15층과 19층", not "1,5층").
C) key_terms: exactly 2-3 items. Each "term" MUST be a Chinese word or phrase that literally appears in the Chinese article text (not English abbreviations, not company or product names, not everyday words like 代码, 自然语言, 数据中心, 应用). Fields: term, pinyin (tone marks), explanation_kr, explanation_en, explanation_zh.
  - Each explanation = one plain sentence of meaning (everyday words, at most one daily-life comparison) + one short sentence on its role in THIS article (no new facts).
  - Korean 50-110 characters; English 20-45 words; Chinese 30-70 characters.
Korean rules for every *_kr field: polite and concise (~합니다/~입니다). ABSOLUTELY NO Chinese characters (한자), not even in parentheses — write Chinese company, product and term names in the Korean name used by Korean media or in Korean reading (宇树 → 유니트리, 短剧 → 숏드라마, 座舱 → 차량 실내 스마트 시스템; if unsure of a company's Korean name, use its English name). English fields: no Chinese characters either. Chinese fields: simplified Chinese.`;

export interface InsightSource {
  title_cn?: string | null;
  summary_cn?: string | null;
  summary_kr?: string | null;
  content_cn?: string | null;
}

/** n8n 「AI Agent - Insights」의 user 메시지와 같은 모양 (scripts/n8n-insight-prompt.ts 가 같은 식으로 만든다) */
export function insightUserMessage(a: InsightSource): string {
  return (
    "다음 뉴스를 분석하세요:\n\n제목: " +
    (a.title_cn ?? "") +
    "\n요약: " +
    (a.summary_cn || a.summary_kr || "") +
    "\n본문: " +
    (a.content_cn ? a.content_cn.substring(0, 3000) : "")
  );
}

export const EASY_MAX = 220;
export const DETAIL_MAX = 380;

/** 한자 판정·괄호 정리는 규칙 원본 src/lib/text/han.ts 를 쓴다 (Gate 2) */
const HAN_ONE = /[\u3400-\u9fff\uf900-\ufaff]/;

/** 괄호 속 한자를 지운다: "시스템(座舱)의" → "시스템의", "캡컷(剪映 국제판)" → "캡컷(국제판)" */
export function stripHanParens(s: string): string {
  return dropHanInsideParens(s);
}

type Term = { term?: unknown; pinyin?: unknown; explanation_kr?: unknown; explanation_en?: unknown; explanation_zh?: unknown };

const str = (v: unknown) => (typeof v === "string" ? v : "");

/** 한국어·영어 인사이트·용어 설명의 괄호 속 한자를 지운다. 바뀐 값만 덮어쓴 새 객체를 돌려준다 (순수) */
export function cleanInsightItem<T extends Record<string, unknown>>(item: T): T {
  const out: Record<string, unknown> = { ...item };
  for (const k of ["ai_insights_kr", "ai_insights_en", "ai_insights_detail_kr", "ai_insights_detail_en"]) {
    if (typeof out[k] === "string") out[k] = stripHanParens(out[k] as string);
  }
  if (Array.isArray(out.key_terms)) {
    out.key_terms = (out.key_terms as Term[]).map((t) =>
      t && typeof t === "object"
        ? {
            ...t,
            ...(typeof t.explanation_kr === "string" ? { explanation_kr: stripHanParens(t.explanation_kr) } : {}),
            ...(typeof t.explanation_en === "string" ? { explanation_en: stripHanParens(t.explanation_en) } : {}),
          }
        : t
    );
  }
  return out as T;
}

export type InsightFlag =
  | { kind: "han"; field: string; sample: string }
  | { kind: "number"; field: string; value: string }
  | { kind: "number_format"; field: string; value: string }
  | { kind: "length"; field: string; length: number }
  | { kind: "missing_detail" }
  | { kind: "term_not_in_source"; term: string }
  | { kind: "term_not_chinese"; term: string };

/** 숫자 비교용: 쉼표·공백을 지운 숫자열들 */
function sourceNumbers(text: string): Set<string> {
  return new Set((text.replace(/(\d),(?=\d{3})/g, "$1").match(/\d+(?:\.\d+)?/g) ?? []).map((n) => n));
}

/**
 * 저장 전 검사 (순수). 문제가 없으면 []. 원문(content_cn)이 없으면 숫자·용어 검사는 건너뛴다(근거 없이 표시하지 않음).
 *  - han: 한국어 필드에 남은 한자 (괄호 병기는 cleanInsightItem 이 이미 지움)
 *  - number: 한국어 쉬운·자세히 필드의 두 자리 이상 숫자가 원문·제목·요약에 없음 (한 자리 숫자는 "1분기" 같은 표기 차이가 많아 보지 않음)
 *  - number_format: "1,5층"처럼 쉼표 뒤 세 자리가 아닌 숫자 (두 숫자를 붙여 쓴 오기)
 *  - length: 쉬운 > EASY_MAX, 자세히 > DETAIL_MAX
 *  - missing_detail: 쉬운 단계는 있는데 자세히가 없음 (ins-v2 생성분만 — 호출하는 쪽이 판단해 넘김)
 *  - term_not_in_source / term_not_chinese: 용어가 원문에 없거나 중국어가 아님
 */
export function insightFlags(
  item: Record<string, unknown>,
  src: InsightSource & { title_kr?: string | null },
  opts: { expectDetail?: boolean } = {}
): InsightFlag[] {
  const flags: InsightFlag[] = [];
  const easy = str(item.ai_insights_kr);
  const detail = str(item.ai_insights_detail_kr);
  const terms = Array.isArray(item.key_terms) ? (item.key_terms as Term[]) : [];

  const krFields: [string, string][] = [
    ["ai_insights_kr", easy],
    ["ai_insights_detail_kr", detail],
    ...terms.map((t, i) => [`key_terms[${i}].explanation_kr`, str(t?.explanation_kr)] as [string, string]),
  ];
  for (const [field, text] of krFields) {
    const m = text.match(HAN_RE);
    if (m) flags.push({ kind: "han", field, sample: [...new Set(m)].join("").slice(0, 12) });
  }

  for (const [field, text] of [["ai_insights_kr", easy], ["ai_insights_detail_kr", detail]] as const) {
    for (const m of text.matchAll(/\d+,\d{1,2}(?!\d)/g)) flags.push({ kind: "number_format", field, value: m[0] });
  }

  const cn = str(src.content_cn);
  if (cn) {
    const srcText = [src.title_cn, src.summary_cn, src.summary_kr, src.title_kr, cn].map(str).join(" ");
    const nums = sourceNumbers(srcText);
    for (const [field, text] of [["ai_insights_kr", easy], ["ai_insights_detail_kr", detail]] as const) {
      const seen = new Set<string>();
      for (const n of text.replace(/(\d),(?=\d{3})/g, "$1").match(/\d+(?:\.\d+)?/g) ?? []) {
        if (n.length < 2 || seen.has(n)) continue;
        seen.add(n);
        if (!nums.has(n)) flags.push({ kind: "number", field, value: n });
      }
    }
    const cnText = [src.title_cn, src.summary_cn, cn].map(str).join(" ");
    for (const t of terms) {
      const term = str(t?.term).trim();
      if (!term) continue;
      if (!HAN_ONE.test(term)) flags.push({ kind: "term_not_chinese", term });
      else if (!cnText.includes(term)) flags.push({ kind: "term_not_in_source", term });
    }
  }

  if (easy.length > EASY_MAX) flags.push({ kind: "length", field: "ai_insights_kr", length: easy.length });
  if (detail.length > DETAIL_MAX) flags.push({ kind: "length", field: "ai_insights_detail_kr", length: detail.length });
  if (opts.expectDetail && easy && !detail) flags.push({ kind: "missing_detail" });
  return flags;
}

/** 깃발 무게 (밤 보정이 새 결과를 받아들일지 판단: 무게가 줄 때만 바꾼다) */
export function flagWeight(flags: InsightFlag[]): number {
  const w: Record<InsightFlag["kind"], number> = {
    han: 3,
    number: 3,
    number_format: 3,
    term_not_in_source: 2,
    term_not_chinese: 2,
    missing_detail: 2,
    length: 1,
  };
  return flags.reduce((n, f) => n + w[f.kind], 0);
}

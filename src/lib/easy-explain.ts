/**
 * 기사 상세 "쉽게 풀어보기" (2026-11-10 사용자 결정: 사이트 강점 = 쉽게 설명해 준다).
 *
 * 기사 상세 = ① 요약(사실, summary_*) + ② 쉽게 풀어보기 { 쉽게 말하면(ai_easy_*) · 왜 중요할까(ai_why_*) }
 *   + 접힌 "더 깊이 보기"(ai_insights_detail_*, 업계 시사점). 번역 요지는 화면에서 뺀다.
 * - 새 열(ai_easy_* · ai_why_*)에만 쓴다. 기존 ai_insights_* (브리핑 후보 입력·예전 화면)는 그대로.
 * - 모델: Sonnet 5.5 (실험 8건 블라인드 평가에서 쉬움 4.5 · 새 의미 4.3 · 최고 7/8, ~/ainews-reports/easy-article-2026-11).
 * - 생성은 scripts/easy-explain-run.ts. 저장 전 검사(easyFlags)는 순수 함수 — 단위 테스트.
 * 이 파일은 DB 를 부르지 않는다.
 */
import { HAN_RE, dropHanInsideParens } from "./text/han";

export const EASY_VERSION = "easy-v1";
export const EASY_MODEL = process.env.EASY_EXPLAIN_MODEL || "anthropic-api-sonnet-5-5";

export const EASY_SYSTEM = `당신은 어린이 신문 기자입니다. 중국·세계 AI 뉴스 한 건을, 이미 화면에 있는 '요약'(SUMMARY)과 겹치지 않게, 초등학교 5~6학년도 이해할 수 있도록 풀어 줍니다. 한국어·영어·중국어 세 언어로 같은 뜻을 씁니다.

JSON 하나만 출력합니다(마크다운 금지):
{"easy_kr":"","why_kr":"","easy_en":"","why_en":"","easy_cn":"","why_cn":""}

easy_* = "쉽게 말하면" (2~3문장. 한국어 90~170자, 영어 35~70단어, 중국어 60~120자)
- 이 기사가 '무슨 뜻'인지 설명합니다. 요약에 있는 사실(누가·언제·숫자)을 다시 늘어놓지 않습니다.
- 낯선 개념이 있으면 아이가 아는 것(학교·집·놀이·가게·운동)에 빗댄 비유를 딱 하나 씁니다. 비유가 상황과 맞지 않거나 뜻을 틀리게 만들면 비유 없이 쉬운 말로만 씁니다.
- 숫자는 쓰지 않는 것이 기본입니다. 꼭 필요하면 원문 숫자 하나만 그대로 씁니다.

why_* = "왜 중요할까" (1~2문장. 한국어 60~130자, 영어 25~55단어, 중국어 40~90자)
- 이 일로 사람들(우리 생활, 일하는 사람, 회사, 나라)에게 무엇이 달라질 수 있는지를 기사가 말하는 범위 안에서 씁니다.
- 기사가 하지 않은 예측·평가·업계 전체 이야기를 지어내지 않습니다. 효과가 일부에만 해당하면 '일부'라고 씁니다. 기사의 판단이면 "기사는 ~라고 봐요"처럼 기사의 말로 씁니다.

공통
- 한국어는 친근한 해요체, 쉬운 우리말. 영어는 쉬운 단어(초등 고학년 수준), 중국어는 간체·쉬운 표현.
- 영어 약어와 전문용어(토큰, 파라미터, ETF, 레버리지, 에이전트, 추론 등)는 쓰지 않고 쉬운 말로 바꿉니다. 꼭 써야 하면 바로 뒤 괄호에 쉬운 풀이를 붙입니다.
- 한국어·영어에는 한자를 쓰지 않습니다. 회사·제품 이름은 SUMMARY 에 나온 표기를 그대로 씁니다.
- 모든 내용은 원문(ORIGINAL)에 근거해야 합니다. 새 사실·숫자·원인을 만들지 않습니다.`;

export interface EasySource {
  title_kr?: string | null;
  title_cn?: string | null;
  summary_kr?: string | null;
  summary_cn?: string | null;
  content_cn?: string | null;
}

export function easyUserMessage(a: EasySource): string {
  return `TITLE: ${a.title_kr ?? ""}\nSUMMARY: ${a.summary_kr || a.summary_cn || ""}\nORIGINAL (중국어):\n${a.title_cn ?? ""}\n${(a.content_cn ?? "").slice(0, 3000)}`;
}

export const EASY_FIELDS = ["easy_kr", "why_kr", "easy_en", "why_en", "easy_cn", "why_cn"] as const;
export type EasyField = (typeof EASY_FIELDS)[number];
export type EasyResult = Record<EasyField, string>;

/** 모델 출력 → 결과 (필드가 하나라도 비면 null). 한국어·영어의 괄호 속 한자는 지운다 */
export function toEasyResult(raw: unknown): EasyResult | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const out = {} as EasyResult;
  for (const f of EASY_FIELDS) {
    const v = typeof o[f] === "string" ? (o[f] as string).trim() : "";
    if (!v) return null;
    out[f] = f.endsWith("_cn") ? v : dropHanInsideParens(v);
  }
  return out;
}

export type EasyFlag =
  | { kind: "han"; field: EasyField; sample: string }
  | { kind: "number"; field: EasyField; value: string }
  | { kind: "length"; field: EasyField; length: number }
  | { kind: "abbr"; field: EasyField; value: string };

/** 한국어 글자 수 상한 (지시문 상한 + 여유) */
const KO_MAX: Partial<Record<EasyField, number>> = { easy_kr: 210, why_kr: 160 };

function numbers(text: string): string[] {
  return text.replace(/(\d),(?=\d{3})/g, "$1").match(/\d+(?:\.\d+)?/g) ?? [];
}

/**
 * 저장 전 검사 (순수). 문제가 있어도 저장은 하고 깃발만 단다 — 화면은 han·number 깃발이 있는 한국어 풀이를 숨긴다(easyShowable).
 *  - han: 한국어·영어에 한자
 *  - number: 두 자리 이상 숫자가 원문·제목·요약에 없음
 *  - length: 한국어 상한 초과
 *  - abbr: 한국어에 풀이 없는 영어 약어(대문자 2자 이상, 바로 뒤 괄호 없음) — 회사·제품 이름도 걸릴 수 있어 참고용
 */
export function easyFlags(r: EasyResult, src: EasySource): EasyFlag[] {
  const flags: EasyFlag[] = [];
  const pool = new Set(numbers([src.title_cn, src.title_kr, src.summary_kr, src.summary_cn, src.content_cn].filter(Boolean).join(" ")));
  for (const f of EASY_FIELDS) {
    const t = r[f];
    if (!f.endsWith("_cn")) {
      const m = t.match(HAN_RE);
      if (m) flags.push({ kind: "han", field: f, sample: [...new Set(m)].join("").slice(0, 8) });
    }
    if (src.content_cn) for (const n of numbers(t)) if (n.length >= 2 && !pool.has(n)) flags.push({ kind: "number", field: f, value: n });
    const max = KO_MAX[f];
    if (max && t.length > max) flags.push({ kind: "length", field: f, length: t.length });
    if (f.endsWith("_kr")) for (const m of t.matchAll(/\b[A-Z]{2,}\b(?!\s*\()/g)) if (m[0] !== "AI") flags.push({ kind: "abbr", field: f, value: m[0] });
  }
  return flags;
}

/** 이 언어의 풀이를 화면에 보여도 되는지 (한자·없는 숫자 깃발이 그 언어 필드에 있으면 숨김) */
export function easyShowable(flags: EasyFlag[] | null | undefined, lang: "kr" | "en" | "cn"): boolean {
  return !(flags ?? []).some((f) => (f.kind === "han" || f.kind === "number") && f.field.endsWith(`_${lang}`));
}

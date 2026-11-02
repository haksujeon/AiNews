/**
 * 한국어(·영어) 텍스트의 한자 잔존 검사 — 규칙 원본 (P0-5, Gate 2).
 *
 * 같은 규칙을 쓰는 곳:
 *  - 데일리 브리핑 검증 han_in_ko (briefing/validate.ts, 주간·월간 periodic/validate.ts 는 HAN_RE 재수출을 씀)
 *  - 번역 재검증 (briefing/translate.ts: en 에 한자 없음)
 *  - 기사 백필 (scripts/han-backfill.ts)
 *  - n8n 수집 단계의 중국어 잔존 검사 Code 노드도 이 파일과 같은 값으로 맞춘다 (규칙 원본 = src/lib/text/han.ts)
 *
 * 괄호 병기 허용: `위첸(于谦)`, `량원펑(梁文锋)` 처럼 괄호 안에 원어를 덧붙인 것은 잔존으로 보지 않는다
 * (allowParenthetical, 기본 true). 브리핑 본문 검증은 예전처럼 괄호 안 한자도 경고하므로 false 로 부른다.
 *
 * 이 파일은 DB·node:* 를 import 하지 않는다.
 */

/**
 * 한자: 확장 A·통합 한자(U+3400–9FFF) + 호환 한자(U+F900–FAFF). 전역(/g) 정규식이라 .test() 대신 match/matchAll 로 쓴다.
 * 범위는 \u 이스케이프로만 쓴다 — 글자로 쓰면 모양이 같은 다른 코드포인트(豈 U+8C48 과 U+F900)가 섞여 한글까지 걸린다.
 */
export const HAN_RE = /[㐀-鿿豈-﫿]/g;
/** 한글 (음절 + 자모 + 호환 자모) */
export const HANGUL_RE = /[가-힯ᄀ-ᇿ㄰-㆏]/;

const HAN_RUN = /[㐀-鿿豈-﫿]+/g;
const HAN_CHAR = /[㐀-鿿豈-﫿]/;
/** 비율 분모: 한자·한글·라틴 글자 */
const LETTER_RE = /[㐀-鿿豈-﫿가-힯ᄀ-ᇿ㄰-㆏A-Za-z]/g;

export interface HanOptions {
  /** 괄호 (…)·（…） 안의 한자는 허용 (기본 true) */
  allowParenthetical?: boolean;
}

export interface HanToken {
  text: string;
  index: number;
}

export interface HanResidue {
  /** 잔존 한자 덩어리 (연속한 한자 = 1개), 등장 순서 */
  tokens: string[];
  /** 잔존 한자가 든 문장 */
  sentences: string[];
  /** 잔존 한자 글자 수 / (한자+한글+라틴 글자 수). 글자가 없으면 0 */
  ratio: number;
}

/** 괄호 구간 [start, end) 목록. 짝이 없는 여는 괄호는 문자열 끝까지로 보지 않는다(무시) */
function parenRanges(text: string): [number, number][] {
  const out: [number, number][] = [];
  const stack: number[] = [];
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === "(" || ch === "（") stack.push(i);
    else if ((ch === ")" || ch === "）") && stack.length) {
      const start = stack.pop()!;
      if (!stack.length) out.push([start, i + 1]); // 가장 바깥 괄호만
    }
  }
  return out;
}

/** 잔존 한자 덩어리와 위치 */
export function hanTokens(text: string, opts: HanOptions = {}): HanToken[] {
  const allowParen = opts.allowParenthetical ?? true;
  const ranges = allowParen ? parenRanges(text) : [];
  const out: HanToken[] = [];
  for (const m of text.matchAll(HAN_RUN)) {
    const i = m.index ?? 0;
    if (ranges.some(([s, e]) => i >= s && i < e)) continue;
    out.push({ text: m[0], index: i });
  }
  return out;
}

const SENTENCE_RE = /[^.!?。！？\n]+[.!?。！？]*/g;

export function hanResidue(text: string | null | undefined, opts: HanOptions = {}): HanResidue {
  const t = text ?? "";
  const toks = hanTokens(t, opts);
  if (!toks.length) return { tokens: [], sentences: [], ratio: 0 };
  const sentences: string[] = [];
  for (const m of t.matchAll(SENTENCE_RE)) {
    const s = m.index ?? 0;
    const e = s + m[0].length;
    if (toks.some((k) => k.index >= s && k.index < e)) sentences.push(m[0].trim());
  }
  const residual = toks.reduce((n, k) => n + k.text.length, 0);
  const letters = (t.match(LETTER_RE) ?? []).length;
  return {
    tokens: toks.map((k) => k.text),
    sentences,
    ratio: letters ? Math.round((residual / letters) * 10000) / 10000 : 0,
  };
}

/** 한자가 한 글자라도 있는지 (괄호 병기 포함) */
export function hasHan(text: string | null | undefined): boolean {
  return !!text && HAN_CHAR.test(text);
}

// ───────────────────────── 백필 단계 분류 (scripts/han-backfill.ts)

/** 2단계 결정적 치환 대상의 최대 한자 길이 */
export const HAN_SHORT_MAX = 4;

export type HanStage = 0 | 1 | 2 | 3;

export interface HanClassification {
  /**
   * 0 = 한자 없음, 1 = 괄호 병기만(고치지 않음), 2 = 남은 덩어리가 모두 사전 치환 가능(4자 이하),
   * 3 = 그 밖(중국어 문장·사전에 없는 이름) → 해당 필드만 LLM 재번역
   */
  stage: HanStage;
  tokens: string[];
  /** 2단계 치환을 적용한 텍스트 (3단계도 사전 치환 가능한 덩어리는 먼저 바꾼 값). 바꿀 게 없으면 원문 */
  fixed: string;
  /** 적용한 치환 [원어, 한국어] */
  replaced: [string, string][];
}

/** 낱말 끝 받침 종류: 'none'(모음·라틴·숫자로 끝남) / 'rieul'(ㄹ) / 'other' */
function finalOf(word: string): "none" | "rieul" | "other" {
  const code = word.charCodeAt(word.length - 1);
  if (code < 0xac00 || code > 0xd7a3) return "none"; // SMIC·TSMC 처럼 라틴으로 끝나면 모음으로 본다
  const jong = (code - 0xac00) % 28;
  return jong === 0 ? "none" : jong === 8 ? "rieul" : "other";
}

const PARTICLES: [string, string][] = [
  ["으로", "로"], // [받침 있음, 받침 없음] — ㄹ 받침은 "로"
  ["은", "는"],
  ["이", "가"],
  ["을", "를"],
  ["과", "와"],
];
const HANGUL_SYLLABLE = /[가-힣]/;

/**
 * 치환한 낱말 바로 뒤의 조사를 새 낱말 받침에 맞춘다 (科大讯飞가 → 아이플라이텍이, 千问는 → 치엔원은).
 * 조사 뒤가 한글 음절이면(가격·이다 등) 조사가 아니므로 건드리지 않는다.
 */
function agreeParticle(word: string, rest: string): { from: string; to: string } | null {
  const fin = finalOf(word);
  for (const [withFinal, noFinal] of PARTICLES) {
    for (const p of [withFinal, noFinal]) {
      if (!rest.startsWith(p)) continue;
      const after = rest.charAt(p.length);
      if (after && HANGUL_SYLLABLE.test(after)) continue;
      const to = withFinal === "으로" ? (fin === "other" ? "으로" : "로") : fin === "none" ? noFinal : withFinal;
      return to === p ? null : { from: p, to };
    }
  }
  return null;
}

/**
 * 괄호 밖 한자 덩어리 중 사전에 정확히 일치하는 4자 이하 덩어리만 바꾼다. 바로 뒤 조사는 새 낱말 받침에 맞춘다.
 * (덩어리 일부만 맞는 경우 — 华为云 — 는 바꾸지 않는다: 잘못된 부분 치환을 막기 위해)
 */
export function applyHanGlossary(text: string, glossary: ReadonlyMap<string, string>): { text: string; replaced: [string, string][] } {
  const toks = hanTokens(text, { allowParenthetical: true });
  const replaced: [string, string][] = [];
  let out = "";
  let last = 0;
  for (const k of toks) {
    const ko = k.text.length <= HAN_SHORT_MAX ? glossary.get(k.text) : undefined;
    if (!ko) continue;
    out += text.slice(last, k.index) + ko;
    last = k.index + k.text.length;
    // 조사 맞춤: 조사 글자(최대 2자)만 바꾸고 그만큼만 건너뛴다 (뒤에 오는 한자 덩어리 위치는 그대로)
    const fix = agreeParticle(ko, text.slice(last, last + 3));
    if (fix) {
      out += fix.to;
      last += fix.from.length;
    }
    replaced.push([k.text, ko]);
  }
  return { text: out + text.slice(last), replaced };
}

export function classifyHan(text: string | null | undefined, glossary: ReadonlyMap<string, string>): HanClassification {
  const t = text ?? "";
  if (!hasHan(t)) return { stage: 0, tokens: [], fixed: t, replaced: [] };
  const tokens = hanResidue(t).tokens;
  if (!tokens.length) return { stage: 1, tokens, fixed: t, replaced: [] };
  const { text: fixed, replaced } = applyHanGlossary(t, glossary);
  const left = hanResidue(fixed).tokens;
  return { stage: left.length ? 3 : 2, tokens, fixed, replaced };
}

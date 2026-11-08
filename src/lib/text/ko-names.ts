/**
 * 한국어 본문의 회사·제품 이름과 AI 용어 표기를 하나로 맞춘다 (표기 사전 ko-glossary.ts 의 fix → ko).
 *
 * 한자 사전(han-glossary)은 한자 덩어리만 바꾸므로, 한글로 잘못 옮긴 표기("유수과기"·"구현지능"·"월지암면")는 여기서 고친다.
 * 기사 저장(api/news/upsert)·데일리/주간/월간(validate.ts glossHanText)·히스토리 분석(story-gen toKoRow)·쉬운 AI 설명(easy-terms)·
 * 일괄 정리(scripts/ko-names-backfill.ts)가 이 함수 하나를 쓴다 (Gate 2).
 *
 * - 긴 표기부터 바꾼다: 월지암면 → 월지암 → 문샷 AI → 맨 "문샷".
 * - 여러 번 돌려도 같은 결과(멱등). 이미 바른 표기("문샷AI")의 앞부분이 잘못된 표기("문샷")와 같아도 건드리지 않는다.
 * - 3자 이하 한글 표기("상탕"·"출해"·"지능체")는 낱말 하나로 쓰였을 때만 고친다 (앞에 한글 없음, 뒤는 조사만) — "산출해"·"지능체계"를 지키려고.
 * - 바꾼 표기 바로 뒤(괄호 설명이 끼어도)의 조사는 새 표기의 받침에 맞춘다: 이↔가 · 은↔는 · 을↔를 · 과↔와 · 으로↔로.
 * - 바꾼 뒤 "피지컬 AI(피지컬 AI)"·"피지컬 AI 피지컬 AI"·"AI AI 에이전트" 처럼 같은 표기가 겹치면 하나로 줄인다.
 * - "중국명 뤄보콰이파오"처럼 원래 이름을 일부러 밝힌 자리는 고치지 않는다.
 * - 영문 회사 이름(2026-11-08 사용자 결정 "A"): 회사·기관 항목의 en 이 혼자 쓰였을 때만 정한 표기로 ("DeepSeek는" → "딥시크는", "DeepSeek 앱" → "딥시크 앱").
 *   뒤에 모델·제품·버전이 붙은 이름("DeepSeek-V4"·"Qwen3"·"MiniMax M3"·"DeepSeek Harness")과 "딥시크(DeepSeek)"처럼 원래 이름을 밝힌 괄호는 그대로.
 */
import { KO_GLOSSARY } from "./ko-glossary";

interface Rule {
  re: RegExp;
  to: string;
  /** 영문 이름 규칙: "딥시크(DeepSeek)" 처럼 정한 표기 바로 뒤 괄호 안이면 그대로 */
  latin?: true;
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** 표기 안 띄어쓰기는 있어도 없어도 같은 것으로 본다 */
const pat = (s: string) => esc(s).replace(/ /g, "\\s?");
const HANGUL_ONLY = /^[가-힣]+$/;
const PARTICLES = "으로|로|이|가|은|는|을|를|과|와";
/** 짧은 표기 뒤에 와도 되는 것: 조사·복수(들) */
const TAIL_OK = "(?:들)?(?:은|는|이|가|을|를|의|과|와|도|에서|에게|에|으로|로|만|까지|부터|처럼|보다|이다|이며|이고|이자|라는|이라는)?";

/** 영문 이름 앞: 영문·숫자·주소 기호가 붙어 있으면 다른 낱말·주소의 일부 ("@DeepSeek"·"deepseek.com"·"api.DeepSeek") */
const LATIN_HEAD = "(?<![A-Za-z0-9@/._-])";
/** 영문 이름 뒤에 모델·제품·버전이 붙지 않음: 영문·숫자가 바로/띄어/하이픈으로 오면 "DeepSeek-V4"·"MiniMax M3"·"DeepSeek Harness" — 그대로 둔다 */
const LATIN_TAIL = "(?![A-Za-z0-9]|\\s?[-–_/]\\s?[A-Za-z0-9]|\\.[A-Za-z0-9]|\\s[A-Za-z0-9])";
/** 영문 이름을 바꿀 항목: 회사·기관 중 정한 표기가 한글이고, 다른 뜻과 겹치지 않는 것(noAlias 제외 — Fourier) */
/** 영문 이름 규칙이 보는 영문 이름 목록 (일괄 정리 스크립트의 행 거르기도 이 목록을 쓴다, Gate 2) */
export function latinNameSources(): string[] {
  return latinPairs().map((p) => p.from);
}
const latinPairs = () =>
  KO_GLOSSARY.filter((e) => (e.kind === "company" || e.kind === "org") && e.en && /^[가-힣]/.test(e.ko) && !e.noAlias && e.en !== e.ko).map((e) => ({ from: e.en as string, to: e.ko }));

/** 사전 밖 규칙 (문맥이 있어야 정할 수 있는 것) */
const EXTRA: { re: string; to: string }[] = [
  // 具身机器人 → "피지컬 AI 로봇" (2026-11-06 결정)
  { re: "(?<![가-힣])구현형\\s?로봇", to: "피지컬 AI 로봇" },
  { re: "(?<![가-힣])구현형\\s?대모델", to: "피지컬 AI 대형 모델" },
  { re: "(?<![가-힣])구현형\\s?모델", to: "피지컬 AI 모델" },
  { re: "(?<![가-힣])체화\\s?로봇", to: "피지컬 AI 로봇" },
  // 文心 5.5 → 어니 5.5, 混元3 → 훈위안3 (숫자 앞일 때만 — '문심'·'혼원' 단독은 다른 뜻일 수 있다)
  { re: "(?<![가-힣])문심(?=\\s?\\d)", to: "어니" },
  { re: "(?<![가-힣])혼원(?=\\s?\\d)", to: "훈위안" },
];

function buildRules(): Rule[] {
  const pairs: { from: string; to: string; short: boolean }[] = [];
  for (const e of KO_GLOSSARY) for (const f of e.fix ?? []) pairs.push({ from: f, to: e.ko, short: HANGUL_ONLY.test(f) && f.length <= 3 });
  pairs.sort((a, b) => b.from.length - a.from.length);
  const rules: Rule[] = EXTRA.map((x) => ({ re: new RegExp(`${x.re}(\\([^()]{0,40}\\))?(${PARTICLES})?(?![가-힣])|${x.re}`, "g"), to: x.to }));
  for (const p of pairs) {
    const head = /^[가-힣]/.test(p.from) ? "(?<![가-힣])" : "(?<![A-Za-z])";
    const body = pat(p.from);
    // 조사 붙은 꼴을 먼저(조사를 바꾸려고), 아니면 맨 표기. 짧은 표기는 맨 표기도 낱말 경계에서만
    const tail = p.short ? `(?=${TAIL_OK}(?![가-힣]))` : "";
    rules.push({ re: new RegExp(`${head}${body}(\\([^()]{0,40}\\))?(${PARTICLES})(?![가-힣])|${head}${body}${tail}`, "g"), to: p.to });
  }
  for (const p of latinPairs().sort((a, b) => b.from.length - a.from.length)) {
    const body = pat(p.from);
    rules.push({ re: new RegExp(`${LATIN_HEAD}${body}(\\([^()]{0,40}\\))?(${PARTICLES})(?![가-힣])|${LATIN_HEAD}${body}${LATIN_TAIL}`, "g"), to: p.to, latin: true });
  }
  return rules;
}

const RULES = buildRules();
const CANONICAL = [...new Set([...KO_GLOSSARY.map((e) => e.ko), ...EXTRA.map((x) => x.to)])].sort((a, b) => b.length - a.length);

/** 받침: 없음 0 / ㄹ 2 / 그 밖 1. 끝의 괄호 설명은 떼고 본다 ("사고 사슬(CoT)" → 사슬) */
function finalSound(word: string): 0 | 1 | 2 {
  const w = word.replace(/\([^()]*\)\s*$/, "").trim();
  const c = w.slice(-1);
  const code = c.charCodeAt(0);
  if (code >= 0xac00 && code <= 0xd7a3) {
    const j = (code - 0xac00) % 28;
    return j === 0 ? 0 : j === 8 ? 2 : 1;
  }
  // 라틴·숫자는 읽는 소리로: L(엘)·R(알) = ㄹ, M(엠)·N(엔) = 받침, 1(일)·7(칠)·8(팔) = ㄹ, 0(영)·3(삼)·6(육) = 받침
  if (/[LlRr178]/.test(c)) return 2;
  if (/[MmNn036]/.test(c)) return 1;
  return 0;
}

function particleFor(word: string, j: string): string {
  const s = finalSound(word);
  const has = s !== 0;
  switch (j) {
    case "이":
    case "가":
      return has ? "이" : "가";
    case "은":
    case "는":
      return has ? "은" : "는";
    case "을":
    case "를":
      return has ? "을" : "를";
    case "과":
    case "와":
      return has ? "과" : "와";
    case "으로":
    case "로":
      return s === 1 ? "으로" : "로";
    default:
      return j;
  }
}

export function normalizeKoNames(text: string): string {
  if (!text) return text;
  let out = text;
  for (const r of RULES) {
    out = out.replace(r.re, (m: string, par: string | undefined, j: string | undefined, offset: number, whole: string) => {
      // 이미 바른 표기의 앞부분이면 그대로 ("문샷AI" 의 "문샷"). 정한 표기가 잘못된 표기의 앞부분인 경우("비렌과기" → "비렌")는 고친다
      const core = m.slice(0, m.length - (par?.length ?? 0) - (j?.length ?? 0));
      if (whole.startsWith(r.to, offset) && r.to.startsWith(core)) return m;
      // 원래 이름을 일부러 밝힌 자리는 그대로 ("아폴로 고(중국명 뤄보콰이파오)")
      if (/(?:중국명|중국 이름|중국어 이름|현지명|원어명|원래 이름)\s?[:：]?\s?$/.test(whole.slice(Math.max(0, offset - 12), offset))) return m;
      // 정한 표기 뒤 괄호 안 영문 이름은 원래 이름을 밝힌 것 ("딥시크(DeepSeek)"·"문샷AI(月之暗面, Moonshot AI)") — 그대로
      if (r.latin && new RegExp(`${pat(r.to)}\\s?\\([^()]{0,40}$`).test(whole.slice(Math.max(0, offset - r.to.length - 42), offset))) return m;
      return j ? `${r.to}${par ?? ""}${particleFor(r.to, j)}` : par !== undefined ? `${r.to}${par}` : r.to;
    });
  }
  for (const c of CANONICAL) {
    const e = esc(c);
    // 겹침 줄이기: "X(X)" → "X", "X X" → "X"
    out = out.replace(new RegExp(`${e}\\s?\\(\\s?${e}\\s?\\)`, "g"), c).replace(new RegExp(`${e}\\s+${e}(?![가-힣A-Za-z])`, "g"), c);
    // 앞 낱말 겹침: "AI 지능체" → "AI AI 에이전트" → "AI 에이전트"
    const first = c.split(" ")[0];
    if (first !== c) out = out.replace(new RegExp(`(?<![가-힣A-Za-z])${esc(first)}\\s+${e}`, "g"), c);
  }
  return out;
}

/** key_terms(배열)의 한국어 설명도 같은 표기로 (기사 저장 때) */
export function normalizeKeyTermsKo<T>(v: T): T {
  if (!Array.isArray(v)) return v;
  return v.map((k) =>
    k && typeof k === "object" && typeof (k as { explanation_kr?: unknown }).explanation_kr === "string"
      ? { ...k, explanation_kr: normalizeKoNames((k as { explanation_kr: string }).explanation_kr) }
      : k
  ) as T;
}

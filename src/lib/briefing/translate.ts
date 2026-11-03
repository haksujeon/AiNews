/**
 * ko → en / zh 값만 번역 + 재검증 (설계 검토서 §3.5).
 *
 *  - 구조(키·배열 길이·순서·refs)는 ko 를 그대로 쓰고, 번역문에서는 텍스트 값만 가져온다.
 *    → 세 언어판의 기사·순서·refs 가 항상 같다.
 *  - 재검증: 필드마다 숫자 집합이 ko 와 같음(억/만 ↔ billion/million/亿/万 크기 환산 후 비교),
 *    en/zh 에 한글 없음, en 에 한자 없음. zh 는 자릿수 문자열까지 그대로(억→亿, 만→万). 원문에 없는 "k" 축약 금지.
 *  - 이름 힌트(중국어 원제)는 숫자를 지워서 준다 (연도·순위가 번역문에 새어 들어가는 것을 막음).
 *  - 실패하면 위반 목록을 주고 1회 수리. 그래도 남으면 그 언어판은 failed (ko 는 영향 없음).
 */
import type { BriefingContent, CandidateGroup, LlmUsage } from "./types";
import { TRANSLATE_EFFORT, TRANSLATE_FALLBACK_EFFORT, TRANSLATE_FALLBACK_MODEL, TRANSLATE_MODEL, chat, parseJsonContent, type Effort } from "./llm";
import {
  buildTranslateRepairPrompt,
  buildTranslateSystemPrompt,
  buildTranslateUserPrompt,
} from "./prompt";
import { citedRefs, normalizeContent } from "./validate";
import { entityMentioned, nameEntriesIn, type Entity, type NameEntry } from "./entities";
import { HANGUL_RE, hanResidue } from "../text/han";
import { canonicalValue, expandRanges, parseQuantities } from "./quantity";

type Target = "en" | "zh";

// ───────────────────────── 숫자 집합

// 수량 파서는 quantity.ts 하나 (Gate 2) — 데일리·주간·월간 숫자 검사와 금액 규칙이 같은 parseQuantities 를 쓴다
export { expandRanges };

/**
 * 텍스트 속 "의미 있는" 수치의 정규화 값 집합.
 * 12 이하 정수는 월·순서·개수처럼 말로 풀어 쓰는 경우가 많아 비교에서 뺀다 (단위·%가 붙으면 포함).
 * 2026-11-02 재감사: 작은 수라도 소수점 표기("飞书10.0" ← 원문 8.0)와 이름에 붙은 수("Genie 4", "GPT-5")는 비교한다.
 * 범위("7~10%", "7-10%", "7%至10%")는 양쪽 수에 단위를 붙여 같은 값으로 본다.
 */
export function numericValues(raw: string): Set<string> {
  return valueSets(raw).sig;
}

/** 중국어 숫자 한 글자 + 큰 단위 ("六万" → "6万", "两亿" → "2亿") — zh 번역이 "约六万名" 처럼 써도 같은 값으로 본다 */
const CN_DIGIT: Record<string, string> = { 一: "1", 二: "2", 两: "2", 三: "3", 四: "4", 五: "5", 六: "6", 七: "7", 八: "8", 九: "9", 十: "10" };
export function cnNumerals(text: string): string {
  return text.replace(/(?<![一二两三四五六七八九十百千\d])([一二两三四五六七八九十])(?=[万亿千])/g, (d) => CN_DIGIT[d]);
}

/**
 * 수치 집합 세 가지 (parseQuantities 하나로):
 *  - sig: 비교 대상 (단위·%·소수점·이름에 붙은 수·12 넘는 수) — 원문 ko 에서 빠지면 안 되는 값
 *  - plain: sig 에서 "이름에 붙은 수" 를 뺀 것 — 번역문에서 덧붙이면 안 되는 값 (영어 문장의 "Q3"·"up 3 points" 는 이름이 아니다)
 *  - all: 모든 수 — 원문의 작은 수가 번역문에 있는지 볼 때
 */
export function valueSets(raw: string): { sig: Set<string>; plain: Set<string>; all: Set<string> } {
  const sig = new Set<string>();
  const plain = new Set<string>();
  const all = new Set<string>();
  for (const q of parseQuantities(expandRanges(cnNumerals(raw)))) {
    const v = canonicalValue(q.value);
    all.add(v);
    const base = q.scaled || q.percent || q.decimal || !Number.isInteger(q.base) || q.base > 12;
    if (base) plain.add(v);
    if (base || q.named) sig.add(v);
  }
  return { sig, plain, all };
}

// ───────────────────────── 필드 대응

interface Field {
  path: string;
  get: (c: BriefingContent) => string | undefined;
  set: (c: BriefingContent, v: string) => void;
}

function fieldsOf(c: BriefingContent): Field[] {
  const f: Field[] = [
    { path: "headline", get: (x) => x.headline, set: (x, v) => (x.headline = v) },
    { path: "lede", get: (x) => x.lede, set: (x, v) => (x.lede = v) },
  ];
  c.top_stories.forEach((_, i) => {
    for (const k of ["subject", "title", "what", "why"] as const) {
      f.push({ path: `top_stories[${i}].${k}`, get: (x) => x.top_stories[i]?.[k], set: (x, v) => (x.top_stories[i][k] = v) });
    }
  });
  c.sections.forEach((sec, j) =>
    sec.items.forEach((_, k) =>
      f.push({
        path: `sections[${j}].items[${k}]`,
        get: (x) => x.sections[j]?.items[k]?.text,
        set: (x, v) => (x.sections[j].items[k].text = v),
      })
    )
  );
  c.key_numbers.forEach((_, i) => {
    for (const k of ["value", "label"] as const) {
      f.push({ path: `key_numbers[${i}].${k}`, get: (x) => x.key_numbers[i]?.[k], set: (x, v) => (x.key_numbers[i][k] = v) });
    }
  });
  c.companies_to_watch.forEach((_, i) => {
    for (const k of ["name", "why"] as const) {
      f.push({
        path: `companies_to_watch[${i}].${k}`,
        get: (x) => x.companies_to_watch[i]?.[k],
        set: (x, v) => (x.companies_to_watch[i][k] = v),
      });
    }
  });
  c.clusters.forEach((_, i) =>
    f.push({ path: `clusters[${i}].story`, get: (x) => x.clusters[i]?.story, set: (x, v) => (x.clusters[i].story = v) })
  );
  return f;
}

function shapeOf(c: BriefingContent): string {
  return JSON.stringify([
    c.top_stories.length,
    c.sections.map((s) => s.items.length),
    c.key_numbers.length,
    c.companies_to_watch.length,
    c.clusters.length,
  ]);
}

// ───────────────────────── 이름 (번역 이름표 대조)

const lc = (s: string) => s.toLowerCase();
/** 한국어 별칭이 낱말 앞에서 시작하나 ("공통의" 의 "통의" 는 알리바바 통의가 아님) */
function koAliasAt(alias: string, text: string): boolean {
  // 낱말 하나로 쓰였나: 앞은 한글이 아니고, 뒤는 한글이 아니거나 조사만 ("애플 인텔리전스" 의 "인텔" 은 인텔이 아님 — round 2 재생성 10-31 zh)
  const esc = alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?<![가-힣])${esc}(?:은|는|이|가|을|를|의|과|와|도|에서|에게|에|으로|로|만|까지|부터|처럼)?(?![가-힣])`).test(text);
}

/** 번역문이 이름표의 표기를 썼나 (en: 라틴 표기 또는 여러 낱말 표기의 4자 이상 낱말, zh: 한자·라틴 표기 또는 3자 이상 한자 이름의 앞 2자) */
function nameRendered(entry: NameEntry, entity: Entity | null, out: string, target: Target): boolean {
  if (entity && entityMentioned(entity, out)) return true;
  const en = entry.en.some((a) => lc(out).includes(lc(a)) || a.split(/\s+/).some((w) => w.length >= 4 && lc(out).includes(lc(w))));
  if (target === "en") return en;
  return en || entry.zh.some((z) => out.includes(z) || (z.length >= 3 && out.includes(z.slice(0, 2))));
}

/**
 * 번역문의 기업·제품 이름이 이름표와 같은가. ko 필드에 나오는 실체(정부·기관 묶음 cn_gov 제외)와 제품 이름마다
 * en 은 라틴 표기, zh 는 한자(또는 라틴) 표기가 번역문에 있어야 한다. 그 언어의 표기가 이름표에 없으면 보지 않는다.
 */
export function nameIssues(src: string, out: string, target: Target): string[] {
  const problems: string[] = [];
  for (const { entry, entity } of nameEntriesIn(src)) {
    if (entry.key === "cn_gov") continue;
    if (entity && !entry.ko.some((k) => koAliasAt(k, src)) && !entity.aliases.some((a) => typeof a !== "string" && a.test(src)) && !entry.en.some((a) => src.includes(a)) && !entry.zh.some((z) => src.includes(z))) continue;
    const want = target === "en" ? entry.en : [...entry.zh, ...entry.en];
    if (!want.length) continue;
    if (!nameRendered(entry, entity, out, target)) problems.push(`name "${entry.ko[0] ?? entry.key}" must be written as ${want.slice(0, 2).map((w) => `"${w}"`).join(" or ")} (NAME_GLOSSARY)`);
  }
  return problems;
}

/** 번역 입력의 이름표 줄 (ko = en = zh) */
export function nameGlossaryLines(ko: BriefingContent): string[] {
  const text = fieldsOf(ko).map((f) => f.get(ko) ?? "").join(" ");
  const seen = new Set<string>();
  const lines: string[] = [];
  for (const { entry } of nameEntriesIn(text)) {
    if (entry.key === "cn_gov" || seen.has(entry.key)) continue;
    seen.add(entry.key);
    lines.push(`${entry.ko.slice(0, 2).join("/") || entry.key} = ${entry.en.slice(0, 2).join("/") || "—"} = ${entry.zh.slice(0, 2).join("/") || "—"}`);
  }
  return lines;
}

/** 번역본 재검증. 문제 목록(빈 배열이면 통과) */
export function checkTranslation(ko: BriefingContent, tr: BriefingContent, target: Target): string[] {
  const problems: string[] = [];
  if (shapeOf(ko) !== shapeOf(tr)) {
    problems.push(`structure: array lengths differ from source (${shapeOf(ko)} vs ${shapeOf(tr)})`);
    return problems;
  }
  for (const f of fieldsOf(ko)) {
    const src = f.get(ko) ?? "";
    const out = f.get(tr) ?? "";
    if (!src) continue;
    if (!out.trim()) {
      problems.push(`${f.path}: empty translation`);
      continue;
    }
    if (HANGUL_RE.test(out)) problems.push(`${f.path}: Hangul remains ("${out.slice(0, 60)}")`);
    // en 은 괄호 병기 원어도 허용하지 않는다 (예전 규칙 그대로)
    if (target === "en" && hanResidue(out, { allowParenthetical: false }).tokens.length)
      problems.push(`${f.path}: Chinese characters in English text`);
    if (/\d{7,}/.test(out.replace(/,/g, "")) && !/\d{7,}/.test(src.replace(/,/g, "")))
      problems.push(`${f.path}: raw long number ("${out.match(/\d[\d,]{6,}/)?.[0]}") — write it as million/billion (en) or 万/亿 (zh)`);
    // 万→10k 식 축약 금지 (원문에 k 가 없을 때)
    if (K_SUFFIX_RE.test(out) && !K_SUFFIX_RE.test(src))
      problems.push(`${f.path}: do not abbreviate numbers with "k" — Korean: "${src}" / yours: "${out}"`);
    for (const n of nameIssues(src, out, target)) problems.push(`${f.path}: ${n}`);
    // 빠진 값 = ko 의 비교 대상이 번역문에 없음, 덧붙인 값 = 번역문의 비교 대상(이름에 붙은 수 제외)이 ko 에 없음
    const a = valueSets(src);
    const b = valueSets(out);
    const missing = [...a.sig].filter((x) => !b.all.has(x));
    const extra = [...b.plain].filter((x) => !a.all.has(x));
    // 정규화 값(2300000000 등)을 보여 주면 모델이 그 숫자를 그대로 베껴 쓰므로 원문 문장을 보여 준다
    if (missing.length || extra.length) {
      // 덧붙인 숫자(연도 등)는 원문 표기 그대로 짚어 준다 — "2026" 을 지우라고 말해야 수리가 된다
      const da = digitStrings(src);
      const added = [...digitStrings(out)].filter((x) => /^(19|20)\d{2}$/.test(x) && !da.has(x));
      problems.push(
        `${f.path}: number set differs — Korean: "${src}" / yours: "${out}"${
          added.length ? ` — DELETE ${added.map((x) => `"${x}"`).join(", ")} (not in the Korean field)` : ""
        } (${
          target === "zh" ? "copy the digits verbatim: 억→亿, 만→万, 조→万亿" : "same magnitude, e.g. 23억 → 2.3 billion; never add years or ranks"
        })`
      );
    } else if (target === "zh") {
      // zh 는 억=亿·만=万 으로 단위가 1:1 이므로 자릿수 문자열까지 그대로여야 한다 (5억 3,700만 → 5亿3700万, 53700万 은 위반)
      const da = digitStrings(src);
      const db = digitStrings(out);
      // 예외: ko 의 여러 단위 금액("1억 9천만")을 한 단위 소수("1.9亿")로 쓴 것은 같은 값 (round 2 재생성 09-16 zh) —
      // "53700万" 처럼 더 작은 단위로 늘여 쓴 것은 여전히 위반
      const koComposite = parseQuantities(src).filter((q) => q.scaled && /\d\s*[조억만천][^\d]*\d/.test(q.raw)).map((q) => canonicalValue(q.value));
      const condensed = new Set(
        parseQuantities(out)
          .filter((q) => q.decimal && q.scaled && koComposite.includes(canonicalValue(q.value)))
          .map((q) => q.raw.match(/\d[\d,]*(?:\.\d+)?/)?.[0]?.replace(/,/g, "") ?? "")
      );
      if ([...da].some((x) => !db.has(x)) || [...db].some((x) => !da.has(x) && !condensed.has(x)))
        problems.push(`${f.path}: digits not verbatim — Korean: "${src}" / yours: "${out}" (keep the same digits; 억→亿, 만→万, 조→万亿)`);
    }
  }
  return problems;
}

const K_SUFFIX_RE = /\d\s?[kK](?![A-Za-z])/;

/** 쉼표를 뺀 숫자 문자열 집합 (12 이하 정수 제외 — numericValues 와 같은 기준, 소수점 표기 "8.0" 은 포함) */
function digitStrings(text: string): Set<string> {
  const out = new Set<string>();
  for (const m of text.matchAll(/\d[\d,]*(?:\.\d+)?/g)) {
    const s = m[0].replace(/,/g, "").replace(/\.$/, "");
    const v = Number(s);
    if (Number.isFinite(v) && (v > 12 || !Number.isInteger(v) || s.includes("."))) out.add(s);
  }
  return out;
}

/**
 * 이름 힌트의 숫자를 지운다. 힌트는 이름 표기용인데, 모델이 중국어 원제의 연도·순위("2026年", "120强")를
 * 번역문에 옮겨 적어 숫자 집합 검증에 걸렸다 (2026-10-13 실패 8건 중 3건). 필요한 숫자는 모두 ko 본문에 있다.
 */
export function maskDigits(s: string): string {
  return s.replace(/\d+(?:[.,]\d+)*/g, "#");
}

/** 번역 응답 → ko 구조에 텍스트 값만 얹은 BriefingContent */
export function mergeTranslation(ko: BriefingContent, raw: unknown): BriefingContent {
  const tr = normalizeContent(raw).content;
  const out: BriefingContent = structuredClone(ko);
  if (shapeOf(ko) !== shapeOf(tr)) return tr; // checkTranslation 이 structure 로 잡는다
  for (const f of fieldsOf(ko)) {
    const v = f.get(tr);
    if (typeof v === "string") f.set(out, v);
  }
  out.excluded = ko.excluded.map((e) => ({ id: e.id, reason: "" })); // 내부용, 번역하지 않음
  return out;
}

/** 번역 입력: 텍스트·구조만 (excluded 는 빼서 토큰 절약) */
function payloadOf(ko: BriefingContent) {
  return { ...ko, excluded: [] };
}

export interface TranslateResult {
  content: BriefingContent | null;
  /** 재검증에 실패했어도 마지막 번역본 (failed 행에 남겨 관리자가 볼 수 있게) */
  candidate: BriefingContent | null;
  problems: string[];
  repaired: boolean;
  usages: LlmUsage[];
  error?: string;
  /** 번역 모델이 검사를 못 넘어 재시도 모델로 다시 번역했나 */
  fallback?: boolean;
}

export interface TranslateOptions {
  /** AI 검토가 앞 번역에서 찾은 문제 — 번역 입력에 붙여 같은 실수를 피하게 한다 (2026-11-03 번역만 문제인 판 재번역) */
  reviewNotes?: string[];
  /** 번역 모델(Haiku)을 건너뛰고 재시도 모델(Sonnet)로 바로 */
  preferFallback?: boolean;
}

export async function translateBriefing(
  ko: BriefingContent,
  target: Target,
  groups: CandidateGroup[],
  budgetCheck: () => void,
  opts: TranslateOptions = {}
): Promise<TranslateResult> {
  const usages: LlmUsage[] = [];
  const byId = new Map(groups.map((g) => [g.shortId, g.primary]));
  // 이름 힌트: 제목 + 중국어 요약 앞부분 (요약에만 나오는 고유명사 — 天垓300·超衍智能 — 를 원어로 쓰게, 숫자는 가림)
  const hints = [...new Set(citedRefs(ko))]
    .filter((r) => byId.has(r))
    .map((r) => {
      const a = byId.get(r)!;
      return {
        ref: r,
        title_kr: maskDigits(a.title_kr),
        title_cn: maskDigits(a.title_cn),
        summary_cn: a.summary_cn ? maskDigits(a.summary_cn.slice(0, 90)) : undefined,
      };
    });
  const system = buildTranslateSystemPrompt(target);
  const notes = (opts.reviewNotes ?? []).filter(Boolean).slice(0, 12);
  const user =
    buildTranslateUserPrompt(payloadOf(ko), hints, nameGlossaryLines(ko)) +
    (notes.length
      ? `\n\nREVIEW_NOTES (a reviewer found these problems in a previous translation of this briefing — do not repeat them; translate each field faithfully, adding nothing):\n${notes.map((n) => `- ${n}`).join("\n")}`
      : "");
  // 한 모델로: 번역 → 검사 → 문제가 있으면 1회 수리
  const attempt = async (model: string, effort: Effort | undefined) => {
    budgetCheck();
    const first = await chat({ model, effort, system, messages: [{ role: "user", content: user }], maxTokens: 8000 }, (u) => usages.push(u));
    let content = mergeTranslation(ko, parseJsonContent(first.content));
    let problems = checkTranslation(ko, content, target);
    let repaired = false;
    if (problems.length) {
      budgetCheck();
      repaired = true;
      const second = await chat(
        {
          model,
          effort,
          system,
          messages: [
            { role: "user", content: user },
            { role: "assistant", content: first.content },
            { role: "user", content: buildTranslateRepairPrompt(problems) },
          ],
          maxTokens: 8000,
        },
        (u) => usages.push(u)
      );
      content = mergeTranslation(ko, parseJsonContent(second.content));
      problems = checkTranslation(ko, content, target);
    }
    return { content, problems, repaired };
  };
  try {
    // 번역 모델은 생성 모델과 따로 (TRANSLATE_MODEL, 기본 Haiku — 2026-11-03 D2). 검사를 못 넘으면 재시도 모델(기본 Sonnet 5.5)로 한 번 더
    if (opts.preferFallback && TRANSLATE_FALLBACK_MODEL) {
      const r0 = await attempt(TRANSLATE_FALLBACK_MODEL, TRANSLATE_FALLBACK_EFFORT);
      return { content: r0.problems.length ? null : r0.content, candidate: r0.content, problems: r0.problems, repaired: true, usages, fallback: true };
    }
    let r = await attempt(TRANSLATE_MODEL, TRANSLATE_EFFORT);
    let fallback = false;
    if (r.problems.length && TRANSLATE_FALLBACK_MODEL && TRANSLATE_FALLBACK_MODEL !== TRANSLATE_MODEL) {
      try {
        const r2 = await attempt(TRANSLATE_FALLBACK_MODEL, TRANSLATE_FALLBACK_EFFORT);
        fallback = true;
        if (r2.problems.length <= r.problems.length) r = r2;
      } catch (e) {
        // 재시도 실패(비용 상한·LLM 오류)는 첫 결과를 그대로 쓴다
        if (!(e instanceof Error)) throw e;
      }
    }
    return { content: r.problems.length ? null : r.content, candidate: r.content, problems: r.problems, repaired: r.repaired || fallback, usages, fallback };
  } catch (e) {
    return { content: null, candidate: null, problems: [], repaired: false, usages, error: (e as Error).message };
  }
}

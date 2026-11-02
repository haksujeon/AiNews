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
import { chat, parseJsonContent } from "./llm";
import {
  buildTranslateRepairPrompt,
  buildTranslateSystemPrompt,
  buildTranslateUserPrompt,
} from "./prompt";
import { citedRefs, normalizeContent } from "./validate";
import { HANGUL_RE, hanResidue } from "../text/han";

type Target = "en" | "zh";

// ───────────────────────── 숫자 집합

const MULT: Record<string, number> = {
  조: 1e12, 兆: 1e12, 万亿: 1e12, trillion: 1e12,
  천억: 1e11, 千亿: 1e11, 백억: 1e10, 百亿: 1e10, 십억: 1e9, 十亿: 1e9,
  억: 1e8, 亿: 1e8,
  만: 1e4, 万: 1e4,
  천: 1e3, 千: 1e3, thousand: 1e3, k: 1e3,
  billion: 1e9, bn: 1e9, b: 1e9,
  million: 1e6, m: 1e6,
};
// 긴 단위부터 (万亿 를 万 + 亿 로 쪼개 읽지 않게)
const NUM_TOKEN =
  /(\d[\d,]*(?:\.\d+)?)\s*(万亿|千亿|百亿|十亿|천억|백억|십억|조|兆|억|亿|만|万|천|千|[Tt]rillion|[Bb]illion|[Mm]illion|[Tt]housand|bn|[kK](?![A-Za-z])|B(?![A-Za-z])|M(?![A-Za-z]))?\s*(%|퍼센트|percent)?/g;

/** 범위 구분자 (~ ～ 〜 - – — 至 到 to) */
const RANGE_RE =
  /(\d[\d,]*(?:\.\d+)?)\s*(~|～|〜|–|—|-|至|到|to)\s*(\d[\d,]*(?:\.\d+)?)\s*(%|퍼센트|percent|万亿|千亿|百亿|十亿|천억|백억|십억|亿|万|억|만|조|兆|[Tt]rillion|[Bb]illion|[Mm]illion)/g;

/**
 * 범위의 뒤쪽 단위를 앞 수에도 붙인다: "7~10%" → "7%~10%", "5~7억" → "5억~7억".
 * "7%至10%" 와 같은 값 집합이 되게 (2026-10-29 zh 오탐: "7~10%" vs "7%至10%").
 */
export function expandRanges(text: string): string {
  return text.replace(RANGE_RE, (_m, a: string, sep: string, b: string, unit: string) => `${a}${unit} ${sep} ${b}${unit}`);
}

/**
 * 텍스트 속 "의미 있는" 수치의 정규화 값 집합.
 * 12 이하 정수는 월·순서·개수처럼 말로 풀어 쓰는 경우가 많아 비교에서 뺀다 (단위·%·소수가 붙으면 포함).
 * 범위("7~10%", "7-10%", "7%至10%")는 양쪽 수에 단위를 붙여 같은 값으로 본다.
 */
export function numericValues(raw: string): Set<string> {
  const text = expandRanges(raw);
  const out: number[] = [];
  const tokens: { v: number; unit: string; end: number; start: number }[] = [];
  for (const m of text.matchAll(NUM_TOKEN)) {
    const base = Number(m[1].replace(/,/g, ""));
    if (!Number.isFinite(base)) continue;
    const unit = (m[2] ?? "").toLowerCase();
    const mult = unit ? MULT[unit] ?? 1 : 1;
    const v = base * mult;
    const prev = tokens[tokens.length - 1];
    // "5억 3,700만" / "5亿3700万" → 하나의 수
    if (prev && mult < (MULT[prev.unit] ?? 1) && mult >= 1e4 && /^\s*$/.test(text.slice(prev.end, m.index))) {
      prev.v += v;
      prev.end = (m.index ?? 0) + m[0].length;
      out[out.length - 1] = prev.v;
      continue;
    }
    tokens.push({ v, unit, start: m.index ?? 0, end: (m.index ?? 0) + m[0].length });
    const significant = Boolean(unit) || Boolean(m[3]) || !Number.isInteger(base) || base > 12;
    out.push(significant ? v : NaN);
  }
  return new Set(out.filter((v) => !Number.isNaN(v)).map((v) => Number(v.toPrecision(6)).toString()));
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
    const a = numericValues(src);
    const b = numericValues(out);
    const missing = [...a].filter((x) => !b.has(x));
    const extra = [...b].filter((x) => !a.has(x));
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
      if ([...da].some((x) => !db.has(x)) || [...db].some((x) => !da.has(x)))
        problems.push(`${f.path}: digits not verbatim — Korean: "${src}" / yours: "${out}" (keep the same digits; 억→亿, 만→万, 조→万亿)`);
    }
  }
  return problems;
}

const K_SUFFIX_RE = /\d\s?[kK](?![A-Za-z])/;

/** 쉼표를 뺀 숫자 문자열 집합 (12 이하 정수 제외 — numericValues 와 같은 기준) */
function digitStrings(text: string): Set<string> {
  const out = new Set<string>();
  for (const m of text.matchAll(/\d[\d,]*(?:\.\d+)?/g)) {
    const s = m[0].replace(/,/g, "").replace(/\.$/, "");
    const v = Number(s);
    if (Number.isFinite(v) && (v > 12 || !Number.isInteger(v))) out.add(s);
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
}

export async function translateBriefing(
  ko: BriefingContent,
  target: Target,
  groups: CandidateGroup[],
  budgetCheck: () => void
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
  const user = buildTranslateUserPrompt(payloadOf(ko), hints);
  try {
    budgetCheck();
    const first = await chat({ system, messages: [{ role: "user", content: user }], maxTokens: 8000 }, (u) => usages.push(u));
    let content = mergeTranslation(ko, parseJsonContent(first.content));
    let problems = checkTranslation(ko, content, target);
    let repaired = false;
    if (problems.length) {
      budgetCheck();
      repaired = true;
      const second = await chat(
        {
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
    return { content: problems.length ? null : content, candidate: content, problems, repaired, usages };
  } catch (e) {
    return { content: null, candidate: null, problems: [], repaired: false, usages, error: (e as Error).message };
  }
}

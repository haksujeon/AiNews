/**
 * ko → en / zh 값만 번역 + 재검증 (설계 검토서 §3.5).
 *
 *  - 구조(키·배열 길이·순서·refs)는 ko 를 그대로 쓰고, 번역문에서는 텍스트 값만 가져온다.
 *    → 세 언어판의 기사·순서·refs 가 항상 같다.
 *  - 재검증: 필드마다 숫자 집합이 ko 와 같음(억/만 ↔ billion/million/亿/万 크기 환산 후 비교),
 *    en/zh 에 한글 없음, en 에 한자 없음.
 *  - 실패하면 위반 목록을 주고 1회 수리. 그래도 남으면 그 언어판은 failed (ko 는 영향 없음).
 */
import type { BriefingContent, CandidateGroup, LlmUsage } from "./types";
import { chat, parseJsonContent } from "./llm";
import {
  buildTranslateRepairPrompt,
  buildTranslateSystemPrompt,
  buildTranslateUserPrompt,
} from "./prompt";
import { HAN_RE, HANGUL_RE, citedRefs, normalizeContent } from "./validate";

type Target = "en" | "zh";

// ───────────────────────── 숫자 집합

const MULT: Record<string, number> = {
  조: 1e12, 兆: 1e12, trillion: 1e12,
  억: 1e8, 亿: 1e8,
  만: 1e4, 万: 1e4,
  천: 1e3, 千: 1e3, thousand: 1e3,
  billion: 1e9, bn: 1e9, b: 1e9,
  million: 1e6, m: 1e6,
};
const NUM_TOKEN = /(\d[\d,]*(?:\.\d+)?)\s*(조|兆|억|亿|만|万|천|千|trillion|billion|million|thousand|bn|B(?![A-Za-z])|M(?![A-Za-z]))?\s*(%|퍼센트|percent)?/g;

/**
 * 텍스트 속 "의미 있는" 수치의 정규화 값 집합.
 * 12 이하 정수는 월·순서·개수처럼 말로 풀어 쓰는 경우가 많아 비교에서 뺀다 (단위·%·소수가 붙으면 포함).
 */
export function numericValues(text: string): Set<string> {
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
    if (target === "en" && new RegExp(HAN_RE.source).test(out)) problems.push(`${f.path}: Chinese characters in English text`);
    const a = numericValues(src);
    const b = numericValues(out);
    const missing = [...a].filter((x) => !b.has(x));
    const extra = [...b].filter((x) => !a.has(x));
    if (missing.length || extra.length)
      problems.push(`${f.path}: number set differs (source ${[...a].join(",") || "-"}; translation ${[...b].join(",") || "-"})`);
  }
  return problems;
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
  const hints = [...new Set(citedRefs(ko))]
    .filter((r) => byId.has(r))
    .map((r) => ({ ref: r, title_kr: byId.get(r)!.title_kr, title_cn: byId.get(r)!.title_cn }));
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
    return { content: problems.length ? null : content, problems, repaired, usages };
  } catch (e) {
    return { content: null, problems: [], repaired: false, usages, error: (e as Error).message };
  }
}

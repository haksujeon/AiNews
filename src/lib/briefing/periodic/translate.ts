/**
 * 주간·월간 리포트 ko → en / zh 번역 (2026-11-10 사용자 결정: 주간·월간도 영어·중국어판).
 *
 *  - 칸(path → 문장)만 평평하게 보내고 받아서 ko 구조에 얹는다 → 세 언어판의 항목·순서·refs·지표가 언제나 같다.
 *  - 칸마다 데일리와 같은 재검증(checkTranslatedField: 한글 잔여·en 한자·숫자 집합·이름표)을 하고, 문제가 있으면 1회 수리,
 *    그래도 남으면 재시도 모델로 한 번 더 (데일리 translateBriefing 과 같은 순서). 규칙 문장도 데일리와 같은 translateCommonRules.
 *  - 쉽게 풀어보기(easy·why)는 그 언어의 쉬운 말로 (초등 고학년 눈높이).
 * 이 파일은 DB 를 import 하지 않는다 (DB 는 translate-run.ts).
 */
import type { LlmUsage } from "../types";
import { TRANSLATE_EFFORT, TRANSLATE_FALLBACK_EFFORT, TRANSLATE_FALLBACK_MODEL, TRANSLATE_MODEL, chat, parseJsonContent, type Effort } from "../llm";
import { translateCommonRules } from "../prompt";
import { checkTranslatedField, maskDigits } from "../translate";
import type { PeriodicContent } from "./types";

type Target = "en" | "zh";
export const PERIODIC_TRANSLATE_PROMPT_VERSION = "periodic-translate-v1-2026-11-10";

interface Field {
  path: string;
  get: (c: PeriodicContent) => string | undefined;
  set: (c: PeriodicContent, v: string) => void;
  /** 쉽게 풀어보기 칸 */
  easy?: boolean;
}

/** 번역할 칸 목록 (순수). term.term(중국어 원어)·entity 키·refs·metrics 는 옮기지 않는다 */
export function periodicTranslateFields(c: PeriodicContent): Field[] {
  const f: Field[] = [
    { path: "headline", get: (x) => x.headline, set: (x, v) => (x.headline = v) },
    { path: "dek", get: (x) => x.dek, set: (x, v) => (x.dek = v) },
  ];
  c.big_picture.forEach((b, i) => {
    f.push({ path: `big_picture[${i}].title`, get: (x) => x.big_picture[i]?.title, set: (x, v) => (x.big_picture[i].title = v) });
    f.push({ path: `big_picture[${i}].text`, get: (x) => x.big_picture[i]?.text, set: (x, v) => (x.big_picture[i].text = v) });
    if (b.easy) f.push({ path: `big_picture[${i}].easy`, easy: true, get: (x) => x.big_picture[i]?.easy, set: (x, v) => (x.big_picture[i].easy = v) });
    if (b.why) f.push({ path: `big_picture[${i}].why`, easy: true, get: (x) => x.big_picture[i]?.why, set: (x, v) => (x.big_picture[i].why = v) });
    if (b.key) {
      f.push({ path: `big_picture[${i}].key.value`, get: (x) => x.big_picture[i]?.key?.value, set: (x, v) => (x.big_picture[i].key!.value = v) });
      f.push({ path: `big_picture[${i}].key.label`, get: (x) => x.big_picture[i]?.key?.label, set: (x, v) => (x.big_picture[i].key!.label = v) });
    }
  });
  c.movers.forEach((_, i) => f.push({ path: `movers[${i}].text`, get: (x) => x.movers[i]?.text, set: (x, v) => (x.movers[i].text = v) }));
  if (c.money) f.push({ path: "money.text", get: (x) => x.money?.text, set: (x, v) => (x.money!.text = v) });
  if (c.china_lens) f.push({ path: "china_lens.text", get: (x) => x.china_lens?.text, set: (x, v) => (x.china_lens!.text = v) });
  c.watch_next.forEach((_, i) => f.push({ path: `watch_next[${i}].text`, get: (x) => x.watch_next[i]?.text, set: (x, v) => (x.watch_next[i].text = v) }));
  if (c.term?.why) f.push({ path: "term.why", get: (x) => x.term?.why, set: (x, v) => (x.term!.why = v) });
  (c.month_arc ?? []).forEach((_, i) => f.push({ path: `month_arc[${i}].text`, get: (x) => x.month_arc[i]?.text, set: (x, v) => (x.month_arc[i].text = v) }));
  return f.filter((x) => (x.get(c) ?? "").trim());
}

export function buildPeriodicTranslateSystemPrompt(target: Target, kind: "weekly" | "monthly"): string {
  const lang = target === "zh" ? "Simplified Chinese" : "English";
  return `You translate a Korean ${kind} report about the Chinese AI industry into ${lang}.

Rules (violations are rejected automatically):
1. Input is FIELDS_JSON: an object of "path": "Korean text". Output a JSON object with exactly the same keys, each value translated. Do not add, drop or merge keys.
2. Keys ending in ".easy" or ".why" are the "explain it simply" boxes for readers aged 10–12: translate them into simple, friendly ${lang} with everyday words, keeping the meaning and the analogy. All other keys are plain, neutral news style.
${translateCommonRules(target)}
Output only the JSON, no code fences.`;
}

export function buildPeriodicTranslateUserPrompt(fields: Record<string, string>, nameHints: { title_kr: string; title_cn: string }[], glossary: string[]): string {
  return `${glossary.length ? `NAME_GLOSSARY (Korean = English = Chinese):\n${glossary.join("\n")}\n\n` : ""}NAME_HINTS (Korean headline ⇢ original Chinese headline, for spelling names only):\n${nameHints
    .map((h) => `${maskDigits(h.title_kr)} ⇢ ${maskDigits(h.title_cn)}`)
    .join("\n")}\n\nFIELDS_JSON:\n${JSON.stringify(fields)}`;
}

/** 번역 응답 → ko 구조에 얹은 판 + 칸별 문제 (순수) */
export function mergePeriodicTranslation(ko: PeriodicContent, raw: unknown, target: Target): { content: PeriodicContent; problems: string[] } {
  const out = structuredClone(ko);
  const got = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const problems: string[] = [];
  for (const f of periodicTranslateFields(ko)) {
    const src = f.get(ko) ?? "";
    const v = typeof got[f.path] === "string" ? (got[f.path] as string).trim() : "";
    problems.push(...checkTranslatedField(f.path, src, v, target));
    if (v) f.set(out, v);
  }
  return { content: out, problems };
}

export interface PeriodicTranslateResult {
  content: PeriodicContent | null;
  candidate: PeriodicContent | null;
  problems: string[];
  usages: LlmUsage[];
  model: string | null;
  error?: string;
}

export async function translatePeriodic(
  ko: PeriodicContent,
  target: Target,
  kind: "weekly" | "monthly",
  ctx: { nameHints: { title_kr: string; title_cn: string }[]; glossary: string[]; budgetCheck?: () => void }
): Promise<PeriodicTranslateResult> {
  const usages: LlmUsage[] = [];
  const fields = Object.fromEntries(periodicTranslateFields(ko).map((f) => [f.path, f.get(ko) ?? ""]));
  const system = buildPeriodicTranslateSystemPrompt(target, kind);
  const user = buildPeriodicTranslateUserPrompt(fields, ctx.nameHints, ctx.glossary);
  // JSON 이 깨진 응답도 "빈 번역"으로 보고 수리·재시도 모델 순서를 그대로 탄다 (W45 zh: Haiku 응답 뒤에 군말이 붙어 파싱 실패)
  const parse = (text: string): unknown => {
    try {
      return parseJsonContent(text);
    } catch {
      return {};
    }
  };
  const attempt = async (model: string, effort: Effort | undefined) => {
    ctx.budgetCheck?.();
    const first = await chat({ model, effort, system, messages: [{ role: "user", content: user }], maxTokens: 8000 }, (u) => usages.push(u));
    let r = mergePeriodicTranslation(ko, parse(first.content), target);
    if (r.problems.length) {
      ctx.budgetCheck?.();
      const second = await chat(
        {
          model,
          effort,
          system,
          messages: [
            { role: "user", content: user },
            { role: "assistant", content: first.content },
            {
              role: "user",
              content: `Automatic checks rejected your translation:\n${r.problems.map((p) => `- ${p}`).join("\n")}\nFix only those keys and output the full JSON object again, no code fences. For "number set differs": the translated field must contain exactly the numbers of the Korean field.`,
            },
          ],
          maxTokens: 8000,
        },
        (u) => usages.push(u)
      );
      r = mergePeriodicTranslation(ko, parse(second.content), target);
    }
    return { ...r, model };
  };
  try {
    let r = await attempt(TRANSLATE_MODEL, TRANSLATE_EFFORT);
    if (r.problems.length && TRANSLATE_FALLBACK_MODEL && TRANSLATE_FALLBACK_MODEL !== TRANSLATE_MODEL) {
      try {
        const r2 = await attempt(TRANSLATE_FALLBACK_MODEL, TRANSLATE_FALLBACK_EFFORT);
        if (r2.problems.length <= r.problems.length) r = r2;
      } catch (e) {
        if (!(e instanceof Error)) throw e;
      }
    }
    return { content: r.problems.length ? null : r.content, candidate: r.content, problems: r.problems, usages, model: r.model };
  } catch (e) {
    return { content: null, candidate: null, problems: [], usages, model: null, error: (e as Error).message };
  }
}

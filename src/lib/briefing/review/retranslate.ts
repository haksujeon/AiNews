/**
 * 자동 수정으로 새 ko 버전이 생기면 en/zh 를 다시 번역한다 (생성과 같은 translateBriefing·재검증).
 * 저장된 판은 refs 가 uuid 이므로, 기사 한 건 = 후보 하나(shortId = uuid)인 묶음을 만들어 이름 힌트를 준다.
 * 용어 설명은 생성(toStored)과 같이 기사 key_terms 의 그 언어 설명을 복사한다.
 */
import { translateBriefing, type TranslateResult } from "../translate";
import type { BriefingContent, CandidateArticle, CandidateGroup, LlmUsage } from "../types";

export function pseudoGroups(articles: Iterable<CandidateArticle>): CandidateGroup[] {
  return [...articles].map((a) => ({ shortId: a.id, primary: a, siblings: [], sources: [a.source_name], score: 0, scoreDetail: {} }));
}

export interface RetranslateResult {
  locale: "en" | "zh";
  content: Record<string, unknown> | null;
  candidate: Record<string, unknown> | null;
  problems: string[];
  repaired: boolean;
  usages: LlmUsage[];
  error?: string;
}

export async function retranslate(
  koStored: Record<string, unknown>,
  articles: Map<string, CandidateArticle>,
  budgetCheck: () => void = () => {},
  translate: typeof translateBriefing = translateBriefing
): Promise<RetranslateResult[]> {
  const { meta, ...rest } = koStored as Record<string, unknown> & { meta?: Record<string, unknown> };
  const body = structuredClone(rest) as unknown as BriefingContent;
  if (body.term_of_the_day) body.term_of_the_day = { ...body.term_of_the_day, explanation: undefined };
  const groups = pseudoGroups(articles.values());
  const out: RetranslateResult[] = [];
  for (const target of ["en", "zh"] as const) {
    let tr: TranslateResult;
    try {
      tr = await translate(body, target, groups, budgetCheck);
    } catch (e) {
      tr = { content: null, candidate: null, problems: [], repaired: false, usages: [], error: (e as Error).message };
    }
    const wrap = (c: BriefingContent | null) => {
      if (!c) return null;
      const term = c.term_of_the_day;
      if (term) {
        const hit = articles.get(term.ref)?.key_terms.find((k) => k.term === term.term);
        term.explanation = (target === "en" ? hit?.explanation_en : hit?.explanation_zh) ?? "";
      }
      return { ...(c as unknown as Record<string, unknown>), meta: { ...(meta ?? {}), locale: target } };
    };
    out.push({ locale: target, content: wrap(tr.content), candidate: wrap(tr.candidate), problems: tr.problems, repaired: tr.repaired, usages: tr.usages, error: tr.error });
  }
  return out;
}

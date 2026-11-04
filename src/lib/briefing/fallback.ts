/**
 * 생성이 끝내 실패했을 때의 대체 판 (2026-11-02 재감사 round 2, §7-10: "3회 실패 시 대체 경로").
 * 10-28·10-31 은 세 번 실패해 그날 판이 아예 없었다. 판 없이 끝나지 않게 두 단계로 내린다:
 *  1. 짧은 판(mode short): 검증을 통과한 주요 기사 3건 이상 — 헤드라인 = 1위 기사 제목(상한 안일 때), 리드 = 주요 기사 제목을 이은 결정적 문장.
 *     짧은 판은 중국 중심 규칙을 보지 않는다(validate.ts chinaCentricRequired) — 그래서 리뷰어가 판정한다.
 *  2. 제목만 판(mode headlines): LLM 문장 없이 후보 상위 기사 제목 + 링크(refs) + 매체. 번역하지 않는다(ko 만).
 * 둘 다 draft 로만 남기고 발행 여부는 리뷰어·자동 발행(별도 작업)이 정한다.
 *
 * 이 파일은 DB 를 import 하지 않는다 (단위 테스트).
 */
import type { BriefingContent, CandidateGroup, TopStory, ValidationReport } from "./types";
import { HEADLINE_MAX, dropFatalItems, itemOf, validateKo, type ValidationContext } from "./validate";
import { isChinaCandidate, isChinaSubject } from "./rules";
import { findEntities } from "./entities";

const md = (d: string) => `${Number(d.slice(5, 7))}월 ${Number(d.slice(8, 10))}일`;

/**
 * 대체 판 헤드라인: 1위 기사 제목이 상한 안이면 그 제목, 아니면 "{1위 주체} 등 M월 D일 주요 소식" (헤드라인 = 1위 기사 규칙을 지킨다).
 * 주체를 알 수 없으면 날짜 제목.
 */
export function fallbackHeadline(c: BriefingContent): string {
  const s = c.top_stories[0];
  const t = s?.title?.trim();
  if (t && t.length <= HEADLINE_MAX) return t;
  // 제목에 가장 먼저 나오는 실체 이름 (헤드라인 숫자 검사에 걸리지 않게 날짜는 넣지 않는다)
  const title = s?.title ?? "";
  const alias = findEntities(title)
    .flatMap((e) => e.aliases.filter((a): a is string => typeof a === "string" && title.includes(a)))
    .sort((a, b) => title.indexOf(a) - title.indexOf(b))[0];
  const subject = (s?.subject ?? "").replace(/\s?[(（][^)）]*[)）]/g, "").trim() || alias || "";
  const withSubject = `${subject} 등 중국 AI 주요 소식`;
  return subject && withSubject.length <= HEADLINE_MAX ? withSubject : "중국 AI 주요 소식";
}

/** 대체 판 리드: 주요 기사 제목을 이은 문장 (200자 안, 넘으면 뒤 제목부터 뺀다). 숫자·표현은 검증을 거친 제목 그대로 */
export function fallbackLede(c: BriefingContent): { lede: string; refs: string[] } {
  const tops = c.top_stories.slice(0, 3);
  for (let n = tops.length; n >= 1; n--) {
    const lede = `주요 소식: ${tops
      .slice(0, n)
      .map((s) => s.title.replace(/[.。]$/, ""))
      .join(" / ")}.`;
    if (lede.length <= 200) return { lede, refs: [...new Set(tops.slice(0, n).flatMap((s) => s.refs))] };
  }
  return { lede: "", refs: [] };
}

/**
 * 짧은 판 대체: 치명 항목을 뺀 뒤(헤드라인·리드는 결정적 문장으로 바꿈) 주요 기사가 3건 이상이고 치명이 없으면 그 판.
 * mode short 문맥으로 다시 검증한다. 안 되면 null.
 */
export function shortFallback(
  content: BriefingContent,
  report: ValidationReport,
  ctx: ValidationContext,
  minTop = 3
): { content: BriefingContent; report: ValidationReport } | null {
  const shortCtx: ValidationContext = { ...ctx, mode: "short" };
  // 헤드라인·리드·중국 중심(판 전체) 치명은 대체 문장으로 갈음하므로 삭제 대상에서 뺀다
  const droppable = report.fatal.filter((f) => !["headline", "lede", "top_stories"].includes(itemOf(f.path)));
  let c = dropFatalItems(content, droppable).content;
  // 짧은 판은 중국 중심 규칙을 보지 않으므로 중국 주체 기사를 앞으로 (같은 무리 안에서는 원래 순서) — 헤드라인 = 1위 기사
  const cn = (s: BriefingContent["top_stories"][number]) => isChinaSubject(s, s.refs.map((r) => ctx.docs?.get(r) ?? []));
  c = { ...c, top_stories: [...c.top_stories.filter(cn), ...c.top_stories.filter((s) => !cn(s))].map((s, i) => ({ ...s, rank: i + 1 })) };
  for (let pass = 0; pass < 2; pass++) {
    if (c.top_stories.length < minTop) return null;
    const lede = fallbackLede(c);
    c = { ...c, headline: fallbackHeadline(c), lede: lede.lede, lede_refs: lede.refs };
    const v = validateKo(c, shortCtx);
    if (!v.report.fatal.length && v.content.top_stories.length >= minTop) return v;
    c = dropFatalItems(v.content, v.report.fatal.filter((f) => !["headline", "lede", "top_stories"].includes(itemOf(f.path)))).content;
  }
  return null;
}

const SECTION_OF: Record<string, string> = { "ai-tech": "models", "ai-product": "products", "ai-biz": "industry" };

/**
 * 제목만 판: 후보 상위 기사(중국 주체 후보 먼저, 점수 순) 제목 + 매체. LLM 문장 없음.
 * top_stories 의 title = 기사 한국어 제목, what = "매체: …" (링크는 refs → 화면이 원문 링크를 붙인다).
 */
export function headlinesEdition(groups: CandidateGroup[], editionDate: string, max = 8): BriefingContent {
  const ordered = [...groups].sort((a, b) => Number(isChinaCandidate(b.primary)) - Number(isChinaCandidate(a.primary)) || b.score - a.score);
  const picked = ordered.slice(0, max);
  const top: TopStory[] = picked.map((g, i) => ({
    rank: i + 1,
    section: SECTION_OF[g.primary.category] ?? "industry",
    subject: "",
    subject_is_chinese: isChinaCandidate(g.primary),
    title: g.primary.title_kr,
    what: `보도: ${(g.eventSources?.length ? g.eventSources : g.sources).join(", ")}`,
    why: "",
    refs: [g.shortId],
    primary_ref: g.shortId,
  }));
  return {
    headline: `${md(editionDate)} 중국 AI 주요 기사`,
    lede: "오늘은 자동 검증을 통과한 요약을 만들지 못해 주요 기사 제목과 원문 링크만 싣습니다.",
    lede_refs: [],
    top_stories: top,
    sections: [],
    key_numbers: [],
    companies_to_watch: [],
    term_of_the_day: null,
    clusters: [],
    excluded: [],
  };
}

/** 제목만 판의 검증 기록 (LLM 문장이 없어 의미 규칙은 보지 않는다) */
export function headlinesReport(c: BriefingContent, reason: string): ValidationReport {
  return {
    fatal: [],
    warn: [{ level: "warn", rule: "headlines_mode", path: "headline", detail: `제목만 판 — ${reason}` }],
    droppedRefs: [],
    stats: {
      numbersChecked: 0,
      topStories: c.top_stories.length,
      chinaCentric: c.top_stories.slice(0, 5).filter((s) => s.subject_is_chinese).length,
      citedIds: new Set(c.top_stories.flatMap((s) => s.refs)).size,
      bodyChars: c.top_stories.reduce((n, s) => n + s.title.length + s.what.length, 0),
    },
  };
}

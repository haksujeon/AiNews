/**
 * AI 검토 시험용 작은 판·근거 (DB 없음). review-*.test.ts 가 같이 쓴다.
 */
import type { BriefingRow } from "../../src/lib/briefing/repository";
import type { ReviewInput } from "../../src/lib/briefing/review/evidence";
import { segmentContent } from "../../src/lib/briefing/review/segments";
import type { CandidateArticle } from "../../src/lib/briefing/types";

export const A1 = "11111111-1111-4111-8111-111111111111";
export const A2 = "22222222-2222-4222-8222-222222222222";

export const ART1: CandidateArticle & { content_kr: string } = {
  id: A1, source_name: "36Kr", source_url: null, category: "ai-biz",
  title_cn: "智谱发布GLM-6，参数量达1.2万亿", title_kr: "즈푸, GLM-6 공개… 매개변수 1조 2천억 개",
  summary_kr: "즈푸가 GLM-6를 공개했다. 매개변수는 1조 2천억 개이며 오픈소스로 배포한다.",
  ai_insights_kr: "중국 오픈소스 대형 모델 경쟁이 이어진다.", key_terms: [{ term: "大模型", explanation_kr: "대형 모델", explanation_en: "large model", explanation_zh: "大模型" }],
  summary_cn: "智谱发布GLM-6，参数量1.2万亿，开源发布。", news_date: "2026-10-27", subject_region: "CN",
  content_kr: "즈푸는 27일 GLM-6를 공개했다. 매개변수는 1조 2천억 개다. 회사는 오픈소스로 배포한다고 밝혔다.",
};
export const ART2: CandidateArticle & { content_kr: string } = {
  id: A2, source_name: "Huxiu", source_url: null, category: "ai-biz",
  title_cn: "月之暗面完成10亿美元融资", title_kr: "문샷AI, 10억 달러 투자 유치",
  summary_kr: "문샷AI가 10억 달러 규모 투자를 유치했다.", ai_insights_kr: "", key_terms: [],
  summary_cn: "月之暗面完成10亿美元融资。", news_date: "2026-10-27", subject_region: "CN", content_kr: "",
};

export const DAILY_CONTENT = {
  headline: "즈푸 GLM-6 공개, 중국 최대 모델",
  lede: "즈푸가 GLM-6를 공개했다. 매개변수는 1조 2천억 개다. 문샷AI는 10억 달러를 유치했다.",
  lede_refs: [A1, A2],
  top_stories: [
    { rank: 1, section: "models", subject: "즈푸", subject_is_chinese: true, title: "즈푸, GLM-6 공개", what: "즈푸가 GLM-6를 공개했다. 매개변수는 1조 2천억 개다.", why: "오픈소스 경쟁이 이어진다.", refs: [A1], primary_ref: A1 },
    { rank: 2, section: "funding", subject: "문샷AI", subject_is_chinese: true, title: "문샷AI, 10억 달러 유치", what: "문샷AI가 10억 달러 규모 투자를 유치했다.", why: "자금이 몰린다.", refs: [A2], primary_ref: A2 },
  ],
  sections: [{ section: "models", items: [{ text: "GLM-6는 오픈소스로 배포된다.", refs: [A1] }] }],
  key_numbers: [{ value: "1조 2천억 개", label: "GLM-6 매개변수", ref: A1 }],
  companies_to_watch: [{ name: "즈푸", why: "GLM-6를 공개했다.", refs: [A1] }],
  term_of_the_day: null,
  clusters: [],
  excluded: [],
  meta: { edition_date: "2026-10-27", locale: "ko", mode: "normal", candidate_count: 2, group_count: 2, cited_count: 2, china_centric_count: 2, prompt_version: "test", ai_generated: true },
};

export function dailyRow(over: Partial<BriefingRow> = {}): BriefingRow {
  return {
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", edition_type: "daily", edition_date: "2026-10-27", period_start: "2026-10-27", period_end: "2026-10-27",
    metrics_id: null, locale: "ko", version: 3, status: "draft", mode: "normal", schema_version: 1, content: structuredClone(DAILY_CONTENT),
    article_ids: [A1, A2], input_article_ids: [A1, A2], candidate_count: 2, input_hash: "h", validation: { final: { fatal: [], warn: [] } },
    source_briefing_id: null, model: "gen", prompt_version: "test", llm_request_ids: [], input_tokens: 0, output_tokens: 0, cost_usd: "0", latency_ms: 0,
    error: null, needs_review: false, edited_by: null, created_at: "", updated_at: "", published_at: null, ...over,
  };
}

/** DB 없이 만든 검토 입력. revalidate 는 기본으로 치명 없음 */
export function fakeInput(row: BriefingRow = dailyRow(), over: Partial<ReviewInput> = {}): ReviewInput {
  const segments = segmentContent(row.content, row.edition_type);
  const refLabels = new Map([["a01", A1], ["a02", A2]]);
  const labelOf = new Map([[A1, "a01"], [A2, "a02"]]);
  const full = (a: typeof ART1) => [a.title_kr, a.summary_kr, a.ai_insights_kr, a.title_cn, a.content_kr, a.summary_cn].join(" ");
  return {
    row, editionType: row.edition_type, periodStart: row.period_start!, periodEnd: row.period_end!, segments,
    articles: [ART1, ART2].map((a, i) => ({
      id: a.id, label: `a0${i + 1}`, source_name: a.source_name, news_date: a.news_date!, subject_region: "CN", title_kr: a.title_kr, title_cn: a.title_cn,
      summary_kr: a.summary_kr, ai_insights_kr: a.ai_insights_kr, content_kr: a.content_kr, summary_cn: a.summary_cn!,
    })),
    refLabels, labelOf, facts: null, metrics: null, candidates: [{ cid: "C1", title: "바이두 새 칩", article_ids: ["33333333-3333-4333-8333-333333333333"], sources: ["36Kr", "Huxiu"], days: ["2026-10-27"], summary: "" }],
    translations: [
      { id: "en1", locale: "en", version: 3, status: "draft", problems: [], content: {} },
      { id: "zh1", locale: "zh", version: 3, status: "draft", problems: [], content: {} },
    ],
    incompleteDays: [], meta: row.content.meta as Record<string, unknown>, fullText: new Map([[A1, full(ART1)], [A2, full(ART2)]]),
    revalidate: (c) => ({ content: c, fatal: [], warn: [] }),
    candidateArticles: new Map([[A1, ART1], [A2, ART2]]),
    genLog: { fallback: null, fallbackReason: null, targetedRepair: false, edits: [], warns: [] },
    ...over,
  };
}

/** 모든 문장을 correct 로 라벨한 응답 (sid → 덮어쓸 라벨) */
export function reviewerJson(input: ReviewInput, overrides: Record<string, Record<string, unknown>> = {}, extra: Record<string, unknown> = {}) {
  return {
    claims: input.segments.map((s) => ({ s: s.sid, c: s.text.slice(0, 20), l: "correct", r: s.refs.map((r) => input.labelOf.get(r)).join(","), ...(overrides[s.sid] ?? {}) })),
    fixes: [],
    omissions: [{ c: "C1", important: false, why: "작은 이야기" }],
    translation: [],
    structure: [],
    verdict: "PASS",
    summary: "문제 없음",
    ...extra,
  };
}

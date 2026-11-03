/**
 * 데일리 중국 AI 브리핑 — 공용 타입.
 *
 * 생성 단계에서는 refs 가 짧은 id(A01..)이고, 저장할 때 uuid 로 되돌린다.
 * 같은 BriefingContent 모양을 두 단계 모두에 쓴다 (Ref 타입만 다름).
 */

export type BriefingLocale = "ko" | "en" | "zh";
export const BRIEFING_LOCALES: BriefingLocale[] = ["ko", "en", "zh"];

export type BriefingStatus =
  | "generating"
  | "draft"
  | "failed"
  | "skipped"
  | "published"
  | "superseded"
  | "withdrawn";

/** §1.2 물량 규칙: ≥6 정상 판, 3~5 짧은 판, <3 생략 */
/** headlines = 생성이 끝내 실패한 날의 제목만 판 (fallback.ts — LLM 문장 없음, ko 만) */
export type EditionMode = "normal" | "short" | "skipped" | "headlines";

export const SECTION_CODES = [
  "models",
  "products",
  "funding",
  "chips",
  "policy",
  "safety",
  "robotics",
  "research",
  "industry",
] as const;
export type SectionCode = (typeof SECTION_CODES)[number];

/** DB 에서 읽은 후보 기사 한 건 (LLM 입력 + 검증 근거) */
export interface CandidateArticle {
  id: string; // uuid
  source_name: string;
  source_url: string | null;
  category: string;
  title_cn: string;
  title_kr: string;
  summary_kr: string;
  ai_insights_kr: string;
  key_terms: KeyTerm[];
  /** 중국어 원문 요약 (통화·고유명사 대조용 — 숫자 근거에는 넣지 않는다) */
  summary_cn?: string;
  /** 본문 요지(원문에서 만든 한국어 3~5문장, 평균 약 900자). S2(2026-11-03): 생성 입력·숫자 근거에 넣는다 */
  content_kr?: string;
  /** 베이징 날짜 YYYY-MM-DD */
  news_date?: string;
  /** 기사 대상 지역 (ai_news_ex.subject_region, region.ts). 중국 중심 규칙(rules.ts isChinaSubject)·프롬프트 지역 표시 */
  subject_region?: string | null;
  /** 지역 태그 (CN·US·TW·HK…) */
  region_tags?: string[];
}

export interface KeyTerm {
  term?: string;
  pinyin?: string;
  explanation_kr?: string;
  explanation_en?: string;
  explanation_zh?: string;
}

/** 전재 묶음 하나 = LLM 에게 보이는 후보 하나. 대표 기사 + 같은 글을 실은 형제 기사 */
export interface CandidateGroup {
  shortId: string; // A01..
  primary: CandidateArticle;
  siblings: CandidateArticle[]; // 전재(제목 바이그램 Jaccard ≥ 0.6)
  sources: string[]; // 대표 + 형제의 매체명 (중복 제거)
  /** 같은 사건(제목이 다른 묶음 포함)을 다룬 매체 전체 (news-rank sameEvent). 없으면 sources */
  eventSources?: string[];
  score: number;
  scoreDetail: Record<string, number>;
}

export interface TopStory<Ref = string> {
  rank: number;
  section: SectionCode | string;
  subject: string; // 주체 기업·기관
  subject_is_chinese: boolean;
  title: string;
  what: string;
  why: string;
  refs: Ref[];
  primary_ref: Ref;
}

export interface SectionItem<Ref = string> {
  text: string;
  refs: Ref[];
}

export interface BriefingSection<Ref = string> {
  section: SectionCode | string;
  items: SectionItem<Ref>[];
}

export interface KeyNumber<Ref = string> {
  value: string;
  label: string;
  ref: Ref;
}

export interface CompanyToWatch<Ref = string> {
  name: string;
  why: string;
  refs: Ref[];
}

export interface TermOfTheDay<Ref = string> {
  term: string;
  pinyin: string;
  ref: Ref;
  /** DB key_terms 의 설명을 그대로 복사 (LLM 이 쓰지 않음). 저장 시 채운다. */
  explanation?: string;
}

export interface BriefingCluster<Ref = string> {
  story: string;
  ids: Ref[];
}

export interface ExcludedItem<Ref = string> {
  id: Ref;
  reason: string;
}

export interface BriefingContent<Ref = string> {
  headline: string;
  lede: string;
  lede_refs: Ref[];
  top_stories: TopStory<Ref>[];
  sections: BriefingSection<Ref>[];
  key_numbers: KeyNumber<Ref>[];
  companies_to_watch: CompanyToWatch<Ref>[];
  term_of_the_day: TermOfTheDay<Ref> | null;
  clusters: BriefingCluster<Ref>[];
  excluded: ExcludedItem<Ref>[];
  editor_note?: string;
}

/** DB content 컬럼에 들어가는 모양 (refs = uuid) */
export interface StoredBriefingContent extends BriefingContent<string> {
  meta: {
    edition_date: string;
    locale: BriefingLocale;
    mode: EditionMode;
    candidate_count: number; // 그날 공개 AI 기사 수 ("기사 N건 중")
    group_count: number; // 정치 제외·전재 묶음 후 이야기 수 (물량 규칙 기준)
    cited_count: number; // 인용한 기사 수 ("M건 정리")
    china_centric_count: number; // 상위 5건 중 중국 주체 수
    /** 믿을 만한 중국 후보 사건 수 (결정 D3, 2026-11-03~ 판). 중국 중심 규칙은 min(3, 이 값) */
    china_credible?: number;
    prompt_version: string;
    ai_generated: true;
    /** 판 기간의 수집 품질 (주간·월간과 같은 결손일 판정). 결손일이 있으면 화면에 데이터 알림 */
    data_quality?: import("../metrics/period").DayQuality;
  };
}

export type IssueLevel = "fatal" | "warn";

export interface ValidationIssue {
  level: IssueLevel;
  rule: string;
  /** 항목 위치: lede | headline | top_stories[0].what | sections[1].items[0] | key_numbers[2] ... */
  path: string;
  detail: string;
}

export interface ValidationReport {
  fatal: ValidationIssue[];
  warn: ValidationIssue[];
  /** refs 관련성 검사로 떼어낸 ref (path → 떼어낸 id) */
  droppedRefs: { path: string; ref: string }[];
  stats: {
    numbersChecked: number;
    topStories: number;
    chinaCentric: number;
    citedIds: number;
    bodyChars: number;
  };
}

export interface LlmUsage {
  requestId: string | null;
  model: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  latencyMs: number;
  finishReason: string | null;
}

export interface GenerateOptions {
  date?: string; // YYYY-MM-DD (베이징 판 날짜). 없으면 정기 일정(sla.ts scheduledRunEdition)
  force?: boolean;
  /** 테스트·CLI 용: LLM 을 부르지 않고 후보만 계산 */
  dryRun?: boolean;
  /** 일요일 단독판을 굳이 만들 때만 (CLI --sunday). force 로는 만들지 않는다 — 토요일 합본과 같은 기사가 두 번 실림 */
  sunday?: boolean;
}

export interface LocaleOutcome {
  locale: BriefingLocale;
  id: string | null;
  version: number | null;
  status: BriefingStatus | "not_run";
  fatal: number;
  warn: number;
  costUsd: number;
  error?: string;
}

export interface GenerateResult {
  date: string;
  outcome: "generated" | "skipped_same_input" | "skipped_low_volume" | "skipped_weekend" | "locked" | "failed" | "dry_run";
  mode: EditionMode | null;
  candidateCount: number;
  inputHash: string | null;
  locales: LocaleOutcome[];
  totalCostUsd: number;
  message?: string;
  /** 대체 판으로 내려갔으면 short | headlines (n8n 이 outcome generated 여도 알림을 보낸다) */
  fallback?: string;
  fallbackReason?: string;
}

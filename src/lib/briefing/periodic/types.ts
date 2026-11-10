/**
 * 주간·월간 리포트 공용 타입 (같은 파이프라인·같은 화면, kind 로만 갈린다 — Gate 2). 생성 단계 refs 는 짧은 id(S01..), 저장할 때 uuid 로 되돌린다.
 * 숫자는 SQL 이 계산한 지표(FACTS)의 표시 문자열만 인용한다 — metrics 는 FACTS 키 목록.
 */
import type { PeriodMetrics } from "../../metrics/period";
import type { StoryContext, ValidationIssue } from "../types";

/** 주간·월간 판의 "큰 흐름" 최소 개수 — 생성(generate.ts)과 AI 검토 마지막 지우기(pipeline.ts)가 같이 쓴다 */
export const PERIODIC_MIN_BIG_PICTURE = 2;

export interface TrendItem<Ref = string> {
  title: string;
  text: string;
  refs: Ref[];
  metrics: string[];
  /** "회사·관련 주제 히스토리 분석" (story-context.ts, 시범). 저장 content 에는 없고 화면에 보낼 때(public.ts hydrate)만 붙인다 */
  story_context?: StoryContext[];
}

export interface MoverItem<Ref = string> {
  /** 실체 key (entities.ts) */
  entity: string;
  text: string;
  refs: Ref[];
  metrics: string[];
}

/** 월간: 주마다 한 문장 ("한 달의 흐름") */
export interface ArcItem<Ref = string> {
  /** "W42" (지표 weeks[].key) */
  week: string;
  text: string;
  refs: Ref[];
  metrics: string[];
}

export type PeriodicKind = "weekly" | "monthly";

export interface PeriodicContent<Ref = string> {
  headline: string;
  dek: string;
  dek_refs: Ref[];
  dek_metrics: string[];
  big_picture: TrendItem<Ref>[];
  movers: MoverItem<Ref>[];
  money: { text: string; refs: Ref[] } | null;
  china_lens: { text: string; refs: Ref[]; metrics: string[] } | null;
  watch_next: { text: string; refs: Ref[] }[];
  term: { term: string; why: string; metrics: string[] } | null;
  /** 월간만 (주간은 빈 배열) */
  month_arc: ArcItem<Ref>[];
}

/** 예전 이름 (주간 MVP) */
export type WeeklyContent<Ref = string> = PeriodicContent<Ref>;

export interface PeriodicMeta {
  edition_type: PeriodicKind;
  /** 기간 키: 주간 "2026-W44", 월간 "2026-10" */
  period_key?: string;
  /** 주간만 (예전 판 호환) */
  iso_week?: string;
  /** 월간만 */
  month?: string;
  period_start: string;
  period_end: string;
  locale: "ko";
  prompt_version: string;
  metrics_id: string;
  metrics_version: string;
  /** 공개 AI 기사 수 */
  candidate_count: number;
  /** LLM 에게 보인 이야기 후보 수 */
  story_count: number;
  data_quality: { incomplete_days: string[]; reduced_days?: string[]; partial_days?: string[] };
  /** 비교 기간 (없으면 비교 없음 — 비교 기간이 축소 수집이면 싣지 않는다) */
  baseline?: { start: string; end: string } | null;
  /** 검증에서 빠져 결정적 문장으로 대체한 필드 (dek, headline) */
  fallbacks: string[];
  ai_generated: true;
}

export type WeeklyMeta = PeriodicMeta;

export interface StoredPeriodicContent extends PeriodicContent<string> {
  meta: PeriodicMeta;
}
export type StoredWeeklyContent = StoredPeriodicContent;

/** LLM 후보 하나 (S01..) */
export interface StoryPoolItem {
  sid: string;
  ids: string[];
  title_kr: string;
  summary_kr: string;
  sources: string[];
  days: string[];
  entities: string[];
}

export interface PeriodicValidationReport {
  fatal: ValidationIssue[];
  warn: ValidationIssue[];
  stats: { bigPicture: number; chinaCentric: number; numbersChecked: number };
}

export type { PeriodMetrics };

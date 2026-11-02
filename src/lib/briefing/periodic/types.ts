/**
 * 주간(·월간) 리포트 공용 타입. 생성 단계 refs 는 짧은 id(S01..), 저장할 때 uuid 로 되돌린다.
 * 숫자는 SQL 이 계산한 지표(FACTS)의 표시 문자열만 인용한다 — metrics 는 FACTS 키 목록.
 */
import type { PeriodMetrics } from "../../metrics/period";
import type { ValidationIssue } from "../types";

export interface TrendItem<Ref = string> {
  title: string;
  text: string;
  refs: Ref[];
  metrics: string[];
}

export interface MoverItem<Ref = string> {
  /** 실체 key (entities.ts) */
  entity: string;
  text: string;
  refs: Ref[];
  metrics: string[];
}

export interface WeeklyContent<Ref = string> {
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
}

export interface WeeklyMeta {
  edition_type: "weekly";
  iso_week: string;
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
  data_quality: { incomplete_days: string[] };
  /** 검증에서 빠져 결정적 문장으로 대체한 필드 (dek, headline) */
  fallbacks: string[];
  ai_generated: true;
}

export interface StoredWeeklyContent extends WeeklyContent<string> {
  meta: WeeklyMeta;
}

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

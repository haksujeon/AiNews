/**
 * AI 편집 검토(결정 D8 변경, 2026-11-02) — 공용 타입.
 *
 * 사람 감사(briefing-qa-2026-11-02 RUBRIC.md)와 같은 단위·라벨을 쓴다:
 *   본문을 원자 주장(claim)으로 나눔 → 인용 기사 근거로 라벨 → 누락 점검 → 점수(코드가 계산) → 판정.
 * 이 파일은 DB·LLM 을 import 하지 않는다 (단위 테스트).
 */
import type { EditionType } from "../repository";

export const CLAIM_LABELS = ["correct", "unsupported", "wrong", "misattributed", "overclaim", "number-unit"] as const;
export type ClaimLabel = (typeof CLAIM_LABELS)[number];

export type Verdict = "PASS" | "FIXABLE" | "FAIL";
export const VERDICTS: Verdict[] = ["PASS", "FIXABLE", "FAIL"];

export type ReviewTrigger = "pipeline" | "manual" | "calibration" | "dry_run";

/** 본문 문장 한 개 (검토 입력의 S01..). 고칠 때도 이 단위로 바꾸거나 지운다 */
export interface Segment {
  /** S01.. */
  sid: string;
  /** 필드 위치: headline | lede | top_stories[0].what | sections[1].items[0] | key_numbers[2] | big_picture[0].text ... */
  path: string;
  /** 필드 안 문장 순번 (0부터) */
  index: number;
  text: string;
  /** 이 필드의 근거 기사 uuid */
  refs: string[];
  /** 주간·월간: 이 필드가 인용한 FACTS 키 */
  metrics?: string[];
  /** 문장으로 나누지 않는 짧은 필드 (제목·숫자·이름) — 고칠 때 필드 전체를 바꾼다 */
  whole: boolean;
  /** 화면·프롬프트용 맥락 (주요 기사 제목, 기업 이름, 실체 이름 등) */
  context?: string;
  /** content 안 필드 위치 (JSON 경로) */
  ptr: (string | number)[];
  /** 필드가 비면 통째로 빼는 항목 위치. null = 뺄 수 없는 필드 (headline·lede·dek) */
  itemPtr: (string | number)[] | null;
  /** 비어도 되는 보조 칸 (주간 큰 흐름의 쉽게 말하면·왜 중요할까) — 문장을 다 지우면 그 칸만 비우고 항목은 남긴다 */
  optional?: boolean;
}

export interface ReviewClaim {
  sid: string;
  path: string;
  claim_type: string;
  claim: string;
  label: ClaimLabel;
  /** 근거 기사 라벨 (a01..) — 저장 시 uuid 도 함께 */
  ref: string | null;
  ref_ids: string[];
  evidence: string;
  note: string;
  /** 근거 인용이 실제 인용 기사 본문에 그대로 있는가 (코드가 확인) */
  evidence_verified?: boolean;
}

export interface ReviewFix {
  sid: string;
  path: string;
  action: "replace" | "delete";
  original: string;
  /** replace 일 때 고친 문장 */
  text: string;
  ref: string | null;
  evidence: string;
  reason: string;
}

export interface ReviewOmission {
  /** C1.. (결정적으로 계산한 누락 후보) */
  cid: string;
  title: string;
  important: boolean;
  why: string;
  article_ids: string[];
  sources: number;
}

export interface TranslationIssue {
  locale: "en" | "zh";
  path: string;
  severity: "major" | "minor";
  issue: string;
}

export interface LabelCounts {
  correct: number;
  unsupported: number;
  wrong: number;
  misattributed: number;
  overclaim: number;
  "number-unit": number;
  total: number;
}

/** LLM 응답을 스키마 검증한 결과 */
export interface ParsedReview {
  claims: ReviewClaim[];
  fixes: ReviewFix[];
  omissions: ReviewOmission[];
  translation: TranslationIssue[];
  structure: string[];
  llmVerdict: Verdict | null;
  summary: string;
  /** 스키마 경고 (버린 항목 등) */
  schemaIssues: string[];
}

export interface ScoreResult {
  score: number;
  counts: LabelCounts;
  breakdown: string[];
  /** 사람 감사 기준표 그대로의 판정 (발행 가능 = PASS, 수정 후 발행 = FIXABLE, 재생성 필요 = FAIL) */
  rubricVerdict: Verdict;
  /** headline·lede 의 wrong/number-unit 수 */
  headLedeErrors: number;
}

/** 검토 1회 결과 (DB briefing_reviews 한 행) */
export interface ReviewResult {
  id: string | null;
  briefingId: string;
  version: number;
  editionType: EditionType;
  editionDate: string;
  round: number;
  trigger: ReviewTrigger;
  model: string;
  promptVersion: string;
  status: "done" | "error";
  verdict: Verdict | null;
  llmVerdict: Verdict | null;
  score: number | null;
  counts: LabelCounts | null;
  breakdown: string[];
  claims: ReviewClaim[];
  fixes: ReviewFix[];
  omissions: ReviewOmission[];
  translation: TranslationIssue[];
  structure: string[];
  summary: string;
  schemaIssues: string[];
  costUsd: number;
  latencyMs: number;
  inputTokens: number;
  outputTokens: number;
  requestIds: string[];
  error?: string;
  /** 파싱하지 못한 응답 원문 (오류 때만 저장 — 다시 부르지 않고 고쳐 읽을 수 있게) */
  rawResponse?: string;
}

export const emptyCounts = (): LabelCounts => ({
  correct: 0,
  unsupported: 0,
  wrong: 0,
  misattributed: 0,
  overclaim: 0,
  "number-unit": 0,
  total: 0,
});

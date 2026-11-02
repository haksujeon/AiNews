/**
 * 점수·판정 — 사람 감사 기준표(briefing-qa-2026-11-02/support/RUBRIC.md + REPORT-v2 의 "점수 ≤3 이면 재생성")를 코드로 옮긴 것.
 * LLM 은 라벨·근거·누락 중요도만 낸다. 점수와 판정은 여기서 계산한다 (임계값을 모델 재호출 없이 조정할 수 있게).
 *
 *  10점에서 시작: wrong −1.5 (headline·lede 면 −3), number-unit −1.5 (headline·lede −3), unsupported −1,
 *  overclaim −0.75, misattributed −0.5, 중요한 누락 −0.5 (최대 −2), 구조 문제 −0.25 (최대 −1.5). 0 아래 없음, 소수 1자리.
 *  판정: headline·lede 의 wrong/number-unit 이 있거나 wrong+number-unit ≥ 3 이거나 점수 ≤ 3 → FAIL(재생성 필요)
 *        점수 ≥ passScore(기준표 8.5) 이고 wrong/number-unit 0 → PASS(발행 가능), 그 밖 → FIXABLE(수정 후 발행)
 */
import type { LabelCounts, ReviewClaim, ReviewOmission, ScoreResult, Verdict } from "./types";
import { emptyCounts } from "./types";

export const RUBRIC_PASS_SCORE = 8.5;
const PENALTY: Record<string, number> = { wrong: 1.5, "number-unit": 1.5, unsupported: 1, overclaim: 0.75, misattributed: 0.5 };
const HEAD_PENALTY = 3;
const OMISSION_EACH = 0.5;
const OMISSION_CAP = 2;
const STRUCTURE_EACH = 0.25;
const STRUCTURE_CAP = 1.5;
const FAIL_SCORE_MAX = 3;

export const isHeadOrLede = (path: string) => path === "headline" || path === "lede";

export function countLabels(claims: ReviewClaim[]): LabelCounts {
  const c = emptyCounts();
  for (const x of claims) {
    c[x.label]++;
    c.total++;
  }
  return c;
}

export function scoreReview(
  claims: ReviewClaim[],
  omissions: Pick<ReviewOmission, "important">[],
  structureIssues: number,
  opts: { passScore?: number } = {}
): ScoreResult {
  const counts = countLabels(claims);
  const breakdown: string[] = [];
  let score = 10;
  let headLedeErrors = 0;
  for (const c of claims) {
    if (c.label === "correct") continue;
    const head = isHeadOrLede(c.path) && (c.label === "wrong" || c.label === "number-unit");
    if (head) headLedeErrors++;
    const p = head ? HEAD_PENALTY : PENALTY[c.label] ?? 0;
    score -= p;
    breakdown.push(`${c.path} ${c.label} −${p}`);
  }
  const om = Math.min(OMISSION_CAP, omissions.filter((o) => o.important).length * OMISSION_EACH);
  if (om) breakdown.push(`누락 −${om}`);
  const st = Math.min(STRUCTURE_CAP, structureIssues * STRUCTURE_EACH);
  if (st) breakdown.push(`구조 −${st}`);
  score = Math.max(0, Math.round((score - om - st) * 10) / 10);
  const hard = counts.wrong + counts["number-unit"];
  const passScore = opts.passScore ?? RUBRIC_PASS_SCORE;
  let rubricVerdict: Verdict;
  if (headLedeErrors > 0 || hard >= 3 || score <= FAIL_SCORE_MAX) rubricVerdict = "FAIL";
  else if (score >= passScore && hard === 0) rubricVerdict = "PASS";
  else rubricVerdict = "FIXABLE";
  return { score, counts, breakdown, rubricVerdict, headLedeErrors };
}

const RANK: Record<Verdict, number> = { PASS: 0, FIXABLE: 1, FAIL: 2 };
/** 두 판정 중 더 엄격한 쪽 (코드 판정과 모델 판정이 다르면 보수적으로) */
export function stricter(a: Verdict, b: Verdict | null): Verdict {
  if (!b) return a;
  return RANK[b] > RANK[a] ? b : a;
}

/** 사람 감사 권고 → 판정 (보정용) */
export function verdictOfRecommendation(rec: string): Verdict {
  if (/발행 가능/.test(rec)) return "PASS";
  if (/재생성/.test(rec)) return "FAIL";
  return "FIXABLE";
}

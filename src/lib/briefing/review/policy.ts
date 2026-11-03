/**
 * 자동 발행 정책 (결정 D8 변경, 2026-11-02 사용자 결정: "AI 검토에서 문제가 없으면 바로 공개").
 * 순수 함수 — 조건마다 통과 여부를 남겨 관리자 화면의 "자동 발행 판정"에 그대로 보인다.
 *
 * 기본값 (환경 변수로 조정, 보정 결과는 ainews-reports/p0-plan/P0-PLAN.md D8):
 *  - BRIEFING_AUTO_PUBLISH=on|off        (기본 off — 켜야 AI 검토 통과 판을 발행한다. 꺼져 있으면 판정만 기록·알림 = 관리자 발행)
 *    보정 v6 에서 목표 3(사실 오류 재현율 ≥ 80%)을 못 채워(77.5%, 막는 라벨 기준 60%) 기본값을 off 로 둔다. 켜는 것은 사용자 승인 뒤.
 *  - 독립 검토 BRIEFING_REVIEW_PASSES 회(기본 2) 모두 아래 조건 통과 (2026-11-03 — 1회 통과면 확인 검토를 한 번 더, pipeline.ts)
 *  - 판정 PASS (코드 기준표 판정과 모델 판정 중 엄격한 쪽)
 *  - wrong · number-unit · misattributed 0건, overclaim ≤ 1, unsupported ≤ 0
 *  - 점수 ≥ 9.0 (데일리) / ≥ 7.5 (주간·월간)   BRIEFING_REVIEW_MIN_SCORE_DAILY / _PERIODIC
 *    (보정 v6 24판: 사람 "발행 가능" 10-27 v7 = 9.5, 사람 6.5 "수정 후 발행" 09-16 v1 = 8.8 → 데일리 기준 8.0 이면 09-16 v1 도 자동 발행되어 9.0 으로 올림.
 *     주간·월간은 보정에서 PASS 가 한 판도 없어 7.5 는 기준표 기본값 그대로 — 결손일 조건과 함께 사실상 사람 확인)
 *  - 결정적 검사기 치명 0건, 고칠 수 없는 항목 없음
 *  - 데일리: en·zh 번역본이 이 ko 버전에서 나온 draft 이고 번역 재검증 문제 0건, 검토의 번역 major 문제 0건
 *  - 주간·월간: 수집 미완 날짜가 없다 (있으면 데이터 알림 확인이 필요하므로 사람에게 넘긴다 — 자동으로 확인하지 않는다)
 *  - 제목만 판(mode headlines, 생성이 끝내 실패한 날의 대체 판): LLM 이 쓴 문장이 없어(기사 제목·매체·링크 + "요약을 만들지 못해
 *    제목과 원문 링크만 싣습니다" 고정 안내) AI 검토 없이 결정적 조건만 보고 자동 발행한다 — BRIEFING_AUTO_PUBLISH_HEADLINES=on|off (기본 on).
 *    판 없는 날을 만들지 않는 것이 목적이고, 안내 문장이 곧 데이터 알림이다. 알림은 언제나 보낸다.
 */
import type { EditionType } from "../repository";
import type { ReviewResult } from "./types";

export interface ReviewPolicy {
  autoPublish: boolean;
  /** 제목만 판 자동 발행 — AI 검토와 무관하므로 별도 스위치 (기본 on) */
  autoPublishHeadlines: boolean;
  minScore: { daily: number; periodic: number };
  maxOverclaim: number;
  maxUnsupported: number;
  blockingLabels: ("wrong" | "number-unit" | "misattributed")[];
  /** 수정 루프 최대 횟수 */
  maxFixRounds: number;
  /**
   * 자동 발행에 필요한 독립 검토 통과 횟수 (BRIEFING_REVIEW_PASSES, 기본 2 — 2026-11-03 사용자 결정 "2번 검증하고 기준 통과면 자동 발행").
   * 보정: Sonnet 5.5 1회는 실행마다 판정이 바뀌는 판 6/23 → 2회 모두 통과 모의에서 사람 9.3점 판만 발행 (model-compare-2026-11/REPORT.md §1)
   */
  requiredPasses: number;
}

const num = (v: string | undefined, d: number) => {
  const n = Number(v);
  return v !== undefined && v !== "" && Number.isFinite(n) ? n : d;
};

export function policyFromEnv(env: Record<string, string | undefined> = process.env): ReviewPolicy {
  const flag = (env.BRIEFING_AUTO_PUBLISH ?? "off").trim().toLowerCase();
  return {
    autoPublish: ["on", "1", "true", "yes"].includes(flag),
    autoPublishHeadlines: !["off", "0", "false", "no"].includes((env.BRIEFING_AUTO_PUBLISH_HEADLINES ?? "on").trim().toLowerCase()),
    minScore: { daily: num(env.BRIEFING_REVIEW_MIN_SCORE_DAILY, 9), periodic: num(env.BRIEFING_REVIEW_MIN_SCORE_PERIODIC, 7.5) },
    maxOverclaim: num(env.BRIEFING_REVIEW_MAX_OVERCLAIM, 1),
    maxUnsupported: num(env.BRIEFING_REVIEW_MAX_UNSUPPORTED, 0),
    blockingLabels: ["wrong", "number-unit", "misattributed"],
    maxFixRounds: Math.max(0, Math.min(2, num(env.BRIEFING_REVIEW_MAX_FIX_ROUNDS, 2))),
    requiredPasses: Math.max(1, Math.min(3, num(env.BRIEFING_REVIEW_PASSES, 2))),
  };
}

export const minScoreFor = (p: ReviewPolicy, t: EditionType) => (t === "daily" ? p.minScore.daily : p.minScore.periodic);

export interface TranslationState {
  locale: "en" | "zh";
  /** 이 ko 버전에서 번역된 행 (없으면 null) */
  status: string | null;
  problems: number;
}

export interface DecisionInput {
  review: Pick<ReviewResult, "status" | "verdict" | "score" | "counts" | "translation" | "error">;
  editionType: EditionType;
  /** 결정적 검사기 치명 수 (저장된 validation.final) */
  deterministicFatal: number;
  /** 수정 단계에서 고칠 수 없었던 것 */
  unfixable?: string[];
  /** 데일리만 */
  translations?: TranslationState[];
  /** 주간·월간: 수집 미완 날짜 */
  incompleteDays?: string[];
  /** 지금 판의 상태가 draft 이고 최신 버전인가, 같은 날 발행본이 없는가 (publish 가 다시 확인한다) */
  publishable?: { ok: boolean; detail: string };
}

export interface DecisionCheck {
  rule: string;
  ok: boolean;
  detail: string;
}

export interface Decision {
  /** 조건을 모두 통과 (자동 발행 스위치와 무관) */
  eligible: boolean;
  /** 실제로 발행해야 하는가 (eligible && 스위치 on) */
  publish: boolean;
  checks: DecisionCheck[];
  policy: ReviewPolicy;
  /** 사람이 읽는 한 줄 (텔레그램·관리자 화면) */
  summary: string;
}

export function decide(input: DecisionInput, policy: ReviewPolicy): Decision {
  const { review: r } = input;
  const c = r.counts;
  const checks: DecisionCheck[] = [];
  const add = (rule: string, ok: boolean, detail: string) => checks.push({ rule, ok, detail });
  add("review_done", r.status === "done" && !!c, r.status === "done" ? "검토 완료" : `검토 오류: ${r.error ?? "알 수 없음"}`);
  add("verdict_pass", r.verdict === "PASS", `판정 ${r.verdict ?? "—"}`);
  for (const l of policy.blockingLabels) add(`no_${l}`, (c?.[l] ?? 0) === 0, `${l} ${c?.[l] ?? "—"}건`);
  add("overclaim", (c?.overclaim ?? 99) <= policy.maxOverclaim, `overclaim ${c?.overclaim ?? "—"}건 (≤ ${policy.maxOverclaim})`);
  add("unsupported", (c?.unsupported ?? 99) <= policy.maxUnsupported, `unsupported ${c?.unsupported ?? "—"}건 (≤ ${policy.maxUnsupported})`);
  const min = minScoreFor(policy, input.editionType);
  add("score", (r.score ?? -1) >= min, `점수 ${r.score ?? "—"} (≥ ${min})`);
  add("deterministic", input.deterministicFatal === 0, `결정적 검사 치명 ${input.deterministicFatal}건`);
  if (input.unfixable?.length) add("fixable", false, `고칠 수 없음: ${input.unfixable.join("; ")}`);
  if (input.editionType === "daily") {
    const tr = input.translations ?? [];
    for (const loc of ["en", "zh"] as const) {
      const t = tr.find((x) => x.locale === loc);
      add(`translation_${loc}`, !!t && t.status === "draft" && t.problems === 0, t ? `${loc} ${t.status}, 재검증 문제 ${t.problems}건` : `${loc} 번역본 없음`);
    }
    const major = r.translation.filter((t) => t.severity === "major");
    add("translation_review", major.length === 0, `검토가 찾은 번역 major 문제 ${major.length}건`);
  } else {
    const days = input.incompleteDays ?? [];
    add("data_quality", days.length === 0, days.length ? `수집 미완 날짜 ${days.join(", ")} — 데이터 알림 확인은 사람이` : "결손일 없음");
  }
  if (input.publishable) add("publishable", input.publishable.ok, input.publishable.detail);
  const eligible = checks.every((x) => x.ok);
  const publish = eligible && policy.autoPublish;
  const failed = checks.filter((x) => !x.ok).map((x) => x.detail);
  const summary = publish
    ? `자동 발행: ${r.verdict} ${r.score}점`
    : eligible
      ? `자동 발행 조건 통과, 스위치 꺼짐(BRIEFING_AUTO_PUBLISH=off) — 관리자 발행 필요 (${r.verdict} ${r.score}점)`
      : `초안 유지 — ${failed.slice(0, 4).join(" / ")}`;
  return { eligible, publish, checks, policy, summary };
}

/** 제목만 판 안내 문장 (fallback.ts headlinesEdition 의 lede) — 이 안내가 있어야 독자에게 "요약 없음"이 보인다 */
export const HEADLINES_NOTICE_RE = /제목과 원문 링크만/;

/** 제목만 판 결정 (AI 검토 없음): 치명 0, 주요 기사 3건 이상, 안내 문장 있음, 발행 가능 상태 */
export function decideHeadlines(
  input: { content: Record<string, unknown>; deterministicFatal: number; publishable?: { ok: boolean; detail: string } },
  policy: ReviewPolicy
): Decision {
  const checks: DecisionCheck[] = [];
  const add = (rule: string, ok: boolean, detail: string) => checks.push({ rule, ok, detail });
  const tops = Array.isArray(input.content.top_stories) ? input.content.top_stories.length : 0;
  add("headlines_policy", policy.autoPublishHeadlines, policy.autoPublishHeadlines ? "제목만 판 자동 발행 허용" : "BRIEFING_AUTO_PUBLISH_HEADLINES=off");
  add("deterministic", input.deterministicFatal === 0, `결정적 검사 치명 ${input.deterministicFatal}건`);
  add("top_stories", tops >= 3, `기사 제목 ${tops}건 (≥ 3)`);
  add("notice", HEADLINES_NOTICE_RE.test(String(input.content.lede ?? "")), "요약 없음 안내 문장");
  if (input.publishable) add("publishable", input.publishable.ok, input.publishable.detail);
  const eligible = checks.every((c) => c.ok);
  // 제목만 판은 LLM 문장이 없어 AI 검토 스위치와 무관 — 정책 검사(headlines_policy)가 곧 스위치
  const publish = eligible;
  const failed = checks.filter((c) => !c.ok).map((c) => c.detail);
  return {
    eligible,
    publish,
    checks,
    policy,
    summary: publish ? "제목만 판 자동 발행 (AI 검토 생략)" : eligible ? "제목만 판 조건 통과, 자동 발행 꺼짐 — 관리자 발행 필요" : `제목만 판 초안 유지 — ${failed.join(" / ")}`,
  };
}

/**
 * AI 검토 파이프라인 — 생성 뒤 검토 → (수정 루프 최대 2회) → 자동 발행 또는 초안 유지 + 알림.
 * 2026-11-02 사용자 결정(D8 변경): "매번 관리자가 브리핑을 검증할 수는 없어. AI 검토 기능을 만들어 문제가 없으면 바로 공개".
 *
 * 비동기 구조 (생성 라우트 안에서 돌리지 않는다):
 *  - 생성(+번역)만 15~60초+, 검토 1회는 Sonnet 출력 수천 토큰이라 1~3분, 수정 2회면 검토 3회 → 생성 라우트 300초를 넘는다.
 *  - n8n "AiNews briefing schedule" 이 생성 뒤 POST /api/internal/briefing/review 를 여러 번 부른다(정기 스윕).
 *    호출마다 시간 예산(기본 250초) 안에서 할 수 있는 만큼 하고, 상태는 briefing_reviews 에 남아 다음 호출이 이어 간다 (재개 가능, 멱등).
 *  - 생성과 같은 판별 잠금(withDateLock)을 잡는다 → 생성 중인 판은 건드리지 않는다.
 *
 * 대상: 판 기간 끝이 BRIEFING_REVIEW_SINCE(기본 2026-11-02) 이후이고 48시간 안에 만든 최신 ko draft 중
 *       같은 판에 발행본이 없고 아직 최종 결정(decision.final)이 없는 것. (배포 전 쌓인 옛 초안은 자동 발행하지 않는다)
 * dryRun: 수정본·번역을 메모리에서만 만들고 검토 기록(trigger dry_run)과 결정만 남긴다 — 새 버전 저장·발행 없음.
 */
import pool from "@/lib/db";
import { publishBriefing, PublishError } from "../publish";
import { insertBriefing, withDateLock, type BriefingRow, type EditionType } from "../repository";
import { citedRefs } from "../validate";
import { citedSids, keyNumberProblem } from "../periodic/validate";
import { fallbackDek, fallbackHeadline } from "../periodic/prompt";
import type { BriefingContent, ValidationIssue } from "../types";
import { PERIODIC_MIN_BIG_PICTURE, type WeeklyContent } from "../periodic/types";
import { SITE_ORIGIN } from "@/lib/site";
import { loadReviewInput, type ReviewInput, type TranslationRow } from "./evidence";
import { planFixes, type FixPlan } from "./fix";
import { decide, decideHeadlines, minScoreFor, policyFromEnv, type Decision, type ReviewPolicy } from "./policy";
import { corpusFor, defaultDeps as defaultReviewDeps, reviewBriefing, type ReviewDeps } from "./review";
import { retranslate, type RetranslateResult } from "./retranslate";
import type { TranslateOptions } from "../translate";
import { applySegmentEdits, isPeriodic, segmentContent, type EditOutcome } from "./segments";
import { reviewThatProduced, reviewsOf, updateReviewDecision } from "./store";
import type { ReviewResult, ReviewTrigger } from "./types";
import { EASY_TIMEOUT_MS, easyRunNote, ensureEasyTerms } from "../easy-terms-run";

export const REVIEW_SINCE = process.env.BRIEFING_REVIEW_SINCE || "2026-11-02";
/** 검토 1회를 시작하려면 남아 있어야 하는 시간 (측정한 최장 검토 + 여유) */
export const REVIEW_SLOT_MS = 170_000;
const DEFAULT_BUDGET_MS = 250_000;
const MAX_ERROR_REVIEWS = 2;
/** "쉬운 AI 설명"은 시간 예산을 넘겨도 라우트 한도(300초) 안이면 부른다 — 예산(250초) + 이만큼까지 끝나야 한다 */
const EASY_SLACK_MS = 45_000;

export interface Target {
  briefingId: string;
  editionType: EditionType;
  date: string;
  /** 주간·월간 잠금 키 (2026-W44 / 2026-10) */
  label?: string;
}

export interface StepLog {
  briefingId: string;
  version: number | string;
  round: number;
  reviewId: string | null;
  verdict: string | null;
  score: number | null;
  action: "reviewed" | "fixed" | "published" | "hold" | "pending" | "would_publish" | "switch_off" | "error" | "skipped";
  detail: string;
}

export interface EditionOutcome {
  target: Target;
  final: boolean;
  published: boolean;
  /** 이 호출에서 새로 나온 최종 결정이 있어 알림을 보낼 것인가 */
  notify: boolean;
  message: string;
  steps: StepLog[];
  decision: Decision | null;
  costUsd: number;
  /** 누락 재생성 요청 (runReviewPipeline 이 판 잠금을 푼 뒤 실행) */
  regenerate?: { mustInclude: string[]; reason: string };
}

export interface PipelineResult {
  dryRun: boolean;
  processed: EditionOutcome[];
  pending: number;
  notify: boolean;
  /** 텔레그램 본문 (n8n 이 그대로 보낸다) */
  message: string;
  costUsd: number;
}

export interface PipelineDeps {
  review: ReviewDeps;
  loadInput: (id: string) => Promise<ReviewInput>;
  findTargets: () => Promise<Target[]>;
  lock: <T>(t: Target, fn: () => Promise<T>) => Promise<T | null>;
  /** 이 버전을 만든 검토의 round (+1 이 이 버전의 round). 없으면 null */
  producedByRound: (briefingId: string) => Promise<number | null>;
  /** 이 버전의 정기(pipeline) 검토 기록, 최신순 */
  pipelineReviews: (briefingId: string) => Promise<{ id: string; status: string; final: boolean; result: ReviewResult | null; /** 기록된 결정 action (confirm_pending = 1차 통과, 확인 검토 대기) */ action?: string }[]>;
  publishable: (t: Target, version: number) => Promise<{ ok: boolean; detail: string }>;
  publish: (t: Target, row: BriefingRow) => Promise<{ published: { locale: string; id: string; version: number }[] }>;
  saveFixed: (input: ReviewInput, content: Record<string, unknown>, info: Record<string, unknown>, warn: ValidationIssue[]) => Promise<{ id: string; version: number }>;
  saveTranslations: (koId: string, input: ReviewInput, tr: RetranslateResult[]) => Promise<void>;
  retranslate: (
    koStored: Record<string, unknown>,
    input: ReviewInput,
    locales?: readonly ("en" | "zh")[],
    optsFor?: (l: "en" | "zh") => TranslateOptions
  ) => Promise<RetranslateResult[]>;
  /** 누락 재생성 (2026-11-03): 반드시 넣을 기사로 다시 생성 — 생성 잠금을 잡으므로 판 잠금 밖에서 부른다 */
  regenerate: (t: Target, mustInclude: string[], reason: string) => Promise<{ koId: string | null; outcome: string; message: string }>;
  recordDecision: (reviewId: string, decision: unknown, fixedBriefingId?: string | null) => Promise<void>;
  /** 발행된 최신 데일리 판의 "쉬운 AI 설명" 만들기 (easy-terms-run.ts ensureEasyTerms — 관리자 발행과 같은 함수). 알림 한 줄(없으면 "") */
  easyTerms?: () => Promise<string>;
  /** 주간·월간 ko 판 자동 발행 뒤 en·zh 판 만들기 (periodic/translate-run.ts — 관리자 발행과 같은 함수). 알림 한 줄 */
  periodicTranslations?: (t: Target) => Promise<string>;
  /** 스윕 끝 따라잡기: 최근 공개된 주간·월간 ko 판 중 en·zh 공개본이 없는 것 (일시 오류로 빠진 번역). 알림 한 줄 */
  periodicTranslationsCatchUp?: () => Promise<string>;
  now: () => number;
}

// ───────────────────────── 기본 의존성 (DB)

async function findTargetsDb(): Promise<Target[]> {
  const { rows } = await pool.query(
    `SELECT DISTINCT ON (b.edition_type, b.edition_date) b.id, b.edition_type, to_char(b.edition_date, 'YYYY-MM-DD') AS edition_date, b.status,
            COALESCE(b.content->'meta'->>'period_key', b.content->'meta'->>'iso_week', b.content->'meta'->>'month') AS label
       FROM daily_briefings b
      WHERE b.locale = 'ko' AND COALESCE(b.period_end, b.edition_date) >= $1::date AND b.created_at > now() - interval '48 hours'
      ORDER BY b.edition_type, b.edition_date, b.version DESC`,
    [REVIEW_SINCE]
  );
  const out: Target[] = [];
  for (const r of rows) {
    if (r.status !== "draft") continue;
    const { rows: pub } = await pool.query(
      `SELECT 1 FROM daily_briefings WHERE edition_type = $1 AND edition_date = $2::date AND status = 'published' LIMIT 1`,
      [r.edition_type, r.edition_date]
    );
    if (pub.length) continue;
    const { rows: fin } = await pool.query(
      `SELECT 1 FROM briefing_reviews WHERE briefing_id = $1::uuid AND trigger = 'pipeline' AND (decision->>'final')::boolean IS TRUE LIMIT 1`,
      [r.id]
    );
    if (fin.length) continue;
    out.push({ briefingId: r.id, editionType: r.edition_type, date: r.edition_date, label: r.label ?? undefined });
  }
  return out;
}

export async function saveFixedDb(input: ReviewInput, content: Record<string, unknown>, info: Record<string, unknown>, warn: ValidationIssue[]) {
  const row = input.row;
  const periodic = isPeriodic(row.edition_type);
  const ids = periodic ? [...new Set(citedSids(content as unknown as WeeklyContent))] : [...new Set(citedRefs(content as unknown as BriefingContent))];
  const meta = (content.meta ?? {}) as Record<string, unknown>;
  const stored = periodic ? content : { ...content, meta: { ...meta, cited_count: ids.length } };
  const prevValidation = (row.validation ?? {}) as Record<string, unknown>;
  const inserted = await insertBriefing({
    editionType: row.edition_type, date: row.edition_date, periodStart: row.period_start ?? row.edition_date, periodEnd: row.period_end ?? row.edition_date,
    metricsId: row.metrics_id, locale: "ko", status: "draft", mode: row.mode, content: stored, articleIds: ids,
    inputArticleIds: row.input_article_ids ?? [], candidateCount: row.candidate_count, inputHash: row.input_hash,
    validation: { prompt_version: prevValidation.prompt_version ?? row.prompt_version, ai_review_fix: info, final: { fatal: [], warn, droppedRefs: [], stats: (prevValidation.final as { stats?: unknown } | undefined)?.stats ?? {} } },
    model: row.model, promptVersion: row.prompt_version, costUsd: 0,
  });
  await pool.query(`UPDATE daily_briefings SET edited_by = 'ai-review' WHERE id = $1`, [inserted.id]);
  return inserted;
}

/** 재번역 결과 저장 (AI 검토 수정 후 재번역·CLI scripts/briefing-retranslate.ts 공용) */
export async function saveTranslationsDb(koId: string, input: ReviewInput, tr: RetranslateResult[], promptVersion = "ai-review-retranslate") {
  const row = input.row;
  for (const t of tr) {
    const shown = t.content ?? t.candidate;
    const ok = Boolean(t.content);
    const ids = shown ? [...new Set(citedRefs(shown as unknown as BriefingContent))] : [];
    const u = t.usages;
    await insertBriefing({
      date: row.edition_date, periodStart: row.period_start ?? row.edition_date, periodEnd: row.period_end ?? row.edition_date,
      locale: t.locale, status: ok ? "draft" : "failed", mode: row.mode, content: shown ?? {}, articleIds: ids,
      inputArticleIds: row.input_article_ids ?? [], candidateCount: row.candidate_count, inputHash: row.input_hash,
      validation: { prompt_version: promptVersion, repaired: t.repaired, problems: t.problems }, sourceBriefingId: koId,
      // 재시도 모델(Sonnet)로 다시 번역했으면 마지막 호출 모델
      model: u.at(-1)?.model ?? row.model, promptVersion,
      llmRequestIds: u.map((x) => x.requestId).filter((x): x is string => Boolean(x)),
      inputTokens: u.reduce((s, x) => s + x.inputTokens, 0), outputTokens: u.reduce((s, x) => s + x.outputTokens, 0),
      costUsd: Math.round(u.reduce((s, x) => s + x.costUsd, 0) * 1e6) / 1e6, error: ok ? null : t.error ?? `번역 재검증 실패 (${t.problems.length}건)`,
    });
  }
}

export const defaultPipelineDeps: PipelineDeps = {
  review: defaultReviewDeps,
  loadInput: (id) => loadReviewInput(id, { includeTranslations: true }),
  findTargets: findTargetsDb,
  lock: (t, fn) => withDateLock(t.date, fn, t.editionType, t.label),
  producedByRound: async (id) => (await reviewThatProduced(id))?.round ?? null,
  pipelineReviews: async (id) =>
    (await reviewsOf(id, 20))
      .filter((r) => r.trigger === "pipeline")
      .map((r) => ({
        id: r.id,
        status: r.status,
        final: Boolean(r.decision?.final),
        action: typeof r.decision?.action === "string" ? r.decision.action : undefined,
        result:
          r.status === "done"
            ? ({
                id: r.id, briefingId: r.briefing_id, version: r.version, editionType: r.edition_type, editionDate: r.edition_date, round: r.round,
                trigger: "pipeline", model: r.model, promptVersion: r.prompt_version, status: "done", verdict: r.verdict as ReviewResult["verdict"],
                llmVerdict: r.llm_verdict as ReviewResult["llmVerdict"], score: r.score === null ? null : Number(r.score),
                counts: r.counts as unknown as ReviewResult["counts"], breakdown: r.counts?.breakdown ?? [], claims: r.claims ?? [], fixes: r.fixes ?? [],
                omissions: r.omissions ?? [], translation: r.translation ?? [], structure: r.structure ?? [], summary: r.summary ?? "", schemaIssues: [],
                costUsd: 0, latencyMs: 0, inputTokens: 0, outputTokens: 0, requestIds: [],
              } satisfies ReviewResult)
            : null,
      })),
  publishable: async (t, version) => {
    const { rows } = await pool.query(
      `SELECT max(version) FILTER (WHERE locale = 'ko') AS latest, bool_or(status = 'published') AS published
         FROM daily_briefings WHERE edition_type = $1 AND edition_date = $2::date`,
      [t.editionType, t.date]
    );
    const latest = Number(rows[0]?.latest ?? 0);
    if (rows[0]?.published) return { ok: false, detail: "같은 판에 이미 발행본이 있음 (교체는 관리자가)" };
    if (latest > version) return { ok: false, detail: `더 새 ko 버전 v${latest} 이 있음` };
    return { ok: true, detail: `최신 ko v${version}, 발행본 없음` };
  },
  publish: (t, row) =>
    publishBriefing({ date: t.date, version: row.version, briefingId: row.id, editionType: t.editionType, editedBy: "ai-review", onlyIfLatest: true, noSupersede: true }),
  saveFixed: saveFixedDb,
  saveTranslations: saveTranslationsDb,
  retranslate: (ko, input, locales, optsFor) => retranslate(ko, input.candidateArticles, () => {}, undefined, locales, optsFor),
  regenerate: async (t, mustInclude, reason) => {
    // 동적 import: generate → review 순환 참조를 피한다
    const { generateBriefing } = await import("../generate");
    const r = await generateBriefing({ date: t.date, mustInclude, regenReason: reason });
    return { koId: r.locales.find((l) => l.locale === "ko")?.id ?? null, outcome: r.outcome, message: r.message ?? "" };
  },
  recordDecision: (id, decision, fixed) => updateReviewDecision(id, { decision, fixedBriefingId: fixed ?? null }),
  easyTerms: async () => easyRunNote(await ensureEasyTerms()),
  periodicTranslations: async (t) => {
    // 동적 import: translate-run → generate → review 순환 참조를 피한다
    const { ensurePeriodicTranslationsFor, periodicTranslateNote } = await import("../periodic/translate-run");
    return periodicTranslateNote(await ensurePeriodicTranslationsFor(t.editionType as "weekly" | "monthly", t.date));
  },
  periodicTranslationsCatchUp: async () => {
    const { catchUpPeriodicTranslations } = await import("../periodic/translate-run");
    return catchUpPeriodicTranslations();
  },
  now: () => Date.now(),
};

// ───────────────────────── 판 하나

/** 주간·월간 마지막 차례에 지우기만으로 발행할 때 지울 수 있는 문장 수 상한 (그보다 많으면 사람이 본다) */
export const FINAL_DELETE_MAX = 3;
/** 마지막 차례 지우기 발행을 쓰는 판 유형 */
export const FINAL_DELETE_TYPES: ReadonlySet<EditionType> = new Set<EditionType>(["weekly", "monthly"]);

const CLAIM_RULES = new Set(["verdict_pass", "no_wrong", "no_number-unit", "no_misattributed", "overclaim", "unsupported", "score"]);

function storedFatal(row: BriefingRow): number {
  const f = (row.validation as { final?: { fatal?: unknown[] } } | null)?.final?.fatal;
  return Array.isArray(f) ? f.length : 0;
}

// CLI 에서는 NEXT_PUBLIC_BASE_PATH 가 없어서 기본 /ainews (next.config basePath)
const adminUrl = (id: string) => `${SITE_ORIGIN}${process.env.NEXT_PUBLIC_BASE_PATH || "/ainews"}/ko/admin/briefings/${id}`;
const typeKo = (t: EditionType) => (t === "daily" ? "데일리" : t === "weekly" ? "주간" : "월간");

/** 수정본으로 다음 검토 입력을 만든다 (메모리, dry-run 과 저장 뒤 공통) */
export function inputWithContent(input: ReviewInput, content: Record<string, unknown>, translations: TranslationRow[], version: number, id?: string): ReviewInput {
  return {
    ...input,
    row: { ...input.row, id: id ?? input.row.id, version, content, validation: { ...(input.row.validation ?? {}), final: { fatal: [], warn: [] } } },
    segments: segmentContent(content, input.editionType),
    translations,
    meta: (content.meta ?? input.meta) as Record<string, unknown>,
  };
}

export interface FixAttempt {
  plan: FixPlan;
  edit: EditOutcome;
  content: Record<string, unknown> | null;
  newFatal: ValidationIssue[];
  warn: ValidationIssue[];
  reason: string | null;
}

/** 검토 결과 → 수정 계획 → 적용 → 결정적 재검증 (순수: DB·LLM 없음) */
export function attemptFix(input: ReviewInput, review: ReviewResult): FixAttempt {
  return applyFixPlan(input, planFixes(input.segments, review.claims, review.fixes, (seg, refIds) => corpusFor(input, seg, refIds)));
}

/**
 * 주간(FINAL_DELETE_TYPES) 마지막 수정 차례: 문제 문장을 지우기만 한다 (바꿈 수정안도 지우기로). 순수.
 * 지우기는 근거 없는 문장을 새로 만들 수 없으므로 다시 검토하지 않고 발행할 수 있다 — 결정적 재검증과 큰 흐름 최소 개수는 그대로 본다.
 * 2026-11-10 사용자 결정 "주간 리포트 매주 자동 발행": W45 는 확인 검토마다 다른 작은 지적(unsupported 1건)이 나와 수정 2회를 다 쓰고 초안에 머물렀다.
 */
export function attemptDeleteOnlyFix(input: ReviewInput, review: ReviewResult): FixAttempt {
  const base = planFixes(input.segments, review.claims, review.fixes, (seg, refIds) => corpusFor(input, seg, refIds));
  const planned = base.planned.map((p) => (p.action === "delete" ? p : { ...p, action: "delete" as const, text: "", basis: "final_delete_only" as const }));
  const fx = applyFixPlan(input, { ...base, planned, edits: planned.map((p) => ({ sid: p.sid, action: "delete" as const })) });
  if (fx.content) {
    const bp = (fx.content as { big_picture?: unknown[] }).big_picture;
    const n = Array.isArray(bp) ? bp.length : 0;
    if (n < PERIODIC_MIN_BIG_PICTURE) return { ...fx, content: null, reason: `지우면 큰 흐름 ${n}개 < ${PERIODIC_MIN_BIG_PICTURE}개` };
  }
  return fx;
}

function applyFixPlan(input: ReviewInput, plan: FixPlan): FixAttempt {
  const m = input.metrics;
  const edit = applySegmentEdits(input.row.content, input.editionType, input.segments, plan.edits, {
    headline: isPeriodic(input.editionType) ? (m ? () => fallbackHeadline(m) : undefined) : undefined,
    dek: isPeriodic(input.editionType) && m ? () => fallbackDek(m) : undefined,
  });
  if (edit.unfixable.length) return { plan, edit, content: null, newFatal: [], warn: [], reason: `고칠 수 없음: ${edit.unfixable.join("; ")}` };
  if (!plan.edits.length) return { plan, edit, content: null, newFatal: [], warn: [], reason: "적용할 수정이 없음" };
  // 주간 큰 흐름 핵심 숫자: 문장을 고쳐 값이 사라졌으면 숫자도 뺀다 (한눈에 보기에 근거 없는 숫자가 남지 않게)
  if (isPeriodic(input.editionType))
    for (const b of (edit.content.big_picture ?? []) as { text?: string; key?: { value: string; label: string } }[])
      if (b.key && keyNumberProblem(b.key, b.text ?? "")) delete b.key;
  if (edit.fallbacks.length) edit.content.meta = { ...((edit.content.meta ?? {}) as Record<string, unknown>), ...(isPeriodic(input.editionType) ? { fallbacks: [...new Set([...(((input.meta.fallbacks as string[]) ?? [])), ...edit.fallbacks])] } : {}) };
  // 결정적 재검증: 원본에 이미 있던 치명(지금 규칙으로 다시 돌린 것)은 빼고, 수정으로 새로 생긴 치명만 본다
  const baseline = input.revalidate(input.row.content);
  const re = input.revalidate(edit.content);
  const key = (f: ValidationIssue) => `${f.rule}|${f.detail}`;
  const before = new Set(baseline.fatal.map(key));
  const newFatal = re.fatal.filter((f) => !before.has(key(f)));
  if (newFatal.length) return { plan, edit, content: null, newFatal, warn: re.warn, reason: `수정본이 결정적 검사에 걸림: ${newFatal.map((f) => `${f.path} ${f.rule}`).join(", ")}` };
  return { plan, edit, content: re.content, newFatal, warn: re.warn, reason: null };
}

async function processEdition(
  target: Target,
  o: Required<Pick<PipelineOptions, "dryRun" | "trigger">> & { deadline: number; policy: ReviewPolicy; reopen?: boolean },
  deps: PipelineDeps
): Promise<EditionOutcome> {
  const steps: StepLog[] = [];
  let cost = 0;
  const out = (final: boolean, notify: boolean, message: string, decision: Decision | null, published = false, regenerate?: EditionOutcome["regenerate"]): EditionOutcome => ({
    target, final, published, notify, message, steps, decision, costUsd: Math.round(cost * 1e6) / 1e6, ...(regenerate ? { regenerate } : {}),
  });
  // 번역만 다시 한 버전인가 (판당 1회 — 2026-11-03)
  let trRetried = false;
  let input = await deps.loadInput(target.briefingId);
  // 대체 판(생성이 끝내 실패한 날)은 outcome 이 generated 라 생성 알림이 없다 → 검토 알림에 항상 표시
  const fb = input.genLog.fallback;
  const head = `[AiNews] ${typeKo(target.editionType)} ${target.label ?? target.date}${fb ? ` [대체 판 ${fb === "headlines" ? "제목만" : "짧은 판"}: ${input.genLog.fallbackReason ?? ""}]` : ""}`;

  // 제목만 판: LLM 문장이 없어(기사 제목·매체·링크 + 고정 안내 문장) AI 검토를 건너뛰고 결정적 조건만 본다
  if (input.row.mode === "headlines") {
    if (!o.dryRun && (await deps.pipelineReviews(input.row.id)).some((p) => p.final)) return out(true, false, `${head}: 이미 결정됨`, null);
    const decision = decideHeadlines(
      {
        content: input.row.content,
        deterministicFatal: storedFatal(input.row),
        publishable: o.dryRun ? { ok: true, detail: "dry-run" } : await deps.publishable(target, input.row.version),
      },
      o.policy
    );
    const r: ReviewResult = {
      id: null, briefingId: input.row.id, version: input.row.version, editionType: target.editionType, editionDate: input.row.edition_date, round: 0,
      trigger: o.trigger, model: "none", promptVersion: "headlines-no-review", status: "done", verdict: null, llmVerdict: null, score: null,
      counts: null, breakdown: [], claims: [], fixes: [], omissions: [], translation: [], structure: [], summary: "제목만 판 — LLM 문장이 없어 AI 검토 생략",
      schemaIssues: [], costUsd: 0, latencyMs: 0, inputTokens: 0, outputTokens: 0, requestIds: [],
    };
    const reviewId = await deps.review.store(r, {});
    let action: StepLog["action"] = decision.eligible ? (o.dryRun ? "would_publish" : decision.publish ? "published" : "switch_off") : "hold";
    let detail = decision.summary;
    let published = false;
    if (action === "published") {
      try {
        const res = await deps.publish(target, input.row);
        detail = `${decision.summary} (${res.published.map((p) => p.locale).join("·")})`;
        published = true;
      } catch (e) {
        action = "hold";
        detail = `발행 실패: ${e instanceof PublishError ? e.message : (e as Error).message}`;
      }
    }
    await deps.recordDecision(reviewId, { ...decision, final: true, action });
    steps.push({ briefingId: input.row.id, version: input.row.version, round: 0, reviewId, verdict: null, score: null, action, detail });
    return out(true, true, `${head} v${input.row.version}${o.dryRun ? " (dry-run)" : ""}: ${detail} ${adminUrl(input.row.id)}`, decision, published);
  }

  let round = o.dryRun ? 0 : ((await deps.producedByRound(target.briefingId)) ?? -1) + 1;
  let parentReviewId: string | null = null;
  let versionLabel: number | string = input.row.version;
  // 이 버전에서 먼저 통과한 독립 검토들 (자동 발행은 policy.requiredPasses 회 모두 통과해야 — 2026-11-03)
  let passed: ReviewResult[] = [];

  for (;;) {
    // 1) 검토 (정기 실행은 저장된 검토를 이어 쓴다 — 재개)
    let review: ReviewResult | null = null;
    if (!o.dryRun) {
      // reopen: 예전 기록을 무시 (이 호출 안의 상태는 메모리 passed·trRetried 로 이어 간다)
      const prior = o.reopen ? [] : await deps.pipelineReviews(input.row.id);
      if (prior.some((p) => p.final)) {
        steps.push({ briefingId: input.row.id, version: versionLabel, round, reviewId: prior[0].id, verdict: null, score: null, action: "skipped", detail: "이미 최종 결정됨" });
        return out(true, false, `${head}: 이미 결정됨`, null);
      }
      // 1차 통과(confirm_pending) 기록은 통과 목록으로, 그 뒤 확인 검토를 새로 한다 (재개 — 다음 호출이 이어 감)
      // 최종 결정이 없는 버전: 1차 통과 기록 + (있으면) 결정 전에 멈춘 검토를 이어 쓴다.
      // 번역만 다시 했으면(retranslated) 그 앞 검토는 옛 번역을 본 것이라 쓰지 않는다
      const cut = prior.findIndex((p) => p.action === "retranslated");
      if (cut >= 0) trRetried = true;
      const fresh = cut >= 0 ? prior.slice(0, cut) : prior;
      const fromDb = fresh.filter((p) => p.status === "done" && p.result && p.action === "confirm_pending").map((p) => p.result!).reverse();
      passed = [...fromDb, ...passed.filter((x) => !fromDb.some((d) => d.id && d.id === x.id))];
      const done = fresh.find((p) => p.status === "done" && p.result && p.action !== "confirm_pending");
      if (done?.result) review = done.result;
      else if (prior.filter((p) => p.status === "error").length >= MAX_ERROR_REVIEWS) {
        const msg = `${head} v${versionLabel}: AI 검토 ${MAX_ERROR_REVIEWS}회 실패 — 초안 유지, 관리자 확인 필요 ${adminUrl(input.row.id)}`;
        await deps.recordDecision(prior[0].id, { final: true, action: "hold", summary: "AI 검토 반복 실패" });
        steps.push({ briefingId: input.row.id, version: versionLabel, round, reviewId: prior[0].id, verdict: null, score: null, action: "hold", detail: "검토 반복 실패" });
        return out(true, true, msg, null);
      }
    }
    if (!review) {
      if (deps.now() + REVIEW_SLOT_MS > o.deadline) {
        steps.push({ briefingId: input.row.id, version: versionLabel, round, reviewId: null, verdict: null, score: null, action: "pending", detail: "시간 예산 부족 — 다음 호출에서 이어 감" });
        return out(false, false, `${head}: 검토 대기`, null);
      }
      const r = await reviewBriefing(input.row.id, { trigger: o.trigger, round, parentReviewId: passed.at(-1)?.id ?? parentReviewId, input, policy: o.policy, store: true }, deps.review);
      review = r.result;
      cost += review.costUsd;
      steps.push({ briefingId: input.row.id, version: versionLabel, round, reviewId: review.id, verdict: review.verdict, score: review.score, action: review.status === "done" ? "reviewed" : "error", detail: review.error ?? review.summary });
      if (review.status !== "done") {
        if (o.dryRun) return out(true, true, `${head} v${versionLabel}: AI 검토 오류 — ${review.error}`, null);
        return out(false, false, `${head}: 검토 오류, 다음 호출에서 다시 (${review.error})`, null);
      }
    }

    // 2) 결정
    const decision = decide(
      {
        review,
        editionType: target.editionType,
        deterministicFatal: storedFatal(input.row),
        translations: input.translations.map((t) => ({ locale: t.locale, status: t.status, problems: t.problems.length })),
        incompleteDays: input.incompleteDays,
        publishable: o.dryRun ? { ok: true, detail: "dry-run (발행 가능 여부 확인 생략)" } : await deps.publishable(target, input.row.version),
      },
      o.policy
    );
    const counts = review.counts!;
    const errSummary = `wrong ${counts.wrong}·number-unit ${counts["number-unit"]}·unsupported ${counts.unsupported}·misattributed ${counts.misattributed}·overclaim ${counts.overclaim}`;
    const rec = async (d: unknown, fixed?: string | null) => {
      if (review!.id) await deps.recordDecision(review!.id, d, fixed);
    };

    if (decision.eligible && passed.length + 1 < o.policy.requiredPasses) {
      // 1차 통과 → 같은 판을 독립적으로 한 번 더 검토 (같은 모델의 실행 간 흔들림을 거른다). 결정은 아직 최종이 아니다
      await rec({ ...decision, final: false, action: "confirm_pending", pass: passed.length + 1, required: o.policy.requiredPasses });
      steps.push({ briefingId: input.row.id, version: versionLabel, round, reviewId: review.id, verdict: review.verdict, score: review.score, action: "reviewed", detail: `검토 ${passed.length + 1}/${o.policy.requiredPasses} 통과 — 확인 검토` });
      passed = [...passed, review];
      continue;
    }
    const passScores = [...passed.map((p) => p.score), review.score].join("·");
    if (decision.eligible) {
      if (o.dryRun) {
        await rec({ ...decision, final: true, action: "would_publish" });
        steps.push({ briefingId: input.row.id, version: versionLabel, round, reviewId: review.id, verdict: review.verdict, score: review.score, action: "would_publish", detail: decision.summary });
        return out(true, true, `${head} v${versionLabel} (dry-run): 자동 발행 조건 통과(검토 ${passed.length + 1}회 ${passScores}점) — ${errSummary}`, decision);
      }
      if (!decision.publish) {
        await rec({ ...decision, final: true, action: "switch_off" });
        steps.push({ briefingId: input.row.id, version: versionLabel, round, reviewId: review.id, verdict: review.verdict, score: review.score, action: "switch_off", detail: decision.summary });
        return out(true, true, `${head} v${versionLabel}: AI 검토 ${passed.length + 1}회 통과(${passScores}점)했지만 자동 발행이 꺼져 있음 — 관리자 발행 필요 ${adminUrl(input.row.id)}`, decision);
      }
      try {
        const res = await deps.publish(target, input.row);
        await rec({ ...decision, final: true, action: "published", published: res.published });
        steps.push({ briefingId: input.row.id, version: versionLabel, round, reviewId: review.id, verdict: review.verdict, score: review.score, action: "published", detail: res.published.map((p) => `${p.locale} v${p.version}`).join(", ") });
        return out(true, true, `${head} v${versionLabel}: AI 검토 ${passed.length + 1}회 통과(${passScores}점) → 자동 발행 (${res.published.map((p) => p.locale).join("·")}) ${adminUrl(input.row.id)}`, decision, true);
      } catch (e) {
        const msg = e instanceof PublishError ? e.message : (e as Error).message;
        await rec({ ...decision, final: true, action: "hold", publish_error: msg });
        steps.push({ briefingId: input.row.id, version: versionLabel, round, reviewId: review.id, verdict: review.verdict, score: review.score, action: "hold", detail: `발행 실패: ${msg}` });
        return out(true, true, `${head} v${versionLabel}: AI 검토 통과했지만 발행 실패 — ${msg} ${adminUrl(input.row.id)}`, decision);
      }
    }

    // 3) 고칠 수 있나
    const failing = decision.checks.filter((c) => !c.ok);
    // 데일리 번역 조건은 수정하면 다시 번역하므로, 고칠 주장이 있으면 막지 않는다
    const flaggedAny = review.claims.some((c) => c.label !== "correct");
    const nonClaim = failing.filter((c) => !CLAIM_RULES.has(c.rule) && !(flaggedAny && target.editionType === "daily" && c.rule.startsWith("translation")));
    const hard = counts.wrong + counts["number-unit"];
    const flagged = review.claims.some((c) => c.label !== "correct");
    // 2026-11-03 사용자 결정: 번역만 문제인 판 → 재번역 후 재검토, 누락만 문제인 판 → 반드시 넣을 기사로 다시 생성 후 재검토 (판당 1회씩)
    const daily = target.editionType === "daily";
    const important = review.omissions.filter((x) => x.important && x.article_ids.length);
    const isTr = (rule: string) => rule.startsWith("translation");
    const omissionOnly = daily && !flagged && important.length > 0 && failing.length > 0 && failing.every((c) => c.rule === "verdict_pass" || c.rule === "score" || isTr(c.rule));
    const regenDone = Boolean((input.row.validation as { regen_reason?: unknown } | null)?.regen_reason);
    if (omissionOnly && !regenDone) {
      const must = [...new Set(important.flatMap((x) => x.article_ids))];
      const reason = `AI 검토 누락: ${important.map((x) => x.title).join(" / ").slice(0, 200)}`;
      const action = o.dryRun ? "would_regenerate" : "regenerate_omission";
      await rec({ ...decision, final: true, action, must_include: must, reason });
      steps.push({ briefingId: input.row.id, version: versionLabel, round, reviewId: review.id, verdict: review.verdict, score: review.score, action: "hold", detail: `누락 재생성 — ${reason}` });
      return out(true, true, `${head} v${versionLabel}: AI 검토 ${review.verdict} ${review.score}점, 문장 오류 없음 — 중요한 누락 ${important.length}건을 넣어 다시 생성${o.dryRun ? " (dry-run: 생성 안 함)" : ""}`, decision, false, o.dryRun ? undefined : { mustInclude: must, reason });
    }
    const trOnly = daily && !flagged && failing.length > 0 && failing.some((c) => isTr(c.rule)) && failing.every((c) => isTr(c.rule) || c.rule === "verdict_pass");
    if (trOnly && !trRetried) {
      const majors = review.translation.filter((t) => t.severity === "major");
      const locales = (["en", "zh"] as const).filter((l) => majors.some((t) => t.locale === l) || failing.some((c) => c.rule === `translation_${l}`));
      const tr = await deps.retranslate(input.row.content, input, locales, (l) => ({
        preferFallback: true,
        reviewNotes: review!.translation.filter((t) => t.locale === l).map((t) => `${t.path}: ${t.issue}`),
      }));
      cost += tr.reduce((sum, t) => sum + t.usages.reduce((a, u) => a + u.costUsd, 0), 0);
      trRetried = true;
      // 결정은 최종이 아니다 — 새 번역으로 처음부터 다시 requiredPasses 회 검토
      await rec({ ...decision, final: false, action: "retranslated", locales, ok: tr.map((t) => `${t.locale}:${t.content ? "draft" : "failed"}`) });
      steps.push({ briefingId: input.row.id, version: versionLabel, round, reviewId: review.id, verdict: review.verdict, score: review.score, action: "fixed", detail: `번역만 다시 (${tr.map((t) => `${t.locale} ${t.content ? "통과" : "실패"}`).join(", ")})` });
      passed = [];
      if (o.dryRun) {
        const kept = input.translations.filter((t) => !locales.includes(t.locale));
        const fresh = tr.map((t) => ({ id: "dry-run", locale: t.locale, version: 0, status: t.content ? "draft" : "failed", problems: t.problems, content: t.content ?? t.candidate ?? {} }));
        input = inputWithContent(input, input.row.content, [...kept, ...fresh], input.row.version);
      } else {
        await deps.saveTranslations(input.row.id, input, tr);
        input = await deps.loadInput(input.row.id);
      }
      continue;
    }

    let holdReason: string | null = null;
    if (nonClaim.length) holdReason = nonClaim.map((c) => c.detail).join(" / ");
    else if (hard >= 3 || (review.score ?? 0) <= 3) holdReason = `재생성 필요 (wrong+number-unit ${hard}건, ${review.score}점)`;
    else if (!flagged) holdReason = `고칠 문장이 없음 (${decision.summary})`;
    else if (round >= o.policy.maxFixRounds) holdReason = `수정 ${o.policy.maxFixRounds}회 뒤에도 미달 (${review.verdict} ${review.score}점, ${errSummary})`;

    if (!holdReason) {
      const fx = attemptFix(input, review);
      if (fx.reason || !fx.content) holdReason = fx.reason ?? "수정 실패";
      else {
        const info = {
          from: { id: input.row.id, version: input.row.version }, review_id: review.id, round: round + 1,
          planned: fx.plan.planned, ignored: fx.plan.ignored, dropped: fx.edit.dropped, fallbacks: fx.edit.fallbacks,
        };
        let translations: TranslationRow[] = [];
        let nextId = input.row.id;
        let nextVersion: number | string = input.row.version;
        if (!isPeriodic(target.editionType)) {
          const tr = await deps.retranslate(fx.content, input);
          cost += tr.reduce((s, t) => s + t.usages.reduce((a, u) => a + u.costUsd, 0), 0);
          if (o.dryRun) {
            translations = tr.map((t) => ({ id: "dry-run", locale: t.locale, version: 0, status: t.content ? "draft" : "failed", problems: t.problems, content: t.content ?? t.candidate ?? {} }));
          } else {
            const saved = await deps.saveFixed(input, fx.content, info, fx.warn);
            await deps.saveTranslations(saved.id, input, tr);
            nextId = saved.id;
            translations = tr.map((t) => ({ id: "", locale: t.locale, version: saved.version, status: t.content ? "draft" : "failed", problems: t.problems, content: t.content ?? t.candidate ?? {} }));
            await rec({ ...decision, final: true, action: "fixed", fix: info }, saved.id);
            nextVersion = saved.version;
          }
        } else if (!o.dryRun) {
          const saved = await deps.saveFixed(input, fx.content, info, fx.warn);
          nextId = saved.id;
          await rec({ ...decision, final: true, action: "fixed", fix: info }, saved.id);
          nextVersion = saved.version;
        }
        if (o.dryRun) {
          await rec({ ...decision, final: true, action: "fixed_in_memory", fix: info });
          nextVersion = `${input.row.version}+수정${round + 1}`;
        }
        steps.push({
          briefingId: input.row.id, version: versionLabel, round, reviewId: review.id, verdict: review.verdict, score: review.score, action: "fixed",
          detail: `${fx.plan.planned.length}문장 (바꿈 ${fx.plan.planned.filter((p) => p.action === "replace").length}, 지움 ${fx.plan.planned.filter((p) => p.action === "delete").length}${fx.edit.dropped.length ? `, 항목 삭제 ${fx.edit.dropped.join(",")}` : ""}${fx.edit.fallbacks.length ? `, 대체 ${fx.edit.fallbacks.join(",")}` : ""})`,
        });
        parentReviewId = review.id;
        round += 1;
        versionLabel = nextVersion;
        passed = []; // 새 버전은 처음부터 다시 requiredPasses 회 통과해야 한다
        input = o.dryRun
          ? inputWithContent(input, fx.content, translations, input.row.version)
          : await deps.loadInput(nextId);
        continue;
      }
    }

    // 3-1) 주간·월간 마지막 차례: 지우기만 해서 발행 (사용자 결정 2026-11-10 "주간 리포트 매주 자동 발행", "월간 다시 짜기" — 월간은 주간 합본 v7 부터).
    //   조건: 수정 횟수를 다 썼고, 문장 지적 말고는 막는 조건이 없고(결손일·결정적 치명·발행 가능), 점수 ≥ 기준, 지울 문장 ≤ FINAL_DELETE_MAX
    const lastRound = FINAL_DELETE_TYPES.has(target.editionType) && flagged && !nonClaim.length && round >= o.policy.maxFixRounds && hard < 3;
    if (lastRound && (review.score ?? 0) >= minScoreFor(o.policy, target.editionType) && o.policy.autoPublish) {
      const fx = attemptDeleteOnlyFix(input, review);
      if (fx.content && fx.plan.planned.length <= FINAL_DELETE_MAX) {
        const info = {
          from: { id: input.row.id, version: input.row.version }, review_id: review.id, round: round + 1, final_delete_only: true,
          planned: fx.plan.planned, ignored: fx.plan.ignored, dropped: fx.edit.dropped, fallbacks: fx.edit.fallbacks,
        };
        const what = `마지막 차례 지우기 ${fx.plan.planned.length}문장${fx.edit.dropped.length ? ` (항목 삭제 ${fx.edit.dropped.join(",")})` : ""}`;
        if (o.dryRun) {
          await rec({ ...decision, final: true, action: "would_publish", fix: info });
          steps.push({ briefingId: input.row.id, version: versionLabel, round, reviewId: review.id, verdict: review.verdict, score: review.score, action: "would_publish", detail: what });
          return out(true, true, `${head} v${versionLabel} (dry-run): ${what} 뒤 자동 발행 — ${errSummary}`, decision);
        }
        const saved = await deps.saveFixed(input, fx.content, info, fx.warn);
        const next = await deps.loadInput(saved.id);
        try {
          const res = await deps.publish(target, next.row);
          await rec({ ...decision, final: true, action: "published", fix: info, published: res.published }, saved.id);
          steps.push({ briefingId: input.row.id, version: versionLabel, round, reviewId: review.id, verdict: review.verdict, score: review.score, action: "published", detail: `${what} → v${saved.version} ${res.published.map((p) => p.locale).join("·")}` });
          return out(true, true, `${head} v${saved.version}: AI 검토 ${review.verdict} ${review.score}점, ${what} → 자동 발행 (${res.published.map((p) => p.locale).join("·")}) ${adminUrl(saved.id)}`, decision, true);
        } catch (e) {
          const msg = e instanceof PublishError ? e.message : (e as Error).message;
          await rec({ ...decision, final: true, action: "hold", fix: info, publish_error: msg }, saved.id);
          steps.push({ briefingId: input.row.id, version: versionLabel, round, reviewId: review.id, verdict: review.verdict, score: review.score, action: "hold", detail: `${what} 뒤 발행 실패: ${msg}` });
          return out(true, true, `${head} v${saved.version}: ${what} 뒤 발행 실패 — ${msg} ${adminUrl(saved.id)}`, decision);
        }
      }
      if (fx.reason) holdReason = `${holdReason} · 마지막 지우기 불가: ${fx.reason}`;
      else if (fx.plan.planned.length > FINAL_DELETE_MAX) holdReason = `${holdReason} · 지울 문장 ${fx.plan.planned.length}개 > ${FINAL_DELETE_MAX}`;
    }

    // 4) 초안 유지 + 알림
    await rec({ ...decision, final: true, action: "hold", hold_reason: holdReason });
    steps.push({ briefingId: input.row.id, version: versionLabel, round, reviewId: review.id, verdict: review.verdict, score: review.score, action: "hold", detail: holdReason ?? "" });
    return out(
      true,
      true,
      `${head} v${versionLabel}${o.dryRun ? " (dry-run)" : ""}: AI 검토 ${review.verdict} ${review.score}점 — 초안 유지. ${holdReason} · ${errSummary}${review.summary ? ` · ${review.summary}` : ""} ${adminUrl(input.row.id)}`,
      decision
    );
  }
}

// ───────────────────────── 진입점

export interface PipelineOptions {
  dryRun?: boolean;
  /** 이 판 한 버전만 (dry-run·수동 시험). 없으면 대상 자동 탐색 */
  briefingId?: string;
  editionType?: EditionType;
  date?: string;
  trigger?: ReviewTrigger;
  /** 이 호출의 시간 예산 (기본 250초) */
  budgetMs?: number;
  policy?: ReviewPolicy;
  /** briefingId 와 함께만: 예전 정기 검토·결정 기록을 무시하고 지금 규칙으로 다시 처리 (CLI --reopen, 2026-11-03) */
  reopen?: boolean;
}

export async function runReviewPipeline(opts: PipelineOptions = {}, deps: PipelineDeps = defaultPipelineDeps): Promise<PipelineResult> {
  const dryRun = Boolean(opts.dryRun);
  const trigger: ReviewTrigger = dryRun ? "dry_run" : opts.trigger ?? "pipeline";
  const policy = opts.policy ?? policyFromEnv();
  const deadline = deps.now() + (opts.budgetMs ?? DEFAULT_BUDGET_MS);
  let targets: Target[];
  if (opts.briefingId) {
    const input = await deps.loadInput(opts.briefingId);
    const meta = (input.meta ?? {}) as { period_key?: string; iso_week?: string; month?: string };
    targets = [{ briefingId: input.row.id, editionType: input.editionType, date: input.row.edition_date, label: meta.period_key ?? meta.iso_week ?? meta.month }];
  } else {
    targets = (await deps.findTargets()).filter((t) => (!opts.editionType || t.editionType === opts.editionType) && (!opts.date || t.date === opts.date));
  }
  const processed: EditionOutcome[] = [];
  let pending = 0;
  // "쉬운 AI 설명": 시간이 남을 때만 (실패해도 검토 결과에는 영향 없음)
  const easyTime = () => deps.now() + EASY_TIMEOUT_MS <= deadline + EASY_SLACK_MS;
  const easy = async (): Promise<string> => {
    if (dryRun || !deps.easyTerms || !easyTime()) return "";
    try {
      return await deps.easyTerms();
    } catch (e) {
      return `쉬운 AI 설명 실패: ${(e as Error).message}`;
    }
  };
  for (const t of targets) {
    if (deps.now() + REVIEW_SLOT_MS > deadline) {
      pending++;
      continue;
    }
    const r = await deps.lock(t, () => processEdition(t, { dryRun, trigger, deadline, policy, reopen: Boolean(opts.reopen && opts.briefingId) }, deps));
    if (!r) {
      pending++;
      continue;
    }
    if (!r.final) pending++;
    processed.push(r);
    if (r.published && t.editionType === "daily") {
      const note = await easy();
      if (note) r.message += ` · ${note}`;
    }
    // 주간·월간: ko 판이 공개되면 영어·중국어판 (2026-11-10 사용자 결정). 실패해도 발행은 그대로
    if (r.published && t.editionType !== "daily" && !dryRun && deps.periodicTranslations && easyTime()) {
      const note = await deps.periodicTranslations(t).catch((e: unknown) => `번역 실패: ${(e as Error).message}`);
      if (note) r.message += ` · ${note}`;
    }
    // 누락 재생성: 판 잠금을 푼 뒤 생성(생성도 같은 날짜 잠금) → 시간이 남으면 새 판을 바로 검토, 아니면 다음 스윕이 잇는다
    if (r.regenerate && !dryRun) {
      try {
        const g = await deps.regenerate(t, r.regenerate.mustInclude, r.regenerate.reason);
        r.message += ` → 다시 생성: ${g.outcome}${g.message ? ` (${g.message})` : ""}`;
        if (g.koId && g.outcome === "generated") {
          const nt: Target = { ...t, briefingId: g.koId };
          if (deps.now() + REVIEW_SLOT_MS > deadline) pending++;
          else {
            const r2 = await deps.lock(nt, () => processEdition(nt, { dryRun, trigger, deadline, policy }, deps));
            if (!r2 || !r2.final) pending++;
            if (r2) processed.push(r2);
          }
        }
      } catch (e) {
        r.message += ` → 다시 생성 실패: ${(e as Error).message}`;
      }
    }
  }
  // 따라잡기: 발행 직후 시간이 모자랐거나 관리자 발행 때 실패한 판 (이미 시도한 판은 LLM 없이 바로 끝난다)
  let catchUp = "";
  if (!opts.briefingId) catchUp = await easy();
  // 주간·월간 번역 따라잡기 (시간이 남을 때만, 실패해도 검토 결과에는 영향 없음)
  if (!opts.briefingId && !dryRun && deps.periodicTranslationsCatchUp && easyTime()) {
    const tr = await deps.periodicTranslationsCatchUp().catch((e: unknown) => `주간·월간 번역 따라잡기 실패: ${(e as Error).message}`);
    if (tr) catchUp = catchUp ? `${catchUp} · ${tr}` : tr;
  }
  const notes = processed.filter((p) => p.notify);
  const lines = [...notes.map((p) => p.message), ...(catchUp ? [`[AiNews] ${catchUp}`] : [])];
  return {
    dryRun,
    processed,
    pending,
    notify: lines.length > 0,
    message: lines.join("\n"),
    costUsd: Math.round(processed.reduce((s, p) => s + p.costUsd, 0) * 1e6) / 1e6,
  };
}

/**
 * 관리자 "다시 검토": 검토 + 자동 발행 판정만 기록한다 (발행·수정 없음 — 발행은 관리자가 버튼으로).
 */
export async function manualReview(briefingId: string, deps: PipelineDeps = defaultPipelineDeps): Promise<{ review: ReviewResult; decision: Decision | null }> {
  const policy = policyFromEnv();
  const input = await deps.loadInput(briefingId);
  const { result } = await reviewBriefing(briefingId, { trigger: "manual", input, policy }, deps.review);
  if (result.status !== "done") return { review: result, decision: null };
  const meta = (input.meta ?? {}) as { period_key?: string; iso_week?: string; month?: string };
  const t: Target = { briefingId, editionType: input.editionType, date: input.row.edition_date, label: meta.period_key ?? meta.iso_week ?? meta.month };
  const decision = decide(
    {
      review: result, editionType: input.editionType, deterministicFatal: storedFatal(input.row),
      translations: input.translations.map((x) => ({ locale: x.locale, status: x.status, problems: x.problems.length })),
      incompleteDays: input.incompleteDays, publishable: input.row.status === "draft" ? await deps.publishable(t, input.row.version) : { ok: false, detail: `상태 ${input.row.status}` },
    },
    policy
  );
  if (result.id) await deps.recordDecision(result.id, { ...decision, final: false, action: "manual_review" });
  return { review: result, decision };
}

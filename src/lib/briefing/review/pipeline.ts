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
import { citedSids } from "../periodic/validate";
import { fallbackDek, fallbackHeadline } from "../periodic/prompt";
import type { BriefingContent, ValidationIssue } from "../types";
import type { WeeklyContent } from "../periodic/types";
import { SITE_ORIGIN } from "@/lib/site";
import { loadReviewInput, type ReviewInput, type TranslationRow } from "./evidence";
import { planFixes, type FixPlan } from "./fix";
import { decide, policyFromEnv, type Decision, type ReviewPolicy } from "./policy";
import { corpusFor, defaultDeps as defaultReviewDeps, reviewBriefing, type ReviewDeps } from "./review";
import { retranslate, type RetranslateResult } from "./retranslate";
import { applySegmentEdits, isPeriodic, segmentContent, type EditOutcome } from "./segments";
import { reviewThatProduced, reviewsOf, updateReviewDecision } from "./store";
import type { ReviewResult, ReviewTrigger } from "./types";

export const REVIEW_SINCE = process.env.BRIEFING_REVIEW_SINCE || "2026-11-02";
/** 검토 1회를 시작하려면 남아 있어야 하는 시간 (측정한 최장 검토 + 여유) */
export const REVIEW_SLOT_MS = 170_000;
const DEFAULT_BUDGET_MS = 250_000;
const MAX_ERROR_REVIEWS = 2;

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
  pipelineReviews: (briefingId: string) => Promise<{ id: string; status: string; final: boolean; result: ReviewResult | null }[]>;
  publishable: (t: Target, version: number) => Promise<{ ok: boolean; detail: string }>;
  publish: (t: Target, row: BriefingRow) => Promise<{ published: { locale: string; id: string; version: number }[] }>;
  saveFixed: (input: ReviewInput, content: Record<string, unknown>, info: Record<string, unknown>, warn: ValidationIssue[]) => Promise<{ id: string; version: number }>;
  saveTranslations: (koId: string, input: ReviewInput, tr: RetranslateResult[]) => Promise<void>;
  retranslate: (koStored: Record<string, unknown>, input: ReviewInput) => Promise<RetranslateResult[]>;
  recordDecision: (reviewId: string, decision: unknown, fixedBriefingId?: string | null) => Promise<void>;
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

async function saveFixedDb(input: ReviewInput, content: Record<string, unknown>, info: Record<string, unknown>, warn: ValidationIssue[]) {
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

async function saveTranslationsDb(koId: string, input: ReviewInput, tr: RetranslateResult[]) {
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
      validation: { prompt_version: "ai-review-retranslate", repaired: t.repaired, problems: t.problems }, sourceBriefingId: koId,
      model: u[0]?.model ?? row.model, promptVersion: "ai-review-retranslate",
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
  retranslate: (ko, input) => retranslate(ko, input.candidateArticles),
  recordDecision: (id, decision, fixed) => updateReviewDecision(id, { decision, fixedBriefingId: fixed ?? null }),
  now: () => Date.now(),
};

// ───────────────────────── 판 하나

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
  const plan = planFixes(input.segments, review.claims, review.fixes, (seg, refIds) => corpusFor(input, seg, refIds));
  const m = input.metrics;
  const edit = applySegmentEdits(input.row.content, input.editionType, input.segments, plan.edits, {
    headline: isPeriodic(input.editionType) ? (m ? () => fallbackHeadline(m) : undefined) : undefined,
    dek: isPeriodic(input.editionType) && m ? () => fallbackDek(m) : undefined,
  });
  if (edit.unfixable.length) return { plan, edit, content: null, newFatal: [], warn: [], reason: `고칠 수 없음: ${edit.unfixable.join("; ")}` };
  if (!plan.edits.length) return { plan, edit, content: null, newFatal: [], warn: [], reason: "적용할 수정이 없음" };
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

async function processEdition(target: Target, o: Required<Pick<PipelineOptions, "dryRun" | "trigger">> & { deadline: number; policy: ReviewPolicy }, deps: PipelineDeps): Promise<EditionOutcome> {
  const steps: StepLog[] = [];
  let cost = 0;
  const out = (final: boolean, notify: boolean, message: string, decision: Decision | null, published = false): EditionOutcome => ({
    target, final, published, notify, message, steps, decision, costUsd: Math.round(cost * 1e6) / 1e6,
  });
  const head = `[AiNews] ${typeKo(target.editionType)} ${target.label ?? target.date}`;

  let input = await deps.loadInput(target.briefingId);
  let round = o.dryRun ? 0 : ((await deps.producedByRound(target.briefingId)) ?? -1) + 1;
  let parentReviewId: string | null = null;
  let versionLabel: number | string = input.row.version;

  for (;;) {
    // 1) 검토 (정기 실행은 저장된 검토를 이어 쓴다 — 재개)
    let review: ReviewResult | null = null;
    if (!o.dryRun) {
      const prior = await deps.pipelineReviews(input.row.id);
      if (prior.some((p) => p.final)) {
        steps.push({ briefingId: input.row.id, version: versionLabel, round, reviewId: prior[0].id, verdict: null, score: null, action: "skipped", detail: "이미 최종 결정됨" });
        return out(true, false, `${head}: 이미 결정됨`, null);
      }
      const done = prior.find((p) => p.status === "done" && p.result);
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
      const r = await reviewBriefing(input.row.id, { trigger: o.trigger, round, parentReviewId, input, policy: o.policy, store: true }, deps.review);
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

    if (decision.eligible) {
      if (o.dryRun) {
        await rec({ ...decision, final: true, action: "would_publish" });
        steps.push({ briefingId: input.row.id, version: versionLabel, round, reviewId: review.id, verdict: review.verdict, score: review.score, action: "would_publish", detail: decision.summary });
        return out(true, true, `${head} v${versionLabel} (dry-run): 자동 발행 조건 통과 — ${review.verdict} ${review.score}점, ${errSummary}`, decision);
      }
      if (!decision.publish) {
        await rec({ ...decision, final: true, action: "switch_off" });
        steps.push({ briefingId: input.row.id, version: versionLabel, round, reviewId: review.id, verdict: review.verdict, score: review.score, action: "switch_off", detail: decision.summary });
        return out(true, true, `${head} v${versionLabel}: AI 검토 통과(${review.score}점)했지만 자동 발행이 꺼져 있음 — 관리자 발행 필요 ${adminUrl(input.row.id)}`, decision);
      }
      try {
        const res = await deps.publish(target, input.row);
        await rec({ ...decision, final: true, action: "published", published: res.published });
        steps.push({ briefingId: input.row.id, version: versionLabel, round, reviewId: review.id, verdict: review.verdict, score: review.score, action: "published", detail: res.published.map((p) => `${p.locale} v${p.version}`).join(", ") });
        return out(true, true, `${head} v${versionLabel}: AI 검토 통과(${review.score}점) → 자동 발행 (${res.published.map((p) => p.locale).join("·")}) ${adminUrl(input.row.id)}`, decision, true);
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
        input = o.dryRun
          ? inputWithContent(input, fx.content, translations, input.row.version)
          : await deps.loadInput(nextId);
        continue;
      }
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
}

export async function runReviewPipeline(opts: PipelineOptions = {}, deps: PipelineDeps = defaultPipelineDeps): Promise<PipelineResult> {
  const dryRun = Boolean(opts.dryRun);
  const trigger: ReviewTrigger = dryRun ? "dry_run" : opts.trigger ?? "pipeline";
  const policy = opts.policy ?? policyFromEnv();
  const deadline = deps.now() + (opts.budgetMs ?? DEFAULT_BUDGET_MS);
  let targets: Target[];
  if (opts.briefingId) {
    const input = await deps.loadInput(opts.briefingId);
    const meta = input.meta as { period_key?: string; iso_week?: string; month?: string };
    targets = [{ briefingId: input.row.id, editionType: input.editionType, date: input.row.edition_date, label: meta.period_key ?? meta.iso_week ?? meta.month }];
  } else {
    targets = (await deps.findTargets()).filter((t) => (!opts.editionType || t.editionType === opts.editionType) && (!opts.date || t.date === opts.date));
  }
  const processed: EditionOutcome[] = [];
  let pending = 0;
  for (const t of targets) {
    if (deps.now() + REVIEW_SLOT_MS > deadline) {
      pending++;
      continue;
    }
    const r = await deps.lock(t, () => processEdition(t, { dryRun, trigger, deadline, policy }, deps));
    if (!r) {
      pending++;
      continue;
    }
    if (!r.final) pending++;
    processed.push(r);
  }
  const notes = processed.filter((p) => p.notify);
  return {
    dryRun,
    processed,
    pending,
    notify: notes.length > 0,
    message: notes.map((p) => p.message).join("\n"),
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
  const meta = input.meta as { period_key?: string; iso_week?: string; month?: string };
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

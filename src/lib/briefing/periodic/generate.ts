/**
 * 주간·월간 리포트 생성 — 데일리 generate.ts 와 같은 뼈대 (설계 검토서 §3.2, Gate 2).
 * 주간과 월간은 generatePeriodic(kind) 하나를 쓰고 기간 해석(period-key.ts)만 다르다.
 * CLI(scripts/briefing-generate.ts weekly|monthly)·내부 API(n8n 일정)·관리자 "다시 생성"이 이 함수를 부른다.
 *
 *  1. 기간 잠금 periodic:weekly:2026-W44 / periodic:monthly:2026-10
 *  2. 공용 지표 computePeriodMetrics(start, end, 비교 기간, population 'ai') — 결손일(축소·부분 수집) 포함.
 *     비교 기간(지난주·지난달)에 축소 수집일(COMPLETE_SINCE 이전)이 있으면 비교를 싣지 않는다 (보충 상한이 걸린 건수와 비교하면 틀린 증감이 된다).
 *     월간은 같은 요일 비교 대신 주별 평일 평균·1천 건당 언급(weeks)을 쓴다.
 *  3. 결손일이 있으면 force 없이는 생성하지 않는다 (blocked_data_quality). force 로 만든 판은
 *     content.meta.data_quality 에 결손일이 남고, 발행할 때 관리자 확인(acknowledgeDataQuality)이 필요하다.
 *  4. period_metrics 스냅숏 저장 (fingerprint 가 같으면 기존 행 재사용)
 *  5. 이야기 후보 S01.. → input_hash 가 이전 판과 같으면 건너뜀 (force 제외)
 *  6. ko 1회 생성 → 검증 → 치명·방향 충돌·제목 길이·한자가 있으면 수리 1회 → 남은 치명 항목 삭제,
 *     headline·dek 가 빠지면 결정적 문장으로 대체 → 큰 흐름 2개 미만이면 failed
 *  7. daily_briefings 에 edition_type='weekly'|'monthly', edition_date=period_start, status draft (발행은 관리자)
 * MVP 는 한국어판만 만든다 (번역은 v2).
 */
import { createHash } from "node:crypto";
import pool from "@/lib/db";
import { COMPLETE_SINCE, computePeriodMetrics, type PeriodMetrics, type PeriodStory } from "@/lib/metrics/period";
import { BRIEFING_MODEL, LlmError, chat, parseJsonContent } from "../llm";
import { articleText, toSourceDoc } from "../validate";
import type { SourceDoc } from "../rules";
import { BudgetExceeded, CostTracker, sumUsage } from "../generate";
import { finishGenerating, insertBriefing, latestBriefing, withDateLock } from "../repository";
import type { CandidateArticle, LlmUsage } from "../types";
import {
  PROMPT_VERSION,
  STORY_LIMIT,
  WEEKLY_HEADLINE_MAX,
  buildFacts,
  buildPeriodicSystemPrompt,
  buildPeriodicUserPrompt,
  buildStoryPool,
  buildWeeklyRepairPrompt,
  fallbackDek,
  fallbackHeadline,
} from "./prompt";
import { previousPeriod, resolvePeriod, resolveWeek, type ResolvedPeriod } from "./period-key";
import type { PeriodicKind, PeriodicMeta, PeriodicValidationReport, StoredPeriodicContent, StoryPoolItem, WeeklyContent } from "./types";
import {
  citedSids,
  dropFatalPeriodic,
  needsRepair,
  normalizeWeekly,
  repairProblems,
  validateWeekly,
  type PeriodicValidationContext,
} from "./validate";

export { resolveWeek };

const PERIODIC_MAX_COST = Number(process.env.PERIODIC_MAX_COST_USD || "0.05");
const MIN_BIG_PICTURE = 2;

export interface PeriodicGenerateOptions {
  /** 주간 "2026-W44" / 월간 "2026-10". 없으면 start, 둘 다 없으면 베이징 기준 지난주·지난달 */
  key?: string;
  /** 주간: 그 주 월요일, 월간: 그 달 1일 (YYYY-MM-DD) */
  start?: string;
  force?: boolean;
  /** LLM 을 부르지 않고 지표·프롬프트 크기만 */
  dryRun?: boolean;
}

export interface WeeklyGenerateOptions extends Omit<PeriodicGenerateOptions, "key"> {
  isoWeek?: string;
}

export interface MonthlyGenerateOptions extends Omit<PeriodicGenerateOptions, "key"> {
  month?: string;
}

export interface PeriodicGenerateResult {
  kind: PeriodicKind;
  /** 기간 키 (주간 2026-W44, 월간 2026-10) */
  key: string;
  /** 예전 이름 (= key) */
  week: string;
  start: string | null;
  end: string | null;
  outcome: "generated" | "failed" | "skipped_same_input" | "locked" | "dry_run" | "blocked_data_quality" | "invalid_week" | "invalid_period";
  id: string | null;
  version: number | null;
  status: string | null;
  metricsId: string | null;
  incompleteDays: string[];
  reducedDays: string[];
  partialDays: string[];
  /** 비교 기간 (없으면 비교 없음) */
  baseline: { start: string; end: string } | null;
  fatal: number;
  warn: number;
  repaired: boolean;
  dropped: string[];
  fallbacks: string[];
  inputHash: string | null;
  headline: string | null;
  costUsd: number;
  message?: string;
}
export type WeeklyGenerateResult = PeriodicGenerateResult;

/** 비교 기간: 직전 기간에 축소 수집일이 없을 때만 (있으면 비교 없음) */
export function comparablePrevious(p: ResolvedPeriod): { start: string; end: string } | null {
  const prev = previousPeriod(p);
  return prev.start >= COMPLETE_SINCE ? prev : null;
}

/** 스냅숏 저장 — fingerprint 가 같은 행이 있으면 그 id. 저장본은 스토리 본문을 빼 ~30KB */
async function upsertPeriodMetrics(m: PeriodMetrics): Promise<string> {
  const { rows } = await pool.query(
    `INSERT INTO period_metrics (period_type, period_start, period_end, baseline_start, baseline_end, population,
                                 metrics_version, fingerprint, metrics, data_quality)
     VALUES ($1, $2::date, $3::date, $4::date, $5::date, $6, $7, $8, $9::jsonb, $10::jsonb)
     ON CONFLICT (period_type, period_start, population, metrics_version, fingerprint)
     DO UPDATE SET period_end = EXCLUDED.period_end
     RETURNING id`,
    [
      m.kind, m.period.start, m.period.end, m.baseline?.start ?? null, m.baseline?.end ?? null, m.population,
      m.metrics_version, m.fingerprint, JSON.stringify(m), JSON.stringify(m.data_quality),
    ]
  );
  return rows[0].id as string;
}

/**
 * S id → 근거 텍스트 (묶음 기사 전체, 데일리와 같은 articleText) + 근거 기사(중국어 원문 포함, rules.ts 의미 규칙용).
 * summary_cn 은 숫자 근거(sourceText)에 넣지 않는다 — 통화·고유명사 대조에만 쓴다.
 */
async function loadSourceText(poolItems: StoryPoolItem[]): Promise<{ sourceText: Map<string, string>; docs: Map<string, SourceDoc[]> }> {
  const ids = [...new Set(poolItems.flatMap((p) => p.ids))];
  const { rows } = await pool.query(
    `SELECT id, source_name, COALESCE(title_cn, '') AS title_cn, COALESCE(title_kr, '') AS title_kr,
            COALESCE(summary_kr, '') AS summary_kr, COALESCE(ai_insights_kr, '') AS ai_insights_kr,
            COALESCE(summary_cn, '') AS summary_cn, to_char((news_date AT TIME ZONE 'UTC')::date, 'YYYY-MM-DD') AS news_date
       FROM ai_news_ex WHERE id = ANY($1::uuid[])`,
    [ids]
  );
  const arts = rows as CandidateArticle[];
  const byId = new Map(arts.map((a) => [a.id, a]));
  return {
    sourceText: new Map(poolItems.map((p) => [p.sid, p.ids.map((id) => (byId.has(id) ? articleText(byId.get(id)!) : "")).join(" ")])),
    docs: new Map(poolItems.map((p) => [p.sid, p.ids.flatMap((id) => (byId.has(id) ? [toSourceDoc(byId.get(id)!)] : []))])),
  };
}

export function validationContext(
  m: PeriodMetrics,
  sourceText: Map<string, string>,
  docs?: Map<string, SourceDoc[]>,
  poolItems: StoryPoolItem[] = []
): PeriodicValidationContext {
  const monthly = m.kind === "monthly";
  return {
    kind: monthly ? "monthly" : "weekly",
    sourceText,
    facts: buildFacts(m),
    entityNames: new Map(m.entities.map((e) => [e.key, e.name_ko])),
    terms: new Set(m.terms.top.map((t) => t.term)),
    headlineMax: WEEKLY_HEADLINE_MAX,
    weekKeys: monthly ? new Set((m.weeks ?? []).map((w) => w.key)) : undefined,
    docs,
    outlets: new Map(poolItems.map((p) => [p.sid, p.sources])),
    // 지표 순위 — "가장 많이 늘었다·가장 많이 다뤄졌다" 는 이 순서의 1위와 같아야 한다
    ranks: {
      entities: m.entities.map((e) => e.key),
      terms: m.terms.top.map((t) => t.term),
      rising: m.terms.rising.map((t) => t.term),
      falling: m.terms.falling.map((t) => t.term),
    },
    topEvents: (m.stories.events_top ?? []).slice(0, 2).map((e) => e.ids),
    poolIds: new Map(poolItems.map((p) => [p.sid, p.ids])),
  };
}

export function computePeriodicInputHash(kind: PeriodicKind, m: PeriodMetrics, poolItems: StoryPoolItem[]): string {
  return createHash("sha256")
    .update(JSON.stringify({ v: PROMPT_VERSION[kind], model: BRIEFING_MODEL, fp: m.fingerprint, pool: poolItems.map((p) => `${p.sid}:${p.ids.join(",")}`) }))
    .digest("hex");
}
export const computeWeeklyInputHash = (m: PeriodMetrics, poolItems: StoryPoolItem[]) => computePeriodicInputHash("weekly", m, poolItems);

/** S id → uuid (묶음 기사 전부) */
export function toStoredWeekly(
  c: WeeklyContent,
  poolItems: StoryPoolItem[],
  meta: PeriodicMeta
): { content: StoredPeriodicContent; articleIds: string[] } {
  const bySid = new Map(poolItems.map((p) => [p.sid, p.ids]));
  const many = (rs: string[]) => [...new Set(rs.flatMap((r) => bySid.get(r) ?? []))];
  const content: StoredPeriodicContent = {
    headline: c.headline,
    dek: c.dek,
    dek_refs: many(c.dek_refs),
    dek_metrics: c.dek_metrics,
    big_picture: c.big_picture.map((b) => ({ ...b, refs: many(b.refs) })),
    movers: c.movers.map((b) => ({ ...b, refs: many(b.refs) })),
    money: c.money ? { ...c.money, refs: many(c.money.refs) } : null,
    china_lens: c.china_lens ? { ...c.china_lens, refs: many(c.china_lens.refs) } : null,
    watch_next: c.watch_next.map((w) => ({ ...w, refs: many(w.refs) })),
    term: c.term,
    month_arc: (c.month_arc ?? []).map((b) => ({ ...b, refs: many(b.refs) })),
    meta,
  };
  return { content, articleIds: many([...new Set(citedSids(c))]) };
}

interface KoOutcome {
  status: "draft" | "failed";
  content: WeeklyContent | null;
  validation: Record<string, unknown>;
  report: PeriodicValidationReport | null;
  repaired: boolean;
  dropped: string[];
  fallbacks: string[];
  error?: string;
}

async function generateKo(
  kind: PeriodicKind,
  m: PeriodMetrics,
  poolItems: StoryPoolItem[],
  ctx: PeriodicValidationContext,
  cost: CostTracker
): Promise<KoOutcome> {
  const system = buildPeriodicSystemPrompt(kind, (m.weeks ?? []).map((w) => w.key));
  const user = buildPeriodicUserPrompt(m, ctx.facts, poolItems, ctx.docs);
  const validation: Record<string, unknown> = { prompt_version: PROMPT_VERSION[kind], prompt_chars: system.length + user.length };
  const track = (u: LlmUsage) => cost.add(u);

  cost.check();
  const first = await chat({ system, messages: [{ role: "user", content: user }], maxTokens: 6000 }, track);
  const p1 = normalizeWeekly(parseJsonContent(first.content));
  let content = p1.content;
  let report = validateWeekly(content, ctx, p1.issues);
  validation.initial = report;
  let repaired = false;

  if (needsRepair(report)) {
    try {
      cost.check();
      const second = await chat(
        {
          system,
          messages: [
            { role: "user", content: user },
            { role: "assistant", content: first.content },
            { role: "user", content: buildWeeklyRepairPrompt(content, repairProblems(report), [], kind) },
          ],
          maxTokens: 6000,
        },
        track
      );
      const p2 = normalizeWeekly(parseJsonContent(second.content));
      const r2 = validateWeekly(p2.content, ctx, p2.issues);
      validation.repair = r2;
      // 수리본이 더 나쁘면(치명 증가·큰 흐름 감소) 원본 유지
      if (r2.fatal.length <= report.fatal.length && r2.stats.bigPicture >= Math.min(report.stats.bigPicture, MIN_BIG_PICTURE)) {
        content = p2.content;
        report = r2;
        repaired = true;
        validation.used = "repair";
      } else validation.used = "initial";
    } catch (e) {
      if (e instanceof BudgetExceeded) throw e;
      validation.repair_error = (e as Error).message;
      validation.used = "initial";
    }
  }

  let dropped: string[] = [];
  const fallbacks: string[] = [];
  // 항목을 빼면 headline 의 근거(본문 전체 refs·지표)도 줄어 새 치명이 생길 수 있다 → 한 번 더 뺀다 (최대 2회)
  for (let pass = 0; pass < 2 && report.fatal.length; pass++) {
    const d = dropFatalPeriodic(content, report.fatal);
    content = d.content;
    dropped = [...new Set([...dropped, ...d.dropped])];
    if (d.needsFallback.includes("dek") && !fallbacks.includes("dek")) {
      const fb = fallbackDek(m);
      content.dek = fb.text;
      content.dek_refs = [];
      content.dek_metrics = fb.metrics;
      fallbacks.push("dek");
    }
    if (d.needsFallback.includes("headline") && !fallbacks.includes("headline")) {
      content.headline = fallbackHeadline(m);
      fallbacks.push("headline");
    }
    report = validateWeekly(content, ctx);
  }
  validation.dropped_items = dropped;
  validation.fallbacks = fallbacks;
  validation.final = report;
  if (report.fatal.length) return { status: "failed", content, validation, report, repaired, dropped, fallbacks, error: "재검증 후에도 치명 위반이 남음" };
  if (content.big_picture.length < MIN_BIG_PICTURE)
    return { status: "failed", content, validation, report, repaired, dropped, fallbacks, error: `큰 흐름 ${content.big_picture.length}개 < ${MIN_BIG_PICTURE}개` };
  return { status: "draft", content, validation, report, repaired, dropped, fallbacks };
}

/** 주간·월간 공용 생성 */
export async function generatePeriodic(kind: PeriodicKind, opts: PeriodicGenerateOptions = {}): Promise<PeriodicGenerateResult> {
  const base = {
    kind, id: null, version: null, status: null, metricsId: null, incompleteDays: [] as string[], reducedDays: [] as string[],
    partialDays: [] as string[], baseline: null, fatal: 0, warn: 0, repaired: false, dropped: [] as string[], fallbacks: [] as string[],
    inputHash: null, headline: null, costUsd: 0,
  };
  const p = resolvePeriod(kind, { key: opts.key, start: opts.start });
  if ("error" in p) {
    const key = opts.key ?? opts.start ?? "";
    return { ...base, key, week: key, start: null, end: null, outcome: kind === "weekly" ? "invalid_week" : "invalid_period", message: p.error };
  }
  const { key, start, end } = p;
  const head = { ...base, key, week: key, start, end };
  const promptVersion = PROMPT_VERSION[kind];

  const result = await withDateLock(
    start,
    async (): Promise<PeriodicGenerateResult> => {
      const prev = comparablePrevious(p);
      const { metrics: m, stories } = await computePeriodMetrics(pool, {
        kind, start, end, prevStart: prev?.start, prevEnd: prev?.end, population: "ai", likeForLike: kind === "weekly",
      });
      const dq = m.data_quality;
      const h = { ...head, incompleteDays: dq.incomplete_days, reducedDays: dq.reduced_days, partialDays: dq.partial_days, baseline: m.baseline };
      if (dq.incomplete_days.length && !opts.force && !opts.dryRun) {
        return {
          ...h,
          outcome: "blocked_data_quality",
          message: `수집 미완 날짜 ${dq.incomplete_days.join(", ")} — 보충이 끝난 뒤 생성하거나 --force 로 만든 뒤 발행 때 데이터 알림을 확인하십시오`,
        };
      }
      const poolItems = buildStoryPool(stories as PeriodStory[], m.money_table, STORY_LIMIT[kind]);
      const inputHash = computePeriodicInputHash(kind, m, poolItems);
      if (opts.dryRun) {
        const facts = buildFacts(m);
        const chars = buildPeriodicSystemPrompt(kind, (m.weeks ?? []).map((w) => w.key)).length + buildPeriodicUserPrompt(m, facts, poolItems).length;
        return { ...h, inputHash, outcome: "dry_run", message: `기사 ${m.volume.total}건, 후보 ${poolItems.length}개, 지표 ${Object.keys(facts).length}개, 프롬프트 ${chars}자` };
      }

      const last = await latestBriefing(start, "ko", kind);
      if (!opts.force && last && last.input_hash === inputHash && ["draft", "published"].includes(last.status)) {
        return { ...h, inputHash, outcome: "skipped_same_input", id: last.id, version: last.version, status: last.status, metricsId: last.metrics_id, message: `입력이 같아 건너뜀 (v${last.version} ${last.status})` };
      }

      const metricsId = await upsertPeriodMetrics(m);
      const { sourceText, docs } = await loadSourceText(poolItems);
      const ctx = validationContext(m, sourceText, docs, poolItems);
      const inputArticleIds = [...new Set(poolItems.flatMap((x) => x.ids))];
      const row = await insertBriefing({
        editionType: kind, date: start, periodStart: start, periodEnd: end, metricsId,
        locale: "ko", status: "generating", mode: "normal", content: {}, articleIds: [], inputArticleIds,
        candidateCount: m.volume.total, inputHash, model: BRIEFING_MODEL, promptVersion,
      });
      const cost = new CostTracker(PERIODIC_MAX_COST);
      let ko: KoOutcome;
      try {
        ko = await generateKo(kind, m, poolItems, ctx, cost);
      } catch (e) {
        const msg = e instanceof LlmError || e instanceof BudgetExceeded ? e.message : `예상치 못한 오류: ${(e as Error).message}`;
        const u = sumUsage(cost.usages);
        await finishGenerating(row.id, { status: "failed", content: {}, articleIds: [], validation: null, model: BRIEFING_MODEL, promptVersion, ...u, error: msg });
        return { ...h, inputHash, metricsId, outcome: "failed", id: row.id, version: row.version, status: "failed", costUsd: u.costUsd, message: msg };
      }
      const meta: PeriodicMeta = {
        edition_type: kind, period_key: key, ...(kind === "weekly" ? { iso_week: key } : { month: key }),
        period_start: start, period_end: end, locale: "ko",
        prompt_version: promptVersion, metrics_id: metricsId, metrics_version: m.metrics_version,
        candidate_count: m.volume.total, story_count: poolItems.length,
        data_quality: { incomplete_days: dq.incomplete_days, reduced_days: dq.reduced_days, partial_days: dq.partial_days },
        baseline: m.baseline, fallbacks: ko.fallbacks, ai_generated: true,
      };
      const stored = ko.content ? toStoredWeekly(ko.content, poolItems, meta) : null;
      const u = sumUsage(cost.usages);
      await finishGenerating(row.id, {
        status: ko.status, content: stored?.content ?? {}, articleIds: stored?.articleIds ?? [], validation: ko.validation,
        model: BRIEFING_MODEL, promptVersion, ...u, error: ko.error ?? null,
      });
      return {
        ...h, inputHash, metricsId, outcome: ko.status === "draft" ? "generated" : "failed", id: row.id, version: row.version,
        status: ko.status, fatal: ko.report?.fatal.length ?? 0, warn: ko.report?.warn.length ?? 0, repaired: ko.repaired,
        dropped: ko.dropped, fallbacks: ko.fallbacks, headline: ko.content?.headline ?? null, costUsd: u.costUsd, message: ko.error,
      };
    },
    kind,
    key
  );
  return result ?? { ...head, outcome: "locked", message: "같은 기간을 다른 실행이 생성 중" };
}

export function generateWeekly(opts: WeeklyGenerateOptions = {}): Promise<PeriodicGenerateResult> {
  return generatePeriodic("weekly", { key: opts.isoWeek, start: opts.start, force: opts.force, dryRun: opts.dryRun });
}

export function generateMonthly(opts: MonthlyGenerateOptions = {}): Promise<PeriodicGenerateResult> {
  return generatePeriodic("monthly", { key: opts.month, start: opts.start, force: opts.force, dryRun: opts.dryRun });
}

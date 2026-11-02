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
 *  6. ko 1회 생성 → 결정적 정리(한자 사전 치환, month_arc 의 주 밖 refs 떼기) → 검증
 *     → 방향 충돌 문장은 결정적으로 지운 뒤(사실을 고쳐 쓰지 않음) 수리(최대 2회). 수리본이 증감 방향을 뒤집으면(지표 값 인용 없이) 그 칸은 되돌린다
 *     → 남은 치명 항목 삭제, headline·dek 가 빠지면 결정적 문장으로 대체 → 큰 흐름 2개 미만이면 failed
 *     감사 기록: validation.edits[] (회차·위치·사유·고치기 전/후 원문 — 데일리와 같은 모양)
 *  7. daily_briefings 에 edition_type='weekly'|'monthly', edition_date=period_start, status draft (발행은 관리자)
 * MVP 는 한국어판만 만든다 (번역은 v2).
 */
import { createHash } from "node:crypto";
import pool from "@/lib/db";
import { COMPLETE_SINCE, computePeriodMetrics, type PeriodMetrics, type PeriodStory } from "@/lib/metrics/period";
import { BRIEFING_MODEL, LlmError, chat, parseJsonContent } from "../llm";
import { articleText, fitText, glossHanText, toSourceDoc } from "../validate";
import { SOURCE_ARTICLE_COLUMNS } from "../columns";
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
  TERM_KO,
  citedSids,
  directionFlips,
  dropConflictSentences,
  dropFatalPeriodic,
  itemOfPeriodic,
  needsRepair,
  normalizeWeekly,
  periodicText,
  pruneArcRefs,
  repairProblems,
  revertFlips,
  validateWeekly,
  type PeriodicEdit,
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
 * 열 목록은 데일리와 같은 columns.ts (subject_region 포함 — 중국 중심 규칙·STORIES 의 지역 표시).
 */
async function loadSourceText(
  poolItems: StoryPoolItem[]
): Promise<{ sourceText: Map<string, string>; docs: Map<string, SourceDoc[]>; idDay: Map<string, string> }> {
  const ids = [...new Set(poolItems.flatMap((p) => p.ids))];
  const { rows } = await pool.query(
    `SELECT ${SOURCE_ARTICLE_COLUMNS} FROM ai_news_ex WHERE id = ANY($1::uuid[])`,
    [ids]
  );
  const arts = rows as CandidateArticle[];
  const byId = new Map(arts.map((a) => [a.id, a]));
  return {
    sourceText: new Map(poolItems.map((p) => [p.sid, p.ids.map((id) => (byId.has(id) ? articleText(byId.get(id)!) : "")).join(" ")])),
    docs: new Map(poolItems.map((p) => [p.sid, p.ids.flatMap((id) => (byId.has(id) ? [toSourceDoc(byId.get(id)!)] : []))])),
    // 기사 id → 베이징 날짜 (월간 month_arc 근거를 그 주 기사로만 저장)
    idDay: new Map(arts.filter((a) => a.news_date).map((a) => [a.id, a.news_date!])),
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
    // 월간: month_arc 의 refs 는 그 주에 날짜가 있는 사건만 (arc_week_mismatch)
    weekRanges: monthly ? new Map((m.weeks ?? []).map((w) => [w.key, { start: w.start, end: w.end }])) : undefined,
    sidDays: new Map(poolItems.map((p) => [p.sid, p.days])),
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
  meta: PeriodicMeta,
  /** 월간: 기사 id → 날짜, 주 키 → 기간. month_arc 근거는 그 주 기사만 저장한다 (사건이 여러 주에 걸쳐도) */
  arcScope?: { idDay: Map<string, string>; weekRanges: Map<string, { start: string; end: string }> }
): { content: StoredPeriodicContent; articleIds: string[] } {
  const bySid = new Map(poolItems.map((p) => [p.sid, p.ids]));
  const many = (rs: string[]) => [...new Set(rs.flatMap((r) => bySid.get(r) ?? []))];
  const inWeek = (ids: string[], week: string) => {
    const w = arcScope?.weekRanges.get(week);
    if (!w) return ids;
    const kept = ids.filter((id) => {
      const d = arcScope!.idDay.get(id);
      return d === undefined || (d >= w.start && d <= w.end);
    });
    return kept.length ? kept : ids;
  };
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
    month_arc: (c.month_arc ?? []).map((b) => ({ ...b, refs: inWeek(many(b.refs), b.week) })),
    meta,
  };
  return { content, articleIds: many([...new Set(citedSids(c))]) };
}

/** 남은 치명 항목 삭제 + headline·dek 결정적 대체 → 재검증 (최대 2회). 수리 단계의 "살릴 수 있나" 판정에도 쓴다 */
export function dropPeriodic(
  content: WeeklyContent,
  report: PeriodicValidationReport,
  ctx: PeriodicValidationContext,
  m: PeriodMetrics
): { content: WeeklyContent; report: PeriodicValidationReport; dropped: string[]; fallbacks: string[]; edits: PeriodicEdit[] } {
  let c = structuredClone(content);
  let r = report;
  let dropped: string[] = [];
  const fallbacks: string[] = [];
  const edits: PeriodicEdit[] = [];
  // 항목을 빼면 headline 의 근거(본문 전체 refs·지표)도 줄어 새 치명이 생길 수 있다 → 한 번 더 뺀다 (최대 2회)
  for (let pass = 0; pass < 2 && r.fatal.length; pass++) {
    // 감사 기록: 지우기 전 원문과 사유 (데일리 dropFatalItems 와 같은 모양)
    const round = pass ? "final(재검증)" : "final";
    for (const item of new Set(r.fatal.map((f) => itemOfPeriodic(f.path)))) {
      const reason = r.fatal.filter((f) => itemOfPeriodic(f.path) === item).map((f) => `${f.rule}: ${f.detail}`).join(" / ");
      const action = item === "headline" || item === "dek" ? ("fallback" as const) : ("drop" as const);
      edits.push({ action, path: item, reason, before: periodicItemValue(c, item), after: null, round });
    }
    const d = dropFatalPeriodic(c, r.fatal);
    c = d.content;
    dropped = [...new Set([...dropped, ...d.dropped])];
    if (d.needsFallback.includes("dek") && !fallbacks.includes("dek")) {
      const fb = fallbackDek(m);
      c.dek = fb.text;
      c.dek_refs = [];
      c.dek_metrics = fb.metrics;
      fallbacks.push("dek");
    }
    if (d.needsFallback.includes("headline") && !fallbacks.includes("headline")) {
      c.headline = fallbackHeadline(m);
      fallbacks.push("headline");
    }
    r = validateWeekly(c, ctx);
  }
  return { content: c, report: r, dropped, fallbacks, edits };
}

/** 항목 위치의 값 (감사 기록용 복사본) */
function periodicItemValue(c: WeeklyContent, item: string): unknown {
  const m = item.match(/^(big_picture|movers|watch_next|month_arc)\[(\d+)\]$/);
  if (m) return structuredClone((c[m[1] as "big_picture" | "movers" | "watch_next" | "month_arc"] ?? [])[Number(m[2])] ?? null);
  if (item === "money") return structuredClone(c.money);
  if (item === "china_lens") return structuredClone(c.china_lens);
  if (item === "term") return structuredClone(c.term);
  if (item === "headline") return c.headline;
  return periodicText(c, item) ?? null;
}

/** 한국어 문장의 지표 용어 한자를 한국어 표기로 (term.term 은 그대로). 괄호 병기 한자는 지운다 */
const HAN_GLOSS: [string, string][] = [
  ...Object.entries(TERM_KO).map(([zh, ko]) => [zh, ko[0]] as [string, string]),
  ["资本开支", "자본지출"],
  ["大模型", "대형 모델"],
];
export function glossPeriodicHan(c: WeeklyContent): WeeklyContent {
  const out = structuredClone(c);
  const f = (t: string) => {
    let x = t.replace(/\s?[(（]\s*[\u3400-\u9fff·、，,\s]+\s*[)）]/g, "");
    for (const [zh, ko] of HAN_GLOSS) x = x.split(zh).join(ko);
    // 기업·기관 이름은 데일리와 같은 한자 사전(han-glossary)으로, 한글이 섞인 괄호 안 한자는 지운다 (Gate 2 — validate.ts glossHanText)
    return glossHanText(x);
  };
  out.headline = f(out.headline);
  out.dek = f(out.dek);
  out.big_picture = out.big_picture.map((b) => ({ ...b, title: f(b.title), text: f(b.text) }));
  out.movers = out.movers.map((b) => ({ ...b, text: f(b.text) }));
  if (out.money) out.money = { ...out.money, text: f(out.money.text) };
  if (out.china_lens) out.china_lens = { ...out.china_lens, text: f(out.china_lens.text) };
  out.watch_next = out.watch_next.map((w) => ({ ...w, text: f(w.text) }));
  if (out.term) out.term = { ...out.term, why: f(out.term.why) };
  out.month_arc = (out.month_arc ?? []).map((b) => ({ ...b, text: f(b.text) }));
  return out;
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

  const edits: PeriodicEdit[] = [];
  // 결정적 정리: 지표 용어 한자를 한국어 표기로 (智能体 → 에이전트), 괄호 병기 한자 삭제, month_arc 의 주 밖 refs 떼기
  const prepare = (c: WeeklyContent, round: string) => {
    const g = glossPeriodicHan(c);
    if (JSON.stringify(g) !== JSON.stringify(c)) edits.push({ action: "gloss", path: "*", reason: "han_in_ko (용어·이름 사전 치환)", before: null, after: null, round });
    const a = pruneArcRefs(g, ctx);
    edits.push(...a.edits.map((e) => ({ ...e, round })));
    return fitPeriodic(a.content, round);
  };
  // 길이 초과는 삭제 전에 끝 문장을 뺀다 (데일리와 같은 fitText — W44 round 2: term.why 85/80자로 term 칸 삭제)
  const fitPeriodic = (c: WeeklyContent, round: string): WeeklyContent => {
    const out = structuredClone(c);
    const fit = (path: string, text: string, max: number) => {
      const t = fitText(text, max);
      if (t !== text) edits.push({ action: "trim", path, reason: `length ${text.length}/${max}자`, before: text, after: t, round });
      return t;
    };
    out.dek = fit("dek", out.dek, 220);
    out.big_picture.forEach((b, i) => (b.text = fit(`big_picture[${i}]`, b.text, 264 - b.title.length - 1)));
    out.movers.forEach((b, i) => (b.text = fit(`movers[${i}]`, b.text, 90)));
    if (out.money) out.money.text = fit("money", out.money.text, 200);
    if (out.china_lens) out.china_lens.text = fit("china_lens", out.china_lens.text, 200);
    if (out.term) out.term.why = fit("term", out.term.why, 80);
    (out.month_arc ?? []).forEach((b, i) => (b.text = fit(`month_arc[${i}]`, b.text, 90)));
    return out;
  };
  cost.check();
  const first = await chat({ system, messages: [{ role: "user", content: user }], maxTokens: 6000 }, track);
  const p1 = normalizeWeekly(parseJsonContent(first.content));
  let content = prepare(p1.content, "initial");
  const initialContent = content;
  let report = validateWeekly(content, ctx, p1.issues);
  validation.initial = report;
  // 방향 충돌은 수리에 맡기기 전에 충돌 문장만 지운다 (W44: 수리가 '호출량 급증'을 '크게 줄었다'로 뒤집었다)
  const dc = dropConflictSentences(content, report.fatal, ctx.facts);
  if (dc.edits.length) {
    edits.push(...dc.edits.map((e) => ({ ...e, round: "initial" })));
    content = dc.content;
    report = validateWeekly(content, ctx, p1.issues);
  }
  let repaired = false;

  // 수리 최대 2회 — 2차는 지금 판을 삭제·대체해도 살릴 수 없을 때만 (삭제 뒤 중국 중심 미달 등). 데일리와 같은 규칙
  const messages: { role: "user" | "assistant"; content: string }[] = [
    { role: "user", content: user },
    { role: "assistant", content: first.content },
  ];
  validation.used = "initial";
  for (let round = 1; round <= 2 && needsRepair(report); round++) {
    if (round > 1) {
      const sim = dropPeriodic(content, report, ctx, m);
      if (!sim.report.fatal.length && sim.content.big_picture.length >= MIN_BIG_PICTURE) break;
    }
    try {
      cost.check();
      messages.push({ role: "user", content: buildWeeklyRepairPrompt(content, repairProblems(report), [], kind) });
      const reply = await chat({ system, messages, maxTokens: 6000 }, track);
      messages.push({ role: "assistant", content: reply.content });
      const p2 = normalizeWeekly(parseJsonContent(reply.content));
      const label = round === 1 ? "repair" : `repair${round}`;
      let c2 = prepare(p2.content, label);
      // 사실 뒤집기 금지: 수리본이 지표 값을 인용하지 않고 증감 방향을 바꾼 칸은 수리 전 문장(충돌 문장은 지운 것)으로 되돌린다
      // 충돌 문장을 지우기 전 원문(initialContent)과도 비교한다 — 지운 문장을 수리가 뒤집어 다시 넣는 경우
      const flipped = [...new Set([...directionFlips(content, c2, ctx.facts), ...directionFlips(initialContent, c2, ctx.facts)])];
      if (flipped.length) {
        const rv = revertFlips(content, c2, flipped, report.fatal, ctx.facts);
        edits.push(...rv.edits.map((e) => ({ ...e, round: label })));
        c2 = rv.content;
      }
      const r2 = validateWeekly(c2, ctx, p2.issues);
      validation[round === 1 ? "repair" : `repair${round}`] = r2;
      // 수리본이 더 나쁘면(치명 증가·큰 흐름 감소) 이전 판 유지
      if (r2.fatal.length <= report.fatal.length && r2.stats.bigPicture >= Math.min(report.stats.bigPicture, MIN_BIG_PICTURE)) {
        content = c2;
        report = r2;
        repaired = true;
        validation.used = round === 1 ? "repair" : `repair${round}`;
      }
    } catch (e) {
      if (e instanceof BudgetExceeded) throw e;
      validation.repair_error = (e as Error).message;
      break;
    }
  }

  const d = dropPeriodic(content, report, ctx, m);
  content = d.content;
  report = d.report;
  const dropped = d.dropped;
  const fallbacks = d.fallbacks;
  edits.push(...d.edits);
  validation.edits = edits;
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
      const { sourceText, docs, idDay } = await loadSourceText(poolItems);
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
      const stored = ko.content ? toStoredWeekly(ko.content, poolItems, meta, ctx.weekRanges ? { idDay, weekRanges: ctx.weekRanges } : undefined) : null;
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

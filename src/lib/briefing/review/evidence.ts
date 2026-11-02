/**
 * AI 검토 입력 — 판 한 버전(ko)과 그 근거를 DB 에서 모은다.
 *
 *  - 본문 → 문장(S01..) (segments.ts)
 *  - 인용 기사 (a01..): 제목·요약·인사이트·본문 앞부분(content_kr)·중국어 원제·중국어 요약·날짜·주체 지역
 *    (중국어 원문은 숫자·통화 대조용). 판 크기에 맞춰 본문 길이를 나눈다 (검토 비용 상한).
 *  - 주간·월간: 저장된 period_metrics 스냅숏의 FACTS (생성 때와 같은 buildFacts)
 *  - 누락 후보 (C1..): 결정적으로 계산 — 데일리 = 그 기간 후보 묶음 중 인용하지 않은 것(사건 매체 수 순),
 *    주간·월간 = 스냅숏 events_top 중 인용하지 않은 것
 *  - 데일리: 이 ko 버전에서 번역된 en/zh (번역 일관성 검사)
 *  - 재검증 함수: 데일리 validateKo(관리자 인라인 수정과 같은 문맥), 주간·월간 validateWeekly(저장 스냅숏 + uuid 단위 근거)
 */
import pool from "@/lib/db";
import { PUBLIC_NEWS_WHERE } from "@/lib/news-query";
import type { PeriodMetrics } from "@/lib/metrics/period";
import { getBriefingRow } from "../admin";
import { loadCandidateArticles, type BriefingRow, type EditionType } from "../repository";
import { bigrams, jaccard, selectCandidates } from "../select";
import type { BriefingContent, CandidateArticle, ValidationIssue } from "../types";
import { articleText, contextFromArticles, toSourceDoc, validateKo } from "../validate";
import { buildFacts } from "../periodic/prompt";
import { validateWeekly } from "../periodic/validate";
import { validationContext } from "../periodic/generate";
import type { StoryPoolItem, WeeklyContent } from "../periodic/types";
import { isPeriodic, segmentContent } from "./segments";
import type { OmissionCandidate } from "./schema";
import type { Segment } from "./types";

export interface ReviewArticle {
  id: string;
  label: string;
  source_name: string;
  news_date: string;
  subject_region: string | null;
  title_kr: string;
  title_cn: string;
  summary_kr: string;
  ai_insights_kr: string;
  content_kr: string;
  summary_cn: string;
  /** 같은 글(전재)이면 전체 필드를 준 기사 라벨 */
  dup_of?: string;
}

/** 같은 글 판정 (전재 묶기 REPOST_JACCARD 0.6 보다 조금 느슨하게 — 같은 사건 제목 변형까지) */
const DUP_JACCARD = 0.5;

export interface TranslationRow {
  id: string;
  locale: "en" | "zh";
  version: number;
  status: string;
  problems: string[];
  content: Record<string, unknown>;
}

export interface Revalidation {
  content: Record<string, unknown>;
  fatal: ValidationIssue[];
  warn: ValidationIssue[];
}

export interface ReviewInput {
  row: BriefingRow;
  editionType: EditionType;
  periodStart: string;
  periodEnd: string;
  segments: Segment[];
  articles: ReviewArticle[];
  /** a01 → uuid */
  refLabels: Map<string, string>;
  /** uuid → a01 */
  labelOf: Map<string, string>;
  facts: Record<string, string> | null;
  metrics: PeriodMetrics | null;
  candidates: OmissionCandidate[];
  translations: TranslationRow[];
  incompleteDays: string[];
  /** 본문 meta (발행 표시용 data_quality 등) */
  meta: Record<string, unknown>;
  /** 인용 기사 본문 전체 (수정 근거 대조용, 프롬프트 길이 제한 없음) */
  fullText: Map<string, string>;
  /** 결정적 검사기 재실행 (수정본 검사) */
  revalidate: (content: Record<string, unknown>) => Revalidation;
  /** 재번역용: uuid → 후보 기사 (key_terms 포함) */
  candidateArticles: Map<string, CandidateArticle>;
}

/** 프롬프트 근거 글자 예산 (기사 본문 앞부분을 이 안에서 나눈다) */
/**
 * 보정 실측(10-27 v7): 프롬프트 38k자 ≈ 입력 32.6k 토큰($0.10) + 출력 2.9k 토큰($0.04). 판당 비용을 $0.12 안팎에 두려고
 * (보정 24판 상한 $3) 데일리 15k자, 주간·월간 16k자 안에서 필드 길이를 정한다 (주간·월간은 인용 기사가 50~115건이라 필드를 더 짧게).
 * 생성 모델도 제목·요약·인사이트만 봤으므로 본문(content_kr)은 앞부분만 준다 — 본문에만 있는 사실은 수정 근거 대조(fullText)에서 다시 찾는다.
 */
export const EVIDENCE_BUDGET = { daily: 15_000, periodic: 16_000 };
const CONTENT_MAX = { daily: 1200, periodic: 400 };
const FIELD_MAX = { daily: { summary: 500, insight: 220, summary_cn: 200 }, periodic: { summary: 220, insight: 120, summary_cn: 140 } };
const OMISSION_CANDIDATES = 6;

const COLS = `id, source_name, source_url, category,
  COALESCE(title_cn, '') AS title_cn, COALESCE(title_kr, '') AS title_kr,
  COALESCE(summary_kr, '') AS summary_kr, COALESCE(ai_insights_kr, '') AS ai_insights_kr,
  COALESCE(key_terms, '[]'::jsonb) AS key_terms, COALESCE(content_kr, '') AS content_kr,
  COALESCE(summary_cn, '') AS summary_cn, to_char((news_date AT TIME ZONE 'UTC')::date, 'YYYY-MM-DD') AS news_date,
  subject_region, (${PUBLIC_NEWS_WHERE}) AS visible`;

type DbArticle = CandidateArticle & { content_kr: string; summary_cn: string; visible: boolean };

async function loadArticles(ids: string[]): Promise<DbArticle[]> {
  if (!ids.length) return [];
  const { rows } = await pool.query(`SELECT ${COLS} FROM ai_news_ex WHERE id = ANY($1::uuid[])`, [ids]);
  return rows.map((a) => ({ ...a, key_terms: Array.isArray(a.key_terms) ? a.key_terms : [] })) as DbArticle[];
}

/** 본문에 처음 나온 순서대로 인용 기사 uuid */
function citedOrder(segments: Segment[], articleIds: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const r of [...segments.flatMap((s) => s.refs), ...articleIds]) {
    if (seen.has(r)) continue;
    seen.add(r);
    out.push(r);
  }
  return out;
}

const clip = (s: string, n: number) => (n <= 0 ? "" : s.length > n ? `${s.slice(0, n)}…` : s);

export async function loadReviewInput(briefingId: string, opts: { includeTranslations?: boolean } = {}): Promise<ReviewInput> {
  const row = await getBriefingRow(briefingId);
  if (!row) throw new Error(`briefing ${briefingId} 없음`);
  if (row.locale !== "ko") throw new Error("AI 검토는 ko 판만 합니다 (en/zh 는 ko 검토의 번역 일관성 검사로)");
  const editionType = row.edition_type;
  const periodic = isPeriodic(editionType);
  const content = (row.content ?? {}) as Record<string, unknown>;
  const meta = (content.meta ?? {}) as Record<string, unknown>;
  const periodStart = row.period_start ?? row.edition_date;
  const periodEnd = row.period_end ?? row.edition_date;
  const segments = segmentContent(content, editionType);

  const cited = citedOrder(segments, row.article_ids ?? []);
  const inputIds = [...new Set([...(row.input_article_ids ?? []), ...cited])];
  const all = await loadArticles(inputIds);
  const byId = new Map(all.map((a) => [a.id, a]));
  const citedArts = cited.filter((id) => byId.has(id)).map((id) => byId.get(id)!);
  // 전재·같은 글(제목 글자쌍 Jaccard ≥ DUP_JACCARD)은 앞의 기사 하나만 전체 필드로 주고 나머지는 제목 한 줄로 (토큰 절약)
  const dupOf = new Map<string, string>();
  const full: DbArticle[] = [];
  for (const a of citedArts) {
    const g = bigrams(`${a.title_cn || a.title_kr}`);
    const same = full.find((f) => jaccard(g, bigrams(`${f.title_cn || f.title_kr}`)) >= DUP_JACCARD);
    if (same) dupOf.set(a.id, same.id);
    else full.push(a);
  }

  // 근거 예산: 기본 필드 뒤 남는 글자를 본문 앞부분에 고르게
  const kind = periodic ? "periodic" : "daily";
  // 인용 기사가 많아 기본 필드만으로 예산을 넘으면: 인사이트를 빼고, 그래도 넘으면 요약·중국어 요약 길이를 줄인다 (월간 115건)
  const fm = { ...FIELD_MAX[kind] };
  const baseOf = () =>
    full.reduce(
      (n, a) => n + a.title_kr.length + a.title_cn.length + Math.min(a.summary_kr.length, fm.summary) + Math.min(a.ai_insights_kr.length, fm.insight) + Math.min(a.summary_cn.length, fm.summary_cn) + 80,
      0
    );
  let base = baseOf();
  if (base > EVIDENCE_BUDGET[kind]) {
    fm.insight = 0;
    base = baseOf();
  }
  if (base > EVIDENCE_BUDGET[kind]) {
    const fixed = full.reduce((n, a) => n + a.title_kr.length + a.title_cn.length + 80, 0);
    const f = Math.max(0.2, (EVIDENCE_BUDGET[kind] - fixed) / Math.max(1, base - fixed));
    fm.summary = Math.max(60, Math.floor(fm.summary * f));
    fm.summary_cn = Math.max(40, Math.floor(fm.summary_cn * f));
    base = baseOf();
  }
  const dupChars = citedArts.filter((a) => dupOf.has(a.id)).reduce((n, a) => n + a.title_kr.length + 50, 0);
  const per = Math.max(0, Math.min(CONTENT_MAX[kind], Math.floor((EVIDENCE_BUDGET[kind] - base - dupChars) / Math.max(1, full.length))));
  const refLabels = new Map<string, string>();
  const labelOf = new Map<string, string>();
  citedArts.forEach((a, i) => {
    const label = `a${String(i + 1).padStart(2, "0")}`;
    refLabels.set(label, a.id);
    labelOf.set(a.id, label);
  });
  const articles: ReviewArticle[] = citedArts.map((a) => {
    const label = labelOf.get(a.id)!;
    const dup = dupOf.get(a.id);
    if (dup)
      return {
        id: a.id, label, source_name: a.source_name, news_date: a.news_date ?? "", subject_region: a.subject_region ?? null,
        title_kr: a.title_kr, title_cn: "", summary_kr: "", ai_insights_kr: "", summary_cn: "", content_kr: "", dup_of: labelOf.get(dup),
      };
    return {
      id: a.id, label, source_name: a.source_name, news_date: a.news_date ?? "", subject_region: a.subject_region ?? null,
      title_kr: a.title_kr, title_cn: a.title_cn, summary_kr: clip(a.summary_kr, fm.summary),
      ai_insights_kr: clip(a.ai_insights_kr, fm.insight), summary_cn: clip(a.summary_cn, fm.summary_cn),
      content_kr: per >= 120 ? clip(a.content_kr.replace(/\s+/g, " ").trim(), per) : "",
    };
  });
  const fullText = new Map(citedArts.map((a) => [a.id, [articleText(a), a.content_kr, a.summary_cn].filter(Boolean).join(" ")]));

  let metrics: PeriodMetrics | null = null;
  let facts: Record<string, string> | null = null;
  let candidates: OmissionCandidate[] = [];
  const citedSet = new Set(cited);
  const incompleteDays: string[] = [];

  if (periodic) {
    if (row.metrics_id) {
      const { rows } = await pool.query(`SELECT metrics FROM period_metrics WHERE id = $1::uuid`, [row.metrics_id]);
      metrics = (rows[0]?.metrics as PeriodMetrics) ?? null;
    }
    if (metrics) {
      facts = buildFacts(metrics);
      incompleteDays.push(...(metrics.data_quality?.incomplete_days ?? []));
      const evs = (metrics.stories?.events_top ?? []).filter((e) => !e.ids.some((id) => citedSet.has(id)));
      const prim = await loadArticles(evs.slice(0, OMISSION_CANDIDATES).map((e) => e.primary_id));
      const pm = new Map(prim.map((a) => [a.id, a]));
      candidates = evs.slice(0, OMISSION_CANDIDATES).map((e, i) => ({
        cid: `C${i + 1}`, title: e.title_kr, article_ids: e.ids, sources: e.sources, days: e.days,
        summary: clip(pm.get(e.primary_id)?.summary_kr ?? "", 160),
      }));
    }
    const dq = (meta.data_quality ?? {}) as { incomplete_days?: string[] };
    for (const d of dq.incomplete_days ?? []) if (!incompleteDays.includes(d)) incompleteDays.push(d);
  } else {
    const period = await loadCandidateArticles(periodStart, periodEnd);
    const sel = selectCandidates(period);
    const groups = sel.groups
      .filter((g) => ![g.primary, ...g.siblings].some((a) => citedSet.has(a.id)))
      .sort((a, b) => (b.eventSources ?? b.sources).length - (a.eventSources ?? a.sources).length || b.score - a.score)
      .slice(0, OMISSION_CANDIDATES);
    candidates = groups.map((g, i) => ({
      cid: `C${i + 1}`, title: g.primary.title_kr, article_ids: [g.primary.id, ...g.siblings.map((s) => s.id)],
      sources: g.eventSources ?? g.sources, days: [g.primary.news_date ?? periodStart], summary: clip(g.primary.summary_kr, 160),
    }));
  }

  let translations: TranslationRow[] = [];
  if (!periodic && opts.includeTranslations !== false) {
    const { rows } = await pool.query(
      `SELECT id, locale, version, status, validation, content FROM daily_briefings WHERE source_briefing_id = $1::uuid ORDER BY locale, version DESC`,
      [row.id]
    );
    const seen = new Set<string>();
    translations = rows
      .filter((r) => (seen.has(r.locale) ? false : (seen.add(r.locale), true)))
      .map((r) => ({
        id: r.id, locale: r.locale, version: r.version, status: r.status,
        problems: Array.isArray(r.validation?.problems) ? (r.validation.problems as string[]) : [],
        content: (r.content ?? {}) as Record<string, unknown>,
      }));
  }

  // 결정적 재검증
  let revalidate: ReviewInput["revalidate"];
  if (periodic && metrics) {
    const m = metrics;
    const pool2: StoryPoolItem[] = all.map((a) => ({
      sid: a.id, ids: [a.id], title_kr: a.title_kr, summary_kr: a.summary_kr, sources: [a.source_name], days: [a.news_date ?? ""], entities: [],
    }));
    const ctx = validationContext(
      m,
      new Map(all.map((a) => [a.id, articleText(a)])),
      new Map(all.map((a) => [a.id, [toSourceDoc(a)]])),
      pool2
    );
    revalidate = (c) => {
      const { meta: _m, ...body } = c as Record<string, unknown> & { meta?: unknown };
      void _m;
      const r = validateWeekly(body as unknown as WeeklyContent, ctx);
      return { content: c, fatal: r.fatal, warn: r.warn };
    };
  } else if (periodic) {
    revalidate = (c) => ({ content: c, fatal: [{ level: "fatal", rule: "no_metrics", path: "", detail: "지표 스냅숏이 없어 재검증할 수 없음" }], warn: [] });
  } else {
    const hidden = new Set(all.filter((a) => !a.visible).map((a) => a.id));
    const ctx = contextFromArticles(all, row.mode, hidden, periodStart);
    revalidate = (c) => {
      const { meta: m, ...body } = c as Record<string, unknown> & { meta?: unknown };
      const v = validateKo(body as unknown as BriefingContent, ctx);
      return { content: { ...(v.content as unknown as Record<string, unknown>), meta: m }, fatal: v.report.fatal, warn: v.report.warn };
    };
  }

  return {
    row, editionType, periodStart, periodEnd, segments, articles, refLabels, labelOf, facts, metrics, candidates, translations,
    incompleteDays, meta, fullText, revalidate, candidateArticles: new Map(all.map((a) => [a.id, a])),
  };
}

/**
 * 브리핑 생성 — 모든 실행 경로(n8n HTTP 호출, cron, 관리자 재생성, CLI)가 이 함수 하나를 부른다 (Gate 2).
 *
 *  1. 날짜 잠금 → 후보 선정(§3.2) → 물량 규칙(§1.2) → 입력 해시가 같으면 건너뜀(force 제외)
 *  2. ko 생성 → 검증 → 치명 위반(또는 중국 중심 미달)이면 수리 1회 → 남은 치명 항목 삭제 → 재검증
 *     → 주요 기사가 최소 건수 이상이면 draft, 아니면 failed
 *  3. ko 가 draft 면 en / zh 값만 번역 + 재검증 (각 언어판은 독립적으로 draft/failed)
 *  4. 토큰·비용·지연·LiteLLM request id 를 행마다 기록. 1회 실행 비용 상한(BRIEFING_MAX_COST_USD, 기본 $0.10)
 */
import type {
  BriefingContent,
  BriefingLocale,
  CandidateGroup,
  EditionMode,
  GenerateOptions,
  GenerateResult,
  LlmUsage,
  LocaleOutcome,
  StoredBriefingContent,
  ValidationReport,
} from "./types";
import { BRIEFING_MODEL, LlmError, chat, parseJsonContent } from "./llm";
import { PROMPT_VERSION, TRANSLATE_PROMPT_VERSION, buildRepairPrompt, buildSystemPrompt, buildUserPrompt } from "./prompt";
import { computeInputHash, editionModeFor, selectCandidates } from "./select";
import { citedRefs, contextFromGroups, dropFatalItems, normalizeContent, validateKo } from "./validate";
import { translateBriefing } from "./translate";
import { finishGenerating, insertBriefing, latestBriefing, loadCandidateArticles, withDateLock } from "./repository";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_COST = Number(process.env.BRIEFING_MAX_COST_USD || "0.10");

/** 베이징(Asia/Shanghai) 오늘 날짜 YYYY-MM-DD */
export function beijingToday(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

export function isValidEditionDate(date: string): boolean {
  if (!DATE_RE.test(date)) return false;
  const d = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== date) return false;
  return date <= beijingToday();
}

class BudgetExceeded extends Error {}

class CostTracker {
  usages: LlmUsage[] = [];
  get total() {
    return Math.round(this.usages.reduce((s, u) => s + u.costUsd, 0) * 1e6) / 1e6;
  }
  check = () => {
    if (this.total >= MAX_COST) throw new BudgetExceeded(`비용 상한 초과: $${this.total} ≥ $${MAX_COST}`);
  };
  add = (u: LlmUsage) => {
    this.usages.push(u);
  };
}

function sumUsage(list: LlmUsage[]) {
  return {
    llmRequestIds: list.map((u) => u.requestId).filter((x): x is string => Boolean(x)),
    inputTokens: list.reduce((s, u) => s + u.inputTokens, 0),
    outputTokens: list.reduce((s, u) => s + u.outputTokens, 0),
    costUsd: Math.round(list.reduce((s, u) => s + u.costUsd, 0) * 1e6) / 1e6,
    latencyMs: list.reduce((s, u) => s + u.latencyMs, 0),
  };
}

/** 짧은 id → uuid 로 되돌린 저장용 content. 전재 형제도 refs 에 넣는다 (두 매체 모두 표기). */
function toStored(
  c: BriefingContent,
  groups: CandidateGroup[],
  locale: BriefingLocale,
  meta: Omit<StoredBriefingContent["meta"], "locale" | "cited_count">
): { content: StoredBriefingContent; articleIds: string[] } {
  const g = new Map(groups.map((x) => [x.shortId, x]));
  const one = (r: string) => g.get(r)?.primary.id ?? r;
  const many = (rs: string[]) => [...new Set(rs.flatMap((r) => (g.has(r) ? [g.get(r)!.primary.id, ...g.get(r)!.siblings.map((s) => s.id)] : [])))];
  const termRef = c.term_of_the_day ? g.get(c.term_of_the_day.ref) : undefined;
  const termHit = termRef?.primary.key_terms.find((k) => k.term === c.term_of_the_day?.term);
  const explanation =
    locale === "ko" ? termHit?.explanation_kr : locale === "en" ? termHit?.explanation_en : termHit?.explanation_zh;
  const content: BriefingContent<string> = {
    headline: c.headline,
    lede: c.lede,
    lede_refs: many(c.lede_refs),
    top_stories: c.top_stories.map((s) => ({ ...s, refs: many(s.refs), primary_ref: one(s.primary_ref) })),
    sections: c.sections.map((sec) => ({ ...sec, items: sec.items.map((it) => ({ ...it, refs: many(it.refs) })) })),
    key_numbers: c.key_numbers.map((k) => ({ ...k, ref: one(k.ref) })),
    companies_to_watch: c.companies_to_watch.map((co) => ({ ...co, refs: many(co.refs) })),
    term_of_the_day: c.term_of_the_day ? { ...c.term_of_the_day, ref: one(c.term_of_the_day.ref), explanation: explanation ?? "" } : null,
    clusters: c.clusters.map((cl) => ({ ...cl, ids: many(cl.ids) })),
    excluded: c.excluded.filter((e) => g.has(e.id)).map((e) => ({ ...e, id: one(e.id) })),
  };
  const articleIds = many([...new Set(citedRefs(c))]);
  return { content: { ...content, meta: { ...meta, locale, cited_count: articleIds.length } }, articleIds };
}

interface KoOutcome {
  status: "draft" | "failed";
  content: BriefingContent | null;
  validation: Record<string, unknown>;
  usages: LlmUsage[];
  error?: string;
}

async function generateKo(date: string, mode: EditionMode, groups: CandidateGroup[], cost: CostTracker): Promise<KoOutcome> {
  const usages: LlmUsage[] = [];
  const track = (u: LlmUsage) => {
    usages.push(u);
    cost.add(u);
  };
  const ctx = contextFromGroups(groups, mode);
  const system = buildSystemPrompt(mode);
  const user = buildUserPrompt(date, groups);
  const minTop = mode === "normal" ? 3 : 1;
  const validation: Record<string, unknown> = { prompt_version: PROMPT_VERSION };

  cost.check();
  const first = await chat({ system, messages: [{ role: "user", content: user }], maxTokens: 8000 }, track);
  const parsed1 = normalizeContent(parseJsonContent(first.content));
  let cur = validateKo(parsed1.content, ctx, parsed1.issues);
  validation.initial = cur.report;

  const chinaMiss = (r: ValidationReport) => r.warn.some((w) => w.rule === "china_centric");
  if (cur.report.fatal.length || chinaMiss(cur.report)) {
    try {
      cost.check();
      const extra = chinaMiss(cur.report) ? [cur.report.warn.find((w) => w.rule === "china_centric")!.detail + " — 중국 중심 규칙 미달"] : [];
      const second = await chat(
        {
          system,
          messages: [
            { role: "user", content: user },
            { role: "assistant", content: first.content },
            { role: "user", content: buildRepairPrompt(cur.content, cur.report.fatal, extra) },
          ],
          maxTokens: 8000,
        },
        track
      );
      const parsed2 = normalizeContent(parseJsonContent(second.content));
      const repaired = validateKo(parsed2.content, ctx, parsed2.issues);
      validation.repair = repaired.report;
      // 수리본이 더 나쁘면(치명 증가·주요 기사 감소) 원본 유지
      if (
        repaired.report.fatal.length <= cur.report.fatal.length &&
        repaired.report.stats.topStories >= Math.min(cur.report.stats.topStories, minTop)
      ) {
        cur = repaired;
        validation.used = "repair";
      } else validation.used = "initial";
    } catch (e) {
      if (e instanceof BudgetExceeded) throw e;
      validation.repair_error = (e as Error).message;
      validation.used = "initial";
    }
  }

  let content = cur.content;
  if (cur.report.fatal.length) {
    const dropped = dropFatalItems(content, cur.report.fatal);
    validation.dropped_items = dropped.dropped;
    if (dropped.unrecoverable.length) {
      validation.final = cur.report;
      return { status: "failed", content, validation, usages, error: `삭제할 수 없는 항목의 치명 위반: ${dropped.unrecoverable.join(", ")}` };
    }
    cur = validateKo(dropped.content, ctx);
    content = cur.content;
  }
  validation.final = cur.report;
  if (cur.report.fatal.length) return { status: "failed", content, validation, usages, error: "재검증 후에도 치명 위반이 남음" };
  if (content.top_stories.length < minTop)
    return { status: "failed", content, validation, usages, error: `주요 기사 ${content.top_stories.length}건 < ${minTop}건` };
  return { status: "draft", content, validation, usages };
}

export async function generateBriefing(opts: GenerateOptions = {}): Promise<GenerateResult> {
  const date = opts.date ?? beijingToday();
  if (!isValidEditionDate(date)) {
    return { date, outcome: "failed", mode: null, candidateCount: 0, inputHash: null, locales: [], totalCostUsd: 0, message: "날짜 형식이 틀렸거나 미래 날짜입니다" };
  }

  const result = await withDateLock(date, async (): Promise<GenerateResult> => {
    const articles = await loadCandidateArticles(date);
    const sel = selectCandidates(articles);
    const mode = editionModeFor(sel.totalGroups);
    const inputHash = computeInputHash(sel.groups, `${PROMPT_VERSION}|${TRANSLATE_PROMPT_VERSION}|${mode}`, BRIEFING_MODEL);
    const base = { date, mode, candidateCount: articles.length, inputHash };
    const inputArticleIds = sel.groups.flatMap((g) => [g.primary.id, ...g.siblings.map((s) => s.id)]);
    const metaBase = {
      edition_date: date,
      mode,
      candidate_count: articles.length,
      group_count: sel.totalGroups,
      prompt_version: PROMPT_VERSION,
      ai_generated: true as const,
    };

    if (opts.dryRun) {
      return { ...base, outcome: "dry_run", locales: [], totalCostUsd: 0, message: `후보 ${sel.groups.length}개 (묶음 ${sel.totalGroups}, 정치 제외 ${sel.politicalExcluded.length})` };
    }

    const prev = await latestBriefing(date, "ko");
    if (!opts.force && prev && prev.input_hash === inputHash && ["draft", "published", "skipped"].includes(prev.status)) {
      return {
        ...base,
        outcome: "skipped_same_input",
        locales: [{ locale: "ko", id: prev.id, version: prev.version, status: prev.status, fatal: 0, warn: 0, costUsd: 0 }],
        totalCostUsd: 0,
        message: `입력이 같아 건너뜀 (v${prev.version} ${prev.status})`,
      };
    }

    if (mode === "skipped") {
      const row = await insertBriefing({
        date, locale: "ko", status: "skipped", mode, content: { meta: { ...metaBase, locale: "ko", cited_count: 0, china_centric_count: 0 } },
        articleIds: [], inputArticleIds, candidateCount: articles.length, inputHash, promptVersion: PROMPT_VERSION,
      });
      return {
        ...base,
        outcome: "skipped_low_volume",
        locales: [{ locale: "ko", id: row.id, version: row.version, status: "skipped", fatal: 0, warn: 0, costUsd: 0 }],
        totalCostUsd: 0,
        message: `이야기 ${sel.totalGroups}건 < 3 — 일간판 생략`,
      };
    }

    const cost = new CostTracker();
    const koRow = await insertBriefing({
      date, locale: "ko", status: "generating", mode, content: {}, articleIds: [], inputArticleIds,
      candidateCount: articles.length, inputHash, model: BRIEFING_MODEL, promptVersion: PROMPT_VERSION,
    });
    const locales: LocaleOutcome[] = [];

    let ko: KoOutcome;
    try {
      ko = await generateKo(date, mode, sel.groups, cost);
    } catch (e) {
      const msg = e instanceof LlmError || e instanceof BudgetExceeded ? e.message : `예상치 못한 오류: ${(e as Error).message}`;
      const u = sumUsage(cost.usages);
      await finishGenerating(koRow.id, { status: "failed", content: {}, articleIds: [], validation: null, model: BRIEFING_MODEL, promptVersion: PROMPT_VERSION, ...u, error: msg });
      return { ...base, outcome: "failed", locales: [{ locale: "ko", id: koRow.id, version: koRow.version, status: "failed", fatal: 0, warn: 0, costUsd: u.costUsd, error: msg }], totalCostUsd: cost.total, message: msg };
    }

    const finalReport = ko.validation.final as ValidationReport | undefined;
    const china = finalReport?.stats.chinaCentric ?? 0;
    const stored = ko.content ? toStored(ko.content, sel.groups, "ko", { ...metaBase, china_centric_count: china }) : null;
    const koUsage = sumUsage(ko.usages);
    await finishGenerating(koRow.id, {
      status: ko.status,
      content: stored?.content ?? {},
      articleIds: stored?.articleIds ?? [],
      validation: ko.validation,
      model: BRIEFING_MODEL,
      promptVersion: PROMPT_VERSION,
      ...koUsage,
      error: ko.error ?? null,
    });
    locales.push({
      locale: "ko", id: koRow.id, version: koRow.version, status: ko.status,
      fatal: finalReport?.fatal.length ?? 0, warn: finalReport?.warn.length ?? 0, costUsd: koUsage.costUsd, error: ko.error,
    });

    if (ko.status === "draft" && ko.content) {
      for (const target of ["en", "zh"] as const) {
        let tr;
        try {
          tr = await translateBriefing(ko.content, target, sel.groups, cost.check);
        } catch (e) {
          tr = { content: null, problems: [], repaired: false, usages: [], error: (e as Error).message };
        }
        tr.usages.forEach(cost.add);
        const u = sumUsage(tr.usages);
        const ok = Boolean(tr.content);
        const st = tr.content ? toStored(tr.content, sel.groups, target, { ...metaBase, china_centric_count: china }) : null;
        const error = ok ? null : tr.error ?? `번역 재검증 실패 (${tr.problems.length}건)`;
        const row = await insertBriefing({
          date, locale: target, status: ok ? "draft" : "failed", mode,
          content: st?.content ?? {}, articleIds: st?.articleIds ?? stored?.articleIds ?? [], inputArticleIds,
          candidateCount: articles.length, inputHash,
          validation: { prompt_version: TRANSLATE_PROMPT_VERSION, repaired: tr.repaired, problems: tr.problems },
          sourceBriefingId: koRow.id, model: BRIEFING_MODEL, promptVersion: TRANSLATE_PROMPT_VERSION, ...u, error,
        });
        locales.push({ locale: target, id: row.id, version: row.version, status: ok ? "draft" : "failed", fatal: tr.problems.length, warn: 0, costUsd: u.costUsd, error: error ?? undefined });
      }
    }

    return { ...base, outcome: ko.status === "draft" ? "generated" : "failed", locales, totalCostUsd: cost.total, message: ko.error };
  });

  return (
    result ?? { date, outcome: "locked", mode: null, candidateCount: 0, inputHash: null, locales: [], totalCostUsd: 0, message: "같은 날짜를 다른 실행이 생성 중" }
  );
}

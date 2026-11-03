/**
 * 브리핑 생성 모델 비교 실험 (2026-11-03) — DB 에 판을 쓰지 않는다 (읽기만).
 *
 *   생성: BRIEFING_MODEL=<model> [BRIEFING_EFFORT=low|medium|high] \   (주간: PERIODIC_MODEL / PERIODIC_EFFORT)
 *         npx tsx scripts/briefing-model-compare.ts gen --date 2026-10-27 --arm <이름> --run 1 --out <dir>
 *         → <dir>/gen/<date>_<arm>_r<run>.json (ko 본문·생성 기록·결정적 지표·비용)
 *   채점: BRIEFING_REVIEW_MODEL=<model> [BRIEFING_REVIEW_EFFORT=..] \
 *         npx tsx scripts/briefing-model-compare.ts review --out <dir> --judge <이름> [--only <파일 일부>]
 *         → <dir>/review/<judge>/<같은 파일명>.json (AI 검토기 v6.2 와 같은 프롬프트·근거, 저장 안 함)
 *
 *  - 같은 날짜는 모든 실험군이 같은 후보 묶음(selectCandidates)과 같은 전날 요약을 쓴다 (generateBriefing 과 같은 순서).
 *  - ko 생성만 비교한다 (번역 제외). generateKo 는 운영 생성과 같은 함수 (수리·부분 수리·삭제·대체 판 포함).
 *  - 채점 행: 그 날짜의 실제 ko 행을 틀로 쓰고 content·article_ids·validation 만 실험 판으로 바꾼다.
 */
import { loadEnvConfig } from "@next/env";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
}

async function gen() {
  const date = arg("date");
  const arm = arg("arm");
  const run = arg("run") ?? "1";
  const out = arg("out");
  if (!date || !arm || !out) throw new Error("--date --arm --out 필요");
  const { generateKo, CostTracker, sumUsage, toStored } = await import("../src/lib/briefing/generate");
  const { loadCandidateArticles, previousEditionSummary } = await import("../src/lib/briefing/repository");
  const { selectCandidates, editionModeFor } = await import("../src/lib/briefing/select");
  const { editionPeriod } = await import("../src/lib/briefing/sla");
  const { BRIEFING_MODEL, BRIEFING_EFFORT } = await import("../src/lib/briefing/llm");
  const { PROMPT_VERSION } = await import("../src/lib/briefing/prompt");

  const period = editionPeriod(date);
  const dateLabel = period.weekend ? `${period.periodStart}~${period.periodEnd} (토·일 주말 합본)` : date;
  const articles = await loadCandidateArticles(period.periodStart, period.periodEnd);
  const sel = selectCandidates(articles);
  const mode = editionModeFor(sel.totalGroups);
  const previous = await previousEditionSummary(period.periodStart);
  const cost = new CostTracker(Number(process.env.COMPARE_MAX_COST_USD || "3"));
  const started = Date.now();
  let ko;
  let error: string | null = null;
  try {
    ko = await generateKo(dateLabel, mode, sel.groups, cost, period.periodStart, previous);
  } catch (e) {
    error = (e as Error).message;
  }
  const v = (ko?.validation ?? {}) as Record<string, unknown> & {
    initial?: { fatal: { rule: string; path: string; detail: string }[]; warn: { rule: string }[] };
    final?: { fatal: unknown[]; warn: { rule: string; path: string; detail: string }[]; stats?: Record<string, number> };
  };
  const finalMode = ko?.mode ?? mode;
  const stored = ko?.content ? toStored(ko.content, sel.groups, "ko", { edition_date: date, mode: finalMode, candidate_count: articles.length, group_count: sel.totalGroups, prompt_version: PROMPT_VERSION, ai_generated: true, china_centric_count: v.final?.stats?.chinaCentric ?? 0 } as never) : null;
  const u = sumUsage(cost.usages);
  const rec = {
    date, arm, run: Number(run), model: BRIEFING_MODEL, effort: BRIEFING_EFFORT ?? null, promptVersion: PROMPT_VERSION,
    mode, finalMode, status: ko?.status ?? "error", error,
    metrics: {
      initialFatal: v.initial?.fatal.length ?? null,
      initialFatalRules: (v.initial?.fatal ?? []).map((f) => `${f.rule}@${f.path}`),
      used: v.used ?? null,
      repairRounds: ["repair", "repair2"].filter((k) => k in v).length,
      targetedRepair: "targeted_repair" in v,
      dropped: (v.dropped_items as string[] | undefined) ?? [],
      fallback: (v.fallback as string | undefined) ?? null,
      fallbackReason: (v.fallback_reason as string | undefined) ?? null,
      finalFatal: v.final?.fatal.length ?? null,
      droppedKeyStories: (v.final?.warn ?? []).filter((w) => w.rule === "dropped_key_story").map((w) => w.detail),
      edits: Array.isArray(v.edits) ? v.edits.length : 0,
      topStories: ko?.content?.top_stories.length ?? 0,
      sectionItems: ko?.content?.sections.reduce((n, s) => n + s.items.length, 0) ?? 0,
      chinaCentric: v.final?.stats?.chinaCentric ?? null,
    },
    usage: { ...u, calls: cost.usages.length, wallMs: Date.now() - started },
    inputArticleIds: sel.groups.flatMap((g) => [g.primary.id, ...g.siblings.map((s) => s.id)]),
    content: stored?.content ?? null,
    articleIds: stored?.articleIds ?? [],
    validation: ko?.validation ?? null,
  };
  mkdirSync(join(out, "gen"), { recursive: true });
  const file = join(out, "gen", `${date}_${arm}_r${run}.json`);
  writeFileSync(file, JSON.stringify(rec, null, 1));
  console.log(`${date} ${arm} r${run}: ${rec.status}/${finalMode} 첫 치명 ${rec.metrics.initialFatal} 수리 ${rec.metrics.repairRounds} 삭제 ${rec.metrics.dropped.length} 대체 ${rec.metrics.fallback ?? "-"} $${u.costUsd} ${Math.round(rec.usage.wallMs / 1000)}s${error ? ` 오류 ${error}` : ""}`);
}

/** 주간 (2026-W41 등) — generatePeriodic 과 같은 순서로 입력을 만들고 generatePeriodicKo 만 부른다 (지표 스냅숏도 저장하지 않음) */
async function weekly() {
  const key = arg("week") ?? arg("month");
  const kind = arg("month") ? ("monthly" as const) : ("weekly" as const);
  const arm = arg("arm");
  const run = arg("run") ?? "1";
  const out = arg("out");
  if (!key || !arm || !out) throw new Error("--week|--month --arm --out 필요");
  const pool = (await import("../src/lib/db")).default;
  const { computePeriodMetrics } = await import("../src/lib/metrics/period");
  const g = await import("../src/lib/briefing/periodic/generate");
  const { resolvePeriod } = await import("../src/lib/briefing/periodic/period-key");
  const { buildStoryPool, STORY_LIMIT, PROMPT_VERSION } = await import("../src/lib/briefing/periodic/prompt");
  const { CostTracker, sumUsage } = await import("../src/lib/briefing/generate");
  const { PERIODIC_MODEL: BRIEFING_MODEL, PERIODIC_EFFORT: BRIEFING_EFFORT } = await import("../src/lib/briefing/llm");
  const p = resolvePeriod(kind, { key });
  if ("error" in p) throw new Error(p.error);
  const prev = g.comparablePrevious(p);
  const { metrics: m, stories } = await computePeriodMetrics(pool, {
    kind, start: p.start, end: p.end, prevStart: prev?.start, prevEnd: prev?.end, population: "ai", likeForLike: kind === "weekly",
  });
  const poolItems = buildStoryPool(stories as never, m.money_table, STORY_LIMIT[kind]);
  const { sourceText, docs, idDay } = await g.loadSourceText(poolItems);
  const ctx = g.validationContext(m, sourceText, docs, poolItems);
  const cost = new CostTracker(Number(process.env.COMPARE_MAX_COST_USD || "3"));
  const started = Date.now();
  let ko: Awaited<ReturnType<typeof g.generatePeriodicKo>> | null = null;
  let error: string | null = null;
  try {
    ko = await g.generatePeriodicKo(kind, m, poolItems, ctx, cost);
  } catch (e) {
    error = (e as Error).message;
  }
  const v = (ko?.validation ?? {}) as Record<string, unknown> & { initial?: { fatal: { rule: string; path: string }[] }; final?: { fatal: unknown[] } };
  const meta = {
    edition_type: kind, period_key: key, ...(kind === "weekly" ? { iso_week: key } : { month: key }), period_start: p.start, period_end: p.end, locale: "ko",
    prompt_version: PROMPT_VERSION[kind], metrics_id: null, metrics_version: m.metrics_version, candidate_count: m.volume.total,
    story_count: poolItems.length, data_quality: m.data_quality, baseline: m.baseline, fallbacks: ko?.fallbacks ?? [], ai_generated: true,
  };
  const stored = ko?.content ? g.toStoredWeekly(ko.content, poolItems, meta as never, ctx.weekRanges ? { idDay, weekRanges: ctx.weekRanges } : undefined) : null;
  const u = sumUsage(cost.usages);
  const rec = {
    date: p.start, week: key, edition: kind, arm, run: Number(run), model: BRIEFING_MODEL, effort: BRIEFING_EFFORT ?? null,
    promptVersion: PROMPT_VERSION[kind], mode: "normal", finalMode: "normal", status: ko?.status ?? "error", error: error ?? ko?.error ?? null,
    metrics: {
      initialFatal: v.initial?.fatal.length ?? null,
      initialFatalRules: (v.initial?.fatal ?? []).map((f) => `${f.rule}@${f.path}`),
      used: v.used ?? null, repairRounds: ["repair", "repair2"].filter((k) => k in v).length,
      dropped: ko?.dropped ?? [], fallbacks: ko?.fallbacks ?? [], finalFatal: v.final?.fatal.length ?? null,
      edits: Array.isArray(v.edits) ? v.edits.length : 0, bigPicture: ko?.content?.big_picture.length ?? 0,
    },
    usage: { ...u, calls: cost.usages.length, wallMs: Date.now() - started },
    inputArticleIds: [...new Set(poolItems.flatMap((x) => x.ids))],
    content: stored?.content ?? null, articleIds: stored?.articleIds ?? [], validation: ko?.validation ?? null,
  };
  mkdirSync(join(out, "gen"), { recursive: true });
  writeFileSync(join(out, "gen", `${key}_${arm}_r${run}.json`), JSON.stringify(rec, null, 1));
  console.log(`${key} ${arm} r${run}: ${rec.status} 첫 치명 ${rec.metrics.initialFatal} 수리 ${rec.metrics.repairRounds} 삭제 ${rec.metrics.dropped.length} 최종 치명 ${rec.metrics.finalFatal} $${u.costUsd} ${Math.round(rec.usage.wallMs / 1000)}s${rec.error ? ` 오류 ${rec.error}` : ""}`);
  await pool.end();
}

async function review() {
  const out = arg("out");
  const judge = arg("judge");
  if (!out || !judge) throw new Error("--out --judge 필요");
  const only = arg("only");
  const { reviewBriefing, REVIEW_MODEL } = await import("../src/lib/briefing/review/review");
  const { loadReviewInput } = await import("../src/lib/briefing/review/evidence");
  const { policyFromEnv } = await import("../src/lib/briefing/review/policy");
  const { getBriefingRow } = await import("../src/lib/briefing/admin");
  const pool = (await import("../src/lib/db")).default;
  const policy = policyFromEnv({ ...process.env, BRIEFING_AUTO_PUBLISH: "on" });
  const dir = join(out, "review", judge);
  mkdirSync(dir, { recursive: true });
  const files = readdirSync(join(out, "gen")).filter((f) => f.endsWith(".json") && (!only || only.split(",").some((o) => f.includes(o)))).sort();
  for (const f of files) {
    const target = join(dir, f);
    if (existsSync(target)) continue;
    const g = JSON.parse(readFileSync(join(out, "gen", f), "utf8"));
    if (!g.content) {
      console.log(`${f}: 본문 없음 — 건너뜀`);
      continue;
    }
    const { rows } = await pool.query(
      `SELECT id FROM daily_briefings WHERE edition_type = $2 AND locale = 'ko' AND edition_date = $1::date AND status IN ('draft','published') ORDER BY version DESC LIMIT 1`,
      [g.date, g.edition === "weekly" || g.edition === "monthly" ? g.edition : "daily"]
    );
    const base = rows[0] ? await getBriefingRow(rows[0].id) : null;
    if (!base) {
      console.log(`${f}: 틀로 쓸 실제 행 없음 — 건너뜀`);
      continue;
    }
    const row = { ...base, version: 0, mode: g.finalMode, content: g.content, article_ids: g.articleIds, input_article_ids: g.inputArticleIds, validation: g.validation };
    const input = await loadReviewInput(row.id, { includeTranslations: false, row });
    const { result } = await reviewBriefing(row.id, { trigger: "calibration", store: false, includeTranslations: false, policy, input });
    writeFileSync(target, JSON.stringify({ file: f, judge, judgeModel: REVIEW_MODEL, arm: g.arm, date: g.date, run: g.run, result }, null, 1));
    console.log(`${f} [${judge}]: ${result.status} ${result.verdict ?? ""} ${result.score ?? ""} $${result.costUsd}${result.error ? ` 오류 ${result.error}` : ""}`);
  }
  await pool.end();
}

async function main() {
  loadEnvConfig(process.cwd());
  const cmd = process.argv[2];
  if (cmd === "gen") {
    await gen();
    const pool = (await import("../src/lib/db")).default;
    await pool.end();
  } else if (cmd === "weekly") await weekly();
  else if (cmd === "monthly") await weekly();
  else if (cmd === "review") await review();
  else throw new Error("gen | weekly | review");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

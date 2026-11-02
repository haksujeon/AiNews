/**
 * AI 검토 보정 — 사람 감사(1차 13판 + 재감사 11판)와 비교한다. 자동 발행을 켜기 전에 반드시 돌린다 (결정 D8).
 *
 *   npx tsx scripts/briefing-review-calibrate.ts --audit-dir ~/ainews-reports/briefing-qa-2026-11-02 --out-dir <dir> [--cap 3] [--fresh] [--only <id,...>] [--no-run]
 *
 *  - 판마다 같은 프롬프트 버전의 보정 검토(trigger calibration)가 이미 있으면 다시 부르지 않는다 (--fresh 면 새로).
 *  - 비용 상한: LiteLLM_SpendLogs 에서 지금까지의 보정 검토 request_id 의 spend 합을 읽어, 상한 − 0.2 를 넘으면 새 검토를 멈춘다.
 *  - 감사 결과는 프롬프트에 넣지 않는다 (비교에만 쓴다).
 *  - 결과: <out-dir>/calibration.json, <out-dir>/CALIBRATION.md
 */
import { loadEnvConfig } from "@next/env";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
}
const flag = (name: string) => process.argv.includes(`--${name}`);

interface Audit {
  file: string;
  set: "first" | "v2";
  edition: string;
  id: string;
  score: number;
  recommendation: string;
  claims: { path: string; claim: string; label: string; claim_type?: string; note?: string }[];
}

function readAudits(dir: string): Audit[] {
  const out: Audit[] = [];
  for (const [sub, set] of [["v2", "v2"], ["", "first"]] as const) {
    const d = join(dir, sub);
    for (const f of readdirSync(d).filter((x) => /^(daily|weekly|monthly)_.*\.json$/.test(x)).sort()) {
      const j = JSON.parse(readFileSync(join(d, f), "utf8"));
      out.push({ file: join(sub, f), set, edition: j.edition ?? f.replace(/\.json$/, ""), id: j.id, score: Number(j.score), recommendation: j.recommendation, claims: j.claims ?? [] });
    }
  }
  return out;
}

function spendOf(requestIds: string[]): number {
  if (!requestIds.length) return 0;
  const list = requestIds.map((r) => `'${r.replace(/[^A-Za-z0-9_-]/g, "")}'`).join(",");
  const out = execFileSync("docker", ["exec", "litellm-postgres", "psql", "-U", "litellm", "-d", "litellm", "-At", "-c", `select coalesce(sum(spend),0) from "LiteLLM_SpendLogs" where request_id in (${list})`], { encoding: "utf8" });
  return Number(out.trim()) || 0;
}

async function main() {
  loadEnvConfig(process.cwd());
  const auditDir = arg("audit-dir");
  const outDir = arg("out-dir");
  if (!auditDir || !outDir) throw new Error("--audit-dir 와 --out-dir 가 필요합니다");
  const cap = Number(arg("cap") ?? "3");
  const only = arg("only")?.split(",");
  mkdirSync(outDir, { recursive: true });

  const pool = (await import("../src/lib/db")).default;
  const { reviewBriefing } = await import("../src/lib/briefing/review/review");
  const { REVIEW_PROMPT_VERSION } = await import("../src/lib/briefing/review/prompt");
  const { policyFromEnv, decide, minScoreFor } = await import("../src/lib/briefing/review/policy");
  const { scoreReview, stricter, verdictOfRecommendation, RUBRIC_PASS_SCORE } = await import("../src/lib/briefing/review/score");
  const { compareEdition, recallTable, falseAlarm, confusion } = await import("../src/lib/briefing/review/calibrate");
  const { segmentContent } = await import("../src/lib/briefing/review/segments");
  type RC = import("../src/lib/briefing/review/types").ReviewClaim;

  const audits = readAudits(auditDir).filter((a) => !only || only.includes(a.id));
  const policy = policyFromEnv({ ...process.env, BRIEFING_AUTO_PUBLISH: "on" });
  try {
    // LiteLLM 기록이 몇 초~몇 분 늦게 쌓이므로, 실측 합과 행에 남긴 계산 비용 중 큰 쪽
    const spentSoFar = async () => {
      const { rows } = await pool.query(
        `SELECT coalesce((SELECT array_agg(x) FROM briefing_reviews, unnest(llm_request_ids) x WHERE trigger = 'calibration'), '{}') AS ids,
                coalesce((SELECT sum(cost_usd) FROM briefing_reviews WHERE trigger = 'calibration'), 0) AS local`
      );
      return Math.max(spendOf(rows[0].ids as string[]), Number(rows[0].local));
    };
    let spent = await spentSoFar();
    console.log(`보정 누적 비용(LiteLLM 실측) $${spent.toFixed(4)} / 상한 $${cap}`);

    if (!flag("no-run")) {
      for (const a of audits) {
        const { rows } = await pool.query(
          `SELECT id FROM briefing_reviews WHERE briefing_id = $1::uuid AND trigger = 'calibration' AND prompt_version = $2 AND status = 'done' LIMIT 1`,
          [a.id, REVIEW_PROMPT_VERSION]
        );
        if (rows.length && !flag("fresh")) continue;
        if (spent + 0.2 > cap) {
          console.log(`비용 상한 근접 — ${a.edition} 이후 중단 (누적 $${spent.toFixed(4)})`);
          break;
        }
        const { result } = await reviewBriefing(a.id, { trigger: "calibration", includeTranslations: false, policy });
        spent = await spentSoFar();
        console.log(`${a.set} ${a.edition}: ${result.status} ${result.verdict ?? ""} ${result.score ?? ""} $${result.costUsd} ${Math.round(result.latencyMs / 1000)}s 누적 $${spent.toFixed(4)}${result.error ? ` 오류 ${result.error}` : ""}`);
      }
    }

    // 비교 (가장 최근의 같은 버전 보정 검토)
    const rowsOut: Record<string, unknown>[] = [];
    const cmps: Record<string, ReturnType<typeof compareEdition>[]> = { first: [], v2: [], all: [] };
    const pairs: Record<string, { human: "PASS" | "FIXABLE" | "FAIL"; reviewer: "PASS" | "FIXABLE" | "FAIL" | null }[]> = { first: [], v2: [], all: [] };
    const pairsRubric: typeof pairs = { first: [], v2: [], all: [] };
    for (const a of audits) {
      const { rows } = await pool.query(
        `SELECT r.*, b.content, b.edition_type AS et FROM briefing_reviews r JOIN daily_briefings b ON b.id = r.briefing_id
          WHERE r.briefing_id = $1::uuid AND r.trigger = 'calibration' AND r.prompt_version = $2 AND r.status = 'done' ORDER BY r.created_at DESC LIMIT 1`,
        [a.id, REVIEW_PROMPT_VERSION]
      );
      const r = rows[0];
      const human = verdictOfRecommendation(a.recommendation);
      if (!r) {
        rowsOut.push({ edition: a.edition, set: a.set, humanScore: a.score, human, reviewer: null });
        continue;
      }
      const claims = (r.claims ?? []) as RC[];
      const segs = new Map(segmentContent(r.content, r.et).map((s) => [s.sid, s.text]));
      const cmp = compareEdition(a.edition, a.claims, claims, (sid) => segs.get(sid) ?? "");
      cmps[a.set].push(cmp);
      cmps.all.push(cmp);
      const omissions = (r.omissions ?? []) as { important: boolean }[];
      const structure = (r.structure ?? []) as string[];
      const sc85 = scoreReview(claims, omissions, structure.length, { passScore: RUBRIC_PASS_SCORE });
      const scPol = scoreReview(claims, omissions, structure.length, { passScore: minScoreFor(policy, r.et) });
      const verdictPipeline = stricter(scPol.rubricVerdict, r.llm_verdict);
      const dec = decide(
        {
          review: { status: "done", verdict: verdictPipeline, score: scPol.score, counts: scPol.counts, translation: [], error: undefined },
          editionType: r.et, deterministicFatal: 0,
          translations: [{ locale: "en", status: "draft", problems: 0 }, { locale: "zh", status: "draft", problems: 0 }],
          incompleteDays: [],
        },
        policy
      );
      // 실제 정책(주간·월간 결손일 → 사람에게)까지 넣은 모의
      const dqDays = ((r.content?.meta?.data_quality?.incomplete_days ?? []) as string[]);
      const decFull = decide(
        {
          review: { status: "done", verdict: verdictPipeline, score: scPol.score, counts: scPol.counts, translation: [], error: undefined },
          editionType: r.et, deterministicFatal: 0,
          translations: [{ locale: "en", status: "draft", problems: 0 }, { locale: "zh", status: "draft", problems: 0 }],
          incompleteDays: dqDays,
        },
        policy
      );
      pairs[a.set].push({ human, reviewer: verdictPipeline });
      pairs.all.push({ human, reviewer: verdictPipeline });
      pairsRubric[a.set].push({ human, reviewer: sc85.rubricVerdict });
      pairsRubric.all.push({ human, reviewer: sc85.rubricVerdict });
      rowsOut.push({
        edition: a.edition, set: a.set, id: a.id, humanScore: a.score, human, humanRec: a.recommendation,
        reviewerScore: scPol.score, llmVerdict: r.llm_verdict, verdictRubric85: sc85.rubricVerdict, verdictPipeline,
        counts: scPol.counts, humanErrors: cmp.humanErrors.length, found: cmp.humanErrors.filter((h) => h.found).length,
        reviewerErrors: cmp.reviewerErrors.length, falseAlarms: cmp.reviewerErrors.filter((x) => !x.matched).length,
        wouldAutoPublish: dec.eligible, wouldAutoPublishWithDq: decFull.eligible, incompleteDays: dqDays, failedChecks: dec.checks.filter((c) => !c.ok).map((c) => c.detail),
        cost: Number(r.cost_usd), latencyS: Math.round(Number(r.latency_ms) / 1000),
        missed: cmp.humanErrors.filter((h) => !h.found).map((h) => `${h.claim.path} ${h.claim.label}: ${h.claim.claim.slice(0, 70)}`),
        alarms: cmp.reviewerErrors.filter((x) => !x.matched).map((x) => `${x.claim.path} ${x.claim.label}: ${x.claim.claim.slice(0, 70)} — ${x.claim.note.slice(0, 80)}`),
      });
    }
    spent = await spentSoFar();
    const summary = {
      promptVersion: REVIEW_PROMPT_VERSION,
      spentUsd: Math.round(spent * 1e4) / 1e4,
      recall: { all: recallTable(cmps.all), first: recallTable(cmps.first), v2: recallTable(cmps.v2) },
      falseAlarm: { all: falseAlarm(cmps.all), first: falseAlarm(cmps.first), v2: falseAlarm(cmps.v2) },
      confusionPipeline: { all: confusion(pairs.all), first: confusion(pairs.first), v2: confusion(pairs.v2) },
      confusionRubric85: { all: confusion(pairsRubric.all) },
      autoPublishedLowRated: rowsOut.filter((x) => x.wouldAutoPublish && Number(x.humanScore) <= 6).map((x) => x.edition),
      autoPublished: rowsOut.filter((x) => x.wouldAutoPublish).map((x) => `${x.edition}(사람 ${x.humanScore})`),
      autoPublishedWithDq: rowsOut.filter((x) => x.wouldAutoPublishWithDq).map((x) => `${x.edition}(사람 ${x.humanScore})`),
      autoPublishedLowRatedWithDq: rowsOut.filter((x) => x.wouldAutoPublishWithDq && Number(x.humanScore) <= 6).map((x) => x.edition),
      editions: rowsOut,
    };
    writeFileSync(join(outDir, "calibration.json"), JSON.stringify(summary, null, 1));
    const md: string[] = [
      `# AI 검토 보정 (${REVIEW_PROMPT_VERSION})`,
      ``,
      `누적 비용(LiteLLM 실측): $${summary.spentUsd}`,
      ``,
      `## 사람 오류 재현율`,
      `| 묶음 | 전체 (사람/찾음/%) | 1차 13판 | 재감사 11판 |`,
      `|---|---|---|---|`,
      ...summary.recall.all.map((g, i) => `| ${g.group} | ${g.human}/${g.found} ${g.recall ?? "—"}% (라벨 일치 ${g.exact}) | ${summary.recall.first[i].human}/${summary.recall.first[i].found} ${summary.recall.first[i].recall ?? "—"}% | ${summary.recall.v2[i].human}/${summary.recall.v2[i].found} ${summary.recall.v2[i].recall ?? "—"}% |`),
      ``,
      `거짓 경보(사람 오류가 없는 항목에 붙인 오류): 전체 ${summary.falseAlarm.all.unmatched}/${summary.falseAlarm.all.reviewerErrors} (${summary.falseAlarm.all.rate}%), 1차 ${summary.falseAlarm.first.rate}%, 재감사 ${summary.falseAlarm.v2.rate}%`,
      ``,
      `## 판정 혼동표 (행 = 사람 권고, 열 = 검토 판정 — 파이프라인 기준)`,
      `| 사람 \\ 검토 | PASS | FIXABLE | FAIL | 오류 |`,
      `|---|---|---|---|---|`,
      ...(["PASS", "FIXABLE", "FAIL"] as const).map((h) => `| ${h} | ${summary.confusionPipeline.all[h].PASS} | ${summary.confusionPipeline.all[h].FIXABLE} | ${summary.confusionPipeline.all[h].FAIL} | ${summary.confusionPipeline.all[h].ERROR} |`),
      ``,
      `자동 발행 모의 A (번역·결손일 조건은 통과로 가정): ${summary.autoPublished.join(", ") || "없음"} — 사람 6점 이하가 자동 발행된 판: ${summary.autoPublishedLowRated.join(", ") || "0건"}`,
      ``,
      `자동 발행 모의 B (주간·월간 결손일 조건 포함, 번역은 통과 가정): ${summary.autoPublishedWithDq.join(", ") || "없음"} — 사람 6점 이하: ${summary.autoPublishedLowRatedWithDq.join(", ") || "0건"}`,
      ``,
      `## 판별`,
      `| 판 | 묶음 | 사람 점수·권고 | 검토 점수·판정(모델) | 사람 오류 찾음 | 거짓 경보 | 자동 발행 | 비용 |`,
      `|---|---|---|---|---|---|---|---|`,
      ...rowsOut.map((x) => `| ${x.edition} | ${x.set} | ${x.humanScore} ${x.human} | ${x.reviewerScore ?? "—"} ${x.verdictPipeline ?? "—"} (${x.llmVerdict ?? "—"}) | ${x.found ?? "—"}/${x.humanErrors ?? "—"} | ${x.falseAlarms ?? "—"}/${x.reviewerErrors ?? "—"} | ${x.wouldAutoPublish ? "예" : "아니오"} | $${x.cost ?? "—"} |`),
      ``,
      `## 놓친 사람 오류 · 거짓 경보 (판별)`,
      ...rowsOut.flatMap((x) => [`### ${x.edition}`, ...((x.missed as string[]) ?? []).map((m) => `- 놓침: ${m}`), ...((x.alarms as string[]) ?? []).map((m) => `- 경보: ${m}`)]),
    ];
    writeFileSync(join(outDir, "CALIBRATION.md"), md.join("\n"));
    console.log(md.slice(0, 30).join("\n"));
  } finally {
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

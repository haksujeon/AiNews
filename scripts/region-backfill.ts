/**
 * 대상 지역 백필 (subject_region / region_tags / region_version). 설계: ~/ainews-reports/region-taxonomy/report.md §6.
 *
 *   npx tsx --env-file=.env.local scripts/region-backfill.ts --rules                 # 1단계: 고신뢰 규칙 (LLM 없음)
 *   npx tsx --env-file=.env.local scripts/region-backfill.ts --llm --cap 0.60        # 2단계: 나머지를 LLM 으로 (비용 상한 USD)
 *   npx tsx --env-file=.env.local scripts/region-backfill.ts --gold <gold.json>      # 금 표본 평가만 (DB 쓰기 없음)
 *   npx tsx --env-file=.env.local scripts/region-backfill.ts --rollback <log.jsonl>  # 이 스크립트가 쓴 값만 되돌린다
 *   npx tsx --env-file=.env.local scripts/region-backfill.ts --rollback-rejudge <run_id>  # 일일 재판정 실행 하나를 되돌린다 (region_rejudge_log)
 *   공통: --log <path>(기본 ~/backups/ainews/2026-11-02-region-backfill.jsonl) --limit N --dry-run --hidden(숨김 기사도)
 *
 * 쓰기 규칙:
 *  - 지역 열(subject_region·region_tags·region_version)만 고친다. 조건: 아직 판정이 없는 행(subject_region IS NULL) — 다시 돌려도 안전하다.
 *  - 기사마다 이전 값·새 값을 JSONL 로 남긴다 → --rollback 이 그 기록으로 되돌린다(그 뒤에 다른 판정이 들어간 행은 건드리지 않는다).
 * 판정은 src/lib/region-judge.ts rejudgeRegions — 일일 재판정 API(/api/internal/region/rejudge)와 같은 함수 (Gate 2).
 * LLM: LiteLLM anthropic-api-haiku-5-5, 사고 기능 끔, temperature 없음, 20건 묶음, 제목 앞 10자 메아리로 정렬 확인
 * (틀린 기사만 최대 2번 다시 묻는다). 비용은 응답 헤더 x-litellm-response-cost 를 더해 상한에서 멈춘다.
 * 수집 시간대(13:45–14:45, 23:45–00:45 UTC)에는 LLM 단계를 시작하지 않는다.
 */
import { appendFileSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import pool from "../src/lib/db";
import { PUBLIC_NEWS_WHERE } from "../src/lib/news-query";
import { REGION_VERSION, normalizeRegion, regionBucketOf, type RegionValue } from "../src/lib/region";
import { inIngestWindow, rejudgeRegions, type JudgeRow, type JudgeUsage } from "../src/lib/region-judge";

// 판정 지시문·묶음 호출·메아리 검사는 src/lib/region-judge.ts 로 옮겼다 — 일일 재판정 API 와 같은 함수 (Gate 2)
export { SYSTEM } from "../src/lib/region-judge";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const has = (name: string) => process.argv.includes(name);

const LOG = arg("--log") ?? `${homedir()}/backups/ainews/2026-11-02-region-backfill.jsonl`;
const DRY = has("--dry-run");
const LIMIT = arg("--limit") ? Number(arg("--limit")) : null;

type Row = JudgeRow;

const progress = (done: number, total: number, u: JudgeUsage, labelled: number) => {
  if (done % 10 === 0) console.log(`  ${done}/${total} batches, $${u.costUsd.toFixed(4)}, ${labelled} labelled`);
};

/** LLM 단계만 (규칙은 이미 --rules 로 썼다). 결과: id → 저장 값 */
async function classify(rows: Row[], cap: number): Promise<{ got: Map<string, RegionValue>; unresolved: string[]; usage: JudgeUsage }> {
  const r = await rejudgeRegions(rows, { rules: false, capUsd: cap, caller: "region-backfill", onProgress: progress, debug: !!process.env.DBG });
  for (const e of r.usage.errors) console.error("batch error:", e);
  return { got: new Map([...r.got].map(([id, v]) => [id, v.value])), unresolved: r.unresolved, usage: r.usage };
}

async function loadTodo(): Promise<Row[]> {
  const where = has("--hidden") ? "is_duplicate = FALSE" : PUBLIC_NEWS_WHERE;
  const { rows } = await pool.query(
    `SELECT id::text, title_kr, title_cn, summary_kr FROM ai_news_ex
      WHERE ${where} AND subject_region IS NULL
      ORDER BY news_date DESC NULLS LAST, id ${LIMIT ? `LIMIT ${Math.floor(LIMIT)}` : ""}`
  );
  return rows as Row[];
}

/** 지역 열만, 아직 판정이 없는 행만 고친다. 기록을 남긴다 */
async function write(id: string, v: RegionValue, version: string, stage: string): Promise<boolean> {
  if (DRY) return true;
  const { rowCount } = await pool.query(
    `UPDATE ai_news_ex SET subject_region = $2, region_tags = $3::text[], region_version = $4
      WHERE id = $1 AND subject_region IS NULL`,
    [id, v.subject_region, v.region_tags, version]
  );
  if (rowCount) {
    appendFileSync(
      LOG,
      JSON.stringify({ ts: new Date().toISOString(), id, stage, before: { subject_region: null, region_tags: [], region_version: null }, after: { ...v, region_version: version } }) + "\n",
      { mode: 0o600 }
    );
  }
  return !!rowCount;
}

async function rules() {
  const todo = await loadTodo();
  let n = 0;
  const dist: Record<string, number> = {};
  const { got } = await rejudgeRegions(todo, { llm: false });
  for (const [id, { value: v }] of got) {
    if (await write(id, v, REGION_VERSION.rule, "rule")) {
      n++;
      dist[v.subject_region] = (dist[v.subject_region] ?? 0) + 1;
    }
  }
  console.log(`rules: ${todo.length} unlabelled → ${n} written${DRY ? " (dry-run)" : ""}`, dist);
}

async function llm() {
  if (inIngestWindow()) throw new Error("수집 시간대(13:45–14:45 / 23:45–00:45 UTC)에는 LLM 단계를 시작하지 않습니다.");
  const cap = Number(arg("--cap") ?? "0.60");
  const todo = await loadTodo();
  console.log(`llm: ${todo.length} unlabelled, cap $${cap}`);
  const { got, unresolved, usage } = await classify(todo, cap);
  let n = 0;
  for (const [id, v] of got) if (await write(id, v, REGION_VERSION.llm, "llm")) n++;
  console.log(`llm: ${n} written${DRY ? " (dry-run)" : ""}, unresolved ${unresolved.length}, calls ${usage.calls}, cost $${usage.costUsd.toFixed(4)}`);
  if (unresolved.length) console.log("unresolved ids (first 20):", unresolved.slice(0, 20).join(","));
}

/** 금 표본: 규칙(고신뢰) → 나머지 LLM. DB 에 쓰지 않는다. 대만 금 라벨은 결정 2 에 따라 CN 으로 접어 비교 */
async function gold(path: string) {
  const g = JSON.parse(readFileSync(path, "utf8")) as { id: string; gold_primary: string; gold_tags?: string[]; ambiguous?: boolean }[];
  const { rows } = await pool.query(`SELECT id::text, title_kr, title_cn, summary_kr FROM ai_news_ex WHERE id = ANY($1::uuid[])`, [g.map((x) => x.id)]);
  const by = new Map((rows as Row[]).map((r) => [r.id, r]));
  const rows2 = g.map((x) => by.get(x.id)).filter((a): a is Row => !!a);
  const { got, usage } = await rejudgeRegions(rows2, { capUsd: Number(arg("--cap") ?? "0.05"), caller: "region-backfill" });
  const pred = new Map<string, { v: RegionValue | null; via: string }>(rows2.map((a) => [a.id, { v: got.get(a.id)?.value ?? null, via: got.get(a.id)?.stage ?? "llm" }]));
  report(g, (id) => pred.get(id) ?? null);
  console.log(`gold llm calls ${usage.calls}, cost $${usage.costUsd.toFixed(4)}`);
}

export function report(
  g: { id: string; gold_primary: string; gold_tags?: string[]; ambiguous?: boolean }[],
  get: (id: string) => { v: RegionValue | null; via: string } | null
) {
  let n = 0, p7 = 0, b3 = 0, amb = 0, ambOk = 0, tp = 0, fp = 0, fn = 0;
  const via: Record<string, [number, number]> = {};
  const misses: string[] = [];
  for (const x of g) {
    const r = get(x.id);
    const gv = normalizeRegion(x.gold_primary, x.gold_tags ?? []);
    if (!gv) continue;
    n++;
    const ok = r?.v?.subject_region === gv.subject_region;
    if (ok) p7++;
    if (regionBucketOf(r?.v?.subject_region) === regionBucketOf(gv.subject_region)) b3++;
    if (!x.ambiguous) { amb++; if (ok) ambOk++; }
    const k = r?.via ?? "none";
    via[k] ??= [0, 0];
    via[k][0]++;
    if (ok) via[k][1]++;
    const pt = new Set(r?.v?.region_tags ?? []);
    const gt = new Set(gv.region_tags);
    for (const t of pt) {
      if (gt.has(t)) tp++;
      else fp++;
    }
    for (const t of gt) if (!pt.has(t)) fn++;
    if (!ok) misses.push(`  [${k}] pred=${r?.v?.subject_region ?? "∅"} gold=${x.gold_primary}${x.ambiguous ? " (모호)" : ""} ${x.id}`);
  }
  const pct = (a: number, b: number) => (b ? ((a / b) * 100).toFixed(1) : "-");
  console.log(`gold n=${n}: primary(7지역) ${pct(p7, n)}%  3버킷(중국/미국/그 밖) ${pct(b3, n)}%  모호 제외 ${pct(ambOk, amb)}% (n=${amb})`);
  console.log(`  tags precision ${pct(tp, tp + fp)}%  recall ${pct(tp, tp + fn)}%`);
  for (const [k, [a, b]] of Object.entries(via)) console.log(`  via ${k}: ${b}/${a} (${pct(b, a)}%)`);
  console.log(misses.join("\n"));
}

/** 기록으로 되돌리기: 이 스크립트가 쓴 값이 그대로 남아 있는 행만 이전 값으로 */
async function rollback(path: string) {
  const lines = readFileSync(path, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
  let n = 0;
  for (const l of lines) {
    if (DRY) { n++; continue; }
    const { rowCount } = await pool.query(
      `UPDATE ai_news_ex SET subject_region = $2, region_tags = $3::text[], region_version = $4
        WHERE id = $1 AND subject_region IS NOT DISTINCT FROM $5 AND region_version IS NOT DISTINCT FROM $6`,
      [l.id, l.before.subject_region, l.before.region_tags, l.before.region_version, l.after.subject_region, l.after.region_version]
    );
    n += rowCount ?? 0;
  }
  console.log(`rollback: ${n}/${lines.length} rows restored${DRY ? " (dry-run)" : ""}`);
}

/** 일일 재판정(region_rejudge_log) 실행 하나 되돌리기: 재판정 값이 그대로 남은 행만 이전 값으로 */
async function rollbackRejudge(runId: string) {
  const { rows } = await pool.query(
    `SELECT article_id::text AS id, old_subject, old_tags, old_version, new_subject, new_tags, new_version FROM region_rejudge_log WHERE run_id = $1 ORDER BY id`,
    [runId]
  );
  let n = 0;
  for (const l of rows as { id: string; old_subject: string | null; old_tags: string[]; old_version: string | null; new_subject: string; new_tags: string[]; new_version: string }[]) {
    if (DRY) { n++; continue; }
    const { rowCount } = await pool.query(
      `UPDATE ai_news_ex SET subject_region = $2, region_tags = $3::text[], region_version = $4
        WHERE id = $1::uuid AND subject_region IS NOT DISTINCT FROM $5 AND region_tags = $6::text[] AND region_version IS NOT DISTINCT FROM $7`,
      [l.id, l.old_subject, l.old_tags, l.old_version, l.new_subject, l.new_tags, l.new_version]
    );
    n += rowCount ?? 0;
  }
  console.log(`rollback-rejudge ${runId}: ${n}/${rows.length} rows restored${DRY ? " (dry-run)" : ""}`);
}

async function main() {
  try {
    if (arg("--rollback-rejudge")) await rollbackRejudge(arg("--rollback-rejudge")!);
    else if (arg("--rollback")) await rollback(arg("--rollback")!);
    else if (arg("--gold")) await gold(arg("--gold")!);
    else {
      if (has("--rules")) await rules();
      if (has("--llm")) await llm();
      if (!has("--rules") && !has("--llm")) console.log("--rules / --llm / --gold / --rollback 중 하나를 주세요.");
    }
  } finally {
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

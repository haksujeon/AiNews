/**
 * 대상 지역 백필 (subject_region / region_tags / region_version). 설계: ~/ainews-reports/region-taxonomy/report.md §6.
 *
 *   npx tsx --env-file=.env.local scripts/region-backfill.ts --rules                 # 1단계: 고신뢰 규칙 (LLM 없음)
 *   npx tsx --env-file=.env.local scripts/region-backfill.ts --llm --cap 0.60        # 2단계: 나머지를 LLM 으로 (비용 상한 USD)
 *   npx tsx --env-file=.env.local scripts/region-backfill.ts --gold <gold.json>      # 금 표본 평가만 (DB 쓰기 없음)
 *   npx tsx --env-file=.env.local scripts/region-backfill.ts --rollback <log.jsonl>  # 이 스크립트가 쓴 값만 되돌린다
 *   공통: --log <path>(기본 ~/backups/ainews/2026-11-02-region-backfill.jsonl) --limit N --dry-run --hidden(숨김 기사도)
 *
 * 쓰기 규칙:
 *  - 지역 열(subject_region·region_tags·region_version)만 고친다. 조건: 아직 판정이 없는 행(subject_region IS NULL) — 다시 돌려도 안전하다.
 *  - 기사마다 이전 값·새 값을 JSONL 로 남긴다 → --rollback 이 그 기록으로 되돌린다(그 뒤에 다른 판정이 들어간 행은 건드리지 않는다).
 * LLM: LiteLLM anthropic-api-haiku-5-5, 사고 기능 끔, temperature 없음, 20건 묶음, 제목 앞 10자 메아리로 정렬 확인
 * (틀린 기사만 최대 2번 다시 묻는다). 비용은 응답 헤더 x-litellm-response-cost 를 더해 상한에서 멈춘다.
 * 수집 시간대(13:45–14:45, 23:45–00:45 UTC)에는 LLM 단계를 시작하지 않는다.
 */
import { appendFileSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import pool from "../src/lib/db";
import { PUBLIC_NEWS_WHERE } from "../src/lib/news-query";
import { REGION_VERSION, highConfidenceRegion, titleEchoMatches, normalizeRegion, regionBucketOf, regionFromLlm, type RegionValue } from "../src/lib/region";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const has = (name: string) => process.argv.includes(name);

const LOG = arg("--log") ?? `${homedir()}/backups/ainews/2026-11-02-region-backfill.jsonl`;
const DRY = has("--dry-run");
const LIMIT = arg("--limit") ? Number(arg("--limit")) : null;
const BASE = process.env.LITELLM_BASE_URL?.replace(/\/+$/, "") || "http://127.0.0.1:4100";
const MODEL = "anthropic-api-haiku-5-5";

// ───────────────────────── 지시문 (보고서 llm.ts v1 + 수정: 국산·국내 = 중국, 대만 기업 목록, 제재 규칙 5)

export const SYSTEM = `당신은 AI 뉴스 기사의 "대상 지역"(어느 나라의 AI 이야기인가)을 판정합니다. 기사는 모두 중국 매체 기사를 한국어로 옮긴 것입니다(매체 국가가 아니라 기사 내용의 주체로 판정).
지역 코드: CN(중국 본토·홍콩·마카오), US(미국), KR(한국), JP(일본), EU(유럽연합·영국·스위스 등 유럽), TW(대만: TSMC·폭스콘/홍하이·UMC·미디어텍·PSMC 등 대만 기업), OTHER(그 밖의 나라: 인도·중동·싱가포르 등), GLOBAL(특정 나라 주체가 없는 일반 기술·산업 분석, 또는 여러 나라가 대등하게 섞인 세계 동향).
규칙:
0. 한국어 번역문의 '국산'·'국내'·'우리나라'는 원문 国产·国内 의 번역이므로 중국(CN)을 뜻합니다. 한국(KR)은 한국 기업·기관·정부·한국 시장이 실제로 나올 때만 씁니다.
1. primary = 제목의 주어(기업·기관·정부·인물)가 속한 나라. 제목에 없으면 요약 첫 문장의 주체.
2. 기업은 본사 국가로 판정: 중국 기업의 해외 사업(TikTok 미국, Shein, 해외 진출)도 CN. 미국 기업의 중국 사업(엔비디아 중국 판매, 애플 중국 매출)은 primary=US, secondary=CN. 자회사는 모회사 국가(딥마인드=US).
3. 주체 기업명이 낯설어도 위안화 금액·중국 도시·중국 대학·중국 증시(A주·커촹반·홍콩 상장)·'국내'(=중국) 맥락이면 CN.
4. 특정 주체 없이 기술 개념·업계 일반론이면 GLOBAL. 단 중국 시장/중국 업계에 대한 분석이면 CN. 주체 국적이 본문에 없으면 추측하지 않습니다.
5. 제재·수출통제·관세 기사는 행위를 당하는 쪽이 primary, 행위를 한 쪽이 secondary 입니다(미국이 중국 기업을 제재 → primary CN, secondary US).
6. secondary = 두 번째로 비중 있는 지역(없으면 NONE).
7. uc(미중 동시) = 미국과 중국이 둘 다 이야기의 중심일 때만 true: 미중 경쟁·비교·수출통제·제재·관세, 또는 미국과 중국 주체가 함께 주인공(예: 중국 모델이 GPT를 앞섬). 단순히 비교 대상으로 한 번 언급되면 false.
출력: 입력 번호마다 한 줄 JSON, 다른 말 없이. {"i":번호,"t":"제목 앞 10글자 그대로","p":"코드","s":"코드 또는 NONE","uc":true/false}`;

const REG = ["CN", "US", "KR", "JP", "EU", "TW", "HK", "OTHER", "GLOBAL"];
const clean = (s: string | null | undefined) => String(s ?? "").replace(/\s+/g, " ").trim();
const norm = (s: string) => s.replace(/[\s'"‘’“”`·…]/g, "");
const head8 = (s: string) => [...norm(s)].slice(0, 8).join("");

interface Row {
  id: string;
  title_kr: string | null;
  title_cn: string | null;
  summary_kr: string | null;
}

interface LlmOut {
  i: number;
  t?: string;
  p?: string;
  s?: string;
  uc?: boolean;
}

let spent = 0;
let calls = 0;

async function callBatch(items: Row[]): Promise<LlmOut[]> {
  const user = items
    .map((x, k) => `${k + 1}. 제목: ${clean(x.title_kr)}${x.title_cn ? `\n   원제목: ${clean(x.title_cn)}` : ""}\n   요약: ${[...clean(x.summary_kr)].slice(0, 300).join("")}`)
    .join("\n");
  const res = await fetch(`${BASE}/v1/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.LITELLM_API_KEY}` },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 3000,
      thinking: { type: "disabled" },
      user: "region-backfill",
      metadata: { tags: ["region-backfill", REGION_VERSION.llm] },
      messages: [
        { role: "system", content: SYSTEM },
        { role: "user", content: user },
      ],
    }),
  });
  calls++;
  const cost = Number(res.headers.get("x-litellm-response-cost") ?? "0");
  if (Number.isFinite(cost)) spent += cost;
  const j = (await res.json()) as { error?: unknown; choices?: { message?: { content?: string } }[] };
  if (!res.ok) {
    const e = j.error as { message?: string } | string | undefined;
    throw new Error(typeof e === "string" ? e : e?.message ?? `HTTP ${res.status}`);
  }
  const text = j.choices?.[0]?.message?.content ?? "";
  const out: LlmOut[] = [];
  for (const m of text.matchAll(/\{[^{}]*\}/g)) {
    try {
      out.push(JSON.parse(m[0]));
    } catch {
      /* 형식이 틀린 줄은 버리고 다시 묻는다 */
    }
  }
  return out;
}

/** 메아리 검사: 정규화 후 메아리 앞 5~8자가 제목 앞부분과 같아야 한다. 번역 찌꺼기 "X → 제목: Y" 는 Y 로도 맞춰 본다 */
function echoOk(o: LlmOut, a: Row): boolean {
  const e = head8(o.t ?? "");
  const t = a.title_kr ?? "";
  const hs = [t, ...(t.includes("제목:") ? [t.split("제목:").pop() ?? ""] : [])].map(head8);
  if (hs.some((h) => h.length > 0 && e.length >= Math.min(5, h.length) && h.startsWith(e))) return true;
  // 모델이 원제목(중국어)을 메아리로 돌려주는 경우 — 원제목과 맞춰 본다
  return titleEchoMatches(o.t, a.title_cn);
}

/** 묶음 판정 + 어긋난 기사만 최대 2번 재질문. 결과: id → 저장 값 */
async function classify(rows: Row[], cap: number): Promise<{ got: Map<string, RegionValue>; unresolved: string[] }> {
  const got = new Map<string, RegionValue>();
  const batches: Row[][] = [];
  for (let k = 0; k < rows.length; k += 20) batches.push(rows.slice(k, k + 20));
  async function run(b: Row[], attempt = 0): Promise<void> {
    if (spent >= cap) return;
    const out = await callBatch(b);
    const bad: Row[] = [];
    b.forEach((a, k) => {
      const o = out.find((x) => x.i === k + 1);
      const v = o && typeof o.p === "string" && REG.includes(o.p.toUpperCase()) && echoOk(o, a) ? regionFromLlm(o) : null;
      if (v) got.set(a.id, v);
      else {
        bad.push(a);
        if (process.env.DBG) console.error("MISS", attempt, JSON.stringify(head8(a.title_kr ?? "")), JSON.stringify(o ?? null));
      }
    });
    if (bad.length && attempt < 2) await run(bad, attempt + 1);
  }
  let idx = 0;
  let done = 0;
  const POOL = 4;
  await Promise.all(
    Array.from({ length: POOL }, async () => {
      while (idx < batches.length && spent < cap) {
        const b = batches[idx++];
        try {
          await run(b);
        } catch (e) {
          console.error("batch error:", (e as Error).message);
        }
        done++;
        if (done % 10 === 0) console.log(`  ${done}/${batches.length} batches, $${spent.toFixed(4)}, ${got.size} labelled`);
      }
    })
  );
  return { got, unresolved: rows.filter((r) => !got.has(r.id)).map((r) => r.id) };
}

function inIngestWindow(now = new Date()): boolean {
  const m = now.getUTCHours() * 60 + now.getUTCMinutes();
  return (m >= 13 * 60 + 45 && m <= 14 * 60 + 45) || m >= 23 * 60 + 45 || m <= 45;
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
  for (const a of todo) {
    const v = highConfidenceRegion(a);
    if (!v) continue;
    if (await write(a.id, v, REGION_VERSION.rule, "rule")) {
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
  const { got, unresolved } = await classify(todo, cap);
  let n = 0;
  for (const [id, v] of got) if (await write(id, v, REGION_VERSION.llm, "llm")) n++;
  console.log(`llm: ${n} written${DRY ? " (dry-run)" : ""}, unresolved ${unresolved.length}, calls ${calls}, cost $${spent.toFixed(4)}`);
  if (unresolved.length) console.log("unresolved ids (first 20):", unresolved.slice(0, 20).join(","));
}

/** 금 표본: 규칙(고신뢰) → 나머지 LLM. DB 에 쓰지 않는다. 대만 금 라벨은 결정 2 에 따라 CN 으로 접어 비교 */
async function gold(path: string) {
  const g = JSON.parse(readFileSync(path, "utf8")) as { id: string; gold_primary: string; gold_tags?: string[]; ambiguous?: boolean }[];
  const { rows } = await pool.query(`SELECT id::text, title_kr, title_cn, summary_kr FROM ai_news_ex WHERE id = ANY($1::uuid[])`, [g.map((x) => x.id)]);
  const by = new Map((rows as Row[]).map((r) => [r.id, r]));
  const pred = new Map<string, { v: RegionValue | null; via: string }>();
  const needLlm: Row[] = [];
  for (const x of g) {
    const a = by.get(x.id);
    if (!a) continue;
    const v = highConfidenceRegion(a);
    if (v) pred.set(x.id, { v, via: "rule" });
    else needLlm.push(a);
  }
  const { got } = await classify(needLlm, Number(arg("--cap") ?? "0.05"));
  for (const a of needLlm) pred.set(a.id, { v: got.get(a.id) ?? null, via: "llm" });
  report(g, (id) => pred.get(id) ?? null);
  console.log(`gold llm calls ${calls}, cost $${spent.toFixed(4)}`);
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

async function main() {
  try {
    if (arg("--rollback")) await rollback(arg("--rollback")!);
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

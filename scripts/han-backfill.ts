/**
 * 공개 기사 한국어 필드의 한자 잔존 백필 (P0-5). 판정은 src/lib/text/han.ts 하나로 한다 (Gate 2).
 *
 *   npx tsx scripts/han-backfill.ts                     # = --dry-run (기본). READ ONLY, LLM 호출 없음, 단계별 건수·예상 비용
 *   npx tsx scripts/han-backfill.ts --dry-run --limit 200 --samples 10
 *   npx tsx scripts/han-backfill.ts --apply [--limit 50] [--stages 2,3] [--fields title_kr,summary_kr]
 *
 * 단계 (필드 단위):
 *  1. 괄호 병기 `위첸(于谦)` 만 남은 필드 — 허용, 고치지 않는다.
 *  2. 괄호 밖 덩어리가 모두 4자 이하이고 사전(han-glossary.ts)과 정확히 같다 — 결정적 치환 (菲尔兹상 → 필즈상).
 *  3. 그 밖(중국어 문장, 사전에 없는 이름) — 그 필드만 LLM 으로 다시 옮긴다 (2단계 치환을 먼저 적용한 값을 넘긴다).
 *     결과를 hanResidue 로 다시 검사하고 숫자 집합·길이가 어긋나면 반영하지 않는다.
 *
 * 안전장치 (--apply):
 *  - 시작 전에 `docker exec aiwork-postgres pg_dump -t ai_news_ex` 를 ~/backups/ainews/ 에 남긴다 (--skip-dump 로 생략).
 *  - 바꾸기 전 값·바꾼 값을 JSONL(~/backups/ainews/han-backfill-<시각>.jsonl)에 먼저 적는다. 되돌리기: scripts/han-restore.ts
 *  - 낙관적 갱신: `WHERE id = $1 AND <필드> IS NOT DISTINCT FROM $old` — 다른 재번역 작업이 그새 바꾼 행은 건너뛴다.
 *  - LLM 비용 상한: HAN_BACKFILL_MAX_COST_USD (기본 2). 넘으면 3단계를 멈춘다.
 *  - 모델: HAN_BACKFILL_MODEL (기본 anthropic-api-haiku-5-5), thinking 끔·temperature 없음 (briefing/llm.ts chat()).
 *
 * 환경변수는 .env.local 등에서 Next 와 같은 방식(@next/env)으로 읽는다.
 */
import { loadEnvConfig } from "@next/env";
import { execFileSync } from "node:child_process";
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/** 고칠 수 있는 필드 (UPDATE 문에 그대로 들어가므로 이 목록만 허용) */
export const HAN_FIELDS = ["title_kr", "summary_kr", "ai_insights_kr", "content_kr"] as const;
type Field = (typeof HAN_FIELDS)[number];
const DEFAULT_FIELDS: Field[] = ["title_kr", "summary_kr", "ai_insights_kr"];

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
}
const flag = (name: string) => process.argv.includes(`--${name}`);

const BACKUP_DIR = join(homedir(), "backups", "ainews");
const stamp = () => new Date().toISOString().replace(/[-:]/g, "").replace(/\..+/, "");

/** 3단계 프롬프트 (시스템). 예상 비용 계산에도 쓴다 */
const SYSTEM = `You fix Korean news text that still contains untranslated Chinese (Han characters).
Rewrite ONLY the Chinese parts into natural Korean:
- Company, product and person names: the usual Korean transliteration or Korean name. You may keep the original in parentheses right after it, e.g. 량원펑(梁文锋).
- Chinese phrases or sentences: translate them into Korean that fits the surrounding text.
Keep everything else exactly as it is: every number and unit, Latin words, quotes, punctuation, sentence order. Do not add, drop or summarize information.
Answer with JSON only: {"text": "<the corrected Korean text>"}`;

/** 숫자 문자열 집합 (쉼표 제거). 3단계 결과 검증용 */
function digitSet(s: string): string {
  return [...new Set((s.match(/\d[\d,.]*/g) ?? []).map((x) => x.replace(/,/g, "").replace(/\.$/, "")))].sort().join("|");
}

interface Row {
  id: string;
  title_cn: string | null;
  [k: string]: string | null;
}

async function main() {
  loadEnvConfig(process.cwd());
  const apply = flag("apply");
  if (apply && flag("dry-run")) throw new Error("--apply 와 --dry-run 은 함께 쓸 수 없다");
  const limit = arg("limit") ? Math.max(1, Number(arg("limit"))) : null;
  const samples = Number(arg("samples") ?? 5);
  const fields = (arg("fields")?.split(",").map((f) => f.trim()) ?? DEFAULT_FIELDS) as Field[];
  for (const f of fields) if (!(HAN_FIELDS as readonly string[]).includes(f)) throw new Error(`허용하지 않는 필드: ${f}`);
  const stages = new Set((arg("stages") ?? "2,3").split(",").map(Number));
  const maxCost = Number(process.env.HAN_BACKFILL_MAX_COST_USD ?? 2);
  process.env.BRIEFING_MODEL = process.env.HAN_BACKFILL_MODEL || "anthropic-api-haiku-5-5";

  // db·llm 은 import 시점에 env 를 읽으므로 동적 import
  const { default: pool } = await import("../src/lib/db");
  const { PUBLIC_NEWS_WHERE } = await import("../src/lib/news-query");
  const { classifyHan, hanResidue, hasHan } = await import("../src/lib/text/han");
  const { HAN_GLOSSARY } = await import("../src/lib/text/han-glossary");
  const { chat, costOf, parseJsonContent, BRIEFING_MODEL } = await import("../src/lib/briefing/llm");

  // 현황은 고치지 않는 content_kr(요지 원본)까지 함께 센다
  const countFields = [...new Set<Field>([...fields, ...HAN_FIELDS])];
  const client = await pool.connect();
  let rows: Row[];
  try {
    await client.query(apply ? "BEGIN" : "BEGIN READ ONLY");
    const res = await client.query(
      `SELECT id, title_cn, ${countFields.join(", ")} FROM ai_news_ex WHERE ${PUBLIC_NEWS_WHERE} ORDER BY news_date DESC, id`
    );
    rows = res.rows as Row[];
    await client.query("COMMIT");
  } finally {
    client.release();
  }
  const total = rows.length;

  type Item = { id: string; field: Field; stage: 2 | 3; old: string; fixed: string; tokens: string[]; replaced: [string, string][]; titleCn: string };
  const census: Record<string, { any_han: number; stage1: number; stage2: number; stage3: number; residue_rows: number }> = {};
  const work: Item[] = [];
  const tokenFreq = new Map<string, number>();
  const s2Repl = new Map<string, number>();
  for (const f of countFields) census[f] = { any_han: 0, stage1: 0, stage2: 0, stage3: 0, residue_rows: 0 };
  const rowsWithResidue = new Set<string>();
  for (const r of rows) {
    for (const f of countFields) {
      const v = r[f];
      if (!v || !hasHan(v)) continue;
      const c = classifyHan(v, HAN_GLOSSARY);
      census[f].any_han++;
      if (c.stage === 1) census[f].stage1++;
      if (c.stage === 2) census[f].stage2++;
      if (c.stage === 3) census[f].stage3++;
      if (c.stage >= 2) {
        census[f].residue_rows++;
        if (fields.includes(f)) rowsWithResidue.add(r.id);
      }
      if (fields.includes(f) && (c.stage === 2 || c.stage === 3)) {
        work.push({ id: r.id, field: f, stage: c.stage, old: v, fixed: c.fixed, tokens: c.tokens, replaced: c.replaced, titleCn: r.title_cn ?? "" });
        for (const t of c.tokens) tokenFreq.set(t, (tokenFreq.get(t) ?? 0) + 1);
        for (const [a, b] of c.replaced) s2Repl.set(`${a} → ${b}`, (s2Repl.get(`${a} → ${b}`) ?? 0) + 1);
      }
    }
  }
  const todo = limit ? work.slice(0, limit) : work;
  const est = todo
    .filter((w) => w.stage === 3)
    .reduce(
      (acc, w) => {
        // 한글·한자는 대략 1글자 ≈ 1토큰으로 넉넉하게 잡는다
        const inTok = SYSTEM.length / 4 + w.fixed.length + w.titleCn.length + 40;
        const outTok = w.fixed.length * 1.1 + 20;
        acc.input += inTok;
        acc.output += outTok;
        return acc;
      },
      { input: 0, output: 0 }
    );
  const summary = {
    at: new Date().toISOString(),
    mode: apply ? "apply" : "dry-run",
    model: BRIEFING_MODEL,
    public_rows: total,
    fields,
    census,
    residue_rate_pct: Object.fromEntries(countFields.map((f) => [f, Math.round((census[f].residue_rows / total) * 10000) / 100])),
    rows_with_residue_in_fields: rowsWithResidue.size,
    work: { total: work.length, stage2: work.filter((w) => w.stage === 2).length, stage3: work.filter((w) => w.stage === 3).length, limited_to: todo.length },
    estimated_llm: {
      calls: todo.filter((w) => w.stage === 3).length,
      input_tokens: Math.round(est.input),
      output_tokens: Math.round(est.output),
      cost_usd: costOf(Math.round(est.input), Math.round(est.output)),
      cap_usd: maxCost,
    },
    stage2_replacements: [...s2Repl.entries()].sort((a, b) => b[1] - a[1]),
    top_tokens: [...tokenFreq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 40),
    samples: {
      // 사람이 눈으로 확인할 수 있게 첫 치환 앞뒤 12자 (조사 맞춤 포함)
      stage2: work
        .filter((w) => w.stage === 2)
        .slice(0, samples)
        .map((w) => {
          const [cn, ko] = w.replaced[0] ?? ["", ""];
          const i = Math.max(0, w.old.indexOf(cn));
          const j = Math.max(0, w.fixed.indexOf(ko, Math.max(0, i - 12)));
          return {
            id: w.id,
            field: w.field,
            replaced: w.replaced,
            before: w.old.slice(Math.max(0, i - 12), i + cn.length + 12),
            after: w.fixed.slice(Math.max(0, j - 12), j + ko.length + 12),
          };
        }),
      stage3: work
        .filter((w) => w.stage === 3)
        .slice(0, samples)
        .map((w) => ({ id: w.id, field: w.field, sentences: hanResidue(w.fixed).sentences.slice(0, 2) })),
    },
  };

  if (!apply) {
    const out = arg("out");
    if (out) writeFileSync(out, JSON.stringify(summary, null, 1));
    console.log(JSON.stringify(summary, null, 1));
    await pool.end();
    return;
  }

  // ───────────── apply
  mkdirSync(BACKUP_DIR, { recursive: true });
  const ts = stamp();
  if (!flag("skip-dump")) {
    const dump = join(BACKUP_DIR, `ai_news_ex-pre-han-backfill-${ts}.sql`);
    const sql = execFileSync("docker", ["exec", "aiwork-postgres", "pg_dump", "-U", "postgres", "-d", "ainews", "-t", "ai_news_ex"], {
      maxBuffer: 1024 * 1024 * 1024,
    });
    writeFileSync(dump, sql);
    console.error(`백업: ${dump} (${sql.length} bytes)`);
  }
  const log = join(BACKUP_DIR, `han-backfill-${ts}.jsonl`);
  console.error(`변경 기록: ${log}  (되돌리기: npx tsx scripts/han-restore.ts ${log} --apply)`);
  const write = (o: Record<string, unknown>) => appendFileSync(log, JSON.stringify({ at: new Date().toISOString(), ...o }) + "\n");

  let spent = 0;
  const counts = { updated: 0, conflict: 0, rejected: 0, skipped_stage: 0, llm_error: 0, cost_cap: 0 };
  for (const w of todo) {
    if (!stages.has(w.stage)) {
      counts.skipped_stage++;
      continue;
    }
    let next = w.fixed;
    if (w.stage === 3) {
      if (spent >= maxCost) {
        counts.cost_cap++;
        continue;
      }
      try {
        const r = await chat(
          {
            system: SYSTEM,
            messages: [{ role: "user", content: JSON.stringify({ field: w.field, text: w.fixed, original_chinese_title: w.titleCn }) }],
            maxTokens: Math.min(8000, Math.ceil(w.fixed.length * 3) + 200),
          },
          (u) => (spent += u.costUsd)
        );
        const parsed = parseJsonContent<{ text?: unknown }>(r.content);
        next = typeof parsed.text === "string" ? parsed.text.trim() : "";
      } catch (e) {
        counts.llm_error++;
        write({ id: w.id, field: w.field, stage: w.stage, status: "llm_error", error: (e as Error).message, old: w.old });
        continue;
      }
    }
    // 재검증: 잔존 없음 + 숫자 집합 동일 + 길이 0.5~2배
    const reasons: string[] = [];
    if (!next) reasons.push("empty");
    if (hanResidue(next).tokens.length) reasons.push(`han_left:${hanResidue(next).tokens.join(",")}`);
    if (digitSet(next) !== digitSet(w.old)) reasons.push("numbers_changed");
    if (next.length < w.old.length * 0.5 || next.length > w.old.length * 2) reasons.push("length");
    if (reasons.length) {
      counts.rejected++;
      write({ id: w.id, field: w.field, stage: w.stage, status: "rejected", reasons, old: w.old, new: next });
      continue;
    }
    write({ id: w.id, field: w.field, stage: w.stage, status: "pending", old: w.old, new: next });
    // 필드 이름은 HAN_FIELDS 화이트리스트를 통과한 값
    const { rowCount } = await pool.query(
      `UPDATE ai_news_ex SET ${w.field} = $2 WHERE id = $1 AND ${w.field} IS NOT DISTINCT FROM $3`,
      [w.id, next, w.old]
    );
    if (rowCount === 1) counts.updated++;
    else counts.conflict++;
    write({ id: w.id, field: w.field, stage: w.stage, status: rowCount === 1 ? "updated" : "conflict", old: w.old, new: next });
  }
  console.log(JSON.stringify({ ...summary, samples: undefined, result: counts, llm_cost_usd: Math.round(spent * 1e6) / 1e6, log }, null, 1));
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

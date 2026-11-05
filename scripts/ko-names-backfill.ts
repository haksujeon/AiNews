/**
 * 이미 저장된 한국어 글의 회사 이름 표기를 한 번 정리한다 (2026-11-05: 월지암면·월지암·문샷 AI·문샷 → 문샷AI).
 * 판정·치환은 src/lib/text/ko-names.ts normalizeKoNames 하나로 한다 (Gate 2 — 생성 단계와 같은 함수).
 *
 *   npx tsx scripts/ko-names-backfill.ts            # 기본 = 미리보기(READ ONLY): 표·필드별 건수와 예시
 *   npx tsx scripts/ko-names-backfill.ts --apply    # 바꾸기 전 값을 JSONL 로 먼저 남기고 바꾼다
 *
 * 대상: ai_news_ex 한국어 필드, daily_briefings(locale=ko) content, briefing_story_context(locale=ko).
 * briefing_reviews 는 감사 기록이라 손대지 않는다. period_metrics 는 다음 계산 때 entities.ts 표기로 다시 만들어진다.
 * 되돌리기: JSONL 의 before 값을 같은 id·필드에 다시 쓴다 (낙관적 갱신이라 그새 바뀐 행은 건너뛴다).
 */
import { loadEnvConfig } from "@next/env";
import { appendFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

type Target = { table: string; key: string; where: string; fields: { name: string; json: boolean }[] };

const TARGETS: Target[] = [
  {
    table: "ai_news_ex",
    key: "id",
    where: "TRUE",
    fields: ["title_kr", "summary_kr", "content_kr", "ai_insights_kr", "ai_insights_detail_kr"].map((name) => ({ name, json: false })),
  },
  { table: "daily_briefings", key: "id", where: "locale = 'ko'", fields: [{ name: "content", json: true }] },
  {
    table: "briefing_story_context",
    key: "article_id || ':' || lens || ':' || locale",
    where: "locale = 'ko'",
    fields: [
      { name: "thread_title", json: false },
      { name: "background", json: false },
      { name: "timeline", json: true },
      { name: "now_text", json: false },
      { name: "caution", json: false },
    ],
  },
];

/** JSON 안의 모든 문자열 값에 같은 함수를 적용한다 (키는 그대로) */
function mapStrings(v: unknown, f: (s: string) => string): unknown {
  if (typeof v === "string") return f(v);
  if (Array.isArray(v)) return v.map((x) => mapStrings(x, f));
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, mapStrings(x, f)]));
  return v;
}

async function main() {
  loadEnvConfig(process.cwd());
  const apply = process.argv.includes("--apply");
  const { default: pool } = await import("../src/lib/db");
  const { normalizeKoNames } = await import("../src/lib/text/ko-names");
  const dir = join(homedir(), "backups", "ainews");
  mkdirSync(dir, { recursive: true });
  const log = join(dir, `ko-names-backfill-${new Date().toISOString().replace(/[-:]/g, "").replace(/\..+/, "")}.jsonl`);
  const hit = "(월지암|문샷)";

  for (const t of TARGETS) {
    for (const f of t.fields) {
      const col = f.json ? `${f.name}::text` : f.name;
      const { rows } = await pool.query(`SELECT ${t.key} AS k, ${f.name} AS v FROM ${t.table} WHERE ${t.where} AND ${col} ~ $1`, [hit]);
      let changed = 0;
      const samples: string[] = [];
      for (const r of rows as { k: string; v: unknown }[]) {
        const after = f.json ? mapStrings(r.v, normalizeKoNames) : normalizeKoNames(String(r.v));
        const before = f.json ? JSON.stringify(r.v) : String(r.v);
        const afterS = f.json ? JSON.stringify(after) : String(after);
        if (afterS === before) continue;
        changed++;
        if (samples.length < 3) {
          const i = before.search(/월지암|문샷/);
          samples.push(`${before.slice(Math.max(0, i - 15), i + 30)}  →  ${afterS.slice(Math.max(0, i - 15), i + 30)}`);
        }
        if (!apply) continue;
        appendFileSync(log, JSON.stringify({ table: t.table, key: r.k, field: f.name, before: r.v, after }) + "\n");
        const val = f.json ? JSON.stringify(after) : after;
        const cast = f.json ? "::jsonb" : "";
        const res = await pool.query(
          `UPDATE ${t.table} SET ${f.name} = $1${cast} WHERE ${t.key} = $2 AND ${col} = $3`,
          [val, r.k, f.json ? (await pool.query(`SELECT ${col} AS s FROM ${t.table} WHERE ${t.key} = $1`, [r.k])).rows[0].s : before]
        );
        if (res.rowCount !== 1) console.log(`  건너뜀 (그새 바뀜) ${t.table} ${r.k} ${f.name}`);
      }
      if (rows.length) console.log(`${t.table}.${f.name}: 걸린 행 ${rows.length} · 바뀔 행 ${changed}${apply ? " (적용)" : ""}`);
      for (const s of samples) console.log(`   ${s.replace(/\s+/g, " ")}`);
    }
  }
  if (apply) console.log(`백업: ${log}`);
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

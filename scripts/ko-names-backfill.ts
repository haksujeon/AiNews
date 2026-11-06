/**
 * 이미 저장된 한국어 글의 회사 이름 표기를 한 번 정리한다 (2026-11-05: 월지암면·월지암·문샷 AI·문샷 → 문샷AI).
 * 판정·치환은 src/lib/text/ko-names.ts normalizeKoNames 하나로 한다 (Gate 2 — 생성 단계와 같은 함수).
 *
 *   npx tsx scripts/ko-names-backfill.ts            # 기본 = 미리보기(READ ONLY): 표·필드별 건수와 예시
 *   npx tsx scripts/ko-names-backfill.ts --apply    # 바꾸기 전 값을 JSONL 로 먼저 남기고 바꾼다
 *
 * 대상: ai_news_ex 한국어 필드·key_terms(한국어 설명), daily_briefings(locale=ko) content, briefing_story_context(locale=ko),
 *       briefing_easy_terms(locale=ko — 용어 이름은 사전 표기로 고정, easy-terms.ts 와 같게).
 * 2026-11-06: 문샷AI 만이 아니라 표기 사전(src/lib/text/ko-glossary.ts)의 모든 고칠 표기로 넓혔다.
 *   --report <파일>: 미리보기 때 바뀌는 곳 전부(앞뒤 문맥)를 그 파일에 남긴다 (사람이 훑어볼 용도, 저장소 밖에 둔다)
 * briefing_reviews 는 감사 기록이라 손대지 않는다. period_metrics 는 다음 계산 때 entities.ts 표기로 다시 만들어진다.
 * 되돌리기: JSONL 의 before 값을 같은 id·필드에 다시 쓴다 (낙관적 갱신이라 그새 바뀐 행은 건너뛴다).
 */
import { loadEnvConfig } from "@next/env";
import { appendFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

type Target = { table: string; key: string; where: string; fields: { name: string; json: boolean; easyTerms?: boolean }[] };

const TARGETS: Target[] = [
  {
    table: "ai_news_ex",
    key: "id",
    where: "TRUE",
    fields: [
      ...["title_kr", "summary_kr", "content_kr", "ai_insights_kr", "ai_insights_detail_kr"].map((name) => ({ name, json: false })),
      { name: "key_terms", json: true },
    ],
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
  { table: "briefing_easy_terms", key: "article_id || ':' || locale", where: "locale = 'ko'", fields: [{ name: "terms", json: true, easyTerms: true }] },
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
  const { normalizeKoNames, normalizeKeyTermsKo } = await import("../src/lib/text/ko-names");
  const { KO_GLOSSARY, glossByZh } = await import("../src/lib/text/ko-glossary");
  const reportPath = (() => {
    const i = process.argv.indexOf("--report");
    return i > 0 ? process.argv[i + 1] : undefined;
  })();
  const report: string[] = [];
  /** 쉬운 AI 설명 한 줄: 문자열은 같은 함수로, 이름은 사전 표기로 (easy-terms.ts checkEasyTerms 와 같게) */
  const easyRow = (v: unknown) =>
    Array.isArray(v)
      ? v.map((t) => {
          const x = mapStrings(t, normalizeKoNames) as Record<string, unknown>;
          const g = typeof x.term === "string" ? glossByZh(x.term) : undefined;
          return g ? { ...x, name: g.ko } : x;
        })
      : v;
  // key_terms 는 한국어 설명(explanation_kr)만 — 영어·중국어 설명과 원어는 건드리지 않는다
  const keyTermsRow = (v: unknown) => normalizeKeyTermsKo(v);
  const dir = join(homedir(), "backups", "ainews");
  mkdirSync(dir, { recursive: true });
  const log = join(dir, `ko-names-backfill-${new Date().toISOString().replace(/[-:]/g, "").replace(/\..+/, "")}.jsonl`);
  // 걸러 볼 행: 사전의 고칠 표기 + 문맥 규칙(구현형·체화·문심·혼원) + 쉬운 AI 설명은 사전 용어가 있는 행 전부(이름 고정)
  const reEsc = (x: string) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/ /g, " ?");
  const hit = [...KO_GLOSSARY.flatMap((e) => e.fix ?? []).map(reEsc), "구현형", "체화 ?로봇", "문심 ?[0-9]", "혼원 ?[0-9]"].join("|");
  const termHit = KO_GLOSSARY.flatMap((e) => e.zh).map(reEsc).join("|");

  for (const t of TARGETS) {
    for (const f of t.fields) {
      const col = f.json ? `${f.name}::text` : f.name;
      const { rows } = await pool.query(`SELECT ${t.key} AS k, ${f.name} AS v FROM ${t.table} WHERE ${t.where} AND ${col} ~ $1`, [f.easyTerms ? `${hit}|${termHit}` : hit]);
      let changed = 0;
      const samples: string[] = [];
      for (const r of rows as { k: string; v: unknown }[]) {
        const after = f.easyTerms ? easyRow(r.v) : f.name === "key_terms" ? keyTermsRow(r.v) : f.json ? mapStrings(r.v, normalizeKoNames) : normalizeKoNames(String(r.v));
        const before = f.json ? JSON.stringify(r.v) : String(r.v);
        const afterS = f.json ? JSON.stringify(after) : String(after);
        if (afterS === before) continue;
        changed++;
        // 처음 달라지는 곳 앞뒤 (미리보기·보고서)
        let i = 0;
        while (i < before.length && before[i] === afterS[i]) i++;
        const ctx = `${before.slice(Math.max(0, i - 15), i + 30)}  →  ${afterS.slice(Math.max(0, i - 15), i + 30)}`.replace(/\s+/g, " ");
        if (samples.length < 3) samples.push(ctx);
        if (reportPath) report.push(`${t.table}.${f.name}\t${r.k}\t${ctx}`);
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
  if (reportPath) {
    const { writeFileSync } = await import("node:fs");
    writeFileSync(reportPath, report.join("\n") + "\n");
    console.log(`보고서: ${reportPath} (${report.length}줄)`);
  }
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

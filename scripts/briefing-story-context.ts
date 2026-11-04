/**
 * 히스토리 분석(회사·관련 주제 흐름) 만들기 CLI — src/lib/briefing/story-run.ts ensureStoryContext.
 * 예약: crontab 40 17 * * * / 0 19 * * * / 30 20 * * * (UTC = 02:40·04:00·05:30 KST, 판 발행 뒤·메일 07:00 전·수집 시간 밖)
 *
 *   npx tsx scripts/briefing-story-context.ts [--date 2026-11-03] [--dry] [--force]
 *     - 그 날짜(없으면 최신)의 발행 ko 데일리 판 주요 기사 중 아직 없는 관점만 ko 생성 → 검사 → 저장, 그다음 zh·en 번역 → 검사 → 저장
 *     - --dry: 저장·기록 없이 결과만 출력 / --force: "이미 시도함" 기록 무시 (이미 저장된 행은 여전히 건너뛴다)
 */
import { loadEnvConfig } from "@next/env";

const arg = (k: string) => {
  const i = process.argv.indexOf(`--${k}`);
  return i > 0 ? process.argv[i + 1] : undefined;
};

async function main() {
  loadEnvConfig(process.cwd());
  const pool = (await import("../src/lib/db")).default;
  const { ensureStoryContext } = await import("../src/lib/briefing/story-run");
  const dry = process.argv.includes("--dry");
  try {
    const r = await ensureStoryContext({ date: arg("date"), dry, force: process.argv.includes("--force"), log: (s) => console.log("  " + s) });
    console.log(`${new Date().toISOString()} 판 ${r.date ?? "-"} ${r.status}: ${r.detail} · 비용 $${r.costUsd.toFixed(4)}`);
    for (const p of r.problems) console.log(`  뺀 것  ${p}`);
    for (const e of r.errors) console.log(`  오류   ${e}`);
    if (dry)
      for (const row of r.rows ?? []) {
        console.log(`\n[${row.locale}] ${row.lens} ${row.article_id.slice(0, 8)} · ${row.thread_title}\n  ${row.background}`);
        for (const t of row.timeline) console.log(`  ${t.date} ${t.text}  (${t.refs.map((x) => x.source).join(", ")})`);
        console.log(`  ◆ ${row.now_text}${row.caution ? `\n  ※ ${row.caution}` : ""}`);
      }
    if (r.status === "error") process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

/**
 * "쉬운 AI 설명" 만들기 CLI — 발행 뒤 자동 생성(관리자 발행·AI 검토 자동 발행·스윕 따라잡기)과 같은 ensureEasyTerms 를 부른다.
 *
 *   npx tsx scripts/briefing-easy-terms.ts [--date 2026-11-02] [--dry] [--force]
 *     - 그 날짜(없으면 최신)의 발행 ko 데일리 판 주요 기사 중 아직 용어가 없는 기사만 → Sonnet 1회(3개 언어) → 코드 검사 → 저장
 *     - --dry: 저장·기록하지 않고 결과만 출력 (사람이 읽고 확인)
 *     - --force: "이 판은 이미 시도함" 기록을 무시 (이미 저장된 기사는 여전히 건너뛴다 — 다시 만들려면 그 행을 먼저 지운다)
 */
import { loadEnvConfig } from "@next/env";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  loadEnvConfig(process.cwd());
  const pool = (await import("../src/lib/db")).default;
  const { ensureEasyTerms } = await import("../src/lib/briefing/easy-terms-run");
  try {
    const r = await ensureEasyTerms({ date: arg("date"), dry: process.argv.includes("--dry"), force: process.argv.includes("--force") });
    console.log(`${r.date ?? "-"} ${r.status}: ${r.detail}`);
    for (const s of r.inputs ?? []) {
      const b = r.byArticle?.get(s.articleId);
      console.log(`\n#${s.rank} ${s.title}`);
      if (!b) {
        console.log("  (상자 없음)");
        continue;
      }
      for (const [j, k] of b.ko.entries())
        console.log(`  - ${k.name} (${k.term}, ${k.pinyin})\n    ko: ${k.easy}\n    en: ${b.en[j].name} — ${b.en[j].easy}\n    zh: ${b.zh[j].name} — ${b.zh[j].easy}`);
    }
    if (r.problems.length) console.log(`\n검사에서 뺀 것:\n${r.problems.map((p) => `  ${p.story} ${p.term ?? ""}: ${p.reason}`).join("\n")}`);
    console.log(`\n비용 $${r.costUsd.toFixed(4)} · 저장 ${r.saved}행`);
  } finally {
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

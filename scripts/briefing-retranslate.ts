/**
 * 데일리 ko 판의 en/zh 를 다시 번역한다 (실패한 언어만). 생성·AI 검토와 같은 translateBriefing(번역 모델 → 실패 시 재시도 모델)·재검증.
 *
 *   npx tsx scripts/briefing-retranslate.ts --date 2026-10-28 [--locales en,zh] [--all]
 *     - 그 날짜의 최신 ko draft 를 원본으로, 그 ko 에서 나온 최신 en/zh 가 draft 가 아니면 다시 번역 (--all 이면 둘 다)
 *     - 저장: 새 버전 행 (status draft/failed, source_briefing_id = ko id). 발행은 관리자 화면에서
 */
import { loadEnvConfig } from "@next/env";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  loadEnvConfig(process.cwd());
  const date = arg("date");
  if (!date) throw new Error("--date 필요");
  const pool = (await import("../src/lib/db")).default;
  const { loadReviewInput } = await import("../src/lib/briefing/review/evidence");
  const { retranslate } = await import("../src/lib/briefing/review/retranslate");
  const { saveTranslationsDb } = await import("../src/lib/briefing/review/pipeline");
  const { TRANSLATE_PROMPT_VERSION } = await import("../src/lib/briefing/prompt");
  try {
    const { rows } = await pool.query(
      `SELECT id, version FROM daily_briefings WHERE edition_type = 'daily' AND locale = 'ko' AND edition_date = $1::date AND status = 'draft' ORDER BY version DESC LIMIT 1`,
      [date]
    );
    if (!rows[0]) throw new Error(`${date} ko draft 없음`);
    const koId = rows[0].id as string;
    const { rows: trs } = await pool.query(
      `SELECT DISTINCT ON (locale) locale, status FROM daily_briefings WHERE source_briefing_id = $1::uuid ORDER BY locale, version DESC`,
      [koId]
    );
    const status = new Map(trs.map((r) => [r.locale as string, r.status as string]));
    const want = (arg("locales")?.split(",") ?? ["en", "zh"]).filter((l): l is "en" | "zh" => l === "en" || l === "zh");
    const locales = process.argv.includes("--all") ? want : want.filter((l) => status.get(l) !== "draft");
    if (!locales.length) {
      console.log(`${date} ko v${rows[0].version}: 다시 번역할 언어 없음 (${JSON.stringify(Object.fromEntries(status))})`);
      return;
    }
    const input = await loadReviewInput(koId, { includeTranslations: false });
    const res = await retranslate(input.row.content, input.candidateArticles, () => {}, undefined, locales);
    await saveTranslationsDb(koId, input, res, TRANSLATE_PROMPT_VERSION);
    for (const r of res)
      console.log(`${date} ${r.locale}: ${r.content ? "draft" : "failed"} 모델 ${r.usages.map((u) => u.model.replace("anthropic-api-", "")).join("→")} $${r.usages.reduce((s, u) => s + u.costUsd, 0).toFixed(4)}${r.problems.length ? ` 문제: ${r.problems.join(" | ").slice(0, 300)}` : ""}`);
  } finally {
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

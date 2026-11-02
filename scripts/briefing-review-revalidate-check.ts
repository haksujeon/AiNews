/**
 * 저장된 판을 AI 검토 수정 경로와 같은 재검증(evidence.revalidate)으로 돌려 치명 수를 본다 (LLM 없음, 읽기만).
 *   npx tsx scripts/briefing-review-revalidate-check.ts <briefing-id> [...]
 * 수정 루프는 "원본에 이미 있던 치명"을 빼고 새로 생긴 치명만 보므로, 여기 숫자가 0 이 아니어도 수정은 가능하다.
 */
import { loadEnvConfig } from "@next/env";

async function main() {
  loadEnvConfig(process.cwd());
  const { loadReviewInput } = await import("../src/lib/briefing/review/evidence");
  const pool = (await import("../src/lib/db")).default;
  try {
    for (const id of process.argv.slice(2)) {
      const input = await loadReviewInput(id, { includeTranslations: false });
      const r = input.revalidate(input.row.content);
      console.log(JSON.stringify({ id, type: input.editionType, version: input.row.version, fatal: r.fatal.map((f) => `${f.path} ${f.rule}`), warn: r.warn.length }));
    }
  } finally {
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

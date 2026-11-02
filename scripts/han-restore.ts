/**
 * han-backfill 되돌리기. 변경 기록(JSONL)의 status=updated·pending 줄을 거꾸로 적용한다.
 *
 *   npx tsx scripts/han-restore.ts ~/backups/ainews/han-backfill-<시각>.jsonl          # 미리보기 (기본)
 *   npx tsx scripts/han-restore.ts ~/backups/ainews/han-backfill-<시각>.jsonl --apply
 *
 * 낙관적 갱신: 지금 값이 백필이 쓴 값(new)과 같을 때만 old 로 돌린다. 그 뒤 다른 작업이 바꾼 행은 건드리지 않고 conflict 로 센다.
 */
import { loadEnvConfig } from "@next/env";
import { readFileSync } from "node:fs";

const FIELDS = new Set(["title_kr", "summary_kr", "ai_insights_kr", "content_kr"]);

async function main() {
  loadEnvConfig(process.cwd());
  const file = process.argv[2];
  if (!file || file.startsWith("--")) throw new Error("JSONL 경로가 필요하다");
  const apply = process.argv.includes("--apply");
  const { default: pool } = await import("../src/lib/db");
  const lines = readFileSync(file, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l) as { id: string; field: string; status: string; old: string | null; new: string });
  // pending = UPDATE 직전에 적은 줄. 갱신 뒤 updated 를 적기 전에 멈췄을 수 있으므로 함께 되돌린다
  // (지금 값이 new 와 같을 때만 바꾸므로 실제로 갱신되지 않은 행은 conflict 로 남을 뿐 안전하다)
  const seen = new Set<string>();
  const updated = lines.filter((l) => {
    if (l.status !== "updated" && l.status !== "pending") return false;
    const k = `${l.id}|${l.field}|${l.new}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  const counts = { candidates: updated.length, restored: 0, conflict: 0 };
  for (const l of updated.reverse()) {
    if (!FIELDS.has(l.field)) throw new Error(`허용하지 않는 필드: ${l.field}`);
    if (!apply) continue;
    const { rowCount } = await pool.query(
      `UPDATE ai_news_ex SET ${l.field} = $2 WHERE id = $1 AND ${l.field} IS NOT DISTINCT FROM $3`,
      [l.id, l.old, l.new]
    );
    if (rowCount === 1) counts.restored++;
    else counts.conflict++;
  }
  console.log(JSON.stringify({ mode: apply ? "apply" : "preview", ...counts }));
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

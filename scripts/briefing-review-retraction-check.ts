/**
 * 메모 자체 철회 규칙(schema.ts RETRACTION_RE) 점검 — 저장된 보정 검토의 오류 주장 중 이 규칙이 correct 로 내리는 것을 모두 나열하고,
 * 그것이 사람 감사 오류와 맞물리는지(= 규칙이 진짜 오류를 지우는지) 본다. LLM 호출 없음.
 *   npx tsx scripts/briefing-review-retraction-check.ts --audit-dir ~/ainews-reports/briefing-qa-2026-11-02
 */
import { loadEnvConfig } from "@next/env";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

async function main() {
  loadEnvConfig(process.cwd());
  const i = process.argv.indexOf("--audit-dir");
  const dir = process.argv[i + 1];
  const pool = (await import("../src/lib/db")).default;
  const { RETRACTION_RE } = await import("../src/lib/briefing/review/schema");
  const { compareEdition } = await import("../src/lib/briefing/review/calibrate");
  const human = new Map<string, { path: string; claim: string; label: string }[]>();
  for (const sub of ["", "v2"])
    for (const f of readdirSync(join(dir, sub)).filter((x) => /^(daily|weekly|monthly)_.*\.json$/.test(x))) {
      const j = JSON.parse(readFileSync(join(dir, sub, f), "utf8"));
      human.set(j.id, j.claims ?? []);
    }
  try {
    const { rows } = await pool.query(`SELECT briefing_id, prompt_version, claims FROM briefing_reviews WHERE trigger = 'calibration' AND status = 'done'`);
    let n = 0;
    let hits = 0;
    for (const r of rows) {
      const claims = (r.claims ?? []) as import("../src/lib/briefing/review/types").ReviewClaim[];
      // 저장 전에 이미 철회된 것(note 에 [철회: ...])도 원래 라벨로 되돌려 본다
      const orig = claims.map((c) => {
        const m = /^\[철회: 원래 ([a-z-]+)\]/.exec(c.note ?? "");
        return m ? { ...c, label: m[1] as typeof c.label } : c;
      });
      const down = orig.filter((c) => c.label !== "correct" && RETRACTION_RE.test(c.note ?? ""));
      if (!down.length) continue;
      const cmp = compareEdition("x", human.get(r.briefing_id) ?? [], orig);
      for (const d of down) {
        n++;
        const matched = cmp.reviewerErrors.find((x) => x.claim === d)?.matched ?? false;
        if (matched) hits++;
        console.log(`${r.prompt_version} ${d.path} ${d.label} 사람오류항목=${matched ? "예" : "아니오"} :: ${d.note.slice(0, 120)}`);
      }
    }
    console.log(`철회 ${n}건, 사람 오류 항목과 겹침 ${hits}건`);
  } finally {
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

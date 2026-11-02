/**
 * 데일리 브리핑 CLI — API 와 같은 generateBriefing / publishBriefing 을 부른다 (로직은 src/lib/briefing 하나).
 *
 *   npx tsx scripts/briefing-generate.ts [--date 2026-10-13] [--force] [--dry-run]
 *   npx tsx scripts/briefing-generate.ts publish --date 2026-10-13 [--version 2]
 *   npx tsx scripts/briefing-generate.ts withdraw --date 2026-10-13 [--locale en]
 *   npx tsx scripts/briefing-generate.ts weekly [--week 2026-W44] [--force] [--dry-run]
 *     (주간 리포트 초안. --week 없으면 베이징 기준 지난주. 수집 미완 날짜가 있으면 --force 가 있어야 만든다.
 *      발행은 관리자 화면에서 데이터 알림을 확인한 뒤 한다)
 *
 * 환경변수는 .env.local 등에서 Next 와 같은 방식(@next/env)으로 읽는다.
 */
import { loadEnvConfig } from "@next/env";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
}
const flag = (name: string) => process.argv.includes(`--${name}`);

async function main() {
  loadEnvConfig(process.cwd());
  // db 풀이 import 시점에 DATABASE_URL 을 읽으므로 env 를 먼저 올린 뒤 동적 import
  const { generateBriefing } = await import("../src/lib/briefing/generate");
  const { publishBriefing, withdrawBriefing } = await import("../src/lib/briefing/publish");
  const { generateWeekly } = await import("../src/lib/briefing/periodic/generate");
  const { default: pool } = await import("../src/lib/db");

  const cmd = process.argv[2] && !process.argv[2].startsWith("--") ? process.argv[2] : "generate";
  const date = arg("date");
  try {
    if (cmd === "publish") {
      if (!date) throw new Error("--date 필요");
      const v = arg("version");
      console.log(JSON.stringify(await publishBriefing({ date, version: v ? Number(v) : undefined, editedBy: "cli" }), null, 2));
    } else if (cmd === "withdraw") {
      if (!date) throw new Error("--date 필요");
      const locale = arg("locale") as "ko" | "en" | "zh" | undefined;
      console.log(JSON.stringify({ withdrawn: await withdrawBriefing({ date, locale, editedBy: "cli" }) }));
    } else if (cmd === "weekly") {
      const result = await generateWeekly({ isoWeek: arg("week"), force: flag("force"), dryRun: flag("dry-run") });
      console.log(JSON.stringify(result, null, 2));
      if (["failed", "invalid_week", "blocked_data_quality", "locked"].includes(result.outcome)) process.exitCode = 1;
    } else if (cmd === "generate") {
      const result = await generateBriefing({ date, force: flag("force"), dryRun: flag("dry-run") });
      console.log(JSON.stringify(result, null, 2));
      if (result.outcome === "failed") process.exitCode = 1;
    } else {
      throw new Error(`알 수 없는 명령: ${cmd}`);
    }
  } finally {
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});

/**
 * 데일리 브리핑 CLI — API 와 같은 generateBriefing / publishBriefing 을 부른다 (로직은 src/lib/briefing 하나).
 *
 *   npx tsx scripts/briefing-generate.ts [--date 2026-10-13] [--force] [--dry-run] [--exclude <uuid,uuid>]  (--exclude: 모델이 거부한 기사 빼기, 판에 기록돼 재생성도 따름)
 *   npx tsx scripts/briefing-generate.ts publish --date 2026-10-13 [--version 2]
 *   npx tsx scripts/briefing-generate.ts withdraw --date 2026-10-13 --reason "공개 철회 사유" [--locale en]
 *   npx tsx scripts/briefing-generate.ts                    (날짜 없음 = n8n 과 같은 정기 일정: 월~금 오늘, 일요일 = 토요일 합본, 토요일 = 건너뜀.
 *                                                            일요일 날짜는 --force 로도 건너뜀 — 토요일 판이 토·일 합본. 꼭 필요하면 --sunday)
 *   npx tsx scripts/briefing-generate.ts weekly [--week 2026-W44] [--force] [--dry-run]
 *     (주간 리포트 초안. --week 없으면 베이징 기준 지난주. 수집 미완 날짜가 있으면 --force 가 있어야 만든다.
 *      발행은 관리자 화면에서 데이터 알림을 확인한 뒤 한다)
 *   npx tsx scripts/briefing-generate.ts monthly [--month 2026-10] [--force] [--dry-run]
 *     (월간 리포트 초안. --month 없으면 베이징 기준 지난달. 주간과 같은 generatePeriodic 을 쓴다)
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
  const { generateWeekly, generateMonthly } = await import("../src/lib/briefing/periodic/generate");
  const { default: pool } = await import("../src/lib/db");

  const cmd = process.argv[2] && !process.argv[2].startsWith("--") ? process.argv[2] : "generate";
  const date = arg("date");
  try {
    if (cmd === "publish") {
      if (!date) throw new Error("--date 필요");
      const v = arg("version");
      const result = await publishBriefing({ date, version: v ? Number(v) : undefined, editedBy: "cli" });
      console.log(JSON.stringify(result, null, 2));
      // 관리자 발행(api/admin/briefing/publish)·AI 검토 자동 발행과 같은 뒤처리: 데일리 ko 를 발행했으면 "쉬운 AI 설명" (2026-11-06: CLI 발행만 빠져 11-05판에 없었음)
      if (result.published.some((p) => p.locale === "ko")) {
        const { ensureEasyTerms, easyRunNote } = await import("../src/lib/briefing/easy-terms-run");
        const note = await ensureEasyTerms({ date })
          .then((r) => easyRunNote(r) || r.detail)
          .catch((e: unknown) => `쉬운 AI 설명 실패: ${e instanceof Error ? e.message : String(e)}`);
        console.log(`쉬운 AI 설명: ${note}`);
      }
    } else if (cmd === "translate-periodic") {
      // 발행된 주간·월간 ko 판의 영어·중국어판 (관리자 발행·AI 검토 자동 발행과 같은 함수). --id <ko briefing id> 또는 --type weekly|monthly --date <시작일>
      const { ensurePeriodicTranslations, ensurePeriodicTranslationsFor } = await import("../src/lib/briefing/periodic/translate-run");
      const id = arg("id");
      const type = arg("type") as "weekly" | "monthly" | undefined;
      const r = id ? await ensurePeriodicTranslations(id) : type && date ? await ensurePeriodicTranslationsFor(type, date) : null;
      if (!r) throw new Error("--id 또는 --type weekly|monthly --date 필요");
      console.log(JSON.stringify(r, null, 2));
    } else if (cmd === "withdraw") {
      if (!date) throw new Error("--date 필요");
      const reason = arg("reason");
      if (!reason) throw new Error("--reason 필요 (공개 정정 기록에 남는 철회 사유)");
      const locale = arg("locale") as "ko" | "en" | "zh" | undefined;
      console.log(JSON.stringify({ withdrawn: await withdrawBriefing({ date, reason, locale, editedBy: "cli" }) }));
    } else if (cmd === "weekly") {
      const result = await generateWeekly({ isoWeek: arg("week"), force: flag("force"), dryRun: flag("dry-run") });
      console.log(JSON.stringify(result, null, 2));
      if (["failed", "invalid_week", "blocked_data_quality", "locked"].includes(result.outcome)) process.exitCode = 1;
    } else if (cmd === "monthly") {
      const result = await generateMonthly({ month: arg("month"), force: flag("force"), dryRun: flag("dry-run") });
      console.log(JSON.stringify(result, null, 2));
      if (["failed", "invalid_period", "blocked_data_quality", "blocked_weeklies", "locked"].includes(result.outcome)) process.exitCode = 1;
    } else if (cmd === "generate") {
      // --exclude uuid,uuid : 후보에서 뺄 기사 (모델 거부 대응, 판에 기록돼 이후 재생성도 따른다). --exclude "" 는 제외 해제
      const ex = process.argv.includes("--exclude") ? (arg("exclude") ?? "").split(",").map((s) => s.trim()).filter(Boolean) : undefined;
      const result = await generateBriefing({ date, force: flag("force"), dryRun: flag("dry-run"), sunday: flag("sunday"), excludeArticleIds: ex });
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

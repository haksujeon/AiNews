/**
 * 구독자 아침 메일 보내기 CLI (src/lib/newsletter/send.ts). 예약: crontab 0 22 * * * / 10 0 * * * (UTC = 07:00·09:10 KST)
 *
 *   npx tsx scripts/newsletter-send.ts --dry                    # 누구에게 어떤 판이 갈지만 (발송·기록 없음)
 *   npx tsx scripts/newsletter-send.ts [--only a@b.c] [--date 2026-11-03]
 *   npx tsx scripts/newsletter-send.ts --test-to a@b.c --locale zh [--date …]   # 시험 1통 (기록 없음, 수신 거부 링크는 보기용)
 */
import { loadEnvConfig } from "@next/env";

const arg = (k: string) => {
  const i = process.argv.indexOf(`--${k}`);
  return i > 0 ? process.argv[i + 1] : undefined;
};

async function main() {
  loadEnvConfig(process.cwd());
  process.env.NEXT_PUBLIC_BASE_PATH ??= "/ainews"; // next.config.ts basePath 와 같은 값 (앱 밖이라 빌드 값이 없다)
  const pool = (await import("../src/lib/db")).default;
  const { sendDailyNewsletter, buildMail } = await import("../src/lib/newsletter/send");
  const { getPublishedBriefing } = await import("../src/lib/briefing/public");
  const { currentEdition } = await import("../src/lib/briefing/sla");
  const { getTransport } = await import("../src/lib/newsletter/transport");
  try {
    const testTo = arg("test-to");
    if (testTo) {
      const locale = (arg("locale") ?? "ko") as "ko" | "en" | "zh";
      const date = arg("date") ?? currentEdition(new Date());
      const b = await getPublishedBriefing(locale, date);
      if (!b) throw new Error(`${date} ${locale} 발행본 없음`);
      const m = buildMail(b, { id: "00000000-0000-4000-8000-000000000000", name: arg("name") ?? null, email: testTo, language: locale });
      const tr = getTransport();
      const r = await tr.send({ to: testTo, subject: `[시험] ${m.subject}`, html: m.html, text: m.text, headers: m.headers });
      console.log(`시험 발송 ${testTo} ${locale} ${date} · ${tr.name} · ${r.messageId}`);
      return;
    }
    const rep = await sendDailyNewsletter({ dry: process.argv.includes("--dry"), only: arg("only"), date: arg("date") });
    console.log(`${new Date().toISOString()} 판 ${rep.edition}`);
    for (const r of rep.results) console.log(`  ${r.outcome.padEnd(10)} ${r.locale} ${r.email}${r.subject ? ` · ${r.subject}` : ""}${r.error ? ` · ${r.error}` : ""}`);
    if (!rep.results.length) console.log("  (받을 구독자 없음)");
    if (rep.results.some((r) => r.outcome === "failed")) process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

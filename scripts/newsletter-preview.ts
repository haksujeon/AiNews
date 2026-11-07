/**
 * 구독자 아침 메일 시안 미리보기 — 발행된 데일리 판(getPublishedBriefing)으로 HTML 파일만 만든다. 발송 없음.
 *   npx tsx scripts/newsletter-preview.ts --out <dir> [--date 2026-11-03]
 */
import { loadEnvConfig } from "@next/env";
import { writeFileSync } from "node:fs";

const arg = (k: string) => {
  const i = process.argv.indexOf(`--${k}`);
  return i > 0 ? process.argv[i + 1] : undefined;
};

async function main() {
  loadEnvConfig(process.cwd());
  process.env.NEXT_PUBLIC_BASE_PATH ??= "/ainews"; // next.config.ts basePath 와 같은 값 (앱 밖이라 빌드 값이 없다)
  const pool = (await import("../src/lib/db")).default;
  const { loadMailEdition } = await import("../src/lib/newsletter/send");
  const { renderDailyEmail } = await import("../src/lib/newsletter/daily-email");
  const out = arg("out") ?? ".";
  try {
    for (const [locale, name, email] of [["ko", "홍길동", "subscriber@example.com"], ["zh", "张三", "subscriber2@example.com"]] as const) {
      // 발송과 같은 판 한 벌 (send.ts loadMailEdition: 금액 환산 + 한눈에 보기 명세)
      const ed = await loadMailEdition(locale, arg("date"));
      if (!ed) { console.log(locale, "발행본 없음"); continue; }
      const b = ed.b;
      const m = renderDailyEmail(b, { name, email, unsubscribeUrl: "https://news.aibaseclub.com/ainews/unsubscribe?t=SAMPLE", cardSpec: ed.cardSpec });
      writeFileSync(`${out}/mail-${locale}.html`, m.html);
      console.log(locale, b.edition_date, "|", m.subject, "|", m.html.length, "bytes | easy", b.content.top_stories.filter((s) => s.easy_terms?.length).length, "story", b.content.top_stories.filter((s) => s.story_context?.length).length);
    }
  } finally { await pool.end(); }
}
main().catch((e) => { console.error(e); process.exit(1); });

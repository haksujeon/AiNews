/**
 * 브리핑 음성·카드 등록·승인 (briefing_media). 관리 화면이 생기기 전까지 이 스크립트로 한다.
 *
 *   npx tsx scripts/briefing-media.ts list [--date 2026-11-04]
 *   npx tsx scripts/briefing-media.ts add --date 2026-11-04 --locale ko --kind audio --file brief.mp3 \
 *        --source notebooklm-brief [--transcript brief.txt]
 *   npx tsx scripts/briefing-media.ts add --date 2026-11-04 --locale ko --kind card --file card.png --source card-v1
 *   npx tsx scripts/briefing-media.ts approve|reject|review --date 2026-11-04 --locale ko --kind audio [--note "…"]
 *
 * add 는 언제나 검토 중(review)으로 넣는다 — 공개 화면에는 승인(approve)한 뒤에만 보인다. 관리자 검토 화면에서는 바로 보인다.
 * 등록은 src/lib/briefing/media-register.ts registerMedia (자동 카드 scripts/briefing-card.ts 와 같은 함수).
 */
import { loadEnvConfig } from "@next/env";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
}
function need(name: string): string {
  const v = arg(name);
  if (!v) throw new Error(`--${name} 가 필요합니다`);
  return v;
}

async function main() {
  loadEnvConfig(process.cwd());
  const cmd = process.argv[2];
  const { default: pool } = await import("../src/lib/db");
  try {
    if (cmd === "list") {
      const date = arg("date");
      const { rows } = await pool.query(
        `SELECT to_char(edition_date,'YYYY-MM-DD') d, locale, kind, status, source, path, bytes, duration_sec, jsonb_array_length(chapters) ch, note
           FROM briefing_media WHERE ($1::date IS NULL OR edition_date = $1::date) ORDER BY edition_date DESC, locale, kind`,
        [date ?? null]
      );
      console.table(rows);
      return;
    }

    const date = need("date");
    const locale = need("locale");
    const kind = need("kind") as "audio" | "card";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !["ko", "en", "zh"].includes(locale) || !["audio", "card"].includes(kind)) throw new Error("date·locale·kind 형식");

    if (cmd === "approve" || cmd === "reject" || cmd === "review") {
      const status = cmd === "approve" ? "approved" : cmd === "reject" ? "rejected" : "review";
      const { setMediaStatus } = await import("../src/lib/briefing/media-register");
      const ok = await setMediaStatus(date, locale as "ko" | "en" | "zh", kind, status, arg("note"));
      console.log(ok ? `${date} ${locale} ${kind} → ${status}` : "해당 줄 없음");
      return;
    }

    if (cmd !== "add") throw new Error("명령: list | add | approve | reject | review");
    const { registerMedia } = await import("../src/lib/briefing/media-register");
    const r = await registerMedia({
      date,
      locale: locale as "ko" | "en" | "zh",
      kind,
      file: need("file"),
      source: need("source"),
      transcriptFile: arg("transcript"),
      note: arg("note"),
    });
    if (kind === "audio") console.log(`장 ${r.chapters.length}개:`, JSON.stringify(r.chapters));
    console.log(`등록(검토 중): ${date} ${locale} ${kind} → ${r.abs} (${r.bytes} bytes)`);
  } finally {
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});

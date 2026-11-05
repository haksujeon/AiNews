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
 * 파일은 BRIEFING_MEDIA_DIR(기본 ~/ainews-media)/날짜/언어/ 아래로 복사한다 (저장소 밖. 저장소에 mp3·png 를 넣지 않는다).
 * 음성: ffprobe 로 길이, 받아쓰기("A: 0:24 …")가 있으면 그 판 주요 기사 수로 장(챕터)을 찾는다 (media.ts chaptersFromTranscript).
 * 카드: sharp 로 크기, 대체 글은 그 판 브리핑 데이터로 만든다 (media.ts cardAltText).
 */
import { loadEnvConfig } from "@next/env";
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { extname, join } from "node:path";

const MIME: Record<string, string> = { ".mp3": "audio/mpeg", ".m4a": "audio/mp4", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp" };

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
  const { mediaRoot } = await import("../src/lib/briefing/media-store");
  const media = await import("../src/lib/briefing/media");
  const { formatShortDate } = await import("../src/lib/briefing/view");
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
      const { rowCount } = await pool.query(
        `UPDATE briefing_media SET status = $4, note = COALESCE($5, note), approved_at = CASE WHEN $4 = 'approved' THEN now() ELSE NULL END
          WHERE edition_date = $1::date AND locale = $2 AND kind = $3`,
        [date, locale, kind, status, arg("note") ?? null]
      );
      console.log(rowCount ? `${date} ${locale} ${kind} → ${status}` : "해당 줄 없음");
      return;
    }

    if (cmd !== "add") throw new Error("명령: list | add | approve | reject | review");
    const file = need("file");
    const source = need("source");
    const ext = extname(file).toLowerCase();
    const mime = MIME[ext];
    if (!mime) throw new Error(`지원하지 않는 파일 형식: ${ext}`);
    if ((kind === "audio") !== mime.startsWith("audio/")) throw new Error("kind 와 파일 형식이 맞지 않습니다");

    // 그 판 브리핑 (기사 수·대체 글)
    const { rows: br } = await pool.query(
      `SELECT content FROM daily_briefings WHERE edition_type = 'daily' AND edition_date = $1::date AND locale = $2 AND status = 'published' LIMIT 1`,
      [date, locale]
    );
    const content = br[0]?.content;
    if (!content) throw new Error(`${date} ${locale} 발행본이 없습니다`);

    const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+/, "");
    const rel = join(date, locale, `${kind}-${stamp}${ext}`);
    const abs = join(mediaRoot(), rel);
    mkdirSync(join(mediaRoot(), date, locale), { recursive: true });
    copyFileSync(file, abs);
    const bytes = statSync(abs).size;

    let duration: number | null = null;
    let chapters: unknown[] = [];
    let transcript: string | null = null;
    let width: number | null = null;
    let height: number | null = null;
    let alt: string | null = null;
    if (kind === "audio") {
      duration = Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", abs]).toString().trim());
      const tx = arg("transcript");
      if (tx) {
        transcript = readFileSync(tx, "utf8").trim();
        chapters = media.chaptersFromTranscript(transcript, content.top_stories.length);
        console.log(`장 ${chapters.length}개:`, JSON.stringify(chapters));
      }
    } else {
      const { default: sharp } = await import("sharp");
      const meta = await sharp(abs).metadata();
      width = meta.width ?? null;
      height = meta.height ?? null;
      const heading = locale === "ko" ? `${formatShortDate(date, locale)} 판 한 장 요약` : locale === "zh" ? `${formatShortDate(date, locale)} 一图看懂` : `${formatShortDate(date, locale)} at a glance`;
      alt = media.cardAltText(content, heading, locale === "ko" ? "숫자" : locale === "zh" ? "数字" : "Numbers");
    }

    await pool.query(
      `INSERT INTO briefing_media (edition_date, locale, kind, path, mime, bytes, width, height, duration_sec, chapters, transcript, alt_text, source, status, note)
       VALUES ($1::date, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11, $12, $13, 'review', $14)
       ON CONFLICT (edition_date, locale, kind) DO UPDATE SET
         path = EXCLUDED.path, mime = EXCLUDED.mime, bytes = EXCLUDED.bytes, width = EXCLUDED.width, height = EXCLUDED.height,
         duration_sec = EXCLUDED.duration_sec, chapters = EXCLUDED.chapters, transcript = EXCLUDED.transcript, alt_text = EXCLUDED.alt_text,
         source = EXCLUDED.source, status = 'review', note = EXCLUDED.note, created_at = now(), approved_at = NULL`,
      [date, locale, kind, rel, mime, bytes, width, height, duration, JSON.stringify(chapters), transcript, alt, source, arg("note") ?? null]
    );
    console.log(`등록(검토 중): ${date} ${locale} ${kind} → ${abs} (${bytes} bytes)`);
  } finally {
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});

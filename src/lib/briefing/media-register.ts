/**
 * 음성·카드 파일을 판에 등록한다 (언제나 검토 중 review 로). 서버·스크립트 전용.
 * scripts/briefing-media.ts add(사람이 올린 파일)와 scripts/briefing-card.ts(자동 카드)가 이 함수 하나를 쓴다 (Gate 2).
 */
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { extname, join } from "node:path";
import pool from "@/lib/db";
import { cardAltText, chaptersFromTranscript, type MediaChapter, type MediaKind } from "./media";
import { mediaRoot } from "./media-store";
import { formatShortDate } from "./view";
import type { BriefingLocale, StoredBriefingContent } from "./types";

const MIME: Record<string, string> = {
  ".mp3": "audio/mpeg",
  ".m4a": "audio/mp4",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
};

export interface RegisterInput {
  date: string;
  locale: BriefingLocale;
  kind: MediaKind;
  file: string;
  source: string;
  /** 음성 받아쓰기 파일 ("A: 0:24 …") — 장(챕터)을 찾는다 */
  transcriptFile?: string;
  note?: string;
}

export interface RegisterResult {
  abs: string;
  bytes: number;
  chapters: MediaChapter[];
  width: number | null;
  height: number | null;
  duration: number | null;
}

const CARD_HEADING: Record<BriefingLocale, (d: string) => string> = {
  ko: (d) => `${d} 판 한 장 요약`,
  zh: (d) => `${d} 一图看懂`,
  en: (d) => `${d} at a glance`,
};
const NUMBERS_LABEL: Record<BriefingLocale, string> = { ko: "숫자", zh: "数字", en: "Numbers" };

export async function registerMedia(input: RegisterInput): Promise<RegisterResult> {
  const { date, locale, kind, file, source } = input;
  const ext = extname(file).toLowerCase();
  const mime = MIME[ext];
  if (!mime) throw new Error(`지원하지 않는 파일 형식: ${ext}`);
  if ((kind === "audio") !== mime.startsWith("audio/")) throw new Error("kind 와 파일 형식이 맞지 않습니다");

  const { rows } = await pool.query(
    `SELECT content FROM daily_briefings WHERE edition_type = 'daily' AND edition_date = $1::date AND locale = $2 AND status = 'published' LIMIT 1`,
    [date, locale]
  );
  const content = rows[0]?.content as StoredBriefingContent | undefined;
  if (!content) throw new Error(`${date} ${locale} 발행본이 없습니다`);

  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+/, "");
  const rel = join(date, locale, `${kind}-${stamp}${ext}`);
  const abs = join(mediaRoot(), rel);
  mkdirSync(join(mediaRoot(), date, locale), { recursive: true });
  copyFileSync(file, abs);
  const bytes = statSync(abs).size;

  let duration: number | null = null;
  let chapters: MediaChapter[] = [];
  let transcript: string | null = null;
  let width: number | null = null;
  let height: number | null = null;
  let alt: string | null = null;
  if (kind === "audio") {
    duration = Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", abs]).toString().trim());
    if (input.transcriptFile) {
      transcript = readFileSync(input.transcriptFile, "utf8").trim();
      chapters = chaptersFromTranscript(transcript, content.top_stories.length);
    }
  } else {
    const { default: sharp } = await import("sharp");
    const meta = await sharp(abs).metadata();
    width = meta.width ?? null;
    height = meta.height ?? null;
    alt = cardAltText(content, CARD_HEADING[locale](formatShortDate(date, locale)), NUMBERS_LABEL[locale]);
  }

  await pool.query(
    `INSERT INTO briefing_media (edition_date, locale, kind, path, mime, bytes, width, height, duration_sec, chapters, transcript, alt_text, source, status, note)
     VALUES ($1::date, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11, $12, $13, 'review', $14)
     ON CONFLICT (edition_date, locale, kind) DO UPDATE SET
       path = EXCLUDED.path, mime = EXCLUDED.mime, bytes = EXCLUDED.bytes, width = EXCLUDED.width, height = EXCLUDED.height,
       duration_sec = EXCLUDED.duration_sec, chapters = EXCLUDED.chapters, transcript = EXCLUDED.transcript, alt_text = EXCLUDED.alt_text,
       source = EXCLUDED.source, status = 'review', note = EXCLUDED.note, created_at = now(), approved_at = NULL`,
    [date, locale, kind, rel, mime, bytes, width, height, duration, JSON.stringify(chapters), transcript, alt, source, input.note ?? null]
  );
  return { abs, bytes, chapters, width, height, duration };
}

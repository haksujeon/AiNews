/**
 * 브리핑 음성·카드 — DB(briefing_media)와 파일. 서버 전용.
 * 화면은 hydrate(public.ts)가 loadBriefingMedia 로 붙인다. 공개는 approved 만, 관리자 검토는 review 도.
 * 파일은 저장소 밖 BRIEFING_MEDIA_DIR(기본 ~/ainews-media) 아래에 두고, 주소는 판·언어·종류로만 연다(media.ts mediaUrl).
 */
import { homedir } from "node:os";
import { join, resolve, sep } from "node:path";
import pool from "@/lib/db";
import type { BriefingLocale } from "./types";
import { mediaUrl, type BriefingMediaSet, type MediaChapter, type MediaKind, type MediaStatus } from "./media";

const UNDEFINED_TABLE = "42P01";

export function mediaRoot(): string {
  return resolve(process.env.BRIEFING_MEDIA_DIR || join(homedir(), "ainews-media"));
}

/** DB 의 상대 경로 → 실제 파일 경로. 뿌리 밖으로 나가면 null */
export function mediaFilePath(rel: string): string | null {
  const root = mediaRoot();
  const abs = resolve(root, rel);
  return abs.startsWith(root + sep) ? abs : null;
}

export interface MediaRow {
  edition_date: string;
  locale: BriefingLocale;
  kind: MediaKind;
  path: string;
  mime: string;
  bytes: number;
  width: number | null;
  height: number | null;
  duration_sec: string | number | null;
  chapters: MediaChapter[] | null;
  transcript: string | null;
  alt_text: string | null;
  source: string;
  status: MediaStatus;
  created_at: string;
}

const COLS = `to_char(edition_date, 'YYYY-MM-DD') AS edition_date, locale, kind, path, mime, bytes, width, height,
  duration_sec, chapters, transcript, alt_text, source, status, created_at::text AS created_at`;

/** 한 줄 (상태 무관). 미디어 라우트와 관리 스크립트가 쓴다 */
export async function getMediaRow(date: string, locale: BriefingLocale, kind: MediaKind): Promise<MediaRow | null> {
  try {
    const { rows } = await pool.query(`SELECT ${COLS} FROM briefing_media WHERE edition_date = $1::date AND locale = $2 AND kind = $3`, [
      date,
      locale,
      kind,
    ]);
    return (rows[0] as MediaRow | undefined) ?? null;
  } catch (e) {
    if ((e as { code?: string }).code === UNDEFINED_TABLE) return null;
    throw e;
  }
}

/** 행 → 화면용 (순수). 버전 표시는 created_at 으로 — 다시 만들면 주소가 바뀌어 캐시가 갱신된다 */
export function toMediaSet(rows: MediaRow[]): BriefingMediaSet {
  const out: BriefingMediaSet = {};
  for (const r of rows) {
    const url = mediaUrl(r.edition_date, r.locale, r.kind, String(Date.parse(r.created_at) || ""));
    if (r.kind === "audio") {
      out.audio = {
        url,
        duration_sec: Number(r.duration_sec) || 0,
        chapters: Array.isArray(r.chapters) ? r.chapters : [],
        transcript: r.transcript,
        source: r.source,
        status: r.status,
      };
    } else if (r.kind === "card" && r.width && r.height) {
      out.card = { url, width: r.width, height: r.height, alt_text: r.alt_text ?? "", source: r.source, status: r.status };
    }
  }
  return out;
}

/** 판의 음성·카드. includeReview = 관리자 검토 화면 (검토 중인 것도 보인다) */
export async function loadBriefingMedia(date: string, locale: BriefingLocale, includeReview = false): Promise<BriefingMediaSet> {
  try {
    const { rows } = await pool.query(
      `SELECT ${COLS} FROM briefing_media WHERE edition_date = $1::date AND locale = $2 AND status = ANY($3::text[])`,
      [date, locale, includeReview ? ["approved", "review"] : ["approved"]]
    );
    return toMediaSet(rows as MediaRow[]);
  } catch (e) {
    if ((e as { code?: string }).code !== UNDEFINED_TABLE) console.error("[briefing-media] 읽기 실패", (e as Error).message);
    return {};
  }
}

/** 카드 그림 명세 파일 (scripts/briefing-card.ts 가 쓰고, 카드 화면이 읽는다) */
export function cardSpecPath(date: string, locale: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^(ko|en|zh)$/.test(locale)) return null;
  return mediaFilePath(join(date, locale, "card-spec.json"));
}

/** 카드 그림 명세 (없으면 null). 한눈에 보기 블록과 카드 화면이 같은 명세를 읽는다 */
export async function loadCardSpec(date: string, locale: string): Promise<import("./card-spec").CardSpec | null> {
  const file = cardSpecPath(date, locale);
  if (!file) return null;
  const { readFile } = await import("node:fs/promises");
  return readFile(file, "utf8")
    .then((t) => JSON.parse(t))
    .catch(() => null);
}

/**
 * 만들 판 고르기 (음성·카드 스크립트가 같이 쓴다, Gate 2): 최근 lookbackDays 일 발행 데일리 판 가운데
 * 그 종류가 아직 승인되지 않은 가장 최신 판. 모두 승인됐으면 undefined (→ 스크립트는 최신 판을 보고 건너뛴다).
 * 발행이 늦은 판(2026-11-10 판은 다음 날 21:42 발행)도 다음 실행 때 만든다 — 최신 판만 보면 영영 건너뛴다.
 */
export async function pendingMediaDate(
  locale: BriefingLocale,
  kind: MediaKind,
  lookbackDays = Number(process.env.BRIEFING_MEDIA_LOOKBACK_DAYS ?? 3)
): Promise<string | undefined> {
  const { rows } = await pool.query(
    `SELECT to_char(b.edition_date, 'YYYY-MM-DD') AS d
       FROM daily_briefings b
       LEFT JOIN briefing_media m ON m.edition_date = b.edition_date AND m.locale = b.locale AND m.kind = $2
      WHERE b.status = 'published' AND b.edition_type = 'daily' AND b.locale = $1
        AND b.edition_date >= current_date - $3::int AND m.status IS DISTINCT FROM 'approved'
      ORDER BY b.edition_date DESC LIMIT 1`,
    [locale, kind, Math.max(0, Math.floor(lookbackDays) || 0)]
  );
  return (rows[0] as { d: string } | undefined)?.d;
}

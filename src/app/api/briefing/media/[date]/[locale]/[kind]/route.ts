import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";
import { NextRequest, NextResponse } from "next/server";
import { COOKIE_NAME, verifyAdminToken } from "@/lib/admin-auth";
import { isCalendarDate } from "@/lib/news-query";
import { getMediaRow, mediaFilePath } from "@/lib/briefing/media-store";
import type { MediaKind } from "@/lib/briefing/media";
import { BRIEFING_LOCALES, type BriefingLocale } from "@/lib/briefing/types";

// GET /api/briefing/media/YYYY-MM-DD/ko/audio|card
// 승인(approved)된 것은 누구나, 검토 중(review)인 것은 관리자 세션만. 그 밖은 404.
// 음성은 Range(206)를 지원한다 — 사파리는 Range 없이는 재생·되감기를 못 한다.
export const dynamic = "force-dynamic";

const KINDS: MediaKind[] = ["audio", "card"];
const notFound = () => NextResponse.json({ error: { message: "Not found" } }, { status: 404 });

export async function GET(request: NextRequest, { params }: { params: Promise<{ date: string; locale: string; kind: string }> }) {
  const { date, locale, kind } = await params;
  if (!isCalendarDate(date) || !BRIEFING_LOCALES.includes(locale as BriefingLocale) || !KINDS.includes(kind as MediaKind)) return notFound();

  try {
    const row = await getMediaRow(date, locale as BriefingLocale, kind as MediaKind);
    if (!row || row.status === "rejected") return notFound();
    const approved = row.status === "approved";
    if (!approved) {
      const token = request.cookies.get(COOKIE_NAME)?.value;
      if (!token || !(await verifyAdminToken(token))) return notFound();
    }
    const file = mediaFilePath(row.path);
    if (!file) return notFound();
    const st = await stat(file).catch(() => null);
    if (!st?.isFile()) return notFound();

    const size = st.size;
    const base: Record<string, string> = {
      "Content-Type": row.mime,
      "Accept-Ranges": "bytes",
      // 주소에 ?v=만든시각 이 붙으므로 승인본은 오래 둬도 된다. 검토본은 저장하지 않는다
      "Cache-Control": approved ? "public, max-age=86400" : "private, no-store",
      "X-Content-Type-Options": "nosniff",
    };
    const range = /^bytes=(\d*)-(\d*)$/.exec(request.headers.get("range") ?? "");
    if (range && (range[1] || range[2])) {
      let start = range[1] ? Number(range[1]) : size - Number(range[2]);
      let end = range[1] && range[2] ? Number(range[2]) : size - 1;
      start = Math.max(0, start);
      end = Math.min(end, size - 1);
      if (start > end || start >= size) {
        return new NextResponse(null, { status: 416, headers: { ...base, "Content-Range": `bytes */${size}` } });
      }
      const body = Readable.toWeb(createReadStream(file, { start, end })) as ReadableStream;
      return new NextResponse(body, {
        status: 206,
        headers: { ...base, "Content-Range": `bytes ${start}-${end}/${size}`, "Content-Length": String(end - start + 1) },
      });
    }
    const body = Readable.toWeb(createReadStream(file)) as ReadableStream;
    return new NextResponse(body, { status: 200, headers: { ...base, "Content-Length": String(size) } });
  } catch (e) {
    console.error("[api/briefing/media]", e);
    return NextResponse.json({ error: { message: "Failed to load media" } }, { status: 500 });
  }
}

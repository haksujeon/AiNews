import { NextRequest, NextResponse } from "next/server";
import { getPublishedBriefing } from "@/lib/briefing/public";
import { BRIEFING_LOCALES, type BriefingLocale } from "@/lib/briefing/types";

// GET /api/briefing?locale=ko&date=YYYY-MM-DD
// 공개: 발행된 판만. date 가 없으면 최신 발행본.
// 인용 기사는 PUBLIC_NEWS_WHERE 로 조인하므로 숨긴 기사와 그것만 근거로 둔 항목은 빠진다.
export const dynamic = "force-dynamic";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const localeParam = searchParams.get("locale") ?? "ko";
  const date = searchParams.get("date") ?? undefined;
  if (!BRIEFING_LOCALES.includes(localeParam as BriefingLocale)) {
    return NextResponse.json({ error: { message: "locale must be ko, en or zh" } }, { status: 400 });
  }
  if (date !== undefined && !DATE_RE.test(date)) {
    return NextResponse.json({ error: { message: "date must be YYYY-MM-DD" } }, { status: 400 });
  }

  try {
    const briefing = await getPublishedBriefing(localeParam as BriefingLocale, date);
    if (!briefing) {
      return NextResponse.json({ error: { message: "Briefing not found" } }, { status: 404 });
    }
    return NextResponse.json(
      { data: briefing },
      { headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600" } }
    );
  } catch (e) {
    console.error("[api/briefing]", e);
    return NextResponse.json({ error: { message: "Failed to load briefing" } }, { status: 500 });
  }
}

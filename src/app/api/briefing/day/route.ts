import { NextRequest, NextResponse } from "next/server";
import { getPublishedBriefing, isEditionWithdrawn } from "@/lib/briefing/public";
import { isValidEditionDate } from "@/lib/briefing/generate";
import { BRIEFING_LOCALES, type BriefingLocale } from "@/lib/briefing/types";

// GET /api/briefing/day?locale=ko&date=YYYY-MM-DD — 홈 날짜 브리핑 팝업(?briefing=) 전용.
//   { data: PublicBriefing } | 404 { error: { code: "withdrawn" | "not_found", message } }
// 브리핑 페이지와 같은 getPublishedBriefing 을 쓴다 (Gate 2). /api/briefing 과 달리 CDN 캐시를 두지 않는다(no-store):
// 철회가 팝업에 바로 반영되어야 한다 (홈·브리핑 페이지도 no-store).
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "private, no-store" };

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const locale = searchParams.get("locale") ?? "ko";
  const date = searchParams.get("date") ?? "";
  if (!BRIEFING_LOCALES.includes(locale as BriefingLocale)) {
    return NextResponse.json({ error: { code: "bad_request", message: "locale must be ko, en or zh" } }, { status: 400, headers: NO_STORE });
  }
  if (!isValidEditionDate(date)) {
    return NextResponse.json({ error: { code: "not_found", message: "Briefing not found" } }, { status: 404, headers: NO_STORE });
  }
  try {
    const briefing = await getPublishedBriefing(locale as BriefingLocale, date);
    if (briefing) return NextResponse.json({ data: briefing }, { headers: NO_STORE });
    const withdrawn = await isEditionWithdrawn(locale as BriefingLocale, date);
    return NextResponse.json(
      { error: { code: withdrawn ? "withdrawn" : "not_found", message: withdrawn ? "Briefing withdrawn" : "Briefing not found" } },
      { status: 404, headers: NO_STORE }
    );
  } catch (e) {
    console.error("[api/briefing/day]", e);
    return NextResponse.json({ error: { code: "failed", message: "Failed to load briefing" } }, { status: 500, headers: NO_STORE });
  }
}

import { NextRequest, NextResponse } from "next/server";
import { requireAdminAuth } from "@/lib/admin-auth";
import { PublishError, publishBriefing, withdrawBriefing } from "@/lib/briefing/publish";
import { isValidEditionDate } from "@/lib/briefing/generate";
import { BRIEFING_LOCALES, type BriefingLocale } from "@/lib/briefing/types";

// POST /api/admin/briefing/publish  (관리자 세션 쿠키 필요)
// body: { date: 'YYYY-MM-DD', version?: number, action?: 'publish' | 'withdraw', locale?: 'ko'|'en'|'zh' }
//  - publish: 그 날짜 ko 초안(version 미지정 시 최신 draft)과 거기서 번역된 en/zh 초안을 발행.
//             기존 발행본은 superseded 로 바뀐다.
//  - withdraw: 발행본 철회 (locale 미지정 시 모든 언어판)
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const authError = await requireAdminAuth(request);
  if (authError) return authError;

  const body: unknown = await request.json().catch(() => ({}));
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const date = typeof b.date === "string" ? b.date : "";
  if (!isValidEditionDate(date)) {
    return NextResponse.json({ error: { message: "date must be YYYY-MM-DD" } }, { status: 400 });
  }
  const action = b.action === "withdraw" ? "withdraw" : "publish";
  const version = typeof b.version === "number" && Number.isInteger(b.version) && b.version > 0 ? b.version : undefined;
  const locale = BRIEFING_LOCALES.includes(b.locale as BriefingLocale) ? (b.locale as BriefingLocale) : undefined;

  try {
    if (action === "withdraw") {
      const withdrawn = await withdrawBriefing({ date, locale, editedBy: "admin" });
      return NextResponse.json({ data: { date, withdrawn } });
    }
    const result = await publishBriefing({ date, version, editedBy: "admin" });
    return NextResponse.json({ data: result });
  } catch (e) {
    if (e instanceof PublishError) {
      return NextResponse.json({ error: { message: e.message } }, { status: e.status });
    }
    console.error("[api/admin/briefing/publish]", e);
    return NextResponse.json({ error: { message: "Publish failed" } }, { status: 500 });
  }
}

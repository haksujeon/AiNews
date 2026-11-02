import { NextRequest, NextResponse } from "next/server";
import { requireAdminAuth } from "@/lib/admin-auth";
import { generateBriefing, isValidEditionDate } from "@/lib/briefing/generate";
import { generateWeekly } from "@/lib/briefing/periodic/generate";

// POST /api/admin/briefing/regenerate  (관리자 세션 쿠키 필요)
// body: { date: 'YYYY-MM-DD', edition_type?: 'daily' | 'weekly' }
// 관리자 "다시 생성" 버튼. n8n·cron·CLI 와 같은 generateBriefing / generateWeekly 를 force 로 부른다 (Gate 2).
// 주간은 date = 그 주 월요일(period_start).
// 발행본은 덮어쓰지 않고 version+1 의 새 draft(또는 failed)가 생긴다. LLM 호출로 15~60초 걸린다.
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(request: NextRequest) {
  const authError = await requireAdminAuth(request);
  if (authError) return authError;

  const body: unknown = await request.json().catch(() => ({}));
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const date = typeof b.date === "string" ? b.date : "";
  if (!isValidEditionDate(date)) {
    return NextResponse.json({ error: { message: "date must be YYYY-MM-DD and not in the future (Beijing)" } }, { status: 400 });
  }
  if (b.edition_type !== undefined && b.edition_type !== "daily" && b.edition_type !== "weekly") {
    return NextResponse.json({ error: { message: "edition_type must be daily or weekly" } }, { status: 400 });
  }
  try {
    if (b.edition_type === "weekly") {
      const weekly = await generateWeekly({ start: date, force: true });
      if (weekly.outcome === "invalid_week") return NextResponse.json({ error: { message: weekly.message ?? "invalid week" } }, { status: 400 });
      return NextResponse.json({ data: weekly }, { status: weekly.outcome === "locked" ? 409 : 200 });
    }
    const result = await generateBriefing({ date, force: true });
    const status = result.outcome === "locked" ? 409 : 200; // failed 도 200 — 결과(오류 메시지 포함)를 화면에 보여 준다
    return NextResponse.json({ data: result }, { status });
  } catch (e) {
    console.error("[api/admin/briefing/regenerate]", e);
    return NextResponse.json({ error: { message: "Regeneration failed" } }, { status: 500 });
  }
}

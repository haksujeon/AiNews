import { NextRequest, NextResponse } from "next/server";
import { requireAdminAuth } from "@/lib/admin-auth";
import { generateBriefing, isValidEditionDate } from "@/lib/briefing/generate";

// POST /api/admin/briefing/regenerate  (관리자 세션 쿠키 필요)
// body: { date: 'YYYY-MM-DD' }
// 관리자 "다시 생성" 버튼. n8n·cron·CLI 와 같은 generateBriefing 을 force 로 부른다 (Gate 2).
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
  try {
    const result = await generateBriefing({ date, force: true });
    const status = result.outcome === "locked" ? 409 : 200; // failed 도 200 — 결과(오류 메시지 포함)를 화면에 보여 준다
    return NextResponse.json({ data: result }, { status });
  } catch (e) {
    console.error("[api/admin/briefing/regenerate]", e);
    return NextResponse.json({ error: { message: "Regeneration failed" } }, { status: 500 });
  }
}

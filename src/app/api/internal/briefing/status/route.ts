import { NextRequest, NextResponse } from "next/server";
import { requireIngestToken } from "@/lib/ingest-auth";
import { briefingSlaStatus } from "@/lib/briefing/sla";

// GET /api/internal/briefing/status   인증: Authorization: Bearer <INGEST_TOKEN>
// 호출자: n8n "AiNews briefing schedule" 09:30 KST 점검 — data.notify 가 true 면 텔레그램 알림.
// 관리자 SLA 띠와 같은 briefingSlaStatus() 를 돌려준다 (Gate 2).
// data: { editionDate, periodStart, periodEnd, weekend, generateAt, dueAt, dueAtKst, generated, koStatus,
//         published, overdue, notify, lastPublished, rate14d: { eligible, published, onTime, rate } }
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const denied = requireIngestToken(request);
  if (denied) return denied;
  try {
    return NextResponse.json({ data: await briefingSlaStatus(new Date()) });
  } catch (e) {
    console.error("[api/internal/briefing/status]", e);
    return NextResponse.json({ error: { message: "Status check failed" } }, { status: 500 });
  }
}

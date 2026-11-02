import { NextRequest, NextResponse } from "next/server";
import { requireIngestToken } from "@/lib/ingest-auth";
import { runReviewPipeline } from "@/lib/briefing/review/pipeline";
import { isEditionType } from "@/lib/briefing/repository";

// POST /api/internal/briefing/review   인증: Authorization: Bearer <INGEST_TOKEN>
// 호출자: n8n "AiNews briefing schedule" — 생성 뒤 AI 검토 스윕 (2026-11-02 결정 D8 변경: AI 검토 통과 시 자동 발행)
//   데일리 01:00·01:30·02:30 KST, 주간 월 01:55·02:25, 월간 1일 02:25·02:55 (생성 00:10/00:40, 01:30, 02:00 뒤).
//   호출마다 250초 예산 안에서 검토 → (수정 최대 2회) → 자동 발행 또는 초안 유지. 상태는 briefing_reviews 에 남아
//   다음 호출이 이어 간다 (멱등 — 이미 결정된 판은 건너뛴다). 생성과 같은 판별 잠금을 잡는다.
// body: { dryRun?: boolean, briefingId?: uuid, editionType?: 'daily'|'weekly'|'monthly', date?: 'YYYY-MM-DD' }
//   dryRun 은 수정본·번역을 메모리에서만 만들고 결정만 기록한다 (발행·새 버전 저장 없음). briefingId 와 함께 쓴다.
// 응답 data: { processed[], pending, notify, message, costUsd } — notify 가 true 면 n8n 이 message 를 텔레그램으로 보낸다.
// 자동 발행 스위치: BRIEFING_AUTO_PUBLISH=off 면 발행하지 않고 결정만 남긴다 (관리자 발행으로 되돌림).
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(request: NextRequest) {
  const denied = requireIngestToken(request);
  if (denied) return denied;

  const body: unknown = await request.json().catch(() => ({}));
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  if (b.briefingId !== undefined && (typeof b.briefingId !== "string" || !UUID_RE.test(b.briefingId)))
    return NextResponse.json({ error: { message: "briefingId must be a uuid" } }, { status: 400 });
  if (b.editionType !== undefined && !isEditionType(b.editionType))
    return NextResponse.json({ error: { message: "editionType must be daily, weekly or monthly" } }, { status: 400 });
  if (b.date !== undefined && (typeof b.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(b.date)))
    return NextResponse.json({ error: { message: "date must be YYYY-MM-DD" } }, { status: 400 });

  try {
    const result = await runReviewPipeline({
      dryRun: b.dryRun === true,
      briefingId: b.briefingId as string | undefined,
      editionType: isEditionType(b.editionType) ? b.editionType : undefined,
      date: b.date as string | undefined,
    });
    return NextResponse.json({ data: result });
  } catch (e) {
    console.error("[api/internal/briefing/review]", e);
    return NextResponse.json({ error: { message: "Briefing review failed" } }, { status: 500 });
  }
}

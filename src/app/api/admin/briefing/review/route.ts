import { NextRequest, NextResponse } from "next/server";
import { requireAdminAuth } from "@/lib/admin-auth";
import { manualReview } from "@/lib/briefing/review/pipeline";

// POST /api/admin/briefing/review  (관리자 세션 쿠키 필요)
// body: { id: uuid (ko 판 한 버전) }
// 관리자 "AI 다시 검토" 버튼. 정기 검토와 같은 reviewBriefing·decide 를 쓴다 (Gate 2).
// 검토 기록과 자동 발행 판정만 남기고 발행·수정은 하지 않는다 (발행은 관리자가 발행 버튼으로). 1~2분 걸린다.
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(request: NextRequest) {
  const authError = await requireAdminAuth(request);
  if (authError) return authError;
  const body: unknown = await request.json().catch(() => ({}));
  const id = body && typeof body === "object" ? (body as Record<string, unknown>).id : undefined;
  if (typeof id !== "string" || !UUID_RE.test(id)) return NextResponse.json({ error: { message: "id must be a uuid" } }, { status: 400 });
  try {
    const { review, decision } = await manualReview(id);
    if (review.status !== "done") return NextResponse.json({ error: { message: review.error ?? "review failed" } }, { status: 502 });
    return NextResponse.json({
      data: { reviewId: review.id, verdict: review.verdict, score: review.score, counts: review.counts, summary: review.summary, decision: decision?.summary ?? null, eligible: decision?.eligible ?? false },
    });
  } catch (e) {
    console.error("[api/admin/briefing/review]", e);
    return NextResponse.json({ error: { message: "Review failed" } }, { status: 500 });
  }
}

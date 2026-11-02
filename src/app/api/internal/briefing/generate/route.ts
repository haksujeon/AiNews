import { NextRequest, NextResponse } from "next/server";
import { requireIngestToken } from "@/lib/ingest-auth";
import { generateBriefing, isValidEditionDate } from "@/lib/briefing/generate";
import { scheduledRunEdition } from "@/lib/briefing/sla";

// POST /api/internal/briefing/generate   인증: Authorization: Bearer <INGEST_TOKEN>
// 호출자: n8n 워크플로 "AiNews briefing schedule" (수집 워크플로와 별개) — 매일 23:40 KST 생성, 00:30 KST 재시도.
//   n8n 은 nginx(proxy_read_timeout 120s)를 거치지 않고 http://host.docker.internal:3012/ainews/... 로 직접 부른다.
//   관리자 "다시 생성"(/api/admin/briefing/regenerate)과 CLI(scripts/briefing-generate.ts)도 같은 generateBriefing 을 쓴다.
// body: { date?: 'YYYY-MM-DD' (베이징 판 날짜), force?: boolean, dryRun?: boolean }
//   date 를 주지 않으면 정기 일정(sla.ts)대로: 월~금 = 베이징 오늘, 일요일 = 토요일 주말 합본(토·일), 토요일 = 생성 안 함(skipped_weekend).
// 같은 입력이면 건너뛰므로(input_hash) 여러 번 불러도 안전하다. LLM 호출 때문에 15~60초 걸린다(maxDuration 300초).
// 응답 상태: 생성·건너뜀 200, 다른 실행이 생성 중 409, 생성 실패 500 (n8n 이 실패 알림을 보낸다).
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const STATUS_BY_OUTCOME: Record<string, number> = {
  generated: 200,
  dry_run: 200,
  skipped_same_input: 200,
  skipped_low_volume: 200,
  skipped_weekend: 200,
  locked: 409,
  failed: 500,
};

export async function POST(request: NextRequest) {
  const denied = requireIngestToken(request);
  if (denied) return denied;

  const body: unknown = await request.json().catch(() => ({}));
  const b = (body && typeof body === "object" ? body : {}) as { date?: unknown; force?: unknown; dryRun?: unknown };
  const explicit = typeof b.date === "string" && b.date ? b.date : null;
  const date = explicit ?? scheduledRunEdition(new Date());
  if (!date) {
    return NextResponse.json({
      data: {
        date: null, outcome: "skipped_weekend", mode: null, candidateCount: 0, inputHash: null, locales: [], totalCostUsd: 0,
        message: "토요일 밤에는 생성하지 않습니다 — 일요일 밤에 토·일 주말 합본을 만듭니다",
      },
    });
  }
  if (!isValidEditionDate(date)) {
    return NextResponse.json({ error: { message: "date must be YYYY-MM-DD and not in the future (Beijing)" } }, { status: 400 });
  }

  try {
    const result = await generateBriefing({ date, force: b.force === true, dryRun: b.dryRun === true });
    return NextResponse.json({ data: result }, { status: STATUS_BY_OUTCOME[result.outcome] ?? 200 });
  } catch (e) {
    console.error("[api/internal/briefing/generate]", e);
    return NextResponse.json({ error: { message: "Briefing generation failed" } }, { status: 500 });
  }
}

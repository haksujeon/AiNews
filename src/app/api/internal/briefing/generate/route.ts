import { NextRequest, NextResponse } from "next/server";
import { requireIngestToken } from "@/lib/ingest-auth";
import { generateBriefing, isValidEditionDate } from "@/lib/briefing/generate";
import { generateMonthly, generateWeekly } from "@/lib/briefing/periodic/generate";
import { parseGenerateBody } from "@/lib/briefing/periodic/period-key";

// POST /api/internal/briefing/generate   인증: Authorization: Bearer <INGEST_TOKEN>
// 호출자: n8n 워크플로 "AiNews briefing schedule" (수집 워크플로와 별개)
//   - 데일리: 매일 00:10 KST 생성(방금 끝난 전날 판), 00:40 KST 재시도 — sla.ts scheduledRunEdition
//   - 주간: 월요일 01:30 KST (베이징 월 00:30) {editionType:'weekly'} → 직전 월~일
//   - 월간: 1일 02:00 KST (베이징 1일 01:00) {editionType:'monthly'} → 직전 달
//   n8n 은 nginx(proxy_read_timeout 120s)를 거치지 않고 http://host.docker.internal:3012/ainews/... 로 직접 부른다.
//   관리자 "다시 생성"(/api/admin/briefing/regenerate)과 CLI(scripts/briefing-generate.ts)도 같은 함수를 쓴다 (Gate 2).
// body: { editionType?: 'daily'|'weekly'|'monthly' (기본 daily), date?: 'YYYY-MM-DD' (daily), isoWeek?: '2026-W44' (weekly),
//         month?: '2026-10' (monthly), force?: boolean, dryRun?: boolean }  — 기간 키는 그 유형에만 (섞이면 400)
//   기간을 주지 않으면 정기 일정대로 (데일리 sla.ts, 주간·월간 period-key.ts — 모두 베이징 날짜 기준).
// 같은 입력이면 건너뛰므로(input_hash) 여러 번 불러도 안전하다. LLM 호출 때문에 15~60초 걸린다(maxDuration 300초).
// 응답 상태: 생성·건너뜀 200, 기간 오류 400, 다른 실행이 생성 중 409, 수집 미완으로 생성 보류 422, 생성 실패 500
//   (n8n 은 2xx 가 아니면 텔레그램 실패 알림을 보낸다).
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const STATUS_BY_OUTCOME: Record<string, number> = {
  generated: 200,
  dry_run: 200,
  skipped_same_input: 200,
  skipped_low_volume: 200,
  skipped_weekend: 200,
  invalid_week: 400,
  invalid_period: 400,
  locked: 409,
  blocked_data_quality: 422,
  failed: 500,
};

export async function POST(request: NextRequest) {
  const denied = requireIngestToken(request);
  if (denied) return denied;

  const body: unknown = await request.json().catch(() => ({}));
  const req = parseGenerateBody(body);
  if ("error" in req) return NextResponse.json({ error: { message: req.error } }, { status: 400 });
  if (req.editionType === "daily" && req.date !== undefined && !isValidEditionDate(req.date)) {
    return NextResponse.json({ error: { message: "date must be YYYY-MM-DD and not in the future (Beijing)" } }, { status: 400 });
  }

  try {
    const result =
      req.editionType === "weekly"
        ? await generateWeekly({ isoWeek: req.isoWeek, force: req.force, dryRun: req.dryRun })
        : req.editionType === "monthly"
          ? await generateMonthly({ month: req.month, force: req.force, dryRun: req.dryRun })
          : await generateBriefing({ date: req.date, force: req.force, dryRun: req.dryRun });
    return NextResponse.json({ data: { editionType: req.editionType, ...result } }, { status: STATUS_BY_OUTCOME[result.outcome] ?? 200 });
  } catch (e) {
    console.error("[api/internal/briefing/generate]", e);
    return NextResponse.json({ error: { message: "Briefing generation failed" } }, { status: 500 });
  }
}

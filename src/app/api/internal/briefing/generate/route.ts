import { NextRequest, NextResponse } from "next/server";
import { requireIngestToken } from "@/lib/ingest-auth";
import { beijingToday, generateBriefing, isValidEditionDate } from "@/lib/briefing/generate";

// POST /api/internal/briefing/generate
// 호출자: n8n 마지막 노드(23:20 KST 전후), 00:30 cron 안전망. 인증: Authorization: Bearer <INGEST_TOKEN>
// body: { date?: 'YYYY-MM-DD' (베이징 발행일, 기본 = 베이징 오늘), force?: boolean }
// 같은 입력이면 건너뛰므로(input_hash) 여러 번 불러도 안전하다. LLM 호출 때문에 15~60초 걸린다.
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const STATUS_BY_OUTCOME: Record<string, number> = {
  generated: 200,
  dry_run: 200,
  skipped_same_input: 200,
  skipped_low_volume: 200,
  locked: 409,
  failed: 500,
};

export async function POST(request: NextRequest) {
  const denied = requireIngestToken(request);
  if (denied) return denied;

  const body: unknown = await request.json().catch(() => ({}));
  const b = (body && typeof body === "object" ? body : {}) as { date?: unknown; force?: unknown; dryRun?: unknown };
  const date = typeof b.date === "string" && b.date ? b.date : beijingToday();
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

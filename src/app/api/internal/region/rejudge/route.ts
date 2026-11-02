import { NextRequest, NextResponse } from "next/server";
import { requireIngestToken } from "@/lib/ingest-auth";
import { parseRejudgeBody, runRejudge } from "@/lib/region-rejudge";

// POST /api/internal/region/rejudge   인증: Authorization: Bearer <INGEST_TOKEN>
// 호출자: n8n 워크플로 "AiNews briefing schedule" — 00:00·09:50·14:50 KST (수집 23:00·09:00·14:00 KST 가 끝난 뒤,
//   00:10 데일리 생성 전). n8n 분류기가 쓴 지역(n8n-v1)을 백필과 같은 방식(고신뢰 규칙 → LLM)으로 다시 판정한다.
//   백필 스크립트(scripts/region-backfill.ts)와 같은 판정 함수 src/lib/region-judge.ts rejudgeRegions 를 쓴다 (Gate 2).
// body: { since?: ISO 시각 (기본 72시간 전, created_at 기준), limit?: 1..3000 (기본 600), dryRun?: boolean,
//         includeVersions?: string[] (시험용: 이미 rule-v1/llm-v1 인 행도 다시) }
// 응답 200 { data: { runId, outcome, selected, rules, llm, changed, tagsChanged, unchanged, failed, conflicts,
//   byOldVersion, llmCalls, costUsd, alert, examples } }. 다른 실행 중 409, 본문 오류 400, 실패 500.
//   수집 시간대에 부르면 200 outcome 'skipped_ingest_window' (경고 아님). n8n 은 400 이상(409 제외)·alert 이면 텔레그램.
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(request: NextRequest) {
  const denied = requireIngestToken(request);
  if (denied) return denied;

  const body: unknown = await request.json().catch(() => ({}));
  const opts = parseRejudgeBody(body);
  if ("error" in opts) return NextResponse.json({ error: { message: opts.error } }, { status: 400 });

  try {
    const result = await runRejudge(opts);
    return NextResponse.json({ data: result }, { status: result.outcome === "locked" ? 409 : 200 });
  } catch (e) {
    console.error("[api/internal/region/rejudge]", e);
    return NextResponse.json({ error: { message: "Region rejudge failed" }, data: { outcome: "failed" } }, { status: 500 });
  }
}

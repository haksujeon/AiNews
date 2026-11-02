import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import { requireIngestToken } from "@/lib/ingest-auth";
import { SHADOW_COLUMNS, parseShadowBody } from "@/lib/classifier-shadow";

// POST /api/internal/classifier-shadow   인증: Authorization: Bearer <INGEST_TOKEN>
// 호출자: n8n 수집 워크플로의 그림자 분기 "Save Shadow" (로봇 범위 1단계). 운영 저장(upsert)과 무관하다.
// body: { run_id: string|number, prompt_version?: "v3", rows: [{ item_url, title, source_name, current_relevant,
//         current_category, current_subject, current_kept, current_capped, v3_relevant, v3_category, v3_subject,
//         current_mode, v3_mode }] }  (최대 300행)
// 같은 (run_id, item_url) 은 한 번만 들어간다 — 실행 기록에서 다시 보내도(백필) 중복되지 않는다.
// 응답: { ok: true, received, inserted, skipped }
export const dynamic = "force-dynamic";

const TYPES: Record<(typeof SHADOW_COLUMNS)[number], string> = {
  item_url: "text", title: "text", source_name: "text", current_relevant: "boolean", current_category: "text",
  current_subject: "text", current_kept: "boolean", current_capped: "boolean", v3_relevant: "boolean",
  v3_category: "text", v3_subject: "text", current_mode: "text", v3_mode: "text",
};

export async function POST(request: NextRequest) {
  const denied = requireIngestToken(request);
  if (denied) return denied;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: { message: "Invalid JSON" } }, { status: 400 });
  }
  const parsed = parseShadowBody(body);
  if (!parsed.ok) return NextResponse.json({ error: { message: parsed.message } }, { status: 400 });
  const { runId, promptVersion, rows, skipped } = parsed;
  if (rows.length === 0) return NextResponse.json({ ok: true, received: 0, inserted: 0, skipped });

  try {
    // 열마다 배열 하나 → unnest 로 한 번에 넣는다 ($1 = run_id, $2 = prompt_version, $3.. = 열 배열)
    const arrays = SHADOW_COLUMNS.map((c) => rows.map((r) => r[c]));
    const unnest = SHADOW_COLUMNS.map((c, i) => `$${i + 3}::${TYPES[c]}[]`).join(", ");
    const { rowCount } = await pool.query(
      `INSERT INTO classifier_shadow (run_id, prompt_version, ${SHADOW_COLUMNS.join(", ")})
       SELECT $1, $2, u.* FROM unnest(${unnest}) AS u(${SHADOW_COLUMNS.join(", ")})
       ON CONFLICT (run_id, item_url) DO NOTHING`,
      [runId, promptVersion, ...arrays]
    );
    return NextResponse.json({ ok: true, received: rows.length, inserted: rowCount ?? 0, skipped });
  } catch (e) {
    console.error("[api/internal/classifier-shadow]", e);
    return NextResponse.json({ error: { message: "Insert failed" } }, { status: 500 });
  }
}

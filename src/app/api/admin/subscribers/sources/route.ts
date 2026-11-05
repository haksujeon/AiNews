import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import { requireAdminAuth } from "@/lib/admin-auth";

/** 출처(QR·사이트 버튼)별 신청 현황 — 구독 중 / 확인 대기 / 해지 (scripts/2026-11-05-newsletter-signup.sql 상태 규칙) */
export async function GET(request: NextRequest) {
  const authError = await requireAdminAuth(request);
  if (authError) return authError;
  try {
    const { rows } = await pool.query(
      `SELECT source,
              count(*)::int AS total,
              count(*) FILTER (WHERE is_active)::int AS active,
              count(*) FILTER (WHERE NOT is_active AND confirmed_at IS NULL AND unsubscribed_at IS NULL)::int AS pending,
              count(*) FILTER (WHERE NOT is_active AND (confirmed_at IS NOT NULL OR unsubscribed_at IS NOT NULL))::int AS inactive
         FROM newsletter_subscribers GROUP BY source ORDER BY total DESC, source NULLS LAST`
    );
    return NextResponse.json({ data: { sources: rows } });
  } catch (e) {
    return NextResponse.json({ error: { message: (e as Error).message } }, { status: 500 });
  }
}

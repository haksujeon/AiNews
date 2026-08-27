import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';

// POST /api/news/check-exists
// Body: { urls: string[] }  OR  { ids: string[] }
// Returns: { existing: string[] }  — already-stored source_urls or ids
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    if (body.urls && Array.isArray(body.urls)) {
      const { rows } = await pool.query(
        `SELECT source_url FROM ai_news_ex WHERE source_url = ANY($1)`,
        [body.urls]
      );
      return NextResponse.json({ existing: rows.map((r: { source_url: string }) => r.source_url) });
    }

    if (body.ids && Array.isArray(body.ids)) {
      const { rows } = await pool.query(
        `SELECT id FROM ai_news_ex WHERE id = ANY($1)`,
        [body.ids]
      );
      return NextResponse.json({ existing: rows.map((r: { id: string }) => r.id) });
    }

    return NextResponse.json({ existing: [] });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}

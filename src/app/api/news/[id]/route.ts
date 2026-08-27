import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';

const DETAIL_FIELDS = `id,
  to_char(created_at::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS created_at,
  source_name, source_url,
  to_char(news_date::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS news_date,
  title_cn, title_kr, title_en, summary_cn, summary_kr, summary_en,
  content_cn, content_kr, content_en, ai_insights_cn, ai_insights_kr, ai_insights_en,
  key_terms, sentiment, category, thumbnail_url, og_image_url, country`;

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    const { rows } = await pool.query(
      `SELECT ${DETAIL_FIELDS} FROM ai_news_ex WHERE id = $1 LIMIT 1`,
      [id]
    );
    if (rows.length === 0) return NextResponse.json(null, { status: 404 });
    return NextResponse.json(rows[0]);
  } catch {
    return NextResponse.json(null, { status: 500 });
  }
}

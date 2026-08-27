import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';

const LIST_FIELDS = `id,
  to_char(created_at::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS created_at,
  source_name, source_url,
  to_char(news_date::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS news_date,
  title_cn, title_kr, title_en, summary_cn, summary_kr, summary_en,
  sentiment, category, thumbnail_url, og_image_url, country`;

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const offset = parseInt(searchParams.get('offset') || '0');
  const limit = Math.min(parseInt(searchParams.get('limit') || '30'), 100);

  try {
    const { rows } = await pool.query(
      `SELECT ${LIST_FIELDS} FROM ai_news_ex
       WHERE is_duplicate = FALSE
       ORDER BY news_date DESC, id DESC
       OFFSET $1 LIMIT $2`,
      [offset, limit]
    );
    return NextResponse.json(rows);
  } catch {
    return NextResponse.json([], { status: 500 });
  }
}

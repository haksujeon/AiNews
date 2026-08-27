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
  const excludeId = searchParams.get('exclude') || '';
  const category = searchParams.get('category') || '';
  const limit = Math.min(parseInt(searchParams.get('limit') || '4'), 20);

  try {
    const values: unknown[] = [excludeId, limit];
    let sql = `SELECT ${LIST_FIELDS} FROM ai_news_ex
               WHERE id != $1 AND is_duplicate = FALSE`;
    if (category) {
      values.push(category);
      sql += ` AND category = $${values.length}`;
    }
    sql += ` ORDER BY news_date DESC LIMIT $2`;

    const { rows } = await pool.query(sql, values);
    return NextResponse.json(rows);
  } catch {
    return NextResponse.json([], { status: 500 });
  }
}

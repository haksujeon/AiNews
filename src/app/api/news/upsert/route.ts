import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { requireIngestToken } from '@/lib/ingest-auth';

// POST /api/news/upsert
// n8n 워크플로우에서 호출: 뉴스 아이템 upsert
// 인증: Authorization: Bearer <INGEST_TOKEN>
// id 를 받아 ON CONFLICT DO UPDATE 하므로 무인증이면 기존 기사 덮어쓰기가 가능하다.
export async function POST(request: NextRequest) {
  const denied = requireIngestToken(request);
  if (denied) return denied;

  try {
    const body = await request.json();
    const items: Record<string, unknown>[] = Array.isArray(body) ? body : [body];

    const ALLOWED_COLS = new Set([
      'id','source_name','source_url','news_date','title_cn','title_kr','title_en',
      'summary_cn','summary_kr','summary_en','content_cn','content_kr','content_en',
      'ai_insights_cn','ai_insights_kr','ai_insights_en','key_terms',
      'sentiment','category','thumbnail_url','og_image_url','country','is_duplicate',
    ]);

    let upserted = 0;
    for (const item of items) {
      const keys = Object.keys(item).filter(k => ALLOWED_COLS.has(k));
      if (!keys.length) continue;

      const cols = keys.map(k => `"${k}"`).join(', ');
      const placeholders = keys.map((_, i) => `$${i + 1}`).join(', ');
      const updates = keys.filter(k => k !== 'id')
        .map(k => `"${k}" = EXCLUDED."${k}"`).join(', ');
      const vals = keys.map(k => {
        const v = item[k];
        return Array.isArray(v) || (v !== null && typeof v === 'object')
          ? JSON.stringify(v) : v;
      });

      await pool.query(
        `INSERT INTO ai_news_ex (${cols}) VALUES (${placeholders})
         ON CONFLICT (id) DO UPDATE SET ${updates}`,
        vals
      );
      upserted++;
    }

    return NextResponse.json({ ok: true, upserted });
  } catch (e) {
    // DB 원문 에러를 응답에 실으면 스키마가 노출된다. 서버 로그에만 남긴다.
    console.error('[api/news/upsert]', e);
    return NextResponse.json(
      { ok: false, error: 'Upsert failed' },
      { status: 500 }
    );
  }
}

import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { requireIngestToken } from '@/lib/ingest-auth';
import { scheduleRelatedCompute } from '@/lib/related';
import { sanitizeRegionFields } from '@/lib/region';

// POST /api/news/upsert
// n8n 워크플로우에서 호출: 뉴스 아이템 upsert
// 인증: Authorization: Bearer <INGEST_TOKEN>
// ON CONFLICT DO UPDATE 하므로 무인증이면 기존 기사 덮어쓰기가 가능하다.
//
// 중복 방지 (2026-10-13): n8n 은 id 를 보내지 않아(DB 가 gen_random_uuid 생성) ON CONFLICT (id) 로는
// 재처리 시 같은 기사가 새 행으로 들어갔다. 이제 source_url(UNIQUE 인덱스 ai_news_ex_source_url_key) 로 충돌 판정한다.
//  - source_url 이 있으면 ON CONFLICT (source_url): 기존 행의 id 는 유지.
//  - source_url 이 없고 id 만 있으면 기존처럼 ON CONFLICT (id).
//  - 갱신 시 빈 값('' / NULL / 빈 key_terms 배열)은 기존 값을 덮어쓰지 않는다
//    (번역·인사이트 LLM 실패로 빈 문자열이 와도 이미 번역된 내용을 지우지 않기 위함).
//
// 대상 지역 (2026-11-02, src/lib/region.ts): n8n 분류기가 subject_region / region_tags / region_version 을 보낸다.
//  - normalizeRegion 으로 다듬는다(TW·HK → CN + 태그, 모르는 코드 버림). 대표 지역이 틀리면 세 열 모두 버린다
//    — CHECK 제약 위반으로 요청 전체가 500 이 되지 않도록.
//  - region_tags 는 text[] 라 JSON 문자열이 아니라 JS 배열로 넘긴다. 빈 배열은 기존 태그를 덮어쓰지 않는다.

const TEXT_COLS = new Set([
  'source_name','source_url','title_cn','title_kr','title_en',
  'summary_cn','summary_kr','summary_en','content_cn','content_kr','content_en',
  'ai_insights_cn','ai_insights_kr','ai_insights_en',
  'sentiment','category','thumbnail_url','og_image_url','country',
  'subject_region','region_version',
]);

/** text[] 열 — JSON 문자열이 아니라 배열 그대로 pg 에 넘긴다 */
const TEXT_ARRAY_COLS = new Set(['region_tags']);


function updateExpr(k: string): string {
  if (TEXT_COLS.has(k)) return `"${k}" = COALESCE(NULLIF(EXCLUDED."${k}", ''), ai_news_ex."${k}")`;
  if (k === 'region_tags') {
    return `"region_tags" = CASE WHEN EXCLUDED."region_tags" IS NULL OR EXCLUDED."region_tags" = '{}'::text[]
                               THEN ai_news_ex."region_tags" ELSE EXCLUDED."region_tags" END`;
  }
  if (k === 'key_terms') {
    return `"key_terms" = CASE WHEN EXCLUDED."key_terms" IS NULL OR EXCLUDED."key_terms" = '[]'::jsonb
                              THEN ai_news_ex."key_terms" ELSE EXCLUDED."key_terms" END`;
  }
  // news_date, is_duplicate 등 비문자열: NULL 이면 기존 값 유지
  return `"${k}" = COALESCE(EXCLUDED."${k}", ai_news_ex."${k}")`;
}

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
      'subject_region','region_tags','region_version',
    ]);

    let upserted = 0;
    let inserted = 0;
    let updated = 0;
    const touched: string[] = [];
    for (const raw of items) {
      if (!raw || typeof raw !== 'object') continue;
      const item: Record<string, unknown> = { ...raw };
      // 빈 source_url 은 NULL 로 — '' 끼리 UNIQUE 충돌하지 않도록
      if (typeof item.source_url === 'string') {
        item.source_url = item.source_url.trim() || null;
      }
      sanitizeRegionFields(item);

      const keys = Object.keys(item).filter(k => ALLOWED_COLS.has(k));
      if (!keys.length) continue;

      const conflictKey = item.source_url ? 'source_url' : item.id ? 'id' : null;

      const cols = keys.map(k => `"${k}"`).join(', ');
      const placeholders = keys.map((_, i) => `$${i + 1}`).join(', ');
      const updates = keys
        .filter(k => k !== 'id' && k !== 'source_url')
        .map(updateExpr)
        .join(', ');
      const vals = keys.map(k => {
        const v = item[k];
        if (TEXT_ARRAY_COLS.has(k)) return v;
        return Array.isArray(v) || (v !== null && typeof v === 'object')
          ? JSON.stringify(v) : v;
      });

      const onConflict = !conflictKey
        ? ''
        : updates
          ? `ON CONFLICT ("${conflictKey}") DO UPDATE SET ${updates}`
          : `ON CONFLICT ("${conflictKey}") DO NOTHING`;

      const { rows } = await pool.query(
        `INSERT INTO ai_news_ex (${cols}) VALUES (${placeholders})
         ${onConflict}
         RETURNING id, (xmax = 0) AS inserted`,
        vals
      );
      upserted++;
      if (rows[0]?.inserted) inserted++;
      else updated++;
      if (rows[0]?.id) touched.push(String(rows[0].id));
    }

    // 관련 기사(related_articles) 미리 계산 — 응답을 보낸 뒤(after) 돌므로 upsert 응답 시간은 그대로다.
    // 다른 기사들의 관련 기사는 "계산 뒤 새 기사" 조건으로 다음 조회 때 다시 계산된다 (src/lib/related.ts).
    await scheduleRelatedCompute(touched);

    return NextResponse.json({ ok: true, upserted, inserted, updated });
  } catch (e) {
    // DB 원문 에러를 응답에 실으면 스키마가 노출된다. 서버 로그에만 남긴다.
    console.error('[api/news/upsert]', e);
    return NextResponse.json(
      { ok: false, error: 'Upsert failed' },
      { status: 500 }
    );
  }
}

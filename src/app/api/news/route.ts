import { NextRequest, NextResponse } from 'next/server';
import { fetchNewsPage } from '@/lib/supabase';
import { parseFilters } from '@/lib/news-query';

// GET /api/news?offset=&limit=&q=&country=&categories=&from=&to=
// 응답: { items: NewsItem[], total: number }
//   total 은 "현재 필터 조건에 맞는 전체 건수"로, 로드된 개수와 다르다.
//   필터링은 전부 SQL에서 수행한다 (이전에는 브라우저에 로드된 것만 걸러 결과가 불완전했음).
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const offset = Math.max(parseInt(searchParams.get('offset') || '0', 10) || 0, 0);
  const limit = Math.min(
    Math.max(parseInt(searchParams.get('limit') || '30', 10) || 30, 1),
    100
  );

  try {
    const page = await fetchNewsPage(parseFilters(searchParams), offset, limit);
    return NextResponse.json(page);
  } catch (e) {
    console.error('[api/news]', e);
    return NextResponse.json({ items: [], total: 0 }, { status: 500 });
  }
}

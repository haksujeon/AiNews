import { NextResponse } from 'next/server';
import { fetchNewsFacets } from '@/lib/supabase';

// GET /api/news/facets
// 필터 드롭다운 선택지. 로드된 페이지가 아니라 테이블 전체 기준이어야
// "필터에 없어서 못 고르는" 상황이 생기지 않는다.
export async function GET() {
  try {
    return NextResponse.json(await fetchNewsFacets());
  } catch (e) {
    console.error('[api/news/facets]', e);
    return NextResponse.json({ countries: [], categories: [] }, { status: 500 });
  }
}

import { NextRequest, NextResponse } from 'next/server';
import { findRelated, RELATED_LIMIT } from '@/lib/related';

/**
 * 모달용 관련 기사. 상세 페이지와 같은 findRelated (src/lib/related.ts) — 같은 기사면 같은 id 목록.
 *   GET /api/news/related?id=<uuid>&limit=4   (예전 이름 exclude=<uuid> 도 받는다. category 는 더 이상 쓰지 않는다)
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id') || searchParams.get('exclude') || '';
  const n = Number.parseInt(searchParams.get('limit') ?? '', 10);
  const limit = Number.isFinite(n) ? n : RELATED_LIMIT;

  try {
    return NextResponse.json(await findRelated(id, { limit }));
  } catch {
    return NextResponse.json([], { status: 500 });
  }
}

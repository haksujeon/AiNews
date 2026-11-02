import { NextRequest, NextResponse } from 'next/server';
import { EMPTY_RELATED, findRelated } from '@/lib/related';

/**
 * 모달용 관련 기사. 상세 페이지와 같은 findRelated (src/lib/related.ts) — 같은 기사면 같은 묶음·같은 id.
 *   GET /api/news/related?id=<uuid>   (예전 이름 exclude=<uuid> 도 받는다. limit·category 는 더 이상 쓰지 않는다)
 *   → { sameEvent: RelatedItem[], flow: RelatedItem[], company: RelatedItem[] }  (묶음마다 0~3건)
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id') || searchParams.get('exclude') || '';

  try {
    return NextResponse.json(await findRelated(id));
  } catch (e) {
    console.error('[api/news/related]', e);
    return NextResponse.json(EMPTY_RELATED, { status: 500 });
  }
}

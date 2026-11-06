import { NextRequest, NextResponse } from 'next/server';
import { fetchNewsById } from '@/lib/supabase';
import { toPublicNewsItem } from '@/lib/news-gist';
import { withNewsFx } from '@/lib/fx/news';
import { isLocale } from '@/i18n/routing';

/**
 * 공개 상세 API. 상세 페이지·모달과 같은 조회(fetchNewsById)와 같은 정리(toPublicNewsItem)를 쓴다(Gate 2).
 * 번역 전문(content_kr/content_en)은 내보내지 않고 ?locale= 언어의 3~5문장 요지(gist)만 싣는다(P0-7).
 * locale 이 없거나 모르는 값이면 ko.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const requested = request.nextUrl.searchParams.get('locale') ?? 'ko';
  const locale = isLocale(requested) ? requested : 'ko';

  try {
    const news = await fetchNewsById(id);
    if (!news) return NextResponse.json(null, { status: 404 });
    // is_hidden 은 상세 페이지의 noindex 판단용이라 공개 API 에는 싣지 않는다(예전 응답과 같은 필드 구성).
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { is_hidden, ...item } = await withNewsFx(toPublicNewsItem(news, locale), locale);
    return NextResponse.json(item);
  } catch {
    return NextResponse.json(null, { status: 500 });
  }
}

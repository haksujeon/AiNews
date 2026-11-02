import { NextRequest, NextResponse } from 'next/server';
import { fetchNewsDays } from '@/lib/supabase';
import { isCalendarDate, parseFilters } from '@/lib/news-query';
import { NEWS_DAYS_PER_PAGE } from '@/lib/news-types';
import { isLocale } from '@/i18n/routing';

// GET /api/news/days?cursor=YYYY-MM-DD&limit=5&locale=ko&q=&country=&categories=&from=&to=
// 응답: { days: [{ date, total, top: RankedNewsItem[] }], total, nextCursor }
//   날짜(베이징 news_date) 단위 페이지. 각 날은 공용 순위(src/lib/news-rank.ts)의 주요 4건만 싣고,
//   나머지는 GET /api/news/days/[date] 로 펼칠 때 받는다. 필터는 순위 전에 적용된다(걸러진 기사 안에서 순위).
//   locale 은 그날 발행 브리핑(인용 기사 우선)의 언어판을 고르는 데만 쓴다.
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const cursorParam = searchParams.get('cursor') ?? '';
  // 형식뿐 아니라 실제 달력 날짜여야 커서로 쓴다 (2026-02-30 을 DB 로 보내면 500)
  const cursor = isCalendarDate(cursorParam) ? cursorParam : null;
  const limit = Math.min(
    Math.max(parseInt(searchParams.get('limit') || String(NEWS_DAYS_PER_PAGE), 10) || NEWS_DAYS_PER_PAGE, 1),
    10
  );
  const localeParam = searchParams.get('locale') ?? 'ko';
  const locale = isLocale(localeParam) ? localeParam : 'ko';

  try {
    const page = await fetchNewsDays(parseFilters(searchParams), locale, cursor, limit);
    return NextResponse.json(page);
  } catch (e) {
    console.error('[api/news/days]', e);
    return NextResponse.json({ error: 'news_days_failed' }, { status: 500 });
  }
}

import { NextRequest, NextResponse } from 'next/server';
import { fetchNewsDayRest } from '@/lib/supabase';
import { parseFilters } from '@/lib/news-query';
import { NEWS_DAY_EXCLUDE_MAX } from '@/lib/news-types';
import { isLocale } from '@/i18n/routing';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// GET /api/news/days/YYYY-MM-DD?exclude=id1,id2,…&locale=ko&q=&country=&categories=&from=&to=
// 응답: { date, total, items: RankedNewsItem[] }
//   그날(필터 적용) 기사 중 exclude(화면에 이미 보이는 주요 기사)를 뺀 전부를 공용 순위 순으로.
//   순위 순(최신순 아님)인 이유: news_date 는 날짜 단위라 하루 안에서 "최신"이 의미가 없고,
//   첫 화면 주요 4건의 다음 순위가 이어서 보이는 편이 자연스럽다.
export async function GET(request: NextRequest, { params }: { params: Promise<{ date: string }> }) {
  const { date } = await params;
  // 형식뿐 아니라 실제 달력 날짜인지도 본다 (2026-13-45 를 DB 로 보내면 500 이 된다)
  if (!DATE_RE.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`)) || new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date) {
    return NextResponse.json({ error: 'invalid_date' }, { status: 400 });
  }
  const { searchParams } = new URL(request.url);
  const exclude = (searchParams.get('exclude') ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => UUID_RE.test(s))
    .slice(0, NEWS_DAY_EXCLUDE_MAX);
  const localeParam = searchParams.get('locale') ?? 'ko';
  const locale = isLocale(localeParam) ? localeParam : 'ko';

  try {
    return NextResponse.json(await fetchNewsDayRest(parseFilters(searchParams), locale, date, exclude));
  } catch (e) {
    console.error('[api/news/days/date]', e);
    return NextResponse.json({ error: 'news_day_failed' }, { status: 500 });
  }
}

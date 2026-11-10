import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { isLocale } from "@/i18n/routing";
import { fetchNewsById } from "@/lib/supabase";
import { formatDate, getCategoryLabel, getSourceName, getTitle } from "@/lib/news-utils";
import { OG_CONTENT_TYPE, OG_SIZE, renderOgCard, siteLabel } from "@/lib/seo/og-card";
import { rootUrl } from "@/lib/site";

// 기사 공유 카드: 자체 생성(브랜드·분류·제목·매체·날짜). 원문 이미지는 쓰지 않는다(결정 D3).
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;
export const alt = "SDSC AI NEWS";

export default async function Image({ params }: { params: Promise<{ locale: string; id: string }> }) {
  const { locale, id } = await params;
  if (!isLocale(locale)) notFound();
  const news = await fetchNewsById(id);
  if (!news) notFound();
  const tm = await getTranslations({ locale, namespace: "meta" });
  return renderOgCard({
    locale,
    brand: tm("brand"),
    kicker: news.category ? getCategoryLabel(news.category, locale) : tm("brand"),
    title: getTitle(news, locale),
    meta: [getSourceName(news.source_name), news.news_date ? formatDate(news.news_date, locale) : null],
    site: siteLabel(rootUrl()),
  });
}

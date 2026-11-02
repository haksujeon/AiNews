import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { isLocale } from "@/i18n/routing";
import { isValidEditionDate } from "@/lib/briefing/generate";
import { getPublishedBriefing } from "@/lib/briefing/public";
import { formatDate } from "@/lib/news-utils";
import { OG_CONTENT_TYPE, OG_SIZE, renderOgCard, siteLabel } from "@/lib/seo/og-card";
import { rootUrl } from "@/lib/site";

// 브리핑 공유 카드: 발행본이 있으면 헤드라인, 없으면(다른 언어판만 있음·아직 발행 전) 날짜와 소개 문구.
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;
export const alt = "AI NEWS";

export default async function Image({ params }: { params: Promise<{ locale: string; date: string }> }) {
  const { locale, date } = await params;
  if (!isLocale(locale) || !isValidEditionDate(date)) notFound();
  const [briefing, tm, ts] = await Promise.all([
    getPublishedBriefing(locale, date),
    getTranslations({ locale, namespace: "meta" }),
    getTranslations({ locale, namespace: "seo" }),
  ]);
  return renderOgCard({
    locale,
    brand: tm("brand"),
    kicker: ts("ogBriefingKicker"),
    title: briefing?.content.headline || ts("ogBriefingFallback"),
    meta: [formatDate(date, locale)],
    site: siteLabel(rootUrl()),
  });
}

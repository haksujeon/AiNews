import type { Metadata } from "next";
import { Suspense } from "react";
import { permanentRedirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { fetchNewsDays } from "@/lib/supabase";
import { EMPTY_FILTERS } from "@/lib/news-query";
import { parseRegionChip } from "@/lib/region";
import { absoluteUrl, languageAlternates } from "@/lib/site";
import { isLocale } from "@/i18n/routing";
import { getPublishedBriefing } from "@/lib/briefing/public";
import { fetchLatestBatch } from "@/lib/today";
import { Header } from "@/components/layout/header";
import { Footer } from "@/components/layout/footer";
import { DayBriefingDialog } from "@/components/news/day-briefing-dialog";
import { TodayLive } from "@/components/today/today-live";
import { TodayBriefing } from "@/components/today/today-briefing";
import { TodayTopNews } from "@/components/today/today-top-news";
import { IntroStrip } from "@/components/today/intro-strip";

/**
 * 홈 = "오늘" (2026-11-03 메뉴 개편). 무엇이 중요한가: LIVE 수집 띠 · 브리핑 콘솔(주요 기사 펼치기) · 숫자·기업·용어 · 주요 뉴스.
 * 예전 홈의 날짜별 목록은 /news 로 옮겼다.
 *  - /?region=X → /news?region=X (308, 지역 칩 공유 링크 유지)
 *  - /?briefing=YYYY-MM-DD → 이 화면에서도 같은 팝업 (이미 퍼진 링크)
 * DB 오류가 나도 부분만 숨기고 화면은 그린다.
 */
export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  return {
    alternates: {
      canonical: absoluteUrl(locale),
      languages: languageAlternates(),
    },
  };
}

export default async function TodayPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await params;
  const sp = await searchParams;
  if (typeof sp.region === "string") {
    const region = parseRegionChip(sp.region);
    permanentRedirect(region === "ALL" ? `/${locale}/news` : `/${locale}/news?region=${region}`);
  }
  const t = await getTranslations({ locale, namespace: "today" });
  const [briefing, batch, page] = await Promise.all([
    isLocale(locale)
      ? getPublishedBriefing(locale).catch((e) => {
          console.warn("[today] briefing", e);
          return null;
        })
      : Promise.resolve(null),
    fetchLatestBatch(3).catch((e) => {
      console.warn("[today] latest batch", e);
      return { lastAt: null, count: 0, items: [] };
    }),
    fetchNewsDays(EMPTY_FILTERS, locale, null, 1).catch((e) => {
      console.warn("[today] top news", e);
      return null;
    }),
  ]);

  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      <IntroStrip />
      <TodayLive batch={batch} locale={locale} />
      <main className="flex-1 container mx-auto space-y-10 px-4 py-6 sm:py-8">
        <h1 className="sr-only">{t("pageTitle")}</h1>
        <TodayBriefing briefing={briefing} locale={locale} />
        <TodayTopNews day={page?.days[0]} locale={locale} />
      </main>
      <Footer />
      {/* ?briefing= 팝업 (뉴스 목록과 같은 대화상자). useSearchParams 를 쓰므로 Suspense 안 */}
      <Suspense fallback={null}>
        <DayBriefingDialog />
      </Suspense>
    </div>
  );
}

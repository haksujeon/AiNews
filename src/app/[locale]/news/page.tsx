import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { fetchNewsDays, fetchNewsFacets } from "@/lib/supabase";
import { EMPTY_FILTERS } from "@/lib/news-query";
import { parseRegionChip } from "@/lib/region";
import { absoluteUrl, languageAlternates } from "@/lib/site";
import { Header } from "@/components/layout/header";
import { Footer } from "@/components/layout/footer";
import { NewsContainer } from "@/components/news/news-container";
import { BriefingBanner } from "@/components/briefing/briefing-banner";

/**
 * 뉴스 (2026-11-03 메뉴 개편): 날짜별 기사 목록·검색·필터. 예전 홈(/)의 목록을 그대로 옮겼다 — 홈은 "오늘".
 * 주소: ?region=CN|US|OTHER (지역 칩 공유), ?q= (헤더·하단 탭 검색), ?focus=search (휴대폰 "검색" 탭 → 검색창 커서).
 * 기사는 /news/[id] — 소프트 이동이면 @modal/(.)news/[id] 가 팝업으로 가로챈다(이 페이지에서도 같다).
 */
const Q_MAX = 100;

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "meta" });
  return {
    title: t("newsTitle"),
    description: t("newsDescription"),
    alternates: {
      canonical: absoluteUrl(locale, "/news"),
      languages: languageAlternates("/news"),
    },
  };
}

export default async function NewsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "list" });
  const sp = await searchParams;
  const region = parseRegionChip(typeof sp.region === "string" ? sp.region : null);
  const q = typeof sp.q === "string" ? sp.q.trim().slice(0, Q_MAX) : "";
  const focus = sp.focus === "search";
  // 필터 선택지는 테이블 전체 기준. 목록 첫 페이지: 최근 5일, 날마다 공용 순위의 주요 4건
  const [page, facets] = await Promise.all([fetchNewsDays({ ...EMPTY_FILTERS, region, q }, locale), fetchNewsFacets()]);

  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      <main className="flex-1 container mx-auto px-4 py-8">
        <h1 className="mb-4 text-[22px] font-[760] tracking-[-0.015em] text-ink sm:text-[26px]">{t("pageTitle")}</h1>
        {/* 최신 브리핑 한 줄 띠 (예전 홈과 같은 부품) */}
        <BriefingBanner locale={locale} />
        <NewsContainer initialPage={page} facets={facets} initialRegion={region} initialQuery={q} autoFocusSearch={focus} />
      </main>
      <Footer />
    </div>
  );
}

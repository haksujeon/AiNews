import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { fetchNewsDays, fetchNewsFacets } from "@/lib/supabase";
import { parseFilters, parseNewsView } from "@/lib/news-query";
import { absoluteUrl, languageAlternates } from "@/lib/site";
import { Header } from "@/components/layout/header";
import { Footer } from "@/components/layout/footer";
import { NewsContainer } from "@/components/news/news-container";
import { BriefingBanner } from "@/components/briefing/briefing-banner";

/**
 * 뉴스 (2026-11-03 메뉴 개편): 날짜별 기사 목록·검색·필터. 예전 홈(/)의 목록을 그대로 옮겼다 — 홈은 "오늘".
 * 주소: ?q= ?region=CN|US|OTHER ?categories=a,b ?from= ?to= ?view=list — 필터·보기 방식을 주소에 남겨 공유·새로고침에도 유지(QA B-02,
 *   읽기 규칙은 API 와 같은 parseFilters), ?focus=search (휴대폰 "검색" 탭 → 검색창 커서).
 * 기사는 /news/[id] — 소프트 이동이면 @modal/(.)news/[id] 가 팝업으로 가로챈다(이 페이지에서도 같다).
 */
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
  const usp = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) if (typeof v === "string") usp.set(k, v);
  const filters = parseFilters(usp);
  const view = parseNewsView(usp.get("view"));
  const focus = sp.focus === "search";
  // 필터 선택지는 테이블 전체 기준. 목록 첫 페이지: 최근 5일, 날마다 공용 순위의 주요 4건 (주소의 필터를 걸어서)
  const [page, facets] = await Promise.all([fetchNewsDays(filters, locale), fetchNewsFacets()]);

  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      <main id="main" tabIndex={-1} className="scroll-mt-16 outline-none flex-1 container mx-auto px-4 py-8">
        <h1 className="mb-4 text-[22px] font-[760] tracking-[-0.015em] text-ink sm:text-[26px]">{t("pageTitle")}</h1>
        {/* 최신 브리핑 한 줄 띠 (예전 홈과 같은 부품) */}
        <BriefingBanner locale={locale} />
        <NewsContainer initialPage={page} facets={facets} initialFilters={filters} initialView={view} autoFocusSearch={focus} />
      </main>
      <Footer />
    </div>
  );
}

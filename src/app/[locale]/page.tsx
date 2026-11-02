import type { Metadata } from "next";
import { fetchNewsDays, fetchNewsFacets } from "@/lib/supabase";
import { EMPTY_FILTERS } from "@/lib/news-query";
import { parseRegionChip } from "@/lib/region";
import { absoluteUrl, languageAlternates } from "@/lib/site";
import { Header } from "@/components/layout/header";
import { Footer } from "@/components/layout/footer";
import { NewsContainer } from "@/components/news/news-container";
import { BriefingBanner } from "@/components/briefing/briefing-banner";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  return {
    alternates: {
      canonical: absoluteUrl(locale),
      languages: languageAlternates(),
    },
  };
}

export default async function HomePage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await params;
  // 지역 칩은 주소(?region=CN|US|OTHER)로 공유된다 — 첫 화면부터 그 칩으로 걸러 보낸다
  const sp = await searchParams;
  const region = parseRegionChip(typeof sp.region === "string" ? sp.region : null);
  // 필터 선택지는 테이블 전체 기준으로 뽑아 초기 렌더에 함께 넘긴다.
  // (예전에는 로드된 30건에서 추출해 고를 수 있는 항목이 누락됐다)
  // 목록 첫 페이지: 최근 5일, 날마다 공용 순위의 주요 4건 (나머지는 펼칠 때 받는다)
  const [page, facets] = await Promise.all([fetchNewsDays({ ...EMPTY_FILTERS, region }, locale), fetchNewsFacets()]);

  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      <main className="flex-1 container mx-auto px-4 py-8">
        {/* 발행된 브리핑이 있을 때만 한 줄 띠 */}
        <BriefingBanner locale={locale} />
        <NewsContainer initialPage={page} facets={facets} initialRegion={region} />
      </main>
      <Footer />
    </div>
  );
}

import type { Metadata } from "next";
import { fetchNewsPage, fetchNewsFacets } from "@/lib/supabase";
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
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  // 필터 선택지는 테이블 전체 기준으로 뽑아 초기 렌더에 함께 넘긴다.
  // (예전에는 로드된 30건에서 추출해 고를 수 있는 항목이 누락됐다)
  const [page, facets] = await Promise.all([fetchNewsPage(), fetchNewsFacets()]);

  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      <main className="flex-1 container mx-auto px-4 py-8">
        {/* 발행된 브리핑이 있을 때만 한 줄 띠 */}
        <BriefingBanner locale={locale} />
        <NewsContainer
          news={page.items}
          initialTotal={page.total}
          facets={facets}
        />
      </main>
      <Footer />
    </div>
  );
}

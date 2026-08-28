import { fetchNewsPage, fetchNewsFacets } from "@/lib/supabase";
import { Header } from "@/components/layout/header";
import { Footer } from "@/components/layout/footer";
import { NewsContainer } from "@/components/news/news-container";

export default async function HomePage() {
  // 필터 선택지는 테이블 전체 기준으로 뽑아 초기 렌더에 함께 넘긴다.
  // (예전에는 로드된 30건에서 추출해 고를 수 있는 항목이 누락됐다)
  const [page, facets] = await Promise.all([fetchNewsPage(), fetchNewsFacets()]);

  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      <main className="flex-1 container mx-auto px-4 py-8">
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

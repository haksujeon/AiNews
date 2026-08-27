import { notFound } from "next/navigation";
import { fetchNewsById, fetchRelatedNews } from "@/lib/supabase";
import { Header } from "@/components/layout/header";
import { Footer } from "@/components/layout/footer";
import { NewsDetail } from "@/components/news/news-detail";

interface Props {
  params: Promise<{ locale: string; id: string }>;
}

export default async function NewsDetailPage({ params }: Props) {
  const { id } = await params;
  const news = await fetchNewsById(id);

  if (!news) {
    notFound();
  }

  const relatedNews = await fetchRelatedNews(news.id, news.country, news.category);

  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      <main className="flex-1 container mx-auto px-4 py-8">
        <NewsDetail news={news} relatedNews={relatedNews} />
      </main>
      <Footer />
    </div>
  );
}

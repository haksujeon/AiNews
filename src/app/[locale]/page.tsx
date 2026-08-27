import { fetchNewsList } from "@/lib/supabase";
import { Header } from "@/components/layout/header";
import { Footer } from "@/components/layout/footer";
import { NewsContainer } from "@/components/news/news-container";

export default async function HomePage() {
  const news = await fetchNewsList();

  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      <main className="flex-1 container mx-auto px-4 py-8">
        <NewsContainer news={news} />
      </main>
      <Footer />
    </div>
  );
}

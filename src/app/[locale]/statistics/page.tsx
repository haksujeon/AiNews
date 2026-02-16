import { fetchNewsList } from "@/lib/supabase";
import { Header } from "@/components/layout/header";
import { Footer } from "@/components/layout/footer";
import { StatisticsContainer } from "@/components/statistics/statistics-container";

export default async function StatisticsPage() {
  const news = await fetchNewsList();

  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      <main className="flex-1 container mx-auto px-4 py-8">
        <StatisticsContainer news={news} />
      </main>
      <Footer />
    </div>
  );
}

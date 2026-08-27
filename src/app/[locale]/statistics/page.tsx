import { fetchNewsForStats } from "@/lib/supabase";
import { Header } from "@/components/layout/header";
import { Footer } from "@/components/layout/footer";
import { StatisticsContainer } from "@/components/statistics/statistics-container";

export default async function StatisticsPage() {
  const news = await fetchNewsForStats();

  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      <main className="flex-1 container mx-auto px-4 py-8">
        <StatisticsContainer news={news} today={new Date().toISOString().split("T")[0]} />
      </main>
      <Footer />
    </div>
  );
}

import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { fetchNewsStatistics } from "@/lib/supabase";
import { absoluteUrl, languageAlternates } from "@/lib/site";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "meta" });
  return {
    title: t("statisticsTitle"),
    alternates: {
      canonical: absoluteUrl(locale, "/statistics"),
      languages: languageAlternates("/statistics"),
    },
  };
}
import { Header } from "@/components/layout/header";
import { Footer } from "@/components/layout/footer";
import { StatisticsContainer } from "@/components/statistics/statistics-container";

export default async function StatisticsPage() {
  // 집계는 전부 SQL 에서 — 홈 목록 총계와 같은 모집단(중복·숨김 제외 전체)
  const stats = await fetchNewsStatistics();

  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      <main className="flex-1 container mx-auto px-4 py-8">
        <StatisticsContainer stats={stats} />
      </main>
      <Footer />
    </div>
  );
}

import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { fetchNewsForStats } from "@/lib/supabase";
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

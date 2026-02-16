"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import type { NewsItem } from "@/lib/supabase";
import {
  calculateCategoryStats,
  calculateSentimentStats,
  calculateCountryStats,
  calculateDailyVolume,
  calculateKPIs,
} from "@/lib/statistics-utils";
import { StatCards } from "./stat-cards";
import { CategoryChart } from "./category-chart";
import { SentimentChart } from "./sentiment-chart";
import { CountryChart } from "./country-chart";
import { DailyVolumeChart } from "./daily-volume-chart";

interface StatisticsContainerProps {
  news: NewsItem[];
}

export function StatisticsContainer({ news }: StatisticsContainerProps) {
  const t = useTranslations("statistics");

  const kpis = useMemo(() => calculateKPIs(news), [news]);
  const categoryStats = useMemo(() => calculateCategoryStats(news), [news]);
  const sentimentStats = useMemo(() => calculateSentimentStats(news), [news]);
  const countryStats = useMemo(() => calculateCountryStats(news), [news]);
  const dailyVolume = useMemo(() => calculateDailyVolume(news), [news]);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">{t("title")}</h1>

      <StatCards data={kpis} />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <CategoryChart data={categoryStats} />
        <SentimentChart data={sentimentStats} />
        <CountryChart data={countryStats} />
        <DailyVolumeChart data={dailyVolume} />
      </div>
    </div>
  );
}

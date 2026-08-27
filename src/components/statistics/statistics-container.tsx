"use client";

import { useMemo } from "react";
import { useLocale, useTranslations } from "next-intl";
import type { NewsItem } from "@/lib/supabase";
import {
  calculateCategoryStats,
  calculateSentimentStats,
  calculateDailyVolume,
  calculateSourceStats,
  calculateKeywordStats,
  calculateWeeklyTrend,
  calculateKPIs,
} from "@/lib/statistics-utils";
import { StatCards } from "./stat-cards";
import { CategoryChart } from "./category-chart";
import { SentimentChart } from "./sentiment-chart";
import { DailyVolumeChart } from "./daily-volume-chart";
import { SourceChart } from "./source-chart";
import { KeywordChart } from "./keyword-chart";
import { WeeklyTrendChart } from "./weekly-trend-chart";

interface StatisticsContainerProps {
  news: NewsItem[];
  today: string;
}

export function StatisticsContainer({ news, today }: StatisticsContainerProps) {
  const t = useTranslations("statistics");
  const locale = useLocale();

  const kpis = useMemo(() => calculateKPIs(news, today), [news, today]);
  const categoryStats = useMemo(() => calculateCategoryStats(news, locale), [news, locale]);
  const sentimentStats = useMemo(() => calculateSentimentStats(news), [news]);
  const dailyVolume = useMemo(() => calculateDailyVolume(news), [news]);
  const sourceStats = useMemo(() => calculateSourceStats(news), [news]);
  const keywordStats = useMemo(() => calculateKeywordStats(news), [news]);
  const weeklyTrend = useMemo(() => calculateWeeklyTrend(news), [news]);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">{t("title")}</h1>

      <StatCards data={kpis} />

      {/* Daily volume - full width */}
      <DailyVolumeChart data={dailyVolume} />

      {/* Charts grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <CategoryChart data={categoryStats} />
        <SentimentChart data={sentimentStats} />
        <SourceChart data={sourceStats} />
        <WeeklyTrendChart data={weeklyTrend} />
      </div>

      {/* Keywords - full width */}
      <KeywordChart data={keywordStats} />
    </div>
  );
}

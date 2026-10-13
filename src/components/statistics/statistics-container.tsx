"use client";

import { useMemo } from "react";
import { useLocale, useTranslations } from "next-intl";
import {
  toCategoryStats,
  toSentimentStats,
  type StatisticsData,
} from "@/lib/statistics-utils";
import { StatCards } from "./stat-cards";
import { CategoryChart } from "./category-chart";
import { SentimentChart } from "./sentiment-chart";
import { DailyVolumeChart } from "./daily-volume-chart";
import { SourceChart } from "./source-chart";
import { KeywordChart } from "./keyword-chart";
import { WeeklyTrendChart } from "./weekly-trend-chart";

interface StatisticsContainerProps {
  /** 서버(SQL)에서 집계된 통계 — fetchNewsStatistics() */
  stats: StatisticsData;
}

export function StatisticsContainer({ stats }: StatisticsContainerProps) {
  const t = useTranslations("statistics");
  const locale = useLocale();

  const kpis = stats.kpis;
  const categoryStats = useMemo(() => toCategoryStats(stats.categories, locale), [stats.categories, locale]);
  const sentimentStats = useMemo(() => toSentimentStats(stats.sentiments), [stats.sentiments]);
  const dailyVolume = stats.daily;
  const sourceStats = stats.sources;
  const keywordStats = stats.keywords;
  const weeklyTrend = stats.weekly;

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

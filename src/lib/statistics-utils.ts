import type { NewsItem } from "@/lib/supabase";

export interface CategoryStat {
  name: string;
  value: number;
  color: string;
}

export interface SentimentStat {
  name: string;
  value: number;
  color: string;
}

export interface CountryStat {
  name: string;
  value: number;
  label: string;
}

export interface DailyVolume {
  date: string;
  count: number;
}

export interface KPIData {
  totalNews: number;
  todayNews: number;
  categoryCount: number;
  countryCount: number;
}

const CATEGORY_COLORS: Record<string, string> = {
  industry: "#3b82f6",
  policy: "#a855f7",
  research: "#10b981",
  investment: "#f59e0b",
  product: "#06b6d4",
  culture: "#ec4899",
  education: "#f97316",
};

const SENTIMENT_COLORS: Record<string, string> = {
  positive: "#22c55e",
  negative: "#ef4444",
  neutral: "#9ca3af",
};

const COUNTRY_LABELS: Record<string, string> = {
  KR: "🇰🇷 Korea",
  US: "🇺🇸 US",
  CN: "🇨🇳 China",
  JP: "🇯🇵 Japan",
};

export function calculateCategoryStats(news: NewsItem[]): CategoryStat[] {
  const counts: Record<string, number> = {};
  for (const item of news) {
    const cat = item.category || "other";
    counts[cat] = (counts[cat] || 0) + 1;
  }
  return Object.entries(counts)
    .map(([name, value]) => ({
      name,
      value,
      color: CATEGORY_COLORS[name] || "#6b7280",
    }))
    .sort((a, b) => b.value - a.value);
}

export function calculateSentimentStats(news: NewsItem[]): SentimentStat[] {
  const counts: Record<string, number> = {};
  for (const item of news) {
    const sent = item.sentiment || "neutral";
    counts[sent] = (counts[sent] || 0) + 1;
  }
  return Object.entries(counts)
    .map(([name, value]) => ({
      name,
      value,
      color: SENTIMENT_COLORS[name] || "#9ca3af",
    }))
    .sort((a, b) => b.value - a.value);
}

export function calculateCountryStats(news: NewsItem[]): CountryStat[] {
  const counts: Record<string, number> = {};
  for (const item of news) {
    const country = item.country || "unknown";
    counts[country] = (counts[country] || 0) + 1;
  }
  return Object.entries(counts)
    .map(([name, value]) => ({
      name,
      value,
      label: COUNTRY_LABELS[name] || name,
    }))
    .sort((a, b) => b.value - a.value);
}

export function calculateDailyVolume(news: NewsItem[]): DailyVolume[] {
  const counts: Record<string, number> = {};
  for (const item of news) {
    const date = item.news_date || "unknown";
    if (date !== "unknown") {
      counts[date] = (counts[date] || 0) + 1;
    }
  }
  return Object.entries(counts)
    .map(([date, count]) => ({ date, count }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

export function calculateKPIs(news: NewsItem[], today?: string): KPIData {
  const todayStr = today ?? new Date().toISOString().split("T")[0];
  const categories = new Set<string>();
  const countries = new Set<string>();
  let todayCount = 0;

  for (const item of news) {
    if (item.category) categories.add(item.category);
    if (item.country) countries.add(item.country);
    if (item.news_date === todayStr) todayCount++;
  }

  return {
    totalNews: news.length,
    todayNews: todayCount,
    categoryCount: categories.size,
    countryCount: countries.size,
  };
}

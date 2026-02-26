import type { NewsItem } from "@/lib/supabase";

export interface CategoryStat {
  name: string;
  label: string;
  value: number;
  color: string;
}

export interface SentimentStat {
  name: string;
  value: number;
  color: string;
}

export interface DailyVolume {
  date: string;
  count: number;
}

export interface SourceStat {
  name: string;
  value: number;
}

export interface KeywordStat {
  term: string;
  count: number;
}

export interface WeeklyTrend {
  week: string;
  count: number;
  avg: number;
}

export interface KPIData {
  totalNews: number;
  todayNews: number;
  categoryCount: number;
  sourceCount: number;
  avgPerDay: number;
  aiRatio: number;
}

const CATEGORY_COLORS: Record<string, string> = {
  "ai-tech": "#06b6d4",
  "ai-product": "#3b82f6",
  "ai-biz": "#8b5cf6",
  politics: "#ef4444",
  economy: "#f59e0b",
  society: "#10b981",
  culture: "#ec4899",
  tech: "#f97316",
};

const CATEGORY_LABELS: Record<string, Record<string, string>> = {
  "ai-tech": { ko: "AI 기술", en: "AI Tech", zh: "AI技术" },
  "ai-product": { ko: "AI 제품", en: "AI Products", zh: "AI产品" },
  "ai-biz": { ko: "AI 비즈니스", en: "AI Business", zh: "AI商业" },
  politics: { ko: "정치", en: "Politics", zh: "政治" },
  economy: { ko: "경제", en: "Economy", zh: "经济" },
  society: { ko: "사회", en: "Society", zh: "社会" },
  culture: { ko: "문화", en: "Culture", zh: "文化" },
  tech: { ko: "IT/과학", en: "Tech & Science", zh: "科技" },
};

const SENTIMENT_COLORS: Record<string, string> = {
  positive: "#22c55e",
  negative: "#ef4444",
  neutral: "#9ca3af",
};

export function calculateCategoryStats(news: NewsItem[], locale: string = "ko"): CategoryStat[] {
  const counts: Record<string, number> = {};
  for (const item of news) {
    const cat = item.category || "other";
    counts[cat] = (counts[cat] || 0) + 1;
  }
  return Object.entries(counts)
    .map(([name, value]) => ({
      name,
      label: CATEGORY_LABELS[name]?.[locale] ?? name,
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

export function calculateSourceStats(news: NewsItem[]): SourceStat[] {
  const counts: Record<string, number> = {};
  for (const item of news) {
    const source = item.source_name || "Unknown";
    counts[source] = (counts[source] || 0) + 1;
  }
  return Object.entries(counts)
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 10);
}

export function calculateKeywordStats(news: NewsItem[]): KeywordStat[] {
  const counts: Record<string, number> = {};
  for (const item of news) {
    if (item.key_terms) {
      for (const kt of item.key_terms) {
        if (kt.term) {
          counts[kt.term] = (counts[kt.term] || 0) + 1;
        }
      }
    }
  }
  return Object.entries(counts)
    .map(([term, count]) => ({ term, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 15);
}

export function calculateWeeklyTrend(news: NewsItem[]): WeeklyTrend[] {
  const daily = calculateDailyVolume(news);
  if (daily.length === 0) return [];

  const weeks: Record<string, number[]> = {};
  for (const d of daily) {
    const date = new Date(d.date + "T00:00:00");
    const dayOfWeek = date.getDay();
    const monday = new Date(date);
    monday.setDate(date.getDate() - ((dayOfWeek + 6) % 7));
    const weekKey = monday.toISOString().split("T")[0];
    if (!weeks[weekKey]) weeks[weekKey] = [];
    weeks[weekKey].push(d.count);
  }

  return Object.entries(weeks)
    .map(([week, counts]) => ({
      week,
      count: counts.reduce((a, b) => a + b, 0),
      avg: Math.round((counts.reduce((a, b) => a + b, 0) / counts.length) * 10) / 10,
    }))
    .sort((a, b) => a.week.localeCompare(b.week));
}

export function calculateKPIs(news: NewsItem[], today?: string): KPIData {
  const todayStr = today ?? new Date().toISOString().split("T")[0];
  const categories = new Set<string>();
  const sources = new Set<string>();
  let todayCount = 0;
  let aiCount = 0;

  const dates = new Set<string>();
  for (const item of news) {
    if (item.category) {
      categories.add(item.category);
      if (item.category.startsWith("ai-")) aiCount++;
    }
    if (item.source_name) sources.add(item.source_name);
    if (item.news_date) dates.add(item.news_date);
    if (item.news_date === todayStr) todayCount++;
  }

  const avgPerDay = dates.size > 0 ? Math.round((news.length / dates.size) * 10) / 10 : 0;
  const aiRatio = news.length > 0 ? Math.round((aiCount / news.length) * 100) : 0;

  return {
    totalNews: news.length,
    todayNews: todayCount,
    categoryCount: categories.size,
    sourceCount: sources.size,
    avgPerDay,
    aiRatio,
  };
}

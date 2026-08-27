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

/**
 * DB 레이어(supabase.ts / api/news)는 news_date를 to_char로 "2026-05-09T00:00:00Z"
 * 형태의 ISO 문자열로 반환한다. 통계 계산은 전부 "YYYY-MM-DD" 날짜 키를 전제로 하므로
 * 이 경계 함수에서 한 번만 정규화한다.
 */
export function toDateKey(value: string | null | undefined): string | null {
  if (!value) return null;
  const key = value.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(key) ? key : null;
}

export function calculateDailyVolume(news: NewsItem[]): DailyVolume[] {
  const counts: Record<string, number> = {};
  for (const item of news) {
    const date = toDateKey(item.news_date);
    if (date) {
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
    if (Number.isNaN(date.getTime())) continue;
    const dayOfWeek = date.getDay();
    const monday = new Date(date);
    monday.setDate(date.getDate() - ((dayOfWeek + 6) % 7));
    // 로컬 자정으로 파싱했으므로 toISOString()을 쓰면 KST(+9)에서 하루 밀린다.
    // 로컬 기준으로 직접 포맷한다.
    const weekKey = [
      monday.getFullYear(),
      String(monday.getMonth() + 1).padStart(2, "0"),
      String(monday.getDate()).padStart(2, "0"),
    ].join("-");
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
    const dateKey = toDateKey(item.news_date);
    if (dateKey) {
      dates.add(dateKey);
      if (dateKey === todayStr) todayCount++;
    }
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

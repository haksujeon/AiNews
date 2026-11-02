import { getCategoryLabel } from "./news-utils";
import type { RegionCounts } from "./metrics/period";

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
  // 로봇(categories.ts 에 추가되면 공개): 기존 AI 색과 구분되는 앰버 계열
  robotics: "#b45309",
  politics: "#ef4444",
  economy: "#f59e0b",
  society: "#10b981",
  culture: "#ec4899",
  tech: "#f97316",
};

const SENTIMENT_COLORS: Record<string, string> = {
  positive: "#22c55e",
  negative: "#ef4444",
  neutral: "#9ca3af",
};

/** SQL GROUP BY 결과 한 줄 (fetchNewsStatistics) */
export interface CountRow {
  name: string;
  value: number;
}

/**
 * 통계 페이지 데이터. 전부 서버(SQL)에서 집계한 값이다 — src/lib/supabase.ts fetchNewsStatistics.
 * 카테고리 라벨·색상만 로케일에 따라 클라이언트에서 입힌다.
 */
export interface StatisticsData {
  kpis: KPIData;
  categories: CountRow[];
  sentiments: CountRow[];
  sources: SourceStat[];
  keywords: KeywordStat[];
  /** 기사 없는 날은 0 으로 채운 연속 일자 (YYYY-MM-DD 오름차순) */
  daily: DailyVolume[];
  weekly: WeeklyTrend[];
  /** 대상 지역 비중 — 홈 지역 칩·주간/월간 리포트와 같은 regionCounts (src/lib/metrics/period.ts) */
  regions: RegionCounts;
}

export function toCategoryStats(rows: CountRow[], locale: string = "ko"): CategoryStat[] {
  return rows.map(({ name, value }) => ({
    name,
    // 라벨은 목록·키커와 같은 표(news-utils getCategoryLabel)를 쓴다 (Gate 2)
    label: getCategoryLabel(name, locale),
    value,
    color: CATEGORY_COLORS[name] || "#6b7280",
  }));
}

export function toSentimentStats(rows: CountRow[]): SentimentStat[] {
  return rows.map(({ name, value }) => ({
    name,
    value,
    color: SENTIMENT_COLORS[name] || "#9ca3af",
  }));
}

/** "YYYY-MM-DD" → 그 주 월요일 "YYYY-MM-DD". UTC 로 계산해 서버 시간대와 무관하다. */
function mondayOf(dateKey: string): string | null {
  const d = new Date(`${dateKey}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}

/**
 * 0 으로 채워진 일별 건수를 월요일 기준 주 단위로 묶는다.
 * avg 는 그 주에서 구간에 포함된 날 수로 나눈 일평균(기사 없는 날 포함).
 */
export function buildWeeklyTrend(daily: DailyVolume[]): WeeklyTrend[] {
  const weeks = new Map<string, { sum: number; days: number }>();
  for (const d of daily) {
    const week = mondayOf(d.date);
    if (!week) continue;
    const w = weeks.get(week) ?? { sum: 0, days: 0 };
    w.sum += d.count;
    w.days += 1;
    weeks.set(week, w);
  }
  return Array.from(weeks.entries())
    .map(([week, { sum, days }]) => ({
      week,
      count: sum,
      avg: Math.round((sum / days) * 10) / 10,
    }))
    .sort((a, b) => a.week.localeCompare(b.week));
}

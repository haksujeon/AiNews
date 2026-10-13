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
}

export function toCategoryStats(rows: CountRow[], locale: string = "ko"): CategoryStat[] {
  return rows.map(({ name, value }) => ({
    name,
    label: CATEGORY_LABELS[name]?.[locale] ?? name,
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

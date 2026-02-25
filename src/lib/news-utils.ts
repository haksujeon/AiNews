import type { NewsItem } from "@/lib/supabase";

// ─── Country ─────────────────────────────────────────────
const COUNTRY_LABELS: Record<string, string> = {
  KR: "🇰🇷 한국",
  US: "🇺🇸 US",
  CN: "🇨🇳 中国",
  JP: "🇯🇵 日本",
};

export function getCountryLabel(code: string): string {
  return COUNTRY_LABELS[code] ?? code;
}

// ─── FR-01: Category color/icon mapping ──────────────────
export type CategoryStyle = {
  bg: string;
  text: string;
  border: string;
  gradient: string;
  icon: string;
};

const CATEGORY_STYLES: Record<string, CategoryStyle> = {
  industry: {
    bg: "bg-blue-100 dark:bg-blue-950",
    text: "text-blue-700 dark:text-blue-300",
    border: "border-blue-300 dark:border-blue-700",
    gradient: "from-blue-500 to-blue-700",
    icon: "Factory",
  },
  policy: {
    bg: "bg-purple-100 dark:bg-purple-950",
    text: "text-purple-700 dark:text-purple-300",
    border: "border-purple-300 dark:border-purple-700",
    gradient: "from-purple-500 to-purple-700",
    icon: "Landmark",
  },
  research: {
    bg: "bg-emerald-100 dark:bg-emerald-950",
    text: "text-emerald-700 dark:text-emerald-300",
    border: "border-emerald-300 dark:border-emerald-700",
    gradient: "from-emerald-500 to-emerald-700",
    icon: "FlaskConical",
  },
  investment: {
    bg: "bg-amber-100 dark:bg-amber-950",
    text: "text-amber-700 dark:text-amber-300",
    border: "border-amber-300 dark:border-amber-700",
    gradient: "from-amber-500 to-amber-700",
    icon: "TrendingUp",
  },
  product: {
    bg: "bg-cyan-100 dark:bg-cyan-950",
    text: "text-cyan-700 dark:text-cyan-300",
    border: "border-cyan-300 dark:border-cyan-700",
    gradient: "from-cyan-500 to-cyan-700",
    icon: "Package",
  },
  culture: {
    bg: "bg-pink-100 dark:bg-pink-950",
    text: "text-pink-700 dark:text-pink-300",
    border: "border-pink-300 dark:border-pink-700",
    gradient: "from-pink-500 to-pink-700",
    icon: "Palette",
  },
  education: {
    bg: "bg-orange-100 dark:bg-orange-950",
    text: "text-orange-700 dark:text-orange-300",
    border: "border-orange-300 dark:border-orange-700",
    gradient: "from-orange-500 to-orange-700",
    icon: "GraduationCap",
  },
};

const DEFAULT_CATEGORY_STYLE: CategoryStyle = {
  bg: "bg-gray-100 dark:bg-gray-800",
  text: "text-gray-700 dark:text-gray-300",
  border: "border-gray-300 dark:border-gray-700",
  gradient: "from-gray-500 to-gray-700",
  icon: "Newspaper",
};

export function getCategoryStyle(category: string | null): CategoryStyle {
  if (!category) return DEFAULT_CATEGORY_STYLE;
  return CATEGORY_STYLES[category] ?? DEFAULT_CATEGORY_STYLE;
}

// ─── FR-02: Sentiment label/style ─────────────────────────
export type SentimentStyle = {
  bg: string;
  text: string;
  border: string;
  dot: string;
};

const SENTIMENT_STYLES: Record<string, SentimentStyle> = {
  positive: {
    bg: "bg-green-50 dark:bg-green-950",
    text: "text-green-700 dark:text-green-300",
    border: "border-green-300 dark:border-green-700",
    dot: "bg-green-500",
  },
  negative: {
    bg: "bg-red-50 dark:bg-red-950",
    text: "text-red-700 dark:text-red-300",
    border: "border-red-300 dark:border-red-700",
    dot: "bg-red-500",
  },
  neutral: {
    bg: "bg-gray-50 dark:bg-gray-900",
    text: "text-gray-600 dark:text-gray-400",
    border: "border-gray-300 dark:border-gray-700",
    dot: "bg-gray-400",
  },
};

const DEFAULT_SENTIMENT_STYLE: SentimentStyle = SENTIMENT_STYLES.neutral;

export function getSentimentStyle(sentiment: string | null): SentimentStyle {
  if (!sentiment) return DEFAULT_SENTIMENT_STYLE;
  return SENTIMENT_STYLES[sentiment] ?? DEFAULT_SENTIMENT_STYLE;
}

export function getSentimentLabel(
  sentiment: string | null,
  locale: string
): string {
  if (!sentiment) return "";
  const labels: Record<string, Record<string, string>> = {
    positive: { ko: "긍정", en: "Positive", zh: "积极" },
    negative: { ko: "부정", en: "Negative", zh: "消极" },
    neutral: { ko: "중립", en: "Neutral", zh: "中性" },
  };
  return labels[sentiment]?.[locale] ?? sentiment;
}

// ─── Date / Text helpers ──────────────────────────────────

const EN_MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const EN_MONTHS_LONG = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const EN_WEEKDAYS_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const KO_WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];

/** Parse "YYYY-MM-DD" without timezone issues (avoids new Date() UTC pitfall) */
function parseDateParts(dateString: string): { y: number; m: number; d: number; w: number } {
  const parts = dateString.split("T")[0].split("-");
  const y = parseInt(parts[0], 10);
  const m = parseInt(parts[1], 10) - 1; // 0-based month
  const d = parseInt(parts[2], 10);
  // Zeller-like weekday: create date with explicit year/month/day to avoid UTC offset
  const date = new Date(y, m, d);
  const w = date.getDay();
  return { y, m, d, w };
}

export function formatDate(
  dateString: string,
  locale: string = "ko"
): string {
  const { y, m, d } = parseDateParts(dateString);
  if (locale === "ko") return `${y}년 ${m + 1}월 ${d}일`;
  if (locale === "zh") return `${y}年${m + 1}月${d}日`;
  return `${EN_MONTHS_SHORT[m]} ${d}, ${y}`;
}

export function formatDateGroup(
  dateString: string,
  locale: string = "ko"
): string {
  const { y, m, d, w } = parseDateParts(dateString);
  if (locale === "ko") return `${y}년 ${m + 1}월 ${d}일 (${KO_WEEKDAYS[w]})`;
  if (locale === "zh") return `${y}年${m + 1}月${d}日`;
  return `${EN_WEEKDAYS_SHORT[w]}, ${EN_MONTHS_LONG[m]} ${d}, ${y}`;
}

export function getTitle(item: NewsItem, locale: string): string {
  if (locale === "zh")
    return item.title_cn || item.title_kr || item.title_en || "";
  if (locale === "en")
    return item.title_en || item.title_kr || item.title_cn || "";
  return item.title_kr || item.title_en || item.title_cn || "";
}

export function getSummary(item: NewsItem, locale: string): string {
  if (locale === "zh")
    return item.summary_cn || item.summary_kr || item.summary_en || "";
  if (locale === "en")
    return item.summary_en || item.summary_kr || item.summary_cn || "";
  return item.summary_kr || item.summary_en || item.summary_cn || "";
}

function stripHtml(html: string): string {
  return html
    .replace(/<img[^>]*>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<\/h[1-6]>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function getContent(item: NewsItem, locale: string): string {
  let raw = "";
  if (locale === "zh")
    raw = item.content_cn || item.content_kr || item.content_en || "";
  else if (locale === "en")
    raw = item.content_en || item.content_kr || item.content_cn || "";
  else
    raw = item.content_kr || item.content_en || item.content_cn || "";
  return stripHtml(raw);
}

export function getAiInsights(item: NewsItem, locale: string): string {
  if (locale === "zh")
    return item.ai_insights_cn || item.ai_insights_en || item.ai_insights_kr || "";
  if (locale === "en")
    return item.ai_insights_en || item.ai_insights_kr || item.ai_insights_cn || "";
  return item.ai_insights_kr || item.ai_insights_en || item.ai_insights_cn || "";
}

export function getUniqueCountries(news: NewsItem[]): string[] {
  const countries = new Set<string>();
  news.forEach((item) => {
    if (item.country) countries.add(item.country);
  });
  return Array.from(countries).sort();
}

export function getUniqueCategories(news: NewsItem[]): string[] {
  const categories = new Set<string>();
  news.forEach((item) => {
    if (item.category) categories.add(item.category);
  });
  return Array.from(categories).sort();
}

export function filterNews(
  news: NewsItem[],
  query: string,
  country: string,
  category: string,
  locale: string
): NewsItem[] {
  let result = [...news];

  if (query) {
    const q = query.toLowerCase();
    result = result.filter((item) => {
      const title = getTitle(item, locale).toLowerCase();
      const summary = getSummary(item, locale).toLowerCase();
      const source = (item.source_name || "").toLowerCase();
      return title.includes(q) || summary.includes(q) || source.includes(q);
    });
  }

  if (country !== "ALL") {
    result = result.filter((item) => item.country === country);
  }

  if (category !== "ALL") {
    result = result.filter((item) => item.category === category);
  }

  return result;
}

// ─── FR-05: Group news by date ────────────────────────────
export function groupNewsByDate(
  news: NewsItem[]
): { date: string; items: NewsItem[] }[] {
  const groups: Record<string, NewsItem[]> = {};

  for (const item of news) {
    const date = item.news_date || "unknown";
    if (!groups[date]) groups[date] = [];
    groups[date].push(item);
  }

  return Object.entries(groups)
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([date, items]) => ({ date, items }));
}

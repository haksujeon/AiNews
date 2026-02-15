import type { NewsItem } from "@/lib/supabase";

const COUNTRY_LABELS: Record<string, string> = {
  KR: "🇰🇷 한국",
  US: "🇺🇸 US",
  CN: "🇨🇳 中国",
  JP: "🇯🇵 日本",
};

export function getCountryLabel(code: string): string {
  return COUNTRY_LABELS[code] ?? code;
}

export function formatDate(dateString: string, locale: string = "ko"): string {
  const date = new Date(dateString);
  const loc = locale === "ko" ? "ko-KR" : locale === "zh" ? "zh-CN" : "en-US";
  return date.toLocaleDateString(loc, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export function getTitle(item: NewsItem, locale: string): string {
  if (locale === "en") return item.title_en || item.title_kr || item.original_title || "";
  if (locale === "zh") return item.original_title || item.title_kr || item.title_en || "";
  return item.title_kr || item.title_en || item.original_title || "";
}

export function getSummary(item: NewsItem, locale: string): string {
  if (locale === "en") return item.summary_en || item.summary_kr || "";
  return item.summary_kr || item.summary_en || "";
}

export function getContent(item: NewsItem, locale: string): string {
  if (locale === "en") return item.content_en || item.content_kr || "";
  return item.content_kr || item.content_en || "";
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

import type { NewsItem } from "@/lib/supabase";
import { apiUrl } from "@/lib/api-path";
import { filtersToParams, EMPTY_FILTERS, type NewsFilters } from "@/lib/news-query";

export interface NewsPageResult {
  items: NewsItem[];
  total: number;
}

/**
 * 필터가 적용된 한 페이지를 서버에서 가져온다.
 * total 은 필터 조건에 맞는 전체 건수(로드된 개수가 아님).
 */
export async function fetchNewsPageClient(
  offset: number,
  limit: number,
  filters: NewsFilters = EMPTY_FILTERS
): Promise<NewsPageResult> {
  const params = filtersToParams(filters);
  params.set("offset", String(offset));
  params.set("limit", String(limit));
  const res = await fetch(apiUrl(`/api/news?${params.toString()}`));
  if (!res.ok) return { items: [], total: 0 };
  return res.json();
}

export async function fetchNewsFacetsClient(): Promise<{
  countries: string[];
  categories: string[];
}> {
  const res = await fetch(apiUrl("/api/news/facets"));
  if (!res.ok) return { countries: [], categories: [] };
  return res.json();
}

export async function fetchNewsDetailClient(
  id: string
): Promise<NewsItem | null> {
  const res = await fetch(apiUrl(`/api/news/${id}`));
  if (!res.ok) return null;
  return res.json();
}

export async function fetchRelatedNewsClient(
  category: string | null,
  excludeId: string,
  limit: number = 4
): Promise<NewsItem[]> {
  const params = new URLSearchParams({ exclude: excludeId, limit: String(limit) });
  if (category) params.set('category', category);
  const res = await fetch(apiUrl(`/api/news/related?${params.toString()}`));
  if (!res.ok) return [];
  return res.json();
}

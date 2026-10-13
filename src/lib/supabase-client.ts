import type { NewsItem } from "@/lib/supabase";
import { apiUrl } from "@/lib/api-path";
import { filtersToParams, EMPTY_FILTERS, type NewsFilters } from "@/lib/news-query";

export interface NewsPageResult {
  items: NewsItem[];
  total: number;
}

/** API 가 실패 상태를 돌려줬을 때. "결과 없음"과 구분하기 위해 빈 배열 대신 던진다. */
export class NewsFetchError extends Error {
  constructor(public status: number) {
    super(`news request failed (HTTP ${status})`);
    this.name = "NewsFetchError";
  }
}

/**
 * 필터가 적용된 한 페이지를 서버에서 가져온다.
 * total 은 필터 조건에 맞는 전체 건수(로드된 개수가 아님).
 * 실패(네트워크/HTTP 오류/형식 오류)는 throw 한다 — 호출 측이 오류 상태를 보여줘야 한다.
 * signal 로 중단되면 AbortError 를 던진다.
 */
export async function fetchNewsPageClient(
  offset: number,
  limit: number,
  filters: NewsFilters = EMPTY_FILTERS,
  signal?: AbortSignal
): Promise<NewsPageResult> {
  const params = filtersToParams(filters);
  params.set("offset", String(offset));
  params.set("limit", String(limit));
  const res = await fetch(apiUrl(`/api/news?${params.toString()}`), { signal });
  if (!res.ok) throw new NewsFetchError(res.status);
  const data = await res.json().catch(() => null);
  if (!data || !Array.isArray(data.items) || typeof data.total !== "number") {
    throw new NewsFetchError(res.status);
  }
  return data as NewsPageResult;
}

export function isAbortError(e: unknown): boolean {
  return e instanceof DOMException && e.name === "AbortError";
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

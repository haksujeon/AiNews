import type { NewsItem } from "@/lib/supabase";
import { apiUrl } from "@/lib/api-path";

export async function fetchNewsPageClient(
  offset: number,
  limit: number
): Promise<NewsItem[]> {
  const res = await fetch(apiUrl(`/api/news?offset=${offset}&limit=${limit}`));
  if (!res.ok) return [];
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

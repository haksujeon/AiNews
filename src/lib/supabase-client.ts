import type { NewsItem } from "@/lib/supabase";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

const DETAIL_SELECT_FIELDS = [
  "id",
  "created_at",
  "source_name",
  "source_url",
  "news_date",
  "title_cn",
  "title_kr",
  "title_en",
  "summary_cn",
  "summary_kr",
  "summary_en",
  "sentiment",
  "category",
  "thumbnail_url",
  "og_image_url",
  "country",
  "content_cn",
  "content_kr",
  "content_en",
  "ai_insights_cn",
  "ai_insights_kr",
  "ai_insights_en",
  "key_terms",
].join(",");

const LIST_SELECT_FIELDS = [
  "id",
  "created_at",
  "source_name",
  "source_url",
  "news_date",
  "title_cn",
  "title_kr",
  "title_en",
  "summary_cn",
  "summary_kr",
  "summary_en",
  "sentiment",
  "category",
  "thumbnail_url",
  "og_image_url",
  "country",
].join(",");

export async function fetchNewsPageClient(
  offset: number,
  limit: number
): Promise<NewsItem[]> {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/ai_news_ex?select=${LIST_SELECT_FIELDS}&is_duplicate=is.false&order=news_date.desc,id.desc&offset=${offset}&limit=${limit}`,
    {
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      },
    }
  );

  if (!res.ok) return [];
  return res.json();
}

export async function fetchNewsDetailClient(
  id: string
): Promise<NewsItem | null> {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/ai_news_ex?select=${DETAIL_SELECT_FIELDS}&id=eq.${id}&limit=1`,
    {
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      },
    }
  );

  if (!res.ok) return null;

  const items: NewsItem[] = await res.json();
  return items[0] ?? null;
}

export async function fetchRelatedNewsClient(
  category: string | null,
  excludeId: string,
  limit: number = 4
): Promise<NewsItem[]> {
  const params = new URLSearchParams({
    select: LIST_SELECT_FIELDS,
    id: `neq.${excludeId}`,
    order: "news_date.desc",
    limit: String(limit),
  });
  if (category) params.set("category", `eq.${category}`);

  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/ai_news_ex?${params.toString()}`,
    {
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      },
    }
  );

  if (!res.ok) return [];
  return res.json();
}

import type { NewsItem } from "@/lib/supabase";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

const DETAIL_SELECT_FIELDS = [
  "id",
  "created_at",
  "source_name",
  "source_url",
  "original_title",
  "news_date",
  "title_kr",
  "title_en",
  "summary_kr",
  "summary_en",
  "sentiment",
  "category",
  "thumbnail_url",
  "og_image_url",
  "country",
  "content_kr",
  "content_en",
  "ai_insights",
  "key_terms",
].join(",");

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

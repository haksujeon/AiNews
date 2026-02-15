const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

export interface NewsItem {
  id: string;
  created_at: string;
  source_name: string | null;
  source_url: string | null;
  original_title: string | null;
  news_date: string | null;
  title_kr: string | null;
  title_en: string | null;
  summary_kr: string | null;
  summary_en: string | null;
  content_kr: string | null;
  content_en: string | null;
  ai_insights: string | null;
  key_terms: { term: string; explanation_kr: string }[] | null;
  sentiment: string | null;
  category: string | null;
  thumbnail_url: string | null;
  og_image_url: string | null;
  author: string | null;
  country: string | null;
  description: string | null;
}

const NEWS_SELECT_FIELDS = [
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
  "ai_insights",
  "key_terms",
  "sentiment",
  "category",
  "thumbnail_url",
  "og_image_url",
  "author",
  "country",
  "description",
].join(",");

const DETAIL_SELECT_FIELDS = [
  ...NEWS_SELECT_FIELDS.split(","),
  "content_kr",
  "content_en",
].join(",");

async function supabaseFetch<T>(path: string): Promise<T> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
    },
    next: { revalidate: 300 },
  });

  if (!res.ok) {
    throw new Error(`Supabase fetch failed: ${res.status}`);
  }

  return res.json();
}

export async function fetchNewsList(): Promise<NewsItem[]> {
  return supabaseFetch<NewsItem[]>(
    `ai_news_ex?select=${NEWS_SELECT_FIELDS}&order=news_date.desc&limit=100`
  );
}

export async function fetchNewsById(id: string): Promise<NewsItem | null> {
  const items = await supabaseFetch<NewsItem[]>(
    `ai_news_ex?select=${DETAIL_SELECT_FIELDS}&id=eq.${id}&limit=1`
  );
  return items[0] ?? null;
}

export async function fetchRelatedNews(
  newsId: string,
  country: string | null,
  category: string | null
): Promise<NewsItem[]> {
  let query = `ai_news_ex?select=${NEWS_SELECT_FIELDS}&id=neq.${newsId}&order=news_date.desc&limit=4`;

  if (country) {
    query += `&country=eq.${country}`;
  }
  if (category) {
    query += `&category=eq.${category}`;
  }

  return supabaseFetch<NewsItem[]>(query);
}

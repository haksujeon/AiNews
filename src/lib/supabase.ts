const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

export interface NewsItem {
  id: string;
  created_at: string;
  source_name: string | null;
  source_url: string | null;
  news_date: string | null;
  // 제목 (CN/KR/EN)
  title_cn: string | null;
  title_kr: string | null;
  title_en: string | null;
  // 요약 (CN/KR/EN)
  summary_cn: string | null;
  summary_kr: string | null;
  summary_en: string | null;
  // 본문 (CN/KR/EN)
  content_cn: string | null;
  content_kr: string | null;
  content_en: string | null;
  // AI 인사이트 (CN/KR/EN)
  ai_insights_cn: string | null;
  ai_insights_kr: string | null;
  ai_insights_en: string | null;
  key_terms: { term: string; explanation_kr: string }[] | null;
  sentiment: string | null;
  category: string | null;
  thumbnail_url: string | null;
  og_image_url: string | null;
  country: string | null;
}

// FR-06: 목록용 경량 필드 (ai_insights, key_terms, description, author 제거)
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

// 상세용 전체 필드
const DETAIL_SELECT_FIELDS = [
  ...LIST_SELECT_FIELDS.split(","),
  "content_cn",
  "content_kr",
  "content_en",
  "ai_insights_cn",
  "ai_insights_kr",
  "ai_insights_en",
  "key_terms",
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
  // FR-04: 중복 뉴스 필터링 (is_duplicate=false)
  return supabaseFetch<NewsItem[]>(
    `ai_news_ex?select=${LIST_SELECT_FIELDS}&is_duplicate=is.false&order=news_date.desc&limit=100`
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
  // FR-04: 관련 뉴스에서도 중복 제외
  let query = `ai_news_ex?select=${LIST_SELECT_FIELDS}&id=neq.${newsId}&is_duplicate=is.false&order=news_date.desc&limit=4`;

  if (country) {
    query += `&country=eq.${country}`;
  }
  if (category) {
    query += `&category=eq.${category}`;
  }

  return supabaseFetch<NewsItem[]>(query);
}

export interface NewsItem {
  id: string;
  created_at: string;
  source_name: string | null;
  source_url: string | null;
  news_date: string | null;
  title_cn: string | null;
  title_kr: string | null;
  title_en: string | null;
  summary_cn: string | null;
  summary_kr: string | null;
  summary_en: string | null;
  content_cn: string | null;
  content_kr: string | null;
  content_en: string | null;
  ai_insights_cn: string | null;
  ai_insights_kr: string | null;
  ai_insights_en: string | null;
  key_terms: { term: string; pinyin?: string; explanation_kr: string; explanation_en?: string; explanation_zh?: string }[] | null;
  sentiment: string | null;
  category: string | null;
  thumbnail_url: string | null;
  og_image_url: string | null;
  country: string | null;
}

export const NEWS_PAGE_SIZE = 30;

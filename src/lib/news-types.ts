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
  // content_cn(원문 매체의 RSS 본문 전문)은 DB에는 보관하지만 공개 UI/API로는 내보내지 않는다.
  // 저작권: "요약 + 원문 링크" 정책(2026-10). 번역문(content_kr/en)은 2차 저작물로 계속 노출.
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
  // 상세 조회(fetchNewsById)에만 실린다. 숨긴 기사(AI 무관 등)는 목록에서 빠지고 상세는 noindex.
  is_hidden?: boolean;
}

export const NEWS_PAGE_SIZE = 30;

/**
 * 공개 목록 카드에 쓰는 ai_news_ex 컬럼 (SELECT 목록). 목록·관련 기사가 같은 모양(NewsItem 목록 필드)을 내도록 한 곳에 둔다.
 * content_cn(원문 전문)·content_kr/en(번역 전문)은 넣지 않는다 — 공개 페이지/RSC 페이로드에 실리지 않도록.
 */
export const LIST_FIELDS = `id,
  to_char(created_at::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS created_at,
  source_name, source_url,
  to_char(news_date::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS news_date,
  title_cn, title_kr, title_en, summary_cn, summary_kr, summary_en,
  sentiment, category, thumbnail_url, og_image_url, country`;

import type { DayBriefingRef } from "./briefing/day-select";

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
  /** "자세히" 단계 인사이트 (2026-11-04, src/lib/insights.ts). 옛 기사는 null — 화면이 "자세히" 버튼을 숨긴다 */
  ai_insights_detail_cn?: string | null;
  ai_insights_detail_kr?: string | null;
  ai_insights_detail_en?: string | null;
  key_terms: { term: string; pinyin?: string; explanation_kr: string; explanation_en?: string; explanation_zh?: string }[] | null;
  sentiment: string | null;
  category: string | null;
  thumbnail_url: string | null;
  og_image_url: string | null;
  country: string | null;
  // 대상 지역 (src/lib/region.ts): 대표 지역 1개 + 태그. 미판정이면 null / []
  subject_region?: string | null;
  region_tags?: string[] | null;
  // 상세 조회(fetchNewsById)에만 실린다. 숨긴 기사(AI 무관 등)는 목록에서 빠지고 상세는 noindex.
  is_hidden?: boolean;
}

export const NEWS_PAGE_SIZE = 30;

/** 날짜별 목록: 한 번에 받는 날 수 (무한 스크롤 한 번 = 이만큼의 날) */
export const NEWS_DAYS_PER_PAGE = 5;
/** 날짜별 목록: 첫 화면에 보이는 그날의 주요 기사 수 (src/lib/news-rank.ts 의 DAY_TOP_COUNT 와 같다) */
export const NEWS_DAY_TOP = 4;
/** 펼치기 요청의 exclude 로 받을 수 있는 최대 id 수 */
export const NEWS_DAY_EXCLUDE_MAX = 20;

/** 목록 기사 + 같은 글(전재)을 실은 매체 수. 2 이상이면 "N개 매체 보도" */
export interface RankedNewsItem extends NewsItem {
  outlet_count: number;
}

/** 베이징 날짜(news_date) 하루치: 전체 건수 + 주요 기사 */
export interface NewsDay {
  date: string; // YYYY-MM-DD
  total: number; // 그날(필터 적용) 전체 기사 수
  top: RankedNewsItem[]; // 순위 상위 NEWS_DAY_TOP 묶음의 대표 기사
  /** 그날을 다루는 발행 데일리 판 (보는 언어판만, 일요일은 토요일 합본). 없으면 null */
  briefing?: DayBriefingRef | null;
  /** 판이 아직 없고 발행 마감 전 (sla.ts isEditionPending) — "브리핑 발행 예정" */
  briefingPending?: boolean;
}

export interface NewsDaysPage {
  days: NewsDay[];
  /** 필터 조건에 맞는 전체 기사 수 (모든 날 합계) */
  total: number;
  /** 다음 페이지 요청에 쓸 커서(이 날짜보다 이전 날부터). 없으면 null */
  nextCursor: string | null;
}

/** 펼치기: 그날의 나머지 기사 (순위 순) */
export interface NewsDayRest {
  date: string;
  total: number;
  items: RankedNewsItem[];
}

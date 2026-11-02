import type { NewsItem } from "@/lib/supabase";

// ─── Country ─────────────────────────────────────────────
// 국기 이모지는 쓰지 않는다(윈도우에서 "CN" 글자로 보이고, 기사가 사실상 전부 중국발이라 정보가 되지 않음).
const COUNTRY_LABELS: Record<string, Record<string, string>> = {
  KR: { ko: "한국", en: "Korea", zh: "韩国" },
  US: { ko: "미국", en: "US", zh: "美国" },
  CN: { ko: "중국", en: "China", zh: "中国" },
  JP: { ko: "일본", en: "Japan", zh: "日本" },
};

export function getCountryLabel(code: string, locale: string = "ko"): string {
  return COUNTRY_LABELS[code]?.[locale] ?? code;
}

// ─── Source (원어 매체명) ─────────────────────────────────
// 출처는 원문 브랜드명 그대로 보여준다(신뢰 신호). DB 의 source_name 은 영문 표기.
const SOURCE_NAMES: Record<string, string> = {
  huxiu: "虎嗅",
  ithome: "IT之家",
  qbitai: "量子位",
  "36kr": "36氪",
  synced: "机器之心",
  xinzhiyuan: "新智元",
};

/** 원어 매체명. 모르는 매체는 받은 값을 그대로 돌려준다(대소문자 무시). */
export function getSourceName(sourceName: string | null | undefined): string {
  if (!sourceName) return "";
  return SOURCE_NAMES[sourceName.trim().toLowerCase()] ?? sourceName;
}

// ─── Thumbnail 정책 ───────────────────────────────────────
// 이미지 없음으로 보는 것:
//  - 量子位 기본 로고(/wp-content/themes/liangziwei/imagesnew/head.jpg)
//  - 量子位 기자 아바타(WordPress 썸네일 -100x100.jpg/png) — 기사 이미지가 없을 때 수집기가 집어 온다
// 虎嗅 AI 생성 커버(ai-general-cover)는 2026-11-02 부터 쓴다. 본문 이미지가 없을 때만 수집기가 고르며,
// 화면에서는 isAiGeneratedImage 로 판별해 "AI 생성 이미지" 라벨을 붙인다(NewsThumbnail).
const PLACEHOLDER_IMAGE_PATTERNS: RegExp[] = [
  /\/wp-content\/themes\/liangziwei\/imagesnew\/head\.jpg/,
  /-100x100\.(?:jpe?g|png)(?:[?#]|$)/i,
];

// http:// 이미지는 https 페이지에서 혼합 콘텐츠다. https 를 지원하는 것을 확인한 호스트만 https 로 올리고
// 나머지는 버린다. (2026-10-13 DB 기준 http 이미지는 전부 www.qbitai.com — https 200 확인)
const HTTPS_UPGRADABLE_HOSTS = new Set(["www.qbitai.com", "qbitai.com"]);

/**
 * 화면에 써도 되는 이미지 URL 로 정규화. 플레이스홀더·아바타·업그레이드할 수 없는 http 는 null.
 * 썸네일·OG 이미지 등 이미지를 쓰는 모든 곳이 이 함수(또는 getImageUrl)를 거친다.
 */
export function normalizeImageUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  let u = url.trim();
  if (!u || PLACEHOLDER_IMAGE_PATTERNS.some((p) => p.test(u))) return null;
  if (u.startsWith("//")) u = `https:${u}`;
  if (/^http:\/\//i.test(u)) {
    const host = u.slice(7).split(/[/?#]/)[0].toLowerCase();
    if (!HTTPS_UPGRADABLE_HOSTS.has(host)) return null;
    u = `https://${u.slice(7)}`;
  }
  return /^https:\/\//i.test(u) ? u : null;
}

export function isRealImage(url: string | null | undefined): url is string {
  return normalizeImageUrl(url) === url && !!url;
}

/** AI 가 만든 대표 이미지인지(虎嗅 AI 생성 커버). 화면에 보여 줄 때 라벨·대체 텍스트로 알린다. */
export function isAiGeneratedImage(url: string | null | undefined): boolean {
  return !!url && /\/ai-general-cover\//i.test(url);
}

/** 화면에 쓸 대표 이미지 URL. 없거나 플레이스홀더성 이미지면 null. */
export function getImageUrl(item: Pick<NewsItem, "thumbnail_url" | "og_image_url">): string | null {
  for (const u of [item.thumbnail_url, item.og_image_url]) {
    const n = normalizeImageUrl(u);
    if (n) return n;
  }
  return null;
}

// ─── Category ─────────────────────────────────────────────
// 카테고리는 색 배지 대신 작은 텍스트 라벨. 색이 전달하는 정보는 "AI 관련 여부" 하나뿐이다.
const CATEGORY_LABELS: Record<string, Record<string, string>> = {
  "ai-tech":   { ko: "AI 기술", en: "AI Tech", zh: "AI技术" },
  "ai-product":{ ko: "AI 제품", en: "AI Products", zh: "AI产品" },
  "ai-biz":    { ko: "AI 비즈니스", en: "AI Business", zh: "AI商业" },
  politics:    { ko: "정치", en: "Politics", zh: "政治" },
  economy:     { ko: "경제", en: "Economy", zh: "经济" },
  society:     { ko: "사회", en: "Society", zh: "社会" },
  culture:     { ko: "문화", en: "Culture", zh: "文化" },
  tech:        { ko: "IT/과학", en: "Tech & Science", zh: "科技" },
};

export function getCategoryLabel(category: string, locale: string): string {
  return CATEGORY_LABELS[category]?.[locale] ?? category;
}

export function isAiCategory(category: string | null): boolean {
  return !!category && category.startsWith("ai-");
}

// ─── Sentiment (상세 사이드에서 단어로만 표시) ─────────────
export function getSentimentLabel(
  sentiment: string | null,
  locale: string
): string {
  if (!sentiment) return "";
  const labels: Record<string, Record<string, string>> = {
    positive: { ko: "긍정", en: "Positive", zh: "积极" },
    negative: { ko: "부정", en: "Negative", zh: "消极" },
    neutral: { ko: "중립", en: "Neutral", zh: "中性" },
  };
  return labels[sentiment]?.[locale] ?? sentiment;
}

// ─── Date / Text helpers ──────────────────────────────────

const EN_MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const EN_MONTHS_LONG = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const EN_WEEKDAYS_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const KO_WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];

/** Parse "YYYY-MM-DD" without timezone issues (avoids new Date() UTC pitfall) */
function parseDateParts(dateString: string): { y: number; m: number; d: number; w: number } {
  const parts = dateString.split("T")[0].split("-");
  const y = parseInt(parts[0], 10);
  const m = parseInt(parts[1], 10) - 1; // 0-based month
  const d = parseInt(parts[2], 10);
  // Zeller-like weekday: create date with explicit year/month/day to avoid UTC offset
  const date = new Date(y, m, d);
  const w = date.getDay();
  return { y, m, d, w };
}

export function formatDate(
  dateString: string,
  locale: string = "ko"
): string {
  const { y, m, d } = parseDateParts(dateString);
  if (locale === "ko") return `${y}년 ${m + 1}월 ${d}일`;
  if (locale === "zh") return `${y}年${m + 1}月${d}日`;
  return `${EN_MONTHS_SHORT[m]} ${d}, ${y}`;
}

export function formatDateGroup(
  dateString: string,
  locale: string = "ko"
): string {
  const { y, m, d, w } = parseDateParts(dateString);
  if (locale === "ko") return `${y}년 ${m + 1}월 ${d}일 (${KO_WEEKDAYS[w]})`;
  if (locale === "zh") return `${y}年${m + 1}月${d}日`;
  return `${EN_WEEKDAYS_SHORT[w]}, ${EN_MONTHS_LONG[m]} ${d}, ${y}`;
}

export function getTitle(item: Pick<NewsItem, "title_cn" | "title_kr" | "title_en">, locale: string): string {
  if (locale === "zh")
    return item.title_cn || item.title_kr || item.title_en || "";
  if (locale === "en")
    return item.title_en || item.title_kr || item.title_cn || "";
  return item.title_kr || item.title_en || item.title_cn || "";
}

export function getSummary(item: Pick<NewsItem, "summary_cn" | "summary_kr" | "summary_en">, locale: string): string {
  if (locale === "zh")
    return item.summary_cn || item.summary_kr || item.summary_en || "";
  if (locale === "en")
    return item.summary_en || item.summary_kr || item.summary_cn || "";
  return item.summary_kr || item.summary_en || item.summary_cn || "";
}

function stripHtml(html: string): string {
  return html
    .replace(/<img[^>]*>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<\/h[1-6]>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * 번역 본문 전문. **서버 전용** — 화면·API 에는 이 값을 그대로 내보내지 않고
 * src/lib/news-gist.ts 의 toPublicNewsItem/toGist 로 3~5문장 요지만 넘긴다(P0-7).
 * 우리가 만든 번역문(content_kr/content_en)만 반환한다.
 * - zh: 원문(content_cn)을 재게시하지 않으므로 항상 "" (요약·인사이트·원문 링크로 대체)
 * - ko/en: 번역문이 없으면 "" — 예전처럼 content_cn 으로 폴백하지 않는다.
 */
export function getContent(item: NewsItem, locale: string): string {
  let raw = "";
  if (locale === "zh") raw = "";
  else if (locale === "en") raw = item.content_en || item.content_kr || "";
  else raw = item.content_kr || item.content_en || "";
  return stripHtml(raw);
}

export function getAiInsights(
  item: Pick<NewsItem, "ai_insights_cn" | "ai_insights_kr" | "ai_insights_en">,
  locale: string
): string {
  if (locale === "zh")
    return item.ai_insights_cn || item.ai_insights_en || item.ai_insights_kr || "";
  if (locale === "en")
    return item.ai_insights_en || item.ai_insights_kr || item.ai_insights_cn || "";
  return item.ai_insights_kr || item.ai_insights_en || item.ai_insights_cn || "";
}

export function getTermExplanation(
  term: { term: string; explanation_kr: string; explanation_en?: string; explanation_zh?: string },
  locale: string
): string {
  if (locale === "en") return term.explanation_en || term.explanation_kr;
  if (locale === "zh") return term.explanation_zh || term.explanation_kr;
  return term.explanation_kr;
}



export interface DateRange {
  from?: string; // "YYYY-MM-DD"
  to?: string;   // "YYYY-MM-DD"
}


// ─── FR-05: Group news by date ────────────────────────────
export function groupNewsByDate(
  news: NewsItem[]
): { date: string; items: NewsItem[] }[] {
  const groups: Record<string, NewsItem[]> = {};

  for (const item of news) {
    const date = item.news_date || "unknown";
    if (!groups[date]) groups[date] = [];
    groups[date].push(item);
  }

  return Object.entries(groups)
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([date, items]) => ({ date, items }));
}

// 참고: 목록 필터링(검색/국가/카테고리/날짜)은 2026-08-27부터 서버 SQL로 이관되었다.
// src/lib/news-query.ts 의 buildNewsWhere() 를 참조할 것.

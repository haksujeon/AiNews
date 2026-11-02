/**
 * RSS 2.0 XML 생성과 이스케이프를 한 곳에 둔다 (P0-2). DB 를 부르지 않는다(단위 테스트에서 그대로 쓴다).
 *
 * 저작권 정책(요약 + 원문 링크): 항목에는 제목·요약(300자 이하)·링크만 넣는다.
 * 번역 전문·content:encoded 는 넣지 않는다.
 */
import { routing, type Locale } from "@/i18n/routing";
import { clipText } from "@/lib/seo/text";
import { rootUrl } from "@/lib/site";
import { SCOPE_CATEGORIES } from "@/lib/categories";

/** 피드 하나에 넣는 최대 항목 수 */
export const FEED_MAX_ITEMS = 50;
/** 항목 설명 최대 글자 수 */
export const FEED_DESCRIPTION_MAX = 300;

/**
 * 분류 피드를 여는 분류 = 공개 범위 분류(categories.ts 의 SCOPE_CATEGORIES). 필터 칩과 같은 목록 (Gate 2).
 * 공개 분류가 늘면(예: robotics) 피드도 자동으로 열린다.
 */
export const FEED_CATEGORIES: readonly string[] = SCOPE_CATEGORIES;
export type FeedCategory = string;

export type FeedKind = { kind: "all" } | { kind: "briefing" } | { kind: "category"; category: FeedCategory };

/** <language> 값 (RSS 2.0 은 RFC 1766 계열 소문자 태그를 쓴다) */
export const FEED_LANGUAGE: Record<Locale, string> = { ko: "ko", en: "en", zh: "zh-cn" };

/** 피드 경로(basePath 제외): /feed/ko/all.xml · /feed/ko/briefing.xml · /feed/ko/category/ai-biz.xml */
export function feedPath(locale: string, feed: FeedKind): string {
  if (feed.kind === "category") return `/feed/${locale}/category/${feed.category}.xml`;
  return `/feed/${locale}/${feed.kind}.xml`;
}

export function feedUrl(locale: string, feed: FeedKind): string {
  return rootUrl(feedPath(locale, feed));
}

/** 라우트 slug(["all.xml"] · ["category","ai-biz.xml"]) → 피드 종류. 모르는 값이면 null(404) */
export function parseFeedSlug(locale: string, slug: string[]): FeedKind | null {
  if (!(routing.locales as readonly string[]).includes(locale)) return null;
  if (slug.length === 1 && slug[0] === "all.xml") return { kind: "all" };
  if (slug.length === 1 && slug[0] === "briefing.xml") return { kind: "briefing" };
  if (slug.length === 2 && slug[0] === "category" && slug[1].endsWith(".xml")) {
    const cat = slug[1].slice(0, -4);
    if (FEED_CATEGORIES.includes(cat)) return { kind: "category", category: cat };
  }
  return null;
}

// XML 1.0 에서 쓸 수 없는 제어 문자(탭·줄바꿈·CR 제외)와 짝 없는 서로게이트, U+FFFE/FFFF
const INVALID_XML_RE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

/** 텍스트 노드·속성 값 이스케이프. CDATA 를 쓰지 않으므로 "]]>" 도 "]]&gt;" 가 된다 */
export function escapeXml(text: string | null | undefined): string {
  return (text ?? "")
    .replace(INVALID_XML_RE, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * RSS <description> 은 HTML 로 해석된다. 일반 텍스트의 & < > 를 먼저 HTML 엔티티로 바꿔야 "R&D" 같은 글이
 * "Invalid HTML"(W3C Feed Validator) 없이 그대로 보인다. 그다음 escapeXml 로 한 번 더 감싼다.
 */
export function textToHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** RFC 822 날짜(RFC 1123 형식, GMT): "Mon, 02 Nov 2026 03:00:00 GMT". 잘못된 값이면 null */
export function rfc822(date: string | Date | null | undefined): string | null {
  if (!date) return null;
  const d = date instanceof Date ? date : new Date(date);
  return Number.isNaN(d.getTime()) ? null : d.toUTCString();
}

export interface FeedItem {
  title: string;
  link: string;
  description: string;
  pubDate?: string | Date | null;
  category?: string | null;
  /** 기본은 link (isPermaLink=true) */
  guid?: string;
}

export interface FeedChannel {
  title: string;
  link: string;
  description: string;
  language: string;
  /** 이 피드 자신의 URL (atom:link rel="self") */
  selfUrl: string;
  lastBuildDate?: string | Date | null;
  ttlMinutes?: number;
}

/** RSS 2.0 문서. 항목은 FEED_MAX_ITEMS 개로, 설명은 FEED_DESCRIPTION_MAX 자로 자른다 */
export function buildRss(channel: FeedChannel, items: FeedItem[]): string {
  const list = items.slice(0, FEED_MAX_ITEMS);
  const newest = channel.lastBuildDate ?? list.find((i) => rfc822(i.pubDate))?.pubDate ?? new Date();
  const lines: string[] = [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">`,
    `<channel>`,
    `<title>${escapeXml(channel.title)}</title>`,
    `<link>${escapeXml(channel.link)}</link>`,
    `<description>${escapeXml(textToHtml(channel.description))}</description>`,
    `<language>${escapeXml(channel.language)}</language>`,
    `<atom:link href="${escapeXml(channel.selfUrl)}" rel="self" type="application/rss+xml"/>`,
    `<lastBuildDate>${rfc822(newest) ?? new Date().toUTCString()}</lastBuildDate>`,
    `<ttl>${channel.ttlMinutes ?? 60}</ttl>`,
  ];
  for (const it of list) {
    const pub = rfc822(it.pubDate);
    lines.push(
      `<item>`,
      `<title>${escapeXml(clipText(it.title, 200))}</title>`,
      `<link>${escapeXml(it.link)}</link>`,
      `<description>${escapeXml(textToHtml(clipText(it.description, FEED_DESCRIPTION_MAX)))}</description>`,
      ...(it.category ? [`<category>${escapeXml(it.category)}</category>`] : []),
      `<guid isPermaLink="${it.guid ? "false" : "true"}">${escapeXml(it.guid ?? it.link)}</guid>`,
      ...(pub ? [`<pubDate>${pub}</pubDate>`] : []),
      `</item>`
    );
  }
  lines.push(`</channel>`, `</rss>`);
  return lines.join("\n") + "\n";
}

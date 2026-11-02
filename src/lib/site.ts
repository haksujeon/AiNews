import { BASE_PATH } from "@/lib/api-path";
import { routing, LOCALE_HTML_LANG, type Locale } from "@/i18n/routing";

/**
 * 절대 URL 생성용 사이트 원점. metadataBase 는 basePath(/ainews)를 붙여주지 않으므로
 * hreflang/og:url 등은 이 헬퍼로 basePath 까지 포함한 절대 URL 을 만든다.
 */
export const SITE_ORIGIN = (process.env.SITE_URL || "https://news.aibaseclub.com").replace(/\/$/, "");

/** "/news/123" → "https://news.aibaseclub.com/ainews/ko/news/123" */
export function absoluteUrl(locale: string, path: string = ""): string {
  const p = path && !path.startsWith("/") ? `/${path}` : path;
  return `${SITE_ORIGIN}${BASE_PATH}/${locale}${p === "/" ? "" : p}`;
}

/**
 * 로케일이 없는 앱 경로의 절대 URL: "/robots.txt" → "https://news.aibaseclub.com/ainews/robots.txt".
 * sitemap·robots·RSS·로고처럼 [locale] 밖에 있는 라우트에 쓴다.
 */
export function rootUrl(path: string = ""): string {
  const p = path && !path.startsWith("/") ? `/${path}` : path;
  return `${SITE_ORIGIN}${BASE_PATH}${p}`;
}

/** hreflang alternates: { "ko": url, "en": url, "zh-CN": url, "x-default": url } */
export function languageAlternates(path: string = ""): Record<string, string> {
  const languages: Record<string, string> = {};
  for (const loc of routing.locales) {
    languages[LOCALE_HTML_LANG[loc]] = absoluteUrl(loc, path);
  }
  languages["x-default"] = absoluteUrl(routing.defaultLocale, path);
  return languages;
}

/**
 * 일부 언어판만 있는 페이지(브리핑·주간 리포트)의 hreflang: 발행된 언어만 + x-default(ko 가 있으면 ko, 없으면 첫 언어).
 * 화면 메타데이터(briefingAlternates·주간 alternates)와 sitemap 이 같은 함수를 쓴다 (Gate 2).
 */
export function publishedLanguageAlternates(path: string, locales: readonly string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const l of locales) out[LOCALE_HTML_LANG[l as Locale] ?? l] = absoluteUrl(l, path);
  if (locales.length) out["x-default"] = absoluteUrl(locales.includes("ko") ? "ko" : locales[0], path);
  return out;
}

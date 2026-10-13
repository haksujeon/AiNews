import { BASE_PATH } from "@/lib/api-path";
import { routing, LOCALE_HTML_LANG } from "@/i18n/routing";

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

/** hreflang alternates: { "ko": url, "en": url, "zh-CN": url, "x-default": url } */
export function languageAlternates(path: string = ""): Record<string, string> {
  const languages: Record<string, string> = {};
  for (const loc of routing.locales) {
    languages[LOCALE_HTML_LANG[loc]] = absoluteUrl(loc, path);
  }
  languages["x-default"] = absoluteUrl(routing.defaultLocale, path);
  return languages;
}

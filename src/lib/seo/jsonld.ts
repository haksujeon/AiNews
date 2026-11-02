/**
 * JSON-LD(schema.org) 만들기 (P0-3). 순수 함수만 둔다 — DB·fs·next-intl/server·next/og 를 부르지 않는다.
 *
 * 발행자(Organization)는 organizationLd 하나로 만든다. 레이아웃(Organization·WebSite), 기사 상세(NewsArticle),
 * 데일리 브리핑·주간 리포트(briefingJsonLd·weeklyJsonLd)가 모두 이 함수를 쓴다 (Gate 2).
 */
import { LOCALE_HTML_LANG, type Locale } from "@/i18n/routing";
import { absoluteUrl, rootUrl } from "@/lib/site";
import { clipText } from "@/lib/seo/text";

/** 로고(정사각 PNG, src/app/logo.png/route.tsx) */
export const LOGO_PATH = "/logo.png";
export const LOGO_SIZE = 512;

/** 페이지 경로 → 그 페이지의 자체 공유 카드 경로 (opengraph-image.tsx 파일 규칙) */
export function ogImagePath(pagePath: string): string {
  return `${pagePath.replace(/\/$/, "")}/opengraph-image`;
}

/** Rich Results: headline 은 110자 이하 */
export const HEADLINE_MAX = 110;

/** JSON 을 <script> 안에 넣을 때 '<' 를 이스케이프 (LLM·수집 텍스트가 </script> 를 담아도 안전) */
export function safeJsonLd(data: unknown): string {
  return JSON.stringify(data)
    .replace(/</g, "\\u003c")
    .replace(new RegExp(String.fromCharCode(0x2028), "g"), "\\u2028")
    .replace(new RegExp(String.fromCharCode(0x2029), "g"), "\\u2029");
}

/** 언어와 관계없이 같은 발행자를 가리키는 @id */
export const ORGANIZATION_ID = rootUrl("/#organization");
export const WEBSITE_ID = rootUrl("/#website");

function htmlLang(locale: string): string {
  return LOCALE_HTML_LANG[locale as Locale] ?? locale;
}

/** 발행자. brand 는 meta.brand(언어별 표기) */
export function organizationLd(locale: string, brand: string) {
  return {
    "@type": "Organization",
    "@id": ORGANIZATION_ID,
    name: brand,
    url: absoluteUrl(locale),
    logo: { "@type": "ImageObject", url: rootUrl(LOGO_PATH), width: LOGO_SIZE, height: LOGO_SIZE },
  };
}

/** 레이아웃에 한 번: Organization + WebSite */
export function siteJsonLd(locale: string, opts: { brand: string; description: string }) {
  return [
    { "@context": "https://schema.org", ...organizationLd(locale, opts.brand) },
    {
      "@context": "https://schema.org",
      "@type": "WebSite",
      "@id": WEBSITE_ID,
      name: opts.brand,
      description: opts.description,
      url: absoluteUrl(locale),
      inLanguage: htmlLang(locale),
      publisher: { "@id": ORGANIZATION_ID },
    },
  ] as const;
}

export interface BreadcrumbItem {
  name: string;
  url: string;
}

export function breadcrumbLd(items: BreadcrumbItem[]) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((it, i) => ({ "@type": "ListItem", position: i + 1, name: it.name, item: it.url })),
  };
}

export interface NewsArticleInput {
  locale: string;
  /** 페이지 경로(로케일 뒤): "/news/{id}" */
  path: string;
  headline: string;
  description: string;
  /** 공유 카드(자체 생성) 절대 URL. 원문 이미지는 쓰지 않는다(D3) */
  image: string;
  datePublished: string | null;
  dateModified?: string | null;
  brand: string;
  section?: string | null;
  /** 원문 기사 (요약·번역의 근거) */
  source?: { url: string | null; outlet: string } | null;
}

/** 기사 상세 NewsArticle. 번역 전문(articleBody)은 넣지 않는다 */
export function newsArticleLd(a: NewsArticleInput) {
  const url = absoluteUrl(a.locale, a.path);
  const org = organizationLd(a.locale, a.brand);
  return {
    "@context": "https://schema.org",
    "@type": "NewsArticle",
    headline: clipText(a.headline, HEADLINE_MAX),
    description: clipText(a.description, 300),
    image: [a.image],
    ...(a.datePublished ? { datePublished: a.datePublished, dateModified: a.dateModified || a.datePublished } : {}),
    inLanguage: htmlLang(a.locale),
    mainEntityOfPage: { "@type": "WebPage", "@id": url },
    url,
    author: org,
    publisher: org,
    isAccessibleForFree: true,
    ...(a.section ? { articleSection: a.section } : {}),
    ...(a.source?.url
      ? {
          isBasedOn: {
            "@type": "NewsArticle",
            url: a.source.url,
            ...(a.source.outlet ? { publisher: { "@type": "Organization", name: a.source.outlet } } : {}),
          },
        }
      : {}),
  };
}

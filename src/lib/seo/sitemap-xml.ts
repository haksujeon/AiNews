/**
 * sitemap XML 직렬화 (순수 함수, P0-2).
 *
 * Next 의 MetadataRoute.Sitemap 직렬화는 <xhtml:link> 를 <lastmod> 앞에 써서 sitemap 0.9 XSD
 * (loc, lastmod?, changefreq?, priority?, 그다음 다른 이름공간 요소)를 통과하지 못한다.
 * 그래서 항목 형식은 MetadataRoute.Sitemap 을 그대로 쓰고, 순서와 이스케이프만 여기서 맞춘다.
 */
import type { MetadataRoute } from "next";
import { escapeXml } from "@/lib/feed";

export type SitemapEntry = MetadataRoute.Sitemap[number];

const XML_HEAD = `<?xml version="1.0" encoding="UTF-8"?>`;

function isoDate(d: string | Date): string {
  return d instanceof Date ? d.toISOString() : d;
}

export function serializeUrlset(entries: SitemapEntry[]): string {
  const out: string[] = [
    XML_HEAD,
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">`,
  ];
  for (const e of entries) {
    out.push(`<url>`, `<loc>${escapeXml(e.url)}</loc>`);
    if (e.lastModified) out.push(`<lastmod>${escapeXml(isoDate(e.lastModified))}</lastmod>`);
    if (e.changeFrequency) out.push(`<changefreq>${e.changeFrequency}</changefreq>`);
    if (typeof e.priority === "number") out.push(`<priority>${e.priority.toFixed(1)}</priority>`);
    for (const [lang, href] of Object.entries(e.alternates?.languages ?? {})) {
      if (href) out.push(`<xhtml:link rel="alternate" hreflang="${escapeXml(lang)}" href="${escapeXml(String(href))}"/>`);
    }
    out.push(`</url>`);
  }
  out.push(`</urlset>`);
  return out.join("\n") + "\n";
}

export function serializeSitemapIndex(locs: string[]): string {
  return (
    [
      XML_HEAD,
      `<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">`,
      ...locs.map((l) => `<sitemap><loc>${escapeXml(l)}</loc></sitemap>`),
      `</sitemapindex>`,
    ].join("\n") + "\n"
  );
}

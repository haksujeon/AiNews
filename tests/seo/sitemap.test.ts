/** sitemap 직렬화(src/lib/seo/sitemap-xml.ts) 단위 테스트 — XSD 요소 순서와 이스케이프 */
import "./env";
import { test } from "node:test";
import assert from "node:assert/strict";
import { serializeSitemapIndex, serializeUrlset } from "../../src/lib/seo/sitemap-xml";
import { languageAlternates, publishedLanguageAlternates } from "../../src/lib/site";

const ORIGIN = "https://news.aibaseclub.com/ainews";

test("urlset: loc → lastmod → changefreq → priority → xhtml:link 순서 (sitemap 0.9 XSD)", () => {
  const xml = serializeUrlset([
    {
      url: `${ORIGIN}/ko/news/1`,
      lastModified: "2026-11-01T00:00:00Z",
      changeFrequency: "daily",
      priority: 1,
      alternates: { languages: languageAlternates("/news/1") },
    },
  ]);
  const order = ["<loc>", "<lastmod>", "<changefreq>", "<priority>", "<xhtml:link"].map((t) => xml.indexOf(t));
  assert.ok(order.every((v) => v >= 0));
  assert.deepEqual([...order].sort((a, b) => a - b), order);
  assert.ok(xml.includes(`<priority>1.0</priority>`));
  for (const lang of ["ko", "en", "zh-CN", "x-default"]) assert.ok(xml.includes(`hreflang="${lang}"`), lang);
  assert.ok(xml.includes(`href="${ORIGIN}/zh/news/1"`));
  assert.ok(xml.includes(`xmlns:xhtml="http://www.w3.org/1999/xhtml"`));
});

test("urlset: & 는 이스케이프, 일부 언어판만 있으면 그 언어 + x-default 만", () => {
  const xml = serializeUrlset([{ url: `${ORIGIN}/ko/?a=1&b=2` }]);
  assert.ok(xml.includes("<loc>https://news.aibaseclub.com/ainews/ko/?a=1&amp;b=2</loc>"));
  assert.ok(!xml.includes("<lastmod>"));
  assert.deepEqual(publishedLanguageAlternates("/briefing/weekly/2026-W44", ["ko"]), {
    ko: `${ORIGIN}/ko/briefing/weekly/2026-W44`,
    "x-default": `${ORIGIN}/ko/briefing/weekly/2026-W44`,
  });
  assert.deepEqual(Object.keys(publishedLanguageAlternates("/briefing/2026-10-13", ["en", "zh"])), ["en", "zh-CN", "x-default"]);
  assert.equal(publishedLanguageAlternates("/briefing/2026-10-13", ["en", "zh"])["x-default"], `${ORIGIN}/en/briefing/2026-10-13`);
});

test("sitemapindex", () => {
  const xml = serializeSitemapIndex([`${ORIGIN}/sitemap/0.xml`, `${ORIGIN}/sitemap/1.xml`]);
  assert.ok(xml.includes(`<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">`));
  assert.equal((xml.match(/<sitemap>/g) ?? []).length, 2);
});

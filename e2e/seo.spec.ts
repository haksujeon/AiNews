import { test, expect } from '@playwright/test';
import pg from 'pg';

// P0-2·P0-3: sitemap(언어 3개 hreflang)·robots·RSS·JSON-LD·공유 카드.
//   E2E_BASE_URL=http://localhost:3096/ainews npx playwright test e2e/seo.spec.ts
// 고정 기사는 ko 전체 피드의 첫 항목(DB 없이). 숨긴 기사 검사는 .env.local 의 DATABASE_URL 이 있을 때만(읽기 전용).
const BASE_URL = process.env.E2E_BASE_URL ?? 'http://localhost:3000/ainews';
// 문서 안의 절대 URL 은 SITE_URL(운영 원점) 기준이다. 요청은 테스트 서버로 바꿔 보낸다.
const toLocal = (u: string) => u.replace(/^https?:\/\/[^/]+\/ainews/, BASE_URL);

if (!process.env.DATABASE_URL) {
  try {
    process.loadEnvFile('.env.local');
  } catch {
    /* 없으면 숨긴 기사 검사를 건너뛴다 */
  }
}

async function firstFeedArticleId(request: import('@playwright/test').APIRequestContext): Promise<string> {
  const xml = await (await request.get(`${BASE_URL}/feed/ko/all.xml`)).text();
  const id = xml.match(/<link>[^<]*\/news\/([0-9a-f-]{36})<\/link>/)?.[1];
  expect(id, '피드에 기사 링크가 있다').toBeTruthy();
  return id!;
}

test('robots.txt: 200, Sitemap 줄, /ainews/api/ 와 관리자 Disallow', async ({ request }) => {
  const res = await request.get(`${BASE_URL}/robots.txt`);
  expect(res.status()).toBe(200);
  const body = await res.text();
  expect(body).toMatch(/^Sitemap: https?:\/\/\S+\/ainews\/sitemap\.xml$/m);
  expect(body).toContain('Disallow: /ainews/api/');
  expect(body).toContain('Disallow: /ainews/*/admin');
});

test('sitemap: 목차 → 기사 파일, 기사마다 ko/en/zh + x-default hreflang', async ({ request }) => {
  const idx = await request.get(`${BASE_URL}/sitemap.xml`);
  expect(idx.status()).toBe(200);
  expect(idx.headers()['content-type']).toContain('xml');
  const locs = [...(await idx.text()).matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  expect(locs.length).toBeGreaterThanOrEqual(2);

  const pages = await (await request.get(toLocal(locs[0]))).text();
  expect(pages).toContain('/ainews/ko</loc>');

  const res = await request.get(toLocal(locs[1]));
  expect(res.status()).toBe(200);
  const xml = await res.text();
  const first = xml.match(/<url>([\s\S]*?)<\/url>/)?.[1] ?? '';
  expect(first).toMatch(/<loc>[^<]+\/ainews\/(ko|en|zh)\/news\/[0-9a-f-]{36}<\/loc>/);
  for (const lang of ['ko', 'en', 'zh-CN', 'x-default']) expect(first).toContain(`hreflang="${lang}"`);
  // XSD 순서: lastmod 가 xhtml:link 보다 앞
  if (first.includes('<lastmod>')) expect(first.indexOf('<lastmod>')).toBeLessThan(first.indexOf('<xhtml:link'));
});

test('sitemap·피드에 숨긴 기사가 없다', async ({ request }) => {
  test.skip(!process.env.DATABASE_URL, 'DATABASE_URL 없음');
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
  let hidden: string;
  try {
    const { rows } = await pool.query(`SELECT id FROM ai_news_ex WHERE is_hidden ORDER BY news_date DESC LIMIT 1`);
    test.skip(!rows.length, '숨긴 기사 없음');
    hidden = rows[0].id;
  } finally {
    await pool.end();
  }
  const idx = await (await request.get(`${BASE_URL}/sitemap.xml`)).text();
  for (const m of idx.matchAll(/<loc>([^<]+)<\/loc>/g)) {
    expect(await (await request.get(toLocal(m[1]))).text()).not.toContain(hidden!);
  }
  expect(await (await request.get(`${BASE_URL}/feed/ko/all.xml`)).text()).not.toContain(hidden!);
});

test('RSS: 언어 3개 × 전체·브리핑·분류, application/rss+xml, 50개 이하, content:encoded 없음', async ({ request }) => {
  for (const loc of ['ko', 'en', 'zh']) {
    for (const path of ['all.xml', 'briefing.xml', 'category/ai-biz.xml']) {
      const res = await request.get(`${BASE_URL}/feed/${loc}/${path}`);
      expect(res.status(), `${loc}/${path}`).toBe(200);
      expect(res.headers()['content-type']).toContain('application/rss+xml');
      const xml = await res.text();
      expect(xml).toContain('<rss version="2.0"');
      expect(xml).not.toContain('content:encoded');
      expect((xml.match(/<item>/g) ?? []).length).toBeLessThanOrEqual(50);
      for (const d of xml.matchAll(/<pubDate>([^<]+)<\/pubDate>/g)) expect(d[1]).toMatch(/^\w{3}, \d{2} \w{3} \d{4} \d{2}:\d{2}:\d{2} GMT$/);
    }
  }
  expect((await request.get(`${BASE_URL}/feed/ko/category/politics.xml`)).status()).toBe(404);
});

test('기사 상세: NewsArticle·BreadcrumbList·Organization·WebSite JSON-LD, RSS 링크, 자체 OG 카드', async ({ page, request }) => {
  const id = await firstFeedArticleId(request);
  for (const loc of ['ko', 'zh']) {
    await page.goto(`${BASE_URL}/${loc}/news/${id}`);
    const lds = (await page.locator('script[type="application/ld+json"]').allTextContents()).flatMap((t) => {
      const d = JSON.parse(t);
      return Array.isArray(d) ? d : [d];
    });
    const types = lds.map((d) => d['@type']);
    expect(types).toEqual(expect.arrayContaining(['Organization', 'WebSite', 'NewsArticle', 'BreadcrumbList']));
    const art = lds.find((d) => d['@type'] === 'NewsArticle');
    expect(art.headline.length).toBeLessThanOrEqual(110);
    expect(art.datePublished).toBeTruthy();
    expect(art.author?.name).toBeTruthy();
    expect(art.publisher?.logo?.url).toMatch(/\/ainews\/logo\.png$/);
    expect(art.image[0]).toMatch(/\/ainews\/[a-z]{2}\/news\/[0-9a-f-]{36}\/opengraph-image$/);
    expect(art).not.toHaveProperty('articleBody');

    await expect(page.locator('link[rel="alternate"][type="application/rss+xml"]')).toHaveAttribute('href', new RegExp(`/ainews/feed/${loc}/all\\.xml$`));

    const og = await page.locator('meta[property="og:image"]').getAttribute('content');
    expect(og).toContain(`/ainews/${loc}/news/${id}/opengraph-image`);
    const img = await request.get(toLocal(og!));
    expect(img.status()).toBe(200);
    expect(img.headers()['content-type']).toBe('image/png');
    const buf = await img.body();
    expect([buf.readUInt32BE(16), buf.readUInt32BE(20)]).toEqual([1200, 630]);
  }
});

test('브리핑 공유 카드: 발행본이 없는 날도 200 PNG, 미래 날짜는 404', async ({ request }) => {
  const res = await request.get(`${BASE_URL}/zh/briefing/2026-11-01/opengraph-image`);
  expect(res.status()).toBe(200);
  expect(res.headers()['content-type']).toBe('image/png');
  expect((await request.get(`${BASE_URL}/ko/briefing/2099-01-01/opengraph-image`)).status()).toBe(404);
});

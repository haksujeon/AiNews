import { test, expect } from '@playwright/test';

// P0-6: 신뢰 페이지(소개·만드는 방법·정정 기록·개인정보 처리방침) × 3개 언어, footer 링크, sitemap.
//   E2E_BASE_URL=http://localhost:3093/ainews npx playwright test e2e/trust-pages.spec.ts
const BASE_URL = process.env.E2E_BASE_URL ?? 'http://localhost:3000/ainews';
const toLocal = (u: string) => u.replace(/^https?:\/\/[^/]+\/ainews/, BASE_URL);

const LOCALES = ['ko', 'en', 'zh'] as const;
const PAGES = ['about', 'methodology', 'corrections', 'privacy'] as const;

for (const locale of LOCALES) {
  for (const page of PAGES) {
    test(`${locale}/${page}: 200, h1 하나, footer 링크 4개`, async ({ page: p }) => {
      const res = await p.goto(`${BASE_URL}/${locale}/${page}`);
      expect(res?.status()).toBe(200);
      await expect(p.locator('h1')).toHaveCount(1);
      await expect(p.getByTestId(`trust-${page}`)).toBeVisible();

      const nav = p.getByTestId('footer-trust-nav');
      for (const target of PAGES) {
        await expect(nav.locator(`a[href="/ainews/${locale}/${target}"]`)).toHaveCount(1);
      }
      // BreadcrumbList JSON-LD
      const lds = await p.locator('script[type="application/ld+json"]').allTextContents();
      expect(lds.some((s) => s.includes('"BreadcrumbList"') && s.includes(`/ainews/${locale}/${page}`))).toBe(true);
      // 원문 HTML 이 새지 않는다 (주석 제거)
      expect(await p.content()).not.toContain('DRAFT:');
    });
  }
}

test('개인정보 처리방침: 판 문자열과 문의 주소', async ({ page }) => {
  await page.goto(`${BASE_URL}/ko/privacy`);
  const v = page.getByTestId('consent-version');
  await expect(v).toBeVisible();
  expect(await v.getAttribute('data-version')).toMatch(/^\d{4}-\d{2}-\d{2}/);
  await expect(page.locator('main a[href^="mailto:"]').first()).toBeVisible();
});

test('정정 기록: 목록 또는 빈 상태가 보인다', async ({ page }) => {
  await page.goto(`${BASE_URL}/ko/corrections`);
  const empty = page.getByTestId('corrections-empty');
  const list = page.getByTestId('corrections-list');
  await expect(empty.or(list)).toBeVisible();
});

test('홈에도 footer 신뢰 링크가 있다', async ({ page }) => {
  await page.goto(`${BASE_URL}/ko`);
  await expect(page.getByTestId('footer-trust-nav').locator('a')).toHaveCount(4);
});

test('sitemap 에 신뢰 페이지 4개 × 3개 언어가 있다', async ({ request }) => {
  const idx = await (await request.get(`${BASE_URL}/sitemap.xml`)).text();
  const first = idx.match(/<loc>([^<]+)<\/loc>/)?.[1];
  expect(first).toBeTruthy();
  const xml = await (await request.get(toLocal(first!))).text();
  for (const locale of LOCALES) {
    for (const page of PAGES) expect(xml).toContain(`/ainews/${locale}/${page}</loc>`);
  }
});

import { test, expect } from '@playwright/test';

// 기업·이슈 메뉴 (2026-11-03). 실행: E2E_BASE_URL=http://localhost:3012/ainews npx playwright test e2e/companies.spec.ts
const BASE_URL = process.env.E2E_BASE_URL ?? 'http://localhost:3000/ainews';
const H1 = { ko: '기업·이슈', en: 'Companies', zh: '企业·议题' } as const;

for (const locale of ['ko', 'en', 'zh'] as const) {
  test(`허브 ${locale}: 제목·차트·큰 이슈·기업 찾기`, async ({ page }) => {
    const res = await page.goto(`${BASE_URL}/${locale}/companies`);
    expect(res?.status()).toBe(200);
    await expect(page.locator('h1')).toHaveText(H1[locale]);
    await expect(page.getByTestId('companies-hub').locator('canvas')).toHaveCount(1);
    await expect(page.getByTestId('companies-dir-cn').locator('a').first()).toBeVisible();
  });
}

test('허브 → 기업 찾기 칩 → 기업 페이지, 차트 2개와 기사 검색 링크', async ({ page }) => {
  await page.goto(`${BASE_URL}/ko/companies`);
  await page.getByTestId('companies-dir-cn').getByRole('link', { name: /^딥시크/ }).click();
  await expect(page).toHaveURL(/\/ko\/companies\/deepseek$/);
  await expect(page.locator('h1')).toHaveText('딥시크');
  await expect(page.getByTestId('company-page').locator('canvas')).toHaveCount(2);
  await expect(page.getByTestId('company-search')).toHaveAttribute('href', /\/news\?q=/);
});

test('모르는 기업 키는 404, 아는 키는 기사가 없어도 200', async ({ request }) => {
  expect((await request.get(`${BASE_URL}/ko/companies/nope`)).status()).toBe(404);
  expect((await request.get(`${BASE_URL}/en/companies/xunce`)).status()).toBe(200);
});

test('휴대폰 360px: 가로 넘침 없음, 하단 탭에 기업 탭', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 780 });
  for (const path of ['/ko/companies', '/ko/companies/deepseek']) {
    await page.goto(`${BASE_URL}${path}`);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  }
  const tabs = page.getByTestId('bottom-tabs');
  await expect(tabs.locator('a')).toHaveCount(5);
  await expect(tabs.getByRole('link', { name: '기업' })).toHaveAttribute('aria-current', 'page');
});

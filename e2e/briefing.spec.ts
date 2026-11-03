import { test, expect } from '@playwright/test';

// 데일리 브리핑 E2E. 발행된 판이 하나 이상 있어야 한다 (최신 판을 /briefing 에서 찾아 날짜 URL 을 얻는다).
//   E2E_BASE_URL=http://localhost:3092/ainews npx playwright test e2e/briefing.spec.ts
const BASE_URL = process.env.E2E_BASE_URL ?? 'http://localhost:3000/ainews';

async function latestDate(page: import('@playwright/test').Page, locale: string): Promise<string> {
  await page.goto(`${BASE_URL}/${locale}/briefing`);
  const canonical = await page.locator('link[rel="canonical"]').getAttribute('href');
  const m = canonical?.match(/\/briefing\/(\d{4}-\d{2}-\d{2})$/);
  expect(m, `canonical 은 날짜 URL 이어야 한다: ${canonical}`).toBeTruthy();
  return m![1];
}

for (const locale of ['ko', 'en', 'zh']) {
  test(`${locale}: 최신 판·날짜 판 200, h1 1개, hreflang, JSON-LD`, async ({ page }) => {
    const date = await latestDate(page, locale);
    const res = await page.goto(`${BASE_URL}/${locale}/briefing/${date}`);
    expect(res?.status()).toBe(200);
    await expect(page.locator('h1')).toHaveCount(1);
    await expect(page.getByTestId('ai-label')).toBeVisible();

    // hreflang: 발행된 언어판 + x-default, 자기 자신 포함
    const alternates = page.locator('link[rel="alternate"][hreflang]');
    const langs = await alternates.evaluateAll((els) => els.map((e) => e.getAttribute('hreflang')));
    expect(langs).toContain('x-default');
    expect(langs).toContain(locale === 'zh' ? 'zh-CN' : locale);

    // JSON-LD: NewsArticle(isBasedOn) + ItemList
    const blocks = await page.locator('script[type="application/ld+json"]').allTextContents();
    const parsed = blocks.flatMap((b) => {
      const j = JSON.parse(b);
      return Array.isArray(j) ? j : [j];
    });
    const article = parsed.find((j) => j['@type'] === 'NewsArticle');
    expect(article).toBeTruthy();
    expect(article.author['@type']).toBe('Organization');
    expect(Array.isArray(article.isBasedOn) && article.isBasedOn.length > 0).toBe(true);
    expect(parsed.some((j) => j['@type'] === 'ItemList')).toBe(true);

    // 근거 기사 링크는 우리 기사 페이지로
    const src = page.locator('[data-testid="briefing"] a[href*="/news/"]').first();
    await expect(src).toBeVisible();
  });
}

test('잘못된 날짜·미래 날짜는 404', async ({ page }) => {
  expect((await page.goto(`${BASE_URL}/ko/briefing/2026-13-45`))?.status()).toBe(404);
  expect((await page.goto(`${BASE_URL}/ko/briefing/2099-01-01`))?.status()).toBe(404);
  expect((await page.goto(`${BASE_URL}/ko/briefing/2001-01-01`))?.status()).toBe(404);
});

test('390 폭: 가로 스크롤 없음 (숫자 띠는 띠 안에서만 스크롤)', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  for (const locale of ['ko', 'zh']) {
    await page.goto(`${BASE_URL}/${locale}/briefing`);
    const { scrollWidth, clientWidth } = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    expect(scrollWidth, `${locale} scrollWidth ${scrollWidth} > ${clientWidth}`).toBeLessThanOrEqual(clientWidth);
  }
  await context.close();
});

test('뉴스 목록 띠 링크와 헤더 메뉴 링크가 같은 곳으로 간다', async ({ page }) => {
  // 2026-11-03: 홈은 "오늘"(브리핑 콘솔), 한 줄 띠는 뉴스 목록(/news)에
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`${BASE_URL}/ko/news`);
  const banner = page.getByTestId('briefing-banner');
  await expect(banner).toBeVisible();
  const nav = page.getByTestId('nav-briefing');
  expect(await banner.getAttribute('href')).toBe(await nav.getAttribute('href'));
});

test('아카이브: 200, 판 목록 링크', async ({ page }) => {
  const res = await page.goto(`${BASE_URL}/ko/briefing/archive`);
  expect(res?.status()).toBe(200);
  await expect(page.locator('h1')).toHaveCount(1);
  await expect(page.locator('main a[href*="/briefing/20"]').first()).toBeVisible();
});

// 홈 배너 대체 규칙 (sla.ts bannerState). 판정 경계는 tests/briefing/sla.test.ts 가 시각 고정으로 검사하고,
// 여기서는 DB 상태 그대로: 발행본이 없으면 띠가 없고, 있으면 그 판의 헤드라인과 (오래된 판이면) 날짜 칩이 보인다.
test('홈 배너: 발행본이 없으면 숨김, 있으면 최신 발행본 + 오래된 판이면 날짜 칩', async ({ page, request }) => {
  for (const locale of ['ko', 'en', 'zh']) {
    const api = await request.get(`${BASE_URL}/api/briefing?locale=${locale}`);
    await page.goto(`${BASE_URL}/${locale}/news`);
    const banner = page.getByTestId('briefing-banner');
    if (api.status() === 404) {
      await expect(banner, `${locale}: 발행본이 없으면 띠가 없다`).toHaveCount(0);
      continue;
    }
    expect(api.status()).toBe(200);
    const { data } = await api.json();
    await expect(banner).toBeVisible();
    await expect(banner).toContainText(data.content.headline);
    const dated = (await banner.getAttribute('data-dated')) === 'true';
    await expect(page.getByTestId('briefing-banner-date')).toHaveCount(dated ? 1 : 0);
  }
});

test('내부 상태 API 는 토큰 없이 401', async ({ request }) => {
  const res = await request.get(`${BASE_URL}/api/internal/briefing/status`);
  expect(res.status()).toBe(401);
});

test('관리자 API 는 세션 없이 401', async ({ request }) => {
  for (const path of ['publish', 'regenerate', 'edit']) {
    const res = await request.post(`${BASE_URL}/api/admin/briefing/${path}`, { data: { date: '2026-10-13' } });
    expect(res.status(), path).toBe(401);
  }
});

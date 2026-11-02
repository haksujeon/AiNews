import { test, expect } from '@playwright/test';

// 로봇 범위 2단계: robotics 는 숨김 분류(NEXT_PUBLIC_HIDDEN_CATEGORIES 기본 "robotics")라 어디에도 노출되지 않는다.
//   E2E_BASE_URL=http://localhost:3090/ainews npx playwright test e2e/robotics-hidden.spec.ts
// 지금은 robotics 행이 0건이라 칩이 없는 것이 당연하다. 그래서 칩만이 아니라 필터 값·피드·facets 를 함께 본다
// (3단계에서 robotics 행이 생기고 PUBLIC_CATEGORIES 에 들어가도 이 시험이 그대로 통과해야 한다 — 4단계 전까지).
const BASE_URL = process.env.E2E_BASE_URL ?? 'http://localhost:3000/ainews';

test('API: facets 에 robotics 가 없고, ?categories=robotics 는 무시된다(= 전체)', async ({ request }) => {
  const facets = await (await request.get(`${BASE_URL}/api/news/facets`)).json();
  expect(facets.categories).not.toContain('robotics');

  // 다른 데이터 작업이 행을 넣고 있을 수 있어 두 요청 차이가 0 이 될 때까지 다시 받는다
  const total = async (q: string) => (await (await request.get(`${BASE_URL}/api/news?limit=1${q}`)).json()).total as number;
  await expect.poll(async () => (await total('&categories=robotics')) - (await total('')), { timeout: 15_000 }).toBe(0);
});

test('피드: /feed/{ko,en,zh}/category/robotics.xml 은 404', async ({ request }) => {
  for (const loc of ['ko', 'en', 'zh']) {
    expect((await request.get(`${BASE_URL}/feed/${loc}/category/robotics.xml`)).status(), loc).toBe(404);
  }
  // 비교: 공개 분류 피드는 열린다
  expect((await request.get(`${BASE_URL}/feed/ko/category/ai-tech.xml`)).status()).toBe(200);
});

test('sitemap: 분류 URL·robotics 항목이 없다', async ({ request }) => {
  const xml = await (await request.get(`${BASE_URL}/sitemap/0.xml`)).text();
  expect(xml).toContain('<urlset');
  expect(xml).not.toContain('robotics');
  expect(xml).not.toContain('categories=');
});

for (const locale of ['ko', 'en', 'zh'] as const) {
  test(`목록 (${locale}): 로봇 칩이 보이지 않는다 — URL 에 ?categories=robotics 를 붙여도`, async ({ page }) => {
    const label = { ko: '로봇', en: 'Robotics', zh: '机器人' }[locale];
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`${BASE_URL}/${locale}?categories=robotics`);
    const chips = page.locator('[data-testid="category-chip"]');
    await expect(chips.first()).toBeVisible();
    expect(await chips.evaluateAll((els) => els.map((e) => e.getAttribute('data-category')))).not.toContain('robotics');
    await expect(page.locator('[data-testid="category-chip"][data-category="robotics"]')).toHaveCount(0);
    await expect(chips.filter({ hasText: new RegExp(`^\\s*${label}\\s*$`) })).toHaveCount(0);
    // 숨김 분류 값은 선택된 상태로도 남지 않는다
    for (const c of await chips.all()) await expect(c).toHaveAttribute('aria-pressed', 'false');
  });
}

import { test, expect, type Locator, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';

// P0-5: 공개 필터는 AI 분류 3개만, 국가 선택 칸 없음(값 1개).
//   E2E_BASE_URL=http://localhost:3094/ainews npx playwright test e2e/filters.spec.ts
// 화면 캡처는 SHOT_DIR(기본 없음)에 ko/zh × 1440/390 으로 남긴다.
const BASE_URL = process.env.E2E_BASE_URL ?? 'http://localhost:3000/ainews';
const SHOT_DIR = process.env.SHOT_DIR;
const PUBLIC = ['ai-tech', 'ai-product', 'ai-biz'];
const L = {
  ko: { filters: '필터' },
  zh: { filters: '筛选' },
} as const;

async function shot(page: Page, name: string, target?: Locator) {
  if (!SHOT_DIR) return;
  mkdirSync(SHOT_DIR, { recursive: true });
  if (target) await target.screenshot({ path: `${SHOT_DIR}/${name}.png` });
  else await page.screenshot({ path: `${SHOT_DIR}/${name}.png` });
}

test('API: 필터 선택지는 공개 분류 3개(설정 순서), 국가 1개 / 비공개 분류 값은 무시', async ({ request }) => {
  const facets = await (await request.get(`${BASE_URL}/api/news/facets`)).json();
  expect(facets.categories).toEqual(PUBLIC);
  expect(facets.countries.length).toBeLessThanOrEqual(1);

  // 다른 데이터 작업이 행을 넣고 있을 수 있어 두 요청을 연달아 다시 받아 비교한다
  const total = async (q: string) => (await (await request.get(`${BASE_URL}/api/news?limit=1${q}`)).json()).total as number;
  await expect.poll(async () => (await total('&categories=economy,culture')) - (await total('')), { timeout: 15_000 }).toBe(0);
  const all = { total: await total('') };
  const tech = await (await request.get(`${BASE_URL}/api/news?limit=1&categories=ai-tech,economy`)).json();
  expect(tech.total).toBeLessThan(all.total);
});

for (const locale of ['ko', 'zh'] as const) {
  test(`목록 필터 (${locale}): 국가 선택 칸 없음, 분류 칩 3개 — 1440·390`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`${BASE_URL}/${locale}`);
    const chips = page.locator('[data-testid="category-chip"]:visible');
    await expect(chips).toHaveCount(3);
    expect(await chips.evaluateAll((els) => els.map((e) => e.getAttribute('data-category')))).toEqual(PUBLIC);
    await expect(page.getByTestId('country-select')).toHaveCount(0);
    await shot(page, `filters-${locale}-1440`);

    // 칩 하나를 누르면 그 분류로 걸러진다 (총 건수 감소)
    const totalText = async () => (await page.locator('main').innerText()).match(/\d[\d,]*/g)?.join('|');
    const before = await totalText();
    await chips.nth(0).click();
    await expect(chips.nth(0)).toHaveAttribute('aria-pressed', 'true');
    await expect.poll(totalText).not.toBe(before);

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${BASE_URL}/${locale}`);
    await page.getByRole('button', { name: L[locale].filters }).first().click();
    const sheet = page.getByRole('dialog');
    await expect(sheet).toBeVisible();
    // 시트가 다 열린 뒤(왼쪽에서 미끄러져 들어옴) 잰다
    await expect.poll(async () => (await sheet.boundingBox())?.x ?? -1).toBeGreaterThanOrEqual(0);
    await expect(sheet.locator('[data-testid="category-chip"]')).toHaveCount(3);
    await expect(sheet.getByTestId('country-select')).toHaveCount(0);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(1);
    await shot(page, `filters-${locale}-390`);
  });
}

// 관련 기사(상세·모달이 같은 묶음·id)는 v2(세 묶음)부터 e2e/related.spec.ts 에서 본다.

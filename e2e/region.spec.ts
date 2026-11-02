import { test, expect, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';

// 대상 지역 칩 (선택지 D, src/lib/region.ts): 전체 · 중국 · 미국 · 그 밖, 주소 ?region=, 카드 라벨·배지, 통계 차트.
//   E2E_BASE_URL=http://localhost:3088/ainews SHOT_DIR=~/ainews-reports/region npx playwright test e2e/region.spec.ts
const BASE_URL = process.env.E2E_BASE_URL ?? 'http://localhost:3000/ainews';
const SHOT_DIR = process.env.SHOT_DIR;
const CHIPS = ['ALL', 'CN', 'US', 'OTHER'];
const L = {
  ko: { filters: '필터', chips: ['전체', '중국', '미국', '그 밖'], us: '미국', cn: '중국' },
  zh: { filters: '筛选', chips: ['全部', '中国', '美国', '其他'], us: '美国', cn: '中国' },
} as const;

async function shot(page: Page, name: string) {
  if (!SHOT_DIR) return;
  mkdirSync(SHOT_DIR, { recursive: true });
  await page.screenshot({ path: `${SHOT_DIR}/${name}.png` });
}

const total = async (request: import('@playwright/test').APIRequestContext, q: string) =>
  (await (await request.get(`${BASE_URL}/api/news?limit=1${q}`)).json()).total as number;

test('API: 칩 건수 — 중국 + 미국 + 그 밖 + 미판정 = 전체, facets 와 /api/news 가 같다', async ({ request }) => {
  const facets = await (await request.get(`${BASE_URL}/api/news/facets`)).json();
  const r = facets.regions;
  expect(r.buckets.CN + r.buckets.US + r.buckets.OTHER + r.unclassified).toBe(r.total);
  // 수집이 도는 중일 수 있어 같은 순간 값을 다시 받아 비교한다
  await expect
    .poll(async () => {
      const [all, cn, us, other] = await Promise.all(['', '&region=CN', '&region=US', '&region=OTHER'].map((q) => total(request, q)));
      const f = (await (await request.get(`${BASE_URL}/api/news/facets`)).json()).regions;
      return [all - f.total, cn - f.buckets.CN, us - f.buckets.US, other - f.buckets.OTHER, all - (cn + us + other + f.unclassified)];
    }, { timeout: 15_000 })
    .toEqual([0, 0, 0, 0, 0]);
  // 모르는 값은 전체로 (400/500 이 아니다)
  expect(await total(request, '&region=TW')).toBe(await total(request, ''));
});

test('API: 날짜별 목록·펼치기도 같은 칩 조건 — 그날 total = 주요 + 펼친 기사, 모두 그 지역', async ({ request }) => {
  const page = await (await request.get(`${BASE_URL}/api/news/days?region=US&locale=ko`)).json();
  expect(page.days.length).toBeGreaterThan(0);
  const day = page.days[0];
  for (const it of day.top) expect(it.subject_region).toBe('US');
  const rest = await (await request.get(`${BASE_URL}/api/news/days/${day.date}?region=US&locale=ko&exclude=${day.top.map((t: { id: string }) => t.id).join(',')}`)).json();
  expect(rest.total).toBe(day.total);
  for (const it of rest.items) expect(it.subject_region).toBe('US');
  expect(day.top.length + rest.items.length).toBe(day.total);
  const other = await (await request.get(`${BASE_URL}/api/news/days?region=OTHER&locale=ko`)).json();
  for (const d of other.days) for (const it of d.top) expect(['CN', 'US', null]).not.toContain(it.subject_region);
});

for (const locale of ['ko', 'zh'] as const) {
  test(`지역 칩 (${locale}): 누르면 거르고 주소에 남는다, 카드에 지역 라벨 — 1440·390`, async ({ page, request }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`${BASE_URL}/${locale}`);
    const chips = page.locator('[data-testid="region-chip"]:visible');
    await expect(chips).toHaveCount(4);
    expect(await chips.evaluateAll((els) => els.map((e) => e.getAttribute('data-region')))).toEqual(CHIPS);
    expect(await chips.allInnerTexts()).toEqual([...L[locale].chips]);
    await expect(chips.nth(0)).toHaveAttribute('aria-pressed', 'true');
    // 예전 국가 선택 칸은 없다
    await expect(page.getByTestId('country-select')).toHaveCount(0);
    await shot(page, `region-${locale}-1440`);

    // 미국 칩 → 카드 라벨이 모두 미국, 주소에 ?region=US, 건수 = API
    const usTotal = await total(request, '&region=US');
    await chips.nth(2).click();
    await expect(chips.nth(2)).toHaveAttribute('aria-pressed', 'true');
    await expect(page).toHaveURL(/[?&]region=US/);
    await expect(page.locator('main')).toContainText(new RegExp(`${usTotal.toLocaleString('en-US')}|${usTotal}`));
    const labels = page.locator('[data-testid="kicker-region"]');
    await expect(labels.first()).toBeVisible();
    expect(new Set(await labels.evaluateAll((els) => els.map((e) => e.getAttribute('data-region'))))).toEqual(new Set(['US']));
    await shot(page, `region-${locale}-1440-us`);

    // 새로고침해도 칩 유지 (서버가 ?region= 으로 첫 페이지를 걸러 보낸다)
    await page.reload();
    await expect(page.locator('[data-testid="region-chip"][data-region="US"]:visible')).toHaveAttribute('aria-pressed', 'true');
    expect(new Set(await page.locator('[data-testid="kicker-region"]').evaluateAll((els) => els.map((e) => e.getAttribute('data-region'))))).toEqual(new Set(['US']));

    // 휴대폰: 시트 안의 칩
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${BASE_URL}/${locale}`);
    await page.getByRole('button', { name: L[locale].filters }).first().click();
    const sheet = page.getByRole('dialog');
    await expect(sheet).toBeVisible();
    await expect.poll(async () => (await sheet.boundingBox())?.x ?? -1).toBeGreaterThanOrEqual(0);
    await expect(sheet.locator('[data-testid="region-chip"]')).toHaveCount(4);
    await shot(page, `region-${locale}-390-sheet`);
    await sheet.locator('[data-testid="region-chip"][data-region="CN"]').click();
    await expect(page).toHaveURL(/[?&]region=CN/);
    await expect(sheet).toBeHidden();
    const cnLabels = page.locator('[data-testid="kicker-region"]');
    await expect(cnLabels.first()).toBeVisible();
    expect(new Set(await cnLabels.evaluateAll((els) => els.map((e) => e.getAttribute('data-region'))))).toEqual(new Set(['CN']));
    // 가로 넘침 없음
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
    await shot(page, `region-${locale}-390-cn`);
  });
}

test('카드 배지: 미중 배지는 태그 CN·US 기사에만', async ({ page, request }) => {
  const days = await (await request.get(`${BASE_URL}/api/news/days?locale=ko&limit=10`)).json();
  const items = days.days.flatMap((d: { top: { id: string; region_tags: string[] }[] }) => d.top);
  const uc = items.filter((i: { region_tags: string[] }) => i.region_tags?.includes('CN') && i.region_tags?.includes('US'));
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${BASE_URL}/ko`);
  const badges = page.locator('[data-testid="region-badge"][data-badge="us_china"]');
  // 첫 화면(5일)의 주요 기사 중 미중 태그 기사 수 ≥ 보이는 미중 배지 수 (스크롤로 더 받은 날은 세지 않음)
  const firstFive = days.days.slice(0, 5).flatMap((d: { top: { region_tags: string[] }[] }) => d.top)
    .filter((i: { region_tags: string[] }) => i.region_tags?.includes('CN') && i.region_tags?.includes('US')).length;
  await expect(badges).toHaveCount(firstFive);
  if (uc.length) await expect(badges.first()).toHaveText('미중');
});

for (const locale of ['ko', 'zh'] as const) {
  test(`통계 (${locale}): 지역 비중 차트`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`${BASE_URL}/${locale}/statistics`);
    const chart = page.getByTestId('region-chart');
    await expect(chart).toBeVisible();
    await expect(chart).toContainText(L[locale].cn);
    await expect(chart).toContainText(L[locale].us);
    await chart.scrollIntoViewIfNeeded();
    await shot(page, `statistics-region-${locale}-1440`);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.reload();
    await page.getByTestId('region-chart').scrollIntoViewIfNeeded();
    await shot(page, `statistics-region-${locale}-390`);
  });
}

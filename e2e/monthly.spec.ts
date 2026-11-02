import { test, expect, type Page } from '@playwright/test';

// 월간 리포트 E2E (주간과 같은 렌더러·관리자 화면). 운영 포트(3012)가 아닌 서버를 대상으로 돌린다:
//   E2E_BASE_URL=http://localhost:3092/ainews ADMIN_PASSWORD=... npx playwright test e2e/monthly.spec.ts
// 관리자 미리보기 시험은 월간 초안이 하나 이상 있어야 한다 (npx tsx scripts/briefing-generate.ts monthly --month 2026-10 --force).
// 이 시험은 아무것도 발행하지 않는다 (발행 버튼은 비활성 상태만 확인).
const BASE_URL = process.env.E2E_BASE_URL ?? 'http://localhost:3000/ainews';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

async function noHorizontalScroll(page: Page) {
  const { scrollWidth, clientWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(scrollWidth, `scrollWidth ${scrollWidth} > ${clientWidth}`).toBeLessThanOrEqual(clientWidth);
}

test('공개 /briefing/monthly: 200, 월간 탭이 현재, 발행본이 없으면 빈 안내 + noindex', async ({ page }) => {
  const res = await page.goto(`${BASE_URL}/ko/briefing/monthly`);
  expect(res?.status()).toBe(200);
  const tabs = page.getByTestId('briefing-tabs');
  await expect(tabs.getByRole('link')).toHaveCount(3);
  await expect(tabs.locator('[aria-current="page"]')).toHaveAttribute('href', /\/briefing\/monthly$/);
  await expect(page.locator('h1')).toHaveCount(1);
  if (!(await page.getByTestId('weekly').count())) {
    await expect(page.getByTestId('weekly-empty')).toBeVisible();
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
  } else {
    expect(await page.locator('link[rel="canonical"]').getAttribute('href')).toMatch(/\/briefing\/monthly\/\d{4}-\d{2}$/);
  }
});

test('월간 탭: 데일리·주간 화면에서 /briefing/monthly 로 간다', async ({ page }) => {
  for (const path of ['/ko/briefing', '/ko/briefing/weekly']) {
    await page.goto(`${BASE_URL}${path}`);
    await expect(page.getByTestId('briefing-tabs').getByRole('link', { name: '월간' })).toHaveAttribute('href', /\/briefing\/monthly$/);
  }
});

test('월 형식 오류·끝나지 않은 달·미발행 달은 404', async ({ page }) => {
  for (const m of ['2026-13', '2026-1', '2026-W44', '2099-01', '2026-11', '2026-10']) {
    const res = await page.goto(`${BASE_URL}/ko/briefing/monthly/${m}`);
    // 2026-10 은 초안만 있으므로(발행 전) 공개 404 — 발행되면 200
    if (m === '2026-10' && (await page.getByTestId('weekly').count())) continue;
    expect(res?.status(), m).toBe(404);
  }
});

test('en/zh 월간: 200 (빈 안내 또는 언어판 안내), 390 폭 가로 스크롤 없음', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  for (const locale of ['ko', 'en', 'zh']) {
    const res = await page.goto(`${BASE_URL}/${locale}/briefing/monthly`);
    expect(res?.status()).toBe(200);
    await noHorizontalScroll(page);
  }
  await context.close();
});

test('관리자 API 는 세션 없이 401 (월간 다시 생성)', async ({ request }) => {
  const res = await request.post(`${BASE_URL}/api/admin/briefing/regenerate`, { data: { date: '2026-10-01', edition_type: 'monthly' } });
  expect(res.status()).toBe(401);
});

test('내부 생성 API 는 토큰 없이 401 (주간·월간 body 포함)', async ({ request }) => {
  for (const data of [{ editionType: 'weekly' }, { editionType: 'monthly', month: '2026-10', dryRun: true }]) {
    const res = await request.post(`${BASE_URL}/api/internal/briefing/generate`, { data });
    expect(res.status()).toBe(401);
  }
});

test.describe('관리자 월간 미리보기', () => {
  test.skip(!ADMIN_PASSWORD, 'ADMIN_PASSWORD 가 없으면 건너뜀');

  async function login(page: Page) {
    const res = await page.request.post(`${BASE_URL}/api/admin/auth`, { data: { password: ADMIN_PASSWORD } });
    expect(res.ok()).toBe(true);
  }

  async function firstMonthlyId(page: Page): Promise<string> {
    await page.goto(`${BASE_URL}/ko/admin/briefings?type=monthly`);
    const rows = page.locator('[data-testid="admin-briefings-table"] tbody tr');
    expect(await rows.count()).toBeGreaterThan(0);
    const types = await rows.evaluateAll((els) => els.map((e) => e.getAttribute('data-edition-type')));
    expect(new Set(types)).toEqual(new Set(['monthly']));
    // 목록의 판 이름은 YYYY-MM
    await expect(rows.first().locator('a[href*="/admin/briefings/"]')).toHaveText(/^\d{4}-\d{2}$/);
    // 생성 실패한 판은 미리보기가 없으므로 초안을 고른다
    const draft = rows.filter({ hasText: '초안' }).first();
    const href = await draft.locator('a[href*="/admin/briefings/"]').getAttribute('href');
    return href!.split('/').pop()!;
  }

  for (const width of [1440, 390]) {
    test(`${width} 폭: 월간 미리보기 — 한 달의 흐름·작은 여러 개·데이터 알림(축소 수집), 표 대체, 가로 스크롤 없음, 발행 비활성`, async ({ browser }) => {
      const context = await browser.newContext({ viewport: { width, height: 900 } });
      const page = await context.newPage();
      await login(page);
      const id = await firstMonthlyId(page);
      const res = await page.goto(`${BASE_URL}/ko/admin/briefings/${id}`);
      expect(res?.status()).toBe(200);
      const report = page.getByTestId('weekly');
      await expect(report).toBeVisible();
      await expect(report).toHaveAttribute('data-edition-type', 'monthly');
      await expect(page.getByTestId('admin-briefing-title')).toContainText('월간');

      await expect(page.getByTestId('monthly-arc').locator('li')).toHaveCount(5); // W40~W44
      await expect(page.getByTestId('chart-multiples')).toBeVisible();
      await expect(page.getByTestId('monthly-weeklies')).toBeVisible();
      // 10-01~10-12 축소 수집 + 10-31 부분 수집
      await expect(page.getByTestId('data-notice-reduced')).toContainText('12일');
      await expect(page.getByTestId('data-notice-partial')).toBeVisible();

      const figures = report.locator('figure');
      const n = await figures.count();
      expect(n).toBeGreaterThanOrEqual(5);
      for (let i = 0; i < n; i++) {
        const f = figures.nth(i);
        await expect(f.locator('details table')).toHaveCount(1);
        const visible = await f.locator('svg[role="img"]').evaluateAll((els) => els.filter((e) => e.getBoundingClientRect().width > 0).length);
        expect(visible, `figure ${i}`).toBe(1);
      }
      await page.getByTestId('chart-daily').locator('summary').click();
      await expect(page.getByTestId('chart-daily').locator('details tbody tr')).toHaveCount(31);

      const minFont = await report.locator('svg[role="img"] text').evaluateAll((els) =>
        Math.min(
          ...els
            .filter((e) => e.getBoundingClientRect().width > 0 && (e.textContent ?? '').trim())
            .map((e) => {
              const svg = (e as SVGTextElement).ownerSVGElement!;
              return parseFloat(getComputedStyle(e).fontSize) * (svg.getBoundingClientRect().width / svg.viewBox.baseVal.width);
            })
        )
      );
      expect(minFont).toBeGreaterThanOrEqual(9);
      await noHorizontalScroll(page);

      await expect(page.getByTestId('admin-data-quality')).toBeVisible();
      await expect(page.getByTestId('admin-publish')).toBeDisabled();
      await context.close();
    });
  }

  test('데일리 10-31 주말 합본 초안: 부분 수집 데이터 알림', async ({ page }) => {
    await login(page);
    await page.goto(`${BASE_URL}/ko/admin/briefings?type=daily`);
    const row = page.locator('[data-testid="admin-briefings-table"] tbody tr', { hasText: '2026-10-31' }).filter({ hasText: '초안' }).first();
    test.skip((await row.count()) === 0, '10-31 데일리 초안 없음');
    const href = await row.locator('a[href*="/admin/briefings/"]').first().getAttribute('href');
    await page.goto(`${BASE_URL}${href!.replace(/^\/ainews/, '')}`);
    await expect(page.getByTestId('briefing-data-notice')).toContainText('수집이 일부만');
  });
});

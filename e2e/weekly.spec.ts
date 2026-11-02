import { test, expect, type Page } from '@playwright/test';

// 주간 리포트 E2E. 운영 포트(3012)가 아닌 서버를 대상으로 돌린다:
//   E2E_BASE_URL=http://localhost:3089/ainews ADMIN_PASSWORD=... npx playwright test e2e/weekly.spec.ts
// 관리자 미리보기 시험은 주간 초안이 하나 이상 있어야 한다 (npx tsx scripts/briefing-generate.ts weekly --week 2026-W44 --force).
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

test('공개 /briefing/weekly: 200, 데일리·주간 탭(주간이 현재), 발행본이 없으면 noindex', async ({ page }) => {
  const res = await page.goto(`${BASE_URL}/ko/briefing/weekly`);
  expect(res?.status()).toBe(200);
  const tabs = page.getByTestId('briefing-tabs');
  await expect(tabs.getByRole('link')).toHaveCount(2);
  await expect(tabs.locator('[aria-current="page"]')).toHaveAttribute('href', /\/briefing\/weekly$/);
  await expect(page.locator('h1')).toHaveCount(1);
  const published = (await page.getByTestId('weekly').count()) > 0;
  if (!published) {
    await expect(page.getByTestId('weekly-empty')).toBeVisible();
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
  } else {
    const canonical = await page.locator('link[rel="canonical"]').getAttribute('href');
    expect(canonical).toMatch(/\/briefing\/weekly\/\d{4}-W\d{2}$/);
  }
});

test('데일리 페이지에도 같은 탭이 있고 데일리가 현재 탭', async ({ page }) => {
  await page.goto(`${BASE_URL}/ko/briefing`);
  const tabs = page.getByTestId('briefing-tabs');
  await expect(tabs.locator('[aria-current="page"]')).toHaveAttribute('href', /\/briefing$/);
  await expect(tabs.getByRole('link', { name: '주간' })).toHaveAttribute('href', /\/briefing\/weekly$/);
});

test('주 형식 오류·끝나지 않은 주·미발행 주는 404', async ({ page }) => {
  for (const w of ['2026-44', '2026-W99', '2099-W01', '2026-W45', '2026-W44']) {
    const res = await page.goto(`${BASE_URL}/ko/briefing/weekly/${w}`);
    // 2026-W44 는 초안만 있으므로(발행 전) 공개 404 — 발행되면 200
    if (w === '2026-W44' && (await page.getByTestId('weekly').count())) continue;
    expect(res?.status(), w).toBe(404);
  }
});

test('en/zh 주간: 200 (발행본이 없으면 빈 안내, 한국어판만 있으면 언어판 안내)', async ({ page }) => {
  for (const locale of ['en', 'zh']) {
    const res = await page.goto(`${BASE_URL}/${locale}/briefing/weekly`);
    expect(res?.status()).toBe(200);
    const shown = (await page.getByTestId('weekly-empty').count()) + (await page.getByTestId('weekly-locale-missing').count());
    expect(shown).toBe(1);
  }
});

test('관리자 API 는 세션 없이 401 (주간 발행·다시 생성)', async ({ request }) => {
  for (const path of ['publish', 'regenerate']) {
    const res = await request.post(`${BASE_URL}/api/admin/briefing/${path}`, { data: { date: '2026-10-26', edition_type: 'weekly' } });
    expect(res.status(), path).toBe(401);
  }
});

test.describe('관리자 주간 미리보기', () => {
  test.skip(!ADMIN_PASSWORD, 'ADMIN_PASSWORD 가 없으면 건너뜀');

  async function login(page: Page) {
    const res = await page.request.post(`${BASE_URL}/api/admin/auth`, { data: { password: ADMIN_PASSWORD } });
    expect(res.ok()).toBe(true);
  }

  async function firstWeeklyId(page: Page): Promise<string> {
    await page.goto(`${BASE_URL}/ko/admin/briefings?type=weekly`);
    const rows = page.locator('[data-testid="admin-briefings-table"] tbody tr');
    expect(await rows.count()).toBeGreaterThan(0);
    // 유형 필터: 주간만
    const types = await rows.evaluateAll((els) => els.map((e) => e.getAttribute('data-edition-type')));
    expect(new Set(types)).toEqual(new Set(['weekly']));
    const href = await rows.first().locator('a[href*="/admin/briefings/"]').getAttribute('href');
    return href!.split('/').pop()!;
  }

  for (const width of [1440, 390]) {
    test(`${width} 폭: 200, 차트마다 표 대체·role=img, 가로 스크롤 없음, 데이터 알림 확인 전 발행 불가`, async ({ browser }) => {
      const context = await browser.newContext({ viewport: { width, height: 900 } });
      const page = await context.newPage();
      await login(page);
      const id = await firstWeeklyId(page);
      const res = await page.goto(`${BASE_URL}/ko/admin/briefings/${id}`);
      expect(res?.status()).toBe(200);
      const weekly = page.getByTestId('weekly');
      await expect(weekly).toBeVisible();

      const figures = weekly.locator('figure');
      const n = await figures.count();
      expect(n).toBeGreaterThanOrEqual(5);
      // 그림마다 표 대체(details > table) 하나, 보이는 SVG 하나(role=img, 제목 연결)
      for (let i = 0; i < n; i++) {
        const f = figures.nth(i);
        await expect(f.locator('details table')).toHaveCount(1);
        const visible = await f.locator('svg[role="img"]').evaluateAll((els) =>
          els.filter((e) => e.getBoundingClientRect().width > 0).map((e) => e.getAttribute('aria-labelledby'))
        );
        expect(visible.length, `figure ${i}`).toBe(1);
        await expect(f.locator(`[id="${visible[0]}"]`)).toHaveCount(1);
      }
      // 표 대체를 펼치면 행이 보인다
      await page.getByTestId('chart-daily').locator('summary').click();
      await expect(page.getByTestId('chart-daily').locator('details tbody tr')).toHaveCount(7);

      // 휴대폰 폭: SVG 글자가 9px 아래로 줄지 않는다
      const minFont = await weekly.locator('svg[role="img"] text').evaluateAll((els) =>
        Math.min(
          ...els
            .filter((e) => e.getBoundingClientRect().width > 0)
            .map((e) => {
              const svg = (e as SVGTextElement).ownerSVGElement!;
              return parseFloat(getComputedStyle(e).fontSize) * (svg.getBoundingClientRect().width / svg.viewBox.baseVal.width);
            })
        )
      );
      expect(minFont).toBeGreaterThanOrEqual(9);
      await noHorizontalScroll(page);

      // 결손일이 있는 판: 데이터 알림 + 확인란을 선택하기 전에는 발행 버튼 비활성 (클릭하지 않는다)
      if (await page.getByTestId('admin-data-quality').count()) {
        await expect(page.getByTestId('weekly-data-notice')).toBeVisible();
        await expect(page.getByTestId('admin-publish')).toBeDisabled();
      }
      await context.close();
    });
  }
});

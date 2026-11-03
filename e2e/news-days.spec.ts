import { test, expect, type Page, type Locator } from '@playwright/test';

// 홈 날짜별 목록: 날마다 주요 4건 + "이날 기사 N건 더 보기" 펼치기.
//   E2E_BASE_URL=http://localhost:3090/ainews npx playwright test e2e/news-days.spec.ts
const BASE_URL = process.env.E2E_BASE_URL ?? 'http://localhost:3000/ainews';

const days = (page: Page) => page.getByTestId('news-day');
const links = (scope: Locator) => scope.locator('a[href*="/news/"]');

/** 기사가 4건보다 많은 첫 날 (펼치기 버튼이 있는 날) */
async function firstExpandableDay(page: Page): Promise<Locator> {
  const day = days(page).filter({ has: page.getByTestId('news-day-toggle') }).first();
  await expect(day).toBeVisible();
  return day;
}

async function visibleLinkHrefs(scope: Locator): Promise<string[]> {
  return links(scope).evaluateAll((els) =>
    els.filter((e) => (e as HTMLElement).offsetParent !== null).map((e) => e.getAttribute('href') ?? '')
  );
}

async function expectExpandedFully(day: Locator) {
  const total = Number(await day.getAttribute('data-total'));
  const toggle = day.getByTestId('news-day-toggle');
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await expect(day.getByTestId('news-day-rest')).toBeVisible();
  const hrefs = await visibleLinkHrefs(day);
  expect(hrefs.length).toBe(total);
  expect(new Set(hrefs).size).toBe(total);
}

test.describe('홈 날짜별 목록 (주요 4건 + 펼치기)', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`${BASE_URL}/ko/news`);
    await expect(days(page).first()).toBeVisible();
  });

  test('날마다 기본 4건 이하, 4건 넘는 날만 버튼, 버튼 수 = 전체 − 주요', async ({ page }) => {
    const n = await days(page).count();
    expect(n).toBeGreaterThan(0);
    for (let i = 0; i < n; i++) {
      const day = days(page).nth(i);
      const total = Number(await day.getAttribute('data-total'));
      const shown = (await visibleLinkHrefs(day)).length;
      expect(shown).toBeLessThanOrEqual(4);
      const toggle = day.getByTestId('news-day-toggle');
      if (total > shown) {
        await expect(toggle).toHaveText(new RegExp(`이날 기사 ${total - shown}건 더 보기`));
        await expect(toggle).toHaveAttribute('aria-expanded', 'false');
        await expect(day.getByTestId('news-day-count')).toHaveText(`주요 ${shown}건 · 전체 ${total}건`);
      } else {
        await expect(toggle).toHaveCount(0);
      }
    }
  });

  test('펼치기: 그날 전체가 보이고(개수·중복 없음) 포커스는 새 첫 기사, 접기: 버튼으로 포커스·화면 위치 유지', async ({ page }) => {
    const day = await firstExpandableDay(page);
    const toggle = day.getByTestId('news-day-toggle');
    const topHrefs = await visibleLinkHrefs(day.getByTestId('news-day-top'));
    await toggle.click();
    await expectExpandedFully(day);
    await expect(toggle).toHaveText(/접기/);

    const focusedHref = await page.evaluate(() => document.activeElement?.getAttribute('href'));
    const firstRest = await links(day.getByTestId('news-day-rest')).first().getAttribute('href');
    expect(focusedHref).toBe(firstRest);
    expect(topHrefs).not.toContain(focusedHref);

    // 접기: 버튼을 화면에 두고 누른 뒤, 버튼의 화면 위치가 그대로여야 한다
    await toggle.scrollIntoViewIfNeeded();
    const before = (await toggle.boundingBox())!.y;
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(day.getByTestId('news-day-rest')).toBeHidden();
    expect((await visibleLinkHrefs(day)).length).toBeLessThanOrEqual(4);
    await expect(toggle).toBeFocused();
    const after = (await toggle.boundingBox())!.y;
    expect(Math.abs(after - before)).toBeLessThanOrEqual(2);
  });

  test('키보드: Enter 로 펼치고 Space 로 접는다', async ({ page }) => {
    const day = await firstExpandableDay(page);
    const toggle = day.getByTestId('news-day-toggle');
    await toggle.focus();
    await page.keyboard.press('Enter');
    await expectExpandedFully(day);
    await toggle.focus();
    await page.keyboard.press('Space');
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(toggle).toBeFocused();
  });

  test('리스트 보기도 같은 펼치기, 보기를 바꿔도 펼침 유지', async ({ page }) => {
    await page.getByRole('button', { name: '목록 보기' }).click();
    const day = await firstExpandableDay(page);
    await day.getByTestId('news-day-toggle').click();
    await expectExpandedFully(day);
    await page.getByRole('button', { name: '그리드 보기' }).click();
    await expectExpandedFully(day);
  });

  test('검색 필터: 걸러진 기사 안에서 날마다 4건 이하 + 펼치기 개수 일치', async ({ page }) => {
    const totalText = page.getByText(/총 [\d,]+개의 기사/).first();
    const beforeText = await totalText.textContent().catch(() => null);
    await page.locator('input[placeholder*="검색"]').first().fill('OpenAI');
    await expect(async () => {
      const t = await totalText.textContent();
      expect(t).not.toBe(beforeText);
    }).toPass({ timeout: 10000 });
    await expect(days(page).first()).toBeVisible();
    const n = await days(page).count();
    for (let i = 0; i < n; i++) {
      expect((await visibleLinkHrefs(days(page).nth(i))).length).toBeLessThanOrEqual(4);
    }
    const day = days(page).filter({ has: page.getByTestId('news-day-toggle') }).first();
    if (await day.count()) {
      await day.getByTestId('news-day-toggle').click();
      await expectExpandedFully(day);
    }
  });

  test('펼치기 실패: 오류 안내 + 다시 시도로 복구', async ({ page }) => {
    const DAY_API = /\/api\/news\/days\/\d{4}-\d{2}-\d{2}/;
    await page.route(DAY_API, (route) => route.abort());
    const day = await firstExpandableDay(page);
    const toggle = day.getByTestId('news-day-toggle');
    await toggle.click();
    await expect(day.getByTestId('news-day-error')).toBeVisible();
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(toggle).toHaveText(/더 보기/);
    await page.unroute(DAY_API);
    await day.getByTestId('news-day-error').getByRole('button', { name: /다시 시도/ }).click();
    await expectExpandedFully(day);
    await expect(day.getByTestId('news-day-error')).toHaveCount(0);
  });

  test('펼치기 로딩: aria-busy + 불러오는 중 문구', async ({ page }) => {
    const DAY_API = /\/api\/news\/days\/\d{4}-\d{2}-\d{2}/;
    await page.route(DAY_API, async (route) => {
      await new Promise((r) => setTimeout(r, 800));
      await route.continue();
    });
    const day = await firstExpandableDay(page);
    const toggle = day.getByTestId('news-day-toggle');
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-busy', 'true');
    await expect(toggle).toHaveText(/불러오는 중/);
    await expectExpandedFully(day);
    await expect(toggle).not.toHaveAttribute('aria-busy', 'true');
  });

  test('펼친 뒤 기사 모달을 열고 닫아도 펼침 유지', async ({ page }) => {
    const day = await firstExpandableDay(page);
    await day.getByTestId('news-day-toggle').click();
    await expectExpandedFully(day);
    await links(day.getByTestId('news-day-rest')).first().click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expectExpandedFully(day);
  });
});

test('390px: 가로 스크롤 없음 (접힘·펼침)', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${BASE_URL}/ko/news`);
  await expect(days(page).first()).toBeVisible();
  const noHScroll = () =>
    page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);
  expect(await noHScroll()).toBe(true);
  const day = await firstExpandableDay(page);
  await day.getByTestId('news-day-toggle').click();
  await expectExpandedFully(day);
  expect(await noHScroll()).toBe(true);
});

test('zh: 펼치기 문구가 중국어', async ({ page }) => {
  await page.goto(`${BASE_URL}/zh/news`);
  const day = await firstExpandableDay(page);
  await expect(day.getByTestId('news-day-toggle')).toHaveText(/查看当天其余 \d+ 篇/);
  await day.getByTestId('news-day-toggle').click();
  await expect(day.getByTestId('news-day-toggle')).toHaveText(/收起/);
});

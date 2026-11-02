import { test, expect, type Page } from '@playwright/test';
import { mkdirSync, readFileSync } from 'node:fs';
import { isEditionPending } from '../src/lib/briefing/sla';

// 홈 날짜 → 그날 브리핑 팝업 (?briefing=YYYY-MM-DD 대화상자) E2E.
// 발행본은 공유 DB 에 쓰지 않고 시험 데이터 이음매로 준다 (src/lib/briefing/fixture.ts):
//   npx tsx --env-file=.env.local scripts/e2e-briefing-fixture.ts            # READ ONLY 조회로 e2e/.fixtures/briefings.json 생성
//   AINEWS_E2E_BRIEFING_FIXTURE=$PWD/e2e/.fixtures/briefings.json npx next start -p 3089
//   AINEWS_E2E_BRIEFING_FIXTURE=$PWD/e2e/.fixtures/briefings.json E2E_BASE_URL=http://localhost:3089/ainews npx playwright test e2e/day-briefing.spec.ts
// 화면 캡처: DAY_BRIEFING_SHOTS=<폴더> 를 주면 Gate 3 측정 때 캡처를 남긴다.
const BASE_URL = process.env.E2E_BASE_URL ?? 'http://localhost:3000/ainews';
const FIXTURE = process.env.AINEWS_E2E_BRIEFING_FIXTURE;
const SHOTS = process.env.DAY_BRIEFING_SHOTS;

test.skip(!FIXTURE, 'AINEWS_E2E_BRIEFING_FIXTURE 가 필요하다 (서버와 같은 시험 데이터 파일)');

type Row = { edition_date: string; locale: string; status: string; content: { headline: string } };
const fixture = FIXTURE
  ? (JSON.parse(readFileSync(FIXTURE, 'utf8')) as { roles: Record<string, string>; rows: Row[] })
  : { roles: {} as Record<string, string>, rows: [] as Row[] };
const R = fixture.roles;
const headline = (date: string, locale = 'ko') =>
  fixture.rows.find((r) => r.edition_date === date && r.locale === locale && r.status === 'published')!.content.headline;

const day = (page: Page, date: string) => page.locator(`[data-testid="news-day"][data-date="${date}"]`);
const dayLink = (page: Page, date: string) => day(page, date).getByTestId('day-briefing-link');
const dialog = (page: Page) => page.getByTestId('day-briefing-dialog');
const focusKey = (page: Page) => page.evaluate(() => document.activeElement?.getAttribute('data-focus-key') ?? document.activeElement?.tagName);

async function home(page: Page, locale = 'ko', query = '') {
  await page.goto(`${BASE_URL}/${locale}${query}`);
  await page.waitForLoadState('networkidle');
}

/** 링크를 화면 가운데로 옮겨 놓고 연다 → 열기 전 스크롤 위치 */
async function openFrom(page: Page, date: string): Promise<number> {
  const link = dayLink(page, date);
  await link.evaluate((el) => el.scrollIntoView({ block: 'center' }));
  const y = await page.evaluate(() => window.scrollY);
  await link.click();
  await expect(dialog(page)).toBeVisible();
  await expect(page.getByTestId('briefing-compact')).toBeVisible();
  return y;
}

async function expectClosedBackOnLink(page: Page, date: string, y: number) {
  await expect(dialog(page)).toHaveCount(0);
  expect(new URL(page.url()).searchParams.has('briefing')).toBe(false);
  await expect.poll(() => focusKey(page)).toBe(`day-briefing-${date}`);
  expect(Math.abs((await page.evaluate(() => window.scrollY)) - y)).toBeLessThanOrEqual(2);
}

test.describe('홈 날짜 브리핑 팝업', () => {
  test('1. 열기: 주소에 ?briefing=, 제목은 판 헤드라인, 팝업에는 h1 없음', async ({ page }) => {
    await home(page);
    await openFrom(page, R.koDay);
    expect(new URL(page.url()).searchParams.get('briefing')).toBe(R.koDay);
    await expect(dialog(page).getByRole('heading', { level: 2 })).toHaveText(headline(R.koDay));
    await expect(dialog(page)).toHaveAttribute('role', 'dialog');
    await expect(dialog(page).locator('h1')).toHaveCount(0);
    // 전체 브리핑 읽기 링크와 근거 기사 링크
    await expect(page.getByTestId('briefing-compact-full')).toHaveAttribute('href', `/ainews/ko/briefing/${R.koDay}`);
    // 링크의 화면 낭독기 이름에 헤드라인
    await expect(dayLink(page, R.koDay)).toHaveAttribute('aria-label', new RegExp(headline(R.koDay).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  });

  test('2. Esc 로 닫으면 포커스가 링크로 돌아오고 스크롤 위치가 같다', async ({ page }) => {
    await home(page);
    const y = await openFrom(page, R.koDay);
    await page.keyboard.press('Escape');
    await expectClosedBackOnLink(page, R.koDay, y);
  });

  test('3. 바깥 누르기·닫기 버튼도 같다', async ({ page }) => {
    await home(page);
    let y = await openFrom(page, R.koDay);
    await page.mouse.click(8, 400); // 760px 상자 바깥 (오버레이)
    await expectClosedBackOnLink(page, R.koDay, y);
    y = await openFrom(page, R.koDay);
    await page.getByTestId('modal-close').click();
    await expectClosedBackOnLink(page, R.koDay, y);
  });

  test('4. 뒤로 = 닫힘, 앞으로 = 다시 열림', async ({ page }) => {
    await home(page);
    const y = await openFrom(page, R.koDay);
    await page.goBack();
    await expectClosedBackOnLink(page, R.koDay, y);
    await page.goForward();
    await expect(dialog(page)).toBeVisible();
    await expect(dialog(page).getByRole('heading', { level: 2 })).toHaveText(headline(R.koDay));
  });

  test('5. (b) 팝업 상태에서 새로고침하면 홈 + 팝업, 닫으면 홈에 남는다(사이트를 떠나지 않음)', async ({ page }) => {
    await home(page);
    await openFrom(page, R.koDay);
    await page.reload();
    await expect(dialog(page)).toBeVisible();
    await expect(dialog(page).getByRole('heading', { level: 2 })).toHaveText(headline(R.koDay));
    await page.keyboard.press('Escape');
    await expect(dialog(page)).toHaveCount(0);
    expect(page.url()).toBe(`${BASE_URL}/ko`);
    await expect(day(page, R.koDay)).toBeVisible();
  });

  test('6. 주소로 직접 들어가면 전체 페이지 (h1 1개, 팝업 없음)', async ({ page }) => {
    const res = await page.goto(`${BASE_URL}/ko/briefing/${R.koDay}`);
    expect(res?.status()).toBe(200);
    await expect(page.locator('h1')).toHaveText(headline(R.koDay));
    await expect(page.locator('[role="dialog"]')).toHaveCount(0);
  });

  test('7. 팝업 안 근거 기사 → 기사 팝업 → 뒤로(브리핑 팝업) → 뒤로(홈)', async ({ page }) => {
    await home(page);
    const y = await openFrom(page, R.koDay);
    const src = page.getByTestId('briefing-compact').locator('a[href*="/news/"]').first();
    await src.click();
    await expect(page).toHaveURL(/\/ko\/news\/[0-9a-f-]+$/);
    await expect(page.getByTestId('news-modal')).toBeVisible();
    await expect(dialog(page)).toHaveCount(0);
    await page.goBack();
    await expect(dialog(page)).toBeVisible();
    await expect(page.getByTestId('news-modal')).toHaveCount(0);
    expect(new URL(page.url()).searchParams.get('briefing')).toBe(R.koDay);
    await page.goBack();
    await expectClosedBackOnLink(page, R.koDay, y);
  });

  test('8. 전체 브리핑 읽기 = 전체 페이지 이동', async ({ page }) => {
    await home(page);
    await openFrom(page, R.koDay);
    await page.evaluate(() => ((window as unknown as { __mark: number }).__mark = 1));
    await page.getByTestId('briefing-compact-full').click();
    await expect(page).toHaveURL(`${BASE_URL}/ko/briefing/${R.koDay}`);
    await expect(page.locator('h1')).toHaveText(headline(R.koDay));
    expect(await page.evaluate(() => (window as unknown as { __mark?: number }).__mark)).toBeUndefined();
    await expect(page.locator('[role="dialog"]')).toHaveCount(0);
  });

  test('9. 전체 페이지의 이전·다음 판·아카이브 링크는 팝업이 아니라 전체 이동 (회귀 방지)', async ({ page }) => {
    const mark = () => page.evaluate(() => ((window as unknown as { __mark: number }).__mark = 1));
    const marked = () => page.evaluate(() => (window as unknown as { __mark?: number }).__mark);
    await page.goto(`${BASE_URL}/ko/briefing/${R.weekendSat}`);
    await mark();
    // 이전 판 (ko 발행본 중 바로 앞 = koDay)
    await page.locator(`[data-testid="briefing"] nav a[href$="/briefing/${R.koDay}"]`).click();
    await expect(page).toHaveURL(`${BASE_URL}/ko/briefing/${R.koDay}`);
    await expect(page.locator('h1')).toHaveText(headline(R.koDay));
    expect(await marked()).toBeUndefined();
    await expect(page.locator('[role="dialog"]')).toHaveCount(0);
    // 다음 판
    await mark();
    await page.locator(`[data-testid="briefing"] nav a[href$="/briefing/${R.weekendSat}"]`).click();
    await expect(page.locator('h1')).toHaveText(headline(R.weekendSat));
    expect(await marked()).toBeUndefined();
    // 아카이브 링크 → 목록 링크
    await mark();
    await page.locator('[data-testid="briefing"] a[href$="/briefing/archive"]').click();
    await expect(page).toHaveURL(`${BASE_URL}/ko/briefing/archive`);
    await expect(page.locator('h1')).toHaveCount(1);
    expect(await marked()).toBeUndefined();
    await mark();
    await page.locator(`main a[href$="/briefing/${R.page2Day}"]`).click();
    await expect(page.locator('h1')).toHaveText(headline(R.page2Day));
    expect(await marked()).toBeUndefined();
    await expect(page.locator('[role="dialog"]')).toHaveCount(0);
  });

  test('10. 정적 형제 경로(/briefing/archive·weekly·monthly)가 정상으로 뜬다 (가로채기 사전 검증에서 깨졌던 것)', async ({ page }) => {
    // 브리핑 탭 소프트 이동
    await page.goto(`${BASE_URL}/ko/briefing`);
    for (const kind of ['weekly', 'monthly']) {
      await page.getByTestId('briefing-tabs').locator(`a[href$="/briefing/${kind}"]`).click();
      await expect(page).toHaveURL(`${BASE_URL}/ko/briefing/${kind}`);
      await expect(page.getByTestId('briefing-tabs').locator('a[aria-current="page"]')).toHaveAttribute('href', new RegExp(`/briefing/${kind}$`));
      await expect(page.locator('[role="dialog"]')).toHaveCount(0);
    }
    // 홈에서 소프트 이동
    for (const p of ['archive', 'weekly', 'monthly']) {
      await home(page);
      await page.evaluate((p) => (window as unknown as { next: { router: { push: (u: string) => void } } }).next.router.push(`/ko/briefing/${p}`), p);
      await expect(page).toHaveURL(`${BASE_URL}/ko/briefing/${p}`);
      await expect(page.locator('main h1, main [data-testid="briefing-tabs"]').first()).toBeVisible();
      await expect(page.locator('[data-testid="news-day"]')).toHaveCount(0);
      await expect(page.locator('[role="dialog"]')).toHaveCount(0);
    }
  });

  test('11. 토·일이 같은 토요일 판으로 연결되고, 무한 스크롤로 받은 날에도 링크가 있다', async ({ page }) => {
    await home(page);
    const sat = R.weekendSat;
    const sun = new Date(Date.parse(`${sat}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
    for (const d of [sat, sun]) {
      // 첫 화면에 없으면 무한 스크롤
      for (let i = 0; i < 6 && !(await day(page, d).count()); i++) {
        await page.mouse.wheel(0, 20000);
        await page.waitForTimeout(800);
      }
      await expect(dayLink(page, d)).toHaveAttribute('data-edition', sat);
      await expect(dayLink(page, d)).toContainText('주말 합본 브리핑');
    }
    await home(page);
    await dayLink(page, sun).click();
    await expect(page.getByTestId('briefing-compact-date')).toContainText('주말 합본');
    await expect(dialog(page).getByRole('heading', { level: 2 })).toHaveText(headline(sat));
    await page.keyboard.press('Escape');
    await expect.poll(() => focusKey(page)).toBe(`day-briefing-${sun}`);

    // 무한 스크롤(/api/news/days)로 받은 날
    await expect(day(page, R.page2Day)).toHaveCount(0);
    for (let i = 0; i < 6 && !(await day(page, R.page2Day).count()); i++) {
      await page.mouse.wheel(0, 20000);
      await page.waitForTimeout(800);
    }
    await expect(dayLink(page, R.page2Day)).toHaveAttribute('data-edition', R.page2Day);
    await dayLink(page, R.page2Day).click();
    await expect(dialog(page).getByRole('heading', { level: 2 })).toHaveText(headline(R.page2Day));
  });

  test('12. 발행본 없는 날·다른 언어판만 있는 날·발행 예정 표시', async ({ page }) => {
    const now = new Date();
    const expected = (d: string, hasLocaleEdition: boolean) => (hasLocaleEdition ? 'link' : isEditionPending(d, now) ? 'pending' : 'none');
    await home(page, 'ko');
    // 오늘 묶음: 판 없음 → 마감 전이면 "발행 예정" (오늘 묶음은 언제나 마감 전)
    await expect(day(page, R.today)).toHaveAttribute('data-briefing-state', expected(R.today, false));
    if (expected(R.today, false) === 'pending') {
      await expect(day(page, R.today).getByTestId('day-briefing-pending')).toHaveText('브리핑 발행 예정');
      await expect(day(page, R.today).locator('a[data-testid="day-briefing-link"]')).toHaveCount(0);
    }
    // en 판만 있는 날: ko 화면에서는 링크 없음 (결정 1)
    await expect(day(page, R.enOnlyDay)).toHaveAttribute('data-briefing-state', expected(R.enOnlyDay, false));
    await expect(day(page, R.enOnlyDay).getByTestId('day-briefing-link')).toHaveCount(0);
    // en 화면에서는 링크, ko 판만 있는 koDay 는 en 판이 없어 링크 없음
    await home(page, 'en');
    await expect(day(page, R.enOnlyDay)).toHaveAttribute('data-briefing-state', 'link');
    await expect(day(page, R.koDay)).toHaveAttribute('data-briefing-state', expected(R.koDay, false));
    // zh 화면: koDay 는 zh 판이 있어 링크
    await home(page, 'zh');
    await expect(day(page, R.koDay)).toHaveAttribute('data-briefing-state', 'link');
    await expect(dayLink(page, R.koDay)).toContainText('当日简报');
  });

  test('철회된 판을 팝업 주소로 열면 정정 안내 (404 화면이 아님)', async ({ page }) => {
    await home(page, 'ko', `?briefing=${R.withdrawnDay}`);
    await expect(page.getByTestId('briefing-withdrawn')).toBeVisible();
    await expect(page.getByTestId('briefing-withdrawn').locator('a[href$="/corrections"]')).toBeVisible();
    await expect(dialog(page).getByRole('heading')).toHaveText('이 브리핑은 정정·철회되었습니다.');
  });

  test('기사 팝업: 닫은 뒤 포커스가 누른 카드 링크로 돌아온다 (예전: BODY) — Esc·뒤로가기', async ({ page }) => {
    await home(page);
    const card = page.locator('[data-testid="news-day-top"] a[href*="/news/"]').first();
    const href = await card.getAttribute('href');
    await card.click();
    await expect(page.getByTestId('news-modal')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('news-modal')).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => document.activeElement?.getAttribute('href'))).toBe(href);
    await card.click();
    await expect(page.getByTestId('news-modal')).toBeVisible();
    await page.goBack();
    await expect(page.getByTestId('news-modal')).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => document.activeElement?.getAttribute('href'))).toBe(href);
  });
});

test('기사 팝업도 같은 틀: 390 에서 92% 바닥 시트, 닫기 버튼 이름 번역', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  await home(page, 'zh');
  await page.locator('[data-testid="news-day-top"] a[href*="/news/"]').first().click();
  const modal = page.getByTestId('news-modal');
  await expect(modal).toBeVisible();
  await page.waitForTimeout(400);
  const box = (await modal.boundingBox())!;
  expect(Math.round(box.y + box.height)).toBe(844);
  expect(Math.abs(box.height - 844 * 0.92)).toBeLessThanOrEqual(1);
  await expect(modal.getByRole('button', { name: '关闭' })).toBeVisible();
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/article-sheet-390-zh.png` });
  await ctx.close();
});

// ───────────────────────── Gate 3: 1440·390 × 라이트·다크 × ko·zh

/** 색 문자열(oklch 포함) → sRGB 상대 휘도 대비 */
async function linkContrast(page: Page, selector: string): Promise<number> {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel) as HTMLElement;
    const c = document.createElement('canvas');
    c.width = c.height = 1;
    const ctx = c.getContext('2d')!;
    const rgb = (color: string) => {
      ctx.clearRect(0, 0, 1, 1);
      ctx.fillStyle = color;
      ctx.fillRect(0, 0, 1, 1);
      return Array.from(ctx.getImageData(0, 0, 1, 1).data.slice(0, 3));
    };
    let bgEl: HTMLElement | null = el;
    let bg = 'rgba(0, 0, 0, 0)';
    while (bgEl && (bg === 'rgba(0, 0, 0, 0)' || bg === 'transparent')) {
      bg = getComputedStyle(bgEl).backgroundColor;
      bgEl = bgEl.parentElement;
    }
    const lum = ([r, g, b]: number[]) => {
      const f = (v: number) => {
        const s = v / 255;
        return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
      };
      return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
    };
    const a = lum(rgb(getComputedStyle(el).color));
    const b = lum(rgb(bg));
    return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
  }, selector);
}

for (const width of [1440, 390]) {
  for (const scheme of ['light', 'dark'] as const) {
    for (const locale of ['ko', 'zh']) {
      test(`Gate 3: ${width} ${scheme} ${locale} — 제목 줄 높이·가로 스크롤·링크 대비·시트`, async ({ browser }) => {
        const ctx = await browser.newContext({ viewport: { width, height: width > 600 ? 900 : 844 }, colorScheme: scheme });
        const page = await ctx.newPage();
        await home(page, locale);
        const mobile = width < 640;
        const heads = await page.locator('[data-testid="news-day"]').evaluateAll((els) =>
          els.map((e) => ({
            date: e.getAttribute('data-date'),
            state: e.getAttribute('data-briefing-state'),
            h: Math.round((e.querySelector('[data-testid="news-day-head"]') as HTMLElement).getBoundingClientRect().height * 10) / 10,
          }))
        );
        console.log(`[gate3] ${width} ${scheme} ${locale}`, JSON.stringify(heads));
        for (const h of heads) {
          if (!mobile) expect(h.h, `${h.date} ${h.state}`).toBe(44);
          else if (h.state === 'link') expect(h.h, `${h.date} link`).toBe(76);
        }
        const { sw, cw } = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
        expect(sw).toBeLessThanOrEqual(cw);
        const ratio = await linkContrast(page, '[data-testid="day-briefing-link"]');
        console.log(`[gate3] link contrast ${width} ${scheme} ${locale}: ${ratio.toFixed(2)}`);
        expect(ratio).toBeGreaterThanOrEqual(4.5);
        const pend = page.getByTestId('day-briefing-pending').first();
        if (await pend.count()) expect(await linkContrast(page, '[data-testid="day-briefing-pending"]')).toBeGreaterThanOrEqual(4.5);
        if (SHOTS) {
          mkdirSync(SHOTS, { recursive: true });
          // 오늘(발행 예정) 묶음 제목 줄이 머리 바로 아래에 오게
          await page.locator('[data-testid="news-day-head"]').first().evaluate((el) => {
            el.scrollIntoView({ block: 'start' });
            window.scrollBy(0, -72);
          });
          await page.screenshot({ path: `${SHOTS}/home-${width}-${scheme}-${locale}.png` });
        }
        // 팝업: 데스크톱 760px 상자 / 휴대폰 92% 바닥 시트, 팝업 안에서도 가로 스크롤 없음
        await dayLink(page, R.weekendSat).click();
        await expect(page.getByTestId('briefing-compact')).toBeVisible();
        await page.waitForTimeout(400); // 열림 애니메이션
        const box = (await dialog(page).boundingBox())!;
        const vh = page.viewportSize()!.height;
        if (mobile) {
          expect(Math.round(box.y + box.height)).toBe(vh);
          expect(Math.abs(box.height - vh * 0.92)).toBeLessThanOrEqual(1);
          expect(box.width).toBe(width);
        } else {
          expect(box.width).toBe(760);
          expect(box.height).toBeLessThanOrEqual(vh * 0.88 + 1);
        }
        const inner = await dialog(page).evaluate((el) => ({ sw: el.scrollWidth, cw: el.clientWidth }));
        expect(inner.sw).toBeLessThanOrEqual(inner.cw);
        if (SHOTS) await page.screenshot({ path: `${SHOTS}/popup-${width}-${scheme}-${locale}.png` });
        // 시트 맨 아래까지 스크롤: 전체 브리핑 읽기 버튼이 시트 안에 다 보인다
        await page.getByTestId('briefing-compact-full').scrollIntoViewIfNeeded();
        const full = (await page.getByTestId('briefing-compact-full').boundingBox())!;
        expect(full.y + full.height).toBeLessThanOrEqual(box.y + box.height);
        if (SHOTS) await page.screenshot({ path: `${SHOTS}/popup-bottom-${width}-${scheme}-${locale}.png` });
        await ctx.close();
      });
    }
  }
}

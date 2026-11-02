import { test, expect, type Locator, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';

// 관련 기사 v2: 상세 페이지와 모달이 같은 findRelated·같은 컴포넌트 → 같은 묶음·같은 id·같은 순서 (Gate 2).
//   E2E_BASE_URL=http://localhost:3095/ainews npx playwright test e2e/related.spec.ts
// 고정 기사: 홈 첫 화면 카드 중 관련 기사 묶음이 2개 이상인 첫 기사 (API 로 고르며, 이 호출이 캐시도 채운다 —
// 서버 렌더와 모달이 백그라운드 재계산을 사이에 두고 갈리지 않게).
const BASE_URL = process.env.E2E_BASE_URL ?? 'http://localhost:3000/ainews';
const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const SECTIONS = ['sameEvent', 'flow', 'company'] as const;
type Ids = Record<(typeof SECTIONS)[number], string[]>;

async function homeCardIds(page: Page): Promise<string[]> {
  await page.goto(`${BASE_URL}/ko`);
  const links = page.locator('main a[href*="/news/"]');
  await expect(links.first()).toBeVisible();
  const hrefs = await links.evaluateAll((els) => els.map((e) => e.getAttribute('href') ?? ''));
  return [...new Set(hrefs.map((h) => h.match(UUID_RE)?.[0]).filter((x): x is string => !!x))];
}

async function apiIds(page: Page, id: string): Promise<Ids> {
  const res = await page.request.get(`${BASE_URL}/api/news/related?id=${id}`);
  expect(res.ok()).toBeTruthy();
  const j = await res.json();
  return Object.fromEntries(SECTIONS.map((s) => [s, (j[s] as { id: string }[]).map((x) => x.id)])) as Ids;
}

async function domIds(scope: Locator): Promise<Ids> {
  const root = scope.getByTestId('related-sections');
  await expect(root).toBeVisible();
  const out = {} as Ids;
  for (const s of SECTIONS) {
    out[s] = await root.locator(`[data-section="${s}"] [data-related-id]`).evaluateAll((els) => els.map((e) => e.getAttribute('data-related-id') ?? ''));
  }
  return out;
}

const nonEmpty = (x: Ids) => SECTIONS.filter((s) => x[s].length > 0).length;

test('상세 페이지와 모달이 같은 관련 기사 묶음·id·순서를 보인다 (API 와도 같다)', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const ids = await homeCardIds(page);
  let pick: { id: string; api: Ids } | null = null;
  for (const id of ids.slice(0, 20)) {
    const api = await apiIds(page, id);
    if (nonEmpty(api) >= 2) {
      pick = { id, api };
      break;
    }
  }
  test.skip(!pick, '홈 카드 중 관련 기사 묶음이 2개 이상인 기사가 없다');
  const id = pick!.id;
  // 첫 읽기가 오래된 계산이었다면 응답 뒤 재계산이 돈다 — 끝난 뒤 다시 읽은 값을 기준으로 (재계산 뒤 10분은 그대로)
  await page.waitForTimeout(2000);
  const api = await apiIds(page, id);
  for (const s of SECTIONS) expect(api[s].length).toBeLessThanOrEqual(3);

  // 상세 페이지 (서버 렌더)
  await page.goto(`${BASE_URL}/ko/news/${id}`);
  const detail = await domIds(page.locator('main'));
  expect(detail).toEqual(api);
  // 빈 묶음은 그리지 않는다
  for (const s of SECTIONS) await expect(page.locator(`[data-testid="related-sections"] [data-section="${s}"]`)).toHaveCount(api[s].length ? 1 : 0);
  // 흐름·후속은 날짜 차이를 보인다
  if (api.flow.length) await expect(page.locator('[data-section="flow"] [data-testid="related-gap"]').first()).toHaveText(/\d+일 (전|후)/);

  // 모달 (홈에서 카드 클릭 → 가로채기 라우트, /api/news/related 로 불러온다)
  await page.goto(`${BASE_URL}/ko`);
  await page.locator(`main a[href*="/news/${id}"]`).first().click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  const modal = await domIds(dialog);
  expect(modal).toEqual(detail);
});

test('zh 상세: 묶음 제목과 날짜 차이가 중국어로 나온다', async ({ page }) => {
  const ids = await homeCardIds(page);
  let id: string | null = null;
  for (const x of ids.slice(0, 20)) {
    const api = await apiIds(page, x);
    if (api.flow.length) {
      id = x;
      break;
    }
  }
  test.skip(!id, '흐름·후속 묶음이 있는 홈 카드 기사가 없다');
  await page.goto(`${BASE_URL}/zh/news/${id}`);
  const root = page.getByTestId('related-sections');
  await expect(root.getByRole('heading', { name: '相关报道' })).toBeVisible();
  await expect(root.locator('[data-section="flow"] [data-testid="related-gap"]').first()).toHaveText(/\d+天(前|后)/);
});

// 화면 캡처: SHOT_DIR 에 ko/zh × 1440/390 (상세·모달). 가로 스크롤이 없어야 한다.
test('ko·zh × 1440·390: 상세·모달 관련 기사 (가로 스크롤 없음)', async ({ page }) => {
  test.setTimeout(120_000);
  const shotDir = process.env.SHOT_DIR;
  if (shotDir) mkdirSync(shotDir, { recursive: true });
  const ids = await homeCardIds(page);
  let id: string | null = null;
  for (const x of ids.slice(0, 20)) {
    if (nonEmpty(await apiIds(page, x)) >= 2) {
      id = x;
      break;
    }
  }
  test.skip(!id, '관련 기사 묶음이 2개 이상인 홈 카드 기사가 없다');
  // 상세 캡처는 세 묶음이 모두 있는 기사(Anthropic 증권신고서)도 함께
  const fixed = '23d8b832-b98e-4a5f-8711-4a88849d8cf9';
  for (const locale of ['ko', 'zh'] as const) {
    for (const vp of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
      await page.setViewportSize(vp);
      for (const [name, target] of [['detail', id!], ['detail-anthropic', fixed]] as const) {
        await page.goto(`${BASE_URL}/${locale}/news/${target}`);
        const root = page.getByTestId('related-sections');
        if ((await root.count()) === 0) continue;
        await root.scrollIntoViewIfNeeded();
        expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
        if (shotDir) await root.screenshot({ path: `${shotDir}/${name}-${locale}-${vp.width}.png` });
      }
      await page.goto(`${BASE_URL}/${locale}`);
      await page.locator(`main a[href*="/news/${id}"]`).first().click();
      const dialog = page.getByRole('dialog');
      const root = dialog.getByTestId('related-sections');
      await expect(root).toBeVisible();
      await root.scrollIntoViewIfNeeded();
      if (shotDir) await dialog.screenshot({ path: `${shotDir}/modal-${locale}-${vp.width}.png` });
    }
  }
});

import { test, expect, type Locator, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';

// P0-5: 공개 필터는 AI 분류 3개만, 국가 선택 칸 없음(값 1개). 관련 기사는 상세·모달이 같은 id 목록.
//   E2E_BASE_URL=http://localhost:3094/ainews npx playwright test e2e/filters.spec.ts
// 화면 캡처는 SHOT_DIR(기본 없음)에 ko/zh × 1440/390 으로 남긴다.
const BASE_URL = process.env.E2E_BASE_URL ?? 'http://localhost:3000/ainews';
const SHOT_DIR = process.env.SHOT_DIR;
const PUBLIC = ['ai-tech', 'ai-product', 'ai-biz'];
const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const L = {
  ko: { related: '관련 기사', more: '관련 기사 늘리기', filters: '필터' },
  zh: { related: '相关新闻', more: '增加相关新闻', filters: '筛选' },
} as const;

async function shot(page: Page, name: string, target?: Locator) {
  if (!SHOT_DIR) return;
  mkdirSync(SHOT_DIR, { recursive: true });
  if (target) await target.screenshot({ path: `${SHOT_DIR}/${name}.png` });
  else await page.screenshot({ path: `${SHOT_DIR}/${name}.png` });
}

async function idsIn(scope: Locator): Promise<string[]> {
  const hrefs = await scope.locator('a[href*="/news/"]').evaluateAll((els) => els.map((e) => e.getAttribute('href') ?? ''));
  return [...new Set(hrefs.map((h) => h.match(UUID_RE)?.[0]).filter((x): x is string => !!x))];
}

/** "늘리기" 를 끝까지 눌러 관련 기사 전부를 보이게 한 뒤 id 목록 */
async function expandRelated(page: Page, section: Locator, more: string): Promise<string[]> {
  const btn = section.getByRole('button', { name: more });
  // 관련 기사가 1건이면 ± 버튼이 없다
  for (let i = 0; i < 4 && (await btn.count()) > 0 && (await btn.isEnabled()); i++) await btn.click();
  return idsIn(section.locator('div.grid'));
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

test('관련 기사: 상세 페이지와 모달이 같은 id 목록 (ko·zh, 1440·390)', async ({ page, request }) => {
  test.setTimeout(120_000); // 언어 2 × 화면 2 × (상세 + 홈 + 모달)
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${BASE_URL}/ko`);
  const cardIds = await idsIn(page.locator('main'));
  // 관련 기사가 2건 이상인 홈 카드 기사
  let seed = '';
  let apiIds: string[] = [];
  for (const id of cardIds.slice(0, 20)) {
    const rel = (await (await request.get(`${BASE_URL}/api/news/related?id=${id}&limit=4`)).json()) as { id: string }[];
    if (rel.length >= 2) {
      seed = id;
      apiIds = rel.map((r) => r.id);
      break;
    }
  }
  test.skip(!seed, '관련 기사가 2건 이상인 홈 카드가 없다');
  expect(apiIds).not.toContain(seed);
  // 예전 파라미터 이름(exclude)도 같은 결과
  const legacy = (await (await request.get(`${BASE_URL}/api/news/related?exclude=${seed}&category=economy`)).json()) as { id: string }[];
  expect(legacy.map((r) => r.id)).toEqual(apiIds);

  for (const locale of ['ko', 'zh'] as const) {
    for (const vp of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
      await page.setViewportSize(vp);
      // 상세 페이지 (직접 접속)
      await page.goto(`${BASE_URL}/${locale}/news/${seed}`);
      const detailSection = page.locator('section', { has: page.getByRole('heading', { name: L[locale].related }) });
      await expect(detailSection).toBeVisible();
      const detailIds = await expandRelated(page, detailSection, L[locale].more);
      expect(detailIds).toEqual(apiIds);
      await detailSection.scrollIntoViewIfNeeded();
      await shot(page, `related-detail-${locale}-${vp.width}`);

      // 모달 (홈 카드 클릭 → 가로채기 라우트). 모달이 받는 /api/news/related 응답과 화면 목록
      const relatedResponse = page.waitForResponse((r) => r.url().includes('/api/news/related') && r.url().includes(seed));
      await page.goto(`${BASE_URL}/${locale}`);
      await page.locator(`main a[href*="/news/${seed}"]`).first().click();
      const dialog = page.getByRole('dialog');
      await expect(dialog).toBeVisible();
      const modalApi = ((await (await relatedResponse).json()) as { id: string }[]).map((r) => r.id);
      expect(modalApi).toEqual(apiIds);
      const modalSection = dialog.locator('section', { has: page.getByRole('heading', { name: L[locale].related }) });
      await expect(modalSection).toBeVisible();
      const modalIds = await expandRelated(page, modalSection, L[locale].more);
      expect(modalIds).toEqual(detailIds);
      await modalSection.scrollIntoViewIfNeeded();
      await shot(page, `related-modal-${locale}-${vp.width}`, dialog);
    }
  }
});

test('관련 기사가 1건이면 표시 수·버튼이 실제 건수를 넘지 않는다 (상세·모달)', async ({ page, request }) => {
  test.setTimeout(90_000);
  const related = async (id: string) =>
    ((await (await request.get(`${BASE_URL}/api/news/related?id=${id}&limit=4`)).json()) as { id: string }[]).map((r) => r.id);
  // 상세: 라벨 세트에서 1건만 나오는 기사를 찾는다 (없으면 홈 카드에서)
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${BASE_URL}/ko`);
  const cardIds = await idsIn(page.locator('main'));
  const pool = [
    '81759824-45aa-41e2-8717-644f7884d502',
    '0a774e2b-12c4-4d5c-918c-78489a708bea',
    'd701448d-9ae1-4c02-865c-68cd02fad909',
    ...cardIds.slice(0, 30),
  ];
  let one = '';
  let oneIds: string[] = [];
  for (const id of pool) {
    const r = await related(id);
    if (r.length === 1) {
      one = id;
      oneIds = r;
      if (cardIds.includes(id)) break; // 홈 카드면 모달도 확인할 수 있으니 우선
    }
  }
  test.skip(!one, '관련 기사가 정확히 1건인 기사를 찾지 못했다');

  for (const vp of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(vp);
    await page.goto(`${BASE_URL}/ko/news/${one}`);
    const section = page.locator('section', { has: page.getByRole('heading', { name: L.ko.related }) });
    await expect(section).toBeVisible();
    await expect(section.getByRole('button', { name: L.ko.more })).toHaveCount(0);
    expect(await idsIn(section.locator('div.grid'))).toEqual(oneIds);
    // 결과가 1건이어도 격자 칸은 기본 표시 수(3) 그대로 — 카드 하나가 전체 폭으로 커지지 않는다
    await expect(section.locator('div.grid')).toHaveClass(/lg:grid-cols-3/);
    await section.scrollIntoViewIfNeeded();
    await shot(page, `related-one-detail-ko-${vp.width}`);

    if (cardIds.includes(one)) {
      await page.goto(`${BASE_URL}/ko`);
      await page.locator(`main a[href*="/news/${one}"]`).first().click();
      const dialog = page.getByRole('dialog');
      const ms = dialog.locator('section', { has: page.getByRole('heading', { name: L.ko.related }) });
      await expect(ms).toBeVisible();
      await expect(ms.getByRole('button', { name: L.ko.more })).toHaveCount(0);
      expect(await idsIn(ms.locator('div.grid'))).toEqual(oneIds);
      await shot(page, `related-one-modal-ko-${vp.width}`, dialog);
    }
  }
});

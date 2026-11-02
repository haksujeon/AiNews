import { test, expect, type Page } from '@playwright/test';

// 썸네일: 虎嗅 AI 생성 커버는 이미지로 보이고, 모서리에 "AI 생성 이미지" 라벨 + 대체 텍스트로 알린다.
//   E2E_BASE_URL=http://localhost:3088/ainews npx playwright test e2e/news-thumbnail.spec.ts
// AI_COVER_NEWS_ID 를 주면 그 기사 상세를 본다. 없으면 홈 목록 API 에서 AI 커버 기사를 찾고, 없으면 건너뛴다.
const BASE_URL = process.env.E2E_BASE_URL ?? 'http://localhost:3000/ainews';
const AI_LABEL: Record<string, string> = { ko: 'AI 생성 이미지', zh: 'AI 生成图片', en: 'AI-generated image' };

type DayItem = { id: string; thumbnail_url: string | null };
type DaysPayload = { days: { top?: DayItem[]; rest?: DayItem[] }[] };

async function findAiCoverId(page: Page): Promise<string | null> {
  if (process.env.AI_COVER_NEWS_ID) return process.env.AI_COVER_NEWS_ID;
  const res = await page.request.get(`${BASE_URL}/api/news/days?locale=ko`);
  if (!res.ok()) return null;
  const data = (await res.json()) as DaysPayload;
  for (const d of data.days ?? []) {
    for (const it of [...(d.top ?? []), ...(d.rest ?? [])]) {
      if (it.thumbnail_url?.includes('/ai-general-cover/')) return it.id;
    }
  }
  return null;
}

async function expectLabelledAiImage(page: Page, locale: string) {
  const img = page.locator('img[src*="/ai-general-cover/"]').first();
  await expect(img).toBeVisible();
  await expect(img).toHaveAttribute('alt', new RegExp(AI_LABEL[locale]));
  const box = img.locator('xpath=..');
  const label = box.getByTestId('ai-image-label');
  await expect(label).toBeVisible();
  await expect(label).toHaveText(AI_LABEL[locale]);
  // 12px 이상, 박스 안에 겹쳐 있음(레이아웃을 밀지 않음)
  const fontSize = await label.evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
  expect(fontSize).toBeGreaterThanOrEqual(12);
  expect(await label.evaluate((el) => getComputedStyle(el).position)).toBe('absolute');
  const [b, l] = [await box.boundingBox(), await label.boundingBox()];
  expect(b && l).toBeTruthy();
  expect(l!.x).toBeGreaterThanOrEqual(b!.x);
  expect(l!.y).toBeGreaterThanOrEqual(b!.y);
  expect(l!.x + l!.width).toBeLessThanOrEqual(b!.x + b!.width + 0.5);
  expect(l!.y + l!.height).toBeLessThanOrEqual(b!.y + b!.height + 0.5);
}

for (const locale of ['ko', 'zh'] as const) {
  test(`상세(${locale}): AI 생성 커버에 라벨과 대체 텍스트`, async ({ page }) => {
    const id = await findAiCoverId(page);
    test.skip(!id, 'AI 커버 기사가 없다');
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(`${BASE_URL}/${locale}/news/${id}`);
    await expectLabelledAiImage(page, locale);
  });
}

test('실제 이미지(AI 커버 아님)에는 라벨이 없다', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${BASE_URL}/ko`);
  const imgs = page.locator('main img:not([src*="/ai-general-cover/"])');
  await expect(imgs.first()).toBeVisible();
  const n = Math.min(await imgs.count(), 8);
  for (let i = 0; i < n; i++) {
    await expect(imgs.nth(i).locator('xpath=..').getByTestId('ai-image-label')).toHaveCount(0);
  }
});

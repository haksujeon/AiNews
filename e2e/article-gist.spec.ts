import { test, expect, type Page } from '@playwright/test';
import pg from 'pg';
import { splitSentences } from '../src/lib/news-gist';
import { getContent } from '../src/lib/news-utils';
import type { NewsItem } from '../src/lib/news-types';

// P0-7: 상세·모달은 번역 전문 대신 3~5문장 요지만 보이고, 6번째 문장은 HTML·RSC·API 어디에도 없다.
//   E2E_BASE_URL=http://localhost:3097/ainews npx playwright test e2e/article-gist.spec.ts
// 고정 기사: 홈 첫 화면 카드 중 content_kr 이 6문장 이상인 첫 기사(DB 읽기 전용 조회, .env.local 의 DATABASE_URL).
// GIST_NEWS_ID 를 주면 상세·API 검사는 그 기사로 한다.
const BASE_URL = process.env.E2E_BASE_URL ?? 'http://localhost:3000/ainews';

if (!process.env.DATABASE_URL) {
  try {
    process.loadEnvFile('.env.local');
  } catch {
    /* 없으면 아래에서 건너뛴다 */
  }
}

type Fixture = { id: string; needle: string };
const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

/** 6번째 문장에서 문장부호·따옴표가 없는 가장 긴 한 덩어리(최대 20자). JSON/flight 이스케이프에 영향받지 않게. */
function needleOf(sentence: string): string {
  const runs = sentence.match(/[가-힣A-Za-z0-9 ]{8,}/g) ?? [];
  const best = runs.sort((a, b) => b.length - a.length)[0]?.trim() ?? '';
  return best.slice(0, 20).trim();
}

async function pickFixture(ids: string[]): Promise<Fixture | null> {
  if (!process.env.DATABASE_URL || ids.length === 0) return null;
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
  try {
    const { rows } = await pool.query(
      `SELECT id, title_kr, title_en, title_cn, summary_kr, summary_en, summary_cn,
              ai_insights_kr, ai_insights_en, ai_insights_cn, content_kr, content_en
         FROM ai_news_ex WHERE id = ANY($1::uuid[])`,
      [ids]
    );
    const byId = new Map(rows.map((r) => [r.id as string, r]));
    for (const id of ids) {
      const r = byId.get(id);
      if (!r) continue;
      const sentences = splitSentences(getContent(r as NewsItem, 'ko'));
      if (sentences.length < 6) continue;
      const needle = needleOf(sentences[5]);
      if (needle.length < 10) continue;
      // 제목·요약·인사이트에 같은 구절이 있으면 정당하게 화면에 보일 수 있다 → 다른 기사
      const visible = [r.title_kr, r.title_en, r.title_cn, r.summary_kr, r.summary_en, r.summary_cn,
        r.ai_insights_kr, r.ai_insights_en, r.ai_insights_cn].filter(Boolean).join('\n');
      if (visible.includes(needle)) continue;
      // 앞 5문장에 같은 구절이 있으면(반복 문장) 요지에 정당하게 실린다 → 다른 기사
      if (sentences.slice(0, 5).join(' ').includes(needle)) continue;
      return { id, needle };
    }
    return null;
  } finally {
    await pool.end();
  }
}

async function homeCardIds(page: Page): Promise<string[]> {
  await page.goto(`${BASE_URL}/ko`);
  const links = page.locator('main a[href*="/news/"]');
  await expect(links.first()).toBeVisible();
  const hrefs = await links.evaluateAll((els) => els.map((e) => e.getAttribute('href') ?? ''));
  return [...new Set(hrefs.map((h) => h.match(UUID_RE)?.[0]).filter((x): x is string => !!x))];
}

async function gistSentenceCount(page: Page, scope = page.locator('body')): Promise<number> {
  const gist = scope.getByTestId('article-gist');
  await expect(gist).toBeVisible();
  const text = (await gist.innerText()).trim();
  expect(text.length).toBeLessThanOrEqual(600);
  return splitSentences(text).length;
}

test('상세(ko/zh/en): 요지 5문장 이하, 6번째 문장은 HTML·RSC·API 에 없다', async ({ page }) => {
  const ids = process.env.GIST_NEWS_ID ? [process.env.GIST_NEWS_ID] : await homeCardIds(page);
  const fx = await pickFixture(ids);
  test.skip(!fx, '6문장 이상인 기사를 찾지 못했다(DB 접속 정보 확인)');
  const { id, needle } = fx!;

  for (const vp of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(vp);
    await page.goto(`${BASE_URL}/ko/news/${id}`);
    const n = await gistSentenceCount(page);
    expect(n).toBeGreaterThanOrEqual(1);
    expect(n).toBeLessThanOrEqual(5);
    await expect(page.getByTestId('read-full-at-source')).toBeVisible();
    expect(await page.content()).not.toContain(needle);
    // 가로 넘침 없음
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(1);
  }

  for (const locale of ['ko', 'zh', 'en']) {
    const html = await page.request.get(`${BASE_URL}/${locale}/news/${id}`);
    expect(html.ok()).toBeTruthy();
    expect(await html.text()).not.toContain(needle);

    const rsc = await page.request.get(`${BASE_URL}/${locale}/news/${id}?_rsc=e2e`, { headers: { RSC: '1' } });
    expect(rsc.ok()).toBeTruthy();
    const rscBody = await rsc.text();
    expect(rscBody.length).toBeGreaterThan(100);
    expect(rscBody).not.toContain(needle);
    expect(rscBody).not.toContain('"content_kr"');
    expect(rscBody).not.toContain('"content_en"');

    const api = await page.request.get(`${BASE_URL}/api/news/${id}?locale=${locale}`);
    expect(api.ok()).toBeTruthy();
    const apiText = await api.text();
    expect(apiText).not.toContain(needle);
    const json = JSON.parse(apiText) as Record<string, unknown>;
    expect(json).not.toHaveProperty('content_kr');
    expect(json).not.toHaveProperty('content_en');
    expect(typeof json.gist).toBe('string');
    if (locale === 'zh') expect(json.gist).toBe('');
    else expect(splitSentences(json.gist as string).length).toBeLessThanOrEqual(5);
  }

  // zh 화면: 요지 없음 + 원문 안내만
  await page.goto(`${BASE_URL}/zh/news/${id}`);
  await expect(page.getByTestId('article-gist')).toHaveCount(0);
  await expect(page.getByTestId('read-full-at-source')).toBeVisible();
});

test('모달(가로채기): 요지 5문장 이하, 6번째 문장은 DOM·RSC 응답에 없다', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  // 홈 첫 로드 전부터 듣는다 — 카드 링크 prefetch 로 받은 가로채기 RSC 도 놓치지 않게
  const rscBodies: Promise<string>[] = [];
  const apiBodies: Promise<string>[] = [];
  page.on('response', (res) => {
    const req = res.request();
    if (req.headers()['rsc'] === '1' || res.url().includes('_rsc=')) rscBodies.push(res.text().catch(() => ''));
    else if (res.url().includes('/api/news/')) apiBodies.push(res.text().catch(() => ''));
  });

  const ids = await homeCardIds(page);
  const fx = await pickFixture(ids);
  test.skip(!fx, '홈 카드 중 6문장 이상인 기사가 없다');
  const { id, needle } = fx!;

  await page.locator(`main a[href*="/news/${id}"]`).first().click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  const n = await gistSentenceCount(page, dialog);
  expect(n).toBeGreaterThanOrEqual(1);
  expect(n).toBeLessThanOrEqual(5);
  await expect(dialog.getByTestId('read-full-at-source')).toBeVisible();
  await page.waitForLoadState('networkidle');

  // 모달이 처음부터 본문을 그리므로 로딩 → 본문 전환으로 높이가 튀지 않는다(Gate 3)
  const h1 = await dialog.evaluate((el) => el.scrollHeight);
  await page.waitForTimeout(800);
  const h2 = await dialog.evaluate((el) => el.scrollHeight);
  expect(Math.abs(h2 - h1)).toBeLessThanOrEqual(200); // 관련 기사 목록이 늦게 붙는 것만 허용

  expect(await page.content()).not.toContain(needle);
  const rsc = await Promise.all(rscBodies);
  const api = await Promise.all(apiBodies);
  // 양성 대조: 모달 기사의 요지를 실은 RSC 응답이 실제로 잡혔다
  const withGist = rsc.filter((b) => b.includes(id) && b.includes('"gist"'));
  console.log(`modal RSC responses ${rsc.length} (gist ${withGist.length}), api ${api.length}; 6th-sentence hits ${[...rsc, ...api].filter((b) => b.includes(needle)).length}`);
  expect(withGist.length).toBeGreaterThan(0);
  for (const b of [...rsc, ...api]) {
    expect(b).not.toContain(needle);
    expect(b).not.toContain('"content_kr"');
  }
});

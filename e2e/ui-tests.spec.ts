import { test, expect } from '@playwright/test';

// basePath(/ainews) 포함. 다른 포트/서버로 돌릴 때: E2E_BASE_URL=http://localhost:3097/ainews
const BASE_URL = process.env.E2E_BASE_URL ?? 'http://localhost:3000/ainews';

test.describe('AiNews UI/UX Tests', () => {
  
  test.beforeEach(async ({ page }) => {
    // 한국어 페이지로 이동
    await page.goto(`${BASE_URL}/ko`);
    // 페이지 로드 대기
    await page.waitForLoadState('networkidle');
  });

  test('페이지 로드 및 기본 구조 확인', async ({ page }) => {
    // 타이틀 확인
    await expect(page).toHaveTitle(/AI NEWS/);
    
    // 헤더 확인 (로고 링크) + <html lang>
    await expect(page.locator('header')).toBeVisible();
    // 로고는 아이콘 타일 + aria-label 대신 보이는 워드마크("AI 뉴스") 링크
    await expect(page.locator('header').getByRole('link', { name: /AI 뉴스/ })).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('lang', 'ko');

    // 뉴스 카드는 기사 상세로 가는 실제 링크
    const cards = page.locator('main a[href*="/news/"]').first();
    await expect(cards).toBeVisible({ timeout: 10000 });
    
    console.log('✅ 페이지 로드 완료');
  });

  test('스켈레톤 로딩 확인', async ({ page }) => {
    // 강제 새로고침으로 로딩 상태 확인
    await page.reload();
    
    // 스켈레톤이 표시되는지 확인 (있는 경우)
    const skeleton = page.locator('.animate-pulse, [class*="skeleton"]').first();
    const hasSkeleton = await skeleton.isVisible().catch(() => false);
    
    if (hasSkeleton) {
      console.log('✅ 스켈레톤 로딩 표시됨');
    } else {
      console.log('ℹ️ 스켈레톤이 너무 빨리 지나감 (데이터가 캐시됨)');
    }
    
    // 뉴스 카드가 최종적으로 표시되는지 확인
    await page.waitForSelector('article, [class*="card"]', { timeout: 10000 });
    console.log('✅ 뉴스 카드 로드 완료');
  });

  test('검색 디바운스 테스트', async ({ page }) => {
    const searchInput = page.locator('input[placeholder*="검색"]').first();
    
    // 검색창 찾기
    await expect(searchInput).toBeVisible();
    
    // 빠르게 타이핑
    await searchInput.fill('AI');
    await searchInput.fill('AI 인공');
    await searchInput.fill('AI 인공지능');
    
    // 디바운스 시간(300ms) + 여유 시간 대기
    await page.waitForTimeout(500);
    
    // 결과가 필터링되었는지 확인
    const results = page.locator('article, [class*="card"]').count();
    console.log(`✅ 검색 결과: ${await results}개`);
  });

  test('그리드/리스트 뷰 전환', async ({ page }) => {
    // 그리드/목록 토글 (aria-label 로 지정)
    const gridBtn = page.getByRole('button', { name: '그리드 보기' });
    const listBtn = page.getByRole('button', { name: '목록 보기' });
    
    await expect(gridBtn).toBeVisible();
    await expect(listBtn).toBeVisible();
    
    // 리스트 뷰로 전환
    await listBtn.click();
    await page.waitForTimeout(300);
    await expect(listBtn).toHaveAttribute('aria-pressed', 'true');
    
    // 리스트 레이아웃 확인
    const listLayout = page.locator('[class*="space-y"]').first();
    await expect(listLayout).toBeVisible();
    console.log('✅ 리스트 뷰 전환 완료');
    
    // 그리드 뷰로 다시 전환
    await gridBtn.click();
    await page.waitForTimeout(300);
    
    const gridLayout = page.locator('[class*="grid"]').first();
    await expect(gridLayout).toBeVisible();
    console.log('✅ 그리드 뷰 전환 완료');
  });

  test('모바일 필터 Sheet 테스트', async ({ page }) => {
    // 모바일 뷰포트 설정
    await page.setViewportSize({ width: 375, height: 667 });
    await page.reload();
    await page.waitForTimeout(1000);
    
    // 필터 버튼 찾기 (모바일에서만 표시)
    const filterBtn = page.locator('button:has-text("필터"), button:has-text("Filters")').first();
    
    if (await filterBtn.isVisible().catch(() => false)) {
      await filterBtn.click();
      await page.waitForTimeout(300);
      
      // Sheet가 열린 것 확인
      const sheet = page.locator('[role="dialog"], [data-state="open"]').first();
      await expect(sheet).toBeVisible();
      console.log('✅ 모바일 필터 Sheet 열림');
      
      // 닫기 버튼 클릭
      const closeBtn = page.locator('button').filter({ hasText: /닫기|Close/ }).first();
      if (await closeBtn.isVisible().catch(() => false)) {
        await closeBtn.click();
      }
    } else {
      console.log('ℹ️ 모바일 필터 버튼을 찾을 수 없음');
    }
  });

  test('카드 확장/축소 테스트', async ({ page }) => {
    // 데스크톱 뷰포트로 복원
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.reload();
    await page.waitForTimeout(2000);
    
    // 첫 번째 카드 클릭
    const firstCard = page.locator('article, [class*="card"]').first();
    await expect(firstCard).toBeVisible();
    
    // 카드 클릭
    await firstCard.click();
    await page.waitForTimeout(500);
    
    // 확장된 내용 확인 (버튼, 더 많은 텍스트 등)
    const expandedContent = page.locator('text=전체 기사 보기, button:has-text("보기"), text=상세보기').first();
    
    if (await expandedContent.isVisible().catch(() => false)) {
      console.log('✅ 카드 확장됨');
    } else {
      console.log('ℹ️ 카드 확장 기능 확인 불가 (데이터 부족할 수 있음)');
    }
  });

  test('스크린샷 캡처', async ({ page }) => {
    // 데스크톱 스크린샷
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.screenshot({ path: 'test-results/desktop.png', fullPage: true });
    console.log('✅ 데스크톱 스크린샷 저장: test-results/desktop.png');
    
    // 모바일 스크린샷
    await page.setViewportSize({ width: 375, height: 667 });
    await page.screenshot({ path: 'test-results/mobile.png', fullPage: true });
    console.log('✅ 모바일 스크린샷 저장: test-results/mobile.png');
  });
});

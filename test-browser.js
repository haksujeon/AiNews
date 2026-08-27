const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  
  console.log('1. 페이지 로딩 중...');
  await page.goto('http://localhost:3000/ko');
  await page.waitForTimeout(3000);
  
  console.log('2. 스크린샷 촬영 (데스크톱)');
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.screenshot({ path: 'test-results/desktop.png', fullPage: true });
  
  console.log('3. 스크린샷 촬영 (모바일)');
  await page.setViewportSize({ width: 375, height: 667 });
  await page.screenshot({ path: 'test-results/mobile.png', fullPage: true });
  
  console.log('4. 테스트 완료!');
  console.log('   - test-results/desktop.png');
  console.log('   - test-results/mobile.png');
  
  await browser.close();
})();

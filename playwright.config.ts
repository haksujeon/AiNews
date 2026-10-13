import { defineConfig, devices } from '@playwright/test';

// E2E_BASE_URL 을 주면 이미 떠 있는 서버(예: next start -p 3097)를 대상으로 돌리고 webServer 를 띄우지 않는다.
//   E2E_BASE_URL=http://localhost:3097/ainews npx playwright test
// (주의: 기본 webServer 의 `npm run dev` 는 운영 포트 3012 를 쓴다 — 운영 서버가 떠 있으면 E2E_BASE_URL 을 쓸 것)
const externalBaseUrl = process.env.E2E_BASE_URL;

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: externalBaseUrl ? 'list' : 'html',
  use: {
    baseURL: externalBaseUrl ?? 'http://localhost:3000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: externalBaseUrl
    ? undefined
    : {
        command: 'npm run dev',
        url: 'http://localhost:3000',
        reuseExistingServer: !process.env.CI,
        timeout: 120 * 1000,
      },
});

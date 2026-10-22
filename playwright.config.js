import { defineConfig } from '@playwright/test';
import { existsSync } from 'node:fs';

// CI uses Playwright's pinned browser. Cloud machines can reuse their supplied
// Chromium without downloading a second browser. TLS verification stays enabled.
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ||
  (!process.env.CI && existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined);

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 90000,
  expect: { timeout: 20000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list'], ['html', { outputFolder: 'logs/playwright-report', open: 'never' }]],
  outputDir: 'logs/playwright-results',
  use: {
    baseURL: 'http://127.0.0.1:4181',
    viewport: { width: 960, height: 540 },
    headless: true,
    launchOptions: {
      executablePath,
      args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
    },
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  webServer: [
    {
      command: 'node server/index.js',
      env: { PORT: '4181' },
      url: 'http://127.0.0.1:4181/health',
      reuseExistingServer: false,
      timeout: 30000,
    },
    {
      command: 'npm run dev -- --host 127.0.0.1 --port 4180 --strictPort',
      env: { VITE_SERVER_URL: 'http://127.0.0.1:4181', VITE_E2E: '1' },
      url: 'http://127.0.0.1:4180',
      reuseExistingServer: false,
      timeout: 30000,
    },
  ],
});

/**
 * Playwright E2E 测试配置 — @spark/desktop
 *
 * Electron release acceptance uses an isolated user profile and credential namespace.
 * Keep these tests separate from browser-only smoke tests and unit suites.
 */

import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.e2e.ts',
  timeout: 30_000,
  expect: {
    // A fresh profile applies every migration before the first production shell is ready.
    timeout: 15_000,
  },
  fullyParallel: false,
  retries: 0,
  reporter: 'html',
  use: {
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'electron',
      use: {},
    },
  ],
})

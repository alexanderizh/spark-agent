/**
 * Playwright E2E 测试配置 — @spark/desktop
 *
 * 注意：Electron 应用的 E2E 测试需要特殊配置。
 * Phase 0 阶段只建立框架，Phase 1 再编写具体用例。
 */

import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  expect: {
    timeout: 5_000,
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
      use: {
        // Electron Playwright 配置将在 Phase 1 补充
        // 需要安装 @playwright/test 的 Electron 支持
      },
    },
  ],
})

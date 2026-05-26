/**
 * Vitest 配置 — @spark/desktop
 *
 * 运行环境：Node.js（主进程代码）/ jsdom（renderer 代码）
 * 默认使用 Node 环境，renderer 测试使用 jsdom
 */

import { defineConfig } from 'vitest/config'
import { resolve } from 'path'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.{ts,tsx}', 'src/**/*.spec.{ts,tsx}', 'e2e/**/*.test.{ts,tsx}'],
    exclude: ['**/node_modules/**', '**/out/**', '**/dist/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/**/*.test.*', 'src/**/*.spec.*', 'src/**/*.d.ts'],
    },
  },
  resolve: {
    alias: {
      '@renderer': resolve(__dirname, 'src/renderer'),
      '@main': resolve(__dirname, 'src/main'),
      '@': resolve(__dirname, 'src/renderer'),
    },
  },
})

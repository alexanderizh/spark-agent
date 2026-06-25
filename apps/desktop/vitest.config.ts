/**
 * Vitest 配置 — @spark/desktop
 *
 * 运行环境：Node.js（主进程代码）/ jsdom（renderer 代码）
 * 默认使用 Node 环境，renderer 测试使用 jsdom
 */

import { createRequire } from 'node:module'
import { defineConfig } from 'vitest/config'
import { dirname, resolve } from 'path'

const nodeRequire = createRequire(__filename)
const fluentEmojiEntryPath = resolve(
  dirname(nodeRequire.resolve('@lobehub/fluent-emoji/package.json')),
  'es/FluentEmoji/index.js',
)

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
    server: {
      // 让 vite 把以下依赖（及其子依赖）也由 vite 自己打包进测试 bundle，
      // 避免 Node 原生 ESM 在解析这些包时撞上目录 import 或 CJS/ESM 混用问题。
      deps: {
        inline: [
          /^@lobehub\//,
          /^antd($|\/)/,
          /^antd-style($|\/)/,
          /^rc-/,
          /^@ant-design\//,
          /^@rc-component\//,
        ],
      },
    },
  },
  resolve: {
    alias: {
      '@renderer': resolve(__dirname, 'src/renderer'),
      '@main': resolve(__dirname, 'src/main'),
      '@': resolve(__dirname, 'src/renderer'),
      // fluent-emoji 的 es/index.js 用了 `from './FluentEmoji'` 目录 import,
      // Node 原生 ESM 解析不支持，vitest 走到 native resolver 时会炸。
      // 直接 alias 到具体 .js 文件,绕过目录 import。
      '@lobehub/fluent-emoji/es/FluentEmoji': fluentEmojiEntryPath,
      // emojilib 主入口是 index.json，Node 24 ESM 严格模式不允许裸 JSON import
      // （需要 `with { type: 'json' }`）。alias 到一个 .js shim，
      // shim 通过 fs.readFileSync 同步加载 JSON。
      '@lobehub/emojilib': resolve(__dirname, 'src/renderer/tests/__mocks__/emojilib-shim.js'),
    },
  },
})

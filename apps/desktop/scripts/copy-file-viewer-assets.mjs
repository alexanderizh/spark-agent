#!/usr/bin/env node
import { spawnSync } from 'node:child_process'
import { cpSync, mkdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const desktopRoot = resolve(here, '..')
const target = resolve(desktopRoot, 'public/file-viewer')

const result = spawnSync('pnpm', ['exec', 'file-viewer-copy-assets', target], {
  cwd: desktopRoot,
  stdio: 'inherit',
  shell: process.platform === 'win32',
})

if (result.error != null) {
  console.error(`[file-viewer-assets] failed to run file-viewer-copy-assets: ${result.error.message}`)
  process.exit(1)
}

// @file-viewer/core 把 PDF worker 默认 URL 硬编码到外部 CDN（npm.onmicrosoft.cn），
// 其资产清单不包含 pdf worker，file-viewer-copy-assets 也不会复制它。
// 这里从 @file-viewer/core 实际依赖的 pdfjs-dist 中取 worker，落到本地由 options.pdf.workerUrl 引用，
// 避免在线/内网/CSP 拦截导致 PDF 完全打不开。worker 是 .mjs 模块文件，与 CSP script-src 'self' 兼容。
const require = createRequire(`${desktopRoot}/`)
let pdfWorkerSrc = null
try {
  pdfWorkerSrc = require.resolve('pdfjs-dist/legacy/build/pdf.worker.mjs', { paths: [desktopRoot] })
} catch (error) {
  console.warn(
    `[file-viewer-assets] pdfjs-dist worker 未找到（${error.code || error.message}），跳过 PDF worker 复制。` +
      '若启用 PDF 预览，请确认 @file-viewer/core 已安装 pdfjs-dist。',
  )
}

if (pdfWorkerSrc != null) {
  const pdfWorkerDest = resolve(target, 'vendor/pdf/pdf.worker.mjs')
  try {
    mkdirSync(dirname(pdfWorkerDest), { recursive: true })
    cpSync(pdfWorkerSrc, pdfWorkerDest)
    console.log(`[file-viewer-assets] copied PDF worker -> ${pdfWorkerDest}`)
  } catch (error) {
    console.warn(`[file-viewer-assets] 复制 PDF worker 失败: ${error.message}`)
  }
}

process.exit(result.status ?? 1)

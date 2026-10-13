#!/usr/bin/env node
/**
 * 生成 tabBar 图标（一次性维护脚本，产物直接提交进 src/assets/tabbar/）。
 *
 * 依赖 monorepo 根 node_modules 的 sharp（hoisted 布局，仓库内可直接跑）：
 *   node scripts/gen-tabbar-icons.mjs
 *
 * 设计语言与桌面端一致：线性描边图标、无渐变。
 *   normal: #8d8a86（--text-muted）  active: #3b82f6（--primary）
 */

import { mkdir } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const outDir = join(root, 'src', 'assets', 'tabbar')

const COLOR_NORMAL = '#8d8a86'
const COLOR_ACTIVE = '#3b82f6'

/** 24×24 viewBox 的线性图标，stroke 1.7、圆角端点，与桌面端彩色语义图标同一风格 */
const ICONS = {
  home: '<path d="M3.2 11.2 12 4l8.8 7.2"/><path d="M5.4 9.8V20h13.2V9.8"/><path d="M9.6 20v-5.6h4.8V20"/>',
  sync: '<path d="M20.5 12a8.5 8.5 0 0 1-14.6 5.9"/><path d="M3.5 12a8.5 8.5 0 0 1 14.6-5.9"/><path d="M18.6 3.4v3.4h-3.4"/><path d="M5.4 20.6v-3.4h3.4"/>',
  devices:
    '<rect x="2.2" y="4.2" width="14" height="9.6" rx="1.4"/><path d="M5.8 16.2v1.6h6.8v-1.6"/><path d="M9.2 13.8v2.4"/><rect x="17.6" y="8.4" width="4.6" height="10.4" rx="1.2"/><path d="M19.2 16.6h1.4"/>',
  profile:
    '<circle cx="12" cy="7.8" r="3.7"/><path d="M4.6 20.4c0-4.1 3.3-6.6 7.4-6.6s7.4 2.5 7.4 6.6"/>',
}

function svg(paths, color) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="81" height="81" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`
}

async function main() {
  await mkdir(outDir, { recursive: true })
  const { default: sharp } = await import('sharp')

  for (const [name, paths] of Object.entries(ICONS)) {
    for (const [state, color] of [
      ['normal', COLOR_NORMAL],
      ['active', COLOR_ACTIVE],
    ]) {
      // 显式 resize 到 81×81（tabBar 图标规范尺寸，3x 图在 27pt 网格上清晰）
      const png = await sharp(Buffer.from(svg(paths, color)))
        .resize(81, 81, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
        .png()
        .toBuffer()
      const { writeFile } = await import('node:fs/promises')
      await writeFile(join(outDir, `${name}-${state}.png`), png)
      console.log(`[icons] ${name}-${state}.png`)
    }
  }
  console.log('[icons] done')
}

main().catch((error) => {
  console.error('[icons] error:', error)
  process.exit(1)
})

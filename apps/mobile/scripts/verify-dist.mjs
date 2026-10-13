#!/usr/bin/env node
/**
 * dist 产物完整性校验（无外部依赖，node 直接跑）：
 *   1. 所有 .json 可解析
 *   2. app.json 声明的页面四件套（js/json/wxml/wxss）齐全
 *   3. tabBar 图标文件齐全
 *   4. usingComponents 引用的组件存在
 *   5. WXML 的 view 标签开闭配对（粗检）
 *
 * 用法：node scripts/verify-dist.mjs
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const dist = join(root, 'dist')

const errors = []

function walk(dir, onFile) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) walk(full, onFile)
    else onFile(full)
  }
}

if (!existsSync(dist)) {
  console.error('[verify] dist/ 不存在，请先执行 node scripts/build.mjs')
  process.exit(1)
}

// 1. JSON 合法性
walk(dist, (file) => {
  if (!file.endsWith('.json')) return
  try {
    JSON.parse(readFileSync(file, 'utf8'))
  } catch (error) {
    errors.push(`JSON 解析失败: ${relative(root, file)} — ${error.message}`)
  }
})

// 2-3. 页面四件套 + tabBar 图标
const appJson = JSON.parse(readFileSync(join(dist, 'app.json'), 'utf8'))
for (const page of appJson.pages) {
  for (const ext of ['.js', '.json', '.wxml', '.wxss']) {
    if (!existsSync(join(dist, page + ext))) {
      errors.push(`页面文件缺失: ${page}${ext}`)
    }
  }
}
for (const item of appJson.tabBar?.list ?? []) {
  for (const key of ['iconPath', 'selectedIconPath']) {
    if (item[key] && !existsSync(join(dist, item[key]))) {
      errors.push(`tabBar 图标缺失: ${item[key]}（${item.text}）`)
    }
  }
}

// 4. usingComponents 引用
walk(dist, (file) => {
  if (!file.endsWith('index.json')) return
  const json = JSON.parse(readFileSync(file, 'utf8'))
  for (const [name, ref] of Object.entries(json.usingComponents ?? {})) {
    if (typeof ref !== 'string' || ref.startsWith('/')) continue // 绝对路径由 devtools 解析
    if (!existsSync(join(dirname(file), `${ref}.js`))) {
      errors.push(`组件缺失: ${name} -> ${ref}（${relative(root, file)}）`)
    }
  }
})

// 5. WXML view 标签配对（粗检）
walk(dist, (file) => {
  if (!file.endsWith('.wxml')) return
  const content = readFileSync(file, 'utf8')
  const open = (content.match(/<view[\s>]/g) ?? []).length
  const close = (content.match(/<\/view>/g) ?? []).length
  if (open !== close) {
    errors.push(`view 标签不配对: ${relative(root, file)}（${open} 开 / ${close} 闭）`)
  }
})

if (errors.length > 0) {
  console.error(`[verify] ${errors.length} 个问题:`)
  for (const error of errors) console.error(` - ${error}`)
  process.exit(1)
}

console.log(
  `[verify] ok — ${appJson.pages.length} 个页面、${appJson.tabBar?.list?.length ?? 0} 个 tab、JSON/WXML/组件引用全部通过`,
)

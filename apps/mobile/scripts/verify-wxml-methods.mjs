#!/usr/bin/env node
/**
 * WXML 方法可达性校验。
 *
 * 小程序的两条硬约束（踩过）：
 *   1. WXML 只能调用**页面实例上的方法**。写在 Page({ methods: {...} }) 里（Vue/uni-app 写法）
 *      的方法一律拿不到 —— 原生 Page 没有 methods 字段。
 *   2. 从 utils 里 import 的纯函数不会自动挂到页面实例，必须在 Page 对象里显式列出
 *      （如 `formatBytes,`），否则 WXML 里 `{{formatBytes(x)}}` 静默失效。
 *
 * 本脚本扫描所有 index.wxml 中 {{ }} 里被当作函数调用的标识符，
 * 逐一确认对应 index.ts（页面/组件）里确实定义了它。
 *
 * 用法：node scripts/verify-wxml-methods.mjs
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** 收集 wxml 里 {{ }} 中被当作函数调用的标识符 */
function calledFunctions(wxml) {
  const names = new Set()
  for (const m of wxml.matchAll(/\{\{([\s\S]*?)\}\}/g)) {
    for (const f of m[1].matchAll(/\b([A-Za-z_][\w$]*)\s*\(/g)) names.add(f[1])
  }
  return names
}

function isDefinedIn(tsSource, name) {
  // 对象方法 / 简写属性 / 函数声明 / 变量赋值
  const patterns = [
    new RegExp(`(^|[^\\w$.])${name}\\s*(\\([^)]*\\)\\s*[:{]|:|\\(|=)`, 'm'),
    new RegExp(`function\\s+${name}\\b`),
    new RegExp(`^\\s*${name},\\s*$`, 'm'), // 简写属性（如 `formatBytes,`）
  ]
  return patterns.some((re) => re.test(tsSource))
}

let problems = 0
let checked = 0

for (const base of ['src/pages', 'src/components']) {
  const dir = join(root, base)
  if (!existsSync(dir)) continue
  for (const entry of readdirSync(dir)) {
    const wxml = join(dir, entry, 'index.wxml')
    const ts = join(dir, entry, 'index.ts')
    if (!existsSync(wxml) || !existsSync(ts)) continue
    const source = readFileSync(ts, 'utf8')
    for (const name of calledFunctions(readFileSync(wxml, 'utf8'))) {
      checked += 1
      if (!isDefinedIn(source, name)) {
        console.error(
          `❌ ${base}/${entry}：wxml 调用了 ${name}()，但 ${base}/${entry}/index.ts 里没有定义\n` +
            `   提示：若是 utils 里的纯函数，需在 Page({...}) 里显式挂载（\`${name},\`）`,
        )
        problems += 1
      }
    }
  }
}

if (problems > 0) {
  console.error(`\n[verify-wxml] ${problems} 个方法不可达（共检查 ${checked} 处调用）`)
  process.exit(1)
}
console.log(`[verify-wxml] ok — ${checked} 处 wxml 方法调用全部可达`)

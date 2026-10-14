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
const registeredPages = new Set(appJson.pages)
for (const page of appJson.pages) {
  for (const ext of ['.js', '.json', '.wxml', '.wxss']) {
    if (!existsSync(join(dist, page + ext))) {
      errors.push(`页面文件缺失: ${page}${ext}`)
    }
  }
}

// 2b. 孤儿页面：pages/ 下有完整四件套但未注册进 app.json（改了 WXML 忘加路由）
const pagesDir = join(dist, 'pages')
if (existsSync(pagesDir)) {
  for (const group of readdirSync(pagesDir)) {
    const pagePath = `pages/${group}/index`
    if (registeredPages.has(pagePath)) continue
    const hasAll = ['.js', '.json', '.wxml', '.wxss'].every((ext) =>
      existsSync(join(dist, pagePath + ext)),
    )
    if (hasAll) {
      errors.push(`孤儿页面（四件套齐全但未注册进 app.json）: ${pagePath}`)
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

// 6. require 路径可达性 —— 小程序的 require 只认 .js，且会自动补 .js 后缀。
//    所以 `require('./config.json')` 会去找 config.json.js 并崩（曾真实发生）。
walk(dist, (file) => {
  if (!file.endsWith('.js')) return
  // 先剥注释：注释里经常出现 `require('./config.json')` 这类反例文案，不剥会误报
  const content = readFileSync(file, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|\s)\/\/[^\n]*/g, '')
  const re = /require\(\s*['"](\.[^'"]+)['"]\s*\)/g
  let match
  while ((match = re.exec(content)) !== null) {
    const spec = match[1]
    const base = join(dirname(file), spec)
    const ok = existsSync(`${base}.js`) || existsSync(join(base, 'index.js')) || existsSync(base)
    if (!ok) {
      errors.push(
        `require 目标不可达: ${relative(root, file)} 里的 "${spec}"` +
          `（小程序只加载 .js，require('./x.json') 会去找 x.json.js 而失败）`,
      )
    }
  }
})

// 7. Page 不允许 methods 字段 —— 那是 Vue/uni-app 的写法；原生 Page({ methods: {...} })
//    里的事件回调与 WXML 函数全都拿不到。Component({ methods }) 才是合法的（自定义组件）。
const pagesRoot = join(dist, 'pages')
if (existsSync(pagesRoot)) {
  walk(pagesRoot, (file) => {
    if (!file.endsWith('.js')) return
    const src = readFileSync(file, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|\s)\/\/[^\n]*/g, '')
    if (/(^|[^.\w])methods\s*:/.test(src)) {
      errors.push(
        `Page 使用了 methods 字段: ${relative(root, file)}` +
          `（原生小程序 Page 不支持 methods，方法必须挂在顶层；Component 才用 methods）`,
      )
    }
  })
}

// 8. 小程序不兼容 API / ESM 残留 —— Node 冒烟跑得通不代表小程序跑得通
const INCOMPATIBLE = [
  ['process.*', /\bprocess\.\w/],
  ['Buffer', /\bBuffer\b/],
  ['require(node 内置模块)', /require\(\s*['"](fs|path|os|crypto)['"]\s*\)/],
  ['window.*', /\bwindow\.\w/],
  ['document.*', /\bdocument\.\w/],
  ['localStorage', /\blocalStorage\b/],
  ['fetch()', /\bfetch\s*\(/],
  ['XMLHttpRequest', /\bXMLHttpRequest\b/],
  ['ESM import 语句', /^\s*import\s+[\w{*'"]/m],
  ['ESM export 语句', /^\s*export\s+(default|const|function|class|\{)/m],
  ['__dirname', /__dirname/],
]
walk(dist, (file) => {
  if (!file.endsWith('.js')) return
  const src = readFileSync(file, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|\s)\/\/[^\n]*/g, '')
  for (const [name, re] of INCOMPATIBLE) {
    if (re.test(src)) errors.push(`小程序不支持: ${relative(root, file)} 使用了 ${name}`)
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

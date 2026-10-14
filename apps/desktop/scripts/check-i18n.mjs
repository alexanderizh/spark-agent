#!/usr/bin/env node
/**
 * i18n 资源校验
 *
 * 1. 解析 `design/i18n/locales.ts`（legacy 字典）与 `design/i18n/resources/*.ts`（模块字典）。
 * 2. 校验 zh / en key 对齐（英文缺翻译即失败）。
 * 3. **英文长度强校验**：按 key 最后一段推断元素类型，超出阈值即失败——
 *    从机制上避免切换英文后按钮 / 标签 / 标题溢出。
 * 4. 覆盖率报告：统计 renderer 下仍存在的硬编码 CJK 行（仅报告，不阻断）。
 *
 * 用法：
 *   node scripts/check-i18n.mjs          # 校验 + 报告
 *   node scripts/check-i18n.mjs --quiet  # 只输出结论与错误
 */
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs'
import { join, relative } from 'node:path'

const appRoot = new URL('..', import.meta.url).pathname
const i18nDir = join(appRoot, 'src/renderer/design/i18n')
const quiet = process.argv.includes('--quiet')

// ── 英文长度规则：按 key 最后一段的后缀推断元素类型 ─────────────────────────────
// 命名约定：类型词作为 key 最后一段的后缀，例如 `...SubmitBtn` / `...LoginTab`
// / `...BindSectionDesc`。aria 类优先（长度更宽松）；prompt / instruction 是
// 写给模型的指令文本，不受 UI 宽度约束，不参与长度校验。
const LENGTH_RULES = [
  { re: /(prompt|instruction)$/i, max: Infinity, label: 'prompt(不校验)' },
  { re: /(longdesc|body|tooltip)$/i, max: 200, label: 'long desc' },
  { re: /aria/i, max: 60, label: 'aria' },
  { re: /(btn|button)$/i, max: 20, label: 'button' },
  { re: /(tab|chip|badge|tag)$/i, max: 14, label: 'tab/chip' },
  { re: /(label|menu|field)$/i, max: 18, label: 'label/menu' },
  { re: /(title|headline)$/i, max: 32, label: 'title' },
  { re: /(placeholder|ph)$/i, max: 28, label: 'placeholder' },
  { re: /(hint|tip|sub|notice|meta)$/i, max: 60, label: 'hint/tip' },
  { re: /(desc|detail|paragraph|lead)$/i, max: 90, label: 'desc/lead' },
  { re: /(error|msg|warn)$/i, max: 64, label: 'error/warn' },
]
const DEFAULT_MAX = 48

function ruleFor(key) {
  const segments = key.split('.')
  const last = segments[segments.length - 1] ?? key
  for (const rule of LENGTH_RULES) {
    if (rule.re.test(last)) return rule
  }
  return { max: DEFAULT_MAX, label: 'default' }
}

/** 去掉 {{param}} 占位符后再测长度（占位符不计入展示文本宽度）。 */
function displayLength(value) {
  return value.replace(/\{\{\s*\w+\s*\}\}/g, '').trim().length
}

// ── TS 字面量扫描器 ──────────────────────────────────────────────────────────
function readStringLiteral(text, i) {
  const quote = text[i]
  let out = ''
  i += 1
  while (i < text.length) {
    const ch = text[i]
    if (ch === '\\') {
      const next = text[i + 1]
      if (next === 'n') out += '\n'
      else if (next === 't') out += '\t'
      else if (next === 'r') out += '\r'
      else out += next
      i += 2
      continue
    }
    if (ch === quote) return { value: out, end: i + 1 }
    out += ch
    i += 1
  }
  return { value: out, end: i }
}

function skipTrivia(text, i) {
  for (;;) {
    if (text[i] === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i += 1
      continue
    }
    if (text[i] === '/' && text[i + 1] === '*') {
      i += 2
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i += 1
      i += 2
      continue
    }
    if (text[i] != null && /\s/.test(text[i])) {
      i += 1
      continue
    }
    return i
  }
}

/** 找出所有 `zh: {` / `en: {` 块的内部文本（花括号配平，跳过字符串与注释）。 */
function findBlocks(text, keyName) {
  const blocks = []
  const re = new RegExp(`\\b${keyName}\\s*:\\s*\\{`, 'g')
  let match
  while ((match = re.exec(text)) != null) {
    const open = match.index + match[0].length - 1
    let depth = 0
    let i = open
    while (i < text.length) {
      const ch = text[i]
      if (ch === "'" || ch === '"' || ch === '`') {
        i = readStringLiteral(text, i).end
        continue
      }
      if (ch === '/' && (text[i + 1] === '/' || text[i + 1] === '*')) {
        i = skipTrivia(text, i)
        continue
      }
      if (ch === '{') depth += 1
      else if (ch === '}') {
        depth -= 1
        if (depth === 0) {
          blocks.push(text.slice(open + 1, i))
          break
        }
      }
      i += 1
    }
  }
  return blocks
}

/** 从块内提取 `'key': 'value'` 对。 */
function extractPairs(blockText) {
  const pairs = new Map()
  let i = 0
  while (i < blockText.length) {
    const ch = blockText[i]
    if (ch !== "'" && ch !== '"' && ch !== '`') {
      i += 1
      continue
    }
    const key = readStringLiteral(blockText, i)
    let j = skipTrivia(blockText, key.end)
    if (blockText[j] !== ':') {
      i = key.end
      continue
    }
    j = skipTrivia(blockText, j + 1)
    if (blockText[j] === "'" || blockText[j] === '"') {
      const value = readStringLiteral(blockText, j)
      pairs.set(key.value, value.value)
      i = value.end
      continue
    }
    i = key.end
  }
  return pairs
}

function collectFromFile(path) {
  const text = readFileSync(path, 'utf8')
  const zh = new Map()
  const en = new Map()
  for (const block of findBlocks(text, 'zh')) for (const [k, v] of extractPairs(block)) zh.set(k, v)
  for (const block of findBlocks(text, 'en')) for (const [k, v] of extractPairs(block)) en.set(k, v)
  return { zh, en }
}

// ── 收集资源文件 ─────────────────────────────────────────────────────────────
const resourceFiles = [join(i18nDir, 'locales.ts')]
const resourcesDir = join(i18nDir, 'resources')
if (existsSync(resourcesDir)) {
  for (const entry of readdirSync(resourcesDir)) {
    if (!/\.ts$/.test(entry) || entry === 'index.ts') continue
    resourceFiles.push(join(resourcesDir, entry))
  }
}

const zhAll = new Map()
const enAll = new Map()
const sourceOf = new Map()
for (const file of resourceFiles) {
  const { zh, en } = collectFromFile(file)
  for (const [k, v] of zh) {
    zhAll.set(k, v)
    sourceOf.set(k, relative(appRoot, file))
  }
  for (const [k, v] of en) enAll.set(k, v)
}

const errors = []

// ── 校验 1：zh / en 对齐 ─────────────────────────────────────────────────────
const missingEn = []
for (const key of zhAll.keys()) {
  if (!enAll.has(key)) missingEn.push(key)
}
const extraEn = []
for (const key of enAll.keys()) {
  if (!zhAll.has(key)) extraEn.push(key)
}
if (missingEn.length > 0) {
  errors.push({
    kind: 'missing-en',
    lines: missingEn.map((k) => `  缺少英文翻译: ${k}  (${sourceOf.get(k) ?? '?'})`),
  })
}
if (extraEn.length > 0) {
  errors.push({
    kind: 'orphan-en',
    lines: extraEn.map((k) => `  存在无对应中文的英文 key: ${k}`),
  })
}

// ── 校验 2：英文长度强校验（仅对模块资源强校验，legacy 仅告警）────────────────
const moduleKeys = new Set()
for (const file of resourceFiles) {
  if (!file.startsWith(resourcesDir)) continue
  for (const k of collectFromFile(file).zh.keys()) moduleKeys.add(k)
}

const tooLong = []
const legacyTooLong = []
for (const [key, value] of enAll) {
  const rule = ruleFor(key)
  const len = displayLength(value)
  if (len <= rule.max) continue
  const item = `  ${key}  [${rule.label} ≤${rule.max}] 实际 ${len}: "${value}"`
  if (moduleKeys.has(key)) tooLong.push(item)
  else legacyTooLong.push(item)
}
if (tooLong.length > 0) {
  errors.push({ kind: 'too-long', lines: tooLong })
}

// ── 覆盖率报告（仅报告）──────────────────────────────────────────────────────
const han = /[\u4e00-\u9fff]/
function walk(dir, out) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry)
    const stat = statSync(path)
    if (stat.isDirectory()) {
      if (entry === 'assets' || entry === 'i18n') continue
      walk(path, out)
      continue
    }
    if (!/\.(ts|tsx|html)$/.test(entry) || /\.test\.tsx?$/.test(entry)) continue
    out.push(path)
  }
  return out
}
function stripLineComment(line) {
  let quote = null
  let escaped = false
  for (let i = 0; i < line.length - 1; i += 1) {
    const ch = line[i]
    if (escaped) {
      escaped = false
      continue
    }
    if (ch === '\\') {
      escaped = true
      continue
    }
    if (quote != null) {
      if (ch === quote) quote = null
      continue
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      quote = ch
      continue
    }
    if (ch === '/' && line[i + 1] === '/') return line.slice(0, i)
  }
  return line
}
function countCjk(path) {
  const raw = readFileSync(path, 'utf8')
  // 文件级豁免：带 @i18n-exempt 标记的文件（如匹配后端文案的正则表）不计入覆盖缺口
  if (raw.includes('@i18n-exempt')) return 0
  const lines = raw.split(/\r?\n/)
  let inBlock = false
  let count = 0
  for (const line of lines) {
    if (line.includes('i18n-exempt-line')) continue
    const trimmed = line.trim()
    if (inBlock) {
      if (trimmed.includes('*/')) inBlock = false
      continue
    }
    if (trimmed.startsWith('/*') || trimmed.startsWith('*')) {
      if (!trimmed.includes('*/')) inBlock = true
      continue
    }
    if (trimmed.startsWith('//') || trimmed.startsWith('{/*')) continue
    if (han.test(stripLineComment(line))) count += 1
  }
  return count
}

const rendererFiles = walk(join(appRoot, 'src/renderer'), [])
const byDir = new Map()
let totalCjk = 0
let filesWithCjk = 0
for (const file of rendererFiles) {
  const count = countCjk(file)
  if (count === 0) continue
  totalCjk += count
  filesWithCjk += 1
  const rel = relative(join(appRoot, 'src/renderer'), file).split('/')
  const key = rel[0] === 'design' && rel[1] ? `design/${rel[1]}` : rel[0]
  byDir.set(key, (byDir.get(key) ?? 0) + count)
}

// ── 输出 ─────────────────────────────────────────────────────────────────────
const totalKeys = zhAll.size
console.log(`i18n 资源: zh ${totalKeys} keys / en ${enAll.size} keys（模块新增 ${moduleKeys.size} keys）`)

if (!quiet) {
  console.log(`\n硬编码 CJK 覆盖率（不含 test/assets/i18n）：${totalCjk} 行 / ${filesWithCjk} 文件`)
  const rows = [...byDir.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12)
  for (const [dir, count] of rows) console.log(`  ${String(count).padStart(6)}  ${dir}`)
}

if (legacyTooLong.length > 0) {
  console.log(`\n⚠ legacy 字典英文偏长（不阻断，建议后续收敛）：${legacyTooLong.length} 条`)
  if (!quiet) for (const line of legacyTooLong.slice(0, 20)) console.log(line)
}

if (errors.length > 0) {
  console.error('\n✖ i18n 校验未通过：')
  for (const error of errors) {
    console.error(`\n[${error.kind}]`)
    for (const line of error.lines.slice(0, 60)) console.error(line)
    if (error.lines.length > 60) console.error(`  ... 另有 ${error.lines.length - 60} 条`)
  }
  process.exit(1)
}

console.log('\n✔ i18n 校验通过（key 对齐 + 模块英文长度）。')

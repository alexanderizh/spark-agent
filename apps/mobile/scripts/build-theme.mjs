#!/usr/bin/env node
/**
 * 从现有 WXSS 生成深色覆盖样式，保持浅色源码为唯一设计事实源。
 * 只转换颜色相关声明，布局、字号、圆角等仍复用原规则。
 */
import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const srcDir = join(root, 'src')
const output = join(srcDir, 'styles', 'theme-dark.wxss')

const NEUTRALS = {
  f7f6f4: '#171716', fafafa: '#171716', ffffff: '#242422', '1a1a1a': '#f2f1ef',
  '11100e': '#f5f4f2', '252422': '#f2f1ef', '26251f': '#f2f1ef', '26241f': '#f2f1ef',
  '4b4944': '#e8e6e1', '4b4a46': '#e8e6e1', '52525b': '#d4d1cc',
  '6b6b6b': '#b0aea8', '6b6862': '#b0aea8', '6b7280': '#aaa69f',
  '77736d': '#aaa69f', '706d67': '#aaa69f', '5d5a55': '#b0aea8',
  '8e8e8e': '#98958f', '8d8a86': '#98958f', '8a8782': '#98958f',
  '8a877f': '#98958f', '8f8b85': '#98958f', '8e8b85': '#98958f',
  '85817a': '#98958f', b3b0ab: '#79766f', b5b2ab: '#79766f',
  a8a49a: '#85817a', a8a5a0: '#85817a', a09c95: '#85817a', a09d96: '#85817a',
  a5a29c: '#85817a', a8a49d: '#85817a', '9b9489': '#85817a',
  ececec: '#353431', eceae7: '#353431', eceae6: '#353431', eceae5: '#353431',
  efede8: '#353431', eeece8: '#353431', e9e7e4: '#3b3935', e5e2dd: '#3b3935',
  e5e3df: '#3b3935', e5e3de: '#3b3935', e0ddd8: '#3b3935', dcd9d4: '#484641',
  d7d4cf: '#484641', d5d2cb: '#484641', d4d1cc: '#484641', c9c6c0: '#625f59',
  d8d5d0: '#484641', ddd9d2: '#484641', e9e6e1: '#3b3935', e3e0da: '#3b3935',
  f2f1ef: '#2c2b29', f2f0ed: '#2c2b29', f2f0ec: '#2c2b29', f2f2f2: '#2c2b29',
  f0efed: '#2c2b29', f0efec: '#2c2b29', efedea: '#2a2927', efece6: '#2a2927',
  eeebe6: '#2a2927', f1f0ed: '#2a2927', f1efe9: '#2a2927', f5f4f1: '#2a2927',
  f7f7f5: '#242422', faf9f7: '#222220', fafaf8: '#222220', f3f4f6: '#2a2927',
  e9e9e7: '#31302d', e8e6e3: '#353431', e8e6e1: '#d8d6d1', '3d3d3d': '#d8d6d1',
}

const SURFACES = {
  eef4fe: '#1e2b3d', fdf3e3: '#342a1b', fef3c7: '#342a1b', fbf3e3: '#342a1b',
  fdf6ec: '#342a1b', ede9fe: '#2e2542', cffafe: '#16363c', ffe4e6: '#3b222a',
  fef2f2: '#3a2222', fdeeee: '#3a2222', fdecec: '#3a2222', fff1f0: '#3a2222',
  fff7f7: '#3a2222', fbeae5: '#3a2621', fffaf6: '#342821', e8f7ee: '#193328',
}

const TEXT_COLORS = {
  '2563eb': '#60a5fa', '3b82f6': '#60a5fa', d97706: '#fbbf24', dc2626: '#f87171',
  b45309: '#fbbf24', '059669': '#34d399', db2777: '#f472b6', '7c3aed': '#c4b5fd',
  '0e7490': '#67e8f9', e11d48: '#fda4af', b42318: '#fca5a5', a12b2b: '#fca5a5',
  b91c1c: '#fca5a5', '16a34a': '#4ade80', '8a5a16': '#fbbf24', b4770f: '#fbbf24',
  b3402a: '#fb923c',
}

const BORDERS = {
  c8d9f5: '#36587d', f5e5c8: '#5b4426', f0d4d4: '#613434', f3c1c1: '#613434',
  f3d4c3: '#614336',
}

const SVG_COLORS = {
  '1a1a1a': 'f2f1ef', '8e8e8e': '98958f', b3b0ab: '79766f',
}

function normalizeHex(hex) {
  const raw = hex.slice(1).toLowerCase()
  if (raw.length === 3) return raw.split('').map((char) => char + char).join('')
  return raw
}

function isNeutral(raw) {
  if (raw.length !== 6) return false
  const r = parseInt(raw.slice(0, 2), 16)
  const g = parseInt(raw.slice(2, 4), 16)
  const b = parseInt(raw.slice(4, 6), 16)
  return Math.max(r, g, b) - Math.min(r, g, b) <= 12
}

function fallbackNeutral(raw, property) {
  if (!isNeutral(raw)) return null
  const luminance = parseInt(raw.slice(0, 2), 16) / 255
  if (property === 'color') {
    if (luminance < 0.4) return '#f2f1ef'
    if (luminance < 0.75) return '#aaa69f'
    return '#79766f'
  }
  if (property.includes('background')) {
    if (luminance < 0.25) return null
    if (luminance > 0.94) return '#242422'
    if (luminance > 0.82) return '#2a2927'
    return '#3b3935'
  }
  if (luminance > 0.75) return '#3b3935'
  if (luminance > 0.45) return '#79766f'
  return '#f2f1ef'
}

function mapHex(hex, property, invertWhiteText) {
  const raw = normalizeHex(hex)
  if (raw.length !== 6) return hex
  const mappedNeutral = NEUTRALS[raw]
  const isBackground = property.includes('background')
  const isBorder = property.includes('border') || property.includes('shadow')

  if (property === 'color' && raw === 'ffffff') return invertWhiteText ? '#171716' : hex
  if (property.includes('shadow') && raw === 'ffffff') return '#171716'
  if (isBackground && SURFACES[raw]) return SURFACES[raw]
  if (property === 'color' && TEXT_COLORS[raw]) return TEXT_COLORS[raw]
  if (isBorder && BORDERS[raw]) return BORDERS[raw]
  if (mappedNeutral) return mappedNeutral
  return fallbackNeutral(raw, property) || hex
}

function transformRgba(value, property) {
  return value.replace(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)/gi,
    (match, r, g, b, alpha) => {
      if (alpha == null) return match
      if (property.includes('shadow')) {
        const nextAlpha = Number(Math.min(0.45, Number(alpha) + 0.2).toFixed(2))
        return `rgba(0, 0, 0, ${nextAlpha})`
      }
      if (property.includes('background') && Math.max(+r, +g, +b) - Math.min(+r, +g, +b) <= 12) {
        if (+r > 225) return `rgba(23, 23, 22, ${alpha})`
      }
      return match
    })
}

function transformBody(body) {
  const invertWhiteText = /background(?:-color)?\s*:\s*#1a1a1a\b/i.test(body)
  const declarations = []
  for (const declaration of body.split(';')) {
    const colon = declaration.indexOf(':')
    if (colon < 0) continue
    const property = declaration.slice(0, colon).trim().toLowerCase()
    const original = declaration.slice(colon + 1).trim()
    if (!original) continue
    let value = original.replace(/%23([0-9a-f]{6})/gi, (match, raw) => {
      const mapped = SVG_COLORS[raw.toLowerCase()]
      return mapped ? `%23${mapped}` : match
    })
    value = transformRgba(value, property)
    value = value.replace(/#[0-9a-fA-F]{3,8}\b/g, (hex) => mapHex(hex, property, invertWhiteText))
    if (value !== original) declarations.push(`  ${property}: ${value};`)
  }
  return declarations
}

function themeSelector(selector) {
  return selector.split(',').map((part) => {
    const trimmed = part.trim()
    return trimmed === 'page' ? '.theme-root.theme-dark' : `.theme-dark ${trimmed}`
  }).join(', ')
}

function extractRules(css) {
  const rules = []
  let cursor = 0
  while (cursor < css.length) {
    const open = css.indexOf('{', cursor)
    if (open < 0) break
    const selector = css.slice(cursor, open).trim()
    let depth = 1
    let end = open + 1
    while (end < css.length && depth > 0) {
      if (css[end] === '{') depth += 1
      if (css[end] === '}') depth -= 1
      end += 1
    }
    const body = css.slice(open + 1, end - 1)
    if (selector && !selector.startsWith('@')) rules.push({ selector, body })
    cursor = end
  }
  return rules
}

async function walk(dir) {
  const files = []
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) files.push(...await walk(full))
    else if (entry.name.endsWith('.wxss') && full !== output) files.push(full)
  }
  return files
}

const sections = []
for (const file of await walk(srcDir)) {
  const source = (await readFile(file, 'utf8')).replace(/\/\*[\s\S]*?\*\//g, '')
  const rules = []
  for (const { selector, body } of extractRules(source)) {
    // 已经是深色选择器的规则（组件内自带的 dark 变体）不再二次加前缀
    if (selector.includes('.theme-dark')) continue
    const declarations = transformBody(body)
    if (declarations.length > 0) rules.push(`${themeSelector(selector)} {\n${declarations.join('\n')}\n}`)
  }
  if (rules.length > 0) sections.push(`/* ${relative(srcDir, file)} */\n${rules.join('\n\n')}`)
}

const extras = `
/* 反色按钮上的图标：底板由深变浅后，白色图标必须同步转深，否则会「消失」 */
.theme-dark .icon-send-white {
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='%231a1a1a'%3E%3Cpath d='M3.4 20.4l17.4-7.5a1 1 0 000-1.8L3.4 3.6a1 1 0 00-1.4 1.1L4 12l-2 7.3a1 1 0 001.4 1.1z'/%3E%3C/svg%3E");
}
.theme-dark .icon-stop {
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='%231a1a1a'%3E%3Crect x='7' y='7' width='10' height='10' rx='1.5'/%3E%3C/svg%3E");
}
.theme-dark .icon-arrow-up-white {
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%231a1a1a' stroke-width='2.4' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M12 19V5M5 12l7-7 7 7'/%3E%3C/svg%3E");
}
.theme-dark .icon-close-sm {
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%231a1a1a' stroke-width='3' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M18 6L6 18M6 6l12 12'/%3E%3C/svg%3E");
}
/* 代码块本身恒为深底，深色下补内描边避免与页面底融为一体（不改盒模型） */
.theme-dark .md-code {
  box-shadow: inset 0 0 0 1rpx rgba(255, 255, 255, 0.1);
}
.theme-dark .rich-task-box::after {
  border-left-color: #171716;
  border-bottom-color: #171716;
}
/* 验证码 SVG 由服务端生成，保留浅色画布确保字符可读 */
.theme-dark .captcha-img {
  background: #ffffff;
}
`

const banner = `/* 本文件由 scripts/build-theme.mjs 生成，请勿手工编辑。 */\n/* 深色覆盖仅包含颜色声明；新增页面样式后执行 pnpm theme。 */\n\n`
await mkdir(dirname(output), { recursive: true })
await writeFile(output, `${banner}${sections.join('\n\n')}\n${extras}`, 'utf8')
console.log(`[mobile] dark theme generated → ${relative(root, output)}`)

#!/usr/bin/env node
/**
 * SparkWork token 收敛 codemod（方案：todo/2026-10-14-设计Token收敛与动效规范落地方案.md §3.2）
 *
 * 用法：
 *   node scripts/token-migration/migrate.mjs <文件或目录...>            # dry-run，仅输出报告
 *   node scripts/token-migration/migrate.mjs --write <文件或目录...>     # 落盘替换
 *
 * 纪律：
 *   - 只处理 map.json 命中的值，不命中即跳过留人工；
 *   - 按文件分批跑（每批一个 commit），--write 前 MUST 先 dry-run 看 diff；
 *   - REVIEW 类条目（颜色逐条人审）不会自动替换，只在报告中计数。
 */

import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs'
import { join, extname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { dirname } from 'node:path'

const HERE = dirname(fileURLToPath(import.meta.url))
const map = JSON.parse(readFileSync(join(HERE, 'map.json'), 'utf8'))

const args = process.argv.slice(2)
const write = args.includes('--write')
const targets = args.filter((a) => a !== '--write')
if (targets.length === 0) {
  console.error('用法: migrate.mjs [--write] <文件或目录...>')
  process.exit(1)
}

const EXTS = new Set(['.css', '.less'])
const SKIP_FILES = new Set(['tokens.css', 'motion.css', 'canvas-tokens.css'])

function collectFiles(target) {
  const st = statSync(target)
  if (st.isFile()) return [target]
  return readdirSync(target, { recursive: true })
    .map((f) => join(target, f.toString()))
    .filter((f) => EXTS.has(extname(f)) && !SKIP_FILES.has(f.split('/').pop()))
}

/** 属性 → 该属性行内允许替换的值类别 */
const PROP_RULES = [
  // [属性名正则, 值映射表]
  { prop: /(^|[-a-z])font-size$/, kind: 'fontSize' },
  { prop: /(^|[-a-z])border-radius$/, kind: 'radius' },
  {
    prop: /(^|[-a-z])(padding|margin|gap|row-gap|column-gap)(-(top|right|bottom|left|inline|block))?$/,
    kind: 'spacing',
  },
]

/** 判断文件是否属于画布域（scope: non-canvas 条目跳过、canvas 条目仅此处生效） */
function isInCanvasScope(file) {
  return file.includes('/views/canvas/')
}

/** 对单文件执行替换，返回 {replaced, reviewCounts, byToken} */
function migrateSource(src, file) {
  const inCanvas = isInCanvasScope(file)
  const stats = { replaced: 0, review: 0, byToken: new Map() }
  const lines = src.split('\n')
  const out = lines.map((line) => {
    // 只处理「属性: 值;」形态的声明行（跳过注释行与 @ 规则行）
    const m = line.match(/^(\s*)([-a-zA-Z]+)\s*:\s*([^;]*);(.*)$/)
    if (!m || line.trim().startsWith('//') || line.trim().startsWith('/*')) return line
    const [, indent, prop, value, tail] = m

    // 1) transition 时长替换（值内逐段）
    let newValue = value
    if (/transition(-duration)?$/.test(prop) && map.transition) {
      for (const [dur, entry] of Object.entries(map.transition)) {
        const re = new RegExp(`(?<![\\w.-])${dur.replace('.', '\\.')}(?=[\\s,])`, 'g')
        newValue = newValue.replace(re, () => {
          stats.replaced += 1
          stats.byToken.set(entry.token, (stats.byToken.get(entry.token) ?? 0) + 1)
          return `var(${entry.token})`
        })
      }
    }

    // 2) 属性行规则（font-size / radius / spacing）
    for (const rule of PROP_RULES) {
      if (!rule.prop.test(prop)) continue
      const table = map[rule.kind]
      // spacing: 逐个替换值列表中的 Npx 段；fontSize/radius: 整值精确匹配
      if (rule.kind === 'spacing') {
        // lookbehind 排除负号：负 margin/padding 是与相邻正值的精确抵消耦合，
        // token 化会在任一侧归位时产生错位，一律保留字面值（Phase 1 实测教训）
        newValue = newValue.replace(/(?<![\d.-])(\d+(?:\.\d+)?)px/g, (full, num) => {
          const key = `${num}px`
          const entry = table[key]
          // 白名单：1px hairline、2px 微调不强制 token
          if (!entry) return full
          stats.replaced += 1
          stats.byToken.set(entry.token, (stats.byToken.get(entry.token) ?? 0) + 1)
          return `var(${entry.token})`
        })
      } else {
        // 整值精确匹配；`!important` 后缀不参与查表但保留原位
        const vm = newValue.match(/^\s*([^!]+?)\s*( !important)?\s*$/)
        if (vm) {
          const entry = table[vm[1].trim()]
          if (entry) {
            stats.replaced += 1
            stats.byToken.set(entry.token, (stats.byToken.get(entry.token) ?? 0) + 1)
            newValue = `var(${entry.token})${vm[2] ?? ''}`
          }
        }
      }
      break
    }

    // 3) 颜色替换（Phase 3 补齐）：非 REVIEW 条目按 scope 生效；REVIEW 仅计数留人审
    // 「var(--token, #hex)」带 fallback 的行本身已是 token 优先形态，跳过（fallback 语义不可劣化）
    // color-mix() 内的 white/#fff 是「提亮方向常量」：换成主题翻转 token 会在暗色把提亮反转成压暗
    // （2026-10-15 事故：16 处 white→--panel/--text-inverse 混色反转），mix 上下文一律只放行恒值 token
    const FLIP_TOKENS = new Set([
      '--panel', '--text-inverse', '--bg', '--bg-sunken', '--bg-soft', '--bg-elevated',
      '--text', '--text-secondary', '--text-primary', '--border', '--border-strong',
      '--border-subtle', '--border-soft', '--bg-hover',
    ])
    if (
      map.color &&
      !/var\(--[a-z0-9-]+,\s*#/.test(newValue) &&
      /(^|[-a-z])(color|background|background-color|border|border-top|border-right|border-bottom|border-left|stroke|fill|outline|box-shadow|text-shadow|caret-color)$/.test(
        prop,
      )
    ) {
      const inMix = newValue.includes('color-mix(')
      let reviewed = false
      for (const [hex, entry] of Object.entries(map.color)) {
        const bare = hex.split(';')[0]
        // `;bg` / `;fg` 上下文后缀：bare hex 两种上下文都可命中时消歧
        const wantBg = hex.includes(';bg') ? /^(background|box-shadow)/.test(prop) : true
        const wantFg = hex.includes(';fg') ? /^(color|caret-color)/.test(prop) : true
        if (!wantBg || !wantFg) continue
        const scopeOk =
          entry.scope === 'global' ||
          (entry.scope === 'non-canvas' && !inCanvas) ||
          (entry.scope === 'canvas' && inCanvas)
        const re = new RegExp(`(?<![\\w-])${bare.replace('#', '#')}(?![\\w])`, 'gi')
        if (!re.test(newValue)) continue
        if (entry.token === 'REVIEW' || !scopeOk) {
          reviewed = true
          continue
        }
        if (inMix && FLIP_TOKENS.has(entry.token)) continue
        newValue = newValue.replace(re, () => {
          stats.replaced += 1
          stats.byToken.set(entry.token, (stats.byToken.get(entry.token) ?? 0) + 1)
          return `var(${entry.token})`
        })
      }
      if (reviewed) stats.review += 1
      return `${indent}${prop}: ${newValue};${tail}`
    }

    if (newValue !== value) {
      return `${indent}${prop}: ${newValue};${tail}`
    }
    return line
  })
  return { source: out.join('\n'), stats }
}

let totalReplaced = 0
let totalReview = 0
const allByToken = new Map()
for (const target of targets) {
  for (const file of collectFiles(target)) {
    const src = readFileSync(file, 'utf8')
    const { source, stats } = migrateSource(src, file)
    if (stats.replaced === 0 && stats.review === 0) continue
    console.log(
      `${write ? '✏️ ' : '👀'} ${file}: 替换 ${stats.replaced} 处${
        stats.review ? `，待人审色值 ${stats.review} 处` : ''
      }${stats.byToken.size ? ` [${[...stats.byToken].map(([t, c]) => `${t}×${c}`).join(', ')}]` : ''}`,
    )
    totalReplaced += stats.replaced
    totalReview += stats.review
    for (const [t, c] of stats.byToken) allByToken.set(t, (allByToken.get(t) ?? 0) + c)
    if (write && stats.replaced > 0) writeFileSync(file, source)
  }
}
console.log(
  `\n合计: 替换 ${totalReplaced} 处，REVIEW 待人审 ${totalReview} 处（${write ? '已落盘' : 'dry-run 未落盘'}）`,
)

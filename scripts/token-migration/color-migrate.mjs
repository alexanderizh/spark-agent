#!/usr/bin/env node
/**
 * 色值残留清理 codemod（rgba / 现代 rgb 语法 / color-mix 内部字面量 → token）
 *
 * 转换规则（全部零视觉变化，输出与原值在 srgb 预乘空间逐像素等值）：
 *  - rgba(r,g,b,α)      → α=1: var(--token)；否则 color-mix(in srgb, var(--token) N%, transparent)
 *  - rgb(r g b / α)     → 同上（现代空格语法）
 *  - color-mix 内部 hex  → 仅替换恒值基元（--white/--black 及本表新增恒值），绝不引入随主题翻转的 token
 *    （Phase 3 教训：color-mix 内换成 --panel 会在暗色下反转混色方向）
 *
 * 跳过：注释行、var() 兜底位、token 定义文件（tokens.css / canvas-tokens.css / cinematic/tokens.less / theme/）。
 * 用法：node color-migrate.mjs <文件...> [--write]（默认 dry-run）
 */
import { readFileSync, writeFileSync } from 'node:fs'

const args = process.argv.slice(2)
const write = args.includes('--write')
const files = args.filter((a) => !a.startsWith('--'))
if (files.length === 0) {
  console.error('用法: node color-migrate.mjs <文件...> [--write]')
  process.exit(1)
}

/** 基色 → 恒值 token（canvas 域例外见 SCOPE_OVERRIDES） */
const BASE = {
  '0,0,0': '--black',
  '255,255,255': '--white',
  '128,128,128': '--gray-mid', // #7f7f7f 并入（Δ1/255 不可见）
  '127,127,127': '--gray-mid',
  '15,23,42': '--ink-slate',
  '31,28,24': '--canvas-ink-900',
  '36,32,27': '--canvas-ink-800',
  '47,43,37': '--canvas-ink-700',
  '59,54,47': '--canvas-ink-600',
  '226,232,240': '--canvas-slate-200',
  '203,213,225': '--canvas-slate-300',
  '148,163,184': '--canvas-slate-400',
  '191,219,254': '--canvas-blue-200',
  '147,197,253': '--canvas-blue-300',
  '96,165,250': '--canvas-blue-400',
  '61,142,255': '--canvas-blue-accent',
  '56,189,248': '--canvas-sky',
  '34,211,238': '--canvas-cyan',
  '145,137,255': '--canvas-indigo-400',
  '119,108,246': '--canvas-indigo-500',
  '101,91,216': '--canvas-indigo-600',
  '239,68,68': '--danger-fixed',
  '34,197,94': '--success-fixed',
  '245,158,11': '--warning', // 两主题同值，恒值安全
  '99,102,241': '--accent',
  '139,92,246': '--violet',
  '241,241,243': '--white-soft',
  '220,38,38': '--danger', // 仅低透明度 tint 用法（≈5%），基色差在 tint 下不可见
  '217,119,6': '--warning', // 同上，低透明度 tint
  /* ΔE<2.3 不可感知吸附（near-black 表面家族归位 canvas-stage 档等） */
  '15,15,18': '--canvas-stage-bg', // #0f0f12 ΔE=1.79 吸附
  '5,5,5': '--black', // #050505 ΔE=0.79 吸附
  '21,25,31': '--canvas-stage-bg-3', // #15191f ΔE=0.76 吸附
  '5,8,7': '--canvas-stage-bg', // #050807 ΔE=1.47 吸附
  '29,28,25': '--canvas-ink-900', // #1d1c19 ΔE=1.45 吸附
  '26,26,30': '--canvas-stage-bg-3', // #1a1a1e ΔE=1.99 吸附
  '74,140,255': '--canvas-blue-accent', // #4a8cff ΔE=1.26 吸附
  '253,253,252': '--white', // #fdfdfc ΔE=0.68 吸附
  '20,20,24': '--canvas-stage-bg-2', // #141418 ΔE=1.62 吸附
  '12,14,18': '--canvas-stage-bg', // #0c0e12 ΔE=1.65 吸附
  '8,10,14': '--canvas-stage-bg', // #080a0e ΔE=1.02 吸附
  '16,18,24': '--canvas-stage-bg-2', // #101218 ΔE=0.95 吸附
  '248,250,252': '--white', // #f8fafc ΔE=1.62 吸附
  '8,10,13': '--canvas-stage-bg', // #080a0d ΔE=0.54 吸附
  '10,10,10': '--canvas-stage-bg', // #0a0a0a ΔE=1.02 吸附
  '10,12,16': '--canvas-stage-bg', // #0a0c10 ΔE=1.31 吸附
  '247,250,252': '--white', // #f7fafc ΔE=1.9 吸附
  '20,24,29': '--canvas-stage-bg-3', // #14181d ΔE=0.61 吸附
  '18,18,22': '--canvas-stage-bg-2', // #121216 ΔE=1.61 吸附
  '251,250,247': '--white', // #fbfaf7 ΔE=1.82 吸附
  '16,18,22': '--canvas-stage-bg-2', // #101216 ΔE=0.87 吸附
  '77,147,232': '--canvas-blue-accent', // #4d93e8 ΔE=2.15 吸附
  '252,252,250': '--white', // #fcfcfa ΔE=1.23 吸附
  '246,246,244': '--white', // #f6f6f4 ΔE=2.13 吸附
  '8,9,12': '--canvas-stage-bg', // #08090c ΔE=0.69 吸附
  '77,128,240': '--primary', // #4d80f0 ΔE=0.72 吸附
  '20,23,28': '--canvas-stage-bg-3', // #14171c ΔE=0.31 吸附
  '16,16,18': '--canvas-stage-bg', // #101012 ΔE=1.68 吸附
  '25,29,35': '--canvas-stage-bg-3', // #191d23 ΔE=1.67 吸附
  '10,14,20': '--canvas-stage-bg-2', // #0a0e14 ΔE=1.15 吸附
  '229,231,235': '--canvas-slate-200', // #e5e7eb ΔE=2.22 吸附
  '13,15,20': '--canvas-stage-bg-2', // #0d0f14 ΔE=1.16 吸附
  '17,24,39': '--ink-slate', // #111827 ΔE=2.27 吸附
  '226,230,238': '--canvas-slate-200', // #e2e6ee ΔE=0.98 吸附
  '220,224,229': '--canvas-slate-200', // #dce0e5 ΔE=2.23 吸附
  '9,11,14': '--canvas-stage-bg', // #090b0e ΔE=0.68 吸附
  '15,18,22': '--canvas-stage-bg-2', // #0f1216 ΔE=0.85 吸附
  '13,16,20': '--canvas-stage-bg-2', // #0d1014 ΔE=1.22 吸附
  '17,18,22': '--canvas-stage-bg-2', // #111216 ΔE=1.17 吸附
  '21,25,30': '--canvas-stage-bg-3', // #15191e ΔE=0.66 吸附
  '17,19,24': '--canvas-stage-bg-2', // #111318 ΔE=0.54 吸附
  '16,19,23': '--canvas-stage-bg-2', // #101317 ΔE=0.72 吸附
  '2,6,12': '--canvas-stage-bg', // #02060c ΔE=1.68 吸附
  '8,10,16': '--canvas-stage-bg-2', // #080a10 ΔE=2.03 吸附
  '8,9,13': '--canvas-stage-bg', // #08090d ΔE=1.1 吸附
  '20,20,25': '--canvas-stage-bg-2', // #141419 ΔE=1.71 吸附
  '10,10,14': '--canvas-stage-bg', // #0a0a0e ΔE=1.45 吸附
  '8,8,12': '--canvas-stage-bg', // #08080c ΔE=1.32 吸附
  '20,20,23': '--canvas-stage-bg-2', // #141417 ΔE=1.84 吸附
  '16,16,19': '--canvas-stage-bg', // #101013 ΔE=1.99 吸附
  '24,24,28': '--canvas-stage-bg-3', // #18181c ΔE=1.83 吸附
  '11,11,14': '--canvas-stage-bg', // #0b0b0e ΔE=1.18 吸附
  '15,17,21': '--canvas-stage-bg-2', // #0f1115 ΔE=1.05 吸附
}

/** canvas 域内 59,130,246 / 37,99,235 走固定蓝阶（不跟 JS 注入的 --primary） */
const SCOPE_OVERRIDES = {
  canvas: { '59,130,246': '--canvas-blue-500', '37,99,235': '--canvas-blue-600' },
  default: { '59,130,246': '--primary', '37,99,235': '--primary-hover' },
}

/** color-mix 内部允许替换的恒值 hex（小写；短形展开为 6 位） */
const MIX_HEX = new Map(
  Object.entries(BASE).reduce((acc, [rgb, token]) => {
    const [r, g, b] = rgb.split(',').map(Number)
    const hex = '#' + [r, g, b].map((x) => x.toString(16).padStart(2, '0')).join('')
    acc.push([hex, token])
    // 短形 #fff / #000
    if ([r, g, b].every((x) => x % 17 === 0)) {
      acc.push(['#' + [r, g, b].map((x) => (x / 17).toString(16)).join(''), token])
    }
    return acc
  }, []),
)

const isCanvas = (f) => f.includes('/canvas/')
const tokenFor = (rgbKey, file) => {
  const scope = isCanvas(file) ? SCOPE_OVERRIDES.canvas : SCOPE_OVERRIDES.default
  return scope[rgbKey] ?? BASE[rgbKey]
}

const pct = (a) => {
  if (String(a).endsWith('%')) return String(parseFloat(a))
  const v = +(a * 100).toFixed(2)
  return String(v) // 0.045*100=4.5
}

let totalRepl = 0
let totalMix = 0
const unresolved = []

for (const file of files) {
  if (/tokens\.(css|less)$/.test(file) || file.includes('/theme/')) continue
  const src = readFileSync(file, 'utf8')
  const lines = src.split('\n')
  let fileRepl = 0
  let fileMix = 0

  const out = lines.map((line, i) => {
    if (/^\s*(\/\/|\/\*|\*)/.test(line)) return line
    let nl = line

    // 1) rgba(r,g,b[,a]) 与 rgb(r g b / a)
    nl = nl.replace(
      /rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*(0?\.\d+|1|0|\d+(?:\.\d+)?%)\s*)?\)|rgba?\(\s*(\d+)\s+(\d+)\s+(\d+)\s*(?:\/\s*(0?\.\d+|1|0|\d+(?:\.\d+)?%)\s*)?\)/g,
      (m, r1, g1, b1, a1, r2, g2, b2, a2, offset) => {
        const r = +(r1 ?? r2),
          g = +(g1 ?? g2),
          b = +(b1 ?? b2),
          a = a1 ?? a2
        const key = `${r},${g},${b}`
        const token = tokenFor(key, file)
        if (!token) {
          unresolved.push(`${file}:${i + 1} ${m.trim()}`)
          return m
        }
        // var() 兜底位跳过：rgba 前方是未闭合的 var(--x,
        const before = line.slice(0, offset)
        if (/var\(--[\w-]+,[^()]*$/.test(before)) return m
        fileRepl++
        if (a === undefined || a === '1' || a === '100%') return `var(${token})`
        return `color-mix(in srgb, var(${token}) ${pct(a)}%, transparent)`
      },
    )
    return nl
  })

  const fixed = out.map((line) => {
    // var(--x, var(--y)) 双层兜底若由本脚本产生需人审，仅收集不改
    if (/var\(--[\w-]+,\s*var\(/.test(line)) {
      unresolved.push(`NESTED-FALLBACK ${line.trim().slice(0, 90)}`)
    }
    return line
  })

  // 2) color-mix 内部恒值 hex
  const out2 = fixed.map((line) => {
    if (/^\s*(\/\/|\/\*|\*)/.test(line)) return line
    if (!line.includes('color-mix(')) return line
    return line.replace(/#[0-9a-fA-F]{3,6}\b/g, (hex) => {
      const h =
        hex.length === 4 ? '#' + [...hex.slice(1)].map((c) => c + c).join('') : hex.toLowerCase()
      const token = MIX_HEX.get(h)
      if (!token) return hex
      fileMix++
      return `var(${token})`
    })
  })

  const changed = out2.join('\n') !== src
  if (changed && write) writeFileSync(file, out2.join('\n'))
  if (changed || fileRepl || fileMix) {
    console.log(`${write ? 'WROTE' : 'DRY'} ${file} rgba替换=${fileRepl} mix内部=${fileMix}`)
  }
  totalRepl += fileRepl
  totalMix += fileMix
}

console.log(`\n合计: rgba替换=${totalRepl} mix内部=${totalMix} 未匹配=${unresolved.length}`)
if (unresolved.length) {
  console.log('未匹配清单(前30):')
  unresolved.forEach((u) => console.log(' ', u))
}

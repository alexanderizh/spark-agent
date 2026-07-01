/**
 * @module media-debug-log
 *
 * 多媒体 adapter 调用前的彩色参数日志（主进程 / Node 运行时）。
 *
 * 目的：画布里文生图 / 图生图 / 图片编辑 / TTS / 转写 / 视频等 AI 调用，
 * 在真正发 HTTP 给三方平台之前，把「组装好的请求参数」按能力分色打印成一块，
 * 方便排查「参数没拼对 / model 选错 / inputFiles 没带上」这类问题。
 *
 * 颜色按产物类型区分，控制台里一眼能分清是图片/语音/视频/文本调用：
 *   image  → 品红
 *   audio  → 青色
 *   video  → 黄色
 *   text   → 绿色
 *   其它   → 灰色
 *
 * 所有 base64 / data: 内容会被截断到 50 字符，不会刷屏。
 */

import { createLogger } from '@spark/shared'
import type { Logger } from '@spark/shared'
import type { MediaCapabilityId } from '@spark/protocol'
import { createHash } from 'node:crypto'

const log: Logger = createLogger('media:adapter')

// ANSI 256 色（Windows Terminal / 现代 macOS/Linux 终端均支持）
// 用 as const 固定字面量类型，配合 noUncheckedIndexedAccess 时访问仍是 string。
const COLORS = {
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  yellow: '\x1b[33m',
  green: '\x1b[32m',
  gray: '\x1b[90m',
  red: '\x1b[31m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  reset: '\x1b[0m',
} as const

const CAPABILITY_COLOR = {
  image: COLORS.magenta,
  audio: COLORS.cyan,
  video: COLORS.yellow,
  text: COLORS.green,
} as const

const SECRET_KEY_PATTERN = /^(authorization|api[-_]?key|.*[-_]?token)$/i
const BASE64_KEY_PATTERN = /(base64|b64(?:_json)?|dataurl)$/i
const DATA_URL_PATTERN = /^data:([^;,]+)?;base64,(.*)$/is

function base64Summary(value: string, mimeType?: string): string {
  const normalized = value.replace(/\s+/g, '')
  const estimatedBytes = Math.max(
    0,
    Math.floor((normalized.length * 3) / 4) -
      (normalized.endsWith('==') ? 2 : normalized.endsWith('=') ? 1 : 0),
  )
  const digest = createHash('sha256').update(normalized).digest('hex').slice(0, 12)
  const preview =
    normalized.length > 16 ? `${normalized.slice(0, 8)}...${normalized.slice(-8)}` : normalized
  return `[base64${mimeType ? ` mime=${mimeType}` : ''} bytes~${estimatedBytes} sha256=${digest} preview=${preview}]`
}

/** 按 capability 选色：image.* → 品红，audio.* → 青，video.* → 黄，其余灰 */
function colorForCapability(capability: string | undefined): string {
  if (!capability) return COLORS.gray
  if (capability.startsWith('image')) return CAPABILITY_COLOR.image
  if (capability.startsWith('audio')) return CAPABILITY_COLOR.audio
  if (capability.startsWith('video')) return CAPABILITY_COLOR.video
  if (capability.startsWith('text')) return CAPABILITY_COLOR.text
  return COLORS.gray
}

/** 把任意对象里 base64 / data: 字符串截断，避免日志被一张图刷屏 */
export function compactForLog(value: unknown, seen: WeakSet<object> = new WeakSet()): unknown {
  if (value == null) return value
  if (typeof value === 'string') {
    const dataUrl = DATA_URL_PATTERN.exec(value)
    return dataUrl ? base64Summary(dataUrl[2] ?? '', dataUrl[1]) : value
  }
  if (typeof value !== 'object') return value
  if (seen.has(value as object)) return '[Circular]'
  seen.add(value as object)
  if (Array.isArray(value)) return value.map((item) => compactForLog(item, seen))
  const out: Record<string, unknown> = {}
  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    if (SECRET_KEY_PATTERN.test(key)) {
      out[key] = '[REDACTED]'
    } else if (typeof val === 'string' && BASE64_KEY_PATTERN.test(key)) {
      const dataUrl = DATA_URL_PATTERN.exec(val)
      out[key] = dataUrl ? base64Summary(dataUrl[2] ?? '', dataUrl[1]) : base64Summary(val)
    } else {
      out[key] = compactForLog(val, seen)
    }
  }
  return out
}

export interface MediaCallLogInput {
  provider: string
  /** exactOptionalPropertyTypes：capability 允许显式传 undefined（adapter 里 input.capability 可能未解析） */
  capability?: MediaCapabilityId | string | undefined
  model?: string | undefined
  method: string
  url: string
  /** 组装好、即将 POST 给三方的请求体 */
  body?: unknown
  /** 额外诊断信息（如 inputFiles 数量、是否异步轮询） */
  extra?: Record<string, unknown> | undefined
}

/**
 * 打印一块彩色「媒体调用」日志。请在 adapter 调用 fetchJson 之前调用。
 *
 * 输出形如：
 *   ╭─ media:adapter · image.generate · apimart ───────────────
 *   │ POST https://api.apimart.ai/v1/images/generations
 *   │ model: gpt-image-2
 *   │ body: { model: 'gpt-image-2', prompt: '一只猫', n: 1, size: '1024x1024' }
 *   ╰──────────────────────────────────────────────────────────
 */
export function logMediaCall(input: MediaCallLogInput): void {
  const color = colorForCapability(input.capability)
  const cap = input.capability ?? 'unknown'
  const header = `${COLORS.bold}media:adapter${COLORS.reset} · ${color}${cap}${COLORS.reset} · ${COLORS.dim}${input.provider}${COLORS.reset}`
  const visibleHeader = Object.values(COLORS).reduce(
    (text, ansi) => text.split(ansi).join(''),
    header,
  )
  const rule = `${COLORS.dim}─${COLORS.reset}`.repeat(Math.max(8, 56 - visibleHeader.length))

  const lines: string[] = []
  lines.push(`${COLORS.dim}╭─${COLORS.reset}${header} ${COLORS.dim}${rule}${COLORS.reset}`)
  lines.push(
    `${COLORS.dim}│${COLORS.reset} ${COLORS.bold}${input.method}${COLORS.reset} ${input.url}`,
  )
  if (input.model)
    lines.push(`${COLORS.dim}│${COLORS.reset} model: ${color}${input.model}${COLORS.reset}`)
  if (input.extra) {
    for (const [key, value] of Object.entries(input.extra)) {
      const display = typeof value === 'string' ? value : JSON.stringify(value)
      lines.push(`${COLORS.dim}│${COLORS.reset} ${key}: ${display}`)
    }
  }
  if (input.body !== undefined) {
    const bodyStr =
      typeof input.body === 'string' ? input.body : JSON.stringify(compactForLog(input.body))
    lines.push(`${COLORS.dim}│${COLORS.reset} body: ${bodyStr}`)
  }
  lines.push(`${COLORS.dim}╰${COLORS.reset}${COLORS.dim}${'─'.repeat(60)}${COLORS.reset}`)

  log.info(`\n${lines.join('\n')}`)
}

export interface MediaCallResultInput {
  provider: string
  capability?: MediaCapabilityId | string | undefined
  ok: boolean
  durationMs?: number | undefined
  assetCount?: number | undefined
  requestId?: string | undefined
  error?: string | undefined
}

/**
 * 打印媒体调用的结果摘要（成功/失败、产物数量、requestId）。
 * 与 logMediaCall 成对使用，框住一次三方调用。
 */
export function logMediaResult(input: MediaCallResultInput): void {
  const color = colorForCapability(input.capability)
  const status = input.ok
    ? `${COLORS.green}ok${COLORS.reset}`
    : `${COLORS.bold}${COLORS.red}failed${COLORS.reset}`
  const parts = [
    `${COLORS.bold}media:result${COLORS.reset} · ${color}${input.capability ?? 'unknown'}${COLORS.reset} · ${status}`,
  ]
  if (input.durationMs != null) parts.push(`${input.durationMs}ms`)
  if (input.assetCount != null) parts.push(`${input.assetCount} asset(s)`)
  if (input.requestId) parts.push(`requestId=${input.requestId}`)
  if (input.error) parts.push(`${COLORS.bold}${COLORS.red}${input.error}${COLORS.reset}`)
  log.info(parts.join(' · '))
}

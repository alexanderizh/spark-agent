/**
 * @module media-debug-log
 *
 * 多媒体 adapter 调用日志（主进程 / Node 运行时）。
 *
 * 目的：画布里文生图 / 图生图 / 图片编辑 / TTS / 转写 / 视频等 AI 调用，
 * 在真正发 HTTP 给三方平台之前，把「组装好的请求参数 / 响应 / 报错」按能力落成
 * 单行结构化日志，方便「设置 → 遥测与日志」页面的日志查看器按前缀过滤和检索。
 *
 * 历史说明：早期版本用 ANSI 多行盒式框打印到控制台，但盒式框会让
 * logger 写到 main.log 后「第二行起」丢失 `[LEVEL] [namespace]` 前缀，
 * 导致 `media:`/`canvas:` 命名空间过滤丢掉 body/response/error 内容。
 * 本版本改为 file-friendly 单行输出，控制台也直接走单行（仍可按 capability 上色）。
 *
 * 颜色按产物类型区分：image→品红，audio→青，video→黄，text→绿，其它灰。
 *
 * 所有 base64 / data: 内容会被截断（复用 compactForLog），不会刷屏。
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

const SECRET_KEY_PATTERN = /^(authorization|cookie|set-cookie|password|secret|api[-_]?key|.*[-_]?token)$/i
const PRIVATE_CONTENT_KEY_PATTERN = /^(prompt|negative[-_]?prompt|messages?|contents?|text|input)$/i
const BASE64_KEY_PATTERN = /(base64|b64(?:_json)?|dataurl)$/i
const DATA_URL_PATTERN = /^data:([^;,]+)?;base64,(.*)$/is
const MAX_LOG_STRING_CHARS = 800

function base64Summary(value: string, mimeType?: string): string {
  const normalized = value.replace(/\s+/g, '')
  const estimatedBytes = Math.max(
    0,
    Math.floor((normalized.length * 3) / 4) -
      (normalized.endsWith('==') ? 2 : normalized.endsWith('=') ? 1 : 0),
  )
  const digest = createHash('sha256').update(normalized).digest('hex').slice(0, 12)
  return `[base64${mimeType ? ` mime=${mimeType}` : ''} bytes~${estimatedBytes} sha256=${digest}]`
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
    if (dataUrl) return base64Summary(dataUrl[2] ?? '', dataUrl[1])
    return value.length > MAX_LOG_STRING_CHARS
      ? `${value.slice(0, MAX_LOG_STRING_CHARS)}…[truncated chars=${value.length}]`
      : value
  }
  if (typeof value !== 'object') return value
  if (seen.has(value as object)) return '[Circular]'
  seen.add(value as object)
  if (Array.isArray(value)) return value.map((item) => compactForLog(item, seen))
  const out: Record<string, unknown> = {}
  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    if (SECRET_KEY_PATTERN.test(key)) {
      out[key] = '[REDACTED]'
    } else if (typeof val === 'string' && DATA_URL_PATTERN.test(val)) {
      const dataUrl = DATA_URL_PATTERN.exec(val)
      out[key] = base64Summary(dataUrl?.[2] ?? '', dataUrl?.[1])
    } else if (typeof val === 'string' && /(?:url|uri)$/i.test(key)) {
      out[key] = sanitizeUrlForLog(val)
    } else if (typeof val === 'string' && BASE64_KEY_PATTERN.test(key)) {
      const dataUrl = DATA_URL_PATTERN.exec(val)
      out[key] = dataUrl ? base64Summary(dataUrl[2] ?? '', dataUrl[1]) : base64Summary(val)
    } else {
      out[key] = compactForLog(val, seen)
    }
  }
  return out
}

/** 落盘日志专用：移除用户正文，同时保留原始长度供排障。 */
export function redactPrivateContentForLog(
  value: unknown,
  seen: WeakSet<object> = new WeakSet(),
): unknown {
  if (value == null || typeof value !== 'object') return compactForLog(value)
  if (seen.has(value as object)) return '[Circular]'
  seen.add(value as object)
  if (Array.isArray(value)) {
    return value.map((item) => redactPrivateContentForLog(item, seen))
  }
  const result: Record<string, unknown> = {}
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    if (PRIVATE_CONTENT_KEY_PATTERN.test(key)) {
      result[key] = `[REDACTED content chars=${contentLength(nested)}]`
    } else if (SECRET_KEY_PATTERN.test(key)) {
      result[key] = '[REDACTED]'
    } else if (typeof nested === 'string' && DATA_URL_PATTERN.test(nested)) {
      const dataUrl = DATA_URL_PATTERN.exec(nested)
      result[key] = base64Summary(dataUrl?.[2] ?? '', dataUrl?.[1])
    } else if (typeof nested === 'string' && BASE64_KEY_PATTERN.test(key)) {
      result[key] = base64Summary(nested)
    } else if (typeof nested === 'string' && /(?:url|uri)$/i.test(key)) {
      result[key] = sanitizeUrlForLog(nested)
    } else {
      result[key] = redactPrivateContentForLog(nested, seen)
    }
  }
  return result
}

function contentLength(value: unknown): number {
  if (typeof value === 'string') return value.length
  try {
    return JSON.stringify(value ?? null).length
  } catch {
    return 0
  }
}

export function sanitizeUrlForLog(rawUrl: string): string {
  try {
    const url = new URL(rawUrl)
    url.username = ''
    url.password = ''
    url.hash = ''
    if (url.search.length > 0) url.search = '?redacted=1'
    return url.toString()
  } catch {
    return rawUrl.split(/[?#]/, 1)[0]?.slice(0, 300) ?? '[invalid-url]'
  }
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
 * 单行打印一次「媒体调用」参数日志（请在 adapter 调用 fetchJson 之前调用）。
 *
 * 输出形如（main.log 实际内容，无 ANSI）：
 *   [...INFO...] [media:adapter] event=adapter-request provider=xai capability=video.generate model=grok-imagine-video method=POST url="..." body={"..."} extras=...
 *
 * 控制台会再额外走一个带颜色的摘要行（不影响文件输出）。
 */
export function logMediaCall(input: MediaCallLogInput): void {
  const parts: string[] = ['event=adapter-request']
  parts.push(`provider=${JSON.stringify(input.provider)}`)
  parts.push(`capability=${JSON.stringify(input.capability ?? 'unknown')}`)
  if (input.model) parts.push(`model=${JSON.stringify(input.model)}`)
  parts.push(`method=${JSON.stringify(input.method)}`)
  parts.push(`url=${JSON.stringify(sanitizeUrlForLog(input.url))}`)
  if (input.body !== undefined) {
    const bodyStr = stringifyBody(input.body)
    parts.push(`body=${bodyStr}`)
  }
  if (input.extra) {
    const safeExtra = redactPrivateContentForLog(input.extra) as Record<string, unknown>
    for (const [key, value] of Object.entries(safeExtra)) {
      parts.push(`${key}=${formatExtraValue(value)}`)
    }
  }
  try {
    log.info(parts.join(' '))
  } catch {
    /* 日志失败不影响业务路径 */
  }
  // 控制台彩色摘要：仅 dev 期肉眼定位能力类型。
  writeConsoleSummary(input)
}

export interface MediaCallResultInput {
  provider: string
  capability?: MediaCapabilityId | string | undefined
  ok: boolean
  durationMs?: number | undefined
  assetCount?: number | undefined
  requestId?: string | undefined
  error?: string | undefined
  /** 失败时的额外上下文：HTTP 状态码或上游响应摘要（仅在 ok=false 时有意义） */
  details?: string | undefined
}

/**
 * 单行打印媒体调用结果摘要（成功/失败、产物数量、requestId、错误）。
 * 与 logMediaCall 成对使用，框住一次三方调用。
 */
export function logMediaResult(input: MediaCallResultInput): void {
  const parts: string[] = [`event=adapter-${input.ok ? 'response' : 'failed'}`]
  parts.push(`provider=${JSON.stringify(input.provider)}`)
  parts.push(`capability=${JSON.stringify(input.capability ?? 'unknown')}`)
  if (input.durationMs != null) parts.push(`durationMs=${input.durationMs}`)
  if (input.assetCount != null) parts.push(`assets=${input.assetCount}`)
  if (input.requestId) parts.push(`requestId=${JSON.stringify(input.requestId)}`)
  if (input.error) parts.push(`error=${JSON.stringify(truncate(input.error, 1000))}`)
  if (input.details) parts.push(`details=${JSON.stringify(truncate(input.details, 800))}`)
  try {
    if (input.ok) {
      log.info(parts.join(' '))
    } else {
      log.warn(parts.join(' '))
    }
  } catch {
    /* 日志失败不影响业务路径 */
  }
  // 控制台彩色摘要：仅 dev 期肉眼定位。
  writeConsoleResultSummary(input)
}

function stringifyBody(body: unknown): string {
  try {
    if (typeof body === 'string') {
      try {
        return JSON.stringify(redactPrivateContentForLog(JSON.parse(body)))
      } catch {
        return JSON.stringify(`[REDACTED content chars=${body.length}]`)
      }
    }
    return JSON.stringify(redactPrivateContentForLog(body))
  } catch {
    return '"[unserializable body]"'
  }
}

function formatExtraValue(value: unknown): string {
  if (value === undefined) return '"(n/a)"'
  if (typeof value === 'string') return JSON.stringify(truncate(value, 400))
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  try {
    return JSON.stringify(compactForLog(value))
  } catch {
    return '"[unserializable value]"'
  }
}

function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max)}…[truncated chars=${value.length}]`
}

function writeConsoleSummary(input: MediaCallLogInput): void {
  if (typeof console === 'undefined') return
  const color = colorForCapability(input.capability)
  const cap = input.capability ?? 'unknown'
  // 控制台用单行着色摘要（避免 ANSI 多行盒式框）
  // eslint-disable-next-line no-console
  console.log(
    `${COLORS.bold}media:adapter${COLORS.reset} · ${color}${cap}${COLORS.reset} · ${COLORS.dim}${input.provider}${COLORS.reset} ${input.method} ${sanitizeUrlForLog(input.url)}`,
  )
}

function writeConsoleResultSummary(input: MediaCallResultInput): void {
  if (typeof console === 'undefined') return
  const color = colorForCapability(input.capability)
  const status = input.ok
    ? `${COLORS.green}ok${COLORS.reset}`
    : `${COLORS.bold}${COLORS.red}failed${COLORS.reset}`
  const summary = `${COLORS.bold}media:result${COLORS.reset} · ${color}${input.capability ?? 'unknown'}${COLORS.reset} · ${status}`
  const tail: string[] = []
  if (input.durationMs != null) tail.push(`${input.durationMs}ms`)
  if (input.assetCount != null) tail.push(`${input.assetCount} asset(s)`)
  if (input.requestId) tail.push(`requestId=${input.requestId}`)
  if (input.error) tail.push(`${COLORS.bold}${COLORS.red}${input.error}${COLORS.reset}`)
  // eslint-disable-next-line no-console
  console.log(tail.length > 0 ? `${summary} · ${tail.join(' · ')}` : summary)
}

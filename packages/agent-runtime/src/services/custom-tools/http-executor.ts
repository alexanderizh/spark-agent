/**
 * HTTP 工具执行器（M1，方案 §3.2）
 *
 * 安全要点：
 * - URL 占位符逐段 encodeURIComponent（模板渲染层）
 * - JSON body 走 parse-based 渲染，结构性注入在解析层死亡
 * - 敏感请求头只能来自密钥库（协议层强制 secretRef）
 * - 可关闭私网访问；Node 连接层 BlockList 同时覆盖 DNS 解析和重定向目标
 * - 超时 / 响应大小上限 / 输出截断，替换后的完整请求永不落日志
 */

import { BlockList } from 'node:net'
import type { CustomToolRecord, HttpToolSpec } from '@spark/protocol'
import { findSensitiveHttpQueryParam, hasHttpUrlCredentials } from '@spark/protocol'
import { clipTextHeadTail } from '@spark/shared'
import { Agent, Headers, fetch as undiciFetch } from 'undici'
import { CustomToolError } from './custom-tool-errors.js'
import type { ExecutorContext, ExecutorResult } from './custom-tool-executor.js'
import { jsonPathExtract, jsonPathValueToCell } from './custom-tool-json-path.js'
import {
  renderHeaderTemplate,
  renderJsonBodyTemplate,
  renderUrlTemplate,
} from './custom-tool-template.js'
import { validateToolInput } from './custom-tool-input-validator.js'

const DEFAULT_MAX_RESPONSE_BYTES = 262_144
/** 给 LLM 的输出预算（token），超出走 clipTextHeadTail 头尾截断 */
const OUTPUT_TOKEN_BUDGET = 8_000

/**
 * Block every address range that is not suitable as a public HTTP destination.
 * Passing this list to the socket connector, instead of checking DNS before
 * fetch, prevents a DNS-rebinding window and applies to every redirect hop.
 */
const NON_PUBLIC_NETWORKS = new BlockList()
for (const [network, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.88.99.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
] as const) {
  NON_PUBLIC_NETWORKS.addSubnet(network, prefix, 'ipv4')
}
for (const [network, prefix] of [
  ['::', 128],
  ['::1', 128],
  ['::ffff:0:0', 96],
  ['64:ff9b:1::', 48],
  ['100::', 64],
  ['2001::', 23],
  ['2001:db8::', 32],
  ['2002::', 16],
  ['fc00::', 7],
  ['fe80::', 10],
  ['ff00::', 8],
] as const) {
  NON_PUBLIC_NETWORKS.addSubnet(network, prefix, 'ipv6')
}

export async function executeHttpTool(
  record: CustomToolRecord,
  input: Record<string, unknown>,
  ctx: ExecutorContext,
): Promise<ExecutorResult> {
  if (record.type !== 'http') {
    throw new CustomToolError('NOT_IMPLEMENTED', 'executeHttpTool 仅接受 http 类型工具')
  }
  const spec = record.spec as HttpToolSpec
  const startedAt = Date.now()

  validateToolInput(record.inputSchema, input)

  const url = renderUrlTemplate(spec.request.urlTemplate, input)
  if (hasHttpUrlCredentials(url)) {
    throw new CustomToolError('DENIED', 'URL 不允许内嵌用户名或密码，请改用 Keychain 请求头')
  }
  const sensitiveQueryParam = findSensitiveHttpQueryParam(url)
  if (sensitiveQueryParam != null) {
    throw new CustomToolError(
      'DENIED',
      `敏感查询参数 ${sensitiveQueryParam} 暂不支持安全密钥引用，请改用 Keychain 请求头`,
    )
  }

  const headers = new Headers()
  for (const header of spec.request.headers ?? []) {
    const value =
      header.secretRef != null
        ? await ctx.resolveSecret(header.secretRef)
        : renderHeaderTemplate(header.valueTemplate ?? '', input)
    headers.set(header.name, value)
  }

  const body =
    spec.request.body != null && spec.request.method !== 'GET' && spec.request.method !== 'DELETE'
      ? renderJsonBodyTemplate(spec.request.body.jsonTemplate, input)
      : undefined
  const hasBody = body !== undefined
  if (hasBody && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json')
  }

  const timeoutMs = record.timeoutMs
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort('timeout'), timeoutMs)
  const onOuterAbort = () => controller.abort('caller')
  if (ctx.signal.aborted) controller.abort('caller')
  else ctx.signal.addEventListener('abort', onOuterAbort, { once: true })

  const dispatcher =
    spec.allowPrivateNetwork === false
      ? new Agent({ connect: { blockList: NON_PUBLIC_NETWORKS } })
      : null

  try {
    const response = await undiciFetch(url, {
      method: spec.request.method,
      headers,
      ...(body !== undefined ? { body } : {}),
      signal: controller.signal,
      redirect: 'follow',
      ...(dispatcher != null ? { dispatcher } : {}),
    })

    const maxSize = spec.response.maxSizeBytes ?? DEFAULT_MAX_RESPONSE_BYTES
    const { text, truncated } = await readBodyWithCap(response, maxSize)
    const durationMs = Date.now() - startedAt
    const bytes = new TextEncoder().encode(text).length

    if (!response.ok) {
      const excerpt = text.slice(0, 500)
      throw new CustomToolError(
        'HTTP_ERROR',
        `HTTP ${response.status} ${response.statusText}${excerpt.trim() !== '' ? `：${excerpt}` : ''}`,
      )
    }

    const rendered = formatResponse(spec, text)
    const clipped = clipTextHeadTail(rendered, OUTPUT_TOKEN_BUDGET)
    return {
      text: clipped,
      meta: { durationMs, bytes, truncated: truncated || clipped !== rendered },
    }
  } catch (error) {
    if (error instanceof CustomToolError) throw error
    if (controller.signal.aborted && controller.signal.reason === 'timeout') {
      throw new CustomToolError(
        'TIMEOUT',
        `请求超时（${timeoutMs}ms）：${spec.request.method} ${redactUrl(url)}`,
      )
    }
    if (ctx.signal.aborted) throw new CustomToolError('DENIED', '调用被取消')
    if (findErrorCode(error) === 'ERR_IP_BLOCKED') {
      throw new CustomToolError('DENIED', '目标地址属于非公网网络，当前工具已关闭私网访问')
    }
    throw new CustomToolError(
      'UNREACHABLE',
      `无法访问目标地址：${error instanceof Error ? error.message : String(error)}`,
    )
  } finally {
    clearTimeout(timer)
    ctx.signal.removeEventListener('abort', onOuterAbort)
    await dispatcher?.close()
  }
}

function findErrorCode(error: unknown): string | undefined {
  let current: unknown = error
  for (let depth = 0; depth < 5; depth += 1) {
    if (current == null || typeof current !== 'object') return undefined
    const record = current as { code?: unknown; cause?: unknown }
    if (typeof record.code === 'string') return record.code
    current = record.cause
  }
  return undefined
}

/** 只读日志需要的最小 URL 信息（保留 host+path 骨架，去掉查询参数值） */
function redactUrl(url: string): string {
  try {
    const parsed = new URL(url)
    return `${parsed.protocol}//${parsed.host}${parsed.pathname}`
  } catch {
    return '<invalid-url>'
  }
}

async function readBodyWithCap(
  response: Response,
  capBytes: number,
): Promise<{ text: string; truncated: boolean }> {
  const reader = response.body?.getReader()
  if (reader == null) {
    const text = await response.text()
    if (text.length <= capBytes) return { text, truncated: false }
    return { text: text.slice(0, capBytes), truncated: true }
  }
  const decoder = new TextDecoder()
  const chunks: Uint8Array[] = []
  let total = 0
  let truncated = false
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      if (value == null) continue
      total += value.byteLength
      if (total > capBytes) {
        const overshoot = total - capBytes
        chunks.push(value.slice(0, value.byteLength - overshoot))
        truncated = true
        await reader.cancel('response size limit reached')
        break
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }
  const merged = new Uint8Array(Math.min(total, capBytes))
  let offset = 0
  for (const chunk of chunks) {
    merged.set(chunk, offset)
    offset += chunk.byteLength
  }
  return { text: decoder.decode(merged, { stream: false }) + decoder.decode(), truncated }
}

function formatResponse(spec: HttpToolSpec, text: string): string {
  const extract = spec.response.extract
  if (extract != null && extract.length > 0) {
    let parsed: unknown
    try {
      parsed = JSON.parse(text)
    } catch {
      return `> 响应不是合法 JSON，extract 规则未生效，返回原始内容\n\n${text}`
    }
    return renderExtractTable(extract, parsed)
  }
  if (spec.response.format === 'json') {
    try {
      return `\`\`\`json\n${JSON.stringify(JSON.parse(text), null, 2)}\n\`\`\``
    } catch {
      return text
    }
  }
  return text
}

function renderExtractTable(
  extract: Array<{ label: string; jsonPath: string }>,
  data: unknown,
): string {
  const columns = extract.map((rule) => ({
    label: rule.label,
    values: jsonPathExtract(data, rule.jsonPath).map(jsonPathValueToCell),
  }))
  const rowCount = Math.max(...columns.map((column) => column.values.length), 1)
  const lines: string[] = []
  lines.push(`| ${columns.map((column) => escapeCell(column.label)).join(' | ')} |`)
  lines.push(`| ${columns.map(() => '---').join(' | ')} |`)
  for (let row = 0; row < rowCount; row += 1) {
    lines.push(`| ${columns.map((column) => escapeCell(column.values[row] ?? '')).join(' | ')} |`)
  }
  return lines.join('\n')
}

function escapeCell(value: string): string {
  return value.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ')
}

/**
 * @module media-error-normalizer
 *
 * Provider 错误响应归一化器。把火山 / xAI / Google / OpenAI-compatible / Apimart 等
 * 各自的错误结构归一为统一的 NormalizedMediaError，方便任务详情、自动重试、agent
 * 反馈和遥测统一处理。
 *
 * Manifest 通过 `error: MediaErrorContract` 声明自家错误响应中 code/message/
 * requestId/paramName 的 JSON 路径与映射表；fetchJson 在抛 MediaProviderError 前
 * 调用本归一器，把结果挂到 `err.normalized`。
 *
 * 解析顺序见 normalizeMediaError 的实现注释。
 */

import type {
  MediaErrorContract,
  MediaNormalizedErrorCode,
} from '@spark/protocol'

export interface NormalizeMediaErrorInput {
  statusCode?: number | undefined
  body: unknown
  rawText: string
  contract?: MediaErrorContract | undefined
  providerKind?: string | undefined
}

export interface NormalizedMediaError {
  code: MediaNormalizedErrorCode
  providerCode?: string | undefined
  message: string
  requestId?: string | undefined
  paramName?: string | undefined
  retryable: boolean
  rawSnippet?: string | undefined
}

const DEFAULT_MESSAGE_LIMIT = 400
const DEFAULT_SNIPPET_LIMIT = 800

// 主流 provider 错误响应里 message / code / requestId 的常见路径。
// contract 缺失时使用这套兜底，保证 401/429/quota 等通用场景仍能归一。
const FALLBACK_MESSAGE_PATHS = [
  'error.message',
  'error.error.message',
  'message',
  'errors[0].message',
  'detail',
]
const FALLBACK_CODE_PATHS = [
  'error.code',
  'error.type',
  'error.status',
  'error.error.code',
  'code',
]
const FALLBACK_REQUEST_ID_PATHS = [
  'request_id',
  'RequestId',
  'requestId',
  'x-request-id',
  'error.details.0.request_id',
]
const FALLBACK_PARAM_NAME_PATTERNS = [
  'parameter[:\\s]+`?([a-z_]+)`?',
  'parameter[:\\s]+"?([a-z_]+)"?',
  '`([a-z_]+)` is not supported',
  '"([a-z_]+)" is not supported',
]

export function normalizeMediaError(input: NormalizeMediaErrorInput): NormalizedMediaError {
  const { statusCode, body, rawText, contract, providerKind } = input
  const codePaths = mergePaths(contract?.codePaths, FALLBACK_CODE_PATHS)
  const messagePaths = mergePaths(contract?.messagePaths, FALLBACK_MESSAGE_PATHS)
  const requestIdPaths = mergePaths(contract?.requestIdPaths, FALLBACK_REQUEST_ID_PATHS)
  const paramNamePatterns = mergePaths(contract?.paramNamePatterns, FALLBACK_PARAM_NAME_PATTERNS)

  const providerCode = extractFirstString(body, codePaths)
  const message =
    extractFirstString(body, messagePaths) ?? fallbackMessage(rawText, statusCode)
  const requestId = extractFirstString(body, requestIdPaths)
  const paramName =
    extractFirstString(body, contract?.paramNamePaths) ??
    extractParamNameFromPatterns(message, paramNamePatterns)

  const mapped = providerCode ? contract?.mappings?.[providerCode] : undefined

  let code: MediaNormalizedErrorCode = mapped ?? 'provider_http_error'
  let retryable = false

  // message 关键词判断（覆盖截图中的 "output_format is not supported" 场景）。
  const lower = (message ?? '').toLowerCase()
  if (paramName && (lower.includes('not supported') || lower.includes('unsupported') || lower.includes('invalid parameter'))) {
    code = 'unsupported_parameter'
  } else if (lower.includes('quota') || lower.includes('balance') || lower.includes('insufficient') || statusCode === 402) {
    code = 'quota_exceeded'
  } else if (lower.includes('content policy') || lower.includes('content filter') || lower.includes('safety')) {
    code = 'content_policy_blocked'
  } else if (lower.includes('unauthorized') || lower.includes('invalid api key') || lower.includes('api key')) {
    code = 'auth_failed'
  } else if (lower.includes('timed out') || lower.includes('timeout')) {
    code = 'task_timeout'
  }

  // HTTP 状态码兜底（优先级低于 message 关键词，避免误判 429 + 限速 message）。
  if (code === 'provider_http_error') {
    if (statusCode === 401 || statusCode === 403) {
      code = 'auth_failed'
    } else if (statusCode === 429) {
      code = 'rate_limited'
      retryable = true
    } else if (statusCode === 400 || statusCode === 422) {
      // 参数错误已被前面的关键词覆盖；这里兜底为 invalid_parameter_value。
      if (paramName || providerCode) code = 'invalid_parameter_value'
    }
  }

  if (providerCode && contract?.retryableCodes?.includes(providerCode)) {
    retryable = true
  }
  // 限速 / 配额默认可重试。
  if (code === 'rate_limited' || code === 'task_timeout') retryable = true

  return {
    code,
    ...(providerCode ? { providerCode } : {}),
    message: truncate(message, DEFAULT_MESSAGE_LIMIT),
    ...(requestId ? { requestId } : {}),
    ...(paramName ? { paramName } : {}),
    retryable,
    rawSnippet: snippet(body, rawText),
    ...(providerKind ? {} : {}),
  }
}

function mergePaths(declared: string[] | undefined, fallback: string[]): string[] {
  if (!declared || declared.length === 0) return fallback
  // declared 优先，但 fallback 也保留以提升命中率（provider 偶尔会改结构）。
  return [...declared, ...fallback]
}

// ─── 内部 helper ──────────────────────────────────────────────────────────
function extractFirstString(root: unknown, paths: string[] | undefined): string | undefined {
  if (!paths || paths.length === 0) return undefined
  for (const path of paths) {
    const value = readPath(root, path)
    if (typeof value === 'string' && value.trim().length > 0) return value.trim()
  }
  return undefined
}

function readPath(root: unknown, path: string): unknown {
  if (!path) return undefined
  return path
    .split('.')
    .reduce<unknown>((acc, key) => {
      if (acc == null) return undefined
      if (Array.isArray(key)) return undefined
      // 支持 `error[0]` / `errors[]` 等数组写法：解析第一个数组元素。
      const arrayMatch = /^(.+)\[\]$/.exec(key)
      if (arrayMatch) {
        const arr = readOwn(acc, arrayMatch[1] ?? '')
        if (Array.isArray(arr)) return arr[0]
        return undefined
      }
      const indexMatch = /^(.+)\[(\d+)\]$/.exec(key)
      if (indexMatch) {
        const arr = readOwn(acc, indexMatch[1] ?? '')
        if (Array.isArray(arr)) return arr[Number(indexMatch[2])]
        return undefined
      }
      // 支持 `error.details.0.request_id` 这种点号分隔的数组下标。
      if (/^\d+$/.test(key)) {
        const idx = Number(key)
        if (Array.isArray(acc)) return acc[idx]
      }
      return readOwn(acc, key)
    }, root)
}

function readOwn(value: unknown, key: string): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  // 大小写不敏感：兜底匹配火山 RequestId/request_id、Google error.code 等。
  if (key in record) return record[key]
  const lower = key.toLowerCase()
  for (const [k, v] of Object.entries(record)) {
    if (k.toLowerCase() === lower) return v
  }
  return undefined
}

function extractParamNameFromPatterns(message: string | undefined, patterns: string[] | undefined): string | undefined {
  if (!message || !patterns || patterns.length === 0) return undefined
  for (const pattern of patterns) {
    try {
      const re = new RegExp(pattern, 'i')
      const match = message.match(re)
      if (match && match[1]) return match[1]
    } catch {
      // 正则非法时跳过，避免污染日志。
      continue
    }
  }
  return undefined
}

function fallbackMessage(rawText: string, statusCode: number | undefined): string {
  if (!rawText) return statusCode ? `HTTP ${statusCode}` : 'Provider error'
  return statusCode ? `HTTP ${statusCode}: ${rawText.slice(0, 200)}` : rawText.slice(0, 400)
}

function truncate(text: string | undefined, limit: number): string {
  if (!text) return ''
  return text.length > limit ? `${text.slice(0, limit - 3)}...` : text
}

function snippet(body: unknown, rawText: string): string {
  const candidate = body && typeof body === 'object' ? safeStringify(body) : rawText
  if (!candidate) return ''
  return candidate.length > DEFAULT_SNIPPET_LIMIT ? `${candidate.slice(0, DEFAULT_SNIPPET_LIMIT - 3)}...` : candidate
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

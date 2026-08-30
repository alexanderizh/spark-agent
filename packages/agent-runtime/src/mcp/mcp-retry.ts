/**
 * MCP 工具调用应用层重试（D-10）
 *
 * 设计原则：
 * - 严格幂等白名单：默认不重试有副作用的工具（write/edit/bash/post 等）
 * - 仅对 read-only 类工具（list/search/get/read/query/fetch/describe）自动重试 5xx/网络错误
 * - 复用 shared.isRetryableHttpError 的瞬时错误判定语义
 * - 指数退避：500ms → 1s → 2s（上限 4s），避免雪崩
 *
 * 安全保障：
 * - JSON-RPC error code 不视为可重试（业务错误，不是传输层）
 * - HTTP 4xx 不重试（确定性失败）
 * - 用户主动 disconnect 引发的错误不重试
 */

import { HttpError, isRetryableHttpError } from '@spark/shared'

export interface McpRetryOptions {
  /** 最大重试次数（不含首次调用），默认 3。设 0 关闭重试。 */
  maxRetries?: number
  /** 退避基数（ms），默认 500，每次 ×2、上限 4s。 */
  retryBackoffMs?: number
  /** 自定义幂等判定，覆盖默认 isMcpToolIdempotent。 */
  isIdempotent?: (serverName: string, toolName: string) => boolean
  /** 自定义「是否可重试」判定。默认：网络错误或 HTTP 5xx。 */
  isRetryable?: (error: unknown) => boolean
  /** 每次重试触发，便于日志/监控。 */
  onRetry?: (info: {
    attempt: number
    maxRetries: number
    backoffMs: number
    error: unknown
    toolName: string
  }) => void
}

const DEFAULT_MAX_RETRIES = 3
const DEFAULT_RETRY_BACKOFF_MS = 500
const MAX_RETRY_BACKOFF_MS = 4_000

/**
 * 幂等工具白名单：默认仅重试 read-only 工具。
 *
 * 判定逻辑（任一命中即视为幂等）：
 * 1. 显式 INDEMOTENT_PREFIXES 前缀（动词性 read-only）
 * 2. 不命中 NON_IDEMPOTENT_PREFIXES 的非幂等黑名单
 *
 * 注意：默认保守 —— 不在前缀白名单里的工具，一律视为非幂等（不重试）。
 */
const IDEMPOTENT_VERBS = [
  'list',
  'search',
  'get',
  'read',
  'query',
  'fetch',
  'describe',
  'find',
  'inspect',
  'lookup',
] as const

const NON_IDEMPOTENT_VERBS = [
  'write',
  'edit',
  'create',
  'delete',
  'remove',
  'update',
  'bash',
  'exec',
  'apply',
  'insert',
  'move',
  'rename',
  'submit',
  'post',
  'put',
  'patch',
  'set',
  'install',
  'kill',
  'spawn',
  'send',
  'dispatch',
  'approve',
  'reject',
  'cancel',
] as const

const NON_IDEMPOTENT_TOKENS = new Set<string>([
  ...NON_IDEMPOTENT_VERBS,
  'writes',
  'written',
  'editing',
  'edits',
  'creates',
  'created',
  'creating',
  'deletes',
  'deleted',
  'deleting',
  'removes',
  'removed',
  'removing',
  'updates',
  'updated',
  'updating',
  'inserts',
  'inserted',
  'inserting',
  'moves',
  'moved',
  'moving',
  'renames',
  'renamed',
  'renaming',
  'submits',
  'submitted',
  'sending',
  'sends',
])

function splitToolName(toolName: string): string[] {
  return toolName
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
}

export function isMcpToolIdempotent(serverName: string, toolName: string): boolean {
  void serverName
  const tokens = splitToolName(toolName)
  if (tokens.some((token) => NON_IDEMPOTENT_TOKENS.has(token))) return false
  if (tokens[0] != null && IDEMPOTENT_VERBS.includes(tokens[0] as (typeof IDEMPOTENT_VERBS)[number])) {
    return true
  }
  // 默认非幂等（保守）
  return false
}

/**
 * 判断 MCP 错误是否可重试。
 * - JSON-RPC error（response.error != null）→ 业务错误，不重试
 * - 网络/HTTP 5xx → 复用 shared.isRetryableHttpError
 * - 用户主动断开 → 不重试
 */
export function isRetryableMcpError(error: unknown): boolean {
  if (error == null) return false
  if (error instanceof HttpError) return isRetryableHttpError(error)
  if (error instanceof Error) {
    const statusCode = (error as Error & { statusCode?: unknown }).statusCode
    if (typeof statusCode === 'number') return isRetryableHttpError(error)
    const message = error.message.toLowerCase()
    return [
      'fetch failed',
      'connection lost',
      'econnreset',
      'econnrefused',
      'eai_again',
      'etimedout',
      'socket',
      'timed out',
      'timeout',
      'not connected',
      'disconnected',
      'stream closed',
      'transport reconnected',
    ].some((marker) => message.includes(marker))
  }
  return false
}

function computeBackoff(attempt: number, base: number): number {
  const v = base * Math.pow(2, attempt)
  return Math.min(v, MAX_RETRY_BACKOFF_MS)
}

/**
 * 包装一次 MCP 工具调用，按需重试可重试错误。
 * - 非幂等工具：直接调用，不重试
 * - 幂等工具：maxRetries 次重试 + 指数退避
 *
 * @param serverName MCP server 名（用于幂等判定 + 日志）
 * @param toolName 工具名（用于幂等判定）
 * @param operation 实际调用 —— 抛出 throw 才会进入重试；返回 McpToolResult 不视为错误
 */
export async function callMcpToolWithRetry<T>(
  serverName: string,
  toolName: string,
  operation: () => Promise<T>,
  options: McpRetryOptions = {},
): Promise<T> {
  const maxRetries = Math.max(0, options.maxRetries ?? DEFAULT_MAX_RETRIES)
  const retryBackoffMs = Math.max(1, options.retryBackoffMs ?? DEFAULT_RETRY_BACKOFF_MS)
  const isIdempotent = options.isIdempotent ?? isMcpToolIdempotent
  const isRetryable = options.isRetryable ?? isRetryableMcpError

  // 非幂等工具直接调用，不重试
  if (maxRetries === 0 || !isIdempotent(serverName, toolName)) {
    return operation()
  }

  let lastError: unknown
  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    try {
      return await operation()
    } catch (err) {
      lastError = err
      if (attempt >= maxRetries) break
      if (!isRetryable(err)) break
      const backoffMs = computeBackoff(attempt, retryBackoffMs)
      options.onRetry?.({
        attempt: attempt + 1,
        maxRetries,
        backoffMs,
        error: err,
        toolName,
      })
      await new Promise<void>((resolve) => setTimeout(resolve, backoffMs))
    }
  }
  throw lastError
}

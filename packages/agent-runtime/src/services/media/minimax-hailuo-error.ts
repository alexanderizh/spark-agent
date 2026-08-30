/**
 * @module minimax-hailuo-error
 *
 * MiniMax v1 / Files 通道的错误归一（adapter 与 files client 共享）。
 *
 * v1 / Files 接口 HTTP 恒为 200，业务码在 body `base_resp.status_code`(number)。非 0 时按本地
 * 映射表归一为 MediaNormalizedErrorCode 并抛 MediaProviderError（带 normalized summary + retryable）。
 * 之前 adapter 与 files client 各写一份 base_resp 检测，files 那份不归一（丢 rate_limited 等），
 * 现统一到本模块，保证两处错误行为一致。
 *
 * V2(H3) 通道错误模型不同（真实 HTTP 码 + OAI error），不走本模块，由 manifest.error 归一。
 *
 * 来源：docs/integrations/minimax/auth-errors.md §2
 */

import type { MediaNormalizedErrorCode } from '@spark/protocol'
import { MediaProviderError } from './media-adapter.types.js'
import type { NormalizedMediaErrorSummary } from './media-adapter.types.js'

/** v1 / Files 通道 base_resp.status_code(number) → 内部归一码（来源 auth-errors.md §2.3）。 */
export const MINIMAX_V1_ERROR_MAP: Record<number, MediaNormalizedErrorCode> = {
  1000: 'provider_http_error',
  1001: 'task_timeout',
  1002: 'rate_limited',
  1004: 'auth_failed',
  1008: 'quota_exceeded',
  1013: 'provider_http_error',
  1026: 'content_policy_blocked',
  1027: 'content_policy_blocked',
  1039: 'rate_limited',
  2013: 'invalid_parameter_value',
  2049: 'auth_failed',
}

function readPath(root: unknown, ...segments: string[]): unknown {
  return segments.reduce<unknown>((acc, key) => {
    if (acc == null) return undefined
    if (typeof acc !== 'object' || Array.isArray(acc)) return undefined
    return (acc as Record<string, unknown>)[key]
  }, root)
}

function stringifyValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined
}

/**
 * 检测 body.base_resp.status_code(number)；非 0 时按 MINIMAX_V1_ERROR_MAP 归一并抛错。
 * HTTP 200 业务错误的统一处理（fetchJson 在 HTTP 200 时不触发 manifest.errorContract）。
 */
export function assertMinimaxBaseResp(body: unknown): void {
  const baseResp = readPath(body, 'base_resp')
  if (!baseResp || typeof baseResp !== 'object') return
  const code = Number(readPath(baseResp, 'status_code'))
  if (!Number.isFinite(code) || code === 0) return
  const msgRaw = readPath(baseResp, 'status_msg')
  const msg = typeof msgRaw === 'string' ? msgRaw : ''
  const normalizedCode = MINIMAX_V1_ERROR_MAP[code] ?? 'provider_http_error'
  const retryable = normalizedCode === 'rate_limited' || normalizedCode === 'task_timeout'
  const requestId =
    stringifyValue(readPath(body, 'task_id')) ?? stringifyValue(readPath(body, 'id')) ?? undefined
  const err = new MediaProviderError(
    'provider_http_error',
    `MiniMax base_resp.status_code=${code}${msg ? `: ${msg}` : ''}`,
  )
  const summary: NormalizedMediaErrorSummary = {
    code: normalizedCode,
    providerCode: String(code),
    message: msg || `base_resp.status_code=${code}`,
    ...(requestId ? { requestId } : {}),
    retryable,
  }
  err.normalized = summary
  throw err
}

/**
 * 账号同步「余量」纯计算层。
 *
 * 服务端的单次同步上限是**请求体级**限制（`DESKTOP_SYNC_MAX_PAYLOAD_BYTES`），
 * 不是累计存储配额；因此「余量」按 `上限 − 参照数据量` 估算：
 * 有本次待同步测量值时以它为准，否则回落到服务端记录的上次同步数据量。
 *
 * 主进程、渲染层与 edu-web 共用同一套口径，避免三处各写一份格式化规则。
 */

import type { AccountSyncStatus } from './account-sync.js'

const BYTES_PER_KIB = 1024
const BYTES_PER_MIB = 1024 * 1024

/**
 * 服务端不支持 `/desktop-sync/status`（旧版本）或读取失败时的保守默认上限。
 * 取历史上限 5 MiB：只会让本地预检更严，不会错放超大请求。
 */
export const ACCOUNT_SYNC_FALLBACK_MAX_PAYLOAD_BYTES = 5 * BYTES_PER_MIB

/** 余量占比低于该阈值时进入警告态（UI 转 warning 色） */
export const ACCOUNT_SYNC_QUOTA_WARN_RATIO = 0.2

export type AccountSyncQuotaLevel = 'empty' | 'ok' | 'warn' | 'over'

export interface AccountSyncQuota {
  /** 作为进度口径的数据量（本次待同步测量值，否则上次同步数据量） */
  usedBytes: number
  maxBytes: number
  /** 剩余量，不会小于 0 */
  remainingBytes: number
  /** 0~1+ 的占比，用于进度条 */
  ratio: number
  level: AccountSyncQuotaLevel
  /** 参照口径：pending=本次待同步测量值；last=上次同步数据；none=尚无数据 */
  basis: 'pending' | 'last' | 'none'
}

/** 字节数 → 人类可读体积（B / KB / MiB），与服务端 `formatMib` 口径一致 */
export function formatAccountSyncPayloadSize(bytes: number | null | undefined): string {
  if (bytes == null || !Number.isFinite(bytes) || bytes < 0) return '—'
  if (bytes < BYTES_PER_KIB) return `${Math.round(bytes)} B`
  if (bytes < BYTES_PER_MIB) return `${Math.round(bytes / BYTES_PER_KIB)} KB`
  // 只保留一位小数，且整数不补 ".0"：3.4 MiB / 16.6 MiB / 20 MiB
  const mib = Math.round((bytes / BYTES_PER_MIB) * 10) / 10
  return `${Number.isInteger(mib) ? mib : mib.toFixed(1)} MiB`
}

export function computeAccountSyncQuota(
  status: AccountSyncStatus | null,
  pendingBytes?: number | null,
): AccountSyncQuota {
  const maxBytes =
    status != null && Number.isFinite(status.maxPayloadBytes) && status.maxPayloadBytes > 0
      ? status.maxPayloadBytes
      : ACCOUNT_SYNC_FALLBACK_MAX_PAYLOAD_BYTES
  const hasPending = pendingBytes != null && Number.isFinite(pendingBytes) && pendingBytes >= 0
  const lastBytes = status?.lastPayloadBytes
  const hasLast = lastBytes != null && Number.isFinite(lastBytes) && lastBytes >= 0

  const basis: AccountSyncQuota['basis'] = hasPending ? 'pending' : hasLast ? 'last' : 'none'
  const usedBytes = hasPending ? (pendingBytes as number) : hasLast ? (lastBytes as number) : 0
  const ratio = maxBytes > 0 ? usedBytes / maxBytes : 0
  const remainingBytes = Math.max(0, maxBytes - usedBytes)

  let level: AccountSyncQuotaLevel
  if (basis === 'none') level = 'empty'
  else if (usedBytes > maxBytes) level = 'over'
  else if (remainingBytes <= maxBytes * ACCOUNT_SYNC_QUOTA_WARN_RATIO) level = 'warn'
  else level = 'ok'

  return { usedBytes, maxBytes, remainingBytes, ratio, level, basis }
}

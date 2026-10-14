/**
 * WXML 视图模型（VM）派生。
 *
 * 小程序 WXML 数据绑定不支持调用 Page 方法（`{{fn(x)}}` 渲染为空），
 * 因此所有需要在模板里展示的格式化结果都在 TS 侧预计算为派生字段：
 * 页面拿到原始接口数据后先过这里的 VM 函数，再把带展示字段的
 * 视图模型 setData 给 WXML 直接绑定。
 */

import { formatBytes, formatDuration, formatFullTime, formatRelativeTime, formatShortTime } from './format'
import { ACCOUNT_SYNC_CATEGORIES, ACCOUNT_SYNC_CATEGORY_LABELS } from '../types'
import type { AccountSyncHistoryItem, AccountSyncStatus } from '../types'

/** 同步类别的中文标签（未知 key 原样返回，向前兼容新增类别） */
export function categoryLabelOf(key: string): string {
  return (ACCOUNT_SYNC_CATEGORY_LABELS as Record<string, string>)[key] ?? key
}

/** 全部同步类别的中文标签清单（类别是静态枚举，直接在 data 初始化） */
export const SYNC_CATEGORY_LABELS: readonly string[] = ACCOUNT_SYNC_CATEGORIES.map(categoryLabelOf)

/** 类别 key + 标签（模板需要同时展示两者时用） */
export interface SyncCategoryVM {
  key: string
  label: string
}

export const SYNC_CATEGORY_VMS: readonly SyncCategoryVM[] = ACCOUNT_SYNC_CATEGORIES.map((key) => ({
  key,
  label: categoryLabelOf(key),
}))

/** 同步操作状态徽标（success/partial/failed/未知 → class 与文案） */
export function syncStatusBadge(status: string | null): { badgeClass: string; badgeLabel: string } {
  if (status === 'success') return { badgeClass: 'badge badge-success', badgeLabel: '成功' }
  if (status === 'partial') return { badgeClass: 'badge badge-warning', badgeLabel: '部分完成' }
  if (status === 'failed') return { badgeClass: 'badge badge-danger', badgeLabel: '失败' }
  return { badgeClass: 'badge badge-neutral', badgeLabel: '暂无' }
}

/** 同步状态视图模型：徽标 + 相对/完整时间 + 用量标签，供首页与同步页直接绑定 */
export interface SyncStatusVM extends AccountSyncStatus {
  badgeClass: string
  badgeLabel: string
  /** 首页用：从未同步兜底为「尚未同步」 */
  relativeTime: string
  /** 同步页用：完整时间，从未同步为「—」 */
  fullTime: string
  payloadBytesLabel: string
  maxBytesLabel: string
  /** 「上次数据量 / 单次上限」合并展示 */
  bytesLabel: string
  usagePercent: number
}

export function syncStatusVM(status: AccountSyncStatus | null): SyncStatusVM | null {
  if (!status) return null
  return {
    ...status,
    ...syncStatusBadge(status.lastStatus),
    relativeTime: status.lastSyncAt ? formatRelativeTime(status.lastSyncAt) : '尚未同步',
    fullTime: formatFullTime(status.lastSyncAt),
    payloadBytesLabel: formatBytes(status.lastPayloadBytes),
    maxBytesLabel: formatBytes(status.maxPayloadBytes),
    bytesLabel: `${formatBytes(status.lastPayloadBytes)} / ${formatBytes(status.maxPayloadBytes)}`,
    usagePercent:
      status.lastPayloadBytes == null || status.maxPayloadBytes <= 0
        ? 0
        : Math.min(100, Math.max(1, Math.round((status.lastPayloadBytes / status.maxPayloadBytes) * 100))),
  }
}

/** 同步历史条目视图模型 */
export interface SyncHistoryItemVM extends AccountSyncHistoryItem {
  createdAtLabel: string
  durationLabel: string
  errorsLabel: string
  badgeClass: string
  badgeText: string
}

export function syncHistoryItemVM(item: AccountSyncHistoryItem): SyncHistoryItemVM {
  return {
    ...item,
    createdAtLabel: formatShortTime(item.createdAt),
    durationLabel: formatDuration(item.durationMs),
    errorsLabel: (item.errorCodes ?? []).join('、'),
    ...(item.status === 'success'
      ? { badgeClass: 'badge badge-success', badgeText: '成功' }
      : item.status === 'partial'
        ? { badgeClass: 'badge badge-warning', badgeText: '部分' }
        : { badgeClass: 'badge badge-danger', badgeText: '失败' }),
  }
}

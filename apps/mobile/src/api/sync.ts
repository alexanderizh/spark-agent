/**
 * 账号同步 API（镜像 edu-server desktop-sync.controller.ts）。
 *
 * 桌面端与移动端登录同一账号后，同步数据（自定义命令/提示词/记忆/助手/工作流/外观/提示词库）
 * 经服务端双向流转，这些接口让移动端实时看到同步状态与历史。
 */

import { request } from './request'
import type { AccountSyncHistoryItem, AccountSyncStatus } from '../types'

/** GET /desktop-sync/status — 同步余量状态 */
export function getSyncStatus(): Promise<AccountSyncStatus> {
  return request<AccountSyncStatus>('/desktop-sync/status')
}

/** GET /desktop-sync/history — 同步历史（分页） */
export function getSyncHistory(input: {
  page?: number
  pageSize?: number
}): Promise<{ list: AccountSyncHistoryItem[]; total: number; page: number; pageSize: number }> {
  return request<{
    list: AccountSyncHistoryItem[]
    total: number
    page: number
    pageSize: number
  }>('/desktop-sync/history', { data: { ...input } })
}

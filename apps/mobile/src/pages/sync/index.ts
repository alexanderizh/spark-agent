/**
 * 同步中心（tab）。
 *
 * 账号同步的详情视图：
 *   - 状态详情（最近同步时间/设备/状态、用量与上限、数据来源说明）
 *   - 同步历史（分页，设备标签可识别桌面端与移动端）
 *   - 同步类别清单
 *
 * 注：execute（真正上/下行同步）在桌面端执行（local-first 数据在本地），
 * 移动端 v1 提供同步态势的可视与设备识别；后续版本可接入移动端本地数据后执行同步。
 */

import * as syncApi from '../../api/sync'
import { ensureAuthenticated } from '../../utils/auth-guard'
import { formatBytes, formatDuration, formatFullTime, formatShortTime } from '../../utils/format'
import { ACCOUNT_SYNC_CATEGORY_LABELS, ACCOUNT_SYNC_CATEGORIES } from '../../types'
import type { AccountSyncHistoryItem, AccountSyncStatus } from '../../types'

interface SyncPageData {
  status: AccountSyncStatus | null
  list: AccountSyncHistoryItem[]
  total: number
  page: number
  pageSize: number
  loading: boolean
  loadingMore: boolean
  noMore: boolean
  highlight: string
  /** 同步类别清单（WXML wx:for 直接遍历 data，不走方法调用） */
  categories: readonly string[]
}

const PAGE_SIZE = 20

Page({
  data: {
    status: null,
    list: [],
    total: 0,
    page: 1,
    pageSize: PAGE_SIZE,
    loading: true,
    loadingMore: false,
    noMore: false,
    highlight: '',
    categories: ACCOUNT_SYNC_CATEGORIES,
  } as SyncPageData,

  onLoad(options: Record<string, string | undefined>) {
    if (options.highlight) {
      this.setData({ highlight: options.highlight })
    }
  },

  onShow() {
    if (!ensureAuthenticated()) return
    void this.loadFirst()
  },

  onPullDownRefresh() {
    void this.loadFirst().finally(() => wx.stopPullDownRefresh())
  },

  onReachBottom() {
    void this.loadMore()
  },

  async loadFirst() {
    this.setData({ loading: true, page: 1, noMore: false })
    try {
      const [status, history] = await Promise.all([
        syncApi.getSyncStatus().catch(() => null),
        syncApi.getSyncHistory({ page: 1, pageSize: PAGE_SIZE }).catch(() => null),
      ])
      const list = history?.list ?? []
      this.setData({
        status,
        list,
        total: history?.total ?? 0,
        page: 1,
        noMore: list.length < PAGE_SIZE,
      })
    } finally {
      this.setData({ loading: false })
    }
  },

  async loadMore() {
    const { loading, loadingMore, noMore, page } = this.data
    if (loading || loadingMore || noMore) return
    this.setData({ loadingMore: true })
    try {
      const next = page + 1
      const history = await syncApi.getSyncHistory({ page: next, pageSize: PAGE_SIZE })
      const appended = history?.list ?? []
      this.setData({
        list: [...this.data.list, ...appended],
        page: next,
        noMore: appended.length < PAGE_SIZE,
      })
    } catch (error) {
      wx.showToast({ title: (error as Error).message || '加载失败', icon: 'none' })
    } finally {
      this.setData({ loadingMore: false })
    }
  },

  methods: {
    formatBytes,
    formatDuration,
    formatFullTime,
    formatShortTime,
    categoryLabel(key: keyof typeof ACCOUNT_SYNC_CATEGORY_LABELS): string {
      return ACCOUNT_SYNC_CATEGORY_LABELS[key] ?? key
    },
    /** WXML 不支持数组 .join()，错误码拼接放这里 */
    joinErrors(codes: string[]): string {
      return (codes ?? []).join('、')
    },
    statusBadgeClass(status: string | null): string {
      if (status === 'success') return 'badge badge-success'
      if (status === 'partial') return 'badge badge-warning'
      if (status === 'failed') return 'badge badge-danger'
      return 'badge badge-neutral'
    },
    statusLabel(status: string | null): string {
      if (status === 'success') return '成功'
      if (status === 'partial') return '部分完成'
      if (status === 'failed') return '失败'
      return '暂无'
    },
    usagePercent(): number {
      const { status } = this.data
      if (!status || status.lastPayloadBytes == null || status.maxPayloadBytes <= 0) return 0
      return Math.min(100, Math.round((status.lastPayloadBytes / status.maxPayloadBytes) * 100))
    },
  },
})

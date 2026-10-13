/**
 * 工作台（首页 tab）。
 *
 * 一览账号与「桌面端 ↔ 移动端」同步态势：
 *   - 用户卡片（头像 / 昵称 / 账号 / 档位）
 *   - 同步状态卡（最近同步时间、设备、状态徽标、单次用量）
 *   - 最近同步记录（前 3 条，点击进「同步」页看全部）
 *   - 同步类别说明（7 类，双向）
 */

import * as authApi from '../../api/auth'
import * as syncApi from '../../api/sync'
import { getState, subscribe } from '../../store/auth'
import { ensureAuthenticated } from '../../utils/auth-guard'
import { formatBytes, formatRelativeTime, formatShortTime, maskAccount } from '../../utils/format'
import {
  ACCOUNT_SYNC_CATEGORY_LABELS,
  ACCOUNT_SYNC_CATEGORIES,
  type AccountSyncHistoryItem,
  type AccountSyncStatus,
  type AuthUserInfo,
} from '../../types'

interface HomePageData {
  user: AuthUserInfo | null
  accountMasked: string
  status: AccountSyncStatus | null
  recent: AccountSyncHistoryItem[]
  /** 同步类别清单（WXML wx:for 直接遍历 data，不走方法调用） */
  categories: readonly string[]
  loading: boolean
}

let unsubscribe: (() => void) | null = null

Page({
  data: {
    user: null,
    accountMasked: '',
    status: null,
    recent: [],
    categories: ACCOUNT_SYNC_CATEGORIES,
    loading: true,
  } as HomePageData,

  onShow() {
    if (!ensureAuthenticated()) return
    if (!unsubscribe) {
      unsubscribe = subscribe('user-updated', () => this.applyUser())
    }
    this.applyUser()
    void this.loadAll()
  },

  onUnload() {
    unsubscribe?.()
    unsubscribe = null
  },

  onPullDownRefresh() {
    void this.loadAll().finally(() => wx.stopPullDownRefresh())
  },

  applyUser() {
    const user = getState().user
    this.setData({
      user,
      accountMasked: user ? maskAccount(user.account) : '',
    })
  },

  async loadAll() {
    this.setData({ loading: true })
    try {
      const [user, status, history] = await Promise.all([
        authApi.getMe().catch(() => null),
        syncApi.getSyncStatus().catch(() => null),
        syncApi.getSyncHistory({ page: 1, pageSize: 3 }).catch(() => null),
      ])
      if (user) this.applyUser()
      this.setData({
        status,
        recent: history?.list ?? [],
      })
    } finally {
      this.setData({ loading: false })
    }
  },

  methods: {
    onGoSync() {
      wx.switchTab({ url: '/pages/sync/index' })
    },

    onGoDevices() {
      wx.switchTab({ url: '/pages/devices/index' })
    },

    onGoProfile() {
      wx.switchTab({ url: '/pages/profile/index' })
    },

    onOpenHistoryItem(e: WechatMiniprogram.CustomEvent) {
      const id = e.currentTarget.dataset.id as string
      wx.navigateTo({ url: `/pages/sync/index?highlight=${encodeURIComponent(id)}` })
    },

    // WXML 内联格式化助手
    formatBytes,
    formatRelativeTime,
    formatShortTime,
    categoryLabel(key: keyof typeof ACCOUNT_SYNC_CATEGORY_LABELS): string {
      return ACCOUNT_SYNC_CATEGORY_LABELS[key] ?? key
    },
    /** 上次同步用量占单次上限百分比（WXML 不支持 .toFixed()，这里取整） */
    usagePercent(): number {
      const { status } = this.data
      if (!status || status.lastPayloadBytes == null || status.maxPayloadBytes <= 0) return 0
      return Math.min(
        100,
        Math.max(1, Math.round((status.lastPayloadBytes / status.maxPayloadBytes) * 100)),
      )
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
    historyItemBadgeClass(status: string): string {
      if (status === 'success') return 'badge badge-success'
      if (status === 'partial') return 'badge badge-warning'
      return 'badge badge-danger'
    },
    historyItemLabel(status: string): string {
      if (status === 'success') return '成功'
      if (status === 'partial') return '部分'
      return '失败'
    },
  },
})

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
import {
  SYNC_CATEGORY_VMS,
  syncHistoryItemVM,
  syncStatusVM,
  type SyncCategoryVM,
  type SyncHistoryItemVM,
  type SyncStatusVM,
} from '../../utils/view-model'
import { isFresh, readListCache, writeListCache } from '../../utils/list-cache'
import { syncPageTheme } from '../../utils/theme'

const SYNC_CACHE_KEY = 'sync:list'

interface SyncPageData {
  status: SyncStatusVM | null
  list: SyncHistoryItemVM[]
  total: number
  page: number
  pageSize: number
  loading: boolean
  loadingMore: boolean
  noMore: boolean
  highlight: string
  /** 同步类别清单（key + 中文标签，WXML wx:for 直接遍历 data，不走方法调用） */
  categories: readonly SyncCategoryVM[]
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
    categories: SYNC_CATEGORY_VMS,
  } as SyncPageData,

  /** 视图是否已有数据（来自缓存秒开或一次成功加载） */
  viewReady: false,
  /** onHide 记录的离开时刻；> 0 表示本次 onShow 是「从别处返回」 */
  hiddenAt: 0,

  onLoad(options: Record<string, string | undefined>) {
    if (options.highlight) {
      this.setData({ highlight: options.highlight })
    }
    const cached = readListCache<{
      status: SyncStatusVM | null
      list: SyncHistoryItemVM[]
      total: number
      noMore: boolean
    }>(SYNC_CACHE_KEY)
    if (cached != null) {
      this.setData({
        status: cached.status,
        list: cached.list,
        total: cached.total,
        noMore: cached.noMore,
        loading: false,
      })
      this.viewReady = true
    }
  },

  onShow() {
    syncPageTheme(this)
    if (!ensureAuthenticated()) return
    if (!this.viewReady) {
      void this.loadFirst()
      return
    }
    if (this.hiddenAt > 0 && isFresh(SYNC_CACHE_KEY)) return
    void this.loadFirst(true)
  },

  onHide() {
    this.hiddenAt = Date.now()
  },

  onPullDownRefresh() {
    void this.loadFirst().finally(() => wx.stopPullDownRefresh())
  },

  onReachBottom() {
    void this.loadMore()
  },

  async loadFirst(silent = false) {
    if (!silent) this.setData({ loading: true, page: 1, noMore: false })
    try {
      const [status, history] = await Promise.all([
        syncApi.getSyncStatus().catch(() => null),
        syncApi.getSyncHistory({ page: 1, pageSize: PAGE_SIZE }).catch(() => null),
      ])
      // 静默后台刷新：请求失败或用户已翻页时不覆盖现有列表，保留旧数据与滚动位置
      if (silent && (history == null || this.data.page > 1)) return
      const list = history?.list ?? []
      const statusVm = syncStatusVM(status)
      const listVm = list.map(syncHistoryItemVM)
      const total = history?.total ?? 0
      const noMore = list.length < PAGE_SIZE
      this.setData({ status: statusVm, list: listVm, total, page: 1, noMore })
      this.viewReady = true
      writeListCache(SYNC_CACHE_KEY, { status: statusVm, list: listVm, total, noMore })
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
      const appended = (history?.list ?? []).map(syncHistoryItemVM)
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
})

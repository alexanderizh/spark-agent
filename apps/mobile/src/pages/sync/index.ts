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
        status: syncStatusVM(status),
        list: list.map(syncHistoryItemVM),
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

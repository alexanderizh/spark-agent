/**
 * 项目会话列表页（Cursor 工作区列表式）。
 *
 * 两种模式：
 *   projectId 存在 → 该项目的会话（标题=项目名，胶囊输入在当前项目发起新会话）
 *   projectId 缺省 → 全部会话聚合（标题「全部会话」，支持状态筛选与标题搜索）
 *
 * 列表按「置顶 / 进行中 / 今天 / 昨天 / 7 天内 / 更早」分组；
 * 条目长按弹出 重命名 / 置顶 / 删除 操作。
 */

import * as bridge from '../../api/bridge'
import { formatRelativeTime } from '../../utils/format'
import type { BridgeSessionSummary } from '../../api/bridge'

type StatusFilter = 'all' | 'running' | 'error' | 'idle'

interface SessionRow extends BridgeSessionSummary {
  statusLabel: string
  dotClass: string
  timeLabel: string
}

interface SessionGroup {
  key: string
  label: string
  rows: SessionRow[]
}

interface ProjectSessionsData {
  projectId: string
  projectName: string
  /** 全部会话聚合模式 */
  allMode: boolean
  loading: boolean
  errorText: string
  groups: SessionGroup[]
  total: number
  filter: StatusFilter
  searchText: string
  /** 进入时聚焦搜索（来自首页搜索按钮） */
  autoFocusSearch: boolean
  quickText: string
  quickSending: boolean
}

/** 今天 0 点（本地时区） */
function startOfToday(): number {
  const now = new Date()
  return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
}

/** 时间分组：置顶 / 进行中 / 今天 / 昨天 / 7 天内 / 更早 */
function groupSessions(rows: SessionRow[]): SessionGroup[] {
  const today = startOfToday()
  const buckets: Record<string, SessionRow[]> = {
    pinned: [],
    running: [],
    today: [],
    yesterday: [],
    week: [],
    older: [],
  }
  for (const row of rows) {
    if (row.pinnedAt) {
      buckets.pinned?.push(row)
      continue
    }
    if (row.status === 'running') {
      buckets.running?.push(row)
      continue
    }
    const time = new Date(row.updatedAt).getTime()
    if (Number.isNaN(time)) {
      buckets.older?.push(row)
    } else if (time >= today) {
      buckets.today?.push(row)
    } else if (time >= today - 86_400_000) {
      buckets.yesterday?.push(row)
    } else if (time >= today - 7 * 86_400_000) {
      buckets.week?.push(row)
    } else {
      buckets.older?.push(row)
    }
  }
  const labels: [string, string][] = [
    ['pinned', '置顶'],
    ['running', '进行中'],
    ['today', '今天'],
    ['yesterday', '昨天'],
    ['week', '7 天内'],
    ['older', '更早'],
  ]
  return labels
    .filter(([key]) => (buckets[key]?.length ?? 0) > 0)
    .map(([key, label]) => ({ key, label, rows: buckets[key] ?? [] }))
}

Page({
  data: {
    projectId: '',
    projectName: '',
    allMode: true,
    loading: true,
    errorText: '',
    groups: [],
    total: 0,
    filter: 'all',
    searchText: '',
    autoFocusSearch: false,
    quickText: '',
    quickSending: false,
  } as ProjectSessionsData,

  /** 全量缓存（前端过滤：状态 + 标题搜索） */
  allRows: [] as SessionRow[],

  onLoad(options: Record<string, string | undefined>) {
    const projectId = options.projectId ?? ''
    this.setData({
      projectId,
      allMode: projectId === '',
      projectName: options.projectName ? decodeURIComponent(options.projectName) : '',
      autoFocusSearch: options.search === '1',
    })
  },

  onShow() {
    void this.load()
  },

  onPullDownRefresh() {
    void this.load().finally(() => wx.stopPullDownRefresh())
  },

  async load() {
    this.setData({ loading: true })
    try {
      const result = this.data.allMode
        ? await bridge.listSessions(100)
        : await bridge.listProjectSessions(this.data.projectId, 100)
      const rows = result.sessions.map((item) => ({
        ...item,
        statusLabel: item.status === 'running' ? '进行中' : item.status === 'error' ? '异常' : '空闲',
        dotClass:
          item.status === 'running' ? 'dot-info' : item.status === 'error' ? 'dot-danger' : 'dot-neutral',
        timeLabel: formatRelativeTime(item.updatedAt),
      }))
      this.allRows = rows
      this.setData({ total: result.total, errorText: '' })
      this.applyFilters()
    } catch (error) {
      this.allRows = []
      this.setData({
        loading: false,
        groups: [],
        errorText: (error as Error).message || '加载失败',
      })
    }
  },

  /** 前端过滤（状态 + 搜索）→ 分组 → setData */
  applyFilters() {
    const { filter, searchText } = this.data
    const keyword = searchText.trim().toLowerCase()
    const rows = this.allRows.filter((row) => {
      if (filter !== 'all' && row.status !== filter) return false
      if (keyword && !row.title.toLowerCase().includes(keyword)) return false
      return true
    })
    this.setData({ groups: groupSessions(rows), loading: false })
  },

  onFilterChange(e: WechatMiniprogram.CustomEvent) {
    const filter = e.currentTarget.dataset.filter as StatusFilter
    this.setData({ filter })
    this.applyFilters()
  },

  onSearchInput(e: WechatMiniprogram.Input) {
    this.setData({ searchText: e.detail.value })
    this.applyFilters()
  },

  // ─── 会话操作 ───────────────────────────────────────────────────────────────

  onOpenSession(e: WechatMiniprogram.CustomEvent) {
    const { id, title } = e.currentTarget.dataset as { id: string; title: string }
    wx.navigateTo({
      url: `/pages/chat/index?sessionId=${encodeURIComponent(id)}&title=${encodeURIComponent(title)}`,
    })
  },

  onRowLongPress(e: WechatMiniprogram.CustomEvent) {
    const { id, title, pinned } = e.currentTarget.dataset as {
      id: string
      title: string
      pinned: boolean
    }
    const itemList = pinned ? ['重命名', '取消置顶', '删除会话'] : ['重命名', '置顶', '删除会话']
    wx.showActionSheet({
      itemList,
      itemColor: '#1a1a1a',
      success: (res) => {
        if (res.tapIndex === 0) void this.onRename(id, title)
        if (res.tapIndex === 1) void this.onTogglePin(id, !pinned)
        if (res.tapIndex === 2) void this.onDelete(id, title)
      },
      fail: () => {
        /* 取消 */
      },
    })
  },

  async onRename(sessionId: string, currentTitle: string) {
    wx.showModal({
      title: '重命名会话',
      editable: true,
      placeholderText: currentTitle,
      success: async (res) => {
        if (!res.confirm) return
        const name = (res.content ?? '').trim()
        if (!name) return
        try {
          await bridge.renameSession(sessionId, name)
          wx.showToast({ title: '已重命名', icon: 'success' })
          await this.load()
        } catch (error) {
          wx.showToast({ title: (error as Error).message || '重命名失败', icon: 'none' })
        }
      },
    })
  },

  async onTogglePin(sessionId: string, pinned: boolean) {
    try {
      await bridge.updateSession(sessionId, { pinned })
      wx.showToast({ title: pinned ? '已置顶' : '已取消置顶', icon: 'success' })
      await this.load()
    } catch (error) {
      wx.showToast({ title: (error as Error).message || '操作失败', icon: 'none' })
    }
  },

  async onDelete(sessionId: string, title: string) {
    wx.showModal({
      title: '删除会话',
      content: `「${title}」将从桌面端删除，无法恢复。`,
      confirmColor: '#dc2626',
      success: async (res) => {
        if (!res.confirm) return
        try {
          await bridge.deleteSession(sessionId)
          wx.showToast({ title: '已删除', icon: 'success' })
          await this.load()
        } catch (error) {
          wx.showToast({ title: (error as Error).message || '删除失败', icon: 'none' })
        }
      },
    })
  },

  // ─── 快速发起（底部胶囊，归属当前项目） ─────────────────────────────────────

  onQuickInput(e: WechatMiniprogram.CustomEvent<{ value: string }>) {
    this.setData({ quickText: e.detail.value })
  },

  async onQuickSend() {
    const text = this.data.quickText.trim()
    if (!text || this.data.quickSending) return
    this.setData({ quickSending: true })
    try {
      const created = await bridge.createSession(
        text.slice(0, 30),
        this.data.allMode ? undefined : this.data.projectId,
      )
      await bridge.submitTurn(created.session.id, text)
      this.setData({ quickText: '' })
      wx.navigateTo({
        url: `/pages/chat/index?sessionId=${encodeURIComponent(created.session.id)}&title=${encodeURIComponent(created.session.title)}`,
      })
    } catch (error) {
      wx.showToast({ title: (error as Error).message || '发起失败', icon: 'none' })
    } finally {
      this.setData({ quickSending: false })
    }
  },
})

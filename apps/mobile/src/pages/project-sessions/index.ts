/**
 * 项目会话列表页（Cursor 工作区列表式）。
 *
 * 本页必须同时持有上层传入的 deviceId 与 projectId；电脑切换只能返回电脑顶层后进行。
 * 'default' 是虚拟「未归属项目」，列出未归属会话，新建会话时不向桌面端传项目 id。
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
  /** 由远程会话顶层固定传入，本页不允许修改 */
  deviceId: string
  deviceName: string
  projectId: string
  projectName: string
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
  deviceOffline: boolean
  deviceUnavailable: boolean
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
    deviceId: '',
    deviceName: '',
    projectId: '',
    projectName: '',
    loading: true,
    errorText: '',
    groups: [],
    total: 0,
    filter: 'all',
    searchText: '',
    autoFocusSearch: false,
    quickText: '',
    quickSending: false,
    deviceOffline: false,
    deviceUnavailable: false,
  } as ProjectSessionsData,

  /** 全量缓存（前端过滤：状态 + 标题搜索） */
  allRows: [] as SessionRow[],
  /** 设备列表订阅取消函数 */
  unsubscribeDevices: null as (() => void) | null,

  onLoad(options: Record<string, string | undefined>) {
    const deviceId = options.deviceId ?? ''
    if (!deviceId) {
      // 旧入口没有电脑上下文时回到顶层选择，禁止使用服务端的自动选机路由。
      wx.redirectTo({ url: '/pages/home/index' })
      return
    }
    const projectId = options.projectId ?? ''
    if (!projectId) {
      // 项目页是会话列表唯一入口；旧的无项目聚合链接回到项目选择层。
      wx.redirectTo({
        url: `/pages/projects/index?deviceId=${encodeURIComponent(deviceId)}&deviceName=${encodeURIComponent(options.deviceName ?? '')}`,
      })
      return
    }
    this.setData({
      deviceId,
      deviceName: options.deviceName ? decodeURIComponent(options.deviceName) : '桌面端',
      projectId,
      projectName: options.projectName ? decodeURIComponent(options.projectName) : '',
      autoFocusSearch: options.search === '1',
    })
    // presence 增量只更新固定电脑状态；切换电脑必须先返回顶层。
    this.unsubscribeDevices = bridge.onRelayDevicesChanged(() => this.onPresenceUpdate())
  },

  onShow() {
    if (!this.data.deviceId) return
    void this.bootstrap()
  },

  onUnload() {
    this.unsubscribeDevices?.()
    this.unsubscribeDevices = null
  },

  onPullDownRefresh() {
    void this.bootstrap().finally(() => wx.stopPullDownRefresh())
  },

  /** 设备列表（REST 首拉 + 中继连接）就绪后加载会话 */
  async bootstrap() {
    void bridge.ensureRelay().catch(() => undefined)
    await this.refreshDeviceContext()
    await this.load()
  },

  async refreshDeviceContext() {
    try {
      const result = await bridge.listRelayDevices()
      const trusted = (result?.devices ?? []).find((item) => item.deviceId === this.data.deviceId)
      if (!trusted) {
        this.setData({ deviceUnavailable: true, deviceOffline: true, groups: [], loading: false })
        return
      }
      const live = bridge
        .getRelayPresenceDevices()
        .find((item) => item.deviceId === this.data.deviceId)
      const online = bridge.isRelayPresenceFresh() ? live != null : trusted.online
      this.setData({
        deviceName: live?.label || trusted.name || this.data.deviceName,
        deviceUnavailable: false,
        deviceOffline: !online,
      })
    } catch {
      // REST 暂不可用时用 presence 判断；状态未知时继续定向请求并显示具体错误。
      if (bridge.isRelayPresenceFresh()) {
        const online = bridge
          .getRelayPresenceDevices()
          .some((item) => item.deviceId === this.data.deviceId)
        this.setData({ deviceOffline: !online })
      }
    }
  },

  /** presence 增量只更新本页固定电脑；恢复在线后重新拉当前项目 */
  onPresenceUpdate() {
    if (!bridge.isRelayPresenceFresh()) return
    const wasOffline = this.data.deviceOffline
    const online = bridge
      .getRelayPresenceDevices()
      .some((item) => item.deviceId === this.data.deviceId)
    this.setData({ deviceOffline: !online })
    if (wasOffline && online) void this.load()
  },

  async load() {
    // 路由必须提供明确电脑；设备被吊销或离线时不回退到其它电脑。
    if (this.data.deviceUnavailable || this.data.deviceOffline) {
      this.setData({ loading: false, groups: [], errorText: '' })
      return
    }
    this.setData({ loading: true })
    const deviceId = this.data.deviceId
    try {
      const result = await bridge.listProjectSessions(this.data.projectId, 100, deviceId)
      const rows = result.sessions.map((item) => ({
        ...item,
        statusLabel:
          item.status === 'running' ? '进行中' : item.status === 'error' ? '异常' : '空闲',
        dotClass:
          item.status === 'running'
            ? 'dot-info'
            : item.status === 'error'
              ? 'dot-danger'
              : 'dot-neutral',
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

  /** 授信设备管理（云端中继的桌面设备列表与吊销） */
  onOpenBridgeDevices() {
    wx.navigateTo({ url: '/pages/bridge-devices/index' })
  },

  /** 返回项目列表；如通过旧链接直接进入，则恢复固定电脑上下文。 */
  onBackToProjects() {
    wx.navigateBack({
      fail: () =>
        wx.redirectTo({
          url: `/pages/projects/index?deviceId=${encodeURIComponent(this.data.deviceId)}&deviceName=${encodeURIComponent(this.data.deviceName)}`,
        }),
    })
  },

  /** 进聊天页：继承当前电脑上下文，不使用全局自动选机 */
  chatUrl(sessionId: string, title: string): string {
    return `/pages/chat/index?sessionId=${encodeURIComponent(sessionId)}&title=${encodeURIComponent(title)}&deviceId=${encodeURIComponent(this.data.deviceId)}`
  },

  onOpenSession(e: WechatMiniprogram.CustomEvent) {
    const { id, title } = e.currentTarget.dataset as { id: string; title: string }
    wx.navigateTo({ url: this.chatUrl(id, title) })
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
          await bridge.renameSession(sessionId, name, this.targetDeviceId())
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
      await bridge.updateSession(sessionId, { pinned }, this.targetDeviceId())
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
          await bridge.deleteSession(sessionId, this.targetDeviceId())
          wx.showToast({ title: '已删除', icon: 'success' })
          await this.load()
        } catch (error) {
          wx.showToast({ title: (error as Error).message || '删除失败', icon: 'none' })
        }
      },
    })
  },

  /** 当前项目固定所属的电脑；不会回退到服务端自动选机 */
  targetDeviceId(): string | undefined {
    return this.data.deviceId || undefined
  },

  // ─── 快速发起（底部胶囊，归属当前项目） ─────────────────────────────────────

  onQuickInput(e: WechatMiniprogram.CustomEvent<{ value: string }>) {
    this.setData({ quickText: e.detail.value })
  },

  async onQuickSend() {
    const text = this.data.quickText.trim()
    if (!text || this.data.quickSending || this.data.deviceUnavailable || this.data.deviceOffline)
      return
    this.setData({ quickSending: true })
    try {
      const deviceId = this.targetDeviceId()
      const created = await bridge.createSession(
        text.slice(0, 30),
        this.data.projectId === 'default' ? undefined : this.data.projectId,
        deviceId,
      )
      await bridge.submitTurn(created.session.id, text, undefined, deviceId)
      this.setData({ quickText: '' })
      wx.navigateTo({ url: this.chatUrl(created.session.id, created.session.title) })
    } catch (error) {
      wx.showToast({ title: (error as Error).message || '发起失败', icon: 'none' })
    } finally {
      this.setData({ quickSending: false })
    }
  },
})

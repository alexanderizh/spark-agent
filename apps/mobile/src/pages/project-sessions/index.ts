/**
 * 项目会话列表页（Cursor 工作区列表式）。
 *
 * 两种模式：
 *   projectId 存在 → 该项目的会话（标题=项目名，胶囊输入在当前项目发起新会话）
 *   projectId 缺省 → 全部会话聚合（标题「全部会话」，支持状态筛选与标题搜索）
 *
 * 顶部「电脑切换」条：同一账号可有多台授信桌面端，会话列表按所选电脑加载；
 * 数据源 = REST 设备列表（首拉）+ WS presence（增量），选择持久化到本地存储。
 *
 * 列表按「置顶 / 进行中 / 今天 / 昨天 / 7 天内 / 更早」分组；
 * 条目长按弹出 重命名 / 置顶 / 删除 操作。
 */

import * as bridge from '../../api/bridge'
import { formatRelativeTime } from '../../utils/format'
import type { BridgeSessionSummary, RelayDeviceInfo } from '../../api/bridge'

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

/** 电脑切换条的设备 pill（WXML 直接绑定，字段预计算） */
interface DevicePill {
  deviceId: string
  name: string
  online: boolean
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
  // ── 电脑切换 ──
  /** 授信设备 pill 列表（REST + presence 合并） */
  devices: DevicePill[]
  /** 选中的桌面端（'' = 主桌面端/自动） */
  selectedDeviceId: string
  /** 所选设备是否离线（离线可选中，但列表区显示离线提示条） */
  selectedOffline: boolean
  /** REST 设备列表是否已返回（区分「加载中」与「无授信设备」） */
  devicesLoaded: boolean
  /** 自动（主桌面端）pill 的在线圆点 */
  primaryOnline: boolean
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
    devices: [],
    selectedDeviceId: '',
    selectedOffline: false,
    devicesLoaded: false,
    primaryOnline: false,
  } as ProjectSessionsData,

  /** 全量缓存（前端过滤：状态 + 标题搜索） */
  allRows: [] as SessionRow[],
  /** REST 设备列表（离线设备也在；presence 只含在线） */
  restDevices: null as RelayDeviceInfo[] | null,
  /** 设备列表订阅取消函数 */
  unsubscribeDevices: null as (() => void) | null,

  onLoad(options: Record<string, string | undefined>) {
    const projectId = options.projectId ?? ''
    this.setData({
      projectId,
      allMode: projectId === '',
      projectName: options.projectName ? decodeURIComponent(options.projectName) : '',
      autoFocusSearch: options.search === '1',
      // 恢复上次选择的电脑（'' = 主桌面端）
      selectedDeviceId: bridge.getSelectedDeviceId(),
    })
    // presence 增量：设备上下线时刷新切换条；所选设备恢复在线后重新拉列表
    this.unsubscribeDevices = bridge.onRelayDevicesChanged(() => this.onPresenceUpdate())
  },

  onShow() {
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
    await this.refreshDevices()
    await this.load()
  },

  /** REST 拉授信设备列表；同时建立中继 WS 以接收 presence 增量 */
  async refreshDevices() {
    // 中继连接失败不阻塞（REST 已能拿到列表，只是没有实时刷新）
    void bridge.ensureRelay().catch(() => undefined)
    try {
      const result = await bridge.listRelayDevices()
      this.restDevices = result?.devices ?? []
      // 只有 REST 真正返回过，才允许进入「无授信设备」引导态（网络抖动不算）
      this.setData({ devicesLoaded: true })
    } catch {
      // REST 失败时保留上次结果（或空），由 presence 兜底在线设备
    }
    this.rebuildDeviceBar()
  },

  /** presence 增量到达：合并刷新切换条；所选设备从离线恢复在线时重新加载列表 */
  onPresenceUpdate() {
    const wasOffline = this.data.selectedOffline
    this.rebuildDeviceBar()
    if (wasOffline && !this.data.selectedOffline && this.data.selectedDeviceId !== '') {
      void this.load()
    }
  },

  /** REST 列表 + presence 快照合并出设备 pill；校验所选设备仍存在 */
  rebuildDeviceBar() {
    const presence = bridge.getRelayPresenceDevices()
    const presenceFresh = bridge.isRelayPresenceFresh()
    const presenceById = new Map(presence.map((item) => [item.deviceId, item]))
    const merged: DevicePill[] = []
    const seen = new Set<string>()
    for (const item of this.restDevices ?? []) {
      seen.add(item.deviceId)
      const live = presenceById.get(item.deviceId)
      merged.push({
        deviceId: item.deviceId,
        name: live?.label || item.name || '桌面端',
        // presence 只含在线设备：在列表里但不在 presence = 离线；
        // presence 还没到过（WS 未连上）时退回 REST 的 online 快照
        online: presenceFresh ? live != null : item.online,
      })
    }
    // presence 里有、REST 列表还没有的（刚授信的设备），补进切换条
    for (const item of presence) {
      if (seen.has(item.deviceId)) continue
      merged.push({ deviceId: item.deviceId, name: item.label || '桌面端', online: true })
    }

    let selected = this.data.selectedDeviceId
    if (selected !== '' && !merged.some((item) => item.deviceId === selected)) {
      // 所选设备被吊销/消失 → 回落到主桌面端
      selected = ''
      bridge.setSelectedDeviceId('')
    }
    const selectedPill = merged.find((item) => item.deviceId === selected)
    this.setData({
      devices: merged,
      selectedDeviceId: selected,
      selectedOffline: selectedPill != null && !selectedPill.online,
      primaryOnline: merged.some((item) => item.online),
    })
  },

  /** 选「自动」= 不定向，服务端选主桌面端（最近活跃的在线桌面端） */
  onPickPrimaryDevice() {
    if (this.data.selectedDeviceId === '') return
    bridge.setSelectedDeviceId('')
    this.setData({ selectedDeviceId: '', selectedOffline: false })
    void this.load()
  },

  onPickDevice(e: WechatMiniprogram.CustomEvent) {
    const id = String(e.currentTarget.dataset.id ?? '')
    if (!id || id === this.data.selectedDeviceId) return
    bridge.setSelectedDeviceId(id)
    const pill = this.data.devices.find((item) => item.deviceId === id)
    this.setData({ selectedDeviceId: id, selectedOffline: pill != null && !pill.online })
    void this.load()
  },

  async load() {
    // 无授信设备：列表区显示引导空态，不发起会话调用
    if (this.data.devicesLoaded && this.data.devices.length === 0) {
      this.setData({ loading: false, groups: [], errorText: '' })
      return
    }
    // 所选电脑离线：不发请求，列表区显示离线提示条
    if (this.data.selectedOffline) {
      this.setData({ loading: false, groups: [] })
      return
    }
    this.setData({ loading: true })
    const deviceId = this.data.selectedDeviceId || undefined
    try {
      const result = this.data.allMode
        ? await bridge.listSessions(100, undefined, deviceId)
        : await bridge.listProjectSessions(this.data.projectId, 100, deviceId)
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

  /** 进聊天页：路由带上所选 deviceId，聊天页据此定向调用与订阅 */
  chatUrl(sessionId: string, title: string): string {
    return `/pages/chat/index?sessionId=${encodeURIComponent(sessionId)}&title=${encodeURIComponent(title)}&deviceId=${encodeURIComponent(this.data.selectedDeviceId)}`
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

  /** 当前定向的 deviceId（'' → undefined，帧不带 d = 主桌面端） */
  targetDeviceId(): string | undefined {
    return this.data.selectedDeviceId || undefined
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
      const deviceId = this.targetDeviceId()
      const created = await bridge.createSession(
        text.slice(0, 30),
        this.data.allMode ? undefined : this.data.projectId,
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

/**
 * 项目会话列表页（Cursor 工作区列表式）。
 *
 * 本页必须同时持有上层传入的 deviceId 与 projectId；电脑切换只能返回电脑顶层后进行。
 * 'default' 是虚拟「未归属项目」，列出未归属会话，新建会话时不向桌面端传项目 id。
 *
 * 列表与桌面端同口径：置顶区（手动置顶 + 会话打标）在最前，段内套用手动序，
 * 普通区按 进行中/今天/昨天/7天内/更早 分组、组内套手动序；
 * 条目长按弹出 重命名 / 置顶 / 标记 / 上移 / 下移 / 删除 操作。
 *
 * 底部快速发起：悬浮胶囊（与会话页输入同构）+ 配置 chips（模型/权限/推理），
 * 选择只在发送建会话后 patch 到新会话；目录加载失败时 chips 隐藏（旧版桌面端兼容）。
 */

import * as bridge from '../../api/bridge'
import { formatRelativeTime } from '../../utils/format'
import {
  buildModelOptions,
  buildPermissionOptions,
  buildReasoningOptions,
  DEFAULT_MODEL_OPTION,
  DEFAULT_PERMISSION_OPTION,
  DEFAULT_REASONING_OPTION,
  type SessionConfigOption,
} from '../../utils/session-config'
import {
  describeWriteEchoMismatch,
  getSessionLabelMeta,
  getSessionPinTime,
  isSessionPinnedZone,
  mergeManualOrderWithHidden,
  moveItem,
  SESSION_LABELS,
  sortByManualOrder,
  type BridgeSessionLabelKey,
} from '../../utils/sidebar-order'
import type { BridgeCatalog, BridgeSessionSummary, BridgeSidebarOrderState } from '../../api/bridge'
import { StorageKeys, getItem, setItem } from '../../utils/storage'

type StatusFilter = 'all' | 'running' | 'error' | 'idle'

/** 标记筛选值：'' = 不筛选；与桌面端 SidebarLabelsFilter 同语义（移动端单选简化） */
type LabelFilter = '' | 'labeled' | 'unlabeled' | BridgeSessionLabelKey

type QuickPanelKind = 'model' | 'permission' | 'reasoning' | 'label'

interface SessionRow extends BridgeSessionSummary {
  statusLabel: string
  dotClass: string
  timeLabel: string
  /** 行内标记标签文案（'' = 未打标） */
  labelText: string
  /** 标签配色 class 后缀（wxss 内定义） */
  labelClass: string
}

interface SessionGroup {
  key: string
  label: string
  rows: SessionRow[]
}

/** 内容匹配条目（服务器 FTS5 搜索；与标题匹配区分的独立展示段） */
interface ContentMatchView {
  sessionId: string
  title: string
  snippet: string
  timeLabel: string
  /** 命中会话已在列表缓存时补齐状态/标记展示；否则仅标题+片段 */
  statusLabel: string
  labelText: string
  labelClass: string
}

interface QuickChipView {
  key: QuickPanelKind
  value: string
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
  /** 标记筛选（'' = 全部；chip 上回显当前值） */
  labelFilter: LabelFilter
  /** 标记筛选 chip 的展示文案 */
  labelFilterText: string
  searchText: string
  /** 内容匹配段（服务器 FTS5 搜索；搜索词为空时为空数组） */
  contentMatches: ContentMatchView[]
  /** 进入时聚焦搜索（来自首页搜索按钮） */
  autoFocusSearch: boolean
  quickText: string
  quickSending: boolean
  deviceOffline: boolean
  deviceUnavailable: boolean
  /** 新会话配置 chips（模型/权限快捷行 + 推理配置条） */
  chips: QuickChipView[]
  /** 半屏配置面板 */
  panelShow: boolean
  panelKind: QuickPanelKind | ''
  panelTitle: string
  panelMode: 'list' | 'slider'
  panelOptions: { id: string; label: string; checked?: boolean }[]
  panelLoading: boolean
  panelEmpty: string
  /** slider 模式展示用中文档位（含「电脑默认」） */
  panelSliderLabels: string[]
  panelSliderIndex: number
  quickModelId: string
  quickPermissionId: string
  quickReasoningId: string
  /** 「置顶」分组是否折叠（本地偏好，按 电脑+项目 记忆） */
  pinnedCollapsed: boolean
}

/** 今天 0 点（本地时区） */
function startOfToday(): number {
  const now = new Date()
  return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
}

/** 普通区时间分组：进行中 / 今天 / 昨天 / 7 天内 / 更早（置顶区独立在 lowest groups 之前） */
function normalBucketOf(row: SessionRow, today: number): string {
  if (row.status === 'running') return 'running'
  const time = new Date(row.updatedAt).getTime()
  if (Number.isNaN(time)) return 'older'
  if (time >= today) return 'today'
  if (time >= today - 86_400_000) return 'yesterday'
  if (time >= today - 7 * 86_400_000) return 'week'
  return 'older'
}

/**
 * 置顶区/普通区分组 + 手动序（桌面端 composeProjectGroupSessions 同口径）：
 * 置顶区（手动置顶或已打标）整体在前，段内先按有效置顶时间倒序兜底、再套 pinned 手动序；
 * 普通区按时间分组，组内先按 updatedAt 倒序兜底、再套普通手动序。
 */
function groupSessions(
  rows: SessionRow[],
  manual: BridgeSidebarOrderState,
  projectId: string,
): SessionGroup[] {
  const today = startOfToday()
  const pinnedRows = rows
    .filter((row) => isSessionPinnedZone(row))
    .sort(
      (a, b) =>
        (getSessionPinTime(b) ?? '').localeCompare(getSessionPinTime(a) ?? '') ||
        b.updatedAt.localeCompare(a.updatedAt),
    )
  const normalRows = rows
    .filter((row) => !isSessionPinnedZone(row))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  // 虚拟「未归属项目」没有可校验的排序 scope，禁用手动序（排序写回只在真实项目开放）
  const pinnedIds = projectId === 'default' ? [] : manual.pinnedSessionIdsByProject[projectId]
  const normalIds = projectId === 'default' ? [] : manual.sessionIdsByProject[projectId]
  const orderedPinned = sortByManualOrder(pinnedRows, pinnedIds, (row) => row.id)
  const orderedNormal = sortByManualOrder(normalRows, normalIds, (row) => row.id)

  const buckets: Record<string, SessionRow[]> = {
    running: [],
    today: [],
    yesterday: [],
    week: [],
    older: [],
  }
  for (const row of orderedNormal) {
    const bucket = buckets[normalBucketOf(row, today)]
    if (bucket != null) bucket.push(row)
  }
  const labels: [string, string][] = [
    ['pinned', '置顶'],
    ['running', '进行中'],
    ['today', '今天'],
    ['yesterday', '昨天'],
    ['week', '7 天内'],
    ['older', '更早'],
  ]
  const grouped = new Map<string, SessionRow[]>(
    labels.map(([key]) => [key, key === 'pinned' ? orderedPinned : (buckets[key] ?? [])]),
  )
  return labels
    .filter(([key]) => (grouped.get(key)?.length ?? 0) > 0)
    .map(([key, label]) => ({ key, label, rows: grouped.get(key) ?? [] }))
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
    labelFilter: '' as LabelFilter,
    labelFilterText: '标记',
    searchText: '',
    contentMatches: [],
    autoFocusSearch: false,
    quickText: '',
    quickSending: false,
    deviceOffline: false,
    deviceUnavailable: false,
    chips: [],
    panelShow: false,
    panelKind: '',
    panelTitle: '',
    panelMode: 'list',
    panelOptions: [],
    panelLoading: false,
    panelEmpty: '',
    panelSliderLabels: [],
    panelSliderIndex: 0,
    quickModelId: DEFAULT_MODEL_OPTION.id,
    quickPermissionId: DEFAULT_PERMISSION_OPTION.id,
    quickReasoningId: DEFAULT_REASONING_OPTION.id,
    pinnedCollapsed: false,
  } as ProjectSessionsData,

  /** 全量缓存（前端过滤：状态 + 标记 + 标题搜索） */
  allRows: [] as SessionRow[],
  /** 当前标题过滤后的行（内容匹配段排除重复命中用） */
  filteredRows: [] as SessionRow[],
  /** 内容搜索防抖定时器 */
  searchTimer: null as ReturnType<typeof setTimeout> | null,
  /** 内容搜索请求代际（丢弃过期响应） */
  searchGeneration: 0,
  /** 桌面端不支持 /v1/search（旧版本 404）时置 true，本轮会话不再请求 */
  searchUnsupported: false,
  /** 最近一次搜索的原始结果（排除已在标题匹配中出现的 id 后渲染） */
  rawContentMatches: [] as bridge.BridgeSessionSearchResult[],
  /** 桌面端侧栏手动序（旧版桌面端无该端点时为空结构，排序退化为时间兜底） */
  sidebarOrder: {
    projectIds: [],
    sessionIdsByProject: {},
    pinnedSessionIdsByProject: {},
  } as BridgeSidebarOrderState,
  /** 设备列表订阅取消函数 */
  unsubscribeDevices: null as (() => void) | null,
  /** 桌面端目录（chips 数据源；null = 未就绪/加载失败，chips 隐藏） */
  catalog: null as BridgeCatalog | null,
  modelOptions: [] as SessionConfigOption[],
  permissionOptions: [] as SessionConfigOption[],
  reasoningOptions: [] as SessionConfigOption[],
  /** 置顶分组折叠偏好缓存（`${deviceId}/${projectId}` → 是否折叠；冷启动时从本地存储恢复） */
  pinnedCollapsedMap: {} as Record<string, boolean>,

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
    // 置顶分组折叠偏好：按 电脑+项目 维度记忆，跨冷启动生效
    // 注意 wx.getStorageSync 对不存在的键返回 ""（不是 null），必须做对象形态守卫
    const storedCollapse = getItem<Record<string, boolean>>(StorageKeys.sessionListPinnedCollapsed)
    this.pinnedCollapsedMap =
      storedCollapse != null && typeof storedCollapse === 'object' ? storedCollapse : {}
    this.setData({
      pinnedCollapsed: this.pinnedCollapsedMap[pinnedCollapseKey(deviceId, projectId)] === true,
    })
    // presence 增量只更新固定电脑状态；切换电脑必须先返回顶层。
    this.unsubscribeDevices = bridge.onRelayDevicesChanged(() => this.onPresenceUpdate())
  },

  onShow() {
    if (!this.data.deviceId) return
    void this.bootstrap()
  },

  onUnload() {
    if (this.searchTimer != null) clearTimeout(this.searchTimer)
    this.searchTimer = null
    this.searchGeneration += 1
    this.unsubscribeDevices?.()
    this.unsubscribeDevices = null
  },

  onPullDownRefresh() {
    void this.bootstrap().finally(() => wx.stopPullDownRefresh())
  },

  /** 设备列表（REST 首拉 + 中继连接）就绪后加载会话 */
  async bootstrap() {
    void bridge.ensureRelay().catch(() => undefined)
    void this.ensureCatalog()
    await this.refreshDeviceContext()
    await this.load()
  },

  /** 拉桌面端目录构建新会话配置 chips；失败静默（chips 隐藏，旧版桌面端兼容） */
  async ensureCatalog() {
    try {
      const catalog = await bridge.getCatalog(this.data.deviceId || undefined)
      this.catalog = catalog
      this.modelOptions = buildModelOptions(catalog)
      this.permissionOptions = buildPermissionOptions(catalog)
      this.reasoningOptions = buildReasoningOptions(catalog)
    } catch {
      this.catalog = null
    }
    this.refreshQuickChips()
  },

  /** 新会话配置 chips：模型/权限快捷行 + 推理配置条（capsule-composer 内部拆分） */
  refreshQuickChips() {
    if (this.catalog == null) {
      this.setData({ chips: [] })
      return
    }
    const model = this.modelOptions.find((item) => item.id === this.data.quickModelId)
    const permission = this.permissionOptions.find(
      (item) => item.id === this.data.quickPermissionId,
    )
    const reasoning = this.reasoningOptions.find((item) => item.id === this.data.quickReasoningId)
    this.setData({
      chips: [
        { key: 'model', value: model?.label ?? DEFAULT_MODEL_OPTION.label },
        { key: 'permission', value: permission?.label ?? DEFAULT_PERMISSION_OPTION.label },
        { key: 'reasoning', value: reasoning?.label ?? DEFAULT_REASONING_OPTION.label },
      ],
    })
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
      const [result, sidebarOrder] = await Promise.all([
        bridge.listProjectSessions(this.data.projectId, 100, deviceId),
        // 旧版桌面端没有排序端点：静默回退到时间兜底排序
        projectIdSupportsOrder(this.data.projectId)
          ? bridge.getSidebarOrder(deviceId).catch(() => this.sidebarOrder)
          : Promise.resolve(this.sidebarOrder),
      ])
      this.sidebarOrder = sidebarOrder
      const rows = result.sessions.map((item) => {
        const labelMeta = getSessionLabelMeta(item.sessionLabel)
        return {
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
          labelText: labelMeta?.label ?? '',
          labelClass: labelMeta?.colorClass ?? '',
        }
      })
      this.allRows = rows
      this.setData({ total: result.total, errorText: '' })
      this.applyFilters()
      // 恢复在线等场景下补拉目录（离线期间 ensureCatalog 失败过）
      if (this.catalog == null) void this.ensureCatalog()
    } catch (error) {
      this.allRows = []
      this.filteredRows = []
      this.rawContentMatches = []
      this.setData({
        loading: false,
        groups: [],
        contentMatches: [],
        errorText: (error as Error).message || '加载失败',
      })
    }
  },

  /** 前端过滤（状态 + 标记 + 搜索）→ 置顶区/时间分组 → setData */
  applyFilters() {
    const { filter, searchText, labelFilter } = this.data
    const keyword = searchText.trim().toLowerCase()
    const rows = this.allRows.filter((row) => {
      if (filter !== 'all' && row.status !== filter) return false
      if (labelFilter === 'labeled' && row.sessionLabel == null) return false
      if (labelFilter === 'unlabeled' && row.sessionLabel != null) return false
      if (
        labelFilter !== '' &&
        labelFilter !== 'labeled' &&
        labelFilter !== 'unlabeled' &&
        row.sessionLabel !== labelFilter
      ) {
        return false
      }
      if (keyword && !row.title.toLowerCase().includes(keyword)) return false
      return true
    })
    this.filteredRows = rows
    this.setData({
      groups: groupSessions(rows, this.sidebarOrder, this.data.projectId),
      loading: false,
    })
    // 标题匹配集合变了，内容匹配段的排除与富化同步重算
    if (this.rawContentMatches.length > 0) this.refreshContentMatches()
  },

  onFilterChange(e: WechatMiniprogram.CustomEvent) {
    const filter = e.currentTarget.dataset.filter as StatusFilter
    this.setData({ filter })
    this.applyFilters()
  },

  onSearchInput(e: WechatMiniprogram.Input) {
    this.setData({ searchText: e.detail.value })
    this.applyFilters()
    this.scheduleContentSearch()
  },

  /** 「置顶」分组折叠/展开：仅切换本地展示与偏好，不影响列表数据 */
  onTogglePinnedGroup() {
    const collapsed = !this.data.pinnedCollapsed
    this.setData({ pinnedCollapsed: collapsed })
    this.pinnedCollapsedMap[pinnedCollapseKey(this.data.deviceId, this.data.projectId)] = collapsed
    setItem(StorageKeys.sessionListPinnedCollapsed, this.pinnedCollapsedMap)
  },

  // ─── 内容搜索（服务器标题 LIKE + FTS5；前端标题过滤保留作即时层） ─────────────

  /** 搜索词防抖 400ms 后请求服务器内容搜索 */
  scheduleContentSearch() {
    if (this.searchTimer != null) clearTimeout(this.searchTimer)
    const keyword = this.data.searchText.trim()
    if (!keyword) {
      this.searchGeneration += 1
      this.rawContentMatches = []
      this.setData({ contentMatches: [] })
      return
    }
    this.searchTimer = setTimeout(() => {
      this.searchTimer = null
      void this.runContentSearch(keyword)
    }, 400)
  },

  /** 请求服务器搜索并刷新内容匹配段；旧版桌面端 404 后本轮不再请求 */
  async runContentSearch(keyword: string) {
    if (this.searchUnsupported) return
    const generation = ++this.searchGeneration
    try {
      const result = await bridge.searchSessions(
        keyword,
        this.data.projectId || undefined,
        this.data.deviceId || undefined,
      )
      if (generation !== this.searchGeneration) return
      this.rawContentMatches = result.results ?? []
      this.refreshContentMatches()
    } catch (error) {
      if (generation !== this.searchGeneration) return
      const message = (error as Error).message || ''
      // 旧版桌面端无该端点：静默降级为仅前端标题过滤（不打扰用户）
      if (message.includes('接口不存在') || message.includes('404')) {
        this.searchUnsupported = true
        this.rawContentMatches = []
        this.setData({ contentMatches: [] })
      }
    }
  },

  /** 用最新标题匹配集合重算内容匹配段（排除重复命中的会话） */
  refreshContentMatches() {
    const titleMatchIds = new Set(this.filteredRows.map((row) => row.id))
    const matches: ContentMatchView[] = []
    for (const item of this.rawContentMatches) {
      if (titleMatchIds.has(item.sessionId)) continue
      const cached = this.allRows.find((row) => row.id === item.sessionId)
      const labelMeta = getSessionLabelMeta(cached?.sessionLabel)
      matches.push({
        sessionId: item.sessionId,
        title: item.title,
        snippet: item.snippet,
        timeLabel: formatRelativeTime(item.updatedAt),
        statusLabel: cached?.statusLabel ?? '',
        labelText: labelMeta?.label ?? '',
        labelClass: labelMeta?.colorClass ?? '',
      })
    }
    this.setData({ contentMatches: matches })
  },

  // ─── 会话操作 ───────────────────────────────────────────────────────────────

  /** 设备管理（云端中继的桌面设备列表与吊销） */
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

  /** 长按菜单：重命名 / 置顶 / 标记 / 上移 / 下移 / 删除（上移下移按分区定位） */
  onRowLongPress(e: WechatMiniprogram.CustomEvent) {
    const { id, title, pinned } = e.currentTarget.dataset as {
      id: string
      title: string
      pinned: boolean
    }
    const row = this.allRows.find((item) => item.id === id)
    if (row == null) return
    const canReorder = projectIdSupportsOrder(this.data.projectId)
    const zone = findRowZone(this.data.groups, id)
    const canMoveUp = canReorder && zone != null && zone.index > 0
    const canMoveDown = canReorder && zone != null && zone.index < zone.rows.length - 1
    // 菜单项与动作同序构建，tapIndex 直接定位，避免条件项导致的下标算术错位
    const itemList: string[] = []
    const actions: Array<() => void> = []
    itemList.push('重命名')
    actions.push(() => void this.onRename(id, title))
    itemList.push(pinned ? '取消置顶' : '置顶')
    actions.push(() => void this.onTogglePin(id, !pinned))
    itemList.push('设置标记')
    actions.push(() => this.onOpenLabelMenu(row))
    if (canMoveUp) {
      itemList.push('上移')
      actions.push(
        () =>
          void this.onMoveSession(row, zone?.rows ?? [], zone?.index ?? 0, (zone?.index ?? 0) - 1),
      )
    }
    if (canMoveDown) {
      itemList.push('下移')
      actions.push(
        () =>
          void this.onMoveSession(row, zone?.rows ?? [], zone?.index ?? 0, (zone?.index ?? 0) + 1),
      )
    }
    itemList.push('删除会话')
    actions.push(() => void this.onDelete(id, title))
    wx.showActionSheet({
      itemList,
      itemColor: '#1a1a1a',
      success: (res) => {
        actions[res.tapIndex]?.()
      },
      fail: () => {
        /* 取消 */
      },
    })
  },

  /** 标记二级菜单：5 预置标签 + 清除标记（顺序与桌面端一致） */
  onOpenLabelMenu(row: SessionRow) {
    const itemList = [...SESSION_LABELS.map((meta) => meta.label), '清除标记']
    wx.showActionSheet({
      itemList,
      itemColor: '#1a1a1a',
      success: (res) => {
        const isClear = res.tapIndex === SESSION_LABELS.length
        const meta = SESSION_LABELS[res.tapIndex]
        if (!isClear && meta == null) return
        void this.onSetLabel(row, isClear ? null : (meta?.key ?? null))
      },
      fail: () => {
        /* 取消 */
      },
    })
  },

  /** 写入会话标记；响应回显校验拦截旧版桌面端「假成功」 */
  async onSetLabel(row: SessionRow, label: BridgeSessionLabelKey | null) {
    if (row.sessionLabel === label) {
      wx.showToast({ title: label == null ? '尚未打标' : '已是该标记', icon: 'none' })
      return
    }
    try {
      const result = await bridge.updateSession(
        row.id,
        { sessionLabel: label },
        this.targetDeviceId(),
      )
      const mismatch = describeWriteEchoMismatch({ label }, result.session)
      if (mismatch != null) {
        wx.showToast({ title: mismatch, icon: 'none' })
        return
      }
      wx.showToast({ title: label == null ? '已清除标记' : '已设置标记', icon: 'success' })
      await this.load()
    } catch (error) {
      wx.showToast({ title: (error as Error).message || '操作失败', icon: 'none' })
    }
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

  /** 置顶/取消置顶；回显校验对齐标记（旧版桌面端兼容） */
  async onTogglePin(sessionId: string, pinned: boolean) {
    try {
      const result = await bridge.updateSession(sessionId, { pinned }, this.targetDeviceId())
      if ((result.session?.pinnedAt != null) !== pinned) {
        wx.showToast({ title: '置顶状态与预期不一致，请刷新后重试', icon: 'none' })
        return
      }
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

  /**
   * 分区内上移/下移：会话所在段（置顶区 → pinned-sessions scope，普通区时间组 → sessions
   * scope）内可见项换位，被筛选隐藏的会话按原邻居位置插回完整手动序后整表回写。
   * 与桌面端拖拽的合并语义一致（mergeManualOrderWithHidden）。
   */
  async onMoveSession(row: SessionRow, zoneRows: SessionRow[], fromIndex: number, toIndex: number) {
    const pinnedZone = isSessionPinnedZone(row)
    const scope = pinnedZone ? 'pinned-sessions' : 'sessions'
    const allRows = pinnedZone
      ? this.allRows
          .filter((item) => isSessionPinnedZone(item))
          .sort(
            (a, b) =>
              (getSessionPinTime(b) ?? '').localeCompare(getSessionPinTime(a) ?? '') ||
              b.updatedAt.localeCompare(a.updatedAt),
          )
      : this.allRows
          .filter((item) => !isSessionPinnedZone(item))
          .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    const manualIds = pinnedZone
      ? this.sidebarOrder.pinnedSessionIdsByProject[this.data.projectId]
      : this.sidebarOrder.sessionIdsByProject[this.data.projectId]
    const zoneFull = sortByManualOrder(allRows, manualIds, (item) => item.id)
    const visibleIds = new Set(zoneRows.map((item) => item.id))
    const movedVisible = moveItem(
      zoneRows.map((item) => item.id),
      fromIndex,
      toIndex,
    )
    const hiddenIds = new Set(
      zoneFull.filter((item) => !visibleIds.has(item.id)).map((item) => item.id),
    )
    const merged = mergeManualOrderWithHidden(
      zoneFull.map((item) => item.id),
      movedVisible,
      hiddenIds,
    )
    try {
      await bridge.updateSidebarOrder(
        { scope, projectId: this.data.projectId, itemIds: merged },
        this.targetDeviceId(),
      )
      const orderMap = pinnedZone
        ? {
            ...this.sidebarOrder,
            pinnedSessionIdsByProject: {
              ...this.sidebarOrder.pinnedSessionIdsByProject,
              [this.data.projectId]: merged,
            },
          }
        : {
            ...this.sidebarOrder,
            sessionIdsByProject: {
              ...this.sidebarOrder.sessionIdsByProject,
              [this.data.projectId]: merged,
            },
          }
      this.sidebarOrder = orderMap
      this.applyFilters()
    } catch (error) {
      wx.showToast({ title: (error as Error).message || '排序失败', icon: 'none' })
    }
  },

  /** 当前项目固定所属的电脑；不会回退到服务端自动选机 */
  targetDeviceId(): string | undefined {
    return this.data.deviceId || undefined
  },

  // ─── 快速发起（底部胶囊，归属当前项目） ─────────────────────────────────────

  onQuickInput(e: WechatMiniprogram.CustomEvent<{ value: string }>) {
    this.setData({ quickText: e.detail.value })
  },

  // ─── 新会话配置面板（模型/权限/推理/标记筛选） ────────────────────────────────

  onChipTap(e: WechatMiniprogram.CustomEvent<{ key: string }>) {
    const key = e.detail.key as QuickPanelKind
    if (key === 'model') this.openModelPanel()
    else if (key === 'permission') this.openPermissionPanel()
    else if (key === 'reasoning') this.openReasoningPanel()
  },

  openPanel(config: {
    kind: QuickPanelKind
    title: string
    mode?: 'list' | 'slider'
    options?: { id: string; label: string; checked?: boolean }[]
    sliderLabels?: string[]
    sliderIndex?: number
  }) {
    this.setData({
      panelShow: true,
      panelKind: config.kind,
      panelTitle: config.title,
      panelMode: config.mode ?? 'list',
      panelOptions: config.options ?? [],
      panelSliderLabels: config.sliderLabels ?? [],
      panelSliderIndex: config.sliderIndex ?? 0,
      panelEmpty: '',
    })
  },

  closePanel() {
    this.setData({ panelShow: false, panelKind: '' })
  },

  openModelPanel() {
    if (this.catalog == null || this.modelOptions.length <= 1) {
      wx.showToast({ title: '模型目录未就绪', icon: 'none' })
      return
    }
    this.openPanel({
      kind: 'model',
      title: '模型渠道',
      options: this.modelOptions.map((item) => ({
        id: item.id,
        label: item.label,
        checked: item.id === this.data.quickModelId,
      })),
    })
  },

  openPermissionPanel() {
    if (this.catalog == null || this.permissionOptions.length <= 1) {
      wx.showToast({ title: '权限目录未就绪', icon: 'none' })
      return
    }
    this.openPanel({
      kind: 'permission',
      title: '权限策略',
      options: this.permissionOptions.map((item) => ({
        id: item.id,
        label: item.label,
        checked: item.id === this.data.quickPermissionId,
      })),
    })
  },

  openReasoningPanel() {
    if (this.catalog == null || this.reasoningOptions.length <= 1) {
      wx.showToast({ title: '推理强度目录未就绪', icon: 'none' })
      return
    }
    const sliderIndex = Math.max(
      this.reasoningOptions.findIndex((item) => item.id === this.data.quickReasoningId),
      0,
    )
    this.openPanel({
      kind: 'reasoning',
      title: '推理强度',
      mode: 'slider',
      sliderLabels: this.reasoningOptions.map((item) => item.label),
      sliderIndex,
    })
  },

  /** 标记筛选面板（segments 里的「标记」chip 点开；单选，与桌面端多选相比的移动端简化） */
  onOpenLabelFilterPanel() {
    const current = this.data.labelFilter
    this.openPanel({
      kind: 'label',
      title: '按标记筛选',
      options: [
        { id: '', label: '全部标记', checked: current === '' },
        { id: 'labeled', label: '已标记', checked: current === 'labeled' },
        { id: 'unlabeled', label: '未标记', checked: current === 'unlabeled' },
        ...SESSION_LABELS.map((meta) => ({
          id: meta.key,
          label: meta.label,
          checked: current === meta.key,
        })),
      ],
    })
  },

  onPanelSelect(e: WechatMiniprogram.CustomEvent<{ id: string }>) {
    const kind = this.data.panelKind
    const id = e.detail.id
    if (kind === '') return
    if (kind === 'label') {
      const value = (
        id === 'labeled' || id === 'unlabeled' || id === ''
          ? id
          : (SESSION_LABELS.find((meta) => meta.key === id)?.key ?? '')
      ) as LabelFilter
      this.setData({
        labelFilter: value,
        labelFilterText: value === '' ? '标记' : describeLabelFilter(value),
      })
      this.applyFilters()
      this.closePanel()
      return
    }
    if (kind === 'model') this.setData({ quickModelId: id })
    else if (kind === 'permission') this.setData({ quickPermissionId: id })
    else return
    this.refreshQuickChips()
    this.closePanel()
  },

  onPanelSliderChange(e: WechatMiniprogram.CustomEvent<{ index: number }>) {
    const option = this.reasoningOptions[e.detail.index]
    if (option == null) return
    this.setData({ quickReasoningId: option.id })
    this.refreshQuickChips()
    this.closePanel()
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
      // 配置只在用户主动选择过时 patch；'default' 沿用电脑端默认，不改动
      const model = this.modelOptions.find((item) => item.id === this.data.quickModelId)
      const permission = this.permissionOptions.find(
        (item) => item.id === this.data.quickPermissionId,
      )
      const reasoning = this.reasoningOptions.find((item) => item.id === this.data.quickReasoningId)
      const patch: {
        providerProfileId?: string
        modelId?: string | null
        permissionMode?: string
        reasoningEffort?: string
      } = {}
      if (model?.providerProfileId) {
        patch.providerProfileId = model.providerProfileId
        patch.modelId = model.modelId ?? null
      }
      if (permission != null && permission.id !== 'default') {
        patch.permissionMode = permission.id
      }
      if (reasoning?.value) patch.reasoningEffort = reasoning.value
      if (Object.keys(patch).length > 0) {
        await bridge.updateSession(created.session.id, patch, deviceId)
      }
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

/** 虚拟「未归属项目」没有可校验的排序 scope：手动排序只在真实项目开放 */
function projectIdSupportsOrder(projectId: string): boolean {
  return projectId !== '' && projectId !== 'default'
}

/** 置顶折叠偏好的映射键：按 电脑+项目 维度隔离 */
function pinnedCollapseKey(deviceId: string, projectId: string): string {
  return `${deviceId}/${projectId}`
}

/** 在分组结果里定位会话所在段（供长按菜单的上移/下移定位） */
function findRowZone(
  groups: SessionGroup[],
  sessionId: string,
): { rows: SessionRow[]; index: number } | null {
  for (const group of groups) {
    const index = group.rows.findIndex((row) => row.id === sessionId)
    if (index >= 0) return { rows: group.rows, index }
  }
  return null
}

/** 标记筛选 chip 的展示文案 */
function describeLabelFilter(value: Exclude<LabelFilter, ''>): string {
  if (value === 'labeled') return '已标记'
  if (value === 'unlabeled') return '未标记'
  return SESSION_LABELS.find((meta) => meta.key === value)?.label ?? '标记'
}

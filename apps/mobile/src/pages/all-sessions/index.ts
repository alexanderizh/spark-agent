/**
 * 全部会话（跨项目视图）。
 *
 * 项目页只能从「某台电脑的某个项目」进入会话列表，跨项目找会话得反复返回；
 * 本页把一台电脑的全部会话拉到一起，按 时间 / 项目 / 状态 / 标记 / 置顶 组合筛选，
 * 语义对齐桌面端远程视图的结果视图（apps/desktop/.../remoteSessionFilters.ts）：
 *   - 状态 / 项目 / 标记是多选 OR，时间与「仅置顶」是单选/开关；
 *   - 维度之间是 AND；
 *   - 筛选全在前端做：一次拉最近 200 条（上限），翻页只做渲染切片，不再打接口。
 *
 * 列表分组：置顶区在最前，其余按 进行中 / 今天 / 昨天 / 7 天内 / 更早。
 * 跨项目不套桌面端的手动序——手动序是「项目内」的概念。
 */

import * as bridge from '../../api/bridge'
import type { BridgeProjectSummary, BridgeSessionSummary } from '../../api/bridge'
import type { FilterSheetSection } from '../../components/filter-sheet/index'
import {
  deviceDisplayName,
  deviceRealName,
  readDeviceAliases,
  type DeviceAliasMap,
} from '../../utils/device-aliases'
import { formatRelativeTime } from '../../utils/format'
import { isFresh, readListCache, writeListCache } from '../../utils/list-cache'
import { observeStuck, statusBarTop } from '../../utils/sticky-header'
import {
  ARCHIVED_PROJECT_FILTER_ID,
  countSessionFilterFacets,
  DEFAULT_SESSION_FILTER,
  matchSession,
  resolveSessionProject,
  SESSION_ACTIVITY_OPTIONS,
  SESSION_LABEL_FILTER_OPTIONS,
  SESSION_STATUS_OPTIONS,
  startOfToday,
  summarizeSessionFilter,
  toggleFilterValue,
  UNASSIGNED_PROJECT_ID,
  type SessionActivityKey,
  type SessionFilterState,
  type SessionLabelFilterValue,
  type SessionStatusKey,
} from '../../utils/session-filters'
import { getSessionLabelMeta, isSessionPinnedZone } from '../../utils/sidebar-order'
import { syncPageTheme } from '../../utils/theme'

/** 一次拉取的会话上限（与「结果视图」同思路：够用即可，超出提示缩小筛选） */
const SESSION_FETCH_LIMIT = 200
/** 首屏/每次加载更多的渲染条数 */
const RENDER_PAGE_SIZE = 60

interface AllSessionRow extends BridgeSessionSummary {
  /** 筛选用的项目归类：真实项目 id / 'default'（未归属）/ 归档项目哨兵值 */
  projectKey: string
  projectName: string
  /** 所属项目已不在项目列表（归档/被删），行上要能看出来 */
  projectMissing: boolean
  statusLabel: string
  dotClass: string
  timeLabel: string
  labelText: string
  labelClass: string
}

interface SessionGroupView {
  key: string
  label: string
  rows: AllSessionRow[]
}

interface AllSessionsData {
  deviceId: string
  deviceName: string
  deviceRealName: string
  loading: boolean
  errorText: string
  deviceOffline: boolean
  deviceUnavailable: boolean
  groups: SessionGroupView[]
  /** 筛选后命中的会话总数 */
  visibleCount: number
  /** 接口返回的总数（> 拉取上限时提示） */
  total: number
  /** 拉取上限（提示文案用） */
  fetchLimit: number
  /** 已渲染条数（加载更多） */
  renderedCount: number
  hasMore: boolean
  searchText: string
  filterShow: boolean
  filter: SessionFilterState
  filterSummary: string
  filterActiveCount: number
  filterSections: FilterSheetSection[]
  /** 吸顶区 top（状态栏高度 px）：导航栏滚出后搜索/筛选停在状态栏下方 */
  stickyTop: number
  /** 吸顶区是否已吸附（吸附后加投影，与下方滚过的列表分层） */
  stickyStuck: boolean
}

/** 状态展示（与项目会话页同一套 dot 口径） */
function statusMeta(status: string): { label: string; dotClass: string } {
  if (status === 'running') return { label: '进行中', dotClass: 'dot-info' }
  if (status === 'error') return { label: '异常', dotClass: 'dot-danger' }
  if (status === 'completed') return { label: '已完成', dotClass: 'dot-success' }
  if (status === 'cancelled') return { label: '已取消', dotClass: 'dot-warning' }
  return { label: '空闲', dotClass: 'dot-neutral' }
}

function normalBucketOf(row: AllSessionRow, today: number): string {
  const time = new Date(row.updatedAt).getTime()
  if (Number.isNaN(time)) return 'older'
  if (time >= today) return 'today'
  if (time >= today - 86_400_000) return 'yesterday'
  if (time >= today - 7 * 86_400_000) return 'week'
  return 'older'
}

/** 置顶区 + 时间分组（跨项目不分项目组，组内按 updatedAt 倒序） */
function groupRows(rows: AllSessionRow[], now: number): SessionGroupView[] {
  const today = startOfToday(now)
  const pinned: AllSessionRow[] = []
  const buckets: Record<string, AllSessionRow[]> = {
    running: [],
    today: [],
    yesterday: [],
    week: [],
    older: [],
  }
  for (const row of rows) {
    if (isSessionPinnedZone(row)) {
      pinned.push(row)
      continue
    }
    // 运行中单独成组（时间窗内的运行中会话才可能出现在这里）
    if (row.status === 'running') buckets.running.push(row)
    else buckets[normalBucketOf(row, today)].push(row)
  }
  const byUpdatedDesc = (a: AllSessionRow, b: AllSessionRow): number =>
    b.updatedAt.localeCompare(a.updatedAt)
  pinned.sort(byUpdatedDesc)
  const labels: [string, string][] = [
    ['pinned', '置顶'],
    ['running', '进行中'],
    ['today', '今天'],
    ['yesterday', '昨天'],
    ['week', '7 天内'],
    ['older', '更早'],
  ]
  const map = new Map<string, AllSessionRow[]>([
    ['pinned', pinned],
    ...Object.entries(buckets).map(([key, list]): [string, AllSessionRow[]] => [
      key,
      [...list].sort(byUpdatedDesc),
    ]),
  ])
  return labels
    .filter(([key]) => (map.get(key)?.length ?? 0) > 0)
    .map(([key, label]) => ({ key, label, rows: map.get(key) ?? [] }))
}

Page({
  data: {
    deviceId: '',
    deviceName: '桌面端',
    deviceRealName: '',
    loading: true,
    errorText: '',
    deviceOffline: false,
    deviceUnavailable: false,
    groups: [],
    visibleCount: 0,
    total: 0,
    fetchLimit: SESSION_FETCH_LIMIT,
    renderedCount: 0,
    hasMore: false,
    searchText: '',
    filterShow: false,
    filter: DEFAULT_SESSION_FILTER,
    filterSummary: '筛选',
    filterActiveCount: 0,
    filterSections: [],
    stickyTop: statusBarTop(),
    stickyStuck: false,
  } as AllSessionsData,

  /** 全量行（接口顺序无关，展示前统一排序） */
  allRows: [] as AllSessionRow[],
  /** 项目 id → 名称（含虚拟「未归属项目」兜底） */
  projectNames: new Map<string, string>(),
  /** 项目维度选项来源 */
  projectList: [] as BridgeProjectSummary[],
  /** 渲染切片大小 */
  pageSize: RENDER_PAGE_SIZE,
  loadGeneration: 0,
  deviceAliases: {} as DeviceAliasMap,
  rawDeviceName: '桌面端',

  viewReady: false,
  hiddenAt: 0,
  /** 吸顶哨兵观察器（判断搜索/筛选区是否已吸附） */
  stickyObserver: null as WechatMiniprogram.IntersectionObserver | null,

  onReady() {
    this.stickyObserver = observeStuck(
      this,
      '#as-sticky-sentinel',
      this.data.stickyTop,
      (stuck) => {
        if (stuck !== this.data.stickyStuck) this.setData({ stickyStuck: stuck })
      },
    )
  },

  onLoad(options: Record<string, string | undefined>) {
    const deviceId = options.deviceId ?? ''
    if (!deviceId) {
      // 「工作台」是 tabBar 页：redirectTo 不能跳 tab 页，用 reLaunch 清栈
      wx.reLaunch({ url: '/pages/home/index' })
      return
    }
    this.deviceAliases = readDeviceAliases()
    this.rawDeviceName = options.deviceName ? decodeURIComponent(options.deviceName) : '桌面端'
    this.setData({
      deviceId,
      ...this.deviceLabelPatch(deviceId),
      filterSections: this.buildFilterSections(DEFAULT_SESSION_FILTER),
    })
    this.unsubscribeDevices = bridge.onRelayDevicesChanged(() => this.onPresenceUpdate())
    const cached = readListCache<{
      rows: AllSessionRow[]
      projects: BridgeProjectSummary[]
      total: number
    }>(this.cacheKey(deviceId))
    if (cached != null) {
      this.allRows = cached.rows
      this.projectList = cached.projects
      this.projectNames = this.buildProjectNames(cached.projects)
      this.setData({ total: cached.total })
      this.applyFilters()
      this.viewReady = true
    }
  },

  unsubscribeDevices: null as (() => void) | null,

  onShow() {
    syncPageTheme(this)
    if (!this.data.deviceId) return
    this.deviceAliases = readDeviceAliases()
    this.setData(this.deviceLabelPatch(this.data.deviceId))
    if (bridge.isRelayPresenceFresh()) {
      const online = bridge
        .getRelayPresenceDevices()
        .some((item) => item.deviceId === this.data.deviceId)
      if (this.data.deviceOffline !== !online) this.setData({ deviceOffline: !online })
    }
    if (!this.viewReady) {
      void this.bootstrap()
      return
    }
    if (this.hiddenAt > 0 && isFresh(this.cacheKey(this.data.deviceId))) return
    void this.bootstrap(true)
  },

  onHide() {
    this.hiddenAt = Date.now()
  },

  onUnload() {
    this.loadGeneration += 1
    this.unsubscribeDevices?.()
    this.unsubscribeDevices = null
    this.stickyObserver?.disconnect()
    this.stickyObserver = null
  },

  onPullDownRefresh() {
    void this.bootstrap().finally(() => wx.stopPullDownRefresh())
  },

  /** 触底加载更多（纯前端切片，不再请求接口） */
  onReachBottom() {
    this.onLoadMore()
  },

  onLoadMore() {
    if (!this.data.hasMore) return
    this.pageSize += RENDER_PAGE_SIZE
    this.applyFilters()
  },

  cacheKey(deviceId: string): string {
    return 'all-sessions:' + deviceId
  },

  /** 设备展示名 patch：备注名优先，原名降级为副标题 */
  deviceLabelPatch(deviceId: string): { deviceName: string; deviceRealName: string } {
    return {
      deviceName: deviceDisplayName(deviceId, this.rawDeviceName, this.deviceAliases),
      deviceRealName: deviceRealName(deviceId, this.rawDeviceName, this.deviceAliases) ?? '',
    }
  },

  /**
   * 项目 id → 名称。
   * 不预置「未归属项目」：那条由 toRow 按 projectId 缺省单独兜底，
   * 否则会把「项目不在列表里」的会话也认成未归属。
   */
  buildProjectNames(projects: BridgeProjectSummary[]): Map<string, string> {
    return new Map(projects.map((project) => [project.id, project.name] as const))
  },

  onBackToProjects() {
    wx.navigateBack({ fail: () => wx.reLaunch({ url: '/pages/home/index' }) })
  },

  onOpenBridgeDevices() {
    wx.navigateTo({ url: '/pages/bridge-devices/index' })
  },

  onRetry() {
    void this.bootstrap()
  },

  async bootstrap(silent = false) {
    const generation = ++this.loadGeneration
    if (!silent) this.setData({ loading: true, errorText: '', deviceUnavailable: false })
    void bridge.ensureRelay().catch(() => undefined)
    try {
      // presence 新鲜且明确离线 → 立刻给离线态，不发无效请求
      if (bridge.isRelayPresenceFresh()) {
        const online = bridge
          .getRelayPresenceDevices()
          .some((item) => item.deviceId === this.data.deviceId)
        this.setData({ deviceOffline: !online })
        if (!online) {
          if (!silent) this.setData({ loading: false, errorText: '' })
          return
        }
      }
      const [trustedResult, projectResult, sessionResult] = await Promise.all([
        // 吊销校验：设备不在接入列表里就不是「加载失败」，要明确告知（失败则不判吊销）
        bridge.listRelayDevices().catch(() => null),
        bridge.listProjects(100, this.data.deviceId),
        bridge.listSessions(SESSION_FETCH_LIMIT, undefined, this.data.deviceId),
      ])
      if (generation !== this.loadGeneration) return
      if (
        trustedResult != null &&
        !(trustedResult.devices ?? []).some((item) => item.deviceId === this.data.deviceId)
      ) {
        this.allRows = []
        this.setData({
          deviceUnavailable: true,
          deviceOffline: true,
          loading: false,
          groups: [],
          visibleCount: 0,
          errorText: '',
        })
        return
      }
      this.projectList = projectResult.projects
      this.projectNames = this.buildProjectNames(projectResult.projects)
      this.allRows = (sessionResult.sessions ?? []).map((session) => this.toRow(session))
      this.setData({ total: sessionResult.total ?? this.allRows.length, errorText: '' })
      this.applyFilters()
      this.viewReady = true
      writeListCache(this.cacheKey(this.data.deviceId), {
        rows: this.allRows,
        projects: projectResult.projects,
        total: sessionResult.total ?? this.allRows.length,
      })
      // 项目列表变了（新建/改名/删除），筛选面板的项目选项随之刷新
      this.setData({ filterSections: this.buildFilterSections(this.data.filter) })
    } catch (error) {
      if (generation !== this.loadGeneration) return
      if (silent) return
      this.allRows = []
      this.setData({
        loading: false,
        groups: [],
        visibleCount: 0,
        errorText: error instanceof Error ? error.message : '会话加载失败，请下拉重试',
      })
    } finally {
      if (generation === this.loadGeneration) this.setData({ loading: false })
    }
  },

  toRow(session: BridgeSessionSummary): AllSessionRow {
    const resolved = resolveSessionProject(session.projectId, this.projectNames)
    const meta = statusMeta(session.status)
    const labelMeta = getSessionLabelMeta(session.sessionLabel)
    return {
      ...session,
      ...resolved,
      statusLabel: meta.label,
      dotClass: meta.dotClass,
      timeLabel: formatRelativeTime(session.updatedAt),
      labelText: labelMeta?.label ?? '',
      labelClass: labelMeta?.colorClass ?? '',
    }
  },

  /** 前端筛选 + 分组 + 渲染切片 */
  applyFilters() {
    const keyword = this.data.searchText.trim().toLowerCase()
    const filter = this.data.filter
    const now = Date.now()
    // 项目维度按页面归类的 projectKey 判断（归档项目合并成一个哨兵值），
    // 其余维度交给 matchSession，避免把 projectId 的兜底逻辑复制两份。
    const projectIds = filter.projectIds
    const restFilter = { ...filter, projectIds: [] as string[] }
    const matched = this.allRows.filter((row) => {
      if (keyword !== '' && !row.title.toLowerCase().includes(keyword)) return false
      if (projectIds.length > 0 && !projectIds.includes(row.projectKey)) return false
      return matchSession(row, restFilter, now)
    })
    const rendered = matched.slice(0, this.pageSize)
    this.setData({
      groups: groupRows(rendered, now),
      visibleCount: matched.length,
      renderedCount: rendered.length,
      hasMore: matched.length > rendered.length,
      loading: false,
    })
  },

  onSearchInput(e: WechatMiniprogram.Input) {
    this.setData({ searchText: e.detail.value })
    this.pageSize = RENDER_PAGE_SIZE
    this.applyFilters()
  },

  // ─── 筛选面板 ───────────────────────────────────────────────────────────────

  buildFilterSections(filter: SessionFilterState): FilterSheetSection[] {
    const projectOptions = this.projectList.map((project) => ({
      id: project.id,
      label: project.name,
      checked: filter.projectIds.includes(project.id),
      sub: `${project.sessionCount} 条会话`,
    }))
    // 未归属 / 已归档项目：只在这批会话里真的存在时才给选项，避免空选项
    const countByKey = new Map<string, number>()
    for (const row of this.allRows) {
      countByKey.set(row.projectKey, (countByKey.get(row.projectKey) ?? 0) + 1)
    }
    const extra: Array<{ id: string; label: string }> = [
      { id: UNASSIGNED_PROJECT_ID, label: '未归属项目' },
      { id: ARCHIVED_PROJECT_FILTER_ID, label: '已归档项目' },
    ]
    for (const item of extra) {
      const count = countByKey.get(item.id) ?? 0
      if (count === 0) continue
      projectOptions.push({
        id: item.id,
        label: item.label,
        checked: filter.projectIds.includes(item.id),
        sub: `${count} 条会话（本次已加载）`,
      })
    }
    return [
      {
        key: 'activity',
        label: '最近活跃',
        mode: 'single',
        options: SESSION_ACTIVITY_OPTIONS.map((option) => ({
          id: option.value,
          label: option.label,
          checked: filter.activity === option.value,
        })),
      },
      {
        key: 'status',
        label: '会话状态',
        mode: 'multi',
        options: SESSION_STATUS_OPTIONS.map((option) => ({
          id: option.value,
          label: option.label,
          checked: filter.statuses.includes(option.value),
        })),
      },
      {
        key: 'label',
        label: '会话标记',
        mode: 'multi',
        options: SESSION_LABEL_FILTER_OPTIONS.map((option) => ({
          id: option.value,
          label: option.label,
          checked: filter.labels.includes(option.value),
        })),
      },
      {
        key: 'project',
        label: '所属项目',
        mode: 'multi',
        options: projectOptions,
      },
      {
        key: 'pinned',
        label: '置顶',
        mode: 'single',
        options: [
          { id: 'all', label: '全部会话', checked: !filter.pinnedOnly },
          { id: 'only', label: '仅置顶/已标记', checked: filter.pinnedOnly },
        ],
      },
    ]
  },

  applyFilter(next: SessionFilterState) {
    this.pageSize = RENDER_PAGE_SIZE
    this.setData({
      filter: next,
      filterSummary: summarizeSessionFilter(next)[0] ?? '筛选',
      filterActiveCount: countSessionFilterFacets(next),
      filterSections: this.buildFilterSections(next),
    })
    this.applyFilters()
  },

  onOpenFilter() {
    this.setData({ filterShow: true, filterSections: this.buildFilterSections(this.data.filter) })
  },

  onCloseFilter() {
    this.setData({ filterShow: false })
  },

  onFilterToggle(e: WechatMiniprogram.CustomEvent<{ section: string; id: string }>) {
    const { section, id } = e.detail
    const current = this.data.filter
    if (section === 'activity') {
      const next = SESSION_ACTIVITY_OPTIONS.some((option) => option.value === id)
        ? (id as SessionActivityKey)
        : 'all'
      this.applyFilter({ ...current, activity: current.activity === next ? 'all' : next })
      return
    }
    if (section === 'pinned') {
      this.applyFilter({ ...current, pinnedOnly: id === 'only' && !current.pinnedOnly })
      return
    }
    if (section === 'status') {
      if (!SESSION_STATUS_OPTIONS.some((option) => option.value === id)) return
      this.applyFilter({
        ...current,
        statuses: toggleFilterValue(current.statuses, id as SessionStatusKey),
      })
      return
    }
    if (section === 'label') {
      if (!SESSION_LABEL_FILTER_OPTIONS.some((option) => option.value === id)) return
      this.applyFilter({
        ...current,
        labels: toggleFilterValue(current.labels, id as SessionLabelFilterValue),
      })
      return
    }
    if (section === 'project') {
      this.applyFilter({ ...current, projectIds: toggleFilterValue(current.projectIds, id) })
    }
  },

  onFilterReset() {
    this.applyFilter(DEFAULT_SESSION_FILTER)
  },

  onPresenceUpdate() {
    if (!bridge.isRelayPresenceFresh()) return
    const online = bridge
      .getRelayPresenceDevices()
      .some((item) => item.deviceId === this.data.deviceId)
    const wasOffline = this.data.deviceOffline
    this.setData({ deviceOffline: !online })
    if (wasOffline && online) void this.bootstrap()
  },

  onOpenSession(e: WechatMiniprogram.CustomEvent) {
    const id = String(e.currentTarget.dataset.id ?? '')
    const title = String(e.currentTarget.dataset.title ?? '')
    if (id === '') return
    wx.navigateTo({
      url: `/pages/chat/index?sessionId=${encodeURIComponent(id)}&title=${encodeURIComponent(title)}&deviceId=${encodeURIComponent(this.data.deviceId)}&deviceName=${encodeURIComponent(this.rawDeviceName)}`,
    })
  },
})

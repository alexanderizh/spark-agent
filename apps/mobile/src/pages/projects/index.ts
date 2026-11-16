/** 固定电脑下的项目列表。进入项目后才允许浏览其会话。 */

import * as bridge from '../../api/bridge'
import type { BridgeProjectSummary, RelayDeviceInfo } from '../../api/bridge'
import type { FilterSheetSection } from '../../components/filter-sheet/index'
import {
  deviceDisplayName,
  deviceRealName,
  readDeviceAliases,
  type DeviceAliasMap,
} from '../../utils/device-aliases'
import { formatRelativeTime } from '../../utils/format'
import {
  readProjectListFilter,
  writeProjectListFilter,
  type CachedProjectListFilter,
} from '../../utils/filter-cache'
import { isFresh, readListCache, writeListCache } from '../../utils/list-cache'
import {
  countProjectFilterFacets,
  DEFAULT_PROJECT_FILTER,
  describeProjectFilter,
  matchProject,
  PROJECT_ACTIVITY_OPTIONS,
  PROJECT_STATUS_OPTIONS,
  type ProjectActivityKey,
  type ProjectFilterState,
  type ProjectStatusKey,
} from '../../utils/project-filters'
import { observeStuck, statusBarTop } from '../../utils/sticky-header'
import { getThemeTextColor, syncPageTheme } from '../../utils/theme'
import {
  mergeManualOrderWithHidden,
  moveItem,
  NO_PROJECT_WORKSPACE_NAME,
  sortByManualOrderWithinPinnedSections,
} from '../../utils/sidebar-order'

interface ProjectOption extends BridgeProjectSummary {
  isVirtual: boolean
  /** 最近活跃时间（相对；时间筛选开启时便于核对） */
  updatedLabel: string
}

/** 切换电脑弹层的一行（sheet-panel 单选列表） */
interface SwitchDeviceOption {
  id: string
  label: string
  sub?: string
  checked?: boolean
}

interface ProjectsPageData {
  deviceId: string
  deviceName: string
  /** 自报名（仅当本机设了备注名且与自报名不同才非空，作为副标题） */
  deviceRealName: string
  /** 置顶段（含项目名搜索过滤前的完整数据；渲染列表由 pinnedView/normalView 承担） */
  projects: ProjectOption[]
  /** 搜索 + 筛选过滤后的置顶/普通两段视图（虚拟「未归属项目」恒在普通段末尾） */
  pinnedView: ProjectOption[]
  normalView: ProjectOption[]
  searchText: string
  pinnedCount: number
  /** 当前筛选下可见的真实项目数（面板底部展示） */
  visibleCount: number
  loading: boolean
  errorText: string
  deviceOffline: boolean
  deviceUnavailable: boolean
  /** 没有任何电脑上下文（tabBar 页直接进入且从未选过电脑）：显示引导而不是跳走 */
  deviceMissing: boolean
  /** 切换电脑弹层 */
  deviceSheetShow: boolean
  deviceOptions: SwitchDeviceOption[]
  deviceOptionsLoading: boolean
  /** 项目筛选（时间 + 状态） */
  filterShow: boolean
  filter: ProjectFilterState
  filterSummary: string
  filterActiveCount: number
  filterSections: FilterSheetSection[]
  /** 吸顶区 top（状态栏高度 px）：导航栏滚出后搜索/筛选停在状态栏下方 */
  stickyTop: number
  /** 吸顶区是否已吸附（吸附后加投影，与下方滚过的列表分层） */
  stickyStuck: boolean
}

function decodeRouteValue(value: string | undefined, fallback: string): string {
  if (!value) return fallback
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

Page({
  data: {
    deviceId: '',
    deviceName: '桌面端',
    deviceRealName: '',
    projects: [],
    pinnedView: [],
    normalView: [],
    searchText: '',
    pinnedCount: 0,
    visibleCount: 0,
    loading: true,
    errorText: '',
    deviceOffline: false,
    deviceUnavailable: false,
    deviceMissing: false,
    deviceSheetShow: false,
    deviceOptions: [],
    deviceOptionsLoading: false,
    filterShow: false,
    filter: DEFAULT_PROJECT_FILTER,
    filterSummary: describeProjectFilter(DEFAULT_PROJECT_FILTER),
    filterActiveCount: 0,
    filterSections: [],
    stickyTop: statusBarTop(),
    stickyStuck: false,
  } as ProjectsPageData,

  unsubscribeDevices: null as (() => void) | null,
  loadGeneration: 0,
  /** 桌面端侧栏手动序（projects scope；空数组 = 桌面端未排过序/旧版本） */
  manualProjectIds: [] as string[],
  /** 本机设备备注名表（进入页面与 onShow 各读一次，改名后返回即生效） */
  deviceAliases: {} as DeviceAliasMap,
  /** 目标机自报的设备名（别名只是本机视图，改备注名不影响它） */
  rawDeviceName: '桌面端',
  /** 切换弹层里的 deviceId → 自报名（弹层只回传 id，切页要还原原名） */
  switchDeviceNames: {} as Record<string, string>,

  /** 视图是否已有数据（来自缓存秒开或一次成功加载） */
  viewReady: false,
  /** onHide 记录的离开时刻；> 0 表示本次 onShow 是「从别处返回」 */
  hiddenAt: 0,
  /** 吸顶哨兵观察器（判断搜索/筛选区是否已吸附） */
  stickyObserver: null as WechatMiniprogram.IntersectionObserver | null,

  onReady() {
    this.stickyObserver = observeStuck(
      this,
      '#projects-sticky-sentinel',
      this.data.stickyTop,
      (stuck) => {
        if (stuck !== this.data.stickyStuck) this.setData({ stickyStuck: stuck })
      },
    )
  },

  onLoad(options: Record<string, string | undefined>) {
    // tabBar 页：从「工作台」tab 切过来不带 query，回落到上次选中的电脑。
    // 一个候选都没有时停在本页给引导 —— tab 页之间不能用 redirectTo 互跳。
    const deviceId = options.deviceId || bridge.getSelectedDeviceId()
    this.deviceAliases = readDeviceAliases()
    if (!deviceId) {
      this.setData({ loading: false, deviceMissing: true })
      return
    }
    this.rawDeviceName = decodeRouteValue(options.deviceName, '桌面端')
    this.restoreFilter(deviceId)
    this.setData({
      deviceId,
      deviceMissing: false,
      ...this.deviceLabelPatch(deviceId, this.rawDeviceName),
    })
    this.unsubscribeDevices = bridge.onRelayDevicesChanged(() => this.onPresenceUpdate())
    const cached = readListCache<{ projects: ProjectOption[]; manualProjectIds: string[] }>(
      'projects:' + deviceId,
    )
    if (cached != null) {
      this.manualProjectIds = cached.manualProjectIds ?? []
      this.setData({ projects: cached.projects, loading: false })
      this.applyProjectOrder()
      this.viewReady = true
    }
  },

  onShow() {
    syncPageTheme(this)
    // tab 页切换不会重新 onLoad：工作台上换了电脑后切到本 tab 要跟着换数据
    const selected = bridge.getSelectedDeviceId()
    if (!this.data.deviceId) {
      if (selected) {
        this.switchDevice(selected)
        return
      }
      if (!this.data.deviceMissing) this.setData({ loading: false, deviceMissing: true })
      return
    }
    if (selected && selected !== this.data.deviceId) {
      this.switchDevice(selected)
      return
    }
    // 备注名是本机视图：从设备管理页改完返回要立即生效
    this.deviceAliases = readDeviceAliases()
    this.setData(this.deviceLabelPatch(this.data.deviceId, this.rawDeviceName))
    // 轻量状态刷新：仅用本地 presence 快照校正在线徽标，且只在状态真变化时才 setData
    if (bridge.isRelayPresenceFresh()) {
      const online = bridge
        .getRelayPresenceDevices()
        .some((item) => item.deviceId === this.data.deviceId)
      const nextOffline = !online
      if (this.data.deviceOffline !== nextOffline) this.setData({ deviceOffline: nextOffline })
    }
    if (!this.viewReady) {
      void this.bootstrap()
      return
    }
    if (this.hiddenAt > 0 && isFresh('projects:' + this.data.deviceId)) return
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

  /**
   * 设备展示名 patch：备注名优先，原名降级为副标题。
   * 自报名以目标机/路由给出的为准（rawDeviceName），别名只改展示，不改这个值。
   */
  deviceLabelPatch(
    deviceId: string,
    realName: string,
  ): { deviceName: string; deviceRealName: string } {
    this.rawDeviceName = realName.trim() === '' ? '桌面端' : realName
    return {
      deviceName: deviceDisplayName(deviceId, this.rawDeviceName, this.deviceAliases),
      deviceRealName: deviceRealName(deviceId, this.rawDeviceName, this.deviceAliases) ?? '',
    }
  },

  onBackToComputers() {
    // 「工作台」是 tabBar 页：navigateBack 可能回到无关页面，直接切 tab 更确定
    wx.switchTab({ url: '/pages/home/index' })
  },

  onOpenBridgeDevices() {
    wx.navigateTo({ url: '/pages/bridge-devices/index' })
  },

  onRetry() {
    void this.bootstrap()
  },

  async bootstrap(silent = false) {
    const generation = ++this.loadGeneration
    // 没有电脑上下文时没有任何可拉的数据（tabBar 页直接进入的引导态）
    if (!this.data.deviceId) {
      if (!silent) this.setData({ loading: false, deviceMissing: true })
      return
    }
    if (!silent) this.setData({ loading: true, errorText: '', deviceUnavailable: false })
    void bridge.ensureRelay().catch(() => undefined)
    try {
      const trustedResult = await bridge.listRelayDevices()
      if (generation !== this.loadGeneration) return
      const trusted = (trustedResult?.devices ?? []).find(
        (item: RelayDeviceInfo) => item.deviceId === this.data.deviceId,
      )
      if (!trusted) {
        // 静默后台刷新不清空现有列表；设备不可用态交由 presence 增量/全量加载维护
        if (!silent) {
          this.clearProjectViews()
          this.setData({ deviceUnavailable: true, deviceOffline: true, loading: false })
        }
        return
      }

      const presence = bridge.getRelayPresenceDevices()
      const live = presence.find((item) => item.deviceId === this.data.deviceId)
      const online = bridge.isRelayPresenceFresh() ? live != null : trusted.online
      this.setData({
        ...this.deviceLabelPatch(
          this.data.deviceId,
          live?.label || trusted.name || this.rawDeviceName,
        ),
        deviceOffline: !online,
        deviceUnavailable: false,
      })
      if (!online) {
        if (!silent) {
          this.clearProjectViews()
          this.setData({ loading: false })
        }
        return
      }

      const [projectResult, unassignedResult, sidebarOrder] = await Promise.all([
        bridge.listProjects(100, this.data.deviceId),
        bridge.listSessions(1, 'default', this.data.deviceId),
        // 旧版桌面端没有该端点：静默回退到「置顶 + 更新时间」兜底排序
        bridge.getSidebarOrder(this.data.deviceId).catch(() => ({
          projectIds: [],
          sessionIdsByProject: {},
          pinnedSessionIdsByProject: {},
        })),
      ])
      if (generation !== this.loadGeneration) return
      this.manualProjectIds = sidebarOrder.projectIds ?? []
      const projects: ProjectOption[] = projectResult.projects.map((project) => ({
        ...project,
        isVirtual: false,
        updatedLabel: project.updatedAt ? formatRelativeTime(project.updatedAt) : '',
      }))
      if (unassignedResult.total > 0) {
        projects.push({
          id: 'default',
          name: '未归属项目',
          rootPath: '',
          projectKind: 'virtual',
          pinnedAt: null,
          updatedAt: '',
          sessionCount: unassignedResult.total,
          // 旧版桌面端不透出（undefined → 不显示徽标）
          runningSessionCount: projectResult.unassignedRunningSessionCount ?? 0,
          isVirtual: true,
          // 虚拟项目没有「最近活跃」概念：留空而不是显示「刚刚」
          updatedLabel: '',
        })
      }
      this.setData({ projects, errorText: '' })
      this.applyProjectOrder()
      this.viewReady = true
      writeListCache('projects:' + this.data.deviceId, {
        projects,
        manualProjectIds: this.manualProjectIds,
      })
    } catch (error) {
      // 静默后台刷新失败时保留旧数据
      if (generation === this.loadGeneration && !silent) {
        this.clearProjectViews()
        this.setData({
          errorText: error instanceof Error ? error.message : '项目列表加载失败，请下拉重试',
        })
      }
    } finally {
      if (generation === this.loadGeneration) this.setData({ loading: false })
    }
  },

  /**
   * 排序与过滤（前端计算，桌面端同口径）：
   * 先按筛选（时间/状态）剔一遍，再套搜索关键词，最后排序——
   * 真实项目套用手动序 + 置顶分区（sortByManualOrderWithinPinnedSections），
   * 虚拟「未归属项目」不参与排序恒在末尾；三个条件对两段都生效。
   */
  applyProjectOrder() {
    const keyword = this.data.searchText.trim().toLowerCase()
    const filter = this.data.filter
    const now = Date.now()
    const matchesKeyword = (project: ProjectOption): boolean =>
      keyword === '' || project.name.toLowerCase().includes(keyword)
    const realProjects = this.data.projects.filter((project) => !project.isVirtual)
    const ordered = sortByManualOrderWithinPinnedSections(
      realProjects,
      this.manualProjectIds,
      (project) => project.id,
      (project) => project.pinnedAt != null,
    )
    const visible = ordered.filter(
      (project) => matchProject(project, filter, now) && matchesKeyword(project),
    )
    const virtual = this.data.projects.filter((project) => project.isVirtual)
    const virtualVisible = virtual.filter(
      (project) => matchProject(project, filter, now) && matchesKeyword(project),
    )
    this.setData({
      pinnedView: visible.filter((project) => project.pinnedAt != null),
      normalView: [...visible.filter((project) => project.pinnedAt == null), ...virtualVisible],
      pinnedCount: ordered.filter((project) => project.pinnedAt != null).length,
      visibleCount: visible.length + virtualVisible.length,
    })
  },

  onSearchInput(e: WechatMiniprogram.Input) {
    this.setData({ searchText: e.detail.value })
    this.applyProjectOrder()
  },

  // ─── 项目筛选（时间 + 状态；与搜索、置顶/手动序叠加生效） ────────────────────

  /** 筛选面板的分组数据（勾选态由当前 filter 计算，面板本身无状态） */
  buildFilterSections(filter: ProjectFilterState): FilterSheetSection[] {
    return [
      {
        key: 'activity',
        label: '最近活跃',
        mode: 'single',
        options: PROJECT_ACTIVITY_OPTIONS.map((option) => ({
          id: option.value,
          label: option.label,
          checked: filter.activity === option.value,
        })),
      },
      {
        key: 'status',
        label: '项目状态',
        mode: 'single',
        options: PROJECT_STATUS_OPTIONS.map((option) => ({
          id: option.value,
          label: option.label,
          checked: filter.status === option.value,
        })),
      },
    ]
  },

  applyFilter(next: ProjectFilterState) {
    this.setData({
      filter: next,
      filterSummary: describeProjectFilter(next),
      filterActiveCount: countProjectFilterFacets(next),
      filterSections: this.buildFilterSections(next),
    })
    // 按电脑维度记住筛选，下次进页面（含冷启动）直接沿用
    writeProjectListFilter(this.data.deviceId, { activity: next.activity, status: next.status })
    this.applyProjectOrder()
  },

  /** 从本地缓存恢复筛选并同步 chip 文案/角标（无缓存时即默认值） */
  restoreFilter(deviceId: string) {
    const cached: CachedProjectListFilter = readProjectListFilter(deviceId)
    const filter: ProjectFilterState = { activity: cached.activity, status: cached.status }
    this.setData({
      filter,
      filterSummary: describeProjectFilter(filter),
      filterActiveCount: countProjectFilterFacets(filter),
    })
  },

  onOpenFilter() {
    this.setData({ filterShow: true, filterSections: this.buildFilterSections(this.data.filter) })
  },

  onCloseFilter() {
    this.setData({ filterShow: false })
  },

  /** 单选维度：点已选项 = 取消该维度（回到「不限/全部」） */
  onFilterToggle(e: WechatMiniprogram.CustomEvent<{ section: string; id: string }>) {
    const section = e.detail.section
    const id = e.detail.id
    const current = this.data.filter
    if (section === 'activity') {
      const next = PROJECT_ACTIVITY_OPTIONS.some((option) => option.value === id)
        ? (id as ProjectActivityKey)
        : 'all'
      this.applyFilter({ ...current, activity: current.activity === next ? 'all' : next })
      return
    }
    if (section === 'status') {
      const next = PROJECT_STATUS_OPTIONS.some((option) => option.value === id)
        ? (id as ProjectStatusKey)
        : 'all'
      this.applyFilter({ ...current, status: current.status === next ? 'all' : next })
    }
  },

  onFilterReset() {
    this.applyFilter(DEFAULT_PROJECT_FILTER)
  },

  // ─── 切换电脑（就地切换，不返回顶层） ─────────────────────────────────────

  /** 切换弹层：REST 列表（含离线）+ presence 在线态，展示名走本机备注名 */
  async onOpenDeviceSwitch() {
    this.setData({ deviceSheetShow: true, deviceOptionsLoading: true })
    // 备注名可能刚在设备管理页改过
    this.deviceAliases = readDeviceAliases()
    void bridge.ensureRelay().catch(() => undefined)
    try {
      const result = await bridge.listRelayDevices()
      const trusted = result?.devices ?? []
      const presence = bridge.getRelayPresenceDevices()
      const presenceFresh = bridge.isRelayPresenceFresh()
      const liveById = new Map(presence.map((item) => [item.deviceId, item]))
      const seen = new Set<string>()
      const names: Record<string, string> = {}
      const rows: SwitchDeviceOption[] = []
      const pushRow = (
        deviceId: string,
        realName: string,
        online: boolean,
        version?: string | null,
      ) => {
        seen.add(deviceId)
        names[deviceId] = realName
        const real = deviceRealName(deviceId, realName, this.deviceAliases)
        rows.push({
          id: deviceId,
          label: `${deviceDisplayName(deviceId, realName, this.deviceAliases)} · ${online ? '在线' : '离线'}`,
          ...(real != null ? { sub: real } : version ? { sub: `v${version}` } : {}),
          checked: deviceId === this.data.deviceId,
        })
      }
      for (const item of trusted) {
        const live = liveById.get(item.deviceId)
        pushRow(
          item.deviceId,
          live?.label || item.name || '桌面端',
          presenceFresh ? live != null : item.online,
          item.version,
        )
      }
      // presence 里有、REST 还没返回的（刚注册接入的设备）
      for (const live of presence) {
        if (seen.has(live.deviceId)) continue
        pushRow(live.deviceId, live.label || '桌面端', true, live.version)
      }
      this.switchDeviceNames = names
      this.setData({ deviceOptions: rows })
    } catch (error) {
      wx.showToast({ title: (error as Error).message || '电脑列表加载失败', icon: 'none' })
    } finally {
      this.setData({ deviceOptionsLoading: false })
    }
  },

  onCloseDeviceSheet() {
    this.setData({ deviceSheetShow: false })
  },

  onDeviceSelect(e: WechatMiniprogram.CustomEvent<{ id: string }>) {
    const deviceId = String(e.detail.id ?? '')
    this.setData({ deviceSheetShow: false })
    if (deviceId === '' || deviceId === this.data.deviceId) return
    this.switchDevice(deviceId)
  },

  /**
   * 就地切换电脑：清掉上一台的项目/筛选/手动序（不同电脑数据完全不同），
   * 保留搜索词以外的偏好为默认值，然后整页重新加载。
   */
  switchDevice(deviceId: string) {
    const realName = this.switchDeviceNames[deviceId] ?? '桌面端'
    const presence = bridge.getRelayPresenceDevices()
    const online = bridge.isRelayPresenceFresh()
      ? presence.some((item) => item.deviceId === deviceId)
      : true
    bridge.setSelectedDeviceId(deviceId)
    this.loadGeneration += 1
    this.manualProjectIds = []
    this.viewReady = false
    this.hiddenAt = 0
    this.setData({
      deviceId,
      deviceMissing: false,
      ...this.deviceLabelPatch(deviceId, realName),
      projects: [],
      pinnedView: [],
      normalView: [],
      searchText: '',
      pinnedCount: 0,
      visibleCount: 0,
      filter: DEFAULT_PROJECT_FILTER,
      filterSummary: describeProjectFilter(DEFAULT_PROJECT_FILTER),
      filterActiveCount: 0,
      filterSections: [],
      filterShow: false,
      errorText: '',
      deviceUnavailable: false,
      deviceOffline: !online,
      loading: true,
    })
    // 不同电脑的筛选是独立的：先清空，再恢复目标电脑上次的筛选
    this.restoreFilter(deviceId)
    void this.bootstrap()
  },

  /** 全部会话：跨项目视图（筛选维度含项目） */
  onOpenAllSessions() {
    if (this.data.deviceOffline || this.data.deviceUnavailable) {
      wx.showToast({ title: '这台电脑不在线，连上中继后可查看全部会话', icon: 'none' })
      return
    }
    wx.navigateTo({
      url: `/pages/all-sessions/index?deviceId=${encodeURIComponent(this.data.deviceId)}&deviceName=${encodeURIComponent(this.rawDeviceName)}`,
    })
  },

  onPresenceUpdate() {
    if (!bridge.isRelayPresenceFresh()) return
    const online = bridge
      .getRelayPresenceDevices()
      .some((item) => item.deviceId === this.data.deviceId)
    const wasOffline = this.data.deviceOffline
    this.setData({ deviceOffline: !online })
    // projects 只是数据源，渲染走 pinnedView/normalView —— 只清数据源会残留旧行
    if (!online) this.clearProjectViews()
    if (wasOffline && online) void this.bootstrap()
  },

  /** 离线/吊销时清空列表视图（三个字段一起清，避免渲染残留） */
  clearProjectViews() {
    this.setData({ projects: [], pinnedView: [], normalView: [], visibleCount: 0 })
  },

  onOpenProject(event: WechatMiniprogram.CustomEvent) {
    if (this.data.deviceOffline || this.data.deviceUnavailable) return
    const id = String(event.currentTarget.dataset.id ?? '')
    const name = String(event.currentTarget.dataset.name ?? '')
    if (!id) return
    wx.navigateTo({
      url: `/pages/project-sessions/index?deviceId=${encodeURIComponent(this.data.deviceId)}&deviceName=${encodeURIComponent(this.rawDeviceName)}&projectId=${encodeURIComponent(id)}&projectName=${encodeURIComponent(name)}`,
    })
  },

  /**
   * 项目行「＋」：进该项目的会话页并直接聚焦底部发起区（create=1）。
   * 与点整行进项目的唯一区别是「进去就能打字」，不跳过任何校验。
   */
  onCreateSessionInProject(event: WechatMiniprogram.CustomEvent) {
    if (this.data.deviceOffline || this.data.deviceUnavailable) {
      wx.showToast({ title: '这台电脑不在线，连上中继后可新建会话', icon: 'none' })
      return
    }
    const id = String(event.currentTarget.dataset.id ?? '')
    const name = String(event.currentTarget.dataset.name ?? '')
    if (!id) return
    wx.navigateTo({
      url: `/pages/project-sessions/index?deviceId=${encodeURIComponent(this.data.deviceId)}&deviceName=${encodeURIComponent(this.rawDeviceName)}&projectId=${encodeURIComponent(id)}&projectName=${encodeURIComponent(name)}&create=1`,
    })
  },

  // ─── 项目操作（长按菜单：置顶 / 重命名 / 上移 / 下移 / 归档 / 删除） ──────────

  onProjectLongPress(event: WechatMiniprogram.CustomEvent) {
    if (this.data.deviceOffline || this.data.deviceUnavailable) return
    const id = String(event.currentTarget.dataset.id ?? '')
    const project = this.data.projects.find((item) => item.id === id)
    if (project == null || project.isVirtual) return
    const section = project.pinnedAt != null ? this.data.pinnedView : this.data.normalView
    const indexInSection = section.findIndex((item) => item.id === id)
    const canMoveUp = indexInSection > 0
    const canMoveDown = indexInSection >= 0 && indexInSection < section.length - 1
    // 保留项目只开放置顶/调序：改名/归档/删除会破坏桌面端按名称查找的不变量
    const reserved = project.name === NO_PROJECT_WORKSPACE_NAME
    // action 数组映射：菜单项与处理器一一对应，避免 tapIndex 算术在条件项下错位
    const actions: Array<{ label: string; run: () => void }> = [
      {
        label: project.pinnedAt != null ? '取消置顶' : '置顶',
        run: () => void this.onToggleProjectPin(project),
      },
      ...(reserved ? [] : [{ label: '重命名', run: () => void this.onRenameProject(project) }]),
      ...(canMoveUp
        ? [
            {
              label: '上移',
              run: () =>
                void this.onMoveProject(project, section, indexInSection, indexInSection - 1),
            },
          ]
        : []),
      ...(canMoveDown
        ? [
            {
              label: '下移',
              run: () =>
                void this.onMoveProject(project, section, indexInSection, indexInSection + 1),
            },
          ]
        : []),
      ...(reserved ? [] : [{ label: '归档', run: () => void this.onArchiveProject(project) }]),
      ...(reserved ? [] : [{ label: '删除', run: () => void this.onDeleteProject(project) }]),
    ]
    wx.showActionSheet({
      itemList: actions.map((action) => action.label),
      itemColor: getThemeTextColor(),
      success: (res) => actions[res.tapIndex]?.run(),
      fail: () => {
        /* 取消 */
      },
    })
  },

  /** 项目置顶/取消置顶；响应回显校验拦截旧版桌面端的「假成功」 */
  async onToggleProjectPin(project: ProjectOption) {
    const pinned = project.pinnedAt == null
    try {
      const result = await bridge.updateProject(project.id, { pinned }, this.data.deviceId)
      const actualPinned = result.project?.pinnedAt != null
      if (actualPinned !== pinned) {
        wx.showToast({ title: '这台电脑的桌面端版本过低，请升级后再置顶项目', icon: 'none' })
        return
      }
      wx.showToast({ title: pinned ? '已置顶' : '已取消置顶', icon: 'success' })
      await this.bootstrap()
    } catch (error) {
      wx.showToast({ title: (error as Error).message || '操作失败', icon: 'none' })
    }
  },

  /** 项目重命名（showModal editable；响应回显 name 拦截旧版「假成功」） */
  onRenameProject(project: ProjectOption) {
    wx.showModal({
      title: '重命名项目',
      editable: true,
      placeholderText: project.name,
      success: (res) => {
        if (!res.confirm) return
        const name = (res.content ?? '').trim()
        if (!name || name === project.name) return
        // 保留名前置拦截：桌面端会 400，这里省一次往返并给出同文案
        if (name === NO_PROJECT_WORKSPACE_NAME) {
          wx.showToast({ title: '「不使用项目」是系统保留名称，不能作为项目名', icon: 'none' })
          return
        }
        void (async () => {
          try {
            const result = await bridge.updateProject(project.id, { name }, this.data.deviceId)
            if (result.project?.name !== name) {
              wx.showToast({
                title: '这台电脑的桌面端版本过低，请升级后再重命名项目',
                icon: 'none',
              })
              return
            }
            wx.showToast({ title: '已重命名', icon: 'success' })
            await this.bootstrap()
          } catch (error) {
            // 旧版桌面端不认识 name 字段（patch 收敛为空回 400），归到版本过低提示
            const message = (error as Error).message || ''
            wx.showToast({
              title: message.includes('缺少需要修改的字段')
                ? '这台电脑的桌面端版本过低，请升级后再重命名项目'
                : message || '重命名失败',
              icon: 'none',
            })
          }
        })()
      },
      fail: () => {
        /* 取消 */
      },
    })
  },

  /** 项目归档（从列表消失、会话保留；恢复走桌面端 设置 → 已归档项目） */
  async onArchiveProject(project: ProjectOption) {
    const confirmed = await new Promise<boolean>((resolve) => {
      wx.showModal({
        title: '归档项目',
        content: `「${project.name}」将从列表消失（项目与会话都保留），可在桌面端设置页恢复。`,
        confirmText: '归档',
        confirmColor: '#c2410c',
        success: (res) => resolve(res.confirm),
        fail: () => resolve(false),
      })
    })
    if (!confirmed) return
    try {
      const result = await bridge.updateProject(project.id, { archived: true }, this.data.deviceId)
      if (result.project?.archivedAt == null) {
        wx.showToast({ title: '这台电脑的桌面端版本过低，请升级后再归档项目', icon: 'none' })
        return
      }
      wx.showToast({ title: '已归档', icon: 'success' })
      await this.bootstrap()
    } catch (error) {
      // 旧版桌面端不认识 archived 字段（patch 收敛为空回 400），归到版本过低提示
      const message = (error as Error).message || ''
      wx.showToast({
        title: message.includes('缺少需要修改的字段')
          ? '这台电脑的桌面端版本过低，请升级后再归档项目'
          : message || '归档失败',
        icon: 'none',
      })
    }
  },

  /**
   * 项目删除（危险操作）：桌面端会级联删除项目下全部会话，二次确认文案必须
   * 带上会话数。旧版桌面端无 DELETE 路由（404），按版本过低提示。
   */
  async onDeleteProject(project: ProjectOption) {
    const sessionCount = project.sessionCount
    const summary = sessionCount > 0 ? `项目下 ${sessionCount} 条会话将一并删除` : '项目将被删除'
    const confirmed = await new Promise<boolean>((resolve) => {
      wx.showModal({
        title: '删除项目',
        content: `「${project.name}」：${summary}，不可恢复。确定删除？`,
        confirmText: '删除',
        confirmColor: '#dc2626',
        success: (res) => resolve(res.confirm),
        fail: () => resolve(false),
      })
    })
    if (!confirmed) return
    try {
      await bridge.deleteProject(project.id, this.data.deviceId)
      wx.showToast({ title: '已删除', icon: 'success' })
      await this.bootstrap()
    } catch (error) {
      const message = (error as Error).message || ''
      wx.showToast({
        title: message.includes('接口不存在')
          ? '这台电脑的桌面端版本过低，请升级后再删除项目'
          : message || '删除失败',
        icon: 'none',
      })
    }
  },

  /**
   * 段内移动（上移/下移）：只在当前搜索可见项里换位，被过滤隐藏的项目按原邻居
   * 位置插回完整手动序（mergeManualOrderWithHidden，与桌面端拖拽同语义），
   * 然后整表回写 projects scope。
   */
  async onMoveProject(
    _project: ProjectOption,
    section: ProjectOption[],
    fromIndex: number,
    toIndex: number,
  ) {
    const isPinnedSection = section === this.data.pinnedView
    const allReal = sortByManualOrderWithinPinnedSections(
      this.data.projects.filter((item) => !item.isVirtual),
      this.manualProjectIds,
      (item) => item.id,
      (item) => item.pinnedAt != null,
    )
    const fullSection = allReal.filter((item) =>
      isPinnedSection ? item.pinnedAt != null : item.pinnedAt == null,
    )
    const keyword = this.data.searchText.trim().toLowerCase()
    const visibleIds = fullSection
      .filter((item) => !keyword || item.name.toLowerCase().includes(keyword))
      .map((item) => item.id)
    const movedVisible = moveItem(visibleIds, fromIndex, toIndex)
    const hiddenIds = new Set(
      fullSection
        .filter((item) => keyword && !item.name.toLowerCase().includes(keyword))
        .map((item) => item.id),
    )
    const mergedSection = mergeManualOrderWithHidden(
      fullSection.map((item) => item.id),
      movedVisible,
      hiddenIds,
    )
    // 重组全局手动序：另一段保持现状，仅替换被移动的段
    const otherSectionIds = allReal
      .filter((item) => (isPinnedSection ? item.pinnedAt == null : item.pinnedAt != null))
      .map((item) => item.id)
    const nextOrder = isPinnedSection
      ? [...mergedSection, ...otherSectionIds]
      : [...otherSectionIds, ...mergedSection]
    try {
      await bridge.updateSidebarOrder({ scope: 'projects', itemIds: nextOrder }, this.data.deviceId)
      this.manualProjectIds = nextOrder
      this.applyProjectOrder()
    } catch (error) {
      wx.showToast({ title: (error as Error).message || '排序失败', icon: 'none' })
    }
  },
})

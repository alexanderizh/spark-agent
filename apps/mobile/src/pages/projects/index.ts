/** 固定电脑下的项目列表。进入项目后才允许浏览其会话。 */

import * as bridge from '../../api/bridge'
import type { BridgeProjectSummary, RelayDeviceInfo } from '../../api/bridge'
import {
  mergeManualOrderWithHidden,
  moveItem,
  NO_PROJECT_WORKSPACE_NAME,
  sortByManualOrderWithinPinnedSections,
} from '../../utils/sidebar-order'

interface ProjectOption extends BridgeProjectSummary {
  isVirtual: boolean
}

interface ProjectsPageData {
  deviceId: string
  deviceName: string
  /** 置顶段（含项目名搜索过滤前的完整数据；渲染列表由 pinnedView/normalView 承担） */
  projects: ProjectOption[]
  /** 搜索过滤后的置顶/普通两段视图（虚拟「未归属项目」恒在普通段末尾） */
  pinnedView: ProjectOption[]
  normalView: ProjectOption[]
  searchText: string
  pinnedCount: number
  loading: boolean
  errorText: string
  deviceOffline: boolean
  deviceUnavailable: boolean
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
    projects: [],
    pinnedView: [],
    normalView: [],
    searchText: '',
    pinnedCount: 0,
    loading: true,
    errorText: '',
    deviceOffline: false,
    deviceUnavailable: false,
  } as ProjectsPageData,

  unsubscribeDevices: null as (() => void) | null,
  loadGeneration: 0,
  /** 桌面端侧栏手动序（projects scope；空数组 = 桌面端未排过序/旧版本） */
  manualProjectIds: [] as string[],

  onLoad(options: Record<string, string | undefined>) {
    const deviceId = options.deviceId ?? ''
    if (!deviceId) {
      wx.redirectTo({ url: '/pages/home/index' })
      return
    }
    this.setData({
      deviceId,
      deviceName: decodeRouteValue(options.deviceName, '桌面端'),
    })
    this.unsubscribeDevices = bridge.onRelayDevicesChanged(() => this.onPresenceUpdate())
  },

  onShow() {
    if (this.data.deviceId) void this.bootstrap()
  },

  onUnload() {
    this.loadGeneration += 1
    this.unsubscribeDevices?.()
    this.unsubscribeDevices = null
  },

  onPullDownRefresh() {
    void this.bootstrap().finally(() => wx.stopPullDownRefresh())
  },

  onBackToComputers() {
    wx.navigateBack({ fail: () => wx.reLaunch({ url: '/pages/home/index' }) })
  },

  onOpenBridgeDevices() {
    wx.navigateTo({ url: '/pages/bridge-devices/index' })
  },

  onRetry() {
    void this.bootstrap()
  },

  async bootstrap() {
    const generation = ++this.loadGeneration
    this.setData({ loading: true, errorText: '', deviceUnavailable: false })
    void bridge.ensureRelay().catch(() => undefined)
    try {
      const trustedResult = await bridge.listRelayDevices()
      if (generation !== this.loadGeneration) return
      const trusted = (trustedResult?.devices ?? []).find(
        (item: RelayDeviceInfo) => item.deviceId === this.data.deviceId,
      )
      if (!trusted) {
        this.setData({
          deviceUnavailable: true,
          deviceOffline: true,
          projects: [],
          loading: false,
        })
        return
      }

      const presence = bridge.getRelayPresenceDevices()
      const live = presence.find((item) => item.deviceId === this.data.deviceId)
      const online = bridge.isRelayPresenceFresh() ? live != null : trusted.online
      this.setData({
        deviceName: live?.label || trusted.name || this.data.deviceName,
        deviceOffline: !online,
        deviceUnavailable: false,
      })
      if (!online) {
        this.setData({ projects: [], loading: false })
        return
      }

      const [projectResult, unassignedResult, sidebarOrder] = await Promise.all([
        bridge.listProjects(100, this.data.deviceId),
        bridge.listSessions(1, 'default', this.data.deviceId),
        // 旧版桌面端没有该端点：静默回退到「置顶 + 更新时间」兜底排序
        bridge
          .getSidebarOrder(this.data.deviceId)
          .catch(() => ({
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
          isVirtual: true,
        })
      }
      this.setData({ projects, errorText: '' })
      this.applyProjectOrder()
    } catch (error) {
      if (generation === this.loadGeneration) {
        this.setData({
          projects: [],
          errorText: error instanceof Error ? error.message : '项目列表加载失败，请下拉重试',
        })
      }
    } finally {
      if (generation === this.loadGeneration) this.setData({ loading: false })
    }
  },

  /**
   * 排序与过滤（前端计算，桌面端同口径）：
   * 真实项目套用手动序 + 置顶分区（sortByManualOrderWithinPinnedSections），
   * 虚拟「未归属项目」不参与排序恒在末尾；搜索按项目名过滤（两段都生效）。
   */
  applyProjectOrder() {
    const keyword = this.data.searchText.trim().toLowerCase()
    const realProjects = this.data.projects.filter((project) => !project.isVirtual)
    const ordered = sortByManualOrderWithinPinnedSections(
      realProjects,
      this.manualProjectIds,
      (project) => project.id,
      (project) => project.pinnedAt != null,
    )
    const visible = keyword
      ? ordered.filter((project) => project.name.toLowerCase().includes(keyword))
      : ordered
    const virtual = this.data.projects.filter((project) => project.isVirtual)
    const virtualVisible = keyword
      ? virtual.filter((project) => project.name.toLowerCase().includes(keyword))
      : virtual
    this.setData({
      pinnedView: visible.filter((project) => project.pinnedAt != null),
      normalView: [...visible.filter((project) => project.pinnedAt == null), ...virtualVisible],
      pinnedCount: ordered.filter((project) => project.pinnedAt != null).length,
    })
  },

  onSearchInput(e: WechatMiniprogram.Input) {
    this.setData({ searchText: e.detail.value })
    this.applyProjectOrder()
  },

  onPresenceUpdate() {
    if (!bridge.isRelayPresenceFresh()) return
    const online = bridge
      .getRelayPresenceDevices()
      .some((item) => item.deviceId === this.data.deviceId)
    const wasOffline = this.data.deviceOffline
    this.setData({ deviceOffline: !online })
    if (!online) this.setData({ projects: [] })
    if (wasOffline && online) void this.bootstrap()
  },

  onOpenProject(event: WechatMiniprogram.CustomEvent) {
    if (this.data.deviceOffline || this.data.deviceUnavailable) return
    const id = String(event.currentTarget.dataset.id ?? '')
    const name = String(event.currentTarget.dataset.name ?? '')
    if (!id) return
    wx.navigateTo({
      url: `/pages/project-sessions/index?deviceId=${encodeURIComponent(this.data.deviceId)}&deviceName=${encodeURIComponent(this.data.deviceName)}&projectId=${encodeURIComponent(id)}&projectName=${encodeURIComponent(name)}`,
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
      itemColor: '#1a1a1a',
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

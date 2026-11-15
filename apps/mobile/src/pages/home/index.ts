/** 远程会话电脑顶层：选中电脑后进入它自己的项目列表。 */

import * as bridge from '../../api/bridge'
import { getState as getAuthState } from '../../store/auth'
import {
  DEVICE_ALIAS_MAX_LENGTH,
  deviceDisplayName,
  deviceRealName,
  getDeviceAlias,
  readDeviceAliases,
  writeDeviceAlias,
  type DeviceAliasMap,
} from '../../utils/device-aliases'
import { getItem, StorageKeys } from '../../utils/storage'
import { logMobileError } from '../../utils/logger'
import {
  buildModelOptions,
  buildPermissionOptions,
  buildReasoningOptions,
  DEFAULT_MODEL_OPTION,
  PENDING_PERMISSION_OPTION,
  PENDING_REASONING_OPTION,
  defaultPermissionId,
  defaultReasoningId,
  type SessionConfigOption,
} from '../../utils/session-config'
import type { BridgeProjectSummary, RelayDeviceInfo } from '../../api/bridge'
import { isFresh, readListCache, writeListCache } from '../../utils/list-cache'
import {
  parseComposerModelRef,
  readComposerModelCache,
  rememberLastComposerModel,
  resolveCachedModelId,
  sortComposerModelOptions,
  toggleComposerModelPin,
} from '../../utils/composer-model-cache'
import { getThemeTextColor, syncPageTheme } from '../../utils/theme'

const HOME_LIST_CACHE_KEY = 'home:devices'

interface ComputerOption {
  deviceId: string
  /** 展示名（本机备注名优先） */
  name: string
  /** 自报名；只在设了备注名时出现，作为副标题 */
  realName?: string
  pickerLabel: string
  online: boolean
  lastSeenAt?: string
}

interface HomeData {
  statusBarHeight: number
  navClearance: number
  avatarUrl: string
  accountLabel: string
  devices: ComputerOption[]
  selectedDeviceId: string
  devicesLoaded: boolean
  devicesLoading: boolean
  devicesError: string
  composerDeviceId: string
  composerDeviceIndex: number
  composerDeviceLabel: string
  projectOptions: SessionConfigOption[]
  projectIndex: number
  modelOptions: SessionConfigOption[]
  modelIndex: number
  permissionOptions: SessionConfigOption[]
  permissionIndex: number
  reasoningOptions: SessionConfigOption[]
  reasoningIndex: number
  configSummary: string
  configOpen: boolean
  /** 配置项的底部选择列表（替代原生 picker，跟随应用内主题） */
  chooserShow: boolean
  chooserKind: string
  chooserTitle: string
  chooserOptions: { id: string; label: string; checked?: boolean }[]
  chooserEmpty: string
  /** 长按置顶提示（仅模型 chooser 非空） */
  chooserPinHint: string
  configLoading: boolean
  configError: string
  quickText: string
  quickSending: boolean
  canQuickSend: boolean
  pendingSessionId: string
  pendingDeviceId: string
  pendingSessionTitle: string
  pendingConfigApplied: boolean
  pendingSubmissionUnknown: boolean
  keyboardHeight: number
}

const DEFAULT_PROJECT: SessionConfigOption = { id: 'default', label: '未归属项目' }

function buildProjectOptions(projects: BridgeProjectSummary[]): SessionConfigOption[] {
  return [DEFAULT_PROJECT, ...projects.map((project) => ({ id: project.id, label: project.name }))]
}

Page({
  data: {
    statusBarHeight: 44,
    navClearance: 100,
    avatarUrl: '',
    accountLabel: '',
    devices: [],
    selectedDeviceId: '',
    devicesLoaded: false,
    devicesLoading: true,
    devicesError: '',
    composerDeviceId: '',
    composerDeviceIndex: 0,
    composerDeviceLabel: '暂无已接入电脑',
    projectOptions: [DEFAULT_PROJECT],
    projectIndex: 0,
    modelOptions: [DEFAULT_MODEL_OPTION],
    modelIndex: 0,
    permissionOptions: [PENDING_PERMISSION_OPTION],
    permissionIndex: 0,
    reasoningOptions: [PENDING_REASONING_OPTION],
    reasoningIndex: 0,
    configSummary: '选择电脑、项目、模型和权限',
    configOpen: false,
    chooserShow: false,
    chooserKind: '',
    chooserTitle: '',
    chooserOptions: [],
    chooserEmpty: '',
    chooserPinHint: '',
    configLoading: false,
    configError: '',
    quickText: '',
    quickSending: false,
    canQuickSend: false,
    pendingSessionId: '',
    pendingDeviceId: '',
    pendingSessionTitle: '',
    pendingConfigApplied: false,
    pendingSubmissionUnknown: false,
    keyboardHeight: 0,
  } as HomeData,

  restDevices: [] as RelayDeviceInfo[],
  unsubscribeDevices: null as (() => void) | null,
  /** 本机设备备注名表（onShow 与改备注名后重读） */
  deviceAliases: {} as DeviceAliasMap,
  loadGeneration: 0,
  configGeneration: 0,
  configLoadedDeviceId: '',

  /** 视图是否已有数据（来自缓存秒开或一次成功加载） */
  viewReady: false,
  /** onHide 记录的离开时刻；> 0 表示本次 onShow 是「从别处返回」而非冷启动首显 */
  hiddenAt: 0,

  onLoad() {
    this.deviceAliases = readDeviceAliases()
    const cached = readListCache<RelayDeviceInfo[]>(HOME_LIST_CACHE_KEY)
    if (cached != null) {
      this.restDevices = cached
      this.setData({ devicesLoaded: true, devicesLoading: false })
      this.rebuildDevices()
      this.viewReady = true
    }
    this.unsubscribeDevices = bridge.onRelayDevicesChanged(() => this.onPresenceUpdate())
  },

  onShow() {
    syncPageTheme(this)
    // 轻量状态刷新：状态栏 + 账号信息属于纯本地/展示态，始终更新，不触发列表重拉
    this.applyStatusBar()
    if (!getItem<string>(StorageKeys.token)) {
      wx.reLaunch({ url: '/pages/login/index' })
      return
    }
    // 备注名可能刚在设备管理页改过：重读并重建列表（纯内存计算，无请求）
    this.deviceAliases = readDeviceAliases()
    if (this.viewReady) this.rebuildDevices()
    const user = getAuthState().user
    this.setData({
      avatarUrl: user?.avatarUrl ?? '',
      accountLabel: user?.nickname ?? user?.account ?? '',
      selectedDeviceId: bridge.getSelectedDeviceId(),
    })
    if (!this.viewReady) {
      // 首次进入且无缓存：正常全量加载
      void this.bootstrap()
      return
    }
    // 从子页面返回且距上次成功加载 < TTL：保留现有视图与滚动位置，跳过重拉
    if (this.hiddenAt > 0 && isFresh(HOME_LIST_CACHE_KEY)) return
    // 冷启动读缓存后的补刷 / 数据已陈旧：静默后台刷新（不铺骨架屏、不清空列表）
    void this.bootstrap(true)
  },

  onHide() {
    this.hiddenAt = Date.now()
  },

  onUnload() {
    this.loadGeneration += 1
    this.configGeneration += 1
    this.unsubscribeDevices?.()
    this.unsubscribeDevices = null
  },

  onPullDownRefresh() {
    void this.bootstrap().finally(() => wx.stopPullDownRefresh())
  },

  applyStatusBar() {
    try {
      const win = wx.getWindowInfo()
      const menu = wx.getMenuButtonBoundingClientRect()
      this.setData({
        statusBarHeight: win.statusBarHeight,
        navClearance: Math.max(win.windowWidth - menu.left + 8, 100),
      })
    } catch {
      /* 保底状态栏高度与微信胶囊让位 */
    }
  },

  async bootstrap(silent = false) {
    const generation = ++this.loadGeneration
    if (!silent) this.setData({ devicesLoading: true, devicesError: '' })
    void bridge.ensureRelay().catch(() => undefined)
    try {
      const result = await bridge.listRelayDevices()
      if (generation !== this.loadGeneration) return
      this.restDevices = result?.devices ?? []
      this.setData({ devicesLoaded: true })
      this.rebuildDevices()
      this.viewReady = true
      writeListCache(HOME_LIST_CACHE_KEY, this.restDevices)
    } catch (error) {
      // 静默后台刷新失败时保留旧数据（不铺错误态、不清空列表）
      if (generation === this.loadGeneration) {
        if (!silent) {
          this.setData({
            devicesError: error instanceof Error ? error.message : '电脑列表加载失败，请重试',
          })
        }
        logMobileError('mobile-home', 'load-devices', error)
      }
    } finally {
      if (generation === this.loadGeneration) this.setData({ devicesLoading: false })
    }
  },

  /** 合并设备快照与在线 presence。展示名走本机备注名，自报名降级为副标题。 */
  rebuildDevices() {
    const presence = bridge.getRelayPresenceDevices()
    const presenceFresh = bridge.isRelayPresenceFresh()
    const liveById = new Map(presence.map((item) => [item.deviceId, item]))
    const devices: ComputerOption[] = []
    const seen = new Set<string>()
    const aliases = this.deviceAliases
    const push = (deviceId: string, realName: string, online: boolean, lastSeenAt?: string) => {
      const name = deviceDisplayName(deviceId, realName, aliases)
      const real = deviceRealName(deviceId, realName, aliases)
      devices.push({
        deviceId,
        name,
        ...(real != null ? { realName: real } : {}),
        pickerLabel: `${name} · ${online ? '在线' : '离线'}`,
        online,
        ...(lastSeenAt != null ? { lastSeenAt } : {}),
      })
    }

    for (const trusted of this.restDevices) {
      seen.add(trusted.deviceId)
      const live = liveById.get(trusted.deviceId)
      push(
        trusted.deviceId,
        live?.label || trusted.name || '桌面端',
        presenceFresh ? live != null : trusted.online,
        trusted.lastSeenAt ?? undefined,
      )
    }
    for (const live of presence) {
      if (seen.has(live.deviceId)) continue
      push(live.deviceId, live.label || '桌面端', true)
    }

    let selectedDeviceId = this.data.selectedDeviceId
    if (!devices.some((item) => item.deviceId === selectedDeviceId)) {
      selectedDeviceId = ''
      bridge.setSelectedDeviceId('')
    }
    let composerDeviceId = this.data.composerDeviceId
    if (!devices.some((item) => item.deviceId === composerDeviceId)) {
      const preferred = devices.find((item) => item.deviceId === selectedDeviceId)
      composerDeviceId =
        (preferred?.online ? preferred.deviceId : undefined) ??
        devices.find((item) => item.online)?.deviceId ??
        preferred?.deviceId ??
        devices[0]?.deviceId ??
        ''
    }
    if (composerDeviceId !== this.data.composerDeviceId) {
      this.configLoadedDeviceId = ''
      this.setData({
        projectOptions: [DEFAULT_PROJECT],
        projectIndex: 0,
        modelOptions: [DEFAULT_MODEL_OPTION],
        modelIndex: 0,
        permissionOptions: [PENDING_PERMISSION_OPTION],
        permissionIndex: 0,
        reasoningOptions: [PENDING_REASONING_OPTION],
        reasoningIndex: 0,
      })
    }
    const composerDeviceIndex = Math.max(
      devices.findIndex((item) => item.deviceId === composerDeviceId),
      0,
    )
    this.setData({
      devices,
      selectedDeviceId,
      composerDeviceId,
      composerDeviceIndex,
      composerDeviceLabel: devices[composerDeviceIndex]?.pickerLabel ?? '暂无已接入电脑',
    })
    this.refreshComposerSummary()
  },

  onPresenceUpdate() {
    this.rebuildDevices()
  },

  onGoProfile() {
    // 「我的」是 tabBar 页：navigateTo 会直接失败
    wx.switchTab({ url: '/pages/profile/index' })
  },

  onOpenBridgeDevices() {
    wx.navigateTo({ url: '/pages/bridge-devices/index' })
  },

  /** 空态里的「看看界面长什么样」：打开只读示例页，不发任何请求 */
  onOpenDemo() {
    wx.navigateTo({ url: '/pages/demo/index' })
  },

  onRetry() {
    void this.bootstrap()
  },

  // ─── 设备备注名（只存本机：桌面端自报名会重名，靠备注名区分） ────────────────

  onDeviceLongPress(event: WechatMiniprogram.CustomEvent) {
    const deviceId = String(event.currentTarget.dataset.id ?? '')
    const device = this.data.devices.find((item) => item.deviceId === deviceId)
    if (!device) return
    const alias = getDeviceAlias(deviceId, this.deviceAliases)
    const actions: Array<{ label: string; run: () => void }> = [
      {
        label: alias != null ? '修改备注名' : '设置备注名',
        run: () => this.promptDeviceAlias(device),
      },
      ...(alias != null ? [{ label: '清除备注名', run: () => this.clearDeviceAlias(device) }] : []),
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

  promptDeviceAlias(device: ComputerOption) {
    const current = getDeviceAlias(device.deviceId, this.deviceAliases) ?? ''
    wx.showModal({
      title: '设备备注名',
      editable: true,
      content: current,
      placeholderText: device.realName ?? device.name,
      confirmText: '保存',
      success: (res) => {
        if (!res.confirm) return
        const raw = (res.content ?? '').trim()
        writeDeviceAlias(device.deviceId, raw)
        this.deviceAliases = readDeviceAliases()
        this.rebuildDevices()
        const truncated = Array.from(raw).length > DEVICE_ALIAS_MAX_LENGTH
        wx.showToast({
          title:
            raw === ''
              ? '已恢复原设备名'
              : truncated
                ? `备注名最多 ${DEVICE_ALIAS_MAX_LENGTH} 字，已截断保存`
                : '备注名已保存',
          icon: 'none',
        })
      },
      fail: () => {
        /* 取消 */
      },
    })
  },

  clearDeviceAlias(device: ComputerOption) {
    writeDeviceAlias(device.deviceId, null)
    this.deviceAliases = readDeviceAliases()
    this.rebuildDevices()
    wx.showToast({ title: '已恢复原设备名', icon: 'none' })
  },

  onPickDevice(event: WechatMiniprogram.CustomEvent) {
    const deviceId = String(event.currentTarget.dataset.id ?? '')
    const device = this.data.devices.find((item) => item.deviceId === deviceId)
    if (!device) return
    if (!device.online) {
      wx.showToast({ title: '这台电脑离线，连上中继后才能浏览项目', icon: 'none' })
      return
    }
    bridge.setSelectedDeviceId(deviceId)
    this.configLoadedDeviceId = ''
    this.setData({
      selectedDeviceId: deviceId,
      composerDeviceId: deviceId,
      composerDeviceLabel: device.pickerLabel,
      projectOptions: [DEFAULT_PROJECT],
      projectIndex: 0,
      modelOptions: [DEFAULT_MODEL_OPTION],
      modelIndex: 0,
      permissionOptions: [PENDING_PERMISSION_OPTION],
      permissionIndex: 0,
      reasoningOptions: [PENDING_REASONING_OPTION],
      reasoningIndex: 0,
    })
    this.refreshComposerSummary()
    // 「项目」是 tabBar 页：先写入选中的电脑（项目页从 bridge 读），再切 tab
    wx.switchTab({ url: '/pages/projects/index' })
  },

  refreshComposerSummary() {
    const device = this.data.devices.find((item) => item.deviceId === this.data.composerDeviceId)
    const project = this.data.projectOptions[this.data.projectIndex]
    const model = this.data.modelOptions[this.data.modelIndex]
    const permission = this.data.permissionOptions[this.data.permissionIndex]
    const reasoning = this.data.reasoningOptions[this.data.reasoningIndex]
    const configSummary = [
      device?.name ?? '选择电脑',
      project?.label ?? DEFAULT_PROJECT.label,
      model?.label ?? DEFAULT_MODEL_OPTION.label,
      permission?.label ?? '未设置',
      reasoning?.label ?? '未设置',
    ].join(' · ')
    const canQuickSend =
      this.data.quickText.trim().length > 0 &&
      (this.data.pendingSubmissionUnknown || device?.online === true) &&
      !this.data.quickSending
    this.setData({ configSummary, canQuickSend })
  },

  onQuickInput(event: WechatMiniprogram.CustomEvent<{ value: string }>) {
    this.setData({ quickText: event.detail.value })
    this.refreshComposerSummary()
  },

  onComposerKeyboardChange(event: WechatMiniprogram.CustomEvent<{ height: number }>) {
    this.setData({ keyboardHeight: Math.max(0, Number(event.detail.height) || 0) })
  },

  async onOpenConfig() {
    this.setData({ configOpen: true, configError: '' })
    const deviceId = this.data.composerDeviceId
    if (deviceId && this.configLoadedDeviceId !== deviceId) {
      await this.loadComposerOptions(deviceId)
    }
  },

  onCloseConfig() {
    this.setData({ configOpen: false })
  },

  onStopConfigTap() {},

  async loadComposerOptions(deviceId: string) {
    const device = this.data.devices.find((item) => item.deviceId === deviceId)
    if (!device?.online) {
      this.setData({ configError: '这台电脑当前离线，连接中继后才能读取项目和模型渠道。' })
      return
    }
    const generation = ++this.configGeneration
    this.setData({ configLoading: true, configError: '' })
    try {
      const [projectResult, catalog] = await Promise.all([
        bridge.listProjects(100, deviceId),
        bridge.getCatalog(deviceId),
      ])
      if (generation !== this.configGeneration) return
      const projectOptions = buildProjectOptions(projectResult.projects)
      // 置顶的常用模型排最前；上次选过的模型直接作为本次默认（不再回落「电脑默认」）
      const modelCache = readComposerModelCache(deviceId)
      const modelOptions = sortComposerModelOptions(
        buildModelOptions(catalog),
        modelCache,
        (option) => parseComposerModelRef(option.id),
      )
      const lastModelId = resolveCachedModelId(modelOptions, modelCache, (option) =>
        parseComposerModelRef(option.id),
      )
      const permissionOptions = buildPermissionOptions(catalog)
      const reasoningOptions = buildReasoningOptions(catalog)
      this.configLoadedDeviceId = deviceId
      // 权限 / 推理不再有「电脑默认」合成项：用户手选过的档位能保留就保留，
      // 否则回落到默认助手在电脑上的当前档位（= 以前「电脑默认」的实际效果）
      const keptPermission = permissionOptions.findIndex(
        (option) => option.id === this.data.permissionOptions[this.data.permissionIndex]?.id,
      )
      const keptReasoning = reasoningOptions.findIndex(
        (option) => option.id === this.data.reasoningOptions[this.data.reasoningIndex]?.id,
      )
      const resolvedPermission = permissionOptions.findIndex(
        (option) => option.id === defaultPermissionId(catalog),
      )
      const resolvedReasoning = reasoningOptions.findIndex(
        (option) => option.id === defaultReasoningId(catalog),
      )
      const modelIndex = lastModelId
        ? modelOptions.findIndex((option) => option.id === lastModelId)
        : -1
      this.setData({
        projectOptions,
        projectIndex: Math.min(this.data.projectIndex, projectOptions.length - 1),
        modelOptions,
        modelIndex: modelIndex >= 0 ? modelIndex : 0,
        permissionOptions,
        permissionIndex: keptPermission >= 0 ? keptPermission : Math.max(resolvedPermission, 0),
        reasoningOptions,
        reasoningIndex: keptReasoning >= 0 ? keptReasoning : Math.max(resolvedReasoning, 0),
      })
      this.refreshComposerSummary()
    } catch (error) {
      if (generation !== this.configGeneration) return
      this.setData({
        configError: error instanceof Error ? error.message : '会话配置加载失败，请重试',
      })
      logMobileError('mobile-home', 'load-session-config', error)
    } finally {
      if (generation === this.configGeneration) this.setData({ configLoading: false })
    }
  },

  /** 切电脑：重置下游配置再按新电脑重新拉目录 */
  async applyDeviceIndex(index: number) {
    if (this.data.pendingSessionId) return
    const device = this.data.devices[index]
    if (!device) return
    bridge.setSelectedDeviceId(device.deviceId)
    this.configLoadedDeviceId = ''
    this.setData({
      selectedDeviceId: device.deviceId,
      composerDeviceId: device.deviceId,
      composerDeviceIndex: index,
      composerDeviceLabel: device.pickerLabel,
      projectOptions: [DEFAULT_PROJECT],
      projectIndex: 0,
      modelOptions: [DEFAULT_MODEL_OPTION],
      modelIndex: 0,
      permissionOptions: [PENDING_PERMISSION_OPTION],
      permissionIndex: 0,
      reasoningOptions: [PENDING_REASONING_OPTION],
      reasoningIndex: 0,
      configError: '',
    })
    this.refreshComposerSummary()
    await this.loadComposerOptions(device.deviceId)
  },

  applyProjectIndex(index: number) {
    if (this.data.pendingSessionId) return
    if (!this.data.projectOptions[index]) return
    this.setData({ projectIndex: index })
    this.refreshComposerSummary()
  },

  applyModelIndex(index: number) {
    if (this.data.pendingSessionId) return
    const option = this.data.modelOptions[index]
    if (!option) return
    // 记住这次选择：下次进页面（乃至下次冷启动）默认还是它；
    // 「电脑默认」清除记录（回落目标端默认），具体模型 / 自动路由渠道都记
    rememberLastComposerModel(this.data.composerDeviceId, parseComposerModelRef(option.id))
    this.setData({ modelIndex: index })
    this.refreshComposerSummary()
  },

  /** 长按 chooser 里的模型行：置顶 / 取消置顶，就地重排（仅模型 chooser 生效） */
  onChooserLongPress(event: WechatMiniprogram.CustomEvent<{ id: string }>) {
    if (this.data.chooserKind !== 'model') return
    const index = Number(event.detail.id)
    const option = this.data.modelOptions[index]
    if (option == null) return
    const ref = parseComposerModelRef(option.id)
    if (ref == null) {
      wx.showToast({ title: '该项不支持置顶', icon: 'none' })
      return
    }
    const deviceId = this.data.composerDeviceId
    toggleComposerModelPin(deviceId, ref)
    const pinned = readComposerModelCache(deviceId).pinned.some(
      (item) => item.providerProfileId === ref.providerProfileId && item.modelId === ref.modelId,
    )
    wx.showToast({ title: pinned ? '已置顶为常用' : '已取消置顶', icon: 'none', duration: 1200 })
    const cache = readComposerModelCache(deviceId)
    const pinnedKeys = new Set(
      cache.pinned.map((pin) => `${pin.providerProfileId}::${pin.modelId ?? ''}`),
    )
    const sorted = sortComposerModelOptions(this.data.modelOptions, cache, (item) =>
      parseComposerModelRef(item.id),
    )
    const selectedId = this.data.modelOptions[this.data.modelIndex]?.id ?? ''
    const nextIndex = Math.max(
      sorted.findIndex((item) => item.id === selectedId),
      0,
    )
    this.setData({
      modelOptions: sorted,
      modelIndex: nextIndex,
      chooserOptions: sorted.map((item, itemIndex) => ({
        id: String(itemIndex),
        label: item.label,
        checked: itemIndex === nextIndex,
        ...(pinnedKeys.has(item.id) ? { pinned: true } : {}),
      })),
    })
    this.refreshComposerSummary()
  },

  applyPermissionIndex(index: number) {
    if (this.data.pendingSessionId) return
    if (!this.data.permissionOptions[index]) return
    this.setData({ permissionIndex: index })
    this.refreshComposerSummary()
  },

  /**
   * 打开底部选择列表。
   *
   * 这里不用原生 <picker>：它跟着系统外观走，不跟随应用内「浅色/深色」切换，
   * 暗色下弹出来的列表是系统配色，和我们自己的深色面板叠在一起就糊了。
   */
  onOpenChooser(event: WechatMiniprogram.BaseEvent) {
    const dataset = event.currentTarget.dataset
    const kind = String(dataset.kind ?? '')
    // dataset 里的布尔在不同基础库可能落成字符串，两种都认
    if (dataset.disabled === true || dataset.disabled === 'true') {
      // 不做「点了没反应」的静默拦截：说明现在为什么不能选
      const title = this.data.pendingSessionId
        ? '正在创建会话，请稍候'
        : kind === 'device'
          ? '还没有接入电脑'
          : '配置读取中，请稍候'
      wx.showToast({ title, icon: 'none' })
      return
    }
    const data = this.data
    const toOptions = (items: SessionConfigOption[], current: number) => {
      // 模型项从缓存查置顶态（图钉标记）；其它 kind 不带该字段
      const pinnedKeys =
        kind === 'model'
          ? new Set(
              readComposerModelCache(this.data.composerDeviceId).pinned.map(
                (ref) => `${ref.providerProfileId}::${ref.modelId ?? ''}`,
              ),
            )
          : null
      return items.map((item, index) => ({
        id: String(index),
        label: item.label,
        checked: index === current,
        ...(pinnedKeys != null && pinnedKeys.has(item.id) ? { pinned: true } : {}),
      }))
    }
    if (kind === 'device') {
      if (data.devices.length === 0) {
        wx.showToast({ title: '还没有接入电脑', icon: 'none' })
        return
      }
      this.setData({
        chooserShow: true,
        chooserKind: kind,
        chooserTitle: '选择电脑',
        chooserOptions: data.devices.map((item, index) => ({
          id: String(index),
          label: item.pickerLabel,
          checked: index === data.composerDeviceIndex,
        })),
        chooserEmpty: '',
      })
      return
    }
    const table: Record<
      string,
      { title: string; options: SessionConfigOption[]; current: number; empty: string }
    > = {
      project: {
        title: '选择项目',
        options: data.projectOptions,
        current: data.projectIndex,
        empty: '这台电脑没有可用项目',
      },
      model: {
        title: '选择模型渠道',
        options: data.modelOptions,
        current: data.modelIndex,
        empty: '这台电脑没有可用模型',
      },
      permission: {
        title: '权限策略',
        options: data.permissionOptions,
        current: data.permissionIndex,
        empty: '当前助手不支持切换权限',
      },
    }
    const entry = table[kind]
    if (entry == null) return
    this.setData({
      chooserShow: true,
      chooserKind: kind,
      chooserTitle: entry.title,
      chooserOptions: toOptions(entry.options, entry.current),
      chooserEmpty: entry.empty,
      chooserPinHint: kind === 'model' ? '长按模型可置顶为常用' : '',
    })
  },

  onChooserClose() {
    this.setData({ chooserShow: false })
  },

  onChooserSelect(event: WechatMiniprogram.CustomEvent<{ id: string }>) {
    const index = Number(event.detail.id)
    const kind = this.data.chooserKind
    this.setData({ chooserShow: false })
    if (!Number.isFinite(index)) return
    if (kind === 'device') {
      void this.applyDeviceIndex(index)
      return
    }
    if (kind === 'project') {
      this.applyProjectIndex(index)
      return
    }
    if (kind === 'model') {
      this.applyModelIndex(index)
      return
    }
    if (kind === 'permission') this.applyPermissionIndex(index)
  },

  onReasoningChange(event: WechatMiniprogram.CustomEvent<{ value: number }>) {
    if (this.data.pendingSessionId) return
    const reasoningIndex = Math.round(Number(event.detail.value))
    if (!this.data.reasoningOptions[reasoningIndex]) return
    this.setData({ reasoningIndex })
    this.refreshComposerSummary()
  },

  onRetryConfig() {
    const deviceId = this.data.composerDeviceId
    if (deviceId) void this.loadComposerOptions(deviceId)
  },

  async onQuickSend() {
    const text = this.data.quickText.trim()
    if (!text || this.data.quickSending) return
    if (this.data.pendingSubmissionUnknown) {
      this.openPendingSession()
      return
    }

    const deviceId = this.data.pendingDeviceId || this.data.composerDeviceId
    const device = this.data.devices.find((item) => item.deviceId === deviceId)
    if (!device?.online) {
      wx.showToast({ title: '先在会话配置中选择一台在线电脑', icon: 'none' })
      return
    }

    this.setData({ quickSending: true })
    this.refreshComposerSummary()
    let stage = 'create-session'
    try {
      let sessionId = this.data.pendingSessionId
      if (!sessionId) {
        const project = this.data.projectOptions[this.data.projectIndex]
        const created = await bridge.createSession(
          text.slice(0, 30),
          project && project.id !== 'default' ? project.id : undefined,
          deviceId,
        )
        sessionId = created.session.id
        this.setData({
          pendingSessionId: sessionId,
          pendingDeviceId: deviceId,
          pendingSessionTitle: created.session.title,
          pendingConfigApplied: false,
        })
      }

      if (!this.data.pendingConfigApplied) {
        stage = 'apply-session-config'
        const model = this.data.modelOptions[this.data.modelIndex]
        const permission = this.data.permissionOptions[this.data.permissionIndex]
        const reasoning = this.data.reasoningOptions[this.data.reasoningIndex]
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
        // 'pending' = 目录还没读到，别把占位当档位写过去
        if (permission != null && permission.id !== 'pending' && permission.id !== '') {
          patch.permissionMode = permission.id
        }
        if (reasoning?.value) patch.reasoningEffort = reasoning.value
        if (Object.keys(patch).length > 0) {
          await bridge.updateSession(sessionId, patch, deviceId)
        }
        this.setData({ pendingConfigApplied: true })
      }

      stage = 'submit-first-turn'
      this.setData({ pendingSubmissionUnknown: true })
      await bridge.submitTurn(sessionId, text, undefined, deviceId)
      this.setData({
        quickText: '',
        pendingSessionId: '',
        pendingDeviceId: '',
        pendingSessionTitle: '',
        pendingConfigApplied: false,
        pendingSubmissionUnknown: false,
        configOpen: false,
      })
      bridge.setSelectedDeviceId(deviceId)
      wx.navigateTo({
        url: `/pages/chat/index?sessionId=${encodeURIComponent(sessionId)}&title=${encodeURIComponent(text.slice(0, 30))}&deviceId=${encodeURIComponent(deviceId)}&deviceName=${encodeURIComponent(device.name)}`,
      })
    } catch (error) {
      if (stage !== 'submit-first-turn') this.setData({ pendingSubmissionUnknown: false })
      logMobileError('mobile-home', stage, error)
      if (stage === 'submit-first-turn') {
        wx.showToast({
          title: '发送结果未确认，点发送按钮打开会话检查，避免重复提交',
          icon: 'none',
          duration: 3200,
        })
      } else {
        wx.showToast({ title: (error as Error).message || '新建会话失败，请重试', icon: 'none' })
      }
    } finally {
      this.setData({ quickSending: false })
      this.refreshComposerSummary()
    }
  },

  openPendingSession() {
    const sessionId = this.data.pendingSessionId
    const deviceId = this.data.pendingDeviceId
    const device = this.data.devices.find((item) => item.deviceId === deviceId)
    if (!sessionId || !deviceId) return
    wx.navigateTo({
      url: `/pages/chat/index?sessionId=${encodeURIComponent(sessionId)}&title=${encodeURIComponent(this.data.pendingSessionTitle)}&deviceId=${encodeURIComponent(deviceId)}&deviceName=${encodeURIComponent(device?.name ?? '桌面端')}`,
    })
  },
})

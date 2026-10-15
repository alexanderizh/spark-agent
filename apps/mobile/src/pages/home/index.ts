/** 远程会话电脑顶层：选中电脑后进入它自己的项目列表。 */

import * as bridge from '../../api/bridge'
import { getState as getAuthState } from '../../store/auth'
import { getItem, StorageKeys } from '../../utils/storage'
import { logMobileError } from '../../utils/logger'
import type { BridgeCatalog, BridgeProjectSummary, RelayDeviceInfo } from '../../api/bridge'

interface ComputerOption {
  deviceId: string
  name: string
  pickerLabel: string
  online: boolean
  lastSeenAt?: string
}

interface PickerOption {
  id: string
  label: string
  value?: string
  providerProfileId?: string
  modelId?: string | null
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
  projectOptions: PickerOption[]
  projectIndex: number
  modelOptions: PickerOption[]
  modelIndex: number
  reasoningOptions: PickerOption[]
  reasoningIndex: number
  configSummary: string
  configOpen: boolean
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

const DEFAULT_PROJECT: PickerOption = { id: 'default', label: '未归属项目' }
const DEFAULT_MODEL: PickerOption = { id: 'default', label: '电脑默认模型' }
const DEFAULT_REASONING: PickerOption = { id: 'default', label: '电脑默认' }
const REASONING_LABELS: Record<string, string> = {
  minimal: '最省',
  low: '低',
  medium: '中',
  high: '高',
  xhigh: '超高',
  max: '极致',
}

function buildModelOptions(catalog: BridgeCatalog): PickerOption[] {
  const options = [DEFAULT_MODEL]
  for (const provider of catalog.providers) {
    if (provider.isAutoRouter || provider.models.length === 0) {
      options.push({
        id: `${provider.id}::`,
        label: provider.isAutoRouter
          ? `${provider.name} · 自动路由`
          : `${provider.name} · 默认模型`,
        providerProfileId: provider.id,
        modelId: null,
      })
      continue
    }
    for (const model of provider.models) {
      options.push({
        id: `${provider.id}::${model.id}`,
        label: `${provider.name} · ${model.name}`,
        providerProfileId: provider.id,
        modelId: model.id,
      })
    }
  }
  return options
}

function buildProjectOptions(projects: BridgeProjectSummary[]): PickerOption[] {
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
    composerDeviceLabel: '暂无已授信电脑',
    projectOptions: [DEFAULT_PROJECT],
    projectIndex: 0,
    modelOptions: [DEFAULT_MODEL],
    modelIndex: 0,
    reasoningOptions: [DEFAULT_REASONING],
    reasoningIndex: 0,
    configSummary: '选择电脑、项目和模型',
    configOpen: false,
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
  loadGeneration: 0,
  configGeneration: 0,
  configLoadedDeviceId: '',

  onLoad() {
    this.unsubscribeDevices = bridge.onRelayDevicesChanged(() => this.onPresenceUpdate())
  },

  onShow() {
    this.applyStatusBar()
    if (!getItem<string>(StorageKeys.token)) {
      wx.reLaunch({ url: '/pages/login/index' })
      return
    }
    const user = getAuthState().user
    this.setData({
      avatarUrl: user?.avatarUrl ?? '',
      accountLabel: user?.nickname ?? user?.account ?? '',
      selectedDeviceId: bridge.getSelectedDeviceId(),
    })
    void this.bootstrap()
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

  async bootstrap() {
    const generation = ++this.loadGeneration
    this.setData({ devicesLoading: true, devicesError: '' })
    void bridge.ensureRelay().catch(() => undefined)
    try {
      const result = await bridge.listRelayDevices()
      if (generation !== this.loadGeneration) return
      this.restDevices = result?.devices ?? []
      this.setData({ devicesLoaded: true })
      this.rebuildDevices()
    } catch (error) {
      if (generation === this.loadGeneration) {
        this.setData({
          devicesError: error instanceof Error ? error.message : '电脑列表加载失败，请重试',
        })
        logMobileError('mobile-home', 'load-devices', error)
      }
    } finally {
      if (generation === this.loadGeneration) this.setData({ devicesLoading: false })
    }
  },

  /** 合并授信设备快照与在线 presence。 */
  rebuildDevices() {
    const presence = bridge.getRelayPresenceDevices()
    const presenceFresh = bridge.isRelayPresenceFresh()
    const liveById = new Map(presence.map((item) => [item.deviceId, item]))
    const devices: ComputerOption[] = []
    const seen = new Set<string>()

    for (const trusted of this.restDevices) {
      seen.add(trusted.deviceId)
      const live = liveById.get(trusted.deviceId)
      devices.push({
        deviceId: trusted.deviceId,
        name: live?.label || trusted.name || '桌面端',
        pickerLabel: `${live?.label || trusted.name || '桌面端'} · ${presenceFresh ? (live ? '在线' : '离线') : trusted.online ? '在线' : '离线'}`,
        online: presenceFresh ? live != null : trusted.online,
        ...(trusted.lastSeenAt != null ? { lastSeenAt: trusted.lastSeenAt } : {}),
      })
    }
    for (const live of presence) {
      if (seen.has(live.deviceId)) continue
      devices.push({
        deviceId: live.deviceId,
        name: live.label || '桌面端',
        pickerLabel: `${live.label || '桌面端'} · 在线`,
        online: true,
      })
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
        modelOptions: [DEFAULT_MODEL],
        modelIndex: 0,
        reasoningOptions: [DEFAULT_REASONING],
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
      composerDeviceLabel: devices[composerDeviceIndex]?.pickerLabel ?? '暂无已授信电脑',
    })
    this.refreshComposerSummary()
  },

  onPresenceUpdate() {
    this.rebuildDevices()
  },

  onGoProfile() {
    wx.navigateTo({ url: '/pages/profile/index' })
  },

  onOpenBridgeDevices() {
    wx.navigateTo({ url: '/pages/bridge-devices/index' })
  },

  onRetry() {
    void this.bootstrap()
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
      modelOptions: [DEFAULT_MODEL],
      modelIndex: 0,
      reasoningOptions: [DEFAULT_REASONING],
      reasoningIndex: 0,
    })
    this.refreshComposerSummary()
    wx.navigateTo({
      url: `/pages/projects/index?deviceId=${encodeURIComponent(device.deviceId)}&deviceName=${encodeURIComponent(device.name)}`,
    })
  },

  refreshComposerSummary() {
    const device = this.data.devices.find((item) => item.deviceId === this.data.composerDeviceId)
    const project = this.data.projectOptions[this.data.projectIndex]
    const model = this.data.modelOptions[this.data.modelIndex]
    const reasoning = this.data.reasoningOptions[this.data.reasoningIndex]
    const configSummary = [
      device?.name ?? '选择电脑',
      project?.label ?? DEFAULT_PROJECT.label,
      model?.label ?? DEFAULT_MODEL.label,
      reasoning?.label ?? DEFAULT_REASONING.label,
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
      const modelOptions = buildModelOptions(catalog)
      const reasoningOptions = [
        DEFAULT_REASONING,
        ...catalog.reasoningEfforts.map((effort) => ({
          id: effort,
          label: REASONING_LABELS[effort] ?? effort,
          value: effort,
        })),
      ]
      this.configLoadedDeviceId = deviceId
      this.setData({
        projectOptions,
        projectIndex: Math.min(this.data.projectIndex, projectOptions.length - 1),
        modelOptions,
        modelIndex: Math.min(this.data.modelIndex, modelOptions.length - 1),
        reasoningOptions,
        reasoningIndex: Math.min(this.data.reasoningIndex, reasoningOptions.length - 1),
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

  async onConfigDeviceChange(event: WechatMiniprogram.CustomEvent<{ value: string }>) {
    if (this.data.pendingSessionId) return
    const index = Number(event.detail.value)
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
      modelOptions: [DEFAULT_MODEL],
      modelIndex: 0,
      reasoningOptions: [DEFAULT_REASONING],
      reasoningIndex: 0,
      configError: '',
    })
    this.refreshComposerSummary()
    await this.loadComposerOptions(device.deviceId)
  },

  onProjectChange(event: WechatMiniprogram.CustomEvent<{ value: string }>) {
    if (this.data.pendingSessionId) return
    const projectIndex = Number(event.detail.value)
    if (!this.data.projectOptions[projectIndex]) return
    this.setData({ projectIndex })
    this.refreshComposerSummary()
  },

  onModelChange(event: WechatMiniprogram.CustomEvent<{ value: string }>) {
    if (this.data.pendingSessionId) return
    const modelIndex = Number(event.detail.value)
    if (!this.data.modelOptions[modelIndex]) return
    this.setData({ modelIndex })
    this.refreshComposerSummary()
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
        const reasoning = this.data.reasoningOptions[this.data.reasoningIndex]
        const patch: {
          providerProfileId?: string
          modelId?: string | null
          reasoningEffort?: string
        } = {}
        if (model?.providerProfileId) {
          patch.providerProfileId = model.providerProfileId
          patch.modelId = model.modelId ?? null
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

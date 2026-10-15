/** 固定电脑下的项目列表。进入项目后才允许浏览其会话。 */

import * as bridge from '../../api/bridge'
import type { BridgeProjectSummary, RelayDeviceInfo } from '../../api/bridge'

interface ProjectOption extends BridgeProjectSummary {
  isVirtual: boolean
}

interface ProjectsPageData {
  deviceId: string
  deviceName: string
  projects: ProjectOption[]
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
    loading: true,
    errorText: '',
    deviceOffline: false,
    deviceUnavailable: false,
  } as ProjectsPageData,

  unsubscribeDevices: null as (() => void) | null,
  loadGeneration: 0,

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

      const [projectResult, unassignedResult] = await Promise.all([
        bridge.listProjects(100, this.data.deviceId),
        bridge.listSessions(1, 'default', this.data.deviceId),
      ])
      if (generation !== this.loadGeneration) return
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
})

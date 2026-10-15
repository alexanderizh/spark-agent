/**
 * 授信设备管理（云端中继）。
 *
 * 管理可通过云端中继访问本账号会话的桌面设备：
 *   - 首次连接即授信：桌面端用本账号登录并开启中继时自动注册
 *   - 吊销不可逆：该设备的中继连接立即断开、deviceId 永久拒绝重连，
 *     桌面端需要「重新授信」生成全新设备身份
 * 列表来自 REST（含离线设备），在线状态由中继 presence 实时刷新。
 */

import {
  listRelayDevices,
  revokeRelayDevice,
  ensureRelayConnected,
  getPresenceDevices,
  onRelayDevicesChanged,
  type RelayDeviceInfo,
  type RelayDesktopInfo,
} from '../../api/relay'
import { ensureAuthenticated } from '../../utils/auth-guard'
import { formatRelativeTime } from '../../utils/format'

/** 设备视图模型：WXML 直接绑定（Mustache 不能调用数据方法，需预计算） */
interface DeviceRowVm {
  deviceId: string
  shortId: string
  name: string
  versionLabel: string
  statusLabel: string
  online: boolean
  lastSeenLabel: string
  trustedLabel: string
}

interface BridgeDevicesData {
  devices: DeviceRowVm[]
  onlineCount: number
  loading: boolean
  errorText: string
  /** 待吊销的 deviceId（行内二次确认） */
  pendingRevoke: string | null
}

/** REST 列表 + presence 快照合并（presence 里的在线设备以实时状态为准） */
function toRows(restDevices: RelayDeviceInfo[], presenceDevices: RelayDesktopInfo[]): DeviceRowVm[] {
  const onlineIds = new Set(presenceDevices.map((item) => item.deviceId))
  const rows = restDevices.map((item) => toRow(item, onlineIds))
  // presence 里有、REST 还没返回的（刚授信的设备），先以在线态补进列表
  const known = new Set(restDevices.map((item) => item.deviceId))
  for (const live of presenceDevices) {
    if (known.has(live.deviceId)) continue
    const item: RelayDeviceInfo = {
      deviceId: live.deviceId,
      name: live.label || '桌面端',
      version: live.version,
      online: true,
      lastSeenAt: live.lastSeenAt,
      trustedAt: new Date().toISOString(),
    }
    rows.push(toRow(item, onlineIds))
  }
  return rows
}

/** REST 列表 + presence 快照合并成行视图 */
function toRow(item: RelayDeviceInfo, onlineIds: Set<string>): DeviceRowVm {
  const online = onlineIds.has(item.deviceId)
  return {
    deviceId: item.deviceId,
    shortId: item.deviceId.length > 12 ? `${item.deviceId.slice(0, 12)}…` : item.deviceId,
    name: item.name || '桌面端',
    versionLabel: item.version ? `v${item.version}` : '',
    statusLabel: online ? '在线' : '离线',
    online,
    lastSeenLabel: formatRelativeTime(item.lastSeenAt),
    trustedLabel: formatRelativeTime(item.trustedAt),
  }
}

Page({
  data: {
    devices: [],
    onlineCount: 0,
    loading: true,
    errorText: '',
    pendingRevoke: null,
  } as BridgeDevicesData,

  /** REST 设备列表原始数据（presence 只含在线设备，合并用） */
  restDevices: [] as RelayDeviceInfo[],
  /** 设备列表订阅取消函数 */
  unsubscribeDevices: null as (() => void) | null,

  onLoad() {
    // presence 增量：设备上下线时实时刷新在线徽标
    this.unsubscribeDevices = onRelayDevicesChanged(() => this.rebuildRows())
  },

  onShow() {
    if (!ensureAuthenticated()) return
    void this.loadDevices()
  },

  onUnload() {
    this.unsubscribeDevices?.()
    this.unsubscribeDevices = null
  },

  onPullDownRefresh() {
    void this.loadDevices().finally(() => wx.stopPullDownRefresh())
  },

  async loadDevices() {
    // 建立中继 WS 以接收 presence 实时刷新（失败不阻塞 REST 列表）
    void ensureRelayConnected().catch(() => undefined)
    this.setData({ loading: true, errorText: '' })
    try {
      const result = await listRelayDevices()
      this.restDevices = result?.devices ?? []
      this.rebuildRows()
    } catch (err) {
      this.setData({
        loading: false,
        errorText: err instanceof Error ? err.message : '加载失败，下拉重试',
      })
    }
  },

  /** presence 到达或列表刷新时重算行视图 */
  rebuildRows() {
    const devices = toRows(this.restDevices, getPresenceDevices())
    this.setData({
      devices,
      onlineCount: devices.filter((item) => item.online).length,
      loading: false,
    })
  },

  /** 行内二次确认：先点「吊销」再点「确认」 */
  onAskRevoke(event: WechatMiniprogram.TouchEvent) {
    const deviceId = String(event.currentTarget.dataset.id ?? '')
    this.setData({ pendingRevoke: deviceId })
  },

  onCancelRevoke() {
    this.setData({ pendingRevoke: null })
  },

  async onConfirmRevoke() {
    const deviceId = this.data.pendingRevoke
    if (!deviceId) return
    this.setData({ pendingRevoke: null })
    wx.showLoading({ title: '吊销中…', mask: true })
    try {
      await revokeRelayDevice(deviceId)
      wx.hideLoading()
      wx.showToast({ title: '已吊销，设备已断开', icon: 'none' })
      await this.loadDevices()
    } catch (err) {
      wx.hideLoading()
      wx.showToast({
        title: err instanceof Error ? err.message : '吊销失败，请重试',
        icon: 'none',
      })
    }
  },
})

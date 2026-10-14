/**
 * 授信设备管理（云端中继）。
 *
 * 管理可通过云端中继访问本账号会话的桌面设备：
 *   - 首次连接即授信：桌面端用本账号登录并开启中继时自动注册
 *   - 吊销不可逆：该设备的中继连接立即断开、deviceId 永久拒绝重连，
 *     桌面端需要「重新授信」生成全新设备身份
 * 当前在线设备由 relay presence 状态标出。
 */

import {
  listRelayDevices,
  revokeRelayDevice,
  getOnlineDeviceId,
  type RelayDeviceItem,
} from '../../api/relay'
import { ensureAuthenticated } from '../../utils/auth-guard'
import { formatRelativeTime } from '../../utils/format'

/** 设备视图模型：WXML 直接绑定（Mustache 不能调用数据方法，需预计算） */
interface DeviceRowVm {
  deviceId: string
  shortId: string
  label: string
  versionLabel: string
  status: 'active' | 'revoked'
  statusLabel: string
  lastSeenLabel: string
  firstSeenLabel: string
  online: boolean
}

interface BridgeDevicesData {
  devices: DeviceRowVm[]
  activeCount: number
  loading: boolean
  errorText: string
  /** 待吊销的 deviceId（行内二次确认） */
  pendingRevoke: string | null
}

function toRow(item: RelayDeviceItem, onlineDeviceId: string | null): DeviceRowVm {
  const online =
    onlineDeviceId != null && item.deviceId === onlineDeviceId && item.status === 'active'
  return {
    deviceId: item.deviceId,
    shortId: item.deviceId.length > 12 ? `${item.deviceId.slice(0, 12)}…` : item.deviceId,
    label: item.label || '桌面端',
    versionLabel: item.version ? `v${item.version}` : '',
    status: item.status,
    statusLabel: item.status === 'active' ? (online ? '在线' : '已授信') : '已吊销',
    lastSeenLabel: formatRelativeTime(item.lastSeenAt),
    firstSeenLabel: formatRelativeTime(item.firstSeenAt),
    online,
  }
}

Page({
  data: {
    devices: [],
    activeCount: 0,
    loading: true,
    errorText: '',
    pendingRevoke: null,
  } as BridgeDevicesData,

  onShow() {
    if (!ensureAuthenticated()) return
    void this.loadDevices()
  },

  onPullDownRefresh() {
    void this.loadDevices().finally(() => wx.stopPullDownRefresh())
  },

  async loadDevices() {
    this.setData({ loading: true, errorText: '' })
    try {
      const result = await listRelayDevices()
      const devices = (result?.devices ?? []).map((item) => toRow(item, getOnlineDeviceId()))
      this.setData({
        devices,
        activeCount: devices.filter((d) => d.status === 'active').length,
        loading: false,
      })
    } catch (err) {
      this.setData({
        loading: false,
        errorText: err instanceof Error ? err.message : '加载失败，下拉重试',
      })
    }
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

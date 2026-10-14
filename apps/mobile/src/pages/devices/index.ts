/**
 * 设备与登录会话（tab）。
 *
 * 桌面端本地优先，会话数据存在本地 SQLite；跨设备可见的「设备身份」来自同步记录里的
 * deviceLabel（edu-server desktop-sync history）。本页把同一账号下的同步记录聚合成设备列表：
 *   - 每台桌面端设备：同步次数、最近活跃、参与同步的类别
 *   - 当前设备：本小程序运行环境（系统 / 微信版本 / 基础库）
 *
 * 后续版本可在服务端增加 user_sessions 列表/吊销接口后，扩展为真正的登录会话管理。
 */

import * as syncApi from '../../api/sync'
import { ensureAuthenticated } from '../../utils/auth-guard'
import { formatRelativeTime } from '../../utils/format'
import { categoryLabelOf } from '../../utils/view-model'

interface DeviceAggregate {
  label: string
  count: number
  lastSeen: string
  categories: string[]
}

/** 设备视图模型：相对活跃时间与类别中文标签已预计算，WXML 直接绑定 */
interface DeviceAggregateVM {
  label: string
  count: number
  lastSeenLabel: string
  categoryLabels: string[]
}

interface DevicesPageData {
  devices: DeviceAggregateVM[]
  total: number
  loading: boolean
  currentDevice: {
    platform: string
    system: string
    version: string
    sdkVersion: string
  }
}

const HISTORY_PAGE_SIZE = 100

Page({
  data: {
    devices: [],
    total: 0,
    loading: true,
    currentDevice: { platform: '', system: '', version: '', sdkVersion: '' },
  } as DevicesPageData,

  onShow() {
    if (!ensureAuthenticated()) return
    this.loadCurrentDevice()
    void this.loadDevices()
  },

  onPullDownRefresh() {
    void this.loadDevices().finally(() => wx.stopPullDownRefresh())
  },

  loadCurrentDevice() {
    try {
      const info = wx.getSystemInfoSync()
      this.setData({
        currentDevice: {
          platform: info.platform || '—',
          system: info.system || '—',
          version: info.version || '—',
          sdkVersion: info.SDKVersion || '—',
        },
      })
    } catch {
      /* 忽略：系统信息不可用时不展示 */
    }
  },

  async loadDevices() {
    this.setData({ loading: true })
    try {
      // 拉取最近 100 条记录做聚合（设备数量有限，足够覆盖）
      const history = await syncApi.getSyncHistory({ page: 1, pageSize: HISTORY_PAGE_SIZE })
      const list = history?.list ?? []
      const map = new Map<string, DeviceAggregate>()
      for (const item of list) {
        const existing = map.get(item.deviceLabel)
        if (existing) {
          existing.count += 1
          if (new Date(item.createdAt) > new Date(existing.lastSeen)) {
            existing.lastSeen = item.createdAt
          }
          for (const c of item.categories) {
            if (!existing.categories.includes(c)) existing.categories.push(c)
          }
        } else {
          map.set(item.deviceLabel, {
            label: item.deviceLabel,
            count: 1,
            lastSeen: item.createdAt,
            categories: [...item.categories],
          })
        }
      }
      const devices = [...map.values()]
        .sort((a, b) => new Date(b.lastSeen).getTime() - new Date(a.lastSeen).getTime())
        .map((device): DeviceAggregateVM => ({
          label: device.label,
          count: device.count,
          lastSeenLabel: formatRelativeTime(device.lastSeen),
          categoryLabels: device.categories.map(categoryLabelOf),
        }))
      this.setData({ devices, total: history?.total ?? list.length })
    } catch (error) {
      wx.showToast({ title: (error as Error).message || '加载失败', icon: 'none' })
    } finally {
      this.setData({ loading: false })
    }
  },
})

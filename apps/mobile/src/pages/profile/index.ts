/**
 * 我的（tab）。
 *
 * 个人中心：头像/昵称管理、账号信息、修改密码入口、同步与设备入口、退出登录。
 */

import * as authApi from '../../api/auth'
import * as bridge from '../../api/bridge'
import { getConfig } from '../../config'
import { getState, logout, patchUser, subscribe } from '../../store/auth'
import { ensureAuthenticated } from '../../utils/auth-guard'
import { formatFullTime, maskAccount } from '../../utils/format'
import type { AuthUserInfo } from '../../types'

interface ProfilePageData {
  user: AuthUserInfo | null
  accountMasked: string
  /** 注册时间展示文案（WXML 不能调 formatFullTime，预计算） */
  createdAtLabel: string
  /** 头像占位首字母（WXML 不支持 .slice()，预计算） */
  avatarInitial: string
  serverUrl: string
  uploadingAvatar: boolean
  /** 小程序版本号（正式/体验版取后台版本，开发环境显示 dev） */
  appVersion: string
  // ── 远程会话 ──
  /** 云端中继开关（默认开：跨网络可用，无需同 Wi-Fi / 公网 IP） */
  relayEnabled: boolean
  /** 中继长连接是否已建立 */
  relayConnected: boolean
  /** 电脑端是否经中继在线（null = 还没收到服务端状态） */
  relayDesktopOnline: boolean | null
  /** WXML 不支持三元以外的表达，状态文案在这里预计算 */
  relayStatusLabel: string
  desktopStatusLabel: string
  bridgeUrlLabel: string
}

/** 读取小程序版本号；getAccountInfoSync 在低版本基础库可能缺失，失败回退 em dash */
function resolveAppVersion(): string {
  try {
    const account = wx.getAccountInfoSync()
    const { version, envVersion } = account.miniProgram
    if (version) return `v${version}`
    return envVersion === 'develop' ? 'dev' : '—'
  } catch {
    return '—'
  }
}

let unsubscribeUserUpdated: (() => void) | null = null

Page({
  data: {
    user: null,
    accountMasked: '',
    createdAtLabel: '—',
    avatarInitial: 'S',
    serverUrl: '',
    uploadingAvatar: false,
    appVersion: '—',
    relayEnabled: true,
    relayConnected: false,
    relayDesktopOnline: null,
    relayStatusLabel: '未连接',
    desktopStatusLabel: '—',
    bridgeUrlLabel: '未设置',
  } as ProfilePageData,

  onShow() {
    if (!ensureAuthenticated()) return
    if (!unsubscribeUserUpdated) {
      unsubscribeUserUpdated = subscribe('user-updated', () => this.applyUser())
    }
    this.applyUser()
    this.setData({ serverUrl: getConfig().baseUrl, appVersion: resolveAppVersion() })
    this.applyRelayState()
  },

  /** 中继状态：连接状态与电脑端在线状态都只做展示，不阻塞页面 */
  applyRelayState() {
    const enabled = bridge.isRelayEnabled()
    const connected = bridge.isRelayConnected()
    const online = bridge.isRelayDesktopOnline()
    const bridgeUrl = bridge.getServerUrl()
    this.setData({
      relayEnabled: enabled,
      relayConnected: connected,
      relayDesktopOnline: online,
      relayStatusLabel: !enabled ? '已关闭（走局域网直连）' : connected ? '已连接' : '未连接',
      desktopStatusLabel: online == null ? '未知' : online ? '在线' : '离线',
      bridgeUrlLabel: bridgeUrl || '未设置',
    })
  },

  onToggleRelay(e: WechatMiniprogram.SwitchChange) {
    const enabled = e.detail.value === true
    bridge.setRelayEnabled(enabled)
    this.applyRelayState()
    wx.showToast({
      title: enabled ? '已开启云端中继' : '已切换到局域网直连',
      icon: 'none',
    })
  },

  /** 关闭中继后需要手填局域网地址；这里复用一个简易输入弹窗 */
  onEditBridgeUrl() {
    wx.showModal({
      title: '局域网直连地址',
      content: bridge.getServerUrl(),
      editable: true,
      placeholderText: '如 http://192.168.1.5:3721',
      success: (res) => {
        if (!res.confirm) return
        const text = (res.content ?? '').trim()
        if (!text) {
          bridge.setServerUrl('')
          this.applyRelayState()
          return
        }
        const url = bridge.normalizeBridgeUrl(text)
        if (!url) {
          wx.showToast({ title: '地址格式如 http://192.168.1.5:3721', icon: 'none' })
          return
        }
        bridge.setServerUrl(url)
        this.applyRelayState()
      },
    })
  },

  onUnload() {
    unsubscribeUserUpdated?.()
    unsubscribeUserUpdated = null
  },

  applyUser() {
    const user = getState().user
    const nickname = user?.nickname?.trim()
    const account = user?.account?.trim() || ''
    this.setData({
      user,
      accountMasked: user ? maskAccount(user.account) : '',
      createdAtLabel: user?.createdAt ? formatFullTime(user.createdAt) : '—',
      avatarInitial: nickname
        ? nickname.slice(0, 1)
        : account
          ? account.slice(0, 1).toUpperCase()
          : 'S',
    })
  },

  // ─── 头像 ───────────────────────────────────────────────────────────────────

  onChangeAvatar() {
    if (this.data.uploadingAvatar) return
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sizeType: ['compressed'],
      sourceType: ['album', 'camera'],
      success: (res) => {
        const file = res.tempFiles[0]
        if (!file?.tempFilePath) return
        // 限制 5MB
        if (file.size && file.size > 5 * 1024 * 1024) {
          wx.showToast({ title: '图片不能超过 5MB', icon: 'none' })
          return
        }
        this.setData({ uploadingAvatar: true })
        authApi
          .uploadAvatar(file.tempFilePath)
          .then((data) => {
            patchUser({ avatarUrl: data.avatarUrl })
            wx.showToast({ title: '头像已更新', icon: 'success' })
          })
          .catch((error: Error) => {
            wx.showToast({ title: error.message || '上传失败', icon: 'none' })
          })
          .finally(() => this.setData({ uploadingAvatar: false }))
      },
    })
  },

  // ─── 昵称 ───────────────────────────────────────────────────────────────────

  onEditNickname() {
    const current = this.data.user?.nickname || ''
    wx.showModal({
      title: '修改昵称',
      editable: true,
      placeholderText: '请输入新昵称（20 字以内）',
      content: current,
      success: (res) => {
        if (!res.confirm) return
        const nickname = (res.content || '').trim()
        if (!nickname) {
          wx.showToast({ title: '昵称不能为空', icon: 'none' })
          return
        }
        authApi
          .updateMe({ nickname })
          .then(() => {
            patchUser({ nickname })
            wx.showToast({ title: '已更新', icon: 'success' })
          })
          .catch((error: Error) => {
            wx.showToast({ title: error.message || '更新失败', icon: 'none' })
          })
      },
    })
  },

  // ─── 导航 ───────────────────────────────────────────────────────────────────

  onGoSessions() {
    wx.navigateTo({ url: '/pages/project-sessions/index' })
  },

  onGoSync() {
    wx.navigateTo({ url: '/pages/sync/index' })
  },

  onGoDevices() {
    wx.navigateTo({ url: '/pages/devices/index' })
  },

  onGoChangePassword() {
    wx.navigateTo({ url: '/pages/password/index' })
  },

  // ─── 退出 ───────────────────────────────────────────────────────────────────

  onLogout() {
    wx.showModal({
      title: '退出登录',
      content: '退出后本地保存的登录状态将被清除，可重新登录。',
      confirmText: '退出',
      confirmColor: '#ef4444',
      success: (res) => {
        if (!res.confirm) return
        void logout()
      },
    })
  },
})

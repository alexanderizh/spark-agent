/**
 * 我的（tab）。
 *
 * 个人中心：头像/昵称管理、账号信息、修改密码入口、同步与设备入口、退出登录。
 */

import * as authApi from '../../api/auth'
import { getConfig } from '../../config'
import { getState, logout, patchUser, subscribe } from '../../store/auth'
import { ensureAuthenticated } from '../../utils/auth-guard'
import { formatFullTime, maskAccount } from '../../utils/format'
import type { AuthUserInfo } from '../../types'

interface ProfilePageData {
  user: AuthUserInfo | null
  accountMasked: string
  serverUrl: string
  uploadingAvatar: boolean
}

let unsubscribeUserUpdated: (() => void) | null = null

Page({
  data: {
    user: null,
    accountMasked: '',
    serverUrl: '',
    uploadingAvatar: false,
  } as ProfilePageData,

  onShow() {
    if (!ensureAuthenticated()) return
    if (!unsubscribeUserUpdated) {
      unsubscribeUserUpdated = subscribe('user-updated', () => this.applyUser())
    }
    this.applyUser()
    this.setData({ serverUrl: getConfig().baseUrl })
  },

  onUnload() {
    unsubscribeUserUpdated?.()
    unsubscribeUserUpdated = null
  },

  applyUser() {
    const user = getState().user
    this.setData({ user, accountMasked: user ? maskAccount(user.account) : '' })
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

  onGoSync() {
    wx.switchTab({ url: '/pages/sync/index' })
  },

  onGoDevices() {
    wx.switchTab({ url: '/pages/devices/index' })
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

  methods: {
    formatFullTime,
    /** 头像占位首字母（WXML 不支持数据对象 .slice()） */
    avatarInitial(): string {
      const nickname = this.data.user?.nickname?.trim()
      if (nickname) return nickname.slice(0, 1)
      const account = this.data.user?.account?.trim()
      return account ? account.slice(0, 1).toUpperCase() : 'S'
    },
  },
})

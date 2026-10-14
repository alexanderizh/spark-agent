/**
 * 启动分流页（不在 tabBar）。
 *
 * 小程序默认打开 pages 数组的第一个页面，这里同步决策：
 *   有 token → 工作台（首页会经 API 校验，无效再跳登录）
 *   无 token → 登录页
 * 避免未登录用户看到工作台内容、或已登录用户看到登录页闪烁。
 *
 * 注意：本页**必须有可见内容**。曾经这里是一个透明中转页，一旦 reLaunch 失败
 * 就表现为「整页白屏」，既无法使用也无法定位。现在改为品牌启动页 + 失败兜底：
 * 跳转失败或超时会显示错误原因与「重试」按钮。
 */

import { getItem, StorageKeys } from '../../utils/storage'

const REDIRECT_TIMEOUT_MS = 3000

Page({
  data: {
    hint: '正在进入…',
    failed: false,
  },

  onLoad() {
    this.go()
  },

  go() {
    const token = getItem<string>(StorageKeys.token)
    const url = token ? '/pages/home/index' : '/pages/login/index'
    this.setData({ hint: '正在进入…', failed: false })

    let settled = false
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      this.setData({ hint: '跳转超时，请点下方重试', failed: true })
    }, REDIRECT_TIMEOUT_MS)

    wx.reLaunch({
      url,
      success: () => {
        settled = true
        clearTimeout(timer)
      },
      fail: (err) => {
        settled = true
        clearTimeout(timer)
        this.setData({
          hint: `跳转失败：${(err && err.errMsg) || '未知错误'}`,
          failed: true,
        })
      },
    })
  },
})

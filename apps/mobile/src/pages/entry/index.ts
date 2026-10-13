/**
 * 启动分流页（不在 tabBar，无 UI）。
 *
 * 小程序默认打开 pages 数组的第一个页面，这里用一个透明中转页同步决策：
 *   有 token → 工作台（首页会经 API 校验，无效再跳登录）
 *   无 token → 登录页
 * 避免未登录用户看到工作台内容、或已登录用户看到登录页闪烁。
 */

import { getItem, StorageKeys } from '../../utils/storage'

Page({
  onLoad() {
    const token = getItem<string>(StorageKeys.token)
    wx.reLaunch({
      url: token ? '/pages/home/index' : '/pages/login/index',
    })
  },
})

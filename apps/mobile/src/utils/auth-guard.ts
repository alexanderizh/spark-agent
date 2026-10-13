/**
 * 页面级登录守卫。
 *
 * tab 页在 onShow 调用：本地无 token 直接回登录页（token 有效性由各页 API 调用兜底，
 * 401 会经 store/auth 的 session-expired 统一跳转）。
 */

import { getItem, StorageKeys } from './storage'

export function ensureAuthenticated(): boolean {
  const token = getItem<string>(StorageKeys.token)
  if (token) return true
  wx.reLaunch({ url: '/pages/login/index' })
  return false
}

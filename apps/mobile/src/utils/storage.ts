/**
 * 本地存储封装（wx.storage 同步 API + 命名空间前缀）。
 *
 * 密钥统一前缀 spark-mobile:，避免与宿主小程序其他存储冲突。
 */

const PREFIX = 'spark-mobile:'

export const StorageKeys = {
  token: `${PREFIX}token`,
  refreshToken: `${PREFIX}refresh-token`,
  userId: `${PREFIX}user-id`,
  user: `${PREFIX}user`,
  /** 聊天页是否隐藏工具调用与思考记录（本地偏好，跨会话生效；复用历史键名） */
  chatHideToolEvents: `${PREFIX}chat-hide-tool-events`,
  /** 会话列表「置顶」分组折叠状态（本地偏好；值为 `${deviceId}/${projectId}` → 是否折叠 的映射） */
  sessionListPinnedCollapsed: `${PREFIX}session-list-pinned-collapsed`,
} as const

export function getItem<T>(key: string): T | null {
  try {
    const value = wx.getStorageSync(key)
    return (value ?? null) as T | null
  } catch {
    return null
  }
}

export function setItem(key: string, value: unknown): void {
  try {
    wx.setStorageSync(key, value)
  } catch {
    // 存储失败（超出 10MB 上限等）不阻塞业务流程
  }
}

export function removeItem(key: string): void {
  try {
    wx.removeStorageSync(key)
  } catch {
    /* noop */
  }
}

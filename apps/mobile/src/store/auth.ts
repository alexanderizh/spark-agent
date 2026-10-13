/**
 * 全局登录态 store。
 *
 * 小程序没有跨页面响应式 store，这里用「App globalData + 事件订阅」的轻量模式：
 *   - 登录态持久化在 wx.storage（token/refreshToken/user）
 *   - 页面通过 subscribe() 监听 login / logout / user-updated，在 onShow 里按需刷新
 */

import * as authApi from '../api/auth'
import { clearSession, saveSession, setSessionExpiredHandler } from '../api/request'
import { getItem, setItem, StorageKeys } from '../utils/storage'
import type { AuthSession, AuthUserInfo } from '../types'

type StoreEvent = 'login' | 'logout' | 'user-updated'

interface AuthState {
  user: AuthUserInfo | null
  isAuthenticated: boolean
  /** bootstrap 是否已完成（避免登录页闪烁） */
  ready: boolean
}

const state: AuthState = {
  user: getItem<AuthUserInfo>(StorageKeys.user),
  isAuthenticated: getItem<string>(StorageKeys.token) != null,
  ready: false,
}

const listeners = new Map<StoreEvent, Set<() => void>>()

function emit(event: StoreEvent): void {
  listeners.get(event)?.forEach((fn) => {
    try {
      fn()
    } catch {
      /* 订阅者异常不波及其他订阅者 */
    }
  })
}

export function subscribe(event: StoreEvent, fn: () => void): () => void {
  let set = listeners.get(event)
  if (!set) {
    set = new Set()
    listeners.set(event, set)
  }
  set.add(fn)
  return () => {
    listeners.get(event)?.delete(fn)
  }
}

export function getState(): Readonly<AuthState> {
  return state
}

/** 启动时调用：已有 token 则调 /me 验证有效性 */
export async function bootstrap(): Promise<void> {
  setSessionExpiredHandler(() => {
    handleExpired()
  })
  if (!state.isAuthenticated) {
    state.ready = true
    return
  }
  try {
    const user = await authApi.getMe()
    state.user = user
    setItem(StorageKeys.user, user)
  } catch {
    // token 无效：request 层已清理会话
    state.user = null
    state.isAuthenticated = false
  }
  state.ready = true
}

function persistSession(session: AuthSession): void {
  saveSession(session)
  state.isAuthenticated = true
}

export async function loginWithSession(session: AuthSession): Promise<AuthUserInfo> {
  persistSession(session)
  const user = await authApi.getMe()
  state.user = user
  setItem(StorageKeys.user, user)
  emit('login')
  return user
}

export async function logout(): Promise<void> {
  try {
    await authApi.logout()
  } catch {
    // 退出接口失败也继续本地清理（token 可能已过期）
  }
  clearSession()
  state.user = null
  state.isAuthenticated = false
  emit('logout')
}

/** 会话过期（401 刷新失败）统一处理：清态 + 通知 + 跳登录页 */
function handleExpired(): void {
  clearSession()
  state.user = null
  state.isAuthenticated = false
  emit('logout')
  wx.reLaunch({ url: '/pages/login/index' })
}

/** 本地更新用户信息（昵称/头像修改后） */
export function patchUser(patch: Partial<AuthUserInfo>): void {
  if (!state.user) return
  state.user = { ...state.user, ...patch }
  setItem(StorageKeys.user, state.user)
  emit('user-updated')
}

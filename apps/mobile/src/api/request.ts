/**
 * 统一请求层。
 *
 * 行为与桌面端 EduServerClient（apps/desktop/src/main/services/Auth/EduServerClient.ts）对齐：
 *   1. 自动附加 Authorization: Bearer <token>
 *   2. 401 → 用 refreshToken 调 /auth/refresh，成功后重试原请求（并发请求共用同一次刷新）
 *   3. 刷新失败 → 清理本地会话并触发 session-expired 回调（页面跳登录页）
 *   4. 业务 code !== 0 → 以 message 抛错（edu-server 统一 { code, data, message } 包装）
 */

import { getConfig } from '../config'
import { getItem, removeItem, setItem, StorageKeys } from '../utils/storage'
import type { AuthSession } from '../types'

const DEFAULT_TIMEOUT = 30_000

/** 会话过期回调（由 store/auth 注册：清登录态 + 跳登录页） */
let onSessionExpired: (() => void) | null = null

export function setSessionExpiredHandler(handler: (() => void) | null): void {
  onSessionExpired = handler
}

/** 刷新并发锁：多个 401 同时触发时只发一次 refresh */
let refreshInflight: Promise<string | null> | null = null

function getToken(): string | null {
  return getItem<string>(StorageKeys.token)
}

function buildUrl(path: string): string {
  const { baseUrl, apiPrefix } = getConfig()
  const p = path.startsWith('/') ? path : `/${path}`
  // 与 EduServerClient.resolveUrl 一致：已带 /api/ 前缀的路径不重复拼接
  const full = p.startsWith('/api/') ? `${baseUrl}${p}` : `${baseUrl}${apiPrefix}${p}`
  return full
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly code?: number,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

async function tryRefresh(): Promise<string | null> {
  if (refreshInflight) return refreshInflight
  refreshInflight = (async () => {
    const refreshToken = getItem<string>(StorageKeys.refreshToken)
    if (!refreshToken) return null
    try {
      const res = await new Promise<{ statusCode: number; data: unknown }>((resolve, reject) => {
        wx.request({
          url: buildUrl('/auth/refresh'),
          method: 'POST',
          timeout: DEFAULT_TIMEOUT,
          data: { refreshToken },
          header: { 'Content-Type': 'application/json' },
          success: resolve,
          fail: reject,
        })
      })
      const body = res.data as { code?: number; data?: AuthSession; message?: string } | null
      if (res.statusCode !== 200 || body?.code !== 0 || !body.data?.token) return null
      const session = body.data
      setItem(StorageKeys.token, session.token)
      setItem(StorageKeys.refreshToken, session.refreshToken)
      setItem(StorageKeys.userId, session.userId)
      return session.token
    } catch {
      return null
    } finally {
      refreshInflight = null
    }
  })()
  return refreshInflight
}

export interface RequestOptions {
  /** wx.request 的 method 不含 PATCH（typings 约束）；本端 API 也未用到 */
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE'
  data?: Record<string, unknown>
  /** 跳过 Authorization（登录/注册/刷新等公开接口） */
  skipAuth?: boolean
  /** 显示全局 loading */
  loading?: boolean | string
  timeout?: number
}

/** 解析 edu-server 的 { code, data, message } 包装；code !== 0 视为业务错误 */
function unwrap<T>(statusCode: number, raw: unknown): T {
  const body = raw as { code?: number; data?: T; message?: string } | null
  if (statusCode !== 200) {
    throw new ApiError(body?.message ?? `请求失败 (${statusCode})`, statusCode)
  }
  if (body == null || typeof body !== 'object') {
    throw new ApiError('响应格式异常', statusCode)
  }
  if (body.code !== 0) {
    throw new ApiError(body.message ?? `请求失败 (${body.code})`, statusCode, body.code)
  }
  return body.data as T
}

export function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const {
    method = 'GET',
    data,
    skipAuth = false,
    loading = false,
    timeout = DEFAULT_TIMEOUT,
  } = options
  const showLoading = typeof loading === 'string' ? loading : loading ? '加载中…' : null

  const doFetch = (token: string | null) =>
    new Promise<{ statusCode: number; data: unknown }>((resolve, reject) => {
      const header: Record<string, string> = { 'Content-Type': 'application/json' }
      if (!skipAuth && token) header.Authorization = `Bearer ${token}`
      if (showLoading) wx.showLoading({ title: showLoading, mask: true })
      wx.request({
        url: buildUrl(path),
        method,
        timeout,
        data,
        header,
        success: resolve,
        fail: (err) => reject(new ApiError(err.errMsg || '网络请求失败')),
        complete: () => {
          if (showLoading) wx.hideLoading()
        },
      })
    })

  const run = async (retryOn401: boolean): Promise<T> => {
    let res = await doFetch(skipAuth ? null : getToken())

    if (res.statusCode === 401 && !skipAuth && retryOn401) {
      const refreshed = await tryRefresh()
      if (refreshed) {
        res = await doFetch(refreshed)
      } else {
        clearSession()
        onSessionExpired?.()
        throw new ApiError('登录已过期，请重新登录', 401)
      }
      // 二次 401：再刷新一次（refresh 返回的 token 立刻又过期的极端情况）
      if (res.statusCode === 401) {
        const refreshed2 = await tryRefresh()
        if (refreshed2) {
          res = await doFetch(refreshed2)
        } else {
          clearSession()
          onSessionExpired?.()
          throw new ApiError('登录已过期，请重新登录', 401)
        }
      }
    }
    return unwrap<T>(res.statusCode, res.data)
  }

  return run(true)
}

/** 清理本地会话（不触发回调，供主动退出使用） */
export function clearSession(): void {
  removeItem(StorageKeys.token)
  removeItem(StorageKeys.refreshToken)
  removeItem(StorageKeys.userId)
  removeItem(StorageKeys.user)
}

/** 保存登录会话 */
export function saveSession(session: AuthSession): void {
  setItem(StorageKeys.token, session.token)
  setItem(StorageKeys.refreshToken, session.refreshToken)
  setItem(StorageKeys.userId, session.userId)
}

/**
 * 文件上传（multipart → POST /me/avatar）。
 * 小程序用 wx.uploadFile，注意其 success 的 data 是字符串，需自行 JSON.parse。
 */
export function uploadFile<T>(path: string, filePath: string, formField = 'file'): Promise<T> {
  const token = getToken()
  return new Promise<T>((resolve, reject) => {
    wx.uploadFile({
      url: buildUrl(path),
      filePath,
      name: formField,
      timeout: 300_000,
      header: token ? { Authorization: `Bearer ${token}` } : {},
      success: (res) => {
        try {
          if (res.statusCode === 401) {
            reject(new ApiError('登录已过期，请重新登录', 401))
            return
          }
          const parsed = JSON.parse(res.data) as { code?: number; data?: T; message?: string }
          if (parsed.code !== 0) {
            reject(new ApiError(parsed.message ?? '上传失败', res.statusCode))
            return
          }
          resolve(parsed.data as T)
        } catch (e) {
          reject(new ApiError((e as Error).message || '上传响应解析失败', res.statusCode))
        }
      },
      fail: (err) => reject(new ApiError(err.errMsg || '上传失败')),
    })
  })
}

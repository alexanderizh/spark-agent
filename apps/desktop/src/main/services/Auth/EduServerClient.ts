/**
 * EduServerClient — spark-edugen/edu-server HTTP 客户端
 *
 * 核心能力：
 *   1. 统一 base URL（支持运行时切换）
 *   2. POST/GET/PUT/DELETE/PATCH 包装，自动处理 edu-server 的 { code, data, message } 响应
 *   3. 401 自动用 refreshToken 续期，续期成功后重试原请求（并发请求复用同一 promise）
 *   4. 续期失败时调用 onSessionExpired 回调（推送 stream:auth:session-expired）
 *   5. 统一超时控制
 *
 * 不做：
 *   - 业务编排（那是 AuthService 的事）
 *   - token 存储（那是 TokenStore 的事）
 */

import { createLogger, normalizeEduAssetUrl, SparkError } from '@spark/shared'
import type { AuthSession, AuthUploadFileResponse } from '@spark/protocol'
import type { EduApiResult } from './types'
import type { TokenStore } from './TokenStore'

const log = createLogger('auth:edu-client')

export interface EduServerClientOptions {
  defaultBaseUrl: string
  tokenStore: TokenStore
  /** session 过期回调（refresh 也失败）*/
  onSessionExpired: () => void
  /** token 续期成功回调（推送 stream:auth:token-refreshed）*/
  onTokenRefreshed: (session: AuthSession) => void
  /** 请求超时（毫秒）*/
  requestTimeoutMs?: number
}

/** refresh 并发锁：多个 401 请求同时触发时，只发一次 refresh 请求 */
let refreshInflight: Promise<AuthSession | null> | null = null

export class EduServerClient {
  private baseUrl: string
  private readonly defaultBaseUrl: string
  private readonly tokenStore: TokenStore
  private readonly onSessionExpired: () => void
  private readonly onTokenRefreshed: (session: AuthSession) => void
  private readonly timeoutMs: number

  constructor(opts: EduServerClientOptions) {
    this.defaultBaseUrl = opts.defaultBaseUrl
    this.baseUrl = opts.defaultBaseUrl
    this.tokenStore = opts.tokenStore
    this.onSessionExpired = opts.onSessionExpired
    this.onTokenRefreshed = opts.onTokenRefreshed
    this.timeoutMs = opts.requestTimeoutMs ?? 30_000
  }

  /** 获取当前 base URL */
  getBaseUrl(): string {
    return this.baseUrl
  }

  /** 重置 base URL（设置页切换环境时使用）*/
  setBaseUrl(url: string): void {
    this.baseUrl = normalizeBaseUrl(url)
    log.info(`base URL updated to: ${this.baseUrl}`)
  }

  /**
   * 执行请求并自动处理 401 refresh。
   *
   * 返回 `EduApiResult.data`，抛错时表示 HTTP 层错误或业务 code !== 0。
   * 注意：401 refresh 后重试如果再次 401，会再尝试一次 refresh（防止 refresh 返回的 token 当时已经过期）。
   */
  async request<T = unknown>(
    method: string,
    path: string,
    body?: unknown,
    options?: { skipAuth?: boolean; raw?: boolean },
  ): Promise<T> {
    const doFetch = (token?: string) => this.rawFetch(method, path, body, token, options?.skipAuth)

    let res = await doFetch(this.tokenStore.get().token)

    // 401 → 尝试 refresh 重试
    if (res.status === 401 && !options?.skipAuth) {
      const refreshed = await this.tryRefresh()
      if (refreshed) {
        res = await doFetch(refreshed.token)
      } else {
        // refresh 失败：触发 session-expired 回调
        this.onSessionExpired()
        const json = await safeParseJson<EduApiResult<unknown>>(res)
        throw new SparkError('UNKNOWN', json?.message ?? '登录已过期，请重新登录')
      }

      // 二次 401：再 refresh 一次（极少见：refresh 后 token 立刻又过期）
      if (res.status === 401) {
        const refreshed2 = await this.tryRefresh()
        if (refreshed2) {
          res = await doFetch(refreshed2.token)
        } else {
          this.onSessionExpired()
          const json = await safeParseJson<EduApiResult<unknown>>(res)
          throw new SparkError('UNKNOWN', json?.message ?? '登录已过期，请重新登录')
        }
      }
    }

    const json = await safeParseJson<EduApiResult<T>>(res)

    // options.raw 直接返回整个 ApiResult（用于兼容特殊场景，比如 captcha 不走标准 code 0）
    if (options?.raw) {
      return json as unknown as T
    }

    if (json?.code !== 0) {
      // 后端业务错误（如「图片验证码已过期」「账号尚未设置密码」）：以 SparkError 透传 message，
      // 否则 IPC 层会把普通 Error 的 message 抹成 "An internal error occurred"，用户看不到真实原因。
      throw new SparkError('UNKNOWN', json?.message ?? `请求失败 (${res.status})`)
    }
    return (json?.data ?? (undefined as unknown)) as T
  }

  /** 原始 fetch（不处理 401，业务自己负责）*/
  async rawFetch(
    method: string,
    path: string,
    body: unknown,
    token: string | undefined,
    skipAuth: boolean | undefined,
  ): Promise<Response> {
    const url = this.resolveUrl(path)
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    }
    if (!skipAuth && token) {
      headers.Authorization = `Bearer ${token}`
    }
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.timeoutMs)
    try {
      return await fetch(url, {
        method,
        headers,
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
        signal: controller.signal,
      })
    } finally {
      clearTimeout(timer)
    }
  }

  // ─── 公开方法（业务层使用）─────────────────────────────────────────────────────

  get<T = unknown>(path: string, options?: { skipAuth?: boolean }): Promise<T> {
    return this.request<T>('GET', path, undefined, options)
  }

  post<T = unknown>(path: string, body?: unknown, options?: { skipAuth?: boolean }): Promise<T> {
    return this.request<T>('POST', path, body, options)
  }

  put<T = unknown>(path: string, body?: unknown, options?: { skipAuth?: boolean }): Promise<T> {
    return this.request<T>('PUT', path, body, options)
  }

  delete<T = unknown>(path: string, options?: { skipAuth?: boolean }): Promise<T> {
    return this.request<T>('DELETE', path, undefined, options)
  }

  patch<T = unknown>(path: string, body?: unknown, options?: { skipAuth?: boolean }): Promise<T> {
    return this.request<T>('PATCH', path, body, options)
  }

  async uploadFile(
    input: { buffer: Buffer; fileName: string; mimeType?: string },
  ): Promise<AuthUploadFileResponse> {
    const doUpload = (token?: string) => this.rawUpload('/upload', input, token)
    let res = await doUpload(this.tokenStore.get().token)
    if (res.status === 401) {
      const refreshed = await this.tryRefresh()
      if (refreshed) {
        res = await doUpload(refreshed.token)
      } else {
        this.onSessionExpired()
        const json = await safeParseJson<EduApiResult<unknown>>(res)
        throw new SparkError('UNKNOWN', json?.message ?? '登录已过期，请重新登录')
      }
    }
    const json = await safeParseJson<EduApiResult<AuthUploadFileResponse>>(res)
    if (json?.code !== 0) {
      throw new SparkError('UNKNOWN', json?.message ?? `上传失败 (${res.status})`)
    }
    const data = json?.data
    if (!data?.aiUrl || !data.fileKey) {
      throw new SparkError('UNKNOWN', '上传响应缺少 aiUrl/fileKey')
    }
    return {
      ...data,
      fileName: data.fileName || input.fileName,
      staticUrl: normalizeEduAssetUrl(data.staticUrl || data.fileUrl || data.aiUrl),
      aiUrl: normalizeEduAssetUrl(data.aiUrl),
      ...(data.fileUrl ? { fileUrl: normalizeEduAssetUrl(data.fileUrl) } : {}),
    }
  }

  /**
   * 上传/更新当前用户头像（multipart → POST /me/avatar）。
   * edu-server 会把文件落到对象存储并写入 user.avatarUrl，返回完整 avatarUrl。
   * 与 uploadFile 的区别：这是用户档案专用接口，服务端直接落库并返回单个 URL。
   */
  async uploadAvatar(
    input: { buffer: Buffer; fileName: string; mimeType?: string },
  ): Promise<{ avatarUrl: string }> {
    const doUpload = (token?: string) => this.rawUpload('/me/avatar', input, token)
    let res = await doUpload(this.tokenStore.get().token)
    if (res.status === 401) {
      const refreshed = await this.tryRefresh()
      if (refreshed) {
        res = await doUpload(refreshed.token)
      } else {
        this.onSessionExpired()
        const json = await safeParseJson<EduApiResult<unknown>>(res)
        throw new SparkError('UNKNOWN', json?.message ?? '登录已过期，请重新登录')
      }
    }
    const json = await safeParseJson<EduApiResult<{ avatarUrl: string }>>(res)
    if (json?.code !== 0) {
      throw new SparkError('UNKNOWN', json?.message ?? `头像上传失败 (${res.status})`)
    }
    const data = json?.data
    if (!data?.avatarUrl) {
      throw new SparkError('UNKNOWN', '头像上传响应缺少 avatarUrl')
    }
    return { avatarUrl: normalizeEduAssetUrl(data.avatarUrl) }
  }

  // ─── 内部：refresh ────────────────────────────────────────────────────────────

  /**
   * 公开版 tryRefresh — 供 AuthService.forceRefresh 在用户主动触发续期时使用。
   * 逻辑与内部 tryRefresh 一致（共用同一个 inflight lock）。
   */
  async tryRefreshPublic(): Promise<AuthSession | null> {
    return this.tryRefresh()
  }

  /**
   * 尝试用 refreshToken 续期。
   * 多个并发请求只触发一次 refresh（inflight promise 复用）。
   * 返回新会话或 null（续期失败）。
   */
  private async tryRefresh(): Promise<AuthSession | null> {
    if (refreshInflight) return refreshInflight

    refreshInflight = (async () => {
      const rt = this.tokenStore.get().refreshToken
      if (!rt) return null

      try {
        // refresh 本身不走 401 重试（会死循环）
        const res = await this.rawFetch('POST', '/auth/refresh', { refreshToken: rt }, undefined, true)
        const json = await safeParseJson<EduApiResult<AuthSession>>(res)
        if (json?.code !== 0 || !json?.data?.token) return null

        await this.tokenStore.save(json.data)
        this.onTokenRefreshed(json.data)
        log.info('refresh succeeded')
        return json.data
      } catch (e) {
        log.warn(`refresh failed: ${(e as Error).message}`)
        return null
      } finally {
        refreshInflight = null
      }
    })()

    return refreshInflight
  }

  private resolveUrl(path: string): string {
    const base = this.baseUrl.replace(/\/$/, '')
    const p = path.startsWith('/') ? path : `/${path}`
    // edu-server 统一前缀 /api/v1
    if (p.startsWith('/api/')) return `${base}${p}`
    return `${base}/api/v1${p}`
  }

  private async rawUpload(
    path: string,
    input: { buffer: Buffer; fileName: string; mimeType?: string },
    token: string | undefined,
  ): Promise<Response> {
    const url = this.resolveUrl(path)
    const form = new FormData()
    const bytes = new Uint8Array(input.buffer)
    form.append('file', new Blob([bytes], { type: input.mimeType ?? 'application/octet-stream' }), input.fileName)
    const headers: Record<string, string> = { Accept: 'application/json' }
    if (token) headers.Authorization = `Bearer ${token}`
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.timeoutMs)
    try {
      return await fetch(url, {
        method: 'POST',
        headers,
        body: form,
        signal: controller.signal,
      })
    } finally {
      clearTimeout(timer)
    }
  }
}

function normalizeBaseUrl(url: string): string {
  return url.trim().replace(/\/$/, '')
}

async function safeParseJson<T>(res: Response): Promise<T | null> {
  try {
    const ct = res.headers.get('content-type') ?? ''
    if (!ct.includes('application/json')) {
      // 非 JSON 响应（HTML 错误页等），包装成 EduApiResult 错误
      return { code: res.status, message: `请求失败 (${res.status})` } as unknown as T
    }
    return (await res.json()) as T
  } catch {
    return null
  }
}

/** 仅在测试中重置 refresh 锁 */
export function __resetRefreshLock(): void {
  refreshInflight = null
}

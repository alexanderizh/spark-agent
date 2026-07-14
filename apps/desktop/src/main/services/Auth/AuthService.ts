/**
 * AuthService — 业务编排层
 *
 * 职责：
 *   - 启动时从 keytar 加载会话
 *   - 暴露登录/注册/退出/微信扫码等业务方法
 *   - 跟踪当前登录状态（用于渲染端订阅 stream:auth:state-changed）
 *
 * 不做：
 *   - HTTP 细节（EduServerClient 负责）
 *   - 凭证存储（TokenStore 负责）
 *   - IPC 路由（registerAuthIpc 负责）
 */

import { createLogger, SparkError } from '@spark/shared'
import { readFile } from 'node:fs/promises'
import { basename, extname } from 'node:path'
import type {
  AuthCaptchaResponse,
  AuthChangePasswordResponse,
  AuthLoginResponse,
  AuthMeResponse,
  AuthRegisterResponse,
  AuthSession,
  AuthBindStatusResponse,
  AuthWechatQrResponse,
  AuthWechatPollResponse,
  AuthWechatBindEmailSendCodeResponse,
  AuthWechatBindEmailResponse,
  AuthBootstrapResponse,
  AuthUploadFileResponse,
  AuthUpdateMeResponse,
  AuthLoginSmsResponse,
  AuthClientConfigResponse,
} from '@spark/protocol'
import { EduServerClient } from './EduServerClient'
import { TokenStore } from './TokenStore'
import type { AuthServiceConfig, BaseUrlSource } from './types'
import type { IpcStreamChannel, IpcStreamPayload } from '@spark/protocol'
import { sendToMainWindow } from '../../windows/index.js'

const log = createLogger('auth:service')

export class AuthService {
  private readonly tokenStore: TokenStore
  private readonly client: EduServerClient
  private readonly config: AuthServiceConfig
  private baseUrlSource: BaseUrlSource = 'default'
  private readonly logoutHooks = new Set<(userId: string | null) => Promise<void>>()
  private readonly loginHooks = new Set<(userId: string) => Promise<void>>()
  private sessionExpiryCleanup: Promise<void> | null = null

  constructor(config: AuthServiceConfig) {
    this.config = config
    this.tokenStore = new TokenStore(config.keytarService)
    this.client = new EduServerClient({
      defaultBaseUrl: config.defaultBaseUrl,
      tokenStore: this.tokenStore,
      ...(config.requestTimeoutMs !== undefined
        ? { requestTimeoutMs: config.requestTimeoutMs }
        : {}),
      onSessionExpired: () => this.handleSessionExpired(),
      onTokenRefreshed: (session) => this.handleTokenRefreshed(session),
    })
  }

  // ─── 生命周期 ─────────────────────────────────────────────────────────────────

  /** 启动：从 keytar 加载会话 */
  async start(): Promise<void> {
    await this.tokenStore.load()
    log.info(
      `auth service started, isAuthenticated=${this.tokenStore.isAuthenticated()}`,
    )
  }

  /** 启动后尝试自动登录（验证已存 token 是否仍有效）*/
  async bootstrap(): Promise<AuthBootstrapResponse> {
    if (!this.tokenStore.isAuthenticated()) {
      const lastError = this.tokenStore.getLastError()
      const base: AuthBootstrapResponse = {
        isAuthenticated: false,
        baseUrl: this.client.getBaseUrl(),
        reason: 'no-session',
        keytarAvailable: this.tokenStore.isPersistent(),
      }
      return lastError ? { ...base, keytarError: lastError } : base
    }

    try {
      const me = await this.client.get<AuthMeResponse>('/me')
      this.emitStateChanged(true, me.id.toString())
      await this.notifyLoginHooks(me.id.toString())
      return { isAuthenticated: true, user: me, baseUrl: this.client.getBaseUrl() }
    } catch (e) {
      const msg = (e as Error).message
      // me 失败可能是 refresh 后又失败（EduServerClient 已处理 onSessionExpired）
      // 也可能是网络问题，这里都按未登录处理
      log.warn(`bootstrap failed: ${msg}`)
      return {
        isAuthenticated: false,
        baseUrl: this.client.getBaseUrl(),
        reason: msg.includes('登录已过期') ? 'refresh-failed' : 'me-fetch-failed',
        keytarAvailable: this.tokenStore.isPersistent(),
      }
    }
  }

  // ─── 公开方法 ─────────────────────────────────────────────────────────────────

  getCaptcha = async (): Promise<AuthCaptchaResponse> => {
    // captcha 接口不强制走标准 code 0；edu-server 返回 { code:0, data:{id,svg} }
    return this.client.get<AuthCaptchaResponse>('/auth/captcha', { skipAuth: true })
  }

  sendCode = async (params: {
    account: string
    type: 'register' | 'login'
    captchaId: string
    captchaText: string
  }): Promise<{ expire_in: number }> => {
    return this.client.post('/auth/send-code', params, { skipAuth: true })
  }

  register = async (params: {
    account: string
    password: string
    code: string
    inviteCode?: string
  }): Promise<AuthRegisterResponse> => {
    const session = await this.client.post<AuthRegisterResponse>(
      '/auth/register',
      params,
      { skipAuth: true },
    )
    await this.afterLoginSuccess(session)
    return session
  }

  login = async (params: {
    account: string
    loginMode: 'password' | 'code'
    password?: string
    captchaId?: string
    captchaText?: string
    emailCode?: string
  }): Promise<AuthLoginResponse> => {
    const session = await this.client.post<AuthLoginResponse>(
      '/auth/login',
      params,
      { skipAuth: true },
    )
    await this.afterLoginSuccess(session)
    return session
  }

  logout = async (): Promise<{ ok: true }> => {
    const userId = this.getCurrentUserId()
    try {
      // 通知服务端撤销 session；失败也继续清本地
      await this.client.post('/auth/logout', {})
    } catch (e) {
      log.warn(`logout server-side failed: ${(e as Error).message}`)
    }
    for (const hook of this.logoutHooks) {
      try {
        await hook(userId)
      } catch (error) {
        log.warn(`logout hook failed: ${(error as Error).message}`)
      }
    }
    await this.tokenStore.clear()
    this.emitStateChanged(false)
    return { ok: true }
  }

  getMe = async (): Promise<AuthMeResponse> => {
    return this.client.get<AuthMeResponse>('/me')
  }

  getCurrentUserId(): string | null {
    return this.tokenStore.get().userId ?? null
  }

  addLogoutHook(hook: (userId: string | null) => Promise<void>): () => void {
    this.logoutHooks.add(hook)
    return () => this.logoutHooks.delete(hook)
  }

  addLoginHook(hook: (userId: string) => Promise<void>): () => void {
    this.loginHooks.add(hook)
    return () => this.loginHooks.delete(hook)
  }

  platformGet<T>(path: string): Promise<T> {
    return this.client.get<T>(path)
  }

  platformPost<T>(path: string, body?: unknown): Promise<T> {
    return this.client.post<T>(path, body)
  }

  getBindStatus = async (): Promise<AuthBindStatusResponse> => {
    return this.client.get<AuthBindStatusResponse>('/me/bind-status')
  }

  changePassword = async (params: {
    oldPassword: string
    newPassword: string
  }): Promise<AuthChangePasswordResponse> => {
    return this.client.post<AuthChangePasswordResponse>('/auth/change-password', params)
  }

  // ─── 手机号短信登录（首次自动注册）──────────────────────────────────────────

  /** 发送短信验证码（需先通过图片验证码）。POST /auth/send-sms */
  sendSmsCode = async (params: {
    phone: string
    captchaId: string
    captchaText: string
  }): Promise<{ expire_in: number }> => {
    return this.client.post(
      '/auth/send-sms',
      {
        phone: params.phone,
        // 短信登录接口同时承担首次注册，服务端校验键必须统一使用 login。
        type: 'login',
        captchaId: params.captchaId,
        captchaText: params.captchaText,
      },
      { skipAuth: true },
    )
  }

  /** 手机号 + 短信验证码登录（首次自动注册）。POST /auth/login-sms */
  loginBySms = async (params: {
    phone: string
    smsCode: string
  }): Promise<AuthLoginSmsResponse> => {
    const result = await this.client.post<AuthLoginSmsResponse>(
      '/auth/login-sms',
      { phone: params.phone, smsCode: params.smsCode },
      { skipAuth: true },
    )
    // login-sms 成功即登录（与普通 login 一致：保存会话 + 推送 state-changed）
    if (result.token && result.refreshToken && result.userId) {
      await this.afterLoginSuccess({
        token: result.token,
        refreshToken: result.refreshToken,
        userId: result.userId,
      })
    }
    return result
  }

  /** 拉取客户端公开配置（无需登录，用于决定是否展示短信/微信登录入口）。GET /client-config */
  getClientConfig = async (): Promise<AuthClientConfigResponse> => {
    return this.client.get<AuthClientConfigResponse>('/client-config', { skipAuth: true })
  }

  /** 更新当前用户资料（目前仅 nickname）。返回更新后的完整用户信息。*/
  updateMe = async (params: { nickname: string }): Promise<AuthUpdateMeResponse> => {
    const me = await this.client.put<AuthUpdateMeResponse>('/me', { nickname: params.nickname })
    // 触发 state-changed（带 userId），便于多窗口/后续订阅刷新
    this.emitStateChanged(true, me.id.toString())
    return me
  }

  /** 上传/更新当前用户头像（multipart → POST /me/avatar）。返回服务端落库后的完整 avatarUrl。*/
  uploadAvatar = async (params: {
    dataUrl: string
    fileName?: string
    mimeType?: string
  }): Promise<{ avatarUrl: string }> => {
    const prepared = await prepareUploadPayload(params)
    return this.client.uploadAvatar(prepared)
  }

  wechatQr = async (): Promise<AuthWechatQrResponse> => {
    return this.client.get<AuthWechatQrResponse>('/auth/wechat/qr', { skipAuth: true })
  }

  wechatPoll = async (state: string): Promise<AuthWechatPollResponse> => {
    return this.client.get<AuthWechatPollResponse>(`/auth/wechat/poll?state=${encodeURIComponent(state)}`, {
      skipAuth: true,
    })
  }

  wechatBindEmailSendCode = async (params: {
    bindSession: string
    email: string
    captchaId: string
    captchaText: string
  }): Promise<AuthWechatBindEmailSendCodeResponse> => {
    return this.client.post('/auth/wechat/bind-email/send-code', params, { skipAuth: true })
  }

  wechatBindEmail = async (params: {
    bindSession: string
    code: string
  }): Promise<AuthWechatBindEmailResponse> => {
    const result = await this.client.post<AuthWechatBindEmailResponse>(
      '/auth/wechat/bind-email',
      params,
      { skipAuth: true },
    )
    // bind-email 成功即登录
    if (result.token && result.refreshToken && result.userId) {
      await this.afterLoginSuccess({
        token: result.token,
        refreshToken: result.refreshToken,
        userId: result.userId,
      })
    }
    return result
  }

  // ─── Base URL 管理 ───────────────────────────────────────────────────────────

  /**
   * 主动触发 token 续期（通常不需要调用 — EduServerClient 在收到 401 时会自动续期）。
   * 这里保留是为了让 web 端风格的"立即刷新"用例能复用，例如设置页手动 refresh。
   */
  forceRefresh = async (): Promise<AuthSession | null> => {
    return this.client.tryRefreshPublic()
  }

  getBaseUrl(): { baseUrl: string; source: BaseUrlSource } {
    return { baseUrl: this.client.getBaseUrl(), source: this.baseUrlSource }
  }

  uploadFile = async (params: {
    dataUrl?: string
    filePath?: string
    fileName?: string
    mimeType?: string
  }): Promise<AuthUploadFileResponse> => {
    const prepared = await prepareUploadPayload(params)
    return this.client.uploadFile(prepared)
  }

  setBaseUrl(url: string): { baseUrl: string } {
    void url
    throw new SparkError('UNKNOWN', '云端服务地址由桌面端内置配置管理，暂不支持修改')
  }

  /** 保留兼容旧调用；云端地址现在固定使用默认配置，不再加载持久化覆盖。 */
  async loadBaseUrl(persistedBaseUrl?: string): Promise<void> {
    void persistedBaseUrl
    this.baseUrlSource = 'default'
  }

  // ─── 内部 ─────────────────────────────────────────────────────────────────────

  private async afterLoginSuccess(session: AuthSession): Promise<void> {
    if (this.sessionExpiryCleanup) await this.sessionExpiryCleanup
    const previousUserId = this.getCurrentUserId()
    if (previousUserId && previousUserId !== session.userId) {
      for (const hook of this.logoutHooks) {
        try {
          await hook(previousUserId)
        } catch (error) {
          log.warn(`account-switch cleanup hook failed: ${(error as Error).message}`)
        }
      }
    }
    await this.tokenStore.save(session)
    this.emitStateChanged(true, session.userId)
    await this.notifyLoginHooks(session.userId)
  }

  private async notifyLoginHooks(userId: string): Promise<void> {
    await Promise.all([...this.loginHooks].map(async hook => {
      try {
        await hook(userId)
      } catch (error) {
        log.warn(`login hook failed: ${(error as Error).message}`)
      }
    }))
  }

  private handleTokenRefreshed(session: AuthSession): void {
    this.emitStream('stream:auth:token-refreshed', {
      token: session.token,
      refreshToken: session.refreshToken,
      userId: session.userId,
    })
  }

  private handleSessionExpired(): void {
    if (this.sessionExpiryCleanup) return
    const userId = this.getCurrentUserId()
    const cleanup = (async () => {
      await Promise.all([...this.logoutHooks].map(async hook => {
        try {
          await hook(userId)
        } catch (error) {
          log.warn(`session-expired hook failed: ${(error as Error).message}`)
        }
      }))
      await this.tokenStore.clear()
      this.emitStateChanged(false)
      this.emitStream('stream:auth:session-expired', {})
    })().finally(() => {
      if (this.sessionExpiryCleanup === cleanup) this.sessionExpiryCleanup = null
    })
    this.sessionExpiryCleanup = cleanup
  }

  private emitStateChanged(isAuthenticated: boolean, userId?: string): void {
    this.emitStream('stream:auth:state-changed', {
      isAuthenticated,
      ...(userId !== undefined ? { userId } : {}),
    })
  }

  private emitStream<C extends IpcStreamChannel>(
    channel: C,
    payload: IpcStreamPayload<C>,
  ): void {
    try {
      sendToMainWindow(channel, payload)
    } catch (e) {
      log.warn(`failed to emit ${channel}: ${(e as Error).message}`)
    }
  }
}

async function prepareUploadPayload(params: {
  dataUrl?: string
  filePath?: string
  fileName?: string
  mimeType?: string
}): Promise<{ buffer: Buffer; fileName: string; mimeType?: string }> {
  if (params.dataUrl) {
    const parsed = parseDataUrl(params.dataUrl)
    const mimeType = params.mimeType ?? parsed.mimeType
    return {
      buffer: parsed.buffer,
      fileName: ensureFileName(params.fileName, mimeType),
      ...(mimeType ? { mimeType } : {}),
    }
  }
  if (params.filePath) {
    const buffer = await readFile(params.filePath)
    const mimeType = params.mimeType ?? mimeFromExt(params.filePath)
    return {
      buffer,
      fileName: ensureFileName(params.fileName ?? basename(params.filePath), mimeType),
      ...(mimeType ? { mimeType } : {}),
    }
  }
  throw new SparkError('UNKNOWN', '缺少上传文件内容')
}

function parseDataUrl(dataUrl: string): { buffer: Buffer; mimeType?: string } {
  const match = /^data:([^;,]+)?;base64,(.*)$/i.exec(dataUrl)
  if (!match) throw new SparkError('VALIDATION_FAILED', '仅支持 base64 dataUrl 上传')
  return {
    buffer: Buffer.from(match[2] ?? '', 'base64'),
    ...(match[1] ? { mimeType: match[1] } : {}),
  }
}

function ensureFileName(fileName: string | undefined, mimeType: string | undefined): string {
  const trimmed = fileName?.trim()
  const fallback = `canvas-input${extFromMime(mimeType)}`
  const name = trimmed && trimmed.length > 0 ? trimmed : fallback
  return extname(name) ? name : `${name}${extFromMime(mimeType)}`
}

function extFromMime(mimeType: string | undefined): string {
  const normalized = (mimeType ?? '').split(';')[0]?.toLowerCase()
  if (normalized === 'image/jpeg' || normalized === 'image/jpg') return '.jpg'
  if (normalized === 'image/webp') return '.webp'
  if (normalized === 'image/svg+xml') return '.svg'
  if (normalized === 'application/pdf') return '.pdf'
  return '.png'
}

function mimeFromExt(filePath: string): string | undefined {
  const ext = extname(filePath).toLowerCase()
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg'
  if (ext === '.png') return 'image/png'
  if (ext === '.webp') return 'image/webp'
  if (ext === '.svg') return 'image/svg+xml'
  if (ext === '.pdf') return 'application/pdf'
  return undefined
}

/** 单例（主进程共用一个 AuthService 实例）*/
let _instance: AuthService | null = null

export function initAuthService(config: AuthServiceConfig): AuthService {
  if (_instance) {
    log.warn('AuthService already initialized, returning existing instance')
    return _instance
  }
  _instance = new AuthService(config)
  return _instance
}

export function getAuthService(): AuthService {
  if (!_instance) {
    throw new Error('AuthService not initialized, call initAuthService() first')
  }
  return _instance
}

/** 仅供测试使用 */
export function __resetAuthServiceForTesting(): void {
  _instance = null
}

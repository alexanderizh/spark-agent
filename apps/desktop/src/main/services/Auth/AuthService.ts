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

import { createLogger } from '@spark/shared'
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
      return { isAuthenticated: false, baseUrl: this.client.getBaseUrl(), reason: 'no-session' }
    }

    try {
      const me = await this.client.get<AuthMeResponse>('/me')
      this.emitStateChanged(true, me.id.toString())
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
    try {
      // 通知服务端撤销 session；失败也继续清本地
      await this.client.post('/auth/logout', {})
    } catch (e) {
      log.warn(`logout server-side failed: ${(e as Error).message}`)
    }
    await this.tokenStore.clear()
    this.emitStateChanged(false)
    return { ok: true }
  }

  getMe = async (): Promise<AuthMeResponse> => {
    return this.client.get<AuthMeResponse>('/me')
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

  setBaseUrl(url: string): { baseUrl: string } {
    this.client.setBaseUrl(url)
    this.baseUrlSource = url === this.config.defaultBaseUrl ? 'default' : 'user'
    return { baseUrl: this.client.getBaseUrl() }
  }

  /** 加载 base URL 持久化设置（启动时调用）*/
  async loadBaseUrl(persistedBaseUrl?: string): Promise<void> {
    if (!persistedBaseUrl) {
      this.baseUrlSource = 'default'
      return
    }
    this.client.setBaseUrl(persistedBaseUrl)
    this.baseUrlSource = 'user'
    log.info(`loaded persisted base URL: ${persistedBaseUrl}`)
  }

  // ─── 内部 ─────────────────────────────────────────────────────────────────────

  private async afterLoginSuccess(session: AuthSession): Promise<void> {
    await this.tokenStore.save(session)
    this.emitStateChanged(true, session.userId)
  }

  private handleTokenRefreshed(session: AuthSession): void {
    this.emitStream('stream:auth:token-refreshed', {
      token: session.token,
      refreshToken: session.refreshToken,
      userId: session.userId,
    })
  }

  private handleSessionExpired(): void {
    // 清空本地凭证
    void this.tokenStore.clear()
    this.emitStateChanged(false)
    this.emitStream('stream:auth:session-expired', {})
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

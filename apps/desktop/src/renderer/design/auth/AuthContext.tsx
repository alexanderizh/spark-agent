/**
 * AuthContext — 渲染端全局登录状态
 *
 * 职责：
 *   - 启动时调 `auth:bootstrap` 决定渲染登录页 or 主界面
 *   - 订阅 stream:auth:* 事件，实时同步状态
 *   - 暴露登录/注册/退出/微信扫码等业务方法
 *
 * 设计要点：
 *   - 不在渲染端存 token（主进程 keytar 持久化）
 *   - 只在内存里放一份副本供 UI 显示
 *   - 401 由主进程 EduServerClient 自动处理，渲染端不用感知
 */

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react'
import type {
  AuthBootstrapResponse,
  AuthCaptchaResponse,
  AuthLoginMode,
  AuthMeResponse,
  AuthSendCodeType,
  AuthSession,
  AuthWechatPollResponse,
} from '@spark/protocol'

export type AuthFlow = 'login' | 'register' | 'wechat' | 'wechat-bind'

export interface AuthContextValue {
  /** 是否已登录（token + userId 都有）*/
  isAuthenticated: boolean
  /** 当前用户信息 */
  user: AuthMeResponse | null
  /** 当前 edu-server base URL */
  baseUrl: string
  /** 当前显示的页面流（未登录时使用）*/
  flow: AuthFlow
  setFlow: (flow: AuthFlow) => void
  /** 微信扫码后绑定邮箱用的会话 ID（由 WechatQrPanel 写入）*/
  bindSession: string | null
  setBindSession: (s: string | null) => void
  /** 是否正在 bootstrap（启动时验证已存 token）*/
  bootstrapping: boolean

  // ─── 业务方法（薄包装，调用 window.spark.invoke）──────────────────────────
  fetchCaptcha: (fresh?: boolean) => Promise<AuthCaptchaResponse>
  sendCode: (params: {
    account: string
    type: AuthSendCodeType
    captchaId: string
    captchaText: string
  }) => Promise<{ expire_in: number }>
  login: (params: {
    account: string
    loginMode: AuthLoginMode
    password?: string
    captchaId?: string
    captchaText?: string
    emailCode?: string
  }) => Promise<AuthSession>
  register: (params: {
    account: string
    password: string
    code: string
    inviteCode?: string
  }) => Promise<AuthSession>
  logout: () => Promise<void>
  refreshMe: () => Promise<AuthMeResponse | null>
  /** 主动 refresh token */
  refreshToken: () => Promise<AuthSession | null>
  /** 微信扫码 */
  wechatQr: () => Promise<{ state: string; qrUrl: string; appId?: string; redirectUri?: string }>
  wechatPoll: (state: string) => Promise<AuthWechatPollResponse>
  wechatBindEmailSendCode: (params: {
    bindSession: string
    email: string
    captchaId: string
    captchaText: string
  }) => Promise<{ expire_in: number }>
  wechatBindEmail: (params: { bindSession: string; code: string }) => Promise<AuthSession & { isNew: boolean }>
  /** 修改 edu-server base URL（设置页）*/
  setBaseUrl: (url: string) => Promise<{ baseUrl: string }>
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}

export interface AuthProviderProps {
  children: React.ReactNode
}

export function AuthProvider({ children }: AuthProviderProps): React.ReactElement {
  const [bootstrapping, setBootstrapping] = useState(true)
  const [isAuthenticated, setIsAuthenticated] = useState(false)
  const [user, setUser] = useState<AuthMeResponse | null>(null)
  const [baseUrl, setBaseUrlState] = useState('')
  const [flow, setFlow] = useState<AuthFlow>('login')
  const [bindSession, setBindSession] = useState<string | null>(null)

  // ─── 启动时 bootstrap ──────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false
    void window.spark
      ?.invoke('auth:bootstrap', {})
      .then((res: AuthBootstrapResponse) => {
        if (cancelled) return
        setBaseUrlState(res.baseUrl)
        if (res.isAuthenticated && res.user) {
          setIsAuthenticated(true)
          setUser(res.user)
        } else {
          setIsAuthenticated(false)
          setUser(null)
          // 启动时根据 reason 智能选择默认页
          if (res.reason === 'no-session') setFlow('login')
          else setFlow('login')
        }
      })
      .catch(() => {
        // 主进程未初始化或协议不匹配 — 视为未登录
        if (!cancelled) {
          setIsAuthenticated(false)
          setUser(null)
          setFlow('login')
        }
      })
      .finally(() => {
        if (!cancelled) setBootstrapping(false)
      })

    return () => {
      cancelled = true
    }
  }, [])

  // ─── 订阅主进程推送 ─────────────────────────────────────────────────────────
  useEffect(() => {
    const spark = window.spark
    if (!spark?.on) return

    const unsubState = spark.on('stream:auth:state-changed', (payload) => {
      setIsAuthenticated(payload.isAuthenticated)
      if (!payload.isAuthenticated) {
        setUser(null)
        setFlow('login')
      } else if (payload.userId) {
        // 状态变化但有 userId，主动拉一次 /me
        void window.spark
          ?.invoke('auth:me', {})
          .then((me) => setUser(me as AuthMeResponse))
          .catch(() => undefined)
      }
    })

    const unsubExpired = spark.on('stream:auth:session-expired', () => {
      setIsAuthenticated(false)
      setUser(null)
      setFlow('login')
    })

    return () => {
      unsubState()
      unsubExpired()
    }
  }, [])

  // ─── 业务方法 ───────────────────────────────────────────────────────────────

  const fetchCaptcha = useCallback(async (fresh?: boolean) => {
    return (await window.spark!.invoke('auth:captcha', {
      fresh: fresh ?? true,
    })) as AuthCaptchaResponse
  }, [])

  const sendCode = useCallback(
    async (params: { account: string; type: AuthSendCodeType; captchaId: string; captchaText: string }) => {
      return (await window.spark!.invoke('auth:send-code', params)) as { expire_in: number }
    },
    [],
  )

  const login = useCallback(async (params: Parameters<AuthContextValue['login']>[0]) => {
    const session = (await window.spark!.invoke('auth:login', params)) as AuthSession
    // 登录成功后再拉 /me 获取完整用户信息
    const me = (await window.spark!.invoke('auth:me', {})) as AuthMeResponse
    setIsAuthenticated(true)
    setUser(me)
    return session
  }, [])

  const register = useCallback(async (params: Parameters<AuthContextValue['register']>[0]) => {
    const session = (await window.spark!.invoke('auth:register', params)) as AuthSession
    const me = (await window.spark!.invoke('auth:me', {})) as AuthMeResponse
    setIsAuthenticated(true)
    setUser(me)
    return session
  }, [])

  const logout = useCallback(async () => {
    await window.spark!.invoke('auth:logout', {})
    setIsAuthenticated(false)
    setUser(null)
    setFlow('login')
  }, [])

  const refreshMe = useCallback(async () => {
    try {
      const me = (await window.spark!.invoke('auth:me', {})) as AuthMeResponse
      setUser(me)
      return me
    } catch {
      return null
    }
  }, [])

  const refreshToken = useCallback(async () => {
    try {
      return (await window.spark!.invoke('auth:refresh', {})) as AuthSession | null
    } catch {
      return null
    }
  }, [])

  const wechatQr = useCallback(async () => {
    return (await window.spark!.invoke('auth:wechat-qr', {})) as {
      state: string
      qrUrl: string
      appId?: string
      redirectUri?: string
    }
  }, [])

  const wechatPoll = useCallback(async (state: string) => {
    return (await window.spark!.invoke('auth:wechat-poll', { state })) as AuthWechatPollResponse
  }, [])

  const wechatBindEmailSendCode = useCallback(
    async (params: { bindSession: string; email: string; captchaId: string; captchaText: string }) => {
      return (await window.spark!.invoke('auth:wechat-bind-email-send-code', params)) as { expire_in: number }
    },
    [],
  )

  const wechatBindEmail = useCallback(
    async (params: { bindSession: string; code: string }) => {
      const result = (await window.spark!.invoke('auth:wechat-bind-email', params)) as AuthSession & { isNew: boolean }
      const me = (await window.spark!.invoke('auth:me', {})) as AuthMeResponse
      setIsAuthenticated(true)
      setUser(me)
      return result
    },
    [],
  )

  const setBaseUrl = useCallback(async (url: string) => {
    const res = (await window.spark!.invoke('auth:set-base-url', { baseUrl: url })) as { baseUrl: string }
    setBaseUrlState(res.baseUrl)
    return res
  }, [])

  const value = useMemo<AuthContextValue>(
    () => ({
      isAuthenticated,
      user,
      baseUrl,
      flow,
      setFlow,
      bindSession,
      setBindSession,
      bootstrapping,
      fetchCaptcha,
      sendCode,
      login,
      register,
      logout,
      refreshMe,
      refreshToken,
      wechatQr,
      wechatPoll,
      wechatBindEmailSendCode,
      wechatBindEmail,
      setBaseUrl,
    }),
    [
      isAuthenticated,
      user,
      baseUrl,
      flow,
      bindSession,
      bootstrapping,
      fetchCaptcha,
      sendCode,
      login,
      register,
      logout,
      refreshMe,
      refreshToken,
      wechatQr,
      wechatPoll,
      wechatBindEmailSendCode,
      wechatBindEmail,
      setBaseUrl,
    ],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

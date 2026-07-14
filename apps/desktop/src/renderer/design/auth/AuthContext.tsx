/**
 * AuthContext — 渲染端全局登录状态
 *
 * 职责：
 *   - 启动时调 `auth:bootstrap` 决定渲染登录页 or 主界面
 *   - 订阅 stream:auth:* 事件，实时同步状态
 *   - 暴露登录/注册/退出等业务方法
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
  AuthCapabilities,
  AuthCaptchaResponse,
  AuthClientConfigResponse,
  AuthLoginMode,
  AuthLoginSmsResponse,
  AuthMeResponse,
  AuthSendCodeType,
  AuthSession,
} from '@spark/protocol'

export type AuthFlow = 'login' | 'register'

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
  /** 是否正在 bootstrap（启动时验证已存 token）*/
  bootstrapping: boolean
  /** keytar 是否可用；false 表示登录态不会持久化（dev 模式 native binding 失败常见）*/
  keytarAvailable: boolean | null

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
  /** 更新昵称（PUT /me），成功后刷新本地 user */
  updateNickname: (nickname: string) => Promise<AuthMeResponse>
  /** 上传/更新头像（POST /me/avatar），成功后刷新本地 user，返回完整 avatarUrl */
  uploadAvatar: (
    dataUrl: string,
    fileName?: string,
    mimeType?: string,
  ) => Promise<{ avatarUrl: string }>
  /** 客户端公开配置中的认证能力开关（决定是否展示短信/微信登录入口）；拉取失败为 null */
  authCapabilities: AuthCapabilities | null
  /** 发送短信验证码（POST /auth/send-sms，需图片验证码）*/
  sendSmsCode: (params: {
    phone: string
    captchaId: string
    captchaText: string
  }) => Promise<{ expire_in: number }>
  /** 手机号 + 短信验证码登录（首次自动注册，POST /auth/login-sms）*/
  loginBySms: (params: { phone: string; smsCode: string }) => Promise<AuthLoginSmsResponse>
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
  const [keytarAvailable, setKeytarAvailable] = useState<boolean | null>(null)
  const [authCapabilities, setAuthCapabilities] = useState<AuthCapabilities | null>(null)

  // ─── 启动时 bootstrap ──────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false
    void window.spark
      ?.invoke('auth:bootstrap', {})
      .then((res: AuthBootstrapResponse) => {
        if (cancelled) return
        setBaseUrlState(res.baseUrl)
        if (res.keytarAvailable !== undefined) {
          setKeytarAvailable(res.keytarAvailable)
        }
        if (res.isAuthenticated && res.user) {
          setIsAuthenticated(true)
          setUser(res.user)
        } else {
          setIsAuthenticated(false)
          setUser(null)
          setFlow('login')
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

  // ─── 拉取客户端公开配置（认证能力开关：短信/微信登录入口）─────────────────────
  useEffect(() => {
    let cancelled = false
    void window.spark
      ?.invoke('auth:client-config', {})
      .then((res: AuthClientConfigResponse) => {
        if (cancelled) return
        setAuthCapabilities(res.authCapabilities ?? null)
      })
      .catch(() => {
        // 拉取失败：保持 null，前端按"能力未知"降级（不展示需要开关的入口）
      })
    return () => {
      cancelled = true
    }
  }, [])
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

  const updateNickname = useCallback(async (nickname: string) => {
    const me = (await window.spark!.invoke('auth:update-me', { nickname })) as AuthMeResponse
    setUser(me)
    return me
  }, [])

  const uploadAvatar = useCallback(
    async (dataUrl: string, fileName?: string, mimeType?: string) => {
      const res = (await window.spark!.invoke('auth:upload-avatar', {
        dataUrl,
        ...(fileName !== undefined ? { fileName } : {}),
        ...(mimeType !== undefined ? { mimeType } : {}),
      })) as { avatarUrl: string }
      // 上传成功后刷新本地用户信息（avatarUrl 已落库）
      await window.spark!.invoke('auth:me', {}).then((me) => setUser(me as AuthMeResponse)).catch(() => undefined)
      return res
    },
    [],
  )

  const sendSmsCode = useCallback(
    async (params: { phone: string; captchaId: string; captchaText: string }) => {
      return (await window.spark!.invoke('auth:send-sms', params)) as { expire_in: number }
    },
    [],
  )

  const loginBySms = useCallback(async (params: { phone: string; smsCode: string }) => {
    const result = (await window.spark!.invoke('auth:login-sms', params)) as AuthLoginSmsResponse
    // 登录成功后拉 /me 获取完整用户信息（与邮箱登录一致）
    const me = (await window.spark!.invoke('auth:me', {})) as AuthMeResponse
    setIsAuthenticated(true)
    setUser(me)
    return result
  }, [])

  const value = useMemo<AuthContextValue>(
    () => ({
      isAuthenticated,
      user,
      baseUrl,
      flow,
      setFlow,
      bootstrapping,
      keytarAvailable,
      fetchCaptcha,
      sendCode,
      login,
      register,
      logout,
      refreshMe,
      refreshToken,
      updateNickname,
      uploadAvatar,
      authCapabilities,
      sendSmsCode,
      loginBySms,
    }),
    [
      isAuthenticated,
      user,
      baseUrl,
      flow,
      bootstrapping,
      keytarAvailable,
      fetchCaptcha,
      sendCode,
      login,
      register,
      logout,
      refreshMe,
      refreshToken,
      updateNickname,
      uploadAvatar,
      authCapabilities,
      sendSmsCode,
      loginBySms,
    ],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

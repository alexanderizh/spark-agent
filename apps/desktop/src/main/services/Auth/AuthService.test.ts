import type { AuthMeResponse, AuthSession } from '@spark/protocol'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  initialSession: {} as Partial<AuthSession>,
  nextGet: undefined as unknown,
  nextPost: undefined as unknown,
  order: [] as string[],
  posts: [] as Array<{ path: string; body: unknown }>,
  streams: [] as Array<{ channel: string; payload: unknown }>,
  clientOptions: undefined as { onSessionExpired: () => void } | undefined,
}))

vi.mock('./TokenStore', () => ({
  TokenStore: class MockTokenStore {
    private session: Partial<AuthSession> = { ...mocks.initialSession }

    async load(): Promise<Partial<AuthSession>> {
      mocks.order.push('load')
      return { ...this.session }
    }

    async save(session: AuthSession): Promise<void> {
      mocks.order.push(`save:${session.userId}`)
      this.session = { ...session }
    }

    async clear(): Promise<void> {
      mocks.order.push('clear')
      this.session = {}
    }

    get(): Partial<AuthSession> {
      return { ...this.session }
    }

    isAuthenticated(): boolean {
      return Boolean(this.session.token && this.session.refreshToken && this.session.userId)
    }

    isPersistent(): boolean {
      return true
    }

    getLastError(): string | null {
      return null
    }
  },
}))

vi.mock('./EduServerClient', () => ({
  EduServerClient: class MockEduServerClient {
    constructor(options: { onSessionExpired: () => void }) {
      mocks.clientOptions = options
    }

    getBaseUrl(): string {
      return 'https://default.example'
    }

    async get<T>(): Promise<T> {
      return mocks.nextGet as T
    }

    async post<T>(path: string, body: unknown): Promise<T> {
      mocks.posts.push({ path, body })
      return mocks.nextPost as T
    }
  },
}))

vi.mock('../../windows/index.js', () => ({
  sendToMainWindow: (channel: string, payload: unknown) => {
    mocks.streams.push({ channel, payload })
  },
}))

import { AuthService } from './AuthService'

function createAuth(): AuthService {
  return new AuthService({
    defaultBaseUrl: 'https://default.example/',
    keytarService: 'SparkAgent.CloudAuth.Test',
  })
}

function session(userId: string): AuthSession {
  return {
    token: `access-${userId}`,
    refreshToken: `refresh-${userId}`,
    userId,
  }
}

describe('AuthService base URL configuration', () => {
  beforeEach(() => {
    mocks.initialSession = {}
    mocks.nextGet = undefined
    mocks.nextPost = undefined
    mocks.order.length = 0
    mocks.posts.length = 0
    mocks.streams.length = 0
    mocks.clientOptions = undefined
  })

  it('rejects runtime cloud auth base URL changes', () => {
    const auth = createAuth()

    expect(() => auth.setBaseUrl('https://cloud.example/')).toThrow('暂不支持修改')
  })
})

describe('AuthService account lifecycle hooks', () => {
  beforeEach(() => {
    mocks.initialSession = {}
    mocks.nextGet = undefined
    mocks.nextPost = undefined
    mocks.order.length = 0
    mocks.posts.length = 0
    mocks.streams.length = 0
    mocks.clientOptions = undefined
  })

  it('persists a successful login before notifying login hooks', async () => {
    const auth = createAuth()
    const loginHook = vi.fn(async (userId: string) => {
      mocks.order.push(`login-hook:${userId}`)
    })
    auth.addLoginHook(loginHook)
    mocks.nextPost = session('user-1')

    await auth.login({
      account: 'user@example.com',
      loginMode: 'password',
      password: 'secret',
    })

    expect(loginHook).toHaveBeenCalledOnce()
    expect(loginHook).toHaveBeenCalledWith('user-1')
    expect(mocks.order).toEqual(['save:user-1', 'login-hook:user-1'])
    expect(mocks.streams).toContainEqual({
      channel: 'stream:auth:state-changed',
      payload: { isAuthenticated: true, userId: 'user-1' },
    })
  })

  it('cleans the previous account before persisting a different account', async () => {
    mocks.initialSession = session('user-old')
    const auth = createAuth()
    const logoutHook = vi.fn(async (userId: string | null) => {
      mocks.order.push(`logout-hook:${userId}`)
    })
    const loginHook = vi.fn(async (userId: string) => {
      mocks.order.push(`login-hook:${userId}`)
    })
    auth.addLogoutHook(logoutHook)
    auth.addLoginHook(loginHook)
    mocks.nextPost = session('user-new')

    await auth.login({
      account: 'new@example.com',
      loginMode: 'password',
      password: 'secret',
    })

    expect(logoutHook).toHaveBeenCalledOnce()
    expect(logoutHook).toHaveBeenCalledWith('user-old')
    expect(loginHook).toHaveBeenCalledWith('user-new')
    expect(mocks.order).toEqual([
      'logout-hook:user-old',
      'save:user-new',
      'login-hook:user-new',
    ])
  })

  it('does not run account cleanup when the same account signs in again', async () => {
    mocks.initialSession = session('user-1')
    const auth = createAuth()
    const logoutHook = vi.fn(async () => undefined)
    auth.addLogoutHook(logoutHook)
    mocks.nextPost = session('user-1')

    await auth.login({
      account: 'user@example.com',
      loginMode: 'password',
      password: 'secret',
    })

    expect(logoutHook).not.toHaveBeenCalled()
    expect(mocks.order).toEqual(['save:user-1'])
  })

  it('notifies login hooks after restoring and validating a persisted session', async () => {
    mocks.initialSession = session('user-restored')
    mocks.nextGet = { id: 'user-restored' } as unknown as AuthMeResponse
    const auth = createAuth()
    const loginHook = vi.fn(async (userId: string) => {
      mocks.order.push(`login-hook:${userId}`)
    })
    auth.addLoginHook(loginHook)

    await auth.start()
    const result = await auth.bootstrap()

    expect(result).toMatchObject({
      isAuthenticated: true,
      user: { id: 'user-restored' },
    })
    expect(loginHook).toHaveBeenCalledOnce()
    expect(loginHook).toHaveBeenCalledWith('user-restored')
    expect(mocks.order).toEqual(['load', 'login-hook:user-restored'])
    expect(mocks.streams).toContainEqual({
      channel: 'stream:auth:state-changed',
      payload: { isAuthenticated: true, userId: 'user-restored' },
    })
  })

  it('removes hooks through the returned unsubscribe callback', async () => {
    const auth = createAuth()
    const loginHook = vi.fn(async () => undefined)
    const unsubscribe = auth.addLoginHook(loginHook)
    unsubscribe()
    mocks.nextPost = session('user-1')

    await auth.login({ account: 'user@example.com', loginMode: 'code' })

    expect(loginHook).not.toHaveBeenCalled()
  })

  it('finishes expired-session cleanup before saving a newly logged-in account', async () => {
    mocks.initialSession = session('user-old')
    const auth = createAuth()
    let releaseCleanup!: () => void
    const cleanupGate = new Promise<void>(resolve => { releaseCleanup = resolve })
    auth.addLogoutHook(async () => {
      mocks.order.push('expired-cleanup-start')
      await cleanupGate
      mocks.order.push('expired-cleanup-finish')
    })
    mocks.clientOptions!.onSessionExpired()
    mocks.nextPost = session('user-new')
    const login = auth.login({
      account: 'new@example.com',
      loginMode: 'password',
      password: 'secret',
    })

    await Promise.resolve()
    expect(mocks.order).toEqual(['expired-cleanup-start'])
    releaseCleanup()
    await login
    expect(mocks.order).toEqual([
      'expired-cleanup-start',
      'expired-cleanup-finish',
      'clear',
      'save:user-new',
    ])
  })
})

describe('AuthService SMS verification contract', () => {
  beforeEach(() => {
    mocks.initialSession = {}
    mocks.nextGet = undefined
    mocks.nextPost = { expire_in: 300 }
    mocks.order.length = 0
    mocks.posts.length = 0
    mocks.streams.length = 0
    mocks.clientOptions = undefined
  })

  it('always sends SMS codes with the login purpose used by login-sms', async () => {
    const auth = createAuth()

    await auth.sendSmsCode({
      phone: '13800138000',
      captchaId: 'captcha-id',
      captchaText: 'abcd',
    })

    expect(mocks.posts).toContainEqual({
      path: '/auth/send-sms',
      body: {
        phone: '13800138000',
        type: 'login',
        captchaId: 'captcha-id',
        captchaText: 'abcd',
      },
    })
  })
})

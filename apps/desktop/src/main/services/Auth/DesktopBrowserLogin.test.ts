import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AuthDesktopLoginStatusEvent } from '@spark/protocol'
import { DEV_DEEP_LINK_SCHEME, type DeepLinkScheme } from '../../build-flavor.js'
import { DesktopBrowserLogin, DesktopLoginUnavailableError } from './DesktopBrowserLogin.js'

const TTL_MS = 300_000
const POLL_INTERVAL_MS = 2_000

function createHarness(
  overrides: {
    webLoginUrl?: string | null
    callbackScheme?: DeepLinkScheme
    opened?: boolean
    poll?: (state: string) => Promise<'pending' | 'bound' | 'expired'>
    exchange?: (state: string, verifier: string) => Promise<void>
  } = {},
) {
  const statuses: AuthDesktopLoginStatusEvent[] = []
  const openedUrls: string[] = []
  const exchanges: Array<{ state: string; codeVerifier: string }> = []
  const polled: string[] = []
  const login = new DesktopBrowserLogin({
    resolveWebLoginUrl: async () =>
      'webLoginUrl' in overrides ? overrides.webLoginUrl! : 'https://web.example/login',
    ...(overrides.callbackScheme == null ? {} : { callbackScheme: overrides.callbackScheme }),
    openExternal: async (url) => {
      openedUrls.push(url)
      return overrides.opened ?? true
    },
    pollBinding: async (state) => {
      polled.push(state)
      return overrides.poll ? overrides.poll(state) : 'pending'
    },
    exchange: async (state, codeVerifier) => {
      exchanges.push({ state, codeVerifier })
      if (overrides.exchange) await overrides.exchange(state, codeVerifier)
    },
    emitStatus: (event) => statuses.push(event),
    ttlMs: TTL_MS,
    pollIntervalMs: POLL_INTERVAL_MS,
  })
  return { login, statuses, openedUrls, exchanges, polled }
}

/** 从浏览器地址中解出 state / challenge，并按 PKCE 反推 verifier 的哈希来源 */
function parseLaunchedUrl(url: string) {
  const target = new URL(url)
  return {
    desktop: target.searchParams.get('desktop'),
    state: target.searchParams.get('state') ?? '',
    challenge: target.searchParams.get('challenge') ?? '',
  }
}

/** 断言非空并取值，避免 noUncheckedIndexedAccess 下的可选类型噪音 */
function first<T>(items: readonly T[]): T {
  const [value] = items
  if (value === undefined) throw new Error('期望至少存在一项')
  return value
}

describe('DesktopBrowserLogin', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('生成 64 位十六进制 state / challenge 并拉起系统浏览器', async () => {
    const h = createHarness()

    const result = await h.login.start()

    const { desktop, state, challenge } = parseLaunchedUrl(first(h.openedUrls))
    expect(desktop).toBe('1')
    expect(new URL(result.webLoginUrl).searchParams.get('callback_scheme')).toBe('spark-agent')
    expect(state).toMatch(/^[0-9a-f]{64}$/)
    expect(challenge).toMatch(/^[0-9a-f]{64}$/)
    expect(result.webLoginUrl).toBe(first(h.openedUrls))
    expect(h.statuses).toEqual([{ status: 'waiting' }])
    h.login.shutdown()
  })

  it('保留 webLoginUrl 既有路径并仅追加桌面参数', async () => {
    const h = createHarness({ webLoginUrl: 'https://web.example/login?sso=1' })

    await h.login.start()

    const target = new URL(first(h.openedUrls))
    expect(target.pathname).toBe('/login')
    expect(target.searchParams.get('sso')).toBe('1')
    h.login.shutdown()
  })

  it('requests the dev callback scheme and overrides URL defaults', async () => {
    const h = createHarness({
      webLoginUrl: 'https://web.example/login?callback_scheme=spark-agent',
      callbackScheme: DEV_DEEP_LINK_SCHEME,
    })
    const { webLoginUrl } = await h.login.start()
    expect(new URL(webLoginUrl).searchParams.getAll('callback_scheme')).toEqual(['spark-agent-dev'])
    h.login.shutdown()
  })

  it('deep link 携带匹配 state 时用 verifier 换取会话并推送 success', async () => {
    const h = createHarness()
    await h.login.start()
    const { state } = parseLaunchedUrl(first(h.openedUrls))

    await expect(h.login.handleCallback(state)).resolves.toBe(true)

    expect(h.exchanges).toHaveLength(1)
    expect(first(h.exchanges).state).toBe(state)
    expect(first(h.exchanges).codeVerifier).toMatch(/^[0-9a-f]{64}$/)
    expect(h.statuses.map((event) => event.status)).toEqual(['waiting', 'success'])
    expect(h.login.hasPending()).toBe(false)
  })

  it('deep link 的 state 不匹配时静默忽略，不发起交换', async () => {
    const h = createHarness()
    await h.login.start()

    await expect(h.login.handleCallback('f'.repeat(64))).resolves.toBe(false)

    expect(h.exchanges).toHaveLength(0)
    expect(h.statuses).toEqual([{ status: 'waiting' }])
    h.login.shutdown()
  })

  it('deep link 失败时靠轮询兜底完成交换', async () => {
    const h = createHarness({ poll: async () => 'bound' })
    await h.login.start()
    const { state } = parseLaunchedUrl(first(h.openedUrls))

    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS)

    expect(h.polled).toEqual([state])
    expect(h.exchanges).toHaveLength(1)
    expect(h.statuses.map((event) => event.status)).toEqual(['waiting', 'success'])
  })

  it('deep link 与轮询并发命中同一 state 时只交换一次', async () => {
    let resolveExchange: (() => void) | undefined
    const h = createHarness({
      poll: async () => 'bound',
      exchange: () =>
        new Promise<void>((resolve) => {
          resolveExchange = resolve
        }),
    })
    await h.login.start()
    const { state } = parseLaunchedUrl(first(h.openedUrls))

    const viaPoll = vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS)
    await vi.advanceTimersByTimeAsync(0)
    const viaDeepLink = h.login.handleCallback(state)
    await vi.advanceTimersByTimeAsync(0)
    resolveExchange?.()
    await Promise.all([viaPoll, viaDeepLink])

    expect(h.exchanges).toHaveLength(1)
    expect(h.statuses.map((event) => event.status)).toEqual(['waiting', 'success'])
  })

  it('轮询异常不中断流程，下一轮恢复', async () => {
    let attempt = 0
    const h = createHarness({
      poll: async () => {
        attempt += 1
        if (attempt === 1) throw new Error('network down')
        return 'bound'
      },
    })
    await h.login.start()

    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS)
    expect(h.exchanges).toHaveLength(0)

    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS)
    expect(h.exchanges).toHaveLength(1)
    expect(h.statuses.map((event) => event.status)).toEqual(['waiting', 'success'])
  })

  it('超过 300s 授权窗口后推送 expired 并停止轮询', async () => {
    const h = createHarness()
    await h.login.start()

    await vi.advanceTimersByTimeAsync(TTL_MS)

    expect(h.statuses.map((event) => event.status)).toEqual(['waiting', 'expired'])
    expect(first(h.statuses.slice(1)).message).toContain('超时')
    expect(h.exchanges).toHaveLength(0)
    expect(h.login.hasPending()).toBe(false)

    const polledAtExpiry = h.polled.length
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 3)
    expect(h.polled).toHaveLength(polledAtExpiry)
  })

  it('超时后的 deep link 不再交换', async () => {
    const h = createHarness()
    await h.login.start()
    const { state } = parseLaunchedUrl(first(h.openedUrls))

    await vi.advanceTimersByTimeAsync(TTL_MS)

    await expect(h.login.handleCallback(state)).resolves.toBe(false)
    expect(h.exchanges).toHaveLength(0)
  })

  it('取消后停止轮询并推送 cancelled，后续 deep link 失效', async () => {
    const h = createHarness()
    await h.login.start()
    const { state } = parseLaunchedUrl(first(h.openedUrls))

    h.login.cancel()

    expect(h.statuses.map((event) => event.status)).toEqual(['waiting', 'cancelled'])
    expect(h.login.hasPending()).toBe(false)
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 3)
    expect(h.polled).toHaveLength(0)
    await expect(h.login.handleCallback(state)).resolves.toBe(false)
  })

  it('交换失败时推送 failed 与可读原因，并作废本次 state', async () => {
    const h = createHarness({
      exchange: async () => {
        throw new Error('登录会话不存在或已失效，请重新发起登录')
      },
    })
    await h.login.start()
    const { state } = parseLaunchedUrl(first(h.openedUrls))

    await expect(h.login.handleCallback(state)).resolves.toBe(true)

    expect(h.statuses.map((event) => event.status)).toEqual(['waiting', 'failed'])
    expect(first(h.statuses.slice(1)).message).toBe('登录会话不存在或已失效，请重新发起登录')
    expect(h.login.hasPending()).toBe(false)
  })

  it('重复发起时作废旧流程，只用最新 state 完成交换', async () => {
    const h = createHarness()
    await h.login.start()
    const firstState = parseLaunchedUrl(first(h.openedUrls)).state
    await h.login.start()
    const secondState = parseLaunchedUrl(first(h.openedUrls.slice(1))).state

    await expect(h.login.handleCallback(firstState)).resolves.toBe(false)
    await expect(h.login.handleCallback(secondState)).resolves.toBe(true)

    expect(h.exchanges).toHaveLength(1)
    expect(first(h.exchanges).state).toBe(secondState)
  })

  it('服务端未下发网页登录地址时拒绝发起且不打开浏览器', async () => {
    const h = createHarness({ webLoginUrl: null })

    await expect(h.login.start()).rejects.toBeInstanceOf(DesktopLoginUnavailableError)
    expect(h.openedUrls).toHaveLength(0)
    expect(h.statuses).toEqual([])
    expect(h.login.hasPending()).toBe(false)
  })

  it('浏览器打开失败时抛出可读错误且不留下等待中的流程', async () => {
    const h = createHarness({ opened: false })

    await expect(h.login.start()).rejects.toThrow('无法打开系统浏览器')
    expect(h.statuses).toEqual([])
    expect(h.login.hasPending()).toBe(false)
  })

  it('服务端下发非法网页登录地址时给出可读错误，不抛 Invalid URL', async () => {
    const h = createHarness({ webLoginUrl: 'not-a-url' })

    await expect(h.login.start()).rejects.toBeInstanceOf(DesktopLoginUnavailableError)
    await expect(h.login.start()).rejects.toThrow('网页登录地址配置不正确')
    expect(h.openedUrls).toHaveLength(0)
    expect(h.login.hasPending()).toBe(false)
  })

  it('shutdown 清理定时器但不推送状态', async () => {
    const h = createHarness()
    await h.login.start()

    h.login.shutdown()

    expect(h.statuses).toEqual([{ status: 'waiting' }])
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 3)
    expect(h.polled).toHaveLength(0)
  })
})

/**
 * DesktopBrowserLogin — 桌面端「使用浏览器登录」流程编排
 *
 * 与既有表单登录并存：点击入口后拉起系统浏览器打开 edu-web 登录页，
 * 用户在网页端用任意方式（密码 / 邮箱验证码 / 短信 / 微信扫码）登录，
 * 桌面端再凭一次性凭证换回自己的 token。
 *
 * 协议：state + PKCE verifier 单次交换（见 spark-edugen 设计文档
 * `docs/system-design/auth/桌面端浏览器登录设计_v1.0.md`）
 *   1. 本模块生成 state / codeVerifier（各 32 字节随机），
 *      challenge = SHA256(codeVerifier)，只把 state + challenge 交给浏览器；
 *   2. 网页端登录成功后调 POST /auth/desktop/bind 把 userId 绑到 state 上；
 *   3. 浏览器跳 `spark-agent://auth-callback?state=xxx` 拉回桌面端（快速路径），
 *      同时本模块 2s 轮询 GET /auth/desktop/poll 兜底（deep link 失败也能闭环）；
 *   4. POST /auth/desktop/exchange {state, codeVerifier} 换回全新 token 对。
 *
 * 安全要点：
 *   - codeVerifier 只存在于主进程内存，不落盘、不进 renderer、不进 deep link；
 *   - deep link 仅承载 state，泄露 state 也无法换取凭证；
 *   - 轮询期间不发任何凭证，exchange 由服务端 GETDEL 一次性消费。
 */

import { createHash, randomBytes } from 'node:crypto'
import { createLogger } from '@spark/shared'
import type { AuthDesktopLoginPhase, AuthDesktopLoginStatusEvent } from '@spark/protocol'

import { PRODUCTION_DEEP_LINK_SCHEME, type DeepLinkScheme } from '../../build-flavor.js'

const log = createLogger('auth:desktop-login')

/** 与服务端 Redis 条目 TTL 保持一致：整个授权窗口 5 分钟 */
const DEFAULT_TTL_MS = 300_000
const DEFAULT_POLL_INTERVAL_MS = 2_000

export interface DesktopLoginDeps {
  /** 解析网页登录页地址（服务端下发优先）；返回 null 表示未配置 */
  resolveWebLoginUrl: () => Promise<string | null>
  callbackScheme?: DeepLinkScheme
  /** 打开系统浏览器；返回 false 表示被安全策略拦截或打开失败 */
  openExternal: (url: string) => Promise<boolean>
  /** 轮询服务端是否已完成绑定（只读、非消费、不返回凭证） */
  pollBinding: (state: string) => Promise<'pending' | 'bound' | 'expired'>
  /** 用 state + codeVerifier 换取会话并完成登录态初始化 */
  exchange: (state: string, codeVerifier: string) => Promise<void>
  /** 推送流程状态给渲染端 */
  emitStatus: (event: AuthDesktopLoginStatusEvent) => void
  ttlMs?: number
  pollIntervalMs?: number
  now?: () => number
}

interface PendingLogin {
  state: string
  codeVerifier: string
  expiresAt: number
  timer: ReturnType<typeof setInterval> | null
  /** 换取凭证的在途 Promise，避免 deep link 与轮询并发交换同一 state */
  exchanging: Promise<void> | null
  /** 已终结（成功 / 失败 / 超时 / 取消），不再产生任何状态推送 */
  settled: boolean
}

export class DesktopLoginUnavailableError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DesktopLoginUnavailableError'
  }
}

export class DesktopBrowserLogin {
  private readonly deps: Required<Pick<DesktopLoginDeps, 'ttlMs' | 'pollIntervalMs' | 'now'>> &
    DesktopLoginDeps
  private current: PendingLogin | null = null

  constructor(deps: DesktopLoginDeps) {
    this.deps = {
      ...deps,
      ttlMs: deps.ttlMs ?? DEFAULT_TTL_MS,
      pollIntervalMs: deps.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS,
      now: deps.now ?? (() => Date.now()),
    }
  }

  /**
   * 发起浏览器登录：生成 state / verifier 并拉起系统浏览器。
   * 重复发起会作废旧条目（旧 state 的 Redis 条目由 TTL 自然回收）。
   *
   * @returns 实际打开的网页登录地址（供 UI 展示）
   */
  async start(): Promise<{ webLoginUrl: string }> {
    const webLoginUrl = await this.resolveLoginUrl()
    this.discard() // 作废上一次未完成的流程，避免同一时刻存在两个轮询

    const state = randomBytes(32).toString('hex')
    const codeVerifier = randomBytes(32).toString('hex')
    const codeChallenge = createHash('sha256').update(codeVerifier).digest('hex')

    let target: URL
    try {
      target = new URL(webLoginUrl)
    } catch {
      // 服务端下发的地址非法（配置错误）时给出可读提示，避免把 Invalid URL 抛给用户
      throw new DesktopLoginUnavailableError('网页登录地址配置不正确，请联系管理员')
    }
    target.searchParams.set('desktop', '1')
    target.searchParams.set('state', state)
    target.searchParams.set('challenge', codeChallenge)
    target.searchParams.set('callback_scheme', this.deps.callbackScheme ?? PRODUCTION_DEEP_LINK_SCHEME)

    const opened = await this.deps.openExternal(target.toString())
    if (!opened) {
      throw new DesktopLoginUnavailableError('无法打开系统浏览器，请检查默认浏览器设置后重试')
    }

    const entry: PendingLogin = {
      state,
      codeVerifier,
      expiresAt: this.deps.now() + this.deps.ttlMs,
      timer: null,
      exchanging: null,
      settled: false,
    }
    this.current = entry
    entry.timer = setInterval(() => {
      void this.tick(entry)
    }, this.deps.pollIntervalMs)
    // 轮询定时器不应阻止进程退出
    entry.timer.unref?.()

    log.info(`desktop browser login started, waiting for authorization: ${target.origin}`)
    this.deps.emitStatus({ status: 'waiting' })
    return { webLoginUrl: target.toString() }
  }

  /**
   * deep link 回调（`spark-agent://auth-callback?state=xxx`）。
   *
   * @returns 是否命中了本次流程（未命中说明是过期/伪造链接，调用方无需提示）
   */
  async handleCallback(state: string): Promise<boolean> {
    const entry = this.current
    if (!entry || entry.settled || entry.state !== state) {
      log.warn('ignored desktop auth callback: no matching pending login')
      return false
    }
    // 仍以本地 TTL 为准：服务端条目可能已过期，直接换会拿到 404
    if (this.deps.now() >= entry.expiresAt) {
      this.settle(entry, 'expired', '授权已超时，请重新发起登录')
      return false
    }
    await this.completeExchange(entry)
    return true
  }

  /** 用户主动取消：停止轮询并作废 state（浏览器侧无感知） */
  cancel(): void {
    const entry = this.current
    this.discard()
    if (entry) this.deps.emitStatus({ status: 'cancelled' })
  }

  /** 进程退出时清理定时器 */
  shutdown(): void {
    this.discard()
  }

  /** 当前是否存在进行中的授权流程（供幂等调用与测试使用） */
  hasPending(): boolean {
    return this.current != null
  }

  // ─── 内部 ───────────────────────────────────────────────────────────────────

  private async resolveLoginUrl(): Promise<string> {
    const url = await this.deps.resolveWebLoginUrl()
    if (!url) {
      throw new DesktopLoginUnavailableError('服务端未配置网页登录地址，暂时无法使用浏览器登录')
    }
    return url
  }

  private async tick(entry: PendingLogin): Promise<void> {
    if (this.current !== entry || entry.settled) return
    if (this.deps.now() >= entry.expiresAt) {
      this.settle(entry, 'expired', '授权已超时，请重新发起登录')
      return
    }
    if (entry.exchanging) return

    let status: 'pending' | 'bound' | 'expired'
    try {
      status = await this.deps.pollBinding(entry.state)
    } catch (error) {
      // 网络抖动不应中断流程：保持等待，下一轮重试
      log.warn(`desktop login poll failed: ${(error as Error).message}`)
      return
    }
    if (this.current !== entry || entry.settled) return
    if (status === 'bound') {
      await this.completeExchange(entry)
      return
    }
    if (status === 'expired') {
      // 服务端只在条目数据损坏时返回 expired；正常等待期为 pending
      log.warn('desktop login poll returned unexpected expired status')
    }
  }

  private async completeExchange(entry: PendingLogin): Promise<void> {
    if (entry.exchanging) return entry.exchanging
    const running = (async () => {
      try {
        await this.deps.exchange(entry.state, entry.codeVerifier)
        this.settle(entry, 'success')
      } catch (error) {
        const message = error instanceof Error ? error.message : '换取登录凭证失败，请重新发起'
        log.warn(`desktop login exchange failed: ${message}`)
        this.settle(entry, 'failed', message)
      }
    })()
    entry.exchanging = running
    await running
  }

  /** 终结条目并推送状态（幂等：已终结的条目不会重复推送） */
  private settle(entry: PendingLogin, status: AuthDesktopLoginPhase, message?: string): void {
    if (entry.settled) return
    entry.settled = true
    this.clearEntry(entry)
    log.info(`desktop browser login settled: ${status}`)
    this.deps.emitStatus(message === undefined ? { status } : { status, message })
  }

  /** 丢弃当前条目且不推送状态（用于重复发起 / 主动取消 / 退出） */
  private discard(): void {
    const entry = this.current
    this.current = null
    if (entry) this.clearEntry(entry)
  }

  private clearEntry(entry: PendingLogin): void {
    if (entry.timer) clearInterval(entry.timer)
    entry.timer = null
    if (this.current === entry) this.current = null
  }
}

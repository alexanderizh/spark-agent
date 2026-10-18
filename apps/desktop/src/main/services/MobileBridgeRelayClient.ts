/**
 * MobileBridgeRelayClient — 桌面端 ↔ edu-server 的云端中继长连接。
 *
 * 为什么需要它：小程序体验版强制 https/wss + 域名白名单，局域网直连
 * （http://IP:端口）真机不可用、已整体移除。中继模式下桌面端**主动出网**
 * 连 edu-server，小程序也连 edu-server，服务端按账号 userId 配对转发：
 *
 *     小程序 ──wss──> edu-server <──wss── 桌面端（本文件）
 *
 * 桌面端因此不需要公网 IP、不需要开端口、不需要配路由器，只要能上网，
 * 同一账号的小程序在任何网络下都能接管它的会话。
 *
 * 帧协议与 edu-server `src/service/mobile-bridge/relay-hub.ts` 对齐：
 *   → auth（首帧，deviceSecret 只走这里，绝不进 URL query）/ hello / res / event / ping
 *   ← welcome（= 认证已通过）/ req / sub / unsub / pong / presence
 */

import { createLogger } from '@spark/shared'
import type {
  MobileBridgeEvent,
  MobileBridgeRelaySettings,
  MobileBridgeRelayStatus,
} from '@spark/protocol'

const log = createLogger('mobile-bridge:relay')

/** 应用级心跳：既保活连接，也刷新服务端上的在线标记 TTL */
const PING_INTERVAL_MS = 20_000
/** 建连超时（握手卡住时及时重试，而不是一直挂着） */
const CONNECT_TIMEOUT_MS = 12_000
/** 重连退避：1s 起，指数退避封顶 30s */
const RETRY_BASE_MS = 1_000
const RETRY_MAX_MS = 30_000

/**
 * 服务端设备信任拒绝码（与 edu-server configuration.ts 的握手验证对齐）：
 * 这些是「身份被拒」而不是「网络故障」——重连不会成功，必须停止退避循环，
 * 由用户在桌面端重置设备身份（生成全新设备身份）或在小程序端检查设备管理。
 */
const CLOSE_CODE_DEVICE_REVOKED = 4403
const CLOSE_CODE_BAD_SECRET = 4401
const CLOSE_CODE_TOO_MANY_DEVICES = 4429

export interface MobileBridgeRelayClientDeps {
  /** 当前中继设置（开关 + 服务地址） */
  getSettings(): MobileBridgeRelaySettings
  /** 中继地址缺省时回落的账号服务基址（https://www.yiqibyte.com） */
  getDefaultBaseUrl(): string
  /** edu-server 账号 JWT；未登录返回 null（此时不连接） */
  getAccessToken(): Promise<string | null>
  /** 本机设备标识（稳定，重启不变） */
  getDeviceId(): string
  /** 设备密钥（接入凭据，仅本机明文保存；服务端只存哈希） */
  getDeviceSecret(): string
  /** 设备展示名（默认主机名；auth/hello 帧上报，小程序「我的桌面端」里显示） */
  getDeviceLabel(): string
  /** 桌面端版本号 */
  getVersion(): string
  /** 执行一个桥接调用（由 MobileBridgeService.invokeRelay 提供） */
  invoke(method: string, path: string, body: unknown): Promise<{ status: number; body: unknown }>
  /** 订阅会话事件流，返回取消函数 */
  subscribe(sessionId: string, sendEvents: (events: MobileBridgeEvent[]) => void): () => void
  /** 状态变化（供设置页刷新） */
  onStatusChange?(status: MobileBridgeRelayStatus): void
}

interface RelayFrame {
  t?: string
  id?: string
  m?: string
  p?: string
  b?: unknown
  s?: number
  sessionId?: string
  events?: MobileBridgeEvent[]
  connId?: string
  message?: string
}

function toWsBase(baseUrl: string): string {
  const trimmed = (baseUrl ?? '').trim().replace(/\/+$/, '')
  if (!trimmed) return ''
  if (trimmed.startsWith('wss://') || trimmed.startsWith('ws://')) return trimmed
  if (trimmed.startsWith('https://')) return `wss://${trimmed.slice('https://'.length)}`
  if (trimmed.startsWith('http://')) return `ws://${trimmed.slice('http://'.length)}`
  return `wss://${trimmed}`
}

export class MobileBridgeRelayClient {
  private socket: WebSocket | null = null
  private pingTimer: ReturnType<typeof setInterval> | null = null
  private retryTimer: ReturnType<typeof setTimeout> | null = null
  private connectTimer: ReturnType<typeof setTimeout> | null = null
  private retryCount = 0
  private stopped = true
  /** 身份被拒（4401/4403/4429）：停止自动重连，等用户重置设备身份 */
  private identityRejected = false
  private unsubscribe: (() => void) | null = null
  private connectionId: string | null = null
  private lastError: string | null = null
  private lastSeenAt: string | null = null
  /** 当前订阅的会话（重连后需要重新订阅） */
  private subscribedSessionId: string | null = null
  /**
   * 是否已收到服务端 welcome（= 首帧认证通过并注册进中继）。
   * 「已连接」徽标以此为准则而非 socket 建立：WS 建立后到认证通过前
   * 存在最长 10s 窗口（认证失败会被 4400/1011 关闭），期间不显示已连接，
   * 避免服务端异常时桌面端在重连振荡中呈现「绿色已连接」的假象。
   */
  private welcomed = false

  constructor(private readonly deps: MobileBridgeRelayClientDeps) {}

  getStatus(): MobileBridgeRelayStatus {
    const settings = this.deps.getSettings()
    return {
      enabled: settings.enabled,
      baseUrl: this.resolveBaseUrl(),
      connected: this.socket != null && this.welcomed,
      lastError: this.lastError,
      connectionId: this.connectionId,
      lastSeenAt: this.lastSeenAt,
      deviceId: this.deps.getDeviceId(),
      label: this.deps.getDeviceLabel(),
      revoked: this.identityRejected,
    }
  }

  private resolveBaseUrl(): string {
    const configured = (this.deps.getSettings().baseUrl ?? '').trim()
    return toWsBase(configured || this.deps.getDefaultBaseUrl())
  }

  /** 启动（幂等）；设置变更或登录态变化后调用 restart() */
  async start(): Promise<void> {
    if (!this.stopped) return
    this.stopped = false
    await this.open()
  }

  /** 重启：开关/地址/账号变化后调用 */
  async restart(): Promise<void> {
    this.teardownSocket()
    this.retryCount = 0
    if (this.stopped) return
    await this.open()
  }

  /** 停止并清理所有定时器 */
  stop(): void {
    this.stopped = true
    this.teardownSocket()
    if (this.retryTimer != null) {
      clearTimeout(this.retryTimer)
      this.retryTimer = null
    }
    this.connectionId = null
    this.notify()
  }

  /**
   * 重置设备身份：清除身份拒绝标志并立即重连。
   * 调用前装配层应已生成全新设备身份（新 deviceId + secret），
   * 否则服务端仍会按旧身份拒绝。
   */
  async resetIdentity(): Promise<void> {
    this.identityRejected = false
    this.lastError = null
    this.retryCount = 0
    if (this.stopped) {
      await this.start()
      return
    }
    await this.restart()
  }

  private teardownSocket(): void {
    this.unsubscribe?.()
    this.unsubscribe = null
    this.subscribedSessionId = null
    if (this.pingTimer != null) {
      clearInterval(this.pingTimer)
      this.pingTimer = null
    }
    if (this.connectTimer != null) {
      clearTimeout(this.connectTimer)
      this.connectTimer = null
    }
    const socket = this.socket
    this.socket = null
    if (socket == null) return
    try {
      socket.onopen = null
      socket.onmessage = null
      socket.onerror = null
      socket.onclose = null
      socket.close()
    } catch {
      /* 已断开 */
    }
  }

  private async open(): Promise<void> {
    if (this.stopped) return
    // 身份被拒（吊销/密钥错误/超上限）后不再自动重连；
    // 只有用户显式「重置设备身份」（resetIdentity）才会解锁。
    if (this.identityRejected) return
    // 每一次建连前都先清掉「排队的重连」和「残留的旧连接」。
    // 否则 restart() 之后旧定时器还会再开一条：服务端看到同一账号有多个桌面端，
    // 订阅与调用会被重复下发（实测同一个 sub 被推了 3 次）。
    if (this.retryTimer != null) {
      clearTimeout(this.retryTimer)
      this.retryTimer = null
    }
    if (this.socket != null) this.teardownSocket()

    if (!this.deps.getSettings().enabled) {
      this.lastError = null
      this.notify()
      return
    }
    const base = this.resolveBaseUrl()
    if (!base) {
      this.lastError = '未配置中继服务地址'
      this.scheduleRetry()
      return
    }
    const token = await this.deps.getAccessToken()
    if (token == null) {
      // 未登录不是故障：仍然排一次重连，这样用户登录后最多等一个退避周期就能连上
      // （否则要等下一次设置变更或重启才会重试）。
      this.lastError = '未登录，登录后自动连接'
      this.notify()
      this.scheduleRetry()
      return
    }

    // query 只带短效 JWT 与设备号：deviceSecret 是长期凭据，绝不能进 URL
    // （生产链路两层 nginx 的 access log 会完整记录 query）——改走首帧 auth。
    const query = new URLSearchParams({
      token,
      deviceId: this.deps.getDeviceId(),
    })
    const url = `${base}/ws/bridge/desktop?${query.toString()}`

    // Electron 43 的 Node 22 提供全局 WebSocket；万一运行环境没有，
    // 明确报错并停止重试，避免每 30s 打一条没有信息量的日志。
    if (typeof WebSocket === 'undefined') {
      this.lastError = '当前运行环境不支持 WebSocket（需要 Node 22+），云端中继已停用'
      log.warn('relay disabled: global WebSocket unavailable')
      this.notify()
      return
    }

    let socket: WebSocket
    try {
      socket = new WebSocket(url)
    } catch (error) {
      this.lastError = `建立连接失败：${error instanceof Error ? error.message : String(error)}`
      this.scheduleRetry()
      return
    }
    this.socket = socket

    // 握手迟迟不完成也当失败处理：否则会一直卡在 CONNECTING 不再重试
    this.connectTimer = setTimeout(() => {
      if (this.socket === socket && socket.readyState === WebSocket.CONNECTING) {
        log.warn('relay 建连超时，主动重试')
        try {
          socket.close()
        } catch {
          /* noop */
        }
      }
    }, CONNECT_TIMEOUT_MS)

    socket.onopen = () => {
      if (this.socket !== socket) return
      if (this.connectTimer != null) {
        clearTimeout(this.connectTimer)
        this.connectTimer = null
      }
      this.retryCount = 0
      this.lastError = null
      this.lastSeenAt = new Date().toISOString()
      this.welcomed = false
      // 首帧认证：服务端收到 auth 并验证通过（deviceSecret 对得上）后，
      // 才把本连接注册进中继并回 welcome；业务帧（hello/订阅/心跳）等
      // welcome 再发，避免认证窗口内发出的帧被丢弃。
      this.send({
        t: 'auth',
        deviceId: this.deps.getDeviceId(),
        secret: this.deps.getDeviceSecret(),
        label: this.deps.getDeviceLabel(),
        version: this.deps.getVersion(),
      })
      log.info(`relay connected: ${base}`)
      this.notify()
    }

    socket.onmessage = (event) => {
      if (this.socket !== socket) return
      this.lastSeenAt = new Date().toISOString()
      void this.handleFrame(event.data)
    }

    socket.onerror = () => {
      if (this.socket !== socket) return
      this.lastError = '与中继服务的连接出错'
      this.notify()
    }

    socket.onclose = (event: { code?: number }) => {
      if (this.socket !== socket) return
      this.socket = null
      this.welcomed = false
      if (this.pingTimer != null) {
        clearInterval(this.pingTimer)
        this.pingTimer = null
      }
      if (this.connectTimer != null) {
        clearTimeout(this.connectTimer)
        this.connectTimer = null
      }
      this.unsubscribe?.()
      this.unsubscribe = null
      this.connectionId = null

      // 设备信任拒绝：重连不会改变结果，停止退避循环，等待用户重置设备身份。
      const closeCode = Number(event?.code ?? 0)
      if (closeCode === CLOSE_CODE_DEVICE_REVOKED) {
        this.identityRejected = true
        this.lastError =
          '此设备已被吊销（可在小程序「远程会话 → 设备管理」中查看）。请在桌面端设置中重置设备身份后重新连接。'
        log.warn('relay rejected: device revoked (4403)')
        this.notify()
        return
      }
      if (closeCode === CLOSE_CODE_BAD_SECRET) {
        this.identityRejected = true
        this.lastError =
          '设备密钥校验失败（4401）。可能是本机身份数据损坏，请「重置设备身份」生成新设备身份。'
        log.warn('relay rejected: bad device secret (4401)')
        this.notify()
        return
      }
      if (closeCode === CLOSE_CODE_TOO_MANY_DEVICES) {
        this.identityRejected = true
        this.lastError =
          '账号接入设备数已达上限（4429）。请先在小程序「远程会话 → 设备管理」吊销不用的设备。'
        log.warn('relay rejected: too many devices (4429)')
        this.notify()
        return
      }

      log.warn(`relay disconnected (code ${closeCode})`)
      this.notify()
      this.scheduleRetry()
    }
  }

  private async handleFrame(raw: unknown): Promise<void> {
    let frame: RelayFrame
    try {
      frame = JSON.parse(typeof raw === 'string' ? raw : String(raw)) as RelayFrame
    } catch {
      return
    }

    switch (frame.t) {
      case 'welcome':
        // welcome = 服务端已通过首帧认证并完成注册，此刻起进入正常业务流程
        this.welcomed = true
        this.lastError = null
        this.connectionId = frame.connId ?? null
        this.send({
          t: 'hello',
          deviceId: this.deps.getDeviceId(),
          label: this.deps.getDeviceLabel(),
          version: this.deps.getVersion(),
        })
        // 重连后恢复订阅，否则「连上了但不推流」
        if (this.subscribedSessionId != null) this.subscribeSession(this.subscribedSessionId)
        if (this.pingTimer != null) clearInterval(this.pingTimer)
        this.pingTimer = setInterval(() => this.send({ t: 'ping' }), PING_INTERVAL_MS)
        this.notify()
        return
      case 'pong':
        return
      case 'ping':
        this.send({ t: 'pong' })
        return
      case 'req': {
        const id = frame.id ?? ''
        const method = (frame.m ?? 'GET').toUpperCase()
        const urlPath = frame.p ?? ''
        try {
          const result = await this.deps.invoke(method, urlPath, frame.b ?? null)
          this.send({ t: 'res', id, s: result.status, b: result.body ?? null })
        } catch (error) {
          log.warn(`relay invoke failed ${method} ${urlPath}: ${(error as Error).message}`)
          this.send({
            t: 'res',
            id,
            s: 500,
            b: {
              error: {
                code: 'INTERNAL',
                message: error instanceof Error ? error.message : String(error),
              },
            },
          })
        }
        return
      }
      case 'sub': {
        const sessionId = frame.sessionId
        if (sessionId) this.subscribeSession(sessionId)
        return
      }
      case 'unsub':
        this.unsubscribe?.()
        this.unsubscribe = null
        this.subscribedSessionId = null
        return
      default:
        return
    }
  }

  private subscribeSession(sessionId: string): void {
    // 重连时会收到两条订阅（服务端补发 + 本端恢复），同一会话只订一次，
    // 否则订阅回调会被反复重建。
    if (this.subscribedSessionId === sessionId && this.unsubscribe != null) return
    this.unsubscribe?.()
    this.subscribedSessionId = sessionId
    this.unsubscribe = this.deps.subscribe(sessionId, (events) => {
      this.send({ t: 'event', sessionId, events })
    })
  }

  private send(frame: Record<string, unknown>): void {
    const socket = this.socket
    if (socket == null || socket.readyState !== WebSocket.OPEN) return
    try {
      socket.send(JSON.stringify(frame))
    } catch {
      /* 连接已断开，等 onclose 重连 */
    }
  }

  private scheduleRetry(): void {
    if (this.stopped || this.retryTimer != null) return
    const delay = Math.min(RETRY_BASE_MS * 2 ** this.retryCount, RETRY_MAX_MS)
    this.retryCount += 1
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null
      void this.open()
    }, delay)
  }

  private notify(): void {
    this.deps.onStatusChange?.(this.getStatus())
  }
}

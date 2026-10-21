import { randomUUID } from 'node:crypto'
import { createLogger } from '@spark/shared'
import type {
  MobileBridgeEvent,
  RemoteAgentDeviceListResponse,
  RemoteAgentDeviceSummary,
  RemoteAgentRelayStatus,
} from '@spark/protocol'

const log = createLogger('remote-agent:relay')

const PING_INTERVAL_MS = 20_000
const CONNECT_TIMEOUT_MS = 12_000
const WELCOME_TIMEOUT_MS = 12_000
const RETRY_BASE_MS = 1_000
const RETRY_MAX_MS = 30_000
const DEFAULT_REQUEST_TIMEOUT_MS = 60_000
const MAX_REQUEST_TIMEOUT_MS = 180_000
const ALLOWED_METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE'])
const MOBILE_BRIDGE_EVENT_TYPES = new Set<MobileBridgeEvent['type']>([
  'user_message',
  'assistant_message',
  'agent_thinking',
  'tool_call',
  'tool_result',
  'agent_status',
  'agent_error',
  'presented_files',
])

export type RemoteAgentRelayErrorCode =
  | 'NOT_CONNECTED'
  | 'CONNECTION_LOST'
  | 'TIMEOUT'
  | 'BAD_RESPONSE'
  | 'RELAY_ERROR'

export class RemoteAgentRelayError extends Error {
  constructor(
    readonly code: RemoteAgentRelayErrorCode,
    message: string,
  ) {
    super(message)
    this.name = 'RemoteAgentRelayError'
  }
}

export interface RemoteAgentRelayCallResult {
  status: number
  body: unknown
}

export interface RemoteAgentRelayClientDeps {
  getBaseUrl(): string
  getAccessToken(): Promise<string | null>
  getClientLabel(): string
  getVersion(): string
  onStatusChange?(status: RemoteAgentRelayStatus): void
  onDevicesChange?(devices: RemoteAgentDeviceListResponse): void
}

type RelayEventListener = (events: MobileBridgeEvent[]) => void

interface PendingCall {
  resolve(result: RemoteAgentRelayCallResult): void
  reject(error: Error): void
  timeout: ReturnType<typeof setTimeout>
}

interface Subscription {
  deviceId: string
  sessionId: string
  listeners: Set<RelayEventListener>
}

interface RelayFrame {
  t?: unknown
  id?: unknown
  s?: unknown
  b?: unknown
  connId?: unknown
  message?: unknown
  sessionId?: unknown
  d?: unknown
  events?: unknown
  devices?: unknown
}

function normalizeWsBase(baseUrl: string): string {
  const value = baseUrl.trim().replace(/\/+$/, '')
  if (!value) return ''
  try {
    const url = new URL(value)
    if (url.protocol === 'https:') url.protocol = 'wss:'
    else if (url.protocol === 'http:') url.protocol = 'ws:'
    else if (url.protocol !== 'wss:' && url.protocol !== 'ws:') return ''
    return url.toString().replace(/\/+$/, '')
  } catch {
    return ''
  }
}

function readDevices(value: unknown): RemoteAgentDeviceSummary[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((entry): RemoteAgentDeviceSummary[] => {
    if (entry == null || typeof entry !== 'object') return []
    const device = entry as Record<string, unknown>
    if (typeof device.deviceId !== 'string' || typeof device.online !== 'boolean') return []
    return [
      {
        deviceId: device.deviceId,
        name: typeof device.label === 'string' ? device.label : '桌面端',
        version: typeof device.version === 'string' ? device.version : null,
        online: device.online,
        lastSeenAt: typeof device.lastSeenAt === 'string' ? device.lastSeenAt : null,
      },
    ]
  })
}

function isMobileBridgeEvent(value: unknown): value is MobileBridgeEvent {
  if (value == null || typeof value !== 'object') return false
  const event = value as Record<string, unknown>
  return (
    typeof event.id === 'string' &&
    Number.isInteger(event.seq) &&
    typeof event.turnId === 'string' &&
    typeof event.timestamp === 'string' &&
    typeof event.type === 'string' &&
    MOBILE_BRIDGE_EVENT_TYPES.has(event.type as MobileBridgeEvent['type'])
  )
}

function subscriptionKey(deviceId: string, sessionId: string): string {
  return `${deviceId}\u0000${sessionId}`
}

export class RemoteAgentRelayClient {
  private socket: WebSocket | null = null
  private retryTimer: ReturnType<typeof setTimeout> | null = null
  private connectTimer: ReturnType<typeof setTimeout> | null = null
  private welcomeTimer: ReturnType<typeof setTimeout> | null = null
  private pingTimer: ReturnType<typeof setInterval> | null = null
  private retryCount = 0
  private stopped = true
  private welcomed = false
  private state: RemoteAgentRelayStatus['state'] = 'stopped'
  private connectionId: string | null = null
  private lastError: string | null = null
  private lastSeenAt: string | null = null
  private devices: RemoteAgentDeviceSummary[] = []
  private readonly pending = new Map<string, PendingCall>()
  private readonly subscriptions = new Map<string, Subscription>()

  constructor(private readonly deps: RemoteAgentRelayClientDeps) {}

  getStatus(): RemoteAgentRelayStatus {
    return {
      state: this.state,
      connected: this.socket != null && this.welcomed,
      connectionId: this.connectionId,
      lastError: this.lastError,
      lastSeenAt: this.lastSeenAt,
    }
  }

  listDevices(): RemoteAgentDeviceListResponse {
    return { devices: this.devices.map((device) => ({ ...device })) }
  }

  async start(): Promise<void> {
    if (!this.stopped) return
    this.stopped = false
    await this.open()
  }

  async restart(): Promise<void> {
    this.stop()
    this.retryCount = 0
    await this.start()
  }

  stop(): void {
    this.stopped = true
    this.state = 'stopped'
    this.clearTimers()
    this.closeSocket()
    this.subscriptions.clear()
    this.rejectPending(new RemoteAgentRelayError('NOT_CONNECTED', '远程中继已断开'))
    this.lastError = null
    this.devices = []
    this.deps.onDevicesChange?.(this.listDevices())
    this.notifyStatus()
  }

  request(
    deviceId: string,
    method: string,
    path: string,
    body?: unknown,
    timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
  ): Promise<RemoteAgentRelayCallResult> {
    const normalizedMethod = method.toUpperCase()
    if (!deviceId.trim() || !path.startsWith('/') || path.length > 2048) {
      return Promise.reject(new RemoteAgentRelayError('BAD_RESPONSE', '远程请求参数无效'))
    }
    if (!ALLOWED_METHODS.has(normalizedMethod)) {
      return Promise.reject(new RemoteAgentRelayError('BAD_RESPONSE', '远程请求方法不受支持'))
    }
    if (this.socket == null || !this.welcomed || this.socket.readyState !== WebSocket.OPEN) {
      return Promise.reject(new RemoteAgentRelayError('NOT_CONNECTED', '远程中继尚未连接'))
    }

    const normalizedDeviceId = deviceId.trim()
    const id = randomUUID()
    const requestedTimeout = Number.isFinite(timeoutMs) ? timeoutMs : DEFAULT_REQUEST_TIMEOUT_MS
    const boundedTimeout = Math.max(1_000, Math.min(MAX_REQUEST_TIMEOUT_MS, requestedTimeout))
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id)
        reject(new RemoteAgentRelayError('TIMEOUT', '远程电脑响应超时'))
      }, boundedTimeout)
      this.pending.set(id, { resolve, reject, timeout })
      if (
        !this.send({
          t: 'req',
          id,
          m: normalizedMethod,
          p: path,
          b: body ?? null,
          d: normalizedDeviceId,
        })
      ) {
        clearTimeout(timeout)
        this.pending.delete(id)
        reject(new RemoteAgentRelayError('CONNECTION_LOST', '远程中继连接已断开'))
      }
    })
  }

  subscribe(deviceId: string, sessionId: string, listener: RelayEventListener): () => void {
    if (!deviceId.trim() || !sessionId.trim()) return () => undefined
    const key = subscriptionKey(deviceId, sessionId)
    let subscription = this.subscriptions.get(key)
    if (subscription == null) {
      subscription = { deviceId, sessionId, listeners: new Set() }
      this.subscriptions.set(key, subscription)
      if (this.welcomed) this.send({ t: 'sub', d: deviceId, sessionId })
    }
    const registeredListener: RelayEventListener = (events) => listener(events)
    subscription.listeners.add(registeredListener)

    let active = true
    return () => {
      if (!active) return
      active = false
      const current = this.subscriptions.get(key)
      if (current == null) return
      current.listeners.delete(registeredListener)
      if (current.listeners.size > 0) return
      this.subscriptions.delete(key)
      if (this.welcomed) this.send({ t: 'unsub', d: deviceId, sessionId })
    }
  }

  private async open(): Promise<void> {
    if (this.stopped || this.socket != null) return
    if (this.retryTimer != null) {
      clearTimeout(this.retryTimer)
      this.retryTimer = null
    }

    let configuredBase = ''
    try {
      configuredBase = this.deps.getBaseUrl()
    } catch {
      // Auth can still be initializing when a renderer requests a connection.
    }
    const base = normalizeWsBase(configuredBase)
    if (!base) {
      this.lastError = '未配置有效的 Spark 平台服务地址'
      this.state = this.retryCount === 0 ? 'connecting' : 'reconnecting'
      this.notifyStatus()
      this.scheduleRetry()
      return
    }

    let token: string | null
    try {
      token = await this.deps.getAccessToken()
    } catch {
      token = null
    }
    if (this.stopped) return
    if (token == null) {
      this.lastError = '尚未登录 Spark 平台账号'
      this.state = this.retryCount === 0 ? 'connecting' : 'reconnecting'
      this.notifyStatus()
      this.scheduleRetry()
      return
    }
    if (typeof WebSocket === 'undefined') {
      this.lastError = '当前运行环境不支持 WebSocket'
      this.state = 'stopped'
      this.stopped = true
      this.notifyStatus()
      log.warn('relay stopped: WebSocket is unavailable')
      return
    }

    const url = new URL(base)
    url.pathname = `${url.pathname.replace(/\/+$/, '')}/ws/bridge/client`
    url.hash = ''
    // edu-server client 角色使用短效 JWT query 认证；长期设备密钥不经过此通道。
    // 不记录 URL，避免短效 token 落入应用日志。
    url.searchParams.set('token', token)

    let socket: WebSocket
    try {
      socket = new WebSocket(url.toString())
    } catch {
      this.lastError = '无法建立远程中继连接'
      this.state = this.retryCount === 0 ? 'connecting' : 'reconnecting'
      this.notifyStatus()
      this.scheduleRetry()
      return
    }

    this.socket = socket
    this.welcomed = false
    this.state = this.retryCount === 0 ? 'connecting' : 'reconnecting'
    this.notifyStatus()
    this.connectTimer = setTimeout(() => {
      if (this.socket === socket && socket.readyState === WebSocket.CONNECTING) socket.close()
    }, CONNECT_TIMEOUT_MS)

    socket.onopen = () => {
      if (this.socket !== socket) return
      if (this.connectTimer != null) clearTimeout(this.connectTimer)
      this.connectTimer = null
      this.welcomeTimer = setTimeout(() => {
        if (this.socket === socket && !this.welcomed) socket.close()
      }, WELCOME_TIMEOUT_MS)
    }
    socket.onmessage = (event) => {
      if (this.socket !== socket) return
      this.lastSeenAt = new Date().toISOString()
      this.handleFrame(event.data)
    }
    socket.onerror = () => {
      if (this.socket !== socket) return
      this.lastError = '与 Spark 平台中继的连接发生错误'
      this.notifyStatus()
    }
    socket.onclose = (event) => {
      if (this.socket !== socket) return
      this.socket = null
      this.welcomed = false
      this.connectionId = null
      this.clearConnectionTimers()
      this.rejectPending(new RemoteAgentRelayError('CONNECTION_LOST', '远程中继连接已断开'))
      if (this.stopped) {
        this.state = 'stopped'
      } else {
        this.state = 'reconnecting'
        if (event.reason) this.lastError = event.reason.slice(0, 160)
        log.warn(`relay disconnected (code=${Number(event.code) || 0})`)
        this.scheduleRetry()
      }
      this.notifyStatus()
    }
  }

  private handleFrame(raw: unknown): void {
    let frame: RelayFrame
    try {
      frame = JSON.parse(typeof raw === 'string' ? raw : String(raw)) as RelayFrame
    } catch {
      return
    }

    switch (frame.t) {
      case 'welcome':
        this.welcomed = true
        this.state = 'connected'
        this.retryCount = 0
        this.lastError = null
        this.connectionId = typeof frame.connId === 'string' ? frame.connId : null
        this.clearConnectionTimers()
        this.send({
          t: 'hello',
          label: this.deps.getClientLabel(),
          version: this.deps.getVersion(),
        })
        this.updateDevices(frame.devices)
        log.info('relay connected')
        for (const subscription of this.subscriptions.values()) {
          this.send({
            t: 'sub',
            d: subscription.deviceId,
            sessionId: subscription.sessionId,
          })
        }
        if (this.pingTimer != null) clearInterval(this.pingTimer)
        this.pingTimer = setInterval(() => this.send({ t: 'ping' }), PING_INTERVAL_MS)
        this.notifyStatus()
        return
      case 'presence':
        this.updateDevices(frame.devices)
        return
      case 'pong':
        return
      case 'ping':
        this.send({ t: 'pong' })
        return
      case 'res': {
        if (typeof frame.id !== 'string') return
        const pending = this.pending.get(frame.id)
        if (pending == null) return
        this.pending.delete(frame.id)
        clearTimeout(pending.timeout)
        const status = Number(frame.s)
        if (!Number.isInteger(status) || status < 100 || status > 599) {
          pending.reject(new RemoteAgentRelayError('BAD_RESPONSE', '中继返回了无效响应'))
          return
        }
        pending.resolve({ status, body: frame.b ?? null })
        return
      }
      case 'error': {
        if (typeof frame.id !== 'string') return
        const pending = this.pending.get(frame.id)
        if (pending == null) return
        this.pending.delete(frame.id)
        clearTimeout(pending.timeout)
        pending.reject(
          new RemoteAgentRelayError(
            'RELAY_ERROR',
            typeof frame.message === 'string' ? frame.message.slice(0, 160) : '中继请求失败',
          ),
        )
        return
      }
      case 'event':
        this.dispatchEvents(frame)
        return
      default:
        return
    }
  }

  private dispatchEvents(frame: RelayFrame): void {
    if (
      typeof frame.d !== 'string' ||
      typeof frame.sessionId !== 'string' ||
      !Array.isArray(frame.events)
    ) {
      return
    }
    const subscription = this.subscriptions.get(subscriptionKey(frame.d, frame.sessionId))
    if (subscription == null) return
    const events = frame.events.filter(isMobileBridgeEvent)
    if (events.length === 0) return
    for (const listener of subscription.listeners) {
      try {
        listener(events)
      } catch {
        log.warn('session event listener failed')
      }
    }
  }

  private updateDevices(rawDevices: unknown): void {
    this.devices = readDevices(rawDevices)
    this.deps.onDevicesChange?.(this.listDevices())
  }

  private send(frame: Record<string, unknown>): boolean {
    const socket = this.socket
    if (socket == null || socket.readyState !== WebSocket.OPEN) return false
    try {
      socket.send(JSON.stringify(frame))
      return true
    } catch {
      return false
    }
  }

  private rejectPending(error: Error): void {
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timeout)
      pending.reject(error)
      this.pending.delete(id)
    }
  }

  private closeSocket(): void {
    const socket = this.socket
    this.socket = null
    this.welcomed = false
    this.connectionId = null
    this.clearConnectionTimers()
    if (socket == null) return
    socket.onopen = null
    socket.onmessage = null
    socket.onerror = null
    socket.onclose = null
    try {
      socket.close()
    } catch {
      /* The socket is already closed. */
    }
  }

  private clearConnectionTimers(): void {
    if (this.connectTimer != null) clearTimeout(this.connectTimer)
    if (this.welcomeTimer != null) clearTimeout(this.welcomeTimer)
    if (this.pingTimer != null) clearInterval(this.pingTimer)
    this.connectTimer = null
    this.welcomeTimer = null
    this.pingTimer = null
  }

  private clearTimers(): void {
    this.clearConnectionTimers()
    if (this.retryTimer != null) clearTimeout(this.retryTimer)
    this.retryTimer = null
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

  private notifyStatus(): void {
    this.deps.onStatusChange?.(this.getStatus())
  }
}

import type {
  MobileBridgeEvent,
  MobileBridgeHistoryResponse,
  MobileBridgeRelayDesktopInfo,
  MobileBridgeRelayFrame,
  MobileBridgeSessionListResponse,
  MobileBridgeSubmitTurnResponse,
} from '../../../packages/protocol/src/mobile-bridge'
import { SERVICE_ORIGIN } from './auth'

export type Device = Pick<MobileBridgeRelayDesktopInfo, 'deviceId' | 'label'>
export type Session = Pick<MobileBridgeSessionListResponse['sessions'][number], 'id' | 'title'>
interface SessionPage {
  sessions: Session[]
  nextOffset: number | null
}

class RequestNotSent extends Error {}

export class SubmitError extends Error {
  constructor(
    readonly outcome: 'not-sent' | 'unconfirmed',
    cause: unknown,
  ) {
    super(cause instanceof Error ? cause.message : '电脑未确认消息', { cause })
  }
}

export interface Target {
  deviceId: string
  sessionId: string
}
type SocketHandler = 'onopen' | 'onmessage' | 'onerror' | 'onclose'
export type SocketPort = Pick<WebSocket, 'send' | 'close'> & {
  [Handler in SocketHandler]: OmitThisParameter<NonNullable<WebSocket[Handler]>> | null
}
type SocketFactory = (url: string) => SocketPort

interface Pending {
  resolve(body: unknown): void
  reject(error: Error): void
  timer: ReturnType<typeof setTimeout>
}

export function object(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}

const textFields = [
  'content',
  'segmentId',
  'toolName',
  'toolCallId',
  'status',
  'statusMessage',
] as const
export function readEvents(value: unknown): MobileBridgeEvent[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((raw: unknown): MobileBridgeEvent[] => {
    const event = object(raw)
    if (
      !event ||
      typeof event.id !== 'string' ||
      typeof event.turnId !== 'string' ||
      typeof event.seq !== 'number' ||
      !Number.isSafeInteger(event.seq) ||
      typeof event.timestamp !== 'string'
    )
      return []
    const { id, turnId, seq, timestamp, type } = event
    if (
      type !== 'user_message' &&
      type !== 'assistant_message' &&
      type !== 'agent_error' &&
      type !== 'agent_status'
    )
      return []
    const safe: MobileBridgeEvent = { id, turnId, seq, timestamp, type }
    for (const field of textFields) {
      const entry = event[field]
      if (typeof entry === 'string') safe[field] = entry
    }
    if (event.mode === 'delta' || event.mode === 'complete') safe.mode = event.mode
    if (typeof event.isFinal === 'boolean') safe.isFinal = event.isFinal
    return [safe]
  })
}

export class Relay {
  private socket: SocketPort | null = null
  private ready = false
  private seq = 0
  private handshake?: ReturnType<typeof setTimeout>
  private heartbeat?: ReturnType<typeof setInterval>
  private lastFrame = 0
  private retry?: ReturnType<typeof setTimeout>
  private failures = 0
  private active = false
  private authBlocked = false
  private pending = new Map<string, Pending>()
  private subscription?: { target: Target; listener(events: MobileBridgeEvent[]): void }

  constructor(
    private readonly token: string,
    private readonly clientId: string,
    private readonly callbacks: {
      presence(devices: Device[]): void
      state(status: 'connecting' | 'online' | 'offline'): void
      issue(message: string): void
      restored(): void
    },
    private readonly makeSocket: SocketFactory = (url) => new WebSocket(url),
  ) {}

  resume(): void {
    if (this.authBlocked) return
    this.active = true
    if (this.socket || this.retry) return
    this.callbacks.state('connecting')
    const label = 'SparkWork 原生样机'
    const base = SERVICE_ORIGIN.replace(/^https:/, 'wss:')
    let socket: SocketPort
    try {
      socket = this.makeSocket(
        `${base}/ws/bridge/client?token=${encodeURIComponent(this.token)}&deviceId=${encodeURIComponent(this.clientId)}&label=${encodeURIComponent(label)}`,
      )
    } catch {
      this.lost('无法连接云中继')
      return
    }
    this.socket = socket
    this.handshake = setTimeout(() => this.lost('云中继握手超时'), 12_000)
    socket.onopen = () => {
      if (this.socket === socket) this.send({ t: 'hello', deviceId: this.clientId, label })
    }
    socket.onmessage = ({ data }) => {
      if (this.socket === socket && typeof data === 'string') this.accept(data)
    }
    socket.onerror = () => {
      if (this.socket === socket) this.lost('云中继连接中断')
    }
    socket.onclose = ({ code }) => {
      if (this.socket !== socket) return
      if (code === 4401 || code === 4403 || code === 1008) this.authFailed()
      else this.lost('云中继连接已关闭')
    }
  }

  pause(): void {
    this.active = false
    clearTimeout(this.retry)
    this.retry = undefined
    this.disconnect('云中继已暂停')
  }

  private disconnect(message: string): void {
    clearTimeout(this.handshake)
    clearInterval(this.heartbeat)
    const socket = this.socket
    this.socket = null
    this.ready = false
    try {
      socket?.close()
    } catch {
      /* Already closed. */
    }
    for (const request of this.pending.values()) {
      clearTimeout(request.timer)
      request.reject(new Error(message))
    }
    this.pending.clear()
    this.callbacks.state('offline')
  }

  private lost(message: string): void {
    this.disconnect(message)
    if (!this.active) return
    this.callbacks.issue(`${message}，正在重连`)
    this.retry = setTimeout(
      () => {
        this.retry = undefined
        this.resume()
      },
      Math.min(15_000, 1000 * 2 ** this.failures),
    )
    this.failures = Math.min(4, this.failures + 1)
  }

  private authFailed(): void {
    this.authBlocked = true
    this.pause()
    this.callbacks.issue('账号鉴权失败，请退出后重新登录')
  }

  private send(frame: MobileBridgeRelayFrame): boolean {
    if (!this.socket) return false
    try {
      this.socket.send(JSON.stringify(frame))
      return true
    } catch {
      this.lost('无法发送中继数据')
      return false
    }
  }

  private accept(text: string): void {
    let frame: Record<string, unknown> | undefined
    try {
      frame = object(JSON.parse(text))
    } catch {
      return
    }
    if (!frame) return
    this.lastFrame = Date.now()

    if (frame.t === 'welcome' || frame.t === 'presence') {
      if (frame.t === 'presence' && !this.ready) return
      const devices: Device[] = []
      if (Array.isArray(frame.devices)) {
        for (const raw of frame.devices) {
          const device = object(raw)
          if (device?.online !== false && typeof device?.deviceId === 'string' && device.deviceId) {
            devices.push({
              deviceId: device.deviceId,
              label: typeof device.label === 'string' ? device.label : device.deviceId,
            })
          }
        }
      } else {
        const legacy = object(frame.desktop)
        if (legacy?.online === true && typeof legacy.deviceId === 'string' && legacy.deviceId) {
          devices.push({
            deviceId: legacy.deviceId,
            label: typeof legacy.label === 'string' ? legacy.label : legacy.deviceId,
          })
        }
      }
      this.callbacks.presence(devices)
      if (this.ready) return
      clearTimeout(this.handshake)
      this.ready = true
      this.failures = 0
      this.heartbeat = setInterval(() => {
        if (Date.now() - this.lastFrame >= 55_000) this.lost('云中继心跳超时')
        else this.send({ t: 'ping' })
      }, 25_000)
      const target = this.subscription?.target
      if (target && !this.send({ t: 'sub', sessionId: target.sessionId, d: target.deviceId }))
        return
      this.callbacks.state('online')
      this.callbacks.restored()
      return
    }

    if (frame.t === 'error') {
      if (frame.code === 'AUTH' || frame.code === 'UNAUTHORIZED') {
        this.authFailed()
      } else this.callbacks.issue('云中继拒绝了当前操作')
      return
    }
    if (!this.ready) return
    if (frame.t === 'res' && typeof frame.id === 'string') {
      const request = this.pending.get(frame.id)
      if (!request) return
      this.pending.delete(frame.id)
      clearTimeout(request.timer)
      const status = frame.s
      if (typeof status === 'number' && status >= 200 && status < 300) request.resolve(frame.b)
      else
        request.reject(
          new Error(
            status === 503
              ? '电脑暂不可用'
              : status === 504
                ? '电脑响应超时'
                : `电脑请求失败 (${typeof status === 'number' ? status : '响应异常'})`,
          ),
        )
    }
    if (frame.t === 'event') {
      const subscription = this.subscription
      if (
        subscription &&
        frame.sessionId === subscription.target.sessionId &&
        frame.d === subscription.target.deviceId
      ) {
        subscription.listener(readEvents(frame.events))
      }
    }
  }

  subscribe(target: Target, listener: (events: MobileBridgeEvent[]) => void): () => void {
    const subscription = { target, listener }
    this.subscription = subscription
    if (this.ready) this.send({ t: 'sub', sessionId: target.sessionId, d: target.deviceId })
    return () => {
      if (this.subscription !== subscription) return
      this.subscription = undefined
      if (this.ready) this.send({ t: 'unsub', sessionId: target.sessionId, d: target.deviceId })
    }
  }

  private call(
    deviceId: string,
    path: string,
    method: 'GET' | 'POST',
    body?: unknown,
  ): Promise<unknown> {
    if (!this.ready || !this.socket || !deviceId)
      return Promise.reject(new RequestNotSent('尚未连接到云中继'))
    const id = `native-${++this.seq}`
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error('电脑端响应超时'))
      }, 30_000)
      this.pending.set(id, { resolve, reject, timer })
      this.send({ t: 'req', id, m: method, p: path, b: body ?? null, d: deviceId })
    })
  }

  async sessions(deviceId: string, offset = 0): Promise<SessionPage> {
    const body = object(await this.call(deviceId, `/v1/sessions?limit=50&offset=${offset}`, 'GET'))
    if (
      !Array.isArray(body?.sessions) ||
      typeof body.total !== 'number' ||
      !Number.isSafeInteger(body.total) ||
      body.total < 0
    )
      throw new Error('会话列表格式异常')
    const end = offset + body.sessions.length
    const sessions = body.sessions.flatMap((row: unknown) => {
      const session = object(row)
      return typeof session?.id === 'string' && session.id && typeof session.title === 'string'
        ? [{ id: session.id, title: session.title }]
        : []
    })
    return { sessions, nextOffset: end > offset && end < body.total ? end : null }
  }

  async history(target: Target): Promise<Pick<MobileBridgeHistoryResponse, 'events' | 'running'>> {
    const body = object(
      await this.call(
        target.deviceId,
        `/v1/sessions/${encodeURIComponent(target.sessionId)}/messages?limit=200`,
        'GET',
      ),
    )
    if (
      body?.sessionId !== target.sessionId ||
      !Array.isArray(body.events) ||
      typeof body.running !== 'boolean'
    ) {
      throw new Error('会话历史格式异常')
    }
    return { events: readEvents(body.events), running: body.running }
  }

  async submit(
    target: Target,
    text: string,
    clientMessageId: string,
  ): Promise<MobileBridgeSubmitTurnResponse> {
    try {
      const body = object(
        await this.call(
          target.deviceId,
          `/v1/sessions/${encodeURIComponent(target.sessionId)}/turns`,
          'POST',
          { text, clientMessageId },
        ),
      )
      if (typeof body?.turnId !== 'string' || !body.turnId) throw new Error('电脑未确认消息')
      return { turnId: body.turnId, started: body.started !== false }
    } catch (cause) {
      // Only a local preflight rejection proves the request never left the client.
      throw new SubmitError(cause instanceof RequestNotSent ? 'not-sent' : 'unconfirmed', cause)
    }
  }
}

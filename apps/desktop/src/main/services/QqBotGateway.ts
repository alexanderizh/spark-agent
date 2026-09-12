import { createLogger } from '@spark/shared'
import { parseQqDispatchEvent, type QqInboundMessage } from './qqProtocol.js'

const log = createLogger('qq-gateway')

const QQ_API_BASE = 'https://api.sgroup.qq.com'

// GROUP_AND_C2C_EVENT（群聊 + 单聊）与 PUBLIC_GUILD_MESSAGES（频道 @ 消息）。
const QQ_INTENTS_GROUP_C2C = 1 << 25
const QQ_INTENTS_PUBLIC_GUILD_MESSAGES = 1 << 9

const OP_DISPATCH = 0
const OP_HEARTBEAT = 1
const OP_IDENTIFY = 2
const OP_RESUME = 6
const OP_RECONNECT = 7
const OP_INVALID_SESSION = 9
const OP_HELLO = 10
const OP_HEARTBEAT_ACK = 11

export type QqGatewayStatus = {
  running: boolean
  lastError?: string
}

type QqGatewayOptions = {
  appId: string
  clientSecret: string
  getToken: () => Promise<string>
  onMessage: (message: QqInboundMessage) => void
  onStatusChange: (status: QqGatewayStatus) => void
}

/**
 * QQ 官方机器人 WebSocket 网关客户端（对齐飞书长连接的“客户端拉取”模式，无需公网）。
 *
 * 生命周期：start() 后循环连接（带退避重连）；每次连接经历
 * 获取网关地址 → WebSocket 握手 → op:10 Hello → Identify/Resume → 周期心跳；
 * 服务端要求重连（op:7）或心跳超时后断开重建，保留 session 走 Resume 续传。
 */
export class QqBotGateway {
  private readonly options: QqGatewayOptions
  private stopped = false
  private ws: WebSocket | null = null
  private sessionId: string | null = null
  private lastSeq: number | null = null
  private heartbeatIntervalMs = 0
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null
  private heartbeatAckAt = 0
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private failCount = 0
  private startedAt = 0
  private status: QqGatewayStatus = { running: false }

  constructor(options: QqGatewayOptions) {
    this.options = options
  }

  matches(appId: string, clientSecret: string): boolean {
    return this.options.appId === appId && this.options.clientSecret === clientSecret
  }

  getStatus(): QqGatewayStatus {
    return this.status
  }

  start(): void {
    if (!this.stopped && this.startedAt > 0) return
    this.stopped = false
    this.startedAt = Date.now()
    void this.connectLoop()
  }

  stop(): void {
    this.stopped = true
    this.clearTimers()
    this.closeSocket()
    this.sessionId = null
    this.lastSeq = null
    this.updateStatus({ running: false })
  }

  private updateStatus(patch: Partial<QqGatewayStatus>): void {
    const next: QqGatewayStatus = { running: this.status.running, ...patch }
    this.status = next
    try {
      this.options.onStatusChange(next)
    } catch {
      // 状态回调失败不影响网关循环。
    }
  }

  private async connectLoop(): Promise<void> {
    while (!this.stopped) {
      try {
        await this.connectOnce()
        this.failCount = 0
      } catch (err) {
        this.failCount += 1
        const message = err instanceof Error ? err.message : String(err)
        this.updateStatus({
          running: false,
          lastError: message,
        })
        log.warn(`QQ 网关连接失败(第 ${this.failCount} 次): ${message}`)
      }
      if (this.stopped) break
      const delay = Math.min(2 ** Math.min(this.failCount, 5) * 1000, 60_000)
      log.info(`${Math.round(delay / 1000)}s 后重连 QQ 网关`)
      await new Promise<void>((resolve) => {
        this.reconnectTimer = setTimeout(resolve, delay)
      })
    }
  }

  private async connectOnce(): Promise<void> {
    const token = await this.options.getToken()
    const gatewayUrl = await this.fetchGatewayUrl(token)
    await new Promise<void>((resolve, reject) => {
      const socket = new WebSocket(gatewayUrl)
      this.ws = socket
      let ready = false

      const cleanup = () => {
        if (this.heartbeatTimer != null) {
          clearInterval(this.heartbeatTimer)
          this.heartbeatTimer = null
        }
        socket.removeEventListener('message', onMessage)
        socket.removeEventListener('close', onClose)
        socket.removeEventListener('error', onError)
      }
      const finish = (err?: Error) => {
        cleanup()
        this.updateStatus({ running: false })
        if (err != null) reject(err)
        else resolve()
      }
      const onMessage = (event: MessageEvent) => {
        try {
          const payload = this.decodePayload(event.data)
          if (payload == null) return
          if (typeof payload.s === 'number') this.lastSeq = payload.s
          switch (payload.op) {
            case OP_HELLO: {
              this.heartbeatIntervalMs = readHeartbeatInterval(payload.d)
              log.info(`收到 Hello，心跳间隔 ${this.heartbeatIntervalMs}ms，发送 Identify/Resume`)
              this.startHeartbeat()
              this.sendIdentifyOrResume(socket, token)
              break
            }
            case OP_DISPATCH: {
              if (payload.t === 'READY' || payload.t === 'RESUMED') {
                if (payload.t === 'READY') {
                  this.sessionId = readSessionId(payload.d)
                  log.info('QQ 网关就绪(READY)，会话已建立')
                } else {
                  log.info('QQ 网关会话已恢复(RESUMED)')
                }
                ready = true
                this.updateStatus({ running: true })
              } else {
                log.info(`收到 QQ 事件: ${payload.t ?? '(无类型)'}`)
                this.handleDispatch(payload)
              }
              break
            }
            case OP_HEARTBEAT_ACK: {
              this.heartbeatAckAt = Date.now()
              break
            }
            case OP_RECONNECT: {
              log.info('服务端要求重连(op:7)，断开当前连接')
              finish()
              break
            }
            case OP_INVALID_SESSION: {
              log.warn('会话失效(op:9)，丢弃 session 重新 Identify')
              this.sessionId = null
              this.lastSeq = null
              this.sendIdentifyOrResume(socket, token)
              break
            }
          }
        } catch (err) {
          finish(err instanceof Error ? err : new Error(String(err)))
        }
      }
      const onClose = () => {
        // READY 之前断开视为连接失败，交由外层退避重试。
        finish(ready ? undefined : new Error('QQ WebSocket 在 READY 前断开'))
      }
      const onError = () => {
        finish(ready ? undefined : new Error('QQ WebSocket 连接失败'))
      }

      socket.addEventListener('message', onMessage)
      socket.addEventListener('close', onClose)
      socket.addEventListener('error', onError)
    })
  }

  private decodePayload(data: unknown): { op: number; s?: number; t?: string; d?: unknown } | null {
    if (typeof data !== 'string') return null
    try {
      const parsed = JSON.parse(data) as { op?: unknown; s?: unknown; t?: unknown; d?: unknown }
      if (typeof parsed.op !== 'number') return null
      return {
        op: parsed.op,
        ...(typeof parsed.s === 'number' ? { s: parsed.s } : {}),
        ...(typeof parsed.t === 'string' ? { t: parsed.t } : {}),
        d: parsed.d,
      }
    } catch {
      return null
    }
  }

  private sendIdentifyOrResume(socket: WebSocket, token: string): void {
    if (this.sessionId != null && this.lastSeq != null) {
      socket.send(
        JSON.stringify({
          op: OP_RESUME,
          d: { token: `QQBot ${token}`, session_id: this.sessionId, seq: this.lastSeq },
        }),
      )
      return
    }
    socket.send(
      JSON.stringify({
        op: OP_IDENTIFY,
        d: {
          token: `QQBot ${token}`,
          intents: QQ_INTENTS_GROUP_C2C | QQ_INTENTS_PUBLIC_GUILD_MESSAGES,
          shard: [0, 1],
        },
      }),
    )
  }

  private startHeartbeat(): void {
    if (this.heartbeatTimer != null) clearInterval(this.heartbeatTimer)
    const intervalMs = this.heartbeatIntervalMs
    if (!(intervalMs > 0)) return
    this.heartbeatAckAt = Date.now()
    this.heartbeatTimer = setInterval(() => {
      const socket = this.ws
      if (socket == null || socket.readyState !== WebSocket.OPEN) return
      socket.send(
        JSON.stringify({
          op: OP_HEARTBEAT,
          d: this.lastSeq != null ? this.lastSeq : null,
        }),
      )
      // 心跳在 1.5 个周期内无 ACK 视为假连接，主动断开触发重连。
      if (Date.now() - this.heartbeatAckAt > intervalMs * 1.5) {
        log.warn('心跳连续无 ACK，判定假连接，主动断开重连')
        this.closeSocket()
      }
    }, intervalMs)
  }

  private handleDispatch(payload: { t?: string; d?: unknown }): void {
    const message = parseQqDispatchEvent(payload.t, payload.d)
    if (message == null) {
      log.warn(`未识别的 QQ 事件，已忽略: ${payload.t ?? '(无类型)'}`)
      return
    }
    // 过滤重连/Resume 期间重放的旧事件，与飞书网关的 startedAt 过滤口径一致。
    // 丢弃消息属于重要事件，用 warn 级别保证在默认日志级别(warn)下可见。
    if (message.timestamp * 1000 < this.startedAt - 60_000) {
      log.warn(`忽略重放旧事件: ${payload.t ?? ''} ts=${message.timestamp}`)
      return
    }
    try {
      this.options.onMessage(message)
    } catch (err) {
      log.error(`处理 QQ 事件异常: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  private async fetchGatewayUrl(token: string): Promise<string> {
    const response = await fetch(`${QQ_API_BASE}/gateway`, {
      headers: { Authorization: `QQBot ${token}` },
    })
    const text = await response.text().catch(() => '')
    if (!response.ok) {
      throw new Error(`QQ gateway 获取失败: ${response.status} ${text.slice(0, 200)}`)
    }
    const data = JSON.parse(text) as { url?: unknown }
    if (typeof data.url !== 'string' || data.url.length === 0) {
      throw new Error('QQ gateway 响应缺少 url')
    }
    return data.url
  }

  private clearTimers(): void {
    if (this.heartbeatTimer != null) {
      clearInterval(this.heartbeatTimer)
      this.heartbeatTimer = null
    }
    if (this.reconnectTimer != null) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
  }

  private closeSocket(): void {
    const socket = this.ws
    this.ws = null
    try {
      socket?.close()
    } catch {
      // close 失败不影响本地状态清理。
    }
  }
}

function readHeartbeatInterval(d: unknown): number {
  if (d != null && typeof d === 'object' && 'heartbeat_interval' in d) {
    const value = (d as { heartbeat_interval?: unknown }).heartbeat_interval
    if (typeof value === 'number' && value > 0) return value
  }
  return 0
}

function readSessionId(d: unknown): string | null {
  if (d != null && typeof d === 'object' && 'session_id' in d) {
    const value = (d as { session_id?: unknown }).session_id
    if (typeof value === 'string' && value.length > 0) return value
  }
  return null
}

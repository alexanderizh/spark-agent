import { createLogger } from '@spark/shared'
import { parseQqDispatchEvent, type QqInboundMessage } from './qqProtocol.js'

const log = createLogger('qq-gateway')

const QQ_API_BASE = 'https://api.sgroup.qq.com'

// GROUP_AND_C2C_EVENT（群聊 + 单聊）、PUBLIC_GUILD_MESSAGES（频道 @ 消息）与 GUILDS（基础事件）。
const QQ_INTENTS_GUILDS = 1 << 0
const QQ_INTENTS_GROUP_C2C = 1 << 25
const QQ_INTENTS_PUBLIC_GUILD_MESSAGES = 1 << 9

// intents 降级阶梯：Identify 被拒（op:9 / 关闭码 4013/4014）时逐级降低事件订阅。
// 机器人未开通某类消息能力时不应彻底无法连接——管理员自用、仅部分场景可用的情况下，
// 降低订阅后仍可保持长连接在线；下次 start() 会回到全量重新尝试。
const INTENT_FALLBACK_LADDER = [
  QQ_INTENTS_GROUP_C2C | QQ_INTENTS_PUBLIC_GUILD_MESSAGES,
  QQ_INTENTS_GROUP_C2C,
  QQ_INTENTS_PUBLIC_GUILD_MESSAGES,
  QQ_INTENTS_GUILDS,
] as const

// 官方 WebSocket 错误码 → 提示文案（见 https://bot.q.qq.com/wiki/develop/api-v2/dev-prepare/event-emit/websocket.html）。
const QQ_WS_CLOSE_CODE_HINTS: Record<number, string> = {
  4001: '无效的 opcode',
  4002: '无效的 payload',
  4006: '无效的 session id，需重新鉴权',
  4007: 'seq 错误，需重新鉴权',
  4008: '发送频率过快',
  4009: '连接过期',
  4010: '无效的 shard',
  4011: '连接需要处理的频道过多，需分片',
  4012: '无效的 version',
  4013: 'intents 参数无效',
  4014: '机器人未开通所申请的事件订阅（消息能力）权限',
  4914: '机器人未上线，只允许连接沙箱环境',
  4915: '机器人已被封禁',
}

// 这两个关闭码表示服务端拒绝了本次 intents 申请，降级订阅后重试可能恢复。
const INTENT_REJECT_CLOSE_CODES = new Set([4013, 4014])

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
  // 当前 intents 降级档位（INTENT_FALLBACK_LADDER 下标）；Identify 被拒时逐级下调。
  private intentsLevel = 0
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
    this.intentsLevel = 0
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
                  if (this.intentsLevel > 0) {
                    log.warn(
                      `QQ 网关就绪(READY)，当前为降级事件订阅(intentsLevel=${this.intentsLevel})；` +
                        '如需恢复群聊/单聊订阅，请到 QQ 开放平台开通对应消息能力后重新启用连接',
                    )
                  } else {
                    log.info('QQ 网关就绪(READY)，会话已建立')
                  }
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
              // 协议要求：收到 op:9 后服务端会关闭当前连接，不能在同一 socket 上重发
              // Identify/Resume；d 为布尔值，指示 session 是否可续用。READY 前收到 op:9
              // 视为服务端拒绝本次鉴权（常见于申请的 intents 超出机器人权限），断开后
              // 由外层退避重连；重连前自动降低一档事件订阅，避免未开通消息能力的机器人
              // （如仅管理员自用）彻底无法建立长连接。
              const resumable = payload.d === true
              if (!resumable) {
                this.sessionId = null
                this.lastSeq = null
              }
              if (ready) {
                log.warn(`会话失效(op:9, resumable=${resumable})，断开后重连`)
                finish()
                break
              }
              const downgraded = this.downgradeIntents()
              log.warn(
                `会话在 READY 前失效(op:9, resumable=${resumable})` +
                  `${downgraded ? `，已降级事件订阅至第 ${this.intentsLevel} 档后重连` : '，等待重连'}`,
              )
              finish(
                new Error(
                  downgraded
                    ? `QQ 鉴权被拒(op:9)，已降级事件订阅至第 ${this.intentsLevel} 档重试`
                    : 'QQ 会话在 READY 前失效(op:9)，等待重连',
                ),
              )
              break
            }
          }
        } catch (err) {
          finish(err instanceof Error ? err : new Error(String(err)))
        }
      }
      // 主进程编译目标无 DOM lib，Node 内置 WebSocket 未暴露全局 CloseEvent 类型，
      // 用结构类型约束本回调实际读取的 code/reason 字段。
      const onClose = (event: { code: number; reason: string }) => {
        // 服务端拒绝鉴权时通过关闭码给出原因（4014=intents 无权限、4914=未上线仅允许
        // 沙箱、4915=封禁等），必须记录并透传到 lastError，否则无法定位真实拒绝原因。
        const code = event.code
        const hint = QQ_WS_CLOSE_CODE_HINTS[code]
        const reason = event.reason ? `, reason=${event.reason.slice(0, 120)}` : ''
        if (ready) {
          log.info(`QQ WebSocket 就绪后关闭(code=${code}${reason})`)
          finish()
          return
        }
        log.warn(`QQ WebSocket 在 READY 前被关闭(code=${code}${reason})${hint ? `：${hint}` : ''}`)
        if (INTENT_REJECT_CLOSE_CODES.has(code)) {
          const downgraded = this.downgradeIntents()
          finish(
            new Error(
              `QQ 网关被服务端拒绝(code=${code})：${hint}` +
                (downgraded ? `，已降级事件订阅至第 ${this.intentsLevel} 档重试` : ''),
            ),
          )
          return
        }
        finish(
          new Error(
            `QQ WebSocket 在 READY 前断开(code=${code}${reason})${hint ? `：${hint}` : ''}`,
          ),
        )
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
          intents: INTENT_FALLBACK_LADDER[this.intentsLevel] ?? INTENT_FALLBACK_LADDER[0],
          shard: [0, 1],
        },
      }),
    )
  }

  /**
   * 降低一档事件订阅；已在最低档时返回 false（保持原档位继续退避重试）。
   */
  private downgradeIntents(): boolean {
    if (this.intentsLevel >= INTENT_FALLBACK_LADDER.length - 1) return false
    this.intentsLevel += 1
    return true
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

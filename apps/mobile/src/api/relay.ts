/**
 * 云端中继传输（小程序侧）。
 *
 * 直连要求手机与电脑在同一网络、且电脑端口可达；小程序体验版还强制 https/wss + 域名白名单，
 * 真机上基本连不通。中继模式下小程序只连 edu-server，由服务端按账号把调用转发给本人的桌面端：
 *
 *     小程序（本文件）──wss──> edu-server <──wss── 桌面端
 *
 * 于是：不需要同 Wi-Fi、不需要电脑有公网 IP、不需要配路由器，登录同一个账号即可接管会话。
 *
 * 一条连接同时承载「调用」和「事件流」（用 sub/unsub 复用），因为小程序对并发 WebSocket
 * 数量有历史限制，多路复用更稳。
 *
 * 帧协议与 edu-server `src/service/mobile-bridge/relay-hub.ts` 对齐。
 */

import { getConfig } from '../config'
import { getItem, setItem } from '../utils/storage'
import { StorageKeys } from '../utils/storage'
import { BridgeError, BRIDGE_HINTS } from './bridge-error'
import { request } from './request'

const RelayKeys = {
  enabled: 'spark-mobile:relay-enabled',
  deviceId: 'spark-mobile:relay-device-id',
} as const

/** 建连超时：握手卡住时及时失败并给出提示，而不是一直转圈 */
const CONNECT_TIMEOUT_MS = 12_000
/** 应用级心跳：保活 + 刷新服务端在线标记 */
const PING_INTERVAL_MS = 25_000
/** 重连退避：1s 起，封顶 15s */
const RETRY_BASE_MS = 1_000
const RETRY_MAX_MS = 15_000

interface PendingCall {
  resolve: (result: { status: number; body: unknown }) => void
  reject: (error: Error) => void
  timer: ReturnType<typeof setTimeout>
}

export interface RelayStreamHandlers {
  onOpen?(): void
  onEvent(events: unknown[]): void
  onError(message: string): void
  onClose(): void
}

let socket: WechatMiniprogram.SocketTask | null = null
let connected = false
let connectPromise: Promise<void> | null = null
let pingTimer: ReturnType<typeof setInterval> | null = null
let retryTimer: ReturnType<typeof setTimeout> | null = null
let retryCount = 0
/** 小程序主动关闭（onUnload）时不再重连 */
let intentionallyClosed = false
let callSeq = 0
const pending = new Map<string, PendingCall>()
let stream: { sessionId: string; handlers: RelayStreamHandlers } | null = null
/** 桌面端在线状态（presence 帧） */
let desktopOnline: boolean | null = null
/** 在线桌面端的设备号（presence 帧；离线为 null） */
let onlineDeviceId: string | null = null

// ─── 开关与地址 ───────────────────────────────────────────────────────────────

export function isRelayEnabled(): boolean {
  return getItem<boolean>(RelayKeys.enabled) !== false
}

export function setRelayEnabled(enabled: boolean): void {
  setItem(RelayKeys.enabled, enabled)
  if (!enabled) closeRelay()
}

function getDeviceId(): string {
  let id = getItem<string>(RelayKeys.deviceId)
  if (!id) {
    id = `mp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
    setItem(RelayKeys.deviceId, id)
  }
  return id
}

function relayWsUrl(): string | null {
  const token = getItem<string>(StorageKeys.token)
  if (!token) return null
  const base = getConfig().baseUrl.replace(/\/+$/, '')
  const wsBase = base.startsWith('https://')
    ? `wss://${base.slice('https://'.length)}`
    : base.startsWith('http://')
      ? `ws://${base.slice('http://'.length)}`
      : `wss://${base}`
  const query = `token=${encodeURIComponent(token)}&deviceId=${encodeURIComponent(getDeviceId())}&label=${encodeURIComponent('微信小程序')}`
  return `${wsBase}/ws/bridge/client?${query}`
}

// ─── 连接管理 ─────────────────────────────────────────────────────────────────

export function isRelayConnected(): boolean {
  return connected
}

export function isDesktopOnline(): boolean | null {
  return desktopOnline
}

/** 在线桌面端的设备号（presence 帧；离线或未知为 null），设备管理页标「在线」用 */
export function getOnlineDeviceId(): string | null {
  return onlineDeviceId
}

/** 确保已连接；未连接则建连并等待握手完成 */
export function ensureRelayConnected(timeoutMs = CONNECT_TIMEOUT_MS): Promise<void> {
  if (connected && socket != null) return Promise.resolve()
  if (connectPromise != null) return connectPromise
  const url = relayWsUrl()
  if (url == null) {
    return Promise.reject(new BridgeError('AUTH', '尚未登录，无法连接云端中继', BRIDGE_HINTS.AUTH))
  }
  if (!isRelayEnabled()) {
    return Promise.reject(
      new BridgeError(
        'DISABLED',
        '云端中继已关闭，请在「我的 → 远程会话」重新开启',
        BRIDGE_HINTS.DISABLED,
      ),
    )
  }

  intentionallyClosed = false
  connectPromise = new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      if (!connected) {
        cleanupSocket()
        connectPromise = null
        reject(new BridgeError('NETWORK', '连接云端中继超时', BRIDGE_HINTS.NETWORK))
      }
    }, timeoutMs)

    const settle = (error?: Error) => {
      clearTimeout(timer)
      connectPromise = null
      if (error != null) reject(error)
      else resolve()
    }

    const task = wx.connectSocket({ url, timeout: timeoutMs })
    socket = task

    task.onOpen(() => {
      connected = true
      retryCount = 0
      send({ t: 'hello', deviceId: getDeviceId(), label: '微信小程序' })
      if (pingTimer != null) clearInterval(pingTimer)
      pingTimer = setInterval(() => send({ t: 'ping' }), PING_INTERVAL_MS)
      // 断线重连后恢复订阅，否则「连上了但不推流」
      if (stream != null) send({ t: 'sub', sessionId: stream.sessionId })
      settle()
      stream?.handlers.onOpen?.()
    })

    task.onMessage((res) => {
      handleFrame(res.data)
    })

    task.onError((err) => {
      const message = (err && err.errMsg) || '中继连接出错'
      cleanupSocket()
      // 握手还没完成就出错 → 让 ensureRelayConnected 直接失败
      if (!connected) {
        settle(classifyConnectError(message))
        return
      }
      stream?.handlers.onError(message)
      scheduleReconnect()
    })

    task.onClose(() => {
      const wasConnected = connected
      cleanupSocket()
      if (intentionallyClosed) return
      if (!wasConnected) {
        settle(new BridgeError('NETWORK', '连接云端中继失败', BRIDGE_HINTS.NETWORK))
        return
      }
      stream?.handlers.onClose()
      scheduleReconnect()
    })
  })
  return connectPromise
}

function classifyConnectError(errMsg: string): BridgeError {
  if (/not in domain|不在以下/.test(errMsg)) {
    return new BridgeError('DOMAIN', '小程序未允许访问该域名', BRIDGE_HINTS.DOMAIN)
  }
  if (/timeout|超时/.test(errMsg)) {
    return new BridgeError('NETWORK', '连接云端中继超时', BRIDGE_HINTS.NETWORK)
  }
  return new BridgeError('NETWORK', `连接云端中继失败：${errMsg}`, BRIDGE_HINTS.NETWORK)
}

function cleanupSocket(): void {
  connected = false
  desktopOnline = null
  if (pingTimer != null) {
    clearInterval(pingTimer)
    pingTimer = null
  }
  const task = socket
  socket = null
  if (task != null) {
    try {
      task.close({ code: 1000 })
    } catch {
      /* noop */
    }
  }
  // 挂起的调用全部失败：否则调用方会一直等到自己的超时才报错
  for (const [id, call] of pending) {
    clearTimeout(call.timer)
    pending.delete(id)
    call.reject(new BridgeError('NETWORK', '与云端中继的连接已断开', BRIDGE_HINTS.NETWORK))
  }
}

function scheduleReconnect(): void {
  if (intentionallyClosed || retryTimer != null) return
  const delay = Math.min(RETRY_BASE_MS * 2 ** retryCount, RETRY_MAX_MS)
  retryCount += 1
  retryTimer = setTimeout(() => {
    retryTimer = null
    ensureRelayConnected().catch(() => undefined)
  }, delay)
}

/** 页面 onUnload 时调用：主动关闭且不再重连 */
export function closeRelay(): void {
  intentionallyClosed = true
  if (retryTimer != null) {
    clearTimeout(retryTimer)
    retryTimer = null
  }
  stream = null
  cleanupSocket()
}

// ─── 帧处理 ───────────────────────────────────────────────────────────────────

function handleFrame(raw: unknown): void {
  let frame: {
    t?: string
    id?: string
    s?: number
    b?: unknown
    sessionId?: string
    events?: unknown[]
    desktop?: { online?: boolean; deviceId?: string }
    connId?: string
    message?: string
  }
  const text = typeof raw === 'string' ? raw : String(raw ?? '')
  try {
    frame = JSON.parse(text)
  } catch {
    return
  }

  switch (frame.t) {
    case 'welcome':
      desktopOnline = frame.desktop?.online === true
      onlineDeviceId = desktopOnline ? (frame.desktop?.deviceId ?? null) : null
      return
    case 'presence':
      desktopOnline = frame.desktop?.online === true
      onlineDeviceId = desktopOnline ? (frame.desktop?.deviceId ?? null) : null
      return
    case 'pong':
      return
    case 'res': {
      const id = frame.id ?? ''
      const call = pending.get(id)
      if (call == null) return
      clearTimeout(call.timer)
      pending.delete(id)
      call.resolve({ status: Number(frame.s ?? 200), body: frame.b ?? null })
      return
    }
    case 'event': {
      if (stream == null || frame.sessionId !== stream.sessionId) return
      if (Array.isArray(frame.events) && frame.events.length > 0) {
        stream.handlers.onEvent(frame.events)
      }
      return
    }
    case 'error': {
      stream?.handlers.onError(frame.message ?? '中继错误')
      return
    }
    default:
      return
  }
}

function send(frame: Record<string, unknown>): void {
  if (socket == null || !connected) return
  try {
    socket.send({ data: JSON.stringify(frame) })
  } catch {
    /* 连接已断开，等 onClose 重连 */
  }
}

// ─── 调用 ─────────────────────────────────────────────────────────────────────

/**
 * 经中继发起一次桥接调用。返回 HTTP 语义的 { status, body }，
 * 由 bridge.ts 复用与直连相同的状态码判定逻辑。
 */
export async function relayExchange(
  path: string,
  method: string,
  data?: Record<string, unknown>,
  timeoutMs = 30_000,
): Promise<{ status: number; body: unknown }> {
  await ensureRelayConnected()
  const id = `rq${(callSeq += 1)}`
  return new Promise<{ status: number; body: unknown }>((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id)
      reject(new BridgeError('NETWORK', '桌面端响应超时', BRIDGE_HINTS.NETWORK))
    }, timeoutMs)
    pending.set(id, { resolve, reject, timer })
    const sent = send({ t: 'req', id, m: method, p: path, b: data ?? null })
    // send 静默失败（连接刚断）时立刻报错，避免干等到超时
    if (sent === undefined && !connected) {
      clearTimeout(timer)
      pending.delete(id)
      reject(new BridgeError('NETWORK', '与云端中继的连接已断开', BRIDGE_HINTS.NETWORK))
    }
  })
}

// ─── 事件流 ───────────────────────────────────────────────────────────────────

/** 订阅会话事件流；返回取消函数 */
export function relaySubscribe(sessionId: string, handlers: RelayStreamHandlers): () => void {
  stream = { sessionId, handlers }
  send({ t: 'sub', sessionId })
  void ensureRelayConnected().catch((error) => {
    handlers.onError(error instanceof Error ? error.message : String(error))
  })
  return () => {
    if (stream?.sessionId !== sessionId) return
    stream = null
    send({ t: 'unsub' })
  }
}

/** 中继不可用时给调用方的兜底：把 503 转成可读的中文提示 */
export function describeRelayStatus(status: number, body: unknown): BridgeError | null {
  if (status !== 503) return null
  const code =
    body != null && typeof body === 'object'
      ? (body as { error?: { code?: string; message?: string } }).error?.code
      : undefined
  const message =
    body != null && typeof body === 'object'
      ? (body as { error?: { code?: string; message?: string } }).error?.message
      : undefined
  if (code === 'DESKTOP_OFFLINE') {
    return new BridgeError('OFFLINE', message ?? '桌面端离线', BRIDGE_HINTS.OFFLINE)
  }
  return new BridgeError('SERVER', message ?? `请求失败 (${status})`, BRIDGE_HINTS.SERVER)
}

/** 测试辅助：重置模块级状态 */
export function __resetRelayForTesting(): void {
  closeRelay()
  pending.clear()
  callSeq = 0
  retryCount = 0
  stream = null
  desktopOnline = null
}

// ─── 授信设备管理（HTTP 直连 edu-server，不经 WS） ────────────────────────────

export interface RelayDeviceItem {
  deviceId: string
  label: string
  version: string | null
  status: 'active' | 'revoked'
  firstSeenAt: string
  lastSeenAt: string
  revokedAt: string | null
}

/** 当前账号的授信桌面设备列表（含已吊销） */
export function listRelayDevices(): Promise<{ devices: RelayDeviceItem[] }> {
  return request<{ devices: RelayDeviceItem[] }>('/mobile-bridge/devices')
}

/**
 * 吊销一台授信设备（不可逆）：该设备的中继连接会被服务端立即断开，
 * 且其 deviceId 永久拒绝重连；桌面端需「重新授信」生成新身份。
 */
export function revokeRelayDevice(
  deviceId: string,
): Promise<{ deviceId: string; revokedAt: string; kicked: number }> {
  return request<{ deviceId: string; revokedAt: string; kicked: number }>(
    `/mobile-bridge/devices/${encodeURIComponent(deviceId)}/revoke`,
    { method: 'POST' },
  )
}

/**
 * 云端中继传输（小程序侧，唯一传输）。
 *
 * 局域网直连已整体移除（体验版强制 https/wss + 域名白名单，真机不可用）。
 * 中继模式下小程序只连 Spark 平台服务（edu-server），由服务端按账号把调用转发给本人的桌面端：
 *
 *     小程序（本文件）──wss──> edu-server <──wss── 桌面端
 *
 * 不需要同 Wi-Fi、不需要电脑有公网 IP、不需要配路由器，登录同一个账号即可接管会话。
 *
 * 多电脑：同一账号可有多台桌面端同时在线。req/sub 帧可带 d=<deviceId> 定向到某台桌面端，
 * 缺省 d 时服务端选「主桌面端」（最近活跃的在线桌面端）；服务端下发的 event 帧带 d=来源设备，
 * 订阅按 (deviceId, sessionId) 维度隔离。
 *
 * 一条连接同时承载「调用」和「事件流」（用 sub/unsub 复用），因为小程序对并发 WebSocket
 * 数量有历史限制，多路复用更稳。
 *
 * 帧协议与 edu-server `src/service/mobile-bridge/relay-hub.ts` 对齐
 * （见 packages/protocol/src/mobile-bridge.ts 的 MobileBridgeRelayFrame）。
 */

import { getConfig } from '../config'
import { getItem, setItem } from '../utils/storage'
import { StorageKeys } from '../utils/storage'
import { BridgeError, BRIDGE_HINTS } from './bridge-error'
import { request } from './request'

const RelayKeys = {
  deviceId: 'spark-mobile:relay-device-id',
  /** 远程会话页选中的桌面端（电脑切换条），跨页面共享 */
  selectedDesktop: 'spark-mobile:bridge-selected-device',
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

// ─── 设备类型（对齐协议 MobileBridgeDeviceInfo / MobileBridgeRelayDesktopInfo） ──

/** 授信设备（REST /mobile-bridge/devices 返回；含离线设备） */
export interface RelayDeviceInfo {
  deviceId: string
  /** 展示名（桌面端主机名） */
  name: string
  version: string | null
  online: boolean
  lastSeenAt: string | null
  /** 首次授信时间 */
  trustedAt: string
}

/** 在线桌面端实时信息（welcome / presence 携带） */
export interface RelayDesktopInfo {
  deviceId: string
  label: string
  version: string | null
  online: boolean
  lastSeenAt: string | null
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
let stream: { sessionId: string; deviceId: string | null; handlers: RelayStreamHandlers } | null =
  null
/** 桌面端在线状态（presence 帧聚合：任一桌面端在线即 true） */
let desktopOnline: boolean | null = null
/** 最近一次 presence/welcome 的在线桌面端列表 */
let presenceDevices: RelayDesktopInfo[] = []
/** 是否收到过服务端下发的设备列表（区分「未知」与「确无在线」） */
let presenceFresh = false
/** 设备列表订阅者（页面刷新设备切换条 / 授信设备页实时刷新） */
const deviceListeners = new Set<(devices: RelayDesktopInfo[]) => void>()

// ─── 地址与本地身份 ───────────────────────────────────────────────────────────

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

// ─── 选中的桌面端（电脑切换；跨页面共享） ─────────────────────────────────────

export function getSelectedDeviceId(): string {
  return getItem<string>(RelayKeys.selectedDesktop) ?? ''
}

export function setSelectedDeviceId(deviceId: string): void {
  setItem(RelayKeys.selectedDesktop, deviceId)
}

// ─── 连接管理 ─────────────────────────────────────────────────────────────────

export function isRelayConnected(): boolean {
  return connected
}

/** 任一桌面端是否经中继在线（null = 尚未收到服务端状态） */
export function isDesktopOnline(): boolean | null {
  return desktopOnline
}

/** 最近一次 presence/welcome 的在线桌面端快照（页面合并 REST 列表用） */
export function getPresenceDevices(): RelayDesktopInfo[] {
  return presenceDevices
}

/** 是否已收到过服务端设备列表（区分「未知」与「确无在线」） */
export function isPresenceFresh(): boolean {
  return presenceFresh
}

/**
 * 订阅设备列表变化（welcome / presence 到达时回调）。
 * 返回取消函数；页面 onHide/onUnload 时调用。
 */
export function onRelayDevicesChanged(listener: (devices: RelayDesktopInfo[]) => void): () => void {
  deviceListeners.add(listener)
  return () => {
    deviceListeners.delete(listener)
  }
}

function notifyDeviceListeners(): void {
  for (const listener of deviceListeners) {
    try {
      listener(presenceDevices)
    } catch {
      /* 单个订阅者异常不影响其他订阅者 */
    }
  }
}

/** 确保已连接；未连接则建连并等待握手完成 */
export function ensureRelayConnected(timeoutMs = CONNECT_TIMEOUT_MS): Promise<void> {
  if (connected && socket != null) return Promise.resolve()
  if (connectPromise != null) return connectPromise
  const url = relayWsUrl()
  if (url == null) {
    return Promise.reject(
      new BridgeError('AUTH', '尚未登录，无法连接 Spark 平台中继', BRIDGE_HINTS.AUTH),
    )
  }

  intentionallyClosed = false
  connectPromise = new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      if (!connected) {
        cleanupSocket()
        connectPromise = null
        reject(new BridgeError('TIMEOUT', '连接 Spark 平台中继超时', BRIDGE_HINTS.TIMEOUT))
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
      // 断线重连后恢复订阅（带上定向 d），否则「连上了但不推流」
      if (stream != null) {
        const sub: Record<string, unknown> = { t: 'sub', sessionId: stream.sessionId }
        if (stream.deviceId != null) sub.d = stream.deviceId
        send(sub)
      }
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
        settle(new BridgeError('NETWORK', '连接 Spark 平台中继失败', BRIDGE_HINTS.NETWORK))
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
    return new BridgeError(
      'NETWORK',
      '小程序未允许访问 Spark 平台服务域名',
      '正式版需在小程序后台配置 request/socket 合法域名',
    )
  }
  if (/timeout|超时/.test(errMsg)) {
    return new BridgeError('TIMEOUT', '连接 Spark 平台中继超时', BRIDGE_HINTS.TIMEOUT)
  }
  return new BridgeError('NETWORK', `连接 Spark 平台中继失败：${errMsg}`, BRIDGE_HINTS.NETWORK)
}

function cleanupSocket(): void {
  connected = false
  desktopOnline = null
  presenceFresh = false
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
    call.reject(new BridgeError('NETWORK', '与 Spark 平台中继的连接已断开', BRIDGE_HINTS.NETWORK))
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

interface RelayFrame {
  t?: string
  id?: string
  s?: number
  b?: unknown
  d?: string
  sessionId?: string
  events?: unknown[]
  connId?: string
  message?: string
  desktop?: {
    online?: boolean
    deviceId?: string | null
    label?: string | null
    version?: string | null
    lastSeenAt?: string | null
  }
  devices?: Array<{
    deviceId?: string
    label?: string
    name?: string
    version?: string | null
    online?: boolean
    lastSeenAt?: string | null
  }>
}

/** welcome / presence 共用：解析 devices 列表并维护内存快照（含订阅通知） */
function applyDevicesFrame(frame: RelayFrame): void {
  const list: RelayDesktopInfo[] = []
  if (Array.isArray(frame.devices)) {
    for (const item of frame.devices) {
      if (item == null || typeof item !== 'object') continue
      const deviceId = typeof item.deviceId === 'string' ? item.deviceId : ''
      if (!deviceId) continue
      list.push({
        deviceId,
        label:
          typeof item.label === 'string'
            ? item.label
            : typeof item.name === 'string'
              ? item.name
              : '',
        version: typeof item.version === 'string' ? item.version : null,
        online: item.online !== false,
        lastSeenAt: typeof item.lastSeenAt === 'string' ? item.lastSeenAt : null,
      })
    }
  }
  if (list.length === 0 && frame.desktop?.online === true && frame.desktop.deviceId) {
    // 兼容旧版单桌面投影：devices 缺失时从 desktop 字段推导
    list.push({
      deviceId: frame.desktop.deviceId,
      label: frame.desktop.label ?? '',
      version: frame.desktop.version ?? null,
      online: true,
      lastSeenAt: frame.desktop.lastSeenAt ?? null,
    })
  }
  presenceDevices = list
  presenceFresh = true
  desktopOnline = list.length > 0
  notifyDeviceListeners()
}

function handleFrame(raw: unknown): void {
  let frame: RelayFrame
  const text = typeof raw === 'string' ? raw : String(raw ?? '')
  try {
    frame = JSON.parse(text) as RelayFrame
  } catch {
    return
  }

  switch (frame.t) {
    case 'welcome':
      applyDevicesFrame(frame)
      return
    case 'presence':
      applyDevicesFrame(frame)
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
      // 防御：定向订阅时忽略来源设备不匹配的事件（两台电脑同名会话不串流）
      if (
        stream.deviceId != null &&
        typeof frame.d === 'string' &&
        frame.d !== '' &&
        frame.d !== stream.deviceId
      ) {
        return
      }
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
 * 经中继发起一次桥接调用（可带 deviceId 定向到某台桌面端，缺省 = 主桌面端）。
 * 返回 HTTP 语义的 { status, body }，由 bridge.ts 做状态码判定。
 */
export async function relayExchange(
  path: string,
  method: string,
  data?: Record<string, unknown>,
  timeoutMs = 30_000,
  deviceId?: string,
): Promise<{ status: number; body: unknown }> {
  await ensureRelayConnected()
  const id = `rq${(callSeq += 1)}`
  return new Promise<{ status: number; body: unknown }>((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id)
      reject(new BridgeError('TIMEOUT', '电脑端响应超时', BRIDGE_HINTS.TIMEOUT))
    }, timeoutMs)
    pending.set(id, { resolve, reject, timer })
    const frame: Record<string, unknown> = { t: 'req', id, m: method, p: path, b: data ?? null }
    if (deviceId != null && deviceId !== '') frame.d = deviceId
    send(frame)
    // send 静默失败（连接刚断）时立刻报错，避免干等到超时
    if (!connected) {
      clearTimeout(timer)
      pending.delete(id)
      reject(new BridgeError('NETWORK', '与 Spark 平台中继的连接已断开', BRIDGE_HINTS.NETWORK))
    }
  })
}

// ─── 事件流 ───────────────────────────────────────────────────────────────────

/** 订阅会话事件流（可带 deviceId 定向）；返回取消函数 */
export function relaySubscribe(
  sessionId: string,
  handlers: RelayStreamHandlers,
  deviceId?: string,
): () => void {
  const target = deviceId ?? null
  stream = { sessionId, deviceId: target, handlers }
  const sub: Record<string, unknown> = { t: 'sub', sessionId }
  if (target != null) sub.d = target
  send(sub)
  if (connected && socket != null) {
    // 共享 WS 已在连接态：ensureRelayConnected 会直接短路返回，task.onOpen 不会再触发，
    // 必须在这里补发 onOpen，否则页面会一直以为「没连上」（聊天页 connected 恒 false，
    // 每次发送都走乐观渲染路径，与真实事件回来后双气泡）。
    handlers.onOpen?.()
    return () => {
      if (stream?.sessionId !== sessionId) return
      stream = null
      const unsub: Record<string, unknown> = { t: 'unsub', sessionId }
      if (target != null) unsub.d = target
      send(unsub)
    }
  }
  void ensureRelayConnected().catch((error) => {
    handlers.onError(error instanceof Error ? error.message : String(error))
  })
  return () => {
    if (stream?.sessionId !== sessionId) return
    stream = null
    const unsub: Record<string, unknown> = { t: 'unsub', sessionId }
    if (target != null) unsub.d = target
    send(unsub)
  }
}

/** 中继不可用时给调用方的兜底：把 503/504 转成可读的中文提示 */
export function describeRelayStatus(status: number, body: unknown): BridgeError | null {
  if (status !== 503 && status !== 504) return null
  const errorBody =
    body != null && typeof body === 'object'
      ? (body as { error?: { code?: string; message?: string } })
      : null
  const code = errorBody?.error?.code
  const message = errorBody?.error?.message
  if (status === 504 || code === 'TIMEOUT') {
    return new BridgeError('TIMEOUT', message ?? '电脑端响应超时', BRIDGE_HINTS.TIMEOUT)
  }
  if (code === 'DESKTOP_OFFLINE') {
    return new BridgeError('DESKTOP_OFFLINE', message ?? '电脑端离线', BRIDGE_HINTS.DESKTOP_OFFLINE)
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
  presenceDevices = []
  presenceFresh = false
}

// ─── 授信设备管理（REST 直连 edu-server，不经 WS；带账号 JWT） ────────────────

/** 当前账号的授信桌面设备列表（含离线设备；吊销后不再返回） */
export function listRelayDevices(): Promise<{ devices: RelayDeviceInfo[] }> {
  return request<{ devices: RelayDeviceInfo[] }>('/mobile-bridge/devices')
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

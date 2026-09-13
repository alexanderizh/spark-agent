import { extractQqInboundImages, type QqInboundImage } from './qqImageMedia.js'

/**
 * QQ 官方机器人协议的纯函数部分：事件解析、目标编码与内容分片。
 *
 * QQ 的回复目标按场景分流（群 group_openid / 单聊 user_openid / 频道 channel_id），
 * openid 本身不携带场景信息，因此统一编码为 `qq-<scene>:<id>` 作为 externalId，
 * 使配对绑定与回复路由共享同一稳定标识。
 */

export type QqMessageScene = 'group' | 'user' | 'channel'

export type QqInboundMessage = {
  scene: QqMessageScene
  /** 回复目标：群 group_openid / 单聊 user_openid / 频道 channel_id */
  targetId: string
  senderName: string
  text: string
  images?: QqInboundImage[]
  /** 被动回复引用的 msg_id（群聊/单聊必带；频道回复不需要） */
  msgId?: string
  /** 事件时间戳（秒），用于过滤重连重放的旧事件 */
  timestamp: number
}

const SCENE_PREFIX: Record<QqMessageScene, string> = {
  group: 'qq-group:',
  user: 'qq-user:',
  channel: 'qq-channel:',
}

const SCENE_BY_PREFIX: Record<string, QqMessageScene> = {
  'qq-group:': 'group',
  'qq-user:': 'user',
  'qq-channel:': 'channel',
}

export function buildQqExternalId(scene: QqMessageScene, targetId: string): string {
  return `${SCENE_PREFIX[scene]}${targetId}`
}

export function parseQqExternalId(
  externalId: string,
): { scene: QqMessageScene; targetId: string } | null {
  for (const [prefix, scene] of Object.entries(SCENE_BY_PREFIX)) {
    if (externalId.startsWith(prefix)) {
      const targetId = externalId.slice(prefix.length)
      if (targetId.length > 0) return { scene, targetId }
      return null
    }
  }
  return null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value)
}

/**
 * 解析事件时间戳为秒。QQ 官方事件的时间戳是 RFC3339 字符串
 * （如 "2026-09-13T01:39:00+08:00"），兼容数值秒/毫秒与纯数字字符串；
 * 无法解析时回退当前时间（宁可放过，不可误判为远古旧事件导致消息被丢弃）。
 */
export function parseQqEventTimestamp(raw: unknown): number {
  const now = Math.floor(Date.now() / 1000)
  const MIN_PLAUSIBLE = 946684800 // 2000-01-01，早于此的解析结果视为异常
  const normalize = (seconds: number): number => (seconds > MIN_PLAUSIBLE ? seconds : now)
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    return normalize(raw > 1e12 ? Math.floor(raw / 1000) : Math.floor(raw))
  }
  if (typeof raw === 'string') {
    const trimmed = raw.trim()
    if (trimmed.length > 0) {
      // 仅对形如 "2026-09-13T01:39:00+08:00" 的 ISO 日期走 Date.parse，
      // 避免 V8 宽松解析（如 "2026" → 2026-01-01）把残缺字符串误判为合法旧时间。
      if (/^\d{4}-\d{2}-\d{2}[T ]\d{2}/.test(trimmed)) {
        const parsedMs = Date.parse(trimmed)
        if (!Number.isNaN(parsedMs)) return normalize(Math.floor(parsedMs / 1000))
      }
      const parsedNum = Number(trimmed)
      if (Number.isFinite(parsedNum)) {
        return normalize(parsedNum > 1e12 ? Math.floor(parsedNum / 1000) : Math.floor(parsedNum))
      }
    }
  }
  return now
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined
}

/**
 * 解析 WebSocket/webhook 推送的 QQ 消息事件（op:0 Dispatch 的 t + d）。
 * 仅接受群 @ 消息、单聊消息与频道 @ 消息三类，其余返回 null。
 */
export function parseQqDispatchEvent(t: string | undefined, d: unknown): QqInboundMessage | null {
  if (t == null || !isRecord(d)) return null

  const author = isRecord(d.author) ? d.author : undefined
  const content = readString(d.content)
  const images = extractQqInboundImages(d)
  const normalized = normalizeQqText(content ?? '')
  const text = normalized || (images.length > 0 ? '请识别并说明这张图片。' : '')
  const msgId = readString(d.id)
  const timestamp = parseQqEventTimestamp(d.timestamp)

  if (content == null && images.length === 0) return null

  if (t === 'GROUP_AT_MESSAGE_CREATE') {
    const groupOpenid = readString(d.group_openid)
    if (groupOpenid == null) return null
    return {
      scene: 'group',
      targetId: groupOpenid,
      senderName: readString(author?.member_openid) ?? readString(author?.id) ?? 'QQ 用户',
      text,
      ...(images.length > 0 ? { images } : {}),
      ...(msgId != null ? { msgId } : {}),
      timestamp,
    }
  }

  if (t === 'C2C_MESSAGE_CREATE') {
    const userOpenid = readString(d.user_openid) ?? readString(author?.user_openid)
    if (userOpenid == null) return null
    return {
      scene: 'user',
      targetId: userOpenid,
      senderName: readString(author?.user_openid) ?? readString(author?.id) ?? 'QQ 用户',
      text,
      ...(images.length > 0 ? { images } : {}),
      ...(msgId != null ? { msgId } : {}),
      timestamp,
    }
  }

  if (t === 'AT_MESSAGE_CREATE') {
    const channelId = readString(d.channel_id)
    if (channelId == null) return null
    return {
      scene: 'channel',
      targetId: channelId,
      senderName: readString(author?.username) ?? readString(author?.id) ?? 'QQ 用户',
      text,
      ...(images.length > 0 ? { images } : {}),
      ...(msgId != null ? { msgId } : {}),
      timestamp,
    }
  }

  return null
}

/** 去掉 @机器人 前缀与多余空白；群里只有 @ 消息会到达这里。 */
export function normalizeQqText(rawText: string): string {
  return rawText
    .replace(/<@[^>]+>\s*/g, '')
    .replace(/^@\S+\s*/, '')
    .trim()
}

/** 句末标点：断在这里不会劈开语义。 */
const SENTENCE_BREAK_RE = /[。！？；…!?;.]/
/** 软断点：逗号/顿号/空白，优先级低于句末标点。 */
const SOFT_BREAK_RE = /[，、, \t]/

function findLastMatchIndex(text: string, re: RegExp): number {
  let last = -1
  for (const match of text.matchAll(new RegExp(re.source, 'g'))) {
    last = match.index
  }
  return last
}

/**
 * QQ 群聊/单聊文本按 UTF-8 字节计长（上限 1024 字节），按字节安全分片。
 * 超长时优先在自然边界断开：换行 > 句末标点 > 逗号/顿号/空白，都没有才硬切；
 * 断点字符均为单个 BMP 码元，按 UTF-16 下标切片不会拆散代理对。
 */
export function splitQqContent(text: string, maxBytes: number): string[] {
  if (maxBytes <= 0) return [text]
  const encoder = new TextEncoder()
  const chunks: string[] = []
  let current = ''
  let currentBytes = 0
  for (const char of Array.from(text)) {
    const size = encoder.encode(char).byteLength
    if (currentBytes + size > maxBytes && current.length > 0) {
      const newline = current.lastIndexOf('\n')
      const sentence = newline >= 1 ? -1 : findLastMatchIndex(current, SENTENCE_BREAK_RE)
      const soft = newline >= 1 || sentence >= 0 ? -1 : findLastMatchIndex(current, SOFT_BREAK_RE)
      const cut =
        newline >= 1
          ? newline + 1
          : sentence >= 0
            ? sentence + 1
            : soft >= 0
              ? soft + 1
              : current.length
      let rest = current.slice(cut).replace(/^\s+/, '')
      let head = current.slice(0, cut)
      // 自然断点的块去掉尾随空白（硬切块保持原样），且不允许修剪成空块
      if (newline >= 1 || sentence >= 0 || soft >= 0) {
        const trimmedHead = head.replace(/\s+$/, '')
        if (trimmedHead.length > 0) head = trimmedHead
      }
      chunks.push(head)
      // 自然断点后的剩余部分加上当前字符仍超预算时，将其独立成块，保证每块都不超限
      if (rest.length > 0 && encoder.encode(rest).byteLength + size > maxBytes) {
        chunks.push(rest)
        rest = ''
      }
      current = rest
      currentBytes = rest.length > 0 ? encoder.encode(rest).byteLength : 0
    }
    current += char
    currentBytes += size
  }
  if (current.length > 0) chunks.push(current)
  return chunks.length > 0 ? chunks : ['']
}

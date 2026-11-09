/**
 * 会话时间线快照：解决「返回聊天页整页重刷 + 图片/附件预览丢失」。
 *
 * 设计要点：
 *   - 只缓存「最近一段完整事件」，不截断单条文本（AI 长回复不能被腰斩）；
 *     按字节预算从最旧的事件开始整条丢弃，更早的记录仍可点「加载更早消息」拉回。
 *   - 缓存是**首屏加速 + 离线可读**，不是事实来源：每次 onShow 都会用服务端
 *     getMessages 做一次增量对账（见 pages/chat reconcileFromServer）。
 *   - 附带图片预览解析结果，避免返回后重新走一遍中继回源导致图片闪一下就消失。
 *   - wx storage 单 key 上限约 1MB，这里按 480KB 字符预算收紧；最多留 8 个会话。
 */

import type { BridgeEvent } from '../api/bridge'
import { getItem, setItem, removeItem } from './storage'

const PREFIX = 'spark-mobile:chat-snapshot:'
const INDEX_KEY = 'spark-mobile:chat-snapshot-index'
const MAX_SESSIONS = 8
const MAX_EVENTS = 160
/** 单会话快照的字符预算（JSON 长度近似，留足余量避开 1MB 单 key 上限） */
const MAX_CHARS = 480_000
/** 超过该时长的快照不再用于首屏秒开（仍保留内容，但对账后会被覆盖） */
export const SNAPSHOT_STALE_MS = 7 * 24 * 3600 * 1000

export interface SentAttachmentView {
  type: 'image' | 'file'
  path: string
  name?: string
  /** 手机本地临时路径（本次会话内可直接预览，刷新后由 userAttachPreviews 兜底） */
  localPath?: string
}

export interface ChatSnapshot {
  sessionId: string
  events: BridgeEvent[]
  running: boolean
  lastSeq: number
  savedAt: number
  hasMore: boolean
  cursor: number | null
  /** 隐藏工具/思考记录偏好在页面里单独持久化，这里只缓存业务态 */
  sentAttachments: Record<string, SentAttachmentView[]>
  mediaPreviews: Record<string, string[]>
  userAttachPreviews: Record<string, Record<string, string>>
  /** 退出页面时的滚动位置（返回后不跳回顶部） */
  scrollTop: number
}

interface SnapshotIndex {
  keys: string[]
}

function readIndex(): string[] {
  const index = getItem<SnapshotIndex>(INDEX_KEY)
  return Array.isArray(index?.keys) ? index!.keys.filter((k) => typeof k === 'string') : []
}

function writeIndex(keys: string[]): void {
  setItem(INDEX_KEY, { keys: keys.slice(0, MAX_SESSIONS) } as SnapshotIndex)
}

function keyOf(sessionId: string): string {
  return `${PREFIX}${sessionId}`
}

/** 从最旧的事件开始整条丢弃，保证留下的每条事件文本完整。 */
function trimEvents(events: BridgeEvent[]): BridgeEvent[] {
  const kept: BridgeEvent[] = []
  let chars = 0
  for (let i = events.length - 1; i >= 0 && kept.length < MAX_EVENTS; i -= 1) {
    const event = events[i]
    const size = JSON.stringify(event).length
    if (chars + size > MAX_CHARS) break
    chars += size
    kept.unshift(event)
  }
  return kept
}

export function saveChatSnapshot(snapshot: ChatSnapshot): void {
  if (!snapshot.sessionId) return
  const key = keyOf(snapshot.sessionId)
  const payload: ChatSnapshot = {
    ...snapshot,
    events: trimEvents(snapshot.events),
    savedAt: Date.now(),
  }
  try {
    setItem(key, payload)
  } catch {
    // 存储写满时丢弃最旧会话再试一次，失败就放弃缓存（不影响主流程）
    const keys = readIndex().filter((item) => item !== key)
    const oldest = keys.pop()
    if (oldest != null) removeItem(oldest)
    writeIndex([key, ...keys])
    return
  }
  writeIndex([key, ...readIndex().filter((item) => item !== key)])
  // 超出容量的旧会话顺手清理，避免 wx storage 无限增长
  const keys = readIndex()
  for (const stale of keys.slice(MAX_SESSIONS)) removeItem(stale)
}

export function loadChatSnapshot(sessionId: string): ChatSnapshot | null {
  if (!sessionId) return null
  const snapshot = getItem<ChatSnapshot>(keyOf(sessionId))
  if (snapshot == null || snapshot.sessionId !== sessionId) return null
  if (!Array.isArray(snapshot.events)) return null
  return {
    ...snapshot,
    sentAttachments: snapshot.sentAttachments ?? {},
    mediaPreviews: snapshot.mediaPreviews ?? {},
    userAttachPreviews: snapshot.userAttachPreviews ?? {},
    scrollTop: typeof snapshot.scrollTop === 'number' ? snapshot.scrollTop : 0,
  }
}

export function isSnapshotStale(snapshot: ChatSnapshot): boolean {
  return Date.now() - (snapshot.savedAt ?? 0) > SNAPSHOT_STALE_MS
}

export function clearChatSnapshot(sessionId: string): void {
  const key = keyOf(sessionId)
  removeItem(key)
  writeIndex(readIndex().filter((item) => item !== key))
}

/** 把实例态的 Map 摊平为可序列化对象（写快照前调用） */
export function mapToRecord<T>(source: Map<string, T>): Record<string, T> {
  const out: Record<string, T> = {}
  source.forEach((value, key) => {
    out[key] = value
  })
  return out
}

export function recordToMap<T>(source: Record<string, T> | undefined): Map<string, T> {
  const out = new Map<string, T>()
  if (source == null) return out
  Object.keys(source).forEach((key) => out.set(key, source[key] as T))
  return out
}

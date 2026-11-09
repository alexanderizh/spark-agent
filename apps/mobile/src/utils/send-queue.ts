/**
 * 本地待发消息队列：中继是「零留存直通」，断线时 req 帧会直接丢失。
 * 本模块在端上补一层持久化队列，保证消息不会「发一下就没了」：
 *
 *   - 发送前先入队并落盘，乐观渲染一条「发送中」气泡；
 *   - 串行 drain（一次只发一条，避免乱序 / 重复提交）；
 *   - 失败保留在队列并标记 failed，界面提供「重试」，文字不会丢；
 *   - WS 重连 onOpen 自动重新 drain；
 *   - clientId 作为幂等键随请求上送（新版桌面端可据此去重，旧版忽略未知字段）。
 *
 * 队列只负责「送达桥接端」，不替代服务端事件流：真实 user_message 回来后
 * 页面按 clientId / 文本匹配移除乐观气泡。
 */

import { getItem, setItem, removeItem } from './storage'
import type { SentAttachmentView } from './chat-cache'

const PREFIX = 'spark-mobile:send-queue:'
/** 超过该时长仍未送达的消息不再自动重发（避免隔天误发） */
const QUEUE_TTL_MS = 24 * 3600 * 1000
export const MAX_SEND_ATTEMPTS = 6

export type QueuedMessageStatus = 'sending' | 'failed'

export interface QueuedMessage {
  /** 端上幂等键：同时用作乐观气泡的 key 后缀 */
  clientId: string
  text: string
  attachmentPaths: string[]
  attachments: SentAttachmentView[]
  createdAt: number
  status: QueuedMessageStatus
  attempts: number
  error?: string
}

function keyOf(sessionId: string): string {
  return `${PREFIX}${sessionId}`
}

function sanitize(list: unknown, now: number): QueuedMessage[] {
  if (!Array.isArray(list)) return []
  return (list as QueuedMessage[]).filter((item) => {
    if (item == null || typeof item.clientId !== 'string' || typeof item.text !== 'string') {
      return false
    }
    return now - (item.createdAt ?? 0) < QUEUE_TTL_MS
  })
}

export function loadSendQueue(sessionId: string): QueuedMessage[] {
  if (!sessionId) return []
  const now = Date.now()
  const list = sanitize(getItem<QueuedMessage[]>(keyOf(sessionId)), now)
  // 上次进程被杀时留在 sending 态的消息，重启后统一降级为 failed 等用户/重连触发
  return list.map((item) =>
    item.status === 'sending' ? { ...item, status: 'failed' as const } : item,
  )
}

export function saveSendQueue(sessionId: string, list: QueuedMessage[]): void {
  if (!sessionId) return
  if (list.length === 0) {
    removeItem(keyOf(sessionId))
    return
  }
  setItem(keyOf(sessionId), list)
}

export function makeClientId(): string {
  return `cm-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

export function enqueueMessage(sessionId: string, message: QueuedMessage): QueuedMessage[] {
  const list = [...loadSendQueue(sessionId), message]
  saveSendQueue(sessionId, list)
  return list
}

export function patchQueuedMessage(
  sessionId: string,
  clientId: string,
  patch: Partial<QueuedMessage>,
): QueuedMessage[] {
  const list = loadSendQueue(sessionId).map((item) =>
    item.clientId === clientId ? { ...item, ...patch } : item,
  )
  saveSendQueue(sessionId, list)
  return list
}

export function dropQueuedMessage(sessionId: string, clientId: string): QueuedMessage[] {
  const list = loadSendQueue(sessionId).filter((item) => item.clientId !== clientId)
  saveSendQueue(sessionId, list)
  return list
}

/** 下一条该发的消息：优先 failed（重连补发），其次 sending；一次只取一条保证顺序 */
export function nextSendable(list: QueuedMessage[]): QueuedMessage | null {
  return (
    list.find((item) => item.status === 'failed' && item.attempts < MAX_SEND_ATTEMPTS) ??
    list.find((item) => item.status === 'sending' && item.attempts === 0) ??
    null
  )
}

/** 错误信息归一，避免把中继内部堆栈直接糊到界面上 */
export function sendFailureMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error ?? '')
  if (/超时|timeout/i.test(raw)) return '电脑端响应超时'
  if (/断开|NETWORK|offline|网络/i.test(raw)) return '连接已断开'
  if (/不能为空|BAD_REQUEST/i.test(raw)) return '消息内容不被接受'
  return raw.length > 40 ? `${raw.slice(0, 40)}…` : raw || '发送失败'
}

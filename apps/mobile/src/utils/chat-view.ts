/**
 * 对话时间线 → 页面渲染项转换。
 *
 * 在 chat-reducer 输出的消息列表之上做两件事：
 *   1. 按天插入居中时间分界（Cursor 式）
 *   2. flatMap 成带 kind 判别的渲染项，WXML 按 kind 分支
 */

import type { ChatMessage } from './chat-reducer'

export type TimelineItem =
  | { kind: 'time'; key: string; label: string }
  | { kind: 'user'; key: string; text: string }
  | { kind: 'assistant'; key: string; text: string }
  | {
      kind: 'tool'
      key: string
      toolName: string
      toolStatus: 'running' | 'success' | 'error'
    }
  | { kind: 'status'; key: string; text: string; tone: 'running' | 'done' | 'error' }

function dayLabel(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const now = new Date()
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const startOfYesterday = startOfToday - 86_400_000
  const time = d.getTime()
  const pad = (n: number) => String(n).padStart(2, '0')
  const hhmm = `${pad(d.getHours())}:${pad(d.getMinutes())}`
  if (time >= startOfToday) return `今天 ${hhmm}`
  if (time >= startOfYesterday) return `昨天 ${hhmm}`
  return `${d.getMonth() + 1}月${d.getDate()}日 ${hhmm}`
}

/** 消息列表 → 渲染项（含天级时间分界） */
export function buildTimelineItems(messages: ChatMessage[]): TimelineItem[] {
  const items: TimelineItem[] = []
  let lastDay = ''
  for (const msg of messages) {
    const day = (msg.createdAt ?? '').slice(0, 10)
    if (day && day !== lastDay) {
      items.push({ kind: 'time', key: `day:${day}:${items.length}`, label: dayLabel(msg.createdAt) })
      lastDay = day
    }
    switch (msg.role) {
      case 'user':
        items.push({ kind: 'user', key: msg.key, text: msg.text })
        break
      case 'assistant':
        items.push({ kind: 'assistant', key: msg.key, text: msg.text })
        break
      case 'tool':
        items.push({
          kind: 'tool',
          key: msg.key,
          toolName: msg.toolName ?? msg.text,
          toolStatus: msg.toolStatus ?? 'success',
        })
        break
      case 'status':
        items.push({ kind: 'status', key: msg.key, text: msg.text, tone: msg.tone ?? 'done' })
        break
    }
  }
  return items
}

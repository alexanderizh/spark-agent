/**
 * 对话时间线 → 页面渲染项转换。
 *
 * 在 chat-reducer 输出的消息列表之上做两件事：
 *   1. 按天插入居中时间分界（Cursor 式）
 *   2. flatMap 成带 kind 判别的渲染项，WXML 按 kind 分支
 */

import type { ChatMessage } from './chat-reducer'

/** 用户消息附件（历史事件透传；图片缩略图经本地缓存解析后渲染） */
export interface TimelineUserAttachment {
  type: 'image' | 'file'
  path: string
  name?: string
}

export type TimelineItem =
  | { kind: 'time'; key: string; label: string }
  | {
      kind: 'user'
      key: string
      text: string
      turnId?: string
      attachments?: TimelineUserAttachment[]
    }
  | { kind: 'assistant'; key: string; text: string }
  | { kind: 'thinking'; key: string; text: string; expanded?: boolean }
  | {
      kind: 'tool'
      key: string
      toolName: string
      toolStatus: 'running' | 'success' | 'error'
    }
  | { kind: 'status'; key: string; text: string; tone: 'running' | 'done' | 'error' }
  | {
      kind: 'media'
      key: string
      paths: string[]
      previews?: string[]
      /** 保存到相册进行中（底部操作按钮组 busy 态；页面实例态经 decorateItem 回填） */
      saving?: boolean
    }

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
  const thinkingByTurn = new Map<string, Extract<TimelineItem, { kind: 'thinking' }>>()
  let lastDay = ''
  for (const msg of messages) {
    const day = (msg.createdAt ?? '').slice(0, 10)
    if (day && day !== lastDay) {
      items.push({
        kind: 'time',
        key: `day:${day}:${items.length}`,
        label: dayLabel(msg.createdAt),
      })
      lastDay = day
    }
    switch (msg.role) {
      case 'user':
        items.push({
          kind: 'user',
          key: msg.key,
          text: msg.text,
          ...(msg.turnId != null ? { turnId: msg.turnId } : {}),
          ...(msg.attachments != null && msg.attachments.length > 0
            ? { attachments: msg.attachments }
            : {}),
        })
        break
      case 'assistant':
        items.push({ kind: 'assistant', key: msg.key, text: msg.text })
        break
      case 'thinking': {
        // 同一回合可能产生多个思考片段；归并成一个折叠入口，避免每段各占一行。
        const turnDayKey = msg.turnId ? `${msg.turnId}:${day}` : ''
        const existing = turnDayKey ? thinkingByTurn.get(turnDayKey) : undefined
        if (existing) {
          existing.text += msg.text
          break
        }
        const thinkingItem: Extract<TimelineItem, { kind: 'thinking' }> = {
          kind: 'thinking',
          key: msg.key,
          text: msg.text,
        }
        items.push(thinkingItem)
        if (turnDayKey) thinkingByTurn.set(turnDayKey, thinkingItem)
        break
      }
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
      case 'media':
        if (msg.paths != null && msg.paths.length > 0) {
          items.push({ kind: 'media', key: msg.key, paths: msg.paths })
        }
        break
    }
  }
  return items
}

/** 隐藏执行详情时同时隐藏工具调用与思考正文，运行状态和最终答复仍保留。 */
export function filterExecutionDetails(items: TimelineItem[], hidden: boolean): TimelineItem[] {
  if (!hidden) return items
  return items.filter((item) => item.kind !== 'tool' && item.kind !== 'thinking')
}

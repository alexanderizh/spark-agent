/**
 * 对话时间线 → 页面渲染项转换。
 *
 * 在 chat-reducer 输出的消息列表之上做三件事：
 *   1. 按天插入居中时间分界（Cursor 式）
 *   2. flatMap 成带 kind 判别的渲染项，WXML 按 kind 分支
 *   3. 隐藏执行详情时，把连续的工具/思考段折叠成一条「浅色横线 + 到达时间」分块
 */

import type { ChatMessage } from './chat-reducer'
import { monotonicCreatedAt } from './chat-order'

/**
 * 纯附件消息的哨兵前缀（零宽空格）。
 *
 * 桌面端 /v1/sessions/:id/turns 强制 text 非空，否则回 400「消息不能为空」。
 * 端上只发图片/文件时用它做前缀：trim 不会移除 U+200B，校验能通过，
 * 模型还能读到后面的说明文字；渲染层识别该前缀后不画文字气泡，只画附件条。
 * 这样不必改动桌面端协议，且对旧版桌面端同样可用。
 */
export const ATTACHMENT_ONLY_MARKER = '\u200b'
export const ATTACHMENT_ONLY_FALLBACK_TEXT = `${ATTACHMENT_ONLY_MARKER}请查看附件`

export function isAttachmentOnlyText(text: string | undefined): boolean {
  return typeof text === 'string' && text.startsWith(ATTACHMENT_ONLY_MARKER)
}

/** 气泡展示文本：纯附件消息不显示占位文案 */
export function displayTextOf(text: string | undefined): string {
  return isAttachmentOnlyText(text) ? '' : (text ?? '')
}

/** 用户消息附件（历史事件透传；图片缩略图经本地缓存解析后渲染） */
export interface TimelineUserAttachment {
  type: 'image' | 'file'
  path: string
  name?: string
  /** 已解析出的本地预览路径（图片） */
  previewUrl?: string
}

interface ItemBase {
  key: string
  /** 到达时间（ISO），用于分块横线与消息时间展示 */
  createdAt?: string
}

export type TimelineItem =
  | (ItemBase & { kind: 'time'; label: string })
  | (ItemBase & {
      kind: 'user'
      text: string
      turnId?: string
      attachments?: TimelineUserAttachment[]
      /** 本地队列乐观态：发送中 / 发送失败可重试 */
      sendStatus?: 'sending' | 'failed'
      clientId?: string
      sendError?: string
      /** 纯附件消息：不渲染文字气泡 */
      attachmentOnly?: boolean
    })
  | (ItemBase & { kind: 'assistant'; text: string })
  | (ItemBase & { kind: 'thinking'; text: string; expanded?: boolean })
  | (ItemBase & {
      kind: 'tool'
      toolName: string
      toolStatus: 'running' | 'success' | 'error'
      /** 工具调用/结果摘要，展开后显示 */
      text: string
      expanded?: boolean
    })
  | (ItemBase & { kind: 'status'; text: string; tone: 'running' | 'done' | 'error' })
  | (ItemBase & {
      kind: 'media'
      paths: string[]
      previews?: string[]
      /** 保存到相册进行中（底部操作按钮组 busy 态；页面实例态经 decorateItem 回填） */
      saving?: boolean
    })
  /** 隐藏工具/思考记录时的分块横线：浅色线 + 到达时间 + 被折叠条数 */
  | (ItemBase & {
      kind: 'divider'
      label: string
      hiddenCount: number
      expanded?: boolean
    })

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

/** 分块横线后的「到达时间」；跨天时带上日期，避免只显示 09:12 看不出哪天 */
export function clockLabel(iso: string | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  const hhmm = `${pad(d.getHours())}:${pad(d.getMinutes())}`
  const now = new Date()
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  return sameDay ? hhmm : `${d.getMonth() + 1}/${d.getDate()} ${hhmm}`
}

/** 消息列表 → 渲染项（含天级时间分界） */
export function buildTimelineItems(messages: ChatMessage[]): TimelineItem[] {
  const items: TimelineItem[] = []
  const thinkingByTurn = new Map<string, Extract<TimelineItem, { kind: 'thinking' }>>()
  let lastDay = ''
  let lastTime = ''
  for (const msg of messages) {
    // seq 决定顺序，timestamp 只决定「显示成几点」。上游事件时间可能倒退
    // （续接/摘要重放、SDK 复用父事件时间、工具结果迟到），钳到前一条避免
    // 出现「23:06 之后又冒出 14:56」的横线与天分界来回跳。
    const createdAt = monotonicCreatedAt(msg.createdAt, lastTime)
    if (createdAt) lastTime = createdAt
    const day = createdAt.slice(0, 10)
    if (day && day !== lastDay) {
      items.push({
        kind: 'time',
        key: `day:${day}:${items.length}`,
        label: dayLabel(createdAt),
        createdAt,
      })
      lastDay = day
    }
    switch (msg.role) {
      case 'user':
        items.push({
          kind: 'user',
          key: msg.key,
          text: displayTextOf(msg.text),
          ...(msg.turnId != null ? { turnId: msg.turnId } : {}),
          ...(msg.attachments != null && msg.attachments.length > 0
            ? { attachments: msg.attachments }
            : {}),
          attachmentOnly: isAttachmentOnlyText(msg.text),
          createdAt,
        })
        break
      case 'assistant':
        items.push({
          kind: 'assistant',
          key: msg.key,
          text: msg.text,
          createdAt,
        })
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
          createdAt,
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
          text: msg.text,
          createdAt,
        })
        break
      case 'status':
        items.push({
          kind: 'status',
          key: msg.key,
          text: msg.text,
          tone: msg.tone ?? 'done',
          createdAt,
        })
        break
      case 'media':
        if (msg.paths != null && msg.paths.length > 0) {
          items.push({
            kind: 'media',
            key: msg.key,
            paths: msg.paths,
            createdAt,
          })
        }
        break
    }
  }
  return items
}

/**
 * 隐藏执行详情时：连续的 tool / thinking 段折叠成一条浅色横线分块，
 * 横线后跟该段的到达时间与折叠条数；点击横线可临时展开该段（expandedKeys）。
 * 运行状态、最终答复、天分界全部保留，会话输出因此被清晰分块。
 */
export function filterExecutionDetails(
  items: TimelineItem[],
  hidden: boolean,
  expandedKeys: Set<string> = new Set<string>(),
): TimelineItem[] {
  if (!hidden) return items
  const out: TimelineItem[] = []
  let pending: TimelineItem[] = []

  const flush = () => {
    if (pending.length === 0) return
    const first = pending[0]
    // key 只依赖段首，流式新增工具时不会换 key（展开态得以保留）
    const dividerKey = `div:${first.key}`
    if (expandedKeys.has(dividerKey)) {
      out.push({
        kind: 'divider',
        key: dividerKey,
        label: clockLabel(first.createdAt),
        hiddenCount: pending.length,
        createdAt: first.createdAt,
        expanded: true,
      })
      out.push(...pending)
    } else {
      out.push({
        kind: 'divider',
        key: dividerKey,
        label: clockLabel(first.createdAt),
        hiddenCount: pending.length,
        createdAt: first.createdAt,
      })
    }
    pending = []
  }

  for (const item of items) {
    if (item.kind === 'tool' || item.kind === 'thinking') {
      pending.push(item)
      continue
    }
    flush()
    out.push(item)
  }
  flush()
  return out
}

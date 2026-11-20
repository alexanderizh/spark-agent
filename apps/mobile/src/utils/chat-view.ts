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

/**
 * 纵向间距档位（WXSS 里 `.gap-*` 落地）。
 *
 * 之前所有行统一 `margin: 16rpx 0`，等于「轮边界」和「轮内阶段」都是 16pt 空隙：
 * 一轮里的 思考 → 工具 → 正文 被撑得七零八落，反而看不出谁和谁是一伙的。
 * 现在按角色分档：轮与轮之间明显换气，同轮的过程段紧贴正文。
 */
export type TimelineGap = 'first' | 'turn' | 'block' | 'tight' | 'section'

interface ItemBase {
  key: string
  /** 到达时间（ISO），用于分块横线与消息时间展示 */
  createdAt?: string
  /** 纵向间距档位；由 assignTimelineGaps 统一回填，页面样式只认这一个字段 */
  gap?: TimelineGap
  /**
   * 轮次锚点 id：该行是新一轮的首条时由 buildTurnRail 回填。
   * 轮次轨道的「跳转到该轮」按这个 id 量位置，见 utils/turn-rail.ts。
   */
  turnAnchorId?: string
}

export type TimelineItem =
  | (ItemBase & { kind: 'time'; label: string })
  | (ItemBase & {
      kind: 'user'
      text: string
      turnId?: string
      attachments?: TimelineUserAttachment[]
      /** 本地队列乐观态：发送中 / 发送失败可重试 / 已送达但目标端排队中 */
      sendStatus?: 'sending' | 'failed' | 'queued'
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
      /** 全部图片解析失败（占位图变为「点击重试」；页面实例态经 decorateItem 回填） */
      failed?: boolean
    })
  /**
   * 折叠横线：浅色线 + 文案 + 折叠条数，点击可临时展开。
   * 两种来源共用：`execution` 是「隐藏执行详情」折叠的工具/思考段，
   * `turn` 是一轮处理完后自动收起的中间过程。
   */
  | (ItemBase & {
      kind: 'divider'
      label: string
      hiddenCount: number
      /** 横线上的完整文案（模板直接用，不再拼单位） */
      text: string
      variant?: 'execution' | 'turn'
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
        text: `${clockLabel(first.createdAt)} · ${pending.length} 条工具记录`,
        variant: 'execution',
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
        text: `${clockLabel(first.createdAt)} · ${pending.length} 条工具记录`,
        variant: 'execution',
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

/**
 * 回合级折叠：一轮处理完之后只留最后一段正文，中间正文段 / 思考 / 工具 / 状态行
 * 收进一条折叠横线，点开才看全过程。
 *
 * 与桌面端主对话区（assistant-turn-collapse）和远程视图（remoteTurnCollapse）同一口径：
 * 目标端一轮常被拆成「正文 → 干活 → 正文 → 干活 → 总结」十几段，全铺出来会把结论
 * 冲到屏幕外。运行中的最后一轮保持展开 —— 实时进展不能被收起来。
 */
export interface TurnFoldOptions {
  /** 会话是否还在运行（最后一轮正在跑时不折叠） */
  running: boolean
  /** 用户点开过的折叠块（key 形如 turn:<首条被折叠项的 key>） */
  expandedKeys?: Set<string>
}

/** 始终可见：提问、天级分界、产物图片（交付结果不是过程日志） */
function isTurnAlwaysVisible(item: TimelineItem): boolean {
  return item.kind === 'user' || item.kind === 'time' || item.kind === 'media'
}

/** 一轮里「算总结」的正文：从末尾往前收集连续助手正文；产物/状态行不切断连续性 */
function collectTurnSummary(segment: TimelineItem[]): Set<TimelineItem> {
  const summary = new Set<TimelineItem>()
  for (let index = segment.length - 1; index >= 0; index -= 1) {
    const item = segment[index]
    if (item == null) continue
    if (item.kind === 'media' || item.kind === 'status') continue
    if (item.kind === 'assistant' && item.text.trim().length > 0) {
      summary.add(item)
      continue
    }
    break
  }
  return summary
}

function foldTurnSegment(
  segment: TimelineItem[],
  expandedKeys: Set<string>,
): TimelineItem[] | null {
  // 中间有报错就没法「一句话总结完」：错误提示必须留在折叠外
  if (segment.some((item) => item.kind === 'status' && item.tone === 'error')) return null
  const summary = collectTurnSummary(segment)
  // 没有正文总结（例如这轮只跑了工具就中断）：收起来只会剩一条空横线
  if (summary.size === 0) return null

  const visible = segment.filter((item) => isTurnAlwaysVisible(item) || summary.has(item))
  const hidden = segment.filter((item) => !visible.includes(item))
  if (hidden.length === 0) return null

  const first = hidden[0]
  if (first == null) return null
  // key 只依赖「第一条被折叠项」：折叠态与展开态之间切换时横线不跳位
  const key = `turn:${first.key}`
  const expanded = expandedKeys.has(key)
  const divider: TimelineItem = {
    kind: 'divider',
    key,
    label: clockLabel(first.createdAt),
    hiddenCount: hidden.length,
    text: `已折叠 ${hidden.length} 段过程`,
    variant: 'turn',
    createdAt: first.createdAt,
    ...(expanded ? { expanded: true } : {}),
  }

  if (expanded) {
    const out: TimelineItem[] = []
    for (const item of segment) {
      if (item === first) out.push(divider)
      out.push(item)
    }
    return out
  }

  const out: TimelineItem[] = []
  let inserted = false
  for (const item of segment) {
    if (!visible.includes(item)) {
      if (!inserted) {
        out.push(divider)
        inserted = true
      }
      continue
    }
    out.push(item)
  }
  return out
}

export function collapseFinishedTurns(
  items: TimelineItem[],
  options: TurnFoldOptions,
): TimelineItem[] {
  if (items.length === 0) return items
  const expandedKeys = new Set(options.expandedKeys ?? [])

  // 按用户提问切回合：用户消息是新回合的第一条；天级分界不切段（同一轮可能跨天）
  const segments: TimelineItem[][] = []
  for (const item of items) {
    if (item.kind === 'user' || segments.length === 0) segments.push([])
    const last = segments[segments.length - 1]
    if (last != null) last.push(item)
  }

  const out: TimelineItem[] = []
  segments.forEach((segment, index) => {
    const finished = !(options.running && index === segments.length - 1)
    const folded = finished ? foldTurnSegment(segment, expandedKeys) : null
    if (folded == null) out.push(...segment)
    else out.push(...folded)
  })
  return out
}

/**
 * 回填每行的纵向间距档位。
 *
 * 必须在折叠（collapseFinishedTurns）与执行详情过滤（filterExecutionDetails）
 * **之后**调用：两者都会增删行（插入/移除 divider），之前算好的档位会错位。
 *
 * 分档口径：
 *   first   列表首行，不预留顶部空隙
 *   turn    新的一轮开始（用户提问）—— 与上一轮的总结之间要能「换气」
 *   block   轮内的正文段 / 产物图片 —— 阅读单元，间距中等
 *   tight   轮内的过程段（思考 / 工具 / 状态行）—— 紧贴上下文，不抢注意力
 *   section 天级分界与折叠横线 —— 自带分隔语义，比正文松一档
 */
export function assignTimelineGaps(items: TimelineItem[]): TimelineItem[] {
  if (items.length === 0) return items
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index]
    if (item == null) continue
    if (index === 0) {
      item.gap = 'first'
      continue
    }
    switch (item.kind) {
      case 'user':
        // 用户提问即新回合起点（collapseFinishedTurns 同口径切段）
        item.gap = 'turn'
        break
      case 'time':
      case 'divider':
        item.gap = 'section'
        break
      case 'assistant':
      case 'media':
        item.gap = 'block'
        break
      default:
        item.gap = 'tight'
        break
    }
  }
  return items
}

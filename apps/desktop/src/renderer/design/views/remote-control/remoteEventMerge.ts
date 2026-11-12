/**
 * 远程会话事件归并。
 *
 * 目标设备同时通过三条路径给出同一段输出：
 *   1. 历史接口 /v1/sessions/:id/messages 返回已落库的 complete 分段；
 *   2. 中继订阅流实时推送同一段的 delta 分片；
 *   3. 回合结束时执行器再补一条 **回合级收尾消息**（`isFinal: true` 且**无
 *      segmentId**，见 agent-runtime/sdk/event-mapper.ts 的 result 分支）。
 *
 * 三条直接拼起来会把同一段文字渲染两遍（小程序端踩过这个坑，见
 * apps/mobile/src/utils/chat-reducer.ts 的 dedupe / stripDoubledText 逻辑）。
 * 这里用与端上一致的四条规则收敛：
 *   - 批次内去重：同 id 保留文本更完整的一份；
 *   - delta 抑制：只丢弃 seq 不晚于同段完整事件的 delta；旧目标端缺少
 *     segmentId 时按 main 段对齐。无 segmentId 的回合级 final 不属于 main 段，
 *     空 complete 也可能是重试复位标记，后续 delta 必须保留；
 *   - 收尾对齐：回合级收尾消息按内容与既有分段对账（拼接相等 / 覆盖末段 /
 *     前缀扩展 / 全量替换），对不上才收敛成一条正文；
 *   - 同身份去重：按事件 ID / 分段 key 合并，不因正文相同删除独立分段。
 * 顺序只认 seq（同一 seq 再按 timestamp），与桌面端 ORDER BY seq, created_at 对齐。
 */
import type { MobileBridgeEvent } from '@spark/protocol'

const TEXT_EVENT_TYPES = new Set<string>(['assistant_message', 'agent_thinking'])

function isTextEvent(event: MobileBridgeEvent): boolean {
  return TEXT_EVENT_TYPES.has(event.type)
}

/** 文本段身份：同一 turn 内同一 segmentId 的 delta 属于同一段输出。 */
function textSegmentKey(event: MobileBridgeEvent): string {
  return `${event.type}\u0000${event.turnId}\u0000${event.segmentId ?? 'main'}`
}

/**
 * 普通完整事件可使用隐式 main 段兼容旧目标端；无 segmentId 的回合级 final
 * 是整轮全文，不是任一 delta 分段的所有者。
 */
function completedSegmentKey(event: MobileBridgeEvent): string | null {
  if (!isTextEvent(event) || event.mode === 'delta') return null
  if (event.segmentId == null && event.isFinal === true) return null
  return textSegmentKey(event)
}

function sameText(a: string, b: string): boolean {
  return a.trim() === b.trim()
}

function isTerminalStatus(status: string | undefined): boolean {
  return status === 'idle' || status === 'completed' || status === 'cancelled' || status === 'error'
}

function sortBySeq(events: MobileBridgeEvent[]): MobileBridgeEvent[] {
  return [...events].sort((a, b) => {
    if (a.seq !== b.seq) return a.seq - b.seq
    return a.timestamp.localeCompare(b.timestamp)
  })
}

/**
 * 合并 base 与 incoming，返回按 seq 排好序的新数组（不修改入参）。
 */
export function mergeRemoteEvents(
  base: MobileBridgeEvent[],
  incoming: MobileBridgeEvent[],
): MobileBridgeEvent[] {
  const byId = new Map<string, MobileBridgeEvent>()
  const completedSegments = new Map<string, number>()

  const rememberCompletedSegment = (event: MobileBridgeEvent): void => {
    const key = completedSegmentKey(event)
    if (key == null) return
    const previousSeq = completedSegments.get(key)
    if (previousSeq == null || event.seq > previousSeq) completedSegments.set(key, event.seq)
  }

  for (const event of base) {
    byId.set(event.id, event)
    rememberCompletedSegment(event)
  }

  // 先扫描整批 incoming，再过滤 delta，避免同一批事件因到达顺序为
  // delta -> complete 而把两种形态都带入渲染层。
  for (const event of incoming) {
    rememberCompletedSegment(event)
  }

  for (const event of incoming) {
    if (isTextEvent(event) && event.mode === 'delta') {
      const completedSeq = completedSegments.get(textSegmentKey(event))
      if (completedSeq != null && event.seq <= completedSeq) {
        // 完整版之后的重试 delta 属于新输出，不可误删。
        continue
      }
    }
    const previous = byId.get(event.id)
    if (previous == null) {
      byId.set(event.id, event)
      continue
    }
    const previousLength = previous.content?.length ?? 0
    const nextLength = event.content?.length ?? 0
    if (isTextEvent(event) && nextLength >= previousLength) {
      byId.set(event.id, { ...previous, ...event })
    }
  }

  return sortBySeq([...byId.values()])
}

/** agent 呈现的产物文件（路径是目标电脑上的绝对路径） */
export interface RemoteAgentFileEntry {
  path: string
  title?: string
}

/**
 * 活动段里的一步：一段思考或一次工具调用。
 *
 * 与桌面端对话区同构（views/chat/ChatActivitySegments.ts）：连续的思考/工具
 * 调用在渲染前被折叠成一条「活动段」摘要行，展开后才逐条列出，
 * 否则一次 turn 里十几次 bash 会把正文彻底冲散。
 */
export type RemoteActivityStep =
  | { kind: 'thinking'; id: string; seq: number; text: string; streaming: boolean }
  | {
      kind: 'tool'
      id: string
      seq: number
      toolName: string
      status: 'running' | 'success' | 'error'
      result: string | null
    }

export type RemoteTimelineItem =
  | {
      kind: 'user'
      id: string
      seq: number
      text: string
      /** 随消息提交的附件（图片缩略图 / 文件 chip） */
      attachments: Array<{ type: 'image' | 'file'; path: string; name?: string }>
    }
  | {
      kind: 'assistant'
      id: string
      seq: number
      /** 所属回合（回合级收尾消息靠它与分段对账） */
      turnId: string
      text: string
      streaming: boolean
    }
  | {
      kind: 'thinking'
      id: string
      seq: number
      turnId: string
      text: string
      streaming: boolean
    }
  | {
      kind: 'tool'
      id: string
      seq: number
      toolName: string
      status: 'running' | 'success' | 'error'
      result: string | null
    }
  | {
      kind: 'notice'
      id: string
      seq: number
      text: string
      tone: 'info' | 'error'
    }
  | {
      kind: 'files'
      id: string
      seq: number
      files: RemoteAgentFileEntry[]
    }
  | {
      /**
       * 折叠后的活动段：`buildRemoteTimeline` 产出的是零散的 thinking / tool，
       * 渲染前经 groupRemoteActivity() 收成一段。
       */
      kind: 'activity'
      id: string
      seq: number
      steps: RemoteActivityStep[]
    }

/**
 * 把事件流折叠成可直接渲染的时间线条目。
 *
 * 文本段按 (type, turnId, segmentId) 聚合：delta 依次拼接，complete 覆盖原文；
 * 工具调用按 toolCallId 与结果配对；agent_status 不渲染，
 * presented_files 合并成产物卡片行。
 */
export function buildRemoteTimeline(events: MobileBridgeEvent[]): RemoteTimelineItem[] {
  const items: RemoteTimelineItem[] = []
  const textIndex = new Map<string, number>()
  const toolIndex = new Map<string, number>()
  /** 回合级收尾消息：等所有分段都落位后再对账，避免中途改动下标 */
  const turnFinals: Array<{ turnId: string; id: string; seq: number; text: string }> = []
  /** 已收到终态（idle/completed/cancelled/error）的回合：流式光标要收敛 */
  const closedTurns = new Set<string>()

  for (const event of sortBySeq(events)) {
    if (event.type === 'agent_status') {
      if (isTerminalStatus(event.status)) closedTurns.add(event.turnId)
      continue
    }

    if (event.type === 'user_message') {
      const text = (event.content ?? '').trim()
      const attachments = (event.attachments ?? []).flatMap((item) =>
        item.type === 'image' || item.type === 'file'
          ? [
              {
                type: item.type,
                path: item.path,
                ...(item.name != null ? { name: item.name } : {}),
              },
            ]
          : [],
      )
      // 纯附件消息文本可能为空（端上用 U+200B 占位），有附件就不能丢弃
      if (text.length === 0 && attachments.length === 0) continue
      items.push({ kind: 'user', id: event.id, seq: event.seq, text, attachments })
      continue
    }

    if (event.type === 'assistant_message' || event.type === 'agent_thinking') {
      const content = event.content ?? ''
      // retry(resetOutput) 用空 complete 清掉失败尝试的半截文本；普通空 delta 无需建项。
      if (content.length === 0 && event.mode !== 'complete') continue
      // 回合级收尾消息（isFinal 且无 segmentId）不是新分段，而是本回合正文的
      // 权威全文（执行器在 result 之后补发）。当成新分段就会把同一段回答画两遍。
      if (event.type === 'assistant_message' && event.isFinal === true && event.segmentId == null) {
        turnFinals.push({ turnId: event.turnId, id: event.id, seq: event.seq, text: content })
        continue
      }
      const key = textSegmentKey(event)
      const existing = textIndex.get(key)
      const streaming = event.isFinal !== true
      const kind = event.type === 'agent_thinking' ? 'thinking' : 'assistant'

      if (existing == null) {
        textIndex.set(key, items.length)
        items.push({
          kind,
          id: event.id,
          seq: event.seq,
          turnId: event.turnId,
          text: content,
          streaming,
        })
        continue
      }
      const item = items[existing]
      if (item == null || (item.kind !== 'assistant' && item.kind !== 'thinking')) continue
      // complete 覆盖（历史版本权威），delta 拼接
      item.text = event.mode === 'delta' ? item.text + content : content
      item.streaming = streaming
      continue
    }

    if (event.type === 'tool_call') {
      const callId = event.toolCallId ?? event.id
      const existing = toolIndex.get(callId)
      if (existing != null) continue
      toolIndex.set(callId, items.length)
      items.push({
        kind: 'tool',
        id: event.id,
        seq: event.seq,
        toolName: event.toolName ?? 'tool',
        status: 'running',
        result: null,
      })
      continue
    }

    if (event.type === 'tool_result') {
      const callId = event.toolCallId ?? event.id
      const existing = toolIndex.get(callId)
      const status: 'success' | 'error' = event.toolStatus === 'error' ? 'error' : 'success'
      const result = event.content ?? null
      if (existing == null) {
        toolIndex.set(callId, items.length)
        items.push({
          kind: 'tool',
          id: event.id,
          seq: event.seq,
          toolName: event.toolName ?? 'tool',
          status,
          result,
        })
        continue
      }
      const item = items[existing]
      if (item == null || item.kind !== 'tool') continue
      item.status = status
      item.result = result
      continue
    }

    if (event.type === 'agent_error') {
      const text = (event.content ?? event.statusMessage ?? '远程执行出错').trim()
      items.push({ kind: 'notice', id: event.id, seq: event.seq, text, tone: 'error' })
      continue
    }

    if (event.type === 'presented_files') {
      const files = (event.files ?? []).flatMap((file) =>
        typeof file?.path === 'string' && file.path.length > 0
          ? [{ path: file.path, ...(file.title != null ? { title: file.title } : {}) }]
          : [],
      )
      if (files.length === 0) continue
      // 连续多条呈现事件（一个 turn 里分批产出）合并成一张卡片行
      const last = items[items.length - 1]
      if (last != null && last.kind === 'files') {
        const seen = new Set(last.files.map((file) => file.path))
        last.files.push(...files.filter((file) => !seen.has(file.path)))
        continue
      }
      items.push({ kind: 'files', id: event.id, seq: event.seq, files })
    }
  }

  for (const final of turnFinals) reconcileTurnFinal(items, final)
  const orderedItems = sortTimelineItems(items)
  settleStreaming(orderedItems, closedTurns)

  return removeEmptyTextItems(orderedItems)
}

function sortTimelineItems(items: RemoteTimelineItem[]): RemoteTimelineItem[] {
  return items
    .map((item, index) => ({ item, index }))
    .sort((a, b) => a.item.seq - b.item.seq || a.index - b.index)
    .map(({ item }) => item)
}

/**
 * 回合级收尾消息与既有分段对账（口径对齐 apps/mobile/src/utils/chat-reducer.ts）：
 *   1. 分段拼接已等于全文 → 丢弃收尾消息，分段原位保留（正常路径）；
 *   2. 收尾消息只覆盖末段 → 无操作；
 *   3. 收尾消息是分段拼接的扩展 → 差量补到最后一段；
 *   4. 内容对不上（分段缺失/漂移）→ 内容正确性优先，收敛成一条。
 * 没有该回合的分段时（历史只有收尾消息或分段被分页截掉）直接落一条；跨回合
 * 的相同正文不能视为重复。
 */
function reconcileTurnFinal(
  items: RemoteTimelineItem[],
  final: { turnId: string; id: string; seq: number; text: string },
): void {
  const finalText = final.text
  const indexes: number[] = []
  items.forEach((item, index) => {
    if (item.kind === 'assistant' && item.turnId === final.turnId) indexes.push(index)
  })
  // 收到回合级收尾消息即表示本回合正文已定稿：后续不再有分片增长
  for (const index of indexes) {
    const item = items[index]
    if (item != null && item.kind === 'assistant') item.streaming = false
  }

  const pushStandalone = (): void => {
    items.push({
      kind: 'assistant',
      id: final.id,
      seq: final.seq,
      turnId: final.turnId,
      text: finalText,
      streaming: false,
    })
  }

  if (indexes.length === 0) {
    pushStandalone()
    return
  }

  const segments = indexes.map((index) => items[index])
  const texts = segments.map((item) => (item?.kind === 'assistant' ? item.text : ''))
  const joined = texts.join('')
  if (sameText(joined, finalText)) return
  const lastIndex = indexes[indexes.length - 1]
  const last = lastIndex != null ? items[lastIndex] : undefined
  if (last != null && last.kind === 'assistant' && sameText(last.text, finalText)) {
    last.streaming = false
    return
  }
  if (
    joined.length > 0 &&
    finalText.startsWith(joined) &&
    last != null &&
    last.kind === 'assistant'
  ) {
    last.text += finalText.slice(joined.length)
    last.streaming = false
    return
  }

  // 对不上：把全文落到第一条分段上，其余分段清空（渲染层按空文本跳过）
  const anchorIndex = indexes[0]
  const anchor = anchorIndex != null ? items[anchorIndex] : undefined
  if (anchor != null && anchor.kind === 'assistant') {
    anchor.text = finalText
    anchor.streaming = false
  }
  for (let i = 1; i < indexes.length; i += 1) {
    const index = indexes[i]
    const item = index != null ? items[index] : undefined
    if (item != null && item.kind === 'assistant') item.text = ''
  }
}

/**
 * 流式光标收敛：只有「最后一条渲染项」且「回合还没收到终态」的文本才继续显示
 * 进行中。思考分段没有 isFinal，若只看 isFinal 会永远停在「进行中…」。
 */
function settleStreaming(items: RemoteTimelineItem[], closedTurns: Set<string>): void {
  const last = items[items.length - 1]
  for (const item of items) {
    if (item.kind !== 'assistant' && item.kind !== 'thinking') continue
    item.streaming = item.streaming && item === last && !closedTurns.has(item.turnId)
  }
}

/** 移除收尾对账产生的空项，保留具有独立分段身份的重复正文。 */
function removeEmptyTextItems(items: RemoteTimelineItem[]): RemoteTimelineItem[] {
  const out: RemoteTimelineItem[] = []
  for (const item of items) {
    if (item.kind === 'assistant') {
      const text = item.text
      // 回合级收敛后留下的空分段不渲染
      if (text.trim().length === 0) continue
      out.push(text === item.text ? item : { ...item, text })
      continue
    }
    if (item.kind === 'thinking' && item.text.trim().length === 0) continue
    out.push(item)
  }
  return out
}

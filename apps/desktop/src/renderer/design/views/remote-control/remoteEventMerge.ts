/**
 * 远程会话事件归并。
 *
 * 目标设备同时通过两条路径给出同一段输出：
 *   1. 历史接口 /v1/sessions/:id/messages 返回已落库的 complete / isFinal 事件；
 *   2. 中继订阅流实时推送同一段的 delta 分片。
 *
 * 两条直接 concat 会把同一段文字渲染两遍（小程序端踩过这个坑，见
 * apps/mobile/src/utils/chat-reducer.ts 的 dedupe/dropped 逻辑）。这里用与端上
 * 一致的两条规则收敛：
 *   - 批次内去重：同 id 保留文本更完整的一份；
 *   - delta 抑制：base 里已有该 (type, turnId, segmentId) 的非 delta 版本时，
 *     丢弃随后到达的 delta，segment 内容以完整版为准。
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
  const completedSegments = new Set<string>()

  for (const event of base) {
    byId.set(event.id, event)
    if (isTextEvent(event) && event.mode !== 'delta') {
      completedSegments.add(textSegmentKey(event))
    }
  }

  for (const event of incoming) {
    if (
      isTextEvent(event) &&
      event.mode === 'delta' &&
      completedSegments.has(textSegmentKey(event))
    ) {
      // 该段已有完整版：delta 属于同一内容的更早分片，丢弃以免重复渲染
      continue
    }
    const previous = byId.get(event.id)
    if (previous == null) {
      byId.set(event.id, event)
      if (isTextEvent(event) && event.mode !== 'delta') {
        completedSegments.add(textSegmentKey(event))
      }
      continue
    }
    const previousLength = previous.content?.length ?? 0
    const nextLength = event.content?.length ?? 0
    if (isTextEvent(event) && nextLength >= previousLength) {
      byId.set(event.id, { ...previous, ...event })
      if (event.mode !== 'delta') completedSegments.add(textSegmentKey(event))
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
      text: string
      streaming: boolean
    }
  | {
      kind: 'thinking'
      id: string
      seq: number
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

  for (const event of sortBySeq(events)) {
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
      if (content.length === 0) continue
      const key = textSegmentKey(event)
      const existing = textIndex.get(key)
      const streaming = event.isFinal !== true
      const kind = event.type === 'agent_thinking' ? 'thinking' : 'assistant'

      if (existing == null) {
        textIndex.set(key, items.length)
        items.push({ kind, id: event.id, seq: event.seq, text: content, streaming })
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

  return items
}

import type { ComputerUseEvent } from '@spark/protocol'

export interface ComputerActivityTimeline {
  computerSessionId: string
  events: ComputerUseEvent[]
}

export function mergeComputerActivityEvents(
  current: ComputerUseEvent[],
  incoming: ComputerUseEvent[],
): ComputerUseEvent[] {
  const merged = new Map<string, ComputerUseEvent>()
  for (const event of [...current, ...incoming]) {
    merged.set(`${event.computerSessionId}:${event.seq}`, event)
  }
  return [...merged.values()].sort(
    (left, right) =>
      left.computerSessionId.localeCompare(right.computerSessionId) || left.seq - right.seq,
  )
}

export function groupComputerActivityEvents(
  events: ComputerUseEvent[],
): ComputerActivityTimeline[] {
  const grouped = new Map<string, ComputerUseEvent[]>()
  for (const event of events) {
    const timeline = grouped.get(event.computerSessionId) ?? []
    timeline.push(event)
    grouped.set(event.computerSessionId, timeline)
  }
  return [...grouped.entries()]
    .map(([computerSessionId, timeline]) => ({
      computerSessionId,
      events: timeline.sort((left, right) => left.seq - right.seq),
    }))
    .sort((left, right) => {
      const leftTime = left.events[0]?.timestamp ?? ''
      const rightTime = right.events[0]?.timestamp ?? ''
      return (
        leftTime.localeCompare(rightTime) ||
        left.computerSessionId.localeCompare(right.computerSessionId)
      )
    })
}

export function isTerminalComputerActivityEvent(event: ComputerUseEvent | undefined): boolean {
  return (
    event?.type === 'computer_session_completed' ||
    event?.type === 'computer_session_failed' ||
    event?.type === 'computer_session_canceled'
  )
}

export interface ComputerActivitySegment {
  computerSessionId: string
  /** 本段事件（保持时间线 seq 升序），时间上落在同一对相邻消息锚点之间 */
  events: ComputerUseEvent[]
  /** 该段是否为此 computerSession 时间线切出的最后一段（含最新事件，控制按钮只跟随它） */
  isSessionLatest: boolean
}

/** 切片锚点需要的消息字段（UIMessage 的结构子集） */
export interface ComputerActivityAnchorMessage {
  id: string
  role: 'user' | 'assistant'
  status: 'streaming' | 'completed' | 'error' | 'cancelled'
  timestamp?: string | undefined
  durationMs?: number | undefined
}

/**
 * 计算消息作为切片锚点的时间（毫秒）；不可锚定返回 null。
 *
 * - 用户消息：真实发送时刻（timestamp）。
 * - 助手消息：timestamp 取自轮次首个 assistant 事件，早于轮内全部电脑操作事件——
 *   若直接用它做锚点，事件会全部落到「最后一条消息」之后，卡片仍然沉底。因此
 *   流式中的助手消息不锚定；终态后锚定在轮次结束时刻（timestamp + durationMs），
 *   缺 durationMs 时退化为创建时刻。
 */
function anchorTimeMs(message: ComputerActivityAnchorMessage): number | null {
  const created = Date.parse(message.timestamp ?? '')
  if (!Number.isFinite(created)) return null
  if (message.role === 'assistant') {
    if (message.status === 'streaming') return null
    return created + (message.durationMs ?? 0)
  }
  return created
}

/**
 * 把电脑操作时间线按消息时间锚点切片，让操作记录按发生时间穿插在会话消息流内，
 * 而不是整轮聚合沉底。
 *
 * - 仍进行中的时间线（末事件非终态）整条挂到 `activeSinkMessageId`（会话最后一条
 *   消息）：实时监控区跟随视口底部，暂停/接管/停止控制按钮保持可达；终态事件一到
 *   即按锚点归位。
 * - 终态时间线逐事件二分定位到「锚定时间不晚于事件时刻的最近一条消息」；事件早于
 *   首个锚点时归首锚点——这是历史分页未加载完时的兜底，加载更早消息后自动归位。
 * - 无任何有效锚点时全部挂 `activeSinkMessageId`，保证记录不丢。
 * - 每个事件独立二分定位，容忍个别事件时间乱序；同一插槽多个 computerSession 的
 *   段按各段首事件时间排序。
 */
export function sliceComputerActivityTimelines(
  timelines: ComputerActivityTimeline[],
  messages: ReadonlyArray<ComputerActivityAnchorMessage>,
  activeSinkMessageId: string | undefined,
): Map<string, ComputerActivitySegment[]> {
  const segmentsByMessage = new Map<string, ComputerActivitySegment[]>()
  const validAnchors: Array<{ id: string; time: number }> = []
  for (const message of messages) {
    const time = anchorTimeMs(message)
    if (time != null) validAnchors.push({ id: message.id, time })
  }
  const firstAnchor = validAnchors[0]

  const anchorIdForEvent = (event: ComputerUseEvent): string => {
    const eventTime = Date.parse(event.timestamp)
    if (firstAnchor == null || !Number.isFinite(eventTime)) {
      return activeSinkMessageId ?? firstAnchor?.id ?? ''
    }
    // 二分找最后一个锚定时间 <= 事件时刻的锚点；早于首锚点时归首锚点。
    let matched = firstAnchor
    let low = 0
    let high = validAnchors.length - 1
    while (low <= high) {
      const mid = (low + high) >> 1
      const anchor = validAnchors[mid]
      if (anchor != null && anchor.time <= eventTime) {
        matched = anchor
        low = mid + 1
      } else {
        high = mid - 1
      }
    }
    return matched.id
  }

  const appendSegment = (messageId: string, segment: ComputerActivitySegment): void => {
    if (messageId === '') return
    const segments = segmentsByMessage.get(messageId) ?? []
    segments.push(segment)
    segmentsByMessage.set(messageId, segments)
  }

  for (const timeline of timelines) {
    const lastEvent = timeline.events[timeline.events.length - 1]
    if (lastEvent == null) continue

    // 进行中的时间线：整条挂实时监控区，不参与锚点归位。
    if (!isTerminalComputerActivityEvent(lastEvent)) {
      if (activeSinkMessageId != null) {
        appendSegment(activeSinkMessageId, {
          computerSessionId: timeline.computerSessionId,
          events: timeline.events,
          isSessionLatest: true,
        })
        continue
      }
    }

    const buckets = new Map<string, ComputerUseEvent[]>()
    for (const event of timeline.events) {
      const anchorId = anchorIdForEvent(event)
      const bucket = buckets.get(anchorId)
      if (bucket != null) bucket.push(event)
      else buckets.set(anchorId, [event])
    }
    const latestAnchorId = anchorIdForEvent(lastEvent)
    for (const [anchorId, events] of buckets) {
      appendSegment(anchorId, {
        computerSessionId: timeline.computerSessionId,
        events,
        isSessionLatest: anchorId === latestAnchorId,
      })
    }
  }

  for (const segments of segmentsByMessage.values()) {
    segments.sort(
      (left, right) =>
        (left.events[0]?.timestamp ?? '').localeCompare(right.events[0]?.timestamp ?? '') ||
        left.computerSessionId.localeCompare(right.computerSessionId),
    )
  }
  return segmentsByMessage
}

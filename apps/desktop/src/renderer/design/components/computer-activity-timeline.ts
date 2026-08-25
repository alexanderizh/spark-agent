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

/**
 * 把电脑操作时间线按消息时间锚点切片：每个事件落到「创建时间不晚于事件时刻的最近
 * 一条消息」的插槽里，让操作记录按发生时间穿插在会话消息流内，而不是整轮聚合沉底。
 *
 * - 锚点只取 timestamp 有效的消息；事件早于首个锚点时归入首锚点——这是历史分页
 *   未加载完时的兜底，加载更早消息后切片自动归位。
 * - 每个事件独立二分定位，容忍个别事件时间乱序；同一插槽多个 computerSession 的
 *   段按各段首事件时间排序。
 */
export function sliceComputerActivityTimelines(
  timelines: ComputerActivityTimeline[],
  anchors: ReadonlyArray<{ id: string; timestamp?: string | undefined }>,
): Map<string, ComputerActivitySegment[]> {
  const segmentsByMessage = new Map<string, ComputerActivitySegment[]>()
  const validAnchors = anchors.filter(
    (anchor): anchor is { id: string; timestamp: string } => anchor.timestamp != null,
  )
  const firstAnchor = validAnchors[0]
  if (firstAnchor == null) return segmentsByMessage

  const anchorIdForEvent = (event: ComputerUseEvent): string => {
    // 二分找最后一个 timestamp <= event.timestamp 的锚点；早于首锚点时归首锚点。
    let matched = firstAnchor
    let low = 0
    let high = validAnchors.length - 1
    while (low <= high) {
      const mid = (low + high) >> 1
      const anchor = validAnchors[mid]
      if (anchor != null && anchor.timestamp.localeCompare(event.timestamp) <= 0) {
        matched = anchor
        low = mid + 1
      } else {
        high = mid - 1
      }
    }
    return matched.id
  }

  for (const timeline of timelines) {
    const lastEvent = timeline.events[timeline.events.length - 1]
    if (lastEvent == null) continue
    const buckets = new Map<string, ComputerUseEvent[]>()
    for (const event of timeline.events) {
      const anchorId = anchorIdForEvent(event)
      const bucket = buckets.get(anchorId)
      if (bucket != null) bucket.push(event)
      else buckets.set(anchorId, [event])
    }
    const latestAnchorId = anchorIdForEvent(lastEvent)
    for (const [anchorId, events] of buckets) {
      const segments = segmentsByMessage.get(anchorId) ?? []
      segments.push({
        computerSessionId: timeline.computerSessionId,
        events,
        isSessionLatest: anchorId === latestAnchorId,
      })
      segmentsByMessage.set(anchorId, segments)
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

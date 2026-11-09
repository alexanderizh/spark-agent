/**
 * 会话事件的顺序归一化。
 *
 * 唯一权威顺序是服务端 `agent_events.seq`（会话内单调递增）；排序口径与
 * `packages/storage` 的 `ORDER BY seq ASC, created_at ASC, rowid ASC` 对齐。
 *
 * 为什么不能只看 timestamp：桌面端 `toMobileEvent` 原样透传 `event.timestamp`，
 * 而续接/摘要重放会沿用历史事件的原始时间、SDK 占位事件会复用父事件时间、
 * 工具结果也可能迟到 —— seq 递增的同一批事件里 timestamp 完全可能倒退。
 * 若按 timestamp 排序或直接把它当时间标签，就会出现「14:56 的横线排在 23:06 之后」。
 *
 * 端上三条硬规则：
 *   1. 渲染顺序只认 seq；任何事件合并都必须回到「完整有序事件集」上重放。
 *   2. 展示时间做单调化（不倒退），但绝不改写事件本身的 timestamp。
 *   3. 同一分段的 delta 与 complete 是同一段内容的两种形态，只能留一种。
 *      桌面端 `ensurePoller` 在运行中的会话会从「当前回合用户消息」回放事件，
 *      回放出的 delta 与 `init()` 拉到的历史 complete 会同时进入 allEvents，
 *      若都交给 applyEvents，delta 会被追加到已有全文后面 → agent 输出重复两遍。
 */

import type { BridgeEvent } from '../api/bridge'

/** seq → timestamp → id 的稳定排序；不修改入参 */
export function sortEvents(events: BridgeEvent[]): BridgeEvent[] {
  return [...events].sort((a, b) => {
    const seqDiff = (Number(a.seq) || 0) - (Number(b.seq) || 0)
    if (seqDiff !== 0) return seqDiff
    const timeDiff = String(a.timestamp ?? '').localeCompare(String(b.timestamp ?? ''))
    if (timeDiff !== 0) return timeDiff
    return String(a.id ?? '').localeCompare(String(b.id ?? ''))
  })
}

/** 分段标识：同一 (类型, 回合, 分段) 的 delta 与 complete 代表同一段输出 */
function segmentKey(event: BridgeEvent): string {
  return `${event.type}\u0000${event.turnId ?? ''}\u0000${event.segmentId ?? ''}`
}

function isTextEvent(event: BridgeEvent): boolean {
  return event.type === 'assistant_message' || event.type === 'agent_thinking'
}

/** 流式增量片段 */
function isTextDelta(event: BridgeEvent): boolean {
  return isTextEvent(event) && event.mode === 'delta'
}

/** 分段完整版；isFinal 的回合收尾消息另行归并，不参与分段去重 */
function isTextComplete(event: BridgeEvent): boolean {
  return isTextEvent(event) && event.mode !== 'delta' && event.isFinal !== true
}

/**
 * 一批事件内部归一化：某分段已有完整版就丢掉它的全部 delta。
 * 用于 applyEvents 全量重放（allEvents 里可能历史原因同时留着两种形态）。
 */
export function normalizeTextEvents(events: BridgeEvent[]): BridgeEvent[] {
  const completeSegments = new Set<string>()
  for (const event of events) {
    if (isTextComplete(event)) completeSegments.add(segmentKey(event))
  }
  if (completeSegments.size === 0) return events
  return events.filter((event) => !(isTextDelta(event) && completeSegments.has(segmentKey(event))))
}

export interface MergeEventsResult {
  /** 按 id 去重后的完整有序事件集 */
  events: BridgeEvent[]
  /** 本次真正新增的事件（已排序）；增量快路径只能用这批，避免 delta 重复拼接 */
  added: BridgeEvent[]
  /** 新增事件里有 seq 落在已加载区间内 → 服务端补写/晚到，必须全量重放时间线 */
  hasBackfill: boolean
  /** 新增事件的最小 seq 越过已应用最大 seq 且中间有空洞（仅实时流场景有意义） */
  hasGap: boolean
  /** 因「该分段已有完整版」被丢弃的回放 delta 条数 */
  droppedRedundantDeltas: number
  maxSeq: number
}

/**
 * 把一批（可能乱序、可能重复）事件合入已有事件集。
 * 已存在的 id 保留旧对象：它的 delta 已经在时间线里应用过，再应用一次会重复拼接。
 * 另外：base 已有某分段的完整版时，incoming 里该分段的 delta 一律丢弃 ——
 * 这些是桌面端回放当前回合时补送的增量，再应用会让整段输出出现两遍。
 */
export function mergeEvents(base: BridgeEvent[], incoming: BridgeEvent[]): MergeEventsResult {
  const known = new Set(base.map((event) => event.id))
  const completeSegments = new Set<string>()
  for (const event of base) {
    if (isTextComplete(event)) completeSegments.add(segmentKey(event))
  }
  const added: BridgeEvent[] = []
  let droppedRedundantDeltas = 0
  for (const event of incoming) {
    if (event == null || typeof event.id !== 'string' || known.has(event.id)) continue
    if (isTextDelta(event) && completeSegments.has(segmentKey(event))) {
      droppedRedundantDeltas += 1
      continue
    }
    known.add(event.id)
    added.push(event)
    if (isTextComplete(event)) completeSegments.add(segmentKey(event))
  }
  const baseMaxSeq = base.reduce((max, event) => Math.max(max, Number(event.seq) || 0), 0)
  const sortedAdded = sortEvents(added)
  const hasBackfill =
    sortedAdded.length > 0 && sortedAdded.some((event) => (Number(event.seq) || 0) <= baseMaxSeq)
  const minSeq = sortedAdded.length > 0 ? Number(sortedAdded[0].seq) || 0 : Number.POSITIVE_INFINITY
  const hasGap = sortedAdded.length > 0 && baseMaxSeq > 0 && minSeq > baseMaxSeq + 1
  const events = sortedAdded.length > 0 ? sortEvents([...base, ...sortedAdded]) : sortEvents(base)
  const maxSeq = events.reduce((max, event) => Math.max(max, Number(event.seq) || 0), baseMaxSeq)
  return {
    events,
    added: sortedAdded,
    hasBackfill,
    hasGap,
    droppedRedundantDeltas,
    maxSeq,
  }
}

/**
 * 展示时间单调化：seq 才是权威顺序，timestamp 倒退时沿用前一条的时间。
 * 只作用于渲染项，不改事件数据（快照/对账仍保留服务端原始 timestamp）。
 */
export function monotonicCreatedAt(iso: string | undefined, previous: string): string {
  if (!iso) return previous
  const time = Date.parse(iso)
  if (!Number.isFinite(time)) return previous
  const prevTime = previous ? Date.parse(previous) : Number.NaN
  if (Number.isFinite(prevTime) && time < prevTime) return previous
  return iso
}

/**
 * 远程会话历史的向上翻页（纯函数 + 常量，可单测）。
 *
 * 目标端 `GET /v1/sessions/:id/messages` 早就支持 `beforeSeq` 游标：按轮次分页
 * （`turnLimit` + `eventLimit`），返回 `hasMore` 与 `nextBeforeSeq`。桌面端此前
 * 只拉一次 `limit=200` 就再也不往上要，长会话往上滚到底也看不到更早的内容。
 *
 * 这里只负责三件容易写错的事：
 *   1. `hasMore` 归一 —— 旧版目标端不带该字段时按「满页即可能还有」兜底；
 *   2. 游标归一 —— 优先服务端 `nextBeforeSeq`，退回本页最小 `seq`；
 *   3. 游标必须严格向更早推进，否则翻页会原地打转刷请求。
 */
import type { MobileBridgeEvent } from '@spark/protocol'

/** 每次取多少轮完整对话（与小程序端一致：轮次分页，绝不把一轮 agentic 输出切碎） */
export const HISTORY_TURN_PAGE_SIZE = 12
/** 单页事件数护栏：某些轮次工具调用特别多，免得一次回传过大 */
export const HISTORY_EVENT_PAGE_LIMIT = 1200
/** 旧版目标端不给 hasMore 时的兜底阈值（等于首页请求的 limit） */
export const HISTORY_FALLBACK_PAGE_SIZE = 200
/** 单次手势最多连续补几页（跳过只有内部事件的页） */
export const HISTORY_MAX_PAGES_PER_GESTURE = 4
/** 顶部触发阈值与冷却：程序化滚动也会触发 scroll，冷却避免「加载→重排→又加载」 */
export const HISTORY_TOP_THRESHOLD_PX = 96
export const HISTORY_LOAD_COOLDOWN_MS = 800

export interface RemoteHistoryPage {
  events?: MobileBridgeEvent[]
  running?: boolean
  hasMore?: boolean
  nextBeforeSeq?: number
}

/** hasMore 归一：新版以服务端为准，旧版按「满页即可能还有」兜底 */
export function resolveHistoryHasMore(page: RemoteHistoryPage): boolean {
  if (typeof page.hasMore === 'boolean') return page.hasMore
  return (page.events?.length ?? 0) >= HISTORY_FALLBACK_PAGE_SIZE
}

/** 向上翻页游标：优先服务端给的 nextBeforeSeq，退回本页最小 seq */
export function resolveHistoryCursor(page: RemoteHistoryPage): number | null {
  const explicit = page.nextBeforeSeq
  if (typeof explicit === 'number' && Number.isFinite(explicit)) return explicit
  const seqs = (page.events ?? [])
    .map((event) => event.seq)
    .filter((seq): seq is number => typeof seq === 'number' && Number.isFinite(seq))
  return seqs.length > 0 ? Math.min(...seqs) : null
}

/** 游标必须严格向更早推进（beforeSeq 是排他下界） */
export function isHistoryCursorAdvancing(next: number | null, current: number): boolean {
  return next != null && next < current
}

/** 过滤出本地还没出现过的事件（翻页去重的第一道，mergeRemoteEvents 是第二道） */
export function pickUnseenEvents(
  known: Iterable<string>,
  incoming: readonly MobileBridgeEvent[],
): MobileBridgeEvent[] {
  const seen = new Set(known)
  const fresh: MobileBridgeEvent[] = []
  for (const event of incoming) {
    if (seen.has(event.id)) continue
    seen.add(event.id)
    fresh.push(event)
  }
  return fresh
}

/** 拼历史请求 URL（首页不带 beforeSeq） */
export function buildHistoryUrl(sessionId: string, beforeSeq?: number): string {
  const params = [
    `limit=${HISTORY_FALLBACK_PAGE_SIZE}`,
    `turnLimit=${HISTORY_TURN_PAGE_SIZE}`,
    `eventLimit=${HISTORY_EVENT_PAGE_LIMIT}`,
  ]
  if (beforeSeq != null) params.push(`beforeSeq=${beforeSeq}`)
  return `/v1/sessions/${encodeURIComponent(sessionId)}/messages?${params.join('&')}`
}

/**
 * 会话队列视图（桌面端权威快照 → 小程序渲染项）。
 *
 * 当前回合运行中时，后续提交的消息在桌面端排队（起跑前不产生 user_message 事件）。
 * 旧实现只弹一个「已加入队列」toast，气泡照常显示成「已送达」，排队几条、排到
 * 第几、什么时候跑一概不知 —— 用户看起来像「发了没反应」。
 * 这里把 GET /v1/sessions/:id/queue 的快照收敛成：
 *   - 输入区上方一张「待执行队列」卡片（每条排队消息的序号 + 摘要 + 排队时间）；
 *   - 本地「已送达待回显」气泡的排队态：按 submitTurn 返回的 turnId 精确匹配
 *     队列项，命中即显示「排队中」，起跑（快照里消失）后自动恢复普通气泡。
 */

import type { BridgeSessionQueue } from '../api/bridge'

/** 队列卡片单条视图 */
export interface QueueItemView {
  /** 队列顺序（1 起） */
  index: number
  turnId: string
  /** 摘要（超长截断；纯附件消息显示附件占位） */
  summary: string
  /** 相对时间（xx 前） */
  timeLabel: string
}

export interface QueueSnapshotView {
  /** 卡片整体显隐（队列空 = 隐藏） */
  visible: boolean
  items: QueueItemView[]
  /** 队列因上一回合出错暂停 */
  pausedReason: string
}

/** 排队摘要截断长度（卡片宽度有限，两行以内） */
const SUMMARY_MAX_CHARS = 40

/** 排队时间标签：分钟以内「刚刚」，以内小时「N 分钟前」，更长「N 小时前」 */
export function queueTimeLabel(enqueuedAt: string, now: number): string {
  const time = Date.parse(enqueuedAt)
  if (!Number.isFinite(time)) return ''
  const diffMs = Math.max(0, now - time)
  if (diffMs < 60_000) return '刚刚'
  if (diffMs < 3_600_000) return `${Math.floor(diffMs / 60_000)} 分钟前`
  return `${Math.floor(diffMs / 3_600_000)} 小时前`
}

/** 纯附件 / 超长消息的摘要（与桌面端排队面板同口径：取首行截断） */
export function queueSummaryOf(message: string): string {
  const firstLine = message.replace(/\r?\n/g, ' ').trim()
  if (firstLine.length === 0) return '附件消息'
  return firstLine.length > SUMMARY_MAX_CHARS
    ? `${firstLine.slice(0, SUMMARY_MAX_CHARS)}…`
    : firstLine
}

/** 桌面端快照 → 卡片视图（null/字段缺失按空队列降级，旧版桌面端 404 时调用方传 null） */
export function buildQueueView(
  snapshot: BridgeSessionQueue | null,
  now: number,
): QueueSnapshotView {
  const queued = snapshot?.queuedTurns ?? []
  const pausedReason =
    snapshot?.paused != null && snapshot.paused.reason === 'turn_error'
      ? (snapshot.paused.errorMessage ?? '上一回合出错，队列已暂停')
      : ''
  return {
    visible: queued.length > 0,
    items: queued.map((turn, i) => ({
      index: i + 1,
      turnId: turn.turnId,
      summary: queueSummaryOf(turn.message),
      timeLabel: queueTimeLabel(turn.enqueuedAt, now),
    })),
    pausedReason,
  }
}

/** 本地气泡是否排队中：submitTurn 返回的 turnId 命中队列项 */
export function isTurnQueued(queuedTurnIds: Set<string>, turnId: string | undefined): boolean {
  return turnId != null && turnId !== '' && queuedTurnIds.has(turnId)
}

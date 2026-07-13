/**
 * 会话排序纯工具 —— 从 SessionSidebarContext 抽离，便于独立单测，且不引入
 * React / UI 副作用依赖。排序规则与后端 SessionRepository.list 的 SQL 逐字对齐。
 */
import type { SessionListResponse } from '@spark/protocol'

export type SessionSummary = SessionListResponse['sessions'][number]

/** 把 ISO 时间字符串解析为可比较的时间戳，非法/缺失时回落到 0。 */
export function toTime(value: string | null | undefined): number {
  if (value == null) return 0
  const t = new Date(value).getTime()
  return Number.isFinite(t) ? t : 0
}

/**
 * 会话排序，与后端 SessionRepository.list 的 SQL 逐字对齐：
 *   ORDER BY pinned_at IS NULL ASC, pinned_at DESC, updated_at DESC
 * 即：置顶在前（近期置顶更靠前），未置顶按最近更新时间倒序。
 * 乐观更新 pinnedAt 后依赖此排序让会话即时归位，避免等全量刷新。
 */
export function sortSessionsByPinned(sessions: SessionSummary[]): SessionSummary[] {
  return [...sessions].sort((a, b) => {
    const aPinnedAt = a.pinnedAt
    const bPinnedAt = b.pinnedAt
    if (aPinnedAt != null && bPinnedAt == null) return -1
    if (aPinnedAt == null && bPinnedAt != null) return 1
    if (aPinnedAt != null && bPinnedAt != null) {
      return toTime(bPinnedAt) - toTime(aPinnedAt)
    }
    return toTime(b.updatedAt) - toTime(a.updatedAt)
  })
}

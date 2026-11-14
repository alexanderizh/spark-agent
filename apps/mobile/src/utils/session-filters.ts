/**
 * 会话筛选（纯函数 + 类型，页面与冒烟脚本共用）。
 *
 * 语义对齐桌面端远程视图（apps/desktop/src/renderer/design/views/remote-control/
 * remoteSessionFilters.ts），改口径请两端同步：
 *   - 状态 / 标记 / 项目都是**多选 OR**，空数组 = 该维度不过滤；
 *   - 最近活动单选（今天按自然日从 00:00 起算）；「只看置顶」是开关；
 *   - 状态开启筛选时，未知状态一律视为不命中（宁可少显示，也不混进其它状态）。
 *
 * 小程序不引入 @spark/protocol（包体约束），类型在此手工同步。
 */

import type { BridgeSessionSummary } from '../api/bridge'
import { SESSION_LABELS, type BridgeSessionLabelKey } from './sidebar-order'

/** 会话状态（目标端 sessions.status 的实际取值） */
export const SESSION_STATUS_KEYS = ['running', 'idle', 'completed', 'cancelled', 'error'] as const
export type SessionStatusKey = (typeof SESSION_STATUS_KEYS)[number]

/** 最近活动窗口（'all' = 不限） */
export const SESSION_ACTIVITY_KEYS = ['today', '3d', '7d', '30d', 'all'] as const
export type SessionActivityKey = (typeof SESSION_ACTIVITY_KEYS)[number]

/** 标记维度：「未标记」与具体标记可并存（OR） */
export type SessionLabelFilterValue = BridgeSessionLabelKey | 'unlabeled'

/** 未归属项目 id（与桌面端 UNASSIGNED_PROJECT_ID 同值） */
export const UNASSIGNED_PROJECT_ID = 'default'

/**
 * 跨项目视图专用：会话所属项目不在项目列表里（项目已归档，或被别的设备删掉）。
 *
 * 桌面端 `listProjects` 默认不含归档项目，而会话查询只排除「已归档会话」——
 * 归档项目下未归档的会话仍会出现。这类行必须单独归类，不能并进「未归属项目」：
 * 否则既显示错名字，又会被「未归属」筛选错误命中。id 用不可能与真实项目冲突的前缀。
 */
export const ARCHIVED_PROJECT_FILTER_ID = '__archived_project__'

export interface SessionFilterState {
  statuses: SessionStatusKey[]
  labels: SessionLabelFilterValue[]
  activity: SessionActivityKey
  /** 空 = 全部项目；含 'default' 表示未归属会话 */
  projectIds: string[]
  pinnedOnly: boolean
}

export const DEFAULT_SESSION_FILTER: SessionFilterState = {
  statuses: [],
  labels: [],
  activity: 'all',
  projectIds: [],
  pinnedOnly: false,
}

export const SESSION_STATUS_OPTIONS: ReadonlyArray<{ value: SessionStatusKey; label: string }> = [
  { value: 'running', label: '运行中' },
  { value: 'idle', label: '空闲' },
  { value: 'completed', label: '已完成' },
  { value: 'cancelled', label: '已取消' },
  { value: 'error', label: '失败' },
]

export const SESSION_ACTIVITY_OPTIONS: ReadonlyArray<{
  value: SessionActivityKey
  label: string
}> = [
  { value: 'today', label: '今天' },
  { value: '3d', label: '近 3 天' },
  { value: '7d', label: '近 7 天' },
  { value: '30d', label: '近 30 天' },
  { value: 'all', label: '不限' },
]

export const SESSION_LABEL_FILTER_OPTIONS: ReadonlyArray<{
  value: SessionLabelFilterValue
  label: string
}> = [
  ...SESSION_LABELS.map((meta) => ({
    value: meta.key as SessionLabelFilterValue,
    label: meta.label,
  })),
  { value: 'unlabeled', label: '未标记' },
]

const DAY_MS = 86_400_000
const ACTIVITY_WINDOW_MS: Record<'3d' | '7d' | '30d', number> = {
  '3d': 3 * DAY_MS,
  '7d': 7 * DAY_MS,
  '30d': 30 * DAY_MS,
}

/** 今天 00:00（本地时区）——「今天」按自然日算，与桌面端一致 */
export function startOfToday(now = Date.now()): number {
  const date = new Date(now)
  date.setHours(0, 0, 0, 0)
  return date.getTime()
}

function matchesActivity(updatedAt: string, activity: SessionActivityKey, now: number): boolean {
  if (activity === 'all') return true
  const time = new Date(updatedAt).getTime()
  if (Number.isNaN(time)) return false
  if (activity === 'today') return time >= startOfToday(now)
  return now - time <= ACTIVITY_WINDOW_MS[activity]
}

/** 单条会话是否命中筛选（只判会话级维度；项目维度由调用方决定是否需要） */
export function matchSession(
  session: BridgeSessionSummary,
  filter: SessionFilterState,
  now = Date.now(),
): boolean {
  if (filter.statuses.length > 0) {
    if (!(filter.statuses as readonly string[]).includes(session.status)) return false
  }
  if (filter.pinnedOnly && session.pinnedAt == null) return false
  if (filter.labels.length > 0) {
    const label = (session.sessionLabel ?? 'unlabeled') as SessionLabelFilterValue
    if (!filter.labels.includes(label)) return false
  }
  if (filter.projectIds.length > 0) {
    const projectId = session.projectId ?? UNASSIGNED_PROJECT_ID
    if (!filter.projectIds.includes(projectId)) return false
  }
  return matchesActivity(session.updatedAt, filter.activity, now)
}

/** 激活了几个维度（按钮角标用；不是选项个数） */
export function countSessionFilterFacets(filter: SessionFilterState): number {
  return (
    (filter.statuses.length > 0 ? 1 : 0) +
    (filter.labels.length > 0 ? 1 : 0) +
    (filter.activity !== 'all' ? 1 : 0) +
    (filter.projectIds.length > 0 ? 1 : 0) +
    (filter.pinnedOnly ? 1 : 0)
  )
}

export function isSessionFilterActive(filter: SessionFilterState): boolean {
  return countSessionFilterFacets(filter) > 0
}

/** 筛选摘要（项目只报个数，避免一行挤满项目名） */
export function summarizeSessionFilter(filter: SessionFilterState): string[] {
  const summary: string[] = []
  for (const value of filter.statuses) {
    summary.push(SESSION_STATUS_OPTIONS.find((option) => option.value === value)?.label ?? value)
  }
  for (const value of filter.labels) {
    summary.push(
      SESSION_LABEL_FILTER_OPTIONS.find((option) => option.value === value)?.label ?? value,
    )
  }
  if (filter.activity !== 'all') {
    summary.push(
      SESSION_ACTIVITY_OPTIONS.find((option) => option.value === filter.activity)?.label ??
        filter.activity,
    )
  }
  if (filter.projectIds.length > 0) summary.push(`项目 ${filter.projectIds.length} 个`)
  if (filter.pinnedOnly) summary.push('仅置顶')
  return summary
}

/** 多选切换（保留选中顺序，不影响语义） */
export function toggleFilterValue<T extends string>(list: readonly T[], value: T): T[] {
  return list.includes(value) ? list.filter((item) => item !== value) : [...list, value]
}

/** 按维度选项顺序归一化，避免各端选择顺序不同导致「看着一样其实不等」 */
export function sortFilterValues<T extends string>(
  list: readonly T[],
  order: ReadonlyArray<{ value: T }>,
): T[] {
  return order.filter((option) => list.includes(option.value)).map((option) => option.value)
}

export interface ResolvedSessionProject {
  /** 筛选/分组用的项目归类 */
  projectKey: string
  /** 行上展示的项目名 */
  projectName: string
  /** 所属项目已不在项目列表（归档/被删） */
  projectMissing: boolean
}

/**
 * 会话归属项目的归类（跨项目视图用）。
 *   - projectId 缺省（旧版桌面端不返回该字段）→ 未归属项目；
 *   - projectId 在项目列表里 → 真实项目；
 *   - 不在列表里（项目已归档或被删）→ 归档哨兵值。
 *
 * 最后一类绝不能并进「未归属项目」：否则名字是错的，而且会被「未归属」筛选错误命中。
 */
export function resolveSessionProject(
  projectId: string | undefined,
  projectNames: ReadonlyMap<string, string>,
): ResolvedSessionProject {
  const rawId = projectId ?? UNASSIGNED_PROJECT_ID
  const known = projectNames.get(rawId)
  if (known != null) return { projectKey: rawId, projectName: known, projectMissing: false }
  if (rawId === UNASSIGNED_PROJECT_ID) {
    return { projectKey: UNASSIGNED_PROJECT_ID, projectName: '未归属项目', projectMissing: false }
  }
  return { projectKey: ARCHIVED_PROJECT_FILTER_ID, projectName: '已归档项目', projectMissing: true }
}

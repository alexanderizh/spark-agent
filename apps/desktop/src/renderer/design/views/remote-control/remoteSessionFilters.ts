/**
 * 远程会话筛选（纯函数 + 类型，可单测）。
 *
 * 语义对齐桌面端侧栏 SidebarFilterMenu：
 *   - 状态 / 标记 / 项目都是**多选 OR**，空数组 = 该维度不过滤；
 *   - 最近活动单选；只看置顶是开关。
 *
 * 与本地唯一的不同是「什么时候生效」：远程会话树是懒加载的（未展开的项目压根没有
 * 会话行），所以会话级维度（状态/标记/活动/置顶）一开，调用方必须切到「结果视图」
 * 去全量拉一遍再过滤；只有项目维度能在树上就地生效。
 */
import type { MobileBridgeSessionSummary, SessionLabelKey } from '@spark/protocol'
import { UNASSIGNED_PROJECT_ID } from './remoteSessionStore'
import { sessionLabelText } from './remoteSessionLabels'

/** 会话状态（目标端 sessions.status 的实际取值：idle / running / completed / cancelled / error） */
export type RemoteStatusFilter = 'running' | 'idle' | 'completed' | 'cancelled' | 'error'
export type RemoteActivityFilter = 'today' | '3d' | '7d' | '30d' | 'all'
/** 标记维度：「未标记」与具体标记可并存（OR） */
export type RemoteLabelFilter = SessionLabelKey | 'unlabeled'

export interface RemoteSessionFilter {
  statuses: RemoteStatusFilter[]
  labels: RemoteLabelFilter[]
  activity: RemoteActivityFilter
  /** 空 = 全部项目；含 UNASSIGNED_PROJECT_ID 表示未归属会话 */
  projectIds: string[]
  pinnedOnly: boolean
}

export const DEFAULT_REMOTE_FILTER: RemoteSessionFilter = {
  statuses: [],
  labels: [],
  activity: 'all',
  projectIds: [],
  pinnedOnly: false,
}

export const REMOTE_STATUS_FILTER_OPTIONS: ReadonlyArray<{
  value: RemoteStatusFilter
  label: string
}> = [
  { value: 'running', label: '运行中' },
  { value: 'idle', label: '空闲' },
  { value: 'completed', label: '已完成' },
  { value: 'cancelled', label: '已取消' },
  { value: 'error', label: '失败' },
]

export const REMOTE_ACTIVITY_FILTER_OPTIONS: ReadonlyArray<{
  value: RemoteActivityFilter
  label: string
}> = [
  { value: 'today', label: '今天' },
  { value: '3d', label: '近 3 天' },
  { value: '7d', label: '近 7 天' },
  { value: '30d', label: '近 30 天' },
  { value: 'all', label: '不限' },
]

const DAY_MS = 86_400_000
const ACTIVITY_WINDOW_MS: Record<Exclude<RemoteActivityFilter, 'all' | 'today'>, number> = {
  '3d': 3 * DAY_MS,
  '7d': 7 * DAY_MS,
  '30d': 30 * DAY_MS,
}

/** 今天 00:00（本地时区）——「今天」按自然日算，跟桌面端侧栏一致 */
function startOfToday(now: number): number {
  const date = new Date(now)
  date.setHours(0, 0, 0, 0)
  return date.getTime()
}

function matchesActivity(updatedAt: string, activity: RemoteActivityFilter, now: number): boolean {
  if (activity === 'all') return true
  const time = new Date(updatedAt).getTime()
  if (Number.isNaN(time)) return false
  if (activity === 'today') return time >= startOfToday(now)
  return now - time <= ACTIVITY_WINDOW_MS[activity]
}

/**
 * 单条会话是否命中筛选。
 * 状态是自由字符串（目标端自己写），筛选开启时未知状态一律视为不命中——
 * 宁可少显示，也不要把「筛选了却混进其它状态」当成 bug。
 */
export function matchRemoteSession(
  session: MobileBridgeSessionSummary,
  filter: RemoteSessionFilter,
  now = Date.now(),
): boolean {
  if (filter.statuses.length > 0) {
    if (!(filter.statuses as readonly string[]).includes(session.status)) return false
  }
  if (filter.pinnedOnly && session.pinnedAt == null) return false
  if (filter.labels.length > 0) {
    const label = (session.sessionLabel ?? 'unlabeled') as RemoteLabelFilter
    if (!filter.labels.includes(label)) return false
  }
  if (filter.projectIds.length > 0) {
    const projectId = session.projectId ?? UNASSIGNED_PROJECT_ID
    if (!filter.projectIds.includes(projectId)) return false
  }
  return matchesActivity(session.updatedAt, filter.activity, now)
}

/** 会话级维度（状态/标记/活动/置顶）是否启用——启用就必须走全量结果视图 */
export function hasSessionLevelFilter(filter: RemoteSessionFilter): boolean {
  return (
    filter.statuses.length > 0 ||
    filter.labels.length > 0 ||
    filter.activity !== 'all' ||
    filter.pinnedOnly
  )
}

export function isRemoteFilterActive(filter: RemoteSessionFilter): boolean {
  return filter.projectIds.length > 0 || hasSessionLevelFilter(filter)
}

/** 按钮角标用：激活了几个维度（不是选项个数） */
export function countActiveFilterFacets(filter: RemoteSessionFilter): number {
  return (
    (filter.statuses.length > 0 ? 1 : 0) +
    (filter.labels.length > 0 ? 1 : 0) +
    (filter.activity !== 'all' ? 1 : 0) +
    (filter.projectIds.length > 0 ? 1 : 0) +
    (filter.pinnedOnly ? 1 : 0)
  )
}

/** 结果视图顶部的「筛选：a · b · c」摘要（项目只报个数，避免一行挤满项目名） */
export function summarizeRemoteFilter(filter: RemoteSessionFilter): string[] {
  const summary: string[] = []
  for (const value of filter.statuses) {
    const meta = REMOTE_STATUS_FILTER_OPTIONS.find((option) => option.value === value)
    summary.push(meta?.label ?? value)
  }
  for (const value of filter.labels) {
    if (value === 'unlabeled') summary.push('未标记')
    else summary.push(sessionLabelText(value) ?? value)
  }
  if (filter.activity !== 'all') {
    const meta = REMOTE_ACTIVITY_FILTER_OPTIONS.find((option) => option.value === filter.activity)
    if (meta != null) summary.push(meta.label)
  }
  if (filter.projectIds.length > 0) summary.push(`项目 ${filter.projectIds.length} 个`)
  if (filter.pinnedOnly) summary.push('仅置顶')
  return summary
}

/** 多选切换（保持选项顺序，选中顺序不影响语义；与桌面端筛选器的写法一致） */
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

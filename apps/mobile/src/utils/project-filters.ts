/**
 * 项目列表筛选（纯函数，可单测）。
 *
 * 项目摘要没有 status 字段，只能按「有无运行中会话 / 有无会话」派生状态，
 * 时间维度取项目自身的 updatedAt（桌面端项目行的「最近活跃」）。
 *   - 时间窗与「今天」口径复用 utils/session-filters（同一天界，避免两页对不上）；
 *   - 虚拟「未归属项目」没有 updatedAt（空串），只在「不限」时间下出现；
 *   - 维度之间是 **AND**，维度内单选。
 */

import { SESSION_ACTIVITY_OPTIONS, startOfToday, type SessionActivityKey } from './session-filters'

export type ProjectActivityKey = SessionActivityKey
export type ProjectStatusKey = 'all' | 'running' | 'withSessions' | 'empty'

export interface ProjectFilterState {
  activity: ProjectActivityKey
  status: ProjectStatusKey
}

export const DEFAULT_PROJECT_FILTER: ProjectFilterState = {
  activity: 'all',
  status: 'all',
}

/** 时间维度与会话页共用同一组选项（文案来自 session-filters） */
export const PROJECT_ACTIVITY_OPTIONS = SESSION_ACTIVITY_OPTIONS

export const PROJECT_STATUS_OPTIONS: ReadonlyArray<{ value: ProjectStatusKey; label: string }> = [
  { value: 'all', label: '全部项目' },
  { value: 'running', label: '有运行中' },
  { value: 'withSessions', label: '有会话' },
  { value: 'empty', label: '空项目' },
]

const DAY_MS = 86_400_000
const ACTIVITY_WINDOW_MS: Record<'3d' | '7d' | '30d', number> = {
  '3d': 3 * DAY_MS,
  '7d': 7 * DAY_MS,
  '30d': 30 * DAY_MS,
}

function matchesActivity(updatedAt: string, activity: ProjectActivityKey, now: number): boolean {
  if (activity === 'all') return true
  // 虚拟项目 / 旧版桌面端缺 updatedAt：时间维度开启时视为不命中
  const time = new Date(updatedAt).getTime()
  if (Number.isNaN(time)) return false
  if (activity === 'today') return time >= startOfToday(now)
  return now - time <= ACTIVITY_WINDOW_MS[activity]
}

function matchesStatus(
  project: { sessionCount: number; runningSessionCount?: number },
  status: ProjectStatusKey,
): boolean {
  if (status === 'all') return true
  const running = project.runningSessionCount ?? 0
  if (status === 'running') return running > 0
  if (status === 'empty') return project.sessionCount === 0
  return project.sessionCount > 0
}

export function matchProject(
  project: { sessionCount: number; runningSessionCount?: number; updatedAt?: string },
  filter: ProjectFilterState,
  now = Date.now(),
): boolean {
  return (
    matchesActivity(project.updatedAt ?? '', filter.activity, now) &&
    matchesStatus(project, filter.status)
  )
}

/** 激活的维度数（筛选按钮角标） */
export function countProjectFilterFacets(filter: ProjectFilterState): number {
  return (filter.activity !== 'all' ? 1 : 0) + (filter.status !== 'all' ? 1 : 0)
}

export function isProjectFilterActive(filter: ProjectFilterState): boolean {
  return countProjectFilterFacets(filter) > 0
}

/** 按钮/chip 文案：单维度显示选项名，多维度显示「筛选中 · N」 */
export function describeProjectFilter(filter: ProjectFilterState): string {
  const facets: string[] = []
  if (filter.activity !== 'all') {
    facets.push(
      PROJECT_ACTIVITY_OPTIONS.find((option) => option.value === filter.activity)?.label ??
        filter.activity,
    )
  }
  if (filter.status !== 'all') {
    facets.push(
      PROJECT_STATUS_OPTIONS.find((option) => option.value === filter.status)?.label ??
        filter.status,
    )
  }
  if (facets.length === 0) return '筛选'
  if (facets.length === 1) return facets[0] ?? '筛选'
  return `筛选中 · ${facets.length}`
}

/**
 * 列表筛选条件的本地缓存（项目页 / 项目会话页）。
 *
 * 为什么需要：两处筛选原本都是页面内存态（`data.filter` 之类），切走再回来即丢，
 * 反复筛选同一批条件要重来。这里按「电脑 +（项目）」维度记忆，跨冷启动仍生效。
 *
 * 存储形态（整表对象，读时逐条校验，脏数据整条忽略、绝不抛错）：
 *   sessionListFilters  `${deviceId}/${projectId}` → { status, activity, label }
 *   projectListFilters  `${deviceId}`             → { activity, status }
 *
 * 搜索词**不缓存**：进页面就带着上次的关键词过滤列表，会让人误以为会话丢了。
 */

import { StorageKeys, getItem, setItem } from './storage'
import {
  SESSION_ACTIVITY_KEYS,
  SESSION_LABEL_FILTER_OPTIONS,
  type SessionActivityKey,
} from './session-filters'
import { PROJECT_STATUS_OPTIONS, type ProjectStatusKey } from './project-filters'

/** 项目会话页的状态筛选（页面内 StatusFilter 的超集，校验时用白名单收敛） */
const SESSION_STATUS_FILTERS = ['all', 'running', 'error', 'idle'] as const
export type SessionStatusFilterValue = (typeof SESSION_STATUS_FILTERS)[number]

export interface CachedSessionListFilters {
  status: SessionStatusFilterValue
  activity: SessionActivityKey
  label: string
}

export interface CachedProjectListFilter {
  activity: SessionActivityKey
  status: ProjectStatusKey
}

export const DEFAULT_SESSION_LIST_FILTERS: CachedSessionListFilters = {
  status: 'all',
  activity: 'all',
  label: '',
}

export const DEFAULT_PROJECT_LIST_FILTER: CachedProjectListFilter = {
  activity: 'all',
  status: 'all',
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function asActivity(value: unknown): SessionActivityKey | null {
  return (SESSION_ACTIVITY_KEYS as readonly string[]).includes(String(value))
    ? (value as SessionActivityKey)
    : null
}

function asStatus(value: unknown): SessionStatusFilterValue | null {
  return (SESSION_STATUS_FILTERS as readonly string[]).includes(String(value))
    ? (value as SessionStatusFilterValue)
    : null
}

/** 标记筛选的合法值：''（不筛）/ labeled（已标记）/ unlabeled（未标记）/ 具体标记 key */
function asLabel(value: unknown): string | null {
  if (value === '' || value === 'labeled') return String(value)
  const allowed = SESSION_LABEL_FILTER_OPTIONS.map((option) => option.value as string)
  return allowed.includes(String(value)) ? String(value) : null
}

function asProjectStatus(value: unknown): ProjectStatusKey | null {
  return PROJECT_STATUS_OPTIONS.some((option) => option.value === value)
    ? (value as ProjectStatusKey)
    : null
}

/** 会话列表筛选：三个维度全部合法才认，任一不合法回退默认值 */
export function readSessionListFilters(
  deviceId: string,
  projectId: string,
): CachedSessionListFilters {
  if (!deviceId || !projectId) return DEFAULT_SESSION_LIST_FILTERS
  const table = getItem<Record<string, unknown>>(StorageKeys.sessionListFilters)
  if (!isRecord(table)) return DEFAULT_SESSION_LIST_FILTERS
  const raw = table[sessionFilterKey(deviceId, projectId)]
  if (!isRecord(raw)) return DEFAULT_SESSION_LIST_FILTERS
  const status = asStatus(raw.status)
  const activity = asActivity(raw.activity)
  const label = asLabel(raw.label)
  if (status == null || activity == null || label == null) return DEFAULT_SESSION_LIST_FILTERS
  return { status, activity, label }
}

export function writeSessionListFilters(
  deviceId: string,
  projectId: string,
  filters: CachedSessionListFilters,
): void {
  if (!deviceId || !projectId) return
  const stored = getItem<Record<string, unknown>>(StorageKeys.sessionListFilters)
  const table = isRecord(stored) ? stored : {}
  const key = sessionFilterKey(deviceId, projectId)
  const next = { status: filters.status, activity: filters.activity, label: filters.label }
  const current = table[key]
  // 值没变就不写（筛选面板逐项点击时避免无意义 I/O）
  if (
    isRecord(current) &&
    current.status === next.status &&
    current.activity === next.activity &&
    current.label === next.label
  ) {
    return
  }
  setItem(StorageKeys.sessionListFilters, { ...table, [key]: next })
}

/** 项目列表筛选：按电脑维度（项目页本身已经是「某台电脑的项目」） */
export function readProjectListFilter(deviceId: string): CachedProjectListFilter {
  if (!deviceId) return DEFAULT_PROJECT_LIST_FILTER
  const table = getItem<Record<string, unknown>>(StorageKeys.projectListFilters)
  if (!isRecord(table)) return DEFAULT_PROJECT_LIST_FILTER
  const raw = table[deviceId]
  if (!isRecord(raw)) return DEFAULT_PROJECT_LIST_FILTER
  const activity = asActivity(raw.activity)
  const status = asProjectStatus(raw.status)
  if (activity == null || status == null) return DEFAULT_PROJECT_LIST_FILTER
  return { activity, status }
}

export function writeProjectListFilter(deviceId: string, filter: CachedProjectListFilter): void {
  if (!deviceId) return
  const stored = getItem<Record<string, unknown>>(StorageKeys.projectListFilters)
  const table = isRecord(stored) ? stored : {}
  const current = table[deviceId]
  if (
    isRecord(current) &&
    current.activity === filter.activity &&
    current.status === filter.status
  ) {
    return
  }
  setItem(StorageKeys.projectListFilters, {
    ...table,
    [deviceId]: { activity: filter.activity, status: filter.status },
  })
}

/** 缓存键：与置顶折叠偏好同构（电脑 + 项目，两个 id 都不含分隔符） */
function sessionFilterKey(deviceId: string, projectId: string): string {
  return `${deviceId}/${projectId}`
}

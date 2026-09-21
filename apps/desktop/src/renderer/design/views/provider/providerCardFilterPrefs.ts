import { useCallback, useEffect, useState } from 'react'

import type { ProviderCardKind } from '../provider-card-actions'

/**
 * Providers（渠道 / 模型管理）页面卡片筛选 / 排序条件的本地缓存。
 *
 * 背景：Providers 视图在切换导航时会被卸载，筛选条件若只放在组件 state 里，
 * 每次回到页面都要重新选一遍。这里把「搜索关键字 + 类型 + 启用状态 + 排序」
 * 写进 localStorage，重新挂载时按缓存恢复。
 *
 * 兼容性约定：
 * - 读取时逐字段校验，非法 / 缺失值回落默认值，避免历史脏数据把列表卡在异常筛选；
 * - 读写失败（首次使用、缓存被清、隐私模式、配额写满）一律静默降级为默认值，
 *   筛选缓存不可用不应影响页面本身可用。
 */
export const PROVIDER_CARD_FILTERS_STORAGE_KEY = 'spark-agent:provider-card-filters'

/** 搜索关键字长度上限，防御超长脏数据占用 localStorage（正常输入远低于此值）。 */
export const PROVIDER_CARD_SEARCH_MAX_LENGTH = 200

export type ProviderCardKindFilter = 'all' | ProviderCardKind
export type ProviderCardEnabledFilter = 'all' | 'enabled' | 'disabled'
export type ProviderCardSortBy = 'default' | 'nameAsc' | 'nameDesc'

export interface ProviderCardFilters {
  /** 名称模糊搜索关键字（原样保留，不做 trim，避免输入空格时被吃掉） */
  search: string
  kind: ProviderCardKindFilter
  enabled: ProviderCardEnabledFilter
  sortBy: ProviderCardSortBy
}

export const DEFAULT_PROVIDER_CARD_FILTERS: ProviderCardFilters = {
  search: '',
  kind: 'all',
  enabled: 'all',
  sortBy: 'default',
}

/**
 * 合法筛选值白名单。
 * 旧「路由」卡片类别（kind='router'）已随旧 Auto Router 下线；历史缓存中
 * 残留的该值会在 normalize 时回落 'all'。
 */
const KIND_VALUES: readonly ProviderCardKindFilter[] = [
  'all',
  'text',
  'image',
  'video',
  'voice',
  'cli',
]

const ENABLED_VALUES: readonly ProviderCardEnabledFilter[] = ['all', 'enabled', 'disabled']
const SORT_VALUES: readonly ProviderCardSortBy[] = ['default', 'nameAsc', 'nameDesc']

function pickFrom<T extends string>(values: readonly T[], raw: unknown, fallback: T): T {
  return typeof raw === 'string' && (values as readonly string[]).includes(raw)
    ? (raw as T)
    : fallback
}

function normalizeSearch(raw: unknown): string {
  if (typeof raw !== 'string') return ''
  return raw.length > PROVIDER_CARD_SEARCH_MAX_LENGTH
    ? raw.slice(0, PROVIDER_CARD_SEARCH_MAX_LENGTH)
    : raw
}

/** 把任意来源（localStorage 原始值 / 局部 patch）收敛为合法筛选项。 */
export function normalizeProviderCardFilters(raw: unknown): ProviderCardFilters {
  const source = (raw ?? {}) as Partial<Record<keyof ProviderCardFilters, unknown>>
  return {
    search: normalizeSearch(source.search),
    kind: pickFrom(KIND_VALUES, source.kind, DEFAULT_PROVIDER_CARD_FILTERS.kind),
    enabled: pickFrom(ENABLED_VALUES, source.enabled, DEFAULT_PROVIDER_CARD_FILTERS.enabled),
    sortBy: pickFrom(SORT_VALUES, source.sortBy, DEFAULT_PROVIDER_CARD_FILTERS.sortBy),
  }
}

export function readProviderCardFilters(): ProviderCardFilters {
  try {
    const raw = window.localStorage.getItem(PROVIDER_CARD_FILTERS_STORAGE_KEY)
    if (!raw) return { ...DEFAULT_PROVIDER_CARD_FILTERS }
    return normalizeProviderCardFilters(JSON.parse(raw))
  } catch {
    return { ...DEFAULT_PROVIDER_CARD_FILTERS }
  }
}

export function writeProviderCardFilters(filters: ProviderCardFilters): void {
  try {
    window.localStorage.setItem(PROVIDER_CARD_FILTERS_STORAGE_KEY, JSON.stringify(filters))
  } catch {
    /* localStorage 不可用时静默降级为「本次挂载内有效」 */
  }
}

/**
 * 带本地缓存的卡片筛选状态：挂载时从 localStorage 恢复，之后任何变更立即回写。
 * 返回对象而非元组，调用方按需解构（如 `filters.kind` / `updateFilters({ kind })`）。
 */
export function useProviderCardFilters(): {
  filters: ProviderCardFilters
  updateFilters: (patch: Partial<ProviderCardFilters>) => void
} {
  const [filters, setFilters] = useState<ProviderCardFilters>(readProviderCardFilters)

  useEffect(() => {
    writeProviderCardFilters(filters)
  }, [filters])

  const updateFilters = useCallback((patch: Partial<ProviderCardFilters>) => {
    setFilters((prev) => normalizeProviderCardFilters({ ...prev, ...patch }))
  }, [])

  return { filters, updateFilters }
}

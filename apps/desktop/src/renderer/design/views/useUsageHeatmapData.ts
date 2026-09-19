import { useCallback, useEffect, useRef, useState } from 'react'
import { getUsageHeatmapRange } from './usageHeatmap.utils'
import type { UsageHeatmapDailyGroup, UsageHeatmapRange } from './usageHeatmap.utils'
import { readCachedUsageHeatmap, writeUsageHeatmapCache } from './usageHeatmapCache'

export interface UseUsageHeatmapDataOptions {
  /**
   * 是否启用数据请求。空会话 hero 只在真正展示时才拉取用量，
   * 避免每次进入 Chat 视图都触发一次 IPC。
   */
  enabled?: boolean
}

export interface UsageHeatmapDataState {
  dailyGroups: UsageHeatmapDailyGroup[]
  /** 首次加载中（该 range 还没有任何已知数据且尚未失败）。 */
  loading: boolean
  error: string | null
  /** 手动重试（设置页错误态按钮使用）。 */
  reload: () => Promise<void>
}

interface UsageHeatmapRangeState {
  range: UsageHeatmapRange
  dailyGroups: UsageHeatmapDailyGroup[]
  /** 该 range 是否已有可用数据（来自缓存或已成功请求）。 */
  known: boolean
  error: string | null
}

/**
 * 先同步取缓存，再决定是否需要 loading：命中缓存时首帧就有数据，
 * 调用方（空会话 hero）可直接渲染热力图，不经过 pending 态。
 */
function seedUsageHeatmapRangeState(range: UsageHeatmapRange): UsageHeatmapRangeState {
  const cached = readCachedUsageHeatmap(range)
  return { range, dailyGroups: cached ?? [], known: cached != null, error: null }
}

/**
 * 用量热力图的共享数据源：按 range 请求 `usage:get-by-date-range`，
 * 管理 loading / error 与竞态取消（requestId 递增丢弃过期响应）。
 * 设置页 UsageHeatmap 与空会话 HeroUsageHeatmap 共用。
 *
 * 数据流：缓存（内存 + localStorage）→ 首帧同步渲染 → 后台请求刷新并回写缓存。
 * 已知数据后不再回到 loading，避免热力图在刷新期间回退成 pending / 快捷卡片造成闪烁。
 */
export function useUsageHeatmapData(
  range: UsageHeatmapRange,
  options?: UseUsageHeatmapDataOptions,
): UsageHeatmapDataState {
  const enabled = options?.enabled ?? true
  const [state, setState] = useState<UsageHeatmapRangeState>(() =>
    seedUsageHeatmapRangeState(range),
  )
  const requestId = useRef(0)

  // range 切换后、新请求返回前，state 里可能还是上一个 range 的快照：
  // 这里按缓存重新派生当前 range 的状态（纯读取），保证不会渲染出上一个 range 的数据。
  const current = state.range === range ? state : seedUsageHeatmapRangeState(range)

  const reload = useCallback(async () => {
    const currentRequestId = ++requestId.current
    const { startDate, endDate } = getUsageHeatmapRange(range)
    try {
      const response = await window.spark.invoke('usage:get-by-date-range', {
        startDate,
        endDate,
      })
      // 先落缓存：即便本次响应因为 hero 收起而不再进 UI，也能让下次进入空会话直接命中，
      // 不重新经历一次「快捷卡片 → 热力图」。
      writeUsageHeatmapCache(range, response.dailyGroups)
      if (currentRequestId !== requestId.current) return
      setState({ range, dailyGroups: response.dailyGroups, known: true, error: null })
    } catch (err) {
      if (currentRequestId !== requestId.current) return
      const message = err instanceof Error ? err.message : String(err)
      setState((prev) =>
        // 已有数据（缓存 / 上次成功结果）时保留数据、只记录失败：设置页照常展示图表并提示，
        // 空会话 hero 因为「有数据就是 heatmap」也不会回退成快捷卡片。
        prev.range === range && prev.known
          ? { ...prev, error: message }
          : { range, dailyGroups: [], known: false, error: message },
      )
    }
  }, [range])

  useEffect(() => {
    if (!enabled) {
      // 只失效在途请求，不清空已知数据：下次启用时按缓存/上次结果直接渲染并后台刷新。
      requestId.current += 1
      return
    }
    const timer = window.setTimeout(() => void reload(), 0)
    return () => window.clearTimeout(timer)
  }, [enabled, reload])

  return {
    dailyGroups: current.dailyGroups,
    loading: !current.known && current.error == null,
    error: current.error,
    reload,
  }
}

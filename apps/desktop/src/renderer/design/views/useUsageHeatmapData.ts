import { useCallback, useEffect, useRef, useState } from 'react'
import { getUsageHeatmapRange } from './usageHeatmap.utils'
import type { UsageHeatmapDailyGroup, UsageHeatmapRange } from './usageHeatmap.utils'

export interface UseUsageHeatmapDataOptions {
  /**
   * 是否启用数据请求。空会话 hero 只在真正展示时才拉取用量，
   * 避免每次进入 Chat 视图都触发一次 IPC。
   */
  enabled?: boolean
}

export interface UsageHeatmapDataState {
  dailyGroups: UsageHeatmapDailyGroup[]
  loading: boolean
  error: string | null
  /** 手动重试（设置页错误态按钮使用）。 */
  reload: () => Promise<void>
}

/**
 * 用量热力图的共享数据源：按 range 请求 `usage:get-by-date-range`，
 * 管理 loading / error 与竞态取消（requestId 递增丢弃过期响应）。
 * 设置页 UsageHeatmap 与空会话 HeroUsageHeatmap 共用。
 */
export function useUsageHeatmapData(
  range: UsageHeatmapRange,
  options?: UseUsageHeatmapDataOptions,
): UsageHeatmapDataState {
  const enabled = options?.enabled ?? true
  const [dailyGroups, setDailyGroups] = useState<UsageHeatmapDailyGroup[]>([])
  const [loading, setLoading] = useState(enabled)
  const [error, setError] = useState<string | null>(null)
  const requestId = useRef(0)

  const reload = useCallback(async () => {
    const currentRequestId = ++requestId.current
    setLoading(true)
    setError(null)
    try {
      const { startDate, endDate } = getUsageHeatmapRange(range)
      const response = await window.spark.invoke('usage:get-by-date-range', {
        startDate,
        endDate,
      })
      if (currentRequestId !== requestId.current) return
      setDailyGroups(response.dailyGroups)
    } catch (err) {
      if (currentRequestId !== requestId.current) return
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      if (currentRequestId === requestId.current) setLoading(false)
    }
  }, [range])

  useEffect(() => {
    if (!enabled) {
      // 失效在途请求，下次启用时重新进入 pending，避免复用旧数据/旧状态。
      requestId.current += 1
      return
    }
    const timer = window.setTimeout(() => void reload(), 0)
    return () => window.clearTimeout(timer)
  }, [enabled, reload])

  if (!enabled) {
    return { dailyGroups: [], loading: true, error: null, reload }
  }
  return { dailyGroups, loading, error, reload }
}

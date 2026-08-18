import { useMemo } from 'react'
import { buildUsageHeatmapWeeks, summarizeUsageHeatmap } from '../usageHeatmap.utils'
import type { UsageHeatmapDailyGroup, UsageHeatmapRange } from '../usageHeatmap.utils'
import { useUsageHeatmapData } from '../useUsageHeatmapData'

/** 空会话 hero 固定展示最近 16 周（12 周再多一个月），不提供档位切换。 */
export const HERO_USAGE_RANGE: UsageHeatmapRange = '16w'

/** hero 文案使用的范围标签，须与 HERO_USAGE_RANGE 保持一致。 */
export const HERO_USAGE_RANGE_LABEL = '最近 16 周'

/** 展示热力图所需的最少活跃天数：超过该天数（不要求连续）才用热力图替换快捷卡片。0 即任意一天有数据就展示。 */
export const HERO_USAGE_MIN_ACTIVE_DAYS = 0

/**
 * 空会话布局模式（快捷卡片与热力图互斥）：
 * - pending：用量数据尚未就绪，先按快捷卡片渲染（多数用户最终也是卡片）
 * - cards：没有任何活跃天数或加载失败，渲染完整快捷卡片，不展示热力图
 * - heatmap：16 周内任意一天（含今天）有用量数据，热力图替换快捷卡片
 */
export type EmptyHeroUsageMode = 'pending' | 'cards' | 'heatmap'

export function resolveEmptyHeroUsageMode(
  loading: boolean,
  error: string | null,
  activeDays: number,
): EmptyHeroUsageMode {
  if (loading) return 'pending'
  if (error != null) return 'cards'
  return activeDays > HERO_USAGE_MIN_ACTIVE_DAYS ? 'heatmap' : 'cards'
}

export interface EmptyHeroUsage {
  mode: EmptyHeroUsageMode
  /** 供 HeroUsageHeatmap 渲染的日粒度数据（非 heatmap 模式时为空数组）。 */
  dailyGroups: UsageHeatmapDailyGroup[]
}

/**
 * 空会话用量感知：仅在空会话 hero 真正展示（且非团队模式）时请求一次 16 周用量，
 * 按活跃天数决定空会话展示快捷卡片还是使用足迹热力图（二者互斥）。
 * 失败时静默降级为快捷卡片，不弹错误。
 */
export function useEmptyHeroUsage(enabled: boolean): EmptyHeroUsage {
  const { dailyGroups, loading, error } = useUsageHeatmapData(HERO_USAGE_RANGE, { enabled })
  const activeDays = useMemo(
    () => summarizeUsageHeatmap(buildUsageHeatmapWeeks(HERO_USAGE_RANGE, dailyGroups)).activeDays,
    [dailyGroups],
  )
  const mode = resolveEmptyHeroUsageMode(loading, error, activeDays)
  return { mode, dailyGroups: mode === 'heatmap' ? dailyGroups : [] }
}

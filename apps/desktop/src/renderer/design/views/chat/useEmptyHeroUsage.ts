import { useUsageHeatmapData } from '../useUsageHeatmapData'
import type { UsageHeatmapDailyGroup, UsageHeatmapRange } from '../usageHeatmap.utils'

/**
 * 空会话 hero 的用量数据档：最近 16 周（12 周再多一个月），不提供档位切换。
 * 展示层在容器足够宽时会另行按 6m 档拉长（见 HeroUsageHeatmap）。
 */
export const HERO_USAGE_RANGE: UsageHeatmapRange = '16w'

/** hero 文案使用的范围标签，须与 HERO_USAGE_RANGE 保持一致。 */
export const HERO_USAGE_RANGE_LABEL = '最近 16 周'

export interface EmptyHeroUsage {
  /** 供 HeroUsageHeatmap 渲染的日粒度数据；没有任何用量时为空数组，热力图照常渲染空网格。 */
  dailyGroups: UsageHeatmapDailyGroup[]
  /** 首次加载中：该档位尚无任何已知数据且尚未失败（用于避免闪出「累计 0 tokens」）。 */
  loading: boolean
}

/**
 * 空会话用量感知：空会话 hero 恒以「使用足迹」热力图呈现（有没有用量都是热力图形式），
 * 因此这里只负责在 hero 真正展示（且非团队模式）时拉取 16 周用量并透传给热力图。
 *
 * 数据源带缓存（见 usageHeatmapCache）：命中缓存时首帧即有数据；没有缓存时首帧按空网格渲染，
 * 加载失败静默降级为空网格，不弹错误、也不改变 hero 的形态。
 */
export function useEmptyHeroUsage(enabled: boolean): EmptyHeroUsage {
  const { dailyGroups, loading } = useUsageHeatmapData(HERO_USAGE_RANGE, { enabled })
  return { dailyGroups, loading }
}

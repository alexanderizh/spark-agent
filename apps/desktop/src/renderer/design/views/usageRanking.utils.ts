/**
 * 用量排行（设置-用量统计「模型 / 渠道」tab 卡片）的纯函数与类型集合：
 * 时间区间计算、token 格式化。数据源为 usage:get-by-date-range 的 modelGroups。
 */

export type UsageRankingRange = 'all' | 'today' | '1d' | '7d' | '30d'

export type UsageRankingView = 'models' | 'providers'

/** 排行行数据（usage:get-by-date-range modelGroups 的最小结构），结构化兼容协议完整类型。 */
export interface ModelUsageGroupRow {
  modelId: string
  providerId: string
  totalInputTokens: number
  totalOutputTokens: number
  recordCount: number
}

export const USAGE_RANKING_VIEW_OPTIONS: Array<{ label: string; value: UsageRankingView }> = [
  { label: '模型', value: 'models' },
  { label: '渠道', value: 'providers' },
]

export const USAGE_RANKING_RANGE_OPTIONS: Array<{ label: string; value: UsageRankingRange }> = [
  { label: '全部', value: 'all' },
  { label: '今天', value: 'today' },
  { label: '1 天', value: '1d' },
  { label: '7 天', value: '7d' },
  { label: '30 天', value: '30d' },
]

/** 「全部」的起始时间早于任何真实记录（request_timestamp 为 ISO 字符串，按字典序比较）。 */
const ALL_TIME_START = '1970-01-01T00:00:00.000Z'

/** 滚动窗口区间的小时数；today 是本地自然日、all 无下限，均不走此表。 */
const ROLLING_WINDOW_HOURS: Partial<Record<UsageRankingRange, number>> = {
  '1d': 24,
  '7d': 24 * 7,
  '30d': 24 * 30,
}

/**
 * 计算统计区间：全部=无下限；今天=本地自然日 0 点起；
 * 1 天 / 7 天 / 30 天=滚动窗口（now 往前 N 小时）。
 */
export function getUsageRankingRange(
  range: UsageRankingRange,
  now = new Date(),
): { startDate: string; endDate: string } {
  const endDate = now.toISOString()
  if (range === 'all') return { startDate: ALL_TIME_START, endDate }
  if (range === 'today') {
    const localDayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    return { startDate: localDayStart.toISOString(), endDate }
  }
  const hours = ROLLING_WINDOW_HOURS[range]
  if (hours === undefined) throw new Error(`Unknown usage ranking range: ${range}`)
  return { startDate: new Date(now.getTime() - hours * 3_600_000).toISOString(), endDate }
}

/** Token 统一按 M 展示（不出现 K）：≥100M 取整、≥10M 一位小数、其余两位小数。 */
export function formatTokensM(tokens: number): string {
  const millions = tokens / 1_000_000
  if (millions >= 100) return `${Math.round(millions)}M`
  if (millions >= 10) return `${millions.toFixed(1)}M`
  return `${millions.toFixed(2)}M`
}

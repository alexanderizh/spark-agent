/**
 * 模型用量趋势（设置-通用页卡片）的纯函数集合：
 * 时间范围计算、Top-N 模型挑选、按日堆叠序列构建。
 * token 口径与 usageHeatmap.utils 一致：input + output + reasoning。
 */

export type ModelUsageTrendRange = '7d' | '30d'

export interface ModelUsageTrendDailyGroup {
  date: string
  modelId: string
  providerId: string
  totalInputTokens: number
  totalOutputTokens: number
  totalReasoningOutputTokens: number
  totalCostUsd: number
  recordCount: number
}

/** Top-N 内单个模型的区间总量。 */
export interface ModelUsageTrendModel {
  /** `${providerId}::${modelId}`，跨 provider 同名模型不混淆。 */
  key: string
  modelId: string
  providerId: string
  totalTokens: number
}

export interface ModelUsageTrendDaySegment {
  modelKey: string
  tokens: number
}

export interface ModelUsageTrendDay {
  date: string
  /** x 轴刻度文案（如 '8月1日'），仅刻度日有值。 */
  tickLabel?: string
  segments: ModelUsageTrendDaySegment[]
  totalTokens: number
}

const RANGE_DAYS: Record<ModelUsageTrendRange, number> = {
  '7d': 7,
  '30d': 30,
}

function toDateKey(date: Date): string {
  return date.toISOString().slice(0, 10)
}

function parseDateKey(dateKey: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey)
  if (match == null) throw new Error(`Invalid usage date: ${dateKey}`)
  return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])))
}

function addDays(dateKey: string, amount: number): string {
  const date = parseDateKey(dateKey)
  date.setUTCDate(date.getUTCDate() + amount)
  return toDateKey(date)
}

export function getModelUsageTrendRange(
  range: ModelUsageTrendRange,
  now = new Date(),
): { startDate: string; endDate: string } {
  const endDateKey = toDateKey(now)
  const startDateKey = addDays(endDateKey, -(RANGE_DAYS[range] - 1))
  return {
    startDate: `${startDateKey}T00:00:00.000Z`,
    endDate: `${endDateKey}T23:59:59.999Z`,
  }
}

export function getModelUsageTrendTokens(
  group: Pick<
    ModelUsageTrendDailyGroup,
    'totalInputTokens' | 'totalOutputTokens' | 'totalReasoningOutputTokens'
  >,
): number {
  return (
    Math.max(0, group.totalInputTokens) +
    Math.max(0, group.totalOutputTokens) +
    Math.max(0, group.totalReasoningOutputTokens)
  )
}

/** 按 token 总量取前 N 个模型（稳定排序：同量按 modelId 字典序）。 */
export function pickTopModels(
  groups: ModelUsageTrendDailyGroup[],
  limit = 5,
): ModelUsageTrendModel[] {
  const totals = new Map<string, ModelUsageTrendModel>()
  for (const group of groups) {
    const key = `${group.providerId}::${group.modelId}`
    const existing = totals.get(key)
    const tokens = getModelUsageTrendTokens(group)
    if (existing) {
      existing.totalTokens += tokens
    } else {
      totals.set(key, {
        key,
        modelId: group.modelId,
        providerId: group.providerId,
        totalTokens: tokens,
      })
    }
  }
  return [...totals.values()]
    .filter((model) => model.totalTokens > 0)
    .sort((a, b) => b.totalTokens - a.totalTokens || a.modelId.localeCompare(b.modelId))
    .slice(0, limit)
}

/**
 * 构建按日堆叠序列：补齐范围内缺失日期为 0，segments 顺序与 topModels 一致。
 * 30 天时每 5 天出一个 x 轴刻度，7 天每天都出。
 */
export function buildModelUsageTrendDays(
  range: ModelUsageTrendRange,
  groups: ModelUsageTrendDailyGroup[],
  topModels: ModelUsageTrendModel[],
  now = new Date(),
): ModelUsageTrendDay[] {
  const { startDate, endDate } = getModelUsageTrendRange(range, now)
  const startDateKey = startDate.slice(0, 10)
  const endDateKey = endDate.slice(0, 10)

  const topKeys = new Set(topModels.map((model) => model.key))
  const usageByDateModel = new Map<string, number>()
  for (const group of groups) {
    const key = `${group.providerId}::${group.modelId}`
    if (!topKeys.has(key)) continue
    const dateKey = group.date.slice(0, 10)
    if (dateKey < startDateKey || dateKey > endDateKey) continue
    const cellKey = `${dateKey}|${key}`
    usageByDateModel.set(
      cellKey,
      (usageByDateModel.get(cellKey) ?? 0) + getModelUsageTrendTokens(group),
    )
  }

  const tickEvery = range === '30d' ? 5 : 1
  const days: ModelUsageTrendDay[] = []
  for (
    let cursor = startDateKey, index = 0;
    cursor <= endDateKey;
    cursor = addDays(cursor, 1), index += 1
  ) {
    const segments = topModels.map((model) => ({
      modelKey: model.key,
      tokens: usageByDateModel.get(`${cursor}|${model.key}`) ?? 0,
    }))
    const totalTokens = segments.reduce((sum, segment) => sum + segment.tokens, 0)
    const day: ModelUsageTrendDay = {
      date: cursor,
      segments,
      totalTokens,
    }
    if (index % tickEvery === 0) {
      const date = parseDateKey(cursor)
      day.tickLabel = `${date.getUTCMonth() + 1}月${date.getUTCDate()}日`
    }
    days.push(day)
  }
  return days
}

/** 区间内 token 总量（用于「消耗总量」摘要）。 */
export function summarizeModelUsageTrend(days: ModelUsageTrendDay[]): number {
  return days.reduce((sum, day) => sum + day.totalTokens, 0)
}

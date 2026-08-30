export type UsageHeatmapRange = '12w' | '16w' | '6m' | '1y'

export interface UsageHeatmapDailyGroup {
  date: string
  totalInputTokens: number
  totalOutputTokens: number
  totalReasoningOutputTokens: number
  totalCostUsd: number
  recordCount: number
}

export interface UsageHeatmapDay {
  date: string
  tokens: number
  recordCount: number
  inRange: boolean
}

export interface UsageHeatmapWeek {
  days: UsageHeatmapDay[]
  monthLabel?: string
}

const RANGE_DAYS: Record<UsageHeatmapRange, number> = {
  '12w': 12 * 7,
  '16w': 16 * 7,
  '6m': 180,
  '1y': 365,
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

function getWeekday(dateKey: string): number {
  return parseDateKey(dateKey).getUTCDay()
}

function getMonthLabel(dateKey: string): string {
  return `${parseDateKey(dateKey).getUTCMonth() + 1}月`
}

export function getUsageHeatmapRange(
  range: UsageHeatmapRange,
  now = new Date(),
): { startDate: string; endDate: string } {
  const endDateKey = toDateKey(now)
  const startDateKey = addDays(endDateKey, -(RANGE_DAYS[range] - 1))

  return {
    startDate: `${startDateKey}T00:00:00.000Z`,
    endDate: `${endDateKey}T23:59:59.999Z`,
  }
}

export function buildUsageHeatmapWeeks(
  range: UsageHeatmapRange,
  dailyGroups: UsageHeatmapDailyGroup[],
  now = new Date(),
): UsageHeatmapWeek[] {
  const { startDate, endDate } = getUsageHeatmapRange(range, now)
  const startDateKey = startDate.slice(0, 10)
  const endDateKey = endDate.slice(0, 10)
  const usageByDate = new Map(
    dailyGroups.map((group) => [
      group.date.slice(0, 10),
      {
        tokens:
          Math.max(0, group.totalInputTokens) +
          Math.max(0, group.totalOutputTokens) +
          Math.max(0, group.totalReasoningOutputTokens),
        recordCount: Math.max(0, group.recordCount),
      },
    ]),
  )
  const gridStart = addDays(startDateKey, -getWeekday(startDateKey))
  const gridEnd = addDays(endDateKey, 6 - getWeekday(endDateKey))
  const weeks: UsageHeatmapWeek[] = []

  for (let cursor = gridStart; cursor <= gridEnd; cursor = addDays(cursor, 7)) {
    const days = Array.from({ length: 7 }, (_, index) => {
      const date = addDays(cursor, index)
      const usage = usageByDate.get(date)
      return {
        date,
        tokens: usage?.tokens ?? 0,
        recordCount: usage?.recordCount ?? 0,
        inRange: date >= startDateKey && date <= endDateKey,
      }
    })
    const monthDay = days.find((day) => day.date.slice(8) === '01')

    weeks.push({
      days,
      ...(monthDay ? { monthLabel: getMonthLabel(monthDay.date) } : {}),
    })
  }

  return weeks
}

export interface UsageHeatmapSummary {
  /** 时间范围内所有 inRange 日的 token 总量。 */
  totalTokens: number
  /** 单日最高 token 用量。 */
  maxTokens: number
  /** token > 0 的天数。 */
  activeDays: number
}

/** 汇总热力图周网格的总量 / 峰值 / 活跃天数，供设置页与空会话 hero 复用。 */
export function summarizeUsageHeatmap(weeks: UsageHeatmapWeek[]): UsageHeatmapSummary {
  let totalTokens = 0
  let maxTokens = 0
  let activeDays = 0
  for (const week of weeks) {
    for (const day of week.days) {
      if (!day.inRange) continue
      totalTokens += day.tokens
      if (day.tokens > maxTokens) maxTokens = day.tokens
      if (day.tokens > 0) activeDays += 1
    }
  }
  return { totalTokens, maxTokens, activeDays }
}

export function getUsageLevel(tokens: number, maxTokens: number): 0 | 1 | 2 | 3 | 4 {
  if (tokens <= 0 || maxTokens <= 0) return 0
  const ratio = tokens / maxTokens
  if (ratio <= 0.25) return 1
  if (ratio <= 0.55) return 2
  if (ratio <= 0.8) return 3
  return 4
}

export function formatUsageTokens(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(2)}M`
  if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(1)}K`
  return String(tokens)
}

/** 单元格 hover / aria 标签文案，设置页与空会话 hero 共用。 */
export function formatUsageDayLabel(
  date: string,
  tokens: number,
  recordCount: number,
): string {
  const [year, month, day] = date.split('-')
  if (year == null || month == null || day == null) return date
  const usage = tokens > 0 ? `${formatUsageTokens(tokens)} tokens` : '无 token 用量'
  return `${year}年${Number(month)}月${Number(day)}日：${usage}，${recordCount} 次请求`
}

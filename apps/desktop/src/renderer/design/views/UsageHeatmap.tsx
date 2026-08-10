import { Segmented, Tooltip } from '@lobehub/ui'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  buildUsageHeatmapWeeks,
  formatUsageTokens,
  getUsageHeatmapRange,
  getUsageLevel,
} from './usageHeatmap.utils'
import type {
  UsageHeatmapDailyGroup,
  UsageHeatmapRange,
} from './usageHeatmap.utils'

const RANGE_OPTIONS: Array<{ label: string; value: UsageHeatmapRange }> = [
  { label: '12 周', value: '12w' },
  { label: '6 个月', value: '6m' },
  { label: '1 年', value: '1y' },
]

const WEEKDAY_LABELS = ['日', '一', '二', '三', '四', '五', '六']

function formatDate(dateKey: string): string {
  const [year, month, day] = dateKey.split('-')
  return `${year}年${Number(month)}月${Number(day)}日`
}

function formatDayLabel(
  date: string,
  tokens: number,
  recordCount: number,
): string {
  const usage = tokens > 0 ? `${formatUsageTokens(tokens)} tokens` : '无 token 用量'
  return `${formatDate(date)}：${usage}，${recordCount} 次请求`
}

export function UsageHeatmap() {
  const [range, setRange] = useState<UsageHeatmapRange>('12w')
  const [dailyGroups, setDailyGroups] = useState<UsageHeatmapDailyGroup[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const requestId = useRef(0)

  const loadUsage = useCallback(async () => {
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
    const timer = window.setTimeout(() => void loadUsage(), 0)
    return () => window.clearTimeout(timer)
  }, [loadUsage])

  const weeks = useMemo(
    () => buildUsageHeatmapWeeks(range, dailyGroups),
    [dailyGroups, range],
  )
  const activeDays = useMemo(
    () => weeks.flatMap((week) => week.days).filter((day) => day.inRange),
    [weeks],
  )
  const maxTokens = Math.max(0, ...activeDays.map((day) => day.tokens))
  const totalTokens = activeDays.reduce((total, day) => total + day.tokens, 0)

  return (
    <div className="settings-card usage-heatmap-card">
      <div className="usage-heatmap-header">
        <div>
          <div className="usage-heatmap-title">Token 用量</div>
          <div className="usage-heatmap-summary">
            {loading ? '正在加载…' : `${formatUsageTokens(totalTokens)} tokens · 按日统计`}
          </div>
        </div>
        <Segmented
          size="small"
          value={range}
          options={RANGE_OPTIONS}
          onChange={(value) => setRange(value as UsageHeatmapRange)}
        />
      </div>

      {error ? (
        <div className="usage-heatmap-error" role="alert">
          <span>用量数据加载失败：{error}</span>
          <button type="button" onClick={() => void loadUsage()}>
            重试
          </button>
        </div>
      ) : loading ? (
        <div className="usage-heatmap-loading" aria-label="正在加载用量数据">
          {Array.from({ length: 84 }, (_, index) => (
            <span key={index} />
          ))}
        </div>
      ) : (
        <div className="usage-heatmap-layout">
          <div className="usage-heatmap-weekdays" aria-hidden="true">
            {WEEKDAY_LABELS.map((label) => (
              <span key={label}>{label}</span>
            ))}
          </div>
          <div className="usage-heatmap-scroll" tabIndex={0}>
            <div
              className="usage-heatmap-months"
              style={{ gridTemplateColumns: `repeat(${weeks.length}, 14px)` }}
              aria-hidden="true"
            >
              {weeks.map((week, index) => (
                <span key={index}>{week.monthLabel ?? ''}</span>
              ))}
            </div>
            <div className="usage-heatmap-grid">
              {weeks.map((week, weekIndex) => (
                <div className="usage-heatmap-week" key={weekIndex}>
                  {week.days.map((day) => {
                    const dayLabel = day.inRange
                      ? formatDayLabel(day.date, day.tokens, day.recordCount)
                      : undefined
                    const cell = (
                      <span
                        aria-label={dayLabel}
                        className={`usage-heatmap-cell usage-heatmap-cell--level-${getUsageLevel(day.tokens, maxTokens)}${day.inRange ? ' usage-heatmap-cell--interactive' : ' is-outside'}`}
                        key={day.date}
                        tabIndex={day.inRange ? 0 : -1}
                        title={dayLabel}
                      />
                    )

                    return dayLabel ? (
                      <Tooltip key={day.date} mouseEnterDelay={0.05} placement="top" title={dayLabel}>
                        {cell}
                      </Tooltip>
                    ) : (
                      cell
                    )
                  })}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      <div className="usage-heatmap-footer">
        <span>{loading ? '—' : maxTokens > 0 ? `单日最高 ${formatUsageTokens(maxTokens)}` : '暂无用量记录'}</span>
        <span className="usage-heatmap-legend" aria-label="用量强度图例">
          <span>少</span>
          {[0, 1, 2, 3, 4].map((level) => (
            <i className={`usage-heatmap-cell usage-heatmap-cell--level-${level}`} key={level} />
          ))}
          <span>多</span>
        </span>
      </div>
    </div>
  )
}

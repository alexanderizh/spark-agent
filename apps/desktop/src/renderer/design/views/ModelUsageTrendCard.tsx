import { Segmented, Tooltip } from '@lobehub/ui'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useApp } from '../AppContext'
import { formatUsageTokens } from './usageHeatmap.utils'
import {
  buildModelUsageTrendDays,
  getModelUsageTrendRange,
  pickTopModels,
  summarizeModelUsageTrend,
} from './modelUsageTrend.utils'
import type {
  ModelUsageTrendDailyGroup,
  ModelUsageTrendDay,
  ModelUsageTrendRange,
} from './modelUsageTrend.utils'
import './ModelUsageTrendCard.less'

const RANGE_OPTIONS: Array<{ label: string; value: ModelUsageTrendRange }> = [
  { label: '近 7 日', value: '7d' },
  { label: '近 30 日', value: '30d' },
]

/**
 * 设置-通用页「模型用量趋势」卡片：TOP 5 模型按日分组细柱图（每天每模型一根柱），
 * 近 7 日 / 近 30 日切换，右上角直达「用量统计」设置页。
 */
export function ModelUsageTrendCard() {
  const { setTweak } = useApp()
  const [range, setRange] = useState<ModelUsageTrendRange>('7d')
  const [groups, setGroups] = useState<ModelUsageTrendDailyGroup[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const requestId = useRef(0)

  const reload = useCallback(async () => {
    const currentRequestId = ++requestId.current
    setLoading(true)
    setError(null)
    try {
      const { startDate, endDate } = getModelUsageTrendRange(range)
      const response = await window.spark.invoke('usage:get-by-date-range', {
        startDate,
        endDate,
      })
      if (currentRequestId !== requestId.current) return
      setGroups(response.modelDailyGroups)
    } catch (err) {
      if (currentRequestId !== requestId.current) return
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      if (currentRequestId === requestId.current) setLoading(false)
    }
  }, [range])

  useEffect(() => {
    const timer = window.setTimeout(() => void reload(), 0)
    return () => window.clearTimeout(timer)
  }, [reload])

  const topModels = useMemo(() => pickTopModels(groups), [groups])
  const days = useMemo(
    () => buildModelUsageTrendDays(range, groups, topModels),
    [groups, range, topModels],
  )
  const totalTokens = useMemo(() => summarizeModelUsageTrend(days), [days])
  const maxDayTokens = useMemo(
    () => days.reduce((max, day) => Math.max(max, day.totalTokens), 0),
    [days],
  )

  const rangeLabel = range === '7d' ? '近 7 日' : '近 30 日'

  return (
    <div className="settings-card usage-trend-card">
      <div className="usage-trend-header">
        <div>
          <div className="usage-trend-title">模型用量趋势</div>
          <div className="usage-trend-summary">
            {loading
              ? '正在加载…'
              : `TOP ${topModels.length || 0} 模型 · 消耗总量 ${formatUsageTokens(totalTokens)} tokens`}
          </div>
        </div>
        <div className="usage-trend-header-actions">
          <Segmented
            size="small"
            value={range}
            options={RANGE_OPTIONS}
            onChange={(value) => setRange(value as ModelUsageTrendRange)}
          />
          <button
            type="button"
            className="usage-trend-link"
            onClick={() => setTweak('settingsSection', 'usage')}
          >
            用量统计 ›
          </button>
        </div>
      </div>

      {error ? (
        <div className="usage-trend-error" role="alert">
          <span>用量数据加载失败：{error}</span>
          <button type="button" onClick={() => void reload()}>
            重试
          </button>
        </div>
      ) : loading ? (
        <div className="usage-trend-loading" aria-label="正在加载模型用量趋势">
          {Array.from({ length: 14 }, (_, index) => (
            <span key={index} />
          ))}
        </div>
      ) : topModels.length === 0 ? (
        <div className="usage-trend-empty">{rangeLabel}暂无用量记录</div>
      ) : (
        <>
          <div className="usage-trend-legend" aria-label="模型用量图例">
            <span className="usage-trend-legend-total">
              消耗总量: <strong>{formatUsageTokens(totalTokens)}</strong> tokens
            </span>
            {topModels.map((model, index) => (
              <span className="usage-trend-legend-item" key={model.key}>
                <i
                  className={`usage-trend-swatch usage-trend-swatch--c${index}`}
                  aria-hidden="true"
                />
                {model.modelId}: {formatUsageTokens(model.totalTokens)} tokens
              </span>
            ))}
          </div>
          <ModelUsageTrendBars days={days} maxDayTokens={maxDayTokens} />
        </>
      )}
    </div>
  )
}

function ModelUsageTrendBars({
  days,
  maxDayTokens,
}: {
  days: ModelUsageTrendDay[]
  maxDayTokens: number
}) {
  return (
    <div className="usage-trend-chart" role="img" aria-label="模型每日 token 用量分组柱状图">
      {days.map((day) => {
        const dayTitle = formatModelUsageTrendDayTitle(day)
        return (
          <div className="usage-trend-col" key={day.date}>
            <Tooltip mouseEnterDelay={0.05} placement="top" title={dayTitle}>
              <div className="usage-trend-bar-area" aria-label={dayTitle}>
                {day.segments.map((segment, segmentIndex) => {
                  // 分组柱：每个模型一根独立细柱并排，而非堆叠在同柱内
                  if (segment.tokens <= 0) return null
                  return (
                    <i
                      className={`usage-trend-bar usage-trend-swatch--c${segmentIndex}`}
                      key={segment.modelKey}
                      style={{ height: `${segmentHeightPercent(segment.tokens, maxDayTokens)}%` }}
                    />
                  )
                })}
              </div>
            </Tooltip>
            <span className="usage-trend-tick">{day.tickLabel ?? ''}</span>
          </div>
        )
      })}
    </div>
  )
}

function segmentHeightPercent(tokens: number, maxDayTokens: number): number {
  if (maxDayTokens <= 0 || tokens <= 0) return 0
  return Math.max((tokens / maxDayTokens) * 100, 1.2)
}

function formatModelUsageTrendDayTitle(day: ModelUsageTrendDay): string {
  const [, month, date] = day.date.split('-')
  const heading = `${Number(month)}月${Number(date)}日 · ${formatUsageTokens(day.totalTokens)} tokens`
  const lines = day.segments
    .filter((segment) => segment.tokens > 0)
    .map((segment) => `${segment.modelKey.split('::')[1]}: ${formatUsageTokens(segment.tokens)}`)
  return lines.length > 0 ? [heading, ...lines].join('\n') : heading
}

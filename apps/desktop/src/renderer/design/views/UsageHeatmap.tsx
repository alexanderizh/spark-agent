import { Segmented, Tooltip } from '@lobehub/ui'
import { useMemo, useState } from 'react'
import {
  buildUsageHeatmapWeeks,
  formatUsageDayLabel,
  formatUsageTokens,
  getUsageLevel,
  summarizeUsageHeatmap,
} from './usageHeatmap.utils'
import type { UsageHeatmapRange } from './usageHeatmap.utils'
import { useUsageHeatmapData } from './useUsageHeatmapData'

const RANGE_OPTIONS: Array<{ label: string; value: UsageHeatmapRange }> = [
  { label: '12 周', value: '12w' },
  { label: '6 个月', value: '6m' },
  { label: '1 年', value: '1y' },
]

const WEEKDAY_LABELS = ['日', '一', '二', '三', '四', '五', '六']

export function UsageHeatmap() {
  const [range, setRange] = useState<UsageHeatmapRange>('1y')
  const { dailyGroups, loading, error, reload } = useUsageHeatmapData(range)

  const weeks = useMemo(
    () => buildUsageHeatmapWeeks(range, dailyGroups),
    [dailyGroups, range],
  )
  const { totalTokens, maxTokens } = useMemo(() => summarizeUsageHeatmap(weeks), [weeks])

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
          <button type="button" onClick={() => void reload()}>
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
              style={{ gridTemplateColumns: `repeat(${weeks.length}, var(--uh-cell, 14px))` }}
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
                      ? formatUsageDayLabel(day.date, day.tokens, day.recordCount)
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

import { Tooltip } from '@lobehub/ui'
import { useMemo } from 'react'
import {
  buildUsageHeatmapWeeks,
  formatUsageDayLabel,
  formatUsageTokens,
  getUsageLevel,
  summarizeUsageHeatmap,
} from '../usageHeatmap.utils'
import type { UsageHeatmapDailyGroup } from '../usageHeatmap.utils'
import { HERO_USAGE_RANGE, HERO_USAGE_RANGE_LABEL } from './useEmptyHeroUsage'
import './HeroUsageHeatmap.less'

const WEEKDAY_LABELS = ['日', '一', '二', '三', '四', '五', '六']

/**
 * 空会话「使用足迹」热力图：设置页 UsageHeatmap 的精简变体。
 * 固定 16 周、小单元格、无档位切换、无横向滚动；右上「查看统计」跳设置页看全量数据。
 */
export function HeroUsageHeatmap({
  dailyGroups,
  onOpenStats,
}: {
  dailyGroups: UsageHeatmapDailyGroup[]
  onOpenStats: () => void
}) {
  const weeks = useMemo(
    () => buildUsageHeatmapWeeks(HERO_USAGE_RANGE, dailyGroups),
    [dailyGroups],
  )
  const { totalTokens, maxTokens, activeDays } = useMemo(
    () => summarizeUsageHeatmap(weeks),
    [weeks],
  )

  return (
    <section className="hero-usage-heatmap" aria-label={`${HERO_USAGE_RANGE_LABEL}使用足迹`}>
      <div className="hero-usage-head">
        <div className="hero-usage-caption">
          <span className="hero-usage-title">使用足迹</span>
          <span className="hero-usage-summary">
            {HERO_USAGE_RANGE_LABEL} · 累计 {formatUsageTokens(totalTokens)} tokens · 活跃 {activeDays} 天
          </span>
        </div>
        <button type="button" className="hero-usage-link" onClick={onOpenStats}>
          查看统计 ›
        </button>
      </div>
      <div className="hero-usage-layout">
        <div className="usage-heatmap-weekdays" aria-hidden="true">
          {WEEKDAY_LABELS.map((label) => (
            <span key={label}>{label}</span>
          ))}
        </div>
        <div className="hero-usage-field">
          <div
            className="usage-heatmap-months"
            style={{ gridTemplateColumns: `repeat(${weeks.length}, var(--uh-cell, 12px))` }}
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
      <div className="hero-usage-foot">
        <span>{maxTokens > 0 ? `单日最高 ${formatUsageTokens(maxTokens)}` : '暂无用量记录'}</span>
        <span className="usage-heatmap-legend" aria-label="用量强度图例">
          <span>少</span>
          {[0, 1, 2, 3, 4].map((level) => (
            <i className={`usage-heatmap-cell usage-heatmap-cell--level-${level}`} key={level} />
          ))}
          <span>多</span>
        </span>
      </div>
    </section>
  )
}

import { Tooltip } from '@lobehub/ui'
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  buildUsageHeatmapWeeks,
  formatUsageDayLabel,
  formatUsageTokens,
  getUsageLevel,
  summarizeUsageHeatmap,
} from '../usageHeatmap.utils'
import type { UsageHeatmapDailyGroup, UsageHeatmapRange } from '../usageHeatmap.utils'
import { useUsageHeatmapData } from '../useUsageHeatmapData'
import { HERO_USAGE_RANGE, HERO_USAGE_RANGE_LABEL } from './useEmptyHeroUsage'
import './HeroUsageHeatmap.less'

const WEEKDAY_LABELS = ['日', '一', '二', '三', '四', '五', '六']

/** 宽容器档位：展示近 6 个月（约 26-28 列），数据按 6m range 独立拉取并缓存。 */
const HERO_USAGE_WIDE_RANGE: UsageHeatmapRange = '6m'
const HERO_USAGE_WIDE_LABEL = '最近 6 个月'
/** 容器（hero stack）宽度达到该值才切宽档：6m 卡片最宽 ~670px，留出余量避免溢出。 */
const HERO_USAGE_WIDE_MIN_WIDTH = 700

/**
 * 空会话「使用足迹」热力图：设置页 UsageHeatmap 的精简变体，也是空会话唯一的
 * 用量展示形态（有没有用量都渲染热力图，无用量时是空网格 + 「暂无用量记录」）。
 * 无档位切换、无横向滚动；右上「查看统计」跳设置页看全量数据。
 * 宽度自适应：hero stack 足够宽（≥700px）时拉长为近 6 个月，否则固定 16 周；
 * 测不到容器宽度（无 ResizeObserver / 无父节点）时按 16 周回落。
 */
export function HeroUsageHeatmap({
  dailyGroups,
  loading = false,
  onOpenStats,
}: {
  dailyGroups: UsageHeatmapDailyGroup[]
  /** 首次加载中且尚无任何数据：文案用「正在读取用量…」代替 0 值，避免闪出误导性的空统计。 */
  loading?: boolean
  onOpenStats: () => void
}) {
  const sectionRef = useRef<HTMLElement | null>(null)
  const [stackWidth, setStackWidth] = useState(0)

  // 监听父级 hero stack（720px / 880px 构图容器）的宽度决定档位；
  // 组件自身是 fit-content，测自己拿不到可用宽度。
  useEffect(() => {
    const stack = sectionRef.current?.parentElement
    if (stack == null || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver((entries) => {
      const width = entries[entries.length - 1]?.contentRect.width
      if (width != null) setStackWidth(width)
    })
    observer.observe(stack)
    return () => observer.disconnect()
  }, [])

  const displayRange: UsageHeatmapRange =
    stackWidth >= HERO_USAGE_WIDE_MIN_WIDTH ? HERO_USAGE_WIDE_RANGE : HERO_USAGE_RANGE
  const rangeLabel =
    displayRange === HERO_USAGE_WIDE_RANGE ? HERO_USAGE_WIDE_LABEL : HERO_USAGE_RANGE_LABEL

  // 宽档数据按 range 独立缓存：未进入宽档不发 IPC；首次进入宽档时先用 16 周数据
  // 渲染 6 个月网格，6m 数据返回后补齐更早月份，不出现空网格闪烁。
  const { dailyGroups: wideDailyGroups } = useUsageHeatmapData(HERO_USAGE_WIDE_RANGE, {
    enabled: displayRange === HERO_USAGE_WIDE_RANGE,
  })
  const mergedDailyGroups =
    displayRange === HERO_USAGE_WIDE_RANGE && wideDailyGroups.length > 0
      ? wideDailyGroups
      : dailyGroups

  const weeks = useMemo(
    () => buildUsageHeatmapWeeks(displayRange, mergedDailyGroups),
    [displayRange, mergedDailyGroups],
  )
  const { totalTokens, maxTokens, activeDays } = useMemo(
    () => summarizeUsageHeatmap(weeks),
    [weeks],
  )
  /* 首次加载且尚无数据（无缓存 / 首次进入）：累计值此时一定是 0，不当作真实统计展示。 */
  const pendingFirstLoad = loading && totalTokens === 0

  return (
    <section ref={sectionRef} className="hero-usage-heatmap" aria-label={`${rangeLabel}使用足迹`}>
      <div className="hero-usage-head">
        <div className="hero-usage-caption">
          <span className="hero-usage-title">使用足迹</span>
          <span className="hero-usage-summary">
            {pendingFirstLoad
              ? `${rangeLabel} · 正在读取用量…`
              : `${rangeLabel} · 累计 ${formatUsageTokens(totalTokens)} tokens · 活跃 ${activeDays} 天`}
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
            style={{ gridTemplateColumns: `repeat(${weeks.length}, var(--uh-cell, 17px))` }}
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
        <span>
          {maxTokens > 0
            ? `单日最高 ${formatUsageTokens(maxTokens)}`
            : pendingFirstLoad
              ? '正在读取用量…'
              : '暂无用量记录'}
        </span>
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

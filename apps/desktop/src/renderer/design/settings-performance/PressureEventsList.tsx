/**
 * @module PressureEventsList
 *
 * 最近降级 / 恢复事件（M3）：resource_pressure_events 持久化回看。
 * 行格式：时间 · 级别迁移（含恢复）· 触发指标与数值（越线原因）。
 */

import { useMemo } from 'react'
import type { ResourcePressureEventRecord } from '@spark/protocol'
import {
  formatClock,
  formatIndicatorValue,
  INDICATOR_LABELS,
  PRESSURE_LEVEL_META,
} from './performance-format'

interface PressureEventsListProps {
  events: ResourcePressureEventRecord[]
  loading: boolean
}

function migrationLabel(from: string, to: string): string {
  const fromMeta = PRESSURE_LEVEL_META[from as keyof typeof PRESSURE_LEVEL_META]
  const toMeta = PRESSURE_LEVEL_META[to as keyof typeof PRESSURE_LEVEL_META]
  if (fromMeta == null || toMeta == null) return `${from} → ${to}`
  const upgraded = toMeta.rank > fromMeta.rank
  return upgraded ? `升入 ${toMeta.name}` : `恢复至 ${toMeta.name}`
}

/** 事件原因：越线指标明细（取该轮评估中达到目标级别的指标）。 */
function eventReason(event: ResourcePressureEventRecord): string {
  const toMeta = PRESSURE_LEVEL_META[event.toLevel as keyof typeof PRESSURE_LEVEL_META]
  const rank = toMeta?.rank ?? 0
  const triggers = event.indicators.filter((indicator) => {
    const indicatorMeta = PRESSURE_LEVEL_META[indicator.level as keyof typeof PRESSURE_LEVEL_META]
    return indicatorMeta != null && indicatorMeta.rank >= rank && rank > 0
  })
  if (triggers.length === 0) {
    return event.indicators.length > 0
      ? event.indicators
          .map((i) => `${INDICATOR_LABELS[i.key] ?? i.key} ${formatIndicatorValue(i.key, i.value)}`)
          .join(' · ')
      : '—'
  }
  return triggers
    .map(
      (indicator) =>
        `${INDICATOR_LABELS[indicator.key] ?? indicator.key} ${formatIndicatorValue(indicator.key, indicator.value)}` +
        (indicator.thresholdPct != null
          ? indicator.key === 'event-loop-delay-ms'
            ? ` ≥ ${Math.round(indicator.thresholdPct)} ms`
            : ` ≥ ${Math.round(indicator.thresholdPct)}%`
          : ''),
    )
    .join(' · ')
}

export function PressureEventsList({ events, loading }: PressureEventsListProps) {
  const rows = useMemo(
    () =>
      events.map((event) => {
        const toMeta = PRESSURE_LEVEL_META[event.toLevel as keyof typeof PRESSURE_LEVEL_META]
        return {
          key: event.id,
          time: formatClock(event.occurredAt),
          levelName: toMeta?.name ?? event.toLevel,
          levelColor: toMeta?.colorVar ?? 'var(--text-faint)',
          action: migrationLabel(event.fromLevel, event.toLevel),
          reason: eventReason(event),
        }
      }),
    [events],
  )

  if (loading) {
    return (
      <div className="card">
        <div className="meter-row">
          <span className="sk" style={{ width: '40%', height: 12 }} />
        </div>
        <div className="meter-row">
          <span className="sk" style={{ width: '60%', height: 12 }} />
        </div>
      </div>
    )
  }

  if (rows.length === 0) {
    return (
      <div className="card">
        <div className="ev-empty">暂无降级事件 · 运行平稳</div>
      </div>
    )
  }

  return (
    <div className="card">
      {rows.map((row) => (
        <div className="ev" key={row.key}>
          <span className="ev-t">{row.time}</span>
          <span className="ev-lv">
            <span className="dot" style={{ width: 7, height: 7, background: row.levelColor }} />
            {row.levelName}
          </span>
          <span className="ev-a">{row.action}</span>
          <span className="ev-r">{row.reason}</span>
        </div>
      ))}
    </div>
  )
}

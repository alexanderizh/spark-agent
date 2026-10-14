/**
 * @module PressureEventsList
 *
 * 最近降级 / 恢复事件（M3）：resource_pressure_events 持久化回看。
 * 行格式：时间 · 级别迁移（含恢复）· 触发指标与数值（越线原因）。
 */

import { useMemo } from 'react'
import type { PressureIndicatorKey, PressureLevel, ResourcePressureEventRecord } from '@spark/protocol'
import { useI18n, type TranslateFn } from '../i18n'
import {
  formatClock,
  formatIndicatorValue,
  getIndicatorLabels,
  getPressureLevelMeta,
  type PressureLevelMeta,
} from './performance-format'

interface PressureEventsListProps {
  events: ResourcePressureEventRecord[]
  loading: boolean
}

type LevelMetaMap = Record<PressureLevel, PressureLevelMeta>

function migrationLabel(from: string, to: string, levels: LevelMetaMap, t: TranslateFn): string {
  const fromMeta = levels[from as PressureLevel]
  const toMeta = levels[to as PressureLevel]
  if (fromMeta == null || toMeta == null) return `${from} → ${to}`
  const upgraded = toMeta.rank > fromMeta.rank
  return upgraded
    ? t('perf.events.upgraded', { name: toMeta.name })
    : t('perf.events.recovered', { name: toMeta.name })
}

/** 事件原因：越线指标明细（取该轮评估中达到目标级别的指标）。 */
function eventReason(
  event: ResourcePressureEventRecord,
  levels: LevelMetaMap,
  indicatorLabels: Record<PressureIndicatorKey, string>,
  t: TranslateFn,
): string {
  const toMeta = levels[event.toLevel as PressureLevel]
  const rank = toMeta?.rank ?? 0
  const triggers = event.indicators.filter((indicator) => {
    const indicatorMeta = levels[indicator.level as PressureLevel]
    return indicatorMeta != null && indicatorMeta.rank >= rank && rank > 0
  })
  if (triggers.length === 0) {
    return event.indicators.length > 0
      ? event.indicators
          .map(
            (i) =>
              `${indicatorLabels[i.key] ?? i.key} ${formatIndicatorValue(i.key, i.value, t)}`,
          )
          .join(' · ')
      : '—'
  }
  return triggers
    .map(
      (indicator) =>
        `${indicatorLabels[indicator.key] ?? indicator.key} ${formatIndicatorValue(indicator.key, indicator.value, t)}` +
        (indicator.thresholdPct != null
          ? indicator.key === 'event-loop-delay-ms'
            ? ` ≥ ${Math.round(indicator.thresholdPct)} ms`
            : ` ≥ ${Math.round(indicator.thresholdPct)}%`
          : ''),
    )
    .join(' · ')
}

export function PressureEventsList({ events, loading }: PressureEventsListProps) {
  const { t } = useI18n()
  const levels = useMemo(() => getPressureLevelMeta(t), [t])
  const indicatorLabels = useMemo(() => getIndicatorLabels(t), [t])

  const rows = useMemo(
    () =>
      events.map((event) => {
        const toMeta = levels[event.toLevel as PressureLevel]
        return {
          key: event.id,
          time: formatClock(event.occurredAt),
          levelName: toMeta?.name ?? event.toLevel,
          levelColor: toMeta?.colorVar ?? 'var(--text-faint)',
          action: migrationLabel(event.fromLevel, event.toLevel, levels, t),
          reason: eventReason(event, levels, indicatorLabels, t),
        }
      }),
    [events, levels, indicatorLabels, t],
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
        <div className="ev-empty">{t('perf.events.empty')}</div>
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

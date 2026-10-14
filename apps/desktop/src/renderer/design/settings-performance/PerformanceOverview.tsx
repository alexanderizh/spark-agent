/**
 * @module PerformanceOverview
 *
 * 资源总览：压力状态行 + 四指标网格（宿主内存 / 系统内存 / 事件循环 /
 * CPU）+ 可展开子进程卡（分类堆叠条 + 治理口径说明）。
 * 四态处理：loading 骨架 / error 指标降级标记 / off 空态卡（父层处理）。
 */

import { useMemo, useState } from 'react'
import { Activity, ChevronDown, RefreshCw } from 'lucide-react'
import type {
  PressureIndicatorKey,
  PressureLevel,
  ResourceMonitorFullSnapshot,
  ResourceMonitorSummarySnapshot,
} from '@spark/protocol'
import { useI18n } from '../i18n'
import {
  aggregateChildrenByKind,
  formatBytes,
  formatClock,
  formatMs,
  formatPct,
  getPressureLevelMeta,
  pressureActionCopy,
} from './performance-format'

interface PerformanceOverviewProps {
  summary: ResourceMonitorSummarySnapshot | null
  full: ResourceMonitorFullSnapshot | null
  loading: boolean
  onRefresh: () => void
  refreshing: boolean
}

/** 指标级别 → 着色 tone（pressure.indicators 为服务端权威逐指标评估）。 */
function toneForLevel(level: PressureLevel | undefined): string {
  switch (level) {
    case 'warning':
      return 'is-warn'
    case 'critical':
      return 'is-crit'
    case 'emergency':
      return 'is-emg'
    default:
      return ''
  }
}

export function PerformanceOverview({
  summary,
  full,
  loading,
  onRefresh,
  refreshing,
}: PerformanceOverviewProps) {
  const { t } = useI18n()
  const [procOpen, setProcOpen] = useState(false)

  const levels = useMemo(() => getPressureLevelMeta(t), [t])
  const level = summary?.pressure.level ?? 'nominal'
  const levelMeta = levels[level]
  const stale = summary?.staleFields ?? []

  const indicatorLevels = useMemo(() => {
    const map: Partial<Record<PressureIndicatorKey, PressureLevel>> = {}
    for (const indicator of summary?.pressure.indicators ?? []) {
      map[indicator.key] = indicator.level
    }
    return map
  }, [summary])

  // error 态：采集失败指标显示 — 与「自动重试中」标记。
  const systemError = stale.includes('system')
  const childrenError = stale.includes('children')

  const hostPct = useMemo(() => {
    if (summary == null) return null
    if (summary.derived.hostRssPct != null) return summary.derived.hostRssPct
    if (full?.baseline != null) return (summary.host.rssBytes / full.baseline.totalBytes) * 100
    return null
  }, [summary, full])

  const metricDefs = useMemo(() => {
    const host = summary?.host
    const system = summary?.system
    const eventLoop = summary?.eventLoop
    return [
      {
        key: 'host-rss',
        label: t('perf.metric.hostRssLabel'),
        value: formatBytes(host?.rssBytes),
        tone: toneForLevel(indicatorLevels['host-rss-pct']),
        sub:
          host == null
            ? ''
            : t('perf.metric.hostSubDesc', {
                pct: formatPct(hostPct),
                heap: formatBytes(host.heapUsedBytes),
                external: formatBytes(host.externalBytes),
              }),
      },
      {
        key: 'system',
        label: t('perf.metric.systemLabel'),
        value: system?.usedPct == null ? '—' : `${formatPct(system.usedPct)}%`,
        tone: toneForLevel(indicatorLevels['system-used-pct']),
        error: systemError,
        sub:
          system == null || full?.baseline == null
            ? ''
            : t('perf.metric.systemSubDesc', {
                free: formatBytes(
                  Math.max(0, system.totalBytes * (1 - (system.usedPct ?? 0) / 100)),
                ),
                baseline: formatBytes(full.baseline.totalBytes),
              }),
      },
      {
        key: 'event-loop',
        label: t('perf.metric.eventLoopLabel'),
        value: formatMs(eventLoop?.smoothedMaxDelayMs),
        tone: toneForLevel(indicatorLevels['event-loop-delay-ms']),
        sub: eventLoop == null ? '' : t('perf.metric.eventLoopSubDesc', { ms: formatMs(eventLoop.maxDelayMs) }),
      },
      {
        key: 'cpu',
        label: t('perf.metric.cpuLabel'),
        value: host?.cpuPct == null ? '—' : `${formatPct(host.cpuPct)}%`,
        tone: '',
        sub:
          host == null
            ? ''
            : t('perf.metric.cpuSubDesc', {
                peak: host.cpuPeakPct == null ? '—' : `${formatPct(host.cpuPeakPct)}%`,
                cores: full?.baseline?.cpuCores ?? '—',
              }),
      },
    ]
  }, [summary, full, indicatorLevels, hostPct, systemError, t])

  // 子进程聚合（full 快照 pid 明细；无 full 时仅计数行）。
  const kindAggregates = useMemo(
    () => aggregateChildrenByKind(full?.childrenEntries ?? [], t),
    [full, t],
  )
  const childrenTotalBytes = kindAggregates.reduce((sum, item) => sum + item.rssBytes, 0)

  return (
    <div>
      {/* 状态行 */}
      <div className="status-line">
        <span
          className={`dot ${loading ? '' : 'pulse'}`}
          style={{ background: loading ? 'var(--text-faint)' : levelMeta.colorVar }}
        />
        <span className="status-level">{loading ? t('perf.status.reading') : levelMeta.name}</span>
        <span className="status-desc">
          {loading ? t('perf.status.collecting') : pressureActionCopy(level, t)}
        </span>
        <span className="status-right">
          <span className="status-upd">
            {t('perf.status.lastUpdated', { time: formatClock(summary?.sampledAt) })}
          </span>
          <button
            className={`icon-btn ${refreshing ? 'spin' : ''}`}
            title={t('perf.status.refreshTitle')}
            onClick={onRefresh}
            disabled={loading}
          >
            <RefreshCw size={13} />
          </button>
        </span>
      </div>

      {/* 指标网格 */}
      <div className="metric-grid">
        {metricDefs.map((metric) => (
          <div className="metric" key={metric.key}>
            <span className="m-label">{metric.label}</span>
            {loading ? (
              <>
                <span className="sk" style={{ width: 76, height: 20, margin: '3px 0 2px' }} />
                <span className="sk" style={{ width: '88%', height: 10 }} />
              </>
            ) : metric.error ? (
              <>
                <span className="m-value is-muted">—</span>
                <span className="m-sub">
                  <span className="err">
                    <Activity size={11} /> {t('perf.metric.collectFailedError')}
                  </span>
                </span>
              </>
            ) : (
              <>
                <span className={`m-value ${metric.tone}`}>{metric.value}</span>
                {metric.sub != null && <span className="m-sub">{metric.sub}</span>}
              </>
            )}
          </div>
        ))}
      </div>

      {/* 子进程卡 */}
      <div className={`card proc-card ${procOpen ? 'open' : ''}`}>
        <button className="proc-toggle" onClick={() => setProcOpen((open) => !open)}>
          <span className="r-title">{t('perf.children.title')}</span>
          <span className="r-desc" style={{ marginTop: 0 }}>
            {kindAggregates.length > 0
              ? kindAggregates
                  .slice(0, 4)
                  .map((item) => `${item.label} ${item.count}`)
                  .join(' · ')
              : t('perf.children.none')}
          </span>
          <span className="proc-sum">
            {loading
              ? '—'
              : t('perf.children.summary', {
                  count: summary?.children.totalCount ?? 0,
                  governed: summary?.children.governedCount ?? 0,
                  rss: formatBytes(summary?.children.totalRssBytes),
                })}
          </span>
          <span className="chev">
            <ChevronDown size={13} />
          </span>
        </button>
        {procOpen && !loading && (
          <div className="proc-detail">
            {childrenError && (
              <div className="m-sub" style={{ marginBottom: 4 }}>
                <span className="err">
                  <Activity size={11} /> {t('perf.children.collectFailedError')}
                </span>
              </div>
            )}
            {kindAggregates.length === 0 ? (
              <div className="ev-empty">{t('perf.children.emptyDesc')}</div>
            ) : (
              <>
                <div className="stack">
                  {kindAggregates.map((item, index) => (
                    <span
                      key={item.kind}
                      style={{
                        width: `${childrenTotalBytes > 0 ? (item.rssBytes / childrenTotalBytes) * 100 : 0}%`,
                        background: `color-mix(in srgb, var(--primary) ${[100, 60, 36, 18, 10][Math.min(index, 4)]}%, transparent)`,
                      }}
                    />
                  ))}
                </div>
                {kindAggregates.map((item, index) => (
                  <div className="bd-row" key={item.kind}>
                    <span
                      className="bd-dot"
                      style={{
                        background: `color-mix(in srgb, var(--primary) ${[100, 60, 36, 18, 10][Math.min(index, 4)]}%, transparent)`,
                      }}
                    />
                    <span className="bd-n">{item.label}</span>
                    <span>{t('perf.unit.count', { value: item.count })}</span>
                    <span className="bd-v">{formatBytes(item.rssBytes)}</span>
                  </div>
                ))}
                <div
                  style={{
                    marginTop: 6,
                    paddingTop: 8,
                    borderTop: '1px solid color-mix(in srgb, var(--divider) 60%, transparent)',
                    fontSize: 10.5,
                    lineHeight: 1.5,
                    color: 'var(--text-faint)',
                  }}
                >
                  {t('perf.children.policyLongDesc', {
                    governed: summary?.children.governedCount ?? 0,
                  })}
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

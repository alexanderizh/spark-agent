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
import {
  PRESSURE_LEVEL_META,
  aggregateChildrenByKind,
  formatBytes,
  formatClock,
  formatMs,
  formatPct,
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
  const [procOpen, setProcOpen] = useState(false)

  const level = summary?.pressure.level ?? 'nominal'
  const levelMeta = PRESSURE_LEVEL_META[level]
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
        label: '宿主内存（RSS）',
        value: formatBytes(host?.rssBytes),
        tone: toneForLevel(indicatorLevels['host-rss-pct']),
        sub:
          host == null
            ? ''
            : `占基线 ${formatPct(hostPct)}% · 堆 ${formatBytes(host.heapUsedBytes)} · 外部 ${formatBytes(host.externalBytes)}`,
      },
      {
        key: 'system',
        label: '系统内存',
        value: system?.usedPct == null ? '—' : `${formatPct(system.usedPct)}%`,
        tone: toneForLevel(indicatorLevels['system-used-pct']),
        error: systemError,
        sub:
          system == null || full?.baseline == null
            ? ''
            : `剩余 ${formatBytes(Math.max(0, system.totalBytes * (1 - (system.usedPct ?? 0) / 100)))} · 基线 ${formatBytes(full.baseline.totalBytes)}`,
      },
      {
        key: 'event-loop',
        label: '事件循环延迟',
        value: formatMs(eventLoop?.smoothedMaxDelayMs),
        tone: toneForLevel(indicatorLevels['event-loop-delay-ms']),
        sub: eventLoop == null ? '' : `峰值 ${formatMs(eventLoop.maxDelayMs)}`,
      },
      {
        key: 'cpu',
        label: 'CPU 占用',
        value: host?.cpuPct == null ? '—' : `${formatPct(host.cpuPct)}%`,
        tone: '',
        sub:
          host == null
            ? ''
            : `峰值 ${host.cpuPeakPct == null ? '—' : `${formatPct(host.cpuPeakPct)}%`} · ${full?.baseline?.cpuCores ?? '—'} 逻辑核`,
      },
    ]
  }, [summary, full, indicatorLevels, hostPct, systemError])

  // 子进程聚合（full 快照 pid 明细；无 full 时仅计数行）。
  const kindAggregates = useMemo(() => aggregateChildrenByKind(full?.childrenEntries ?? []), [full])
  const childrenTotalBytes = kindAggregates.reduce((sum, item) => sum + item.rssBytes, 0)

  return (
    <div>
      {/* 状态行 */}
      <div className="status-line">
        <span
          className={`dot ${loading ? '' : 'pulse'}`}
          style={{ background: loading ? 'var(--text-faint)' : levelMeta.colorVar }}
        />
        <span className="status-level">{loading ? '读取中…' : levelMeta.name}</span>
        <span className="status-desc">
          {loading ? '正在采集资源指标' : pressureActionCopy(level)}
        </span>
        <span className="status-right">
          <span className="status-upd">最后更新 {formatClock(summary?.sampledAt)}</span>
          <button
            className={`icon-btn ${refreshing ? 'spin' : ''}`}
            title="刷新"
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
                    <Activity size={11} /> 采集失败 · 自动重试中
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
          <span className="r-title">子进程</span>
          <span className="r-desc" style={{ marginTop: 0 }}>
            {kindAggregates.length > 0
              ? kindAggregates
                  .slice(0, 4)
                  .map((item) => `${item.label} ${item.count}`)
                  .join(' · ')
              : '暂无明细'}
          </span>
          <span className="proc-sum">
            {loading
              ? '—'
              : `${summary?.children.totalCount ?? 0} 个 · 治理口径 ${summary?.children.governedCount ?? 0} 个 · ${formatBytes(summary?.children.totalRssBytes)}`}
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
                  <Activity size={11} /> 子进程采集暂时失败，以下为最近一次成功扫描结果
                </span>
              </div>
            )}
            {kindAggregates.length === 0 ? (
              <div className="ev-empty">暂无子进程明细 · 打开 Agent 会话后开始追踪</div>
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
                    <span>{item.count} 个</span>
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
                  治理口径 {summary?.children.governedCount ?? 0} 个 = claude / codex 家族（含 CLI
                  内部子代理）；MCP 桥与常驻池不计入压力判定，仅诊断展示。
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

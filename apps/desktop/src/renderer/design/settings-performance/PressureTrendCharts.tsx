/**
 * @module PressureTrendCharts
 *
 * 历史趋势（M3）：三张自绘 SVG 小图——宿主内存（RSS，线 + 阈值虚线）、
 * 系统内存占用率（线 + 阈值虚线）、子进程数（柱）。无图表库依赖，
 * 视觉对齐已审设计稿（网格线 / 阈值虚线 / 末端点 / hover 竖线 + tooltip）。
 *
 * 阈值虚线：pct 阈值 × 基线换算成 MB 画线（bytes 仅展示语义，§3.3.2）。
 */

import { useMemo, useRef, useState } from 'react'
import type { ResourceMetricsHistoryPoint, ThresholdSnapshot } from '@spark/protocol'
import { formatBytes } from './performance-format'

const VIEW_W = 600
const VIEW_H = 64

interface PressureTrendChartsProps {
  points: ResourceMetricsHistoryPoint[]
  thresholds: ThresholdSnapshot | null
  rangeMinutes: number
  loading: boolean
}

type ChartKind = 'line' | 'bar'

interface ChartSpec {
  id: 'host' | 'sys' | 'proc'
  label: string
  kind: ChartKind
  /** 数值序列（空数组 = 无数据）。 */
  values: number[]
  /** 与 values 等长的采样时间（tooltip 显示；系统内存缺测点被过滤后由 filterTimes 对齐）。 */
  times: string[]
  format: (value: number) => string
  /** 阈值虚线（值域单位）；空 = 不画。 */
  thresholdLines: Array<{ value: number; color: string }>
  /** y 轴下界钳制（柱状图从 0 起）。 */
  zeroBased: boolean
}

function niceRange(values: number[], zeroBased: boolean): { lo: number; hi: number } {
  let lo = Math.min(...values)
  const hi = Math.max(...values)
  if (zeroBased) lo = Math.min(lo, 0)
  const pad = (hi - lo) * 0.12 || 1
  return { lo: lo - pad, hi: hi + pad * 0.6 }
}

export function PressureTrendCharts({
  points,
  thresholds,
  rangeMinutes,
  loading,
}: PressureTrendChartsProps) {
  const hostThresholds = thresholds?.entries?.['host-rss-pct'] ?? null
  const sysThresholds = thresholds?.entries?.['system-used-pct'] ?? null
  const baselineTotalBytes = thresholds?.baseline?.totalBytes ?? null

  const specs = useMemo<ChartSpec[]>(() => {
    const allTimes = points.map((p) => p.sampledAt)
    const hostValues = points.map((p) => p.hostRssBytes / (1024 * 1024))
    const sysPairs = points
      .map((p) => ({ time: p.sampledAt, value: p.systemUsedPct }))
      .filter((pair): pair is { time: string; value: number } => pair.value != null)
    const procValues = points.map((p) => p.childrenCount)
    const pctToMb = (pct: number): number =>
      ((pct / 100) * (baselineTotalBytes ?? 0)) / (1024 * 1024)
    return [
      {
        id: 'host',
        label: '宿主内存（RSS）',
        kind: 'line',
        values: hostValues,
        times: allTimes,
        format: (v) => formatBytes(v * 1024 * 1024),
        thresholdLines:
          hostThresholds != null && baselineTotalBytes != null
            ? [
                { value: pctToMb(hostThresholds.warning.pct), color: 'var(--warning)' },
                { value: pctToMb(hostThresholds.critical.pct), color: 'var(--perf-critical)' },
                { value: pctToMb(hostThresholds.emergency.pct), color: 'var(--danger)' },
              ]
            : [],
        zeroBased: false,
      },
      {
        id: 'sys',
        label: '系统内存占用率',
        kind: 'line',
        values: sysPairs.map((pair) => pair.value),
        times: sysPairs.map((pair) => pair.time),
        format: (v) => `${Math.round(v)}%`,
        thresholdLines:
          sysThresholds != null
            ? [
                { value: sysThresholds.warning.pct, color: 'var(--warning)' },
                { value: sysThresholds.critical.pct, color: 'var(--perf-critical)' },
                { value: sysThresholds.emergency.pct, color: 'var(--danger)' },
              ]
            : [],
        zeroBased: false,
      },
      {
        id: 'proc',
        label: '子进程数（全量）',
        kind: 'bar',
        values: procValues,
        times: allTimes,
        format: (v) => `${Math.round(v)}`,
        thresholdLines: [],
        zeroBased: true,
      },
    ]
  }, [points, hostThresholds, sysThresholds, baselineTotalBytes])

  return (
    <div className="trend-grid">
      {specs.map((spec) => (
        <TrendChart key={spec.id} spec={spec} loading={loading} rangeMinutes={rangeMinutes} />
      ))}
    </div>
  )
}

function TrendChart({
  spec,
  loading,
  rangeMinutes,
}: {
  spec: ChartSpec
  loading: boolean
  rangeMinutes: number
}) {
  const bodyRef = useRef<HTMLDivElement | null>(null)
  const [hover, setHover] = useState<{ x: number; width: number; index: number } | null>(null)

  const { lo, hi } = useMemo(
    () => (spec.values.length > 0 ? niceRange(spec.values, spec.zeroBased) : { lo: 0, hi: 1 }),
    [spec.values, spec.zeroBased],
  )

  const y = (value: number): number => VIEW_H - ((value - lo) / (hi - lo)) * VIEW_H
  const x = (index: number): number => (index / Math.max(1, spec.values.length - 1)) * VIEW_W

  const lastIndex = spec.values.length - 1
  const last = lastIndex >= 0 ? spec.values[lastIndex] : null

  const linePath = spec.values
    .map((v, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(v).toFixed(1)}`)
    .join(' ')
  const areaPath =
    spec.values.length > 0
      ? `M0,${VIEW_H} ${spec.values.map((v, i) => `L${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ')} L${VIEW_W},${VIEW_H} Z`
      : ''

  const handleMove = (event: React.MouseEvent<HTMLDivElement>): void => {
    if (bodyRef.current == null || spec.values.length === 0) return
    const rect = bodyRef.current.getBoundingClientRect()
    const ratio = Math.min(Math.max((event.clientX - rect.left) / rect.width, 0), 1)
    const index = Math.round(ratio * (spec.values.length - 1))
    // width 随事件捕获，渲染期零 ref 访问（react-hooks/refs）。
    setHover({ x: ratio * rect.width, width: rect.width, index })
  }

  const hoverTimeLabel = useMemo(() => {
    if (hover == null) return ''
    const sampledAt = spec.times[hover.index]
    if (sampledAt == null) return ''
    const date = new Date(sampledAt)
    if (Number.isNaN(date.getTime())) return ''
    const two = (n: number): string => String(n).padStart(2, '0')
    return `${two(date.getHours())}:${two(date.getMinutes())}`
  }, [hover, spec.times])

  return (
    <div className="chart">
      <div className="chart-head">
        <span className="c-label">{spec.label}</span>
        {loading ? (
          <span className="sk" style={{ width: 48, height: 12 }} />
        ) : (
          <span className="c-val">{last == null ? '—' : spec.format(last)}</span>
        )}
      </div>
      <div
        className="chart-body"
        ref={bodyRef}
        onMouseMove={handleMove}
        onMouseLeave={() => setHover(null)}
      >
        {loading ? (
          <span
            className="sk"
            style={{ position: 'absolute', inset: 0, height: 64, borderRadius: 4 }}
          />
        ) : spec.values.length === 0 ? (
          <div className="ev-empty" style={{ lineHeight: '64px', padding: 0 }}>
            暂无趋势数据
          </div>
        ) : (
          <>
            <svg viewBox={`0 0 ${VIEW_W} ${VIEW_H}`} preserveAspectRatio="none">
              {[0.25, 0.5, 0.75].map((g) => (
                <line
                  key={g}
                  x1={0}
                  y1={VIEW_H * g}
                  x2={VIEW_W}
                  y2={VIEW_H * g}
                  style={{ stroke: 'var(--divider)', strokeWidth: 1 }}
                  vectorEffect="non-scaling-stroke"
                />
              ))}
              {spec.thresholdLines.map((line, index) =>
                // 两档阈值可被用户调成同值：key 加索引去重，避免重复 key 告警与错位渲染。
                line.value > lo && line.value < hi ? (
                  <line
                    key={`${line.value}-${index}`}
                    x1={0}
                    y1={y(line.value)}
                    x2={VIEW_W}
                    y2={y(line.value)}
                    style={{
                      stroke: line.color,
                      strokeWidth: 1,
                      strokeDasharray: '3 4',
                      opacity: 0.75,
                    }}
                    vectorEffect="non-scaling-stroke"
                  />
                ) : null,
              )}
              {spec.kind === 'line' ? (
                <>
                  <path d={areaPath} style={{ fill: 'var(--primary)', fillOpacity: 0.08 }} />
                  <path
                    d={linePath}
                    style={{
                      fill: 'none',
                      stroke: 'var(--primary)',
                      strokeWidth: 1.5,
                      strokeLinejoin: 'round',
                    }}
                    vectorEffect="non-scaling-stroke"
                  />
                </>
              ) : (
                spec.values.map((v, i) => {
                  const bw = (VIEW_W / spec.values.length) * 0.58
                  const yy = y(v)
                  return (
                    <rect
                      key={i}
                      x={x(i) - bw / 2}
                      y={yy}
                      width={bw}
                      height={Math.max(1, VIEW_H - yy)}
                      rx={1}
                      style={{
                        fill:
                          i === lastIndex
                            ? 'var(--primary)'
                            : 'color-mix(in srgb, var(--text) 30%, transparent)',
                      }}
                    />
                  )
                })
              )}
            </svg>
            {last != null && (
              <span
                className="last-dot"
                style={{
                  top: `${((VIEW_H - y(last)) / VIEW_H) * 100}%`,
                  background: 'var(--primary)',
                }}
              />
            )}
            <span className="y-lab top">{spec.format(hi)}</span>
            <span className="y-lab btm">{spec.format(lo)}</span>
            {hover != null && (
              <>
                <span className="hover-vline" style={{ display: 'block', left: hover.x }} />
                <span
                  className="chart-tip"
                  style={{
                    display: 'block',
                    left: Math.min(Math.max(hover.x, 40), Math.max(hover.width - 40, 40)),
                    top: 8,
                  }}
                >
                  {spec.values[hover.index] != null
                    ? spec.format(spec.values[hover.index] as number)
                    : '—'}
                  {hoverTimeLabel !== '' ? ` · ${hoverTimeLabel}` : ''}
                </span>
              </>
            )}
          </>
        )}
      </div>
      <div className="chart-x">
        <span>-{rangeMinutes} 分钟</span>
        <span>现在</span>
      </div>
    </div>
  )
}

/**
 * @module GovernanceMeters
 *
 * 活动治理（M3）：并发闸门占用表。真实数据结构为 dispatch-governor
 * 双池（主池 + 嵌套池），据此呈现两行占用 + 宿主在途计数；降级状态
 * pill 由当前压力级别推导（warning 限流 / critical 暂停 / emergency 熔断）。
 */

import type {
  DispatchGovernorGetDiagnosticsResponse,
  ResourceMonitorSummarySnapshot,
} from '@spark/protocol'
import { PRESSURE_LEVEL_META } from './performance-format'

interface GovernanceMetersProps {
  diagnostics: DispatchGovernorGetDiagnosticsResponse | null
  summary: ResourceMonitorSummarySnapshot | null
  loading: boolean
}

interface MeterRow {
  key: string
  name: string
  inUse: number
  capacity: number
  waiting: number
}

function statePillForLevel(
  level: ResourceMonitorSummarySnapshot['pressure']['level'],
): { text: string; cls: string } | null {
  switch (level) {
    case 'warning':
      return { text: '限流中', cls: 'warn' }
    case 'critical':
      return { text: '已暂停派发', cls: 'danger' }
    case 'emergency':
      return { text: '已熔断', cls: 'danger' }
    default:
      return null
  }
}

export function GovernanceMeters({ diagnostics, summary, loading }: GovernanceMetersProps) {
  const snapshot = diagnostics?.diagnostics ?? null
  const level = summary?.pressure.level ?? 'nominal'
  const pill = statePillForLevel(level)
  const levelMeta = PRESSURE_LEVEL_META[level]

  const rows: MeterRow[] =
    snapshot == null
      ? []
      : [
          {
            key: 'main',
            name: 'Agent 派发（主池）',
            inUse: snapshot.mainInUse,
            capacity: snapshot.mainCapacity,
            waiting: snapshot.mainWaiting,
          },
          {
            key: 'nested',
            name: '嵌套派发（防死锁池）',
            inUse: snapshot.nestedInUse,
            capacity: snapshot.nestedSlots,
            waiting: snapshot.nestedWaiting,
          },
        ]

  if (loading) {
    return (
      <div className="card">
        {[0, 1].map((i) => (
          <div className="meter-row" key={i}>
            <span className="sk" style={{ width: 120, height: 13 }} />
            <span className="m-track">
              <span
                className="sk"
                style={{ display: 'block', height: '100%', width: `${40 + i * 20}%` }}
              />
            </span>
            <span className="sk" style={{ width: 92, height: 12 }} />
          </div>
        ))}
      </div>
    )
  }

  if (snapshot == null) {
    return (
      <div className="card">
        <div className="ev-empty">闸门诊断不可用（governor 尚未创建或已停用）</div>
      </div>
    )
  }

  if (!snapshot.enabled) {
    return (
      <div className="card">
        <div className="ev-empty">并发闸门已停用（governance.enabled=false）</div>
      </div>
    )
  }

  return (
    <div className="card">
      {rows.map((row) => {
        const pct = row.capacity > 0 ? Math.min((row.inUse / row.capacity) * 100, 100) : 0
        const degraded = level === 'critical' || level === 'emergency'
        return (
          <div className="meter-row" key={row.key}>
            <span className="m-name">{row.name}</span>
            <span className="m-track">
              <span className={`m-fill ${degraded ? 'paused' : ''}`} style={{ width: `${pct}%` }} />
            </span>
            <span className="m-nums">
              {row.inUse}/{row.capacity} 运行
              {row.waiting > 0 ? (
                <>
                  {' · '}
                  <b>{row.waiting}</b> 排队
                </>
              ) : (
                <>
                  {' · '}
                  <span className="q">0 排队</span>
                </>
              )}
            </span>
          </div>
        )
      })}
      <div className="meter-row" style={{ paddingTop: 8 }}>
        <span className="m-sub" style={{ flex: 1 }}>
          宿主在途 {snapshot.hostEffectiveCount}（上限 {snapshot.config.hostInflightCap}）·
          全局并发预算 {snapshot.config.totalAgentProcessBudget} · 状态
        </span>
        {pill != null ? (
          <span className={`state-pill ${pill.cls === 'warn' ? 'warn' : 'danger'}`}>
            {pill.text}
          </span>
        ) : (
          <span
            className="state-pill"
            style={{
              color: levelMeta.colorVar,
              background: 'color-mix(in srgb, currentColor 11%, transparent)',
            }}
          >
            正常调度
          </span>
        )}
      </div>
    </div>
  )
}

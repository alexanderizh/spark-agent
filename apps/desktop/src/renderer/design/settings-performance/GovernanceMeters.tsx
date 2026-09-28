/**
 * @module GovernanceMeters
 *
 * 活动治理（M3）：并发闸门占用表。真实数据结构为 dispatch-governor
 * 双池（主池 + 嵌套池），两行只统计成员派发（团队 / 工作流子代理），
 * 宿主会话不占槽位、仅计入主池预算；底部口径行区分「运行中会话」与
 * 「计入并发预算的宿主占用」。降级状态 pill 由当前压力级别推导
 * （warning 限流 / critical 暂停 / emergency 熔断）。
 */

import type {
  DispatchGovernorDiagnosticsSnapshot,
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

/**
 * 底部口径行全文（悬停说明）。
 * 「运行中会话」取自 turnRegistry 的活动执行器 + starting 过渡态采样；
 * 「宿主封顶」= hostInflightCap，超出部分不再计入主池容量（主池容量 =
 * 全局并发预算 − 计入的宿主占用，再取成员侧硬顶 maxMemberDispatches）。
 */
const HOST_USAGE_HINT =
  '运行中会话：正在执行本轮任务的会话数（含即将开始的过渡态）。' +
  '宿主封顶：宿主会话占用计入主池的上限，超出部分不再占用主池；' +
  '主池容量 = 全局并发预算 − 计入的宿主占用，再取成员侧硬顶。' +
  '数据为诊断快照：打开页面、每 30 秒、压力级别变更时刷新。'

/**
 * 底部口径行文本：区分「真实运行中会话数」与「计入主池预算的宿主占用」。
 * 二者在未触顶时相等；触顶（宿主封顶或预算 − 成员下限预留）时如实标出差额，
 * 避免把被截断后的占用误读为会话数（旧文案称「宿主在途」且只显示截断值）。
 */
function hostUsageText(snapshot: DispatchGovernorDiagnosticsSnapshot): string {
  const inflight = snapshot.hostInflightCount
  const effective = snapshot.hostEffectiveCount
  const cap = snapshot.config.hostInflightCap
  const budget = snapshot.config.totalAgentProcessBudget
  const head =
    inflight > effective
      ? `运行中会话 ${inflight} · 计入并发预算 ${effective}（宿主封顶 ${cap}）`
      : `运行中会话 ${inflight}（全部计入并发预算）`
  return `${head} · 全局并发预算 ${budget}`
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
            name: '成员派发（主池）',
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
        <div className="ev-empty">暂无闸门运行数据（将在首次任务派发后显示）</div>
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
        <span className="m-sub" style={{ flex: 1 }} title={HOST_USAGE_HINT}>
          {hostUsageText(snapshot)} · 状态
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

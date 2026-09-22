/**
 * @module PerformanceConfigPanel
 *
 * 性能保护配置（M3）：监控/保护开关、并发上限步进、压力阈值矩阵
 * （百分比双形式展示 + 事件循环毫秒 + 子进程数治理口径）、恢复默认。
 *
 * 数据流：初始值 ← full 快照 runtimeConfig / workflowGovernance / 诊断回显
 * （生效态单一事实源）；写入 → settings:set performance.data（主进程热更新
 * 即时灌注 monitor/governor/workflow，方案 §六）。渲染层只持有编辑态，
 * 不做判定逻辑——判定与钳制以主进程归一化为准。
 */

import { useMemo, useState } from 'react'
import { Switch } from 'antd'
import { Minus, Plus } from 'lucide-react'
import type {
  DispatchGovernorGetDiagnosticsResponse,
  PressureLevelTripleNumbers,
  ResourceMonitorFullSnapshot,
} from '@spark/protocol'
import { clampNumber, formatBytes, PRESSURE_LEVEL_META } from './performance-format'

interface PerformanceConfigPanelProps {
  full: ResourceMonitorFullSnapshot | null
  diagnostics: DispatchGovernorGetDiagnosticsResponse | null
  onUpdateSettings: (mutate: (draft: Record<string, unknown>) => void) => Promise<void>
}

/* 参数边界（与 agent-runtime 权威常量对齐；渲染层仅用于步进交互约束）。 */
const RANGES = {
  totalAgentProcessBudget: { min: 4, max: 32, step: 1 },
  maxMemberDispatches: { min: 1, max: 32, step: 1 },
  waveWidth: { min: 1, max: 16, step: 1 },
  fanoutClamp: { min: 1, max: 8, step: 1 },
  hostRssPct: { min: 5, max: 100, step: 1 },
  systemUsedPct: { min: 50, max: 99, step: 1 },
  eventLoopDelayMs: { min: 50, max: 3000, step: 50 },
  childrenCount: { min: 4, max: 256, step: 2 },
} as const

interface TripleSpec {
  key: 'hostRssPct' | 'systemUsedPct' | 'eventLoopDelayMs'
  label: string
  unit: string
  range: { min: number; max: number; step: number }
  /** 双形式展示（§3.3.6）：百分比 × 基线 → GB 附注。 */
  showGbEquivalent: boolean
}

const TRIPLE_SPECS: readonly TripleSpec[] = [
  {
    key: 'hostRssPct',
    label: '宿主内存',
    unit: ' %',
    range: RANGES.hostRssPct,
    showGbEquivalent: true,
  },
  {
    key: 'systemUsedPct',
    label: '系统内存',
    unit: ' %',
    range: RANGES.systemUsedPct,
    showGbEquivalent: true,
  },
  {
    key: 'eventLoopDelayMs',
    label: '事件循环',
    unit: ' ms',
    range: RANGES.eventLoopDelayMs,
    showGbEquivalent: false,
  },
]

const LEVEL_ROWS: ReadonlyArray<{ level: 'warning' | 'critical' | 'emergency'; desc: string }> = [
  { level: 'warning', desc: '静默限流新任务，不弹通知' },
  { level: 'critical', desc: '暂停新派发，不弹通知' },
  { level: 'emergency', desc: '暂停全部新任务，即将溢出时弹通知' },
]

interface PanelState {
  monitorEnabled: boolean
  governanceEnabled: boolean
  totalAgentProcessBudget: number
  maxMemberDispatches: number
  waveWidth: number
  hostRssPct: PressureLevelTripleNumbers
  systemUsedPct: PressureLevelTripleNumbers
  eventLoopDelayMs: PressureLevelTripleNumbers
  childrenCount: {
    mode: 'auto' | 'manual'
    manual: PressureLevelTripleNumbers | null
    derived: PressureLevelTripleNumbers | null
  }
}

function readPanelState(
  full: ResourceMonitorFullSnapshot | null,
  diagnostics: DispatchGovernorGetDiagnosticsResponse | null,
): PanelState {
  const runtime = full?.runtimeConfig ?? null
  const thresholds = runtime?.thresholds
  return {
    monitorEnabled: runtime?.monitorEnabled ?? full?.monitorEnabled ?? true,
    governanceEnabled: diagnostics?.diagnostics?.enabled ?? true,
    totalAgentProcessBudget: diagnostics?.diagnostics?.config.totalAgentProcessBudget ?? 8,
    maxMemberDispatches: diagnostics?.diagnostics?.config.maxMemberDispatches ?? 6,
    waveWidth: full?.workflowGovernance?.waveWidth ?? 4,
    // 回退字面量须与 monitor-config 的 DEFAULT_PRESSURE_THRESHOLDS 保持一致
    // （渲染层不依赖 agent-runtime，只能字面量兜底；运行时快照缺才走这里）。
    hostRssPct: thresholds?.hostRssPct ?? { warning: 45, critical: 60, emergency: 75 },
    systemUsedPct: thresholds?.systemUsedPct ?? { warning: 90, critical: 94, emergency: 97 },
    eventLoopDelayMs: thresholds?.eventLoopDelayMs ?? {
      warning: 300,
      critical: 600,
      emergency: 1200,
    },
    childrenCount: thresholds?.childrenCount ?? { mode: 'auto', manual: null, derived: null },
  }
}

export function PerformanceConfigPanel({
  full,
  diagnostics,
  onUpdateSettings,
}: PerformanceConfigPanelProps) {
  // 编辑态仅初始化一次；父层在刷新 / 恢复默认后以 key={echoVersion} 重挂载取新回显。
  const [state, setState] = useState<PanelState>(() => readPanelState(full, diagnostics))

  const baselineTotalBytes = full?.baseline?.totalBytes ?? null
  const cores = full?.baseline?.cpuCores ?? null

  const gbEquivalent = useMemo(
    () =>
      (pct: number): string =>
        baselineTotalBytes == null ? '' : ` ≈ ${formatBytes((pct / 100) * baselineTotalBytes)}`,
    [baselineTotalBytes],
  )

  /* ─── 写入辅助 ─────────────────────────────────────────────────────────── */

  const writeMonitorEnabled = async (enabled: boolean): Promise<void> => {
    setState((s) => ({ ...s, monitorEnabled: enabled }))
    await onUpdateSettings((draft) => {
      draft.monitor = { ...((draft.monitor as object) ?? {}), enabled }
    })
  }

  const writeGovernanceEnabled = async (enabled: boolean): Promise<void> => {
    setState((s) => ({ ...s, governanceEnabled: enabled }))
    await onUpdateSettings((draft) => {
      draft.governance = { ...((draft.governance as object) ?? {}), enabled }
    })
  }

  const writeGovernanceCap = async (
    key: 'totalAgentProcessBudget' | 'maxMemberDispatches',
    value: number,
  ): Promise<void> => {
    // 与其他 write* 一致：先更新本地编辑态，否则步进器显示冻结且连续步进基于过期值。
    setState((s) => ({ ...s, [key]: value }))
    await onUpdateSettings((draft) => {
      draft.governance = { ...((draft.governance as object) ?? {}), [key]: value }
    })
  }

  const writeWorkflowCap = async (key: 'waveWidth', value: number): Promise<void> => {
    setState((s) => ({ ...s, [key]: value }))
    await onUpdateSettings((draft) => {
      draft.workflow = { ...((draft.workflow as object) ?? {}), [key]: value }
    })
  }

  const writeThresholdTriple = async (
    key: TripleSpec['key'],
    level: 'warning' | 'critical' | 'emergency',
    value: number,
  ): Promise<void> => {
    setState((s) => ({ ...s, [key]: { ...s[key], [level]: value } }))
    await onUpdateSettings((draft) => {
      const thresholds = (draft.thresholds as Record<string, unknown>) ?? {}
      const triple = (thresholds[key] as Record<string, unknown>) ?? {}
      thresholds[key] = { ...triple, [level]: value }
      draft.thresholds = thresholds
    })
  }

  const writeChildrenCountManual = async (
    level: 'warning' | 'critical' | 'emergency',
    value: number,
  ): Promise<void> => {
    setState((s) => {
      const base = s.childrenCount.manual ??
        s.childrenCount.derived ?? { warning: 80, critical: 128, emergency: 160 }
      return {
        ...s,
        childrenCount: {
          mode: 'manual',
          manual: { ...base, [level]: value },
          derived: s.childrenCount.derived,
        },
      }
    })
    await onUpdateSettings((draft) => {
      const thresholds = (draft.thresholds as Record<string, unknown>) ?? {}
      const cc = (thresholds.childrenCount as Record<string, unknown>) ?? {}
      const manualBase = (cc.manual as Record<string, unknown>) ??
        (full?.runtimeConfig?.thresholds.childrenCount.derived as Record<
          string,
          unknown
        > | null) ?? { warning: 80, critical: 128, emergency: 160 }
      thresholds.childrenCount = {
        ...cc,
        mode: 'manual',
        manual: { ...manualBase, [level]: value },
      }
      draft.thresholds = thresholds
    })
  }

  const restoreChildrenAuto = async (): Promise<void> => {
    setState((s) => ({
      ...s,
      childrenCount: { mode: 'auto', manual: null, derived: s.childrenCount.derived },
    }))
    await onUpdateSettings((draft) => {
      const thresholds = (draft.thresholds as Record<string, unknown>) ?? {}
      const cc = (thresholds.childrenCount as Record<string, unknown>) ?? {}
      thresholds.childrenCount = { ...cc, mode: 'auto', manual: null }
      draft.thresholds = thresholds
    })
  }

  /* ─── 渲染 ─────────────────────────────────────────────────────────────── */

  return (
    <div className="card">
      {/* 总开关 */}
      <div className="rowline">
        <div className="r-main">
          <div className="r-title">性能监控</div>
          <div className="r-desc">
            实时采集宿主与子进程资源指标（2 秒采样，仅本地保存）；关闭后不再采样与推送。
          </div>
        </div>
        <div className="r-act">
          <Switch
            size="small"
            checked={state.monitorEnabled}
            onChange={(checked) => void writeMonitorEnabled(checked)}
          />
        </div>
      </div>
      <div className="rowline">
        <div className="r-main">
          <div className="r-title">自动降级保护</div>
          <div className="r-desc">
            资源压力过高时自动限制并发任务，防止应用与系统无响应；关闭后不再自动降级（监控与展示不受影响）。
          </div>
        </div>
        <div className="r-act">
          <Switch
            size="small"
            checked={state.governanceEnabled}
            onChange={(checked) => void writeGovernanceEnabled(checked)}
          />
        </div>
      </div>

      <div className={state.governanceEnabled ? undefined : 'disabled-zone'}>
        {/* 并发上限 */}
        <div className="rowline">
          <div className="r-main">
            <div className="r-title">并发上限</div>
            <div className="r-desc">同时运行的任务数上限，超出部分进入排队，空闲后按顺序启动。</div>
          </div>
          <div className="cap-steps">
            <span className="th-step">
              <span>全局预算</span>
              <Stepper
                value={state.totalAgentProcessBudget}
                unit=""
                min={RANGES.totalAgentProcessBudget.min}
                max={RANGES.totalAgentProcessBudget.max}
                step={RANGES.totalAgentProcessBudget.step}
                onChange={(v) => void writeGovernanceCap('totalAgentProcessBudget', v)}
              />
            </span>
            <span className="th-step">
              <span>成员派发</span>
              <Stepper
                value={state.maxMemberDispatches}
                unit=""
                min={RANGES.maxMemberDispatches.min}
                max={RANGES.maxMemberDispatches.max}
                step={RANGES.maxMemberDispatches.step}
                onChange={(v) => void writeGovernanceCap('maxMemberDispatches', v)}
              />
            </span>
            <span className="th-step">
              <span>工作流波宽</span>
              <Stepper
                value={state.waveWidth}
                unit=""
                min={RANGES.waveWidth.min}
                max={RANGES.waveWidth.max}
                step={RANGES.waveWidth.step}
                onChange={(v) => void writeWorkflowCap('waveWidth', v)}
              />
            </span>
          </div>
        </div>

        {/* 子进程数阈值推导说明（治理口径） */}
        <div className="rowline">
          <div className="r-main">
            <div className="r-title">子进程数阈值 · 治理口径 · 按核数与并发预算推导</div>
            <div className="r-desc">
              治理口径统计 claude / codex 家族子进程及其内部 node 载体 （含会话挂载的 MCP server
              进程，每会话常驻十几个属正常）， 因此阈值下限远高于日常用量，仅在进程数量失控时触发。
              {state.childrenCount.derived != null && cores != null && (
                <>
                  {' '}
                  按本机基线（{cores} 逻辑核 / 预算 {state.totalAgentProcessBudget}）推导：警告{' '}
                  {Math.round(state.childrenCount.derived.warning)} / 严重{' '}
                  {Math.round(state.childrenCount.derived.critical)} / 危急{' '}
                  {Math.round(state.childrenCount.derived.emergency)} 个，公式 max(下限,
                  核数×8/12/16, 预算+0/8/16)。
                </>
              )}
              {state.childrenCount.mode === 'manual' &&
                ' 已手动覆盖（下方危急/严重/警告列可编辑）。'}
            </div>
            {state.childrenCount.mode === 'manual' && (
              <button
                className="n-link"
                style={{ padding: '4px 0 0' }}
                onClick={() => void restoreChildrenAuto()}
              >
                恢复自动推导
              </button>
            )}
          </div>
        </div>

        {/* 压力阈值矩阵 */}
        {LEVEL_ROWS.map((row) => {
          const meta = PRESSURE_LEVEL_META[row.level]
          return (
            <div className="th-row" key={row.level}>
              <span className="th-lv">
                <span className="dot" style={{ background: meta.colorVar }} />
                <span>
                  <span className="th-name">{meta.name}</span>
                  <br />
                  <span className="th-desc">{row.desc}</span>
                </span>
              </span>
              <span className="th-steps">
                {TRIPLE_SPECS.map((spec) => (
                  <span className="th-step" key={spec.key}>
                    <span>
                      {spec.label}
                      {spec.showGbEquivalent && (
                        <i style={{ fontStyle: 'normal', color: 'var(--text-faint)' }}>
                          {gbEquivalent(state[spec.key][row.level])}
                        </i>
                      )}
                    </span>
                    <Stepper
                      value={state[spec.key][row.level]}
                      unit={spec.unit}
                      min={spec.range.min}
                      max={spec.range.max}
                      step={spec.range.step}
                      onChange={(v) => void writeThresholdTriple(spec.key, row.level, v)}
                    />
                  </span>
                ))}
                <span className="th-step">
                  <span>子进程数</span>
                  <Stepper
                    value={
                      state.childrenCount.mode === 'manual' && state.childrenCount.manual != null
                        ? state.childrenCount.manual[row.level]
                        : (state.childrenCount.derived?.[row.level] ?? 80)
                    }
                    unit=" 个"
                    min={RANGES.childrenCount.min}
                    max={RANGES.childrenCount.max}
                    step={RANGES.childrenCount.step}
                    disabled={state.childrenCount.mode !== 'manual'}
                    onChange={(v) => void writeChildrenCountManual(row.level, v)}
                  />
                </span>
              </span>
            </div>
          )
        })}
      </div>

      <p className="footnote">
        阈值判定：宿主内存（RSS，按占系统总内存百分比）、系统内存占用率、事件循环延迟、
        子进程数四类指标任一越级，即进入更高压力级别；内存阈值按宿主机基线动态换算 （基线随内存变化
        &gt;5% 或休眠恢复自动重采样）。判定以百分比直比为准， GB
        换算值仅用于展示。并发闸门在压力升级时按 warning 限流 → critical 暂停派发 → emergency
        熔断的固定矩阵自动执行，无需逐项开关。
      </p>
    </div>
  )
}

/* ─── 步进器 ───────────────────────────────────────────────────────────── */

interface StepperProps {
  value: number
  unit: string
  min: number
  max: number
  step: number
  disabled?: boolean
  onChange: (value: number) => void
}

function Stepper({ value, unit, min, max, step, disabled, onChange }: StepperProps) {
  const display = `${Number.isInteger(value) ? value : value.toFixed(1)}${unit}`
  return (
    <span className="step">
      <button
        aria-label="减少"
        disabled={disabled || value <= min}
        onClick={() => onChange(clampNumber(value - step, min, max))}
      >
        <Minus size={12} />
      </button>
      <span className="v">{display}</span>
      <button
        aria-label="增加"
        disabled={disabled || value >= max}
        onClick={() => onChange(clampNumber(value + step, min, max))}
      >
        <Plus size={12} />
      </button>
    </span>
  )
}

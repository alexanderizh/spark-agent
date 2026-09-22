/**
 * @module PerformanceSettingsSection
 *
 * 设置 → 系统 → 性能（M3 主容器）：四数据状态（live / loading / error /
 * off）编排，组合资源总览、历史趋势、活动治理、治理事件、性能保护配置。
 */

import { useCallback, useMemo, useState } from 'react'
import { Activity, RotateCcw } from 'lucide-react'
import { formatBytes } from './performance-format'
import { usePerformanceData } from './usePerformanceData'
import { PerformanceOverview } from './PerformanceOverview'
import { PressureTrendCharts } from './PressureTrendCharts'
import { GovernanceMeters } from './GovernanceMeters'
import { PressureEventsList } from './PressureEventsList'
import { PerformanceConfigPanel } from './PerformanceConfigPanel'
import './settings-performance.less'

const RANGE_OPTIONS: ReadonlyArray<{ value: number; label: string }> = [
  { value: 15, label: '15 分钟' },
  { value: 30, label: '30 分钟' },
  { value: 60, label: '60 分钟' },
]

export function PerformanceSettingsSection() {
  const [rangeMinutes, setRangeMinutes] = useState(30)
  const [refreshing, setRefreshing] = useState(false)
  const [echoVersion, setEchoVersion] = useState(0)
  const [enabling, setEnabling] = useState(false)

  const {
    loadState,
    errorMessage,
    summary,
    full,
    history,
    events,
    diagnostics,
    refresh,
    refreshDiagnostics,
    updateSettings,
    resetSettings,
  } = usePerformanceData(rangeMinutes * 60_000)

  // 配置写入后即时回拉诊断，占用表立刻反映新上限（验收③），不触发整页加载态。
  const updateSettingsAndSync = useCallback(
    async (mutate: (draft: Record<string, unknown>) => void) => {
      await updateSettings(mutate)
      await refreshDiagnostics()
    },
    [updateSettings, refreshDiagnostics],
  )

  const loading = loadState === 'loading'
  const baselineDesc = useMemo(() => {
    const baseline = full?.baseline
    if (baseline == null) return ''
    return `${formatBytes(baseline.totalBytes)} / ${baseline.cpuCores} 核`
  }, [full])

  const handleRefresh = useCallback(async () => {
    setRefreshing(true)
    try {
      await refresh()
      setEchoVersion((v) => v + 1)
    } finally {
      setRefreshing(false)
    }
  }, [refresh])

  const handleEnable = useCallback(async () => {
    setEnabling(true)
    try {
      await updateSettings((draft) => {
        draft.monitor = { ...((draft.monitor as object) ?? {}), enabled: true }
      })
      await refresh()
      setEchoVersion((v) => v + 1)
    } finally {
      setEnabling(false)
    }
  }, [updateSettings, refresh])

  const handleReset = useCallback(async () => {
    await resetSettings()
    setEchoVersion((v) => v + 1)
  }, [resetSettings])

  return (
    <section className="settings-section perf-settings">
      <h2>性能</h2>
      <p className="lede">
        实时监控 SparkWork 与宿主电脑的资源占用；压力过高时自动降级并发任务并通知你。
        {baselineDesc !== '' && <> 阈值按本机内存与 CPU 核数动态换算（当前基线：{baselineDesc}）</>}
        ，数据 2 秒采样，仅保存在本地。
      </p>

      {errorMessage != null && (
        <div className="integrity-banner error" style={{ marginBottom: 12 }}>
          {loadState === 'error' ? '性能数据采集失败' : '性能配置操作失败'}
          {errorMessage != null ? `：${errorMessage}` : ''}
          {loadState === 'error' ? ' · 将自动重试' : ''}
        </div>
      )}

      {loadState === 'off' ? (
        <div className="card empty-card">
          <div className="empty-ic">
            <Activity size={20} />
          </div>
          <div className="empty-title">性能监控未开启</div>
          <div className="empty-desc">
            开启后展示宿主内存、系统内存、事件循环延迟等实时指标，并在压力过高时自动降级。
          </div>
          <button
            className="btn primary"
            style={{ marginTop: 12 }}
            disabled={enabling}
            onClick={() => void handleEnable()}
          >
            {enabling ? '开启中…' : '开启性能监控'}
          </button>
        </div>
      ) : (
        <>
          <PerformanceOverview
            summary={summary}
            full={full}
            loading={loading}
            refreshing={refreshing}
            onRefresh={() => void handleRefresh()}
          />

          <div className="subsec-row">
            <div className="subsec-h">历史趋势</div>
            <div className="seg">
              {RANGE_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  className={rangeMinutes === option.value ? 'on' : undefined}
                  onClick={() => setRangeMinutes(option.value)}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>
          <PressureTrendCharts
            points={history}
            thresholds={full?.thresholds ?? null}
            rangeMinutes={rangeMinutes}
            loading={loading}
          />

          <div className="subsec-h">活动治理</div>
          <GovernanceMeters diagnostics={diagnostics} summary={summary} loading={loading} />

          <div className="subsec-h">最近降级 / 恢复事件</div>
          <PressureEventsList events={events} loading={loading} />
        </>
      )}

      <div className="subsec-row">
        <div className="subsec-h">性能保护</div>
        <button
          className="btn text"
          style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}
          onClick={() => void handleReset()}
        >
          <RotateCcw size={12} />
          恢复默认
        </button>
      </div>
      <PerformanceConfigPanel
        key={echoVersion}
        full={full}
        diagnostics={diagnostics}
        onUpdateSettings={updateSettingsAndSync}
      />

      <p className="footnote">
        通知规则：warning / critical 仅静默降级（限流、暂停新派发），不弹任何提示；只有
        emergency（电脑资源即将耗尽、已暂停全部新任务派发）才弹常驻横幅并发送系统通知。这是
        电脑资源保护机制——压力恢复后横幅自动消失并提示「电脑资源已恢复」。
      </p>
    </section>
  )
}

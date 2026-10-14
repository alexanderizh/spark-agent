/**
 * @module PerformanceSettingsSection
 *
 * 设置 → 系统 → 性能（M3 主容器）：四数据状态（live / loading / error /
 * off）编排，组合资源总览、历史趋势、活动治理、治理事件、性能保护配置。
 */

import { useCallback, useMemo, useState } from 'react'
import { Activity, RotateCcw } from 'lucide-react'
import { useI18n } from '../i18n'
import { formatBytes } from './performance-format'
import { usePerformanceData } from './usePerformanceData'
import { PerformanceOverview } from './PerformanceOverview'
import { PressureTrendCharts } from './PressureTrendCharts'
import { GovernanceMeters } from './GovernanceMeters'
import { PressureEventsList } from './PressureEventsList'
import { PerformanceConfigPanel } from './PerformanceConfigPanel'
import './settings-performance.less'

const RANGE_MINUTES: readonly number[] = [15, 30, 60]

export function PerformanceSettingsSection() {
  const { t } = useI18n()
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
    return t('perf.section.baselineDesc', {
      bytes: formatBytes(baseline.totalBytes),
      cores: baseline.cpuCores,
    })
  }, [full, t])

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
      <h2>{t('perf.sectionTitle')}</h2>
      <p className="lede">
        {t('perf.section.ledeDesc')}
        {baselineDesc !== '' && (
          <> {t('perf.section.baselineNoteDesc', { baseline: baselineDesc })}</>
        )}
        {t('perf.section.ledeTailDesc')}
      </p>

      {errorMessage != null && (
        <div className="integrity-banner error" style={{ marginBottom: 12 }}>
          {loadState === 'error' ? t('perf.error.collectFailed') : t('perf.error.configFailed')}
          {errorMessage != null ? `: ${errorMessage}` : ''}
          {loadState === 'error' ? ` · ${t('perf.error.retrying')}` : ''}
        </div>
      )}

      {loadState === 'off' ? (
        <div className="card empty-card">
          <div className="empty-ic">
            <Activity size={20} />
          </div>
          <div className="empty-title">{t('perf.off.title')}</div>
          <div className="empty-desc">{t('perf.off.descDesc')}</div>
          <button
            className="btn primary"
            style={{ marginTop: 12 }}
            disabled={enabling}
            onClick={() => void handleEnable()}
          >
            {enabling ? t('perf.off.enablingBtn') : t('perf.off.enableBtn')}
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
            <div className="subsec-h">{t('perf.section.trendTitle')}</div>
            <div className="seg">
              {RANGE_MINUTES.map((minutes) => (
                <button
                  key={minutes}
                  className={rangeMinutes === minutes ? 'on' : undefined}
                  onClick={() => setRangeMinutes(minutes)}
                >
                  {t('perf.range.minutes', { count: minutes })}
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

          <div className="subsec-h">{t('perf.section.governanceTitle')}</div>
          <div className="subsec-desc">{t('perf.section.governanceDesc')}</div>
          <GovernanceMeters diagnostics={diagnostics} summary={summary} loading={loading} />

          <div className="subsec-h">{t('perf.section.eventsTitle')}</div>
          <PressureEventsList events={events} loading={loading} />
        </>
      )}

      <div className="subsec-row">
        <div className="subsec-h">{t('perf.section.protectionTitle')}</div>
        <button
          className="btn text"
          style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}
          onClick={() => void handleReset()}
        >
          <RotateCcw size={12} />
          {t('perf.section.restoreDefaultBtn')}
        </button>
      </div>
      <PerformanceConfigPanel
        key={echoVersion}
        full={full}
        diagnostics={diagnostics}
        onUpdateSettings={updateSettingsAndSync}
      />

      <p className="footnote">{t('perf.section.footnoteLongDesc')}</p>
    </section>
  )
}

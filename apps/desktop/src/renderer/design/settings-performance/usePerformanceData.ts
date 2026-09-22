/**
 * @module usePerformanceData
 *
 * 性能设置页数据层：全量/摘要快照、趋势历史、治理事件、闸门诊断、
 * performance 设置组读写，全部经 window.spark 类型化 IPC。
 *
 * 推拉分工：
 *  - 拉取：full 快照（打开/手动刷新/展开子进程明细时）、history、
 *    events、diagnostics、settings；
 *  - 推送：stream:snapshot（节流摘要，驱动指标实时刷新）、
 *    stream:pressure-changed（级别变更 → 事件/诊断/趋势即时回拉）；
 *  - 订阅窗口生命周期：subscribe(true) 建立服务端节流推送，
 *    unmount / document.hidden 时退订（隐藏窗口零推送，方案 M1-⑤）。
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  DispatchGovernorGetDiagnosticsResponse,
  ResourceMonitorFullSnapshot,
  ResourceMonitorGetHistoryResponse,
  ResourceMonitorSnapshotStreamPayload,
  ResourceMonitorSummarySnapshot,
  ResourcePressureChangedPayload,
  ResourcePressureEventRecord,
} from '@spark/protocol'

export type PerformanceLoadState = 'loading' | 'live' | 'error' | 'off'

export interface PerformanceData {
  loadState: PerformanceLoadState
  errorMessage: string | null
  /** 最近一次摘要（stream 推送或拉取）。 */
  summary: ResourceMonitorSummarySnapshot | null
  /** 最近一次全量快照（打开页面/手动刷新时拉取，含 pid 明细与阈值）。 */
  full: ResourceMonitorFullSnapshot | null
  history: ResourceMonitorGetHistoryResponse['points']
  events: ResourcePressureEventRecord[]
  diagnostics: DispatchGovernorGetDiagnosticsResponse | null
  /** performance 设置组当前持久化值（data JSON）。 */
  settingsData: Record<string, unknown> | null
  /** 手动刷新（自旋动画由调用方驱动）。 */
  refresh: () => Promise<void>
  /** 仅刷新闸门诊断（配置写入后即时反映新上限，不闪加载态）。 */
  refreshDiagnostics: () => Promise<void>
  /** 深合并更新 performance.data 并回读（热更新经主进程即时灌注）。 */
  updateSettings: (mutate: (draft: Record<string, unknown>) => void) => Promise<void>
  /** 恢复 performance.data 为默认（写空对象 → 各模块回落默认配置）。 */
  resetSettings: () => Promise<void>
}

/** 深拷贝 + 变更合并后整体写回（settings:set 是值级整体替换语义）。 */
async function writePerformanceSettings(next: Record<string, unknown>): Promise<void> {
  await window.spark.invoke('settings:set', {
    category: 'performance',
    key: 'data',
    value: next,
  })
}

export function usePerformanceData(historyWindowMs: number): PerformanceData {
  const [loadState, setLoadState] = useState<PerformanceLoadState>('loading')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [summary, setSummary] = useState<ResourceMonitorSummarySnapshot | null>(null)
  const [full, setFull] = useState<ResourceMonitorFullSnapshot | null>(null)
  const [history, setHistory] = useState<ResourceMonitorGetHistoryResponse['points']>([])
  const [events, setEvents] = useState<ResourcePressureEventRecord[]>([])
  const [diagnostics, setDiagnostics] = useState<DispatchGovernorGetDiagnosticsResponse | null>(
    null,
  )
  const [settingsData, setSettingsData] = useState<Record<string, unknown> | null>(null)

  const settingsDataRef = useRef<Record<string, unknown> | null>(null)

  const pullFull = useCallback(async () => {
    const response = await window.spark.invoke('resource-monitor:get-snapshot', { detail: 'full' })
    setFull(response.full)
    if (response.summary != null) setSummary(response.summary)
    if (response.summary == null) {
      // summary 为 null：监控未开启 → off（开启按钮可达）；已开启等首拍 → loading。
      setLoadState(
        response.monitorEnabled === false ? 'off' : response.full == null ? 'loading' : 'off',
      )
    } else {
      setLoadState(response.summary.monitorEnabled ? 'live' : 'off')
    }
  }, [])

  const pullHistory = useCallback(async () => {
    const response = await window.spark.invoke('resource-monitor:get-history', {
      windowMs: historyWindowMs,
    })
    setHistory(response.points)
  }, [historyWindowMs])

  const pullEvents = useCallback(async () => {
    const response = await window.spark.invoke('resource-monitor:get-pressure-events', {
      limit: 20,
    })
    setEvents(response.events)
  }, [])

  const pullDiagnostics = useCallback(async () => {
    try {
      setDiagnostics(await window.spark.invoke('dispatch-governor:get-diagnostics', {}))
    } catch {
      setDiagnostics({ available: false, diagnostics: null })
    }
  }, [])

  const pullSettings = useCallback(async () => {
    const response = await window.spark.invoke('settings:get', {
      category: 'performance',
      key: 'data',
    })
    const value =
      response.value != null && typeof response.value === 'object'
        ? (response.value as Record<string, unknown>)
        : {}
    settingsDataRef.current = value
    setSettingsData(value)
  }, [])

  const refresh = useCallback(async () => {
    setErrorMessage(null)
    try {
      await Promise.all([pullFull(), pullHistory(), pullEvents(), pullDiagnostics()])
    } catch (cause) {
      setLoadState('error')
      setErrorMessage(cause instanceof Error ? cause.message : String(cause))
    }
  }, [pullFull, pullHistory, pullEvents, pullDiagnostics])

  const updateSettings = useCallback(
    async (mutate: (draft: Record<string, unknown>) => void) => {
      const base = settingsDataRef.current ?? {}
      // 浅结构足够：mutate 只改顶层字段（monitor/governance/workflow）或其内部一层，
      // 这里对已知子对象做深拷贝，避免误改引用共享的原对象。
      const draft = structuredClonePolyfill(base)
      mutate(draft)
      settingsDataRef.current = draft
      setSettingsData(draft)
      try {
        await writePerformanceSettings(draft)
      } catch (cause) {
        // 持久化失败：回读服务端真值恢复写入基准（防止后续写入基于未持久化的幽灵
        // draft），错误经页面横幅提示；乐观 UI 由刷新时的 key={echoVersion} 重挂载纠正。
        const message = cause instanceof Error ? cause.message : String(cause)
        setErrorMessage(`性能配置保存失败：${message}`)
        void pullSettings().catch(() => {})
      }
    },
    [pullSettings],
  )

  const resetSettings = useCallback(async () => {
    settingsDataRef.current = {}
    setSettingsData({})
    try {
      await writePerformanceSettings({})
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause)
      setErrorMessage(`性能配置重置失败：${message}`)
      void pullSettings().catch(() => {})
      return
    }
    await Promise.all([pullFull(), pullSettings()]).catch(() => {})
  }, [pullFull, pullSettings])

  // ─── 初始拉取 + 订阅 ────────────────────────────────────────────────────────
  useEffect(() => {
    void refresh()
    void pullSettings().catch(() => {
      /* 初始设置拉取失败不阻断页面：刷新时统一报错 */
    })
    void window.spark
      .invoke('resource-monitor:subscribe', { enabled: true, minIntervalMs: 2_000 })
      .catch(() => {
        /* 订阅失败不阻断页面：拉取兜底 */
      })

    const offSnapshot = window.spark.on(
      'stream:resource-monitor:snapshot',
      (payload: ResourceMonitorSnapshotStreamPayload) => {
        setSummary(payload.summary)
        setLoadState((previous) =>
          previous === 'error' ? previous : payload.summary.monitorEnabled ? 'live' : 'off',
        )
      },
    )
    const offPressure = window.spark.on(
      'stream:resource-monitor:pressure-changed',
      (payload: ResourcePressureChangedPayload) => {
        if (payload.summary != null) {
          setSummary(payload.summary)
          setLoadState(payload.summary.monitorEnabled ? 'live' : 'off')
        }
        // 级别变更：事件与诊断即时回拉（历史由低频轮询跟进）。
        void pullEvents().catch(() => {
          /* 事件回拉瞬时失败：30s 轮询兜底 */
        })
        void pullDiagnostics()
      },
    )

    return () => {
      offSnapshot()
      offPressure()
      void window.spark.invoke('resource-monitor:subscribe', { enabled: false }).catch(() => {})
    }
  }, [refresh, pullSettings, pullEvents, pullDiagnostics])

  // ─── 低频轮询：趋势尾部推进 + 诊断刷新（订阅推送不含这两类数据） ────────────
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.hidden) return
      void pullHistory().catch(() => {
        /* 轮询失败：下轮重试 */
      })
      void pullDiagnostics()
    }, 30_000)
    return () => window.clearInterval(timer)
  }, [pullHistory, pullDiagnostics])

  // ─── 窗口隐藏/可见：退订/复订（隐藏窗口零推送） ─────────────────────────────
  useEffect(() => {
    const syncSubscription = (hidden: boolean): void => {
      void window.spark
        .invoke('resource-monitor:subscribe', { enabled: !hidden, minIntervalMs: 2_000 })
        .catch(() => {})
    }
    const onVisibility = (): void => {
      if (document.hidden) {
        syncSubscription(false)
      } else {
        syncSubscription(true)
        void refresh()
      }
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => document.removeEventListener('visibilitychange', onVisibility)
  }, [refresh])

  return {
    loadState,
    errorMessage,
    summary,
    full,
    history,
    events,
    diagnostics,
    settingsData,
    refresh,
    refreshDiagnostics: pullDiagnostics,
    updateSettings,
    resetSettings,
  }
}

/** structuredClone 兜底（旧 WebView 无实现时 JSON 降级，配置值为纯 JSON 安全）。 */
function structuredClonePolyfill<T>(value: T): T {
  if (typeof structuredClone === 'function') return structuredClone(value)
  return JSON.parse(JSON.stringify(value)) as T
}

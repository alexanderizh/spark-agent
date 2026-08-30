import { useCallback, useEffect, useMemo, useState } from 'react'
import { Button, Tag } from 'antd'
import type {
  CodexRuntimeDiagnosticsResponse,
  CodexRuntimeLatencySummary,
  CodexRuntimeSupervisorDiagnostics,
} from '@spark/protocol'
import './optional-capabilities.less'

const TOTAL_RSS_WARNING_BYTES = 1024 * 1024 * 1024
const TOTAL_HANDLE_WARNING_COUNT = 2_048
const WARM_TURN_START_WARNING_MS = 300
const WARM_RATE_MIN_SAMPLE_COUNT = 5
const WARM_RATE_WARNING_RATIO = 0.6

export function CodexRuntimeDiagnosticsCard() {
  const [snapshot, setSnapshot] = useState<CodexRuntimeDiagnosticsResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [restarting, setRestarting] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setSnapshot(await window.spark.invoke('codex-runtime:diagnostics', {}))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    window.spark
      .invoke('codex-runtime:diagnostics', {})
      .then((response) => {
        if (!cancelled) setSnapshot(response)
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const restartIdle = async () => {
    setRestarting(true)
    setError(null)
    setMessage(null)
    try {
      const response = await window.spark.invoke('codex-runtime:restart-idle', {})
      const restarted = response.result?.restartedLeaseIds.length ?? 0
      const busy = response.result?.busyLeaseIds.length ?? 0
      setMessage(
        `已重启 ${restarted} 个空闲 Runtime${busy > 0 ? `，跳过 ${busy} 个运行中任务` : ''}`,
      )
      await refresh()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setRestarting(false)
    }
  }

  const health = useMemo(() => resolveRuntimeHealth(snapshot), [snapshot])
  const diagnostics = snapshot?.diagnostics ?? null

  return (
    <section className="settings-section codex-runtime-diagnostics">
      <div className="voice-integrity-header">
        <div className="voice-integrity-heading">
          <h3>Codex Runtime 诊断</h3>
          <p>
            查看持久 App Server 的资源占用、暖启动命中与线程连续性；诊断数据不包含会话标识或凭据。
          </p>
        </div>
        <div className="codex-runtime-actions">
          <Tag color={health.color}>{health.label}</Tag>
          <Button loading={loading} onClick={() => void refresh()}>
            刷新
          </Button>
          <Button
            loading={restarting}
            disabled={!snapshot?.enabled || diagnostics == null}
            onClick={() => void restartIdle()}
          >
            重启空闲 Runtime
          </Button>
        </div>
      </div>

      {error && <div className="integrity-banner error">{error}</div>}
      {message && <div className="integrity-banner success">{message}</div>}
      {health.messages.length > 0 && (
        <div className={`codex-runtime-health-copy ${health.level}`}>
          {health.messages.map((item) => (
            <span key={item}>{item}</span>
          ))}
        </div>
      )}

      {diagnostics != null ? (
        <>
          <div className="codex-runtime-summary-grid">
            <SummaryMetric
              label="Runtime"
              value={`${diagnostics.activeRuntimeCount}`}
              detail={`${diagnostics.leasedRuntimeCount} 个运行中`}
            />
            <SummaryMetric
              label="总内存"
              value={formatBytes(diagnostics.totalRssBytes)}
              detail={`${diagnostics.processCount} 个进程`}
            />
            <SummaryMetric
              label="暖启动命中率"
              value={formatPercent(diagnostics.counters.warmHitRate)}
              detail={`${diagnostics.counters.warmHitCount}/${diagnostics.counters.acquireCount} 次`}
            />
            <SummaryMetric
              label="暖 turn/start p95"
              value={formatDuration(diagnostics.latency.warmTurnStart.p95Ms)}
              detail={`${diagnostics.latency.warmTurnStart.count} 个样本`}
            />
          </div>

          <div className="settings-card codex-runtime-latency-card">
            <LatencyRow label="冷启动 acquire" value={diagnostics.latency.coldAcquire} />
            <LatencyRow label="暖启动 acquire" value={diagnostics.latency.warmAcquire} />
            <LatencyRow label="冷 turn/start" value={diagnostics.latency.coldTurnStart} />
            <LatencyRow label="暖 turn/start" value={diagnostics.latency.warmTurnStart} />
          </div>

          <div className="settings-card integrity-sdk-card codex-runtime-list">
            {diagnostics.runtimes.map((runtime, index) => (
              <div
                key={runtime.leaseId}
                className={`integrity-sdk-row ${index > 0 ? 'bordered' : ''}`}
              >
                <div className="integrity-sdk-info">
                  <div className="integrity-sdk-name">Runtime {runtime.leaseId}</div>
                  <div className="integrity-sdk-version">
                    {runtimeStateLabel(runtime.state)} · {formatBytes(runtime.rssBytes)} ·{' '}
                    {runtime.handleCount ?? '—'} 个句柄
                  </div>
                  <div className="voice-integrity-desc">
                    {runtime.loadedThreadCount ?? 0} 个 thread · {runtime.resourceCount} 个 sidecar
                    · 最近使用 {formatTimestamp(runtime.lastUsedAt)}
                  </div>
                </div>
                <Tag>{runtime.state}</Tag>
              </div>
            ))}
            {diagnostics.runtimes.length === 0 && (
              <div className="integrity-empty">
                尚无活跃 Runtime；首次 Codex 会话执行后会显示诊断。
              </div>
            )}
          </div>
        </>
      ) : (
        <div className="settings-card codex-runtime-disabled">
          持久 Runtime 已通过启动环境关闭，当前使用兼容的每轮临时载具。
        </div>
      )}
      <p className="codex-runtime-footnote">
        手动重启只回收空闲 Runtime；运行中的任务不会被中断。告警阈值：总内存 1 GiB、总句柄 2048、暖
        turn/start p95 300ms。
      </p>
    </section>
  )
}

function SummaryMetric(props: { label: string; value: string; detail: string }) {
  return (
    <div className="settings-card codex-runtime-summary-item">
      <span>{props.label}</span>
      <strong>{props.value}</strong>
      <small>{props.detail}</small>
    </div>
  )
}

function LatencyRow(props: { label: string; value: CodexRuntimeLatencySummary }) {
  return (
    <div className="codex-runtime-latency-row">
      <span>{props.label}</span>
      <span>p50 {formatDuration(props.value.p50Ms)}</span>
      <span>p95 {formatDuration(props.value.p95Ms)}</span>
      <span>max {formatDuration(props.value.maxMs)}</span>
      <small>{props.value.count} 个样本</small>
    </div>
  )
}

function resolveRuntimeHealth(snapshot: CodexRuntimeDiagnosticsResponse | null): {
  level: 'healthy' | 'attention' | 'inactive'
  label: string
  color: 'success' | 'warning' | 'default'
  messages: string[]
} {
  if (snapshot == null)
    return { level: 'inactive', label: '读取中', color: 'default', messages: [] }
  if (!snapshot.enabled || snapshot.diagnostics == null) {
    return { level: 'inactive', label: '兼容模式', color: 'default', messages: [] }
  }
  const diagnostics = snapshot.diagnostics
  const messages: string[] = []
  if (diagnostics.totalRssBytes != null && diagnostics.totalRssBytes > TOTAL_RSS_WARNING_BYTES) {
    messages.push('Codex Runtime 总内存超过 1 GiB，建议在任务结束后重启空闲 Runtime。')
  }
  if (
    diagnostics.totalHandleCount != null &&
    diagnostics.totalHandleCount > TOTAL_HANDLE_WARNING_COUNT
  ) {
    messages.push('Codex Runtime 总句柄数超过 2048，建议检查长时间未回收的工具连接。')
  }
  const warmTurnP95 = diagnostics.latency.warmTurnStart.p95Ms
  if (warmTurnP95 != null && warmTurnP95 > WARM_TURN_START_WARNING_MS) {
    messages.push(`暖 turn/start p95 为 ${warmTurnP95}ms，超过 300ms 发布目标。`)
  }
  if (
    diagnostics.counters.acquireCount >= WARM_RATE_MIN_SAMPLE_COUNT &&
    diagnostics.counters.warmHitRate < WARM_RATE_WARNING_RATIO
  ) {
    messages.push('暖启动命中率低于 60%，请检查 Provider、MCP 或身份配置是否频繁变化。')
  }
  if (
    diagnostics.counters.startFailureCount > 0 ||
    diagnostics.counters.crashReplacementCount > 0
  ) {
    messages.push(
      `已记录 ${diagnostics.counters.startFailureCount} 次启动失败、${diagnostics.counters.crashReplacementCount} 次崩溃替换。`,
    )
  }
  return messages.length === 0
    ? { level: 'healthy', label: '健康', color: 'success', messages }
    : { level: 'attention', label: '需关注', color: 'warning', messages }
}

function formatBytes(bytes: number | null): string {
  if (bytes == null) return '—'
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KiB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MiB`
}

function formatPercent(value: number): string {
  return `${Math.round(value * 100)}%`
}

function formatDuration(value: number | null): string {
  return value == null ? '—' : `${value}ms`
}

function formatTimestamp(value: string): string {
  const timestamp = new Date(value)
  return Number.isNaN(timestamp.getTime()) ? '未知' : timestamp.toLocaleTimeString()
}

function runtimeStateLabel(
  state: CodexRuntimeSupervisorDiagnostics['runtimes'][number]['state'],
): string {
  const labels = { starting: '启动中', running: '运行中', idle: '空闲', exited: '已退出' }
  return labels[state]
}

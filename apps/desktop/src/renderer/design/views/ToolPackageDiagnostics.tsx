import { useCallback, useEffect, useMemo, useState } from 'react'
import { Button, Select, Tag } from '@lobehub/ui'
import { message } from 'antd'
import type {
  ToolInvocationTrace,
  ToolPackageDetail,
  ToolPackageRuntimeEvent,
  ToolPackageTestResult,
} from '@spark/protocol'
import { useIpcInvoke, useIpcStream } from '../hooks/useIpc'

interface ToolPackageDiagnosticsProps {
  detail: ToolPackageDetail
  requestConfirm(input: {
    title: string
    description: string
    confirmText?: string
  }): Promise<boolean>
}

export function ToolPackageDiagnostics({ detail, requestConfirm }: ToolPackageDiagnosticsProps) {
  const [toolName, setToolName] = useState(detail.manifest.tools[0]?.name ?? '')
  const [input, setInput] = useState('{}')
  const [testResult, setTestResult] = useState<ToolPackageTestResult | null>(null)
  const [invocations, setInvocations] = useState<ToolInvocationTrace[]>([])
  const [logs, setLogs] = useState<string[]>([])
  const [runtimeEvent, setRuntimeEvent] = useState<ToolPackageRuntimeEvent | null>(null)
  const [loading, setLoading] = useState(false)
  const [testRunning, setTestRunning] = useState(false)
  const [activeCorrelationId, setActiveCorrelationId] = useState<string | null>(null)
  const { invoke: testPackage } = useIpcInvoke('tool-packages:test')
  const { invoke: cancelTest } = useIpcInvoke('tool-packages:test:cancel')
  const { invoke: listInvocations } = useIpcInvoke('tool-packages:invocations:list')

  useIpcStream('stream:tool-packages:runtime', (event) => {
    if (event.packageId !== detail.package.id) return
    setRuntimeEvent(event)
    if (event.type === 'log') {
      setLogs((current) => [
        ...current.slice(-199),
        `[${event.level.toUpperCase()}] ${event.message}`,
      ])
    }
  })

  const selectedTool = useMemo(
    () => detail.manifest.tools.find((tool) => tool.name === toolName),
    [detail.manifest.tools, toolName],
  )

  const refreshDiagnostics = useCallback(async () => {
    setLoading(true)
    try {
      const [traceResponse, logResponse] = await Promise.all([
        listInvocations({ packageId: detail.package.id, limit: 30 }),
        window.spark.invoke('log:read', {
          scope: 'tools',
          namespace: `tools:process:${detail.package.id}`,
          maxLines: 200,
        }),
      ])
      setInvocations(traceResponse.invocations)
      setLogs(logResponse.lines)
    } finally {
      setLoading(false)
    }
  }, [detail.package.id, listInvocations])

  useEffect(() => {
    const timer = window.setTimeout(() => void refreshDiagnostics(), 0)
    return () => window.clearTimeout(timer)
  }, [refreshDiagnostics])

  const runTest = useCallback(async () => {
    if (selectedTool == null) return
    let parsed: unknown
    try {
      parsed = JSON.parse(input) as unknown
    } catch {
      setTestResult({
        ok: false,
        error: { code: 'INVALID_JSON', message: '测试输入必须是合法 JSON。' },
        durationMs: 0,
        correlationId: 'not-started',
      })
      return
    }
    if (parsed == null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      setTestResult({
        ok: false,
        error: { code: 'INVALID_INPUT', message: '测试输入必须是 JSON 对象。' },
        durationMs: 0,
        correlationId: 'not-started',
      })
      return
    }
    const confirmed = await requestConfirm({
      title: `测试 ${selectedTool.title}？`,
      description: `将执行 ${detail.package.id}@${detail.version}/${selectedTool.name}。适配器 ${detail.manifest.runtime.adapter} 可能产生 manifest 声明的系统副作用。`,
      confirmText: '开始测试',
    })
    if (!confirmed) return
    setTestRunning(true)
    const correlationId = crypto.randomUUID()
    setActiveCorrelationId(correlationId)
    try {
      const response = await testPackage({
        packageId: detail.package.id,
        version: detail.version,
        toolName: selectedTool.name,
        input: parsed as Record<string, unknown>,
        correlationId,
      })
      setTestResult(response.test)
      await refreshDiagnostics()
    } finally {
      setRuntimeEvent(null)
      setActiveCorrelationId(null)
      setTestRunning(false)
    }
  }, [detail, input, refreshDiagnostics, requestConfirm, selectedTool, testPackage])

  return (
    <section className="tp_section">
      <div className="tp_sectionHeading">
        <strong>测试与运行诊断</strong>
        <Button size="small" loading={loading} onClick={() => void refreshDiagnostics()}>
          刷新记录
        </Button>
      </div>
      <div className="tp_testToolbar">
        <Select
          value={toolName}
          options={detail.manifest.tools.map((tool) => ({ label: tool.title, value: tool.name }))}
          onChange={(value) => setToolName(value)}
        />
        {testRunning && activeCorrelationId != null ? (
          <Button
            danger
            onClick={() => {
              void cancelTest({ correlationId: activeCorrelationId })
                .then((response) => {
                  if (!response.cancelled) message.info('测试已结束，无需取消。')
                })
                .catch((error: unknown) =>
                  message.error(error instanceof Error ? error.message : '取消测试失败'),
                )
            }}
          >
            取消测试
          </Button>
        ) : (
          <Button type="primary" onClick={() => void runTest()}>
            运行测试
          </Button>
        )}
      </div>
      <label className="tp_fieldLabel" htmlFor="tool-package-test-input">
        测试输入（JSON）
      </label>
      <textarea
        id="tool-package-test-input"
        className="tp_jsonInput"
        value={input}
        spellCheck={false}
        onChange={(event) => setInput(event.target.value)}
      />
      {testResult != null && (
        <div className="tp_testResult" role={testResult.ok ? 'status' : 'alert'}>
          <div className="tp_testResultMeta">
            <Tag color={testResult.ok ? 'green' : 'red'}>{testResult.ok ? '成功' : '失败'}</Tag>
            <span>{testResult.durationMs}ms</span>
            <code>{testResult.correlationId}</code>
          </div>
          <pre>
            {testResult.ok
              ? JSON.stringify(testResult.result, null, 2)
              : `${testResult.error?.code ?? 'ERROR'}: ${testResult.error?.message ?? '测试失败'}`}
          </pre>
        </div>
      )}

      <div className="tp_subsectionTitle">最近调用</div>
      {runtimeEvent?.type === 'progress' && (
        <div className="tp_runtimeProgress" role="status" aria-live="polite">
          <span>{runtimeEvent.toolName ?? '工具运行中'}</span>
          {runtimeEvent.progress != null && (
            <progress max={1} value={runtimeEvent.progress} aria-label="工具运行进度" />
          )}
          <span>
            {runtimeEvent.progress == null
              ? '处理中'
              : `${Math.round(runtimeEvent.progress * 100)}%`}
            {runtimeEvent.message ? ` · ${runtimeEvent.message}` : ''}
          </span>
        </div>
      )}
      {invocations.length === 0 ? (
        <p className="tp_muted">暂无调用记录。</p>
      ) : (
        <div className="tp_traceList">
          {invocations.map((trace) => (
            <div className="tp_traceRow" key={trace.id}>
              <Tag color={statusColor(trace.status)}>{trace.status}</Tag>
              <code>{trace.toolName}</code>
              <span>{trace.durationMs == null ? '运行中' : `${trace.durationMs}ms`}</span>
              <span>{trace.outputBytes == null ? '—' : `${trace.outputBytes} B`}</span>
              <code title={trace.correlationId}>{trace.correlationId.slice(0, 12)}</code>
              {trace.errorCode != null && <span className="tp_errorText">{trace.errorCode}</span>}
            </div>
          ))}
        </div>
      )}

      <div className="tp_subsectionTitle">进程日志</div>
      {logs.length === 0 ? (
        <p className="tp_muted">
          暂无该包的进程日志；remote-http、MCP 和声明式 HTTP 可从调用记录查看。
        </p>
      ) : (
        <pre className="tp_logOutput">{logs.join('\n')}</pre>
      )}
    </section>
  )
}

function statusColor(status: ToolInvocationTrace['status']): string {
  if (status === 'ok') return 'green'
  if (status === 'running') return 'blue'
  if (status === 'denied' || status === 'cancelled') return 'gold'
  return 'red'
}

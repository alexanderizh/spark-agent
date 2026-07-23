import { useEffect, useMemo, useRef, useState } from 'react'
import type {
  CanvasWorkflowDefinition,
  CanvasWorkflowExecutionPlan,
  CanvasWorkflowRun,
  CanvasWorkflowValueType,
} from '@spark/protocol'
import { Icons } from '../../Icons'
import { canvasWorkflowApi } from './canvasWorkflow.api'
import { checkCanvasWorkflowDependencies } from './canvasWorkflowDependencyPreflight'
import { useCanvasWorkflowDialogFocus } from './useCanvasWorkflowDialogFocus'

export interface CanvasWorkflowRunExecutionInput {
  workflow: CanvasWorkflowDefinition
  run: CanvasWorkflowRun
  plan: Readonly<CanvasWorkflowExecutionPlan>
  signal: AbortSignal
}

export interface CanvasWorkflowInputNodeOption {
  id: string
  label: string
  valueTypes: CanvasWorkflowValueType[]
}

function initialParamValue(value: unknown, valueType: string): string | boolean {
  if (valueType === 'boolean') return value === true
  if (value == null) return ''
  return typeof value === 'string' ? value : String(value)
}

function runStatusLabel(status: CanvasWorkflowRun['status']): string {
  const labels: Record<CanvasWorkflowRun['status'], string> = {
    queued: '等待运行',
    running: '正在运行',
    paused: '已暂停',
    completed: '运行完成',
    failed: '运行失败',
    cancelled: '已取消',
  }
  return labels[status]
}

export function CanvasWorkflowRunPanel({
  open,
  projectId,
  workflow,
  availableInputNodes = [],
  onClose,
  onExecute,
}: {
  open: boolean
  projectId: string
  workflow: CanvasWorkflowDefinition | null
  availableInputNodes?: CanvasWorkflowInputNodeOption[]
  onClose: () => void
  onExecute: (input: CanvasWorkflowRunExecutionInput) => Promise<CanvasWorkflowRun>
}) {
  const [inputValues, setInputValues] = useState<Record<string, string>>({})
  const [paramValues, setParamValues] = useState<Record<string, string | boolean>>({})
  const [run, setRun] = useState<CanvasWorkflowRun | null>(null)
  const [recoverableRun, setRecoverableRun] = useState<CanvasWorkflowRun | null>(null)
  const [plan, setPlan] = useState<Readonly<CanvasWorkflowExecutionPlan> | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [preflightLoading, setPreflightLoading] = useState(false)
  const [preflightIssues, setPreflightIssues] = useState<string[]>([])
  const closeRef = useRef<HTMLButtonElement>(null)
  const dialogRef = useRef<HTMLElement>(null)
  const abortRef = useRef<AbortController | null>(null)
  useCanvasWorkflowDialogFocus(dialogRef, open)

  useEffect(() => {
    if (!open || !workflow) return
    setInputValues(
      Object.fromEntries(workflow.package.contract.inputs.map((input) => [input.id, ''])),
    )
    setParamValues(
      Object.fromEntries(
        workflow.package.contract.exposedParams.map((param) => [
          param.id,
          initialParamValue(param.defaultValue, param.valueType),
        ]),
      ),
    )
    setRun(null)
    setRecoverableRun(null)
    setPlan(null)
    setBusy(false)
    setError('')
  }, [open, workflow])

  useEffect(() => {
    if (!open || !workflow) return
    let active = true
    void canvasWorkflowApi
      .listRuns({ projectId, workflowId: workflow.id, limit: 20, offset: 0 })
      .then((items) => {
        if (!active) return
        setRecoverableRun(
          items.find((item) => item.status === 'failed' || item.status === 'paused') ?? null,
        )
      })
      .catch(() => {
        if (active) setRecoverableRun(null)
      })
    return () => {
      active = false
    }
  }, [open, projectId, workflow])

  useEffect(() => {
    if (!open || !workflow || !window.spark?.invoke) return
    let active = true
    setPreflightLoading(true)
    void Promise.all([
      window.spark.invoke('provider:list', {}),
      window.spark.invoke('canvas:media-capabilities:list', {}),
    ])
      .then(([providerResponse, mediaResponse]) => {
        if (!active) return
        const requiredProviders = workflow.package.graph.nodes.map((node) => ({
          nodeLabel: node.label,
          ...(typeof node.config.providerProfileId === 'string'
            ? { providerProfileId: node.config.providerProfileId }
            : {}),
          ...(typeof node.config.modelId === 'string' ? { modelId: node.config.modelId } : {}),
        }))
        setPreflightIssues(
          checkCanvasWorkflowDependencies({
            requiredCapabilities: workflow.package.dependencies.modelCapabilities,
            requiredProviders,
            textProviders: providerResponse.profiles.map((provider) => ({
              id: provider.id,
              ...(provider.modelType ? { modelType: provider.modelType } : {}),
              modelIds: provider.modelIds,
              defaultModel: provider.defaultModel,
            })),
            mediaProviders: mediaResponse.providers.map((provider) => ({
              providerProfileId: provider.providerProfileId,
              mediaCapabilities: provider.mediaCapabilities,
            })),
          }),
        )
      })
      .catch((preflightError) => {
        if (active) {
          setPreflightIssues([
            preflightError instanceof Error ? preflightError.message : '无法检查 Provider 依赖',
          ])
        }
      })
      .finally(() => {
        if (active) setPreflightLoading(false)
      })
    return () => {
      active = false
    }
  }, [open, workflow])

  const completedCount = useMemo(
    () => run?.steps.filter((step) => step.status === 'completed' || step.status === 'skipped').length ?? 0,
    [run],
  )

  if (!open || !workflow) return null

  const startRun = async () => {
    if (preflightIssues.length > 0) {
      setError('请先补齐运行前检查中的 Provider 或模型依赖')
      return
    }
    const missing = workflow.package.contract.inputs.find(
      (input) => input.required && !(inputValues[input.id] ?? '').trim(),
    )
    if (missing) {
      setError(`请填写必填输入“${missing.name}”`)
      return
    }

    const inputs: Record<string, unknown> = {}
    try {
      for (const input of workflow.package.contract.inputs) {
        const value = inputValues[input.id] ?? ''
        if (input.valueType === 'structured' && value.trim()) {
          inputs[input.id] = JSON.parse(value)
        } else if (value.trim()) {
          inputs[input.id] = value
        }
      }
    } catch {
      setError('结构化输入必须是有效 JSON')
      return
    }

    const exposedParams: Record<string, unknown> = {}
    for (const param of workflow.package.contract.exposedParams) {
      const value = paramValues[param.id]
      if (param.valueType === 'number') {
        const numberValue = Number(value)
        if (!Number.isFinite(numberValue)) {
          setError(`参数“${param.name}”必须是数字`)
          return
        }
        exposedParams[param.id] = numberValue
      } else {
        exposedParams[param.id] = value
      }
    }

    setBusy(true)
    setError('')
    const controller = new AbortController()
    abortRef.current = controller
    let createdRun: CanvasWorkflowRun | null = null
    try {
      const created = await canvasWorkflowApi.createRun({
        workflowId: workflow.id,
        projectId,
        inputs,
        exposedParams,
        idempotencyKey: `${projectId}:${workflow.id}:${crypto.randomUUID()}`,
      })
      createdRun = created.run
      setRun(created.run)
      setPlan(created.plan)
      const completed = await onExecute({
        workflow,
        run: created.run,
        plan: created.plan,
        signal: controller.signal,
      })
      setRun(completed)
      setRecoverableRun(null)
    } catch (runError) {
      setError(runError instanceof Error ? runError.message : '画布工作流运行失败')
      const latest = createdRun
        ? await canvasWorkflowApi.getRun(createdRun.id).catch(() => null)
        : null
      if (latest) setRun(latest)
    } finally {
      abortRef.current = null
      setBusy(false)
    }
  }

  const cancel = async () => {
    abortRef.current?.abort()
    if (!run) return
    const cancelled = await canvasWorkflowApi.cancelRun(run.id)
    setRun(cancelled)
  }

  const retry = async (nodeId: string) => {
    if (!run || !plan) return
    setBusy(true)
    setError('')
    const controller = new AbortController()
    abortRef.current = controller
    try {
      const retried = await canvasWorkflowApi.retryRunStep(run.id, nodeId)
      setRun(retried)
      setRun(await onExecute({ workflow, run: retried, plan, signal: controller.signal }))
    } catch (retryError) {
      setError(retryError instanceof Error ? retryError.message : '重试失败')
    } finally {
      abortRef.current = null
      setBusy(false)
    }
  }

  const resume = async () => {
    if (!recoverableRun) return
    setBusy(true)
    setError('')
    const controller = new AbortController()
    abortRef.current = controller
    try {
      const resumed = await canvasWorkflowApi.resumeRun(recoverableRun.id)
      setRun(resumed.run)
      setPlan(resumed.plan)
      setRecoverableRun(null)
      setRun(
        await onExecute({
          workflow,
          run: resumed.run,
          plan: resumed.plan,
          signal: controller.signal,
        }),
      )
    } catch (resumeError) {
      setError(resumeError instanceof Error ? resumeError.message : '恢复运行失败')
    } finally {
      abortRef.current = null
      setBusy(false)
    }
  }

  return (
    <div className="canvas-workflow-run-layer">
      <button
        type="button"
        className="canvas-workflow-run-scrim"
        aria-label="关闭画布工作流运行面板遮罩"
        tabIndex={-1}
        onClick={busy ? undefined : onClose}
      />
      <aside
        ref={dialogRef}
        className="canvas-workflow-run-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="canvas-workflow-run-title"
      >
        <header>
          <div>
            <span>运行 v{workflow.version}</span>
            <h2 id="canvas-workflow-run-title">{workflow.name}</h2>
            <p>{workflow.description || '配置输入并将产物生成到当前画布'}</p>
          </div>
          <button ref={closeRef} data-dialog-initial-focus type="button" aria-label="关闭运行面板" disabled={busy} onClick={onClose}>
            <Icons.X size={16} />
          </button>
        </header>

        <div className="canvas-workflow-run-body">
          {workflow.package.contract.inputs.length > 0 && (
            <section>
              <h3>输入</h3>
              {workflow.package.contract.inputs.map((input) => {
                const usesCanvasNode = ['image', 'video', 'audio', 'file', 'asset', 'node'].includes(
                  input.valueType,
                )
                const compatibleNodes = availableInputNodes.filter((node) =>
                  node.valueTypes.includes(input.valueType),
                )
                return <label key={input.id}>
                  <span>{input.name}{input.required ? ' *' : ''}</span>
                  <small>{input.valueType}</small>
                  {usesCanvasNode ? (
                    <select
                      aria-label={input.name}
                      value={inputValues[input.id] ?? ''}
                      onChange={(event) =>
                        setInputValues((current) => ({ ...current, [input.id]: event.target.value }))
                      }
                    >
                      <option value="">
                        {compatibleNodes.length > 0 ? '选择画布节点' : '当前画布没有兼容节点'}
                      </option>
                      {compatibleNodes.map((node) => (
                        <option key={node.id} value={node.id}>{node.label}</option>
                      ))}
                    </select>
                  ) : (
                    <textarea
                      aria-label={input.name}
                      rows={input.valueType === 'structured' ? 4 : 2}
                      value={inputValues[input.id] ?? ''}
                      placeholder={input.valueType === 'structured' ? '{ }' : '输入内容'}
                      onChange={(event) =>
                        setInputValues((current) => ({ ...current, [input.id]: event.target.value }))
                      }
                    />
                  )}
                </label>
              })}
            </section>
          )}

          {workflow.package.contract.exposedParams.length > 0 && (
            <section>
              <h3>参数</h3>
              {workflow.package.contract.exposedParams.map((param) => (
                <label key={param.id} className={param.valueType === 'boolean' ? 'is-toggle' : ''}>
                  <span>{param.name}</span>
                  {param.valueType === 'boolean' ? (
                    <input
                      type="checkbox"
                      aria-label={param.name}
                      checked={paramValues[param.id] === true}
                      onChange={(event) =>
                        setParamValues((current) => ({ ...current, [param.id]: event.target.checked }))
                      }
                    />
                  ) : (
                    <input
                      type={param.valueType === 'number' ? 'number' : 'text'}
                      aria-label={param.name}
                      value={String(paramValues[param.id] ?? '')}
                      onChange={(event) =>
                        setParamValues((current) => ({ ...current, [param.id]: event.target.value }))
                      }
                    />
                  )}
                </label>
              ))}
            </section>
          )}

          <section className="canvas-workflow-run-dependencies">
            <h3>运行前检查</h3>
            <div>
              <Icons.Check size={14} />
              <span>{workflow.package.graph.nodes.length} 个节点，DAG 定义将在提交前校验</span>
            </div>
            {workflow.package.dependencies.modelCapabilities.map((capability) => (
              <div key={capability}><Icons.Cpu size={14} /><span>{capability}</span></div>
            ))}
            {preflightLoading && <div><span>正在检查 Provider 与模型能力…</span></div>}
            {preflightIssues.map((issue) => (
              <div key={issue} className="is-error"><Icons.AlertTriangle size={14} /><span>{issue}</span></div>
            ))}
          </section>

          {run && (
            <section className="canvas-workflow-run-progress" aria-live="polite">
              <div>
                <h3>{runStatusLabel(run.status)}</h3>
                <span>{completedCount} / {run.steps.length}</span>
              </div>
              <progress max={Math.max(run.steps.length, 1)} value={completedCount} />
              {run.steps.map((step) => (
                <div key={step.id} className={`is-${step.status}`}>
                  <span>{workflow.package.graph.nodes.find((node) => node.id === step.nodeId)?.label ?? step.nodeId}</span>
                  <em>{step.status}</em>
                  {step.status === 'failed' && (
                    <button type="button" disabled={busy} onClick={() => void retry(step.nodeId)}>
                      <Icons.RotateCcw size={13} /> 重试
                    </button>
                  )}
                </div>
              ))}
            </section>
          )}

          {error && <div className="canvas-workflow-run-error" role="alert">{error}</div>}
        </div>

        <footer>
          {busy ? (
            <button type="button" aria-label="取消画布工作流运行" onClick={() => void cancel()}>
              <Icons.Square size={14} /> 取消运行
            </button>
          ) : (
            <>
              {recoverableRun && (
                <button
                  type="button"
                  aria-label="恢复上次画布工作流运行"
                  disabled={preflightLoading || preflightIssues.length > 0}
                  onClick={() => void resume()}
                >
                  <Icons.RotateCcw size={14} /> 恢复上次运行
                </button>
              )}
              <button
                type="button"
                className="is-primary"
                aria-label="运行画布工作流"
                disabled={preflightLoading || preflightIssues.length > 0}
                onClick={() => void startRun()}
              >
                <Icons.Play size={14} /> {run?.status === 'completed' ? '再次运行' : '运行到画布'}
              </button>
            </>
          )}
        </footer>
      </aside>
    </div>
  )
}

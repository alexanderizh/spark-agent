import type { CanvasSnapshot, CanvasTask } from '../canvas.types'
import { resolveCanvasOperationInputNodes } from '../canvasOperationOutputModel'
import {
  appendCanvasAcceptanceRunnerEvidence,
  captureCanvasAcceptanceTaskEvidence,
  createCanvasAcceptanceAttempt,
  readCanvasAcceptanceEvidence,
} from './canvasAcceptanceEvidence'
import {
  persistCanvasAcceptanceEvidence,
  type CanvasAcceptancePersistenceResult,
} from './canvasAcceptancePersistence'
import type { CanvasAcceptanceCasePlan, CanvasAcceptancePlan } from './canvasAcceptanceTypes'

const POLL_INTERVAL_MS = 1_000

export type CanvasAcceptanceRunCaseResult = {
  caseId: string
  status: 'passed' | 'failed' | 'blocked' | 'skipped' | 'cancelled'
  taskId?: string
  error?: string
}

export type CanvasAcceptanceRunProgress = {
  currentCaseId: string | null
  completedCases: number
  totalCases: number
  results: CanvasAcceptanceRunCaseResult[]
}

type AcceptanceRunnerApi = {
  openSnapshot(projectId: string, boardId?: string | null): Promise<CanvasSnapshot>
  runOperationNode(
    projectId: string,
    nodeId: string,
    params: {
      prompt: string
      negativePrompt?: string
      inputNodeIds?: string[]
      agentId?: string
      providerProfileId?: string
      manifestId?: string
      modelId?: string
      reasoningEffort?: CanvasTask['reasoningEffort'] extends infer T ? Exclude<T, null | undefined> : never
      modelParams?: Record<string, unknown>
      skillIds?: string[]
      shotScriptConfig?: { maxClipSec: number }
    },
  ): Promise<CanvasSnapshot>
  retryOperationNode?(
    projectId: string,
    nodeId: string,
    options?: {
      sourceTaskId?: string
      runtimeSource?: 'current-node' | 'original-task'
    },
  ): Promise<CanvasSnapshot>
  cancelTask(projectId: string, taskId: string): Promise<CanvasSnapshot>
}

export async function runCanvasAcceptancePlan(input: {
  api: AcceptanceRunnerApi
  projectId: string
  boardId: string
  plan: CanvasAcceptancePlan
  caseNodeIds: Record<string, string>
  project?: { id: string; title: string; rootPath?: string | null }
  caseIds?: readonly string[]
  retryExisting?: boolean
  signal?: AbortSignal
  onProgress?: (progress: CanvasAcceptanceRunProgress) => void
  onEvidencePersistence?: (result: CanvasAcceptancePersistenceResult) => void
  pollIntervalMs?: number
}): Promise<CanvasAcceptanceRunCaseResult[]> {
  const results: CanvasAcceptanceRunCaseResult[] = []
  const statusByCase = new Map<string, CanvasAcceptanceRunCaseResult['status']>()
  const selectedCaseIds = input.caseIds ? new Set(input.caseIds) : null
  const casesToRun = selectedCaseIds
    ? input.plan.cases.filter((casePlan) => selectedCaseIds.has(casePlan.caseId))
    : input.plan.cases
  const emit = (caseId: string | null): void => {
    input.onProgress?.({
      currentCaseId: caseId,
      completedCases: results.length,
      totalCases: casesToRun.length,
      results: [...results],
    })
  }

  for (const casePlan of casesToRun) {
    if (input.signal?.aborted) break
    const attempt = createCanvasAcceptanceAttempt(input.plan.runId, casePlan.caseId)
    emit(casePlan.caseId)
    const dependencyFailure = casePlan.dependsOnCaseIds.find((caseId) => {
      const status = statusByCase.get(caseId)
      return status != null && status !== 'passed' && status !== 'skipped'
    })
    if (dependencyFailure) {
      appendCanvasAcceptanceRunnerEvidence({
        runId: input.plan.runId,
        casePlan,
        operationNodeId: input.caseNodeIds[casePlan.caseId] ?? null,
        taskStatus: 'pending',
        stage: 'blocked_by_upstream',
        preCall: { dependsOnCaseIds: casePlan.dependsOnCaseIds },
        assertions: [
          {
            id: 'preflight.upstream',
            status: 'failed',
            message: `上游 ${dependencyFailure} 未通过，未发起真实调用`,
          },
        ],
        attempt,
      })
      pushResult({
        caseId: casePlan.caseId,
        status: 'blocked',
        error: `blocked_by_upstream:${dependencyFailure}`,
      })
      continue
    }
    if (casePlan.blockedReasons.length > 0) {
      appendCanvasAcceptanceRunnerEvidence({
        runId: input.plan.runId,
        casePlan,
        operationNodeId: input.caseNodeIds[casePlan.caseId] ?? null,
        taskStatus: 'pending',
        stage: 'preflight_blocked',
        preCall: { target: casePlan.target, blockedReasons: casePlan.blockedReasons },
        assertions: casePlan.blockedReasons.map((reason) => ({
          id: `preflight.${reason.split(':')[0]}`,
          status: 'failed' as const,
          message: reason,
        })),
        attempt,
      })
      pushResult({
        caseId: casePlan.caseId,
        status: 'blocked',
        error: casePlan.blockedReasons.join(','),
      })
      continue
    }
    const nodeId = input.caseNodeIds[casePlan.caseId]
    if (!nodeId) {
      appendCanvasAcceptanceRunnerEvidence({
        runId: input.plan.runId,
        casePlan,
        taskStatus: 'failed',
        stage: 'operation_node_missing',
        assertions: [
          {
            id: 'canvas.operation_node',
            status: 'failed',
            message: '验收计划中的操作节点未在画布中找到',
          },
        ],
        attempt,
      })
      pushResult({ caseId: casePlan.caseId, status: 'failed', error: 'operation_node_missing' })
      continue
    }

    try {
      const before = await input.api.openSnapshot(input.projectId, input.boardId)
      const node = before.nodes.find((item) => item.id === nodeId && !item.hidden)
      if (!node) throw new Error('operation_node_missing')
      const existingTask = node.taskId
        ? before.tasks.find((task) => task.id === node.taskId)
        : null
      if (existingTask?.status === 'completed') {
        if (!input.retryExisting) {
          const existingEvidence = captureCanvasAcceptanceTaskEvidence({
            snapshot: before,
            taskId: existingTask.id,
            source: 'manual-verification',
          })
          const failedAssertions = existingEvidence?.assertions.filter(
            (assertion) => assertion.status === 'failed',
          )
          if (failedAssertions && failedAssertions.length > 0) {
            pushResult({
              caseId: casePlan.caseId,
              status: 'failed',
              taskId: existingTask.id,
              error: `acceptance_assertion_failed:${failedAssertions.map((item) => item.id).join(',')}`,
            })
          } else {
            pushResult({ caseId: casePlan.caseId, status: 'skipped', taskId: existingTask.id })
          }
          continue
        }
      }
      const configurationDrift = detectCanvasAcceptanceConfigurationDrift(casePlan, node.data)
      if (configurationDrift.length > 0) {
        appendCanvasAcceptanceRunnerEvidence({
          runId: input.plan.runId,
          casePlan,
          operationNodeId: node.id,
          ...(existingTask?.id ? { taskId: existingTask.id } : {}),
          taskStatus: 'pending',
          stage: 'preflight_config_drift',
          preCall: {
            frozenTarget: casePlan.target,
            currentTarget: {
              providerProfileId: node.data.providerProfileId,
              manifestId: node.data.manifestId,
              modelId: node.data.modelId,
            },
          },
          assertions: configurationDrift.map((reason) => ({
            id: `preflight.config_drift.${reason.field}`,
            status: 'failed' as const,
            message: `${reason.field} 已从 ${reason.expected} 变为 ${reason.actual}，为避免调用错误渠道已阻断`,
          })),
          attempt,
        })
        pushResult({
          caseId: casePlan.caseId,
          status: 'blocked',
          error: `preflight_config_drift:${configurationDrift.map((item) => item.field).join(',')}`,
        })
        continue
      }
      const inputNodeIds = resolveAcceptanceRuntimeInputNodeIds(before, node.id)
      appendCanvasAcceptanceRunnerEvidence({
        runId: input.plan.runId,
        casePlan,
        operationNodeId: node.id,
        ...(existingTask?.id ? { taskId: existingTask.id } : {}),
        taskStatus: 'pending',
        stage: 'preflight_passed',
        preCall: {
          providerProfileId: node.data.providerProfileId,
          manifestId: node.data.manifestId,
          modelId: node.data.modelId,
          operation: node.data.operation ?? node.type,
          prompt: node.data.prompt,
          systemPrompt: node.data.systemPrompt,
          negativePrompt: node.data.negativePrompt,
          modelParams: node.data.modelParams,
          inputNodeIds,
          expectedEvidence: casePlan.expectedEvidence,
        },
        assertions: [
          { id: 'preflight.plan', status: 'passed', message: '冻结验收计划已通过' },
          { id: 'preflight.provider', status: 'passed', message: casePlan.target?.providerName ?? '' },
          { id: 'preflight.model', status: 'passed', message: casePlan.target?.modelId ?? '' },
        ],
        attempt,
      })
      const started =
        input.retryExisting && existingTask
          ? await retryExistingTask(input.api, input.projectId, node.id, existingTask.id)
          : await input.api.runOperationNode(input.projectId, node.id, {
              prompt: node.data.prompt ?? '',
              ...(node.data.negativePrompt ? { negativePrompt: node.data.negativePrompt } : {}),
              inputNodeIds,
              ...(node.data.agentId ? { agentId: node.data.agentId } : {}),
              ...(node.data.providerProfileId
                ? { providerProfileId: node.data.providerProfileId }
                : {}),
              ...(node.data.manifestId ? { manifestId: node.data.manifestId } : {}),
              ...(node.data.modelId ? { modelId: node.data.modelId } : {}),
              ...(node.data.reasoningEffort
                ? { reasoningEffort: node.data.reasoningEffort }
                : {}),
              ...(node.data.modelParams ? { modelParams: node.data.modelParams } : {}),
              ...(node.data.skillIds ? { skillIds: node.data.skillIds } : {}),
              ...(node.data.shotScriptConfig
                ? { shotScriptConfig: node.data.shotScriptConfig }
                : {}),
            })
      const startedNode = started.nodes.find((item) => item.id === node.id)
      const taskId = startedNode?.taskId
      if (!taskId) throw new Error('runtime_task_missing_after_submit')
      captureCanvasAcceptanceTaskEvidence({
        snapshot: started,
        taskId,
        source: 'manual-verification',
        attempt,
      })
      const terminal = await waitForTerminalTask({
        api: input.api,
        projectId: input.projectId,
        boardId: input.boardId,
        taskId,
        casePlan,
        ...(input.signal ? { signal: input.signal } : {}),
        pollIntervalMs: input.pollIntervalMs ?? POLL_INTERVAL_MS,
      })
      const terminalEvidence = captureCanvasAcceptanceTaskEvidence({
        snapshot: terminal.snapshot,
        taskId,
        source: 'manual-verification',
        attempt,
      })
      if (terminal.task.status === 'completed') {
        const failedAssertions = terminalEvidence?.assertions.filter(
          (assertion) => assertion.status === 'failed',
        )
        if (failedAssertions && failedAssertions.length > 0) {
          pushResult({
            caseId: casePlan.caseId,
            status: 'failed',
            taskId,
            error: `acceptance_assertion_failed:${failedAssertions.map((item) => item.id).join(',')}`,
          })
        } else {
          pushResult({ caseId: casePlan.caseId, status: 'passed', taskId })
        }
      } else if (terminal.task.status === 'cancelled') {
        pushResult({ caseId: casePlan.caseId, status: 'cancelled', taskId })
      } else {
        pushResult({
          caseId: casePlan.caseId,
          status: 'failed',
          taskId,
          error: terminal.task.errorDetail ?? terminal.task.errorMsg ?? 'task_failed',
        })
      }
    } catch (error) {
      appendCanvasAcceptanceRunnerEvidence({
        runId: input.plan.runId,
        casePlan,
        operationNodeId: input.caseNodeIds[casePlan.caseId] ?? null,
        taskStatus: input.signal?.aborted ? 'cancelled' : 'failed',
        stage: input.signal?.aborted ? 'cancelled' : 'submit_or_wait_failed',
        providerResult: {
          error: error instanceof Error ? error.message : String(error),
        },
        assertions: [
          {
            id: 'evidence.runner_failure',
            status: 'passed',
            message: 'Runner 已保存调用前或等待终态异常',
          },
          {
            id: 'runtime.completed',
            status: 'failed',
            message: error instanceof Error ? error.message : String(error),
          },
        ],
        attempt,
      })
      pushResult({
        caseId: casePlan.caseId,
        status: input.signal?.aborted ? 'cancelled' : 'failed',
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }
  if (input.project) {
    const persistence = await persistCanvasAcceptanceEvidence({
      project: input.project,
      plan: input.plan,
      evidence: readCanvasAcceptanceEvidence(input.plan.runId),
    })
    input.onEvidencePersistence?.(persistence)
  }
  emit(null)
  return results

  function pushResult(result: CanvasAcceptanceRunCaseResult): void {
    results.push(result)
    statusByCase.set(result.caseId, result.status)
    emit(result.caseId)
  }
}

async function retryExistingTask(
  api: AcceptanceRunnerApi,
  projectId: string,
  nodeId: string,
  sourceTaskId: string,
): Promise<CanvasSnapshot> {
  if (!api.retryOperationNode) throw new Error('retry_operation_node_unavailable')
  return api.retryOperationNode(projectId, nodeId, {
    sourceTaskId,
    runtimeSource: 'current-node',
  })
}

export function resolveAcceptanceRuntimeInputNodeIds(
  snapshot: CanvasSnapshot,
  operationNodeId: string,
): string[] {
  const sourceIds = snapshot.edges
    .filter(
      (edge) => edge.targetNodeId === operationNodeId && edge.type === 'used_as_input',
    )
    .map((edge) => edge.sourceNodeId)
  const resolved: string[] = []
  for (const sourceId of sourceIds) {
    const source = snapshot.nodes.find((node) => node.id === sourceId && !node.hidden)
    if (!source) continue
    if (!source.data.operation) {
      resolved.push(source.id)
      continue
    }
    const outputs = resolveCanvasOperationInputNodes(source, snapshot)
    if (outputs.length === 0) {
      const latestTask = snapshot.tasks
        .filter((task) => task.operationNodeId === source.id)
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0]
      if (latestTask?.status === 'completed') {
        throw new Error(`upstream_materialized_output_missing:${source.id}`)
      }
      resolved.push(source.id)
      continue
    }
    resolved.push(...outputs.map((output) => output.id))
  }
  return Array.from(new Set(resolved))
}

async function waitForTerminalTask(input: {
  api: AcceptanceRunnerApi
  projectId: string
  boardId: string
  taskId: string
  casePlan: CanvasAcceptanceCasePlan
  signal?: AbortSignal
  pollIntervalMs: number
}): Promise<{ snapshot: CanvasSnapshot; task: CanvasTask }> {
  const startedAt = Date.now()
  const timeoutMs = timeoutForCase(input.casePlan)
  while (true) {
    if (input.signal?.aborted) {
      const cancelled = await input.api.cancelTask(input.projectId, input.taskId)
      const task = cancelled.tasks.find((item) => item.id === input.taskId)
      if (!task) throw new Error('cancelled_task_missing')
      return { snapshot: cancelled, task }
    }
    const snapshot = await input.api.openSnapshot(input.projectId, input.boardId)
    const task = snapshot.tasks.find((item) => item.id === input.taskId)
    if (!task) throw new Error('runtime_task_disappeared')
    if (task.status === 'completed' || task.status === 'failed' || task.status === 'cancelled') {
      return { snapshot, task }
    }
    if (Date.now() - startedAt >= timeoutMs) {
      let timeoutSnapshot = snapshot
      let timeoutTask = task
      try {
        const cancelled = await input.api.cancelTask(input.projectId, input.taskId)
        timeoutSnapshot = cancelled
        timeoutTask = cancelled.tasks.find((item) => item.id === input.taskId) ?? task
      } catch {
        // 即使本地取消失败，也必须把 timeout 作为独立终态证据返回给验收 Runner。
      }
      return {
        snapshot: timeoutSnapshot,
        task: {
          ...timeoutTask,
          status: 'failed',
          errorMsg: 'acceptance_timeout',
          errorDetail: `验收 Runner 等待任务终态超过 ${timeoutMs}ms`,
        },
      }
    }
    await delay(input.pollIntervalMs)
  }
}

function timeoutForCase(casePlan: CanvasAcceptanceCasePlan): number {
  if (casePlan.targetKind === 'video') return 60 * 60 * 1_000
  if (casePlan.targetKind === 'image' || casePlan.targetKind === 'audio') return 20 * 60 * 1_000
  return 10 * 60 * 1_000
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function detectCanvasAcceptanceConfigurationDrift(
  casePlan: CanvasAcceptanceCasePlan,
  nodeData: CanvasSnapshot['nodes'][number]['data'],
): Array<{ field: 'providerProfileId' | 'manifestId' | 'modelId'; expected: string; actual: string }> {
  const target = casePlan.target
  if (!target) return []
  const comparisons = [
    {
      field: 'providerProfileId' as const,
      expected: target.providerProfileId,
      actual: nodeData.providerProfileId ?? '(missing)',
    },
    {
      field: 'modelId' as const,
      expected: target.modelId,
      actual: nodeData.modelId ?? '(missing)',
    },
    ...(target.manifestId
      ? [{
          field: 'manifestId' as const,
          expected: target.manifestId,
          actual: nodeData.manifestId ?? '(missing)',
        }]
      : []),
  ]
  return comparisons.filter((item) => item.actual !== item.expected)
}

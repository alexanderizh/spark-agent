import type {
  CanvasNodeData,
  CanvasPipelineRole,
  CanvasTask,
  CanvasTaskRuntimeEvent,
} from './canvas.types'
import type { SessionReasoningEffort } from '@spark/protocol'

const MAX_TASK_RUNTIME_EVENTS = 100

export function initialCanvasTaskRuntimeEvents(
  at: string,
  label = '任务创建',
): CanvasTaskRuntimeEvent[] {
  return [{ at, kind: 'created', label }]
}

export function appendCanvasTaskRuntimeEvent(
  task: Pick<CanvasTask, 'runtimeEvents'>,
  event: CanvasTaskRuntimeEvent,
): void {
  const events = [...(task.runtimeEvents ?? []), event]
  task.runtimeEvents = events.slice(-MAX_TASK_RUNTIME_EVENTS)
}

export function appendCanvasTaskModelOutputEvent(
  task: Pick<CanvasTask, 'runtimeEvents'>,
  at: string,
  text: string,
): void {
  appendCanvasTaskRuntimeEvent(task, {
    at,
    kind: 'provider_response',
    label: '模型返回原始文本',
    detail: `${text.length} 字符`,
  })
}

export function syncCanvasNodeRuntimeData(
  data: CanvasNodeData,
  runtime: {
    agentId?: string | null
    providerProfileId?: string | null
    manifestId?: string | null
    modelId?: string | null
    reasoningEffort?: SessionReasoningEffort | null
    skillIds?: string[] | null
    modelParams?: Record<string, unknown> | null
    taskPipelineRole?: CanvasPipelineRole | null
    outputPipelineRole?: CanvasPipelineRole | null
  },
): void {
  syncOptionalString(data, 'agentId', runtime.agentId)
  syncOptionalString(data, 'providerProfileId', runtime.providerProfileId)
  syncOptionalString(data, 'manifestId', runtime.manifestId)
  syncOptionalString(data, 'modelId', runtime.modelId)
  if (runtime.reasoningEffort) data.reasoningEffort = runtime.reasoningEffort
  else delete data.reasoningEffort
  data.skillIds = [...(runtime.skillIds ?? [])]
  data.modelParams = { ...(runtime.modelParams ?? {}) }
  if (runtime.taskPipelineRole) data.pipelineRole = runtime.taskPipelineRole
  else delete data.pipelineRole
  if (runtime.outputPipelineRole) data.outputPipelineRole = runtime.outputPipelineRole
  else delete data.outputPipelineRole
}

export function syncCanvasTaskRuntimeToNode(task: CanvasTask, data: CanvasNodeData): void {
  syncCanvasNodeRuntimeData(data, {
    agentId: task.agentId ?? null,
    providerProfileId: task.providerProfileId ?? null,
    manifestId: task.manifestId ?? null,
    modelId: task.modelId ?? null,
    reasoningEffort: task.reasoningEffort ?? null,
    skillIds: task.skillIds ?? [],
    modelParams: task.modelParams,
    // Legacy tasks predate persisted role fields. Preserve the node's semantic roles
    // for those records; new tasks explicitly store null when a role should be cleared.
    taskPipelineRole:
      task.taskPipelineRole === undefined ? (data.pipelineRole ?? null) : task.taskPipelineRole,
    outputPipelineRole:
      task.outputPipelineRole === undefined
        ? (data.outputPipelineRole ?? null)
        : task.outputPipelineRole,
  })
}

function syncOptionalString(
  data: CanvasNodeData,
  key: 'agentId' | 'providerProfileId' | 'manifestId' | 'modelId',
  value: string | null | undefined,
): void {
  const normalized = value?.trim() ?? ''
  if (normalized) data[key] = normalized
  else delete data[key]
}

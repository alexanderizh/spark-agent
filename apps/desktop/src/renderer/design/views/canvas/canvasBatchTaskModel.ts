import { isOperationNode } from './canvas.capabilities'
import type {
  CanvasNode,
  CanvasNodeData,
  CanvasOperationType,
} from './canvas.types'

export type CanvasBatchEditableData = Pick<
  CanvasNodeData,
  | 'agentId'
  | 'providerProfileId'
  | 'manifestId'
  | 'modelId'
  | 'reasoningEffort'
  | 'skillIds'
  | 'modelParams'
>

export type CanvasBatchTaskPatch = {
  touched: string[]
  values: CanvasBatchEditableData
}

export type CanvasBatchTaskEntry = {
  nodeId: string
  title: string
  operation: CanvasOperationType
  baseUpdatedAt: string
  base: CanvasBatchEditableData
  draft: CanvasBatchEditableData
  touchedFields: Set<string>
}

export type CanvasBatchTaskSession = {
  entries: CanvasBatchTaskEntry[]
  activeOperation: CanvasOperationType
  activeNodeId: string | null
}

export type CanvasBatchTaskSelectionSummary = {
  canBatchConfigure: boolean
  canBatchSubmit: boolean
  configureReason: string | null
  submitReason: string | null
  taskNodeIds: string[]
  operationCount: number
}

type CanvasBatchSelectionNode = Pick<CanvasNode, 'id' | 'type'> & {
  data?: Pick<CanvasNodeData, 'operation' | 'status'>
}

const EDITABLE_FIELDS: Array<keyof CanvasBatchEditableData> = [
  'agentId',
  'providerProfileId',
  'manifestId',
  'modelId',
  'reasoningEffort',
  'skillIds',
  'modelParams',
]

export function summarizeBatchTaskSelection(
  nodes: CanvasBatchSelectionNode[],
): CanvasBatchTaskSelectionSummary {
  const taskNodes = nodes.filter(isOperationNode)
  const taskNodeIds = taskNodes.map((node) => node.id)
  const operationCount = new Set(taskNodes.map(nodeOperation)).size
  const enoughNodes = nodes.length >= 2
  const allTasks = enoughNodes && taskNodes.length === nodes.length
  const selectionReason = allTasks
    ? null
    : !enoughNodes
      ? '请至少选择两个任务节点'
      : '仅支持同时选择任务节点'
  const hasRunningTask = taskNodes.some((node) => node.data?.status === 'running')

  return {
    canBatchConfigure: allTasks,
    canBatchSubmit: allTasks && !hasRunningTask,
    configureReason: selectionReason,
    submitReason:
      selectionReason ??
      (hasRunningTask ? '选中任务包含正在运行的节点' : null),
    taskNodeIds,
    operationCount,
  }
}

export function createCanvasBatchTaskSession(nodes: CanvasNode[]): CanvasBatchTaskSession {
  const entries = nodes.filter(isOperationNode).map((node) => {
    const editable = readEditableData(node.data)
    return {
      nodeId: node.id,
      title: node.title?.trim() || node.id,
      operation: nodeOperation(node),
      baseUpdatedAt: node.updatedAt,
      base: cloneEditableData(editable),
      draft: cloneEditableData(editable),
      touchedFields: new Set<string>(),
    }
  })
  const first = entries[0]
  if (!first) throw new Error('批量任务会话至少需要一个任务节点')
  return {
    entries,
    activeOperation: first.operation,
    activeNodeId: null,
  }
}

export function patchCanvasBatchTaskGroup(
  session: CanvasBatchTaskSession,
  operation: CanvasOperationType,
  patch: CanvasBatchTaskPatch,
): CanvasBatchTaskSession {
  return {
    ...session,
    entries: session.entries.map((entry) =>
      entry.operation === operation ? patchEntry(entry, patch) : entry,
    ),
  }
}

export function patchCanvasBatchTaskNode(
  session: CanvasBatchTaskSession,
  nodeId: string,
  patch: CanvasBatchTaskPatch,
): CanvasBatchTaskSession {
  return {
    ...session,
    entries: session.entries.map((entry) =>
      entry.nodeId === nodeId ? patchEntry(entry, patch) : entry,
    ),
  }
}

export function buildCanvasBatchNodeUpdates(
  session: CanvasBatchTaskSession,
): Array<{ nodeId: string; data: Partial<CanvasNodeData> }> {
  return session.entries.flatMap((entry) => {
    if (entry.touchedFields.size === 0) return []
    const data: Partial<CanvasNodeData> = {}
    let modelParamsTouched = false
    for (const field of entry.touchedFields) {
      if (field.startsWith('modelParams.')) {
        modelParamsTouched = true
        continue
      }
      if (isEditableField(field)) {
        assignEditableField(data, field, entry.draft[field])
      }
    }
    if (modelParamsTouched) {
      data.modelParams = { ...(entry.draft.modelParams ?? {}) }
    }
    return [{ nodeId: entry.nodeId, data }]
  })
}

export function findStaleCanvasBatchNodeIds(
  session: CanvasBatchTaskSession,
  currentNodes: CanvasNode[],
): string[] {
  const currentById = new Map(currentNodes.map((node) => [node.id, node]))
  return session.entries
    .filter((entry) => currentById.get(entry.nodeId)?.updatedAt !== entry.baseUpdatedAt)
    .map((entry) => entry.nodeId)
}

export function rebaseCanvasBatchTaskSession(
  session: CanvasBatchTaskSession,
  currentNodes: CanvasNode[],
): CanvasBatchTaskSession {
  const currentById = new Map(currentNodes.map((node) => [node.id, node]))
  const entries = session.entries.flatMap((entry) => {
    const node = currentById.get(entry.nodeId)
    if (!node || !isOperationNode(node)) return []
    const editable = readEditableData(node.data)
    return [
      {
        ...entry,
        title: node.title?.trim() || node.id,
        operation: nodeOperation(node),
        baseUpdatedAt: node.updatedAt,
        base: cloneEditableData(editable),
        draft: cloneEditableData(editable),
        touchedFields: new Set<string>(),
      },
    ]
  })
  return { ...session, entries }
}

export function refreshCanvasBatchTaskSession(
  session: CanvasBatchTaskSession,
  currentNodes: CanvasNode[],
): CanvasBatchTaskSession {
  const currentById = new Map(currentNodes.map((node) => [node.id, node]))
  const entries = session.entries.map((entry) => {
    const node = currentById.get(entry.nodeId)
    if (!node || !isOperationNode(node)) return entry
    const editable = readEditableData(node.data)
    const refreshed: CanvasBatchTaskEntry = {
      ...entry,
      title: node.title?.trim() || node.id,
      operation: nodeOperation(node),
      baseUpdatedAt: node.updatedAt,
      base: cloneEditableData(editable),
      draft: cloneEditableData(editable),
      touchedFields: new Set<string>(),
    }
    return patchEntry(refreshed, {
      touched: [...entry.touchedFields],
      values: entry.draft,
    })
  })
  return { ...session, entries }
}

function patchEntry(
  entry: CanvasBatchTaskEntry,
  patch: CanvasBatchTaskPatch,
): CanvasBatchTaskEntry {
  const draft = cloneEditableData(entry.draft)
  const touchedFields = new Set(entry.touchedFields)
  for (const field of patch.touched) {
    touchedFields.add(field)
    if (field.startsWith('modelParams.')) {
      const paramName = field.slice('modelParams.'.length)
      if (!paramName) continue
      const nextParams = { ...(draft.modelParams ?? {}) }
      const value = patch.values.modelParams?.[paramName]
      if (value === undefined || value === '') delete nextParams[paramName]
      else nextParams[paramName] = value
      draft.modelParams = nextParams
      continue
    }
    if (isEditableField(field)) {
      assignEditableField(draft, field, patch.values[field])
    }
  }
  return { ...entry, draft, touchedFields }
}

function nodeOperation(node: CanvasBatchSelectionNode): CanvasOperationType {
  return (node.data?.operation ?? node.type) as CanvasOperationType
}

function readEditableData(data: CanvasNodeData): CanvasBatchEditableData {
  const result: CanvasBatchEditableData = {}
  for (const field of EDITABLE_FIELDS) {
    assignEditableField(result, field, data[field])
  }
  return result
}

function cloneEditableData(data: CanvasBatchEditableData): CanvasBatchEditableData {
  return {
    ...data,
    ...(data.skillIds ? { skillIds: [...data.skillIds] } : {}),
    ...(data.modelParams ? { modelParams: { ...data.modelParams } } : {}),
  }
}

function isEditableField(field: string): field is keyof CanvasBatchEditableData {
  return (EDITABLE_FIELDS as string[]).includes(field)
}

function assignEditableField(
  target: CanvasBatchEditableData | Partial<CanvasNodeData>,
  field: keyof CanvasBatchEditableData,
  value: CanvasBatchEditableData[typeof field],
): void {
  ;(target as Record<string, unknown>)[field] =
    value === '' ? undefined : Array.isArray(value) ? [...value] : value
}

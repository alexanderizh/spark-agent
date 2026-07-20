import { appendCanvasTaskRuntimeEvent } from './canvasTaskLifecycle'
import type {
  CanvasAsset,
  CanvasEdge,
  CanvasNode,
  CanvasTask,
  CanvasTaskStatus,
} from './canvas.types'

type RecoverTaskOutputInput = {
  task: CanvasTask
  operationNode?: CanvasNode
  outputNodeIds?: Iterable<string>
  outputAssetIds?: Iterable<string>
  at: string
}

/**
 * Register materialized outputs and recover a timed-out/failed task once a usable
 * artifact has been attached to its operation node.
 */
export function recoverCanvasTaskFromMaterializedOutputs(input: RecoverTaskOutputInput): boolean {
  const { task, operationNode, at } = input
  task.outputNodeIds = mergeIds(task.outputNodeIds, input.outputNodeIds)
  task.outputAssetIds = mergeIds(task.outputAssetIds, input.outputAssetIds)
  task.updatedAt = at

  if (task.status !== 'failed' && task.status !== 'cancelled') return false
  if (task.outputNodeIds.length === 0 && task.outputAssetIds.length === 0) return false

  task.status = 'completed'
  task.progress = 100
  task.errorMsg = null
  task.errorDetail = null
  task.completedAt = at
  appendCanvasTaskRuntimeEvent(task, {
    at,
    kind: 'completed',
    label: '已关联可用产物，任务恢复为完成',
  })

  if (operationNode?.taskId === task.id) {
    operationNode.data = {
      ...operationNode.data,
      status: 'completed',
      progress: 100,
      message: `${task.outputNodeIds.length || task.outputAssetIds.length} 个产物已恢复`,
    }
    operationNode.updatedAt = at
  }
  return true
}

/**
 * Failed-task cleanup must not delete the only run record that indexes a
 * materialized artifact. Recover such records to completed and return the IDs
 * that are safe to delete because they have no surviving outputs.
 */
export function canvasTaskIdsSafeToDelete(input: {
  projectId: string
  taskIds: Iterable<string>
  tasks: CanvasTask[]
  nodes: CanvasNode[]
  assets: CanvasAsset[]
  edges: CanvasEdge[]
  at: string
}): Set<string> {
  const requested = new Set(input.taskIds)
  const nodesById = new Map(input.nodes.map((node) => [node.id, node]))
  const assetsById = new Map(input.assets.map((asset) => [asset.id, asset]))
  const safeToDelete = new Set<string>()

  for (const task of input.tasks) {
    if (task.projectId !== input.projectId || !requested.has(task.id)) continue

    const generatedEdges = input.edges.filter(
      (edge) =>
        edge.projectId === input.projectId &&
        edge.type === 'generated' &&
        edge.taskId === task.id,
    )
    const outputNodeIds = new Set(
      [...task.outputNodeIds, ...generatedEdges.map((edge) => edge.targetNodeId)].filter((id) =>
        nodesById.has(id),
      ),
    )
    const outputAssetIds = new Set(task.outputAssetIds.filter((id) => assetsById.has(id)))
    for (const nodeId of outputNodeIds) {
      const assetId = nodesById.get(nodeId)?.assetId
      if (assetId && assetsById.has(assetId)) outputAssetIds.add(assetId)
    }

    if (outputNodeIds.size === 0 && outputAssetIds.size === 0) {
      safeToDelete.add(task.id)
      continue
    }

    const generatedSourceId = generatedEdges[0]?.sourceNodeId
    const operationNode = input.nodes.find(
      (node) =>
        node.projectId === input.projectId &&
        (node.id === task.operationNodeId ||
          node.taskId === task.id ||
          (generatedSourceId != null && node.id === generatedSourceId)),
    )
    recoverCanvasTaskFromMaterializedOutputs({
      task,
      ...(operationNode ? { operationNode } : {}),
      outputNodeIds,
      outputAssetIds,
      at: input.at,
    })
  }

  return safeToDelete
}

export function isCompletedCanvasTaskWithOutputs(task: CanvasTask): boolean {
  return (
    task.status === 'completed' &&
    (task.outputNodeIds.length > 0 || task.outputAssetIds.length > 0)
  )
}

export function effectiveCanvasOperationStatus(
  status: CanvasTaskStatus | undefined,
  hasMaterializedOutput: boolean,
): CanvasTaskStatus {
  if (hasMaterializedOutput && (status === 'failed' || status === 'cancelled')) return 'completed'
  return status ?? 'pending'
}

function mergeIds(current: string[], additions?: Iterable<string>): string[] {
  if (!additions) return current
  return Array.from(new Set([...current, ...additions]))
}

import { appendCanvasTaskRuntimeEvent } from './canvasTaskLifecycle'
import { isOperationNode } from './canvas.capabilities'
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
  const existingProjectTaskIds = new Set(
    input.tasks.filter((task) => task.projectId === input.projectId).map((task) => task.id),
  )
  const nodesById = new Map(input.nodes.map((node) => [node.id, node]))
  const assetsById = new Map(input.assets.map((asset) => [asset.id, asset]))
  const safeToDelete = new Set(
    [...requested].filter((taskId) => !existingProjectTaskIds.has(taskId)),
  )

  for (const task of input.tasks) {
    if (task.projectId !== input.projectId || !requested.has(task.id)) continue

    const generatedEdges = input.edges.filter(
      (edge) =>
        edge.projectId === input.projectId && edge.type === 'generated' && edge.taskId === task.id,
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

  repairOperationNodesAfterTaskDeletion(input, safeToDelete)

  return safeToDelete
}

function repairOperationNodesAfterTaskDeletion(
  input: {
    projectId: string
    tasks: CanvasTask[]
    nodes: CanvasNode[]
    edges: CanvasEdge[]
    at: string
  },
  deletedTaskIds: Set<string>,
): void {
  if (deletedTaskIds.size === 0) return

  for (const node of input.nodes) {
    if (
      node.projectId !== input.projectId ||
      !isOperationNode(node) ||
      !node.taskId ||
      !deletedTaskIds.has(node.taskId)
    ) {
      continue
    }

    const latestTask = input.tasks
      .filter(
        (task) =>
          task.projectId === input.projectId &&
          !deletedTaskIds.has(task.id) &&
          (task.operationNodeId === node.id ||
            input.edges.some(
              (edge) =>
                edge.projectId === input.projectId &&
                edge.sourceNodeId === node.id &&
                edge.type === 'generated' &&
                edge.taskId === task.id,
            )),
      )
      .sort(
        (left, right) =>
          right.createdAt.localeCompare(left.createdAt) || right.id.localeCompare(left.id),
      )[0]

    const latestRecoveredRunId = latestTask
      ? undefined
      : input.edges
          .filter(
            (edge) =>
              edge.projectId === input.projectId &&
              edge.sourceNodeId === node.id &&
              edge.type === 'generated' &&
              edge.taskId != null &&
              !deletedTaskIds.has(edge.taskId),
          )
          .sort(
            (left, right) =>
              right.createdAt.localeCompare(left.createdAt) || right.id.localeCompare(left.id),
          )[0]?.taskId

    syncCanvasOperationNodeCurrentTask(
      node,
      latestTask,
      input.at,
      latestRecoveredRunId ?? undefined,
    )
  }
}

/**
 * 同步操作节点的“当前任务指针 + 展示状态”。删除任务记录或最后一个产物时必须原子地
 * 更新两者，避免 taskId 已切换/清空而 data.status 仍停留在旧运行终态。
 */
export function syncCanvasOperationNodeCurrentTask(
  node: CanvasNode,
  task: CanvasTask | undefined,
  at: string,
  recoveredRunId?: string,
): void {
  node.taskId = task?.id ?? recoveredRunId ?? null
  node.data = {
    ...node.data,
    status: task?.status ?? (recoveredRunId ? 'completed' : 'pending'),
    progress: task?.progress ?? (recoveredRunId ? 100 : 0),
    message: task ? canvasTaskNodeMessage(task) : recoveredRunId ? '任务已完成' : '待提交',
  }
  node.updatedAt = at
}

function canvasTaskNodeMessage(task: CanvasTask): string {
  if (task.status === 'completed') return '任务已完成'
  if (task.status === 'cancelled') return '任务已取消'
  if (task.status === 'failed') {
    return `失败：${task.errorDetail ?? task.errorMsg ?? '任务执行失败'}`
  }
  if (task.status === 'running') return '任务运行中'
  return '待提交'
}

export function isCompletedCanvasTaskWithOutputs(task: CanvasTask): boolean {
  return (
    task.status === 'completed' && (task.outputNodeIds.length > 0 || task.outputAssetIds.length > 0)
  )
}

export function effectiveCanvasOperationStatus(
  nodeStatus: CanvasTaskStatus | undefined,
  hasMaterializedOutput: boolean,
  currentTaskStatus?: CanvasTaskStatus,
): CanvasTaskStatus {
  // CanvasTask 是当前运行生命周期的权威；node.data.status 只承担没有任务记录的旧数据兜底。
  // 任务已取消/失败但仍有历史或部分产物时，必须保留真实终态，同时允许产物独立预览。
  if (currentTaskStatus) return currentTaskStatus
  if (hasMaterializedOutput && (nodeStatus === 'failed' || nodeStatus === 'cancelled')) {
    return 'completed'
  }
  return nodeStatus ?? 'pending'
}

function mergeIds(current: string[], additions?: Iterable<string>): string[] {
  if (!additions) return current
  return Array.from(new Set([...current, ...additions]))
}

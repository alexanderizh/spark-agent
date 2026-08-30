import type { CanvasNode, CanvasSnapshot, CanvasTask } from './canvas.types'

type CanvasRuntimeStateDb = Pick<CanvasSnapshot, 'nodes' | 'edges' | 'assets' | 'tasks'>

const TASK_RUNTIME_FIELDS = [
  'status',
  'progress',
  'agentId',
  'providerProfileId',
  'manifestId',
  'modelId',
  'provider',
  'requestId',
  'runtimeTaskId',
  'providerTaskId',
  'pollingAvailable',
  'pollingUnavailableReason',
  'rawResponse',
  'modelOutputText',
  'submitResponse',
  'requestCall',
  'runtimeEvents',
  'errorMsg',
  'errorDetail',
  'updatedAt',
  'completedAt',
] as const satisfies readonly (keyof CanvasTask)[]

const NODE_RUNTIME_DATA_FIELDS = [
  'status',
  'progress',
  'message',
] as const satisfies readonly (keyof CanvasNode['data'])[]

function copyOwnFields<T extends object>(target: T, source: T, fields: readonly (keyof T)[]): void {
  for (const field of fields) {
    if (Object.prototype.hasOwnProperty.call(source, field)) {
      Object.assign(target, { [field]: source[field] })
    } else {
      Reflect.deleteProperty(target, field)
    }
  }
}

function runtimeTaskNodeMessage(task: CanvasTask): string {
  if (task.status === 'completed') return '任务已完成'
  if (task.status === 'cancelled') return '任务已取消'
  if (task.status === 'failed') {
    return `失败：${task.errorDetail ?? task.errorMsg ?? '任务执行失败'}`
  }
  if (task.status === 'running') return '任务运行中'
  return '待提交'
}

/**
 * 把热库中的任务生命周期字段合并进上次显式保存的快照。
 *
 * 只更新磁盘中已经存在的 task，以及这些 task 的运行态和新增产物血缘。节点位置、尺寸、
 * Prompt、模型参数、新建 task 和已有产物的人工作改动均沿用磁盘基线，保证静默回写
 * 不破坏“放弃修改”的语义。
 */
export function mergeCanvasRuntimeStateIntoSnapshot(
  persisted: CanvasSnapshot,
  runtime: CanvasRuntimeStateDb,
): CanvasSnapshot {
  const runtimeTasksById = new Map(runtime.tasks.map((task) => [task.id, task]))
  const runtimeNodesById = new Map(runtime.nodes.map((node) => [node.id, node]))
  const persistedTaskIds = new Set(persisted.tasks.map((task) => task.id))

  const tasks = persisted.tasks.map((task) => {
    const runtimeTask = runtimeTasksById.get(task.id)
    if (
      !runtimeTask ||
      runtimeTask.projectId !== persisted.project.id ||
      runtimeTask.status === 'pending'
    ) {
      return task
    }
    const merged = { ...task }
    copyOwnFields(merged, runtimeTask, TASK_RUNTIME_FIELDS)
    merged.outputNodeIds = Array.from(
      new Set([...task.outputNodeIds, ...runtimeTask.outputNodeIds]),
    )
    merged.outputAssetIds = Array.from(
      new Set([...task.outputAssetIds, ...runtimeTask.outputAssetIds]),
    )
    return merged
  })

  const mergedTasksById = new Map(tasks.map((task) => [task.id, task]))
  const persistedNodeIds = new Set(persisted.nodes.map((node) => node.id))
  const outputNodeIds = new Set(tasks.flatMap((task) => task.outputNodeIds))
  const outputAssetIds = new Set(tasks.flatMap((task) => task.outputAssetIds))

  const nodes = persisted.nodes.map((node) => {
    if (!node.taskId || !persistedTaskIds.has(node.taskId)) return node
    const runtimeNode = runtimeNodesById.get(node.id)
    const runtimeTask = runtimeTasksById.get(node.taskId)
    if (!runtimeNode || !runtimeTask || runtimeTask.status === 'pending') {
      return node
    }
    const data = { ...node.data }
    if (runtimeNode.projectId === persisted.project.id && runtimeNode.taskId === node.taskId) {
      copyOwnFields(data, runtimeNode.data, NODE_RUNTIME_DATA_FIELDS)
    } else {
      data.status = runtimeTask.status
      data.progress = runtimeTask.progress
      data.message = runtimeTaskNodeMessage(runtimeTask)
    }
    return {
      ...node,
      data,
      updatedAt: runtimeTask.updatedAt,
    }
  })

  for (const runtimeNode of runtime.nodes) {
    if (
      runtimeNode.projectId !== persisted.project.id ||
      persistedNodeIds.has(runtimeNode.id) ||
      !outputNodeIds.has(runtimeNode.id)
    ) {
      continue
    }
    nodes.push(runtimeNode)
    persistedNodeIds.add(runtimeNode.id)
    if (runtimeNode.assetId) outputAssetIds.add(runtimeNode.assetId)
  }

  const persistedAssetIds = new Set(persisted.assets.map((asset) => asset.id))
  const assets = [...persisted.assets]
  for (const runtimeAsset of runtime.assets) {
    if (
      runtimeAsset.projectId !== persisted.project.id ||
      persistedAssetIds.has(runtimeAsset.id) ||
      !outputAssetIds.has(runtimeAsset.id)
    ) {
      continue
    }
    assets.push(runtimeAsset)
    persistedAssetIds.add(runtimeAsset.id)
  }

  const edges = [...persisted.edges]
  const persistedEdgeKeys = new Set(
    persisted.edges.map(
      (edge) => `${edge.type}:${edge.taskId ?? ''}:${edge.sourceNodeId}:${edge.targetNodeId}`,
    ),
  )
  for (const runtimeEdge of runtime.edges) {
    if (
      runtimeEdge.projectId !== persisted.project.id ||
      runtimeEdge.type !== 'generated' ||
      !runtimeEdge.taskId ||
      !mergedTasksById.has(runtimeEdge.taskId) ||
      !outputNodeIds.has(runtimeEdge.targetNodeId)
    ) {
      continue
    }
    const key = `${runtimeEdge.type}:${runtimeEdge.taskId}:${runtimeEdge.sourceNodeId}:${runtimeEdge.targetNodeId}`
    if (persistedEdgeKeys.has(key)) continue
    edges.push(runtimeEdge)
    persistedEdgeKeys.add(key)
  }

  return {
    ...persisted,
    project: {
      ...persisted.project,
      nodeCount: nodes.filter((node) => !node.hidden).length,
      assetCount: assets.length,
      taskCount: tasks.length,
    },
    nodes,
    edges,
    assets,
    tasks,
  }
}

import type { CanvasOperationOutputView } from './canvasOperationRuns'
import type { CanvasEdge, CanvasNode, CanvasTask } from './canvas.types'

export type CanvasOperationOutputDeletionPlan = {
  edgeIds: string[]
  nodeIds: string[]
  taskOutputRemovals: Array<{ taskId: string; nodeIds: string[]; assetIds: string[] }>
  deletedOutputIds: string[]
  skippedOutputIds: string[]
  primaryOutputDeleted: boolean
}

export type CanvasOperationOutputDeletionResult = {
  deletedOutputCount: number
  deletedNodeCount: number
  deletedTaskCount: number
  skippedOutputCount: number
}

type CanvasOperationOutputDeletionState = {
  nodes: CanvasNode[]
  edges: CanvasEdge[]
  tasks: CanvasTask[]
}

type CanvasOperationOutputDeletionApplication = CanvasOperationOutputDeletionState & {
  result: CanvasOperationOutputDeletionResult
}

function outputKeys(output: CanvasOperationOutputView): Set<string> {
  return new Set(
    [output.id, output.nodeId, output.assetId].filter((id): id is string => Boolean(id)),
  )
}

function outputMatchesKey(output: CanvasOperationOutputView, key: string): boolean {
  return output.id === key || output.nodeId === key || output.assetId === key
}

export function planCanvasOperationOutputDeletion(input: {
  operationNodeId: string
  outputs: CanvasOperationOutputView[]
  nodes: CanvasNode[]
  edges: CanvasEdge[]
  tasks: CanvasTask[]
}): CanvasOperationOutputDeletionPlan {
  const nodesById = new Map(input.nodes.map((node) => [node.id, node]))
  const operationNode = nodesById.get(input.operationNodeId)
  const ownedTaskIds = new Set(
    input.tasks
      .filter(
        (task) =>
          task.operationNodeId === input.operationNodeId || task.id === operationNode?.taskId,
      )
      .map((task) => task.id),
  )
  for (const edge of input.edges) {
    if (edge.sourceNodeId === input.operationNodeId && edge.type === 'generated' && edge.taskId) {
      ownedTaskIds.add(edge.taskId)
    }
  }
  const tasksById = new Map(input.tasks.map((task) => [task.id, task]))
  const generatedEdgesByTargetId = new Map<string, CanvasEdge[]>()
  for (const edge of input.edges) {
    if (edge.sourceNodeId !== input.operationNodeId || edge.type !== 'generated') continue
    const targetEdges = generatedEdgesByTargetId.get(edge.targetNodeId) ?? []
    targetEdges.push(edge)
    generatedEdgesByTargetId.set(edge.targetNodeId, targetEdges)
  }
  const materializedNodeIdsByOutputId = new Map<string, string[]>()
  for (const node of input.nodes) {
    const materialized = node.data.materializedOutput
    if (materialized?.operationNodeId !== input.operationNodeId) continue
    const nodeIds = materializedNodeIdsByOutputId.get(materialized.outputId) ?? []
    nodeIds.push(node.id)
    materializedNodeIdsByOutputId.set(materialized.outputId, nodeIds)
  }

  const outputNodeCandidates = new Set<string>()
  const materializedNodeCandidates = new Map<string, string>()
  const edgeIds = new Set<string>()
  const deletedOutputIds = new Set<string>()
  const skippedOutputIds = new Set<string>()
  const taskRemovals = new Map<string, { nodeIds: Set<string>; assetIds: Set<string> }>()
  let primaryOutputDeleted = false

  for (const output of input.outputs) {
    const keys = outputKeys(output)
    let matched = false
    const task = output.taskId
      ? ownedTaskIds.has(output.taskId)
        ? tasksById.get(output.taskId)
        : undefined
      : input.tasks.find(
          (candidate) =>
            ownedTaskIds.has(candidate.id) &&
            (candidate.outputNodeIds.some((id) => keys.has(id)) ||
              candidate.outputAssetIds.some((id) => keys.has(id))),
        )

    if (task) {
      const removal = taskRemovals.get(task.id) ?? {
        nodeIds: new Set<string>(),
        assetIds: new Set<string>(),
      }
      for (const id of task.outputNodeIds) {
        if (keys.has(id)) removal.nodeIds.add(id)
      }
      for (const id of task.outputAssetIds) {
        if (keys.has(id)) removal.assetIds.add(id)
      }
      if (removal.nodeIds.size > 0 || removal.assetIds.size > 0) {
        taskRemovals.set(task.id, removal)
        matched = true
      }
    }

    for (const key of keys) {
      for (const edge of generatedEdgesByTargetId.get(key) ?? []) {
        if (output.taskId && edge.taskId && edge.taskId !== output.taskId) continue
        edgeIds.add(edge.id)
        outputNodeCandidates.add(edge.targetNodeId)
        matched = true
      }
    }

    for (const key of keys) {
      for (const nodeId of materializedNodeIdsByOutputId.get(key) ?? []) {
        materializedNodeCandidates.set(nodeId, key)
        matched = true
      }
    }
    if (output.nodeId) {
      const materialized = input.nodes.find((node) => node.id === output.nodeId)?.data
        .materializedOutput
      if (materialized?.operationNodeId === input.operationNodeId) {
        materializedNodeCandidates.set(output.nodeId, materialized.outputId)
        matched = true
      }
    }
    for (const nodeId of task?.outputNodeIds ?? []) {
      if (!keys.has(nodeId)) continue
      outputNodeCandidates.add(nodeId)
      matched = true
    }

    if (matched) {
      deletedOutputIds.add(output.id)
    } else {
      skippedOutputIds.add(output.id)
    }
  }

  const retainedNodeOutputIds = new Set<string>()
  const retainedOutputIds = new Set<string>()
  for (const task of input.tasks) {
    if (!ownedTaskIds.has(task.id)) continue
    const removal = taskRemovals.get(task.id)
    for (const id of task.outputNodeIds) {
      if (removal?.nodeIds.has(id)) continue
      retainedNodeOutputIds.add(id)
      retainedOutputIds.add(id)
    }
    for (const id of task.outputAssetIds) {
      if (!removal?.assetIds.has(id)) retainedOutputIds.add(id)
    }
  }
  const taskRetainsOutputKey = (key: string, kind: 'node' | 'any'): boolean =>
    (kind === 'node' ? retainedNodeOutputIds : retainedOutputIds).has(key)

  const nodeIds = new Set<string>()
  for (const nodeId of outputNodeCandidates) {
    if (!taskRetainsOutputKey(nodeId, 'node')) nodeIds.add(nodeId)
  }
  for (const [nodeId, outputId] of materializedNodeCandidates) {
    if (taskRetainsOutputKey(outputId, 'any')) continue
    nodeIds.add(nodeId)
  }

  const primaryOutputId = operationNode?.data.primaryOutputId
  if (
    primaryOutputId &&
    input.outputs.some((output) => outputMatchesKey(output, primaryOutputId))
  ) {
    const survivingGeneratedEdge = input.edges.some((edge) => {
      if (
        edge.sourceNodeId !== input.operationNodeId ||
        edge.type !== 'generated' ||
        edgeIds.has(edge.id)
      ) {
        return false
      }
      const target = nodesById.get(edge.targetNodeId)
      return edge.targetNodeId === primaryOutputId || target?.assetId === primaryOutputId
    })
    primaryOutputDeleted = !taskRetainsOutputKey(primaryOutputId, 'any') && !survivingGeneratedEdge
  }

  for (const edge of input.edges) {
    if (nodeIds.has(edge.sourceNodeId) || nodeIds.has(edge.targetNodeId)) edgeIds.add(edge.id)
  }

  return {
    edgeIds: [...edgeIds],
    nodeIds: [...nodeIds],
    taskOutputRemovals: [...taskRemovals].map(([taskId, removal]) => ({
      taskId,
      nodeIds: [...removal.nodeIds],
      assetIds: [...removal.assetIds],
    })),
    deletedOutputIds: [...deletedOutputIds],
    skippedOutputIds: [...skippedOutputIds],
    primaryOutputDeleted,
  }
}

export function applyCanvasOperationOutputDeletion(input: {
  projectId: string
  operationNodeId: string
  outputs: CanvasOperationOutputView[]
  nodes: CanvasNode[]
  edges: CanvasEdge[]
  tasks: CanvasTask[]
  updatedAt: string
}): CanvasOperationOutputDeletionApplication {
  const plan = planCanvasOperationOutputDeletion(input)
  const removedNodeIds = new Set(plan.nodeIds)
  const removedEdgeIds = new Set(plan.edgeIds)
  const removalsByTaskId = new Map(
    plan.taskOutputRemovals.map((removal) => [
      removal.taskId,
      {
        nodeIds: new Set(removal.nodeIds),
        assetIds: new Set(removal.assetIds),
      },
    ]),
  )
  const patchedTasks = input.tasks.map((task) => {
    const removal = removalsByTaskId.get(task.id)
    if (!removal || task.projectId !== input.projectId) return task
    return {
      ...task,
      outputNodeIds: task.outputNodeIds.filter((id) => !removal.nodeIds.has(id)),
      outputAssetIds: task.outputAssetIds.filter((id) => !removal.assetIds.has(id)),
      updatedAt: input.updatedAt,
    }
  })
  const deletedTaskIds = new Set(
    patchedTasks
      .filter(
        (task) =>
          task.projectId === input.projectId &&
          removalsByTaskId.has(task.id) &&
          task.status === 'completed' &&
          task.outputNodeIds.length === 0 &&
          task.outputAssetIds.length === 0,
      )
      .map((task) => task.id),
  )
  const tasks = patchedTasks.filter((task) => !deletedTaskIds.has(task.id))
  const remainingProjectTaskIds = new Set(
    tasks.filter((task) => task.projectId === input.projectId).map((task) => task.id),
  )
  const remainingOperationTaskIds = new Set(
    tasks
      .filter(
        (task) =>
          task.projectId === input.projectId && task.operationNodeId === input.operationNodeId,
      )
      .map((task) => task.id),
  )
  for (const edge of input.edges) {
    if (
      edge.sourceNodeId === input.operationNodeId &&
      edge.type === 'generated' &&
      edge.taskId &&
      !removedEdgeIds.has(edge.id) &&
      remainingProjectTaskIds.has(edge.taskId)
    ) {
      remainingOperationTaskIds.add(edge.taskId)
    }
  }
  const latestRemainingTask = tasks
    .filter((task) => remainingOperationTaskIds.has(task.id))
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0]

  const nodes = input.nodes.map((node) => {
    if (removedNodeIds.has(node.id) && node.projectId === input.projectId) {
      return { ...node, hidden: true, updatedAt: input.updatedAt }
    }
    if (node.id !== input.operationNodeId || node.projectId !== input.projectId) return node
    const nextTaskId = deletedTaskIds.has(node.taskId ?? '')
      ? (latestRemainingTask?.id ?? null)
      : node.taskId
    if (!plan.primaryOutputDeleted && nextTaskId === node.taskId) return node
    const data = { ...node.data }
    if (plan.primaryOutputDeleted) {
      delete data.primaryOutputId
      data.primaryOutputSelection = 'auto_latest'
    }
    return {
      ...node,
      ...(nextTaskId !== undefined ? { taskId: nextTaskId } : {}),
      data,
      updatedAt: input.updatedAt,
    }
  })
  const edges = input.edges.filter(
    (edge) =>
      !removedEdgeIds.has(edge.id) &&
      !removedNodeIds.has(edge.sourceNodeId) &&
      !removedNodeIds.has(edge.targetNodeId),
  )

  return {
    nodes,
    edges,
    tasks,
    result: {
      deletedOutputCount: plan.deletedOutputIds.length,
      deletedNodeCount: removedNodeIds.size,
      deletedTaskCount: deletedTaskIds.size,
      skippedOutputCount: plan.skippedOutputIds.length,
    },
  }
}

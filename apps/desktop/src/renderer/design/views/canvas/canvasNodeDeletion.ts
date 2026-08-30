import { isOperationNode } from './canvas.capabilities'
import type { CanvasEdge, CanvasNode, CanvasTask } from './canvas.types'

/**
 * Remove deleted node references from a task without treating independent
 * asset references as owned task outputs. An asset is removed only when a
 * deleted node is registered in outputNodeIds and no retained registered
 * output node still exposes the same asset.
 */
export function removeDeletedCanvasNodeReferencesFromTask(input: {
  task: CanvasTask
  nodesById: ReadonlyMap<string, CanvasNode>
  deletedNodeIds: ReadonlySet<string>
}): CanvasTask {
  const { task, nodesById, deletedNodeIds } = input
  const inputNodeIds = task.inputNodeIds.filter((id) => !deletedNodeIds.has(id))
  const outputNodeIds = task.outputNodeIds.filter((id) => !deletedNodeIds.has(id))
  const retainedOutputAssetIds = new Set(
    outputNodeIds.map((id) => nodesById.get(id)?.assetId).filter((id): id is string => Boolean(id)),
  )
  const removedOwnedAssetIds = new Set(
    task.outputNodeIds
      .filter((id) => deletedNodeIds.has(id))
      .map((id) => nodesById.get(id)?.assetId)
      .filter((id): id is string => typeof id === 'string' && !retainedOutputAssetIds.has(id)),
  )
  const outputAssetIds =
    removedOwnedAssetIds.size > 0
      ? task.outputAssetIds.filter((id) => !removedOwnedAssetIds.has(id))
      : task.outputAssetIds

  if (
    inputNodeIds.length === task.inputNodeIds.length &&
    outputNodeIds.length === task.outputNodeIds.length &&
    outputAssetIds.length === task.outputAssetIds.length
  ) {
    return task
  }
  return { ...task, inputNodeIds, outputNodeIds, outputAssetIds }
}

/**
 * Expand an explicit node deletion with outputs that are still embedded inside
 * the deleted operation node. Materialized references and grouped outputs are
 * already independent canvas content, so they intentionally survive.
 */
export function resolveCanvasNodeDeletionIds(input: {
  projectId: string
  nodeIds: string[]
  nodes: CanvasNode[]
  edges: CanvasEdge[]
}): Set<string> {
  const remove = new Set(input.nodeIds)
  const operationNodeIds = new Set(
    input.nodes
      .filter(
        (node) =>
          node.projectId === input.projectId && remove.has(node.id) && isOperationNode(node),
      )
      .map((node) => node.id),
  )
  if (operationNodeIds.size === 0) return remove

  const nodesById = new Map(input.nodes.map((node) => [node.id, node]))
  for (const edge of input.edges) {
    if (
      edge.projectId !== input.projectId ||
      edge.type !== 'generated' ||
      !operationNodeIds.has(edge.sourceNodeId)
    ) {
      continue
    }
    const output = nodesById.get(edge.targetNodeId)
    if (
      !output ||
      output.projectId !== input.projectId ||
      output.parentNodeId ||
      output.data.subtype === 'video_workbench'
    ) {
      continue
    }
    remove.add(output.id)
  }

  return remove
}

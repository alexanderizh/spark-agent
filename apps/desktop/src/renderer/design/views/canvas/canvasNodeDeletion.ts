import { isOperationNode } from './canvas.capabilities'
import type { CanvasEdge, CanvasNode } from './canvas.types'

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

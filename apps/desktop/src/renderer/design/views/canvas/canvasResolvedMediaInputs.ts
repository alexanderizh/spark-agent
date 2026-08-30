import { isOperationNode } from './canvas.capabilities'
import { buildOutputMediaNodeMap, type CanvasNodeMediaKind } from './canvasNodeMediaKind'
import { resolveCanvasOperationResourceNode } from './canvasOperationOutputModel'
import type { CanvasNode, CanvasSnapshot } from './canvas.types'

export type CanvasResolvedMediaInputs = {
  bindingNodes: CanvasNode[]
  outputMediaKindByNodeId: ReadonlyMap<string, CanvasNodeMediaKind>
  outputMediaNodeByNodeId: ReadonlyMap<string, CanvasNode>
  presentationNodeBySourceId: ReadonlyMap<string, CanvasNode>
}

/**
 * Resolve operation owners to their current output for prompt presentation, while separately
 * exposing media-only maps for role selection and transport. This includes outputs that only
 * exist as task/asset records and have not been expanded into persisted canvas nodes yet.
 */
export function resolveCanvasMediaInputs(
  snapshot: CanvasSnapshot,
  additionalBindingNodes: readonly CanvasNode[] = [],
): CanvasResolvedMediaInputs {
  const outputMediaNodeByNodeId = buildOutputMediaNodeMap(snapshot.nodes, snapshot.edges)
  const presentationNodeBySourceId = new Map<string, CanvasNode>(outputMediaNodeByNodeId)
  for (const node of snapshot.nodes) {
    if (!isOperationNode(node)) continue
    const output = resolveCanvasOperationResourceNode(node, snapshot)
    if (!output) continue
    presentationNodeBySourceId.set(node.id, output)
    if (isMediaNode(output)) outputMediaNodeByNodeId.set(node.id, output)
  }

  const outputMediaKindByNodeId = new Map<string, CanvasNodeMediaKind>()
  for (const [nodeId, output] of outputMediaNodeByNodeId) {
    if (isMediaNode(output)) outputMediaKindByNodeId.set(nodeId, output.type)
  }

  const bindingNodes = Array.from(
    new Map(
      [...snapshot.nodes, ...outputMediaNodeByNodeId.values(), ...additionalBindingNodes].map(
        (node) => [node.id, node],
      ),
    ).values(),
  )
  return {
    bindingNodes,
    outputMediaKindByNodeId,
    outputMediaNodeByNodeId,
    presentationNodeBySourceId,
  }
}

function isMediaNode(node: CanvasNode): node is CanvasNode & { type: CanvasNodeMediaKind } {
  return node.type === 'image' || node.type === 'video' || node.type === 'audio'
}

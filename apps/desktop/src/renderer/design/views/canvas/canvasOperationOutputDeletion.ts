import type { CanvasEdge } from './canvas.types'
import type { CanvasOperationOutputView } from './canvasOperationRuns'

export type CanvasOperationOutputDeletionPlan = {
  edgeIds: string[]
  nodeIds: string[]
  skippedOutputIds: string[]
}

export function planCanvasOperationOutputDeletion(input: {
  operationNodeId: string
  outputs: CanvasOperationOutputView[]
  edges: CanvasEdge[]
}): CanvasOperationOutputDeletionPlan {
  const generatedEdgeByTargetId = new Map(
    input.edges
      .filter((edge) => edge.type === 'generated' && edge.sourceNodeId === input.operationNodeId)
      .map((edge) => [edge.targetNodeId, edge] as const),
  )
  const edgeIds: string[] = []
  const nodeIds: string[] = []
  const skippedOutputIds: string[] = []
  const seenNodeIds = new Set<string>()

  for (const output of input.outputs) {
    const nodeId = output.nodeId
    const generatedEdge = nodeId ? generatedEdgeByTargetId.get(nodeId) : undefined
    if (!nodeId || !generatedEdge) {
      skippedOutputIds.push(output.id)
      continue
    }
    if (seenNodeIds.has(nodeId)) continue
    seenNodeIds.add(nodeId)
    nodeIds.push(nodeId)
    edgeIds.push(generatedEdge.id)
  }

  return { edgeIds, nodeIds, skippedOutputIds }
}

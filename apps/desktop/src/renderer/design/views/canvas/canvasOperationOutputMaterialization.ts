import type { CanvasOperationOutputView } from './canvasOperationRuns'
import type { CanvasNode } from './canvas.types'

export type CanvasOperationOutputMaterializationPlan = {
  existingNodeIds: string[]
  unsupportedOutputIds: string[]
  items: Array<{ output: CanvasOperationOutputView; x: number; y: number }>
}

export function planCanvasOperationOutputMaterialization({
  operationNode,
  outputs,
  existingNodes,
}: {
  operationNode: CanvasNode
  outputs: CanvasOperationOutputView[]
  existingNodes: CanvasNode[]
}): CanvasOperationOutputMaterializationPlan {
  const existingByOutputId = new Map(
    existingNodes.flatMap((node) => {
      const materialized = node.data.materializedOutput
      return materialized?.operationNodeId === operationNode.id
        ? [[materialized.outputId, node] as const]
        : []
    }),
  )
  const existingNodeIds: string[] = []
  const unsupportedOutputIds: string[] = []
  const missing: CanvasOperationOutputView[] = []
  const seen = new Set<string>()

  for (const output of outputs) {
    const outputId = output.id
    if (seen.has(outputId)) continue
    seen.add(outputId)
    const existing = existingByOutputId.get(outputId)
    if (existing) {
      existingNodeIds.push(existing.id)
    } else if (!output.assetId) {
      unsupportedOutputIds.push(outputId)
    } else {
      missing.push(output)
    }
  }

  const startX = operationNode.x + operationNode.width + 60
  const startY = operationNode.y
  const columnStep = 360
  const rowStep = 300
  return {
    existingNodeIds,
    unsupportedOutputIds,
    items: missing.map((output, index) => ({
      output,
      x: startX + (index % 3) * columnStep,
      y: startY + Math.floor(index / 3) * rowStep,
    })),
  }
}

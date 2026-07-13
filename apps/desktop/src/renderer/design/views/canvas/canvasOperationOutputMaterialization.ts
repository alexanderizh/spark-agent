import type { CanvasOperationOutputView } from './canvasOperationRuns'
import type { CanvasNode } from './canvas.types'
import { resolveCollisionFreeBatchPositions } from './canvasCollisionPlacement'
import {
  AUDIO_NODE_DEFAULT_SIZE,
  IMAGE_NODE_DEFAULT_SIZE,
  TEXT_NODE_DEFAULT_SIZE,
  VIDEO_NODE_DEFAULT_SIZE,
  fitCanvasImageNodeSize,
  pickTextNodeSize,
} from './canvasNodeSize'

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

  const sizes = missing.map((output) => {
    if (output.type === 'image') return fitCanvasImageNodeSize(output.width, output.height)
    if (output.type === 'video') return VIDEO_NODE_DEFAULT_SIZE
    if (output.type === 'audio') return AUDIO_NODE_DEFAULT_SIZE
    if (output.type === 'text' || output.type === 'prompt') return pickTextNodeSize(output.text)
    return output.type === 'file' ? TEXT_NODE_DEFAULT_SIZE : IMAGE_NODE_DEFAULT_SIZE
  })
  const positions = resolveCollisionFreeBatchPositions({
    preferred: {
      x: operationNode.x + operationNode.width + 60,
      y: operationNode.y,
    },
    sizes,
    nodes: existingNodes,
    boardId: operationNode.boardId,
  })
  return {
    existingNodeIds,
    unsupportedOutputIds,
    items: missing.map((output, index) => ({
      output,
      x: positions[index]?.x ?? operationNode.x + operationNode.width + 60,
      y: positions[index]?.y ?? operationNode.y,
    })),
  }
}

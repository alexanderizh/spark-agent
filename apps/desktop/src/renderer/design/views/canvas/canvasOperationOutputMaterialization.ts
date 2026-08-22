import type { CanvasOperationOutputView } from './canvasOperationRuns'
import type { CanvasNode } from './canvas.types'
import { AUTO_NODE_RIGHT_GAP, stackAutoNodesToRight } from './canvasAutoPlacement'
import {
  AUDIO_NODE_DEFAULT_SIZE,
  IMAGE_NODE_DEFAULT_SIZE,
  TEXT_NODE_DEFAULT_SIZE,
  fitCanvasImageNodeSize,
  fitCanvasVideoNodeSize,
  pickTextNodeSize,
} from './canvasNodeSize'

export type CanvasOperationOutputMaterializationPlan = {
  existingNodeIds: string[]
  unsupportedOutputIds: string[]
  items: Array<{ output: CanvasOperationOutputView; x: number; y: number }>
}

function outputIdentityKeys(output: CanvasOperationOutputView): string[] {
  return [output.id, output.nodeId, output.assetId].filter(
    (id, index, keys): id is string => Boolean(id) && keys.indexOf(id) === index,
  )
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
  const existingByIdentityKey = new Map<string, CanvasNode>()
  for (const node of existingNodes) {
    const materialized = node.data.materializedOutput
    if (materialized?.operationNodeId !== operationNode.id) continue
    for (const key of [materialized.outputId, node.id, node.assetId]) {
      if (key && !existingByIdentityKey.has(key)) existingByIdentityKey.set(key, node)
    }
  }
  const existingNodeIds: string[] = []
  const existingNodeIdSet = new Set<string>()
  const unsupportedOutputIds: string[] = []
  const missing: CanvasOperationOutputView[] = []
  const seenIdentityKeys = new Set<string>()

  for (const output of outputs) {
    const identityKeys = outputIdentityKeys(output)
    if (identityKeys.some((key) => seenIdentityKeys.has(key))) continue
    for (const key of identityKeys) seenIdentityKeys.add(key)
    const existing = identityKeys
      .map((key) => existingByIdentityKey.get(key))
      .find((node): node is CanvasNode => Boolean(node))
    if (existing) {
      if (!existingNodeIdSet.has(existing.id)) {
        existingNodeIdSet.add(existing.id)
        existingNodeIds.push(existing.id)
      }
    } else if (!output.assetId) {
      unsupportedOutputIds.push(output.id)
    } else {
      missing.push(output)
    }
  }

  const sizes = missing.map((output) => {
    if (output.type === 'image') return fitCanvasImageNodeSize(output.width, output.height)
    if (output.type === 'video') return fitCanvasVideoNodeSize(output.width, output.height)
    if (output.type === 'audio') return AUDIO_NODE_DEFAULT_SIZE
    if (output.type === 'text' || output.type === 'prompt') return pickTextNodeSize(output.text)
    return output.type === 'file' ? TEXT_NODE_DEFAULT_SIZE : IMAGE_NODE_DEFAULT_SIZE
  })
  // 展开产物固定为原节点右侧的纵向单列，列的垂直中点与原节点中心对齐；
  // 不做碰撞回避，保证多产物展开的落位确定、规整、便于后续框选操作。
  const positions = stackAutoNodesToRight(operationNode, sizes)
  return {
    existingNodeIds,
    unsupportedOutputIds,
    items: missing.map((output, index) => ({
      output,
      x: positions[index]?.x ?? operationNode.x + operationNode.width + AUTO_NODE_RIGHT_GAP,
      y: positions[index]?.y ?? operationNode.y,
    })),
  }
}

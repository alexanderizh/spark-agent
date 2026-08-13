import { isOperationNode } from './canvas.capabilities'
import { resolveCanvasOperationResourceNode } from './canvasOperationOutputModel'
import type { CanvasAsset, CanvasNode, CanvasSnapshot } from './canvas.types'

/** 提示词封面只接受图片资产；URL 是否存在不能代表资产是图片。 */
export function isPromptCoverAsset(asset: CanvasAsset | null | undefined): asset is CanvasAsset {
  return asset?.type === 'image'
}

export function isPromptCoverNode(
  node: Pick<CanvasNode, 'type'> | null | undefined,
  asset: CanvasAsset | null | undefined,
): asset is CanvasAsset {
  return (
    (node?.type === 'image' || (node != null && isOperationNode(node))) && isPromptCoverAsset(asset)
  )
}

/**
 * Resolve the image asset represented by a canvas node.
 *
 * Operation nodes expose their outputs through the shared operation-run
 * projection, which also covers generated edges and recovered historical runs.
 */
export function resolveNodeOutputAsset(
  node: CanvasNode | null,
  snapshot: CanvasSnapshot,
): CanvasAsset | null {
  if (!node) return null
  if (node.assetId) return snapshot.assets.find((asset) => asset.id === node.assetId) ?? null

  const resolvedNode = isOperationNode(node)
    ? resolveCanvasOperationResourceNode(node, snapshot)
    : node
  if (resolvedNode?.assetId) {
    return snapshot.assets.find((asset) => asset.id === resolvedNode.assetId) ?? null
  }
  if (isOperationNode(node)) return null
  if (!node.taskId) return null

  const task = snapshot.tasks.find((item) => item.id === node.taskId)
  if (!task) return null

  const primaryOutputId = node.data?.primaryOutputId
  if (primaryOutputId) {
    const primaryAsset = snapshot.assets.find((asset) => asset.id === primaryOutputId)
    if (primaryAsset) return primaryAsset
    const primaryNode = snapshot.nodes.find((item) => item.id === primaryOutputId)
    if (primaryNode?.assetId) {
      return snapshot.assets.find((asset) => asset.id === primaryNode.assetId) ?? null
    }
  }

  const outputNode = task.outputNodeIds
    .map((nodeId) => snapshot.nodes.find((item) => item.id === nodeId))
    .find((item) => Boolean(item?.assetId))
  if (outputNode?.assetId) {
    return snapshot.assets.find((asset) => asset.id === outputNode.assetId) ?? null
  }

  const outputAssetId = task.outputAssetIds[0]
  return outputAssetId
    ? (snapshot.assets.find((asset) => asset.id === outputAssetId) ?? null)
    : null
}

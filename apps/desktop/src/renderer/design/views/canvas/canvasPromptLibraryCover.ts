import { isOperationNode } from './canvas.capabilities'
import {
  collectCanvasOperationImageAssets,
  resolveCanvasOperationResourceNode,
} from './canvasOperationOutputModel'
import type { CanvasAsset, CanvasNode, CanvasSnapshot } from './canvas.types'

/** 提示词封面只接受图片资产；URL 是否存在不能代表资产是图片。 */
export function isPromptCoverAsset(asset: CanvasAsset | null | undefined): asset is CanvasAsset {
  return asset?.type === 'image'
}

/**
 * 枚举一个画布节点可作为提示词封面的全部图片资产。
 *
 * image 节点返回自身资产；操作节点返回全部运行产物中的图片资产——一次任务
 * 可能产出多张图，封面候选要逐张列出，而不是只给主产物；其余节点没有封面资产。
 */
export function collectNodeImageCoverAssets(
  node: CanvasNode | null,
  snapshot: CanvasSnapshot,
): CanvasAsset[] {
  if (!node) return []
  const ownAsset = node.assetId
    ? (snapshot.assets.find((asset) => asset.id === node.assetId) ?? null)
    : null
  const own = isPromptCoverAsset(ownAsset) ? [ownAsset] : []
  if (node.type === 'image') {
    if (own.length > 0) return own
    // 旧数据的 image 节点可能只有 taskId，资产挂在任务输出上；沿用主产物
    // 投影回退，保持与改造前一致的候选语义。
    const resolved = resolveNodeOutputAsset(node, snapshot)
    return isPromptCoverAsset(resolved) ? [resolved] : []
  }
  if (isOperationNode(node)) {
    const seen = new Set(own.map((asset) => asset.id))
    const outputs = collectCanvasOperationImageAssets(node, snapshot).filter((asset) => {
      if (seen.has(asset.id)) return false
      seen.add(asset.id)
      return true
    })
    return [...own, ...outputs]
  }
  return []
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

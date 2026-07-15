import { readAssetKind } from './canvasFilmAssets'
import { isOperationNode } from './canvas.capabilities'
import { resolveCollisionFreeBatchPositions } from './canvasCollisionPlacement'
import { buildCanvasOperationRunViews } from './canvasOperationRuns'
import { expandCanvasInputNodes } from './canvasWorkspaceTaskInput'
import { OPERATION_NODE_DEFAULT_SIZE } from './canvasNodeSize'
import type { CanvasAsset, CanvasNode, CanvasSnapshot } from './canvas.types'

export type CanvasPipelineAssetTarget = {
  sourceNode: CanvasNode
  asset: CanvasAsset
}

const ACTION_ASSET_KIND = {
  'character.three_view': 'character',
  'scene.scene_image': 'scene',
  'prop.prop_image': 'prop',
  'effect.effect_image': 'effect',
} as const

/**
 * 把单资源节点、组节点或多产物操作节点统一解析成独立的流水线目标。
 * 操作节点消费最近一次运行中与右键动作类型匹配的全部产物；普通节点仍只消费自身。
 */
export function resolveCanvasPipelineAssetTargets(input: {
  sourceNode: CanvasNode
  actionId: string
  snapshot: CanvasSnapshot
}): CanvasPipelineAssetTarget[] {
  const expectedKind = ACTION_ASSET_KIND[input.actionId as keyof typeof ACTION_ASSET_KIND]
  if (!expectedKind) return []

  const assetsById = new Map(input.snapshot.assets.map((asset) => [asset.id, asset]))
  const candidateNodes = isOperationNode(input.sourceNode)
    ? (() => {
        const latestRun = buildCanvasOperationRunViews(input.sourceNode, input.snapshot).find(
          (run) => run.outputs.length > 0,
        )
        return (latestRun?.outputs ?? []).flatMap((output) => {
          const persisted = output.nodeId
            ? input.snapshot.nodes.find((node) => node.id === output.nodeId)
            : output.assetId
              ? input.snapshot.nodes.find((node) => node.assetId === output.assetId)
              : undefined
          return persisted ? [persisted] : []
        })
      })()
    : expandCanvasInputNodes([input.sourceNode], input.snapshot)
  const seenAssetIds = new Set<string>()
  const targets: CanvasPipelineAssetTarget[] = []
  for (const sourceNode of candidateNodes) {
    if (!sourceNode.assetId || seenAssetIds.has(sourceNode.assetId)) continue
    const asset = assetsById.get(sourceNode.assetId)
    if (!asset || readAssetKind(asset) !== expectedKind) continue
    seenAssetIds.add(asset.id)
    targets.push({ sourceNode, asset })
  }
  return targets
}

/** 为一批后续任务节点计算规整、等间距且避让已有画布内容的落点。 */
export function planCanvasPipelineTaskPositions(input: {
  sourceNode: CanvasNode
  count: number
  existingNodes: CanvasNode[]
}): Array<{ x: number; y: number }> {
  return resolveCollisionFreeBatchPositions({
    preferred: {
      x: input.sourceNode.x + input.sourceNode.width + 80,
      y: input.sourceNode.y,
    },
    sizes: Array.from({ length: input.count }, () => OPERATION_NODE_DEFAULT_SIZE),
    nodes: input.existingNodes,
    boardId: input.sourceNode.boardId,
  })
}

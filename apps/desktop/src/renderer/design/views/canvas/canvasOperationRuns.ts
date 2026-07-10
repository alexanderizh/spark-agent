import { isOperationNode } from './canvas.capabilities'
import type {
  CanvasAsset,
  CanvasNode,
  CanvasSnapshot,
  CanvasTaskStatus,
} from './canvas.types'

export type CanvasOperationOutputView = {
  id: string
  nodeId?: string
  assetId?: string
  type: CanvasAsset['type']
  title: string
  url?: string
  thumbnailUrl?: string
  text?: string
  mimeType?: string
  width?: number
  height?: number
  pipelineRole?: CanvasNode['data']['pipelineRole']
  productionState?: CanvasNode['data']['productionState']
  panorama360?: CanvasNode['data']['panorama360']
  createdAt: string
  updatedAt: string
}

export type CanvasOperationRunView = {
  taskId: string
  status: CanvasTaskStatus
  progress: number
  createdAt: string
  completedAt?: string
  provider?: string
  modelId?: string
  workflow?: string
  outputs: CanvasOperationOutputView[]
}

function outputTypeForNode(node: CanvasNode | undefined, asset: CanvasAsset | undefined) {
  if (asset) return asset.type
  if (node?.type === 'image' || node?.type === 'audio' || node?.type === 'video') return node.type
  return 'text' as const
}

function outputPipelineRole(
  node: CanvasNode | undefined,
  asset: CanvasAsset | undefined,
): CanvasNode['data']['pipelineRole'] {
  if (node?.data.pipelineRole) return node.data.pipelineRole
  const assetKind = asset?.metadata.kind
  if (
    assetKind === 'character' ||
    assetKind === 'scene' ||
    assetKind === 'prop' ||
    assetKind === 'effect'
  ) {
    return assetKind
  }
  const filmKind = asset?.metadata.filmKind
  if (
    filmKind === 'character' ||
    filmKind === 'scene' ||
    filmKind === 'prop' ||
    filmKind === 'effect' ||
    filmKind === 'camera' ||
    filmKind === 'frame' ||
    filmKind === 'action' ||
    filmKind === 'design_card' ||
    filmKind === 'shot' ||
    filmKind === 'keyframe' ||
    filmKind === 'clip'
  ) {
    return filmKind
  }
  return undefined
}

function operationOutputView(
  node: CanvasNode | undefined,
  asset: CanvasAsset | undefined,
  fallbackId: string,
): CanvasOperationOutputView {
  const url = node?.data.url ?? asset?.url ?? undefined
  const thumbnailUrl = node?.data.thumbnailUrl ?? asset?.thumbnailUrl ?? undefined
  const text = node?.data.text ?? asset?.contentText ?? undefined
  const mimeType = node?.data.mimeType ?? asset?.mimeType ?? undefined
  const width = asset?.width ?? undefined
  const height = asset?.height ?? undefined
  const pipelineRole = outputPipelineRole(node, asset)
  return {
    id: node?.id ?? asset?.id ?? fallbackId,
    ...(node ? { nodeId: node.id } : {}),
    ...(asset ? { assetId: asset.id } : {}),
    type: outputTypeForNode(node, asset),
    title: node?.title ?? asset?.title ?? '未命名产物',
    ...(url ? { url } : {}),
    ...(thumbnailUrl ? { thumbnailUrl } : {}),
    ...(text ? { text } : {}),
    ...(mimeType ? { mimeType } : {}),
    ...(width ? { width } : {}),
    ...(height ? { height } : {}),
    ...(pipelineRole ? { pipelineRole } : {}),
    ...(node?.data.productionState ? { productionState: node.data.productionState } : {}),
    ...(node?.data.panorama360 ? { panorama360: node.data.panorama360 } : {}),
    createdAt: node?.createdAt ?? asset?.createdAt ?? '',
    updatedAt: node?.updatedAt ?? asset?.updatedAt ?? '',
  }
}

/**
 * 将现有 CanvasTask / generated edge / 资源节点投影成操作节点可消费的运行历史。
 * 只做视图聚合，不改变任务、资产和血缘的持久化结构。
 */
export function buildCanvasOperationRunViews(
  operationNode: CanvasNode,
  snapshot: CanvasSnapshot,
): CanvasOperationRunView[] {
  if (!isOperationNode(operationNode)) return []

  const generatedEdges = snapshot.edges.filter(
    (edge) => edge.sourceNodeId === operationNode.id && edge.type === 'generated',
  )
  const taskIds = new Set<string>()
  if (operationNode.taskId) taskIds.add(operationNode.taskId)
  for (const edge of generatedEdges) {
    if (edge.taskId) taskIds.add(edge.taskId)
  }

  const nodesById = new Map(snapshot.nodes.map((node) => [node.id, node]))
  const assetsById = new Map(snapshot.assets.map((asset) => [asset.id, asset]))

  return snapshot.tasks
    .filter((task) => taskIds.has(task.id))
    .map((task): CanvasOperationRunView => {
      const outputs: CanvasOperationOutputView[] = []
      const seen = new Set<string>()

      for (const nodeId of task.outputNodeIds) {
        const node = nodesById.get(nodeId)
        const asset = node?.assetId ? assetsById.get(node.assetId) : undefined
        const view = operationOutputView(node, asset, nodeId)
        if (seen.has(view.id)) continue
        seen.add(view.id)
        outputs.push(view)
      }

      for (const assetId of task.outputAssetIds) {
        const asset = assetsById.get(assetId)
        if (!asset || seen.has(asset.id)) continue
        const node = snapshot.nodes.find((item) => item.assetId === assetId)
        const view = operationOutputView(node, asset, assetId)
        if (seen.has(view.id)) continue
        seen.add(view.id)
        outputs.push(view)
      }

      return {
        taskId: task.id,
        status: task.status,
        progress: task.progress,
        createdAt: task.createdAt,
        ...(task.completedAt ? { completedAt: task.completedAt } : {}),
        ...(task.provider ? { provider: task.provider } : {}),
        ...(task.modelId ? { modelId: task.modelId } : {}),
        ...(typeof task.modelParams?.workflow === 'string'
          ? { workflow: task.modelParams.workflow }
          : {}),
        outputs,
      }
    })
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
}

export function canvasOperationRunsFingerprint(runs: CanvasOperationRunView[]): string {
  return runs
    .map(
      (run) =>
        `${run.taskId}:${run.status}:${run.progress}:${run.outputs
          .map((output) => `${output.id}:${output.updatedAt}`)
          .join(',')}`,
    )
    .join('|')
}

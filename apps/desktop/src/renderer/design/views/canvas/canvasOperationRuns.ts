import { resolveStorageKeyToAbsolutePath } from './assetLibrary/storageKey'
import { isOperationNode } from './canvas.capabilities'
import type { CanvasAsset, CanvasNode, CanvasSnapshot, CanvasTaskStatus } from './canvas.types'

export type CanvasOperationOutputView = {
  id: string
  /** 所属运行任务；删除等持久化操作据此只修改当前 run。 */
  taskId?: string
  nodeId?: string
  assetId?: string
  type: CanvasAsset['type']
  title: string
  url?: string
  thumbnailUrl?: string
  /** 本地产物在磁盘上的路径；本地媒体任务（如分离音频）直读用。 */
  filePath?: string
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
  errorMsg?: string | null
  errorDetail?: string | null
  outputs: CanvasOperationOutputView[]
}

/**
 * 节点快捷删除只补齐“没有可直接操作的成功产物”这一侧：
 * 非成功运行无论是否已有部分产物都可整次清理；成功但无产物的空记录也可清理。
 * 成功且有产物时继续使用节点既有的产物级删除，避免两个相同删除入口并存。
 */
export function isCanvasOperationRunQuickDeletable(
  run: CanvasOperationRunView | undefined,
): run is CanvasOperationRunView {
  return Boolean(run && (run.status !== 'completed' || run.outputs.length === 0))
}

/** 只从真实运行历史中解析当前任务，避免为悬空 taskId 伪造可删除记录。 */
export function resolveCanvasOperationCurrentRun(
  operationNode: CanvasNode,
  runs: CanvasOperationRunView[],
): CanvasOperationRunView | undefined {
  if (operationNode.taskId) {
    const matchingRun = runs.find((run) => run.taskId === operationNode.taskId)
    if (matchingRun) return matchingRun
  }
  return runs[0]
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

/**
 * 解析任务产物 asset 的本地绝对路径。
 *
 * storageKey 自「assetLibrary 缺陷 3」归一化后对项目目录内文件存的是相对 key
 * （相对 project.rootPath），不能直接当 filePath 使用——本地处理链路
 * （image:probe / ffmpeg 等）一律要求绝对路径，readMediaLocalFilePath 对
 * node.data.filePath 也是原样返回。因此优先取 metadata.filePath（落库时的
 * 权威绝对路径，与 storageKey 指向同一份文件），缺失时再把 storageKey
 * 解析回绝对路径（历史绝对路径原样返回）。
 */
export function resolveOperationOutputLocalFilePath(
  asset: CanvasAsset | undefined,
  projectRootPath: string | null | undefined,
): string | undefined {
  if (!asset) return undefined
  const metaFilePath = (asset.metadata as { filePath?: unknown } | undefined)?.filePath
  if (typeof metaFilePath === 'string' && metaFilePath.trim()) return metaFilePath
  return resolveStorageKeyToAbsolutePath(asset.storageKey, projectRootPath) ?? undefined
}

function operationOutputView(
  node: CanvasNode | undefined,
  asset: CanvasAsset | undefined,
  fallbackId: string,
  taskId: string,
  projectRootPath: string | null | undefined,
): CanvasOperationOutputView {
  const url = node?.data.url ?? asset?.url ?? undefined
  const thumbnailUrl = node?.data.thumbnailUrl ?? asset?.thumbnailUrl ?? undefined
  const text = node?.data.text ?? asset?.contentText ?? undefined
  const mimeType = node?.data.mimeType ?? asset?.mimeType ?? undefined
  const panorama360 =
    node?.data.panorama360 ??
    (asset?.metadata.panorama360 as CanvasNode['data']['panorama360'] | undefined)
  const width = node?.data.mediaWidth ?? asset?.width ?? undefined
  const height = node?.data.mediaHeight ?? asset?.height ?? undefined
  const pipelineRole = outputPipelineRole(node, asset)
  // storageKey 可能是相对 key，须经 resolveOperationOutputLocalFilePath 归一为绝对路径
  const filePath = node?.data.filePath ?? resolveOperationOutputLocalFilePath(asset, projectRootPath)
  return {
    id: node?.id ?? asset?.id ?? fallbackId,
    taskId,
    ...(node ? { nodeId: node.id } : {}),
    ...(asset ? { assetId: asset.id } : {}),
    type: outputTypeForNode(node, asset),
    title: node?.title ?? asset?.title ?? '未命名产物',
    ...(url ? { url } : {}),
    ...(thumbnailUrl ? { thumbnailUrl } : {}),
    ...(filePath ? { filePath } : {}),
    ...(text ? { text } : {}),
    ...(mimeType ? { mimeType } : {}),
    ...(width ? { width } : {}),
    ...(height ? { height } : {}),
    ...(pipelineRole ? { pipelineRole } : {}),
    ...(node?.data.productionState ? { productionState: node.data.productionState } : {}),
    ...(panorama360 ? { panorama360 } : {}),
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
  const generatedEdgesByTaskId = new Map<string, typeof generatedEdges>()
  for (const edge of generatedEdges) {
    if (!edge.taskId) continue
    const taskEdges = generatedEdgesByTaskId.get(edge.taskId) ?? []
    taskEdges.push(edge)
    generatedEdgesByTaskId.set(edge.taskId, taskEdges)
  }

  const collectOutputs = (
    taskId: string,
    outputNodeIds: string[],
    outputAssetIds: string[],
  ): CanvasOperationOutputView[] => {
    const outputs: CanvasOperationOutputView[] = []
    const seen = new Set<string>()
    const nodeOutputAssetIds = new Set<string>()
    const nodeIds = new Set([
      ...outputNodeIds,
      ...(generatedEdgesByTaskId.get(taskId) ?? []).map((edge) => edge.targetNodeId),
    ])

    for (const nodeId of nodeIds) {
      const node = nodesById.get(nodeId)
      const asset = node?.assetId ? assetsById.get(node.assetId) : undefined
      if (!node && !asset) continue
      const view = operationOutputView(node, asset, nodeId, taskId, snapshot.project.rootPath)
      if (seen.has(view.id)) continue
      seen.add(view.id)
      if (view.assetId) nodeOutputAssetIds.add(view.assetId)
      outputs.push(view)
    }

    for (const assetId of outputAssetIds) {
      const asset = assetsById.get(assetId)
      if (!asset || nodeOutputAssetIds.has(asset.id) || seen.has(asset.id)) continue
      // Asset-only outputs have no owned output node. Do not borrow an
      // independent materialized/reference node that happens to share the
      // asset, otherwise the output identity changes after expansion.
      const view = operationOutputView(undefined, asset, assetId, taskId, snapshot.project.rootPath)
      if (seen.has(view.id)) continue
      seen.add(view.id)
      outputs.push(view)
    }
    return outputs
  }

  const persistedTaskIds = new Set<string>()
  const persistedRuns = snapshot.tasks
    .filter((task) => task.operationNodeId === operationNode.id || taskIds.has(task.id))
    .map((task): CanvasOperationRunView => {
      persistedTaskIds.add(task.id)
      const outputs = collectOutputs(task.id, task.outputNodeIds, task.outputAssetIds)

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
        ...(task.errorMsg ? { errorMsg: task.errorMsg } : {}),
        ...(task.errorDetail ? { errorDetail: task.errorDetail } : {}),
        outputs,
      }
    })

  // Historical cleanup versions deleted failed CanvasTask rows without removing
  // their generated edges/assets. Synthesize a compact completed run from the
  // surviving graph so existing projects keep their playable artifacts.
  const recoveredRuns = Array.from(taskIds).flatMap((taskId): CanvasOperationRunView[] => {
    if (persistedTaskIds.has(taskId)) return []
    const outputs = collectOutputs(taskId, [], [])
    if (outputs.length === 0) return []
    const createdAt =
      (generatedEdgesByTaskId.get(taskId) ?? [])
        .map((edge) => edge.createdAt)
        .sort()
        .at(-1) ??
      outputs
        .map((output) => output.createdAt)
        .sort()
        .at(-1) ??
      operationNode.updatedAt
    const completedAt =
      outputs
        .map((output) => output.updatedAt)
        .sort()
        .at(-1) ?? operationNode.updatedAt
    return [
      {
        taskId,
        status: 'completed',
        progress: 100,
        createdAt,
        completedAt,
        ...(operationNode.data.modelId ? { modelId: operationNode.data.modelId } : {}),
        outputs,
      },
    ]
  })

  return [...persistedRuns, ...recoveredRuns].sort((left, right) =>
    right.createdAt.localeCompare(left.createdAt),
  )
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

/**
 * 仅描述会改变产物选择坐标的运行/产物结构。
 * 进度、状态和缩略图元数据更新仍由完整 fingerprint 触发视图刷新，但不应清除用户
 * 已选择的历史产物；新增/删除 run 或 output 时才让选择回落到最新有效产物。
 */
export function canvasOperationOutputSelectionFingerprint(runs: CanvasOperationRunView[]): string {
  return runs
    .map((run) => `${run.taskId}:${run.outputs.map((output) => output.id).join(',')}`)
    .join('|')
}

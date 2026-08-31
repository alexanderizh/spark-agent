import { isOperationNode } from './canvas.capabilities'
import {
  buildCanvasOperationRunViews,
  resolveOperationOutputLocalFilePath,
  type CanvasOperationOutputView,
  type CanvasOperationRunView,
} from './canvasOperationRuns'
import type {
  CanvasAsset,
  CanvasNode,
  CanvasOperationOutputMode,
  CanvasSnapshot,
} from './canvas.types'

const COLLECTION_WORKFLOWS = new Set([
  'extract_character',
  'extract_scene',
  'script_breakdown',
  'shot_expand_to_canvas',
])

export type CanvasOperationOutputState = {
  mode: CanvasOperationOutputMode
  primaryOutput: CanvasOperationOutputView | null
  primaryRun: CanvasOperationRunView | null
  primaryRunIndex: number
  primaryOutputIndex: number
  latestRunWithOutputsIndex: number
}

function outputMatchesId(output: CanvasOperationOutputView, id: string): boolean {
  return output.id === id || output.nodeId === id || output.assetId === id
}

function outputIdentity(output: CanvasOperationOutputView): string {
  return output.assetId ?? output.nodeId ?? output.id
}

function workflowForOperation(
  node: CanvasNode,
  runs: CanvasOperationRunView[],
): string | undefined {
  const nodeWorkflow = node.data.modelParams?.workflow
  if (typeof nodeWorkflow === 'string' && nodeWorkflow.trim()) return nodeWorkflow.trim()
  return runs.find((run) => run.workflow)?.workflow
}

export function inferCanvasOperationOutputMode(
  node: CanvasNode,
  runs: CanvasOperationRunView[],
): CanvasOperationOutputMode {
  if (node.data.outputMode) return node.data.outputMode
  const workflow = workflowForOperation(node, runs)
  if (workflow && COLLECTION_WORKFLOWS.has(workflow)) return 'collection'
  const latestRun = runs.find((run) => run.outputs.length > 0)
  return (latestRun?.outputs.length ?? 0) > 1 ? 'candidates' : 'single'
}

export function resolveCanvasOperationOutputState(
  node: CanvasNode,
  runs: CanvasOperationRunView[],
): CanvasOperationOutputState {
  const latestRunWithOutputsIndex = runs.findIndex((run) => run.outputs.length > 0)
  // 节点状态与产物预览是两个维度：最新一轮 running/failed/cancelled 且尚无产物时，
  // 仍展示最近一次成功产物；状态徽标、跑马灯和任务面板继续读取节点/最新任务状态。
  // 只有从未产生过产物时才落到最新空 run 的进度/错误 fallback。
  let primaryRunIndex =
    latestRunWithOutputsIndex >= 0 ? latestRunWithOutputsIndex : runs.length > 0 ? 0 : -1
  let primaryOutputIndex =
    primaryRunIndex >= 0 && (runs[primaryRunIndex]?.outputs.length ?? 0) > 0 ? 0 : -1

  const primaryOutputId = node.data.primaryOutputId
  if (primaryOutputId) {
    for (let runIndex = 0; runIndex < runs.length; runIndex += 1) {
      const run = runs[runIndex]
      if (!run) continue
      const outputIndex = run.outputs.findIndex((output) =>
        outputMatchesId(output, primaryOutputId),
      )
      if (outputIndex >= 0) {
        primaryRunIndex = runIndex
        primaryOutputIndex = outputIndex
        break
      }
    }
  }

  const primaryRun = primaryRunIndex >= 0 ? (runs[primaryRunIndex] ?? null) : null
  const primaryOutput =
    primaryRun && primaryOutputIndex >= 0 ? (primaryRun.outputs[primaryOutputIndex] ?? null) : null
  return {
    mode: inferCanvasOperationOutputMode(node, runs),
    primaryOutput,
    primaryRun,
    primaryRunIndex,
    primaryOutputIndex,
    latestRunWithOutputsIndex,
  }
}

function assetNodeType(asset: CanvasAsset): CanvasNode['type'] {
  if (asset.type === 'image' || asset.type === 'video' || asset.type === 'audio') return asset.type
  return asset.type === 'prompt' ? 'prompt' : 'text'
}

function outputToInputNode(
  output: CanvasOperationOutputView,
  operationNode: CanvasNode,
  snapshot: CanvasSnapshot,
): CanvasNode | null {
  const asset = output.assetId
    ? snapshot.assets.find((candidate) => candidate.id === output.assetId)
    : undefined
  if (output.nodeId) {
    const persisted = snapshot.nodes.find((node) => node.id === output.nodeId)
    if (persisted) {
      const panorama360 =
        persisted.data.panorama360 ??
        output.panorama360 ??
        (asset?.metadata.panorama360 as CanvasNode['data']['panorama360'] | undefined)
      if (!panorama360 || persisted.data.panorama360) return persisted
      return {
        ...persisted,
        data: { ...persisted.data, panorama360 },
      }
    }
  }
  if (!asset) return null
  const type = assetNodeType(asset)
  const width = asset.width && asset.width > 0 ? Math.min(640, asset.width) : 360
  const height =
    asset.width && asset.height && asset.width > 0
      ? Math.max(180, Math.round((width * asset.height) / asset.width))
      : 240
  const url = output.url ?? asset.url ?? undefined
  const thumbnailUrl = output.thumbnailUrl ?? asset.thumbnailUrl ?? undefined
  const mimeType = output.mimeType ?? asset.mimeType ?? undefined
  const panorama360 =
    output.panorama360 ??
    (asset.metadata.panorama360 as CanvasNode['data']['panorama360'] | undefined)
  // storageKey 可能是相对 key（assetLibrary 缺陷 3 归一化），须经
  // resolveOperationOutputLocalFilePath 归一为绝对路径，否则下游
  // readMediaLocalFilePath 原样返回相对路径，image:probe / ffmpeg 链路直接失败。
  const filePath =
    output.filePath ?? resolveOperationOutputLocalFilePath(asset, snapshot.project.rootPath)
  return {
    id: `operation-output:${outputIdentity(output)}`,
    projectId: operationNode.projectId,
    boardId: operationNode.boardId,
    userId: operationNode.userId,
    type,
    title: output.title,
    assetId: asset.id,
    x: operationNode.x,
    y: operationNode.y,
    width,
    height,
    rotation: 0,
    zIndex: operationNode.zIndex,
    locked: true,
    hidden: false,
    data:
      type === 'text' || type === 'prompt'
        ? {
            text: output.text ?? asset.contentText ?? '',
            format: type === 'prompt' ? 'prompt' : 'plain',
            origin: 'task_output',
            ...(output.pipelineRole ? { pipelineRole: output.pipelineRole } : {}),
          }
        : {
            ...(url ? { url } : {}),
            ...(thumbnailUrl ? { thumbnailUrl } : {}),
            ...(filePath ? { filePath } : {}),
            ...(mimeType ? { mimeType } : {}),
            origin: 'task_output',
            ...(output.pipelineRole ? { pipelineRole: output.pipelineRole } : {}),
            ...(panorama360 ? { panorama360 } : {}),
          },
    createdAt: output.createdAt || asset.createdAt,
    updatedAt: output.updatedAt || asset.updatedAt,
  }
}

/** 将指定运行产物解析为可供下载、全景等资源操作消费的节点视图。 */
export function resolveCanvasOperationOutputResourceNode(
  operationNode: CanvasNode,
  output: CanvasOperationOutputView,
  snapshot: CanvasSnapshot,
): CanvasNode | null {
  if (!isOperationNode(operationNode)) return null
  return outputToInputNode(output, operationNode, snapshot)
}

export function resolveCanvasOperationInputNodes(
  operationNode: CanvasNode,
  snapshot: CanvasSnapshot,
): CanvasNode[] {
  if (!isOperationNode(operationNode)) return [operationNode]
  const runs = buildCanvasOperationRunViews(operationNode, snapshot)
  const state = resolveCanvasOperationOutputState(operationNode, runs)
  const latestRun =
    state.latestRunWithOutputsIndex >= 0 ? runs[state.latestRunWithOutputsIndex] : undefined
  const selectedOutputs =
    state.mode === 'collection' || state.mode === 'bundle'
      ? (latestRun?.outputs ?? [])
      : state.primaryOutput
        ? [state.primaryOutput]
        : []
  const seen = new Set<string>()
  return selectedOutputs.flatMap((output) => {
    const key = outputIdentity(output)
    if (seen.has(key)) return []
    seen.add(key)
    const node = outputToInputNode(output, operationNode, snapshot)
    return node ? [node] : []
  })
}

export function resolveCanvasOperationResourceNode(
  operationNode: CanvasNode,
  snapshot: CanvasSnapshot,
): CanvasNode | null {
  if (!isOperationNode(operationNode)) return operationNode
  const state = resolveCanvasOperationOutputState(
    operationNode,
    buildCanvasOperationRunViews(operationNode, snapshot),
  )
  return state.primaryOutput
    ? resolveCanvasOperationOutputResourceNode(operationNode, state.primaryOutput, snapshot)
    : null
}

/**
 * 收集操作节点全部运行产物中的图片资产（跨所有 run，按 asset.id 去重）。
 *
 * 与节点卡片缩略图切换器同口径：产物级选择（如「从画布选择封面」）要能选到
 * 节点产出的每一张图，而不是只有主产物；主产物/下游输入语义仍由
 * resolveCanvasOperationResourceNode / resolveCanvasOperationInputNodes 提供。
 */
export function collectCanvasOperationImageAssets(
  operationNode: CanvasNode,
  snapshot: CanvasSnapshot,
): CanvasAsset[] {
  if (!isOperationNode(operationNode)) return []
  const runs = buildCanvasOperationRunViews(operationNode, snapshot)
  const assetsById = new Map(snapshot.assets.map((asset) => [asset.id, asset]))
  const seen = new Set<string>()
  const collected: CanvasAsset[] = []
  for (const run of runs) {
    for (const output of run.outputs) {
      if (!output.assetId || seen.has(output.assetId)) continue
      const asset = assetsById.get(output.assetId)
      if (!asset || asset.type !== 'image') continue
      seen.add(output.assetId)
      collected.push(asset)
    }
  }
  return collected
}

export function selectCanvasOperationOutputs(
  runs: CanvasOperationRunView[],
  selection:
    | { scope: 'selected'; selectedOutputIds: string[] }
    | { scope: 'run'; taskId: string }
    | { scope: 'all' },
): CanvasOperationOutputView[] {
  const all = runs.flatMap((run) => run.outputs)
  const candidates =
    selection.scope === 'selected'
      ? selection.selectedOutputIds.flatMap((id) => {
          const output = all.find((candidate) => outputMatchesId(candidate, id))
          return output ? [output] : []
        })
      : selection.scope === 'run'
        ? (runs.find((run) => run.taskId === selection.taskId)?.outputs ?? [])
        : all
  const seen = new Set<string>()
  return candidates.filter((output) => {
    const key = outputIdentity(output)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

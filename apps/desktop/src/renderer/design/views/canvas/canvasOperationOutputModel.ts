import { isOperationNode } from './canvas.capabilities'
import {
  buildCanvasOperationRunViews,
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
  let primaryRunIndex = latestRunWithOutputsIndex
  let primaryOutputIndex = latestRunWithOutputsIndex >= 0 ? 0 : -1

  const primaryOutputId = node.data.primaryOutputId
  if (primaryOutputId) {
    for (let runIndex = 0; runIndex < runs.length; runIndex += 1) {
      const run = runs[runIndex]
      if (!run) continue
      const outputIndex = run.outputs.findIndex((output) => outputMatchesId(output, primaryOutputId))
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
  if (output.nodeId) {
    const persisted = snapshot.nodes.find((node) => node.id === output.nodeId)
    if (persisted) return persisted
  }
  const asset = output.assetId
    ? snapshot.assets.find((candidate) => candidate.id === output.assetId)
    : undefined
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
            ...(mimeType ? { mimeType } : {}),
            origin: 'task_output',
            ...(output.pipelineRole ? { pipelineRole: output.pipelineRole } : {}),
            ...(output.panorama360 ? { panorama360: output.panorama360 } : {}),
          },
    createdAt: output.createdAt || asset.createdAt,
    updatedAt: output.updatedAt || asset.updatedAt,
  }
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
  return state.primaryOutput ? outputToInputNode(state.primaryOutput, operationNode, snapshot) : null
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

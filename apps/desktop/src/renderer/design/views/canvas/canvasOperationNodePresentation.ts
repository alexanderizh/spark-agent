import { getCanvasCapability, isOperationNode, nodeOperation } from './canvas.capabilities'
import { resolveCanvasOperationOutputState } from './canvasOperationOutputModel'
import type { CanvasOperationRunView } from './canvasOperationRuns'
import {
  AUDIO_NODE_DEFAULT_SIZE,
  CANVAS_NODE_META_BAR_HEIGHT,
  OPERATION_NODE_DEFAULT_SIZE,
  fitCollectionOperationNodeSize,
  fitShotScriptOperationNodeSize,
} from './canvasNodeSize'
import { readRenderableShotScriptRows } from './canvasShotScriptPresentation'
import type { CanvasNode } from './canvas.types'
import {
  readCanvasVideoAspectRatio,
  resolveCanvasVideoAspectRatio,
} from './canvasVideoNodePresentation'

/**
 * Returns the persisted node size to apply after a configured aspect ratio changes.
 * Keeping this as a one-time patch lets later manual resizing remain authoritative.
 */
export function operationNodeAspectRatioSizePatch(
  node: CanvasNode,
  nextModelParams: Record<string, unknown>,
): { width: number; height: number } | null {
  if (!isOperationNode(node)) return null

  const operation = nodeOperation(node)
  const outputTypes = operation ? (getCanvasCapability(operation)?.outputTypes ?? []) : []
  if (!outputTypes.includes('image') && !outputTypes.includes('video')) return null

  const previousAspectRatio = readCanvasVideoAspectRatio(node.data.modelParams)
  const nextAspectRatio = readCanvasVideoAspectRatio(nextModelParams)
  if (!nextAspectRatio || nextAspectRatio === previousAspectRatio) return null

  return {
    width: node.width,
    height: Math.max(1, Math.round(node.width / nextAspectRatio)) + CANVAS_NODE_META_BAR_HEIGHT,
  }
}

export function operationNodePresentationSize(
  node: CanvasNode,
  runs: CanvasOperationRunView[],
): { width: number; height: number } {
  if (!isOperationNode(node)) return { width: node.width, height: node.height }

  const isAudioOperation = node.data.operation === 'extract_audio'
  const outputState = resolveCanvasOperationOutputState(node, runs)
  const output = outputState.primaryOutput
  const latestOutputs =
    outputState.latestRunWithOutputsIndex >= 0
      ? (runs[outputState.latestRunWithOutputsIndex]?.outputs ?? [])
      : []

  if (outputState.mode === 'collection' && latestOutputs.length > 0) {
    const fittedSize = fitCollectionOperationNodeSize(latestOutputs.length)
    return {
      width: node.width <= OPERATION_NODE_DEFAULT_SIZE.width ? fittedSize.width : node.width,
      height: node.height <= OPERATION_NODE_DEFAULT_SIZE.height ? fittedSize.height : node.height,
    }
  }

  const storyboardRows = readRenderableShotScriptRows(output?.text)
  if (storyboardRows.length > 0) {
    const fittedSize = fitShotScriptOperationNodeSize(storyboardRows.length)
    return {
      width: node.width <= OPERATION_NODE_DEFAULT_SIZE.width ? fittedSize.width : node.width,
      height: node.height <= OPERATION_NODE_DEFAULT_SIZE.height ? fittedSize.height : node.height,
    }
  }

  // 分离音频任务的可见卡片就是音频资源播放器；旧任务节点可能仍保存普通
  // 操作节点的 460×420，因此这里也按默认尺寸做一次展示层兼容收敛。
  if (isAudioOperation || output?.type === 'audio') {
    const width =
      node.width <= OPERATION_NODE_DEFAULT_SIZE.width ? AUDIO_NODE_DEFAULT_SIZE.width : node.width
    const height =
      node.height <= OPERATION_NODE_DEFAULT_SIZE.height
        ? AUDIO_NODE_DEFAULT_SIZE.height
        : node.height
    return {
      width,
      height,
    }
  }

  if (output?.type === 'video') {
    const aspectRatio = resolveCanvasVideoAspectRatio(
      {
        ...(output.width != null ? { width: output.width } : {}),
        ...(output.height != null ? { height: output.height } : {}),
      },
      node.data.modelParams,
    )
    const mediaHeight = Math.max(1, Math.round(node.width / aspectRatio))
    return {
      width: node.width,
      height: mediaHeight + CANVAS_NODE_META_BAR_HEIGHT,
    }
  }

  if (!output) {
    return { width: node.width, height: node.height }
  }

  if (output.type !== 'image') {
    return {
      width: node.width,
      height: Math.max(node.height, OPERATION_NODE_DEFAULT_SIZE.height),
    }
  }

  const aspectRatio = output.width && output.height ? output.width / output.height : 1
  const mediaHeight = Math.min(720, Math.max(160, Math.round(node.width / aspectRatio)))
  return {
    width: node.width,
    height: mediaHeight + CANVAS_NODE_META_BAR_HEIGHT,
  }
}

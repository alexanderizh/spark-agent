import type { CanvasOperationType } from './canvas.types'
import { canvasOperationKind, type CanvasOperationExecutionKind } from './canvasOperationKind'

export type CanvasOperationRuntimeKind = 'text_full' | 'vision_model' | 'none'
export type CanvasDepthModelState = 'missing' | 'installing' | 'ready' | 'error' | 'unknown'

export type CanvasOperationPanelMode = {
  executionKind: CanvasOperationExecutionKind
  runtimeKind: CanvasOperationRuntimeKind
  showPromptEditor: boolean
  dedicatedMediaKind: 'image' | 'video' | null
  showCustomParams: boolean
  showLocalDepthNotice: boolean
  submitLabel: string
}

export function resolveCanvasOperationPanelMode(
  operation: CanvasOperationType,
): CanvasOperationPanelMode {
  const executionKind = canvasOperationKind(operation)
  if (operation === 'image_prompt_reverse') {
    return {
      executionKind,
      runtimeKind: 'vision_model',
      showPromptEditor: false,
      dedicatedMediaKind: 'image',
      showCustomParams: false,
      showLocalDepthNotice: false,
      submitLabel: '生成提示词',
    }
  }
  if (operation === 'video_depth_map') {
    return {
      executionKind,
      runtimeKind: 'none',
      showPromptEditor: false,
      dedicatedMediaKind: 'video',
      showCustomParams: false,
      showLocalDepthNotice: true,
      submitLabel: '生成深度视频',
    }
  }
  if (executionKind === 'text') {
    return {
      executionKind,
      runtimeKind: 'text_full',
      showPromptEditor: true,
      dedicatedMediaKind: null,
      showCustomParams: true,
      showLocalDepthNotice: false,
      submitLabel: '提交任务',
    }
  }
  return {
    executionKind,
    runtimeKind: 'none',
    showPromptEditor: true,
    dedicatedMediaKind: null,
    showCustomParams: false,
    showLocalDepthNotice: false,
    submitLabel: '提交任务',
  }
}

export function resolveCanvasDepthSubmitLabel(state: CanvasDepthModelState): string {
  if (state === 'missing') return '下载模型并运行'
  if (state === 'installing') return '正在下载深度模型'
  return '生成深度视频'
}

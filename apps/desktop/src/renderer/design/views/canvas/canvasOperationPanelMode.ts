import type { CanvasOperationType } from './canvas.types'
import { canvasOperationKind, type CanvasOperationExecutionKind } from './canvasOperationKind'

export type CanvasOperationRuntimeKind = 'text_full' | 'vision_model' | 'none'

export type CanvasOperationPanelMode = {
  executionKind: CanvasOperationExecutionKind
  runtimeKind: CanvasOperationRuntimeKind
  showPromptEditor: boolean
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
      showCustomParams: true,
      showLocalDepthNotice: false,
      submitLabel: '提交任务',
    }
  }
  return {
    executionKind,
    runtimeKind: 'none',
    showPromptEditor: true,
    showCustomParams: false,
    showLocalDepthNotice: false,
    submitLabel: '提交任务',
  }
}

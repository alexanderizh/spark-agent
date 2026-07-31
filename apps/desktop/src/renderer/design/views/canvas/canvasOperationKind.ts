import type { CanvasOperationType } from './canvas.types'

export type CanvasOperationExecutionKind = 'text' | 'cloud_media' | 'local_media'

export function canvasOperationKind(
  operation: CanvasOperationType,
): CanvasOperationExecutionKind {
  if (
    operation === 'text_generate' ||
    operation === 'text_rewrite' ||
    operation === 'prompt_optimize' ||
    operation === 'image_prompt_reverse'
  ) {
    return 'text'
  }
  if (operation === 'video_depth_map') return 'local_media'
  return 'cloud_media'
}

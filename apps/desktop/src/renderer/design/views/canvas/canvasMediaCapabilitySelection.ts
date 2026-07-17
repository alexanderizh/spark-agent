import type {
  CanvasMediaModelCapabilitySummary,
  CanvasMediaModelSummary,
  CanvasOperationType,
} from '@spark/protocol'
import { capabilityForOperation } from '@spark/protocol'

export interface CanvasMediaCapabilitySelectionInput {
  operation: CanvasOperationType
  model: CanvasMediaModelSummary | null | undefined
  selectedInputNodeIds: ReadonlyArray<string>
  mediaInputOptions: ReadonlyArray<{ value: string; type: string }>
  firstFrameNodeId?: string | undefined
  lastFrameNodeId?: string | undefined
  referenceFrameNodeIds?: ReadonlyArray<string> | undefined
}

/**
 * Select the capability that matches the actual canvas input mode.
 *
 * A model can expose both first-frame I2V and multi-reference R2V. The canvas
 * operation is still `image_to_video`/`text_to_video`, so choosing the first
 * capability by array order would incorrectly apply the I2V image limit to a
 * multi-reference request.
 */
export function selectCanvasMediaCapability(
  input: CanvasMediaCapabilitySelectionInput,
): CanvasMediaModelCapabilitySummary | null {
  const capabilities = input.model?.capabilities ?? []
  const primaryIds = capabilityForOperation(input.operation)
  const primary =
    primaryIds
      .map((id) => capabilities.find((item) => item.id === id))
      .find((item): item is CanvasMediaModelCapabilitySummary => item != null) ?? null
  const reference = capabilities.find((item) => item.id === 'video.reference_to_video') ?? null

  if (!reference || !shouldUseReferenceCapability(input)) return primary
  return reference
}

function shouldUseReferenceCapability(input: CanvasMediaCapabilitySelectionInput): boolean {
  if (input.operation !== 'image_to_video' && input.operation !== 'text_to_video') return false

  const selectedMedia = new Set(input.selectedInputNodeIds)
  const selectedImages = input.mediaInputOptions.filter(
    (item) => item.type === 'image' && selectedMedia.has(item.value),
  )
  const selectedMediaCount = input.mediaInputOptions.filter((item) => selectedMedia.has(item.value)).length
  const hasExplicitReference = (input.referenceFrameNodeIds?.length ?? 0) > 0
  const hasExplicitFrame = Boolean(input.firstFrameNodeId || input.lastFrameNodeId)

  if (hasExplicitReference) return true
  if (hasExplicitFrame) return false
  if (input.operation === 'text_to_video') return selectedMediaCount > 0
  if (selectedMediaCount > selectedImages.length) return true
  return selectedImages.length > 1
}

import type { MediaContractIssue } from '@spark/protocol'
import {
  promptText,
  validationIssue,
  type MediaValidationContext,
} from './media-validator.types.js'

export function validateMidjourneyMediaRequest(
  context: MediaValidationContext,
): MediaContractIssue[] {
  return promptText(context)
    ? []
    : [validationIssue('missing_required', 'Midjourney 任务需要提示词', ['prompt'])]
}

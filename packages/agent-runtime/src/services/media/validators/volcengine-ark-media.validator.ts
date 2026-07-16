import type { MediaContractIssue } from '@spark/protocol'
import {
  promptText,
  validationIssue,
  type MediaValidationContext,
} from './media-validator.types.js'

export function validateVolcengineArkMediaRequest(
  context: MediaValidationContext,
): MediaContractIssue[] {
  const issues: MediaContractIssue[] = []
  const prompt = promptText(context)
  const files = context.input.inputFiles ?? []

  if (context.capability.startsWith('image.') && !prompt) {
    issues.push(validationIssue('missing_required', '火山方舟图片任务需要提示词', ['prompt']))
  }
  if (context.capability.startsWith('video.') && !prompt && files.length === 0) {
    issues.push(
      validationIssue('missing_required', '火山方舟视频任务需要提示词或输入媒体', ['prompt']),
    )
  }
  return issues
}

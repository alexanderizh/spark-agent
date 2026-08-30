import type { MediaContractIssue } from '@spark/protocol'
import {
  imageInputFiles,
  promptText,
  validationIssue,
  type MediaValidationContext,
} from './media-validator.types.js'

export function validateAgnesMediaRequest(context: MediaValidationContext): MediaContractIssue[] {
  const issues: MediaContractIssue[] = []
  const images = imageInputFiles(context)
  const prompt = promptText(context)

  if (
    (context.capability === 'image.generate' || context.capability === 'image.edit') &&
    prompt.length === 0 &&
    images.length === 0
  ) {
    issues.push(
      validationIssue('missing_required', 'Agnes 图片任务需要提示词或输入图片', ['prompt']),
    )
  }
  if (context.capability === 'image.edit' && images.length === 0) {
    issues.push(validationIssue('missing_required', 'Agnes 图片编辑需要输入图片', ['inputFiles']))
  }
  if (context.capability.startsWith('video.') && prompt.length === 0) {
    issues.push(validationIssue('missing_required', 'Agnes 视频生成需要提示词', ['prompt']))
  }
  if (
    (context.capability === 'video.image_to_video' ||
      context.capability === 'video.reference_to_video') &&
    images.length === 0
  ) {
    issues.push(
      validationIssue('missing_required', 'Agnes 当前视频能力需要输入图片', ['inputFiles']),
    )
  }
  return issues
}

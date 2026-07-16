import type { MediaContractIssue } from '@spark/protocol'
import { validateOpenAiCompatibleMediaRequest } from './openai-compatible-media.validator.js'
import {
  imageInputFiles,
  validationIssue,
  type MediaValidationContext,
} from './media-validator.types.js'

export function validateApimartMediaRequest(context: MediaValidationContext): MediaContractIssue[] {
  const issues = validateOpenAiCompatibleMediaRequest(context)

  if (context.capability !== 'image.edit') return issues

  imageInputFiles(context).forEach((file, index) => {
    const hasPublicUrl = Boolean(file.url && /^https?:\/\//i.test(file.url))
    const hasDataUrl = Boolean(file.dataUrl)
    const hasLocalPath = Boolean(file.path)
    if (!hasPublicUrl && !hasDataUrl && !hasLocalPath) {
      issues.push(
        validationIssue(
          'invalid_type',
          'APIMart 图片编辑仅支持公网图片 URL、dataUrl 或本地文件路径',
          ['inputFiles', index],
        ),
      )
    }
  })

  return issues
}

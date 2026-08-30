import type { MediaContractIssue } from '@spark/protocol'
import {
  imageInputFiles,
  promptText,
  validationIssue,
  type MediaValidationContext,
} from './media-validator.types.js'

export function validateGoogleGenerativeAiMediaRequest(
  context: MediaValidationContext,
): MediaContractIssue[] {
  const issues: MediaContractIssue[] = []
  const prompt = promptText(context)

  if (context.capability.startsWith('image.') && !prompt) {
    issues.push(validationIssue('missing_required', 'Google 图片任务需要提示词', ['prompt']))
  }
  if (context.capability === 'video.generate' && !prompt) {
    issues.push(validationIssue('missing_required', 'Google 视频生成需要提示词', ['prompt']))
  }

  const referenceImages = imageInputFiles(context).filter((file) => file.role === 'reference')
  if (context.capability.startsWith('video.') && referenceImages.length > 3) {
    issues.push(validationIssue('out_of_range', 'Google 视频参考图最多支持 3 张', ['inputFiles']))
  }

  for (const [index, file] of (context.input.inputFiles ?? []).entries()) {
    if (file.type !== 'image' && file.type !== 'file') continue
    if (file.dataUrl || file.path) continue
    issues.push(
      validationIssue('missing_required', 'Google 媒体图片输入需要 dataUrl 或本地文件路径', [
        'inputFiles',
        index,
      ]),
    )
  }
  return issues
}

import type { MediaContractIssue } from '@spark/protocol'
import {
  imageInputFiles,
  inputFilesOfKind,
  promptText,
  validationIssue,
  type MediaValidationContext,
} from './media-validator.types.js'

export function validateOpenAiCompatibleMediaRequest(
  context: MediaValidationContext,
): MediaContractIssue[] {
  const issues: MediaContractIssue[] = []
  const prompt = promptText(context)
  const images = imageInputFiles(context)

  if (context.capability === 'image.generate' && !prompt) {
    issues.push(validationIssue('missing_required', '图片生成需要提示词', ['prompt']))
  }
  if (context.capability === 'image.edit' && images.length === 0) {
    issues.push(validationIssue('missing_required', '图片编辑需要输入图片', ['inputFiles']))
  }
  if (context.capability === 'image.edit' && !prompt) {
    issues.push(validationIssue('missing_required', '图片编辑需要提示词', ['prompt']))
  }
  if (context.capability === 'audio.speech' && !prompt) {
    issues.push(validationIssue('missing_required', '语音合成需要文本', ['prompt']))
  }
  if (
    context.capability === 'audio.transcription' &&
    inputFilesOfKind(context, 'audio').length === 0 &&
    inputFilesOfKind(context, 'file').length === 0
  ) {
    issues.push(validationIssue('missing_required', '语音转写需要音频文件', ['inputFiles']))
  }
  if (context.capability === 'video.generate' && !prompt) {
    issues.push(validationIssue('missing_required', '视频生成需要提示词', ['prompt']))
  }
  return issues
}

import type { MediaContractIssue, MediaManifestInputKind } from '@spark/protocol'
import {
  imageInputFiles,
  inputFilesOfKind,
  promptText,
  validationIssue,
  type MediaValidationContext,
} from './media-validator.types.js'

export function validateCommonMediaRequest(context: MediaValidationContext): MediaContractIssue[] {
  const issues: MediaContractIssue[] = []
  const capability = context.manifestCapability
  const files = context.input.inputFiles ?? []

  for (const [index, file] of files.entries()) {
    if (file.dataUrl && !/^data:[^;,]+;base64,.+$/is.test(file.dataUrl)) {
      issues.push(
        validationIssue('invalid_type', `第 ${index + 1} 个输入文件的 dataUrl 格式无效`, [
          'inputFiles',
          index,
          'dataUrl',
        ]),
      )
    }
  }

  if (capability) {
    for (const required of capability.input.required) {
      if (!hasRequiredInput(context, required)) {
        issues.push(
          validationIssue(
            'missing_required',
            `模型 ${context.modelId} 的 ${capability.label} 缺少必需输入：${required}`,
            required === 'prompt' || required === 'text' ? ['prompt'] : ['inputFiles', required],
          ),
        )
      }
    }

    const images = imageInputFiles(context)
    if (capability.input.maxImages != null && images.length > capability.input.maxImages) {
      issues.push(
        validationIssue(
          'out_of_range',
          `模型 ${context.modelId} 最多支持 ${capability.input.maxImages} 张图片，当前选择了 ${images.length} 张`,
          ['inputFiles'],
        ),
      )
    }

    const videos = inputFilesOfKind(context, 'video')
    if (capability.input.maxVideos != null && videos.length > capability.input.maxVideos) {
      issues.push(
        validationIssue(
          'out_of_range',
          `模型 ${context.modelId} 最多支持 ${capability.input.maxVideos} 段视频，当前选择了 ${videos.length} 段`,
          ['inputFiles'],
        ),
      )
    }

    const audios = inputFilesOfKind(context, 'audio')
    if (capability.input.maxAudios != null && audios.length > capability.input.maxAudios) {
      issues.push(
        validationIssue(
          'out_of_range',
          `模型 ${context.modelId} 最多支持 ${capability.input.maxAudios} 段音频，当前选择了 ${audios.length} 段`,
          ['inputFiles'],
        ),
      )
    }

    const acceptedMimeTypes = capability.input.acceptedMimeTypes ?? []
    if (acceptedMimeTypes.length > 0) {
      const accepted = new Set(acceptedMimeTypes.map(normalizeMimeType))
      for (const [index, file] of files.entries()) {
        if (!file.mimeType || accepted.has(normalizeMimeType(file.mimeType))) continue
        issues.push(
          validationIssue(
            'invalid_enum',
            `模型 ${context.modelId} 不支持输入格式 ${file.mimeType}`,
            ['inputFiles', index, 'mimeType'],
          ),
        )
      }
    }
  }

  const promptSafety = context.manifest?.safety
  const maxPromptLength = promptSafety?.maxPromptLength
  const prompt = context.input.prompt ?? ''
  const promptLengthUnit = promptSafety?.promptLengthUnit ?? 'provider_specific'
  const observedLength = Array.from(prompt).length
  if (maxPromptLength != null && observedLength > maxPromptLength) {
    const thresholdLabel =
      promptLengthUnit === 'tokens'
        ? `${maxPromptLength} Token`
        : promptLengthUnit === 'characters'
          ? `${maxPromptLength} 个字符`
          : `清单中的参考值 ${maxPromptLength}`
    const observedLabel =
      promptLengthUnit === 'characters'
        ? `当前为 ${observedLength} 个字符`
        : `当前可观测字符长度为 ${observedLength}`
    const providerBehavior =
      promptSafety?.promptOverflowBehavior === 'truncate'
        ? '；Provider 文档说明超出部分会自动截断'
        : promptSafety?.promptOverflowBehavior === 'reject'
          ? '；Provider 可能拒绝该请求'
          : '；是否接受由 Provider 最终判定'
    issues.push(
      validationIssue(
        'out_of_range',
        `提示词可能超过模型的${thresholdLabel}，${observedLabel}${providerBehavior}。本地不会阻断请求`,
        ['prompt'],
        'warning',
      ),
    )
  }

  if (context.manifest?.safety?.allowLocalFiles === false) {
    for (const [index, file] of files.entries()) {
      if (!file.path) continue
      issues.push(
        validationIssue('forbidden_param', `模型 ${context.modelId} 不允许直接使用本地文件路径`, [
          'inputFiles',
          index,
          'path',
        ]),
      )
    }
  }

  return issues
}

function normalizeMimeType(value: string): string {
  const normalized = value.split(';', 1)[0]?.trim().toLowerCase() ?? ''
  return normalized === 'image/jpg' ? 'image/jpeg' : normalized
}

function hasRequiredInput(
  context: MediaValidationContext,
  required: MediaManifestInputKind,
): boolean {
  if (required === 'prompt' || required === 'text') return promptText(context).length > 0
  if (required === 'image' || required === 'images') return imageInputFiles(context).length > 0
  if (required === 'video') return inputFilesOfKind(context, 'video').length > 0
  if (required === 'audio') return inputFilesOfKind(context, 'audio').length > 0
  if (required === 'file') return (context.input.inputFiles ?? []).length > 0
  if (required === 'mask') {
    return (context.input.inputFiles ?? []).some((file) => file.role === 'mask')
  }
  return true
}

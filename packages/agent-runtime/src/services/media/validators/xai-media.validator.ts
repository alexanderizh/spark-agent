import type { MediaContractIssue } from '@spark/protocol'
import {
  imageInputFiles,
  inputFilesOfKind,
  numericParam,
  promptText,
  stringParam,
  validationIssue,
  type MediaValidationContext,
} from './media-validator.types.js'

export function validateXaiMediaRequest(context: MediaValidationContext): MediaContractIssue[] {
  const issues: MediaContractIssue[] = []
  const { capability, modelId, input } = context
  const prompt = promptText(context)
  const images = imageInputFiles(context)
  const videos = inputFilesOfKind(context, 'video')

  if (capability === 'image.generate' && images.length === 0 && prompt.length === 0) {
    issues.push(validationIssue('missing_required', 'xAI 图片生成需要提示词', ['prompt']))
  }
  if (capability === 'image.edit') {
    if (prompt.length === 0) {
      issues.push(validationIssue('missing_required', 'xAI 图片编辑需要提示词', ['prompt']))
    }
    if (images.length === 0) {
      issues.push(
        validationIssue('missing_required', 'xAI 图片编辑需要至少一张输入图片', ['inputFiles']),
      )
    }
    if (images.length > 3) {
      issues.push(
        validationIssue('out_of_range', 'xAI 图片编辑最多支持 3 张输入图片', ['inputFiles']),
      )
    }
  }
  if (capability === 'audio.speech') {
    if (prompt.length === 0) {
      issues.push(validationIssue('missing_required', 'xAI 语音合成需要文本', ['prompt']))
    } else if (prompt.length > 15_000) {
      issues.push(
        validationIssue(
          'out_of_range',
          'xAI 语音合成文本可能超过 15000 个字符；本地不会阻断请求',
          ['prompt'],
          'warning',
        ),
      )
    }
  }

  if (capability.startsWith('video.')) {
    if (capability !== 'video.image_to_video' && prompt.length === 0) {
      issues.push(validationIssue('missing_required', 'xAI 视频任务需要提示词', ['prompt']))
    }
    if (modelId.startsWith('grok-imagine-video-1.5') && capability !== 'video.image_to_video') {
      issues.push(
        validationIssue('conflicting_params', `${modelId} 仅支持图生视频`, ['capability']),
      )
    }
  }

  if (
    capability === 'video.generate' ||
    capability === 'video.image_to_video' ||
    capability === 'video.reference_to_video'
  ) {
    if (videos.length > 0) {
      issues.push(
        validationIssue('forbidden_param', 'xAI 视频生成不支持参考视频输入', ['inputFiles']),
      )
    }
    if ((input.inputFiles ?? []).some((file) => file.role === 'last_frame')) {
      issues.push(validationIssue('forbidden_param', 'xAI 视频生成不支持尾帧输入', ['inputFiles']))
    }
  }

  if (capability === 'video.image_to_video') {
    const hasFirstFrame = images.some((file) => file.role === 'first_frame') || images.length > 0
    if (!hasFirstFrame) {
      issues.push(
        validationIssue('missing_required', `xAI ${modelId} 需要首帧图片`, ['inputFiles']),
      )
    }
  }

  if (capability === 'video.reference_to_video') {
    const explicitReferences = images.filter((file) => file.role === 'reference')
    const references = explicitReferences.length > 0 ? explicitReferences : images
    if (references.length > 7) {
      issues.push(validationIssue('out_of_range', 'xAI reference-to-video supports at most 7 reference images', ['inputFiles']))
    }
    if (references.length === 0) {
      issues.push(validationIssue('missing_required', 'xAI 参考生视频需要参考图片', ['inputFiles']))
    }
  }

  if (capability === 'video.edit' || capability === 'video.extend') {
    if (videos.length === 0) {
      issues.push(
        validationIssue('missing_required', `xAI ${capability} requires an input video`, [
          'inputFiles',
        ]),
      )
    }
  }

  const duration = numericParam(input.modelParams, 'durationSeconds', 'duration')
  if (duration != null) {
    const min = capability === 'video.extend' ? 2 : 1
    const max =
      capability === 'video.extend' || capability === 'video.reference_to_video' ? 10 : 15
    if (
      duration < min ||
      duration > max ||
      (capability === 'video.extend' && !Number.isInteger(duration))
    ) {
      issues.push(
        validationIssue(
          'out_of_range',
          `xAI ${capability} 时长必须在 ${min}–${max} 秒之间${
            capability === 'video.extend' ? '，且必须为整数' : ''
          }`,
          ['modelParams', 'durationSeconds'],
        ),
      )
    }
  }

  const resolution = stringParam(input.modelParams, 'resolution')
  if (
    resolution === '1080p' &&
    (capability === 'video.generate' ||
      capability === 'video.image_to_video' ||
      capability === 'video.reference_to_video') &&
    !modelId.startsWith('grok-imagine-video-1.5')
  ) {
    issues.push(
      validationIssue(
        'conflicting_params',
        'xAI 1080p 视频仅支持 Grok Imagine Video 1.5 图生视频模型',
        ['modelParams', 'resolution'],
      ),
    )
  }

  return issues
}

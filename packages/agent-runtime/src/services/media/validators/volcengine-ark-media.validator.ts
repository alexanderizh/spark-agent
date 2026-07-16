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
  if (context.capability.startsWith('video.')) {
    issues.push(...validateSeedanceRequest(context))
  }
  if (context.capability.startsWith('image.')) {
    issues.push(...validateSeedreamRequest(context))
  }
  return issues
}

function validateSeedanceRequest(context: MediaValidationContext): MediaContractIssue[] {
  const issues: MediaContractIssue[] = []
  const files = context.input.inputFiles ?? []
  const images = imageInputFiles(context).filter(
    (file) => !file.mimeType?.startsWith('video/') && !file.mimeType?.startsWith('audio/'),
  )
  const videos = inputFilesOfKind(context, 'video')
  const audios = inputFilesOfKind(context, 'audio')
  const firstFrames = images.filter((file) => file.role === 'first_frame')
  const lastFrames = images.filter((file) => file.role === 'last_frame')
  const references = images.filter((file) => file.role === 'reference')
  const isSeedance2 = context.modelId.startsWith('doubao-seedance-2-0-')
  const isSeedance15 = context.modelId.startsWith('doubao-seedance-1-5-')
  const isSeedance10Fast = context.modelId.includes('seedance-1-0-pro-fast')

  if (firstFrames.length > 1) {
    issues.push(validationIssue('out_of_range', '首帧最多只能选择 1 张', ['inputFiles']))
  }
  if (lastFrames.length > 1) {
    issues.push(validationIssue('out_of_range', '尾帧最多只能选择 1 张', ['inputFiles']))
  }
  if (lastFrames.length > 0 && firstFrames.length === 0) {
    issues.push(validationIssue('missing_required', '尾帧不能脱离首帧单独提交', ['inputFiles']))
  }
  if (isSeedance10Fast && (lastFrames.length > 0 || images.length > 1)) {
    issues.push(
      validationIssue('forbidden_param', 'Seedance 1.0 Pro Fast 仅支持单张首帧，不支持首尾帧', [
        'inputFiles',
      ]),
    )
  }

  const hasExplicitFrameMode = firstFrames.length > 0 || lastFrames.length > 0
  const usesImplicitFrameMode =
    context.capability === 'video.image_to_video' &&
    !hasExplicitFrameMode &&
    references.length === 0 &&
    images.length > 0
  const implicitReferenceImages = usesImplicitFrameMode
    ? images.slice(2)
    : images.filter((file) => file.role !== 'first_frame' && file.role !== 'last_frame')
  const hasFrameMode = hasExplicitFrameMode || usesImplicitFrameMode
  const hasReferenceMode =
    implicitReferenceImages.length > 0 ||
    videos.length > 0 ||
    audios.length > 0 ||
    context.capability === 'video.reference_to_video' ||
    context.capability === 'video.edit' ||
    context.capability === 'video.extend'
  if (hasFrameMode && hasReferenceMode) {
    issues.push(
      validationIssue('conflicting_params', '首帧/首尾帧模式与多模态参考模式互斥，不能混用', [
        'inputFiles',
      ]),
    )
  }
  if (!isSeedance2 && hasReferenceMode) {
    issues.push(
      validationIssue('forbidden_param', `${context.modelId} 不支持多模态参考图、视频或音频`, [
        'inputFiles',
      ]),
    )
  }
  if (isSeedance2 && hasReferenceMode && images.length === 0 && videos.length === 0) {
    issues.push(
      validationIssue('missing_required', '多模态参考不能只传音频，至少需要 1 张图片或 1 段视频', [
        'inputFiles',
      ]),
    )
  }

  const params = context.input.modelParams
  if (booleanParam(params, 'searchEnabled', 'enable_search') && files.length > 0) {
    issues.push(
      validationIssue(
        'conflicting_params',
        '联网搜索仅支持纯文本输入，不能与图片、视频或音频同时使用',
        ['modelParams', 'searchEnabled'],
      ),
    )
  }
  const duration = numericParam(params, 'durationSeconds', 'duration')
  if (duration != null) {
    const valid = isSeedance2
      ? duration === -1 || (duration >= 4 && duration <= 15)
      : isSeedance15
        ? duration === -1 || (duration >= 4 && duration <= 12)
        : duration >= 2 && duration <= 12
    if (!valid) {
      issues.push(
        validationIssue('out_of_range', `${context.modelId} 不支持时长 ${duration} 秒`, [
          'modelParams',
          'durationSeconds',
        ]),
      )
    }
  }

  const frames = numericParam(params, 'frames')
  if (frames != null && (frames < 29 || frames > 289 || (frames - 25) % 4 !== 0)) {
    issues.push(
      validationIssue('out_of_range', 'frames 必须在 29–289 且满足 25+4n', [
        'modelParams',
        'frames',
      ]),
    )
  }
  if (isSeedance2) {
    for (const field of ['seed', 'cameraFixed', 'camera_fixed', 'frames'] as const) {
      if (params?.[field] != null) {
        issues.push(
          validationIssue('forbidden_param', `Seedance 2.0 暂不支持参数 ${field}`, [
            'modelParams',
            field,
          ]),
        )
      }
    }
    if (stringParam(params, 'serviceTier', 'service_tier') === 'flex') {
      issues.push(
        validationIssue('forbidden_param', 'Seedance 2.0 不支持 service_tier=flex', [
          'modelParams',
          'serviceTier',
        ]),
      )
    }
  }
  if (
    booleanParam(params, 'draft') &&
    booleanParam(params, 'returnLastFrame', 'return_last_frame')
  ) {
    issues.push(
      validationIssue('conflicting_params', '样片模式 draft=true 时不支持返回尾帧', [
        'modelParams',
        'returnLastFrame',
      ]),
    )
  }
  if (
    stringParam(params, 'serviceTier', 'service_tier') === 'flex' &&
    numericParam(params, 'priority') != null
  ) {
    issues.push(
      validationIssue('conflicting_params', '离线推理 service_tier=flex 不支持 priority', [
        'modelParams',
        'priority',
      ]),
    )
  }
  if (!isSeedance2 && images.length > 0 && booleanParam(params, 'cameraFixed', 'camera_fixed')) {
    issues.push(
      validationIssue('conflicting_params', 'Seedance 1.x 参考图场景不支持 camera_fixed', [
        'modelParams',
        'cameraFixed',
      ]),
    )
  }
  if (!isSeedance2 && images.length > 0 && stringParam(params, 'resolution') === '1080p') {
    issues.push(
      validationIssue('conflicting_params', 'Seedance 1.x 参考图场景不支持 1080p', [
        'modelParams',
        'resolution',
      ]),
    )
  }

  const knownRequestBytes = files.reduce(
    (sum, file) => sum + (file.dataUrl ? (file.sizeBytes ?? 0) : 0),
    0,
  )
  if (knownRequestBytes > 64 * 1024 * 1024) {
    issues.push(
      validationIssue('out_of_range', 'Seedance 请求体中的已知素材总大小不能超过 64 MB', [
        'inputFiles',
      ]),
    )
  }

  validateSeedanceMediaMetadata(issues, images, videos, audios)
  return issues
}

function validateSeedanceMediaMetadata(
  issues: MediaContractIssue[],
  images: NonNullable<MediaValidationContext['input']['inputFiles']>,
  videos: NonNullable<MediaValidationContext['input']['inputFiles']>,
  audios: NonNullable<MediaValidationContext['input']['inputFiles']>,
): void {
  for (const [index, file] of images.entries()) {
    if (file.sizeBytes != null && file.sizeBytes > 30 * 1024 * 1024) {
      issues.push(
        validationIssue('out_of_range', 'Seedance 单张图片不能超过 30 MB', [
          'inputFiles',
          index,
          'sizeBytes',
        ]),
      )
    }
    validateDimensions(issues, file, index, 300, 6000, 0.4, 2.5, 'Seedance 图片')
  }
  let totalVideoMs = 0
  for (const [index, file] of videos.entries()) {
    if (file.sizeBytes != null && file.sizeBytes > 200 * 1024 * 1024) {
      issues.push(
        validationIssue('out_of_range', 'Seedance 单段参考视频不能超过 200 MB', [
          'inputFiles',
          index,
          'sizeBytes',
        ]),
      )
    }
    if (file.durationMs != null) {
      totalVideoMs += file.durationMs
      if (file.durationMs < 2000 || file.durationMs > 15000) {
        issues.push(
          validationIssue('out_of_range', 'Seedance 单段参考视频时长必须为 2–15 秒', [
            'inputFiles',
            index,
            'durationMs',
          ]),
        )
      }
    }
    validateDimensions(issues, file, index, 300, 6000, 0.4, 2.5, 'Seedance 视频')
  }
  if (totalVideoMs > 15000) {
    issues.push(
      validationIssue('out_of_range', 'Seedance 参考视频总时长不能超过 15 秒', ['inputFiles']),
    )
  }
  let totalAudioMs = 0
  for (const [index, file] of audios.entries()) {
    if (file.sizeBytes != null && file.sizeBytes > 15 * 1024 * 1024) {
      issues.push(
        validationIssue('out_of_range', 'Seedance 单段参考音频不能超过 15 MB', [
          'inputFiles',
          index,
          'sizeBytes',
        ]),
      )
    }
    if (file.durationMs != null) {
      totalAudioMs += file.durationMs
      if (file.durationMs < 2000 || file.durationMs > 15000) {
        issues.push(
          validationIssue('out_of_range', 'Seedance 单段参考音频时长必须为 2–15 秒', [
            'inputFiles',
            index,
            'durationMs',
          ]),
        )
      }
    }
  }
  if (totalAudioMs > 15000) {
    issues.push(
      validationIssue('out_of_range', 'Seedance 参考音频总时长不能超过 15 秒', ['inputFiles']),
    )
  }
}

function validateSeedreamRequest(context: MediaValidationContext): MediaContractIssue[] {
  const issues: MediaContractIssue[] = []
  const images = imageInputFiles(context)
  const params = context.input.modelParams
  const isPro = context.modelId === 'doubao-seedream-5-0-pro-260628'

  for (const field of ['seed', 'guidanceScale', 'guidance_scale', 'negative_prompt'] as const) {
    if (params?.[field] != null) {
      issues.push(
        validationIssue('forbidden_param', `火山图片生成官方参数不包含 ${field}`, [
          'modelParams',
          field,
        ]),
      )
    }
  }
  if (isPro && images.length > 10) {
    issues.push(
      validationIssue('out_of_range', 'Seedream 5.0 Pro 最多支持 10 张参考图', ['inputFiles']),
    )
  }

  const sequential = stringParam(params, 'sequentialImageGeneration', 'sequential_image_generation')
  const generatedCount = numericParam(params, 'maxImages', 'max_images')
  if (sequential === 'auto' && generatedCount != null && images.length + generatedCount > 15) {
    issues.push(
      validationIssue(
        'out_of_range',
        `组图场景要求输入参考图数与生成图数之和不超过 15，当前为 ${images.length + generatedCount}`,
        ['modelParams', 'maxImages'],
      ),
    )
  }
  for (const [index, file] of images.entries()) {
    if (file.sizeBytes != null && file.sizeBytes > 30 * 1024 * 1024) {
      issues.push(
        validationIssue('out_of_range', 'Seedream 单张参考图不能超过 30 MB', [
          'inputFiles',
          index,
          'sizeBytes',
        ]),
      )
    }
    if ((file.width != null && file.width <= 14) || (file.height != null && file.height <= 14)) {
      issues.push(
        validationIssue('out_of_range', 'Seedream 图片宽和高都必须大于 14 px', [
          'inputFiles',
          index,
        ]),
      )
    }
    if (file.width != null && file.height != null) {
      if (file.width * file.height > 36_000_000) {
        issues.push(
          validationIssue('out_of_range', 'Seedream 图片总像素不能超过 36,000,000', [
            'inputFiles',
            index,
          ]),
        )
      }
      const ratio = file.width / file.height
      if (ratio < 1 / 16 || ratio > 16) {
        issues.push(
          validationIssue('out_of_range', 'Seedream 图片宽高比必须在 [1/16,16]', [
            'inputFiles',
            index,
          ]),
        )
      }
    }
  }
  return issues
}

function validateDimensions(
  issues: MediaContractIssue[],
  file: NonNullable<MediaValidationContext['input']['inputFiles']>[number],
  index: number,
  min: number,
  max: number,
  minRatio: number,
  maxRatio: number,
  label: string,
): void {
  if (file.width == null || file.height == null) return
  if (file.width < min || file.width > max || file.height < min || file.height > max) {
    issues.push(
      validationIssue('out_of_range', `${label}宽高必须在 ${min}–${max} px`, ['inputFiles', index]),
    )
  }
  const ratio = file.width / file.height
  if (ratio < minRatio || ratio > maxRatio) {
    issues.push(
      validationIssue('out_of_range', `${label}宽高比必须在 [${minRatio},${maxRatio}]`, [
        'inputFiles',
        index,
      ]),
    )
  }
}

function booleanParam(params: Record<string, unknown> | undefined, ...names: string[]): boolean {
  for (const name of names) {
    const value = params?.[name]
    if (typeof value === 'boolean') return value
    if (typeof value === 'string') {
      if (value.toLowerCase() === 'true') return true
      if (value.toLowerCase() === 'false') return false
    }
  }
  return false
}

import type { MediaContractIssue } from '@spark/protocol'
import { validateOpenAiCompatibleMediaRequest } from './openai-compatible-media.validator.js'
import {
  imageInputFiles,
  inputFilesOfKind,
  numericParam,
  promptText,
  stringParam,
  validationIssue,
  type MediaValidationContext,
} from './media-validator.types.js'

export function validateApimartMediaRequest(context: MediaValidationContext): MediaContractIssue[] {
  const issues = validateOpenAiCompatibleMediaRequest(context)

  if (context.capability.startsWith('video.')) {
    issues.push(...validateApimartVideoRequest(context))
  }

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

function validateApimartVideoRequest(context: MediaValidationContext): MediaContractIssue[] {
  const issues: MediaContractIssue[] = []
  const images = imageInputFiles(context)
  const videos = inputFilesOfKind(context, 'video')
  const audios = inputFilesOfKind(context, 'audio')
  const params = context.input.modelParams

  if (
    ['doubao-seedance-2.0', 'doubao-seedance-2-0-fast'].includes(context.modelId) &&
    promptText(context).length > 4000
  ) {
    issues.push(
      validationIssue(
        'out_of_range',
        'APIMart Seedance 2.0 prompt 可能超过 4000 个字符；本地不会阻断请求',
        ['prompt'],
        'warning',
      ),
    )
  }

  if (
    context.capability === 'video.reference_to_video' &&
    images.length + videos.length + audios.length === 0
  ) {
    issues.push(
      validationIssue('missing_required', 'APIMart 参考生视频需要至少一份参考素材', ['inputFiles']),
    )
  }

  if (context.modelId === 'wan2.7-r2v' && images.length + videos.length > 5) {
    issues.push(
      validationIssue(
        'out_of_range',
        `Wan 2.7 R2V 参考图片与参考视频总数不能超过 5，当前为 ${images.length + videos.length}`,
        ['inputFiles'],
      ),
    )
  }

  if (context.modelId === 'Omni-Flash-Ext') {
    const generationType = stringParam(params, 'generationType', 'generation_type')
    if (
      (context.capability === 'video.reference_to_video' ||
        context.capability === 'video.image_to_video') &&
      images.length > 0 &&
      images.length !== 1 &&
      images.length !== 3
    ) {
      issues.push(
        validationIssue('out_of_range', 'Omni-Flash-Ext 参考模式仅支持 1 张或 3 张参考图', [
          'inputFiles',
        ]),
      )
    }
    if (generationType === 'frame' && images.length > 1) {
      issues.push(
        validationIssue('out_of_range', 'Omni-Flash-Ext 首帧模式仅支持 1 张图片', ['inputFiles']),
      )
    }
    if (videos.length > 0 && numericParam(params, 'durationSeconds', 'duration') != null) {
      issues.push(
        validationIssue('conflicting_params', 'Omni-Flash-Ext 参考视频与 duration 不能同时传入', [
          'modelParams',
          'durationSeconds',
        ]),
      )
    }
  }

  if (context.modelId === 'MiniMax-Hailuo-2.3' || context.modelId === 'MiniMax-Hailuo-02') {
    const resolution = stringParam(params, 'resolution')
    const duration = numericParam(params, 'durationSeconds', 'duration')
    const requiredDuration = context.modelId === 'MiniMax-Hailuo-2.3' ? 6 : 5
    if (resolution === '1080p' && duration != null && duration !== requiredDuration) {
      issues.push(
        validationIssue(
          'conflicting_params',
          `${context.modelId} 使用 1080p 时仅支持 ${requiredDuration} 秒`,
          ['modelParams', 'durationSeconds'],
        ),
      )
    }
  }

  if (context.modelId === 'kling-v2-6') {
    const mode = stringParam(params, 'mode') ?? 'std'
    const audio = booleanParam(params, 'audio')
    const hasTailFrame = images.length > 1 || images.some((file) => file.role === 'last_frame')
    if (hasTailFrame && mode !== 'pro') {
      issues.push(
        validationIssue('conflicting_params', 'Kling 2.6 首尾帧仅支持 pro 模式', [
          'modelParams',
          'mode',
        ]),
      )
    }
    if (audio === true && mode !== 'pro') {
      issues.push(
        validationIssue('conflicting_params', 'Kling 2.6 音频生成仅支持 pro 模式', [
          'modelParams',
          'audio',
        ]),
      )
    }
    if (audio === true && hasTailFrame) {
      issues.push(
        validationIssue('conflicting_params', 'Kling 2.6 尾帧与音频互斥，不能同时使用', [
          'modelParams',
          'audio',
        ]),
      )
    }
  }

  if (context.modelId === 'wan2.5-preview') {
    const resolution = stringParam(params, 'resolution')
    const aspectRatio = stringParam(params, 'aspectRatio', 'aspect_ratio', 'size')
    if (
      resolution === '480p' &&
      aspectRatio != null &&
      !['16:9', '9:16', '1:1'].includes(aspectRatio)
    ) {
      issues.push(
        validationIssue(
          'conflicting_params',
          `Wan 2.5 Preview 的 480p 不支持画面比例 ${aspectRatio}`,
          ['modelParams', 'aspectRatio'],
        ),
      )
    }
    if (booleanParam(params, 'audio') === false) {
      issues.push(
        validationIssue('forbidden_param', 'Wan 2.5 Preview 仅支持 audio=true', [
          'modelParams',
          'audio',
        ]),
      )
    }
  }

  if (context.modelId === 'wan2.7-r2v' && videos.length > 0) {
    const duration = numericParam(params, 'durationSeconds', 'duration')
    if (duration != null && duration > 10) {
      issues.push(
        validationIssue(
          'conflicting_params',
          'Wan 2.7 R2V 包含参考视频时，输出时长只能为 2–10 秒',
          ['modelParams', 'durationSeconds'],
        ),
      )
    }
  }

  if (context.modelId === 'wan3.0-video' && context.capability === 'video.generate') {
    const fileUrl = stringParam(params, 'fileUrl', 'file_url')
    const linkUrl = stringParam(params, 'linkUrl', 'link_url')
    const generationType = stringParam(params, 'generationType', 'generation_type')
    if (
      !promptText(context) &&
      images.length + videos.length + audios.length === 0 &&
      !fileUrl &&
      !linkUrl
    ) {
      issues.push(
        validationIssue(
          'missing_required',
          'Wan 3.0 至少需要 prompt 或一份参考媒体/文件/网页链接',
          ['prompt'],
        ),
      )
    }
    if (fileUrl && linkUrl) {
      issues.push(
        validationIssue('conflicting_params', 'Wan 3.0 的 file_url 与 link_url 不能同时使用', [
          'modelParams',
          'fileUrl',
        ]),
      )
    }
    if (
      generationType === 'frame' &&
      (videos.length > 0 || audios.length > 0 || Boolean(fileUrl) || Boolean(linkUrl))
    ) {
      issues.push(
        validationIssue(
          'conflicting_params',
          'Wan 3.0 的 frame 模式不能与参考视频、参考音频、文件或网页链接混用',
          ['modelParams', 'generationType'],
        ),
      )
    }
  }

  if (context.modelId === 'flux-3-video' && context.capability === 'video.generate') {
    const draft = booleanParam(params, 'draft') === true
    const draftFromTaskId = stringParam(params, 'draftFromTaskId', 'draft_from_task_id')
    const mode = stringParam(params, 'mode')
    const supportedModes = new Set([
      't2v',
      'i2v',
      'v2v',
      'draft_enhance',
      'text-to-video',
      'image-continuation',
      'video-continuation',
    ])
    if (mode && !supportedModes.has(mode)) {
      issues.push(
        validationIssue('invalid_enum', `FLUX 3 Video 不支持生成模式 ${mode}`, [
          'modelParams',
          'mode',
        ]),
      )
    }
    if (!promptText(context) && !draftFromTaskId) {
      issues.push(
        validationIssue(
          'missing_required',
          'FLUX 3 Video 需要 prompt；仅草稿转正式任务时可使用 draft_from_task_id',
          ['prompt'],
        ),
      )
    }
    if (draftFromTaskId && promptText(context)) {
      issues.push(
        validationIssue(
          'conflicting_params',
          'FLUX 3 Video 使用 draft_from_task_id 时不能再次传 prompt',
          ['prompt'],
        ),
      )
    }
    if (draftFromTaskId && (images.length > 0 || videos.length > 0 || audios.length > 0)) {
      issues.push(
        validationIssue(
          'conflicting_params',
          'FLUX 3 Video 使用 draft_from_task_id 时不能再次传入图片或视频',
          ['inputFiles'],
        ),
      )
    }
    if (draft && draftFromTaskId) {
      issues.push(
        validationIssue(
          'conflicting_params',
          'FLUX 3 Video 的 draft 与 draft_from_task_id 不能同时使用',
          ['modelParams', 'draftFromTaskId'],
        ),
      )
    }
    if (draft && stringParam(params, 'resolution') === 'fhd') {
      issues.push(
        validationIssue('conflicting_params', 'FLUX 3 Video 草稿模式只支持 hd 分辨率', [
          'modelParams',
          'resolution',
        ]),
      )
    }
    if ((mode === 'i2v' || mode === 'image-continuation') && images.length === 0) {
      issues.push(
        validationIssue('missing_required', 'FLUX 3 Video 的 i2v 模式需要关键帧图片', [
          'inputFiles',
        ]),
      )
    }
    if ((mode === 'v2v' || mode === 'video-continuation') && videos.length === 0) {
      issues.push(
        validationIssue('missing_required', 'FLUX 3 Video 的 v2v 模式需要输入视频', ['inputFiles']),
      )
    }
    if (mode === 'draft_enhance' && !draftFromTaskId) {
      issues.push(
        validationIssue(
          'missing_required',
          'FLUX 3 Video 的 draft_enhance 模式需要 draft_from_task_id',
          ['modelParams', 'draftFromTaskId'],
        ),
      )
    }
  }

  if (context.modelId === 'MiniMax-H3') {
    const frameImages =
      context.capability === 'video.image_to_video' ||
      images.some((file) => file.role === 'first_frame' || file.role === 'last_frame')
    const referenceMedia =
      context.capability === 'video.reference_to_video' ||
      images.some((file) => file.role === 'reference') ||
      videos.length > 0 ||
      audios.length > 0
    if (frameImages && referenceMedia) {
      issues.push(
        validationIssue('conflicting_params', 'MiniMax-H3 的首尾帧输入不能与参考图/视频/音频混用', [
          'inputFiles',
        ]),
      )
    }
    if (referenceMedia && audios.length > 0 && images.length + videos.length === 0) {
      issues.push(
        validationIssue(
          'missing_required',
          'MiniMax-H3 的参考音频不能单独使用，需要至少一张参考图或一段参考视频',
          ['inputFiles'],
        ),
      )
    }
  }

  if (
    context.modelId === 'doubao-seedance-2.5' &&
    (context.capability === 'video.image_to_video' ||
      context.capability === 'video.edit' ||
      context.capability === 'video.extend')
  ) {
    const aspectRatio = stringParam(params, 'aspectRatio', 'aspect_ratio', 'size')
    if (aspectRatio != null && aspectRatio !== 'adaptive') {
      issues.push(
        validationIssue(
          'conflicting_params',
          'Seedance 2.5 的首尾帧/编辑/扩展任务画幅必须使用 adaptive',
          ['modelParams', 'aspectRatio'],
        ),
      )
    }
    if (
      (context.capability === 'video.edit' || context.capability === 'video.extend') &&
      numericParam(params, 'durationSeconds', 'duration') != null &&
      numericParam(params, 'durationSeconds', 'duration') !== -1
    ) {
      issues.push(
        validationIssue('conflicting_params', 'Seedance 2.5 的编辑/扩展任务 duration 必须为 -1', [
          'modelParams',
          'durationSeconds',
        ]),
      )
    }
  }

  if (context.modelId === 'pixverse-v6') {
    const hasTransition = images.some((file) => file.role === 'last_frame') || images.length > 1
    const duration = numericParam(params, 'durationSeconds', 'duration')
    if (hasTransition && duration != null && duration !== 5 && duration !== 8) {
      issues.push(
        validationIssue('conflicting_params', 'PixVerse 首尾帧转场只支持 5 或 8 秒', [
          'modelParams',
          'durationSeconds',
        ]),
      )
    }
  }

  if (
    (context.modelId === 'veo3.1-fast' ||
      context.modelId === 'veo3.1-quality' ||
      context.modelId === 'veo3.1-lite') &&
    booleanParam(params, 'enable_gif') === true &&
    ['1080p', '4k'].includes(stringParam(params, 'resolution') ?? '')
  ) {
    issues.push(
      validationIssue('conflicting_params', 'VEO GIF 输出不能与 1080p 或 4k 分辨率同时使用', [
        'modelParams',
        'resolution',
      ]),
    )
  }

  return issues
}

function booleanParam(
  params: Record<string, unknown> | undefined,
  ...names: string[]
): boolean | undefined {
  for (const name of names) {
    const value = params?.[name]
    if (typeof value === 'boolean') return value
    if (typeof value === 'string') {
      if (value.toLowerCase() === 'true') return true
      if (value.toLowerCase() === 'false') return false
    }
  }
  return undefined
}

/**
 * MiniMax（minimax-hailuo）请求预校验。仅阻断文档明确声明的非法组合，模糊项不臆断。
 * 来源：docs/integrations/minimax/{image-models,image-edit-models,video-models,video-models-v2,video-templates}.md
 */

import type { MediaContractIssue } from '@spark/protocol'
import { MINIMAX_VIDEO_TEMPLATE_IDS } from '@spark/protocol'
import {
  imageInputFiles,
  inputFilesOfKind,
  numericParam,
  promptText,
  stringParam,
  validationIssue,
  type MediaValidationContext,
} from './media-validator.types.js'

const V2_RATIOS = ['adaptive', '21:9', '16:9', '4:3', '1:1', '3:4', '9:16']
const V2_RESOLUTIONS = ['768P', '2K']
const TEMPLATE_ID_SET = new Set<string>(MINIMAX_VIDEO_TEMPLATE_IDS)

export function validateMinimaxHailuoMediaRequest(context: MediaValidationContext): MediaContractIssue[] {
  const issues: MediaContractIssue[] = []
  const { capability, modelId } = context
  const prompt = promptText(context)

  if (capability.startsWith('image.')) {
    issues.push(...validateImageRequest(context, prompt))
    return issues
  }
  if (capability.startsWith('video.')) {
    if (modelId === 'video-agent') {
      issues.push(...validateTemplateRequest(context, prompt))
    } else if (modelId === 'MiniMax-H3') {
      issues.push(...validateV2VideoRequest(context, prompt))
    } else {
      issues.push(...validateV1VideoRequest(context, prompt))
    }
  }
  return issues
}

function validateImageRequest(context: MediaValidationContext, prompt: string): MediaContractIssue[] {
  const issues: MediaContractIssue[] = []
  if (!prompt) {
    issues.push(validationIssue('missing_required', 'MiniMax 图像任务需要提示词', ['prompt']))
  }
  const images = imageInputFiles(context)

  if (context.capability === 'image.edit') {
    // subject_reference：官方当前仅 image-01 + type=character + 单张参考图（<10MB，JPG/JPEG/PNG）。
    if (images.length === 0) {
      issues.push(validationIssue('missing_required', 'MiniMax 图生图需要一张主体参考图', ['inputFiles']))
    } else if (images.length > 1) {
      issues.push(validationIssue('out_of_range', 'MiniMax 图生图当前仅支持单张参考图', ['inputFiles']))
    }
    for (const [index, file] of images.entries()) {
      if (file.sizeBytes != null && file.sizeBytes > 10 * 1024 * 1024) {
        issues.push(
          validationIssue('out_of_range', 'MiniMax 主体参考图不能超过 10 MB', ['inputFiles', index, 'sizeBytes']),
        )
      }
    }
  }

  // image-01-live 不支持 width/height（官方仅 image-01 生效）。schema 已裁剪，这里防御性再守一次。
  if (modelId(context) === 'image-01-live') {
    const params = context.input.modelParams
    if (params?.width != null || params?.height != null) {
      issues.push(
        validationIssue('forbidden_param', 'image-01-live 不支持 width/height，请改用 aspect_ratio', [
          'modelParams',
          'width',
        ]),
      )
    }
  }

  const n = numericParam(context.input.modelParams, 'n')
  if (n != null && (n < 1 || n > 9)) {
    issues.push(validationIssue('out_of_range', 'MiniMax 图像 n 必须在 1–9', ['modelParams', 'n']))
  }
  return issues
}

function validateV1VideoRequest(context: MediaValidationContext, prompt: string): MediaContractIssue[] {
  const issues: MediaContractIssue[] = []
  const model = modelId(context)
  const images = imageInputFiles(context)
  const params = context.input.modelParams

  // MiniMax-Hailuo-2.3-Fast 官方仅 i2v，不支持 t2v（video.generate）。
  if (model === 'MiniMax-Hailuo-2.3-Fast' && context.capability === 'video.generate') {
    issues.push(
      validationIssue('forbidden_param', 'MiniMax-Hailuo-2.3-Fast 仅支持图生视频，不支持文生视频', ['capability']),
    )
  }

  if (context.capability === 'video.generate' && !prompt) {
    issues.push(validationIssue('missing_required', 'MiniMax v1 文生视频需要提示词', ['prompt']))
  }
  if (context.capability === 'video.image_to_video') {
    if (images.length === 0) {
      issues.push(validationIssue('missing_required', 'MiniMax v1 图生视频需要一张首帧图', ['inputFiles']))
    } else if (images.length > 1) {
      issues.push(
        validationIssue('out_of_range', 'MiniMax Hailuo-2.3/-Fast 图生视频仅支持单张首帧（首尾帧仅 Hailuo-02）', [
          'inputFiles',
        ]),
      )
    }
  }

  const duration = numericParam(params, 'durationSeconds', 'duration')
  if (duration != null && duration !== 6 && duration !== 10) {
    issues.push(
      validationIssue('out_of_range', 'MiniMax Hailuo-2.3/-Fast 时长必须是 6 或 10 秒', [
        'modelParams',
        'durationSeconds',
      ]),
    )
  }
  const resolution = stringParam(params, 'resolution')
  if (resolution && resolution !== '768P' && resolution !== '1080P') {
    issues.push(
      validationIssue('invalid_enum', 'MiniMax Hailuo-2.3/-Fast 分辨率仅支持 768P / 1080P', [
        'modelParams',
        'resolution',
      ]),
    )
  }
  if (resolution === '1080P' && duration === 10) {
    issues.push(
      validationIssue('conflicting_params', 'MiniMax Hailuo-2.3/-Fast 的 1080P 仅支持 6 秒', [
        'modelParams',
        'durationSeconds',
      ]),
    )
  }
  return issues
}

function validateV2VideoRequest(context: MediaValidationContext, prompt: string): MediaContractIssue[] {
  const issues: MediaContractIssue[] = []
  const params = context.input.modelParams
  const images = imageInputFiles(context)
  const videos = inputFilesOfKind(context, 'video')
  const audios = inputFilesOfKind(context, 'audio')

  // V2 每次请求必须含至少一个非空 text 项（≤7000 字符）。
  if (!prompt) {
    issues.push(validationIssue('missing_required', 'MiniMax H3 需要文本提示', ['prompt']))
  } else if (prompt.length > 7000) {
    issues.push(validationIssue('out_of_range', 'MiniMax H3 文本最长 7000 字符', ['prompt']))
  }

  const duration = numericParam(params, 'duration')
  if (duration != null && (duration < 4 || duration > 15)) {
    issues.push(validationIssue('out_of_range', 'MiniMax H3 时长必须在 4–15 秒', ['modelParams', 'duration']))
  }
  const resolution = stringParam(params, 'resolution')
  if (resolution && !V2_RESOLUTIONS.includes(resolution)) {
    issues.push(
      validationIssue('invalid_enum', `MiniMax H3 resolution 不支持 ${resolution}，仅 768P / 2K`, [
        'modelParams',
        'resolution',
      ]),
    )
  }
  const ratio = stringParam(params, 'ratio')
  if (ratio && !V2_RATIOS.includes(ratio)) {
    issues.push(validationIssue('invalid_enum', `MiniMax H3 ratio 不支持 ${ratio}`, ['modelParams', 'ratio']))
  }
  // t2v（video.generate）ratio 必填且不能为 adaptive。
  if (context.capability === 'video.generate') {
    const effectiveRatio = ratio ?? '16:9'
    if (effectiveRatio === 'adaptive') {
      issues.push(
        validationIssue('invalid_enum', 'MiniMax H3 文生视频 ratio 不能为 adaptive，请选择具体比例', [
          'modelParams',
          'ratio',
        ]),
      )
    }
    if (images.length > 0 || videos.length > 0 || audios.length > 0) {
      issues.push(
        validationIssue('conflicting_params', 'MiniMax H3 文生视频不接受图片/视频/音频输入', ['inputFiles']),
      )
    }
  }

  if (context.capability === 'video.image_to_video') {
    if (images.length === 0) {
      issues.push(
        validationIssue('missing_required', 'MiniMax H3 图生视频至少需要一张首帧图', ['inputFiles']),
      )
    } else if (images.length > 2) {
      issues.push(
        validationIssue('out_of_range', 'MiniMax H3 图生视频最多 2 张图（首帧+尾帧）', ['inputFiles']),
      )
    }
  }

  // r2v：不可仅音频，须含至少 1 个参考图或参考视频。
  const hasReferenceMode = context.capability === 'video.reference_to_video'
  if (hasReferenceMode) {
    if (images.length === 0 && videos.length === 0) {
      issues.push(
        validationIssue(
          'missing_required',
          'MiniMax H3 多模态参考至少需要 1 张图片或 1 段视频，不能缺少参考素材或仅传音频',
          ['inputFiles'],
        ),
      )
    }
    if (images.length > 9) {
      issues.push(validationIssue('out_of_range', 'MiniMax H3 参考图最多 9 张', ['inputFiles']))
    }
    if (videos.length > 3) {
      issues.push(validationIssue('out_of_range', 'MiniMax H3 参考视频最多 3 段', ['inputFiles']))
    }
    if (audios.length > 3) {
      issues.push(validationIssue('out_of_range', 'MiniMax H3 参考音频最多 3 段', ['inputFiles']))
    }
  }

  // 单文件大小（来源 video-models-v2.md §4.4）：图片 ≤30MB / 视频 ≤50MB / 音频 ≤15MB。
  for (const [index, file] of images.entries()) {
    if (file.sizeBytes != null && file.sizeBytes > 30 * 1024 * 1024) {
      issues.push(
        validationIssue('out_of_range', 'MiniMax H3 图片单张不能超过 30 MB', ['inputFiles', index, 'sizeBytes']),
      )
    }
  }
  for (const [index, file] of videos.entries()) {
    if (file.sizeBytes != null && file.sizeBytes > 50 * 1024 * 1024) {
      issues.push(
        validationIssue('out_of_range', 'MiniMax H3 视频单段不能超过 50 MB', ['inputFiles', index, 'sizeBytes']),
      )
    }
  }
  for (const [index, file] of audios.entries()) {
    if (file.sizeBytes != null && file.sizeBytes > 15 * 1024 * 1024) {
      issues.push(
        validationIssue('out_of_range', 'MiniMax H3 音频单段不能超过 15 MB', ['inputFiles', index, 'sizeBytes']),
      )
    }
  }

  // V2 请求体总大小 ≤ 64MB（base64 素材累计）。
  const knownRequestBytes = (context.input.inputFiles ?? []).reduce(
    (sum, file) => sum + (file.dataUrl ? (file.sizeBytes ?? 0) : 0),
    0,
  )
  if (knownRequestBytes > 64 * 1024 * 1024) {
    issues.push(
      validationIssue('out_of_range', 'MiniMax H3 请求体已知素材总大小不能超过 64 MB，请改用公网 URL 或 mm_file://', [
        'inputFiles',
      ]),
    )
  }
  return issues
}

function validateTemplateRequest(context: MediaValidationContext, prompt: string): MediaContractIssue[] {
  const issues: MediaContractIssue[] = []
  const templateId = stringParam(context.input.modelParams, 'templateId', 'template_id')
  if (!templateId) {
    issues.push(validationIssue('missing_required', 'MiniMax 视频 Agent 需要选择 template_id', ['modelParams', 'templateId']))
  } else if (!TEMPLATE_ID_SET.has(templateId)) {
    issues.push(
      validationIssue('invalid_enum', `MiniMax 视频 Agent 模板 ${templateId} 不在官方 11 个模板清单内`, [
        'modelParams',
        'templateId',
      ]),
    )
  }
  // 模板至少需要一种输入（media 或 text）；官方仅披露每模板"是否需要"二元信息，无法逐模板精确校验。
  const images = imageInputFiles(context)
  if (!prompt && images.length === 0) {
    issues.push(
      validationIssue('missing_required', 'MiniMax 视频 Agent 至少需要文本或图片输入之一', ['inputFiles']),
    )
  }
  return issues
}

function modelId(context: MediaValidationContext): string {
  return context.modelId
}

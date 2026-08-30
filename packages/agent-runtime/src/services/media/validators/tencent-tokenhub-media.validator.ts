import type { MediaContractIssue } from '@spark/protocol'
import {
  imageInputFiles,
  numericParam,
  promptText,
  stringParam,
  validationIssue,
  type MediaValidationContext,
} from './media-validator.types.js'

export function validateTencentTokenhubMediaRequest(
  context: MediaValidationContext,
): MediaContractIssue[] {
  if (!context.capability.startsWith('video.')) return []
  if (context.modelId.startsWith('kl-video-')) return validateKling(context)
  if (context.modelId.startsWith('vd-video-')) return validateVidu(context)
  return []
}

function validateKling(context: MediaValidationContext): MediaContractIssue[] {
  const issues: MediaContractIssue[] = []
  const params = context.input.modelParams ?? {}
  const images = imageInputFiles(context)
  const hasTailFrame = images.some((file) => file.role === 'last_frame') || images.length > 1
  const multiShot = booleanParam(params, 'multiShot', 'multi_shot')
  const shotType = stringParam(params, 'shotType', 'shot_type')
  const multiPrompt = arrayParam(params, 'multiPrompt', 'multi_prompt')
  const cameraControl = objectParam(params, 'cameraControl', 'camera_control')
  const staticMask = stringParam(params, 'staticMask', 'static_mask')
  const dynamicMasks = arrayParam(params, 'dynamicMasks', 'dynamic_masks')
  const elementList = arrayParam(params, 'elementList', 'element_list')
  const voiceList = arrayParam(params, 'voiceList', 'voice_list')
  const mode = stringParam(params, 'mode')
  const sound = stringParam(params, 'sound')

  if (context.capability === 'video.generate' && multiShot !== true && !promptText(context)) {
    issues.push(validationIssue('missing_required', 'Kling 普通文生视频需要 prompt', ['prompt']))
  }

  if (hasTailFrame && (cameraControl || staticMask || dynamicMasks)) {
    issues.push(
      validationIssue(
        'conflicting_params',
        'Kling 尾帧与 CameraControl、StaticMask、DynamicMasks 互斥，不能同时使用',
        ['inputFiles'],
      ),
    )
  }
  if (multiShot === true && hasTailFrame) {
    issues.push(
      validationIssue('conflicting_params', 'Kling 多镜头模式不支持首尾帧输入', [
        'modelParams',
        'multiShot',
      ]),
    )
  }
  if (hasTailFrame && context.modelId === 'kl-video-v2-1' && mode !== 'pro') {
    issues.push(
      validationIssue('conflicting_params', 'Kling v2.1 首尾帧只支持 pro 模式', [
        'modelParams',
        'mode',
      ]),
    )
  }
  if (hasTailFrame && context.modelId === 'kl-video-v2-6' && sound === 'on') {
    issues.push(
      validationIssue('conflicting_params', 'Kling v2.6 首尾帧只能生成无声视频', [
        'modelParams',
        'sound',
      ]),
    )
  }
  if (multiShot === true && !shotType) {
    issues.push(
      validationIssue('missing_required', 'Kling 开启多镜头时必须设置 shotType', [
        'modelParams',
        'shotType',
      ]),
    )
  }
  if (
    multiShot === true &&
    shotType === 'customize' &&
    (!multiPrompt || multiPrompt.length === 0)
  ) {
    issues.push(
      validationIssue('missing_required', 'Kling 自定义分镜必须提供 multiPrompt', [
        'modelParams',
        'multiPrompt',
      ]),
    )
  }
  if (multiPrompt && (multiPrompt.length < 1 || multiPrompt.length > 6)) {
    issues.push(
      validationIssue('out_of_range', 'Kling multiPrompt 只支持 1–6 个分镜', [
        'modelParams',
        'multiPrompt',
      ]),
    )
  }
  const duration = numericParam(params, 'durationSeconds', 'duration') ?? 5
  if (multiShot === true && shotType === 'customize' && multiPrompt) {
    const total = multiPrompt.reduce<number>(
      (sum, item) => sum + (recordNumber(item, 'duration') ?? 0),
      0,
    )
    if (total !== duration) {
      issues.push(
        validationIssue(
          'conflicting_params',
          `Kling 自定义分镜时长合计必须等于总时长 ${duration} 秒，当前合计 ${total} 秒`,
          ['modelParams', 'multiPrompt'],
        ),
      )
    }
  }
  if (elementList && elementList.length > 3) {
    issues.push(
      validationIssue('out_of_range', 'Kling elementList 最多支持 3 个参考主体', [
        'modelParams',
        'elementList',
      ]),
    )
  }
  if (dynamicMasks && dynamicMasks.length > 6) {
    issues.push(
      validationIssue('out_of_range', 'Kling dynamicMasks 最多支持 6 组动态笔刷', [
        'modelParams',
        'dynamicMasks',
      ]),
    )
  }
  if (voiceList && voiceList.length > 2) {
    issues.push(
      validationIssue('out_of_range', 'Kling voiceList 最多支持 2 个音色', [
        'modelParams',
        'voiceList',
      ]),
    )
  }
  if (elementList && elementList.length > 0 && voiceList && voiceList.length > 0) {
    issues.push(
      validationIssue('conflicting_params', 'Kling elementList 与 voiceList 互斥', [
        'modelParams',
        'voiceList',
      ]),
    )
  }
  return issues
}

function validateVidu(context: MediaValidationContext): MediaContractIssue[] {
  if (context.capability !== 'video.image_to_video') return []
  const images = imageInputFiles(context)
  const duration = numericParam(context.input.modelParams, 'durationSeconds', 'duration') ?? 5
  if (context.modelId.startsWith('vd-video-q2') && images.length > 1 && duration > 8) {
    return [
      validationIssue('conflicting_params', 'Vidu Q2 首尾帧模式只支持 1–8 秒', [
        'modelParams',
        'durationSeconds',
      ]),
    ]
  }
  return []
}

function booleanParam(params: Record<string, unknown>, ...names: string[]): boolean | undefined {
  for (const name of names) {
    const value = params[name]
    if (typeof value === 'boolean') return value
    if (typeof value === 'string' && ['true', 'false'].includes(value.toLowerCase())) {
      return value.toLowerCase() === 'true'
    }
  }
  return undefined
}

function arrayParam(params: Record<string, unknown>, ...names: string[]): unknown[] | undefined {
  for (const name of names) {
    const value = params[name]
    if (Array.isArray(value)) return value
  }
  return undefined
}

function objectParam(
  params: Record<string, unknown>,
  ...names: string[]
): Record<string, unknown> | undefined {
  for (const name of names) {
    const value = params[name]
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      return value as Record<string, unknown>
    }
  }
  return undefined
}

function recordNumber(value: unknown, key: string): number | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const raw = (value as Record<string, unknown>)[key]
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw
  if (typeof raw === 'string' && raw.trim()) {
    const parsed = Number(raw)
    if (Number.isFinite(parsed)) return parsed
  }
  return undefined
}

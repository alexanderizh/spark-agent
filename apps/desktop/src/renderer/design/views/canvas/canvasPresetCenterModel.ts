import type { ProviderProfile } from '@spark/protocol'

import type { CanvasPresetTargetDefinition, CanvasPresetTargetId } from './canvasOperationPresets'
import type { CanvasTaskDefaultKind } from './canvasTaskDefaults'
import type { CanvasOperationType } from './canvas.types'

export type CanvasPresetTaskCardDefinition = {
  kind: CanvasTaskDefaultKind
  label: string
  description: string
  icon: 'text' | 'vision' | 'image' | 'video'
}

export const CANVAS_PRESET_TASK_CARDS: readonly CanvasPresetTaskCardDefinition[] = [
  {
    kind: 'text',
    label: '文本处理',
    description: '写作、改写、提取与提示词优化',
    icon: 'text',
  },
  {
    kind: 'image_understanding',
    label: '图片理解',
    description: '看图、识别内容与提取信息',
    icon: 'vision',
  },
  {
    kind: 'image_generation',
    label: '图片生成',
    description: '生成、编辑、合成与故事板',
    icon: 'image',
  },
  {
    kind: 'video_generation',
    label: '视频生成',
    description: '文生视频、图生视频与视频编辑',
    icon: 'video',
  },
]

export type CanvasPresetTargetGroupId = 'text' | 'image' | 'video' | 'audio'

export type CanvasPresetTargetGroup = {
  id: CanvasPresetTargetGroupId
  label: string
  description: string
  targets: CanvasPresetTargetDefinition[]
}

const GROUP_DEFINITIONS: readonly Omit<CanvasPresetTargetGroup, 'targets'>[] = [
  { id: 'text', label: '文本节点', description: '写作、改写与剧本流水线' },
  { id: 'image', label: '图片节点', description: '生成、编辑与合成' },
  { id: 'video', label: '视频节点', description: '生成、编辑与扩展' },
  { id: 'audio', label: '音频节点', description: '语音生成与转写' },
]

const IMAGE_OPERATIONS = new Set<CanvasOperationType>([
  'text_to_image',
  'image_to_image',
  'image_edit',
  'image_compose',
  'storyboard_grid',
  'panorama_360',
])

const VIDEO_OPERATIONS = new Set<CanvasOperationType>([
  'text_to_video',
  'image_to_video',
  'video_edit',
  'video_extend',
])

const AUDIO_OPERATIONS = new Set<CanvasOperationType>(['text_to_audio', 'audio_transcribe'])

function groupIdForTarget(target: CanvasPresetTargetDefinition): CanvasPresetTargetGroupId {
  if (IMAGE_OPERATIONS.has(target.operation)) return 'image'
  if (VIDEO_OPERATIONS.has(target.operation)) return 'video'
  if (AUDIO_OPERATIONS.has(target.operation)) return 'audio'
  return 'text'
}

export function buildCanvasPresetTargetGroups(
  targets: readonly CanvasPresetTargetDefinition[],
): CanvasPresetTargetGroup[] {
  return GROUP_DEFINITIONS.map((definition) => ({
    ...definition,
    targets: targets.filter((target) => groupIdForTarget(target) === definition.id),
  }))
}

export function isImageUnderstandingProvider(
  provider: Pick<ProviderProfile, 'modelType'> | { modelType?: string },
): boolean {
  return provider.modelType === 'multimodal'
}

export function countCanvasPresetOverrides(
  targetIds: readonly CanvasPresetTargetId[],
  hasOverride: (targetId: CanvasPresetTargetId) => boolean,
): number {
  return targetIds.filter(hasOverride).length
}

import { Tooltip } from 'antd'
import type { MediaInputRolePolicy } from '@spark/protocol'

export type CanvasMediaInputHintMode = 'composer' | 'panel' | 'inline'

export type CanvasMediaInputHintProps = {
  rolePolicy: MediaInputRolePolicy
  maxImages: number
  selectedImageCount: number
  maxVideos?: number | undefined
  selectedVideoCount?: number | undefined
  maxAudios?: number | undefined
  selectedAudioCount?: number | undefined
  mode: CanvasMediaInputHintMode
  capabilityLabel?: string | undefined
  capabilityId?: string | undefined
  extraText?: string | undefined
}

function hasImageRole(rolePolicy: MediaInputRolePolicy): boolean {
  return (rolePolicy.imageRoles?.length ?? 0) > 0
}

function defaultAssignmentText(rolePolicy: MediaInputRolePolicy): string {
  if (rolePolicy.defaultRoleAssignment === 'first_then_last_then_reference') {
    return '未手动指定时，第一张作为首帧、第二张作为尾帧，其余作为参考图。建议显式选择以避免顺序变化。'
  }
  if (rolePolicy.defaultRoleAssignment === 'all_reference') {
    return '未手动指定时，已选图片均作为参考图。'
  }
  return ''
}

export function formatCanvasMediaInputHintText(input: CanvasMediaInputHintProps): string {
  const {
    rolePolicy,
    maxImages,
    selectedImageCount,
    maxVideos = 0,
    selectedVideoCount = 0,
    maxAudios = 0,
    selectedAudioCount = 0,
    extraText,
  } = input

  const safeMax = Math.max(0, Math.floor(maxImages))
  const safeSelected = Math.max(0, Math.floor(selectedImageCount))
  const overflowCount = Math.max(0, safeSelected - safeMax)
  const parts = hasImageRole(rolePolicy)
    ? [
        `当前模型声明支持 ${safeMax} 张图片。`,
        defaultAssignmentText(rolePolicy),
        `已选 ${safeSelected} 张。`,
      ]
    : ['当前能力不支持图片输入。']
  if ((rolePolicy.videoRoles?.length ?? 0) > 0) {
    parts.push(`参考视频 ${selectedVideoCount}/${maxVideos} 段。`)
  }
  if ((rolePolicy.audioRoles?.length ?? 0) > 0) {
    parts.push(`参考音频 ${selectedAudioCount}/${maxAudios} 段。`)
  }
  if (overflowCount > 0) parts.push(`图片超出 ${overflowCount} 张，提交校验会阻止任务。`)
  if (maxVideos > 0 && selectedVideoCount > maxVideos)
    parts.push('参考视频数量超限，提交校验会阻止任务。')
  if (maxAudios > 0 && selectedAudioCount > maxAudios)
    parts.push('参考音频数量超限，提交校验会阻止任务。')
  if (extraText) parts.push(extraText)
  return parts.filter(Boolean).join('')
}

export function CanvasMediaInputHint(props: CanvasMediaInputHintProps) {
  const { rolePolicy, maxImages, selectedImageCount, mode } = props
  const supportsImages = hasImageRole(rolePolicy)
  const safeMax = Math.max(0, Math.floor(maxImages))
  const safeSelected = Math.max(0, Math.floor(selectedImageCount))
  const overflowCount = Math.max(0, safeSelected - safeMax)
  const percent =
    supportsImages && safeMax > 0 ? Math.min(100, Math.round((safeSelected / safeMax) * 100)) : 0
  const className = [
    'canvas-media-input-hint',
    `is-${mode}`,
    overflowCount > 0 ? 'is-overflow' : '',
    supportsImages ? '' : 'is-unsupported',
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <Tooltip title={formatCanvasMediaInputHintText(props)}>
      <div className={className}>
        {supportsImages ? (
          <div
            className="canvas-media-input-hint-meter"
            aria-label={`图片用量 ${safeSelected}/${safeMax}`}
          >
            <span style={{ width: `${percent}%` }} />
          </div>
        ) : null}
      </div>
    </Tooltip>
  )
}

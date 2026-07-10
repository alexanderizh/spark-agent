import { Tooltip } from 'antd'
import type { MediaInputRolePolicy } from '@spark/protocol'

export type CanvasMediaInputHintMode = 'composer' | 'panel' | 'inline'

export type CanvasMediaInputHintProps = {
  rolePolicy: MediaInputRolePolicy
  maxImages: number
  selectedImageCount: number
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
  const { rolePolicy, maxImages, selectedImageCount, extraText } = input
  if (!hasImageRole(rolePolicy)) {
    return '当前能力不支持图片输入，仅使用文本或视频输入。'
  }

  const safeMax = Math.max(0, Math.floor(maxImages))
  const safeSelected = Math.max(0, Math.floor(selectedImageCount))
  const overflowCount = Math.max(0, safeSelected - safeMax)
  const parts = [
    `当前模型声明支持 ${safeMax} 张图片。`,
    defaultAssignmentText(rolePolicy),
    `已选 ${safeSelected} 张。`,
  ]
  if (overflowCount > 0) parts.push(`超出 ${overflowCount} 张仍会尝试传递，可能由平台报错或忽略。`)
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
    supportsImages && safeMax > 0
      ? Math.min(100, Math.round((safeSelected / safeMax) * 100))
      : 0
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

import { useRef, useState } from 'react'
import { Select, Tooltip } from 'antd'
import { Button } from '@lobehub/ui'
import type { CanvasInputBinding, CanvasMediaInputMode } from '@spark/protocol'
import { Icons } from '../../Icons'
import { AssetThumbnail } from './CanvasAssetThumbnail'
import type { CanvasAsset, CanvasNode } from './canvas.types'
import {
  canvasMediaInputModeIssue,
  type CanvasMediaInputAssignment,
  type CanvasMediaInputModeOption,
} from './canvasMediaInputMode'

const VIDEO_GENERATION_MODES: ReadonlyArray<{
  mode: CanvasMediaInputMode
  label: string
}> = [
  { mode: 'text', label: '文生视频' },
  { mode: 'first_frame', label: '首帧生成' },
  { mode: 'first_last_frame', label: '首尾帧生成' },
  { mode: 'reference', label: '全能参考' },
]

export function CanvasMediaInputConfigurator({
  options,
  value,
  assignments,
  bindings,
  nodes,
  assets,
  presentationNodeBySourceId,
  disabled,
  variant,
  onChange,
  onMove,
  onRemove,
  onQuickPick,
  onQuickUpload,
}: {
  options: readonly CanvasMediaInputModeOption[]
  value?: CanvasMediaInputMode | undefined
  assignments: readonly CanvasMediaInputAssignment[]
  bindings: readonly CanvasInputBinding[]
  nodes: readonly CanvasNode[]
  assets: readonly CanvasAsset[]
  presentationNodeBySourceId?: ReadonlyMap<string, CanvasNode> | undefined
  disabled?: boolean
  variant: 'composer' | 'panel'
  onChange: (mode: CanvasMediaInputMode) => void
  onMove: (sourceNodeId: string, direction: -1 | 1) => void
  onRemove?: ((sourceNodeId: string) => void) | undefined
  onQuickPick?: (() => void) | undefined
  onQuickUpload?: ((file: File) => Promise<void> | void) | undefined
}) {
  const quickUploadInputRef = useRef<HTMLInputElement | null>(null)
  const [quickUploading, setQuickUploading] = useState(false)
  if (options.length === 0) return null
  const nodeById = new Map(nodes.map((node) => [node.id, node]))
  const assetById = new Map(assets.map((asset) => [asset.id, asset]))
  const originsBySource = collectOrigins(bindings)
  const current = options.find((option) => option.mode === value)
  const currentIssue = current ? canvasMediaInputModeIssue(current, bindings) : undefined
  const usedCount = assignments.filter((assignment) => assignment.used).length
  const presentedModes = presentationModes(options)
  const modeSelectOptions = presentedModes.map(({ mode, label, option }) => {
    const issue = option
      ? canvasMediaInputModeIssue(option, bindings)
      : `当前模型不支持${label}模式`
    const title = issue || option?.capability.label
    return {
      value: mode,
      label,
      disabled: Boolean(issue),
      ...(title ? { title } : {}),
    }
  })

  return (
    <section className={`canvas-media-input-configurator is-${variant}`}>
      <div className="canvas-media-input-configurator-head">
        <div className="canvas-media-input-configurator-title">
          <span className="canvas-media-input-configurator-title-icon">
            <Icons.Layers size={13} />
          </span>
          <strong>素材编排</strong>
          <span className="canvas-media-input-configurator-count">
            {assignments.length > 0 ? `${usedCount}/${assignments.length} 参与生成` : '暂无素材'}
          </span>
          <Select<CanvasMediaInputMode>
            className="canvas-media-input-mode-select"
            classNames={{ popup: { root: 'canvas-media-input-mode-select-popup' } }}
            size="small"
            aria-label="视频生成模式"
            value={value ?? null}
            options={modeSelectOptions}
            disabled={disabled === true}
            onChange={onChange}
          />
        </div>

        {current ? (
          <Tooltip
            title={
              <div className="canvas-media-input-capability-tip">
                <strong>{current.capability.label}</strong>
                <span>{current.capabilityId}</span>
                <small>任务运行时将固定使用此能力，不再按素材数量猜测。</small>
              </div>
            }
          >
            <span
              className="canvas-media-input-capability-status"
              aria-label={`当前能力：${current.label}`}
            >
              <i />
            </span>
          </Tooltip>
        ) : null}
      </div>

      <div className="canvas-media-input-track">
        {assignments.length === 0 ? (
          <div className="canvas-media-input-track-empty">
            <Icons.Image size={16} />
            <div className="canvas-media-input-track-empty-copy">
              <span>通过连线、@ 或“+”加入图片、视频与音频</span>
              {onQuickPick || onQuickUpload ? (
                <div className="canvas-media-input-track-empty-actions">
                  {onQuickPick ? (
                    <Button
                      type="text"
                      size="small"
                      aria-label="从画布选择输入素材"
                      disabled={disabled === true || quickUploading}
                      onClick={onQuickPick}
                    >
                      从画布选择
                    </Button>
                  ) : null}
                  {onQuickUpload ? (
                    <>
                      <Button
                        type="text"
                        size="small"
                        aria-label="本地上传输入素材"
                        disabled={disabled === true || quickUploading}
                        onClick={() => quickUploadInputRef.current?.click()}
                      >
                        {quickUploading ? '上传中' : '本地上传'}
                      </Button>
                      <input
                        ref={quickUploadInputRef}
                        type="file"
                        accept="image/*,video/*,audio/*"
                        aria-label="选择本地输入素材"
                        hidden
                        onChange={(event) => {
                          const file = event.target.files?.[0]
                          event.target.value = ''
                          if (!file) return
                          setQuickUploading(true)
                          void Promise.resolve(onQuickUpload(file)).finally(() =>
                            setQuickUploading(false),
                          )
                        }}
                      />
                    </>
                  ) : null}
                </div>
              ) : null}
            </div>
          </div>
        ) : (
          assignments.map((assignment, index) => {
            const sourceNode = nodeById.get(assignment.sourceNodeId)
            const presentationNode = presentationNodeBySourceId?.get(assignment.sourceNodeId)
            const previewNode = presentationNode ?? sourceNode
            const asset = previewNode?.assetId ? assetById.get(previewNode.assetId) : undefined
            const previewUrl = previewNode?.data.thumbnailUrl ?? previewNode?.data.url
            const origins = originsBySource.get(assignment.sourceNodeId)
            const label =
              sourceNode?.title?.trim() ||
              presentationNode?.title?.trim() ||
              `${kindLabel(assignment.kind)} ${index + 1}`
            const role = rolePresentation(assignment)
            const removable = Boolean(onRemove && !origins?.has('connection'))
            return (
              <Tooltip
                key={assignment.sourceNodeId}
                mouseEnterDelay={0.2}
                title={
                  <div className="canvas-media-input-resource-tip">
                    <strong>{label}</strong>
                    <span>{originLabel(origins)}</span>
                    <small>
                      {assignment.used ? `本次作为${role.label}提交` : '保留在节点中，本次不提交'}
                    </small>
                  </div>
                }
              >
                <article
                  className={`canvas-media-input-tile role-${role.tone}${assignment.used ? '' : ' is-unused'}`}
                  aria-label={`${label}，${originLabel(origins)}，${role.label}`}
                >
                  <div className="canvas-media-input-tile-media">
                    {asset ? (
                      <AssetThumbnail asset={asset} />
                    ) : previewUrl ? (
                      <img src={previewUrl} alt="" />
                    ) : (
                      kindIcon(assignment.kind)
                    )}
                    <span className="canvas-media-input-tile-index">{index + 1}</span>
                    <span className="canvas-media-input-tile-role">{role.label}</span>
                    <div className="canvas-media-input-tile-actions">
                      <Button
                        type="text"
                        size="small"
                        icon={<Icons.ChevronLeft size={11} />}
                        aria-label={`前移 ${label}`}
                        disabled={disabled === true || index === 0}
                        onClick={() => onMove(assignment.sourceNodeId, -1)}
                      />
                      <Button
                        type="text"
                        size="small"
                        icon={<Icons.ChevronRight size={11} />}
                        aria-label={`后移 ${label}`}
                        disabled={disabled === true || index === assignments.length - 1}
                        onClick={() => onMove(assignment.sourceNodeId, 1)}
                      />
                      {removable ? (
                        <Button
                          type="text"
                          size="small"
                          icon={<Icons.X size={11} />}
                          aria-label={`移除 ${label}`}
                          disabled={disabled === true}
                          onClick={() => onRemove?.(assignment.sourceNodeId)}
                        />
                      ) : null}
                    </div>
                  </div>
                  {variant === 'panel' ? (
                    <div className="canvas-media-input-tile-name">{label}</div>
                  ) : null}
                </article>
              </Tooltip>
            )
          })
        )}
      </div>

      <div className={`canvas-media-input-configurator-foot${currentIssue ? ' is-warning' : ''}`}>
        <span>{currentIssue ? '!' : 'i'}</span>
        {currentIssue || modeGuidance(value, current)}
      </div>
    </section>
  )
}

function presentationModes(options: readonly CanvasMediaInputModeOption[]): ReadonlyArray<{
  mode: CanvasMediaInputMode
  label: string
  option: CanvasMediaInputModeOption | undefined
}> {
  const optionByMode = new Map(options.map((option) => [option.mode, option]))
  const isVideoGeneration = VIDEO_GENERATION_MODES.some(({ mode }) => optionByMode.has(mode))
  if (!isVideoGeneration) {
    return options.map((option) => ({
      mode: option.mode,
      label: compactModeLabel(option),
      option,
    }))
  }
  return VIDEO_GENERATION_MODES.map(({ mode, label }) => ({
    mode,
    label,
    option: optionByMode.get(mode),
  }))
}

function collectOrigins(bindings: readonly CanvasInputBinding[]) {
  const result = new Map<string, Set<CanvasInputBinding['origin']>>()
  for (const binding of bindings) {
    const origins = result.get(binding.sourceNodeId) ?? new Set()
    origins.add(binding.origin)
    result.set(binding.sourceNodeId, origins)
  }
  return result
}

function compactModeLabel(option: CanvasMediaInputModeOption): string {
  if (option.mode === 'text') return '文生视频'
  if (option.mode === 'first_frame') return '首帧生成'
  if (option.mode === 'first_last_frame') return '首尾帧生成'
  if (option.mode === 'reference') return option.label.includes('图片') ? '图片参考' : '全能参考'
  if (option.mode === 'edit') return '编辑'
  return '延长'
}

function rolePresentation(assignment: CanvasMediaInputAssignment): {
  label: string
  tone: 'first' | 'last' | 'reference' | 'input' | 'unused'
} {
  if (!assignment.used) return { label: '未使用', tone: 'unused' }
  if (assignment.role === 'first_frame') return { label: '首帧', tone: 'first' }
  if (assignment.role === 'last_frame') return { label: '尾帧', tone: 'last' }
  if (assignment.kind === 'video' && assignment.role === 'input') {
    return { label: '主视频', tone: 'input' }
  }
  return {
    label:
      assignment.kind === 'video'
        ? '参考视频'
        : assignment.kind === 'audio'
          ? '参考音频'
          : '参考图',
    tone: 'reference',
  }
}

function kindIcon(kind: CanvasInputBinding['kind']) {
  if (kind === 'video') return <Icons.Video size={20} />
  if (kind === 'audio') return <Icons.AudioLines size={20} />
  if (kind === 'file') return <Icons.File size={20} />
  return <Icons.Image size={20} />
}

function kindLabel(kind: CanvasInputBinding['kind']): string {
  if (kind === 'video') return '视频'
  if (kind === 'audio') return '音频'
  if (kind === 'file') return '文件'
  return '图片'
}

function originLabel(origins: ReadonlySet<CanvasInputBinding['origin']> | undefined): string {
  const labels = [
    ...(origins?.has('connection') ? ['连线'] : []),
    ...(origins?.has('manual') ? ['@ / +'] : []),
    ...(origins?.has('picker') ? ['选择器'] : []),
  ]
  return labels.length > 0 ? `来源：${labels.join(' + ')}` : '来源：输入资源'
}

function modeGuidance(
  mode: CanvasMediaInputMode | undefined,
  option: CanvasMediaInputModeOption | undefined,
): string {
  const supportsReferences = Boolean(
    option?.rolePolicy.imageRoles?.includes('reference_image') ||
    option?.rolePolicy.videoRoles?.includes('reference_video') ||
    option?.rolePolicy.audioRoles?.includes('reference_audio'),
  )
  if (mode === 'first_last_frame') {
    return supportsReferences
      ? '轨道前两张图作为首帧、尾帧，其余兼容素材继续作为参考输入。'
      : '轨道前两张图依次作为首帧、尾帧；拖动顺序等价于调整角色。'
  }
  if (mode === 'first_frame') {
    return supportsReferences
      ? '轨道第 1 张图作为首帧，其余兼容素材继续作为参考输入。'
      : '轨道第 1 张图作为首帧，其余素材保留但不发送。'
  }
  if (mode === 'reference') return '已按模型能力分配参考素材；灰色素材不会发送。'
  if (mode === 'edit') return '第 1 段视频为编辑主体，图片作为参考素材。'
  if (mode === 'extend') return '第 1 段视频为延长主体，其余素材不发送。'
  return '当前为纯文本生成，轨道素材不会发送。'
}

import { Segmented, Select, Tooltip } from 'antd'
import { Button } from '@lobehub/ui'
import type { CanvasInputBinding, CanvasMediaInputMode } from '@spark/protocol'
import { Icons } from '../../Icons'
import { AssetThumbnail } from './CanvasAssetThumbnail'
import type { CanvasAsset, CanvasNode } from './canvas.types'
import {
  canvasMediaInputModeIssue,
  collapseVideoEditExtendOptions,
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
  { mode: 'edit', label: '视频编辑' },
  { mode: 'extend', label: '视频延长' },
]

/**
 * 合并后「图片生成」节点的模式表。image.generate → 文生图(text)，image.edit → 图生图/编辑(reference)。
 * 图片与视频共享 text / reference 两个 mode，因此模式族必须按 capability 命名空间（image.* vs video.*）
 * 区分，不能按 mode 判断——否则图片节点会被误判为视频族，泄露「文生视频 / 全能参考」等文案。
 */
const IMAGE_GENERATION_MODES: ReadonlyArray<{ mode: CanvasMediaInputMode; label: string }> = [
  { mode: 'text', label: '文生图' },
  { mode: 'reference', label: '图生图 / 编辑' },
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
}) {
  if (options.length === 0) return null
  const nodeById = new Map(nodes.map((node) => [node.id, node]))
  const assetById = new Map(assets.map((asset) => [asset.id, asset]))
  const originsBySource = collectOrigins(bindings)
  const current = options.find((option) => option.mode === value)
  const currentIssue = current ? canvasMediaInputModeIssue(current, bindings) : undefined
  const usedCount = assignments.filter((assignment) => assignment.used).length
  const presentedModes = presentationModes(options)
  // 模式族按 capability 命名空间判定，决定 Select 的 aria-label 文案。
  const isImageFamily = options.some((option) => option.capabilityId.startsWith('image.'))
  const modeSelectAriaLabel = isImageFamily ? '图片生成模式' : '视频生成模式'
  const editExtendPair = collapseVideoEditExtendOptions(options)
  const isEditExtendActive = Boolean(editExtendPair) && (value === 'edit' || value === 'extend')
  // 合并行以 'edit' 作为 Select 取值；真正的 编辑/延长 选择由子开关承载。
  const modeSelectValue = value === 'extend' && editExtendPair ? 'edit' : value
  const modeSelectOptions = presentedModes.map(({ mode, label, option }) => {
    const unsupportedReason = option ? undefined : `当前模型不支持${label}模式`
    const title = unsupportedReason || option?.capability.label
    return {
      value: mode,
      label,
      disabled: option == null,
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
            aria-label={modeSelectAriaLabel}
            value={modeSelectValue ?? null}
            options={modeSelectOptions}
            disabled={disabled === true}
            onChange={onChange}
          />
          {isEditExtendActive ? (
            <Segmented<CanvasMediaInputMode>
              className="canvas-media-input-mode-editextend"
              size="small"
              aria-label="视频编辑或延长"
              value={value === 'extend' ? 'extend' : 'edit'}
              disabled={disabled === true}
              onChange={(next) => onChange(next)}
              options={[
                { value: 'edit', label: '编辑' },
                { value: 'extend', label: '延长' },
              ]}
            />
          ) : null}
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
              {onQuickPick ? (
                <div className="canvas-media-input-track-empty-actions">
                  <Button
                    type="text"
                    size="small"
                    aria-label="从画布选择输入素材"
                    disabled={disabled === true}
                    onClick={onQuickPick}
                  >
                    从画布选择
                  </Button>
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
  /** 合并分组时该展示行代表的备选模式（edit 行携带 extend），供子开关切换。 */
  alternate?: CanvasMediaInputMode
}> {
  const optionByMode = new Map(options.map((option) => [option.mode, option]))
  // 按 capability 命名空间判定模式族：image.* → 图片统一节点，video.* → 视频统一节点。
  const isVideoGeneration = options.some((option) => option.capabilityId.startsWith('video.'))
  const isImageGeneration = options.some((option) => option.capabilityId.startsWith('image.'))
  if (isImageGeneration && !isVideoGeneration) {
    // 图片统一节点：text / reference 两模式，无 edit/extend 合并，直接用 IMAGE_GENERATION_MODES 权威文案。
    return IMAGE_GENERATION_MODES.flatMap(({ mode, label }) => {
      const option = optionByMode.get(mode)
      if (!option) return []
      return [{ mode, label, option }]
    })
  }
  if (!isVideoGeneration) {
    return options.map((option) => ({
      mode: option.mode,
      label: compactModeLabel(option),
      option,
    }))
  }
  // 模型同时支持编辑与延长时，二者同构，合并为一个「视频编辑 / 延长」展示行 + 子开关。
  const editExtendPair = collapseVideoEditExtendOptions(options)
  return VIDEO_GENERATION_MODES.flatMap(({ mode, label }) => {
    if (mode === 'extend' && editExtendPair) return []
    if (mode === 'edit' && editExtendPair) {
      return [
        {
          mode: 'edit',
          label: '视频编辑 / 延长',
          option: editExtendPair.edit,
          alternate: 'extend' as CanvasMediaInputMode,
        },
      ]
    }
    return [{ mode, label, option: optionByMode.get(mode) }]
  })
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
  // 图片统一节点直接复用 modeOptionsForCapability 给出的权威文案，避免视频专属词汇泄露。
  if (option.capabilityId.startsWith('image.')) return option.label
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
  if (mode === 'edit') return '第 1 段视频为编辑主体，其余兼容素材按模型能力作为参考输入。'
  if (mode === 'extend') return '第 1 段视频为延长主体，其余兼容素材按模型能力作为参考输入。'
  return '当前为纯文本生成，轨道素材不会发送。'
}

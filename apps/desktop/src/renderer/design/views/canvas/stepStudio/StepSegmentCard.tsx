/**
 * 分镜分段卡片（P5）：单条分段的剧本 / 出镜资产 / 生成模式编辑与
 * 生成入口、产物预览。受控组件 —— 数据变更经 onPatch 上抛，
 * 由 StepStoryboardView 统一写 stepStudioState。
 * 二期：内建 dnd-kit useSortable，卡片经左上把手拖拽排序
 * （键盘可达：把手聚焦后空格拾起、方向键移动，sortableKeyboardCoordinates）。
 */

import { InputNumber, Radio, Select } from 'antd'
import { Button } from '@lobehub/ui'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { useMemo } from 'react'
import type { StepShotSegment } from '../canvas.types'
import type { SegmentRuntime } from './stepStoryboardModel'
import { SegmentMentionInput } from './SegmentMentionInput'
import type { SegmentMentionOption } from './SegmentMentionInput'
import { Icons } from '../../../Icons'

export interface SegmentAssetOption {
  value: string
  label: string
  /** 资产主参考图地址（下拉项里的小预览，可缺省） */
  previewUrl?: string | null
}

export type StepSegmentCardProps = Readonly<{
  segment: StepShotSegment
  index: number
  total: number
  runtime: SegmentRuntime
  characterOptions: SegmentAssetOption[]
  sceneOptions: SegmentAssetOption[]
  propOptions: SegmentAssetOption[]
  imageOptions: SegmentAssetOption[]
  generatable: boolean
  onPatch: (patch: Partial<StepShotSegment>) => void
  onGenerate: () => void
  onRemove: () => void
  onMove: (direction: 'up' | 'down') => void
}>

const STATUS_META: Record<StepShotSegment['status'], { label: string; className: string }> = {
  draft: { label: '草稿', className: 'is-draft' },
  generating: { label: '生成中', className: 'is-generating' },
  done: { label: '已完成', className: 'is-done' },
  failed: { label: '失败', className: 'is-failed' },
}

export function StepSegmentCard({
  segment,
  index,
  total,
  runtime,
  characterOptions,
  sceneOptions,
  propOptions,
  imageOptions,
  generatable,
  onPatch,
  onGenerate,
  onRemove,
  onMove,
}: StepSegmentCardProps) {
  const statusMeta = STATUS_META[runtime.status]
  const generating = runtime.status === 'generating'
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: segment.id,
  })

  // @ 提及候选：三类出镜资产合并（kind 决定引用写入哪个字段）
  const mentionOptions = useMemo<SegmentMentionOption[]>(
    () => [
      ...characterOptions.map((option) => ({ ...option, kind: 'character' as const })),
      ...sceneOptions.map((option) => ({ ...option, kind: 'scene' as const })),
      ...propOptions.map((option) => ({ ...option, kind: 'prop' as const })),
    ],
    [characterOptions, sceneOptions, propOptions],
  )

  const handleMentionSelect = (option: SegmentMentionOption): void => {
    if (option.kind === 'character') {
      onPatch({
        characterAssetIds: [...new Set([...segment.characterAssetIds, option.value])],
      })
    } else if (option.kind === 'scene') {
      onPatch({ sceneAssetId: option.value })
    } else {
      onPatch({ propAssetIds: [...new Set([...segment.propAssetIds, option.value])] })
    }
  }

  return (
    <article
      ref={setNodeRef}
      className={`step-segment-card${generating ? ' is-generating' : ''}${isDragging ? ' is-dragging' : ''}`}
      style={{ transform: CSS.Transform.toString(transform), transition }}
    >
      <header className="step-segment-card-head">
        <button
          type="button"
          className="step-segment-drag-handle"
          aria-label={`拖拽调整第 ${index + 1} 段顺序`}
          title="拖拽调整顺序（聚焦后空格拾起、方向键移动）"
          {...attributes}
          {...listeners}
        >
          <Icons.GripVertical size={13} />
        </button>
        <span className="step-segment-card-index">{index + 1}</span>
        <span className={`step-segment-status ${statusMeta.className}`}>
          {generating && runtime.progress > 0
            ? `${statusMeta.label} ${Math.round(runtime.progress)}%`
            : statusMeta.label}
        </span>
        <div className="step-segment-card-actions">
          <Button
            size="small"
            type="text"
            icon={<Icons.ArrowUp size={13} />}
            disabled={index === 0}
            aria-label="上移"
            onClick={() => onMove('up')}
          />
          <Button
            size="small"
            type="text"
            icon={<Icons.ArrowDown size={13} />}
            disabled={index === total - 1}
            aria-label="下移"
            onClick={() => onMove('down')}
          />
          <Button
            size="small"
            type="text"
            danger
            icon={<Icons.Trash size={13} />}
            aria-label="删除分段"
            onClick={onRemove}
          />
        </div>
      </header>

      <div className="step-segment-card-body">
        <SegmentMentionInput
          className="step-segment-script"
          value={segment.script}
          options={mentionOptions}
          placeholder="本段剧本 / 画面描述…（输入 @ 引用出镜资产，生成时自动注入设定）"
          onChange={(script) => onPatch({ script })}
          onMention={handleMentionSelect}
        />

        <div className="step-segment-cast-row">
          <Select
            mode="multiple"
            allowClear
            className="step-segment-cast-select"
            placeholder="出镜角色"
            optionFilterProp="label"
            value={segment.characterAssetIds}
            options={characterOptions}
            onChange={(value) => onPatch({ characterAssetIds: value })}
          />
          <Select
            allowClear
            className="step-segment-cast-select"
            placeholder="场景"
            optionFilterProp="label"
            value={segment.sceneAssetId ?? undefined}
            options={sceneOptions}
            onChange={(value) => onPatch({ sceneAssetId: value ?? null })}
          />
          <Select
            mode="multiple"
            allowClear
            className="step-segment-cast-select"
            placeholder="道具"
            optionFilterProp="label"
            value={segment.propAssetIds}
            options={propOptions}
            onChange={(value) => onPatch({ propAssetIds: value })}
          />
        </div>

        <div className="step-segment-gen-row">
          <Radio.Group
            className="step-segment-gen-mode"
            value={segment.genMode}
            onChange={(event) =>
              onPatch({ genMode: event.target.value as StepShotSegment['genMode'] })
            }
            options={[
              { value: 'reference', label: '全能参考' },
              { value: 'first_last_frame', label: '首尾帧' },
            ]}
          />
          <InputNumber
            className="step-segment-duration"
            min={1}
            max={60}
            step={1}
            precision={0}
            placeholder="秒数"
            value={segment.durationSec ?? null}
            onChange={(value) =>
              onPatch({ durationSec: typeof value === 'number' && value > 0 ? value : undefined })
            }
          />
          <Button
            size="small"
            type="primary"
            icon={<Icons.Play size={12} />}
            disabled={!generatable}
            loading={generating}
            onClick={onGenerate}
          >
            {generating ? '生成中' : '生成本段'}
          </Button>
        </div>

        {segment.genMode === 'reference' ? (
          <Select
            mode="multiple"
            allowClear
            className="step-segment-frame-select"
            placeholder="追加参考图（可选；出镜资产的设定图会自动带上）"
            optionFilterProp="label"
            value={segment.referenceAssetIds}
            options={imageOptions}
            onChange={(value) => onPatch({ referenceAssetIds: value })}
          />
        ) : (
          <div className="step-segment-frames">
            <Select
              allowClear
              className="step-segment-frame-select"
              placeholder="首帧图片"
              optionFilterProp="label"
              value={segment.firstFrameAssetId ?? undefined}
              options={imageOptions}
              onChange={(value) => onPatch({ firstFrameAssetId: value ?? null })}
            />
            <span className="step-segment-frames-arrow">→</span>
            <Select
              allowClear
              className="step-segment-frame-select"
              placeholder="尾帧图片（可选）"
              optionFilterProp="label"
              value={segment.lastFrameAssetId ?? undefined}
              options={imageOptions}
              onChange={(value) => onPatch({ lastFrameAssetId: value ?? null })}
            />
          </div>
        )}

        {runtime.errorText ? (
          <p className="step-segment-error" title={runtime.errorText}>
            {runtime.errorText}
          </p>
        ) : null}

        {runtime.latestVideoAsset ? (
          <div className="step-segment-output">
            <video
              key={runtime.latestVideoAsset.id}
              src={runtime.latestVideoAsset.url ?? undefined}
              controls
              preload="metadata"
            />
          </div>
        ) : null}
      </div>
    </article>
  )
}

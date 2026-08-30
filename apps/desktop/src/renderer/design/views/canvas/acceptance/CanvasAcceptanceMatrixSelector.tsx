import { Checkbox, Select, Typography } from 'antd'
import type { CanvasMediaModelSummary, ProviderProfile } from '@spark/protocol'

import { mediaModelKey } from '../canvasModelPickerModel'
import { CANVAS_ACCEPTANCE_MATRIX_CASES } from './canvasAcceptanceWorkflow'
import { listTextTargetOptions, modelMatchesKind } from './canvasAcceptanceTargetModel'
import type { CanvasAcceptanceTargetKind } from './canvasAcceptanceTypes'

const { Text } = Typography

export function CanvasAcceptanceMatrixSelector({
  providers,
  mediaModels,
  loading,
  textKeys,
  imageKeys,
  videoKeys,
  audioKeys,
  caseIds,
  onTextKeysChange,
  onImageKeysChange,
  onVideoKeysChange,
  onAudioKeysChange,
  onCaseIdsChange,
}: {
  providers: ProviderProfile[]
  mediaModels: CanvasMediaModelSummary[]
  loading: boolean
  textKeys: string[]
  imageKeys: string[]
  videoKeys: string[]
  audioKeys: string[]
  caseIds: string[]
  onTextKeysChange: (keys: string[]) => void
  onImageKeysChange: (keys: string[]) => void
  onVideoKeysChange: (keys: string[]) => void
  onAudioKeysChange: (keys: string[]) => void
  onCaseIdsChange: (caseIds: string[]) => void
}) {
  return (
    <section className="canvas-acceptance-section canvas-acceptance-matrix-section">
      <div className="canvas-acceptance-section-title">横向模型矩阵</div>
      <Text type="secondary">
        主工作流仍使用上方主模型；这里选择的附加模型会在指定节点创建独立泳道，共用相同冻结上游输入。
      </Text>
      <div className="canvas-acceptance-runtime-row canvas-acceptance-runtime-row-two">
        <MatrixModelSelect
          label="附加文本模型"
          loading={loading}
          value={textKeys}
          options={listTextTargetOptions(providers)}
          onChange={onTextKeysChange}
        />
        <MatrixModelSelect
          label="附加图片模型"
          loading={loading}
          value={imageKeys}
          options={mediaOptions(mediaModels, 'image')}
          onChange={onImageKeysChange}
        />
        <MatrixModelSelect
          label="附加视频模型"
          loading={loading}
          value={videoKeys}
          options={mediaOptions(mediaModels, 'video')}
          onChange={onVideoKeysChange}
        />
        <MatrixModelSelect
          label="附加音频模型"
          loading={loading}
          value={audioKeys}
          options={mediaOptions(mediaModels, 'audio')}
          onChange={onAudioKeysChange}
        />
      </div>
      <div className="canvas-acceptance-section-title">选择需要横向比较的节点</div>
      <Checkbox.Group
        className="canvas-acceptance-stage-grid"
        value={caseIds}
        options={CANVAS_ACCEPTANCE_MATRIX_CASES.map((item) => ({
          label: `${item.label} · ${item.kind}`,
          value: item.caseId,
        }))}
        onChange={(values) => onCaseIdsChange(values as string[])}
      />
    </section>
  )
}

function MatrixModelSelect({
  label,
  loading,
  value,
  options,
  onChange,
}: {
  label: string
  loading: boolean
  value: string[]
  options: Array<{ label: string; value: string }>
  onChange: (value: string[]) => void
}) {
  return (
    <label>
      <span>{label}</span>
      <Select<string[]>
        mode="multiple"
        allowClear
        showSearch
        maxTagCount="responsive"
        loading={loading}
        value={value}
        placeholder={label}
        optionFilterProp="label"
        options={options}
        onChange={onChange}
      />
    </label>
  )
}

function mediaOptions(
  models: readonly CanvasMediaModelSummary[],
  kind: CanvasAcceptanceTargetKind,
): Array<{ label: string; value: string }> {
  return models.filter((model) => modelMatchesKind(model, kind)).map((model) => ({
    label: `${model.providerName ?? model.providerKind} · ${model.displayName}`,
    value: mediaModelKey(model),
  }))
}

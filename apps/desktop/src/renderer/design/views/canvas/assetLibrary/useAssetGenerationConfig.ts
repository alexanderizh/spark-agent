/**
 * 资产生成配置（步骤模式 R3）。
 *
 * 统一「生成模型 + 参数」的配置状态，供两处入口共享：
 * - AssetCreateModal 的 AI 生成 Tab（新建资产即生成）
 * - 资产详情抽屉的「生成设定图」（对既有资产补图/重生成）
 *
 * 行为对齐画布模式的任务参数面板（CanvasInlineAiComposer 同一套纯函数）：
 * - 字段三层合并：manifest paramSchema > operation 建议 > 模型建议
 * - 默认值：参数偏好记忆 > capability.defaults > operation 默认
 * - 提交：buildModelParams + normalizeModelParamsForSubmit（画幅/尺寸互斥归一）
 * 提交成功后调用 rememberPreferences 记忆参数偏好（按渠道+模型维度）。
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import type { CanvasMediaModelSummary } from '@spark/protocol'
import { canvasApi } from '../canvas.api'
import type { CanvasOperationType } from '../canvas.types'
import {
  buildModelParams,
  mergeSchemaFields,
  modelSuggestedFields,
  normalizeModelParamsForSubmit,
  operationDefaultModelParams,
  operationSuggestedFields,
  resolveInitialModelParamDraftValue,
  schemaFields,
  updateModelParamDraftValue,
} from '../CanvasInlineAiComposer'
import type { SchemaField } from '../canvasParameterPresentation'
import { mediaModelKey } from '../canvasModelPickerModel'
import {
  canvasModelParameterPreferenceKey,
  readCanvasModelParameterPreferences,
  writeCanvasModelParameterPreferences,
} from '../canvasModelParameterPreferences'

/** 资产生成支持的图片类 operation（均落在 image.generate 能力上） */
export type AssetGenerationOperation = Extract<
  CanvasOperationType,
  'text_to_image' | 'image_to_image'
>

const OPERATION_CAPABILITY: Record<AssetGenerationOperation, string> = {
  text_to_image: 'image.generate',
  image_to_image: 'image.generate',
}

/** 提交时的模型与参数配置，直接展开进 CreateCanvasTaskRequest */
export type AssetGenerationSubmitConfig = {
  manifestId?: string
  providerProfileId?: string
  modelId?: string
  modelParams?: Record<string, unknown>
}

export type AssetGenerationConfigController = Readonly<{
  /** image.generate 可用模型列表 */
  models: CanvasMediaModelSummary[]
  modelLoading: boolean
  modelKey: string
  selectedModel: CanvasMediaModelSummary | undefined
  /** 三层合并后的参数字段（含常用/高级分层所需的全部信息） */
  fields: SchemaField[]
  /** 参数草稿（字符串形式，与画布模式一致） */
  paramDraft: Record<string, string>
  onModelChange: (value: string) => void
  onParameterChange: (name: string, value: string) => void
  /** 编译提交配置；未选模型时返回空对象（沿用平台默认） */
  buildSubmitConfig: () => AssetGenerationSubmitConfig
  /** 提交成功后调用，记忆当前模型的参数偏好 */
  rememberPreferences: () => void
}>

export function useAssetGenerationConfig(
  operation: AssetGenerationOperation,
  enabled = true,
): AssetGenerationConfigController {
  const [mediaModels, setMediaModels] = useState<CanvasMediaModelSummary[]>([])
  const [modelLoading, setModelLoading] = useState(false)
  const [modelKey, setModelKey] = useState('')
  const [paramDraft, setParamDraft] = useState<Record<string, string>>({})

  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    setModelLoading(true)
    void canvasApi
      .listMediaModels({ enabledOnly: true })
      .then((response) => {
        if (!cancelled) setMediaModels(response.models)
      })
      .catch(() => {
        if (!cancelled) setMediaModels([])
      })
      .finally(() => {
        if (!cancelled) setModelLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [enabled])

  const models = useMemo(
    () =>
      mediaModels.filter((model) =>
        model.capabilities.some((capability) => capability.id === 'image.generate'),
      ),
    [mediaModels],
  )

  // 默认选中第一个可用模型（对齐画布模式任务面板）；仍可切回空值沿用平台默认
  useEffect(() => {
    const first = models[0]
    if (modelKey === '' && first) setModelKey(mediaModelKey(first))
  }, [models, modelKey])

  const selectedModel = useMemo(
    () => models.find((model) => mediaModelKey(model) === modelKey),
    [models, modelKey],
  )

  const capability = useMemo(() => {
    const capabilityId = OPERATION_CAPABILITY[operation]
    return selectedModel?.capabilities.find((item) => item.id === capabilityId)
  }, [operation, selectedModel])

  const fields = useMemo(
    () =>
      mergeSchemaFields(
        schemaFields(capability?.paramSchema ?? {}),
        operationSuggestedFields(operation),
        modelSuggestedFields(selectedModel),
      ),
    [capability, operation, selectedModel],
  )

  // 模型或字段变化 → 草稿重置：偏好记忆 > capability.defaults > operation 默认
  useEffect(() => {
    const defaultParams: Record<string, unknown> = {
      ...operationDefaultModelParams(operation, selectedModel),
      ...(capability?.defaults ?? {}),
    }
    const preferenceKey = selectedModel
      ? canvasModelParameterPreferenceKey(selectedModel)
      : undefined
    const preferences = readCanvasModelParameterPreferences(preferenceKey, fields)
    const next: Record<string, string> = {}
    for (const field of fields) {
      const value = resolveInitialModelParamDraftValue({
        operation,
        field,
        fieldName: field.name,
        presetParams: preferences,
        existingParams: preferences,
        defaultParams,
      })
      if (value) next[field.name] = value
    }
    setParamDraft(next)
  }, [operation, selectedModel, capability, fields])

  const onModelChange = useCallback((value: string) => setModelKey(value), [])

  const onParameterChange = useCallback((name: string, value: string) => {
    setParamDraft((prev) => updateModelParamDraftValue(prev, name, value))
  }, [])

  const buildSubmitConfig = useCallback((): AssetGenerationSubmitConfig => {
    if (!selectedModel) return {}
    const params = normalizeModelParamsForSubmit(
      buildModelParams(fields, paramDraft),
      capability?.defaults ?? {},
      fields,
    )
    return {
      ...(selectedModel.manifestId ? { manifestId: selectedModel.manifestId } : {}),
      ...(selectedModel.providerProfileId
        ? { providerProfileId: selectedModel.providerProfileId }
        : {}),
      ...(selectedModel.modelId ? { modelId: selectedModel.modelId } : {}),
      ...(Object.keys(params).length > 0 ? { modelParams: params } : {}),
    }
  }, [selectedModel, capability, fields, paramDraft])

  const rememberPreferences = useCallback(() => {
    if (!selectedModel) return
    writeCanvasModelParameterPreferences(
      canvasModelParameterPreferenceKey(selectedModel),
      fields,
      paramDraft,
    )
  }, [selectedModel, fields, paramDraft])

  return {
    models,
    modelLoading,
    modelKey,
    selectedModel,
    fields,
    paramDraft,
    onModelChange,
    onParameterChange,
    buildSubmitConfig,
    rememberPreferences,
  }
}

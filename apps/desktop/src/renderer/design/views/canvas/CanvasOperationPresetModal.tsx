import { useCallback, useEffect, useMemo, useState } from 'react'
import { Input, Modal, Select, Tag, message } from 'antd'
import { Button } from '@lobehub/ui'
import {
  capabilityForOperation,
  type CanvasMediaModelSummary,
  type ManagedAgent,
  type ProviderProfile,
  type SkillItem,
} from '@spark/protocol'

import { Icons } from '../../Icons'
import { AgentPickerInline, ProviderModelPickerInline } from './CanvasAgentModal'
import { canvasApi, operationLabel } from './canvas.api'
import {
  CANVAS_OPERATION_PRESET_OPERATIONS,
  buildCanvasOperationPrompt,
  formatCanvasOperationPresetModelParams,
  readCanvasOperationPresetPromptPrefix,
  readCanvasOperationPreset,
  readCanvasOperationPresetOverrides,
  resetCanvasOperationPreset,
  type CanvasOperationPreset,
  writeCanvasOperationPreset,
} from './canvasOperationPresets'
import {
  buildCustomModelParams,
  buildModelParams,
  createCustomParamDraft,
  mediaModelKey,
  mergeSchemaFields,
  modelSuggestedFields,
  normalizeModelParamsForSubmit,
  operationSuggestedFields,
  isModelParamCoveredByFields,
  resolveInitialModelParamDraftValue,
  schemaFields,
  updateCustomParam,
  updateModelParamDraftValue,
  type CustomParamDraft,
  type CustomParamType,
} from './CanvasInlineAiComposer'
import type { CanvasOperationType } from './canvas.types'

type RuntimePickerMenu = 'agent' | 'model' | null

const INITIAL_OPERATION: CanvasOperationType = 'text_generate'

export function CanvasOperationPresetModal({
  open,
  onClose,
  onPresetCountChange,
}: {
  open: boolean
  onClose: () => void
  onPresetCountChange?: (count: number) => void
}) {
  const [operation, setOperation] = useState<CanvasOperationType>(INITIAL_OPERATION)
  const [prompt, setPrompt] = useState('')
  const [negativePrompt, setNegativePrompt] = useState('')
  const [selectedAgentId, setSelectedAgentId] = useState('')
  const [selectedTextProviderId, setSelectedTextProviderId] = useState('')
  const [selectedTextModelId, setSelectedTextModelId] = useState('')
  const [selectedSkillIds, setSelectedSkillIds] = useState<string[]>([])
  const [selectedModelKey, setSelectedModelKey] = useState('')
  const [modelParamDraft, setModelParamDraft] = useState<Record<string, string>>({})
  const [customParams, setCustomParams] = useState<CustomParamDraft[]>([])
  const [agents, setAgents] = useState<ManagedAgent[]>([])
  const [providers, setProviders] = useState<ProviderProfile[]>([])
  const [skills, setSkills] = useState<SkillItem[]>([])
  const [mediaModels, setMediaModels] = useState<CanvasMediaModelSummary[]>([])
  const [runtimeLoading, setRuntimeLoading] = useState(false)
  const [modelsLoading, setModelsLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [openRuntimeMenu, setOpenRuntimeMenu] = useState<RuntimePickerMenu>(null)

  const currentPreset = useMemo(() => readCanvasOperationPreset(operation), [operation])
  const isTextOperation = useMemo(() => isTextModelOperation(operation), [operation])
  const configuredPresetCount = useMemo(
    () => Object.keys(readCanvasOperationPresetOverrides()).length,
    [open],
  )
  const readonlyPromptPrefix = useMemo(
    () => readCanvasOperationPresetPromptPrefix(operation),
    [operation],
  )
  const effectivePromptPreview = useMemo(
    () => buildCanvasOperationPrompt(operation, prompt) ?? '',
    [operation, prompt],
  )

  useEffect(() => {
    if (!open) return
    setPrompt(currentPreset.prompt)
    setNegativePrompt(currentPreset.negativePrompt)
    setSelectedAgentId(currentPreset.agentId ?? '')
    setSelectedTextProviderId(currentPreset.providerProfileId ?? '')
    setSelectedTextModelId(currentPreset.modelId ?? '')
    setSelectedSkillIds(currentPreset.skillIds)
  }, [currentPreset, open])

  useEffect(() => {
    if (!open) return
    let cancelled = false
    setModelsLoading(true)
    void canvasApi
      .listMediaModels({ enabledOnly: true })
      .then((response) => {
        if (!cancelled) setMediaModels(response.models)
      })
      .catch(() => {
        if (!cancelled) setMediaModels([])
      })
      .finally(() => {
        if (!cancelled) setModelsLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    let cancelled = false
    setRuntimeLoading(true)
    void Promise.all([
      window.spark.invoke('agent:list', { includeDisabled: false }),
      window.spark.invoke('provider:list', {}),
      window.spark.invoke('skill:list', {}),
    ])
      .then(([agentRes, providerRes, skillRes]) => {
        if (cancelled) return
        setAgents((agentRes as { agents?: ManagedAgent[] }).agents ?? [])
        setProviders((providerRes as { profiles?: ProviderProfile[] }).profiles ?? [])
        setSkills(
          (skillRes as { skills?: SkillItem[] }).skills?.filter((skill) => skill.enabled) ?? [],
        )
      })
      .catch(() => {
        if (cancelled) return
        setAgents([])
        setProviders([])
        setSkills([])
      })
      .finally(() => {
        if (!cancelled) setRuntimeLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [open])

  const mediaCapabilityIds = useMemo(() => capabilityForOperation(operation), [operation])
  const supportedMediaModels = useMemo(() => {
    if (mediaCapabilityIds.length === 0) return []
    return mediaModels.filter((model) =>
      model.capabilities.some((item) =>
        (mediaCapabilityIds as readonly string[]).includes(item.id),
      ),
    )
  }, [mediaCapabilityIds, mediaModels])
  const modelOptions = useMemo(
    () =>
      supportedMediaModels.map((model) => ({
        value: mediaModelKey(model),
        label: `${model.providerName ?? model.providerKind} / ${model.displayName}`,
      })),
    [supportedMediaModels],
  )
  const selectedModel = useMemo(
    () => supportedMediaModels.find((model) => mediaModelKey(model) === selectedModelKey) ?? null,
    [selectedModelKey, supportedMediaModels],
  )
  const selectedCapability = useMemo(() => {
    if (!selectedModel) return null
    return (
      selectedModel.capabilities.find((item) =>
        (mediaCapabilityIds as readonly string[]).includes(item.id),
      ) ?? null
    )
  }, [mediaCapabilityIds, selectedModel])
  const textProviders = useMemo(
    () => providers.filter((provider) => isTextProviderProfile(provider)),
    [providers],
  )
  const selectedAgent = useMemo(
    () => agents.find((agent) => agent.id === selectedAgentId) ?? null,
    [agents, selectedAgentId],
  )
  const selectedTextProvider = useMemo(
    () => textProviders.find((provider) => provider.id === selectedTextProviderId) ?? null,
    [selectedTextProviderId, textProviders],
  )
  const parameterFields = useMemo(
    () =>
      mergeSchemaFields(
        schemaFields(selectedCapability?.paramSchema ?? {}),
        operationSuggestedFields(operation),
        modelSuggestedFields(selectedModel ?? undefined),
      ),
    [operation, selectedCapability, selectedModel],
  )

  useEffect(() => {
    if (!open || !isTextOperation || runtimeLoading) return
    const preferredAgent =
      (currentPreset.agentId ? agents.find((agent) => agent.id === currentPreset.agentId) : null) ??
      pickDefaultTextAgent(agents)
    const preferredProvider = pickDefaultTextProvider(
      textProviders,
      currentPreset.providerProfileId ?? preferredAgent?.providerProfileId,
    )
    setSelectedAgentId(preferredAgent?.id ?? '')
    setSelectedTextProviderId(preferredProvider?.id ?? '')
    setSelectedTextModelId((current) => {
      if (current && getProviderTextModels(preferredProvider).includes(current)) return current
      return pickDefaultTextModel(preferredProvider, currentPreset.modelId ?? preferredAgent?.modelId)
    })
  }, [
    agents,
    currentPreset.agentId,
    currentPreset.modelId,
    currentPreset.providerProfileId,
    isTextOperation,
    open,
    runtimeLoading,
    textProviders,
  ])

  useEffect(() => {
    if (!open || isTextOperation) {
      setSelectedModelKey('')
      return
    }
    if (supportedMediaModels.length === 0) {
      setSelectedModelKey('')
      return
    }
    const fromPreset = supportedMediaModels.find(
      (model) =>
        (!currentPreset.providerProfileId ||
          model.providerProfileId === currentPreset.providerProfileId) &&
        (!currentPreset.manifestId || model.manifestId === currentPreset.manifestId) &&
        (!currentPreset.modelId || model.effectiveModelId === currentPreset.modelId),
    )
    setSelectedModelKey(mediaModelKey(fromPreset ?? supportedMediaModels[0]!))
  }, [
    currentPreset.manifestId,
    currentPreset.modelId,
    currentPreset.providerProfileId,
    isTextOperation,
    open,
    supportedMediaModels,
  ])

  useEffect(() => {
    if (!open) return
    const defaults = selectedCapability?.defaults ?? {}
    const existing = currentPreset.modelParams
    const next: Record<string, string> = {}
    const fieldNames = new Set(parameterFields.map((field) => field.name))
    for (const field of parameterFields) {
      next[field.name] =
        resolveInitialModelParamDraftValue({
          operation,
          field,
          fieldName: field.name,
          presetParams: currentPreset.modelParams,
          existingParams: existing,
          defaultParams: defaults,
        }) ?? ''
    }
    setModelParamDraft(next)
    setCustomParams(
      Object.entries(existing)
        .filter(
          ([key, value]) =>
            !fieldNames.has(key) &&
            !isModelParamCoveredByFields(key, parameterFields) &&
            value != null,
        )
        .map(([key, value]) => ({
          id: `custom-${key}`,
          name: key,
          type: inferCustomParamType(value),
          value: typeof value === 'object' ? JSON.stringify(value) : String(value),
        })),
    )
  }, [currentPreset.modelParams, open, operation, parameterFields, selectedCapability])

  const buildCurrentModelParams = useCallback(
    () =>
      normalizeModelParamsForSubmit(
        {
          ...buildModelParams(parameterFields, modelParamDraft),
          ...buildCustomModelParams(customParams),
        },
        selectedCapability?.defaults ?? {},
        parameterFields,
      ),
    [customParams, modelParamDraft, parameterFields, selectedCapability?.defaults],
  )

  const handleTextAgentChange = useCallback(
    (agentId: string) => {
      const nextAgent = agents.find((agent) => agent.id === agentId)
      if (!nextAgent) return
      const nextProvider = pickDefaultTextProvider(
        textProviders,
        nextAgent.providerProfileId ?? selectedTextProvider?.id,
      )
      setSelectedAgentId(agentId)
      setSelectedTextProviderId(nextProvider?.id ?? '')
      setSelectedTextModelId(pickDefaultTextModel(nextProvider, nextAgent.modelId))
    },
    [agents, selectedTextProvider?.id, textProviders],
  )

  const handleTextProviderModelChange = useCallback((providerId: string, modelId: string) => {
    setSelectedTextProviderId(providerId)
    setSelectedTextModelId(modelId)
  }, [])

  const savePreset = async () => {
    setSaving(true)
    try {
      const nextModelParams = buildCurrentModelParams()
      const nextPreset: Partial<CanvasOperationPreset> = {
        prompt,
        negativePrompt,
        ...(isTextOperation && selectedAgentId ? { agentId: selectedAgentId } : {}),
        ...(isTextOperation && selectedTextProviderId
          ? { providerProfileId: selectedTextProviderId }
          : selectedModel?.providerProfileId
            ? { providerProfileId: selectedModel.providerProfileId }
            : {}),
        ...(selectedModel?.manifestId ? { manifestId: selectedModel.manifestId } : {}),
        ...(isTextOperation && selectedTextModelId
          ? { modelId: selectedTextModelId }
          : selectedModel?.effectiveModelId
            ? { modelId: selectedModel.effectiveModelId }
            : {}),
        ...(isTextOperation ? { skillIds: selectedSkillIds } : {}),
        modelParams: nextModelParams,
      }
      writeCanvasOperationPreset(operation, nextPreset)
      const nextCount = Object.keys(readCanvasOperationPresetOverrides()).length
      onPresetCountChange?.(nextCount)
      message.success(`${operationLabel(operation)} 应用级节点预设已更新`)
    } catch (error) {
      message.error(error instanceof Error ? error.message : '保存应用级节点预设失败')
    } finally {
      setSaving(false)
    }
  }

  const resetPreset = async () => {
    setSaving(true)
    try {
      resetCanvasOperationPreset(operation)
      const nextPreset = readCanvasOperationPreset(operation)
      setPrompt(nextPreset.prompt)
      setNegativePrompt(nextPreset.negativePrompt)
      setSelectedAgentId(nextPreset.agentId ?? '')
      setSelectedTextProviderId(nextPreset.providerProfileId ?? '')
      setSelectedTextModelId(nextPreset.modelId ?? '')
      setSelectedSkillIds(nextPreset.skillIds)
      const nextCount = Object.keys(readCanvasOperationPresetOverrides()).length
      onPresetCountChange?.(nextCount)
      message.success(`${operationLabel(operation)} 已恢复内置默认`)
    } catch (error) {
      message.error(error instanceof Error ? error.message : '恢复应用级节点预设失败')
    } finally {
      setSaving(false)
    }
  }

  const runtimeSummary = useMemo(() => {
    if (!isTextOperation) {
      if (modelsLoading) return '正在读取已启用模型...'
      if (selectedModel) {
        return `${selectedModel.providerName ?? selectedModel.providerKind} · ${selectedModel.effectiveModelId}`
      }
      return '未指定固定模型，将在节点侧按当前可用能力选择'
    }
    if (runtimeLoading) return '正在读取应用 Agent / Provider / Skills 配置...'
    const skillSummary = selectedSkillIds.length > 0 ? ` · ${selectedSkillIds.length} Skills` : ''
    if (selectedAgent && selectedTextProvider) {
      return `${selectedAgent.name} · ${selectedTextProvider.name}${selectedTextModelId ? ` · ${selectedTextModelId}` : ''}${skillSummary}`
    }
    if (selectedTextProvider) {
      return `${selectedTextProvider.name}${selectedTextModelId ? ` · ${selectedTextModelId}` : ''}${skillSummary}`
    }
    return '未固定 Agent / Provider，节点将使用可用默认值'
  }, [
    isTextOperation,
    modelsLoading,
    runtimeLoading,
    selectedAgent,
    selectedModel,
    selectedSkillIds.length,
    selectedTextModelId,
    selectedTextProvider,
  ])

  return (
    <Modal
      className="canvas-operation-preset-dialog"
      open={open}
      width={1040}
      destroyOnHidden
      closable={false}
      footer={null}
      centered
      styles={{ body: { padding: 0 } }}
      onCancel={onClose}
    >
      <div className="canvas-operation-preset-modal-shell">
        <div className="canvas-operation-preset-topbar">
          <div className="canvas-operation-preset-topbar-main">
            <span className="canvas-operation-preset-topbar-kicker">应用级节点预设</span>
            <div className="canvas-operation-preset-topbar-title-row">
              <h2>预设中心</h2>
              <Tag color={configuredPresetCount > 0 ? 'gold' : 'default'} bordered>
                {configuredPresetCount > 0 ? `已配置 ${configuredPresetCount}` : '未配置'}
              </Tag>
            </div>
            <p>只用于初始化后续新建节点，节点自己改过的配置会保持在节点内部。</p>
          </div>
          <Button
            size="small"
            type="text"
            icon={<Icons.X size={15} />}
            aria-label="关闭预设中心"
            onClick={onClose}
          />
        </div>
        <div className="canvas-operation-preset-scroll">
          <div className="canvas-operation-preset-modal">
            <aside className="canvas-operation-preset-sidebar">
              <div className="canvas-operation-preset-sidebar-head">
                <strong>节点类型</strong>
                <span>按能力类型拆分默认 Agent、模型、Skills 与参数</span>
              </div>
              <div className="canvas-operation-preset-sidebar-list">
                {CANVAS_OPERATION_PRESET_OPERATIONS.map((item) => (
                  <button
                    key={item}
                    type="button"
                    className={`canvas-operation-preset-sidebar-item${operation === item ? ' active' : ''}`}
                    onClick={() => setOperation(item)}
                  >
                    <span>{operationLabel(item)}</span>
                    {hasConfiguredPreset(item) ? (
                      <Tag color="blue" bordered>
                        已设定
                      </Tag>
                    ) : null}
                  </button>
                ))}
              </div>
            </aside>

            <div className="canvas-operation-preset-content">
              <div className="canvas-operation-preset-banner">
                <div>
                  <h3>{operationLabel(operation)}</h3>
                  <p>
                    这里管理同类型任务节点的初始化默认值。保存后只影响后续新建节点，不会回写已经改过的旧节点。
                  </p>
                </div>
                <Tag color="blue" bordered>
                  仅初始化新节点
                </Tag>
              </div>

              <section className="canvas-operation-preset-section">
                <div className="canvas-operation-preset-section-head">
                  <strong>节点运行时</strong>
                  <span>默认 Agent / Provider / Model / Skills</span>
                </div>
                {isTextOperation ? (
                  <div className="canvas-operation-preset-runtime">
                    <AgentPickerInline
                      agents={agents}
                      selectedId={selectedAgentId}
                      disabled={runtimeLoading || agents.length === 0}
                      open={openRuntimeMenu === 'agent'}
                      onOpenChange={(nextOpen) => setOpenRuntimeMenu(nextOpen ? 'agent' : null)}
                      onChange={handleTextAgentChange}
                    />
                    <ProviderModelPickerInline
                      providers={textProviders}
                      selectedProviderId={selectedTextProvider?.id ?? ''}
                      selectedModelId={selectedTextModelId}
                      disabled={runtimeLoading || textProviders.length === 0}
                      open={openRuntimeMenu === 'model'}
                      onOpenChange={(nextOpen) => setOpenRuntimeMenu(nextOpen ? 'model' : null)}
                      onChange={handleTextProviderModelChange}
                    />
                    <Select
                      mode="multiple"
                      size="small"
                      allowClear
                      showSearch
                      className="canvas-operation-preset-skill-select"
                      value={selectedSkillIds}
                      placeholder="选择默认 Skills"
                      optionFilterProp="label"
                      maxTagCount="responsive"
                      options={skills.map((skill) => ({ value: skill.id, label: skill.name }))}
                      disabled={runtimeLoading || skills.length === 0}
                      onChange={(value) => setSelectedSkillIds(value.map(String))}
                    />
                  </div>
                ) : (
                  <div className="canvas-operation-preset-model-block">
                    <label className="canvas-operation-preset-field">
                      <span>固定模型</span>
                      <Select
                        size="small"
                        allowClear
                        loading={modelsLoading}
                        value={selectedModelKey || undefined}
                        placeholder={modelsLoading ? '加载模型目录...' : '选择默认模型'}
                        options={modelOptions}
                        onChange={(value) => setSelectedModelKey(value == null ? '' : String(value))}
                      />
                    </label>
                  </div>
                )}
                <div className="canvas-operation-preset-summary">
                  <Icons.Bot size={13} />
                  <span>{runtimeSummary}</span>
                </div>
              </section>

              <section className="canvas-operation-preset-section">
                <div className="canvas-operation-preset-section-head">
                  <strong>提示词默认值</strong>
                  <span>统一常用结构、语气和反向约束</span>
                </div>
                {readonlyPromptPrefix ? (
                  <label className="canvas-operation-preset-field">
                    <span>系统内置前缀（只读）</span>
                    <Input.TextArea value={readonlyPromptPrefix} rows={5} readOnly />
                    <div className="canvas-operation-preset-hint">
                      这部分是节点类型内置约束，会在任务运行时自动拼接到最终提示词前面。
                    </div>
                  </label>
                ) : null}
                <label className="canvas-operation-preset-field">
                  <span>{readonlyPromptPrefix ? '补充提示词' : '预置提示词'}</span>
                  <Input.TextArea
                    value={prompt}
                    rows={5}
                    placeholder={
                      readonlyPromptPrefix
                        ? '例如：描述具体场景、主体、氛围和构图要求'
                        : '例如：统一镜头语言、品牌语气、结构要求'
                    }
                    onChange={(event) => setPrompt(event.target.value)}
                  />
                </label>
                <label className="canvas-operation-preset-field">
                  <span>预置反向提示词</span>
                  <Input.TextArea
                    value={negativePrompt}
                    rows={4}
                    placeholder="例如：不要水印、不要额外人物、不要低清晰度"
                    onChange={(event) => setNegativePrompt(event.target.value)}
                  />
                </label>
              </section>

              <section className="canvas-operation-preset-section">
                <div className="canvas-operation-preset-section-head">
                  <strong>模型参数默认值</strong>
                  <Tag color="purple" bordered>
                    跟随模型参数表
                  </Tag>
                </div>
                {parameterFields.length > 0 ? (
                  <div className="canvas-operation-preset-param-grid">
                    {parameterFields.map((field) => (
                      <label key={field.name} className="canvas-operation-preset-field">
                        <span title={field.description}>{field.title}</span>
                        {field.enumValues.length > 0 ? (
                          <Select
                            size="small"
                            allowClear
                            value={modelParamDraft[field.name] || undefined}
                            options={field.enumValues.map((value) => ({ value, label: value }))}
                            onChange={(value) =>
                              setModelParamDraft((prev) =>
                                updateModelParamDraftValue(
                                  prev,
                                  field.name,
                                  value == null ? '' : String(value),
                                ),
                              )
                            }
                          />
                        ) : field.type === 'boolean' ? (
                          <Select
                            size="small"
                            allowClear
                            value={modelParamDraft[field.name] || undefined}
                            options={[
                              { value: 'true', label: 'true' },
                              { value: 'false', label: 'false' },
                            ]}
                            onChange={(value) =>
                              setModelParamDraft((prev) =>
                                updateModelParamDraftValue(
                                  prev,
                                  field.name,
                                  value == null ? '' : String(value),
                                ),
                              )
                            }
                          />
                        ) : (
                          <Input
                            size="small"
                            type={field.type === 'integer' || field.type === 'number' ? 'number' : 'text'}
                            placeholder={field.placeholder}
                            value={modelParamDraft[field.name] ?? ''}
                            onChange={(event) =>
                              setModelParamDraft((prev) =>
                                updateModelParamDraftValue(prev, field.name, event.target.value),
                              )
                            }
                          />
                        )}
                      </label>
                    ))}
                  </div>
                ) : (
                  <div className="canvas-operation-preset-hint">
                    当前模型没有可结构化展示的参数表，仍可在下方添加自定义参数。
                  </div>
                )}

                <div className="canvas-operation-preset-section-head canvas-operation-preset-custom-head">
                  <strong>自定义参数</strong>
                  <Button
                    size="small"
                    type="text"
                    icon={<Icons.Plus size={13} />}
                    onClick={() => setCustomParams((prev) => [...prev, createCustomParamDraft()])}
                  >
                    添加
                  </Button>
                </div>
                {customParams.length === 0 ? (
                  <div className="canvas-operation-preset-hint">
                    可补充模型私有字段，例如 `seed`、`camera_control`、`reasoning_effort`。
                  </div>
                ) : (
                  <div className="canvas-operation-preset-custom-list">
                    {customParams.map((param) => (
                      <div key={param.id} className="canvas-operation-preset-custom-item">
                        <Input
                          size="small"
                          value={param.name}
                          placeholder="字段名"
                          onChange={(event) =>
                            updateCustomParam(setCustomParams, param.id, {
                              name: event.target.value,
                            })
                          }
                        />
                        <Select
                          size="small"
                          value={param.type}
                          options={[
                            { value: 'string', label: '文本' },
                            { value: 'number', label: '数字' },
                            { value: 'integer', label: '整数' },
                            { value: 'boolean', label: '布尔' },
                            { value: 'json', label: 'JSON' },
                          ]}
                          onChange={(value) =>
                            updateCustomParam(setCustomParams, param.id, {
                              type: String(value) as CustomParamType,
                            })
                          }
                        />
                        {param.type === 'boolean' ? (
                          <Select
                            size="small"
                            allowClear
                            value={param.value || undefined}
                            placeholder="值"
                            options={[
                              { value: 'true', label: 'true' },
                              { value: 'false', label: 'false' },
                            ]}
                            onChange={(value) =>
                              updateCustomParam(setCustomParams, param.id, {
                                value: value == null ? '' : String(value),
                              })
                            }
                          />
                        ) : (
                          <Input
                            size="small"
                            value={param.value}
                            placeholder={param.type === 'json' ? '{"key":"value"}' : '值'}
                            type={param.type === 'integer' || param.type === 'number' ? 'number' : 'text'}
                            onChange={(event) =>
                              updateCustomParam(setCustomParams, param.id, {
                                value: event.target.value,
                              })
                            }
                          />
                        )}
                        <Button
                          size="small"
                          type="text"
                          icon={<Icons.Trash size={13} />}
                          aria-label="删除自定义参数"
                          onClick={() =>
                            setCustomParams((prev) => prev.filter((item) => item.id !== param.id))
                          }
                        />
                      </div>
                    ))}
                  </div>
                )}

                <label className="canvas-operation-preset-field">
                  <span>当前默认参数预览</span>
                  <Input.TextArea
                    value={formatCanvasOperationPresetModelParams(buildCurrentModelParams())}
                    rows={6}
                    readOnly
                  />
                </label>
              </section>
            </div>
          </div>
        </div>
        <div className="canvas-operation-preset-footer">
          <div className="canvas-operation-preset-footer-summary">
            当前修改只影响后续新建节点，已存在节点保持自己的运行时配置。
          </div>
          <div className="canvas-operation-preset-footer-actions">
            <Button size="small" loading={saving} onClick={() => void resetPreset()}>
              恢复默认
            </Button>
            <Button size="small" onClick={onClose}>
              取消
            </Button>
            <Button size="small" type="primary" loading={saving} onClick={() => void savePreset()}>
              保存预设
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  )
}

function hasConfiguredPreset(operation: CanvasOperationType): boolean {
  const preset = readCanvasOperationPresetOverrides()[operation]
  if (!preset) return false
  return Boolean(
    preset.prompt ||
      preset.negativePrompt ||
      preset.providerProfileId ||
      preset.manifestId ||
      preset.modelId ||
      preset.agentId ||
      (preset.skillIds && preset.skillIds.length > 0) ||
      (preset.modelParams && Object.keys(preset.modelParams).length > 0),
  )
}

function isTextModelOperation(operation: CanvasOperationType): boolean {
  return (
    operation === 'text_generate' || operation === 'text_rewrite' || operation === 'prompt_optimize'
  )
}

function isTextProviderProfile(provider: ProviderProfile): boolean {
  return (
    provider.modelType == null ||
    provider.modelType === 'text' ||
    provider.modelType === 'multimodal'
  )
}

function pickDefaultTextAgent(agents: ManagedAgent[]): ManagedAgent | null {
  return (
    agents.find((agent) => agent.id === 'platform-manager-agent') ??
    agents.find((agent) => agent.isDefault) ??
    agents[0] ??
    null
  )
}

function pickDefaultTextProvider(
  providers: ProviderProfile[],
  preferredId?: string | null,
): ProviderProfile | null {
  return (
    (preferredId ? providers.find((provider) => provider.id === preferredId) : null) ??
    providers.find((provider) => provider.isDefault) ??
    providers[0] ??
    null
  )
}

function pickDefaultTextModel(
  provider: ProviderProfile | null | undefined,
  preferredModel?: string | null,
): string {
  if (!provider) return preferredModel?.trim() ?? ''
  const models = getProviderTextModels(provider)
  const preferred = preferredModel?.trim()
  if (preferred && (models.length === 0 || models.includes(preferred))) return preferred
  return provider.defaultModel?.trim() || models[0] || ''
}

function getProviderTextModels(provider: ProviderProfile | null | undefined): string[] {
  if (!provider) return []
  return Array.from(
    new Set(
      [
        provider.defaultModel,
        provider.haikuModel,
        provider.sonnetModel,
        provider.opusModel,
        ...(provider.modelIds ?? []),
      ]
        .map((model) => model?.trim())
        .filter((model): model is string => Boolean(model)),
    ),
  )
}

function inferCustomParamType(value: unknown): CustomParamType {
  if (typeof value === 'boolean') return 'boolean'
  if (typeof value === 'number') return Number.isInteger(value) ? 'integer' : 'number'
  if (value && typeof value === 'object') return 'json'
  return 'string'
}

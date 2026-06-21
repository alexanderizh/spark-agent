import { useCallback, useEffect, useMemo, useState } from 'react'
import { Input, Select, Tag, Tooltip, message } from 'antd'
import { Button } from '@lobehub/ui'
import { Icons } from '../../Icons'
import {
  capabilityForOperation,
  type ManagedAgent,
  type CanvasMediaModelSummary,
  type CanvasMediaTaskInputFile,
  type ProviderProfile,
} from '@spark/protocol'
import { operationLabel } from './canvas.api'
import { getCanvasCapability, nodeOperation } from './canvas.capabilities'
import { AgentPickerInline, ProviderModelPickerInline } from './CanvasAgentModal'
import { AssetThumbnail } from './CanvasAssetThumbnail'
import { canvasApi } from './canvas.api'
import {
  buildCustomModelParams,
  buildModelParams,
  createCustomParamDraft,
  mediaModelKey,
  mergeSchemaFields,
  modelSuggestedFields,
  normalizeModelParamsForSubmit,
  operationSuggestedFields,
  schemaFields,
  updateCustomParam,
  updateModelParamDraftValue,
  type CustomParamDraft,
  type CustomParamType,
} from './CanvasInlineAiComposer'
import type {
  CanvasInputTransport,
  CanvasNode,
  CanvasOperationType,
  CanvasSnapshot,
  CanvasTask,
} from './canvas.types'

/**
 * 操作节点悬浮编辑面板（文档：点击操作节点后下方展开）。
 *
 * 定位在底部 dock 上方（bottom:72px，同 add-node-menu 模式）。
 * 三区：操作类型 / 输入预览 / 参数编辑。确定后运行。
 */

type CanvasTaskInputRole = NonNullable<CanvasMediaTaskInputFile['role']>
type RuntimePickerMenu = 'agent' | 'model' | null

export type OperationRunParams = {
  prompt: string
  negativePrompt?: string
  inputNodeIds?: string[]
  inputTransport?: CanvasInputTransport
  inputRoles?: Record<string, CanvasTaskInputRole>
  agentId?: string
  providerProfileId?: string
  manifestId?: string
  modelId?: string
  modelParams?: Record<string, unknown>
}

export type OperationDraftParams = {
  title: string | null
  message: string
  prompt: string
  negativePrompt: string
  modelParams: Record<string, unknown>
}

export function CanvasOperationPanel({
  node,
  snapshot,
  task,
  onClose,
  onRun,
  onRetry,
  onSaveDraft,
}: {
  node: CanvasNode
  snapshot: CanvasSnapshot
  /** 关联的 CanvasTask（可能为 null，pending 状态） */
  task?: CanvasTask | null
  onClose: () => void
  onRun: (params: OperationRunParams) => Promise<void> | void
  onRetry: () => void
  onSaveDraft: (params: OperationDraftParams) => Promise<void> | void
}) {
  const operation = nodeOperation(node) ?? 'text_generate'
  const capability = getCanvasCapability(operation)
  const operationText = operationLabel(operation)
  const isTextOperation = isTextModelOperation(operation)
  const [fullscreen, setFullscreen] = useState(false)
  const canEditMediaInputs =
    capability?.inputTypes.some((type) => type === 'image' || type === 'video') ?? false

  // 上游输入节点（used_as_input edge 的 source）
  const sourceInputNodes = useMemo(() => {
    const inputEdges = snapshot.edges.filter(
      (edge) => edge.targetNodeId === node.id && edge.type === 'used_as_input',
    )
    const inputIds = new Set(inputEdges.map((edge) => edge.sourceNodeId))
    return snapshot.nodes.filter((n) => inputIds.has(n.id) && !n.hidden)
  }, [snapshot.edges, snapshot.nodes, node.id])
  const expandedSourceInputNodes = useMemo(
    () => expandOperationInputNodes(sourceInputNodes, snapshot.nodes),
    [sourceInputNodes, snapshot.nodes],
  )
  const editableSourceMediaNodes = useMemo(
    () =>
      expandedSourceInputNodes.filter((item) =>
        isSupportedMediaInputNode(item, capability?.inputTypes ?? []),
      ),
    [capability, expandedSourceInputNodes],
  )
  const mediaInputOptions = useMemo(
    () =>
      snapshot.nodes
        .filter((item) => {
          if (item.hidden || item.id === node.id) return false
          if (item.type !== 'image' && item.type !== 'video') return false
          if (item.type === 'video' && !capability?.inputTypes.includes('video')) return false
          if (item.type === 'image' && !capability?.inputTypes.includes('image')) return false
          return true
        })
        .sort((left, right) => left.x - right.x || left.y - right.y || left.zIndex - right.zIndex)
        .map((item, index) => ({
          value: item.id,
          label: item.title ?? (item.type === 'video' ? `视频 ${index + 1}` : `图片 ${index + 1}`),
          type: item.type,
        })),
    [capability, node.id, snapshot.nodes],
  )

  // 已有 output 节点（generated edge 的 target）
  const outputNodes = useMemo(() => {
    const outputEdges = snapshot.edges.filter(
      (edge) => edge.sourceNodeId === node.id && edge.type === 'generated',
    )
    const outputIds = new Set(outputEdges.map((edge) => edge.targetNodeId))
    return snapshot.nodes.filter((n) => outputIds.has(n.id) && !n.hidden)
  }, [snapshot.edges, snapshot.nodes, node.id])

  const inheritedNegativePrompt = useMemo(() => {
    const taskNegativePrompt = task?.negativePrompt?.trim()
    if (taskNegativePrompt) return taskNegativePrompt
    const nodeNegativePrompt = node.data.negativePrompt?.trim()
    if (nodeNegativePrompt) return nodeNegativePrompt
    for (const sourceNode of expandedSourceInputNodes) {
      const sourceTask = sourceNode.taskId
        ? snapshot.tasks.find((item) => item.id === sourceNode.taskId)
        : null
      const sourceTaskNegativePrompt = sourceTask?.negativePrompt?.trim()
      if (sourceTaskNegativePrompt) return sourceTaskNegativePrompt
      const sourceNodeNegativePrompt = sourceNode.data.negativePrompt?.trim()
      if (sourceNodeNegativePrompt) return sourceNodeNegativePrompt
    }
    return snapshot.project.settings?.negativePrompt?.trim() ?? ''
  }, [
    expandedSourceInputNodes,
    node.data.negativePrompt,
    snapshot.project.settings?.negativePrompt,
    snapshot.tasks,
    task?.negativePrompt,
  ])

  // 参数状态：从 task、node.data、项目/上游继承值带入
  const [prompt, setPrompt] = useState(
    task?.prompt ?? node.data.prompt ?? snapshot.project.settings?.prompt ?? '',
  )
  const [negativePrompt, setNegativePrompt] = useState(inheritedNegativePrompt)
  const [mediaModels, setMediaModels] = useState<CanvasMediaModelSummary[]>([])
  const [modelsLoading, setModelsLoading] = useState(false)
  const [selectedModelKey, setSelectedModelKey] = useState('')
  const [agents, setAgents] = useState<ManagedAgent[]>([])
  const [providers, setProviders] = useState<ProviderProfile[]>([])
  const [runtimeLoading, setRuntimeLoading] = useState(false)
  const [selectedAgentId, setSelectedAgentId] = useState(task?.agentId ?? '')
  const [selectedTextProviderId, setSelectedTextProviderId] = useState(
    task?.providerProfileId ?? '',
  )
  const [selectedTextModelId, setSelectedTextModelId] = useState(task?.modelId ?? '')
  const [openRuntimeMenu, setOpenRuntimeMenu] = useState<RuntimePickerMenu>(null)
  const [modelParamDraft, setModelParamDraft] = useState<Record<string, string>>({})
  const [customParams, setCustomParams] = useState<CustomParamDraft[]>([])
  const [selectedInputNodeIds, setSelectedInputNodeIds] = useState<string[]>(() =>
    (canEditMediaInputs ? editableSourceMediaNodes : expandedSourceInputNodes).map(
      (item) => item.id,
    ),
  )
  const [firstFrameNodeId, setFirstFrameNodeId] = useState('')
  const [lastFrameNodeId, setLastFrameNodeId] = useState('')
  const [referenceFrameNodeIds, setReferenceFrameNodeIds] = useState<string[]>([])
  const [running, setRunning] = useState(false)
  const [savingDraft, setSavingDraft] = useState(false)
  const [titleDraft, setTitleDraft] = useState(node.title ?? '')
  const [messageDraft, setMessageDraft] = useState(node.data.message ?? '')

  useEffect(() => {
    setSelectedInputNodeIds(
      (canEditMediaInputs ? editableSourceMediaNodes : expandedSourceInputNodes).map(
        (item) => item.id,
      ),
    )
  }, [canEditMediaInputs, editableSourceMediaNodes, expandedSourceInputNodes])

  useEffect(() => {
    setPrompt(task?.prompt ?? node.data.prompt ?? snapshot.project.settings?.prompt ?? '')
    setNegativePrompt(inheritedNegativePrompt)
    setTitleDraft(node.title ?? '')
    setMessageDraft(node.data.message ?? '')
    setSelectedAgentId(task?.agentId ?? '')
    setSelectedTextProviderId(task?.providerProfileId ?? '')
    setSelectedTextModelId(task?.modelId ?? '')
  }, [
    inheritedNegativePrompt,
    node.data.message,
    node.data.prompt,
    node.id,
    node.title,
    snapshot.project.settings?.prompt,
    task?.prompt,
    task?.agentId,
    task?.modelId,
    task?.providerProfileId,
  ])

  useEffect(() => {
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
  }, [])

  useEffect(() => {
    if (!isTextOperation) return
    let cancelled = false
    setRuntimeLoading(true)
    void Promise.all([
      window.spark.invoke('agent:list', { includeDisabled: false }),
      window.spark.invoke('provider:list', {}),
    ])
      .then(([agentRes, providerRes]) => {
        if (cancelled) return
        setAgents((agentRes as { agents?: ManagedAgent[] }).agents ?? [])
        setProviders((providerRes as { profiles?: ProviderProfile[] }).profiles ?? [])
      })
      .catch(() => {
        if (cancelled) return
        setAgents([])
        setProviders([])
      })
      .finally(() => {
        if (!cancelled) setRuntimeLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [isTextOperation])

  // 输入节点内容带入 prompt（首次打开时如果 prompt 为空）
  useEffect(() => {
    if (prompt) return
    const textInputs = expandedSourceInputNodes
      .filter((n) => n.type === 'text' || n.type === 'prompt')
      .map((n) => n.data.text ?? '')
      .filter(Boolean)
    if (textInputs.length > 0) {
      setPrompt(textInputs.join('\n\n'))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const statusTag = useMemo(() => {
    const s = node.data.status ?? 'pending'
    const color =
      s === 'completed' ? 'green' : s === 'failed' ? 'red' : s === 'running' ? 'blue' : 'default'
    return (
      <Tag color={color} bordered>
        {operationStatusLabel(s)}
      </Tag>
    )
  }, [node.data.status])

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
    () => supportedMediaModels.find((model) => mediaModelKey(model) === selectedModelKey),
    [selectedModelKey, supportedMediaModels],
  )
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

  useEffect(() => {
    if (!isTextOperation || runtimeLoading) return

    const defaultAgent =
      (task?.agentId ? agents.find((agent) => agent.id === task.agentId) : null) ??
      pickDefaultTextAgent(agents)
    const preferredProviderId =
      task?.providerProfileId ?? defaultAgent?.providerProfileId ?? selectedTextProviderId
    const defaultProvider = pickDefaultTextProvider(textProviders, preferredProviderId)

    setSelectedAgentId((current) =>
      current && agents.some((agent) => agent.id === current) ? current : defaultAgent?.id || '',
    )
    setSelectedTextProviderId((current) =>
      current && textProviders.some((provider) => provider.id === current)
        ? current
        : defaultProvider?.id || '',
    )
    setSelectedTextModelId((current) => {
      const provider =
        textProviders.find((item) => item.id === selectedTextProviderId) ?? defaultProvider
      const models = getProviderTextModels(provider)
      if (current && (models.length === 0 || models.includes(current))) return current
      return pickDefaultTextModel(provider, task?.modelId ?? defaultAgent?.modelId)
    })
  }, [
    agents,
    isTextOperation,
    node.id,
    runtimeLoading,
    selectedTextProviderId,
    task?.agentId,
    task?.modelId,
    task?.providerProfileId,
    textProviders,
  ])

  const runtimeSummary = useMemo(() => {
    if (runtimeLoading) return '正在读取应用 Agent 与 Provider 配置...'
    if (selectedAgent && selectedTextProvider) {
      return `${selectedAgent.name} · ${selectedTextProvider.name}${selectedTextModelId ? ` · ${selectedTextModelId}` : ''}`
    }
    if (selectedTextProvider) {
      return `${selectedTextProvider.name}${selectedTextModelId ? ` · ${selectedTextModelId}` : ''}`
    }
    return '未找到可用文本 Provider'
  }, [runtimeLoading, selectedAgent, selectedTextModelId, selectedTextProvider])
  const selectedCapability = useMemo(() => {
    if (!selectedModel) return null
    return (
      selectedModel.capabilities.find((item) =>
        (mediaCapabilityIds as readonly string[]).includes(item.id),
      ) ?? null
    )
  }, [mediaCapabilityIds, selectedModel])
  const supportsVideoFrameRoles = useMemo(
    () =>
      operationSupportsVideoFrameRoles(operation) &&
      mediaInputOptions.some((option) => option.type === 'image'),
    [mediaInputOptions, operation],
  )
  const videoFrameMaxImages = useMemo(
    () => videoImageLimitForCapability(operation, selectedCapability),
    [operation, selectedCapability],
  )
  const canUseLastFrame = supportsVideoFrameRoles && videoFrameMaxImages > 1
  const selectedFrameCount =
    (firstFrameNodeId ? 1 : 0) + (lastFrameNodeId ? 1 : 0) + referenceFrameNodeIds.length
  const referenceFrameCapacity = Math.max(
    0,
    videoFrameMaxImages - (firstFrameNodeId ? 1 : 0) - (lastFrameNodeId ? 1 : 0),
  )
  const frameImageOptions = useMemo(
    () => mediaInputOptions.filter((option) => option.type === 'image'),
    [mediaInputOptions],
  )
  const hasExplicitFrameInput =
    supportsVideoFrameRoles &&
    Boolean(firstFrameNodeId || lastFrameNodeId || referenceFrameNodeIds.length > 0)
  const explicitFrameNodeIds = useMemo(
    () =>
      supportsVideoFrameRoles
        ? normalizeVideoFrameNodeIds(
            firstFrameNodeId,
            lastFrameNodeId,
            referenceFrameNodeIds,
            videoFrameMaxImages,
          )
        : [],
    [
      firstFrameNodeId,
      lastFrameNodeId,
      referenceFrameNodeIds,
      supportsVideoFrameRoles,
      videoFrameMaxImages,
    ],
  )
  const parameterFields = useMemo(
    () =>
      mergeSchemaFields(
        schemaFields(selectedCapability?.paramSchema ?? {}),
        operationSuggestedFields(operation),
        modelSuggestedFields(selectedModel),
      ),
    [operation, selectedCapability, selectedModel],
  )

  useEffect(() => {
    if (supportedMediaModels.length === 0) {
      setSelectedModelKey('')
      return
    }
    if (supportedMediaModels.some((model) => mediaModelKey(model) === selectedModelKey)) return
    const fromTask = supportedMediaModels.find(
      (model) =>
        (!task?.providerProfileId || model.providerProfileId === task.providerProfileId) &&
        (!task?.manifestId || model.manifestId === task.manifestId) &&
        (!task?.modelId || model.effectiveModelId === task.modelId),
    )
    setSelectedModelKey(mediaModelKey(fromTask ?? supportedMediaModels[0]!))
  }, [
    selectedModelKey,
    supportedMediaModels,
    task?.manifestId,
    task?.modelId,
    task?.providerProfileId,
  ])

  useEffect(() => {
    const defaults = selectedCapability?.defaults ?? {}
    const existing = task?.modelParams ?? node.data.modelParams ?? {}
    const next: Record<string, string> = {}
    const fieldNames = new Set(parameterFields.map((field) => field.name))
    for (const field of parameterFields) {
      const value = existing[field.name] ?? defaults[field.name]
      next[field.name] = value == null ? '' : String(value)
    }
    setModelParamDraft(next)
    setCustomParams(
      Object.entries(existing)
        .filter(([key, value]) => !fieldNames.has(key) && value != null)
        .map(([key, value]) => ({
          id: `custom-${key}`,
          name: key,
          type: inferCustomParamType(value),
          value: typeof value === 'object' ? JSON.stringify(value) : String(value),
        })),
    )
  }, [node.data.modelParams, parameterFields, selectedCapability, task?.modelParams])

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
      if (nextAgent == null) return
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

  const handleSaveDraft = useCallback(async () => {
    if (savingDraft) return
    setSavingDraft(true)
    try {
      await onSaveDraft({
        title: titleDraft.trim().length > 0 ? titleDraft.trim() : null,
        message: messageDraft.trim(),
        prompt: prompt.trim(),
        negativePrompt: negativePrompt.trim(),
        modelParams: buildCurrentModelParams(),
      })
      message.success('操作配置已保存')
    } catch (error) {
      console.error('[CanvasOperationPanel] Failed to save operation draft:', error)
      message.error(error instanceof Error ? error.message : '保存操作配置失败')
    } finally {
      setSavingDraft(false)
    }
  }, [
    buildCurrentModelParams,
    messageDraft,
    negativePrompt,
    onSaveDraft,
    prompt,
    savingDraft,
    titleDraft,
  ])

  const handleRun = useCallback(async () => {
    if (running || node.data.status === 'running') return
    if (
      !prompt.trim() &&
      !capability?.inputTypes.includes('image') &&
      !capability?.inputTypes.includes('video')
    ) {
      message.warning('请输入提示词')
      return
    }
    if (
      canEditMediaInputs &&
      capability?.inputTypes.some((type) => type === 'image' || type === 'video') &&
      selectedInputNodeIds.length === 0 &&
      !hasExplicitFrameInput
    ) {
      message.warning('请至少选择一个输入图片或视频节点')
      return
    }
    const inputRoles = supportsVideoFrameRoles
      ? buildVideoFrameInputRoles(
          explicitFrameNodeIds,
          firstFrameNodeId,
          lastFrameNodeId,
          referenceFrameNodeIds,
        )
      : undefined
    const nextModelParams = buildCurrentModelParams()
    const runInputNodeIds = Array.from(
      new Set([
        ...selectedInputNodeIds,
        ...explicitFrameNodeIds,
        ...expandedSourceInputNodes
          .filter((item) => item.type === 'text' || item.type === 'prompt')
          .map((item) => item.id),
      ]),
    )
    setRunning(true)
    try {
      await onRun({
        prompt: prompt.trim(),
        ...(negativePrompt.trim() ? { negativePrompt: negativePrompt.trim() } : {}),
        inputNodeIds: runInputNodeIds,
        ...(isTextOperation && selectedAgentId ? { agentId: selectedAgentId } : {}),
        ...(selectedModel?.providerKind === 'xai'
          ? { inputTransport: 'base64' as const }
          : { inputTransport: 'cloud_url' as const }),
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
        ...(Object.keys(nextModelParams).length > 0 ? { modelParams: nextModelParams } : {}),
        ...(inputRoles && Object.keys(inputRoles).length > 0 ? { inputRoles } : {}),
      })
    } catch (error) {
      console.error('[CanvasOperationPanel] Failed to run operation node:', error)
      message.error('提交任务失败，请调整参数后重试')
    } finally {
      setRunning(false)
    }
  }, [
    canEditMediaInputs,
    capability,
    buildCurrentModelParams,
    negativePrompt,
    node.data.status,
    onRun,
    prompt,
    selectedModel,
    running,
    expandedSourceInputNodes,
    explicitFrameNodeIds,
    firstFrameNodeId,
    hasExplicitFrameInput,
    lastFrameNodeId,
    selectedInputNodeIds,
    referenceFrameNodeIds,
    isTextOperation,
    selectedAgentId,
    selectedTextModelId,
    selectedTextProviderId,
    supportsVideoFrameRoles,
  ])

  const selectedInputIdSet = useMemo(
    () => new Set([...selectedInputNodeIds, ...explicitFrameNodeIds]),
    [explicitFrameNodeIds, selectedInputNodeIds],
  )
  const inputNodes = useMemo(() => {
    const byId = new Map(snapshot.nodes.map((item) => [item.id, item]))
    return Array.from(selectedInputIdSet)
      .map((id) => byId.get(id))
      .filter((item): item is CanvasNode => item != null)
      .filter((item) => !item.hidden && selectedInputIdSet.has(item.id))
  }, [selectedInputIdSet, snapshot.nodes])
  const mediaInputs = inputNodes.filter((n) => n.type === 'image' || n.type === 'video')
  const textInputs = expandedSourceInputNodes.filter(
    (n) => n.type === 'text' || n.type === 'prompt',
  )

  return (
    <div
      className={`canvas-operation-panel${fullscreen ? ' is-fullscreen' : ''}`}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div className="canvas-operation-panel-head">
        <div className="canvas-operation-panel-title">
          {operationLabel(operation)}
          {statusTag}
          {outputNodes.length > 0 && (
            <Tag color="purple" bordered>
              {outputNodes.length} 产出
            </Tag>
          )}
        </div>
        <div className="canvas-operation-panel-head-actions">
          <Tooltip title={fullscreen ? '退出全屏' : '全屏操作'}>
            <Button
              size="small"
              type="text"
              icon={fullscreen ? <Icons.Minimize size={15} /> : <Icons.Maximize size={15} />}
              aria-label={fullscreen ? '退出全屏' : '全屏操作'}
              onClick={() => setFullscreen((current) => !current)}
            />
          </Tooltip>
          <Button size="small" type="text" icon={<Icons.X size={15} />} onClick={onClose} />
        </div>
      </div>

      <div className="canvas-operation-panel-body">
        <div className="canvas-operation-panel-section canvas-operation-panel-section-node">
          <div className="canvas-operation-panel-section-label">节点信息</div>
          <div className="canvas-operation-panel-detail-grid">
            <label className="canvas-operation-panel-detail-field">
              <span>标题</span>
              <Input
                size="small"
                value={titleDraft}
                placeholder={`${operationText}节点`}
                onChange={(event) => setTitleDraft(event.target.value)}
                disabled={running}
              />
            </label>
            <label className="canvas-operation-panel-detail-field">
              <span>备注 / 展示文本</span>
              <Input.TextArea
                rows={2}
                value={messageDraft}
                placeholder="显示在节点卡片上的辅助说明"
                onChange={(event) => setMessageDraft(event.target.value)}
                disabled={running}
              />
            </label>
          </div>
        </div>

        {/* 输入预览 */}
        {(expandedSourceInputNodes.length > 0 || canEditMediaInputs) && (
          <div className="canvas-operation-panel-section canvas-operation-panel-section-inputs">
            <div className="canvas-operation-panel-section-title-row">
              <div className="canvas-operation-panel-section-label">
                输入 ({inputNodes.length + textInputs.length})
              </div>
              {sourceInputNodes.some((item) => item.type === 'group') && (
                <Tag bordered color="gold">
                  已展开组内元素
                </Tag>
              )}
            </div>
            {canEditMediaInputs && (
              <>
                <Select
                  mode="multiple"
                  size="small"
                  allowClear
                  showSearch
                  value={
                    supportsVideoFrameRoles
                      ? selectedInputNodeIds.filter((id) =>
                          mediaInputOptions.some(
                            (option) => option.value === id && option.type === 'video',
                          ),
                        )
                      : selectedInputNodeIds
                  }
                  placeholder={
                    supportsVideoFrameRoles
                      ? '选择输入视频节点（图片请用下方帧角色）'
                      : '选择或调整输入图片/视频节点'
                  }
                  options={
                    supportsVideoFrameRoles
                      ? mediaInputOptions.filter((option) => option.type === 'video')
                      : mediaInputOptions
                  }
                  optionFilterProp="label"
                  onChange={(value) => {
                    const values = value.map(String)
                    setSelectedInputNodeIds((prev) =>
                      supportsVideoFrameRoles
                        ? [
                            ...prev.filter((id) =>
                              mediaInputOptions.some(
                                (option) => option.value === id && option.type === 'image',
                              ),
                            ),
                            ...values,
                          ]
                        : values,
                    )
                  }}
                  disabled={running}
                />
                {supportsVideoFrameRoles && (
                  <div className="canvas-operation-panel-frame-roles">
                    <div className="canvas-frame-role-grid">
                      <div className="canvas-param-field">
                        <span>首帧</span>
                        <Select
                          size="small"
                          allowClear
                          showSearch
                          value={firstFrameNodeId || undefined}
                          options={frameImageOptions}
                          optionFilterProp="label"
                          disabled={running}
                          onChange={(value) => {
                            const next = value == null ? '' : String(value)
                            setFirstFrameNodeId(next)
                            if (next && next === lastFrameNodeId) setLastFrameNodeId('')
                            if (next)
                              setReferenceFrameNodeIds((prev) => prev.filter((id) => id !== next))
                          }}
                        />
                      </div>
                      <div className="canvas-param-field">
                        <span>尾帧</span>
                        <Select
                          size="small"
                          allowClear
                          showSearch
                          value={lastFrameNodeId || undefined}
                          options={frameImageOptions}
                          optionFilterProp="label"
                          placeholder={canUseLastFrame ? undefined : '当前模型仅 1 张图'}
                          disabled={running || !canUseLastFrame}
                          onChange={(value) => {
                            const next = value == null ? '' : String(value)
                            setLastFrameNodeId(next && next !== firstFrameNodeId ? next : '')
                            if (next)
                              setReferenceFrameNodeIds((prev) => prev.filter((id) => id !== next))
                          }}
                        />
                      </div>
                    </div>
                    {videoFrameMaxImages > 2 && (
                      <div className="canvas-param-field">
                        <span>参考图</span>
                        <Select
                          mode="multiple"
                          size="small"
                          allowClear
                          showSearch
                          value={referenceFrameNodeIds}
                          options={frameImageOptions.filter(
                            (option) =>
                              option.value !== firstFrameNodeId && option.value !== lastFrameNodeId,
                          )}
                          optionFilterProp="label"
                          placeholder={
                            referenceFrameCapacity > 0
                              ? `最多再选 ${referenceFrameCapacity} 张`
                              : '已达上限'
                          }
                          disabled={running || referenceFrameCapacity <= 0}
                          onChange={(value) => {
                            const values = value.map(String)
                            setReferenceFrameNodeIds(
                              values
                                .filter((id) => id !== firstFrameNodeId && id !== lastFrameNodeId)
                                .slice(0, referenceFrameCapacity),
                            )
                          }}
                        />
                      </div>
                    )}
                    <div className="canvas-operation-panel-hint canvas-frame-role-hint">
                      未手动指定时，第一张图片作为首帧，第二张作为尾帧，后续作为参考图；建议显式选择以避免顺序变化。
                      当前模型最多使用 {videoFrameMaxImages} 张图片，已显式选择{' '}
                      {Math.min(selectedFrameCount, videoFrameMaxImages)} 张。
                      {operation === 'video_edit'
                        ? ' 可同时选择输入视频节点，并为参考帧指定角色。'
                        : ''}
                    </div>
                  </div>
                )}
              </>
            )}
            {mediaInputs.length > 0 ? (
              <div className="canvas-operation-panel-inputs">
                {mediaInputs.map((n) => {
                  const asset = n.assetId ? snapshot.assets.find((a) => a.id === n.assetId) : null
                  return (
                    <Tooltip key={n.id} title={n.title ?? n.type}>
                      <div className="canvas-operation-panel-input-card">
                        <div className="canvas-operation-panel-input-thumb">
                          {asset ? <AssetThumbnail asset={asset} /> : <Icons.Image size={20} />}
                        </div>
                        <div className="canvas-operation-panel-input-name">
                          {n.title ?? (n.type === 'video' ? '视频' : '图片')}
                        </div>
                        {canEditMediaInputs && (
                          <Button
                            size="small"
                            type="text"
                            icon={<Icons.X size={12} />}
                            aria-label="移除输入"
                            disabled={running}
                            onClick={() =>
                              setSelectedInputNodeIds((prev) => prev.filter((id) => id !== n.id))
                            }
                          />
                        )}
                      </div>
                    </Tooltip>
                  )
                })}
              </div>
            ) : canEditMediaInputs ? (
              <div className="canvas-operation-panel-hint">
                暂无输入媒体。可从上方选择已有图片/视频节点，组节点会自动展开为内部元素。
              </div>
            ) : null}
            {sourceInputNodes.some((item) => item.type === 'group') && (
              <div className="canvas-operation-panel-hint">
                组节点仅作为选择容器，提交任务时会使用组内的图片/视频/文本元素作为真实输入。
              </div>
            )}
            {textInputs.length > 0 && (
              <div className="canvas-operation-panel-text-inputs">
                {textInputs.map((n) => (
                  <div
                    key={n.id}
                    className="canvas-operation-panel-text-input"
                    title={n.title ?? ''}
                  >
                    <span className="canvas-operation-panel-text-input-title">
                      {n.title ?? '文本'}
                    </span>
                    <span className="canvas-operation-panel-text-input-content">
                      {(n.data.text ?? '').slice(0, 80) || '(空)'}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {isTextOperation && (
          <div className="canvas-operation-panel-section canvas-operation-panel-section-runtime">
            <div className="canvas-operation-panel-section-title-row">
              <div className="canvas-operation-panel-section-label">Agent / 文本模型</div>
              <Tag bordered color="blue">
                应用配置
              </Tag>
            </div>
            <div className="canvas-operation-panel-runtime-card">
              <AgentPickerInline
                agents={agents}
                selectedId={selectedAgentId}
                disabled={running || runtimeLoading || agents.length === 0}
                open={openRuntimeMenu === 'agent'}
                onOpenChange={(nextOpen) => setOpenRuntimeMenu(nextOpen ? 'agent' : null)}
                onChange={handleTextAgentChange}
              />
              <ProviderModelPickerInline
                providers={textProviders}
                selectedProviderId={selectedTextProvider?.id ?? ''}
                selectedModelId={selectedTextModelId}
                disabled={running || runtimeLoading || textProviders.length === 0}
                open={openRuntimeMenu === 'model'}
                onOpenChange={(nextOpen) => setOpenRuntimeMenu(nextOpen ? 'model' : null)}
                onChange={handleTextProviderModelChange}
              />
            </div>
            <div className="canvas-operation-panel-runtime-summary">
              <Icons.Bot size={13} />
              <span>{runtimeSummary}</span>
            </div>
          </div>
        )}

        {mediaCapabilityIds.length > 0 && (
          <div className="canvas-operation-panel-section canvas-operation-panel-section-model">
            <div className="canvas-operation-panel-section-label">模型</div>
            <Select
              size="small"
              allowClear
              loading={modelsLoading}
              value={selectedModelKey || undefined}
              placeholder={modelsLoading ? '加载模型目录...' : '自动路由'}
              options={modelOptions}
              onChange={(value) => setSelectedModelKey(value == null ? '' : String(value))}
              disabled={running}
            />
            <div className="canvas-operation-panel-hint">
              {modelsLoading
                ? '正在读取已启用模型...'
                : supportedMediaModels.length > 0
                  ? `当前能力可用 ${supportedMediaModels.length} 个模型${selectedModel ? ` · ${selectedModel.effectiveModelId} · ${selectedModel.invocationMode}` : ''}`
                  : '当前能力暂无已启用模型，可继续使用自动路由或先到 Provider 绑定模型。'}
            </div>
          </div>
        )}

        {/* Prompt 编辑 */}
        <div className="canvas-operation-panel-section canvas-operation-panel-section-prompt">
          <div className="canvas-operation-panel-section-label">提示词</div>
          <Input.TextArea
            className="canvas-operation-panel-prompt-input"
            rows={4}
            value={prompt}
            placeholder={`输入${operationText}的提示词...`}
            onChange={(e) => setPrompt(e.target.value)}
            disabled={running}
          />
        </div>

        {/* 负面提示词（仅图像/视频类） */}
        {(operation.includes('image') || operation.includes('video')) && (
          <div className="canvas-operation-panel-section canvas-operation-panel-section-negative">
            <div className="canvas-operation-panel-section-label">负面提示词（可选）</div>
            <Input.TextArea
              rows={2}
              value={negativePrompt}
              placeholder="不希望出现的内容..."
              onChange={(e) => setNegativePrompt(e.target.value)}
              disabled={running}
            />
          </div>
        )}

        {/* 操作专属参数 */}
        {parameterFields.length > 0 && (
          <div className="canvas-operation-panel-section canvas-operation-panel-section-params">
            <div className="canvas-operation-panel-section-label">模型参数</div>
            <div className="canvas-operation-panel-params">
              {parameterFields.map((field) => (
                <label key={field.name} className="canvas-operation-panel-param">
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
                      disabled={running}
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
                      disabled={running}
                    />
                  ) : (
                    <Input
                      size="small"
                      type={field.type === 'integer' || field.type === 'number' ? 'number' : 'text'}
                      placeholder={field.placeholder}
                      value={modelParamDraft[field.name] ?? ''}
                      onChange={(e) =>
                        setModelParamDraft((prev) =>
                          updateModelParamDraftValue(prev, field.name, e.target.value),
                        )
                      }
                      disabled={running}
                    />
                  )}
                </label>
              ))}
            </div>
          </div>
        )}

        <div className="canvas-operation-panel-section canvas-operation-panel-section-custom">
          <div className="canvas-operation-panel-section-title-row">
            <div className="canvas-operation-panel-section-label">自定义参数</div>
            <Button
              size="small"
              type="text"
              icon={<Icons.Plus size={13} />}
              disabled={running}
              onClick={() => setCustomParams((prev) => [...prev, createCustomParamDraft()])}
            >
              添加
            </Button>
          </div>
          {customParams.length === 0 ? (
            <div className="canvas-operation-panel-hint">
              可添加模型私有参数，例如 seed、negative_prompt、camera_control。
            </div>
          ) : (
            <div className="canvas-operation-panel-custom-params">
              {customParams.map((param) => (
                <div key={param.id} className="canvas-operation-panel-custom-param">
                  <Input
                    size="small"
                    value={param.name}
                    placeholder="字段名"
                    disabled={running}
                    onChange={(event) =>
                      updateCustomParam(setCustomParams, param.id, { name: event.target.value })
                    }
                  />
                  <Select
                    size="small"
                    value={param.type}
                    disabled={running}
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
                      disabled={running}
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
                      disabled={running}
                      onChange={(event) =>
                        updateCustomParam(setCustomParams, param.id, { value: event.target.value })
                      }
                    />
                  )}
                  <Button
                    size="small"
                    type="text"
                    icon={<Icons.Trash size={13} />}
                    aria-label="删除自定义参数"
                    disabled={running}
                    onClick={() =>
                      setCustomParams((prev) => prev.filter((item) => item.id !== param.id))
                    }
                  />
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="canvas-operation-panel-footer">
        <Button
          size="small"
          icon={<Icons.RotateCcw size={13} />}
          disabled={running || outputNodes.length === 0}
          onClick={() => {
            onRetry()
            message.info('已发起重试，将在右侧生成新的产出节点')
          }}
        >
          重试
        </Button>
        <div className="canvas-operation-panel-footer-spacer" />
        <Button
          size="small"
          loading={savingDraft}
          disabled={running || node.data.status === 'running'}
          onClick={() => void handleSaveDraft()}
        >
          保存配置
        </Button>
        <Button size="small" onClick={onClose}>
          取消
        </Button>
        <Button
          size="small"
          type="primary"
          icon={<Icons.Sparkles size={13} />}
          loading={running || node.data.status === 'running'}
          disabled={node.data.status === 'running'}
          onClick={() => void handleRun()}
        >
          {node.data.status === 'running' ? '运行中' : '提交任务'}
        </Button>
      </div>
    </div>
  )
}

function expandOperationInputNodes(
  sourceNodes: CanvasNode[],
  allNodes: CanvasNode[],
): CanvasNode[] {
  const byId = new Map(allNodes.map((item) => [item.id, item]))
  const seen = new Set<string>()
  const result: CanvasNode[] = []
  const push = (item: CanvasNode) => {
    const latest = byId.get(item.id) ?? item
    if (latest.hidden || seen.has(latest.id)) return
    seen.add(latest.id)
    result.push(latest)
  }

  for (const source of sourceNodes) {
    if (source.type !== 'group') {
      push(source)
      continue
    }
    const members = allNodes
      .filter((item) => item.parentNodeId === source.id && !item.hidden)
      .sort((left, right) => {
        const leftX = source.x + left.x
        const rightX = source.x + right.x
        const leftY = source.y + left.y
        const rightY = source.y + right.y
        return leftX - rightX || leftY - rightY || left.zIndex - right.zIndex
      })
    if (members.length === 0) {
      push(source)
      continue
    }
    for (const member of members) push(member)
  }

  return result
}

function isSupportedMediaInputNode(node: CanvasNode, inputTypes: readonly string[]): boolean {
  if (node.type === 'image') return inputTypes.includes('image')
  if (node.type === 'video') return inputTypes.includes('video')
  return false
}

function isTextModelOperation(operation: CanvasOperationType): boolean {
  return (
    operation === 'text_generate' ||
    operation === 'text_rewrite' ||
    operation === 'prompt_optimize'
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

function operationSupportsVideoFrameRoles(operation: CanvasOperationType): boolean {
  return operation === 'image_to_video' || operation === 'video_edit'
}

function videoImageLimitForCapability(
  operation: CanvasOperationType,
  capability: CanvasMediaModelSummary['capabilities'][number] | null,
): number {
  const maxImages = capability?.input?.maxImages
  if (typeof maxImages === 'number' && Number.isFinite(maxImages) && maxImages > 0) {
    return Math.max(1, Math.floor(maxImages))
  }
  if (operation === 'video_edit') return 2
  if (operation === 'image_to_video') return 1
  return 1
}

function buildVideoFrameInputRoles(
  imageNodeIds: string[],
  firstFrameNodeId: string,
  lastFrameNodeId: string,
  referenceFrameNodeIds: string[],
): Record<string, CanvasTaskInputRole> {
  const roles: Record<string, CanvasTaskInputRole> = {}
  const referenceIds = new Set(referenceFrameNodeIds)
  for (const nodeId of imageNodeIds) {
    if (nodeId === firstFrameNodeId) {
      roles[nodeId] = 'first_frame'
      continue
    }
    if (nodeId === lastFrameNodeId) {
      roles[nodeId] = 'last_frame'
      continue
    }
    if (referenceIds.has(nodeId)) roles[nodeId] = 'reference'
  }
  return roles
}

function normalizeVideoFrameNodeIds(
  firstFrameNodeId: string,
  lastFrameNodeId: string,
  referenceFrameNodeIds: string[],
  maxImages: number,
): string[] {
  const result: string[] = []
  const push = (id: string) => {
    if (!id || result.includes(id) || result.length >= maxImages) return
    result.push(id)
  }
  push(firstFrameNodeId)
  push(lastFrameNodeId)
  for (const id of referenceFrameNodeIds) push(id)
  return result
}

function operationStatusLabel(status: CanvasTask['status']): string {
  if (status === 'completed') return '已完成'
  if (status === 'failed') return '失败'
  if (status === 'cancelled') return '已取消'
  if (status === 'running') return '运行中'
  return '待提交'
}

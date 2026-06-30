import { memo, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { Input, Popover, Select, Tag, Tooltip, message } from 'antd'
import { Button } from '@lobehub/ui'
import { Icons } from '../../Icons'
import {
  capabilityForOperation,
  type ManagedAgent,
  type CanvasMediaModelSummary,
  type CanvasMediaTaskInputFile,
  type ProviderProfile,
  type SkillItem,
} from '@spark/protocol'
import { operationLabel } from './canvas.api'
import { getCanvasCapability, nodeOperation } from './canvas.capabilities'
import {
  mergeCanvasOperationPresetNegativePrompt,
  readCanvasOperationPreset,
} from './canvasOperationPresets'
import { AgentPickerInline, ProviderModelPickerInline } from './CanvasAgentModal'
import { CanvasMediaInputThumb } from './CanvasMediaInputThumb'
import {
  CanvasMediaInputPickerModal,
  type MediaInputPickerItem,
} from './CanvasMediaInputPickerModal'
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
  isModelParamCoveredByFields,
  resolveInitialModelParamDraftValue,
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
 * 操作节点编辑面板。
 *
 * 默认定位在底部 dock 上方；双击节点时可切到 inline，作为节点卡片内部扩展区。
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
  skillIds?: string[]
  modelParams?: Record<string, unknown>
}

export type OperationDraftParams = {
  title: string | null
  message: string
  prompt: string
  negativePrompt: string
  modelParams: Record<string, unknown>
  agentId?: string
  providerProfileId?: string
  manifestId?: string
  modelId?: string
  skillIds?: string[]
}

export function buildOperationPanelSnapshotSignature(
  snapshot: CanvasSnapshot,
  nodeId: string,
): string {
  const relatedIds = new Set<string>([nodeId])
  for (const edge of snapshot.edges) {
    if (edge.targetNodeId === nodeId && edge.type === 'used_as_input') {
      relatedIds.add(edge.sourceNodeId)
    }
    if (edge.sourceNodeId === nodeId && edge.type === 'generated') {
      relatedIds.add(edge.targetNodeId)
    }
  }
  const parts = [...relatedIds]
    .sort()
    .map((id) => {
      const node = snapshot.nodes.find((item) => item.id === id)
      return node ? `${id}:${node.updatedAt}` : id
    })
  parts.push(snapshot.project.settings?.negativePrompt ?? '')
  parts.push(snapshot.project.settings?.prompt ?? '')
  const panelNode = snapshot.nodes.find((item) => item.id === nodeId)
  const task = panelNode?.taskId
    ? snapshot.tasks.find((item) => item.id === panelNode.taskId)
    : null
  if (task) {
    parts.push(
      `${task.id}:${task.status}:${task.updatedAt ?? ''}:${task.prompt ?? ''}:${task.negativePrompt ?? ''}`,
    )
  }
  return parts.join('|')
}

export function resolveCanvasOperationPanelNegativePrompt(params: {
  taskNegativePrompt?: string | null | undefined
  nodeNegativePrompt?: string | null | undefined
  sourceNegativePrompts?: Array<string | null | undefined>
  projectNegativePrompt?: string | null | undefined
  operationPresetNegativePrompt?: string | null | undefined
}): string {
  const baseNegativePrompt =
    params.taskNegativePrompt?.trim() ||
    params.nodeNegativePrompt?.trim() ||
    params.sourceNegativePrompts?.map((value) => value?.trim() || '').find((value) => value.length > 0) ||
    params.projectNegativePrompt?.trim() ||
    ''

  return mergeCanvasOperationPresetNegativePrompt(
    baseNegativePrompt,
    params.operationPresetNegativePrompt?.trim() ?? '',
  )
}

export const CanvasOperationPanel = memo(function CanvasOperationPanel({
  node,
  snapshot,
  task,
  placement = 'floating',
  onClose,
  onRun,
  onRetry,
  onSaveDraft,
}: {
  node: CanvasNode
  snapshot: CanvasSnapshot
  /** 关联的 CanvasTask（可能为 null，pending 状态） */
  task?: CanvasTask | null
  placement?: 'floating' | 'inline'
  onClose: () => void
  onRun: (params: OperationRunParams) => Promise<void> | void
  onRetry: () => void
  onSaveDraft: (params: OperationDraftParams) => Promise<void> | void
}) {
  const operation = nodeOperation(node) ?? 'text_generate'
  const capability = getCanvasCapability(operation)
  const operationText = operationLabel(operation)
  const isTextOperation = isTextModelOperation(operation)
  const operationPreset = readCanvasOperationPreset(operation)
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
    const sourceNegativePrompts: string[] = []
    for (const sourceNode of expandedSourceInputNodes) {
      const sourceTask = sourceNode.taskId
        ? snapshot.tasks.find((item) => item.id === sourceNode.taskId)
        : null
      if (sourceTask?.negativePrompt) sourceNegativePrompts.push(sourceTask.negativePrompt)
      if (sourceNode.data.negativePrompt) sourceNegativePrompts.push(sourceNode.data.negativePrompt)
    }
    return resolveCanvasOperationPanelNegativePrompt({
      taskNegativePrompt: task?.negativePrompt,
      nodeNegativePrompt: node.data.negativePrompt,
      sourceNegativePrompts,
      projectNegativePrompt: snapshot.project.settings?.negativePrompt,
      operationPresetNegativePrompt: operationPreset.negativePrompt,
    })
  }, [
    expandedSourceInputNodes,
    node.data.negativePrompt,
    operationPreset.negativePrompt,
    snapshot.project.settings?.negativePrompt,
    snapshot.tasks,
    task?.negativePrompt,
  ])

  // 参数状态：从 task、node.data、项目/上游继承值带入
  const [prompt, setPrompt] = useState(
    task?.prompt ??
      node.data.prompt ??
      operationPreset.prompt ??
      snapshot.project.settings?.prompt ??
      '',
  )
  const [negativePrompt, setNegativePrompt] = useState(inheritedNegativePrompt)
  const [mediaModels, setMediaModels] = useState<CanvasMediaModelSummary[]>([])
  const [modelsLoading, setModelsLoading] = useState(false)
  const [selectedModelKey, setSelectedModelKey] = useState('')
  const [agents, setAgents] = useState<ManagedAgent[]>([])
  const [providers, setProviders] = useState<ProviderProfile[]>([])
  const [skills, setSkills] = useState<SkillItem[]>([])
  const [runtimeLoading, setRuntimeLoading] = useState(false)
  const [selectedAgentId, setSelectedAgentId] = useState(
    task?.agentId ?? node.data.agentId ?? operationPreset.agentId ?? '',
  )
  const [selectedTextProviderId, setSelectedTextProviderId] = useState(
    task?.providerProfileId ??
      node.data.providerProfileId ??
      operationPreset.providerProfileId ??
      '',
  )
  const [selectedTextModelId, setSelectedTextModelId] = useState(
    task?.modelId ?? node.data.modelId ?? operationPreset.modelId ?? '',
  )
  const [selectedSkillIds, setSelectedSkillIds] = useState<string[]>(
    task?.skillIds ?? node.data.skillIds ?? operationPreset.skillIds,
  )
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
  // 提交中态：覆盖「点击 → closePanel 卸载按钮 → 乐观更新前」的反馈空窗，
  // 并用于防重复提交（已 completed 节点重提时也拦得住）。
  const [submitting, setSubmitting] = useState(false)
  const [savingDraft, setSavingDraft] = useState(false)
  const [titleDraft, setTitleDraft] = useState(node.title ?? '')
  const [messageDraft, setMessageDraft] = useState(node.data.message ?? '')
  const [showAllTextInputs, setShowAllTextInputs] = useState(false)
  const [mediaPickerOpen, setMediaPickerOpen] = useState(false)

  useEffect(() => {
    const nextIds = (canEditMediaInputs ? editableSourceMediaNodes : expandedSourceInputNodes).map(
      (item) => item.id,
    )
    setSelectedInputNodeIds((prev) => {
      if (prev.length === nextIds.length && prev.every((id, index) => id === nextIds[index])) {
        return prev
      }
      return nextIds
    })
  }, [canEditMediaInputs, editableSourceMediaNodes, expandedSourceInputNodes])

  useEffect(() => {
    setPrompt(
      task?.prompt ??
        node.data.prompt ??
        operationPreset.prompt ??
        snapshot.project.settings?.prompt ??
        '',
    )
    setNegativePrompt(inheritedNegativePrompt)
    setTitleDraft(node.title ?? '')
    setMessageDraft(node.data.message ?? '')
    setSelectedAgentId(task?.agentId ?? node.data.agentId ?? operationPreset.agentId ?? '')
    setSelectedTextProviderId(
      task?.providerProfileId ??
        node.data.providerProfileId ??
        operationPreset.providerProfileId ??
        '',
    )
    setSelectedTextModelId(task?.modelId ?? node.data.modelId ?? operationPreset.modelId ?? '')
    setSelectedSkillIds(task?.skillIds ?? node.data.skillIds ?? operationPreset.skillIds)
    // 只在切换节点时重载草稿，避免保存后的 snapshot 刷新把用户刚输入的配置重置掉。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [node.id])

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

    const presetAgent =
      operationPreset.agentId != null
        ? agents.find((agent) => agent.id === operationPreset.agentId) ?? null
        : null
    const defaultAgent =
      (task?.agentId ? agents.find((agent) => agent.id === task.agentId) : null) ??
      (node.data.agentId ? agents.find((agent) => agent.id === node.data.agentId) : null) ??
      presetAgent ??
      pickDefaultTextAgent(agents)
    const preferredProviderId =
      task?.providerProfileId ??
      node.data.providerProfileId ??
      operationPreset.providerProfileId ??
      defaultAgent?.providerProfileId
    const defaultProvider = pickDefaultTextProvider(textProviders, preferredProviderId)

    setSelectedAgentId((current) =>
      current && agents.some((agent) => agent.id === current) ? current : defaultAgent?.id || '',
    )
    setSelectedTextProviderId((current) =>
      current && textProviders.some((provider) => provider.id === current)
        ? current
        : defaultProvider?.id || '',
    )
  }, [
    agents,
    isTextOperation,
    node.id,
    node.data.agentId,
    node.data.providerProfileId,
    operationPreset.agentId,
    operationPreset.providerProfileId,
    runtimeLoading,
    task?.agentId,
    task?.providerProfileId,
    textProviders,
  ])

  useEffect(() => {
    if (!isTextOperation || runtimeLoading) return

    const provider = textProviders.find((item) => item.id === selectedTextProviderId) ?? null
    if (!provider) return

    const presetAgent =
      operationPreset.agentId != null
        ? agents.find((agent) => agent.id === operationPreset.agentId) ?? null
        : null
    const defaultAgent =
      (task?.agentId ? agents.find((agent) => agent.id === task.agentId) : null) ??
      (node.data.agentId ? agents.find((agent) => agent.id === node.data.agentId) : null) ??
      presetAgent ??
      pickDefaultTextAgent(agents)

    setSelectedTextModelId((current) => {
      const models = getProviderTextModels(provider)
      if (current && (models.length === 0 || models.includes(current))) return current
      return pickDefaultTextModel(
        provider,
        task?.modelId ?? node.data.modelId ?? operationPreset.modelId ?? defaultAgent?.modelId,
      )
    })
  }, [
    agents,
    isTextOperation,
    node.data.agentId,
    node.data.modelId,
    node.id,
    operationPreset.agentId,
    operationPreset.modelId,
    runtimeLoading,
    selectedTextProviderId,
    task?.agentId,
    task?.modelId,
    textProviders,
  ])

  const runtimeSummary = useMemo(() => {
    if (runtimeLoading) return '正在读取应用 Agent 与 Provider 配置...'
    const skillSummary = selectedSkillIds.length > 0 ? ` · ${selectedSkillIds.length} Skills` : ''
    if (selectedAgent && selectedTextProvider) {
      return `${selectedAgent.name} · ${selectedTextProvider.name}${selectedTextModelId ? ` · ${selectedTextModelId}` : ''}${skillSummary}`
    }
    if (selectedTextProvider) {
      return `${selectedTextProvider.name}${selectedTextModelId ? ` · ${selectedTextModelId}` : ''}${skillSummary}`
    }
    return '未找到可用文本 Provider'
  }, [
    runtimeLoading,
    selectedAgent,
    selectedSkillIds.length,
    selectedTextModelId,
    selectedTextProvider,
  ])
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
        (!(task?.providerProfileId ?? node.data.providerProfileId ?? operationPreset.providerProfileId) ||
          model.providerProfileId ===
            (task?.providerProfileId ??
              node.data.providerProfileId ??
              operationPreset.providerProfileId)) &&
        (!(task?.manifestId ?? node.data.manifestId ?? operationPreset.manifestId) ||
          model.manifestId ===
            (task?.manifestId ?? node.data.manifestId ?? operationPreset.manifestId)) &&
        (!(task?.modelId ?? node.data.modelId ?? operationPreset.modelId) ||
          model.effectiveModelId === (task?.modelId ?? node.data.modelId ?? operationPreset.modelId)),
    )
    setSelectedModelKey(mediaModelKey(fromTask ?? supportedMediaModels[0]!))
  }, [
    selectedModelKey,
    supportedMediaModels,
    node.data.manifestId,
    node.data.modelId,
    node.data.providerProfileId,
    operationPreset.manifestId,
    operationPreset.modelId,
    operationPreset.providerProfileId,
    task?.manifestId,
    task?.modelId,
    task?.providerProfileId,
  ])

  useEffect(() => {
    const defaults = selectedCapability?.defaults ?? {}
    const existing = task?.modelParams ?? node.data.modelParams ?? {}
    const seeded = { ...operationPreset.modelParams, ...existing }
    const next: Record<string, string> = {}
    const fieldNames = new Set(parameterFields.map((field) => field.name))
    for (const field of parameterFields) {
      next[field.name] =
        resolveInitialModelParamDraftValue({
          operation,
          field,
          fieldName: field.name,
          presetParams: operationPreset.modelParams,
          existingParams: existing,
          defaultParams: defaults,
        }) ?? ''
    }
    setModelParamDraft((prev) => {
      const prevKeys = Object.keys(prev)
      const nextKeys = Object.keys(next)
      if (
        prevKeys.length === nextKeys.length &&
        nextKeys.every((key) => prev[key] === next[key])
      ) {
        return prev
      }
      return next
    })
    const nextCustomParams = Object.entries(seeded)
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
      }))
    setCustomParams((prev) => {
      if (
        prev.length === nextCustomParams.length &&
        prev.every(
          (item, index) =>
            item.id === nextCustomParams[index]?.id &&
            item.name === nextCustomParams[index]?.name &&
            item.type === nextCustomParams[index]?.type &&
            item.value === nextCustomParams[index]?.value,
        )
      ) {
        return prev
      }
      return nextCustomParams
    })
  }, [
    node.data.modelParams,
    operationPreset.modelParams,
    parameterFields,
    selectedCapability,
    task?.modelParams,
  ])

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

  const buildRuntimeDraft = useCallback(
    (): Pick<
      OperationDraftParams,
      'agentId' | 'providerProfileId' | 'manifestId' | 'modelId' | 'skillIds'
    > => ({
      ...(isTextOperation && selectedAgentId ? { agentId: selectedAgentId } : {}),
      ...(isTextOperation ? { skillIds: selectedSkillIds } : {}),
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
    }),
    [
      isTextOperation,
      selectedAgentId,
      selectedModel,
      selectedSkillIds,
      selectedTextModelId,
      selectedTextProviderId,
    ],
  )

  const handleSaveDraft = useCallback(async () => {
    if (savingDraft) return
    setSavingDraft(true)
    try {
      const runtimeDraft = buildRuntimeDraft()
      await onSaveDraft({
        title: titleDraft.trim().length > 0 ? titleDraft.trim() : null,
        message: messageDraft.trim(),
        prompt: prompt.trim(),
        negativePrompt: negativePrompt.trim(),
        modelParams: buildCurrentModelParams(),
        ...runtimeDraft,
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
    buildRuntimeDraft,
    messageDraft,
    negativePrompt,
    onSaveDraft,
    prompt,
    savingDraft,
    titleDraft,
  ])

  const handleRun = useCallback(async () => {
    // 防重复提交：本地 running/submitting flag + 节点状态（含已完成节点重提场景）。
    // 旧实现仅拦 running，已完成(completed)节点重提会穿透 → 产生重复任务。
    if (running || submitting || node.data.status === 'running') return
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
      !operationAcceptsTextInput(capability?.inputTypes) &&
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
    setSubmitting(true)
    setRunning(true)
    try {
      await onRun({
        prompt: prompt.trim(),
        ...(negativePrompt.trim() ? { negativePrompt: negativePrompt.trim() } : {}),
        inputNodeIds: runInputNodeIds,
        ...(isTextOperation && selectedAgentId ? { agentId: selectedAgentId } : {}),
        ...(isTextOperation ? { skillIds: selectedSkillIds } : {}),
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
      setSubmitting(false)
    }
  }, [
    canEditMediaInputs,
    capability,
    buildCurrentModelParams,
    buildRuntimeDraft,
    negativePrompt,
    node.data.status,
    onRun,
    prompt,
    selectedModel,
    running,
    submitting,
    selectedSkillIds,
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
  const showMediaStrip = canEditMediaInputs || mediaInputs.length > 0
  const nodeById = useMemo(
    () => new Map(snapshot.nodes.map((item) => [item.id, item])),
    [snapshot.nodes],
  )
  const assetById = useMemo(
    () => new Map(snapshot.assets.map((item) => [item.id, item])),
    [snapshot.assets],
  )
  const composerMediaPickerItems = useMemo<MediaInputPickerItem[]>(() => {
    const options = supportsVideoFrameRoles
      ? mediaInputOptions.filter((option) => option.type === 'video')
      : mediaInputOptions
    return options.map((option) => {
      const sourceNode = nodeById.get(option.value)
      const asset = sourceNode?.assetId ? (assetById.get(sourceNode.assetId) ?? null) : null
      const previewUrl =
        sourceNode?.data.thumbnailUrl ??
        sourceNode?.data.url ??
        asset?.thumbnailUrl ??
        asset?.url ??
        null
      return {
        id: option.value,
        label: option.label,
        type: option.type as 'image' | 'video',
        asset,
        previewUrl,
      }
    })
  }, [assetById, mediaInputOptions, nodeById, supportsVideoFrameRoles])
  const composerMediaPickerSelectedIds = useMemo(() => {
    if (supportsVideoFrameRoles) {
      return selectedInputNodeIds.filter((id) =>
        composerMediaPickerItems.some((item) => item.id === id),
      )
    }
    return selectedInputNodeIds
  }, [composerMediaPickerItems, selectedInputNodeIds, supportsVideoFrameRoles])
  const applyComposerMediaSelection = useCallback(
    (values: string[]) => {
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
    },
    [mediaInputOptions, supportsVideoFrameRoles],
  )
  const textInputs = expandedSourceInputNodes.filter(
    (n) => n.type === 'text' || n.type === 'prompt',
  )
  const visibleTextInputs = showAllTextInputs ? textInputs : textInputs.slice(0, 3)
  const frameLabel = (id: string) =>
    String(frameImageOptions.find((option) => String(option.value) === id)?.label ?? id)
  const renderTextHoverSelector = ({
    label,
    valueText,
    disabled,
    content,
    popoverClassName = 'canvas-operation-text-picker-popover',
  }: {
    label: string
    valueText?: string
    disabled?: boolean
    content: ReactNode
    popoverClassName?: string
  }) => (
    <Popover
      trigger="hover"
      mouseEnterDelay={0.08}
      mouseLeaveDelay={0.45}
      placement="top"
      content={
        <div
          className={popoverClassName}
          onMouseDown={(event) => event.stopPropagation()}
        >
          {content}
        </div>
      }
    >
      <button
        type="button"
        className={`canvas-operation-text-picker${disabled ? ' is-disabled' : ''}`}
        disabled={disabled}
      >
        <span className="canvas-operation-text-picker-label">{label}</span>
        {valueText && <span className="canvas-operation-text-picker-value">{valueText}</span>}
        <Icons.ChevronDown size={12} />
      </button>
    </Popover>
  )
  const renderSingleOptionList = (
    options: Array<{ value: string; label: ReactNode; disabled?: boolean }>,
    selectedValue: string,
    onChange: (value: string) => void,
    emptyText = '自动 / 默认',
  ) => (
    <div className="canvas-operation-text-option-list">
      <button
        type="button"
        className={`canvas-operation-text-option${selectedValue ? '' : ' is-active'}`}
        onMouseDown={(event) => {
          event.preventDefault()
          onChange('')
        }}
      >
        <span>{emptyText}</span>
        {!selectedValue && <Icons.Check size={14} />}
      </button>
      {options.map((option) => {
        const active = option.value === selectedValue
        return (
          <button
            key={option.value}
            type="button"
            className={`canvas-operation-text-option${active ? ' is-active' : ''}`}
            disabled={option.disabled}
            onMouseDown={(event) => {
              event.preventDefault()
              if (!option.disabled) onChange(option.value)
            }}
          >
            <span>{option.label}</span>
            {active && <Icons.Check size={14} />}
          </button>
        )
      })}
    </div>
  )
  const renderMultiOptionList = (
    options: Array<{ value: string; label: ReactNode; disabled?: boolean }>,
    selectedValues: string[],
    onChange: (value: string[]) => void,
    emptyText = '清空选择',
    maxSelected?: number,
  ) => {
    const selectedSet = new Set(selectedValues)
    return (
      <div className="canvas-operation-text-option-list">
        <button
          type="button"
          className="canvas-operation-text-option"
          disabled={selectedValues.length === 0}
          onMouseDown={(event) => {
            event.preventDefault()
            if (selectedValues.length > 0) onChange([])
          }}
        >
          <span>{emptyText}</span>
        </button>
        {options.map((option) => {
          const active = selectedSet.has(option.value)
          const atCapacity =
            maxSelected != null && maxSelected > 0 && selectedValues.length >= maxSelected
          return (
            <button
              key={option.value}
              type="button"
              className={`canvas-operation-text-option${active ? ' is-active' : ''}`}
              disabled={option.disabled || (!active && atCapacity)}
              onMouseDown={(event) => {
                event.preventDefault()
                if (option.disabled || (!active && atCapacity)) return
                onChange(
                  active
                    ? selectedValues.filter((value) => value !== option.value)
                    : [...selectedValues, option.value].slice(0, maxSelected ?? Number.MAX_SAFE_INTEGER),
                )
              }}
            >
              <span>{option.label}</span>
              {active && <Icons.Check size={14} />}
            </button>
          )
        })}
      </div>
    )
  }

  if (placement === 'inline' && !fullscreen) {
    return (
      <div
        className="canvas-operation-panel is-inline is-composer"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div
          className={`canvas-operation-composer-top${showMediaStrip ? '' : ' has-no-media'}`}
        >
          <div className="canvas-operation-composer-title">
            <span>{operationLabel(operation)}</span>
            {statusTag}
            {outputNodes.length > 0 && (
              <Tag color="purple" bordered>
                {outputNodes.length} 产出
              </Tag>
            )}
          </div>
          {showMediaStrip ? (
            <div
              className={`canvas-operation-composer-media-strip${mediaInputs.length === 0 ? ' is-add-only' : ''}`}
            >
              {mediaInputs.map((n) => {
                const asset = n.assetId ? snapshot.assets.find((a) => a.id === n.assetId) : null
                return (
                  <CanvasMediaInputThumb
                    key={n.id}
                    asset={asset ?? null}
                    label={n.title ?? (n.type === 'video' ? '视频' : '图片')}
                    variant="composer"
                    {...(canEditMediaInputs
                      ? {
                          onRemove: () =>
                            setSelectedInputNodeIds((prev) => prev.filter((id) => id !== n.id)),
                        }
                      : {})}
                    {...(running ? { removeDisabled: true } : {})}
                  />
                )
              })}
              {canEditMediaInputs && (
                <>
                  <button
                    type="button"
                    className="canvas-operation-composer-add-media"
                    aria-label="添加输入"
                    disabled={running || composerMediaPickerItems.length === 0}
                    onClick={() => setMediaPickerOpen(true)}
                  >
                    <Icons.Plus size={18} />
                    <span>添加输入</span>
                  </button>
                  <CanvasMediaInputPickerModal
                    open={mediaPickerOpen}
                    title={
                      supportsVideoFrameRoles
                        ? '选择输入视频'
                        : capability?.inputTypes.includes('video')
                          ? '选择输入图片 / 视频'
                          : '选择输入图片'
                    }
                    items={composerMediaPickerItems}
                    selectedIds={composerMediaPickerSelectedIds}
                    onCancel={() => setMediaPickerOpen(false)}
                    onConfirm={(values) => {
                      applyComposerMediaSelection(values)
                      setMediaPickerOpen(false)
                    }}
                  />
                </>
              )}
            </div>
          ) : null}
          <div className="canvas-operation-composer-top-actions">
            <Tooltip title="全屏编辑">
              <Button
                size="small"
                type="text"
                icon={<Icons.Maximize size={15} />}
                aria-label="全屏编辑"
                onClick={() => setFullscreen(true)}
              />
            </Tooltip>
            <Button size="small" type="text" icon={<Icons.X size={15} />} onClick={onClose} />
          </div>
          <div className="canvas-operation-composer-inputs">
            <label className="canvas-operation-composer-mini-field">
              <span>标题</span>
              <Input
                size="small"
                value={titleDraft}
                placeholder={`${operationText}节点`}
                onChange={(event) => setTitleDraft(event.target.value)}
                disabled={running}
              />
            </label>
            <label className="canvas-operation-composer-mini-field is-message">
              <span>备注</span>
              <Input
                size="small"
                value={messageDraft}
                placeholder="节点展示说明"
                onChange={(event) => setMessageDraft(event.target.value)}
                disabled={running}
              />
            </label>
            {visibleTextInputs.map((n) => (
              <Tooltip key={n.id} title={(n.data.text ?? '').slice(0, 240) || '(空)'}>
                <div className="canvas-operation-composer-file">
                  <Icons.File size={13} />
                  <span>{n.title ?? '文本'}</span>
                </div>
              </Tooltip>
            ))}
            {textInputs.length > 3 && (
              <Button size="small" type="text" onClick={() => setShowAllTextInputs((v) => !v)}>
                {showAllTextInputs ? '收起文本' : `+${textInputs.length - 3} 文本`}
              </Button>
            )}
          </div>
        </div>

        <div className="canvas-operation-composer-main">
          <Input.TextArea
            className="canvas-operation-composer-prompt"
            rows={6}
            value={prompt}
            placeholder={`输入${operationText}的提示词...`}
            onChange={(e) => setPrompt(e.target.value)}
            disabled={running}
          />
        </div>

        <div className="canvas-operation-composer-bottom">
          <div className="canvas-operation-composer-params">
            {isTextOperation && (
              <>
                <AgentPickerInline
                  agents={agents}
                  selectedId={selectedAgentId}
                  disabled={running || runtimeLoading || agents.length === 0}
                  open={openRuntimeMenu === 'agent'}
                  openOnHover
                  onOpenChange={(nextOpen) => setOpenRuntimeMenu(nextOpen ? 'agent' : null)}
                  onChange={handleTextAgentChange}
                />
                <ProviderModelPickerInline
                  providers={textProviders}
                  selectedProviderId={selectedTextProvider?.id ?? ''}
                  selectedModelId={selectedTextModelId}
                  disabled={running || runtimeLoading || textProviders.length === 0}
                  open={openRuntimeMenu === 'model'}
                  openOnHover
                  onOpenChange={(nextOpen) => setOpenRuntimeMenu(nextOpen ? 'model' : null)}
                  onChange={handleTextProviderModelChange}
                />
                {renderTextHoverSelector({
                  label: 'Skills',
                  valueText:
                    selectedSkillIds.length > 0 ? `${selectedSkillIds.length} 个` : '未选择',
                  disabled: running || runtimeLoading || skills.length === 0,
                  content: renderMultiOptionList(
                    skills.map((skill) => ({ value: skill.id, label: skill.name })),
                    selectedSkillIds,
                    setSelectedSkillIds,
                    '清空 Skills',
                  ),
                })}
              </>
            )}
            {mediaCapabilityIds.length > 0 && (
              renderTextHoverSelector({
                label: '模型',
                valueText: selectedModel
                  ? `${selectedModel.providerName ?? selectedModel.providerKind} / ${selectedModel.displayName}`
                  : modelsLoading
                    ? '加载中'
                    : '自动路由',
                disabled: running,
                content: renderSingleOptionList(
                  modelOptions.map((option) => ({
                    value: String(option.value),
                    label: option.label,
                  })),
                  selectedModelKey,
                  setSelectedModelKey,
                  modelsLoading ? '加载模型...' : '自动路由',
                ),
              })
            )}
            {supportsVideoFrameRoles && (
              <>
                {renderTextHoverSelector({
                  label: '首帧',
                  valueText: firstFrameNodeId ? frameLabel(firstFrameNodeId) : '未选择',
                  disabled: running,
                  content: renderSingleOptionList(
                    frameImageOptions.map((option) => ({
                      value: String(option.value),
                      label: option.label,
                    })),
                    firstFrameNodeId,
                    (next) => {
                      setFirstFrameNodeId(next)
                      if (next && next === lastFrameNodeId) setLastFrameNodeId('')
                      if (next)
                        setReferenceFrameNodeIds((prev) => prev.filter((id) => id !== next))
                    },
                    '不指定首帧',
                  ),
                })}
                {renderTextHoverSelector({
                  label: '尾帧',
                  valueText: lastFrameNodeId
                    ? frameLabel(lastFrameNodeId)
                    : canUseLastFrame
                      ? '未选择'
                      : '仅 1 张图',
                  disabled: running || !canUseLastFrame,
                  content: renderSingleOptionList(
                    frameImageOptions.map((option) => ({
                      value: String(option.value),
                      label: option.label,
                    })),
                    lastFrameNodeId,
                    (next) => {
                      setLastFrameNodeId(next && next !== firstFrameNodeId ? next : '')
                      if (next)
                        setReferenceFrameNodeIds((prev) => prev.filter((id) => id !== next))
                    },
                    canUseLastFrame ? '不指定尾帧' : '仅 1 张图',
                  ),
                })}
                {videoFrameMaxImages > 2 && (
                  renderTextHoverSelector({
                    label: '参考图',
                    valueText:
                      referenceFrameNodeIds.length > 0
                        ? `${referenceFrameNodeIds.length} 张`
                        : '未选择',
                    disabled: running || referenceFrameCapacity <= 0,
                    content: renderMultiOptionList(
                      frameImageOptions
                        .filter(
                          (option) =>
                            option.value !== firstFrameNodeId && option.value !== lastFrameNodeId,
                        )
                        .map((option) => ({
                          value: String(option.value),
                          label: option.label,
                        })),
                      referenceFrameNodeIds,
                      (values) =>
                        setReferenceFrameNodeIds(
                          values
                            .filter((id) => id !== firstFrameNodeId && id !== lastFrameNodeId)
                            .slice(0, referenceFrameCapacity),
                        ),
                      '清空参考图',
                      referenceFrameCapacity,
                    ),
                  })
                )}
              </>
            )}
            {parameterFields.map((field) => (
              <label key={field.name} className="canvas-operation-composer-param">
                {field.enumValues.length > 0 ? (
                  renderTextHoverSelector({
                    label: field.title,
                    valueText: modelParamDraft[field.name] || '默认',
                    disabled: running,
                    content: renderSingleOptionList(
                      field.enumValues.map((value) => ({ value, label: value })),
                      modelParamDraft[field.name] || '',
                      (value) =>
                        setModelParamDraft((prev) =>
                          updateModelParamDraftValue(prev, field.name, value),
                        ),
                      '默认',
                    ),
                  })
                ) : field.type === 'boolean' ? (
                  renderTextHoverSelector({
                    label: field.title,
                    valueText: modelParamDraft[field.name] || '默认',
                    disabled: running,
                    content: renderSingleOptionList(
                      [
                        { value: 'true', label: 'true' },
                        { value: 'false', label: 'false' },
                      ],
                      modelParamDraft[field.name] || '',
                      (value) =>
                        setModelParamDraft((prev) =>
                          updateModelParamDraftValue(prev, field.name, value),
                        ),
                      '默认',
                    ),
                  })
                ) : (
                  <>
                    <span title={field.description}>{field.title}</span>
                    <Input
                      size="small"
                      type={field.type === 'integer' || field.type === 'number' ? 'number' : 'text'}
                      placeholder={field.placeholder}
                      value={modelParamDraft[field.name] ?? ''}
                      disabled={running}
                      onChange={(e) =>
                        setModelParamDraft((prev) =>
                          updateModelParamDraftValue(prev, field.name, e.target.value),
                        )
                      }
                    />
                  </>
                )}
              </label>
            ))}
            {(operation.includes('image') || operation.includes('video')) && (
              <Popover
                trigger="hover"
                mouseEnterDelay={0.08}
                mouseLeaveDelay={0.45}
                placement="top"
                content={
                  <div className="canvas-operation-composer-popover">
                    <div className="canvas-operation-composer-popover-title">反向提示词</div>
                    <Input.TextArea
                      rows={5}
                      value={negativePrompt}
                      placeholder="不希望出现的内容..."
                      onChange={(e) => setNegativePrompt(e.target.value)}
                      disabled={running}
                    />
                  </div>
                }
              >
                <Button size="small" type={negativePrompt.trim() ? 'primary' : 'default'}>
                  反向提示词
                </Button>
              </Popover>
            )}
            {renderTextHoverSelector({
              label: '自定义参数',
              ...(customParams.length > 0 ? { valueText: `${customParams.length} 项` } : {}),
              disabled: running,
              popoverClassName: 'canvas-operation-composer-popover is-custom',
              content: (
                <>
                  <div className="canvas-operation-composer-popover-title">自定义参数</div>
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
                      <Input
                        size="small"
                        value={param.value}
                        placeholder={param.type === 'json' ? '{"key":"value"}' : '值'}
                        disabled={running}
                        onChange={(event) =>
                          updateCustomParam(setCustomParams, param.id, { value: event.target.value })
                        }
                      />
                      <Button
                        size="small"
                        type="text"
                        icon={<Icons.Trash size={13} />}
                        aria-label="删除自定义参数"
                        disabled={running}
                        onMouseDown={(event) => {
                          event.preventDefault()
                          setCustomParams((prev) => prev.filter((item) => item.id !== param.id))
                        }}
                      />
                    </div>
                  ))}
                  <Button
                    size="small"
                    type="text"
                    icon={<Icons.Plus size={13} />}
                    disabled={running}
                    onMouseDown={(event) => {
                      event.preventDefault()
                      setCustomParams((prev) => [...prev, createCustomParamDraft()])
                    }}
                  >
                    添加自定义参数
                  </Button>
                </>
              ),
            })}
          </div>
          <div className="canvas-operation-composer-actions">
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
            <Button
              size="small"
              loading={savingDraft}
              disabled={running || node.data.status === 'running'}
              onClick={() => void handleSaveDraft()}
            >
              保存
            </Button>
            <Button
              size="small"
              type="primary"
              className="canvas-operation-composer-submit"
              icon={<Icons.Sparkles size={13} />}
              loading={running || submitting || node.data.status === 'running'}
              disabled={running || submitting || node.data.status === 'running'}
              onClick={() => void handleRun()}
            >
              {node.data.status === 'running' ? '运行中' : submitting ? '提交中…' : '提交任务'}
            </Button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div
      className={`canvas-operation-panel${placement === 'inline' ? ' is-inline is-composer' : ''}${fullscreen ? ' is-fullscreen' : ''}`}
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
              <Input
                size="small"
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
              {textInputs.length > 3 && (
                <Button
                  size="small"
                  type="text"
                  onClick={() => setShowAllTextInputs((current) => !current)}
                >
                  {showAllTextInputs ? '收起' : `展开全部 ${textInputs.length} 项`}
                </Button>
              )}
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
                    <CanvasMediaInputThumb
                      key={n.id}
                      asset={asset ?? null}
                      label={n.title ?? (n.type === 'video' ? '视频' : '图片')}
                      variant="panel"
                      {...(canEditMediaInputs
                        ? {
                            onRemove: () =>
                              setSelectedInputNodeIds((prev) => prev.filter((id) => id !== n.id)),
                          }
                        : {})}
                      {...(running ? { removeDisabled: true } : {})}
                    />
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
                {visibleTextInputs.map((n) => (
                  <div
                    key={n.id}
                    className="canvas-operation-panel-text-input"
                    title={n.title ?? ''}
                  >
                    <span className="canvas-operation-panel-text-input-title">
                      {n.title ?? '文本'}
                    </span>
                    <span className="canvas-operation-panel-text-input-content">
                      {showAllTextInputs
                        ? (n.data.text ?? '') || '(空)'
                        : (n.data.text ?? '').slice(0, 80) || '(空)'}
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
                openOnHover
                onOpenChange={(nextOpen) => setOpenRuntimeMenu(nextOpen ? 'agent' : null)}
                onChange={handleTextAgentChange}
              />
              <ProviderModelPickerInline
                providers={textProviders}
                selectedProviderId={selectedTextProvider?.id ?? ''}
                selectedModelId={selectedTextModelId}
                disabled={running || runtimeLoading || textProviders.length === 0}
                open={openRuntimeMenu === 'model'}
                openOnHover
                onOpenChange={(nextOpen) => setOpenRuntimeMenu(nextOpen ? 'model' : null)}
                onChange={handleTextProviderModelChange}
              />
              <Select
                mode="multiple"
                size="small"
                allowClear
                showSearch
                className="canvas-operation-panel-skill-select"
                value={selectedSkillIds}
                placeholder="选择 Skills"
                optionFilterProp="label"
                maxTagCount="responsive"
                options={skills.map((skill) => ({ value: skill.id, label: skill.name }))}
                disabled={running || runtimeLoading || skills.length === 0}
                onChange={(value) => setSelectedSkillIds(value.map(String))}
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
          className="canvas-operation-composer-submit"
          icon={<Icons.Sparkles size={13} />}
          loading={running || submitting || node.data.status === 'running'}
          disabled={running || submitting || node.data.status === 'running'}
          onClick={() => void handleRun()}
        >
          {node.data.status === 'running' ? '运行中' : submitting ? '提交中…' : '提交任务'}
        </Button>
      </div>
    </div>
  )
})

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

function operationSupportsVideoFrameRoles(operation: CanvasOperationType): boolean {
  return operation === 'image_to_video' || operation === 'video_edit'
}

/**
 * 能力是否接受文本输入（text/prompt）。
 * 接受文本输入的操作（如 panorama_360）可在仅有提示词、无图片节点时提交，
 * 不强制要求选择图片/视频节点。
 */
function operationAcceptsTextInput(inputTypes: readonly string[] | undefined): boolean {
  if (!inputTypes) return false
  return inputTypes.includes('text') || inputTypes.includes('prompt')
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
  if (operation === 'video_extend') return 0
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

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
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
import { isProviderVisibleInUi } from '../../utils/auto-router-ui'
import { AgentPickerInline, ProviderModelPickerInline } from './CanvasAgentModal'
import { CanvasOperationParameterControls } from './CanvasOperationParameterControls'
import { CanvasPresetNodeOverrides } from './CanvasPresetNodeOverrides'
import { CanvasPresetTaskCards } from './CanvasPresetTaskCards'
import { canvasApi, operationLabel } from './canvas.api'
import {
  buildCanvasPresetTargetGroups,
  countCanvasPresetOverrides,
} from './canvasPresetCenterModel'
import {
  CANVAS_PRESET_TARGETS,
  formatCanvasOperationPresetModelParams,
  getCanvasPresetTargetDefinition,
  hasCanvasPresetTargetOverride,
  readBuiltinCanvasOperationPreset,
  readCanvasOperationPresetPromptPrefix,
  readCanvasInheritedPresetTarget,
  readCanvasPresetTarget,
  readCanvasPresetTargetOverrides,
  readCanvasResolvedPresetTarget,
  resetCanvasLastUsedPresetTarget,
  resetCanvasPresetTarget,
  writeCanvasPresetTarget,
  type CanvasOperationPreset,
  type CanvasPresetTargetId,
} from './canvasOperationPresets'
import {
  CANVAS_TASK_DEFAULT_KINDS,
  canvasTaskDefaultKindForOperation,
  readCanvasTaskDefault,
  readCanvasTaskDefaults,
  writeCanvasTaskDefault,
  type CanvasTaskDefaultKind,
  type CanvasTaskRuntimeDefault,
} from './canvasTaskDefaults'
import {
  buildCustomModelParams,
  buildModelParams,
  createCustomParamDraft,
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
import { mediaModelKey } from './canvasModelPickerModel'
import {
  mergeSeededModelParamDraft,
  sameCustomParamDrafts,
  sameModelParamDraft,
} from './canvasModelParamDraftState'
import type { CanvasOperationType } from './canvas.types'
import { useCanvasUnsavedChangesGuard } from './useCanvasUnsavedChangesGuard'
import './CanvasPresetCenter.less'

type RuntimePickerMenu = 'agent' | 'model' | null
type PresetCenterMode = 'tasks' | 'nodes'

const INITIAL_TARGET: CanvasPresetTargetId = 'text_generate'
const IMAGE_TASK_CAPABILITY_IDS = new Set<string>(
  [
    'text_to_image',
    'image_to_image',
    'image_edit',
    'image_compose',
    'storyboard_grid',
    'panorama_360',
  ].flatMap((operation) => capabilityForOperation(operation as CanvasOperationType)),
)
const VIDEO_TASK_CAPABILITY_IDS = new Set<string>(
  ['text_to_video', 'image_to_video', 'video_edit', 'video_extend'].flatMap((operation) =>
    capabilityForOperation(operation as CanvasOperationType),
  ),
)

export function CanvasOperationPresetModal({
  open,
  onClose,
  onPresetCountChange,
}: {
  open: boolean
  onClose: () => void
  onPresetCountChange?: (count: number) => void
}) {
  const [activeTargetId, setActiveTargetId] = useState<CanvasPresetTargetId>(INITIAL_TARGET)
  const [viewMode, setViewMode] = useState<PresetCenterMode>('tasks')
  const [drafts, setDrafts] = useState<Record<string, CanvasOperationPreset>>({})
  const [taskDrafts, setTaskDrafts] = useState(readTaskDefaultDrafts)
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
  const modelParamDraftEditedRef = useRef(false)
  const customParamsEditedRef = useRef(false)
  const [nodeFormTouched, setNodeFormTouched] = useState(false)
  const [nodeRuntimeTouched, setNodeRuntimeTouched] = useState(false)
  const baselineDraftsRef = useRef<Record<string, CanvasOperationPreset>>({})
  const [baselineDraftsSignature, setBaselineDraftsSignature] = useState('')
  const [baselineTaskDraftsSignature, setBaselineTaskDraftsSignature] = useState('')

  const activeTarget = useMemo(
    () => getCanvasPresetTargetDefinition(activeTargetId),
    [activeTargetId],
  )
  const activeOperation = activeTarget?.operation ?? 'text_generate'
  const canEditPresetPrompt = activeTarget?.kind === 'pipeline'
  const isTextOperation = useMemo(() => isTextModelOperation(activeOperation), [activeOperation])
  const configuredPresetCount =
    Object.keys(readCanvasPresetTargetOverrides()).length +
    Object.keys(readCanvasTaskDefaults()).length
  const nodeOverrideCount = countCanvasPresetOverrides(
    CANVAS_PRESET_TARGETS.map((target) => target.id),
    hasCanvasPresetTargetOverride,
  )
  const targetGroups = useMemo(() => buildCanvasPresetTargetGroups(CANVAS_PRESET_TARGETS), [])
  const readonlyPromptPrefix = useMemo(
    () => readCanvasOperationPresetPromptPrefix(activeOperation),
    [activeOperation],
  )
  const activeStoredPreset = useMemo(
    () => drafts[activeTargetId] ?? readCanvasResolvedPresetTarget(activeTargetId),
    [activeTargetId, drafts],
  )
  const activePresetOnly = useMemo(() => readCanvasPresetTarget(activeTargetId), [activeTargetId])

  useEffect(() => {
    if (!open) return
    // 打开 modal 时把每个 target 的「当前生效配置」（上次应用 > 已保存预设 > 平台默认）
    // 一起塞进 drafts，保证用户看到的就是新建节点时实际拿到的默认值；
    // 后续保存会重写 preset 并清掉 lastUsed，让预设立即生效。
    const nextDrafts = Object.fromEntries(
      CANVAS_PRESET_TARGETS.map((target) => [target.id, readCanvasResolvedPresetTarget(target.id)]),
    ) as Record<string, CanvasOperationPreset>
    setDrafts(nextDrafts)
    baselineDraftsRef.current = nextDrafts
    setBaselineDraftsSignature(JSON.stringify(nextDrafts))
    const nextTaskDrafts = readTaskDefaultDrafts()
    setTaskDrafts(nextTaskDrafts)
    setBaselineTaskDraftsSignature(JSON.stringify(nextTaskDrafts))
    setViewMode('tasks')
    setActiveTargetId((current) =>
      CANVAS_PRESET_TARGETS.some((target) => target.id === current) ? current : INITIAL_TARGET,
    )
  }, [open])

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
        const nextAgents = (agentRes as { agents?: ManagedAgent[] }).agents ?? []
        const nextProviders = (providerRes as { profiles?: ProviderProfile[] }).profiles ?? []
        setAgents(nextAgents)
        setProviders(nextProviders)
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

  const mediaCapabilityIds = useMemo(
    () => capabilityForOperation(activeOperation),
    [activeOperation],
  )
  const supportedMediaModels = useMemo(() => {
    if (mediaCapabilityIds.length === 0) return []
    return mediaModels.filter((model) =>
      model.capabilities.some((item) =>
        (mediaCapabilityIds as readonly string[]).includes(item.id),
      ),
    )
  }, [mediaCapabilityIds, mediaModels])
  const imageTaskModels = useMemo(
    () =>
      mediaModels.filter((model) =>
        model.capabilities.some((capability) => IMAGE_TASK_CAPABILITY_IDS.has(capability.id)),
      ),
    [mediaModels],
  )
  const videoTaskModels = useMemo(
    () =>
      mediaModels.filter((model) =>
        model.capabilities.some((capability) => VIDEO_TASK_CAPABILITY_IDS.has(capability.id)),
      ),
    [mediaModels],
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
        operationSuggestedFields(activeOperation),
        modelSuggestedFields(selectedModel ?? undefined),
      ),
    [activeOperation, selectedCapability, selectedModel],
  )

  const loadDraftIntoForm = useCallback((draft: CanvasOperationPreset) => {
    modelParamDraftEditedRef.current = false
    customParamsEditedRef.current = false
    setNodeFormTouched(false)
    setNodeRuntimeTouched(false)
    setPrompt(draft.prompt)
    setNegativePrompt(draft.negativePrompt)
    setSelectedAgentId(draft.agentId ?? '')
    setSelectedTextProviderId(draft.providerProfileId ?? '')
    setSelectedTextModelId(draft.modelId ?? '')
    setSelectedSkillIds(draft.skillIds)
    setSelectedModelKey('')
  }, [])

  useEffect(() => {
    if (!open) return
    loadDraftIntoForm(activeStoredPreset)
  }, [activeStoredPreset, loadDraftIntoForm, open])

  useEffect(() => {
    if (!open || !isTextOperation || runtimeLoading) return
    const preferredAgent =
      (activeStoredPreset.agentId
        ? (agents.find((agent) => agent.id === activeStoredPreset.agentId) ?? null)
        : null) ?? pickDefaultTextAgent(agents)
    const preferredProvider = pickDefaultTextProvider(
      textProviders,
      activeStoredPreset.providerProfileId ?? preferredAgent?.providerProfileId,
    )
    setSelectedAgentId((current) =>
      current && agents.some((agent) => agent.id === current)
        ? current
        : (preferredAgent?.id ?? ''),
    )
    setSelectedTextProviderId((current) =>
      current && textProviders.some((provider) => provider.id === current)
        ? current
        : (preferredProvider?.id ?? ''),
    )
    setSelectedTextModelId((current) => {
      if (current && getProviderTextModels(preferredProvider).includes(current)) return current
      return pickDefaultTextModel(
        preferredProvider,
        activeStoredPreset.modelId ?? preferredAgent?.modelId,
      )
    })
  }, [
    activeStoredPreset.agentId,
    activeStoredPreset.modelId,
    activeStoredPreset.providerProfileId,
    agents,
    isTextOperation,
    open,
    runtimeLoading,
    textProviders,
  ])

  useEffect(() => {
    if (!open || isTextOperation) return
    if (supportedMediaModels.length === 0) {
      setSelectedModelKey('')
      return
    }
    const selectedFromDraft = supportedMediaModels.find(
      (model) =>
        (!activeStoredPreset.providerProfileId ||
          model.providerProfileId === activeStoredPreset.providerProfileId) &&
        (!activeStoredPreset.manifestId || model.manifestId === activeStoredPreset.manifestId) &&
        (!activeStoredPreset.modelId || model.effectiveModelId === activeStoredPreset.modelId),
    )
    setSelectedModelKey((current) => {
      if (current && supportedMediaModels.some((model) => mediaModelKey(model) === current)) {
        return current
      }
      return selectedFromDraft ? mediaModelKey(selectedFromDraft) : ''
    })
  }, [
    activeStoredPreset.manifestId,
    activeStoredPreset.modelId,
    activeStoredPreset.providerProfileId,
    isTextOperation,
    open,
    supportedMediaModels,
  ])

  useEffect(() => {
    if (!open) return
    const defaults = selectedCapability?.defaults ?? {}
    const existing = activeStoredPreset.modelParams
    const next: Record<string, string> = {}
    const fieldNames = new Set(parameterFields.map((field) => field.name))
    for (const field of parameterFields) {
      next[field.name] =
        resolveInitialModelParamDraftValue({
          operation: activeOperation,
          field,
          fieldName: field.name,
          presetParams: activeStoredPreset.modelParams,
          existingParams: existing,
          defaultParams: defaults,
        }) ?? ''
    }
    setModelParamDraft((prev) => {
      const candidate = modelParamDraftEditedRef.current
        ? mergeSeededModelParamDraft(prev, next, parameterFields)
        : next
      return sameModelParamDraft(prev, candidate) ? prev : candidate
    })
    setCustomParams((prev) => {
      const nextCustomParams = Object.entries(existing)
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
      if (customParamsEditedRef.current || sameCustomParamDrafts(prev, nextCustomParams)) {
        return prev
      }
      return nextCustomParams
    })
  }, [activeOperation, activeStoredPreset.modelParams, open, parameterFields, selectedCapability])

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

  const buildCurrentDraft = useCallback((): CanvasOperationPreset => {
    const modelParams = buildCurrentModelParams()
    const preservedRuntime = !nodeRuntimeTouched
      ? {
          ...(activeStoredPreset.agentId ? { agentId: activeStoredPreset.agentId } : {}),
          ...(activeStoredPreset.providerProfileId
            ? { providerProfileId: activeStoredPreset.providerProfileId }
            : {}),
          ...(activeStoredPreset.manifestId ? { manifestId: activeStoredPreset.manifestId } : {}),
          ...(activeStoredPreset.modelId ? { modelId: activeStoredPreset.modelId } : {}),
        }
      : {}
    return {
      prompt: canEditPresetPrompt
        ? prompt
        : readBuiltinCanvasOperationPreset(activeOperation).prompt,
      negativePrompt,
      ...preservedRuntime,
      ...(nodeRuntimeTouched && isTextOperation && selectedAgentId
        ? { agentId: selectedAgentId }
        : {}),
      ...(nodeRuntimeTouched && isTextOperation && selectedTextProviderId
        ? { providerProfileId: selectedTextProviderId }
        : nodeRuntimeTouched && selectedModel?.providerProfileId
          ? { providerProfileId: selectedModel.providerProfileId }
          : {}),
      ...(nodeRuntimeTouched && selectedModel?.manifestId
        ? { manifestId: selectedModel.manifestId }
        : {}),
      ...(nodeRuntimeTouched && isTextOperation && selectedTextModelId
        ? { modelId: selectedTextModelId }
        : nodeRuntimeTouched && selectedModel?.effectiveModelId
          ? { modelId: selectedModel.effectiveModelId }
          : {}),
      ...(isTextOperation ? { skillIds: selectedSkillIds } : { skillIds: [] }),
      modelParams,
    }
  }, [
    activeStoredPreset.agentId,
    activeStoredPreset.manifestId,
    activeStoredPreset.modelId,
    activeStoredPreset.providerProfileId,
    activeOperation,
    buildCurrentModelParams,
    canEditPresetPrompt,
    isTextOperation,
    negativePrompt,
    nodeRuntimeTouched,
    prompt,
    selectedAgentId,
    selectedModel,
    selectedSkillIds,
    selectedTextModelId,
    selectedTextProviderId,
  ])

  const composeNextDrafts = useCallback(() => {
    if (viewMode !== 'nodes' || !nodeFormTouched) return drafts
    return {
      ...drafts,
      [activeTargetId]: buildCurrentDraft(),
    }
  }, [activeTargetId, buildCurrentDraft, drafts, nodeFormTouched, viewMode])

  const handleTargetSwitch = useCallback(
    (targetId: CanvasPresetTargetId) => {
      setDrafts(composeNextDrafts())
      setNodeFormTouched(false)
      setNodeRuntimeTouched(false)
      setActiveTargetId(targetId)
    },
    [composeNextDrafts],
  )

  const handleTextAgentChange = useCallback(
    (agentId: string) => {
      const nextAgent = agents.find((agent) => agent.id === agentId)
      if (!nextAgent) return
      setNodeFormTouched(true)
      setNodeRuntimeTouched(true)
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
    setNodeFormTouched(true)
    setNodeRuntimeTouched(true)
    setSelectedTextProviderId(providerId)
    setSelectedTextModelId(modelId)
  }, [])

  const handleModelParamDraftChange = useCallback((fieldName: string, value: string) => {
    setNodeFormTouched(true)
    modelParamDraftEditedRef.current = true
    setModelParamDraft((prev) => updateModelParamDraftValue(prev, fieldName, value))
  }, [])

  const handleCustomParamPatch = useCallback((id: string, patch: Partial<CustomParamDraft>) => {
    setNodeFormTouched(true)
    customParamsEditedRef.current = true
    updateCustomParam(setCustomParams, id, patch)
  }, [])

  const handleAddCustomParam = useCallback(() => {
    setNodeFormTouched(true)
    customParamsEditedRef.current = true
    setCustomParams((prev) => [...prev, createCustomParamDraft()])
  }, [])

  const handleRemoveCustomParam = useCallback((id: string) => {
    setNodeFormTouched(true)
    customParamsEditedRef.current = true
    setCustomParams((prev) => prev.filter((item) => item.id !== id))
  }, [])

  const isDirty =
    JSON.stringify(composeNextDrafts()) !== baselineDraftsSignature ||
    JSON.stringify(taskDrafts) !== baselineTaskDraftsSignature
  const requestClose = useCanvasUnsavedChangesGuard({
    dirty: isDirty,
    onClose,
    subject: '画布默认设置',
  })

  const saveAllPresets = useCallback(async () => {
    setSaving(true)
    try {
      const nextDrafts = composeNextDrafts()
      setDrafts(nextDrafts)
      for (const kind of CANVAS_TASK_DEFAULT_KINDS) {
        writeCanvasTaskDefault(kind, taskDrafts[kind])
      }
      for (const target of CANVAS_PRESET_TARGETS) {
        const next = nextDrafts[target.id] ?? readCanvasPresetTarget(target.id)
        const initial = baselineDraftsRef.current[target.id]
        if (initial && samePreset(next, initial)) {
          resetCanvasLastUsedPresetTarget(target.id)
          continue
        }
        const inherited = readCanvasInheritedPresetTarget(target.id)
        if (samePreset(next, inherited)) {
          resetCanvasPresetTarget(target.id)
        } else {
          writeCanvasPresetTarget(target.id, next)
        }
        // 同步清掉 lastUsed，避免旧值在新建节点时继续覆盖新预设
        // （优先级：lastUsed > preset > builtin）
        resetCanvasLastUsedPresetTarget(target.id)
      }
      const nextCount =
        Object.keys(readCanvasPresetTargetOverrides()).length +
        Object.keys(readCanvasTaskDefaults()).length
      onPresetCountChange?.(nextCount)
      baselineDraftsRef.current = nextDrafts
      setBaselineDraftsSignature(JSON.stringify(nextDrafts))
      setBaselineTaskDraftsSignature(JSON.stringify(taskDrafts))
      message.success('画布默认设置已保存，新建任务会自动使用这套设置')
      onClose()
    } catch (error) {
      message.error(error instanceof Error ? error.message : '保存节点预设失败')
    } finally {
      setSaving(false)
    }
  }, [composeNextDrafts, onClose, onPresetCountChange, taskDrafts])

  useEffect(() => {
    if (!open) return
    const onShortcut = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.key !== 'Enter') return
      event.preventDefault()
      event.stopPropagation()
      void saveAllPresets()
    }
    window.addEventListener('keydown', onShortcut, true)
    return () => window.removeEventListener('keydown', onShortcut, true)
  }, [open, saveAllPresets])

  const resetCurrentPreset = useCallback(async () => {
    setSaving(true)
    try {
      resetCanvasPresetTarget(activeTargetId)
      resetCanvasLastUsedPresetTarget(activeTargetId)
      const nextPreset = readCanvasResolvedPresetTarget(activeTargetId)
      const nextDrafts = { ...composeNextDrafts(), [activeTargetId]: nextPreset }
      setDrafts(nextDrafts)
      baselineDraftsRef.current = nextDrafts
      setBaselineDraftsSignature(JSON.stringify(nextDrafts))
      loadDraftIntoForm(nextPreset)
      const nextCount =
        Object.keys(readCanvasPresetTargetOverrides()).length +
        Object.keys(readCanvasTaskDefaults()).length
      onPresetCountChange?.(nextCount)
      message.success(`${targetLabel(activeTarget)} 已恢复平台默认`)
    } catch (error) {
      message.error(error instanceof Error ? error.message : '恢复默认预设失败')
    } finally {
      setSaving(false)
    }
  }, [activeTarget, activeTargetId, composeNextDrafts, loadDraftIntoForm, onPresetCountChange])

  const runtimeSummary = useMemo(() => {
    if (!isTextOperation) {
      if (modelsLoading) return '正在读取已启用模型...'
      if (selectedModel) {
        return `${selectedModel.providerName ?? selectedModel.providerKind} · ${selectedModel.effectiveModelId}`
      }
      return '未指定固定模型，将沿用预设 / 平台默认配置'
    }
    if (runtimeLoading) return '正在读取应用 Agent / Provider / Skills 配置...'
    const skillSummary = selectedSkillIds.length > 0 ? ` · ${selectedSkillIds.length} Skills` : ''
    if (selectedAgent && selectedTextProvider) {
      return `${selectedAgent.name} · ${selectedTextProvider.name}${selectedTextModelId ? ` · ${selectedTextModelId}` : ''}${skillSummary}`
    }
    if (selectedTextProvider) {
      return `${selectedTextProvider.name}${selectedTextModelId ? ` · ${selectedTextModelId}` : ''}${skillSummary}`
    }
    return '未固定 Agent / Provider，节点将使用平台默认值'
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

  const summaryForTarget = useCallback(
    (target: (typeof CANVAS_PRESET_TARGETS)[number]) => {
      const preset = drafts[target.id] ?? readCanvasResolvedPresetTarget(target.id)
      const agent = preset.agentId ? agents.find((item) => item.id === preset.agentId) : null
      if (agent) return agent.name
      const model = mediaModels.find(
        (item) =>
          (!preset.providerProfileId || item.providerProfileId === preset.providerProfileId) &&
          (!preset.manifestId || item.manifestId === preset.manifestId) &&
          (!preset.modelId || item.effectiveModelId === preset.modelId),
      )
      if (model) return model.displayName
      const provider = preset.providerProfileId
        ? providers.find((item) => item.id === preset.providerProfileId)
        : null
      if (preset.modelId) return provider ? `${provider.name} · ${preset.modelId}` : preset.modelId
      const taskKind = canvasTaskDefaultKindForOperation(target.operation)
      return taskKind ? '继承对应任务默认' : '使用平台默认'
    },
    [agents, drafts, mediaModels, providers],
  )

  // 字段来源：标记当前 resolved 配置里哪些字段来自「已保存预设」 vs 「平台默认」。
  // 用于在 modal 顶部提示用户，预设一旦保存会覆盖 lastUsed，新建节点将按这套预设初始化。
  const presetCoverage = useMemo(() => {
    const preset = activePresetOnly
    const has = (key: keyof CanvasOperationPreset) => {
      const value = preset[key]
      if (key === 'modelParams') {
        return value && typeof value === 'object' && Object.keys(value as object).length > 0
      }
      if (Array.isArray(value)) return value.length > 0
      if (typeof value === 'string') return value.trim().length > 0
      return Boolean(value)
    }
    return {
      hasPrompt: has('prompt'),
      hasNegativePrompt: has('negativePrompt'),
      hasRuntime:
        has('agentId') ||
        has('providerProfileId') ||
        has('modelId') ||
        has('skillIds') ||
        has('manifestId'),
      hasModelParams: has('modelParams'),
    }
  }, [activePresetOnly])

  const advancedParameterContent = (
    <div className="canvas-operation-unified-advanced-extras">
      <label className="canvas-operation-preset-field canvas-operation-unified-advanced-block">
        <span>预置反向提示词</span>
        <Input.TextArea
          value={negativePrompt}
          rows={4}
          placeholder="例如：不要水印、不要额外人物、不要低清晰度"
          onChange={(event) => {
            setNodeFormTouched(true)
            setNegativePrompt(event.target.value)
          }}
        />
      </label>

      <div className="canvas-operation-unified-advanced-block">
        <div className="canvas-operation-preset-section-head canvas-operation-preset-custom-head">
          <div>
            <strong>自定义参数</strong>
            <span>补充 Provider 私有字段</span>
          </div>
          <Button
            size="middle"
            type="text"
            icon={<Icons.Plus size={13} />}
            onClick={handleAddCustomParam}
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
                  size="middle"
                  value={param.name}
                  placeholder="字段名"
                  onChange={(event) =>
                    handleCustomParamPatch(param.id, { name: event.target.value })
                  }
                />
                <Select
                  size="middle"
                  value={param.type}
                  options={[
                    { value: 'string', label: '文本' },
                    { value: 'number', label: '数字' },
                    { value: 'integer', label: '整数' },
                    { value: 'boolean', label: '布尔' },
                    { value: 'json', label: 'JSON' },
                  ]}
                  onChange={(value) =>
                    handleCustomParamPatch(param.id, {
                      type: String(value) as CustomParamType,
                    })
                  }
                />
                {param.type === 'boolean' ? (
                  <Select
                    size="middle"
                    allowClear
                    value={param.value || undefined}
                    placeholder="值"
                    options={[
                      { value: 'true', label: 'true' },
                      { value: 'false', label: 'false' },
                    ]}
                    onChange={(value) =>
                      handleCustomParamPatch(param.id, {
                        value: value == null ? '' : String(value),
                      })
                    }
                  />
                ) : (
                  <Input
                    size="middle"
                    value={param.value}
                    placeholder={param.type === 'json' ? '{"key":"value"}' : '值'}
                    type={param.type === 'integer' || param.type === 'number' ? 'number' : 'text'}
                    onChange={(event) =>
                      handleCustomParamPatch(param.id, { value: event.target.value })
                    }
                  />
                )}
                <Button
                  size="middle"
                  type="text"
                  icon={<Icons.Trash size={13} />}
                  aria-label="删除自定义参数"
                  onClick={() => handleRemoveCustomParam(param.id)}
                />
              </div>
            ))}
          </div>
        )}
      </div>

      <label className="canvas-operation-preset-field canvas-operation-unified-advanced-block">
        <span>当前默认参数预览</span>
        <Input.TextArea
          value={formatCanvasOperationPresetModelParams(buildCurrentModelParams())}
          rows={6}
          readOnly
        />
      </label>
    </div>
  )

  return (
    <Modal
      className="canvas-operation-preset-dialog"
      open={open}
      width={1100}
      destroyOnHidden
      closable={false}
      footer={null}
      centered
      styles={{ body: { padding: 0 } }}
      onCancel={requestClose}
    >
      <div className="canvas-operation-preset-modal-shell">
        <div className="canvas-operation-preset-topbar">
          <div className="canvas-operation-preset-topbar-main">
            <span className="canvas-operation-preset-topbar-kicker">无限画布 · 新任务默认值</span>
            <div className="canvas-operation-preset-topbar-title-row">
              <h2>画布默认设置</h2>
              <Tag color={configuredPresetCount > 0 ? 'gold' : 'default'} bordered>
                {configuredPresetCount > 0 ? `已配置 ${configuredPresetCount}` : '未配置'}
              </Tag>
            </div>
            <p>新建任务会自动使用这些设置，仍可在单个节点里临时修改。</p>
          </div>
          <Button
            size="middle"
            type="text"
            icon={<Icons.X size={15} />}
            aria-label="关闭画布默认设置"
            onClick={requestClose}
          />
        </div>
        <nav className="canvas-preset-mode-tabs" aria-label="默认设置方式">
          <button
            type="button"
            className={viewMode === 'tasks' ? 'is-active' : ''}
            aria-current={viewMode === 'tasks' ? 'page' : undefined}
            onClick={() => {
              if (viewMode === 'nodes') {
                setDrafts(composeNextDrafts())
                setNodeFormTouched(false)
                setNodeRuntimeTouched(false)
              }
              setViewMode('tasks')
            }}
          >
            <Icons.Layers size={14} />
            <span>按任务类型</span>
          </button>
          <button
            type="button"
            className={viewMode === 'nodes' ? 'is-active' : ''}
            aria-current={viewMode === 'nodes' ? 'page' : undefined}
            onClick={() => setViewMode('nodes')}
          >
            <Icons.Grid size={14} />
            <span>按节点覆盖</span>
            {nodeOverrideCount > 0 ? <em>{nodeOverrideCount}</em> : null}
          </button>
        </nav>
        <div className="canvas-operation-preset-scroll">
          {viewMode === 'tasks' ? (
            <main className="canvas-preset-task-page">
              <div className="canvas-preset-page-intro">
                <div>
                  <strong>先设置四类常用任务</strong>
                  <span>没有特殊要求时，完成这里就可以保存。</span>
                </div>
                <span className="canvas-preset-inheritance-note">
                  <Icons.HelpCircle size={13} />
                  节点没有单独设置时，会自动继承这里
                </span>
              </div>
              <CanvasPresetTaskCards
                value={taskDrafts}
                agents={agents}
                providers={providers}
                imageModels={imageTaskModels}
                videoModels={videoTaskModels}
                loading={runtimeLoading || modelsLoading}
                onChange={(kind, value) =>
                  setTaskDrafts((current) => ({ ...current, [kind]: value }))
                }
              />
            </main>
          ) : (
            <div className="canvas-operation-preset-modal canvas-preset-node-page">
              <CanvasPresetNodeOverrides
                groups={targetGroups}
                activeTargetId={activeTargetId}
                hasOverride={hasCanvasPresetTargetOverride}
                labelForTarget={(target) => targetLabel(target)}
                summaryForTarget={summaryForTarget}
                onSelect={handleTargetSwitch}
              />

              <main className="canvas-operation-preset-content">
                <div className="canvas-operation-preset-banner">
                  <div>
                    <h3>{targetLabel(activeTarget)}</h3>
                    <p>
                      只有这个节点功能需要不同的 Agent、模型、提示词或参数时，才在这里单独设置。
                    </p>
                  </div>
                  <span
                    className={`canvas-preset-detail-status${
                      hasCanvasPresetTargetOverride(activeTargetId) ? ' is-override' : ''
                    }`}
                  >
                    {hasCanvasPresetTargetOverride(activeTargetId) ? '已单独设置' : '当前继承默认'}
                  </span>
                </div>

                <section className="canvas-operation-preset-section">
                  <div className="canvas-operation-preset-section-head">
                    <strong>执行方式</strong>
                    <span>Agent、模型与 Skills</span>
                  </div>
                  {isTextOperation ? (
                    <div className="canvas-operation-preset-runtime">
                      <div className="canvas-operation-preset-runtime-pair">
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
                      </div>
                      <Select
                        mode="multiple"
                        size="middle"
                        allowClear
                        showSearch
                        className="canvas-operation-preset-runtime-skill canvas-operation-preset-skill-select"
                        value={selectedSkillIds}
                        placeholder="选择默认 Skills"
                        optionFilterProp="label"
                        maxTagCount="responsive"
                        options={skills.map((skill) => ({ value: skill.id, label: skill.name }))}
                        disabled={runtimeLoading || skills.length === 0}
                        onChange={(value) => {
                          setNodeFormTouched(true)
                          setSelectedSkillIds(value.map(String))
                        }}
                      />
                    </div>
                  ) : null}
                  <div className="canvas-operation-preset-summary">
                    <Icons.Bot size={13} />
                    <span>{runtimeSummary}</span>
                    <div className="canvas-operation-preset-summary-tags">
                      {presetCoverage.hasRuntime ? (
                        <Tag color="blue" bordered>
                          执行方式已设置
                        </Tag>
                      ) : null}
                      {presetCoverage.hasPrompt || presetCoverage.hasNegativePrompt ? (
                        <Tag color="gold" bordered>
                          提示词已设置
                        </Tag>
                      ) : null}
                      {presetCoverage.hasModelParams ? (
                        <Tag color="purple" bordered>
                          参数已设置
                        </Tag>
                      ) : null}
                      {!presetCoverage.hasRuntime &&
                      !presetCoverage.hasPrompt &&
                      !presetCoverage.hasNegativePrompt &&
                      !presetCoverage.hasModelParams ? (
                        <Tag bordered>继承任务默认</Tag>
                      ) : null}
                    </div>
                  </div>
                </section>

                <section className="canvas-operation-preset-section">
                  <div className="canvas-operation-preset-section-head">
                    <strong>节点提示词</strong>
                    <span>只补充这个节点功能需要的要求</span>
                  </div>
                  {readonlyPromptPrefix ? (
                    <label className="canvas-operation-preset-field">
                      <span>系统内置前缀（只读）</span>
                      <Input.TextArea value={readonlyPromptPrefix} rows={5} readOnly />
                    </label>
                  ) : null}
                  <label className="canvas-operation-preset-field">
                    <span>
                      {canEditPresetPrompt
                        ? readonlyPromptPrefix
                          ? '补充提示词'
                          : '预置提示词'
                        : '系统内置能力 Prompt（只读）'}
                    </span>
                    <Input.TextArea
                      value={
                        canEditPresetPrompt
                          ? prompt
                          : readBuiltinCanvasOperationPreset(activeOperation).prompt
                      }
                      rows={5}
                      readOnly={!canEditPresetPrompt}
                      placeholder={
                        readonlyPromptPrefix
                          ? '例如：描述具体场景、主体、氛围和构图要求'
                          : '例如：统一镜头语言、品牌语气、结构要求'
                      }
                      onChange={
                        canEditPresetPrompt
                          ? (event) => {
                              setNodeFormTouched(true)
                              setPrompt(event.target.value)
                            }
                          : undefined
                      }
                    />
                    {!canEditPresetPrompt ? (
                      <span className="canvas-operation-preset-hint">
                        普通节点的自定义 Prompt 请在项目或节点内填写，避免跨项目静默复用。
                      </span>
                    ) : null}
                  </label>
                </section>

                <section className="canvas-operation-preset-section">
                  <div className="canvas-operation-preset-section-head">
                    <div>
                      <strong>生成参数</strong>
                      <span>常用项直接展示，低频项折叠收起</span>
                    </div>
                  </div>
                  <CanvasOperationParameterControls
                    variant="panel"
                    models={supportedMediaModels}
                    modelValue={selectedModelKey}
                    modelLoading={modelsLoading}
                    disabled={saving}
                    showModelPicker={!isTextOperation}
                    allowEmptyModel
                    emptyModelLabel="沿用平台默认"
                    fields={parameterFields}
                    values={modelParamDraft}
                    modelMeta={
                      parameterFields.length === 0 ? (
                        <div className="canvas-operation-preset-hint">
                          当前模型没有可结构化展示的参数表，仍可在高级设置中添加自定义参数。
                        </div>
                      ) : null
                    }
                    advancedContent={advancedParameterContent}
                    onModelChange={(modelKey) => {
                      setNodeFormTouched(true)
                      setNodeRuntimeTouched(true)
                      setSelectedModelKey(modelKey)
                    }}
                    onParameterChange={handleModelParamDraftChange}
                  />
                </section>
              </main>
            </div>
          )}
        </div>
        <div className="canvas-operation-preset-footer">
          <div className="canvas-operation-preset-footer-summary">
            <Icons.HelpCircle size={13} />
            只影响之后新建的任务；已有节点保留自己的设置。
          </div>
          <div className="canvas-operation-preset-footer-actions">
            {viewMode === 'nodes' ? (
              <Button size="middle" loading={saving} onClick={() => void resetCurrentPreset()}>
                恢复继承
              </Button>
            ) : null}
            <Button size="middle" onClick={requestClose}>
              取消
            </Button>
            <Button
              size="middle"
              type="primary"
              loading={saving}
              onClick={() => void saveAllPresets()}
            >
              保存默认设置
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  )
}

function targetLabel(
  target:
    | ReturnType<typeof getCanvasPresetTargetDefinition>
    | (typeof CANVAS_PRESET_TARGETS)[number]
    | null
    | undefined,
): string {
  if (!target) return '未命名节点'
  return target.kind === 'pipeline' ? target.label : operationLabel(target.operation)
}

function readTaskDefaultDrafts(): Record<CanvasTaskDefaultKind, CanvasTaskRuntimeDefault> {
  return Object.fromEntries(
    CANVAS_TASK_DEFAULT_KINDS.map((kind) => [kind, readCanvasTaskDefault(kind)]),
  ) as Record<CanvasTaskDefaultKind, CanvasTaskRuntimeDefault>
}

function samePreset(left: CanvasOperationPreset, right: CanvasOperationPreset): boolean {
  return (
    left.prompt === right.prompt &&
    left.negativePrompt === right.negativePrompt &&
    left.providerProfileId === right.providerProfileId &&
    left.manifestId === right.manifestId &&
    left.modelId === right.modelId &&
    left.agentId === right.agentId &&
    left.skillIds.length === right.skillIds.length &&
    left.skillIds.every((value, index) => value === right.skillIds[index]) &&
    JSON.stringify(left.modelParams) === JSON.stringify(right.modelParams)
  )
}

function isTextModelOperation(operation: CanvasOperationType): boolean {
  return (
    operation === 'text_generate' || operation === 'text_rewrite' || operation === 'prompt_optimize'
  )
}

function isTextProviderProfile(provider: ProviderProfile): boolean {
  return (
    isProviderVisibleInUi(provider) &&
    (provider.modelType == null ||
      provider.modelType === 'text' ||
      provider.modelType === 'multimodal')
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

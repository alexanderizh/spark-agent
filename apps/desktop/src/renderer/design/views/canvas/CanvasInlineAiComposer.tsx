import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from 'react'
import { Button, Checkbox as LobeCheckbox, Input, Tag, Tooltip } from '@lobehub/ui'
import { Icons } from '../../Icons'
import { Select as LobeSelect } from '@lobehub/ui'
import {
  capabilityForOperation,
  capabilitySupportsFrameRoles,
  inferRolePolicy,
  videoImageLimitForCapability,
} from '@spark/protocol'
import type {
  CanvasMediaModelSummary,
  CanvasMediaTaskInputFile,
  ManagedAgent,
  MediaInputRolePolicy,
} from '@spark/protocol'
import {
  CANVAS_AGENT_PRESETS,
  applyShotScriptConfigToPrompt,
  buildAgentPresetPrompt,
  DEFAULT_SHOT_SCRIPT_CONFIG,
  getAgentPreset,
  type CanvasAgentRoleId,
} from './canvasAgentPromptPresets'
import { canvasApi } from './canvas.api'
import { pruneModelParamsForCanvas } from './canvasMediaContract'
import { CANVAS_CAPABILITIES, isCapabilityRecommended } from './canvas.capabilities'
import {
  mergeCanvasOperationPresetNegativePrompt,
  readBuiltinCanvasOperationPreset,
  readCanvasResolvedPresetTarget,
  resolveCanvasPresetTarget,
  writeCanvasLastUsedPresetTarget,
} from './canvasOperationPresets'
import { CanvasPromptEditor } from './CanvasPromptEditor'
import { CanvasMediaInputHint } from './CanvasMediaInputHint'
import { buildReferenceImageInputRoles } from './canvasTaskInputFiles'
import { mediaModelKey } from './canvasModelPickerModel'
import { CanvasModelPicker } from './CanvasModelPicker'
import { CanvasParameterControl } from './CanvasParameterControl'
import { CanvasComposerToolbar } from './CanvasComposerToolbar'
import {
  parameterSummaryValue,
  partitionParameterFields,
  type CanvasParameterControlKind,
  type SchemaField,
} from './canvasParameterPresentation'
import {
  readCanvasComposerAdvancedOpen,
  writeCanvasComposerAdvancedOpen,
} from './canvasComposerPreferences'
import './CanvasInlineAiComposer.less'
import type {
  CanvasInputTransport,
  CanvasNode,
  CanvasOperationType,
  CanvasProjectSettings,
} from './canvas.types'

const COMPOSER_CACHE_KEY = 'spark-canvas:inline-ai-composer:v1'
type CanvasTaskInputRole = NonNullable<CanvasMediaTaskInputFile['role']>
type CanvasTaskInputRoleSelection = CanvasTaskInputRole | CanvasTaskInputRole[]
const EMPTY_MEDIA_INPUT_ROLE_POLICY: MediaInputRolePolicy = { defaultRoleAssignment: 'none' }

export function CanvasInlineAiComposer({
  open,
  selectedNodes,
  allNodes = selectedNodes,
  projectSettings,
  onUploadImage,
  onClose,
  onCreateTask,
}: {
  open: boolean
  selectedNodes: CanvasNode[]
  allNodes?: CanvasNode[]
  projectSettings?: CanvasProjectSettings
  onUploadImage?: () => void
  onClose: () => void
  onCreateTask: (input: {
    operation: CanvasOperationType
    prompt: string
    negativePrompt?: string
    inputNodeIds?: string[]
    providerProfileId?: string
    manifestId?: string
    modelId?: string
    modelParams?: Record<string, unknown>
    inputTransport?: CanvasInputTransport
    inputRoles?: Record<string, CanvasTaskInputRoleSelection>
    /** 文本类操作可指定专属 agent（应用内 agent 管理配置的 ManagedAgent） */
    agentId?: string
    /** Contract V2 裁剪产物：被丢弃的字段及原因，供任务详情展示。 */
    droppedModelParams?: Array<{ name: string; reason: string; valuePreview?: string | undefined }>
    /** Contract V2 裁剪产物：非阻断性提示（如 missing_param_policy、compat_passthrough）。 */
    modelParamWarnings?: Array<{ code: string; message: string }>
  }) => void
}) {
  const [operation, setOperation] = useState<CanvasOperationType>('text_to_image')
  const [prompt, setPrompt] = useState('')
  const [negativePrompt, setNegativePrompt] = useState('')
  const [includeProjectPrompt, setIncludeProjectPrompt] = useState(false)
  const [includeNegativePrompt, setIncludeNegativePrompt] = useState(false)
  const [mediaModels, setMediaModels] = useState<CanvasMediaModelSummary[]>([])
  const [modelsLoading, setModelsLoading] = useState(false)
  const [selectedModelKey, setSelectedModelKey] = useState<string>('')
  const [modelParamDraft, setModelParamDraft] = useState<Record<string, string>>({})
  const [customParams, setCustomParams] = useState<CustomParamDraft[]>([])
  const [inputTransport, setInputTransport] = useState<CanvasInputTransport>('auto')
  const [firstFrameNodeId, setFirstFrameNodeId] = useState<string>('')
  const [lastFrameNodeId, setLastFrameNodeId] = useState<string>('')
  const [referenceFrameNodeIds, setReferenceFrameNodeIds] = useState<string[]>([])
  const [panelPosition, setPanelPosition] = useState<{ x: number; y: number } | null>(null)
  const [fullscreen, setFullscreen] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [advancedOpen, setAdvancedOpen] = useState(readCanvasComposerAdvancedOpen)
  /**
   * 「创建任务」按钮防连击。
   * 用 ref 而非 state：onClick 是纯同步执行（onCreateTask 不返回 Promise），
   * 若用 useState，setState 的重渲染发生在整个同步函数跑完之后，
   * loading/disabled 来不及生效，第二次点击到达时 submitting 仍为 false。
   * ref 在赋值后立即可见，能可靠拦截跨 tick 的重复点击。
   */
  const submittingRef = useRef(false)
  /** 文本类操作可选的专属 agent（应用内 agent 管理） */
  const [agents, setAgents] = useState<ManagedAgent[]>([])
  const [selectedAgentId, setSelectedAgentId] = useState<string>('')
  const panelRef = useRef<HTMLElement | null>(null)
  const lastOpenRef = useRef(false)
  /** 参数草稿兜底 key（operation::model，保留旧行为） */
  const cacheKey = useMemo(
    () => composerCacheKey(operation, selectedModelKey || 'auto'),
    [operation, selectedModelKey],
  )
  /** 按选中节点集合生成的草稿缓存 key；空串表示无选中节点（不缓存） */
  const nodeCacheKey = useMemo(
    () => composeNodeCacheKey(selectedNodes.map((node) => node.id)),
    [selectedNodes],
  )
  /** 防抖自动保存 timer；关窗时 flush */
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  /** 创建任务后置位，阻止本次关窗 flush 把已清除的草稿写回 */
  const suppressFlushRef = useRef(false)
  const projectPrompt = projectSettings?.prompt?.trim() ?? ''
  const projectNegativePrompt = projectSettings?.negativePrompt?.trim() ?? ''

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

  // 加载应用内 agent 列表（供文本类操作指定专属 agent）
  useEffect(() => {
    if (!open) return
    let cancelled = false
    void window.spark
      .invoke('agent:list', { includeDisabled: false })
      .then((res) => {
        if (!cancelled) setAgents((res as { agents?: ManagedAgent[] }).agents ?? [])
      })
      .catch(() => {
        if (!cancelled) setAgents([])
      })
    return () => {
      cancelled = true
    }
  }, [open])

  const nodePromptContext = useMemo(() => buildPromptContext(selectedNodes), [selectedNodes])
  const selectedImageNodes = useMemo(
    () => selectedNodes.filter((node) => node.type === 'image' && Boolean(node.data.url)),
    [selectedNodes],
  )
  const canvasImageNodes = useMemo(
    () =>
      allNodes
        .filter((node) => node.type === 'image' && !node.hidden && Boolean(node.data.url))
        .sort((left, right) => left.x - right.x || left.y - right.y || left.zIndex - right.zIndex),
    [allNodes],
  )
  const frameCandidateImageNodes = useMemo(
    () => (canvasImageNodes.length > 0 ? canvasImageNodes : selectedImageNodes),
    [canvasImageNodes, selectedImageNodes],
  )

  const selectedSummary = useMemo(() => {
    if (selectedNodes.length === 0) return '未选择节点'
    const counts = selectedNodes.reduce<Record<string, number>>((acc, node) => {
      acc[node.type] = (acc[node.type] ?? 0) + 1
      return acc
    }, {})
    return Object.entries(counts)
      .map(([type, count]) => `${type} ${count}`)
      .join(' / ')
  }, [selectedNodes])

  const capabilities = useMemo(
    () =>
      CANVAS_CAPABILITIES.map((capability) => ({
        ...capability,
        recommended: isCapabilityRecommended(capability, selectedNodes),
      })),
    [selectedNodes],
  )
  const creativeActions = useMemo(() => {
    const recommended = capabilities.filter((capability) => capability.recommended)
    return (recommended.length > 0 ? recommended : capabilities).slice(0, 6)
  }, [capabilities])

  useEffect(() => {
    if (!open) {
      lastOpenRef.current = false
      return
    }
    if (lastOpenRef.current) return
    lastOpenRef.current = true
    // 有缓存优先恢复全部字段；否则按现状自动填充 operation + 节点 prompt 上下文
    const draft = readComposerDraft(nodeCacheKey)
    if (draft) {
      setOperation(draft.operation)
      setPrompt(draft.prompt)
      setNegativePrompt(draft.negativePrompt)
      setIncludeProjectPrompt(draft.includeProjectPrompt)
      setIncludeNegativePrompt(draft.includeNegativePrompt)
      if (draft.modelKey && draft.modelKey !== 'auto') setSelectedModelKey(draft.modelKey)
      setCustomParams(draft.customParams)
      setInputTransport(draft.inputTransport)
      setFirstFrameNodeId(draft.firstFrameNodeId)
      setLastFrameNodeId(draft.lastFrameNodeId)
      setReferenceFrameNodeIds(draft.referenceFrameNodeIds)
      // modelParamDraft 由下方 cacheKey effect 合并 capability defaults 恢复
      return
    }
    const recommended = capabilities.find((capability) => capability.recommended)
    const nextOperation = recommended?.operation ?? operation
    const nextPreset = readCanvasResolvedPresetTarget(
      resolveCanvasPresetTarget({ operation: nextOperation }),
    )
    if (recommended) setOperation(recommended.operation)
    setPrompt(nodePromptContext)
    setNegativePrompt(mergeCanvasOperationPresetNegativePrompt('', nextPreset.negativePrompt))
  }, [capabilities, nodePromptContext, open, nodeCacheKey])

  const mediaCapabilityIds = useMemo(() => capabilityForOperation(operation), [operation])
  /** 当前 operation 对应的「节点预设」resolved 值（lastUsed > preset > builtin），
   *  用来补齐 InlineAiComposer UI 没暴露的字段（如 skillIds），写入 lastUsed 时不丢失。 */
  const resolvedPreset = useMemo(
    () => readCanvasResolvedPresetTarget(resolveCanvasPresetTarget({ operation })),
    [operation],
  )
  const resolvedPresetSkillIds = useMemo(() => resolvedPreset.skillIds ?? [], [resolvedPreset])
  /** 文本类操作（剧本/分镜/导演/动作 等专属 agent 适用）：走真实文本模型，可指定 agent */
  const isTextOperation =
    operation === 'text_generate' || operation === 'text_rewrite' || operation === 'prompt_optimize'
  const supportedMediaModels = useMemo(() => {
    if (mediaCapabilityIds.length === 0) return []
    return mediaModels.filter((model) =>
      model.capabilities.some((capability) =>
        (mediaCapabilityIds as readonly string[]).includes(capability.id),
      ),
    )
  }, [mediaCapabilityIds, mediaModels])
  const selectedModel = useMemo(
    () => supportedMediaModels.find((model) => mediaModelKey(model) === selectedModelKey),
    [selectedModelKey, supportedMediaModels],
  )
  const selectedCapability = useMemo(() => {
    if (!selectedModel) return null
    return (
      selectedModel.capabilities.find((capability) =>
        (mediaCapabilityIds as readonly string[]).includes(capability.id),
      ) ?? null
    )
  }, [mediaCapabilityIds, selectedModel])
  const supportsVideoFrameRoles = useMemo(
    () =>
      (selectedCapability ? capabilitySupportsFrameRoles(selectedCapability) : false) &&
      frameCandidateImageNodes.length > 0,
    [frameCandidateImageNodes.length, selectedCapability],
  )
  const videoFrameMaxImages = useMemo(
    () => videoImageLimitForCapability(operation, selectedCapability),
    [operation, selectedCapability],
  )
  const canUseLastFrame = supportsVideoFrameRoles && videoFrameMaxImages > 1
  const selectedFrameCount =
    (firstFrameNodeId ? 1 : 0) + (lastFrameNodeId ? 1 : 0) + referenceFrameNodeIds.length
  const selectedCapabilityRolePolicy = useMemo(
    () =>
      selectedCapability ? inferRolePolicy(selectedCapability) : EMPTY_MEDIA_INPUT_ROLE_POLICY,
    [selectedCapability],
  )
  const frameImageOptions = useMemo(
    () =>
      frameCandidateImageNodes.map((node, index) => ({
        value: node.id,
        title: frameNodeLabelText(
          node,
          index,
          selectedImageNodes.some((item) => item.id === node.id),
        ),
        label: renderFrameNodeOptionLabel(
          node,
          frameNodeLabelText(
            node,
            index,
            selectedImageNodes.some((item) => item.id === node.id),
          ),
        ),
      })),
    [frameCandidateImageNodes, selectedImageNodes],
  )
  const hasExplicitFrameInput =
    supportsVideoFrameRoles &&
    Boolean(firstFrameNodeId || lastFrameNodeId || referenceFrameNodeIds.length > 0)
  const needsImageInput = useMemo(
    () =>
      operationNeedsImageInput(operation) &&
      (selectedNodes.some((node) => node.type === 'image') || hasExplicitFrameInput),
    [hasExplicitFrameInput, operation, selectedNodes],
  )
  const canSubmit =
    prompt.trim().length > 0 ||
    nodePromptContext.length > 0 ||
    negativePrompt.trim().length > 0 ||
    (includeProjectPrompt && projectPrompt.length > 0) ||
    canRunFromInputOnly(operation, selectedNodes) ||
    hasExplicitFrameInput
  const parameterFields = useMemo(
    () =>
      mergeSchemaFields(
        schemaFields(selectedCapability?.paramSchema ?? {}),
        operationSuggestedFields(operation),
        modelSuggestedFields(selectedModel),
      ),
    [operation, selectedCapability, selectedModel],
  )
  const parameterPartition = useMemo(
    () => partitionParameterFields(parameterFields),
    [parameterFields],
  )

  useEffect(() => {
    const defaults = selectedCapability?.defaults ?? {}
    // operation 级默认（如全景图 2:1 / 2k），优先级低于 capability.defaults
    const opDefaults = operationDefaultModelParams(operation)
    // 节点持久化的默认参数（如角色身份板默认 16:9），优先级低于用户草稿、高于 capability/op 默认
    const nodeDefaults = nodeDefaultModelParams(selectedNodes, parameterFields)
    // 参数草稿优先级：node draft（按选中节点）> 旧 entry（operation::model）> 节点持久化默认 > capability defaults > operation defaults > ''
    const nodeDraft = readComposerDraft(nodeCacheKey)
    const legacy = readComposerCacheEntry(cacheKey)
    const paramSource = nodeDraft?.modelParamDraft ?? legacy?.modelParamDraft ?? {}
    setModelParamDraft(() => {
      const next: Record<string, string> = {}
      const mergedDefaults = { ...opDefaults, ...defaults }
      for (const field of parameterFields) {
        const cachedValue = readModelParamDraftValue(paramSource, field.name)
        next[field.name] =
          cachedValue ??
          resolveInitialModelParamDraftValue({
            operation,
            field,
            fieldName: field.name,
            presetParams: opDefaults,
            existingParams: nodeDefaults,
            defaultParams: mergedDefaults,
          })
      }
      return next
    })
    // 仅当无 node draft（未走上升沿全量恢复）时，才用旧 entry 兜底 customParams/inputTransport
    if (!nodeDraft) {
      setCustomParams(legacy?.customParams ?? [])
      if (legacy?.inputTransport) setInputTransport(legacy.inputTransport)
    }
  }, [cacheKey, nodeCacheKey, operation, parameterFields, selectedCapability, selectedNodes])

  useEffect(() => {
    if (supportedMediaModels.length === 0) {
      setSelectedModelKey('')
      return
    }
    if (!supportedMediaModels.some((model) => mediaModelKey(model) === selectedModelKey)) {
      const cachedModelKey = readLastModelKey(operation)
      const cachedModel = supportedMediaModels.find(
        (model) => mediaModelKey(model) === cachedModelKey,
      )
      const firstModel = cachedModel ?? supportedMediaModels[0]
      if (firstModel) setSelectedModelKey(mediaModelKey(firstModel))
    }
  }, [operation, selectedModelKey, supportedMediaModels])

  useEffect(() => {
    if (!open) setCustomParams([])
  }, [open])

  useEffect(() => {
    if (!supportsVideoFrameRoles) {
      setFirstFrameNodeId('')
      setLastFrameNodeId('')
      setReferenceFrameNodeIds([])
      return
    }
    const candidateIds = new Set(frameCandidateImageNodes.map((node) => node.id))
    const selectedImageIds = new Set(selectedImageNodes.map((node) => node.id))
    const preferredNodes =
      selectedImageNodes.length > 0 ? selectedImageNodes : frameCandidateImageNodes
    setFirstFrameNodeId((prev) =>
      prev &&
      candidateIds.has(prev) &&
      (selectedImageNodes.length === 0 || selectedImageIds.has(prev))
        ? prev
        : (preferredNodes[0]?.id ?? ''),
    )
    setLastFrameNodeId((prev) =>
      videoFrameMaxImages > 1 && prev && candidateIds.has(prev)
        ? prev
        : videoFrameMaxImages > 1
          ? (preferredNodes[1]?.id ?? '')
          : '',
    )
    setReferenceFrameNodeIds((prev) => prev.filter((id) => candidateIds.has(id)))
  }, [frameCandidateImageNodes, selectedImageNodes, supportsVideoFrameRoles, videoFrameMaxImages])

  // 防抖自动保存：弹窗打开期间，任意字段变化 → 400ms 后写入本节点集合的草稿。
  // 任务创建前持续缓存；关闭弹窗时立即 flush（见下一个 effect）。
  useEffect(() => {
    if (!open || !nodeCacheKey) return
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(() => {
      writeComposerDraft(nodeCacheKey, {
        operation,
        modelKey: selectedModelKey || 'auto',
        prompt,
        negativePrompt,
        includeProjectPrompt,
        includeNegativePrompt,
        modelParamDraft: pickDraftForFields(parameterFields, modelParamDraft),
        customParams: customParams.filter((param) => param.name.trim() || param.value.trim()),
        inputTransport,
        firstFrameNodeId,
        lastFrameNodeId,
        referenceFrameNodeIds,
      })
      saveTimerRef.current = null
    }, 400)
    return () => {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current)
        saveTimerRef.current = null
      }
    }
  }, [
    open,
    nodeCacheKey,
    operation,
    selectedModelKey,
    prompt,
    negativePrompt,
    includeProjectPrompt,
    includeNegativePrompt,
    modelParamDraft,
    customParams,
    inputTransport,
    firstFrameNodeId,
    lastFrameNodeId,
    referenceFrameNodeIds,
    parameterFields,
  ])

  // 关闭弹窗时 flush 最后一次草稿，保证关窗前最后输入不丢。
  useEffect(() => {
    if (open) return
    if (!nodeCacheKey) return
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current)
      saveTimerRef.current = null
    }
    // 创建任务后已主动清除草稿，跳过本次 flush 并复位标志
    if (suppressFlushRef.current) {
      suppressFlushRef.current = false
      return
    }
    // 仅当确实有待缓存内容时写入（避免空状态覆盖已存在草稿）
    const hasContent =
      prompt.trim() ||
      negativePrompt.trim() ||
      operation ||
      selectedModelKey ||
      customParams.length > 0 ||
      firstFrameNodeId ||
      lastFrameNodeId ||
      referenceFrameNodeIds.length > 0
    if (!hasContent) return
    writeComposerDraft(nodeCacheKey, {
      operation,
      modelKey: selectedModelKey || 'auto',
      prompt,
      negativePrompt,
      includeProjectPrompt,
      includeNegativePrompt,
      modelParamDraft: pickDraftForFields(parameterFields, modelParamDraft),
      customParams: customParams.filter((param) => param.name.trim() || param.value.trim()),
      inputTransport,
      firstFrameNodeId,
      lastFrameNodeId,
      referenceFrameNodeIds,
    })
  }, [
    open,
    nodeCacheKey,
    operation,
    selectedModelKey,
    prompt,
    negativePrompt,
    includeProjectPrompt,
    includeNegativePrompt,
    modelParamDraft,
    customParams,
    inputTransport,
    firstFrameNodeId,
    lastFrameNodeId,
    referenceFrameNodeIds,
    parameterFields,
  ])

  const handleDragStart = useCallback((event: React.PointerEvent<HTMLElement>) => {
    const target = event.target as HTMLElement
    if (target.closest('button,input,textarea,.ant-select,.ant-tag,.canvas-prompt-editor')) return
    const panel = panelRef.current
    if (!panel) return
    const parent = panel.offsetParent instanceof HTMLElement ? panel.offsetParent : null
    const parentRect = parent?.getBoundingClientRect() ?? {
      left: 0,
      top: 0,
      width: window.innerWidth,
      height: window.innerHeight,
    }
    const panelRect = panel.getBoundingClientRect()
    const offsetX = event.clientX - panelRect.left
    const offsetY = event.clientY - panelRect.top
    const maxX = Math.max(8, parentRect.width - panelRect.width - 8)
    const maxY = Math.max(8, parentRect.height - panelRect.height - 8)
    const move = (moveEvent: PointerEvent) => {
      const nextX = Math.min(Math.max(8, moveEvent.clientX - parentRect.left - offsetX), maxX)
      const nextY = Math.min(Math.max(8, moveEvent.clientY - parentRect.top - offsetY), maxY)
      setPanelPosition({ x: nextX, y: nextY })
    }
    const stop = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', stop)
    }
    setPanelPosition({
      x: Math.min(Math.max(8, panelRect.left - parentRect.left), maxX),
      y: Math.min(Math.max(8, panelRect.top - parentRect.top), maxY),
    })
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', stop)
    event.preventDefault()
  }, [])

  /**
   * 套用内置角色预设：把写好的提示词（含上游内容）填入提示词框，切到该角色默认操作，
   * 并在未指定 agent 时尝试自动匹配同名的应用内 agent。
   */
  const applyAgentPreset = useCallback(
    (role: CanvasAgentRoleId) => {
      const preset = getAgentPreset(role)
      if (!preset) return
      setOperation(preset.defaultOperation)
      const presetPrompt = buildAgentPresetPrompt(role, { upstreamText: nodePromptContext })
      // 分镜角色：把 {maxClip} 占位槽用默认值填好（内联编辑器不走结构化配置），
      // 避免文本框里出现字面 {maxClip}。
      setPrompt(
        role === 'storyboard'
          ? applyShotScriptConfigToPrompt(presetPrompt, DEFAULT_SHOT_SCRIPT_CONFIG)
          : presetPrompt,
      )
      if (!selectedAgentId) {
        const match = agents.find(
          (agent) =>
            agent.name.includes(preset.label.replace(/\s*agent$/i, '').trim()) ||
            (agent.description ?? '').includes(preset.label),
        )
        if (match) setSelectedAgentId(match.id)
      }
    },
    [agents, nodePromptContext, selectedAgentId],
  )

  const handleAdvancedToggle = () => {
    const next = !advancedOpen
    setAdvancedOpen(next)
    writeCanvasComposerAdvancedOpen(next)
  }

  const focusParameterControl = (fieldName: string) => {
    const controls = panelRef.current?.querySelectorAll<HTMLElement>('[data-parameter-name]')
    const target = controls
      ? Array.from(controls).find((item) => item.dataset.parameterName === fieldName)
      : undefined
    target?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' })
    target
      ?.querySelector<HTMLElement>('button, input, [role="switch"], .ant-select-selector')
      ?.focus()
  }

  const handleSubmit = async () => {
    // 防连点：ref 同步置位，拦住渲染未完成前的重复点击。
    if (submittingRef.current) return
    submittingRef.current = true
    setSubmitting(true)
    try {
      const rawModelParams = normalizeModelParamsForSubmit(
        {
          ...buildModelParams(parameterFields, modelParamDraft),
          ...buildCustomModelParams(customParams),
        },
        selectedCapability?.defaults ?? {},
        parameterFields,
      )
      // Contract V2 裁剪：按目标 manifest 在提交前过滤 unsupported/forbidden 字段，
      // 避免 provider 400。manifest 缺省时 pruneModelParamsForCanvas 直接返回原值。
      const pruned = await pruneModelParamsForCanvas({
        operation,
        ...(selectedModel?.manifestId ? { manifestId: selectedModel.manifestId } : {}),
        ...(selectedModel?.providerProfileId
          ? { providerProfileId: selectedModel.providerProfileId }
          : {}),
        modelParams: rawModelParams,
      })
      const modelParams = pruned.modelParams
      const effectivePrompt = mergeProjectPrompt(
        prompt.trim() || fallbackPromptForOperation(operation),
        includeProjectPrompt ? projectPrompt : '',
      )
      const effectiveNegativePrompt = mergeNegativePrompt(
        negativePrompt,
        includeNegativePrompt ? projectNegativePrompt : '',
      )
      const effectiveInputTransport =
        inputTransport === 'auto'
          ? selectedModel?.providerKind === 'xai'
            ? 'base64'
            : 'cloud_url'
          : inputTransport
      const videoFrameNodeIds = supportsVideoFrameRoles
        ? normalizeVideoFrameNodeIds(firstFrameNodeId, lastFrameNodeId, referenceFrameNodeIds)
        : []
      const inputRoles = supportsVideoFrameRoles
        ? buildVideoFrameInputRoles(
            videoFrameNodeIds,
            firstFrameNodeId,
            lastFrameNodeId,
            referenceFrameNodeIds,
          )
        : selectedCapabilityRolePolicy.imageRoles?.includes('reference_image')
          ? buildReferenceImageInputRoles(selectedImageNodes.map((node) => node.id))
          : undefined
      const inputNodeIds = supportsVideoFrameRoles
        ? buildTaskInputNodeIds(selectedNodes, videoFrameNodeIds)
        : undefined
      const payload: {
        operation: CanvasOperationType
        prompt: string
        negativePrompt?: string
        inputNodeIds?: string[]
        providerProfileId?: string
        manifestId?: string
        modelId?: string
        modelParams?: Record<string, unknown>
        inputTransport?: CanvasInputTransport
        inputRoles?: Record<string, CanvasTaskInputRoleSelection>
        agentId?: string
        droppedModelParams?: Array<{ name: string; reason: string; valuePreview?: string }>
        modelParamWarnings?: Array<{ code: string; message: string }>
      } = {
        operation,
        prompt: effectivePrompt,
      }
      if (isTextOperation && selectedAgentId) payload.agentId = selectedAgentId
      if (effectiveNegativePrompt) payload.negativePrompt = effectiveNegativePrompt
      if (selectedModel?.providerProfileId)
        payload.providerProfileId = selectedModel.providerProfileId
      if (selectedModel?.manifestId) payload.manifestId = selectedModel.manifestId
      if (selectedModel?.effectiveModelId) payload.modelId = selectedModel.effectiveModelId
      if (Object.keys(modelParams).length > 0) payload.modelParams = modelParams
      if (needsImageInput) payload.inputTransport = effectiveInputTransport
      if (inputNodeIds && inputNodeIds.length > 0) payload.inputNodeIds = inputNodeIds
      if (inputRoles && Object.keys(inputRoles).length > 0) payload.inputRoles = inputRoles
      if (pruned.droppedParams.length > 0) {
        payload.droppedModelParams = pruned.droppedParams.map((d) => ({
          name: d.name,
          reason: d.reason,
          ...(d.valuePreview != null ? { valuePreview: d.valuePreview } : {}),
        }))
      }
      if (pruned.warnings.length > 0) {
        payload.modelParamWarnings = pruned.warnings.map((w) => ({
          code: w.code,
          message: w.message,
        }))
      }
      // 任务创建：保留跨节点模型偏好，清除本节点集合的草稿缓存
      if (selectedModelKey) writeLastModelKey(operation, selectedModelKey)
      writeCanvasLastUsedPresetTarget(resolveCanvasPresetTarget({ operation }), {
        ...(prompt.trim() ? { prompt } : {}),
        negativePrompt,
        ...(selectedModel?.providerProfileId
          ? { providerProfileId: selectedModel.providerProfileId }
          : {}),
        ...(selectedModel?.manifestId ? { manifestId: selectedModel.manifestId } : {}),
        ...(selectedModel?.effectiveModelId ? { modelId: selectedModel.effectiveModelId } : {}),
        ...(selectedAgentId ? { agentId: selectedAgentId } : {}),
        // 新节点没在 InlineAiComposer 里选 skills，但 preset 里可能已经预设了；
        // 这里把 preset 默认值一起写进 lastUsed，避免后续新建节点拿不到 skill 覆盖。
        ...(resolvedPresetSkillIds.length > 0 ? { skillIds: resolvedPresetSkillIds } : {}),
        ...(Object.keys(modelParams).length > 0 ? { modelParams } : {}),
      })
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current)
        saveTimerRef.current = null
      }
      clearComposerDraft(nodeCacheKey)
      // 阻止本次关窗 flush 把已清除的草稿写回
      suppressFlushRef.current = true
      onCreateTask(payload)
      setPrompt('')
      setNegativePrompt('')
    } finally {
      submittingRef.current = false
      setSubmitting(false)
    }
  }

  const composerSummaries = [
    ...(mediaCapabilityIds.length > 0
      ? [
          {
            key: 'model',
            label: '模型',
            value: selectedModel?.displayName ?? '未选择模型',
            icon: <Icons.Sparkles size={14} />,
            onClick: () => {
              const trigger =
                panelRef.current?.querySelector<HTMLButtonElement>('[aria-label="选择模型"]')
              trigger?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' })
              trigger?.click()
            },
          },
        ]
      : []),
    ...parameterPartition.common.map((presentation) => ({
      key: presentation.field.name,
      label: presentation.label,
      value: parameterSummaryValue(presentation, modelParamDraft[presentation.field.name] ?? ''),
      icon: parameterSummaryIcon(presentation.control),
      onClick: () => focusParameterControl(presentation.field.name),
    })),
  ]

  if (!open) return null

  return (
    <section
      ref={panelRef}
      className={`canvas-inline-ai-composer${fullscreen ? ' is-fullscreen' : ''}`}
      style={
        !fullscreen && panelPosition
          ? { left: panelPosition.x, top: panelPosition.y, bottom: 'auto', transform: 'none' }
          : undefined
      }
    >
      <div className="canvas-inline-ai-head">
        <div
          className={fullscreen ? '' : 'canvas-inline-ai-drag-handle'}
          onPointerDown={fullscreen ? undefined : handleDragStart}
        >
          <h3>AI 操作</h3>
          <div className="canvas-inline-ai-subtitle">基于画布选择创建任务</div>
        </div>
        <div className="canvas-inline-ai-head-actions">
          <Tag color={selectedNodes.length > 0 ? 'blue' : 'default'}>{selectedSummary}</Tag>
          <Tooltip title={fullscreen ? '退出全屏' : '全屏操作'}>
            <Button
              size="middle"
              type="text"
              icon={fullscreen ? <Icons.Minimize size={14} /> : <Icons.Maximize size={14} />}
              aria-label={fullscreen ? '退出全屏' : '全屏操作'}
              onClick={() => setFullscreen((current) => !current)}
            />
          </Tooltip>
          <Button
            size="middle"
            type="text"
            icon={<Icons.X size={14} />}
            aria-label="关闭 AI 操作"
            onClick={onClose}
          />
        </div>
      </div>
      <div className="canvas-inline-ai-body">
        <div className="canvas-form-row">
          <label>能力</label>
          <LobeSelect
            value={operation}
            onChange={(value) => setOperation(value as CanvasOperationType)}
            options={capabilities.map((capability) => ({
              value: capability.operation,
              label: capability.recommended ? `推荐 / ${capability.label}` : capability.label,
            }))}
          />
          <div className="canvas-creative-actions">
            {creativeActions.map((capability) => (
              <Button
                key={capability.operation}
                size="middle"
                type={capability.operation === operation ? 'primary' : 'default'}
                onClick={() => setOperation(capability.operation)}
              >
                {capability.label}
              </Button>
            ))}
          </div>
        </div>
        {mediaCapabilityIds.length > 0 && (
          <div className="canvas-form-row canvas-composer-model-row">
            <label>模型</label>
            <CanvasModelPicker
              models={supportedMediaModels}
              value={selectedModelKey}
              loading={modelsLoading}
              onChange={setSelectedModelKey}
            />
            <div className="canvas-model-hint">
              {modelsLoading
                ? '正在读取已启用模型...'
                : supportedMediaModels.length > 0
                  ? `当前能力可用 ${supportedMediaModels.length} 个模型${selectedModel ? ` · ${selectedModel.effectiveModelId} · ${selectedModel.invocationMode}` : ''}`
                  : '当前能力暂无已启用模型，请先到 Provider 绑定。'}
            </div>
          </div>
        )}
        {supportsVideoFrameRoles && (
          <div className="canvas-form-row">
            <div className="canvas-form-label-row">
              <label>视频帧</label>
              {onUploadImage && (
                <Button
                  size="middle"
                  type="text"
                  icon={<Icons.Upload size={13} />}
                  onClick={onUploadImage}
                >
                  上传
                </Button>
              )}
            </div>
            <div className="canvas-frame-role-grid">
              <div className="canvas-param-field">
                <span>首帧</span>
                <LobeSelect
                  value={firstFrameNodeId || undefined}
                  allowClear
                  onChange={(value) => {
                    const next = value == null ? '' : String(value)
                    setFirstFrameNodeId(next)
                  }}
                  options={frameImageOptions}
                  optionFilterProp="title"
                  showSearch
                />
              </div>
              <div className="canvas-param-field">
                <span>尾帧</span>
                <LobeSelect
                  value={lastFrameNodeId || undefined}
                  allowClear
                  disabled={!canUseLastFrame}
                  onChange={(value) => {
                    const next = value == null ? '' : String(value)
                    setLastFrameNodeId(next)
                  }}
                  options={frameImageOptions}
                  optionFilterProp="title"
                  placeholder={canUseLastFrame ? undefined : '当前模型仅 1 张图'}
                  showSearch
                />
              </div>
            </div>
            {videoFrameMaxImages > 2 && (
              <div className="canvas-param-field">
                <span>参考图</span>
                <LobeSelect
                  mode="multiple"
                  value={referenceFrameNodeIds}
                  allowClear
                  onChange={(value) => {
                    const values = Array.isArray(value) ? value.map(String) : []
                    setReferenceFrameNodeIds(values)
                  }}
                  options={frameImageOptions}
                  optionFilterProp="title"
                  placeholder="可多选，超出模型声明可能失败"
                  showSearch
                />
              </div>
            )}
            <CanvasMediaInputHint
              mode="inline"
              maxImages={videoFrameMaxImages}
              selectedImageCount={selectedFrameCount}
              rolePolicy={selectedCapabilityRolePolicy}
              capabilityLabel={selectedCapability?.label}
              capabilityId={selectedCapability?.id}
              extraText={
                videoFrameMaxImages <= 1
                  ? '如需多图参考，先用“多图合成”生成一张新图片节点。'
                  : `可从全画布 ${frameCandidateImageNodes.length} 张图片中选择。`
              }
            />
          </div>
        )}
        {isTextOperation && (
          <>
            <div className="canvas-form-row">
              <label>专属 Agent</label>
              <LobeSelect
                value={selectedAgentId || undefined}
                placeholder="使用通用文本模型（不指定 agent）"
                onChange={(value) => setSelectedAgentId(String(value ?? ''))}
                options={agents.map((agent) => ({
                  value: agent.id,
                  label: agent.builtIn ? `${agent.name}（内置）` : agent.name,
                }))}
                allowClear
              />
              <div className="canvas-model-hint">
                {agents.length > 0
                  ? '选中后用该 agent 的人设与绑定模型执行；不选则用通用影视创作助手。'
                  : '未配置 agent，可继续用通用文本模型，或到「Agents」中新建专属 agent。'}
              </div>
            </div>
            <div className="canvas-form-row">
              <label>内置角色</label>
              <div className="canvas-creative-actions">
                {CANVAS_AGENT_PRESETS.map((preset) => (
                  <Button
                    key={preset.role}
                    size="middle"
                    title={preset.description}
                    onClick={() => applyAgentPreset(preset.role)}
                  >
                    {preset.label}
                  </Button>
                ))}
              </div>
              <div className="canvas-model-hint">
                一键填入该角色的内置提示词（含上游内容），可继续编辑后发起。
              </div>
            </div>
          </>
        )}
        <CanvasPromptEditor
          prompt={prompt}
          negativePrompt={negativePrompt}
          promptPlaceholder={
            nodePromptContext
              ? '已自动带入选中节点内容，可继续补充要求'
              : '描述你希望 agent/provider 在画布中完成的生成、编辑、重写或合成任务'
          }
          optimizeDisabled={prompt.trim().length === 0 && nodePromptContext.length === 0}
          onPromptChange={setPrompt}
          onNegativePromptChange={setNegativePrompt}
          onOptimizePrompt={() => {
            const sourcePrompt = prompt.trim() || nodePromptContext
            if (!sourcePrompt) return
            onCreateTask({
              operation: 'prompt_optimize',
              prompt: buildPromptOptimizationPrompt(sourcePrompt, negativePrompt),
              ...(negativePrompt.trim() ? { negativePrompt: negativePrompt.trim() } : {}),
            })
          }}
        />
        {parameterPartition.common.length > 0 && (
          <div className="canvas-form-row canvas-composer-common-parameters">
            <label>常用参数</label>
            <div className="canvas-composer-common-grid">
              {parameterPartition.common.map((presentation) => (
                <CanvasParameterControl
                  key={presentation.field.name}
                  presentation={presentation}
                  value={modelParamDraft[presentation.field.name] ?? ''}
                  onChange={(value) =>
                    setModelParamDraft((prev) =>
                      updateModelParamDraftValue(prev, presentation.field.name, value),
                    )
                  }
                />
              ))}
            </div>
          </div>
        )}
        {advancedOpen && (
          <div className="canvas-composer-advanced">
            <div className="canvas-composer-advanced-title">
              <Icons.Sliders size={14} />
              <span>高级设置</span>
            </div>
            {needsImageInput && (
              <div className="canvas-form-row">
                <label>输入图片传输</label>
                <LobeSelect
                  value={inputTransport}
                  onChange={(value) => setInputTransport((value ?? 'auto') as CanvasInputTransport)}
                  options={[
                    {
                      value: 'auto',
                      label:
                        selectedModel?.providerKind === 'xai'
                          ? '自动：Base64'
                          : '自动：云端公网链接',
                    },
                    { value: 'cloud_url', label: '云端公网链接' },
                    { value: 'base64', label: 'Base64 直传' },
                  ]}
                />
                <div className="canvas-model-hint">
                  APIMart 等平台需要公网链接；xAI 在国内公网地址不可达时建议使用 Base64。
                </div>
              </div>
            )}
            <div className="canvas-form-row">
              <label>项目提示词</label>
              <div className="canvas-prompt-injection-list">
                <LobeCheckbox
                  checked={includeProjectPrompt}
                  disabled={projectPrompt.length === 0}
                  onChange={setIncludeProjectPrompt}
                >
                  注入项目统一提示词
                </LobeCheckbox>
                <LobeCheckbox
                  checked={includeNegativePrompt}
                  disabled={projectNegativePrompt.length === 0}
                  onChange={setIncludeNegativePrompt}
                >
                  注入反向提示词
                </LobeCheckbox>
              </div>
              <div className="canvas-model-hint">
                {projectPrompt || projectNegativePrompt
                  ? '提交任务时按勾选状态附加项目级约束。'
                  : '可在右侧项目信息中配置项目级提示词。'}
              </div>
            </div>
            {parameterPartition.advanced.length > 0 && (
              <div className="canvas-form-row">
                <label>更多模型参数</label>
                <div className="canvas-composer-advanced-grid">
                  {parameterPartition.advanced.map((presentation) => (
                    <CanvasParameterControl
                      key={presentation.field.name}
                      presentation={presentation}
                      value={modelParamDraft[presentation.field.name] ?? ''}
                      onChange={(value) =>
                        setModelParamDraft((prev) =>
                          updateModelParamDraftValue(prev, presentation.field.name, value),
                        )
                      }
                    />
                  ))}
                </div>
              </div>
            )}
            <div className="canvas-form-row">
              <div className="canvas-form-label-row">
                <label>自定义参数</label>
                <Button
                  size="middle"
                  icon={<Icons.Plus size={13} />}
                  onClick={() => setCustomParams((prev) => [...prev, createCustomParamDraft()])}
                >
                  添加
                </Button>
              </div>
              {customParams.length === 0 ? (
                <div className="canvas-param-empty">
                  可添加模型私有参数，例如 google_search、seed、negative_prompt。
                </div>
              ) : (
                <div className="canvas-custom-param-list">
                  {customParams.map((param) => (
                    <div key={param.id} className="canvas-custom-param-row">
                      <Input
                        value={param.name}
                        placeholder="字段名"
                        onChange={(event) =>
                          updateCustomParam(setCustomParams, param.id, {
                            name: event.target.value,
                          })
                        }
                      />
                      <LobeSelect
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
                        <LobeSelect
                          value={param.value || undefined}
                          placeholder="值"
                          allowClear
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
                          value={param.value}
                          placeholder={param.type === 'json' ? '{"key":"value"}' : '值'}
                          type={
                            param.type === 'integer' || param.type === 'number' ? 'number' : 'text'
                          }
                          onChange={(event) =>
                            updateCustomParam(setCustomParams, param.id, {
                              value: event.target.value,
                            })
                          }
                        />
                      )}
                      <Button
                        size="middle"
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
            </div>
          </div>
        )}
      </div>
      <CanvasComposerToolbar
        summaries={composerSummaries}
        advancedAvailable
        advancedOpen={advancedOpen}
        canSubmit={canSubmit}
        submitting={submitting}
        onToggleAdvanced={handleAdvancedToggle}
        onCancel={onClose}
        onSubmit={() => void handleSubmit()}
      />
    </section>
  )
}

function parameterSummaryIcon(control: CanvasParameterControlKind) {
  switch (control) {
    case 'aspect-ratio':
      return <Icons.Image size={14} />
    case 'resolution':
      return <Icons.Maximize size={14} />
    case 'count':
      return <Icons.Layers size={14} />
    case 'duration':
      return <Icons.Clock size={14} />
    default:
      return <Icons.Settings size={14} />
  }
}

function buildPromptContext(nodes: CanvasNode[]): string {
  const textParts = nodes
    .filter((node) => node.type === 'text' || node.type === 'prompt')
    .map((node) => node.data.text?.trim())
    .filter((text): text is string => Boolean(text))
  return textParts.join('\n\n')
}

function mergeProjectPrompt(prompt: string, projectPrompt: string): string {
  const trimmedPrompt = prompt.trim()
  const trimmedProjectPrompt = projectPrompt.trim()
  if (!trimmedProjectPrompt) return trimmedPrompt
  if (!trimmedPrompt) return `项目统一提示词：\n${trimmedProjectPrompt}`
  if (trimmedPrompt.includes(trimmedProjectPrompt)) return trimmedPrompt
  return `${trimmedPrompt}\n\n项目统一提示词：\n${trimmedProjectPrompt}`
}

function mergeNegativePrompt(negativePrompt: string, projectNegativePrompt: string): string {
  const trimmedNegativePrompt = negativePrompt.trim()
  const trimmedProjectNegativePrompt = projectNegativePrompt.trim()
  if (!trimmedProjectNegativePrompt) return trimmedNegativePrompt
  if (!trimmedNegativePrompt) return trimmedProjectNegativePrompt
  if (trimmedNegativePrompt.includes(trimmedProjectNegativePrompt)) return trimmedNegativePrompt
  return `${trimmedNegativePrompt}\n${trimmedProjectNegativePrompt}`
}

function buildPromptOptimizationPrompt(prompt: string, negativePrompt: string): string {
  const sections = [
    '请优化以下画布 AI 任务提示词，使其更清晰、可执行、包含必要约束，并保持用户原始意图。',
    `原提示词：\n${prompt.trim()}`,
  ]
  if (negativePrompt.trim()) {
    sections.push(`反向提示词：\n${negativePrompt.trim()}`)
  }
  sections.push('请只输出优化后的提示词正文。')
  return sections.join('\n\n')
}

function canRunFromInputOnly(operation: CanvasOperationType, nodes: CanvasNode[]): boolean {
  if (
    ![
      'image_to_image',
      'image_edit',
      'image_compose',
      'storyboard_grid',
      'image_to_video',
      'video_edit',
      'video_extend',
      'audio_transcribe',
    ].includes(operation)
  ) {
    return false
  }
  const inputTypes = new Set(nodes.map((node) => node.type))
  if (operation === 'audio_transcribe') return inputTypes.has('audio')
  if (operation === 'video_edit') return inputTypes.has('video') || inputTypes.has('image')
  if (operation === 'video_extend') return inputTypes.has('video')
  return inputTypes.has('image')
}

function operationNeedsImageInput(operation: CanvasOperationType): boolean {
  // 注意：panorama_360 映射到 image.generate 能力（与 text_to_image 相同），
  // 既可接受文本输入也可接受图片输入，因此不强制要求图片输入。
  return [
    'image_to_image',
    'image_edit',
    'image_compose',
    'storyboard_grid',
    'image_to_video',
    'video_edit',
    'video_extend',
  ].includes(operation)
}

function fallbackPromptForOperation(operation: CanvasOperationType): string {
  return readBuiltinCanvasOperationPreset(operation).prompt
}

function buildVideoFrameInputRoles(
  imageNodeIds: string[],
  firstFrameNodeId: string,
  lastFrameNodeId: string,
  referenceFrameNodeIds: string[],
): Record<string, CanvasTaskInputRoleSelection> {
  const roles: Record<string, CanvasTaskInputRoleSelection> = {}
  const referenceIds = new Set(referenceFrameNodeIds)
  const addRole = (nodeId: string, role: CanvasTaskInputRole) => {
    const current = roles[nodeId]
    if (!current) {
      roles[nodeId] = role
      return
    }
    const currentList = Array.isArray(current) ? current : [current]
    if (!currentList.includes(role)) roles[nodeId] = [...currentList, role]
  }
  for (const nodeId of imageNodeIds) {
    if (nodeId === firstFrameNodeId) addRole(nodeId, 'first_frame')
    if (nodeId === lastFrameNodeId) addRole(nodeId, 'last_frame')
    if (referenceIds.has(nodeId)) addRole(nodeId, 'reference')
  }
  return roles
}

function normalizeVideoFrameNodeIds(
  firstFrameNodeId: string,
  lastFrameNodeId: string,
  referenceFrameNodeIds: string[],
): string[] {
  const result: string[] = []
  const push = (id: string) => {
    if (!id || result.includes(id)) return
    result.push(id)
  }
  push(firstFrameNodeId)
  push(lastFrameNodeId)
  for (const id of referenceFrameNodeIds) push(id)
  return result
}

function buildTaskInputNodeIds(selectedNodes: CanvasNode[], extraNodeIds: string[]): string[] {
  const result: string[] = []
  const push = (id: string) => {
    if (!id || result.includes(id)) return
    result.push(id)
  }
  for (const node of selectedNodes) push(node.id)
  for (const id of extraNodeIds) push(id)
  return result
}

function frameNodeLabelText(node: CanvasNode, index: number, selected: boolean): string {
  const title = node.title?.trim() || `图片 ${index + 1}`
  return selected ? `${title} / 已选中` : title
}

function renderFrameNodeOptionLabel(node: CanvasNode, label: string) {
  const previewUrl = node.data.thumbnailUrl ?? node.data.url
  return (
    <span className="canvas-operation-media-option-label">
      <span className="canvas-operation-media-option-thumb">
        {previewUrl ? <img src={previewUrl} alt="" /> : <Icons.Image size={16} />}
      </span>
      <span className="canvas-operation-media-option-name">{label}</span>
    </span>
  )
}

export type { SchemaField } from './canvasParameterPresentation'

export type CustomParamType = 'string' | 'number' | 'integer' | 'boolean' | 'json'

export type CustomParamDraft = {
  id: string
  name: string
  type: CustomParamType
  value: string
}

type ComposerCacheEntry = {
  operation: CanvasOperationType
  modelKey: string
  modelParamDraft: Record<string, string>
  customParams: CustomParamDraft[]
  inputTransport: CanvasInputTransport
}

/**
 * 按选中节点集合缓存的弹窗草稿。
 * 任务创建前持续防抖写入；创建任务后清除本 key。
 */
type ComposerDraft = {
  operation: CanvasOperationType
  modelKey: string
  prompt: string
  negativePrompt: string
  includeProjectPrompt: boolean
  includeNegativePrompt: boolean
  modelParamDraft: Record<string, string>
  customParams: CustomParamDraft[]
  inputTransport: CanvasInputTransport
  firstFrameNodeId: string
  lastFrameNodeId: string
  referenceFrameNodeIds: string[]
}

type ComposerCache = {
  /** 按选中节点集合 key 缓存的草稿（新结构） */
  drafts?: Record<string, ComposerDraft>
  /** 旧结构（operation::modelKey），保留兜底读取 */
  entries?: Record<string, ComposerCacheEntry>
  lastModelByOperation?: Partial<Record<CanvasOperationType, string>>
}

export function schemaFields(schema: Record<string, unknown>): SchemaField[] {
  const properties = schema.properties
  if (!properties || typeof properties !== 'object' || Array.isArray(properties)) return []
  return Object.entries(properties as Record<string, unknown>)
    .slice(0, 12)
    .map(([name, raw]) => {
      const spec =
        raw && typeof raw === 'object' && !Array.isArray(raw)
          ? (raw as Record<string, unknown>)
          : {}
      const type = typeof spec.type === 'string' ? spec.type : 'string'
      const enumValues = Array.isArray(spec.enum)
        ? spec.enum
            .filter(
              (value) =>
                typeof value === 'string' ||
                typeof value === 'number' ||
                typeof value === 'boolean',
            )
            .map((value) => String(value))
        : []
      const examples = Array.isArray(spec.examples)
        ? spec.examples.filter((value): value is string => typeof value === 'string')
        : []
      // manifest paramSchema 可标记 `x-allow-custom: true` 让前端用 AutoComplete 渲染
      //（既保留下拉推荐值，又允许用户在范围内输入自定义值，如 Seedream size）。
      const allowCustom = spec['x-allow-custom'] === true || spec.allowCustom === true
      return {
        name,
        title: typeof spec.title === 'string' ? spec.title : name,
        type,
        enumValues,
        ...(allowCustom ? { allowCustom: true } : {}),
        ...(typeof spec.description === 'string' ? { description: spec.description } : {}),
        ...(examples[0] ? { placeholder: examples[0] } : {}),
      }
    })
}

/**
 * 按 operation 返回默认模型参数草稿（字符串形式，便于回填 modelParamDraft）。
 * 全景图（panorama_360）专用默认：2:1 等距柱状投影画幅 + 高分辨率，确保产物可直接用于
 * 360° 全景查看器（设计 §7.3）。优先级低于用户草稿与 capability.defaults，仅作兜底默认。
 */
export function operationDefaultModelParams(
  operation: CanvasOperationType,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(
      readCanvasResolvedPresetTarget(resolveCanvasPresetTarget({ operation })).modelParams,
    ).map(([name, value]) => [name, typeof value === 'string' ? value : String(value)]),
  )
}

/**
 * 从选中节点里取首个带 `data.modelParams` 的节点，转成字符串形式供草稿回填。
 * 用于让任务节点持久化的默认参数（如角色身份板默认 16:9）在面板里自动回显。
 * 只读草稿可见字段（fields），避免把无关字段塞进面板。优先级低于用户草稿。
 */
export function nodeDefaultModelParams(
  nodes: readonly Pick<CanvasNode, 'data'>[],
  fields: readonly SchemaField[],
): Record<string, string> {
  const fieldNames = new Set(fields.map((field) => field.name))
  const result: Record<string, string> = {}
  for (const node of nodes) {
    const params = node.data?.modelParams
    if (!params || typeof params !== 'object') continue
    for (const [name, value] of Object.entries(params)) {
      if (!fieldNames.has(name)) continue
      if (value == null) continue
      const str = typeof value === 'string' ? value : String(value)
      if (str && result[name] === undefined) result[name] = str
    }
    if (Object.keys(result).length > 0) break
  }
  return result
}

export function readModelParamDraftValue(
  params: Record<string, unknown>,
  fieldName: string,
): string | undefined {
  const candidates = modelParamAliasCandidates(fieldName)
  for (const name of candidates) {
    const value = params[name]
    if (value == null) continue
    const str = typeof value === 'string' ? value : String(value)
    if (str.trim()) return str
  }
  return undefined
}

export function resolveInitialModelParamDraftValue({
  operation,
  field,
  fieldName,
  presetParams,
  existingParams,
  defaultParams,
}: {
  operation: CanvasOperationType
  field: Pick<SchemaField, 'name' | 'enumValues'>
  fieldName: string
  presetParams: Record<string, unknown>
  existingParams: Record<string, unknown>
  defaultParams: Record<string, unknown>
}): string {
  const panoramaFieldValue =
    operation === 'panorama_360' ? derivePanoramaFieldValue(field, presetParams) : undefined
  if (
    operation === 'panorama_360' &&
    (fieldName === 'aspect_ratio' || fieldName === 'aspectRatio' || fieldName === 'size')
  ) {
    return (
      panoramaFieldValue ??
      readModelParamDraftValue(presetParams, fieldName) ??
      readModelParamDraftValue(existingParams, fieldName) ??
      readModelParamDraftValue(defaultParams, fieldName) ??
      ''
    )
  }
  return (
    readModelParamDraftValue(existingParams, fieldName) ??
    panoramaFieldValue ??
    readModelParamDraftValue(presetParams, fieldName) ??
    readModelParamDraftValue(defaultParams, fieldName) ??
    ''
  )
}

export function isModelParamCoveredByFields(
  key: string,
  fields: readonly Pick<SchemaField, 'name' | 'enumValues'>[],
): boolean {
  const aliases = new Set(modelParamAliasCandidates(key))
  if (
    (key === 'aspect_ratio' || key === 'aspectRatio') &&
    fields.some((field) => field.name === 'size' && fieldCanRepresentPanoramaAspectRatio(field))
  ) {
    return true
  }
  return fields.some((field) => aliases.has(field.name))
}

function modelParamAliasCandidates(fieldName: string): string[] {
  if (fieldName === 'aspect_ratio') return ['aspect_ratio', 'aspectRatio']
  if (fieldName === 'aspectRatio') return ['aspectRatio', 'aspect_ratio']
  return [fieldName]
}

function derivePanoramaFieldValue(
  field: Pick<SchemaField, 'name' | 'enumValues'>,
  presetParams: Record<string, unknown>,
): string | undefined {
  const presetAspect =
    readModelParamDraftValue(presetParams, 'aspect_ratio') ??
    readModelParamDraftValue(presetParams, 'aspectRatio')
  if (!presetAspect) return undefined
  if (field.name === 'aspect_ratio' || field.name === 'aspectRatio') return presetAspect
  if (field.name !== 'size') return undefined
  if (field.enumValues.includes(presetAspect)) return presetAspect
  const dimensionCandidate = field.enumValues.find((value) =>
    matchesAspectRatio(value, presetAspect),
  )
  return dimensionCandidate
}

function fieldCanRepresentPanoramaAspectRatio(
  field: Pick<SchemaField, 'name' | 'enumValues'>,
): boolean {
  return field.name === 'size' && derivePanoramaFieldValue(field, { aspect_ratio: '2:1' }) != null
}

function matchesAspectRatio(value: string, aspectRatio: string): boolean {
  const ratio = parseAspectRatio(aspectRatio)
  const size = parseDimension(value)
  if (!ratio || !size) return false
  const valueRatio = size.width / size.height
  return Math.abs(valueRatio - ratio) < 0.01
}

function parseAspectRatio(value: string): number | null {
  const match = value.trim().match(/^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/)
  if (!match) return null
  const width = Number(match[1])
  const height = Number(match[2])
  if (!Number.isFinite(width) || !Number.isFinite(height) || height === 0) return null
  return width / height
}

function parseDimension(value: string): { width: number; height: number } | null {
  const match = value.trim().match(/^(\d+)\s*x\s*(\d+)$/i)
  if (!match) return null
  const width = Number(match[1])
  const height = Number(match[2])
  if (!Number.isFinite(width) || !Number.isFinite(height) || height === 0) return null
  return { width, height }
}

export function operationSuggestedFields(operation: CanvasOperationType): SchemaField[] {
  if (
    [
      'text_to_image',
      'image_to_image',
      'image_edit',
      'image_compose',
      'storyboard_grid',
      'panorama_360',
    ].includes(operation)
  ) {
    return [
      {
        name: 'size',
        title: '图片尺寸 size',
        type: 'string',
        enumValues: [
          '1024x1024',
          '1536x1024',
          '1024x1536',
          '1792x1024',
          '1024x1792',
          '2048x1024',
          '512x512',
        ],
        description: 'OpenAI 兼容图像模型常用尺寸。',
      },
      {
        name: 'aspect_ratio',
        title: '比例 aspect_ratio',
        type: 'string',
        enumValues: ['1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3', '2:1'],
        description: 'xAI、模板类图像模型常用画幅比例。',
      },
      {
        name: 'resolution',
        title: '清晰度 resolution',
        type: 'string',
        enumValues: ['auto', '1k', '2k'],
        description: '支持分辨率参数的图像模型会透传该值。',
      },
      {
        name: 'quality',
        title: '质量 quality',
        type: 'string',
        enumValues: ['auto', 'low', 'medium', 'high', 'standard', 'hd'],
      },
      {
        name: 'image_format',
        title: '格式 image_format',
        type: 'string',
        enumValues: ['png', 'jpeg', 'webp'],
      },
      {
        name: 'n',
        title: '数量 n',
        type: 'integer',
        enumValues: ['1', '2', '3', '4'],
      },
    ]
  }
  if (['text_to_video', 'image_to_video', 'video_edit', 'video_extend'].includes(operation)) {
    const fields: SchemaField[] = [
      {
        name: 'aspectRatio',
        title: '视频比例 aspectRatio',
        type: 'string',
        enumValues: ['16:9', '9:16', '1:1', '4:3', '3:4'],
      },
      {
        name: 'durationSeconds',
        title: '时长 durationSeconds',
        type: 'integer',
        enumValues: ['3', '5', '8', '10'],
      },
      {
        name: 'quality',
        title: '质量 quality',
        type: 'string',
        enumValues: ['standard', 'high', '720p', '1080p'],
      },
      {
        name: 'seed',
        title: 'seed',
        type: 'integer',
        enumValues: [],
      },
    ]
    if (operation === 'video_edit') {
      fields.push({
        name: 'editStrength',
        title: '编辑强度 editStrength',
        type: 'number',
        enumValues: ['0.25', '0.5', '0.75'],
      })
    }
    if (operation === 'video_extend') {
      return fields.filter((field) => ['durationSeconds', 'seed'].includes(field.name))
    }
    return fields
  }
  if (operation === 'text_to_audio') {
    return [
      {
        name: 'voice',
        title: '音色 voice',
        type: 'string',
        enumValues: [
          'alloy',
          'ash',
          'ballad',
          'coral',
          'echo',
          'fable',
          'nova',
          'onyx',
          'sage',
          'shimmer',
        ],
      },
      {
        name: 'format',
        title: '格式 format',
        type: 'string',
        enumValues: ['mp3', 'wav', 'aac', 'flac', 'opus'],
      },
      {
        name: 'speed',
        title: '语速 speed',
        type: 'number',
        enumValues: ['0.75', '1', '1.25', '1.5'],
      },
    ]
  }
  if (operation === 'audio_transcribe') {
    return [
      {
        name: 'language',
        title: '语言 language',
        type: 'string',
        enumValues: ['zh', 'en', 'ja', 'ko', 'fr', 'de', 'es'],
      },
      {
        name: 'response_format',
        title: '格式 response_format',
        type: 'string',
        enumValues: ['json', 'text', 'srt', 'verbose_json', 'vtt'],
      },
    ]
  }
  return []
}

export function modelSuggestedFields(model: CanvasMediaModelSummary | undefined): SchemaField[] {
  if (!model) return []
  const fingerprint = [model.manifestId, model.modelId, model.effectiveModelId, model.displayName]
    .join(' ')
    .toLowerCase()
  const fields: SchemaField[] = []

  if (
    fingerprint.includes('gemini') ||
    fingerprint.includes('imagen') ||
    fingerprint.includes('veo')
  ) {
    fields.push(
      {
        name: 'google_search',
        title: 'google_search',
        type: 'boolean',
        enumValues: [],
        description: 'Gemini / Google 系模型常见的搜索增强开关。',
      },
      {
        name: 'person_generation',
        title: 'person_generation',
        type: 'string',
        enumValues: ['allow_adult', 'dont_allow'],
        description: 'Google 图像模型人物生成策略。',
      },
    )
  }
  if (fingerprint.includes('gpt-image')) {
    fields.push(
      {
        name: 'quality',
        title: 'quality',
        type: 'string',
        enumValues: ['auto', 'low', 'medium', 'high'],
      },
      {
        name: 'background',
        title: 'background',
        type: 'string',
        enumValues: ['auto', 'transparent', 'opaque'],
      },
      { name: 'moderation', title: 'moderation', type: 'string', enumValues: ['auto', 'low'] },
    )
  }
  if (
    fingerprint.includes('seed') ||
    fingerprint.includes('kling') ||
    fingerprint.includes('wan') ||
    fingerprint.includes('pixverse') ||
    fingerprint.includes('hailuo') ||
    fingerprint.includes('minimax')
  ) {
    fields.push(
      {
        name: 'negative_prompt',
        title: 'negative_prompt',
        type: 'string',
        enumValues: [],
        placeholder: '不希望出现的内容',
      },
      {
        name: 'camera_control',
        title: 'camera_control',
        type: 'string',
        enumValues: [],
        placeholder: 'push_in / pull_out / pan_left ...',
      },
      { name: 'seed', title: 'seed', type: 'integer', enumValues: [] },
    )
  }
  if (model.capabilities.some((capability) => capability.id.startsWith('video.'))) {
    fields.push(
      {
        name: 'motion_strength',
        title: 'motion_strength',
        type: 'number',
        enumValues: [],
        placeholder: '0.5',
      },
      { name: 'fps', title: 'fps', type: 'integer', enumValues: [], placeholder: '24' },
    )
  }
  return fields
}

export function mergeSchemaFields(
  baseFields: SchemaField[],
  ...suggestedFieldGroups: SchemaField[][]
): SchemaField[] {
  const dimensionFieldPolicy = imageDimensionFieldPolicy(baseFields)
  const seen = new Set<string>()
  const result: SchemaField[] = []
  for (const field of baseFields) {
    if (seen.has(field.name)) continue
    seen.add(field.name)
    result.push(field)
  }
  for (const field of suggestedFieldGroups.flat()) {
    if (!dimensionFieldPolicy.allows(field.name)) continue
    const existingIndex = result.findIndex((item) => item.name === field.name)
    if (existingIndex >= 0) {
      const existing = result[existingIndex]
      if (!existing) continue
      result[existingIndex] = {
        ...field,
        ...existing,
        enumValues: existing.enumValues.length > 0 ? existing.enumValues : field.enumValues,
      }
      continue
    }
    seen.add(field.name)
    result.push(field)
  }
  return result.slice(0, 18)
}

function imageDimensionFieldPolicy(fields: SchemaField[]): {
  allows: (name: string) => boolean
  accepted: Set<string>
} {
  const accepted = new Set(
    fields
      .map((field) => field.name)
      .filter((name) => name === 'size' || name === 'aspect_ratio' || name === 'aspectRatio'),
  )
  return {
    accepted,
    allows: (name) =>
      accepted.size === 0 ||
      (name !== 'size' && name !== 'aspect_ratio' && name !== 'aspectRatio') ||
      accepted.has(name),
  }
}

function readComposerCache(): ComposerCache {
  if (typeof window === 'undefined') return {}
  try {
    const raw = window.localStorage.getItem(COMPOSER_CACHE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as ComposerCache
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

function writeComposerCache(cache: ComposerCache): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(COMPOSER_CACHE_KEY, JSON.stringify(cache))
  } catch {
    // 参数缓存不应影响创建任务。
  }
}

function composerCacheKey(operation: CanvasOperationType, modelKey: string): string {
  return `${operation}::${modelKey}`
}

function readComposerCacheEntry(key: string): ComposerCacheEntry | null {
  return readComposerCache().entries?.[key] ?? null
}

function readLastModelKey(operation: CanvasOperationType): string | undefined {
  return readComposerCache().lastModelByOperation?.[operation]
}

function writeLastModelKey(operation: CanvasOperationType, modelKey: string): void {
  const cache = readComposerCache()
  writeComposerCache({
    ...cache,
    lastModelByOperation: {
      ...(cache.lastModelByOperation ?? {}),
      [operation]: modelKey,
    },
  })
}

/**
 * 按选中节点集合生成缓存 key：排序去重后以 `__` 连接。
 * 空集合返回空串（调用方据此跳过读写，维持现状）。
 */
function composeNodeCacheKey(nodeIds: string[]): string {
  const unique = Array.from(new Set(nodeIds.filter(Boolean))).sort()
  return unique.join('__')
}

function readComposerDraft(key: string): ComposerDraft | null {
  if (!key) return null
  return readComposerCache().drafts?.[key] ?? null
}

function writeComposerDraft(key: string, draft: ComposerDraft): void {
  if (!key) return
  const cache = readComposerCache()
  writeComposerCache({
    ...cache,
    drafts: {
      ...(cache.drafts ?? {}),
      [key]: draft,
    },
  })
}

function clearComposerDraft(key: string): void {
  if (!key) return
  const cache = readComposerCache()
  if (!cache.drafts || !(key in cache.drafts)) return
  const next = { ...cache.drafts }
  delete next[key]
  writeComposerCache({ ...cache, drafts: next })
}

function pickDraftForFields(
  fields: SchemaField[],
  draft: Record<string, string>,
): Record<string, string> {
  const result: Record<string, string> = {}
  for (const field of fields) {
    const value = draft[field.name]
    if (value != null && value.trim()) result[field.name] = value
  }
  return result
}

export function createCustomParamDraft(): CustomParamDraft {
  return {
    id: `custom-param-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name: '',
    type: 'string',
    value: '',
  }
}

export function updateCustomParam(
  setCustomParams: Dispatch<SetStateAction<CustomParamDraft[]>>,
  id: string,
  patch: Partial<CustomParamDraft>,
) {
  setCustomParams((prev) => prev.map((item) => (item.id === id ? { ...item, ...patch } : item)))
}

export function buildModelParams(
  fields: SchemaField[],
  draft: Record<string, string>,
): Record<string, unknown> {
  const params: Record<string, unknown> = {}
  for (const field of fields) {
    const raw = draft[field.name]?.trim()
    if (!raw) continue
    if (field.type === 'integer') {
      const value = Number.parseInt(raw, 10)
      if (Number.isFinite(value)) params[field.name] = value
    } else if (field.type === 'number') {
      const value = Number(raw)
      if (Number.isFinite(value)) params[field.name] = value
    } else if (field.type === 'boolean') {
      params[field.name] = raw === 'true'
    } else {
      params[field.name] = raw
    }
  }
  return params
}

export function updateModelParamDraftValue(
  draft: Record<string, string>,
  fieldName: string,
  value: string,
): Record<string, string> {
  const next = { ...draft, [fieldName]: value }
  if (value.trim().length === 0) return next
  if (fieldName === 'size') {
    next.aspect_ratio = ''
    next.aspectRatio = ''
  } else if (fieldName === 'aspect_ratio' || fieldName === 'aspectRatio') {
    next.size = ''
  }
  return next
}

export function buildCustomModelParams(drafts: CustomParamDraft[]): Record<string, unknown> {
  const params: Record<string, unknown> = {}
  for (const draft of drafts) {
    const name = draft.name.trim()
    const raw = draft.value.trim()
    if (!name || !raw) continue
    if (draft.type === 'integer') {
      const value = Number.parseInt(raw, 10)
      if (Number.isFinite(value)) params[name] = value
    } else if (draft.type === 'number') {
      const value = Number(raw)
      if (Number.isFinite(value)) params[name] = value
    } else if (draft.type === 'boolean') {
      params[name] = raw === 'true'
    } else if (draft.type === 'json') {
      try {
        params[name] = JSON.parse(raw)
      } catch {
        params[name] = raw
      }
    } else {
      params[name] = raw
    }
  }
  return params
}

export function normalizeModelParamsForSubmit(
  params: Record<string, unknown>,
  defaults: Record<string, unknown>,
  fields?: SchemaField[],
): Record<string, unknown> {
  const next = { ...params }
  if (fields) {
    const policy = imageDimensionFieldPolicy(fields)
    if (policy.accepted.size > 0) {
      for (const name of ['size', 'aspect_ratio', 'aspectRatio']) {
        if (!policy.accepted.has(name)) delete next[name]
      }
    }
  }
  const aspect = stringParam(next.aspectRatio) ?? stringParam(next.aspect_ratio)
  const size = stringParam(next.size)
  const defaultSize = stringParam(defaults.size)
  const defaultAspect = stringParam(defaults.aspectRatio) ?? stringParam(defaults.aspect_ratio)
  if (aspect && size && defaultSize && size === defaultSize) {
    delete next.size
  } else if (aspect && size && defaultAspect && aspect === defaultAspect) {
    delete next.aspectRatio
    delete next.aspect_ratio
  }
  return next
}

function stringParam(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined
}

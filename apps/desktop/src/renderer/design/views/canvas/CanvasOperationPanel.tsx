import { memo, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Input, InputNumber, Popover, Select, Tag, Tooltip, message } from 'antd'
import { Button } from '@lobehub/ui'
import { Icons } from '../../Icons'
import {
  capabilityForOperation,
  capabilitySupportsFrameRoles,
  capabilitySupportsImageRoles,
  inferRolePolicy,
  videoImageLimitForCapability,
  type ManagedAgent,
  type CanvasMediaModelSummary,
  type CanvasMediaTaskInputFile,
  type ProviderProfile,
  type SkillItem,
  type MediaInputRolePolicy,
  type SessionReasoningEffort,
  type CanvasPromptDocument,
} from '@spark/protocol'
import { operationLabel } from './canvas.api'
import { getCanvasCapability, nodeOperation } from './canvas.capabilities'
import {
  mergeCanvasOperationPresetNegativePrompt,
  readCanvasResolvedPresetTarget,
  resolveCanvasPresetTarget,
} from './canvasOperationPresets'
import { DEFAULT_MAX_CLIP_SEC } from './canvasAgentPromptPresets'
import { buildReferenceImageInputRoles } from './canvasTaskInputFiles'
import { AgentPickerInline, ProviderModelPickerInline } from './CanvasAgentModal'
import { CanvasMediaInputHint } from './CanvasMediaInputHint'
import { CanvasMediaInputThumb } from './CanvasMediaInputThumb'
import { AssetThumbnail } from './CanvasAssetThumbnail'
import { CanvasPromptMentionTextArea } from './CanvasPromptMentionTextArea'
import { toCanvasPromptPlainText } from './canvasPromptDocument'
import {
  buildCanvasVisiblePromptDocument,
  isCanvasPromptInlineNode,
  stripCanvasFunctionalPromptInput,
} from './canvasPromptInitialization'
import { computeMediaInputRoleMap } from './canvasMediaInputRoles'
import {
  CanvasMediaInputPickerModal,
  type MediaInputPickerItem,
} from './CanvasMediaInputPickerModal'
import { canvasApi } from './canvas.api'
import { expandCanvasInputNodes } from './canvasWorkspaceTaskInput'
import { readCanvasTextInputContent } from './canvasTextInputPresentation'
import { confirmVideoSubmission, isVideoSubmissionOperation } from './canvasVideoSubmissionGate'
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
  type SchemaField,
} from './CanvasInlineAiComposer'
import { mediaModelKey } from './canvasModelPickerModel'
import { CanvasOperationParameterControls } from './CanvasOperationParameterControls'
import {
  mergeSeededModelParamDraft,
  sameCustomParamDrafts,
  sameModelParamDraft,
} from './canvasModelParamDraftState'
import type {
  CanvasInputTransport,
  CanvasNode,
  CanvasOperationType,
  CanvasSnapshot,
  CanvasTask,
  ShotScriptConfig,
} from './canvas.types'

/**
 * 操作节点编辑面板。
 *
 * 默认定位在底部 dock 上方；双击节点时可切到 inline，作为节点卡片内部扩展区。
 * 三区：操作类型 / 输入预览 / 参数编辑。确定后运行。
 */

type CanvasTaskInputRole = NonNullable<CanvasMediaTaskInputFile['role']>
type CanvasTaskInputRoleSelection = CanvasTaskInputRole | CanvasTaskInputRole[]
type RuntimePickerMenu = 'agent' | 'model' | null
const EMPTY_MEDIA_INPUT_ROLE_POLICY: MediaInputRolePolicy = { defaultRoleAssignment: 'none' }
const COMMON_MODEL_PARAM_NAMES = new Set([
  'aspect',
  'aspectRatio',
  'aspect_ratio',
  'duration',
  'durationSeconds',
  'fps',
  'frameRate',
  'google_image_search',
  'google_search',
  'quality',
  'ratio',
  'resolution',
  'searchEnabled',
  'seed',
  'size',
])
const HIDDEN_MODEL_PARAM_NAMES = new Set([
  'returnLastFrame',
  'return_last_frame',
  'useFirstFrame',
  'useLastFrame',
])
const COMMON_MODEL_PARAM_TITLE_PATTERNS = [
  'Google 搜索',
  'Google 图片搜索',
  '分辨率',
  '尺寸',
  '帧率',
  '联网搜索',
  '随机种子',
  '视频比例',
  '画幅',
  '画质',
  '比例',
  '质量',
  '首帧',
  '时长',
  '搜索',
  '尾帧',
]

/** 分镜「每镜最长时间」档位（秒） */
const SHOT_MAX_CLIP_PRESETS = [4, 5, 8, 10]

export type OperationRunParams = {
  prompt: string
  promptDocument?: CanvasPromptDocument
  /** 功能节点的隐藏指令；不进入用户可见提示词文档。 */
  systemPrompt?: string
  negativePrompt?: string
  inputNodeIds?: string[]
  inputTransport?: CanvasInputTransport
  inputRoles?: Record<string, CanvasTaskInputRoleSelection>
  agentId?: string
  providerProfileId?: string
  manifestId?: string
  modelId?: string
  reasoningEffort?: SessionReasoningEffort
  skillIds?: string[]
  modelParams?: Record<string, unknown>
  /** 分镜任务的时长配置（每镜最长时间），运行时替换 prompt 占位槽 {maxClip} */
  shotScriptConfig?: ShotScriptConfig
}

export type OperationDraftParams = {
  title: string | null
  message: string
  prompt: string
  promptDocument?: CanvasPromptDocument
  systemPrompt?: string
  negativePrompt: string
  modelParams: Record<string, unknown>
  agentId?: string
  providerProfileId?: string
  manifestId?: string
  modelId?: string
  skillIds?: string[]
  /** 分镜任务的时长配置，随草稿持久化到 node.data.shotScriptConfig */
  shotScriptConfig?: ShotScriptConfig
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
  const parts = [...relatedIds].sort().map((id) => {
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
    params.sourceNegativePrompts
      ?.map((value) => value?.trim() || '')
      .find((value) => value.length > 0) ||
    params.projectNegativePrompt?.trim() ||
    ''

  return mergeCanvasOperationPresetNegativePrompt(
    baseNegativePrompt,
    params.operationPresetNegativePrompt?.trim() ?? '',
  )
}

export function readCanvasOperationPanelTextInputContent(
  node: CanvasNode,
  assets: CanvasSnapshot['assets'],
): string {
  return readCanvasTextInputContent(node, assets)
}

export function mergeOperationPanelPromptWithInputContext(
  prompt: string | null | undefined,
  context: string,
): string {
  const trimmedPrompt = (prompt ?? '').trim()
  const trimmedContext = context.trim()
  if (!trimmedContext) return trimmedPrompt
  if (!trimmedPrompt) return trimmedContext
  if (trimmedPrompt.includes(trimmedContext)) return trimmedPrompt
  return `${trimmedPrompt}\n\n画布节点内容：\n${trimmedContext}`
}

export function resolveOperationPanelEditablePrompt(params: {
  nodePrompt?: string | null
  upstreamTextContext?: string | null
  hideFunctionalPrompt?: boolean
}): string {
  // Connected text is represented by Prompt Document reference blocks. Keep the
  // visible editor limited to authored text; the compiler resolves upstream
  // content at submission time.
  if (params.hideFunctionalPrompt) return ''
  return (params.nodePrompt ?? '').trim()
}

export function isGeneratedCanvasFunctionalPrompt(
  prompt: string | null | undefined,
  presetTargetId: string,
): boolean {
  const value = prompt?.trim() ?? ''
  if (!value) return false
  if (presetTargetId === 'screenplay.to_shot_script') {
    return value.includes('【任务】把下面的场次剧本拆成') && value.includes('JSON 顶层结构必须为')
  }
  if (presetTargetId === 'chapter.to_screenplay') {
    return value.includes('请把下面的小说/长文稿章节改写为影视剧本') && value.includes('章节原文：')
  }
  if (presetTargetId === 'screenplay.extract_characters' || presetTargetId === 'screenplay.extract_scenes') {
    return value.includes('【任务】你是资深影视美术/设定师') && value.includes('【剧本】')
  }
  return false
}

export function stripGeneratedCanvasFunctionalPromptInput(
  prompt: string,
  presetTargetId: string,
): string {
  return stripCanvasFunctionalPromptInput(prompt, presetTargetId)
}

export function buildOperationPanelEditablePromptDocument(params: {
  document?: CanvasPromptDocument
  editablePrompt: string
  hideFunctionalPrompt: boolean
  nodes: CanvasNode[]
  connections: CanvasNode[]
  assets: CanvasSnapshot['assets']
}): CanvasPromptDocument {
  return buildCanvasVisiblePromptDocument({
    ...(params.document ? { document: params.document } : {}),
    prompt: params.editablePrompt,
    nodes: params.nodes,
    connections: params.connections,
    assets: params.assets,
    ...(params.hideFunctionalPrompt ? { hideText: true } : {}),
  })
}

export function isCanvasPromptInlineConnection(node: CanvasNode): boolean {
  return isCanvasPromptInlineNode(node)
}

export function hasOperationPanelPromptContent(document: CanvasPromptDocument): boolean {
  return document.blocks.some((block) => {
    if (block.kind === 'text') return block.text.trim().length > 0
    if (block.kind === 'reference') return block.suppressed !== true
    return true
  })
}

export function readActiveOperationPromptNodeIds(document: CanvasPromptDocument): string[] {
  return Array.from(
    new Set(
      document.blocks.flatMap((block) => {
        if (block.kind === 'structured') return [block.sourceNodeId]
        if (block.kind === 'reference' && !block.suppressed) return [block.sourceNodeId]
        return []
      }),
    ),
  )
}

export type OperationPanelEnumOption = {
  value: string
  label: string
  disabled?: boolean
  unsupported?: boolean
}

export function buildOperationPanelEnumOptions(
  field: { enumValues: string[]; allowCustom?: boolean },
  currentValue: string | null | undefined,
): OperationPanelEnumOption[] {
  const options: OperationPanelEnumOption[] = field.enumValues.map((value: string) => ({
    value,
    label: value,
  }))
  const trimmed = (currentValue ?? '').trim()
  if (trimmed && !field.allowCustom && !field.enumValues.includes(trimmed)) {
    return [{ value: trimmed, label: trimmed, disabled: true, unsupported: true }, ...options]
  }
  return options
}

export function isCommonOperationModelParam(field: Pick<SchemaField, 'name' | 'title'>): boolean {
  if (HIDDEN_MODEL_PARAM_NAMES.has(field.name)) return false
  if (COMMON_MODEL_PARAM_NAMES.has(field.name)) return true
  const normalizedName = field.name.toLowerCase()
  if (
    normalizedName.includes('search') ||
    normalizedName.includes('quality') ||
    normalizedName.includes('resolution') ||
    normalizedName.includes('duration') ||
    normalizedName.includes('aspect') ||
    normalizedName.includes('ratio') ||
    normalizedName.includes('fps')
  ) {
    return true
  }
  return COMMON_MODEL_PARAM_TITLE_PATTERNS.some((pattern) => field.title.includes(pattern))
}

function operationPickerPopoverClassName(popoverClassName?: string): string {
  if (popoverClassName) return popoverClassName
  return 'canvas-operation-text-picker-popover'
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
  onCancelTask,
  fullscreen: controlledFullscreen,
  onFullscreenChange,
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
  /** 强制取消当前任务；不传则不渲染取消按钮 */
  onCancelTask?: (taskId: string) => Promise<void> | void
  fullscreen?: boolean
  onFullscreenChange?: (nextFullscreen: boolean) => void
}) {
  const operation = nodeOperation(node) ?? 'text_generate'
  const capability = getCanvasCapability(operation)
  const operationText = operationLabel(operation)
  const isTextOperation = isTextModelOperation(operation)
  // 分镜脚本任务节点（带结构化时长配置）才渲染「每镜时长 / 平均镜时」控件。
  const isShotScriptNode =
    node.data.operation === 'text_generate' && node.data.shotScriptConfig != null
  const presetTargetId = useMemo(
    () =>
      resolveCanvasPresetTarget({
        operation,
        taskPipelineRole: node.data.pipelineRole ?? null,
        outputPipelineRole: node.data.outputPipelineRole ?? null,
        workflow: task?.modelParams?.workflow ?? node.data.modelParams?.workflow,
      }),
    [
      node.data.modelParams?.workflow,
      node.data.outputPipelineRole,
      node.data.pipelineRole,
      operation,
      task?.modelParams?.workflow,
    ],
  )
  const operationPreset = useMemo(
    () => readCanvasResolvedPresetTarget(presetTargetId),
    [presetTargetId],
  )
  const [localFullscreen, setLocalFullscreen] = useState(false)
  const fullscreen = controlledFullscreen ?? localFullscreen
  const setFullscreen = useCallback(
    (next: boolean | ((current: boolean) => boolean)) => {
      const nextFullscreen = typeof next === 'function' ? next(fullscreen) : next
      if (controlledFullscreen === undefined) setLocalFullscreen(nextFullscreen)
      onFullscreenChange?.(nextFullscreen)
    },
    [controlledFullscreen, fullscreen, onFullscreenChange],
  )
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
    () => expandCanvasInputNodes(sourceInputNodes, snapshot),
    [sourceInputNodes, snapshot],
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
  const functionalPromptSource = useMemo(
    () => node.data.prompt?.trim() || task?.prompt?.trim() || '',
    [node.data.prompt, task?.prompt],
  )
  const hideFunctionalPrompt = useMemo(
    () =>
      presetTargetId !== operation &&
      isGeneratedCanvasFunctionalPrompt(functionalPromptSource, presetTargetId),
    [functionalPromptSource, operation, presetTargetId],
  )
  const hiddenFunctionalSystemPrompt = useMemo(
    () =>
      task?.systemPrompt?.trim() ||
      node.data.systemPrompt?.trim() ||
      (hideFunctionalPrompt
        ? stripGeneratedCanvasFunctionalPromptInput(functionalPromptSource, presetTargetId)
        : ''),
    [
      functionalPromptSource,
      hideFunctionalPrompt,
      node.data.systemPrompt,
      presetTargetId,
      task?.systemPrompt,
    ],
  )
  const initialPrompt = useMemo(() => {
    const nodePrompt = node.data.prompt
    return resolveOperationPanelEditablePrompt({
      ...(typeof nodePrompt === 'string' ? { nodePrompt } : {}),
      ...(hideFunctionalPrompt ? { hideFunctionalPrompt: true } : {}),
    })
  }, [hideFunctionalPrompt, node.data.prompt])
  const initialPromptDocument = useMemo(
    () =>
      buildOperationPanelEditablePromptDocument({
        ...(task?.promptDocument
          ? { document: task.promptDocument }
          : node.data.promptDocument
            ? { document: node.data.promptDocument }
            : {}),
        editablePrompt: initialPrompt,
        hideFunctionalPrompt,
        nodes: snapshot.nodes,
        connections: sourceInputNodes,
        assets: snapshot.assets,
      }),
    [
      sourceInputNodes,
      hideFunctionalPrompt,
      initialPrompt,
      node.data.promptDocument,
      snapshot.assets,
      snapshot.nodes,
      task?.promptDocument,
    ],
  )

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
  const [prompt, setPrompt] = useState(initialPrompt)
  const [promptDocument, setPromptDocument] = useState<CanvasPromptDocument>(initialPromptDocument)
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
  const [cancelling, setCancelling] = useState(false)
  const [titleDraft, setTitleDraft] = useState(node.title ?? '')
  const [messageDraft, setMessageDraft] = useState(node.data.message ?? '')
  const [showAllTextInputs, setShowAllTextInputs] = useState(false)
  const [mediaPickerOpen, setMediaPickerOpen] = useState(false)
  const [activeTextPickerId, setActiveTextPickerId] = useState<string | null>(null)
  // 分镜时长配置草稿：preset 命中档位则用档位值，否则 'custom' + 自定义数字字符串。
  const [maxClipPreset, setMaxClipPreset] = useState<number | 'custom'>('custom')
  const [maxClipCustom, setMaxClipCustom] = useState('')
  const modelParamDraftEditedRef = useRef(false)
  const customParamsEditedRef = useRef(false)
  const promptCharCount = useMemo(
    () => toCanvasPromptPlainText(promptDocument).trim().length,
    [promptDocument],
  )

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
    modelParamDraftEditedRef.current = false
    customParamsEditedRef.current = false
    setPrompt(initialPrompt)
    setPromptDocument(initialPromptDocument)
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
    // 分镜时长配置草稿：从 node.data.shotScriptConfig 解析到 preset/custom（随节点切换重置）。
    // 兼容脏数据：持久化的 maxClipSec 非法（缺省 / 非有限 / ≤0）时回退默认值，避免回显 -1 这类异常。
    const rawMaxClip = node.data.shotScriptConfig?.maxClipSec
    const safeMaxClip =
      typeof rawMaxClip === 'number' && Number.isFinite(rawMaxClip) && rawMaxClip > 0
        ? rawMaxClip
        : DEFAULT_MAX_CLIP_SEC
    setMaxClipPreset(SHOT_MAX_CLIP_PRESETS.includes(safeMaxClip) ? safeMaxClip : 'custom')
    setMaxClipCustom(SHOT_MAX_CLIP_PRESETS.includes(safeMaxClip) ? '' : String(safeMaxClip))
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
        ? (agents.find((agent) => agent.id === operationPreset.agentId) ?? null)
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
        ? (agents.find((agent) => agent.id === operationPreset.agentId) ?? null)
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
      (selectedCapability ? capabilitySupportsFrameRoles(selectedCapability) : false) &&
      mediaInputOptions.some((option) => option.type === 'image'),
    [mediaInputOptions, selectedCapability],
  )
  const supportsImageRoles = useMemo(
    () =>
      (selectedCapability ? capabilitySupportsImageRoles(selectedCapability) : false) &&
      mediaInputOptions.some((option) => option.type === 'image'),
    [mediaInputOptions, selectedCapability],
  )
  const videoFrameMaxImages = useMemo(
    () => videoImageLimitForCapability(operation, selectedCapability),
    [operation, selectedCapability],
  )
  const canUseLastFrame = supportsVideoFrameRoles && videoFrameMaxImages > 1
  const selectedFrameCount =
    (firstFrameNodeId ? 1 : 0) + (lastFrameNodeId ? 1 : 0) + referenceFrameNodeIds.length
  const frameImageOptions = useMemo(
    () => mediaInputOptions.filter((option) => option.type === 'image'),
    [mediaInputOptions],
  )
  const sourceReferenceImageNodeIds = useMemo(
    () => editableSourceMediaNodes.filter((item) => item.type === 'image').map((item) => item.id),
    [editableSourceMediaNodes],
  )
  const hasExplicitFrameInput =
    supportsVideoFrameRoles &&
    Boolean(firstFrameNodeId || lastFrameNodeId || referenceFrameNodeIds.length > 0)
  const explicitFrameNodeIds = useMemo(
    () =>
      supportsVideoFrameRoles
        ? normalizeVideoFrameNodeIds(firstFrameNodeId, lastFrameNodeId, referenceFrameNodeIds)
        : [],
    [firstFrameNodeId, lastFrameNodeId, referenceFrameNodeIds, supportsVideoFrameRoles],
  )
  const allParameterFields = useMemo(
    () =>
      mergeSchemaFields(
        schemaFields(selectedCapability?.paramSchema ?? {}),
        operationSuggestedFields(operation),
        modelSuggestedFields(selectedModel),
      ),
    [operation, selectedCapability, selectedModel],
  )
  const parameterFields = useMemo(
    () => allParameterFields.filter((field) => !HIDDEN_MODEL_PARAM_NAMES.has(field.name)),
    [allParameterFields],
  )

  useEffect(() => {
    if (supportedMediaModels.length === 0) {
      setSelectedModelKey('')
      return
    }
    if (supportedMediaModels.some((model) => mediaModelKey(model) === selectedModelKey)) return
    const fromTask = supportedMediaModels.find(
      (model) =>
        (!(
          task?.providerProfileId ??
          node.data.providerProfileId ??
          operationPreset.providerProfileId
        ) ||
          model.providerProfileId ===
            (task?.providerProfileId ??
              node.data.providerProfileId ??
              operationPreset.providerProfileId)) &&
        (!(task?.manifestId ?? node.data.manifestId ?? operationPreset.manifestId) ||
          model.manifestId ===
            (task?.manifestId ?? node.data.manifestId ?? operationPreset.manifestId)) &&
        (!(task?.modelId ?? node.data.modelId ?? operationPreset.modelId) ||
          model.effectiveModelId ===
            (task?.modelId ?? node.data.modelId ?? operationPreset.modelId)),
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
    if (!supportsVideoFrameRoles || sourceReferenceImageNodeIds.length === 0) return
    setReferenceFrameNodeIds((prev) =>
      mergeDefaultReferenceFrameNodeIds(
        prev,
        sourceReferenceImageNodeIds,
        frameImageOptions.map((option) => String(option.value)),
      ),
    )
  }, [frameImageOptions, sourceReferenceImageNodeIds, supportsVideoFrameRoles])

  useEffect(() => {
    const defaults = selectedCapability?.defaults ?? {}
    const existing = task?.modelParams ?? node.data.modelParams ?? {}
    const seeded = { ...operationPreset.modelParams, ...existing }
    const next: Record<string, string> = {}
    const fieldNames = new Set(allParameterFields.map((field) => field.name))
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
      const candidate = modelParamDraftEditedRef.current
        ? mergeSeededModelParamDraft(prev, next)
        : next
      if (sameModelParamDraft(prev, candidate)) {
        return prev
      }
      return candidate
    })
    const nextCustomParams = Object.entries(seeded)
      .filter(
        ([key, value]) =>
          !fieldNames.has(key) &&
          !isModelParamCoveredByFields(key, allParameterFields) &&
          value != null,
      )
      .map(([key, value]) => ({
        id: `custom-${key}`,
        name: key,
        type: inferCustomParamType(value),
        value: typeof value === 'object' ? JSON.stringify(value) : String(value),
      }))
    setCustomParams((prev) => {
      if (customParamsEditedRef.current || sameCustomParamDrafts(prev, nextCustomParams)) {
        return prev
      }
      return nextCustomParams
    })
  }, [
    node.data.modelParams,
    allParameterFields,
    operationPreset.modelParams,
    operation,
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

  const handleModelParamDraftChange = useCallback((fieldName: string, value: string) => {
    modelParamDraftEditedRef.current = true
    setModelParamDraft((prev) => updateModelParamDraftValue(prev, fieldName, value))
  }, [])

  const handleCustomParamPatch = useCallback((id: string, patch: Partial<CustomParamDraft>) => {
    customParamsEditedRef.current = true
    updateCustomParam(setCustomParams, id, patch)
  }, [])

  const handleAddCustomParam = useCallback(() => {
    customParamsEditedRef.current = true
    setCustomParams((prev) => [...prev, createCustomParamDraft()])
  }, [])

  const handleRemoveCustomParam = useCallback((id: string) => {
    customParamsEditedRef.current = true
    setCustomParams((prev) => prev.filter((item) => item.id !== id))
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

  // 把 preset/custom 草稿解析成结构化时长配置。
  // 分镜节点永远返回合法值——非法输入（空 / 非正）回退默认，绝不放任 {maxClip} 占位槽裸奔泄漏给 LLM；
  // 非分镜节点返回 null。
  const resolveShotScriptConfig = useCallback((): ShotScriptConfig | null => {
    if (!isShotScriptNode) return null
    const parsed = maxClipPreset === 'custom' ? Number(maxClipCustom) : maxClipPreset
    const maxClipSec = Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_MAX_CLIP_SEC
    return { maxClipSec }
  }, [isShotScriptNode, maxClipPreset, maxClipCustom])

  const handleSaveDraft = useCallback(async () => {
    if (savingDraft) return
    setSavingDraft(true)
    try {
      const runtimeDraft = buildRuntimeDraft()
      const shotConfig = resolveShotScriptConfig()
      await onSaveDraft({
        title: titleDraft.trim().length > 0 ? titleDraft.trim() : null,
        message: messageDraft.trim(),
        prompt: prompt.trim(),
        promptDocument,
        ...(hiddenFunctionalSystemPrompt
          ? { systemPrompt: hiddenFunctionalSystemPrompt }
          : {}),
        negativePrompt: negativePrompt.trim(),
        modelParams: buildCurrentModelParams(),
        ...runtimeDraft,
        ...(shotConfig ? { shotScriptConfig: shotConfig } : {}),
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
    promptDocument,
    hiddenFunctionalSystemPrompt,
    resolveShotScriptConfig,
    savingDraft,
    titleDraft,
  ])

  const handleCancelTask = useCallback(async () => {
    if (!task?.id || !onCancelTask) return
    setCancelling(true)
    try {
      await onCancelTask(task.id)
    } finally {
      setCancelling(false)
    }
  }, [onCancelTask, task?.id])

  const handleRun = useCallback(async () => {
    // 防重复提交：本地 running/submitting flag + 节点状态（含已完成节点重提场景）。
    // 旧实现仅拦 running，已完成(completed)节点重提会穿透 → 产生重复任务。
    if (running || submitting || node.data.status === 'running') return
    if (
      !hasOperationPanelPromptContent(promptDocument) &&
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
    if (supportsVideoFrameRoles && !hasExplicitFrameInput) {
      message.warning('请在底部参数栏选择首帧或尾帧图片')
      return
    }
    const inputRoles = supportsVideoFrameRoles
      ? buildVideoFrameInputRoles(
          explicitFrameNodeIds,
          firstFrameNodeId,
          lastFrameNodeId,
          referenceFrameNodeIds,
        )
      : supportsImageRoles
        ? buildReferenceImageInputRoles(
            selectedInputNodeIds.filter((id) =>
              mediaInputOptions.some((option) => option.type === 'image' && option.value === id),
            ),
          )
        : undefined
    const nextModelParams = buildCurrentModelParams()
    const activePromptNodeIds = readActiveOperationPromptNodeIds(promptDocument)
    const activePromptNodeIdSet = new Set(activePromptNodeIds)
    const runInputNodeIds = Array.from(
      new Set([
        ...buildOperationPanelRunInputNodeIds({
          selectedInputNodeIds,
          explicitFrameNodeIds,
          textInputNodeIds: expandedSourceInputNodes
            .filter(
              (item) =>
                (item.type === 'text' || item.type === 'prompt') &&
                activePromptNodeIdSet.has(item.id),
            )
            .map((item) => item.id),
          supportsVideoFrameRoles,
          mediaInputOptions: mediaInputOptions.map((item) => ({
            value: String(item.value),
            type: item.type,
          })),
        }),
        ...activePromptNodeIds,
      ]),
    )
    if (isVideoSubmissionOperation(operation)) {
      const proceed = await confirmVideoSubmission({
        prompt: prompt.trim(),
        imageCount: runInputNodeIds.filter((id) =>
          mediaInputOptions.some((option) => option.value === id && option.type === 'image'),
        ).length,
        modelParams: nextModelParams,
      })
      if (!proceed) return
    }
    const resolvedShotScriptConfig = resolveShotScriptConfig()
    setSubmitting(true)
    setRunning(true)
    try {
      await onRun({
        prompt: prompt.trim(),
        promptDocument,
        ...(hiddenFunctionalSystemPrompt
          ? { systemPrompt: hiddenFunctionalSystemPrompt }
          : {}),
        ...(negativePrompt.trim() ? { negativePrompt: negativePrompt.trim() } : {}),
        inputNodeIds: runInputNodeIds,
        ...(isTextOperation && selectedAgentId ? { agentId: selectedAgentId } : {}),
        ...(isTextOperation ? { skillIds: selectedSkillIds } : {}),
        ...(modelPrefersBase64Input(selectedModel)
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
        ...(resolvedShotScriptConfig ? { shotScriptConfig: resolvedShotScriptConfig } : {}),
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
    negativePrompt,
    operation,
    node.data.status,
    onRun,
    prompt,
    promptDocument,
    hiddenFunctionalSystemPrompt,
    resolveShotScriptConfig,
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
    mediaInputOptions,
    isTextOperation,
    selectedAgentId,
    selectedTextModelId,
    selectedTextProviderId,
    supportsImageRoles,
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
  const referenceMediaInputs = useMemo(
    () =>
      supportsVideoFrameRoles
        ? mediaInputs.filter(
            (item) => item.type !== 'image' || referenceFrameNodeIds.includes(item.id),
          )
        : mediaInputs,
    [mediaInputs, referenceFrameNodeIds, supportsVideoFrameRoles],
  )
  const showMediaStrip = canEditMediaInputs || referenceMediaInputs.length > 0
  const nodeById = useMemo(
    () => new Map(snapshot.nodes.map((item) => [item.id, item])),
    [snapshot.nodes],
  )
  const assetById = useMemo(
    () => new Map(snapshot.assets.map((item) => [item.id, item])),
    [snapshot.assets],
  )
  // 为每个媒体输入节点计算角色（首帧/尾帧/参考图/输入视频/参考视频/参考音频）和使用状态
  // （已用/未用/超额）。用于缩略图徽章：让用户一眼看到哪些图/视频被用到了、用作了什么角色。
  // 纯函数同时服务帧角色路径（image_to_video / video_edit）与纯参考图路径（video.generate
  // 多模态参考 / image.edit / image.variations / image.compose），后者修复了原来 !frameRoles
  // 就返回空 map、导致"拉了一堆参考图却看不到任何徽章/用量"的根因。
  const mediaInputRoleMap = useMemo(
    () =>
      computeMediaInputRoleMap({
        mediaInputs,
        selectedInputNodeIds,
        supportsFrameRoles: supportsVideoFrameRoles,
        supportsImageRoles,
        policy: selectedCapability
          ? inferRolePolicy(selectedCapability)
          : { defaultRoleAssignment: 'none' },
        maxImages: videoFrameMaxImages,
        firstFrameNodeId,
        lastFrameNodeId,
        referenceFrameNodeIds,
        explicitFrameNodeIds,
      }),
    [
      mediaInputs,
      selectedInputNodeIds,
      supportsVideoFrameRoles,
      supportsImageRoles,
      selectedCapability,
      videoFrameMaxImages,
      firstFrameNodeId,
      lastFrameNodeId,
      referenceFrameNodeIds,
      explicitFrameNodeIds,
    ],
  )
  const selectedCapabilityRolePolicy = useMemo(
    () =>
      selectedCapability ? inferRolePolicy(selectedCapability) : EMPTY_MEDIA_INPUT_ROLE_POLICY,
    [selectedCapability],
  )
  const selectedImageCount = useMemo(() => {
    if (supportsVideoFrameRoles) return selectedFrameCount
    const selectedSet = new Set(selectedInputNodeIds)
    return mediaInputs.filter((item) => item.type === 'image' && selectedSet.has(item.id)).length
  }, [mediaInputs, selectedFrameCount, selectedInputNodeIds, supportsVideoFrameRoles])
  const showMediaInputHint =
    selectedCapability != null && (supportsImageRoles || canEditMediaInputs)
  // 当前命中的 capability 标识：让用户一眼看出当前节点命中 manifest 的哪个能力
  // （如"图生视频（首帧/首尾帧）"、"文生视频 / 多模态参考"），hover 看图片上限/必填输入/支持角色。
  const capabilityTag = useMemo(() => {
    if (!selectedCapability) return null
    const policy = selectedCapabilityRolePolicy
    const roles = [
      ...(policy.imageRoles ?? []),
      ...(policy.videoRoles ?? []),
      ...(policy.audioRoles ?? []),
    ]
    const maxImages = selectedCapability.input.maxImages
    const required = selectedCapability.input.required
    return (
      <Tooltip
        title={
          <div style={{ fontSize: 12, lineHeight: '18px' }}>
            <div>能力：{selectedCapability.id}</div>
            <div>图片上限：{maxImages != null ? `${maxImages} 张` : '未限制'}</div>
            <div>必填输入：{required && required.length > 0 ? required.join('、') : '无'}</div>
            <div>支持角色：{roles.length > 0 ? roles.join('、') : '无'}</div>
          </div>
        }
      >
        <Tag color="blue" bordered>
          {selectedCapability.label || selectedCapability.id}
        </Tag>
      </Tooltip>
    )
  }, [selectedCapability, selectedCapabilityRolePolicy])
  const composerMediaPickerItems = useMemo<MediaInputPickerItem[]>(() => {
    const options = mediaInputOptions
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
  }, [
    assetById,
    firstFrameNodeId,
    lastFrameNodeId,
    mediaInputOptions,
    nodeById,
    supportsVideoFrameRoles,
  ])
  const composerMediaPickerSelectedIds = useMemo(() => {
    if (supportsVideoFrameRoles) {
      return [...selectedInputNodeIds, ...referenceFrameNodeIds].filter((id) =>
        composerMediaPickerItems.some((item) => item.id === id),
      )
    }
    return selectedInputNodeIds
  }, [
    composerMediaPickerItems,
    referenceFrameNodeIds,
    selectedInputNodeIds,
    supportsVideoFrameRoles,
  ])
  const applyComposerMediaSelection = useCallback(
    (values: string[]) => {
      if (!supportsVideoFrameRoles) {
        setSelectedInputNodeIds(values)
        return
      }
      const imageValueSet = new Set(
        mediaInputOptions
          .filter((option) => option.type === 'image')
          .map((option) => String(option.value)),
      )
      setReferenceFrameNodeIds(values.filter((id) => imageValueSet.has(id)))
      setSelectedInputNodeIds(values.filter((id) => !imageValueSet.has(id)))
    },
    [mediaInputOptions, supportsVideoFrameRoles],
  )
  const handleRemoveMediaInput = useCallback(
    (nodeId: string) => {
      setSelectedInputNodeIds((prev) => prev.filter((id) => id !== nodeId))
      setReferenceFrameNodeIds((prev) => prev.filter((id) => id !== nodeId))
      if (nodeId === firstFrameNodeId) setFirstFrameNodeId('')
      if (nodeId === lastFrameNodeId) setLastFrameNodeId('')
    },
    [firstFrameNodeId, lastFrameNodeId],
  )
  const promptConnectionNodes = useMemo(
    () =>
      Array.from(new Map(sourceInputNodes.map((item) => [item.id, item])).values()).filter(
        isCanvasPromptInlineConnection,
      ),
    [sourceInputNodes],
  )
  const promptCandidateNodes = useMemo(
    () => snapshot.nodes.filter((item) => !item.hidden && item.id !== node.id),
    [node.id, snapshot.nodes],
  )
  const handlePromptMentionSelect = useCallback(
    (selectedNode: CanvasNode) => {
      if (running) return false
      if (canEditMediaInputs) {
        if (supportsVideoFrameRoles && selectedNode.type === 'image') {
          setReferenceFrameNodeIds((prev) =>
            prev.includes(selectedNode.id) ? prev : [...prev, selectedNode.id],
          )
          return true
        }
        setSelectedInputNodeIds((prev) =>
          prev.includes(selectedNode.id) ? prev : [...prev, selectedNode.id],
        )
      }
      return true
    },
    [canEditMediaInputs, running, supportsVideoFrameRoles],
  )
  const textInputs = expandedSourceInputNodes.filter(
    (n) => n.type === 'text' || n.type === 'prompt',
  )
  const textInputContent = useCallback(
    (sourceNode: CanvasNode): string =>
      readCanvasOperationPanelTextInputContent(sourceNode, snapshot.assets),
    [snapshot.assets],
  )
  const visibleTextInputs = showAllTextInputs ? textInputs : textInputs.slice(0, 3)
  const frameLabel = (id: string) =>
    String(frameImageOptions.find((option) => String(option.value) === id)?.label ?? id)
  const renderMediaOptionLabel = (nodeId: string, fallback: ReactNode) => {
    const sourceNode = nodeById.get(nodeId)
    const asset = sourceNode?.assetId ? assetById.get(sourceNode.assetId) : undefined
    const previewUrl = sourceNode?.data.thumbnailUrl ?? sourceNode?.data.url ?? null
    return (
      <span className="canvas-operation-media-option-label">
        <span className="canvas-operation-media-option-thumb">
          {asset ? (
            <AssetThumbnail asset={asset} />
          ) : previewUrl ? (
            <img src={previewUrl} alt="" />
          ) : (
            <Icons.Image size={16} />
          )}
        </span>
        <span className="canvas-operation-media-option-name">{fallback}</span>
      </span>
    )
  }
  const renderTextClickSelector = ({
    pickerId,
    title,
    label,
    valueText,
    disabled,
    content,
    popoverClassName,
  }: {
    pickerId: string
    title: ReactNode
    label: ReactNode
    valueText?: string
    disabled?: boolean
    content: ReactNode
    popoverClassName?: string
  }) => (
    <Popover
      trigger="click"
      open={activeTextPickerId === pickerId}
      placement="bottomLeft"
      autoAdjustOverflow
      onOpenChange={(nextOpen) => {
        if (disabled) {
          setActiveTextPickerId(null)
          return
        }
        setActiveTextPickerId(nextOpen ? pickerId : null)
      }}
      content={
        <div
          className={operationPickerPopoverClassName(popoverClassName)}
          onMouseDown={(event) => event.stopPropagation()}
        >
          {content}
        </div>
      }
    >
      <button
        type="button"
        className={`canvas-operation-text-picker${disabled ? ' is-disabled' : ''}`}
        aria-label={typeof title === 'string' ? title : undefined}
        disabled={disabled}
        onClick={() => {
          if (!disabled) setActiveTextPickerId(pickerId)
        }}
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
          setActiveTextPickerId(null)
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
              if (!option.disabled) {
                onChange(option.value)
                setActiveTextPickerId(null)
              }
            }}
          >
            <span className="canvas-operation-text-option-label">{option.label}</span>
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
                    : [...selectedValues, option.value].slice(
                        0,
                        maxSelected ?? Number.MAX_SAFE_INTEGER,
                      ),
                )
              }}
            >
              <span className="canvas-operation-text-option-label">{option.label}</span>
              {active && <Icons.Check size={14} />}
            </button>
          )
        })}
      </div>
    )
  }

  const advancedParameterContent = (
    <div className="canvas-operation-unified-advanced-extras">
      {(operation.includes('image') || operation.includes('video')) && (
        <div className="canvas-operation-unified-advanced-block">
          <div className="canvas-operation-panel-section-label">反向提示词</div>
          <Input.TextArea
            rows={3}
            value={negativePrompt}
            placeholder="不希望出现的内容..."
            onChange={(event) => setNegativePrompt(event.target.value)}
            disabled={running}
          />
        </div>
      )}
      <div className="canvas-operation-unified-advanced-block">
        <div className="canvas-operation-panel-section-title-row">
          <div className="canvas-operation-panel-section-label">自定义参数</div>
          <Button
            size="small"
            type="text"
            icon={<Icons.Plus size={13} />}
            disabled={running}
            onClick={handleAddCustomParam}
          >
            添加
          </Button>
        </div>
        {customParams.length === 0 ? (
          <div className="canvas-operation-panel-hint">
            可添加模型私有参数，例如 negative_prompt、camera_control 或 Provider 专属字段。
          </div>
        ) : (
          <div className="canvas-operation-panel-custom-params">
            {customParams.map((param) => (
              <div key={param.id} className="canvas-operation-panel-custom-param">
                <Input
                  size="middle"
                  value={param.name}
                  placeholder="字段名"
                  disabled={running}
                  onChange={(event) =>
                    handleCustomParamPatch(param.id, { name: event.target.value })
                  }
                />
                <Select
                  size="middle"
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
                    disabled={running}
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
                    disabled={running}
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
                  disabled={running}
                  onClick={() => handleRemoveCustomParam(param.id)}
                />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )

  if (placement === 'inline' && !fullscreen) {
    return (
      <div
        className="canvas-operation-panel is-inline is-composer"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className={`canvas-operation-composer-top${showMediaStrip ? '' : ' has-no-media'}`}>
          <div className="canvas-operation-composer-media-inputs">
            {showMediaStrip ? (
              <div
                className={`canvas-operation-composer-media-strip${referenceMediaInputs.length === 0 ? ' is-add-only' : ''}`}
              >
                {referenceMediaInputs.map((n) => {
                  const asset = n.assetId ? snapshot.assets.find((a) => a.id === n.assetId) : null
                  return (
                    <CanvasMediaInputThumb
                      key={n.id}
                      asset={asset ?? null}
                      label={n.title ?? (n.type === 'video' ? '视频' : '图片')}
                      variant="composer"
                      role={mediaInputRoleMap.get(n.id)?.role}
                      usageStatus={mediaInputRoleMap.get(n.id)?.usageStatus ?? 'used'}
                      {...(canEditMediaInputs
                        ? {
                            onRemove: () => handleRemoveMediaInput(n.id),
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
                      aria-label="选择参考资源"
                      disabled={running || composerMediaPickerItems.length === 0}
                      onClick={() => setMediaPickerOpen(true)}
                    >
                      <Icons.Plus size={18} />
                      <span>参考资源</span>
                    </button>
                    <CanvasMediaInputPickerModal
                      open={mediaPickerOpen}
                      title={
                        supportsVideoFrameRoles
                          ? '选择参考资源'
                          : capability?.inputTypes.includes('video')
                            ? '选择参考图片 / 视频'
                            : '选择参考图片'
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
          </div>
          <div className="canvas-operation-composer-inputs">
            <label className="canvas-operation-composer-mini-field">
              <span>标题</span>
              <Input
                size="middle"
                value={titleDraft}
                placeholder={`${operationText}节点`}
                onChange={(event) => setTitleDraft(event.target.value)}
                disabled={running}
              />
            </label>
            <label className="canvas-operation-composer-mini-field is-message">
              <span>备注</span>
              <Input
                size="middle"
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
              <Button size="middle" type="text" onClick={() => setShowAllTextInputs((v) => !v)}>
                {showAllTextInputs ? '收起文本' : `+${textInputs.length - 3} 文本`}
              </Button>
            )}
            {showMediaInputHint ? (
              <CanvasMediaInputHint
                mode="composer"
                maxImages={videoFrameMaxImages}
                selectedImageCount={selectedImageCount}
                rolePolicy={selectedCapabilityRolePolicy}
                capabilityLabel={selectedCapability?.label}
                capabilityId={selectedCapability?.id}
              />
            ) : null}
          </div>
        </div>

        <div className="canvas-operation-composer-main">
          <div className="canvas-operation-prompt-count-wrap">
            <CanvasPromptMentionTextArea
              className="canvas-operation-composer-prompt"
              rows={6}
              value={prompt}
              document={promptDocument}
              placeholder={`输入${operationText}的提示词...`}
              mentionNodes={promptCandidateNodes}
              connectionNodes={promptConnectionNodes}
              assets={snapshot.assets}
              onChange={setPrompt}
              onDocumentChange={setPromptDocument}
              onMentionSelect={handlePromptMentionSelect}
              disabled={running}
            />
            <span className="canvas-operation-prompt-count">
              {promptCharCount.toLocaleString()} 字符
            </span>
          </div>
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
                {renderTextClickSelector({
                  pickerId: 'skills',
                  title: '选择 Skills',
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
                {isShotScriptNode && (
                  <div
                    className="canvas-operation-shot-config"
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      flexWrap: 'wrap',
                    }}
                  >
                    <span style={{ fontSize: 12, opacity: 0.7 }}>每镜最长</span>
                    <Select<number | 'custom'>
                      size="small"
                      style={{ width: 92 }}
                      value={maxClipPreset}
                      onChange={(v) => setMaxClipPreset(v)}
                      options={[
                        ...SHOT_MAX_CLIP_PRESETS.map((s) => ({ value: s, label: `${s} 秒` })),
                        { value: 'custom', label: '自定义' },
                      ]}
                    />
                    {maxClipPreset === 'custom' && (
                      <InputNumber
                        size="small"
                        min={1}
                        style={{ width: 90 }}
                        addonAfter="秒"
                        value={maxClipCustom.trim() === '' ? null : Number(maxClipCustom)}
                        onChange={(v) => setMaxClipCustom(v == null ? '' : String(v))}
                      />
                    )}
                  </div>
                )}
              </>
            )}
            {mediaCapabilityIds.length > 0 && (
              <CanvasOperationParameterControls
                variant="toolbar"
                models={supportedMediaModels}
                modelValue={selectedModelKey}
                modelLoading={modelsLoading}
                disabled={running}
                fields={parameterFields}
                values={modelParamDraft}
                advancedContent={advancedParameterContent}
                onModelChange={setSelectedModelKey}
                onParameterChange={handleModelParamDraftChange}
              />
            )}
            {supportsVideoFrameRoles && (
              <>
                {renderTextClickSelector({
                  pickerId: 'first-frame',
                  title: '选择首帧',
                  label: '首帧',
                  valueText: firstFrameNodeId ? frameLabel(firstFrameNodeId) : '未选择',
                  disabled: running,
                  content: renderSingleOptionList(
                    frameImageOptions.map((option) => ({
                      value: String(option.value),
                      label: renderMediaOptionLabel(String(option.value), option.label),
                    })),
                    firstFrameNodeId,
                    setFirstFrameNodeId,
                    '不指定首帧',
                  ),
                })}
                {renderTextClickSelector({
                  pickerId: 'last-frame',
                  title: '选择尾帧',
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
                      label: renderMediaOptionLabel(String(option.value), option.label),
                    })),
                    lastFrameNodeId,
                    setLastFrameNodeId,
                    canUseLastFrame ? '不指定尾帧' : '仅 1 张图',
                  ),
                })}
                {videoFrameMaxImages > 2 &&
                  renderTextClickSelector({
                    pickerId: 'reference-frames',
                    title: '选择参考图',
                    label: '参考图',
                    valueText:
                      referenceFrameNodeIds.length > 0
                        ? `${referenceFrameNodeIds.length} 张`
                        : '未选择',
                    disabled: running,
                    content: renderMultiOptionList(
                      frameImageOptions.map((option) => ({
                        value: String(option.value),
                        label: renderMediaOptionLabel(String(option.value), option.label),
                      })),
                      referenceFrameNodeIds,
                      setReferenceFrameNodeIds,
                      '清空参考图',
                    ),
                  })}
              </>
            )}
            {mediaCapabilityIds.length === 0 &&
              renderTextClickSelector({
                pickerId: 'custom-params',
                title: '自定义参数',
                label: '自定义参数',
                ...(customParams.length > 0 ? { valueText: `${customParams.length} 项` } : {}),
                disabled: running,
                popoverClassName: 'canvas-operation-composer-popover is-custom',
                content: advancedParameterContent,
              })}
          </div>
          <div className="canvas-operation-composer-actions">
            <Tooltip title="重试任务">
              <Button
                size="middle"
                type="text"
                aria-label="重试任务"
                icon={<Icons.RotateCcw size={14} />}
                disabled={running || outputNodes.length === 0}
                onClick={() => {
                  onRetry()
                  message.info('已发起重试，将在右侧生成新的产出节点')
                }}
              />
            </Tooltip>
            <Tooltip title="保存配置">
              <Button
                size="middle"
                type="text"
                aria-label="保存配置"
                icon={<Icons.Check size={14} />}
                loading={savingDraft}
                disabled={running || node.data.status === 'running'}
                onClick={() => void handleSaveDraft()}
              />
            </Tooltip>
            {(running || submitting || node.data.status === 'running') &&
              task?.id &&
              onCancelTask && (
                <Button
                  size="middle"
                  danger
                  type="text"
                  aria-label="取消任务"
                  icon={<Icons.XCircle size={13} />}
                  loading={cancelling}
                  onClick={() => void handleCancelTask()}
                />
              )}
            <Tooltip title={node.data.status === 'running' ? '运行中' : '提交任务'}>
              <Button
                size="middle"
                type="primary"
                className="canvas-operation-composer-submit"
                aria-label="提交任务"
                icon={<Icons.Send size={14} />}
                loading={running || submitting || node.data.status === 'running'}
                disabled={running || submitting || node.data.status === 'running'}
                onClick={() => void handleRun()}
              />
            </Tooltip>
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
      {placement !== 'inline' && (
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
                size="middle"
                type="text"
                icon={fullscreen ? <Icons.Minimize size={15} /> : <Icons.Maximize size={15} />}
                aria-label={fullscreen ? '退出全屏' : '全屏操作'}
                onClick={() => setFullscreen((current) => !current)}
              />
            </Tooltip>
            <Button size="middle" type="text" icon={<Icons.X size={15} />} onClick={onClose} />
          </div>
        </div>
      )}

      <div className="canvas-operation-panel-body">
        <div className="canvas-operation-panel-section canvas-operation-panel-section-node">
          <div className="canvas-operation-panel-section-label">节点信息</div>
          <div className="canvas-operation-panel-detail-grid">
            <label className="canvas-operation-panel-detail-field">
              <span>标题</span>
              <Input
                size="middle"
                value={titleDraft}
                placeholder={`${operationText}节点`}
                onChange={(event) => setTitleDraft(event.target.value)}
                disabled={running}
              />
            </label>
            <label className="canvas-operation-panel-detail-field">
              <span>备注 / 展示文本</span>
              <Input
                size="middle"
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
                  size="middle"
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
              {showMediaInputHint ? (
                <CanvasMediaInputHint
                  mode="panel"
                  maxImages={videoFrameMaxImages}
                  selectedImageCount={selectedImageCount}
                  rolePolicy={selectedCapabilityRolePolicy}
                  capabilityLabel={selectedCapability?.label}
                  capabilityId={selectedCapability?.id}
                />
              ) : null}
            </div>
            {canEditMediaInputs && (
              <>
                <Select
                  mode="multiple"
                  size="middle"
                  allowClear
                  showSearch
                  value={
                    supportsVideoFrameRoles
                      ? [...selectedInputNodeIds, ...referenceFrameNodeIds].filter((id) =>
                          mediaInputOptions.some((option) => option.value === id),
                        )
                      : selectedInputNodeIds
                  }
                  placeholder={
                    supportsVideoFrameRoles
                      ? '选择参考图片 / 视频节点'
                      : '选择或调整参考图片/视频节点'
                  }
                  options={mediaInputOptions}
                  optionFilterProp="label"
                  optionRender={(option) =>
                    renderMediaOptionLabel(
                      String(option.value),
                      String(option.label ?? option.value),
                    )
                  }
                  onChange={(value) => {
                    const values = value.map(String)
                    applyComposerMediaSelection(values)
                  }}
                  disabled={running}
                />
              </>
            )}
            {referenceMediaInputs.length > 0 ? (
              <div className="canvas-operation-panel-inputs">
                {referenceMediaInputs.map((n) => {
                  const asset = n.assetId ? snapshot.assets.find((a) => a.id === n.assetId) : null
                  return (
                    <CanvasMediaInputThumb
                      key={n.id}
                      asset={asset ?? null}
                      label={n.title ?? (n.type === 'video' ? '视频' : '图片')}
                      variant="panel"
                      role={mediaInputRoleMap.get(n.id)?.role}
                      usageStatus={mediaInputRoleMap.get(n.id)?.usageStatus ?? 'used'}
                      {...(canEditMediaInputs
                        ? {
                            onRemove: () => handleRemoveMediaInput(n.id),
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
                        ? textInputContent(n) || '(空)'
                        : textInputContent(n).slice(0, 80) || '(空)'}
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
              <Select
                mode="multiple"
                size="middle"
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
            <div className="canvas-operation-panel-section-label">模型与参数</div>
            <CanvasOperationParameterControls
              variant="panel"
              models={supportedMediaModels}
              modelValue={selectedModelKey}
              modelLoading={modelsLoading}
              disabled={running}
              fields={parameterFields}
              values={modelParamDraft}
              advancedContent={advancedParameterContent}
              modelMeta={
                <>
                  {capabilityTag}
                  <div className="canvas-operation-panel-hint">
                    {modelsLoading
                      ? '正在读取已启用模型...'
                      : supportedMediaModels.length > 0
                        ? `当前能力可用 ${supportedMediaModels.length} 个模型${selectedModel ? ` · ${selectedModel.effectiveModelId} · ${selectedModel.invocationMode}` : ''}`
                        : '当前能力暂无已启用模型，请先到 Provider 绑定。'}
                  </div>
                </>
              }
              onModelChange={setSelectedModelKey}
              onParameterChange={handleModelParamDraftChange}
            />
          </div>
        )}

        {supportsVideoFrameRoles && (
          <div className="canvas-operation-panel-section canvas-operation-panel-section-frame-params">
            <div className="canvas-operation-panel-section-label">视频帧 / 参考图</div>
            <div className="canvas-operation-panel-frame-roles">
              <div className="canvas-frame-role-grid">
                <div className="canvas-param-field">
                  {renderTextClickSelector({
                    pickerId: 'panel-first-frame',
                    title: '选择首帧',
                    label: '首帧',
                    valueText: firstFrameNodeId ? frameLabel(firstFrameNodeId) : '未选择',
                    disabled: running,
                    content: renderSingleOptionList(
                      frameImageOptions.map((option) => ({
                        value: String(option.value),
                        label: renderMediaOptionLabel(String(option.value), option.label),
                      })),
                      firstFrameNodeId,
                      setFirstFrameNodeId,
                      '不指定首帧',
                    ),
                  })}
                </div>
                <div className="canvas-param-field">
                  {renderTextClickSelector({
                    pickerId: 'panel-last-frame',
                    title: '选择尾帧',
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
                        label: renderMediaOptionLabel(String(option.value), option.label),
                      })),
                      lastFrameNodeId,
                      setLastFrameNodeId,
                      canUseLastFrame ? '不指定尾帧' : '仅 1 张图',
                    ),
                  })}
                </div>
              </div>
              {videoFrameMaxImages > 2 &&
                renderTextClickSelector({
                  pickerId: 'panel-reference-frames',
                  title: '选择参考图',
                  label: '参考图',
                  valueText:
                    referenceFrameNodeIds.length > 0
                      ? `${referenceFrameNodeIds.length} 张`
                      : '未选择',
                  disabled: running,
                  content: renderMultiOptionList(
                    frameImageOptions.map((option) => ({
                      value: String(option.value),
                      label: renderMediaOptionLabel(String(option.value), option.label),
                    })),
                    referenceFrameNodeIds,
                    setReferenceFrameNodeIds,
                    '清空参考图',
                  ),
                })}
            </div>
          </div>
        )}

        {/* Prompt 编辑 */}
        <div className="canvas-operation-panel-section canvas-operation-panel-section-prompt">
          <div className="canvas-operation-panel-section-label">提示词</div>
          <div className="canvas-operation-prompt-count-wrap">
            <CanvasPromptMentionTextArea
              className="canvas-operation-panel-prompt-input"
              rows={4}
              value={prompt}
              document={promptDocument}
              placeholder={`输入${operationText}的提示词...`}
              mentionNodes={promptCandidateNodes}
              connectionNodes={promptConnectionNodes}
              assets={snapshot.assets}
              onChange={setPrompt}
              onDocumentChange={setPromptDocument}
              onMentionSelect={handlePromptMentionSelect}
              disabled={running}
            />
            <span className="canvas-operation-prompt-count">
              {promptCharCount.toLocaleString()} 字符
            </span>
          </div>
        </div>

        {mediaCapabilityIds.length === 0 && (
          <div className="canvas-operation-panel-section canvas-operation-panel-section-custom">
          <div className="canvas-operation-panel-section-title-row">
            <div className="canvas-operation-panel-section-label">自定义参数</div>
            <Button
              size="middle"
              type="text"
              icon={<Icons.Plus size={13} />}
              disabled={running}
              onClick={handleAddCustomParam}
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
                    size="middle"
                    value={param.name}
                    placeholder="字段名"
                    disabled={running}
                    onChange={(event) =>
                      handleCustomParamPatch(param.id, { name: event.target.value })
                    }
                  />
                  <Select
                    size="middle"
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
                      disabled={running}
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
                      disabled={running}
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
                    disabled={running}
                    onClick={() => handleRemoveCustomParam(param.id)}
                  />
                </div>
              ))}
            </div>
          )}
          </div>
        )}
      </div>

      <div className="canvas-operation-panel-footer">
        <Tooltip title="重试任务">
          <Button
            size="middle"
            type="text"
            aria-label="重试任务"
            icon={<Icons.RotateCcw size={14} />}
            disabled={running || outputNodes.length === 0}
            onClick={() => {
              onRetry()
              message.info('已发起重试，将在右侧生成新的产出节点')
            }}
          />
        </Tooltip>
        <div className="canvas-operation-panel-footer-spacer" />
        <Tooltip title="保存配置">
          <Button
            size="middle"
            type="text"
            aria-label="保存配置"
            icon={<Icons.Check size={14} />}
            loading={savingDraft}
            disabled={running || node.data.status === 'running'}
            onClick={() => void handleSaveDraft()}
          />
        </Tooltip>
        {placement !== 'inline' && (
          <Tooltip title="关闭配置">
            <Button
              size="middle"
              type="text"
              aria-label="关闭配置"
              icon={<Icons.X size={14} />}
              onClick={onClose}
            />
          </Tooltip>
        )}
        <Tooltip title={node.data.status === 'running' ? '运行中' : '提交任务'}>
          <Button
            size="middle"
            type="primary"
            className="canvas-operation-composer-submit"
            aria-label="提交任务"
            icon={<Icons.Send size={14} />}
            loading={running || submitting || node.data.status === 'running'}
            disabled={running || submitting || node.data.status === 'running'}
            onClick={() => void handleRun()}
          />
        </Tooltip>
      </div>
    </div>
  )
})

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

/**
 * 能力是否接受文本输入（text/prompt）。
 * 接受文本输入的操作（如 panorama_360）可在仅有提示词、无图片节点时提交，
 * 不强制要求选择图片/视频节点。
 */
function operationAcceptsTextInput(inputTypes: readonly string[] | undefined): boolean {
  if (!inputTypes) return false
  return inputTypes.includes('text') || inputTypes.includes('prompt')
}

export function buildOperationPanelRunInputNodeIds(input: {
  selectedInputNodeIds: string[]
  explicitFrameNodeIds: string[]
  textInputNodeIds: string[]
  supportsVideoFrameRoles: boolean
  mediaInputOptions: Array<{ value: string; type: string }>
}): string[] {
  const explicitFrameSet = new Set(input.explicitFrameNodeIds)
  const mediaTypeById = new Map(input.mediaInputOptions.map((item) => [item.value, item.type]))
  const selectedIds = input.supportsVideoFrameRoles
    ? input.selectedInputNodeIds.filter((id) => {
        const type = mediaTypeById.get(id)
        return type !== 'image' || explicitFrameSet.has(id)
      })
    : input.selectedInputNodeIds
  return Array.from(
    new Set([...selectedIds, ...input.explicitFrameNodeIds, ...input.textInputNodeIds]),
  )
}

function modelPrefersBase64Input(model: CanvasMediaModelSummary | null | undefined): boolean {
  return model?.providerKind === 'xai' || model?.providerKind === 'agnes'
}

export function buildVideoFrameInputRoles(
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

export function mergeDefaultReferenceFrameNodeIds(
  currentIds: string[],
  defaultImageNodeIds: string[],
  candidateNodeIds: string[],
): string[] {
  const candidateSet = new Set(candidateNodeIds)
  const result: string[] = []
  const push = (id: string) => {
    if (!id || !candidateSet.has(id) || result.includes(id)) return
    result.push(id)
  }
  for (const id of currentIds) push(id)
  for (const id of defaultImageNodeIds) push(id)
  return sameIdList(result, currentIds) ? currentIds : result
}

function sameIdList(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index])
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

function operationStatusLabel(status: CanvasTask['status']): string {
  if (status === 'completed') return '已完成'
  if (status === 'failed') return '失败'
  if (status === 'cancelled') return '已取消'
  if (status === 'running') return '运行中'
  return '待提交'
}

import { memo, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Input, InputNumber, Popover, Select, Tag, Tooltip, message } from 'antd'
import { Button } from '@lobehub/ui'
import { Icons } from '../../Icons'
import { isProviderVisibleInUi } from '../../utils/auto-router-ui'
import { useProviderConfigVersion } from '../../hooks/useProviderConfigVersion'
import {
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
  type CanvasInputBinding,
  type CanvasMediaInputMode,
  type CanvasPromptDocument,
  type MediaCapabilityId,
} from '@spark/protocol'
import { operationLabel } from './canvas.api'
import { getCanvasCapability, isOperationNode, nodeOperation } from './canvas.capabilities'
import {
  mergeCanvasOperationPresetNegativePrompt,
  mergeCanvasPresetTargetModelParams,
  readCanvasResolvedPresetTarget,
  resolveCanvasPresetTarget,
  writeCanvasLastUsedPresetTarget,
} from './canvasOperationPresets'
import { DEFAULT_MAX_CLIP_SEC } from './canvasAgentPromptPresets'
import { buildReferenceImageInputRoles } from './canvasTaskInputFiles'
import { AgentPickerInline, ProviderModelPickerInline } from './CanvasAgentModal'
import { AssetThumbnail } from './CanvasAssetThumbnail'
import { CanvasPromptMentionTextArea } from './CanvasPromptMentionTextArea'
import { toCanvasPromptPlainText } from './canvasPromptDocument'
import {
  buildCanvasVisiblePromptDocument,
  stripCanvasFunctionalPromptInput,
} from './canvasPromptInitialization'
import { selectCanvasMediaCapability } from './canvasMediaCapabilitySelection'
import { canvasApi } from './canvas.api'
import { expandCanvasInputNodes } from './canvasWorkspaceTaskInput'
import { resolveCanvasOperationResourceNode } from './canvasOperationOutputModel'
import { readCanvasTextInputContent } from './canvasTextInputPresentation'
import { confirmVideoSubmission, isVideoSubmissionOperation } from './canvasVideoSubmissionGate'
import { useCanvasInputBindings } from './useCanvasInputBindings'
import { materializeCanvasInputBindingReferences } from './canvasInputBindings'
import { useCanvasOperationDraftAutosave } from './useCanvasOperationDraftAutosave'
import { CanvasTaskValidationError } from './canvasTaskSubmissionValidation'
import {
  readSkipCanvasParameterValidation,
  writeSkipCanvasParameterValidation,
} from './canvasParameterValidationPreferences'
import { confirmCanvasTaskValidation } from './canvasTaskValidationWarning'
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
import { CanvasOperationMediaInput } from './CanvasOperationMediaInput'
import { CanvasDepthModelNotice } from './CanvasDepthModelNotice'
import {
  buildOperationPanelRunInputNodeIds,
  buildVideoFrameInputRoles,
  modelPrefersBase64Input,
  normalizeVideoFrameNodeIds,
  operationStatusLabel,
} from './canvasOperationPanelInputModel'
export {
  buildOperationPanelRunInputNodeIds,
  buildVideoFrameInputRoles,
  mergeDefaultReferenceFrameNodeIds,
} from './canvasOperationPanelInputModel'
import { CanvasMediaInputConfigurator } from './CanvasMediaInputConfigurator'
import {
  useCanvasMediaInputQuickActions,
  type CanvasMediaInputQuickKind,
} from './useCanvasMediaInputQuickActions'
import {
  resolveCanvasDepthSubmitLabel,
  resolveCanvasOperationPanelMode,
  type CanvasDepthModelState,
} from './canvasOperationPanelMode'
import { isImageUnderstandingProvider } from './canvasPresetCenterModel'
import {
  applyCanvasMediaInputModeToBindings,
  canvasInputRolesFromBindings,
  canvasMediaCapabilityIdsForOperation,
  canvasMediaInputAssignments,
  canvasMediaInputModeIssue,
  canvasMediaInputModeOptions,
  capabilityIdForCanvasMediaInputMode,
  executionCanvasInputBindings,
  moveCanvasMediaInputBinding,
  resolveCanvasMediaInputMode,
} from './canvasMediaInputMode'
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
  inputBindings?: CanvasInputBinding[]
  mediaInputMode?: CanvasMediaInputMode
  capabilityId?: MediaCapabilityId
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
  /** User-confirmed opt-out from renderer-side parameter preflight. */
  skipParameterValidation?: boolean
  /** 分镜任务的时长配置（每镜最长时间），运行时替换 prompt 占位槽 {maxClip} */
  shotScriptConfig?: ShotScriptConfig
}

export type OperationDraftParams = {
  message: string
  prompt: string
  promptDocument?: CanvasPromptDocument
  inputBindings?: CanvasInputBinding[]
  mediaInputMode?: CanvasMediaInputMode
  capabilityId?: MediaCapabilityId
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
    params.nodeNegativePrompt?.trim() ||
    params.taskNegativePrompt?.trim() ||
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
  if (
    presetTargetId === 'screenplay.extract_characters' ||
    presetTargetId === 'screenplay.extract_scenes' ||
    presetTargetId === 'screenplay.extract_props' ||
    presetTargetId === 'screenplay.extract_effects'
  ) {
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

export function buildOperationPanelPromptOwnerNodeIds(
  snapshot: CanvasSnapshot,
): ReadonlyMap<string, readonly string[]> {
  const ownersBySourceNodeId = new Map<string, string[]>()
  for (const ownerNode of snapshot.nodes) {
    if (ownerNode.type !== 'group' && !isOperationNode(ownerNode)) continue
    for (const sourceNode of expandCanvasInputNodes([ownerNode], snapshot)) {
      if (sourceNode.id === ownerNode.id) continue
      const owners = ownersBySourceNodeId.get(sourceNode.id) ?? []
      if (!owners.includes(ownerNode.id)) owners.push(ownerNode.id)
      ownersBySourceNodeId.set(sourceNode.id, owners)
    }
  }
  return ownersBySourceNodeId
}

export function expandOperationPanelPromptNodeIds(
  nodeIds: readonly string[],
  snapshot: CanvasSnapshot,
): string[] {
  const nodeById = new Map(snapshot.nodes.map((node) => [node.id, node]))
  const expandedIds = new Set<string>()
  for (const nodeId of nodeIds) {
    expandedIds.add(nodeId)
    const node = nodeById.get(nodeId)
    if (!node) continue
    for (const sourceNode of expandCanvasInputNodes([node], snapshot)) {
      expandedIds.add(sourceNode.id)
    }
  }
  return Array.from(expandedIds)
}

export function materializeOperationPanelPromptNodeIds(
  nodeIds: readonly string[],
  snapshot: CanvasSnapshot,
): string[] {
  const nodeById = new Map(snapshot.nodes.map((node) => [node.id, node]))
  const materializedIds = new Set<string>()
  for (const nodeId of nodeIds) {
    const node = nodeById.get(nodeId)
    if (!node) continue
    for (const sourceNode of expandCanvasInputNodes([node], snapshot)) {
      materializedIds.add(sourceNode.id)
    }
  }
  return Array.from(materializedIds)
}

export function resolveOperationPanelActualInputNodes(
  bindings: readonly CanvasInputBinding[],
  nodes: readonly CanvasNode[],
): CanvasNode[] {
  const nodeById = new Map(nodes.map((node) => [node.id, node]))
  const seen = new Set<string>()
  return [...bindings]
    .filter((binding) => binding.enabled)
    .sort((left, right) => left.order - right.order || left.id.localeCompare(right.id))
    .flatMap((binding) => {
      if (seen.has(binding.sourceNodeId)) return []
      const node = nodeById.get(binding.sourceNodeId)
      if (!node) return []
      seen.add(binding.sourceNodeId)
      return [node]
    })
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
  onRequestCanvasNodePick,
  onUploadLocalFile,
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
  onRequestCanvasNodePick?: (onPick: (node: CanvasNode) => void) => void
  onUploadLocalFile?: (file: File) => Promise<CanvasNode | null | undefined>
  /** 强制取消当前任务；不传则不渲染取消按钮 */
  onCancelTask?: (taskId: string) => Promise<void> | void
  fullscreen?: boolean
  onFullscreenChange?: (nextFullscreen: boolean) => void
}) {
  const providerConfigVersion = useProviderConfigVersion()
  const operation = nodeOperation(node) ?? 'text_generate'
  const capability = getCanvasCapability(operation)
  const operationText = operationLabel(operation)
  const panelMode = resolveCanvasOperationPanelMode(operation)
  const dedicatedMediaKind = panelMode.dedicatedMediaKind
  const [depthModelState, setDepthModelState] = useState<CanvasDepthModelState>('unknown')
  const [depthModelError, setDepthModelError] = useState('')
  const isTextOperation = panelMode.executionKind === 'text'
  const usesTextRuntime = panelMode.runtimeKind === 'text_full'
  useEffect(() => {
    if (!panelMode.showLocalDepthNotice) return
    let active = true
    void window.spark
      .invoke('canvas:depth-model:status', {})
      .then((status) => {
        if (!active) return
        setDepthModelState(status.state)
        setDepthModelError(status.error ?? '')
      })
      .catch((error) => {
        if (!active) return
        setDepthModelState('error')
        setDepthModelError(error instanceof Error ? error.message : String(error))
      })
    return () => {
      active = false
    }
  }, [panelMode.showLocalDepthNotice])
  const submitLabel = panelMode.showLocalDepthNotice
    ? resolveCanvasDepthSubmitLabel(depthModelState)
    : panelMode.submitLabel
  // 分镜脚本任务节点（带结构化时长配置）才渲染「每镜时长 / 平均镜时」控件。
  const isShotScriptNode =
    node.data.operation === 'text_generate' && node.data.shotScriptConfig != null
  const presetTargetId = useMemo(
    () =>
      resolveCanvasPresetTarget({
        operation,
        taskPipelineRole: node.data.pipelineRole ?? task?.taskPipelineRole ?? null,
        outputPipelineRole: node.data.outputPipelineRole ?? task?.outputPipelineRole ?? null,
        workflow: node.data.modelParams?.workflow ?? task?.modelParams?.workflow,
      }),
    [
      node.data.modelParams?.workflow,
      node.data.outputPipelineRole,
      node.data.pipelineRole,
      operation,
      task?.outputPipelineRole,
      task?.taskPipelineRole,
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
    capability?.inputTypes.some(
      (type) => type === 'image' || type === 'video' || type === 'audio',
    ) ?? false

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
  const promptOwnerNodeIdsBySourceNodeId = useMemo(
    () => buildOperationPanelPromptOwnerNodeIds(snapshot),
    [snapshot],
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
          if (item.type !== 'image' && item.type !== 'video' && item.type !== 'audio') return false
          if (item.type === 'video' && !capability?.inputTypes.includes('video')) return false
          if (item.type === 'image' && !capability?.inputTypes.includes('image')) return false
          if (item.type === 'audio' && !capability?.inputTypes.includes('audio')) return false
          return true
        })
        .sort((left, right) => left.x - right.x || left.y - right.y || left.zIndex - right.zIndex)
        .map((item, index) => ({
          value: item.id,
          label:
            item.title ??
            (item.type === 'video'
              ? `视频 ${index + 1}`
              : item.type === 'audio'
                ? `音频 ${index + 1}`
                : `图片 ${index + 1}`),
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
      node.data.systemPrompt?.trim() ||
      task?.systemPrompt?.trim() ||
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
  const initialPromptDocument = useMemo(() => {
    const visibleDocument = buildOperationPanelEditablePromptDocument({
      ...(node.data.promptDocument
        ? { document: node.data.promptDocument }
        : task?.promptDocument
          ? { document: task.promptDocument }
          : {}),
      editablePrompt: initialPrompt,
      hideFunctionalPrompt,
      nodes: snapshot.nodes,
      connections: sourceInputNodes,
      assets: snapshot.assets,
    })
    return materializeCanvasInputBindingReferences({
      document: visibleDocument,
      bindings: node.data.inputBindings ?? task?.inputBindings ?? [],
      nodes: snapshot.nodes,
      promptOwnerNodeIdsBySourceNodeId,
    })
  }, [
    sourceInputNodes,
    hideFunctionalPrompt,
    initialPrompt,
    node.data.promptDocument,
    node.data.inputBindings,
    promptOwnerNodeIdsBySourceNodeId,
    snapshot.assets,
    snapshot.nodes,
    task?.inputBindings,
    task?.promptDocument,
  ])
  const bindingConnectionNodeIds = useMemo(
    () =>
      (canEditMediaInputs ? editableSourceMediaNodes : expandedSourceInputNodes).map(
        (item) => item.id,
      ),
    [canEditMediaInputs, editableSourceMediaNodes, expandedSourceInputNodes],
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
  const {
    document: promptDocument,
    setDocument: setPromptDocument,
    bindings: inputBindings,
    setBindings: setInputBindings,
    selectedInputNodeIds,
    setSelectedInputNodeIds,
    firstFrameNodeId,
    setFirstFrameNodeId,
    lastFrameNodeId,
    setLastFrameNodeId,
    referenceFrameNodeIds,
    setReferenceFrameNodeIds,
    removeNode: removeInputNode,
  } = useCanvasInputBindings({
    resetKey: node.id,
    initialDocument: initialPromptDocument,
    ...(node.data.inputBindings
      ? { initialBindings: node.data.inputBindings }
      : task?.inputBindings
        ? { initialBindings: task.inputBindings }
        : {}),
    nodes: snapshot.nodes,
    connectionNodeIds: bindingConnectionNodeIds,
    promptOwnerNodeIdsBySourceNodeId,
  })
  const [negativePrompt, setNegativePrompt] = useState(inheritedNegativePrompt)
  const [mediaModels, setMediaModels] = useState<CanvasMediaModelSummary[]>([])
  const [modelsLoading, setModelsLoading] = useState(false)
  const [selectedModelKey, setSelectedModelKey] = useState('')
  const [mediaInputMode, setMediaInputMode] = useState<CanvasMediaInputMode | undefined>(
    node.data.mediaInputMode ?? task?.mediaInputMode,
  )
  const [agents, setAgents] = useState<ManagedAgent[]>([])
  const [providers, setProviders] = useState<ProviderProfile[]>([])
  const [skills, setSkills] = useState<SkillItem[]>([])
  const [runtimeLoading, setRuntimeLoading] = useState(false)
  const [selectedAgentId, setSelectedAgentId] = useState(
    node.data.agentId ?? task?.agentId ?? operationPreset.agentId ?? '',
  )
  const [selectedTextProviderId, setSelectedTextProviderId] = useState(
    node.data.providerProfileId ??
      task?.providerProfileId ??
      operationPreset.providerProfileId ??
      '',
  )
  const [selectedTextModelId, setSelectedTextModelId] = useState(
    node.data.modelId ?? task?.modelId ?? operationPreset.modelId ?? '',
  )
  const [selectedSkillIds, setSelectedSkillIds] = useState<string[]>(
    node.data.skillIds ?? task?.skillIds ?? operationPreset.skillIds,
  )
  const [openRuntimeMenu, setOpenRuntimeMenu] = useState<RuntimePickerMenu>(null)
  const [modelParamDraft, setModelParamDraft] = useState<Record<string, string>>({})
  const [customParams, setCustomParams] = useState<CustomParamDraft[]>([])
  const [running, setRunning] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [draftRevision, setDraftRevision] = useState(0)
  const [cancelling, setCancelling] = useState(false)
  const [messageDraft, setMessageDraft] = useState(node.data.message ?? '')
  const [pendingDedicatedMediaNode, setPendingDedicatedMediaNode] = useState<CanvasNode | null>(
    null,
  )
  const [activeTextPickerId, setActiveTextPickerId] = useState<string | null>(null)
  const [maxClipPreset, setMaxClipPreset] = useState<number | 'custom'>('custom')
  const [maxClipCustom, setMaxClipCustom] = useState('')
  const modelParamDraftEditedRef = useRef(false)
  const customParamsEditedRef = useRef(false)
  const configurationTouchedRef = useRef(false)
  const markDraftDirty = useCallback(() => setDraftRevision((revision) => revision + 1), [])
  const markConfigurationTouched = useCallback(() => {
    configurationTouchedRef.current = true
    markDraftDirty()
  }, [markDraftDirty])
  const handlePromptChange = useCallback(
    (value: string) => {
      markDraftDirty()
      setPrompt(value)
    },
    [markDraftDirty],
  )
  const handleMessageDraftChange = useCallback(
    (value: string) => {
      markDraftDirty()
      setMessageDraft(value)
    },
    [markDraftDirty],
  )
  const promptCharCount = useMemo(
    () => toCanvasPromptPlainText(promptDocument).trim().length,
    [promptDocument],
  )

  useEffect(() => {
    modelParamDraftEditedRef.current = false
    customParamsEditedRef.current = false
    setPrompt(initialPrompt)
    setPromptDocument(initialPromptDocument)
    setNegativePrompt(inheritedNegativePrompt)
    setMessageDraft(node.data.message ?? '')
    setMediaInputMode(node.data.mediaInputMode ?? task?.mediaInputMode)
    setSelectedAgentId(node.data.agentId ?? task?.agentId ?? operationPreset.agentId ?? '')
    setSelectedTextProviderId(
      node.data.providerProfileId ??
        task?.providerProfileId ??
        operationPreset.providerProfileId ??
        '',
    )
    setSelectedTextModelId(node.data.modelId ?? task?.modelId ?? operationPreset.modelId ?? '')
    setSelectedSkillIds(node.data.skillIds ?? task?.skillIds ?? operationPreset.skillIds)
    configurationTouchedRef.current = false
    const rawMaxClip = node.data.shotScriptConfig?.maxClipSec
    const safeMaxClip =
      typeof rawMaxClip === 'number' && Number.isFinite(rawMaxClip) && rawMaxClip > 0
        ? rawMaxClip
        : DEFAULT_MAX_CLIP_SEC
    setMaxClipPreset(SHOT_MAX_CLIP_PRESETS.includes(safeMaxClip) ? safeMaxClip : 'custom')
    setMaxClipCustom(SHOT_MAX_CLIP_PRESETS.includes(safeMaxClip) ? '' : String(safeMaxClip))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [node.id, task?.id])

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
  }, [providerConfigVersion])

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
  }, [isTextOperation, providerConfigVersion])

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

  const mediaCapabilityIds = useMemo(
    () => canvasMediaCapabilityIdsForOperation(operation),
    [operation],
  )
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
    () =>
      providers.filter((provider) =>
        panelMode.runtimeKind === 'vision_model'
          ? isImageUnderstandingProvider(provider)
          : isTextProviderProfile(provider),
      ),
    [panelMode.runtimeKind, providers],
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
      (node.data.agentId ? agents.find((agent) => agent.id === node.data.agentId) : null) ??
      (task?.agentId ? agents.find((agent) => agent.id === task.agentId) : null) ??
      presetAgent ??
      pickDefaultTextAgent(agents)
    // 旧节点缺 providerProfileId 时避免把 modelId 误归到 Agent 默认 Provider。
    const persistedModelId =
      node.data.modelId ?? task?.modelId ?? operationPreset.modelId ?? defaultAgent?.modelId
    const modelOwner = persistedModelId
      ? textProviders.find((provider) => getProviderTextModels(provider).includes(persistedModelId))
      : null
    const explicitProviderId =
      node.data.providerProfileId ?? task?.providerProfileId ?? operationPreset.providerProfileId
    const explicitProvider = explicitProviderId
      ? textProviders.find((provider) => provider.id === explicitProviderId)
      : null
    const explicitProviderSupportsModel =
      persistedModelId == null ||
      (explicitProvider == null
        ? explicitProviderId == null
        : getProviderTextModels(explicitProvider).includes(persistedModelId))
    const preferredProviderId =
      modelOwner != null && !explicitProviderSupportsModel
        ? modelOwner.id
        : (explicitProviderId ?? modelOwner?.id ?? defaultAgent?.providerProfileId)
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
    node.data.modelId,
    node.data.providerProfileId,
    operationPreset.agentId,
    operationPreset.modelId,
    operationPreset.providerProfileId,
    runtimeLoading,
    task?.agentId,
    task?.modelId,
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
      (node.data.agentId ? agents.find((agent) => agent.id === node.data.agentId) : null) ??
      (task?.agentId ? agents.find((agent) => agent.id === task.agentId) : null) ??
      presetAgent ??
      pickDefaultTextAgent(agents)

    setSelectedTextModelId((current) => {
      const models = getProviderTextModels(provider)
      if (current && (models.length === 0 || models.includes(current))) return current
      return pickDefaultTextModel(
        provider,
        node.data.modelId ?? task?.modelId ?? operationPreset.modelId ?? defaultAgent?.modelId,
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
  const mediaInputModeOptions = useMemo(
    () => canvasMediaInputModeOptions(operation, selectedModel),
    [operation, selectedModel],
  )
  const effectiveMediaInputMode = useMemo(
    () =>
      resolveCanvasMediaInputMode({
        preferred: mediaInputMode,
        operation,
        options: mediaInputModeOptions,
        bindings: inputBindings,
      }),
    [inputBindings, mediaInputMode, mediaInputModeOptions, operation],
  )
  const selectedMediaInputModeOption = useMemo(
    () => mediaInputModeOptions.find((option) => option.mode === effectiveMediaInputMode),
    [effectiveMediaInputMode, mediaInputModeOptions],
  )
  const selectedCapability = useMemo(() => {
    if (!selectedModel) return null
    if (selectedMediaInputModeOption) return selectedMediaInputModeOption.capability
    return selectCanvasMediaCapability({
      operation,
      model: selectedModel,
      selectedInputNodeIds,
      mediaInputOptions: mediaInputOptions.map((item) => ({
        value: String(item.value),
        type: item.type,
      })),
      firstFrameNodeId,
      lastFrameNodeId,
      referenceFrameNodeIds,
    })
  }, [
    firstFrameNodeId,
    lastFrameNodeId,
    mediaInputOptions,
    operation,
    referenceFrameNodeIds,
    selectedInputNodeIds,
    selectedModel,
    selectedMediaInputModeOption,
  ])
  const normalizedInputBindings = useMemo(
    () =>
      effectiveMediaInputMode && selectedMediaInputModeOption
        ? applyCanvasMediaInputModeToBindings({
            bindings: inputBindings,
            mode: effectiveMediaInputMode,
            option: selectedMediaInputModeOption,
          })
        : inputBindings,
    [effectiveMediaInputMode, inputBindings, selectedMediaInputModeOption],
  )
  const executionInputBindings = useMemo(
    () =>
      effectiveMediaInputMode && selectedMediaInputModeOption
        ? executionCanvasInputBindings({
            bindings: inputBindings,
            mode: effectiveMediaInputMode,
            option: selectedMediaInputModeOption,
          })
        : inputBindings,
    [effectiveMediaInputMode, inputBindings, selectedMediaInputModeOption],
  )
  const mediaInputAssignments = useMemo(
    () =>
      effectiveMediaInputMode && selectedMediaInputModeOption
        ? canvasMediaInputAssignments({
            bindings: inputBindings,
            mode: effectiveMediaInputMode,
            option: selectedMediaInputModeOption,
          })
        : [],
    [effectiveMediaInputMode, inputBindings, selectedMediaInputModeOption],
  )
  const selectedCapabilityId = capabilityIdForCanvasMediaInputMode(
    effectiveMediaInputMode,
    mediaInputModeOptions,
  )
  const selectedMediaInputIssue = selectedMediaInputModeOption
    ? canvasMediaInputModeIssue(selectedMediaInputModeOption, inputBindings)
    : undefined
  const handleMediaInputModeChange = useCallback(
    (mode: CanvasMediaInputMode) => {
      markConfigurationTouched()
      setMediaInputMode(mode)
    },
    [markConfigurationTouched],
  )
  const handleMediaInputMove = useCallback(
    (sourceNodeId: string, direction: -1 | 1) => {
      markConfigurationTouched()
      setInputBindings((current) => moveCanvasMediaInputBinding(current, sourceNodeId, direction))
    },
    [markConfigurationTouched, setInputBindings],
  )
  const handleMediaInputRemove = useCallback(
    (sourceNodeId: string) => {
      markConfigurationTouched()
      removeInputNode(sourceNodeId)
    },
    [markConfigurationTouched, removeInputNode],
  )
  const mediaInputQuickKinds = useMemo<CanvasMediaInputQuickKind[]>(() => {
    const policy = selectedMediaInputModeOption?.rolePolicy
    return [
      ...(policy?.imageRoles?.length ? (['image'] as const) : []),
      ...(policy?.videoRoles?.length ? (['video'] as const) : []),
      ...(policy?.audioRoles?.length ? (['audio'] as const) : []),
    ]
  }, [selectedMediaInputModeOption])
  const appendQuickMediaInput = useCallback(
    (mediaNode: CanvasNode) => {
      setSelectedInputNodeIds((current) => Array.from(new Set([...current, mediaNode.id])))
      markConfigurationTouched()
    },
    [markConfigurationTouched, setSelectedInputNodeIds],
  )
  const mediaInputQuickActions = useCanvasMediaInputQuickActions({
    nodes: snapshot.nodes,
    acceptedKinds: mediaInputQuickKinds,
    onRequestCanvasNodePick,
    onUploadLocalFile,
    onAppendNode: appendQuickMediaInput,
    onInvalidNode: () => message.warning('所选素材类型不适用于当前生成模式'),
  })
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
  const promptReferencedNodeIds = useMemo(
    () => new Set(readActiveOperationPromptNodeIds(promptDocument)),
    [promptDocument],
  )
  const expandedPromptReferencedNodeIds = useMemo(
    () => new Set(expandOperationPanelPromptNodeIds(Array.from(promptReferencedNodeIds), snapshot)),
    [promptReferencedNodeIds, snapshot],
  )
  const frameImageOptions = useMemo(
    () =>
      mediaInputOptions.filter(
        (option) => option.type === 'image' && expandedPromptReferencedNodeIds.has(option.value),
      ),
    [expandedPromptReferencedNodeIds, mediaInputOptions],
  )
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
          node.data.providerProfileId ??
          task?.providerProfileId ??
          operationPreset.providerProfileId
        ) ||
          model.providerProfileId ===
            (node.data.providerProfileId ??
              task?.providerProfileId ??
              operationPreset.providerProfileId)) &&
        (!(node.data.manifestId ?? task?.manifestId ?? operationPreset.manifestId) ||
          model.manifestId ===
            (node.data.manifestId ?? task?.manifestId ?? operationPreset.manifestId)) &&
        (!(node.data.modelId ?? task?.modelId ?? operationPreset.modelId) ||
          model.effectiveModelId ===
            (node.data.modelId ?? task?.modelId ?? operationPreset.modelId)),
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
    const existing = node.data.modelParams ?? task?.modelParams ?? {}
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
        ? mergeSeededModelParamDraft(prev, next, parameterFields)
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
      mergeCanvasPresetTargetModelParams(
        presetTargetId,
        normalizeModelParamsForSubmit(
          {
            ...buildModelParams(parameterFields, modelParamDraft),
            ...buildCustomModelParams(customParams),
          },
          selectedCapability?.defaults ?? {},
          parameterFields,
        ),
      ),
    [customParams, modelParamDraft, parameterFields, presetTargetId, selectedCapability?.defaults],
  )

  const handleTextAgentChange = useCallback(
    (agentId: string) => {
      const nextAgent = agents.find((agent) => agent.id === agentId)
      if (nextAgent == null) return
      markConfigurationTouched()
      const nextProvider = pickDefaultTextProvider(
        textProviders,
        nextAgent.providerProfileId ?? selectedTextProvider?.id,
      )
      setSelectedAgentId(agentId)
      setSelectedTextProviderId(nextProvider?.id ?? '')
      setSelectedTextModelId(pickDefaultTextModel(nextProvider, nextAgent.modelId))
    },
    [agents, markConfigurationTouched, selectedTextProvider?.id, textProviders],
  )

  const handleTextProviderModelChange = useCallback(
    (providerId: string, modelId: string) => {
      markConfigurationTouched()
      setSelectedTextProviderId(providerId)
      setSelectedTextModelId(modelId)
    },
    [markConfigurationTouched],
  )

  const handleSelectedModelChange = useCallback(
    (modelKey: string) => {
      markConfigurationTouched()
      setSelectedModelKey(modelKey)
    },
    [markConfigurationTouched],
  )

  const handleSkillIdsChange = useCallback(
    (skillIds: string[]) => {
      markConfigurationTouched()
      setSelectedSkillIds(skillIds)
    },
    [markConfigurationTouched],
  )

  const handleNegativePromptChange = useCallback(
    (value: string) => {
      markConfigurationTouched()
      setNegativePrompt(value)
    },
    [markConfigurationTouched],
  )

  const handleModelParamDraftChange = useCallback(
    (fieldName: string, value: string) => {
      markConfigurationTouched()
      modelParamDraftEditedRef.current = true
      setModelParamDraft((prev) => updateModelParamDraftValue(prev, fieldName, value))
    },
    [markConfigurationTouched],
  )

  const handleCustomParamPatch = useCallback(
    (id: string, patch: Partial<CustomParamDraft>) => {
      markConfigurationTouched()
      customParamsEditedRef.current = true
      updateCustomParam(setCustomParams, id, patch)
    },
    [markConfigurationTouched],
  )

  const handleAddCustomParam = useCallback(() => {
    markConfigurationTouched()
    customParamsEditedRef.current = true
    setCustomParams((prev) => [...prev, createCustomParamDraft()])
  }, [markConfigurationTouched])

  const handleRemoveCustomParam = useCallback(
    (id: string) => {
      markConfigurationTouched()
      customParamsEditedRef.current = true
      setCustomParams((prev) => prev.filter((item) => item.id !== id))
    },
    [markConfigurationTouched],
  )

  const buildRuntimeDraft = useCallback(
    (): Pick<
      OperationDraftParams,
      'agentId' | 'providerProfileId' | 'manifestId' | 'modelId' | 'skillIds'
    > => ({
      ...(usesTextRuntime && selectedAgentId ? { agentId: selectedAgentId } : {}),
      ...(usesTextRuntime ? { skillIds: selectedSkillIds } : {}),
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
      usesTextRuntime,
    ],
  )

  const persistLastUsedPreset = useCallback(() => {
    if (!configurationTouchedRef.current) return
    const runtimeDraft = buildRuntimeDraft()
    const modelParams = buildCurrentModelParams()
    writeCanvasLastUsedPresetTarget(presetTargetId, {
      ...(negativePrompt.trim() ? { negativePrompt: negativePrompt.trim() } : {}),
      ...(runtimeDraft.agentId ? { agentId: runtimeDraft.agentId } : {}),
      ...(runtimeDraft.providerProfileId
        ? { providerProfileId: runtimeDraft.providerProfileId }
        : {}),
      ...(runtimeDraft.manifestId ? { manifestId: runtimeDraft.manifestId } : {}),
      ...(runtimeDraft.modelId ? { modelId: runtimeDraft.modelId } : {}),
      ...(runtimeDraft.skillIds ? { skillIds: runtimeDraft.skillIds } : {}),
      ...(Object.keys(modelParams).length > 0 ? { modelParams } : {}),
    })
  }, [buildCurrentModelParams, buildRuntimeDraft, negativePrompt, presetTargetId])

  const handleClose = useCallback(() => {
    persistLastUsedPreset()
    onClose()
  }, [onClose, persistLastUsedPreset])

  const persistOnUnmountRef = useRef(persistLastUsedPreset)
  useEffect(() => {
    persistOnUnmountRef.current = persistLastUsedPreset
  }, [persistLastUsedPreset])
  useEffect(() => {
    return () => persistOnUnmountRef.current()
  }, [])

  const resolveShotScriptConfig = useCallback((): ShotScriptConfig | null => {
    if (!isShotScriptNode) return null
    const parsed = maxClipPreset === 'custom' ? Number(maxClipCustom) : maxClipPreset
    const maxClipSec = Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_MAX_CLIP_SEC
    return { maxClipSec }
  }, [isShotScriptNode, maxClipPreset, maxClipCustom])

  const operationDraft = useMemo<OperationDraftParams>(() => {
    const runtimeDraft = buildRuntimeDraft()
    const shotConfig = resolveShotScriptConfig()
    return {
      message: messageDraft.trim(),
      prompt: prompt.trim(),
      promptDocument,
      inputBindings: normalizedInputBindings,
      ...(effectiveMediaInputMode ? { mediaInputMode: effectiveMediaInputMode } : {}),
      ...(selectedCapabilityId ? { capabilityId: selectedCapabilityId } : {}),
      ...(hiddenFunctionalSystemPrompt ? { systemPrompt: hiddenFunctionalSystemPrompt } : {}),
      negativePrompt: negativePrompt.trim(),
      modelParams: buildCurrentModelParams(),
      ...runtimeDraft,
      ...(shotConfig ? { shotScriptConfig: shotConfig } : {}),
    }
  }, [
    buildCurrentModelParams,
    buildRuntimeDraft,
    hiddenFunctionalSystemPrompt,
    effectiveMediaInputMode,
    messageDraft,
    negativePrompt,
    prompt,
    promptDocument,
    resolveShotScriptConfig,
    normalizedInputBindings,
    selectedCapabilityId,
  ])
  const {
    saving: savingDraft,
    saveNow: saveDraftNow,
    tooltip: saveDraftTooltip,
  } = useCanvasOperationDraftAutosave({
    draft: operationDraft,
    revision: draftRevision,
    onSave: onSaveDraft,
  })
  const handleSaveDraft = useCallback(async () => {
    try {
      await saveDraftNow(true)
      message.success('操作配置已保存')
    } catch (error) {
      console.error('[CanvasOperationPanel] Failed to save operation draft:', error)
      message.error(error instanceof Error ? error.message : '保存操作配置失败')
    }
  }, [saveDraftNow])

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
    if (running || submitting || node.data.status === 'running') return
    if (selectedMediaInputIssue) {
      message.warning(selectedMediaInputIssue)
      return
    }
    const usesExplicitMediaMode = Boolean(effectiveMediaInputMode && selectedMediaInputModeOption)
    const inputRoles = usesExplicitMediaMode
      ? canvasInputRolesFromBindings(executionInputBindings)
      : supportsVideoFrameRoles
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
    const materializedPromptNodeIds = materializeOperationPanelPromptNodeIds(
      activePromptNodeIds,
      snapshot,
    )
    const snapshotNodeById = new Map(snapshot.nodes.map((item) => [item.id, item]))
    const textInputNodeIds = materializedPromptNodeIds.filter((id) => {
      const item = snapshotNodeById.get(id)
      return item?.type === 'text' || item?.type === 'prompt'
    })
    const mediaNodeIds = new Set(mediaInputOptions.map((option) => String(option.value)))
    const runInputNodeIds = usesExplicitMediaMode
      ? Array.from(
          new Set([
            ...executionInputBindings
              .filter((binding) => ['image', 'video', 'audio', 'file'].includes(binding.kind))
              .map((binding) => binding.sourceNodeId),
            ...textInputNodeIds,
            ...materializedPromptNodeIds.filter((id) => !mediaNodeIds.has(id)),
          ]),
        )
      : Array.from(
          new Set([
            ...buildOperationPanelRunInputNodeIds({
              selectedInputNodeIds,
              explicitFrameNodeIds,
              textInputNodeIds,
              supportsVideoFrameRoles,
              mediaInputOptions: mediaInputOptions.map((item) => ({
                value: String(item.value),
                type: item.type,
              })),
            }),
            ...materializedPromptNodeIds,
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
    const skipParameterValidation = readSkipCanvasParameterValidation()
    setSubmitting(true)
    setRunning(true)
    try {
      await saveDraftNow()
      const runParams: OperationRunParams = {
        prompt: prompt.trim(),
        promptDocument,
        inputBindings: executionInputBindings,
        ...(effectiveMediaInputMode ? { mediaInputMode: effectiveMediaInputMode } : {}),
        ...(selectedCapabilityId ? { capabilityId: selectedCapabilityId } : {}),
        ...(hiddenFunctionalSystemPrompt ? { systemPrompt: hiddenFunctionalSystemPrompt } : {}),
        ...(negativePrompt.trim() ? { negativePrompt: negativePrompt.trim() } : {}),
        inputNodeIds: runInputNodeIds,
        ...(usesTextRuntime && selectedAgentId ? { agentId: selectedAgentId } : {}),
        ...(usesTextRuntime ? { skillIds: selectedSkillIds } : {}),
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
        ...(skipParameterValidation ? { skipParameterValidation: true } : {}),
      }
      try {
        await onRun(runParams)
      } catch (error) {
        if (!(error instanceof CanvasTaskValidationError)) throw error
        const decision = await confirmCanvasTaskValidation(error.issues)
        if (!decision.confirmed) return
        if (decision.skipFutureValidation) writeSkipCanvasParameterValidation(true)
        await onRun({ ...runParams, skipParameterValidation: true })
      }
    } catch (error) {
      console.error('[CanvasOperationPanel] Failed to run operation node:', error)
      if (error instanceof CanvasTaskValidationError) {
        message.warning(error.message)
      } else {
        message.error(error instanceof Error ? error.message : '提交任务失败，请调整参数后重试')
      }
    } finally {
      setRunning(false)
      setSubmitting(false)
    }
  }, [
    buildCurrentModelParams,
    negativePrompt,
    operation,
    node.data.status,
    onRun,
    prompt,
    promptDocument,
    effectiveMediaInputMode,
    executionInputBindings,
    hiddenFunctionalSystemPrompt,
    resolveShotScriptConfig,
    saveDraftNow,
    selectedModel,
    selectedCapabilityId,
    selectedMediaInputModeOption,
    selectedMediaInputIssue,
    running,
    submitting,
    selectedSkillIds,
    snapshot,
    expandedSourceInputNodes,
    explicitFrameNodeIds,
    firstFrameNodeId,
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
    usesTextRuntime,
  ])

  const nodeById = useMemo(
    () => new Map(snapshot.nodes.map((item) => [item.id, item])),
    [snapshot.nodes],
  )
  const assetById = useMemo(
    () => new Map(snapshot.assets.map((item) => [item.id, item])),
    [snapshot.assets],
  )
  const selectedCapabilityRolePolicy = useMemo(
    () =>
      selectedCapability ? inferRolePolicy(selectedCapability) : EMPTY_MEDIA_INPUT_ROLE_POLICY,
    [selectedCapability],
  )
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
  const promptConnectionNodes = useMemo(
    () => Array.from(new Map(sourceInputNodes.map((item) => [item.id, item])).values()),
    [sourceInputNodes],
  )
  const promptCandidateNodes = useMemo(
    () => snapshot.nodes.filter((item) => !item.hidden && item.id !== node.id),
    [node.id, snapshot.nodes],
  )
  const dedicatedMediaInputNode = useMemo(
    () =>
      pendingDedicatedMediaNode ??
      selectedInputNodeIds
        .map((inputNodeId) => nodeById.get(inputNodeId))
        .find((inputNode) => inputNode?.type === dedicatedMediaKind) ??
      null,
    [dedicatedMediaKind, nodeById, pendingDedicatedMediaNode, selectedInputNodeIds],
  )
  useEffect(() => {
    if (!pendingDedicatedMediaNode || !nodeById.has(pendingDedicatedMediaNode.id)) return
    setSelectedInputNodeIds([pendingDedicatedMediaNode.id])
    setPendingDedicatedMediaNode(null)
    markConfigurationTouched()
  }, [markConfigurationTouched, nodeById, pendingDedicatedMediaNode, setSelectedInputNodeIds])
  const promptPresentationNodeBySourceId = useMemo(() => {
    const resolved = new Map<string, CanvasNode>()
    for (const candidate of promptCandidateNodes) {
      if (!isOperationNode(candidate)) continue
      const output = resolveCanvasOperationResourceNode(candidate, snapshot)
      if (output) resolved.set(candidate.id, output)
    }
    return resolved
  }, [promptCandidateNodes, snapshot])
  const mediaPresentationNodeBySourceId = useMemo(() => {
    const resolved = new Map(promptPresentationNodeBySourceId)
    for (const assignment of mediaInputAssignments) {
      const direct = resolved.get(assignment.sourceNodeId)
      if (direct?.assetId || direct?.data.thumbnailUrl || direct?.data.url) continue
      const source = nodeById.get(assignment.sourceNodeId)
      if (!source) continue
      const preview = expandCanvasInputNodes([source], snapshot).find(
        (candidate) =>
          candidate.id !== source.id &&
          (candidate.assetId || candidate.data.thumbnailUrl || candidate.data.url) &&
          (candidate.type === assignment.kind || assignment.kind === 'file'),
      )
      if (preview) resolved.set(assignment.sourceNodeId, preview)
    }
    return resolved
  }, [mediaInputAssignments, nodeById, promptPresentationNodeBySourceId, snapshot])
  const handlePromptMentionSelect = useCallback(
    (_selectedNode: CanvasNode) => {
      if (running) return false
      return true
    },
    [running],
  )
  const handleDedicatedMediaPick = useCallback(() => {
    onRequestCanvasNodePick?.((pickedNode) => {
      if (pickedNode.type !== dedicatedMediaKind) {
        message.warning(
          dedicatedMediaKind === 'video' ? '深度视频仅支持视频节点' : '图片反推仅支持图片节点',
        )
        return
      }
      setSelectedInputNodeIds([pickedNode.id])
      markConfigurationTouched()
    })
  }, [
    dedicatedMediaKind,
    markConfigurationTouched,
    onRequestCanvasNodePick,
    setSelectedInputNodeIds,
  ])
  const handleDedicatedMediaUpload = useCallback(
    async (file: File) => {
      if (!dedicatedMediaKind || !file.type.startsWith(`${dedicatedMediaKind}/`)) {
        message.warning(dedicatedMediaKind === 'video' ? '请选择视频文件' : '请选择图片文件')
        return
      }
      const uploadedNode = await onUploadLocalFile?.(file)
      if (uploadedNode?.type === dedicatedMediaKind) setPendingDedicatedMediaNode(uploadedNode)
    },
    [dedicatedMediaKind, onUploadLocalFile],
  )
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
            onChange={(event) => handleNegativePromptChange(event.target.value)}
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
        <div className="canvas-operation-composer-top has-no-media">
          <div className="canvas-operation-composer-inputs">
            <label className="canvas-operation-composer-mini-field is-message">
              <span>备注</span>
              <Input
                size="middle"
                value={messageDraft}
                placeholder="节点展示说明"
                onChange={(event) => handleMessageDraftChange(event.target.value)}
                disabled={running}
              />
            </label>
            <span className="canvas-operation-panel-hint">
              {dedicatedMediaKind === 'image'
                ? '反推指令已内置，只需提供一张图片'
                : dedicatedMediaKind === 'video'
                  ? '本地转换无需提示词，只需提供一段视频'
                  : '资源和文本统一在提示词中用 @ 添加'}
            </span>
          </div>
        </div>

        {dedicatedMediaKind ? (
          <div className="canvas-operation-composer-main">
            <CanvasOperationMediaInput
              node={dedicatedMediaInputNode}
              mediaKind={dedicatedMediaKind}
              disabled={running}
              {...(onRequestCanvasNodePick ? { onPick: handleDedicatedMediaPick } : {})}
              {...(onUploadLocalFile ? { onUpload: handleDedicatedMediaUpload } : {})}
              onClear={() => {
                setPendingDedicatedMediaNode(null)
                setSelectedInputNodeIds([])
                markConfigurationTouched()
              }}
            />
            {panelMode.showLocalDepthNotice && (
              <CanvasDepthModelNotice state={depthModelState} error={depthModelError} compact />
            )}
          </div>
        ) : panelMode.showPromptEditor ? (
          <div className="canvas-operation-composer-main">
            <div className="canvas-operation-prompt-count-wrap">
              <CanvasPromptMentionTextArea
                className="canvas-operation-composer-prompt"
                rows={6}
                value={prompt}
                document={promptDocument}
                placeholder={`输入${operationText}的提示词...`}
                mentionNodes={promptCandidateNodes}
                presentationNodeBySourceId={mediaPresentationNodeBySourceId}
                connectionNodes={promptConnectionNodes}
                assets={snapshot.assets}
                onChange={handlePromptChange}
                onDocumentChange={setPromptDocument}
                onMentionSelect={handlePromptMentionSelect}
                {...(onRequestCanvasNodePick ? { onRequestCanvasNodePick } : {})}
                {...(onUploadLocalFile ? { onUploadLocalFile } : {})}
                disabled={running}
              />
              <span className="canvas-operation-prompt-count">
                {promptCharCount.toLocaleString()} 字符
              </span>
            </div>
          </div>
        ) : null}

        {mediaInputModeOptions.length > 0 && effectiveMediaInputMode && (
          <div className="canvas-operation-composer-input-rail">
            <CanvasMediaInputConfigurator
              options={mediaInputModeOptions}
              value={effectiveMediaInputMode}
              assignments={mediaInputAssignments}
              bindings={inputBindings}
              nodes={snapshot.nodes}
              assets={snapshot.assets}
              presentationNodeBySourceId={mediaPresentationNodeBySourceId}
              disabled={running}
              variant="composer"
              onChange={handleMediaInputModeChange}
              onMove={handleMediaInputMove}
              onRemove={handleMediaInputRemove}
              {...(onRequestCanvasNodePick ? { onQuickPick: mediaInputQuickActions.pick } : {})}
              {...(onUploadLocalFile ? { onQuickUpload: mediaInputQuickActions.upload } : {})}
            />
          </div>
        )}

        <div className="canvas-operation-composer-bottom">
          <div className="canvas-operation-composer-params">
            {isTextOperation && (
              <>
                {panelMode.runtimeKind === 'text_full' && (
                  <AgentPickerInline
                    agents={agents}
                    selectedId={selectedAgentId}
                    disabled={running || runtimeLoading || agents.length === 0}
                    open={openRuntimeMenu === 'agent'}
                    onOpenChange={(nextOpen) => setOpenRuntimeMenu(nextOpen ? 'agent' : null)}
                    onChange={handleTextAgentChange}
                  />
                )}
                <ProviderModelPickerInline
                  providers={textProviders}
                  selectedProviderId={selectedTextProvider?.id ?? ''}
                  selectedModelId={selectedTextModelId}
                  disabled={running || runtimeLoading || textProviders.length === 0}
                  open={openRuntimeMenu === 'model'}
                  onOpenChange={(nextOpen) => setOpenRuntimeMenu(nextOpen ? 'model' : null)}
                  onChange={handleTextProviderModelChange}
                />
                {panelMode.runtimeKind === 'text_full' &&
                  renderTextClickSelector({
                    pickerId: 'skills',
                    title: '选择 Skills',
                    label: 'Skills',
                    valueText:
                      selectedSkillIds.length > 0 ? `${selectedSkillIds.length} 个` : '未选择',
                    disabled: running || runtimeLoading || skills.length === 0,
                    content: renderMultiOptionList(
                      skills.map((skill) => ({ value: skill.id, label: skill.name })),
                      selectedSkillIds,
                      handleSkillIdsChange,
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
                      onChange={(v) => {
                        markConfigurationTouched()
                        setMaxClipPreset(v)
                      }}
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
                        onChange={(v) => {
                          markConfigurationTouched()
                          setMaxClipCustom(v == null ? '' : String(v))
                        }}
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
                onModelChange={handleSelectedModelChange}
                onParameterChange={handleModelParamDraftChange}
              />
            )}
            {supportsVideoFrameRoles && mediaInputModeOptions.length === 0 && (
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
                    (value) => {
                      markConfigurationTouched()
                      setFirstFrameNodeId(value)
                    },
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
                    (value) => {
                      markConfigurationTouched()
                      setLastFrameNodeId(value)
                    },
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
                      (values) => {
                        markConfigurationTouched()
                        setReferenceFrameNodeIds(values)
                      },
                      '清空参考图',
                    ),
                  })}
              </>
            )}
            {panelMode.showCustomParams &&
              mediaCapabilityIds.length === 0 &&
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
            <Tooltip title={saveDraftTooltip}>
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
            <Tooltip
              title={
                selectedMediaInputIssue ?? (node.data.status === 'running' ? '运行中' : submitLabel)
              }
            >
              <Button
                size="middle"
                type="primary"
                className="canvas-operation-composer-submit"
                aria-label={submitLabel}
                icon={<Icons.Send size={14} />}
                loading={running || submitting || node.data.status === 'running'}
                disabled={
                  Boolean(selectedMediaInputIssue) ||
                  running ||
                  submitting ||
                  node.data.status === 'running'
                }
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
            <Button size="middle" type="text" icon={<Icons.X size={15} />} onClick={handleClose} />
          </div>
        </div>
      )}

      <div className="canvas-operation-panel-body">
        <div className="canvas-operation-panel-section canvas-operation-panel-section-node">
          <div className="canvas-operation-panel-section-label">节点备注</div>
          <div className="canvas-operation-panel-detail-grid">
            <label className="canvas-operation-panel-detail-field">
              <span>备注 / 展示文本</span>
              <Input
                size="middle"
                value={messageDraft}
                placeholder="显示在节点卡片上的辅助说明"
                onChange={(event) => handleMessageDraftChange(event.target.value)}
                disabled={running}
              />
            </label>
          </div>
        </div>

        {isTextOperation && (
          <div className="canvas-operation-panel-section canvas-operation-panel-section-runtime">
            <div className="canvas-operation-panel-section-title-row">
              <div className="canvas-operation-panel-section-label">
                {panelMode.runtimeKind === 'vision_model' ? '图片理解模型' : 'Agent / 文本模型'}
              </div>
              <Tag bordered color="blue">
                应用配置
              </Tag>
            </div>
            <div className="canvas-operation-panel-runtime-card">
              {panelMode.runtimeKind === 'text_full' && (
                <AgentPickerInline
                  agents={agents}
                  selectedId={selectedAgentId}
                  disabled={running || runtimeLoading || agents.length === 0}
                  open={openRuntimeMenu === 'agent'}
                  onOpenChange={(nextOpen) => setOpenRuntimeMenu(nextOpen ? 'agent' : null)}
                  onChange={handleTextAgentChange}
                />
              )}
              <ProviderModelPickerInline
                providers={textProviders}
                selectedProviderId={selectedTextProvider?.id ?? ''}
                selectedModelId={selectedTextModelId}
                disabled={running || runtimeLoading || textProviders.length === 0}
                open={openRuntimeMenu === 'model'}
                onOpenChange={(nextOpen) => setOpenRuntimeMenu(nextOpen ? 'model' : null)}
                onChange={handleTextProviderModelChange}
              />
              {panelMode.runtimeKind === 'text_full' && (
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
                  onChange={(value) => handleSkillIdsChange(value.map(String))}
                />
              )}
            </div>
            <div className="canvas-operation-panel-runtime-summary">
              <Icons.Bot size={13} />
              <span>{runtimeSummary}</span>
            </div>
          </div>
        )}

        {panelMode.showLocalDepthNotice && (
          <CanvasDepthModelNotice state={depthModelState} error={depthModelError} />
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
              onModelChange={handleSelectedModelChange}
              onParameterChange={handleModelParamDraftChange}
            />
          </div>
        )}

        {mediaInputModeOptions.length > 0 && effectiveMediaInputMode && (
          <div className="canvas-operation-panel-section canvas-operation-panel-section-inputs">
            <div className="canvas-operation-panel-section-label">素材编排</div>
            <CanvasMediaInputConfigurator
              options={mediaInputModeOptions}
              value={effectiveMediaInputMode}
              assignments={mediaInputAssignments}
              bindings={inputBindings}
              nodes={snapshot.nodes}
              assets={snapshot.assets}
              presentationNodeBySourceId={promptPresentationNodeBySourceId}
              disabled={running}
              variant="panel"
              onChange={handleMediaInputModeChange}
              onMove={handleMediaInputMove}
              onRemove={handleMediaInputRemove}
              {...(onRequestCanvasNodePick ? { onQuickPick: mediaInputQuickActions.pick } : {})}
              {...(onUploadLocalFile ? { onQuickUpload: mediaInputQuickActions.upload } : {})}
            />
          </div>
        )}

        {supportsVideoFrameRoles && mediaInputModeOptions.length === 0 && (
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
                      (value) => {
                        markConfigurationTouched()
                        setFirstFrameNodeId(value)
                      },
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
                      (value) => {
                        markConfigurationTouched()
                        setLastFrameNodeId(value)
                      },
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
                    (values) => {
                      markConfigurationTouched()
                      setReferenceFrameNodeIds(values)
                    },
                    '清空参考图',
                  ),
                })}
            </div>
          </div>
        )}

        {dedicatedMediaKind && (
          <div className="canvas-operation-panel-section canvas-operation-panel-section-inputs">
            <div className="canvas-operation-panel-section-label">
              {dedicatedMediaKind === 'video' ? '输入视频' : '输入图片'}
            </div>
            <CanvasOperationMediaInput
              node={dedicatedMediaInputNode}
              mediaKind={dedicatedMediaKind}
              disabled={running}
              {...(onRequestCanvasNodePick ? { onPick: handleDedicatedMediaPick } : {})}
              {...(onUploadLocalFile ? { onUpload: handleDedicatedMediaUpload } : {})}
              onClear={() => {
                setPendingDedicatedMediaNode(null)
                setSelectedInputNodeIds([])
                markConfigurationTouched()
              }}
            />
          </div>
        )}

        {/* Prompt 编辑 */}
        {panelMode.showPromptEditor && (
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
                presentationNodeBySourceId={promptPresentationNodeBySourceId}
                connectionNodes={promptConnectionNodes}
                assets={snapshot.assets}
                onChange={handlePromptChange}
                onDocumentChange={setPromptDocument}
                onMentionSelect={handlePromptMentionSelect}
                {...(onRequestCanvasNodePick ? { onRequestCanvasNodePick } : {})}
                {...(onUploadLocalFile ? { onUploadLocalFile } : {})}
                disabled={running}
              />
              <span className="canvas-operation-prompt-count">
                {promptCharCount.toLocaleString()} 字符
              </span>
            </div>
          </div>
        )}

        {panelMode.showCustomParams && mediaCapabilityIds.length === 0 && (
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
                        type={
                          param.type === 'integer' || param.type === 'number' ? 'number' : 'text'
                        }
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
        <Tooltip title={saveDraftTooltip}>
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
              onClick={handleClose}
            />
          </Tooltip>
        )}
        <Tooltip
          title={
            selectedMediaInputIssue ?? (node.data.status === 'running' ? '运行中' : submitLabel)
          }
        >
          <Button
            size="middle"
            type="primary"
            className="canvas-operation-composer-submit"
            aria-label={submitLabel}
            icon={<Icons.Send size={14} />}
            loading={running || submitting || node.data.status === 'running'}
            disabled={
              Boolean(selectedMediaInputIssue) ||
              running ||
              submitting ||
              node.data.status === 'running'
            }
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
  if (node.type === 'audio') return inputTypes.includes('audio')
  return false
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

/** 能力是否接受 text/prompt 输入。 */
function operationAcceptsTextInput(inputTypes: readonly string[] | undefined): boolean {
  if (!inputTypes) return false
  return inputTypes.includes('text') || inputTypes.includes('prompt')
}

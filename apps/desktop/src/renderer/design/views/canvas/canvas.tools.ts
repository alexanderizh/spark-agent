/**
 * 画布 Agent 工具注册表（Phase 1）
 *
 * 设计：每个工具是纯描述符（name + description + JSON Schema + handler）。
 * Handler 在渲染进程执行，通过 `CanvasToolContext` 拿到当前画布的 store actions
 * 和 canvas.api。Phase 2 的 IPC 桥会把主进程 SDK 工具调用转发到这里。
 *
 * 工具命名：`canvas_<verb>_<noun>`（snake_case，便于 LLM 调用）。
 * 工具返回：紧凑结果（不返回完整 snapshot；快照在每次操作后会被自动 refresh）。
 */
import { canvasApi, operationLabel } from './canvas.api'
import { translate } from '../../i18n'
import type {
  CanvasAsset,
  CanvasBoard,
  CanvasCapability,
  CanvasNode,
  CanvasNodeData,
  CanvasNodeType,
  CanvasOperationType,
  ShotScriptConfig,
  CanvasSnapshot,
  CanvasTask,
} from './canvas.types'
import type { CreateFilmAssetInput, ShotGroup, ShotSegment } from './canvasFilmAssets'
import type {
  CanvasWorkflowDefinition,
  CanvasWorkflowExecutionPlan,
  CanvasWorkflowPackage,
  CanvasWorkflowRun,
  SessionReasoningEffort,
} from '@spark/protocol'
import { getCanvasCapability, isOperationNode, nodeOperation } from './canvas.capabilities'
import { getCanvasAgentAvailableActions, resolveNodeAssetKinds } from './canvasAgentCapabilities'
import { buildCanvasAgentProductionPlan } from './canvasAgentProductionPlan'
import { SPECIALIZED_CANVAS_NODE_TOOLS } from './canvasSpecializedNodeTools'
import { CANVAS_WORKFLOW_TOOLS } from './canvasWorkflowAgentTools'
import { CANVAS_AGENT_WORKFLOW_GRAPH_TOOLS } from './canvasAgentWorkflowGraphTools'
import { formatCanvasToolInputIssues, validateCanvasToolInput } from './canvasToolInputValidation'
import type { CanvasAgentLiveViewport } from './canvasAgentWorkflowViewport'

type JSONSchema = Record<string, unknown>

/** 画布工作区 actions 的形状（与 useCanvasWorkspace 返回值匹配） */
export type CanvasWorkspaceActions = {
  /** 为 Agent 轮次记录可恢复的完整画布快照。 */
  createCanvasHistoryCheckpoint: () => string | null
  /** 还原到指定 Agent 轮次开始前的画布快照。 */
  restoreCanvasHistoryCheckpoint: (checkpointId: string) => Promise<void>
  /** 检查快照是否仍在内存保留窗口中。 */
  hasCanvasHistoryCheckpoint: (checkpointId: string) => boolean
  createTextNode: (input: { text: string; x: number; y: number }) => Promise<CanvasNode | undefined>
  createImageNode: (input: {
    file: File
    filePath: string
    x: number
    y: number
    width?: number
    height?: number
    imageWidth?: number
    imageHeight?: number
  }) => Promise<CanvasNode | undefined>
  uploadImageAsset: (file: File) => Promise<string | null>
  createGroupNode: (nodeIds: string[]) => Promise<CanvasSnapshot>
  dissolveGroupNode: (groupId: string) => Promise<void>
  addNodesToGroup: (groupId: string, nodeIds: string[]) => Promise<void>
  removeNodesFromGroup: (nodeIds: string[]) => Promise<void>
  deleteNodes: (nodeIds: string[]) => Promise<void>
  duplicateNodes: (nodeIds: string[]) => Promise<void>
  patchNodes: (
    nodeIds: string[],
    patch: Partial<
      Pick<
        CanvasNode,
        'x' | 'y' | 'width' | 'height' | 'rotation' | 'zIndex' | 'locked' | 'hidden' | 'title'
      >
    >,
  ) => Promise<void>
  updateNode: (
    nodeId: string,
    patch: { title?: string; data?: Partial<CanvasNodeData> },
  ) => Promise<void>
  updateNodeData: (nodeId: string, data: Partial<CanvasNodeData>) => Promise<void>
  connectNodes: (input: { sourceNodeId: string; targetNodeId: string }) => Promise<void>
  deleteEdges: (edgeIds: string[]) => Promise<void>
  createBoard: (input?: { name?: string; templateId?: string | null }) => Promise<void>
  renameBoard: (boardId: string, name: string) => Promise<void>
  deleteBoard: (boardId: string) => Promise<void>
  duplicateBoard: (boardId: string, name?: string) => Promise<void>
  switchBoard: (boardId: string, viewport?: CanvasBoard['viewport']) => Promise<void>
  copyNodesToBoard: (nodeIds: string[], targetBoardId: string) => Promise<void>
  insertAsset: (input: {
    assetId: string
    boardId: string
    x: number
    y: number
  }) => Promise<CanvasNode | null>
  createFilmAsset: (input: CreateFilmAssetInput) => Promise<CanvasAsset>
  updateFilmAsset: (assetId: string, patch: Record<string, unknown>) => Promise<void>
  deleteFilmAsset: (assetId: string) => Promise<void>
  createShotGroup: (input: { name: string; description?: string }) => Promise<ShotGroup>
  updateShotGroup: (
    groupId: string,
    patch: { name?: string; description?: string },
  ) => Promise<void>
  deleteShotGroup: (groupId: string) => Promise<void>
  createShotSegment: (
    groupId: string,
    input: Partial<ShotSegment> & { title: string },
  ) => Promise<ShotSegment>
  updateShotSegment: (
    groupId: string,
    segmentId: string,
    patch: Partial<ShotSegment>,
  ) => Promise<void>
  deleteShotSegment: (groupId: string, segmentId: string) => Promise<void>
  createOperationNode: (input: {
    boardId: string
    operation: CanvasOperationType
    inputNodeIds: string[]
    x: number
    y: number
    title?: string
    message?: string
    prompt?: string
    systemPrompt?: string
    negativePrompt?: string
    modelParams?: Record<string, unknown>
    agentId?: string
    providerProfileId?: string
    manifestId?: string
    modelId?: string
    reasoningEffort?: SessionReasoningEffort
    taskPipelineRole?: CanvasNodeData['pipelineRole']
    outputPipelineRole?: CanvasNodeData['outputPipelineRole']
    shotScriptConfig?: ShotScriptConfig
  }) => Promise<CanvasSnapshot | void>
  retryOperationNode: (nodeId: string) => Promise<void>
  runOperationNode: (
    nodeId: string,
    params: {
      prompt: string
      negativePrompt?: string
      inputNodeIds?: string[]
      inputAssetIds?: string[]
      agentId?: string
      providerProfileId?: string
      manifestId?: string
      modelId?: string
      reasoningEffort?: SessionReasoningEffort
      modelParams?: Record<string, unknown>
      skillIds?: string[]
      userPrompt?: string
    },
  ) => Promise<CanvasSnapshot | void>
  cancelTask: (taskId: string) => Promise<void>
  updateProjectSettings: (settings: { prompt?: string; negativePrompt?: string }) => Promise<void>
  applyTemplate: (input: {
    boardId: string
    originX: number
    originY: number
    nodes: Array<{
      ref: string
      type: CanvasNodeType
      title?: string
      x: number
      y: number
      width?: number
      height?: number
      data?: Partial<CanvasNodeData>
    }>
    edges?: Array<{
      from: string
      to: string
      type?: import('./canvas.types').CanvasEdgeType
      sourceHandle?: string
      targetHandle?: string
    }>
  }) => Promise<CanvasSnapshot>
  materializeWorkflow: (input: {
    boardId: string
    originX: number
    originY: number
    workflowPackage: CanvasWorkflowPackage
  }) => Promise<CanvasSnapshot>
  runCanvasWorkflow?: (input: {
    workflow: CanvasWorkflowDefinition
    run: CanvasWorkflowRun
    plan: Readonly<CanvasWorkflowExecutionPlan>
    signal: AbortSignal
  }) => Promise<CanvasWorkflowRun>
}

/** 工具执行上下文 */
export type CanvasToolContext = {
  projectId: string
  /** 返回当前最新的 snapshot；可能为 null（加载中） */
  getSnapshot: () => CanvasSnapshot | null
  /** 返回 React Flow 当前实时视口，用于将 Agent 新内容放在用户正在查看的区域。 */
  getViewport?: () => CanvasAgentLiveViewport | null
  /** 选中并平滑定位一组节点；仅在新内容不完整可见时调用。 */
  revealNodes?: (nodeIds: string[]) => void
  /** 当前画布选区，仅供显式的子图校验；不扩大到整个画布。 */
  getSelectedNodeIds?: () => string[]
  /** 渲染进程的画布 actions */
  workspace: CanvasWorkspaceActions
}

export type CanvasToolDescriptor = {
  name: string
  description: string
  paramsSchema: JSONSchema
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  handler: (ctx: CanvasToolContext, input: any) => Promise<unknown>
}

const requireSnapshot = (ctx: CanvasToolContext): CanvasSnapshot => {
  const snap = ctx.getSnapshot()
  if (!snap) throw new Error(translate('canvasTools.t1Desc'))
  return snap
}

const activeBoardId = (ctx: CanvasToolContext): string => {
  const snap = requireSnapshot(ctx)
  return snap.activeBoardId ?? snap.board.id
}

/** 找一块空白位置放新节点（避免叠在已有节点上） */
const findEmptySpot = (snap: CanvasSnapshot, boardId: string): { x: number; y: number } => {
  const nodes = snap.nodes.filter((n) => n.boardId === boardId && !n.hidden)
  if (nodes.length === 0) return { x: 80, y: 80 }
  let maxRight = 0
  let avgY = 0
  for (const n of nodes) {
    maxRight = Math.max(maxRight, n.x + n.width)
    avgY += n.y
  }
  return { x: maxRight + 40, y: Math.round(avgY / nodes.length) }
}

const findNode = (snap: CanvasSnapshot, nodeId: string): CanvasNode => {
  const n = snap.nodes.find((x) => x.id === nodeId)
  if (!n) throw new Error(translate('canvasTools.tpl1Desc', { id: nodeId }))
  return n
}

async function updateCanvasNode(
  ctx: CanvasToolContext,
  input: {
    nodeId: string
    title?: string
    content?: string
    data?: Partial<CanvasNodeData>
  },
): Promise<CanvasNode> {
  const node = findNode(requireSnapshot(ctx), input.nodeId)
  const hasTitle = input.title !== undefined
  const hasContent = input.content !== undefined
  const hasData = input.data != null && Object.keys(input.data).length > 0
  if (!hasTitle && !hasContent && !hasData) {
    throw new Error(translate('canvasTools.t2Desc'))
  }

  const dataPatch: Partial<CanvasNodeData> = { ...(input.data ?? {}) }
  const content = input.content
  if (content !== undefined) {
    if (node.type === 'text') {
      dataPatch.text = content
    } else if (node.type === 'prompt') {
      // Prompt cards render data.text, while some Agent/pipeline paths read
      // data.prompt. Keep the two representations in sync.
      dataPatch.text = content
      dataPatch.prompt = content
    } else if (isOperationNode(node)) {
      dataPatch.prompt = content
    } else {
      throw new Error(translate('canvasTools.tpl2LongDesc', { id: input.nodeId }))
    }
  } else if (node.type === 'prompt') {
    const hasPrompt = Object.prototype.hasOwnProperty.call(dataPatch, 'prompt')
    const hasText = Object.prototype.hasOwnProperty.call(dataPatch, 'text')
    const prompt = dataPatch.prompt
    const text = dataPatch.text
    if (hasPrompt && hasText && prompt !== text) {
      throw new Error(translate('canvasTools.t3LongDesc'))
    }
    if (hasPrompt && !hasText && typeof prompt === 'string') dataPatch.text = prompt
    if (hasText && !hasPrompt && typeof text === 'string') dataPatch.prompt = text
  }

  await ctx.workspace.updateNode(input.nodeId, {
    ...(input.title !== undefined ? { title: input.title } : {}),
    ...(Object.keys(dataPatch).length > 0 ? { data: dataPatch } : {}),
  })
  return node
}

const summarizeNode = (n: CanvasNode) => ({
  id: n.id,
  type: n.type,
  title: n.title ?? null,
  x: n.x,
  y: n.y,
  width: n.width,
  height: n.height,
  hidden: n.hidden,
  boardId: n.boardId,
  parentNodeId: n.parentNodeId ?? null,
  assetId: n.assetId ?? null,
  taskId: n.taskId ?? null,
  data: {
    text: n.data.text,
    prompt: n.data.prompt,
    url: n.data.url,
    operation: n.data.operation,
    status: n.data.status,
    progress: n.data.progress,
    message: n.data.message,
  },
})

/**
 * 轻量节点摘要：用于列表/查询类工具返回。
 * 只含定位与标识字段，不含 data 详情——Agent 需要详情时再调 canvas_get_node。
 * 减少 Agent token 消耗，加速推理。
 */
const summarizeNodeLite = (n: CanvasNode) => ({
  id: n.id,
  type: n.type,
  title: n.title ?? null,
  subtype: n.data.subtype ?? null,
  x: n.x,
  y: n.y,
  width: n.width,
  height: n.height,
  status: n.data.status ?? null,
  operation: n.data.operation ?? null,
  assetId: n.assetId ?? null,
  taskId: n.taskId ?? null,
})

const summarizeAsset = (a: CanvasAsset) => ({
  id: a.id,
  type: a.type,
  source: a.source,
  title: a.title,
  url: a.url,
  thumbnailUrl: a.thumbnailUrl,
  contentText: a.contentText ? a.contentText.slice(0, 400) : null,
  width: a.width,
  height: a.height,
  durationMs: a.durationMs,
  kind: (a.metadata?.kind as string | undefined) ?? null,
  tags: (a.metadata?.tags as string[] | undefined) ?? [],
})

const summarizeBoard = (b: CanvasBoard, isActive: boolean) => ({
  id: b.id,
  name: b.name,
  isActive,
  isDefault: b.settings.isDefault ?? false,
})

const summarizeTask = (t: CanvasTask) => ({
  id: t.id,
  operation: t.operation,
  status: t.status,
  progress: t.progress,
  prompt: t.prompt,
  inputNodeIds: t.inputNodeIds,
  inputAssetIds: t.inputAssetIds,
  outputNodeIds: t.outputNodeIds,
  outputAssetIds: t.outputAssetIds,
  errorMsg: t.errorMsg,
})

const summarizeOperationConfig = (snap: CanvasSnapshot, node: CanvasNode) => {
  const operation = nodeOperation(node)
  const task = node.taskId ? (snap.tasks.find((item) => item.id === node.taskId) ?? null) : null
  const inputNodeIds = snap.edges
    .filter((edge) => edge.targetNodeId === node.id && edge.type === 'used_as_input')
    .map((edge) => edge.sourceNodeId)
  const inputNodes = inputNodeIds
    .map((id) => snap.nodes.find((candidate) => candidate.id === id))
    .filter((candidate): candidate is CanvasNode => candidate != null)
    .map(summarizeNode)
  const capability = operation ? getCanvasCapability(operation) : undefined
  return {
    nodeId: node.id,
    operation,
    configuration: {
      prompt: node.data.prompt ?? task?.prompt ?? null,
      negativePrompt: node.data.negativePrompt ?? task?.negativePrompt ?? null,
      modelParams: node.data.modelParams ?? task?.modelParams ?? {},
      agentId: node.data.agentId ?? task?.agentId ?? null,
      providerProfileId: node.data.providerProfileId ?? task?.providerProfileId ?? null,
      manifestId: node.data.manifestId ?? task?.manifestId ?? null,
      modelId: node.data.modelId ?? task?.modelId ?? null,
      reasoningEffort: node.data.reasoningEffort ?? task?.reasoningEffort ?? null,
      skillIds: node.data.skillIds ?? task?.skillIds ?? [],
    },
    inputNodes,
    capability: capability
      ? {
          id: capability.id,
          inputTypes: capability.inputTypes,
          outputTypes: capability.outputTypes,
          paramsSchema: capability.paramsSchema,
        }
      : null,
    task: task ? summarizeTask(task) : null,
  }
}

// ─── Schema helpers ────────────────────────────────────────────────────────
const string = (description: string, required = true): JSONSchema => ({
  type: 'string',
  description,
  ...(required ? {} : {}),
})
const number = (description: string): JSONSchema => ({ type: 'number', description })
const boolean = (description: string): JSONSchema => ({ type: 'boolean', description })
const array = (items: JSONSchema, description: string): JSONSchema => ({
  type: 'array',
  items,
  description,
})
const enumOf = (values: string[], description: string): JSONSchema => ({
  type: 'string',
  enum: values,
  description,
})

const NODE_TYPES: CanvasNodeType[] = [
  'image',
  'audio',
  'video',
  'text',
  'prompt',
  'group',
  'text_to_image',
  'image_to_image',
  'image_edit',
  'image_compose',
  'storyboard_grid',
  'panorama_360',
  'text_generate',
  'text_rewrite',
  'prompt_optimize',
  'text_to_video',
  'image_to_video',
  'video_edit',
  'video_extend',
  'text_to_audio',
  'audio_transcribe',
]

const OPERATION_TYPES: CanvasOperationType[] = [
  'text_to_image',
  'image_to_image',
  'image_edit',
  'image_compose',
  'storyboard_grid',
  'panorama_360',
  'text_generate',
  'text_rewrite',
  'prompt_optimize',
  'text_to_audio',
  'audio_transcribe',
  'text_to_video',
  'image_to_video',
  'video_edit',
  'video_extend',
  'extract_audio',
  'extract_first_last_frames',
]

const FILM_ASSET_KINDS = [
  'script',
  'character',
  'scene',
  'prop',
  'effect',
  'prompt_library',
] as const
const PIPELINE_ROLES = [
  'style_bible',
  'chapter',
  'screenplay',
  'character',
  'scene',
  'prop',
  'effect',
  'camera',
  'frame',
  'action',
  'design_card',
  'shot',
  'keyframe',
  'clip',
] as const
const PRODUCTION_STATES = ['empty', 'drafting', 'draft', 'confirmed', 'stale'] as const

const SHOT_SEGMENT_TOOL_FIELDS = {
  description: string(translate('canvasTools.t4'), false),
  dialogue: string(translate('canvasTools.t5'), false),
  narration: string(translate('canvasTools.t6'), false),
  characterAssetIds: array(string(translate('canvasTools.t7')), translate('canvasTools.t8')),
  sceneAssetId: string(translate('canvasTools.t9'), false),
  propAssetIds: array(string(translate('canvasTools.t10')), translate('canvasTools.t11')),
  shotPrompt: string(translate('canvasTools.t12Desc'), false),
  shotSize: string(translate('canvasTools.t13'), false),
  angle: string(translate('canvasTools.t14'), false),
  movement: string(translate('canvasTools.t15Desc'), false),
  sceneLayout: string(translate('canvasTools.t16'), false),
  composition: string(translate('canvasTools.t17Desc'), false),
  blocking: string(translate('canvasTools.t18Desc'), false),
  lighting: string(translate('canvasTools.t19Desc'), false),
  focalLength: string(translate('canvasTools.t20'), false),
  aperture: string(translate('canvasTools.t21'), false),
  iso: string(translate('canvasTools.t22'), false),
  colorTone: string(translate('canvasTools.t23Desc'), false),
  mood: string(translate('canvasTools.t24'), false),
  microExpression: string(translate('canvasTools.t25'), false),
  costume: string(translate('canvasTools.t26'), false),
  characterReferences: string(translate('canvasTools.t27Desc'), false),
  actionBeats: string(translate('canvasTools.t28Desc'), false),
  soundEffects: string(translate('canvasTools.t29'), false),
  transition: string(translate('canvasTools.t30Desc'), false),
  firstFrame: string(translate('canvasTools.t31'), false),
  lastFrame: string(translate('canvasTools.t32'), false),
  continuity: string(translate('canvasTools.t33Desc'), false),
  negativePrompt: string(translate('canvasTools.t34'), false),
  inSec: number(translate('canvasTools.t35')),
  outSec: number(translate('canvasTools.t36')),
  durationSec: number(translate('canvasTools.t37')),
  keyframeNodeIds: array(string(translate('canvasTools.t38')), translate('canvasTools.t39')),
  cameraDesignId: string(translate('canvasTools.t40'), false),
  actionDesignId: string(translate('canvasTools.t41'), false),
  frameDesignId: string(translate('canvasTools.t42'), false),
}

// ─── 工具定义 ──────────────────────────────────────────────────────────────

const tools: CanvasToolDescriptor[] = [
  // ───────── 项目 / 概览 ─────────
  {
    name: 'canvas_describe_tool',
    description: translate('canvasTools.tpl3LongDesc'),
    paramsSchema: {
      type: 'object',
      required: ['toolName'],
      additionalProperties: false,
      properties: {
        toolName: {
          type: 'string',
          minLength: 1,
          description: translate('canvasTools.tpl4Desc'),
        },
      },
    },
    handler: async (_ctx, input: { toolName: string }) => {
      const tool = tools.find((candidate) => candidate.name === input.toolName)
      if (!tool) throw new Error(translate('canvasTools.tpl5Desc', { name: input.toolName }))
      return {
        name: tool.name,
        description: tool.description,
        inputSchema: tool.paramsSchema,
      }
    },
  },
  {
    name: 'canvas_get_project_summary',
    description: translate('canvasTools.tpl6LongDesc'),
    paramsSchema: { type: 'object', properties: {} },
    handler: async (ctx) => {
      const snap = requireSnapshot(ctx)
      const activeId = snap.activeBoardId ?? snap.board.id
      const boards = (snap.boards ?? [snap.board]).map((b) => summarizeBoard(b, b.id === activeId))
      return {
        projectId: snap.project.id,
        title: snap.project.title,
        description: snap.project.description,
        rootPath: snap.project.rootPath,
        settings: snap.project.settings ?? {},
        canvasMode: 'single_canvas',
        activeBoardId: activeId,
        boards,
        counts: {
          nodes: snap.nodes.length,
          assets: snap.assets.length,
          tasks: snap.tasks.length,
        },
      }
    },
  },
  {
    name: 'canvas_update_project_settings',
    description: translate('canvasTools.tpl7Desc'),
    paramsSchema: {
      type: 'object',
      properties: {
        prompt: string(translate('canvasTools.t47'), false),
        negativePrompt: string(translate('canvasTools.t48'), false),
      },
    },
    handler: async (ctx, input: { prompt?: string; negativePrompt?: string }) => {
      await ctx.workspace.updateProjectSettings(input)
      return { ok: true }
    },
  },

  {
    name: 'canvas_get_available_actions',
    description: translate('canvasTools.tpl8LongDesc'),
    paramsSchema: {
      type: 'object',
      required: ['nodeId'],
      properties: { nodeId: string(translate('canvasTools.t50')) },
    },
    handler: async (ctx, input: { nodeId: string }) => {
      const snap = requireSnapshot(ctx)
      const node = findNode(snap, input.nodeId)
      const assetKinds = resolveNodeAssetKinds(node, snap.assets)
      const actions = getCanvasAgentAvailableActions(node, { assetKinds }).map((action) => {
        if (
          action.execution !== 'create_operation_node' ||
          (action.source !== 'pipeline' && action.source !== 'recommended_flow')
        ) {
          return action
        }
        return {
          ...action,
          toolName: 'canvas_create_pipeline_operation_node',
          toolRecipe: {
            toolName: 'canvas_create_pipeline_operation_node',
            arguments: { actionId: action.id, sourceNodeId: node.id },
          },
        }
      })
      return {
        node: summarizeNodeLite(node),
        actions,
        usage: {
          preferredOrder: [
            translate('canvasTools.t51Desc'),
            translate('canvasTools.t52Desc'),
            translate('canvasTools.t53Desc'),
          ],
        },
      }
    },
  },
  {
    name: 'canvas_get_production_plan',
    description: translate('canvasTools.tpl9LongDesc'),
    paramsSchema: { type: 'object', properties: {} },
    handler: async (ctx) => {
      const snap = requireSnapshot(ctx)
      return buildCanvasAgentProductionPlan({
        assets: snap.assets,
        nodes: snap.nodes,
        metadata: snap.project.metadata,
      })
    },
  },

  // ───────── 节点查询 ─────────
  {
    name: 'canvas_list_nodes',
    description: translate('canvasTools.tpl10Desc'),
    paramsSchema: {
      type: 'object',
      properties: {
        type: enumOf(NODE_TYPES, translate('canvasTools.t56Desc')),
        includeHidden: boolean(translate('canvasTools.t57Desc')),
      },
    },
    handler: async (
      ctx,
      input: { type?: CanvasNodeType; includeHidden?: boolean; boardId?: string },
    ) => {
      const snap = requireSnapshot(ctx)
      const bid = input.boardId ?? activeBoardId(ctx)
      const nodes = snap.nodes
        .filter((n) => n.boardId === bid)
        .filter((n) => input.includeHidden || !n.hidden)
        .filter((n) => !input.type || n.type === input.type)
        .map(summarizeNodeLite)
      return { nodes, count: nodes.length }
    },
  },
  {
    name: 'canvas_get_node',
    description: translate('canvasTools.t58Desc'),
    paramsSchema: {
      type: 'object',
      required: ['nodeId'],
      properties: { nodeId: string(translate('canvasTools.t50')) },
    },
    handler: async (ctx, input: { nodeId: string }) => {
      const snap = requireSnapshot(ctx)
      const n = findNode(snap, input.nodeId)
      return {
        node: {
          ...summarizeNode(n),
          data: n.data,
          rotation: n.rotation,
          zIndex: n.zIndex,
          locked: n.locked,
        },
      }
    },
  },
  {
    name: 'canvas_get_operation_config',
    description: translate('canvasTools.tpl11LongDesc'),
    paramsSchema: {
      type: 'object',
      required: ['nodeId'],
      properties: { nodeId: string(translate('canvasTools.t60')) },
    },
    handler: async (ctx, input: { nodeId: string }) => {
      const snap = requireSnapshot(ctx)
      const node = findNode(snap, input.nodeId)
      if (!isOperationNode(node))
        throw new Error(translate('canvasTools.tpl12Desc', { id: input.nodeId }))
      return summarizeOperationConfig(snap, node)
    },
  },
  {
    name: 'canvas_find_nodes',
    description: translate('canvasTools.tpl13Desc'),
    paramsSchema: {
      type: 'object',
      required: ['query'],
      properties: {
        query: string(translate('canvasTools.t62Desc')),
      },
    },
    handler: async (ctx, input: { query: string; boardId?: string }) => {
      const snap = requireSnapshot(ctx)
      const q = input.query.toLowerCase()
      const bid = input.boardId ?? activeBoardId(ctx)
      const nodes = snap.nodes
        .filter((n) => n.boardId === bid && !n.hidden)
        .filter(
          (n) =>
            (n.title ?? '').toLowerCase().includes(q) ||
            (n.data.text ?? '').toLowerCase().includes(q) ||
            (n.data.prompt ?? '').toLowerCase().includes(q),
        )
        .map(summarizeNodeLite)
      return { nodes, count: nodes.length }
    },
  },
  {
    name: 'canvas_list_group_members',
    description: translate('canvasTools.t63'),
    paramsSchema: {
      type: 'object',
      required: ['groupId'],
      properties: { groupId: string(translate('canvasTools.t64')) },
    },
    handler: async (ctx, input: { groupId: string }) => {
      const snap = requireSnapshot(ctx)
      const members = snap.nodes.filter((n) => n.parentNodeId === input.groupId).map(summarizeNode)
      return { groupId: input.groupId, members, count: members.length }
    },
  },

  // ───────── 节点编辑 ─────────
  {
    name: 'canvas_update_node',
    description: translate('canvasTools.tpl14LongDesc'),
    paramsSchema: {
      type: 'object',
      required: ['nodeId'],
      properties: {
        nodeId: string(translate('canvasTools.t50')),
        title: string(translate('canvasTools.t66'), false),
        content: string(translate('canvasTools.t67Desc'), false),
        data: {
          type: 'object',
          description: translate('canvasTools.t68Desc'),
          additionalProperties: true,
        },
      },
    },
    handler: async (
      ctx,
      input: {
        nodeId: string
        title?: string
        content?: string
        data?: Partial<CanvasNodeData>
      },
    ) => {
      const node = await updateCanvasNode(ctx, input)
      return {
        ok: true,
        nodeId: input.nodeId,
        nodeType: node.type,
        refreshed: true,
      }
    },
  },
  {
    name: 'canvas_create_text_node',
    description: translate('canvasTools.tpl15LongDesc'),
    paramsSchema: {
      type: 'object',
      required: ['text'],
      properties: {
        text: string(translate('canvasTools.t70')),
        x: number(translate('canvasTools.t71')),
        y: number(translate('canvasTools.t72')),
      },
    },
    handler: async (ctx, input: { text: string; x?: number; y?: number }) => {
      const snap = requireSnapshot(ctx)
      const bid = activeBoardId(ctx)
      const pos =
        input.x != null && input.y != null ? { x: input.x, y: input.y } : findEmptySpot(snap, bid)
      const node = await ctx.workspace.createTextNode({ text: input.text, ...pos })
      return { nodeId: node?.id ?? null }
    },
  },
  {
    name: 'canvas_create_prompt_node',
    description: translate('canvasTools.tpl16LongDesc'),
    paramsSchema: {
      type: 'object',
      required: ['prompt'],
      properties: {
        prompt: string(translate('canvasTools.t74')),
        title: string(translate('canvasTools.t66'), false),
        x: number(translate('canvasTools.t71')),
        y: number(translate('canvasTools.t72')),
      },
    },
    handler: async (ctx, input: { prompt: string; title?: string; x?: number; y?: number }) => {
      const snap = requireSnapshot(ctx)
      const bid = activeBoardId(ctx)
      const pos =
        input.x != null && input.y != null ? { x: input.x, y: input.y } : findEmptySpot(snap, bid)
      const node = await ctx.workspace.createTextNode({ text: input.prompt, ...pos })
      if (node) {
        await ctx.workspace.updateNodeData(node.id, { prompt: input.prompt, format: 'prompt' })
        if (input.title) await ctx.workspace.patchNodes([node.id], { title: input.title })
      }
      return { nodeId: node?.id ?? null }
    },
  },
  {
    name: 'canvas_update_node_data',
    description: translate('canvasTools.tpl17LongDesc'),
    paramsSchema: {
      type: 'object',
      required: ['nodeId', 'data'],
      properties: {
        nodeId: string(translate('canvasTools.t50')),
        data: {
          type: 'object',
          description: translate('canvasTools.tpl18LongDesc'),
          additionalProperties: true,
          properties: {
            text: string(translate('canvasTools.t77'), false),
            prompt: string(translate('canvasTools.t78'), false),
            negativePrompt: string(translate('canvasTools.t79'), false),
            format: enumOf(['plain', 'markdown', 'prompt'], translate('canvasTools.t80')),
            message: string(translate('canvasTools.t81'), false),
            url: string(translate('canvasTools.t82Desc'), false),
            thumbnailUrl: string(translate('canvasTools.t83'), false),
            mimeType: string(translate('canvasTools.t84'), false),
            operation: enumOf(OPERATION_TYPES as unknown as string[], translate('canvasTools.t85')),
            modelParams: {
              type: 'object',
              additionalProperties: true,
              description: translate('canvasTools.t86'),
            },
            agentId: string(translate('canvasTools.t87Desc'), false),
            providerProfileId: string(translate('canvasTools.t88Desc'), false),
            manifestId: string(translate('canvasTools.t89Desc'), false),
            modelId: string(translate('canvasTools.t90'), false),
            reasoningEffort: enumOf(
              ['minimal', 'low', 'medium', 'high', 'xhigh', 'max'],
              translate('canvasTools.t91'),
            ),
            skillIds: array(string('Skill id'), translate('canvasTools.t92Desc')),
            pipelineRole: enumOf(
              PIPELINE_ROLES as unknown as string[],
              translate('canvasTools.t93Desc'),
            ),
            outputPipelineRole: enumOf(
              PIPELINE_ROLES as unknown as string[],
              translate('canvasTools.t94'),
            ),
            productionState: enumOf(
              PRODUCTION_STATES as unknown as string[],
              translate('canvasTools.t95'),
            ),
            shotGroupId: string(translate('canvasTools.t96'), false),
            shotSegmentId: string(translate('canvasTools.t97'), false),
          },
        },
      },
    },
    handler: async (ctx, input: { nodeId: string; data: Partial<CanvasNodeData> }) => {
      await updateCanvasNode(ctx, input)
      return { ok: true, refreshed: true }
    },
  },
  {
    name: 'canvas_patch_nodes',
    description: translate('canvasTools.t98Desc'),
    paramsSchema: {
      type: 'object',
      required: ['nodeIds', 'patch'],
      properties: {
        nodeIds: array(string(translate('canvasTools.t50')), translate('canvasTools.t99')),
        patch: {
          type: 'object',
          properties: {
            x: number(translate('canvasTools.t100')),
            y: number(translate('canvasTools.t101')),
            width: number(translate('canvasTools.t102')),
            height: number(translate('canvasTools.t103')),
            rotation: number(translate('canvasTools.t104')),
            zIndex: number(translate('canvasTools.t105')),
            locked: boolean(translate('canvasTools.t106')),
            hidden: boolean(translate('canvasTools.t107')),
            title: string(translate('canvasTools.t108'), false),
          },
        },
      },
    },
    handler: async (
      ctx,
      input: {
        nodeIds: string[]
        patch: Partial<
          Pick<
            CanvasNode,
            'x' | 'y' | 'width' | 'height' | 'rotation' | 'zIndex' | 'locked' | 'hidden' | 'title'
          >
        >
      },
    ) => {
      await ctx.workspace.patchNodes(input.nodeIds, input.patch)
      return { ok: true }
    },
  },
  {
    name: 'canvas_update_operation_config',
    description: translate('canvasTools.tpl19LongDesc'),
    paramsSchema: {
      type: 'object',
      required: ['nodeId', 'config'],
      properties: {
        nodeId: string(translate('canvasTools.t60')),
        title: string(translate('canvasTools.t66'), false),
        config: {
          type: 'object',
          additionalProperties: true,
          description: translate('canvasTools.tpl20Desc'),
        },
      },
    },
    handler: async (
      ctx,
      input: { nodeId: string; title?: string; config: Partial<CanvasNodeData> },
    ) => {
      const snap = requireSnapshot(ctx)
      const node = findNode(snap, input.nodeId)
      if (!isOperationNode(node))
        throw new Error(translate('canvasTools.tpl12Desc', { id: input.nodeId }))
      await updateCanvasNode(ctx, {
        nodeId: input.nodeId,
        ...(input.title != null ? { title: input.title } : {}),
        data: input.config,
      })
      return {
        ok: true,
        nodeId: input.nodeId,
        taskId: node.taskId ?? null,
        refreshed: true,
      }
    },
  },
  {
    name: 'canvas_delete_nodes',
    description: translate('canvasTools.t111Desc'),
    paramsSchema: {
      type: 'object',
      required: ['nodeIds'],
      properties: {
        nodeIds: array(string(translate('canvasTools.t50')), translate('canvasTools.t112')),
      },
    },
    handler: async (ctx, input: { nodeIds: string[] }) => {
      await ctx.workspace.deleteNodes(input.nodeIds)
      return { ok: true, deleted: input.nodeIds.length }
    },
  },
  {
    name: 'canvas_duplicate_nodes',
    description: translate('canvasTools.t113Desc'),
    paramsSchema: {
      type: 'object',
      required: ['nodeIds'],
      properties: {
        nodeIds: array(string(translate('canvasTools.t50')), translate('canvasTools.t114')),
      },
    },
    handler: async (ctx, input: { nodeIds: string[] }) => {
      await ctx.workspace.duplicateNodes(input.nodeIds)
      return { ok: true }
    },
  },
  {
    name: 'canvas_connect_nodes',
    description: translate('canvasTools.tpl21LongDesc'),
    paramsSchema: {
      type: 'object',
      required: ['sourceNodeId', 'targetNodeId'],
      properties: {
        sourceNodeId: string(translate('canvasTools.t116')),
        targetNodeId: string(translate('canvasTools.t117')),
      },
    },
    handler: async (ctx, input: { sourceNodeId: string; targetNodeId: string }) => {
      await ctx.workspace.connectNodes(input)
      return { ok: true }
    },
  },
  {
    name: 'canvas_create_group',
    description: translate('canvasTools.t118Desc'),
    paramsSchema: {
      type: 'object',
      required: ['nodeIds'],
      properties: {
        nodeIds: array(string(translate('canvasTools.t50')), translate('canvasTools.t119Desc')),
      },
    },
    handler: async (ctx, input: { nodeIds: string[] }) => {
      const beforeIds = new Set(requireSnapshot(ctx).nodes.map((n) => n.id))
      const updated = await ctx.workspace.createGroupNode(input.nodeIds)
      let group = updated?.nodes?.find((n) => !beforeIds.has(n.id) && n.type === 'group')
      if (!group) {
        const fallback = requireSnapshot(ctx)
        group = [...fallback.nodes]
          .reverse()
          .find((n) => !beforeIds.has(n.id) && n.type === 'group')
      }
      return { groupId: group?.id ?? null }
    },
  },
  {
    name: 'canvas_dissolve_group',
    description: translate('canvasTools.t120Desc'),
    paramsSchema: {
      type: 'object',
      required: ['groupId'],
      properties: { groupId: string(translate('canvasTools.t64')) },
    },
    handler: async (ctx, input: { groupId: string }) => {
      await ctx.workspace.dissolveGroupNode(input.groupId)
      return { ok: true }
    },
  },
  {
    name: 'canvas_add_to_group',
    description: translate('canvasTools.t121'),
    paramsSchema: {
      type: 'object',
      required: ['groupId', 'nodeIds'],
      properties: {
        groupId: string(translate('canvasTools.t64')),
        nodeIds: array(string(translate('canvasTools.t50')), translate('canvasTools.t122')),
      },
    },
    handler: async (ctx, input: { groupId: string; nodeIds: string[] }) => {
      await ctx.workspace.addNodesToGroup(input.groupId, input.nodeIds)
      return { ok: true }
    },
  },
  {
    name: 'canvas_remove_from_group',
    description: translate('canvasTools.t123'),
    paramsSchema: {
      type: 'object',
      required: ['nodeIds'],
      properties: {
        nodeIds: array(string(translate('canvasTools.t50')), translate('canvasTools.t124')),
      },
    },
    handler: async (ctx, input: { nodeIds: string[] }) => {
      await ctx.workspace.removeNodesFromGroup(input.nodeIds)
      return { ok: true }
    },
  },

  // ───────── 资产 ─────────
  {
    name: 'canvas_list_assets',
    description: translate('canvasTools.tpl22Desc'),
    paramsSchema: {
      type: 'object',
      properties: {
        type: enumOf(
          ['image', 'audio', 'video', 'text', 'prompt', 'file'],
          translate('canvasTools.t126'),
        ),
        kind: string(translate('canvasTools.t127LongDesc'), false),
      },
    },
    handler: async (ctx, input: { type?: string; kind?: string }) => {
      const snap = requireSnapshot(ctx)
      let list = snap.assets
      if (input.type) list = list.filter((a) => a.type === input.type)
      if (input.kind)
        list = list.filter((a) => (a.metadata?.kind as string | undefined) === input.kind)
      return { assets: list.map(summarizeAsset), count: list.length }
    },
  },
  {
    name: 'canvas_get_asset',
    description: translate('canvasTools.t128Desc'),
    paramsSchema: {
      type: 'object',
      required: ['assetId'],
      properties: { assetId: string(translate('canvasTools.t129')) },
    },
    handler: async (ctx, input: { assetId: string }) => {
      const snap = requireSnapshot(ctx)
      const a = snap.assets.find((x) => x.id === input.assetId)
      if (!a) throw new Error(translate('canvasTools.tpl23Desc', { id: input.assetId }))
      return { asset: { ...summarizeAsset(a), contentText: a.contentText, metadata: a.metadata } }
    },
  },
  {
    name: 'canvas_insert_asset',
    description: translate('canvasTools.tpl24Desc'),
    paramsSchema: {
      type: 'object',
      required: ['assetId'],
      properties: {
        assetId: string(translate('canvasTools.t129')),
        x: number(translate('canvasTools.t71')),
        y: number(translate('canvasTools.t72')),
      },
    },
    handler: async (ctx, input: { assetId: string; boardId?: string; x?: number; y?: number }) => {
      const snap = requireSnapshot(ctx)
      const bid = input.boardId ?? activeBoardId(ctx)
      const pos =
        input.x != null && input.y != null ? { x: input.x, y: input.y } : findEmptySpot(snap, bid)
      const node = await ctx.workspace.insertAsset({ assetId: input.assetId, boardId: bid, ...pos })
      return { nodeId: node?.id ?? null }
    },
  },
  {
    name: 'canvas_create_film_asset',
    description: translate('canvasTools.tpl25Desc'),
    paramsSchema: {
      type: 'object',
      required: ['kind', 'name'],
      properties: {
        kind: enumOf(FILM_ASSET_KINDS as unknown as string[], translate('canvasTools.t126')),
        name: string(translate('canvasTools.t132')),
        text: string(translate('canvasTools.t133'), false),
        prompt: string(translate('canvasTools.t134'), false),
        tags: array(string(translate('canvasTools.t135')), translate('canvasTools.t136')),
        attributes: {
          type: 'object',
          description: translate('canvasTools.t137Desc'),
          additionalProperties: true,
        },
      },
    },
    handler: async (ctx, input: CreateFilmAssetInput) => {
      const asset = await ctx.workspace.createFilmAsset(input)
      return { assetId: asset.id, title: asset.title }
    },
  },
  {
    name: 'canvas_update_film_asset',
    description: translate('canvasTools.t138'),
    paramsSchema: {
      type: 'object',
      required: ['assetId'],
      properties: {
        assetId: string(translate('canvasTools.t129')),
        title: string(translate('canvasTools.t108'), false),
        contentText: string(translate('canvasTools.t139'), false),
        prompt: string(translate('canvasTools.t78'), false),
        tags: array(string(translate('canvasTools.t135')), translate('canvasTools.t136')),
        attributes: {
          type: 'object',
          additionalProperties: true,
          description: translate('canvasTools.t140'),
        },
      },
    },
    handler: async (
      ctx,
      input: {
        assetId: string
        title?: string
        contentText?: string
        prompt?: string
        tags?: string[]
        attributes?: Record<string, unknown>
      },
    ) => {
      const { assetId, ...patch } = input
      await ctx.workspace.updateFilmAsset(assetId, patch as Record<string, unknown>)
      return { ok: true }
    },
  },
  {
    name: 'canvas_delete_film_asset',
    description: translate('canvasTools.t141'),
    paramsSchema: {
      type: 'object',
      required: ['assetId'],
      properties: { assetId: string(translate('canvasTools.t129')) },
    },
    handler: async (ctx, input: { assetId: string }) => {
      await ctx.workspace.deleteFilmAsset(input.assetId)
      return { ok: true }
    },
  },
  {
    name: 'canvas_search_assets',
    description: translate('canvasTools.t142Desc'),
    paramsSchema: {
      type: 'object',
      properties: {
        query: string(translate('canvasTools.t143'), false),
        kinds: array(
          enumOf(FILM_ASSET_KINDS as unknown as string[], 'kind'),
          translate('canvasTools.t144'),
        ),
        tags: array(string('tag'), translate('canvasTools.t145')),
        sortBy: enumOf(['updated', 'created', 'name', 'usage'], translate('canvasTools.t146')),
      },
    },
    handler: async (
      ctx,
      input: {
        query?: string
        kinds?: string[]
        tags?: string[]
        sortBy?: 'updated' | 'created' | 'name' | 'usage'
      },
    ) => {
      const list = await canvasApi.searchFilmAssets(ctx.projectId, input as never)
      return { assets: list.map(summarizeAsset), count: list.length }
    },
  },

  // ───────── 操作节点 / 任务 ─────────
  {
    name: 'canvas_list_capabilities',
    description: translate('canvasTools.tpl26Desc'),
    paramsSchema: { type: 'object', properties: {} },
    handler: async () => {
      const { CANVAS_CAPABILITIES } = await import('./canvas.capabilities')
      const caps = (CANVAS_CAPABILITIES as CanvasCapability[])
        .filter((c) => c.enabled)
        .map((c) => ({
          id: c.id,
          operation: c.operation,
          label: c.label,
          inputTypes: c.inputTypes,
          outputTypes: c.outputTypes,
          paramsSchema: c.paramsSchema,
        }))
      return { capabilities: caps }
    },
  },
  {
    name: 'canvas_create_operation_node',
    description: translate('canvasTools.tpl27LongDesc'),
    paramsSchema: {
      type: 'object',
      required: ['operation'],
      properties: {
        operation: enumOf(OPERATION_TYPES as unknown as string[], translate('canvasTools.t85')),
        inputNodeIds: array(
          string(translate('canvasTools.t50')),
          translate('canvasTools.t149Desc'),
        ),
        title: string(translate('canvasTools.t150'), false),
        message: string(translate('canvasTools.t151'), false),
        prompt: string(translate('canvasTools.t152Desc'), false),
        negativePrompt: string(translate('canvasTools.t153'), false),
        modelParams: {
          type: 'object',
          additionalProperties: true,
          description: translate('canvasTools.tpl28Desc'),
        },
        agentId: string(translate('canvasTools.t155Desc'), false),
        providerProfileId: string(translate('canvasTools.t156Desc'), false),
        manifestId: string(translate('canvasTools.t157Desc'), false),
        modelId: string(translate('canvasTools.t158'), false),
        taskPipelineRole: enumOf(
          PIPELINE_ROLES as unknown as string[],
          translate('canvasTools.t159'),
        ),
        outputPipelineRole: enumOf(
          PIPELINE_ROLES as unknown as string[],
          translate('canvasTools.t160'),
        ),
        x: number(translate('canvasTools.t71')),
        y: number(translate('canvasTools.t72')),
      },
    },
    handler: async (
      ctx,
      input: {
        operation: CanvasOperationType
        inputNodeIds?: string[]
        title?: string
        message?: string
        prompt?: string
        negativePrompt?: string
        modelParams?: Record<string, unknown>
        agentId?: string
        providerProfileId?: string
        manifestId?: string
        modelId?: string
        taskPipelineRole?: CanvasNodeData['pipelineRole']
        outputPipelineRole?: CanvasNodeData['outputPipelineRole']
        x?: number
        y?: number
      },
    ) => {
      const snap = requireSnapshot(ctx)
      const bid = activeBoardId(ctx)
      const pos =
        input.x != null && input.y != null ? { x: input.x, y: input.y } : findEmptySpot(snap, bid)
      const beforeIds = new Set(snap.nodes.map((n) => n.id))
      const updated = await ctx.workspace.createOperationNode({
        boardId: bid,
        operation: input.operation,
        inputNodeIds: input.inputNodeIds ?? [],
        ...(input.title ? { title: input.title } : {}),
        ...(input.message ? { message: input.message } : {}),
        ...(input.prompt ? { prompt: input.prompt } : {}),
        ...(input.negativePrompt ? { negativePrompt: input.negativePrompt } : {}),
        ...(input.modelParams ? { modelParams: input.modelParams } : {}),
        ...(input.agentId ? { agentId: input.agentId } : {}),
        ...(input.providerProfileId ? { providerProfileId: input.providerProfileId } : {}),
        ...(input.manifestId ? { manifestId: input.manifestId } : {}),
        ...(input.modelId ? { modelId: input.modelId } : {}),
        ...(input.taskPipelineRole ? { taskPipelineRole: input.taskPipelineRole } : {}),
        ...(input.outputPipelineRole ? { outputPipelineRole: input.outputPipelineRole } : {}),
        ...pos,
      })
      // 优先用返回快照 diff 出新节点（createOperationNode 返回的 state 此刻可能尚未刷新到 React）；
      // 返回快照异常时才退化为重读最新 state，并叠加 beforeId 约束避免误匹配旧同类节点
      let created = updated?.nodes?.find((n) => !beforeIds.has(n.id) && n.type === input.operation)
      if (!created) {
        const fallback = requireSnapshot(ctx)
        created = [...fallback.nodes]
          .reverse()
          .find((n) => !beforeIds.has(n.id) && n.type === input.operation)
      }
      return { nodeId: created?.id ?? null, operationLabel: operationLabel(input.operation) }
    },
  },
  {
    name: 'canvas_run_operation',
    description: translate('canvasTools.tpl29Desc'),
    paramsSchema: {
      type: 'object',
      required: ['nodeId'],
      properties: {
        nodeId: string(translate('canvasTools.t162')),
        prompt: string(translate('canvasTools.t163Desc'), false),
        negativePrompt: string(translate('canvasTools.t79'), false),
        inputNodeIds: array(string(translate('canvasTools.t50')), translate('canvasTools.t164')),
        inputAssetIds: array(
          string(translate('canvasTools.t129')),
          translate('canvasTools.t165Desc'),
        ),
        agentId: string(translate('canvasTools.t166Desc'), false),
        providerProfileId: string(translate('canvasTools.t167Desc'), false),
        manifestId: string(translate('canvasTools.t168Desc'), false),
        modelId: string(translate('canvasTools.t169'), false),
        reasoningEffort: {
          type: 'string',
          enum: ['minimal', 'low', 'medium', 'high', 'xhigh', 'max'],
          description: translate('canvasTools.tpl30Desc'),
        },
        modelParams: {
          type: 'object',
          additionalProperties: true,
          description: translate('canvasTools.tpl31Desc'),
        },
      },
    },
    handler: async (
      ctx,
      input: {
        nodeId: string
        prompt?: string
        negativePrompt?: string
        inputNodeIds?: string[]
        inputAssetIds?: string[]
        agentId?: string
        providerProfileId?: string
        manifestId?: string
        modelId?: string
        reasoningEffort?: SessionReasoningEffort
        modelParams?: Record<string, unknown>
      },
    ) => {
      const snap = requireSnapshot(ctx)
      const node = findNode(snap, input.nodeId)
      if (!isOperationNode(node))
        throw new Error(translate('canvasTools.tpl12Desc', { id: input.nodeId }))
      const savedPrompt =
        node.data.prompt ??
        (node.taskId ? snap.tasks.find((t) => t.id === node.taskId)?.prompt : null)
      const prompt = input.prompt ?? savedPrompt
      if (!prompt?.trim()) throw new Error(translate('canvasTools.tpl32Desc'))
      const { nodeId, ...params } = input
      await ctx.workspace.runOperationNode(nodeId, { ...params, prompt })
      return { ok: true, nodeId }
    },
  },
  {
    name: 'canvas_retry_operation',
    description: translate('canvasTools.t173Desc'),
    paramsSchema: {
      type: 'object',
      required: ['nodeId'],
      properties: { nodeId: string(translate('canvasTools.t162')) },
    },
    handler: async (ctx, input: { nodeId: string }) => {
      await ctx.workspace.retryOperationNode(input.nodeId)
      return { ok: true }
    },
  },
  {
    name: 'canvas_cancel_task',
    description: translate('canvasTools.t174'),
    paramsSchema: {
      type: 'object',
      required: ['taskId'],
      properties: { taskId: string(translate('canvasTools.t175')) },
    },
    handler: async (ctx, input: { taskId: string }) => {
      await ctx.workspace.cancelTask(input.taskId)
      return { ok: true }
    },
  },
  {
    name: 'canvas_list_tasks',
    description: translate('canvasTools.t176Desc'),
    paramsSchema: {
      type: 'object',
      properties: {
        status: enumOf(
          ['pending', 'running', 'completed', 'failed', 'cancelled'],
          translate('canvasTools.t177'),
        ),
      },
    },
    handler: async (ctx, input: { status?: string }) => {
      const snap = requireSnapshot(ctx)
      let tasks = snap.tasks
      if (input.status) tasks = tasks.filter((t) => t.status === input.status)
      return { tasks: tasks.map(summarizeTask), count: tasks.length }
    },
  },
  {
    name: 'canvas_list_media_models',
    description: translate('canvasTools.tpl33Desc'),
    paramsSchema: {
      type: 'object',
      properties: { enabledOnly: boolean(translate('canvasTools.t179Desc')) },
    },
    handler: async (_ctx, input: { enabledOnly?: boolean }) => {
      const { models } = await canvasApi.listMediaModels({ enabledOnly: input.enabledOnly ?? true })
      return { models }
    },
  },

  // ───────── 分镜（影视开发专用）─────────
  {
    name: 'canvas_list_shot_groups',
    description: translate('canvasTools.t180Desc'),
    paramsSchema: { type: 'object', properties: {} },
    handler: async (ctx) => {
      const snap = requireSnapshot(ctx)
      const film = (snap.project.metadata?.film as { shotGroups?: ShotGroup[] } | undefined) ?? {}
      const groups = (film.shotGroups ?? []).map((g) => ({
        id: g.id,
        name: g.name,
        description: g.description,
        segmentCount: g.segments?.length ?? 0,
        segments: (g.segments ?? []).map((s) => ({
          id: s.id,
          index: s.index,
          title: s.title,
          description: s.description,
        })),
      }))
      return { groups, count: groups.length }
    },
  },
  {
    name: 'canvas_create_shot_group',
    description: translate('canvasTools.t181Desc'),
    paramsSchema: {
      type: 'object',
      required: ['name'],
      properties: {
        name: string(translate('canvasTools.t182')),
        description: string(translate('canvasTools.t183'), false),
      },
    },
    handler: async (ctx, input: { name: string; description?: string }) => {
      const created = await ctx.workspace.createShotGroup(input)
      return { groupId: created.id, name: created.name }
    },
  },
  {
    name: 'canvas_update_shot_group',
    description: translate('canvasTools.t184'),
    paramsSchema: {
      type: 'object',
      required: ['groupId'],
      properties: {
        groupId: string(translate('canvasTools.t185')),
        name: string(translate('canvasTools.t186'), false),
        description: string(translate('canvasTools.t187'), false),
      },
    },
    handler: async (ctx, input: { groupId: string; name?: string; description?: string }) => {
      const { groupId, ...patch } = input
      await ctx.workspace.updateShotGroup(groupId, patch)
      return { ok: true }
    },
  },
  {
    name: 'canvas_delete_shot_group',
    description: translate('canvasTools.t188'),
    paramsSchema: {
      type: 'object',
      required: ['groupId'],
      properties: { groupId: string(translate('canvasTools.t185')) },
    },
    handler: async (ctx, input: { groupId: string }) => {
      await ctx.workspace.deleteShotGroup(input.groupId)
      return { ok: true }
    },
  },
  {
    name: 'canvas_create_shot_segment',
    description: translate('canvasTools.t189Desc'),
    paramsSchema: {
      type: 'object',
      required: ['groupId', 'title'],
      properties: {
        groupId: string(translate('canvasTools.t185')),
        title: string(translate('canvasTools.t190Desc')),
        ...SHOT_SEGMENT_TOOL_FIELDS,
      },
    },
    handler: async (ctx, input: { groupId: string; title: string } & Partial<ShotSegment>) => {
      const { groupId, ...segment } = input
      await ctx.workspace.createShotSegment(groupId, segment)
      return { ok: true }
    },
  },
  {
    name: 'canvas_update_shot_segment',
    description: translate('canvasTools.t191'),
    paramsSchema: {
      type: 'object',
      required: ['groupId', 'segmentId'],
      properties: {
        groupId: string(translate('canvasTools.t185')),
        segmentId: string(translate('canvasTools.t192')),
        title: string(translate('canvasTools.t108'), false),
        ...SHOT_SEGMENT_TOOL_FIELDS,
      },
    },
    handler: async (ctx, input: { groupId: string; segmentId: string } & Partial<ShotSegment>) => {
      const { groupId, segmentId, ...patch } = input
      await ctx.workspace.updateShotSegment(groupId, segmentId, patch)
      return { ok: true }
    },
  },
  {
    name: 'canvas_delete_shot_segment',
    description: translate('canvasTools.t193'),
    paramsSchema: {
      type: 'object',
      required: ['groupId', 'segmentId'],
      properties: {
        groupId: string(translate('canvasTools.t185')),
        segmentId: string(translate('canvasTools.t192')),
      },
    },
    handler: async (ctx, input: { groupId: string; segmentId: string }) => {
      await ctx.workspace.deleteShotSegment(input.groupId, input.segmentId)
      return { ok: true }
    },
  },

  // ───────── Agent 生成结果 → 画布（关键能力）─────────
  {
    name: 'canvas_insert_generated_image',
    description: translate('canvasTools.tpl34LongDesc'),
    paramsSchema: {
      type: 'object',
      required: ['source'],
      properties: {
        source: {
          oneOf: [
            {
              type: 'string',
              description: translate('canvasTools.t195LongDesc'),
            },
          ],
          description: translate('canvasTools.t196Desc'),
        },
        title: string(translate('canvasTools.t66'), false),
        x: number(translate('canvasTools.t71')),
        y: number(translate('canvasTools.t72')),
        width: number(translate('canvasTools.t197Desc')),
        height: number(translate('canvasTools.t198Desc')),
      },
    },
    handler: async (
      ctx,
      input: {
        source: string
        title?: string
        x?: number
        y?: number
        width?: number
        height?: number
      },
    ) => {
      const snap = requireSnapshot(ctx)
      const bid = activeBoardId(ctx)
      const pos =
        input.x != null && input.y != null ? { x: input.x, y: input.y } : findEmptySpot(snap, bid)

      // 把 source 落地为本地文件路径
      let filePath = input.source
      let mimeType = 'image/png'
      if (input.source.startsWith('data:')) {
        mimeType = input.source.match(/^data:([^;]+);/)?.[1] ?? 'image/png'
        const saved = await window.spark.invoke('file:save-pasted-image', {
          dataUrl: input.source,
          mimeType,
          suggestedBaseName: input.title ?? 'agent-image',
          storageScope: 'canvas',
          ...(snap.project.rootPath ? { projectRootPath: snap.project.rootPath } : {}),
        })
        filePath = saved.filePath
      } else if (/^https?:\/\//.test(input.source)) {
        // 远程 URL：让前端下载为 dataURL 再落盘
        const res = await fetch(input.source)
        const blob = await res.blob()
        mimeType = blob.type || mimeType
        const dataUrl = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader()
          reader.onload = () => resolve(String(reader.result))
          reader.onerror = () => reject(reader.error ?? new Error(translate('canvasTools.t199')))
          reader.readAsDataURL(blob)
        })
        const saved = await window.spark.invoke('file:save-pasted-image', {
          dataUrl,
          mimeType,
          suggestedBaseName: input.title ?? 'agent-image',
          storageScope: 'canvas',
          ...(snap.project.rootPath ? { projectRootPath: snap.project.rootPath } : {}),
        })
        filePath = saved.filePath
      }

      // 用 File 接口包一下（createImageNode 需要）
      const stub = new File([], filePath.split(/[\\/]/).pop() ?? 'image.png', { type: mimeType })
      const node = await ctx.workspace.createImageNode({
        file: stub,
        filePath,
        x: pos.x,
        y: pos.y,
        ...(input.width != null ? { width: input.width } : {}),
        ...(input.height != null ? { height: input.height } : {}),
      })
      if (node && input.title) await ctx.workspace.patchNodes([node.id], { title: input.title })
      return { nodeId: node?.id ?? null, filePath }
    },
  },
  {
    name: 'canvas_insert_generated_text',
    description: translate('canvasTools.tpl35LongDesc'),
    paramsSchema: {
      type: 'object',
      required: ['text'],
      properties: {
        text: string(translate('canvasTools.t70')),
        title: string(translate('canvasTools.t150'), false),
        format: enumOf(['plain', 'markdown', 'prompt'], translate('canvasTools.t201Desc')),
        x: number(translate('canvasTools.t71')),
        y: number(translate('canvasTools.t72')),
      },
    },
    handler: async (
      ctx,
      input: {
        text: string
        title?: string
        format?: 'plain' | 'markdown' | 'prompt'
        x?: number
        y?: number
      },
    ) => {
      const snap = requireSnapshot(ctx)
      const bid = activeBoardId(ctx)
      const pos =
        input.x != null && input.y != null ? { x: input.x, y: input.y } : findEmptySpot(snap, bid)
      const node = await ctx.workspace.createTextNode({ text: input.text, ...pos })
      if (node) {
        await ctx.workspace.updateNodeData(node.id, {
          text: input.text,
          format: input.format ?? 'markdown',
        })
        if (input.title) await ctx.workspace.patchNodes([node.id], { title: input.title })
      }
      return { nodeId: node?.id ?? null }
    },
  },

  ...SPECIALIZED_CANVAS_NODE_TOOLS,

  // ───────── 批量 / 高级操作（C3 增强）─────────
  {
    name: 'canvas_batch_create_nodes',
    description: translate('canvasTools.tpl36LongDesc'),
    paramsSchema: {
      type: 'object',
      required: ['nodes'],
      properties: {
        nodes: {
          type: 'array',
          description: translate('canvasTools.t203'),
          items: {
            type: 'object',
            properties: {
              text: string(translate('canvasTools.t204Desc'), false),
              prompt: string(translate('canvasTools.t205Desc'), false),
              type: enumOf(['text', 'prompt'], translate('canvasTools.t206Desc')),
              title: string(translate('canvasTools.t66'), false),
              x: number(translate('canvasTools.t207Desc')),
              y: number(translate('canvasTools.t72')),
            },
          },
        },
        connections: {
          type: 'array',
          description: translate('canvasTools.t208Desc'),
          items: {
            type: 'object',
            properties: {
              fromIndex: number(translate('canvasTools.t209Desc')),
              toIndex: number(translate('canvasTools.t210Desc')),
            },
          },
        },
        startX: number(translate('canvasTools.t211Desc')),
        startY: number(translate('canvasTools.t212')),
        spacing: number(translate('canvasTools.t213Desc')),
      },
    },
    handler: async (
      ctx,
      input: {
        nodes: Array<{
          text?: string
          prompt?: string
          type?: 'text' | 'prompt'
          title?: string
          x?: number
          y?: number
        }>
        connections?: Array<{ fromIndex: number; toIndex: number }>
        startX?: number
        startY?: number
        spacing?: number
      },
    ) => {
      if (input.nodes.length === 0) return { nodeIds: [], connectionCount: 0 }
      const snap = requireSnapshot(ctx)
      const bid = activeBoardId(ctx)
      const spacing = input.spacing ?? 360
      let cursorX = input.startX
      let cursorY = input.startY
      if (cursorX == null || cursorY == null) {
        const spot = findEmptySpot(snap, bid)
        cursorX = cursorX ?? spot.x
        cursorY = cursorY ?? spot.y
      }
      const createdIds: string[] = []
      for (let i = 0; i < input.nodes.length; i++) {
        const spec = input.nodes[i]
        if (!spec) continue
        const isPrompt = spec.type === 'prompt' || spec.prompt != null
        const content = isPrompt ? (spec.prompt ?? '') : (spec.text ?? '')
        const x = spec.x ?? cursorX + i * spacing
        const y = spec.y ?? cursorY
        const node = await ctx.workspace.createTextNode({ text: content, x, y })
        if (node) {
          createdIds.push(node.id)
          if (isPrompt) {
            await ctx.workspace.updateNodeData(node.id, {
              prompt: spec.prompt ?? content,
              format: 'prompt',
            })
          }
          if (spec.title) await ctx.workspace.patchNodes([node.id], { title: spec.title })
        }
      }
      // 建立连线
      let connectionCount = 0
      if (input.connections && createdIds.length > 0) {
        for (const conn of input.connections) {
          const sourceId = createdIds[conn.fromIndex]
          const targetId = createdIds[conn.toIndex]
          if (sourceId && targetId && sourceId !== targetId) {
            await ctx.workspace.connectNodes({ sourceNodeId: sourceId, targetNodeId: targetId })
            connectionCount++
          }
        }
      }
      return { nodeIds: createdIds, connectionCount }
    },
  },
  {
    name: 'canvas_align_nodes',
    description: translate('canvasTools.tpl37Desc'),
    paramsSchema: {
      type: 'object',
      required: ['nodeIds', 'direction'],
      properties: {
        nodeIds: array(string(translate('canvasTools.t50')), translate('canvasTools.t215Desc')),
        direction: enumOf(
          ['left', 'right', 'top', 'bottom', 'center-h', 'center-v'],
          translate('canvasTools.tpl38Desc'),
        ),
      },
    },
    handler: async (
      ctx,
      input: {
        nodeIds: string[]
        direction: 'left' | 'right' | 'top' | 'bottom' | 'center-h' | 'center-v'
      },
    ) => {
      const snap = requireSnapshot(ctx)
      const targets = input.nodeIds
        .map((id) => snap.nodes.find((n) => n.id === id))
        .filter((n): n is CanvasNode => n != null)
      if (targets.length < 2) throw new Error(translate('canvasTools.t217'))
      // 计算基准线
      const left = Math.min(...targets.map((n) => n.x))
      const right = Math.max(...targets.map((n) => n.x + n.width))
      const top = Math.min(...targets.map((n) => n.y))
      const bottom = Math.max(...targets.map((n) => n.y + n.height))
      const centerX = (left + right) / 2
      const centerY = (top + bottom) / 2
      // 逐个 patch
      for (const n of targets) {
        let patch: { x?: number; y?: number } = {}
        switch (input.direction) {
          case 'left':
            patch = { x: left }
            break
          case 'right':
            patch = { x: right - n.width }
            break
          case 'top':
            patch = { y: top }
            break
          case 'bottom':
            patch = { y: bottom - n.height }
            break
          case 'center-h':
            patch = { x: centerX - n.width / 2 }
            break
          case 'center-v':
            patch = { y: centerY - n.height / 2 }
            break
        }
        await ctx.workspace.patchNodes([n.id], patch)
      }
      return { ok: true, aligned: targets.length, direction: input.direction }
    },
  },
  {
    name: 'canvas_distribute_nodes',
    description: translate('canvasTools.t218Desc'),
    paramsSchema: {
      type: 'object',
      required: ['nodeIds', 'axis'],
      properties: {
        nodeIds: array(string(translate('canvasTools.t50')), translate('canvasTools.t219Desc')),
        axis: enumOf(['horizontal', 'vertical'], translate('canvasTools.t220')),
        gap: number(translate('canvasTools.t221Desc')),
      },
    },
    handler: async (
      ctx,
      input: { nodeIds: string[]; axis: 'horizontal' | 'vertical'; gap?: number },
    ) => {
      const snap = requireSnapshot(ctx)
      const targets = input.nodeIds
        .map((id) => snap.nodes.find((n) => n.id === id))
        .filter((n): n is CanvasNode => n != null)
      if (targets.length < 3) throw new Error(translate('canvasTools.t222'))
      const isH = input.axis === 'horizontal'
      // 按位置排序
      const sorted = [...targets].sort((a, b) => (isH ? a.x - b.x : a.y - b.y))
      const first = sorted[0]
      const last = sorted[sorted.length - 1]
      if (!first || !last) throw new Error(translate('canvasTools.t223'))
      const start = isH ? first.x : first.y
      const end = isH ? last.x + last.width : last.y + last.height
      const totalSpan = end - start
      const itemSizes = sorted.reduce((sum, n) => sum + (isH ? n.width : n.height), 0)
      const gap = input.gap ?? Math.max(20, (totalSpan - itemSizes) / (sorted.length - 1))
      let cursor = start
      for (const n of sorted) {
        const size = isH ? n.width : n.height
        const patch = isH ? { x: Math.round(cursor) } : { y: Math.round(cursor) }
        await ctx.workspace.patchNodes([n.id], patch)
        cursor += size + gap
      }
      return { ok: true, distributed: sorted.length, axis: input.axis, gap }
    },
  },
  {
    name: 'canvas_bring_to_front',
    description: translate('canvasTools.t224Desc'),
    paramsSchema: {
      type: 'object',
      required: ['nodeIds'],
      properties: {
        nodeIds: array(string(translate('canvasTools.t50')), translate('canvasTools.t225')),
      },
    },
    handler: async (ctx, input: { nodeIds: string[] }) => {
      const snap = requireSnapshot(ctx)
      const maxZ = snap.nodes.reduce((max, n) => Math.max(max, n.zIndex), 0)
      // 逐个递增，保持列表顺序
      let i = 0
      for (const id of input.nodeIds) {
        await ctx.workspace.patchNodes([id], { zIndex: maxZ + 1 + i })
        i++
      }
      return { ok: true, broughtToFront: input.nodeIds.length, maxZBefore: maxZ }
    },
  },
  {
    name: 'canvas_send_to_back',
    description: translate('canvasTools.t226Desc'),
    paramsSchema: {
      type: 'object',
      required: ['nodeIds'],
      properties: {
        nodeIds: array(string(translate('canvasTools.t50')), translate('canvasTools.t227')),
      },
    },
    handler: async (ctx, input: { nodeIds: string[] }) => {
      const snap = requireSnapshot(ctx)
      const minZ = snap.nodes.reduce((min, n) => Math.min(min, n.zIndex), 0)
      let i = 0
      for (const id of input.nodeIds) {
        await ctx.workspace.patchNodes([id], { zIndex: minZ - 1 - i })
        i++
      }
      return { ok: true, sentToBack: input.nodeIds.length, minZBefore: minZ }
    },
  },
  {
    name: 'canvas_update_model_param',
    description: translate('canvasTools.tpl39LongDesc'),
    paramsSchema: {
      type: 'object',
      required: ['nodeId', 'params'],
      properties: {
        nodeId: string(translate('canvasTools.t162')),
        params: {
          type: 'object',
          description: translate('canvasTools.tpl40Desc'),
          additionalProperties: true,
        },
        removeKeys: array(string(translate('canvasTools.t230')), translate('canvasTools.t231Desc')),
      },
    },
    handler: async (
      ctx,
      input: { nodeId: string; params: Record<string, unknown>; removeKeys?: string[] },
    ) => {
      const snap = requireSnapshot(ctx)
      const node = findNode(snap, input.nodeId)
      const existing = (node.data.modelParams as Record<string, unknown>) ?? {}
      const next = { ...existing, ...input.params }
      if (input.removeKeys) {
        for (const key of input.removeKeys) delete next[key]
      }
      await ctx.workspace.updateNodeData(input.nodeId, { modelParams: next })
      return { ok: true, nodeId: input.nodeId, modelParams: next }
    },
  },
  {
    name: 'canvas_query_nodes',
    description: translate('canvasTools.tpl41LongDesc'),
    paramsSchema: {
      type: 'object',
      properties: {
        types: array(
          enumOf(NODE_TYPES, translate('canvasTools.t233')),
          translate('canvasTools.t234'),
        ),
        status: enumOf(
          ['pending', 'running', 'completed', 'failed', 'cancelled'],
          translate('canvasTools.t235'),
        ),
        inBbox: {
          type: 'object',
          description: translate('canvasTools.t236Desc'),
          properties: {
            minX: number(translate('canvasTools.t237')),
            maxX: number(translate('canvasTools.t238')),
            minY: number(translate('canvasTools.t239')),
            maxY: number(translate('canvasTools.t240')),
          },
        },
        hasAsset: boolean(translate('canvasTools.t241Desc')),
        hasInputs: boolean(translate('canvasTools.t242Desc')),
        hasOutputs: boolean(translate('canvasTools.t243Desc')),
        pipelineRole: enumOf(PIPELINE_ROLES as unknown as string[], translate('canvasTools.t244')),
        productionState: enumOf(
          PRODUCTION_STATES as unknown as string[],
          translate('canvasTools.t245'),
        ),
        limit: number(translate('canvasTools.t246')),
        boardId: string(translate('canvasTools.t247Desc'), false),
      },
    },
    handler: async (
      ctx,
      input: {
        types?: CanvasNodeType[]
        status?: string
        inBbox?: { minX: number; maxX: number; minY: number; maxY: number }
        hasAsset?: boolean
        hasInputs?: boolean
        hasOutputs?: boolean
        pipelineRole?: string
        productionState?: string
        limit?: number
        boardId?: string
      },
    ) => {
      const snap = requireSnapshot(ctx)
      const bid = input.boardId ?? activeBoardId(ctx)
      let result = snap.nodes.filter((n) => n.boardId === bid && !n.hidden)
      if (input.types && input.types.length > 0) {
        const typeSet = new Set(input.types)
        result = result.filter((n) => typeSet.has(n.type))
      }
      if (input.status) {
        result = result.filter((n) => n.data.status === input.status)
      }
      if (input.pipelineRole) {
        result = result.filter((n) => n.data.pipelineRole === input.pipelineRole)
      }
      if (input.productionState) {
        result = result.filter((n) => n.data.productionState === input.productionState)
      }
      if (input.hasAsset != null) {
        result = result.filter((n) => Boolean(n.assetId) === input.hasAsset)
      }
      if (input.inBbox) {
        const { minX, maxX, minY, maxY } = input.inBbox
        result = result.filter((n) => {
          const cx = n.x + n.width / 2
          const cy = n.y + n.height / 2
          return cx >= minX && cx <= maxX && cy >= minY && cy <= maxY
        })
      }
      if (input.hasInputs != null) {
        const nodesWithInputs = new Set(
          snap.edges.filter((e) => e.type === 'used_as_input').map((e) => e.targetNodeId),
        )
        result = result.filter((n) => nodesWithInputs.has(n.id) === input.hasInputs)
      }
      if (input.hasOutputs != null) {
        const nodesWithOutputs = new Set(
          snap.edges
            .filter((e) => e.type === 'generated' || e.type === 'derived_from')
            .map((e) => e.sourceNodeId),
        )
        result = result.filter((n) => nodesWithOutputs.has(n.id) === input.hasOutputs)
      }
      const limit = input.limit ?? 50
      const truncated = result.length > limit
      const finalResult = truncated ? result.slice(0, limit) : result
      return {
        nodes: finalResult.map(summarizeNodeLite),
        count: finalResult.length,
        totalMatches: result.length,
        truncated,
      }
    },
  },
]

tools.push(...CANVAS_AGENT_WORKFLOW_GRAPH_TOOLS, ...CANVAS_WORKFLOW_TOOLS)

export const CANVAS_TOOLS: ReadonlyArray<CanvasToolDescriptor> = tools
const canvasToolEntries: Array<[string, CanvasToolDescriptor]> = tools.map((t) => [t.name, t])
const insertAssetTool = tools.find((t) => t.name === 'canvas_insert_asset')
if (insertAssetTool) {
  canvasToolEntries.push(['canvas_insert_asset_to_board', insertAssetTool])
}
export const CANVAS_TOOL_INDEX: Record<string, CanvasToolDescriptor> =
  Object.fromEntries(canvasToolEntries)

/** 给主进程 SDK 注册用的紧凑 schema 列表 */
export type CanvasToolSchema = {
  name: string
  description: string
  inputSchema: JSONSchema
}
export function getCanvasToolSchemas(): CanvasToolSchema[] {
  return tools.map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: t.paramsSchema,
  }))
}

/** 渲染进程统一入口：执行某个工具 */
export async function executeCanvasTool(
  ctx: CanvasToolContext,
  name: string,
  input: unknown,
): Promise<unknown> {
  const tool = CANVAS_TOOL_INDEX[name]
  if (!tool) throw new Error(translate('canvasTools.tpl5Desc', { name }))
  const validation = validateCanvasToolInput(tool.paramsSchema, input)
  if (!validation.valid) {
    throw new Error(formatCanvasToolInputIssues(name, validation.issues))
  }
  return await tool.handler(ctx, input as never)
}

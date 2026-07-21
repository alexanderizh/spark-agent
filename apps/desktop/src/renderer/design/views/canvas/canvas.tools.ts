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
import type { SessionReasoningEffort } from '@spark/protocol'
import { getCanvasCapability, isOperationNode, nodeOperation } from './canvas.capabilities'
import { getCanvasAgentAvailableActions, resolveNodeAssetKinds } from './canvasAgentCapabilities'
import { buildCanvasAgentProductionPlan } from './canvasAgentProductionPlan'
import { SPECIALIZED_CANVAS_NODE_TOOLS } from './canvasSpecializedNodeTools'

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
  ) => Promise<void>
  cancelTask: (taskId: string) => Promise<void>
  updateProjectSettings: (settings: { prompt?: string; negativePrompt?: string }) => Promise<void>
}

/** 工具执行上下文 */
export type CanvasToolContext = {
  projectId: string
  /** 返回当前最新的 snapshot；可能为 null（加载中） */
  getSnapshot: () => CanvasSnapshot | null
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
  if (!snap) throw new Error('画布尚未加载完成，请稍后重试。')
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
  if (!n) throw new Error(`未找到节点 ${nodeId}`)
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
    throw new Error('至少提供 title、content 或 data 中的一项')
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
      throw new Error(`节点 ${input.nodeId} 不支持 content，请通过 data 修改具体字段`)
    }
  } else if (node.type === 'prompt') {
    const hasPrompt = Object.prototype.hasOwnProperty.call(dataPatch, 'prompt')
    const hasText = Object.prototype.hasOwnProperty.call(dataPatch, 'text')
    const prompt = dataPatch.prompt
    const text = dataPatch.text
    if (hasPrompt && hasText && prompt !== text) {
      throw new Error('Prompt 节点的 data.text 与 data.prompt 必须一致，请改用 content')
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
  description: string('镜头画面与动作描述', false),
  dialogue: string('带说话人的对白', false),
  narration: string('旁白 / OS / 字幕', false),
  characterAssetIds: array(string('角色资产 id'), '出场角色'),
  sceneAssetId: string('场景资产 id', false),
  propAssetIds: array(string('道具资产 id'), '道具'),
  shotPrompt: string('自包含的 AI 视频镜头提示词', false),
  shotSize: string('景别', false),
  angle: string('机位高度、拍摄角度与视角', false),
  movement: string('镜头类型、轨迹、方向、速度与稳定性', false),
  sceneLayout: string('前中后景、道具和空间布局', false),
  composition: string('九宫格落点、视觉中心与画面分割', false),
  blocking: string('人物站位、入画范围、走位与 cm 级距离', false),
  lighting: string('主光/辅光/轮廓光、光比和色温', false),
  focalLength: string('镜头焦距/焦段', false),
  aperture: string('光圈、景深与焦平面', false),
  iso: string('感光度与颗粒', false),
  colorTone: string('主色、强调色、冷暖与饱和度', false),
  mood: string('氛围与情绪基调', false),
  microExpression: string('微表情与表演动作', false),
  costume: string('服装与造型连续性', false),
  characterReferences: string('角色图/资产参考与本镜造型', false),
  actionBeats: string('0.5s 精度的完整动作节拍', false),
  soundEffects: string('环境声、拟音、音乐与时码', false),
  transition: string('入镜/出镜的硬切或其他剪辑标识', false),
  firstFrame: string('0.0s 首帧精确描述', false),
  lastFrame: string('镜头末尾帧精确描述', false),
  continuity: string('轴线、视线、道具、造型、光向与动作接点', false),
  negativePrompt: string('该镜专属反向提示词', false),
  inSec: number('镜头入点（秒）'),
  outSec: number('镜头出点（秒）'),
  durationSec: number('镜头时长（秒）'),
  keyframeNodeIds: array(string('关键帧节点 id'), '关联关键帧节点'),
  cameraDesignId: string('运镜风格预设 id', false),
  actionDesignId: string('动作风格预设 id', false),
  frameDesignId: string('画面风格预设 id', false),
}

// ─── 工具定义 ──────────────────────────────────────────────────────────────

const tools: CanvasToolDescriptor[] = [
  // ───────── 项目 / 概览 ─────────
  {
    name: 'canvas_get_project_summary',
    description:
      '获取当前画布项目的整体概览（项目信息、当前画布、节点/资产/任务计数）。任何编辑前先调一次。',
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
    description: '更新项目级 prompt / negativePrompt（影响新建操作节点的默认值）。',
    paramsSchema: {
      type: 'object',
      properties: {
        prompt: string('项目级默认提示词', false),
        negativePrompt: string('项目级负面提示词', false),
      },
    },
    handler: async (ctx, input: { prompt?: string; negativePrompt?: string }) => {
      await ctx.workspace.updateProjectSettings(input)
      return { ok: true }
    },
  },

  {
    name: 'canvas_get_available_actions',
    description:
      '获取指定节点当前可用的完整能力目录：剧本流水线、推荐影视流程、通用生成、编辑整理和 UI 专属右键功能。针对节点操作前优先调用。',
    paramsSchema: {
      type: 'object',
      required: ['nodeId'],
      properties: { nodeId: string('节点 id') },
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
            '先选择 pipeline 或 recommended_flow 动作',
            '再按 toolRecipe 使用专用流水线工具创建可检查的操作节点',
            '只有用户明确要求立即执行时才运行媒体任务',
          ],
        },
      }
    },
  },
  {
    name: 'canvas_get_production_plan',
    description:
      '根据当前画布实时状态生成影视/短剧推荐制作计划、阻塞项和下一步。收到“制作短剧/继续制作/下一步”等宽泛请求时，在创建节点前调用。',
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
    description: '列出当前画布内的节点，可按类型筛选。返回节点摘要（含 id/type/坐标/标题/数据）。',
    paramsSchema: {
      type: 'object',
      properties: {
        type: enumOf(NODE_TYPES, '只返回该类型的节点（可选）'),
        includeHidden: boolean('是否包含 hidden 节点（默认 false）'),
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
    description: '获取单个节点完整信息（含 data 全部字段）。',
    paramsSchema: {
      type: 'object',
      required: ['nodeId'],
      properties: { nodeId: string('节点 id') },
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
    description:
      '读取 AI 操作节点的持久化配置、关联任务、已连接输入和操作能力约束；精细调参前调用。',
    paramsSchema: {
      type: 'object',
      required: ['nodeId'],
      properties: { nodeId: string('AI 操作节点 id') },
    },
    handler: async (ctx, input: { nodeId: string }) => {
      const snap = requireSnapshot(ctx)
      const node = findNode(snap, input.nodeId)
      if (!isOperationNode(node)) throw new Error(`节点 ${input.nodeId} 不是 AI 操作节点`)
      return summarizeOperationConfig(snap, node)
    },
  },
  {
    name: 'canvas_find_nodes',
    description:
      '在当前画布内按文本搜索节点（匹配 title / data.text / data.prompt）。返回匹配的节点摘要。',
    paramsSchema: {
      type: 'object',
      required: ['query'],
      properties: {
        query: string('搜索关键词（不区分大小写）'),
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
    description: '列出组节点内的成员节点。',
    paramsSchema: {
      type: 'object',
      required: ['groupId'],
      properties: { groupId: string('组节点 id') },
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
    description:
      '通用节点更新工具。可同时修改节点标题、可见正文和任意 data 字段，并在写入后强制刷新画布内存快照。text/prompt 节点的 content 会更新卡片正文，AI 操作节点的 content 会更新提示词。优先使用本工具，避免只改存储数据但 UI 仍显示旧值。',
    paramsSchema: {
      type: 'object',
      required: ['nodeId'],
      properties: {
        nodeId: string('节点 id'),
        title: string('节点标题（可选）', false),
        content: string('节点可见正文或 AI 操作提示词（可选）', false),
        data: {
          type: 'object',
          description: '需要合并写入的其他 node.data 字段（可选）',
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
    description:
      '创建普通纯文本笔记节点（同时生成同步的文本 asset）。不得用于剧本、分镜或影视资产；这些内容必须使用对应专用工具。坐标省略时自动放在画布空白处。',
    paramsSchema: {
      type: 'object',
      required: ['text'],
      properties: {
        text: string('文本内容'),
        x: number('画布坐标 x（可选）'),
        y: number('画布坐标 y（可选）'),
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
    description:
      '创建 Prompt 节点（与 text 节点结构相同，data.format=prompt，用于专门承载提示词）。',
    paramsSchema: {
      type: 'object',
      required: ['prompt'],
      properties: {
        prompt: string('提示词内容'),
        title: string('节点标题（可选）', false),
        x: number('画布坐标 x（可选）'),
        y: number('画布坐标 y（可选）'),
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
    description:
      '兼容工具：编辑节点 data 字段并刷新画布。普通节点更新优先使用 canvas_update_node；修改 prompt 卡片的 prompt 字段时会自动同步其可见 text。',
    paramsSchema: {
      type: 'object',
      required: ['nodeId', 'data'],
      properties: {
        nodeId: string('节点 id'),
        data: {
          type: 'object',
          description:
            '要合并写入的 data 字段（partial）。支持文本/媒体字段，也支持流水线语义字段；未知扩展字段会透传。',
          additionalProperties: true,
          properties: {
            text: string('文本/Prompt 内容', false),
            prompt: string('提示词', false),
            negativePrompt: string('负面提示词', false),
            format: enumOf(['plain', 'markdown', 'prompt'], '文本格式'),
            message: string('节点状态消息', false),
            url: string('媒体 URL（图片/音频/视频节点）', false),
            thumbnailUrl: string('缩略图 URL', false),
            mimeType: string('MIME 类型', false),
            operation: enumOf(OPERATION_TYPES as unknown as string[], 'AI 操作类型'),
            modelParams: {
              type: 'object',
              additionalProperties: true,
              description: '模型特定参数',
            },
            agentId: string('文本任务使用的 Agent id', false),
            providerProfileId: string('多模态/文本任务使用的 provider profile id', false),
            manifestId: string('多模态模型 manifest id', false),
            modelId: string('模型 id', false),
            reasoningEffort: enumOf(
              ['minimal', 'low', 'medium', 'high', 'xhigh', 'max'],
              '统一推理强度',
            ),
            skillIds: array(string('Skill id'), '文本任务使用的 Skill id 列表'),
            pipelineRole: enumOf(
              PIPELINE_ROLES as unknown as string[],
              '节点在影视流水线中的语义角色',
            ),
            outputPipelineRole: enumOf(
              PIPELINE_ROLES as unknown as string[],
              '任务产物节点的流水线角色',
            ),
            productionState: enumOf(PRODUCTION_STATES as unknown as string[], '生产状态'),
            shotGroupId: string('关联分镜分组 id', false),
            shotSegmentId: string('关联分镜片段 id', false),
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
    description: '批量更新节点几何属性 / 标题 / 锁定 / 隐藏。',
    paramsSchema: {
      type: 'object',
      required: ['nodeIds', 'patch'],
      properties: {
        nodeIds: array(string('节点 id'), '要更新的节点 id 列表'),
        patch: {
          type: 'object',
          properties: {
            x: number('x 坐标'),
            y: number('y 坐标'),
            width: number('宽度（像素）'),
            height: number('高度（像素）'),
            rotation: number('旋转角度'),
            zIndex: number('层级'),
            locked: boolean('是否锁定'),
            hidden: boolean('是否隐藏'),
            title: string('标题', false),
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
    description:
      '持久化更新 AI 操作节点配置，并同步关联任务；后续 retry 会使用新参数。modelParams 为完整替换值。',
    paramsSchema: {
      type: 'object',
      required: ['nodeId', 'config'],
      properties: {
        nodeId: string('AI 操作节点 id'),
        title: string('节点标题（可选）', false),
        config: {
          type: 'object',
          additionalProperties: true,
          description: '只传需要修改的配置字段；修改前先读取 canvas_get_operation_config。',
        },
      },
    },
    handler: async (
      ctx,
      input: { nodeId: string; title?: string; config: Partial<CanvasNodeData> },
    ) => {
      const snap = requireSnapshot(ctx)
      const node = findNode(snap, input.nodeId)
      if (!isOperationNode(node)) throw new Error(`节点 ${input.nodeId} 不是 AI 操作节点`)
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
    description: '删除节点（软删，可恢复）。',
    paramsSchema: {
      type: 'object',
      required: ['nodeIds'],
      properties: { nodeIds: array(string('节点 id'), '要删除的节点 id 列表') },
    },
    handler: async (ctx, input: { nodeIds: string[] }) => {
      await ctx.workspace.deleteNodes(input.nodeIds)
      return { ok: true, deleted: input.nodeIds.length }
    },
  },
  {
    name: 'canvas_duplicate_nodes',
    description: '复制节点（保留连线、组归属，自动重新映射 id）。',
    paramsSchema: {
      type: 'object',
      required: ['nodeIds'],
      properties: { nodeIds: array(string('节点 id'), '要复制的节点 id') },
    },
    handler: async (ctx, input: { nodeIds: string[] }) => {
      await ctx.workspace.duplicateNodes(input.nodeIds)
      return { ok: true }
    },
  },
  {
    name: 'canvas_connect_nodes',
    description: '在两个节点之间建立连线（type 自动推断：操作节点入边为 used_as_input）。',
    paramsSchema: {
      type: 'object',
      required: ['sourceNodeId', 'targetNodeId'],
      properties: {
        sourceNodeId: string('源节点 id'),
        targetNodeId: string('目标节点 id'),
      },
    },
    handler: async (ctx, input: { sourceNodeId: string; targetNodeId: string }) => {
      await ctx.workspace.connectNodes(input)
      return { ok: true }
    },
  },
  {
    name: 'canvas_create_group',
    description: '把多个节点组合成一个组节点（至少 2 个非组节点）。',
    paramsSchema: {
      type: 'object',
      required: ['nodeIds'],
      properties: { nodeIds: array(string('节点 id'), '要分组的节点 id 列表（≥2）') },
    },
    handler: async (ctx, input: { nodeIds: string[] }) => {
      await ctx.workspace.createGroupNode(input.nodeIds)
      const snap = requireSnapshot(ctx)
      // 最新一个 group 节点
      const group = [...snap.nodes].reverse().find((n) => n.type === 'group')
      return { groupId: group?.id ?? null }
    },
  },
  {
    name: 'canvas_dissolve_group',
    description: '解散组节点（成员节点恢复独立）。',
    paramsSchema: {
      type: 'object',
      required: ['groupId'],
      properties: { groupId: string('组节点 id') },
    },
    handler: async (ctx, input: { groupId: string }) => {
      await ctx.workspace.dissolveGroupNode(input.groupId)
      return { ok: true }
    },
  },
  {
    name: 'canvas_add_to_group',
    description: '把节点加入已存在的组。',
    paramsSchema: {
      type: 'object',
      required: ['groupId', 'nodeIds'],
      properties: {
        groupId: string('组节点 id'),
        nodeIds: array(string('节点 id'), '要加入的节点 id'),
      },
    },
    handler: async (ctx, input: { groupId: string; nodeIds: string[] }) => {
      await ctx.workspace.addNodesToGroup(input.groupId, input.nodeIds)
      return { ok: true }
    },
  },
  {
    name: 'canvas_remove_from_group',
    description: '把节点从组里移出。',
    paramsSchema: {
      type: 'object',
      required: ['nodeIds'],
      properties: { nodeIds: array(string('节点 id'), '要移出的节点 id') },
    },
    handler: async (ctx, input: { nodeIds: string[] }) => {
      await ctx.workspace.removeNodesFromGroup(input.nodeIds)
      return { ok: true }
    },
  },

  // ───────── 资产 ─────────
  {
    name: 'canvas_list_assets',
    description: '列出项目内全部资产（图片/音频/视频/文本/Prompt/文件）。可按 type 筛选。',
    paramsSchema: {
      type: 'object',
      properties: {
        type: enumOf(['image', 'audio', 'video', 'text', 'prompt', 'file'], '资产类型'),
        kind: string('影视资产细分（script/character/scene/prop/effect/prompt_library）', false),
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
    description: '获取单个资产完整信息（含 contentText 全文 / metadata）。',
    paramsSchema: {
      type: 'object',
      required: ['assetId'],
      properties: { assetId: string('资产 id') },
    },
    handler: async (ctx, input: { assetId: string }) => {
      const snap = requireSnapshot(ctx)
      const a = snap.assets.find((x) => x.id === input.assetId)
      if (!a) throw new Error(`未找到资产 ${input.assetId}`)
      return { asset: { ...summarizeAsset(a), contentText: a.contentText, metadata: a.metadata } }
    },
  },
  {
    name: 'canvas_insert_asset',
    description: '把已有资产作为引用节点插入当前画布。坐标省略时自动放在画布空白处。',
    paramsSchema: {
      type: 'object',
      required: ['assetId'],
      properties: {
        assetId: string('资产 id'),
        x: number('画布坐标 x（可选）'),
        y: number('画布坐标 y（可选）'),
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
    description: '创建影视类资产（剧本/角色/场景/道具/特效/提示词库）。用于项目级共享资源管理。',
    paramsSchema: {
      type: 'object',
      required: ['kind', 'name'],
      properties: {
        kind: enumOf(FILM_ASSET_KINDS as unknown as string[], '资产类型'),
        name: string('资产名称'),
        text: string('正文/描述（可选）', false),
        prompt: string('关联提示词（可选）', false),
        tags: array(string('标签'), '标签列表'),
        attributes: {
          type: 'object',
          description: '类型特定属性（自由 JSON）',
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
    description: '编辑影视资产字段。',
    paramsSchema: {
      type: 'object',
      required: ['assetId'],
      properties: {
        assetId: string('资产 id'),
        title: string('标题', false),
        contentText: string('正文', false),
        prompt: string('提示词', false),
        tags: array(string('标签'), '标签列表'),
        attributes: { type: 'object', additionalProperties: true, description: '类型特定属性' },
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
    description: '删除影视资产。',
    paramsSchema: {
      type: 'object',
      required: ['assetId'],
      properties: { assetId: string('资产 id') },
    },
    handler: async (ctx, input: { assetId: string }) => {
      await ctx.workspace.deleteFilmAsset(input.assetId)
      return { ok: true }
    },
  },
  {
    name: 'canvas_search_assets',
    description: '搜索影视资产（关键词 + kind + tags + 排序）。',
    paramsSchema: {
      type: 'object',
      properties: {
        query: string('搜索关键词', false),
        kinds: array(enumOf(FILM_ASSET_KINDS as unknown as string[], 'kind'), '限定 kinds'),
        tags: array(string('tag'), '限定 tags'),
        sortBy: enumOf(['updated', 'created', 'name', 'usage'], '排序方式'),
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
    description: '列出支持的 AI 操作能力（每个操作的输入/输出类型、参数 schema）。',
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
    description: '创建一个 AI 操作节点（不立即执行），可后续调 canvas_run_operation 触发。',
    paramsSchema: {
      type: 'object',
      required: ['operation'],
      properties: {
        operation: enumOf(OPERATION_TYPES as unknown as string[], 'AI 操作类型'),
        inputNodeIds: array(string('节点 id'), '输入节点 id 列表（图片/文本节点）'),
        title: string('节点标题', false),
        message: string('节点提示消息（可选）', false),
        prompt: string('预填提示词（可选，不会立即执行）', false),
        negativePrompt: string('预填负面提示词（可选）', false),
        modelParams: {
          type: 'object',
          additionalProperties: true,
          description: '预填模型参数（如 aspect_ratio / durationSec / workflow / responseFormat）',
        },
        agentId: string('预绑定文本 Agent id（可选）', false),
        providerProfileId: string('预绑定 provider profile id（可选）', false),
        manifestId: string('预绑定 manifest id（可选）', false),
        modelId: string('预绑定模型 id（可选）', false),
        taskPipelineRole: enumOf(PIPELINE_ROLES as unknown as string[], '任务节点流水线角色'),
        outputPipelineRole: enumOf(PIPELINE_ROLES as unknown as string[], '产物节点流水线角色'),
        x: number('画布坐标 x（可选）'),
        y: number('画布坐标 y（可选）'),
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
      await ctx.workspace.createOperationNode({
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
      const next = requireSnapshot(ctx)
      const created = [...next.nodes].reverse().find((n) => n.type === input.operation)
      return { nodeId: created?.id ?? null, operationLabel: operationLabel(input.operation) }
    },
  },
  {
    name: 'canvas_run_operation',
    description: '运行已存在的 AI 操作节点（提交 prompt + 输入，调用对应模型生成结果）。',
    paramsSchema: {
      type: 'object',
      required: ['nodeId'],
      properties: {
        nodeId: string('操作节点 id'),
        prompt: string('提示词；省略时使用节点已保存的 prompt', false),
        negativePrompt: string('负面提示词', false),
        inputNodeIds: array(string('节点 id'), '覆盖默认输入节点（可选）'),
        inputAssetIds: array(string('资产 id'), '直接用项目资产作为输入（可选）'),
        agentId: string('指定文本 Agent（可选，仅文本类任务使用）', false),
        providerProfileId: string('指定 provider profile（可选）', false),
        manifestId: string('指定 manifest（可选）', false),
        modelId: string('指定模型 id（可选）', false),
        reasoningEffort: {
          type: 'string',
          enum: ['minimal', 'low', 'medium', 'high', 'xhigh', 'max'],
          description: 'Spark 统一推理强度；运行时会按 adapter 映射为 provider 合法枚举',
        },
        modelParams: {
          type: 'object',
          additionalProperties: true,
          description: '模型特定参数（如尺寸 / 步数 / seed），schema 由 capability 决定',
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
      if (!isOperationNode(node)) throw new Error(`节点 ${input.nodeId} 不是 AI 操作节点`)
      const savedPrompt =
        node.data.prompt ??
        (node.taskId ? snap.tasks.find((t) => t.id === node.taskId)?.prompt : null)
      const prompt = input.prompt ?? savedPrompt
      if (!prompt?.trim())
        throw new Error('操作节点没有可运行的 prompt，请先更新配置或传入 prompt。')
      const { nodeId, ...params } = input
      await ctx.workspace.runOperationNode(nodeId, { ...params, prompt })
      return { ok: true, nodeId }
    },
  },
  {
    name: 'canvas_retry_operation',
    description: '基于操作节点的旧参数重试一次。',
    paramsSchema: {
      type: 'object',
      required: ['nodeId'],
      properties: { nodeId: string('操作节点 id') },
    },
    handler: async (ctx, input: { nodeId: string }) => {
      await ctx.workspace.retryOperationNode(input.nodeId)
      return { ok: true }
    },
  },
  {
    name: 'canvas_cancel_task',
    description: '取消运行中的任务。',
    paramsSchema: {
      type: 'object',
      required: ['taskId'],
      properties: { taskId: string('任务 id') },
    },
    handler: async (ctx, input: { taskId: string }) => {
      await ctx.workspace.cancelTask(input.taskId)
      return { ok: true }
    },
  },
  {
    name: 'canvas_list_tasks',
    description: '列出当前画布的任务（可按 status 筛选）。',
    paramsSchema: {
      type: 'object',
      properties: {
        status: enumOf(['pending', 'running', 'completed', 'failed', 'cancelled'], '任务状态'),
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
    description:
      '列出可用的多模态模型（用于挑选 provider/manifest/modelId 传给 canvas_run_operation）。',
    paramsSchema: {
      type: 'object',
      properties: { enabledOnly: boolean('仅返回已启用模型（默认 true）') },
    },
    handler: async (_ctx, input: { enabledOnly?: boolean }) => {
      const { models } = await canvasApi.listMediaModels({ enabledOnly: input.enabledOnly ?? true })
      return { models }
    },
  },

  // ───────── 分镜（影视开发专用）─────────
  {
    name: 'canvas_list_shot_groups',
    description: '列出当前项目所有分镜分组（含每组的 segments 概要）。',
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
    description: '新建分镜分组（如「第一幕」「第二幕」）。',
    paramsSchema: {
      type: 'object',
      required: ['name'],
      properties: {
        name: string('分组名称'),
        description: string('描述', false),
      },
    },
    handler: async (ctx, input: { name: string; description?: string }) => {
      const created = await ctx.workspace.createShotGroup(input)
      return { groupId: created.id, name: created.name }
    },
  },
  {
    name: 'canvas_update_shot_group',
    description: '修改分镜分组。',
    paramsSchema: {
      type: 'object',
      required: ['groupId'],
      properties: {
        groupId: string('分组 id'),
        name: string('新名称', false),
        description: string('新描述', false),
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
    description: '删除分镜分组。',
    paramsSchema: {
      type: 'object',
      required: ['groupId'],
      properties: { groupId: string('分组 id') },
    },
    handler: async (ctx, input: { groupId: string }) => {
      await ctx.workspace.deleteShotGroup(input.groupId)
      return { ok: true }
    },
  },
  {
    name: 'canvas_create_shot_segment',
    description: '在分镜分组内新建一个镜头片段。',
    paramsSchema: {
      type: 'object',
      required: ['groupId', 'title'],
      properties: {
        groupId: string('分组 id'),
        title: string('镜头标题（如「开场—远景」）'),
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
    description: '修改镜头片段。',
    paramsSchema: {
      type: 'object',
      required: ['groupId', 'segmentId'],
      properties: {
        groupId: string('分组 id'),
        segmentId: string('片段 id'),
        title: string('标题', false),
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
    description: '删除镜头片段。',
    paramsSchema: {
      type: 'object',
      required: ['groupId', 'segmentId'],
      properties: {
        groupId: string('分组 id'),
        segmentId: string('片段 id'),
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
    description:
      'Agent 生成了一张图片后，把它插入到画布作为图片节点。支持本地文件路径或 data URL。会自动创建 asset + 节点。',
    paramsSchema: {
      type: 'object',
      required: ['source'],
      properties: {
        source: {
          oneOf: [
            {
              type: 'string',
              description: '本地文件绝对路径（如 /tmp/xxx.png）或 data URL 或 http(s) URL',
            },
          ],
          description: '图片来源（路径 / dataURL / URL）',
        },
        title: string('节点标题（可选）', false),
        x: number('画布坐标 x（可选）'),
        y: number('画布坐标 y（可选）'),
        width: number('节点宽度（可选，默认 320）'),
        height: number('节点高度（可选，根据图片比例自适应）'),
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
          reader.onerror = () => reject(reader.error ?? new Error('读取图片失败'))
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
    description:
      '把 Agent 生成的普通说明或笔记插入文本节点。不得用于剧本、分镜或影视资产；这些内容必须使用对应专用工具。',
    paramsSchema: {
      type: 'object',
      required: ['text'],
      properties: {
        text: string('文本内容'),
        title: string('节点标题', false),
        format: enumOf(['plain', 'markdown', 'prompt'], '文本格式（默认 markdown）'),
        x: number('画布坐标 x（可选）'),
        y: number('画布坐标 y（可选）'),
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
    description:
      '一次性批量创建多个文本/Prompt 节点，并可指定它们之间的连线。大幅减少往返次数。返回所有创建的节点 id。',
    paramsSchema: {
      type: 'object',
      required: ['nodes'],
      properties: {
        nodes: {
          type: 'array',
          description: '要创建的节点列表',
          items: {
            type: 'object',
            properties: {
              text: string('文本内容（text 节点必填）', false),
              prompt: string('Prompt 内容（prompt 节点用）', false),
              type: enumOf(['text', 'prompt'], '节点类型（默认 text）'),
              title: string('节点标题（可选）', false),
              x: number('画布坐标 x（可选，省略时自动排列）'),
              y: number('画布坐标 y（可选）'),
            },
          },
        },
        connections: {
          type: 'array',
          description: '节点之间的连线，用 nodes 数组的索引（从 0 开始）指定',
          items: {
            type: 'object',
            properties: {
              fromIndex: number('源节点在 nodes 数组中的索引'),
              toIndex: number('目标节点在 nodes 数组中的索引'),
            },
          },
        },
        startX: number('自动排列起始 x（可选，默认空白处）'),
        startY: number('自动排列起始 y（可选）'),
        spacing: number('自动排列间距（默认 360px）'),
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
    description:
      '把多个节点对齐到指定方向（left/right/top/bottom/center-h/center-v）。只改 x/y，不改尺寸。',
    paramsSchema: {
      type: 'object',
      required: ['nodeIds', 'direction'],
      properties: {
        nodeIds: array(string('节点 id'), '要对齐的节点 id 列表（≥2）'),
        direction: enumOf(
          ['left', 'right', 'top', 'bottom', 'center-h', 'center-v'],
          '对齐方向：left=左边缘对齐，center-h=水平居中，center-v=垂直居中',
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
      if (targets.length < 2) throw new Error('对齐至少需要 2 个节点')
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
    description: '把多个节点等距分布（水平或垂直方向）。',
    paramsSchema: {
      type: 'object',
      required: ['nodeIds', 'axis'],
      properties: {
        nodeIds: array(string('节点 id'), '要分布的节点 id 列表（≥3）'),
        axis: enumOf(['horizontal', 'vertical'], '分布轴'),
        gap: number('节点间最小间距（像素，可选，默认自动）'),
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
      if (targets.length < 3) throw new Error('分布至少需要 3 个节点')
      const isH = input.axis === 'horizontal'
      // 按位置排序
      const sorted = [...targets].sort((a, b) => (isH ? a.x - b.x : a.y - b.y))
      const first = sorted[0]
      const last = sorted[sorted.length - 1]
      if (!first || !last) throw new Error('分布节点排序失败')
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
    description: '把节点置顶（zIndex 设为当前画布最大值 + 1）。',
    paramsSchema: {
      type: 'object',
      required: ['nodeIds'],
      properties: { nodeIds: array(string('节点 id'), '要置顶的节点 id 列表') },
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
    description: '把节点置底（zIndex 设为当前画布最小值 - 1）。',
    paramsSchema: {
      type: 'object',
      required: ['nodeIds'],
      properties: { nodeIds: array(string('节点 id'), '要置底的节点 id 列表') },
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
    description:
      '细粒度更新操作节点的单个 modelParams 参数（如 aspect_ratio / seed / steps），不需要整块替换 data.modelParams。不存在的 key 会自动新增。',
    paramsSchema: {
      type: 'object',
      required: ['nodeId', 'params'],
      properties: {
        nodeId: string('操作节点 id'),
        params: {
          type: 'object',
          description: '要设置/更新的参数键值对（合并写入，不删除其他已有参数）',
          additionalProperties: true,
        },
        removeKeys: array(string('参数名'), '要从 modelParams 中删除的 key（可选）'),
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
    description:
      '按多维条件查询节点：类型、任务状态、坐标范围、是否有连线、资产关联等。比 list_nodes/find_nodes 更强大。',
    paramsSchema: {
      type: 'object',
      properties: {
        types: array(enumOf(NODE_TYPES, '类型'), '限定节点类型（任一匹配）'),
        status: enumOf(['pending', 'running', 'completed', 'failed', 'cancelled'], '任务状态筛选'),
        inBbox: {
          type: 'object',
          description: '坐标范围筛选（节点中心点在此框内）',
          properties: {
            minX: number('框左边界'),
            maxX: number('框右边界'),
            minY: number('框上边界'),
            maxY: number('框下边界'),
          },
        },
        hasAsset: boolean('只返回有 asset 关联的节点（true）或无关联的（false）'),
        hasInputs: boolean('只返回有输入连线的操作节点'),
        hasOutputs: boolean('只返回有输出连线的操作节点'),
        pipelineRole: enumOf(PIPELINE_ROLES as unknown as string[], '流水线角色筛选'),
        productionState: enumOf(PRODUCTION_STATES as unknown as string[], '生产状态筛选'),
        limit: number('返回上限（默认 50）'),
        boardId: string('限定画布 id（可选，默认当前激活画布）', false),
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
  if (!tool) throw new Error(`未知画布工具: ${name}`)
  return await tool.handler(ctx, input as never)
}

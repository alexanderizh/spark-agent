import type {
  MediaRequestCall,
  CanvasPromptDocument,
  CanvasPromptResponseFields,
  CanvasPromptTaskFields,
  SessionReasoningEffort,
} from '@spark/protocol'

export type CanvasProjectStatus = 'active' | 'archived' | 'deleted'

export type CanvasProjectSettings = {
  prompt?: string
  negativePrompt?: string
}

export type CanvasNodeType =
  | 'image'
  | 'audio'
  | 'video'
  | 'text'
  | 'prompt'
  | 'group'
  // 类型化 AI 操作节点（node.type === node.data.operation，一一对应）
  | 'text_to_image'
  | 'image_to_image'
  | 'image_edit'
  | 'image_compose'
  | 'storyboard_grid'
  | 'panorama_360'
  | 'text_generate'
  | 'text_rewrite'
  | 'prompt_optimize'
  | 'text_to_video'
  | 'image_to_video'
  | 'video_edit'
  | 'video_extend'
  | 'text_to_audio'
  | 'audio_transcribe'
  /** @deprecated 旧通用任务节点，保留读取兼容，新代码不再创建 */
  | 'task'
export type CanvasAssetType = 'image' | 'audio' | 'video' | 'text' | 'prompt' | 'file'
export type CanvasAssetSource = 'upload' | 'ai_generated' | 'ai_edited' | 'imported' | 'manual'

export type CanvasOperationType =
  | 'text_to_image'
  | 'image_to_image'
  | 'image_edit'
  | 'image_compose'
  | 'storyboard_grid'
  | 'panorama_360'
  | 'text_generate'
  | 'text_rewrite'
  | 'prompt_optimize'
  | 'text_to_audio'
  | 'audio_transcribe'
  | 'text_to_video'
  | 'image_to_video'
  | 'video_edit'
  | 'video_extend'

export type CanvasInputTransport = 'auto' | 'cloud_url' | 'base64'
export type CanvasTaskInputPayloadField = 'url' | 'dataUrl' | 'path' | 'unknown'
export type CanvasTaskInputTransportKind =
  | 'remote_url'
  | 'safe_file_url'
  | 'base64_data_url'
  | 'local_path'
  | 'unknown'

export type CanvasTaskInputDiagnostic = {
  type: 'image' | 'audio' | 'video' | 'file'
  role?: 'input' | 'first_frame' | 'last_frame' | 'reference' | 'mask'
  payloadField: CanvasTaskInputPayloadField
  transport: CanvasTaskInputTransportKind
  mimeType?: string | null
  format?: string | null
  valuePreview?: string | null
}

/** 操作步骤的产物组织语义；UI 合一，但运行历史与产物集合仍保留明确结构。 */
export type CanvasOperationOutputMode = 'single' | 'candidates' | 'collection' | 'bundle'
export type CanvasOperationOutputSelectionPolicy = 'auto_latest' | 'manual'

/**
 * 流水线语义角色（设计 §6 节点模型）。
 * 与底层 CanvasNodeType 解耦：用 data.pipelineRole 标记节点在
 * 「文稿→剧本→资源→图卡→分镜→关键帧→视频」流水线中的位置，不新增底层 type。
 */
export type CanvasPipelineRole =
  | 'style_bible' // 视觉总设定
  | 'chapter' // 章节
  | 'screenplay' // 场次剧本
  | 'character' // 角色设计
  | 'scene' // 场景设计
  | 'prop' // 道具设计
  | 'effect' // 特效设计
  | 'camera' // 运镜风格预设
  | 'frame' // 画面风格预设
  | 'action' // 动作风格预设
  | 'design_card' // 设定图卡
  | 'shot' // 分镜
  | 'keyframe' // 关键帧
  | 'clip' // 视频片段

/**
 * 节点生产状态机（设计 §9.2 人机协作 / 过期契约）。
 * empty → drafting(agent) → draft → editing(human) → confirmed → (上游变) stale。
 * 下游正式生成默认只读上游 confirmed 内容。
 */
export type CanvasProductionState = 'empty' | 'drafting' | 'draft' | 'confirmed' | 'stale'

export type CanvasTaskStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled'
export type CanvasEdgeType =
  | 'derived_from'
  | 'used_as_input'
  | 'generated'
  | 'group_contains'
  | 'references'

export type CanvasProject = {
  id: string
  userId: number
  title: string
  description?: string | null
  coverAssetId?: string | null
  /** 项目封面图 URL（safe-file:// 指向项目目录内文件，或 http(s):// 外链） */
  coverUrl?: string | null
  rootPath?: string | null
  status: CanvasProjectStatus
  /** 是否置顶（项目管理页优先展示） */
  pinned?: boolean
  /** 置顶时间（置顶内部排序） */
  pinnedAt?: string | null
  settings?: CanvasProjectSettings
  /**
   * 项目级扩展元数据（与 asset.metadata 一致的策略：先挂 JSON，后续再结构化）。
   * 承载行业模式数据，如影视开发的 CanvasFilmProjectMetadata（文档 §7.10）。
   */
  metadata?: Record<string, unknown>
  nodeCount: number
  assetCount: number
  taskCount: number
  lastOpenedAt?: string | null
  createdAt: string
  updatedAt: string
}

export type CanvasBoardSettings = {
  grid?: boolean
  snap?: boolean
  background?: string
  /** 封面资产 id，用于 board 列表缩略图 */
  coverAssetId?: string | null
  /** 是否为项目默认打开的 board */
  isDefault?: boolean
  /** board 排序权重 */
  sortOrder?: number
  /** 来源模板 id（从模板创建时记录） */
  templateId?: string | null
  /** board 主题/配色（预留扩展位） */
  theme?: string
}

export type CanvasBoard = {
  id: string
  projectId: string
  userId: number
  name: string
  viewport: { x: number; y: number; zoom: number }
  settings: CanvasBoardSettings
  createdAt: string
  updatedAt: string
}

export type CanvasNodeData = {
  text?: string
  format?: 'plain' | 'markdown' | 'prompt'
  url?: string
  thumbnailUrl?: string
  mimeType?: string
  operation?: CanvasOperationType
  /** 单产物 / 候选 / 集合 / 角色包；缺省时由工作流和最近一次运行自动推断。 */
  outputMode?: CanvasOperationOutputMode
  /** 默认资源操作与候选型下游传参所使用的主产物。可匹配 output/node/asset id。 */
  primaryOutputId?: string
  /** 主产物选择策略；手动选择后即使再次运行也保留采用项。 */
  primaryOutputSelection?: CanvasOperationOutputSelectionPolicy
  /** 从操作节点展开出的资产引用节点；同一 outputId 重复展开时复用现有引用。 */
  materializedOutput?: {
    operationNodeId: string
    outputId: string
    taskId?: string
    materializedAt: string
  }
  status?: CanvasTaskStatus
  progress?: number
  message?: string
  prompt?: string
  /** Versioned user-authored prompt blocks. `prompt` remains the legacy fallback. */
  promptDocument?: CanvasPromptDocument
  /** 功能节点的隐藏内置指令；不进入用户可见 Prompt Document。 */
  systemPrompt?: string
  /** 继承/暂存的反向提示词；任务持久化仍以 CanvasTask.negativePrompt 为准 */
  negativePrompt?: string
  modelParams?: Record<string, unknown>
  /** 上次保存/运行时选择的媒体模型 Provider，用于同类操作节点复用配置 */
  providerProfileId?: string
  /** 上次保存/运行时选择的媒体模型 manifest，用于同类操作节点复用配置 */
  manifestId?: string
  /** 上次保存/运行时选择的模型 id，用于同类操作节点复用配置 */
  modelId?: string
  /** 上次保存/运行时选择的文本 Agent，用于同类操作节点复用配置 */
  agentId?: string
  /** 上次保存/运行时选择的文本 Skills，仅文本节点任务使用 */
  skillIds?: string[]
  /** 与关联 CanvasTask 同步的统一推理强度。 */
  reasoningEffort?: SessionReasoningEffort
  /** UI 表现层子类型（如 'script'），不改变底层 node type */
  subtype?: string
  /** 节点展示分类，用于添加节点菜单分组：内容 / 任务 / 资源 */
  displayCategory?: 'content' | 'task' | 'resource'
  /** 来源模板 id */
  presetId?: string | null
  /** 节点来源：手动 / 资产 / 历史 / 模板 / 任务输出 */
  origin?: 'manual' | 'asset' | 'history' | 'template' | 'task_output'
  /** 流水线语义角色（设计 §6），不改变底层 type */
  pipelineRole?: CanvasPipelineRole
  /** 生产状态机（设计 §9.2），驱动闸门与过期提示 */
  productionState?: CanvasProductionState
  /** 是否被人工编辑过（区分 ai_generated / ai_edited 续作语义） */
  editedByHuman?: boolean
  /** 确认时间（confirmed 闸门），下游正式生成只读已确认内容 */
  confirmedAt?: string
  /** 版本号（agent 重生成产新版本而非覆盖） */
  version?: number
  /** 导致本节点过期（stale）的上游节点 id 列表 */
  staleFrom?: string[]
  /** 分镜节点化（设计 §S6 节点化）：回链到分镜分组/片段 */
  shotGroupId?: string
  shotSegmentId?: string
  /** 专用流水线任务节点上暂存的「产物节点角色」，供任务完成回写产物节点时读取 */
  outputPipelineRole?: CanvasPipelineRole
  /** 专用流水线任务节点上暂存的「产物节点标题」，供任务完成回写产物节点时读取 */
  outputTitle?: string
  /** Contract V2 裁剪产物：被丢弃的字段及原因，供任务详情展示。 */
  droppedModelParams?: Array<{ name: string; reason: string; valuePreview?: string | undefined }>
  /** Contract V2 裁剪产物：非阻断性提示（如 missing_param_policy、compat_passthrough）。 */
  modelParamWarnings?: Array<{ code: string; message: string }>
  /** 3D 导演台节点数据：三维对象、摄像机、网格与导出提示词。 */
  directorStage?: Record<string, unknown>
  /** 真·3D 导演台节点数据（subtype 'director_stage_3d'）：人偶/道具/背景/取景相机。 */
  stage3d?: Record<string, unknown>
  /** 视频工作台节点数据（subtype 'video_workbench'）：关键帧/剪辑/转码配置与产物。 */
  videoWorkbench?: Record<string, unknown>
  /** 360 全景图产物标记：基于 equirectangular panorama 渲染全屏 3D 预览。 */
  panorama360?: {
    projection: 'equirectangular'
    sourceOperation?: 'panorama_360'
    capturedFromNodeId?: string
  }
  /** 分镜脚本任务的结构化时长配置（UI 可调，运行时替换 prompt 占位槽 {maxClip}） */
  shotScriptConfig?: ShotScriptConfig
}

/** 分镜脚本任务的时长配置：每镜最长时间上限（秒），约束 LLM 生成的每镜 durationSec */
export type ShotScriptConfig = {
  maxClipSec: number
}

export type CanvasNode = {
  id: string
  projectId: string
  boardId: string
  userId: number
  type: CanvasNodeType
  title?: string | null
  assetId?: string | null
  taskId?: string | null
  parentNodeId?: string | null
  x: number
  y: number
  width: number
  height: number
  rotation: number
  zIndex: number
  locked: boolean
  hidden: boolean
  data: CanvasNodeData
  createdAt: string
  updatedAt: string
}

export type CanvasAsset = {
  id: string
  projectId: string
  userId: number
  type: CanvasAssetType
  source: CanvasAssetSource
  title?: string | null
  mimeType?: string | null
  storageKey?: string | null
  url?: string | null
  thumbnailKey?: string | null
  thumbnailUrl?: string | null
  contentText?: string | null
  width?: number | null
  height?: number | null
  durationMs?: number | null
  sizeBytes?: number | null
  metadata: Record<string, unknown>
  createdAt: string
  updatedAt: string
}

/**
 * 资产治理字段（第一阶段挂在 CanvasAsset.metadata 上，后续 migration 稳定再结构化）。
 * 面板读写时通过 readAssetMeta / writeAssetMeta helper 访问，避免散落字符串 key。
 */
export type CanvasAssetMeta = {
  folderId?: string | null
  tags?: string[]
  favorite?: boolean
  archived?: boolean
  /** 由哪个任务生成（资产血缘） */
  originTaskId?: string | null
  /** 由哪个节点引用创建 */
  originNodeId?: string | null
  lastUsedAt?: string | null
  usageCount?: number
}

export type CanvasTask = {
  id: string
  projectId: string
  boardId: string
  userId: number
  operation: CanvasOperationType
  status: CanvasTaskStatus
  progress: number
  title?: string | null
  prompt?: string | null
  negativePrompt?: string | null
  inputNodeIds: string[]
  inputAssetIds: string[]
  outputNodeIds: string[]
  outputAssetIds: string[]
  providerProfileId?: string | null
  manifestId?: string | null
  modelId?: string | null
  /** provider adapter 种类（apimart/xai/...），用于资产抽屉展示 */
  provider?: string | null
  /** 异步任务的 request/task id（用于血缘追溯） */
  requestId?: string | null
  /** provider 原始响应摘要（不含敏感信息） */
  rawResponse?: unknown
  /** 提交时输入文件的诊断摘要，便于任务详情排查 url/base64/path 等传参方式。 */
  inputFileDiagnostics?: CanvasTaskInputDiagnostic[]
  /** 实际发给 provider 的 HTTP 调用摘要（请求 + 响应），用于任务详情展示。 */
  requestCall?: MediaRequestCall | null
  agentId?: string | null
  skillIds?: string[]
  agentMode?: 'local' | 'cloud' | null
  agentUrl?: string | null
  /** Spark 统一推理强度；主进程会按目标 adapter 映射为 provider 合法枚举。 */
  reasoningEffort?: SessionReasoningEffort | null
  modelParams: Record<string, unknown>
  errorMsg?: string | null
  errorDetail?: string | null
  createdAt: string
  updatedAt: string
  completedAt?: string | null
} & CanvasPromptTaskFields &
  CanvasPromptResponseFields

export type CanvasEdge = {
  id: string
  projectId: string
  boardId: string
  userId: number
  sourceNodeId: string
  targetNodeId: string
  type: CanvasEdgeType
  taskId?: string | null
  metadata: Record<string, unknown>
  createdAt: string
}

/** 右侧信息区 tab */
export type CanvasRightPanelTab = 'inspector' | 'tasks' | 'project'

/** 画布 UI 会话状态（可选，用于跨会话恢复布局） */
export type CanvasUiState = {
  rightPanelTab?: CanvasRightPanelTab
}

export type CanvasSnapshot = {
  project: CanvasProject
  /** 当前激活的 board（向下兼容：旧快照仅有此字段） */
  board: CanvasBoard
  /** 项目内全部 board（多 board 演进；旧快照读取时归一化为 [board]） */
  boards?: CanvasBoard[]
  /** 当前激活 board id（多 board 演进） */
  activeBoardId?: string
  nodes: CanvasNode[]
  edges: CanvasEdge[]
  assets: CanvasAsset[]
  tasks: CanvasTask[]
  /** UI 会话状态（可选） */
  uiState?: CanvasUiState
}

export type CreateCanvasTaskRequest = {
  boardId: string
  operation: CanvasOperationType
  prompt?: string
  negativePrompt?: string
  inputNodeIds?: string[]
  inputAssetIds?: string[]
  outputPlacement?: {
    x?: number
    y?: number
    strategy?: 'near_selection' | 'viewport_center' | 'right_of_selection'
  }
  modelParams?: Record<string, unknown>
  agentId?: string
  providerProfileId?: string
  manifestId?: string
  modelId?: string
  /** Spark 统一推理强度；主进程会按目标 adapter 映射为 provider 合法枚举。 */
  reasoningEffort?: SessionReasoningEffort
  skillIds?: string[]
  /** 专用流水线节点：覆盖任务节点标题（如「生成分镜脚本」「提取角色」） */
  taskTitle?: string
  /** 专用流水线节点：覆盖生成产物节点/资产标题（如角色身份板产物 = 角色名） */
  outputTitle?: string
  /** 专用流水线节点：任务节点的流水线角色（驱动着色/语义） */
  taskPipelineRole?: CanvasPipelineRole
  /** 专用流水线节点：产物节点的流水线角色（如分镜脚本产物 = shot） */
  outputPipelineRole?: CanvasPipelineRole
  /** Contract V2 裁剪产物：被丢弃的字段及原因，供任务详情展示。 */
  droppedModelParams?: Array<{ name: string; reason: string; valuePreview?: string | undefined }>
  /** Contract V2 裁剪产物：非阻断性提示（如 missing_param_policy、compat_passthrough）。 */
  modelParamWarnings?: Array<{ code: string; message: string }>
} & CanvasPromptTaskFields

export type CanvasCapability = {
  id: string
  label: string
  operation: CanvasOperationType
  inputTypes: CanvasNodeType[]
  outputTypes: CanvasAssetType[]
  enabled: boolean
  paramsSchema: Record<string, unknown>
}

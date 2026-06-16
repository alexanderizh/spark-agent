export type CanvasProjectStatus = 'active' | 'archived' | 'deleted'

export type CanvasProjectSettings = {
  prompt?: string
  negativePrompt?: string
}

export type CanvasNodeType = 'image' | 'audio' | 'video' | 'text' | 'prompt' | 'task' | 'group'
export type CanvasAssetType = 'image' | 'audio' | 'video' | 'text' | 'prompt' | 'file'
export type CanvasAssetSource = 'upload' | 'ai_generated' | 'ai_edited' | 'imported' | 'manual'

export type CanvasOperationType =
  | 'text_to_image'
  | 'image_to_image'
  | 'image_edit'
  | 'image_compose'
  | 'text_generate'
  | 'text_rewrite'
  | 'prompt_optimize'
  | 'text_to_audio'
  | 'audio_transcribe'
  | 'text_to_video'
  | 'image_to_video'
  | 'video_edit'

export type CanvasInputTransport = 'auto' | 'cloud_url' | 'base64'

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
  rootPath?: string | null
  status: CanvasProjectStatus
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
  status?: CanvasTaskStatus
  progress?: number
  message?: string
  prompt?: string
  /** UI 表现层子类型（如 'script'），不改变底层 node type */
  subtype?: string
  /** 节点展示分类，用于添加节点菜单分组：内容 / 任务 / 资源 */
  displayCategory?: 'content' | 'task' | 'resource'
  /** 来源模板 id */
  presetId?: string | null
  /** 节点来源：手动 / 资产 / 历史 / 模板 / 任务输出 */
  origin?: 'manual' | 'asset' | 'history' | 'template' | 'task_output'
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
  /** 实际发给 provider 的请求摘要（method + url + 已截断 body），用于任务详情展示 */
  requestCall?: { method: string; url: string; body?: unknown } | null
  agentId?: string | null
  agentMode?: 'local' | 'cloud' | null
  agentUrl?: string | null
  modelParams: Record<string, unknown>
  errorMsg?: string | null
  errorDetail?: string | null
  createdAt: string
  updatedAt: string
  completedAt?: string | null
}

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

/** 左侧工作台主 tab */
export type CanvasLeftPanelTab = 'boards' | 'assets' | 'asset_manager'
/** 左下角次级工具入口 */
export type CanvasLeftUtilityTab = 'templates' | 'history' | 'help'
/** 右侧信息区 tab */
export type CanvasRightPanelTab = 'inspector' | 'tasks' | 'project'

/** 画布 UI 会话状态（可选，用于跨会话恢复布局） */
export type CanvasUiState = {
  leftPanelTab?: CanvasLeftPanelTab
  leftUtilityTab?: CanvasLeftUtilityTab
  rightPanelTab?: CanvasRightPanelTab
  bottomToolbarCollapsed?: boolean
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
}

export type CanvasCapability = {
  id: string
  label: string
  operation: CanvasOperationType
  inputTypes: CanvasNodeType[]
  outputTypes: CanvasAssetType[]
  enabled: boolean
  paramsSchema: Record<string, unknown>
}

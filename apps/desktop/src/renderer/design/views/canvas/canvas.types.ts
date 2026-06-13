export type CanvasProjectStatus = 'active' | 'archived' | 'deleted'

export type CanvasNodeType = 'image' | 'video' | 'text' | 'prompt' | 'task' | 'group'
export type CanvasAssetType = 'image' | 'video' | 'text' | 'prompt' | 'file'
export type CanvasAssetSource = 'upload' | 'ai_generated' | 'ai_edited' | 'imported' | 'manual'

export type CanvasOperationType =
  | 'text_to_image'
  | 'image_to_image'
  | 'image_edit'
  | 'image_compose'
  | 'text_generate'
  | 'text_rewrite'
  | 'prompt_optimize'
  | 'image_to_video'

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
  status: CanvasProjectStatus
  nodeCount: number
  assetCount: number
  taskCount: number
  lastOpenedAt?: string | null
  createdAt: string
  updatedAt: string
}

export type CanvasBoard = {
  id: string
  projectId: string
  userId: number
  name: string
  viewport: { x: number; y: number; zoom: number }
  settings: { grid?: boolean; snap?: boolean; background?: string }
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
  modelId?: string | null
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

export type CanvasSnapshot = {
  project: CanvasProject
  board: CanvasBoard
  nodes: CanvasNode[]
  edges: CanvasEdge[]
  assets: CanvasAsset[]
  tasks: CanvasTask[]
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

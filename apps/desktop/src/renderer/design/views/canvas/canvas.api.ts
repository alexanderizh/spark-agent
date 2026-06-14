import type {
  CanvasAsset,
  CanvasAssetType,
  CanvasBoard,
  CanvasEdge,
  CanvasNode,
  CanvasOperationType,
  CanvasProject,
  CanvasSnapshot,
  CanvasTask,
  CreateCanvasTaskRequest,
} from './canvas.types'
import { getCanvasCapability } from './canvas.capabilities'
import { resolveMediaDisplayUrl } from './canvas-safe-file'
import type {
  CanvasMediaTaskCreateRequest,
  CanvasMediaTaskCreateResponse,
  CanvasMediaTaskInputFile,
  CanvasMediaCapabilitiesListResponse,
  CanvasSnapshotSaveRequest,
} from '@spark/protocol'

const STORAGE_KEY = 'spark-canvas:v1'
const USER_ID = 0

/**
 * 把当前 localStorage db 的每个项目快照异步持久化到 SQLite（生产备份）。
 * debounce 500ms，避免每次 writeDb 都打 IPC。localStorage 仍是热存储，
 * SQLite 提供"重启不丢 / 可备份 / 跨窗口一致"的生产级保证。
 */
let persistTimer: ReturnType<typeof setTimeout> | null = null
function schedulePersist(getDb: () => CanvasDb): void {
  if (persistTimer != null) clearTimeout(persistTimer)
  persistTimer = setTimeout(() => {
    persistTimer = null
    void persistAllProjects(getDb())
  }, 500)
}

async function persistAllProjects(db: CanvasDb): Promise<void> {
  for (const project of db.projects) {
    if (project.status === 'deleted') continue
    const snapshot = {
      project,
      board: db.boards.find((b) => b.projectId === project.id) ?? null,
      nodes: db.nodes.filter((n) => n.projectId === project.id),
      edges: db.edges.filter((e) => e.projectId === project.id),
      assets: db.assets.filter((a) => a.projectId === project.id),
      tasks: db.tasks.filter((t) => t.projectId === project.id),
    }
    const req: CanvasSnapshotSaveRequest = {
      projectId: project.id,
      snapshotJson: JSON.stringify(snapshot),
    }
    req.meta = buildProjectMeta(project)
    try {
      await window.spark.invoke('canvas:snapshot:save', req)
    } catch {
      // 持久化失败不阻断画布主流程（localStorage 仍是热存储）
    }
  }
}

/** 构造 CanvasSnapshotSaveRequest.meta，跳过 undefined 字段（exactOptionalPropertyTypes） */
function buildProjectMeta(project: CanvasProject): NonNullable<CanvasSnapshotSaveRequest['meta']> {
  const meta: NonNullable<CanvasSnapshotSaveRequest['meta']> = {
    title: project.title,
    status: project.status,
    nodeCount: project.nodeCount,
    assetCount: project.assetCount,
    taskCount: project.taskCount,
  }
  if (project.description !== undefined) meta.description = project.description
  if (project.coverAssetId !== undefined) meta.coverAssetId = project.coverAssetId
  return meta
}

/** 需要真实平台 adapter 的多媒体 operation（其余走 demo / 文本模型） */
const MEDIA_OPERATIONS = new Set<CanvasOperationType>([
  'text_to_image',
  'image_to_image',
  'image_edit',
  'image_compose',
  'text_to_audio',
  'audio_transcribe',
  'text_to_video',
  'image_to_video',
])

export function isMediaOperation(operation: CanvasOperationType): boolean {
  return MEDIA_OPERATIONS.has(operation)
}

type CanvasDb = {
  projects: CanvasProject[]
  boards: CanvasBoard[]
  nodes: CanvasNode[]
  edges: CanvasEdge[]
  assets: CanvasAsset[]
  tasks: CanvasTask[]
}

const emptyDb = (): CanvasDb => ({
  projects: [],
  boards: [],
  nodes: [],
  edges: [],
  assets: [],
  tasks: [],
})

function uid(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

function now(): string {
  return new Date().toISOString()
}

function readDb(): CanvasDb {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return seedDb()
    return { ...emptyDb(), ...JSON.parse(raw) }
  } catch {
    return seedDb()
  }
}

function writeDb(db: CanvasDb): void {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(db))
  // 异步把每个项目快照持久化到 SQLite（生产备份，debounce）
  schedulePersist(() => db)
}

function seedDb(): CanvasDb {
  const at = now()
  const projectId = 'canvas_project_demo'
  const boardId = 'canvas_board_demo'
  const promptNodeId = 'canvas_node_prompt_demo'
  const imageNodeId = 'canvas_node_image_demo'
  const taskNodeId = 'canvas_node_task_demo'
  const taskId = 'canvas_task_demo'
  const assetId = 'canvas_asset_prompt_demo'
  const db: CanvasDb = {
    projects: [
      {
        id: projectId,
        userId: USER_ID,
        title: '618 商品主图',
        description: '用于验证文本、参考图、任务节点和血缘关系的画布样例。',
        status: 'active',
        nodeCount: 3,
        assetCount: 1,
        taskCount: 1,
        lastOpenedAt: at,
        createdAt: at,
        updatedAt: at,
      },
    ],
    boards: [
      {
        id: boardId,
        projectId,
        userId: USER_ID,
        name: 'Main canvas',
        viewport: { x: 0, y: 0, zoom: 1 },
        settings: { grid: true, snap: false, background: 'paper' },
        createdAt: at,
        updatedAt: at,
      },
    ],
    nodes: [
      createNodeBase({
        id: promptNodeId,
        projectId,
        boardId,
        type: 'prompt',
        title: '促销主图 Prompt',
        x: 120,
        y: 110,
        width: 260,
        height: 164,
        data: {
          text: '做一张红色促销主图，突出新品首发、限时优惠和高质感产品光影。',
          format: 'prompt',
        },
        at,
      }),
      createNodeBase({
        id: imageNodeId,
        projectId,
        boardId,
        type: 'image',
        title: '产品参考图',
        x: 480,
        y: 130,
        width: 260,
        height: 190,
        data: { url: '', message: '上传图片后会保留为画布资产引用' },
        at,
      }),
      createNodeBase({
        id: taskNodeId,
        projectId,
        boardId,
        type: 'task',
        title: '多图合成 / 商品主图',
        taskId,
        x: 330,
        y: 380,
        width: 300,
        height: 152,
        data: {
          operation: 'image_compose',
          status: 'running',
          progress: 56,
          message: '等待 agent/provider 输出',
        },
        at,
      }),
    ],
    edges: [
      {
        id: 'canvas_edge_demo',
        projectId,
        boardId,
        userId: USER_ID,
        sourceNodeId: promptNodeId,
        targetNodeId: taskNodeId,
        type: 'used_as_input',
        taskId,
        metadata: {},
        createdAt: at,
      },
    ],
    assets: [
      {
        id: assetId,
        projectId,
        userId: USER_ID,
        type: 'prompt',
        source: 'manual',
        title: '促销主图 Prompt',
        contentText: '做一张红色促销主图，突出新品首发、限时优惠和高质感产品光影。',
        metadata: { nodeId: promptNodeId },
        createdAt: at,
        updatedAt: at,
      },
    ],
    tasks: [
      {
        id: taskId,
        projectId,
        boardId,
        userId: USER_ID,
        operation: 'image_compose',
        status: 'running',
        progress: 56,
        title: '多图合成 / 商品主图',
        prompt: '做一张红色促销主图',
        inputNodeIds: [promptNodeId, imageNodeId],
        inputAssetIds: [assetId],
        outputNodeIds: [],
        outputAssetIds: [],
        modelParams: {},
        agentMode: 'local',
        createdAt: at,
        updatedAt: at,
      },
    ],
  }
  writeDb(db)
  return db
}

function createNodeBase(input: {
  id?: string
  projectId: string
  boardId: string
  type: CanvasNode['type']
  title?: string | null
  assetId?: string | null
  taskId?: string | null
  x: number
  y: number
  width: number
  height: number
  data: CanvasNode['data']
  at?: string
}): CanvasNode {
  const at = input.at ?? now()
  return {
    id: input.id ?? uid('canvas_node'),
    projectId: input.projectId,
    boardId: input.boardId,
    userId: USER_ID,
    type: input.type,
    title: input.title ?? null,
    assetId: input.assetId ?? null,
    taskId: input.taskId ?? null,
    parentNodeId: null,
    x: input.x,
    y: input.y,
    width: input.width,
    height: input.height,
    rotation: 0,
    zIndex: 1,
    locked: false,
    hidden: false,
    data: input.data,
    createdAt: at,
    updatedAt: at,
  }
}

function sortCanvasNodes(nodes: CanvasNode[]): CanvasNode[] {
  return [...nodes].sort((left, right) => {
    if (left.type === 'group' && right.type !== 'group') return -1
    if (left.type !== 'group' && right.type === 'group') return 1
    if (left.parentNodeId && !right.parentNodeId) return 1
    if (!left.parentNodeId && right.parentNodeId) return -1
    return left.zIndex - right.zIndex
  })
}

function updateProjectCounts(db: CanvasDb, projectId: string): void {
  const project = db.projects.find((item) => item.id === projectId)
  if (!project) return
  project.nodeCount = db.nodes.filter((node) => node.projectId === projectId && !node.hidden).length
  project.assetCount = db.assets.filter((asset) => asset.projectId === projectId).length
  project.taskCount = db.tasks.filter((task) => task.projectId === projectId).length
  project.updatedAt = now()
}

export const canvasApi = {
  async listProjects(): Promise<CanvasProject[]> {
    const db = readDb()
    return db.projects.filter((project) => project.status !== 'deleted')
  },

  async createProject(input: { title: string; description?: string }): Promise<CanvasSnapshot> {
    const db = readDb()
    const at = now()
    const projectId = uid('canvas_project')
    const boardId = uid('canvas_board')
    const project: CanvasProject = {
      id: projectId,
      userId: USER_ID,
      title: input.title,
      description: input.description ?? null,
      status: 'active',
      nodeCount: 0,
      assetCount: 0,
      taskCount: 0,
      lastOpenedAt: at,
      createdAt: at,
      updatedAt: at,
    }
    const board: CanvasBoard = {
      id: boardId,
      projectId,
      userId: USER_ID,
      name: 'Main canvas',
      viewport: { x: 0, y: 0, zoom: 1 },
      settings: { grid: true, snap: false, background: 'paper' },
      createdAt: at,
      updatedAt: at,
    }
    db.projects.unshift(project)
    db.boards.push(board)
    writeDb(db)
    return { project, board, nodes: [], edges: [], assets: [], tasks: [] }
  },

  async updateProject(
    projectId: string,
    patch: Partial<Pick<CanvasProject, 'title' | 'description' | 'status'>>,
  ): Promise<CanvasProject> {
    const db = readDb()
    const project = db.projects.find((item) => item.id === projectId)
    if (!project) throw new Error('Canvas project not found')
    Object.assign(project, patch, { updatedAt: now() })
    writeDb(db)
    return project
  },

  async deleteProject(projectId: string): Promise<void> {
    await this.updateProject(projectId, { status: 'deleted' })
  },

  async openSnapshot(projectId: string): Promise<CanvasSnapshot> {
    const db = readDb()
    const project = db.projects.find((item) => item.id === projectId)
    const board = db.boards.find((item) => item.projectId === projectId)
    if (!project || !board) throw new Error('Canvas project not found')
    project.lastOpenedAt = now()
    writeDb(db)
    return {
      project,
      board,
      nodes: sortCanvasNodes(db.nodes.filter((node) => node.projectId === projectId && !node.hidden)),
      edges: db.edges.filter((edge) => edge.projectId === projectId),
      assets: db.assets.filter((asset) => asset.projectId === projectId),
      tasks: db.tasks.filter((task) => task.projectId === projectId),
    }
  },

  async updateViewport(projectId: string, viewport: CanvasBoard['viewport']): Promise<void> {
    const db = readDb()
    const board = db.boards.find((item) => item.projectId === projectId)
    if (!board) return
    board.viewport = viewport
    board.updatedAt = now()
    writeDb(db)
  },

  async createTextNode(input: {
    projectId: string
    boardId: string
    text: string
    isPrompt?: boolean
    x: number
    y: number
  }): Promise<CanvasNode> {
    const db = readDb()
    const node = createNodeBase({
      projectId: input.projectId,
      boardId: input.boardId,
      type: input.isPrompt ? 'prompt' : 'text',
      title: input.isPrompt ? 'Prompt' : 'Text note',
      x: input.x,
      y: input.y,
      width: 280,
      height: 164,
      data: { text: input.text, format: input.isPrompt ? 'prompt' : 'plain' },
    })
    const asset: CanvasAsset = {
      id: uid('canvas_asset'),
      projectId: input.projectId,
      userId: USER_ID,
      type: input.isPrompt ? 'prompt' : 'text',
      source: 'manual',
      title: node.title ?? null,
      contentText: input.text,
      metadata: { nodeId: node.id },
      createdAt: node.createdAt,
      updatedAt: node.updatedAt,
    }
    node.assetId = asset.id
    db.nodes.push(node)
    db.assets.push(asset)
    updateProjectCounts(db, input.projectId)
    writeDb(db)
    return node
  },

  async createImageNode(input: {
    projectId: string
    boardId: string
    file: File
    dataUrl: string
    x: number
    y: number
  }): Promise<CanvasNode> {
    const db = readDb()
    const asset: CanvasAsset = {
      id: uid('canvas_asset'),
      projectId: input.projectId,
      userId: USER_ID,
      type: 'image',
      source: 'upload',
      title: input.file.name,
      mimeType: input.file.type,
      url: input.dataUrl,
      thumbnailUrl: input.dataUrl,
      sizeBytes: input.file.size,
      metadata: { storageAdapter: 'localStorage-demo' },
      createdAt: now(),
      updatedAt: now(),
    }
    const node = createNodeBase({
      projectId: input.projectId,
      boardId: input.boardId,
      type: 'image',
      title: input.file.name,
      assetId: asset.id,
      x: input.x,
      y: input.y,
      width: 280,
      height: 210,
      data: { url: input.dataUrl, thumbnailUrl: input.dataUrl, mimeType: input.file.type },
    })
    db.assets.push(asset)
    db.nodes.push(node)
    updateProjectCounts(db, input.projectId)
    writeDb(db)
    return node
  },

  async createGroupNode(projectId: string, nodeIds: string[]): Promise<CanvasSnapshot> {
    const db = readDb()
    const board = db.boards.find((item) => item.projectId === projectId)
    if (!board) throw new Error('Canvas board not found')

    const selected = new Set(nodeIds)
    const sourceNodes = db.nodes.filter(
      (node) =>
        node.projectId === projectId &&
        !node.hidden &&
        node.type !== 'group' &&
        !node.parentNodeId &&
        selected.has(node.id),
    )
    if (sourceNodes.length < 2) return this.openSnapshot(projectId)

    const at = now()
    const maxZ = Math.max(0, ...db.nodes.filter((node) => node.projectId === projectId).map((node) => node.zIndex))
    const groupX = Math.min(...sourceNodes.map((node) => node.x)) - 28
    const groupY = Math.min(...sourceNodes.map((node) => node.y)) - 56
    const cellWidth = Math.max(220, ...sourceNodes.map((node) => Math.min(node.width, 320)))
    const cellHeight = Math.max(132, ...sourceNodes.map((node) => Math.min(node.height, 210)))
    const columns = sourceNodes.length <= 2 ? sourceNodes.length : 2
    const rows = Math.ceil(sourceNodes.length / columns)
    const gap = 18
    const paddingX = 22
    const headerHeight = 48
    const groupWidth = Math.max(360, columns * cellWidth + (columns - 1) * gap + paddingX * 2)
    const groupHeight = Math.max(220, headerHeight + rows * cellHeight + (rows - 1) * gap + 24)

    const groupNode = createNodeBase({
      projectId,
      boardId: board.id,
      type: 'group',
      title: `Group ${sourceNodes.length}`,
      x: groupX,
      y: groupY,
      width: groupWidth,
      height: groupHeight,
      data: {
        text: `包含 ${sourceNodes.length} 个节点`,
        message: sourceNodes.map((node) => node.title ?? node.type).join(' / '),
      },
      at,
    })
    groupNode.zIndex = maxZ + 1

    const sortedNodes = [...sourceNodes].sort((left, right) => left.x - right.x || left.y - right.y)
    const arrangedById = new Map(
      sortedNodes.map((node, index) => {
        const col = index % columns
        const row = Math.floor(index / columns)
        return [
          node.id,
          {
            x: paddingX + col * (cellWidth + gap),
            y: headerHeight + row * (cellHeight + gap),
            width: Math.min(Math.max(node.width, 200), cellWidth),
            height: Math.min(Math.max(node.height, 118), cellHeight),
          },
        ]
      }),
    )

    db.nodes = db.nodes.map((node) => {
      const layout = arrangedById.get(node.id)
      if (!layout) return node
      return {
        ...node,
        parentNodeId: groupNode.id,
        x: layout.x,
        y: layout.y,
        width: layout.width,
        height: layout.height,
        zIndex: groupNode.zIndex + 1,
        updatedAt: at,
      }
    })
    db.nodes.push(groupNode)
    db.edges.push(
      ...sourceNodes.map(
        (node): CanvasEdge => ({
          id: uid('canvas_edge'),
          projectId,
          boardId: board.id,
          userId: USER_ID,
          sourceNodeId: groupNode.id,
          targetNodeId: node.id,
          type: 'group_contains',
          metadata: {},
          createdAt: at,
        }),
      ),
    )
    updateProjectCounts(db, projectId)
    writeDb(db)
    return this.openSnapshot(projectId)
  },

  async updateNodes(projectId: string, nodes: CanvasNode[]): Promise<void> {
    const db = readDb()
    const byId = new Map(nodes.map((node) => [node.id, node]))
    db.nodes = db.nodes.map((node) => {
      const next = byId.get(node.id)
      return next ? { ...node, ...next, updatedAt: now() } : node
    })
    updateProjectCounts(db, projectId)
    writeDb(db)
  },

  async patchNodes(
    projectId: string,
    nodeIds: string[],
    patch: Partial<CanvasNode>,
  ): Promise<CanvasSnapshot> {
    const db = readDb()
    const selected = new Set(nodeIds)
    db.nodes = db.nodes.map((node) => {
      if (!selected.has(node.id) || node.projectId !== projectId) return node
      return {
        ...node,
        ...patch,
        id: node.id,
        projectId: node.projectId,
        boardId: node.boardId,
        userId: node.userId,
        updatedAt: now(),
      }
    })
    updateProjectCounts(db, projectId)
    writeDb(db)
    return this.openSnapshot(projectId)
  },

  async updateNodeData(
    projectId: string,
    nodeId: string,
    data: CanvasNode['data'],
  ): Promise<CanvasSnapshot> {
    const db = readDb()
    const node = db.nodes.find((item) => item.id === nodeId && item.projectId === projectId)
    if (!node) return this.openSnapshot(projectId)
    node.data = data
    node.updatedAt = now()

    const asset = node.assetId ? db.assets.find((item) => item.id === node.assetId) : null
    if (asset && (node.type === 'text' || node.type === 'prompt')) {
      asset.contentText = data.text ?? ''
      asset.updatedAt = now()
    }

    updateProjectCounts(db, projectId)
    writeDb(db)
    return this.openSnapshot(projectId)
  },

  async duplicateNodes(projectId: string, nodeIds: string[]): Promise<CanvasSnapshot> {
    const db = readDb()
    const selected = new Set(nodeIds)
    const sourceNodes = db.nodes.filter(
      (node) => selected.has(node.id) && node.projectId === projectId,
    )
    const idMap = new Map<string, string>()
    const at = now()
    const clones = sourceNodes.map((node) => {
      const nextId = uid('canvas_node')
      idMap.set(node.id, nextId)
      return {
        ...node,
        id: nextId,
        x: node.x + 36,
        y: node.y + 36,
        locked: false,
        title: node.title ? `${node.title} copy` : null,
        createdAt: at,
        updatedAt: at,
      }
    })
    const clonedEdges = db.edges
      .filter((edge) => selected.has(edge.sourceNodeId) && selected.has(edge.targetNodeId))
      .map((edge) => ({
        ...edge,
        id: uid('canvas_edge'),
        sourceNodeId: idMap.get(edge.sourceNodeId) ?? edge.sourceNodeId,
        targetNodeId: idMap.get(edge.targetNodeId) ?? edge.targetNodeId,
        createdAt: at,
      }))

    db.nodes.push(...clones)
    db.edges.push(...clonedEdges)
    updateProjectCounts(db, projectId)
    writeDb(db)
    return this.openSnapshot(projectId)
  },

  async deleteNodes(projectId: string, nodeIds: string[]): Promise<void> {
    const db = readDb()
    const remove = new Set(nodeIds)
    const removedGroups = new Map(
      db.nodes
        .filter((node) => remove.has(node.id) && node.projectId === projectId && node.type === 'group')
        .map((node) => [node.id, node]),
    )
    const at = now()
    db.nodes = db.nodes.map((node) => {
      if (remove.has(node.id)) return { ...node, hidden: true, updatedAt: at }
      const parent = node.parentNodeId ? removedGroups.get(node.parentNodeId) : undefined
      if (!parent) return node
      return {
        ...node,
        parentNodeId: null,
        x: parent.x + node.x,
        y: parent.y + node.y,
        updatedAt: at,
      }
    })
    db.edges = db.edges.filter(
      (edge) => !remove.has(edge.sourceNodeId) && !remove.has(edge.targetNodeId),
    )
    updateProjectCounts(db, projectId)
    writeDb(db)
  },

  async createTask(projectId: string, request: CreateCanvasTaskRequest): Promise<CanvasSnapshot> {
    const db = readDb()
    const board = db.boards.find((item) => item.id === request.boardId)
    const project = db.projects.find((item) => item.id === projectId)
    if (!board || !project) throw new Error('Canvas board not found')
    const at = now()
    const taskId = uid('canvas_task')
    const x = request.outputPlacement?.x ?? 360
    const y = request.outputPlacement?.y ?? 320
    const taskNodeData: CanvasNode['data'] = {
      operation: request.operation,
      status: 'pending',
      progress: 12,
      message: '任务已创建，等待 agent/provider 接入',
    }
    if (request.prompt != null) taskNodeData.prompt = request.prompt

    const taskNode = createNodeBase({
      projectId,
      boardId: board.id,
      type: 'task',
      taskId,
      title: operationLabel(request.operation),
      x,
      y,
      width: 300,
      height: 152,
      data: taskNodeData,
      at,
    })
    const task: CanvasTask = {
      id: taskId,
      projectId,
      boardId: board.id,
      userId: USER_ID,
      operation: request.operation,
      status: 'pending',
      progress: 12,
      title: operationLabel(request.operation),
      prompt: request.prompt ?? null,
      inputNodeIds: request.inputNodeIds ?? [],
      inputAssetIds: request.inputAssetIds ?? [],
      outputNodeIds: [],
      outputAssetIds: [],
      agentId: request.agentId ?? null,
      providerProfileId: request.providerProfileId ?? null,
      modelId: request.modelId ?? null,
      modelParams: request.modelParams ?? {},
      createdAt: at,
      updatedAt: at,
    }
    const inputEdges = task.inputNodeIds.map(
      (sourceNodeId): CanvasEdge => ({
        id: uid('canvas_edge'),
        projectId,
        boardId: board.id,
        userId: USER_ID,
        sourceNodeId,
        targetNodeId: taskNode.id,
        type: 'used_as_input',
        taskId,
        metadata: {},
        createdAt: at,
      }),
    )
    db.nodes.push(taskNode)
    db.tasks.push(task)
    db.edges.push(...inputEdges)
    updateProjectCounts(db, projectId)
    writeDb(db)
    return this.openSnapshot(projectId)
  },

  async completeDemoTask(projectId: string, taskId: string): Promise<CanvasSnapshot> {
    const db = readDb()
    const task = db.tasks.find((item) => item.id === taskId)
    const taskNode = db.nodes.find((item) => item.taskId === taskId)
    if (!task || !taskNode) return this.openSnapshot(projectId)
    const asset: CanvasAsset = {
      id: uid('canvas_asset'),
      projectId,
      userId: USER_ID,
      type:
        task.operation === 'text_generate' || task.operation === 'prompt_optimize'
          ? 'text'
          : 'image',
      source: 'ai_generated',
      title: `${task.title ?? operationLabel(task.operation)} result`,
      contentText:
        task.operation === 'text_generate' || task.operation === 'prompt_optimize'
          ? `优化结果：${task.prompt ?? '基于当前选区生成一段可继续编辑的文本。'}`
          : null,
      url: task.operation === 'text_generate' || task.operation === 'prompt_optimize' ? null : '',
      metadata: { taskId, demo: true },
      createdAt: now(),
      updatedAt: now(),
    }
    const resultNode = createNodeBase({
      projectId,
      boardId: task.boardId,
      type: asset.type === 'image' ? 'image' : 'text',
      title: asset.title ?? null,
      assetId: asset.id,
      x: taskNode.x + 380,
      y: taskNode.y,
      width: asset.type === 'image' ? 280 : 300,
      height: asset.type === 'image' ? 210 : 164,
      data:
        asset.type === 'image'
          ? {
              message:
                task.prompt != null
                  ? `AI 图片结果占位，后续由 agent/provider 回填 URL。Prompt: ${task.prompt}`
                  : 'AI 图片结果占位，后续由 agent/provider 回填 URL',
            }
          : { text: asset.contentText ?? '', format: 'plain' },
    })
    task.status = 'completed'
    task.progress = 100
    task.completedAt = now()
    task.updatedAt = now()
    task.outputAssetIds.push(asset.id)
    task.outputNodeIds.push(resultNode.id)
    taskNode.data = {
      ...taskNode.data,
      status: 'completed',
      progress: 100,
      message: 'Demo 结果已写回画布',
    }
    taskNode.updatedAt = now()
    db.assets.push(asset)
    db.nodes.push(resultNode)
    db.edges.push({
      id: uid('canvas_edge'),
      projectId,
      boardId: task.boardId,
      userId: USER_ID,
      sourceNodeId: taskNode.id,
      targetNodeId: resultNode.id,
      type: 'generated',
      taskId,
      metadata: {},
      createdAt: now(),
    })
    updateProjectCounts(db, projectId)
    writeDb(db)
    return this.openSnapshot(projectId)
  },

  /**
   * 创建并执行真实多媒体任务（走 main process → MediaRouterService → 平台 adapter）。
   *
   * 流程（design doc §8）：
   *   1. 写入 optimistic task node（status=running）。
   *   2. 调 `canvas:task:create-media` IPC（API key 只在主进程内）。
   *   3. 成功：把每个输出 asset 写回 canvas_assets，创建输出节点 + generated 边缘，
   *      task 标记 completed，记录 provider/model/requestId/rawResponse。
   *   4. 失败：task 标记 failed，保留 errorMsg 供 Inspector 展示。
   */
  async createMediaTask(
    projectId: string,
    request: Omit<CreateCanvasTaskRequest, 'boardId'> & {
      inputFiles?: CanvasMediaTaskInputFile[]
    },
  ): Promise<CanvasSnapshot> {
    const db = readDb()
    const board = db.boards.find((item) => item.projectId === projectId)
    const project = db.projects.find((item) => item.id === projectId)
    if (!board || !project) throw new Error('Canvas board not found')
    const at = now()
    const taskId = uid('canvas_task')
    const x = request.outputPlacement?.x ?? 360
    const y = request.outputPlacement?.y ?? 320

    // optimistic task node
    const taskNodeData: CanvasNode['data'] = {
      operation: request.operation,
      status: 'running',
      progress: 24,
      message: '调用平台 adapter 中…',
    }
    if (request.prompt != null) taskNodeData.prompt = request.prompt
    const taskNode = createNodeBase({
      projectId,
      boardId: board.id,
      type: 'task',
      taskId,
      title: operationLabel(request.operation),
      x,
      y,
      width: 300,
      height: 152,
      data: taskNodeData,
      at,
    })
    const task: CanvasTask = {
      id: taskId,
      projectId,
      boardId: board.id,
      userId: USER_ID,
      operation: request.operation,
      status: 'running',
      progress: 24,
      title: operationLabel(request.operation),
      prompt: request.prompt ?? null,
      inputNodeIds: request.inputNodeIds ?? [],
      inputAssetIds: request.inputAssetIds ?? [],
      outputNodeIds: [],
      outputAssetIds: [],
      agentId: request.agentId ?? null,
      providerProfileId: request.providerProfileId ?? null,
      modelId: request.modelId ?? null,
      modelParams: request.modelParams ?? {},
      createdAt: at,
      updatedAt: at,
    }
    const inputEdges = task.inputNodeIds.map(
      (sourceNodeId): CanvasEdge => ({
        id: uid('canvas_edge'),
        projectId,
        boardId: board.id,
        userId: USER_ID,
        sourceNodeId,
        targetNodeId: taskNode.id,
        type: 'used_as_input',
        taskId,
        metadata: {},
        createdAt: at,
      }),
    )
    db.nodes.push(taskNode)
    db.tasks.push(task)
    db.edges.push(...inputEdges)
    updateProjectCounts(db, projectId)
    writeDb(db)

    // 调 IPC（API key 只在主进程）
    const ipcRequest: CanvasMediaTaskCreateRequest = {
      operation: request.operation,
      ...(request.prompt != null ? { prompt: request.prompt } : {}),
      ...(request.inputFiles != null ? { inputFiles: request.inputFiles } : {}),
      ...(request.providerProfileId != null ? { providerProfileId: request.providerProfileId } : {}),
      ...(request.modelParams != null ? { modelParams: request.modelParams } : {}),
    }
    let response: CanvasMediaTaskCreateResponse
    try {
      response = await window.spark.invoke('canvas:task:create-media', ipcRequest)
    } catch (err) {
      response = {
        providerProfileId: '',
        provider: '',
        model: '',
        mode: 'sync',
        assets: [],
        error: { code: 'ipc_error', message: err instanceof Error ? err.message : String(err) },
      }
    }
    return this.applyMediaTaskResult(projectId, taskId, response)
  },

  /** 把平台 adapter 的输出写回 canvas_assets / canvas_nodes / canvas_edges */
  async applyMediaTaskResult(
    projectId: string,
    taskId: string,
    response: CanvasMediaTaskCreateResponse,
  ): Promise<CanvasSnapshot> {
    const db = readDb()
    const task = db.tasks.find((item) => item.id === taskId)
    const taskNode = db.nodes.find((item) => item.taskId === taskId)
    if (!task || !taskNode) return this.openSnapshot(projectId)

    if (response.error) {
      task.status = 'failed'
      task.progress = 100
      task.errorMsg = response.error.code
      task.errorDetail = response.error.message
      task.updatedAt = now()
      taskNode.data = {
        ...taskNode.data,
        status: 'failed',
        progress: 100,
        message: `失败：${response.error.message}`,
      }
      taskNode.updatedAt = now()
      updateProjectCounts(db, projectId)
      writeDb(db)
      return this.openSnapshot(projectId)
    }

    task.status = 'completed'
    task.progress = 100
    task.completedAt = now()
    task.updatedAt = now()
    if (response.providerProfileId) task.providerProfileId = response.providerProfileId
    if (response.model) task.modelId = response.model
    task.provider = response.provider || null
    task.requestId = response.requestId ?? null
    task.rawResponse = response.rawResponse

    const at = now()
    response.assets.forEach((assetOut, index) => {
      const assetType = (assetOut.type || 'file') as CanvasAssetType
      // 优先用 base64 预览（小图快），否则把磁盘路径编码成 safe-file:// 供 <audio>/<video>/<img> 加载
      const displayUrl = resolveMediaDisplayUrl({
        url: assetOut.url,
        dataUrl: assetOut.previewDataUrl,
        filePath: assetOut.filePath,
      })
      const asset: CanvasAsset = {
        id: uid('canvas_asset'),
        projectId,
        userId: USER_ID,
        type: assetType,
        source: task.operation === 'image_edit' || task.operation === 'image_compose' ? 'ai_edited' : 'ai_generated',
        title: `${operationLabel(task.operation)} · ${response.provider}/${response.model}`,
        mimeType: assetOut.mimeType ?? null,
        storageKey: assetOut.filePath ?? null,
        url: displayUrl || null,
        thumbnailUrl: assetType === 'image' ? (displayUrl || null) : null,
        contentText: assetOut.contentText ?? null,
        ...(assetOut.width != null ? { width: assetOut.width } : {}),
        ...(assetOut.height != null ? { height: assetOut.height } : {}),
        ...(assetOut.durationMs != null ? { durationMs: assetOut.durationMs } : {}),
        metadata: {
          taskId,
          provider: response.provider,
          model: response.model,
          requestId: response.requestId ?? null,
          filePath: assetOut.filePath ?? null,
        },
        createdAt: at,
        updatedAt: at,
      }
      const nodeType: CanvasNode['type'] =
        assetType === 'text' ? 'text'
          : assetType === 'image' ? 'image'
            : assetType === 'audio' ? 'audio'
              : assetType === 'video' ? 'video' : 'text'
      const nodeData: CanvasNode['data'] =
        nodeType === 'text'
          ? { text: asset.contentText ?? '', format: 'plain' }
          : { message: assetOut.filePath ?? asset.title ?? 'media asset' }
      if (nodeType !== 'text') {
        if (displayUrl) nodeData.url = displayUrl
        if (asset.mimeType) nodeData.mimeType = asset.mimeType
        if (assetType === 'image' && asset.thumbnailUrl) nodeData.thumbnailUrl = asset.thumbnailUrl
      }
      const resultNode = createNodeBase({
        projectId,
        boardId: task.boardId,
        type: nodeType,
        title: asset.title ?? null,
        assetId: asset.id,
        x: taskNode.x + 380 + index * 48,
        y: taskNode.y + index * 48,
        width: nodeType === 'image' ? 280 : nodeType === 'video' ? 320 : 300,
        height: nodeType === 'image' ? 210 : nodeType === 'video' ? 200 : 164,
        data: nodeData,
      })
      task.outputAssetIds.push(asset.id)
      task.outputNodeIds.push(resultNode.id)
      db.assets.push(asset)
      db.nodes.push(resultNode)
      db.edges.push({
        id: uid('canvas_edge'),
        projectId,
        boardId: task.boardId,
        userId: USER_ID,
        sourceNodeId: taskNode.id,
        targetNodeId: resultNode.id,
        type: 'generated',
        taskId,
        metadata: {},
        createdAt: at,
      })
    })

    taskNode.data = {
      ...taskNode.data,
      status: 'completed',
      progress: 100,
      message: `${response.assets.length} 个产物已写回画布`,
    }
    taskNode.updatedAt = now()
    updateProjectCounts(db, projectId)
    writeDb(db)
    return this.openSnapshot(projectId)
  },

  /** 拉取当前可用的多媒体 provider 列表（不含 API key） */
  async listMediaCapabilities(): Promise<CanvasMediaCapabilitiesListResponse> {
    return window.spark.invoke('canvas:media-capabilities:list', {})
  },

  /**
   * 从 SQLite 恢复画布数据到 localStorage（迁移 / 跨窗口恢复）。
   *
   * 只恢复 localStorage 中不存在的 projectId（不覆盖本地较新的数据）。
   * 启动时调用一次，保证 SQLite 里的项目在画布中可见。
   */
  async hydrateFromStorage(): Promise<{ restored: number }> {
    let db: CanvasDb
    try {
      db = readDb()
    } catch {
      db = emptyDb()
    }
    const existing = new Set(db.projects.map((p) => p.id))
    let restored = 0
    try {
      const { projects } = await window.spark.invoke('canvas:project:list', {})
      for (const project of projects) {
        if (project.status === 'deleted' || existing.has(project.id)) continue
        const { snapshotJson } = await window.spark.invoke('canvas:snapshot:load', { projectId: project.id })
        if (!snapshotJson) continue
        try {
          const snapshot = JSON.parse(snapshotJson) as Partial<CanvasSnapshot>
          if (snapshot.project) db.projects.push(snapshot.project)
          if (snapshot.board) db.boards.push(snapshot.board)
          if (snapshot.nodes) db.nodes.push(...snapshot.nodes)
          if (snapshot.edges) db.edges.push(...snapshot.edges)
          if (snapshot.assets) db.assets.push(...snapshot.assets)
          if (snapshot.tasks) db.tasks.push(...snapshot.tasks)
          restored += 1
        } catch {
          // 单个项目解析失败跳过
        }
      }
      if (restored > 0) {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(db))
      }
    } catch {
      // SQLite 不可用时静默降级到 localStorage
    }
    return { restored }
  },
}

export function operationLabel(operation: CanvasOperationType): string {
  return getCanvasCapability(operation)?.label ?? operation
}

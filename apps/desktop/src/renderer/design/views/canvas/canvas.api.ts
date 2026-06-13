import type {
  CanvasAsset,
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

const STORAGE_KEY = 'spark-canvas:v1'
const USER_ID = 0

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
      nodes: db.nodes.filter((node) => node.projectId === projectId && !node.hidden),
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
    db.nodes = db.nodes.map((node) =>
      remove.has(node.id) ? { ...node, hidden: true, updatedAt: now() } : node,
    )
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
}

export function operationLabel(operation: CanvasOperationType): string {
  return getCanvasCapability(operation)?.label ?? operation
}

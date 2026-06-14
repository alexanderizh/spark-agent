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
  CanvasMediaModelDescribeRequest,
  CanvasMediaModelDescribeResponse,
  CanvasMediaModelsListRequest,
  CanvasMediaModelsListResponse,
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

const GROUP_PADDING_X = 28
const GROUP_PADDING_BOTTOM = 28
const GROUP_HEADER_HEIGHT = 56

type GroupMemberLayout = {
  node: CanvasNode
  absoluteX: number
  absoluteY: number
}

function applyGroupLayout(
  groupNode: CanvasNode,
  members: GroupMemberLayout[],
  at: string,
): void {
  if (members.length === 0) {
    groupNode.width = Math.max(groupNode.width, 360)
    groupNode.height = Math.max(groupNode.height, 220)
    groupNode.data = {
      ...groupNode.data,
      text: '包含 0 个节点',
      message: '拖入或选择节点后可加入此组',
    }
    groupNode.updatedAt = at
    return
  }

  const left = Math.min(...members.map((item) => item.absoluteX))
  const top = Math.min(...members.map((item) => item.absoluteY))
  const right = Math.max(...members.map((item) => item.absoluteX + item.node.width))
  const bottom = Math.max(...members.map((item) => item.absoluteY + item.node.height))
  const contentWidth = right - left
  const contentHeight = bottom - top
  const tallestNodeHeight = Math.max(...members.map((item) => item.node.height))
  const groupX = left - GROUP_PADDING_X
  const groupY = top - GROUP_HEADER_HEIGHT

  groupNode.x = groupX
  groupNode.y = groupY
  groupNode.width = Math.max(360, contentWidth + GROUP_PADDING_X * 2)
  groupNode.height = Math.max(
    220,
    GROUP_HEADER_HEIGHT + contentHeight + GROUP_PADDING_BOTTOM,
    GROUP_HEADER_HEIGHT + tallestNodeHeight + GROUP_PADDING_BOTTOM,
  )
  groupNode.data = {
    ...groupNode.data,
    text: `包含 ${members.length} 个节点`,
    message: members.map((item) => item.node.title ?? item.node.type).join(' / '),
  }
  groupNode.updatedAt = at

  for (const member of members) {
    member.node.parentNodeId = groupNode.id
    member.node.x = member.absoluteX - groupNode.x
    member.node.y = member.absoluteY - groupNode.y
    member.node.zIndex = groupNode.zIndex + 1
    member.node.updatedAt = at
  }
}

function refreshGroupLayout(db: CanvasDb, groupNode: CanvasNode, at: string): void {
  const members = db.nodes
    .filter((node) => node.parentNodeId === groupNode.id && !node.hidden)
    .map((node) => ({
      node,
      absoluteX: groupNode.x + node.x,
      absoluteY: groupNode.y + node.y,
    }))
  applyGroupLayout(groupNode, members, at)
}

function fitMediaNodeSize(
  type: CanvasAssetType,
  width?: number | null,
  height?: number | null,
): { width: number; height: number } {
  if (type === 'image' || type === 'video') {
    const headerHeight = 36
    if (width && height) {
      const aspect = height / width
      let nodeWidth = Math.min(Math.max(width, type === 'video' ? 320 : 260), type === 'video' ? 520 : 420)
      let bodyHeight = Math.round(nodeWidth * aspect)
      const maxBodyHeight = type === 'video' ? 420 : 680
      if (bodyHeight > maxBodyHeight) {
        bodyHeight = maxBodyHeight
        nodeWidth = Math.max(type === 'video' ? 300 : 220, Math.round(bodyHeight / aspect))
      }
      return { width: Math.round(nodeWidth), height: Math.max(type === 'video' ? 220 : 220, bodyHeight + headerHeight) }
    }
    return type === 'video' ? { width: 360, height: 240 } : { width: 320, height: 260 }
  }
  if (type === 'audio') return { width: 320, height: 164 }
  return { width: 300, height: 164 }
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
    width?: number
    height?: number
    imageWidth?: number
    imageHeight?: number
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
      width: input.imageWidth ?? null,
      height: input.imageHeight ?? null,
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
      width: input.width ?? 320,
      height: input.height ?? 260,
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
    const memberLayouts = sourceNodes.map((node) => ({
      node,
      absoluteX: node.x,
      absoluteY: node.y,
    }))

    const groupNode = createNodeBase({
      projectId,
      boardId: board.id,
      type: 'group',
      title: `Group ${sourceNodes.length}`,
      x: 0,
      y: 0,
      width: 360,
      height: 220,
      data: {
        text: `包含 ${sourceNodes.length} 个节点`,
        message: sourceNodes.map((node) => node.title ?? node.type).join(' / '),
      },
      at,
    })
    groupNode.zIndex = maxZ + 1

    const sortedNodes = [...sourceNodes].sort(
      (leftNode, rightNode) => leftNode.x - rightNode.x || leftNode.y - rightNode.y,
    )
    const memberLayoutById = new Map(memberLayouts.map((item) => [item.node.id, item]))
    const sortedMemberLayouts = sortedNodes
      .map((node) => memberLayoutById.get(node.id))
      .filter((item): item is GroupMemberLayout => Boolean(item))
    applyGroupLayout(groupNode, sortedMemberLayouts, at)

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

  async dissolveGroupNode(projectId: string, groupId: string): Promise<CanvasSnapshot> {
    const db = readDb()
    const groupNode = db.nodes.find(
      (node) => node.id === groupId && node.projectId === projectId && node.type === 'group' && !node.hidden,
    )
    if (!groupNode) return this.openSnapshot(projectId)

    const at = now()
    for (const node of db.nodes) {
      if (node.projectId !== projectId || node.hidden || node.parentNodeId !== groupNode.id) continue
      node.parentNodeId = null
      node.x = groupNode.x + node.x
      node.y = groupNode.y + node.y
      node.updatedAt = at
    }
    groupNode.hidden = true
    groupNode.updatedAt = at
    db.edges = db.edges.filter(
      (edge) => edge.sourceNodeId !== groupNode.id && edge.targetNodeId !== groupNode.id,
    )
    updateProjectCounts(db, projectId)
    writeDb(db)
    return this.openSnapshot(projectId)
  },

  async addNodesToGroup(projectId: string, groupId: string, nodeIds: string[]): Promise<CanvasSnapshot> {
    const db = readDb()
    const groupNode = db.nodes.find(
      (node) => node.id === groupId && node.projectId === projectId && node.type === 'group' && !node.hidden,
    )
    if (!groupNode) return this.openSnapshot(projectId)

    const selected = new Set(nodeIds.filter((id) => id !== groupNode.id))
    const nodesToAdd = db.nodes.filter(
      (node) =>
        node.projectId === projectId &&
        !node.hidden &&
        node.type !== 'group' &&
        !node.parentNodeId &&
        selected.has(node.id),
    )
    if (nodesToAdd.length === 0) return this.openSnapshot(projectId)

    const at = now()
    const existingMembers: GroupMemberLayout[] = db.nodes
      .filter((node) => node.projectId === projectId && !node.hidden && node.parentNodeId === groupNode.id)
      .map((node) => ({
        node,
        absoluteX: groupNode.x + node.x,
        absoluteY: groupNode.y + node.y,
      }))
    const addedMembers: GroupMemberLayout[] = nodesToAdd.map((node) => ({
      node,
      absoluteX: node.x,
      absoluteY: node.y,
    }))

    applyGroupLayout(groupNode, [...existingMembers, ...addedMembers], at)

    for (const node of nodesToAdd) {
      const duplicate = db.edges.some(
        (edge) =>
          edge.projectId === projectId &&
          edge.sourceNodeId === groupNode.id &&
          edge.targetNodeId === node.id &&
          edge.type === 'group_contains',
      )
      if (duplicate) continue
      db.edges.push({
        id: uid('canvas_edge'),
        projectId,
        boardId: groupNode.boardId,
        userId: USER_ID,
        sourceNodeId: groupNode.id,
        targetNodeId: node.id,
        type: 'group_contains',
        metadata: {},
        createdAt: at,
      })
    }

    updateProjectCounts(db, projectId)
    writeDb(db)
    return this.openSnapshot(projectId)
  },

  async removeNodesFromGroup(projectId: string, nodeIds: string[]): Promise<CanvasSnapshot> {
    const db = readDb()
    const selected = new Set(nodeIds)
    const groupById = new Map(
      db.nodes
        .filter((node) => node.projectId === projectId && node.type === 'group' && !node.hidden)
        .map((node) => [node.id, node]),
    )
    const nodesToRemove = db.nodes.filter(
      (node) =>
        node.projectId === projectId &&
        !node.hidden &&
        node.parentNodeId &&
        selected.has(node.id) &&
        groupById.has(node.parentNodeId),
    )
    if (nodesToRemove.length === 0) return this.openSnapshot(projectId)

    const at = now()
    const affectedGroupIds = new Set<string>()
    for (const node of nodesToRemove) {
      const groupNode = node.parentNodeId ? groupById.get(node.parentNodeId) : undefined
      if (!groupNode) continue
      affectedGroupIds.add(groupNode.id)
      node.parentNodeId = null
      node.x = groupNode.x + node.x
      node.y = groupNode.y + node.y
      node.zIndex = groupNode.zIndex + 1
      node.updatedAt = at
    }

    const removedNodeIds = new Set(nodesToRemove.map((node) => node.id))
    db.edges = db.edges.filter(
      (edge) => !(edge.type === 'group_contains' && removedNodeIds.has(edge.targetNodeId)),
    )

    for (const groupId of affectedGroupIds) {
      const groupNode = groupById.get(groupId)
      if (!groupNode) continue
      const remainingMembers = db.nodes.filter(
        (node) => node.projectId === projectId && !node.hidden && node.parentNodeId === groupId,
      )
      if (remainingMembers.length === 0) {
        groupNode.hidden = true
        groupNode.updatedAt = at
        db.edges = db.edges.filter(
          (edge) => edge.sourceNodeId !== groupNode.id && edge.targetNodeId !== groupNode.id,
        )
        continue
      }
      refreshGroupLayout(db, groupNode, at)
    }

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

  async connectNodes(
    projectId: string,
    input: {
      sourceNodeId: string
      targetNodeId: string
      type?: CanvasEdge['type']
    },
  ): Promise<CanvasSnapshot> {
    if (!input.sourceNodeId || !input.targetNodeId || input.sourceNodeId === input.targetNodeId) {
      return this.openSnapshot(projectId)
    }
    const db = readDb()
    const source = db.nodes.find((node) => node.id === input.sourceNodeId && node.projectId === projectId && !node.hidden)
    const target = db.nodes.find((node) => node.id === input.targetNodeId && node.projectId === projectId && !node.hidden)
    const board = db.boards.find((item) => item.projectId === projectId)
    if (!source || !target || !board) return this.openSnapshot(projectId)

    const edgeType: CanvasEdge['type'] = input.type
      ?? (target.type === 'task' ? 'used_as_input' : source.type === 'task' ? 'generated' : 'references')
    const duplicate = db.edges.some((edge) =>
      edge.projectId === projectId &&
      edge.sourceNodeId === source.id &&
      edge.targetNodeId === target.id &&
      edge.type === edgeType,
    )
    if (duplicate) return this.openSnapshot(projectId)

    const taskId = target.type === 'task'
      ? target.taskId
      : source.type === 'task'
        ? source.taskId
        : null
    const at = now()
    const edge: CanvasEdge = {
      id: uid('canvas_edge'),
      projectId,
      boardId: board.id,
      userId: USER_ID,
      sourceNodeId: source.id,
      targetNodeId: target.id,
      type: edgeType,
      taskId: taskId ?? null,
      metadata: { manual: true },
      createdAt: at,
    }
    db.edges.push(edge)

    const task = taskId ? db.tasks.find((item) => item.id === taskId) : undefined
    if (task && edgeType === 'used_as_input') {
      if (!task.inputNodeIds.includes(source.id)) task.inputNodeIds.push(source.id)
      if (source.assetId && !task.inputAssetIds.includes(source.assetId)) task.inputAssetIds.push(source.assetId)
      task.updatedAt = at
    }
    if (task && edgeType === 'generated') {
      if (!task.outputNodeIds.includes(target.id)) task.outputNodeIds.push(target.id)
      if (target.assetId && !task.outputAssetIds.includes(target.assetId)) task.outputAssetIds.push(target.assetId)
      task.updatedAt = at
    }

    updateProjectCounts(db, projectId)
    writeDb(db)
    return this.openSnapshot(projectId)
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
      manifestId: request.manifestId ?? null,
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
      projectId,
      clientTaskId: taskId,
      operation: request.operation,
      ...(request.prompt != null ? { prompt: request.prompt } : {}),
      ...(request.inputFiles != null ? { inputFiles: request.inputFiles } : {}),
      ...(request.providerProfileId != null ? { providerProfileId: request.providerProfileId } : {}),
      ...(request.manifestId != null ? { manifestId: request.manifestId } : {}),
      ...(request.modelId != null ? { modelId: request.modelId } : {}),
      ...(request.modelParams != null ? { modelParams: request.modelParams } : {}),
      waitForCompletion: false,
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
    if (response.status === 'running') {
      return this.markMediaTaskSubmitted(projectId, taskId, response)
    }
    return this.applyMediaTaskResult(projectId, taskId, response)
  },

  async markMediaTaskSubmitted(
    projectId: string,
    taskId: string,
    response: CanvasMediaTaskCreateResponse,
  ): Promise<CanvasSnapshot> {
    const db = readDb()
    const task = db.tasks.find((item) => item.id === taskId)
    const taskNode = db.nodes.find((item) => item.taskId === taskId)
    if (!task || !taskNode) return this.openSnapshot(projectId)
    task.status = 'running'
    task.progress = Math.max(task.progress, 35)
    task.requestId = response.runtimeTaskId ?? response.requestId ?? null
    task.providerProfileId = response.providerProfileId || task.providerProfileId || null
    task.provider = response.provider || task.provider || null
    task.modelId = response.model || task.modelId || null
    task.updatedAt = now()
    taskNode.data = {
      ...taskNode.data,
      status: 'running',
      progress: task.progress,
      message: '后台任务已提交，等待 provider 返回产物',
    }
    taskNode.updatedAt = now()
    updateProjectCounts(db, projectId)
    writeDb(db)
    return this.openSnapshot(projectId)
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

    const responseRequestId = response.requestId ?? response.runtimeTaskId ?? null
    if (
      !response.error
      && response.status === 'succeeded'
      && task.status === 'completed'
      && task.outputAssetIds.length > 0
      && task.requestId === responseRequestId
    ) {
      return this.openSnapshot(projectId)
    }

    if (response.error || response.status === 'failed' || response.status === 'cancelled') {
      const isCancelled = response.status === 'cancelled'
      task.status = isCancelled ? 'cancelled' : 'failed'
      task.progress = 100
      task.errorMsg = response.error?.code ?? (isCancelled ? 'cancelled' : 'provider_task_failed')
      task.errorDetail = response.error?.message ?? (isCancelled ? '任务已取消' : 'Provider task failed')
      task.requestId = responseRequestId
      task.updatedAt = now()
      taskNode.data = {
        ...taskNode.data,
        status: task.status,
        progress: 100,
        message: isCancelled ? '任务已取消' : `失败：${task.errorDetail}`,
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
    task.requestId = responseRequestId
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
          requestId: responseRequestId,
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
      const resultNodeSize = fitMediaNodeSize(assetType, assetOut.width, assetOut.height)
      const resultNode = createNodeBase({
        projectId,
        boardId: task.boardId,
        type: nodeType,
        title: asset.title ?? null,
        assetId: asset.id,
        x: taskNode.x + 380 + index * 48,
        y: taskNode.y + index * 48,
        width: resultNodeSize.width,
        height: resultNodeSize.height,
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

  /** 拉取当前画布可用的 manifest 驱动模型列表（不含 API key） */
  async listMediaModels(request: CanvasMediaModelsListRequest = {}): Promise<CanvasMediaModelsListResponse> {
    return window.spark.invoke('canvas:media-models:list', request)
  },

  /** 查询单个 manifest 的完整调用/参数描述，供参数面板和 agent 节点编排使用 */
  async describeMediaModel(request: CanvasMediaModelDescribeRequest): Promise<CanvasMediaModelDescribeResponse> {
    return window.spark.invoke('canvas:media-models:describe', request)
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

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
import { encodeToSafeFileUrl, resolveMediaDisplayUrl } from './canvas-safe-file'
import type {
  CanvasMediaTaskCreateRequest,
  CanvasMediaTaskCreateResponse,
  CanvasMediaTaskInputFile,
  CanvasMediaCapabilitiesListResponse,
  CanvasMediaModelDescribeRequest,
  CanvasMediaModelDescribeResponse,
  CanvasMediaModelsListRequest,
  CanvasMediaModelsListResponse,
  CanvasProjectListItem,
  CanvasSnapshotSaveRequest,
} from '@spark/protocol'

const STORAGE_KEY = 'spark-canvas:v1'
const USER_ID = 0

/**
 * SQLite 是画布的生产权威存储。手动保存模型（避免「自动保存却没真正落库」的静默丢数据）：
 *   - writeDb 只写 localStorage（即时热存储）并置 dirty=true，不自动落 SQLite。
 *   - 保存动作（Ctrl+S / 保存按钮 / 离开确认）→ saveCanvas() → flushPersist()，
 *     把全量快照写进 SQLite，成功后清掉 dirty。
 *   - 项目生命周期（创建/重命名/归档/删除/打开）仍立即 flush，保证项目壳与元数据不丢。
 *
 * dirty 状态通过 'canvas:dirty' CustomEvent 广播，供工作区刷新「未保存」徽标。
 */
let persistInFlight: Promise<number> = Promise.resolve(0)
let canvasDirty = false

function dispatchDirty(): void {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('canvas:dirty', { detail: { dirty: canvasDirty } }))
  }
}

async function persistAllProjects(db: CanvasDb): Promise<number> {
  let failed = 0
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
    } catch (err) {
      failed += 1
      // 落库失败不阻断画布交互，但必须显式记录——这是「重启丢数据」的根因之一。
      console.error('[canvas] snapshot persist failed', project.id, err)
    }
  }
  return failed
}

/** 立即把全量快照写进 SQLite；全部成功（failed=0）返回 true 并清掉 dirty。 */
async function flushPersist(): Promise<boolean> {
  await persistInFlight
  persistInFlight = persistAllProjects(readDb())
  const failed = await persistInFlight
  if (failed === 0) {
    canvasDirty = false
    dispatchDirty()
    return true
  }
  return false
}

/** 手动保存：全量落库，返回是否成功。 */
export async function saveCanvas(): Promise<boolean> {
  return flushPersist()
}

/**
 * 用户选择「不保存离开」：把指定项目回滚到 SQLite 上次保存的状态，并清掉 dirty。
 * 否则被丢弃的改动仍留在 localStorage 里，会在下一次全量落库
 * （saveCanvas / openSnapshot）时被悄悄写回，违背「不保存」的语义。
 */
export async function revertProject(projectId: string): Promise<void> {
  const db = readDb()
  db.projects = db.projects.filter((p) => p.id !== projectId)
  db.boards = db.boards.filter((b) => b.projectId !== projectId)
  db.nodes = db.nodes.filter((n) => n.projectId !== projectId)
  db.edges = db.edges.filter((e) => e.projectId !== projectId)
  db.assets = db.assets.filter((a) => a.projectId !== projectId)
  db.tasks = db.tasks.filter((t) => t.projectId !== projectId)
  try {
    const { snapshotJson } = await window.spark.invoke('canvas:snapshot:load', { projectId })
    if (snapshotJson) {
      const snap = JSON.parse(snapshotJson) as Partial<CanvasSnapshot>
      if (snap.project) db.projects.push(snap.project)
      if (snap.board) db.boards.push(snap.board)
      if (snap.nodes) db.nodes.push(...snap.nodes)
      if (snap.edges) db.edges.push(...snap.edges)
      if (snap.assets) db.assets.push(...snap.assets)
      if (snap.tasks) db.tasks.push(...snap.tasks)
    }
  } catch (err) {
    // SQLite 读不到快照时，项目就地清空（等同丢弃）。
    console.error('[canvas] revertProject load failed', projectId, err)
  }
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(db))
  canvasDirty = false
  dispatchDirty()
}

export function isCanvasDirty(): boolean {
  return canvasDirty
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
  if (project.rootPath !== undefined) meta.rootPath = project.rootPath
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
  'video_edit',
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

type CanvasProjectExportPayload = {
  kind: 'spark.canvas.project'
  version: 1 | 2
  exportedAt: string
  app: 'Spark-Agent'
  projectRootPath?: string
  snapshot: CanvasSnapshot
}

function uid(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

function now(): string {
  return new Date().toISOString()
}

function toCanvasProject(project: CanvasProjectListItem): CanvasProject {
  return {
    ...project,
    userId: USER_ID,
  }
}

async function getDefaultCanvasProjectsRoot(): Promise<string> {
  const { rootPath } = await window.spark.invoke('canvas:project:default-root', {})
  return rootPath
}

async function ensureCanvasProjectDirectory(input: {
  projectId: string
  title?: string
  rootPath?: string | null
  parentDirectory?: string
}): Promise<string> {
  const result = await window.spark.invoke('canvas:project:ensure-directory', {
    projectId: input.projectId,
    ...(input.title !== undefined ? { title: input.title } : {}),
    ...(input.rootPath !== undefined ? { rootPath: input.rootPath } : {}),
    ...(input.parentDirectory !== undefined ? { parentDirectory: input.parentDirectory } : {}),
  })
  return result.rootPath
}

function readDb(): CanvasDb {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return emptyDb()
    return { ...emptyDb(), ...JSON.parse(raw) }
  } catch {
    return emptyDb()
  }
}

function writeDb(db: CanvasDb): void {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(db))
  // localStorage 仍是即时热存储；SQLite 只在手动保存(Ctrl+S)或项目生命周期操作时写入。
  canvasDirty = true
  dispatchDirty()
}

function writeHotDb(db: CanvasDb, dirty: boolean): void {
  const serialized = JSON.stringify(db)
  try {
    window.localStorage.setItem(STORAGE_KEY, serialized)
  } catch (err) {
    window.localStorage.removeItem(STORAGE_KEY)
    window.localStorage.setItem(STORAGE_KEY, serialized)
  }
  canvasDirty = dirty
  dispatchDirty()
}

function replaceProjectSnapshot(db: CanvasDb, snapshot: CanvasSnapshot): void {
  const projectId = snapshot.project.id
  db.projects = db.projects.filter((item) => item.id !== projectId)
  db.boards = db.boards.filter((item) => item.projectId !== projectId)
  db.nodes = db.nodes.filter((item) => item.projectId !== projectId)
  db.edges = db.edges.filter((item) => item.projectId !== projectId)
  db.assets = db.assets.filter((item) => item.projectId !== projectId)
  db.tasks = db.tasks.filter((item) => item.projectId !== projectId)
  db.projects.push(snapshot.project)
  if (snapshot.board) db.boards.push(snapshot.board)
  db.nodes.push(...snapshot.nodes)
  db.edges.push(...snapshot.edges)
  db.assets.push(...snapshot.assets)
  db.tasks.push(...snapshot.tasks)
}

function fullSnapshotFromDb(db: CanvasDb, projectId: string): CanvasSnapshot {
  const project = db.projects.find((item) => item.id === projectId)
  const board = db.boards.find((item) => item.projectId === projectId)
  if (!project || !board) throw new Error('Canvas project not found')
  return {
    project,
    board,
    nodes: sortCanvasNodes(db.nodes.filter((node) => node.projectId === projectId)),
    edges: db.edges.filter((edge) => edge.projectId === projectId),
    assets: db.assets.filter((asset) => asset.projectId === projectId),
    tasks: db.tasks.filter((task) => task.projectId === projectId),
  }
}

function snapshotFromDb(db: CanvasDb, projectId: string): CanvasSnapshot {
  const project = db.projects.find((item) => item.id === projectId)
  const board = db.boards.find((item) => item.projectId === projectId)
  if (!project || !board) throw new Error('Canvas project not found')
  return {
    project,
    board,
    nodes: sortCanvasNodes(db.nodes.filter((node) => node.projectId === projectId && !node.hidden)),
    edges: db.edges.filter((edge) => edge.projectId === projectId),
    assets: db.assets.filter((asset) => asset.projectId === projectId),
    tasks: db.tasks.filter((task) => task.projectId === projectId),
  }
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function sanitizeFileName(value: string): string {
  const cleaned = value.trim().replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, '-')
  return cleaned.length > 0 ? cleaned.slice(0, 80) : 'canvas-project'
}

async function mediaUrlToDataUrl(url: string): Promise<string | null> {
  if (url.startsWith('data:')) return url
  if (!url.startsWith('safe-file://')) return null
  try {
    const response = await fetch(url)
    if (!response.ok) return null
    const blob = await response.blob()
    return await new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onerror = () => reject(reader.error ?? new Error('Failed to read media'))
      reader.onload = () => resolve(String(reader.result ?? ''))
      reader.readAsDataURL(blob)
    })
  } catch {
    return null
  }
}

async function embedExportableImages(snapshot: CanvasSnapshot): Promise<CanvasSnapshot> {
  const next = cloneJson(snapshot)
  const cache = new Map<string, Promise<string | null>>()
  const embed = (url: string | null | undefined, mimeType?: string | null): Promise<string | null> => {
    if (!url) return Promise.resolve(null)
    if (mimeType && !mimeType.toLowerCase().startsWith('image/')) return Promise.resolve(null)
    if (!url.startsWith('safe-file://') && !url.startsWith('data:image/')) return Promise.resolve(null)
    const existing = cache.get(url)
    if (existing) return existing
    const promise = mediaUrlToDataUrl(url)
    cache.set(url, promise)
    return promise
  }

  for (const asset of next.assets) {
    if (asset.type !== 'image') continue
    const dataUrl = await embed(asset.url, asset.mimeType)
    if (dataUrl) asset.url = dataUrl
    const thumbnailDataUrl = await embed(asset.thumbnailUrl, asset.mimeType)
    if (thumbnailDataUrl) asset.thumbnailUrl = thumbnailDataUrl
  }

  for (const node of next.nodes) {
    if (node.type !== 'image') continue
    const dataUrl = await embed(node.data.url, node.data.mimeType)
    if (dataUrl) node.data.url = dataUrl
    const thumbnailDataUrl = await embed(node.data.thumbnailUrl, node.data.mimeType)
    if (thumbnailDataUrl) node.data.thumbnailUrl = thumbnailDataUrl
  }

  return next
}

function remapUnknownIds(value: unknown, idMap: Map<string, string>): unknown {
  if (typeof value === 'string') return idMap.get(value) ?? value
  if (Array.isArray(value)) return value.map((item) => remapUnknownIds(item, idMap))
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, child]) => [key, remapUnknownIds(child, idMap)]),
  )
}

function cloneImportedSnapshot(snapshot: CanvasSnapshot): CanvasSnapshot {
  const next = cloneJson(snapshot)
  const at = now()
  const idMap = new Map<string, string>()
  const mapId = (id: string, prefix: string): string => {
    const existing = idMap.get(id)
    if (existing) return existing
    const mapped = uid(prefix)
    idMap.set(id, mapped)
    return mapped
  }

  const projectId = mapId(next.project.id, 'canvas_project')
  const boardId = mapId(next.board.id, 'canvas_board')
  for (const asset of next.assets) mapId(asset.id, 'canvas_asset')
  for (const node of next.nodes) mapId(node.id, 'canvas_node')
  for (const task of next.tasks) mapId(task.id, 'canvas_task')
  for (const edge of next.edges) mapId(edge.id, 'canvas_edge')

  next.project = {
    ...next.project,
    id: projectId,
    userId: USER_ID,
    title: `${next.project.title || 'Canvas Project'}（导入）`,
    status: 'active',
    rootPath: null,
    lastOpenedAt: at,
    createdAt: at,
    updatedAt: at,
  }
  next.board = {
    ...next.board,
    id: boardId,
    projectId,
    userId: USER_ID,
    createdAt: at,
    updatedAt: at,
  }
  next.assets = next.assets.map((asset) => ({
    ...asset,
    id: mapId(asset.id, 'canvas_asset'),
    projectId,
    userId: USER_ID,
    metadata: remapUnknownIds(asset.metadata ?? {}, idMap) as Record<string, unknown>,
  }))
  next.nodes = next.nodes.map((node) => ({
    ...node,
    id: mapId(node.id, 'canvas_node'),
    projectId,
    boardId,
    userId: USER_ID,
    ...(node.assetId ? { assetId: mapId(node.assetId, 'canvas_asset') } : {}),
    ...(node.taskId ? { taskId: mapId(node.taskId, 'canvas_task') } : {}),
    ...(node.parentNodeId ? { parentNodeId: mapId(node.parentNodeId, 'canvas_node') } : {}),
  }))
  next.tasks = next.tasks.map((task) => ({
    ...task,
    id: mapId(task.id, 'canvas_task'),
    projectId,
    boardId,
    userId: USER_ID,
    inputNodeIds: task.inputNodeIds.map((id) => idMap.get(id) ?? id),
    inputAssetIds: task.inputAssetIds.map((id) => idMap.get(id) ?? id),
    outputNodeIds: task.outputNodeIds.map((id) => idMap.get(id) ?? id),
    outputAssetIds: task.outputAssetIds.map((id) => idMap.get(id) ?? id),
  }))
  next.edges = next.edges.map((edge) => ({
    ...edge,
    id: mapId(edge.id, 'canvas_edge'),
    projectId,
    boardId,
    userId: USER_ID,
    sourceNodeId: idMap.get(edge.sourceNodeId) ?? edge.sourceNodeId,
    targetNodeId: idMap.get(edge.targetNodeId) ?? edge.targetNodeId,
    ...(edge.taskId ? { taskId: idMap.get(edge.taskId) ?? edge.taskId } : {}),
    metadata: remapUnknownIds(edge.metadata ?? {}, idMap) as Record<string, unknown>,
  }))
  updateSnapshotCounts(next)
  return next
}

function updateSnapshotCounts(snapshot: CanvasSnapshot): void {
  snapshot.project.nodeCount = snapshot.nodes.filter((node) => !node.hidden).length
  snapshot.project.assetCount = snapshot.assets.length
  snapshot.project.taskCount = snapshot.tasks.length
  snapshot.project.updatedAt = now()
}

function parseCanvasProjectExport(raw: string): CanvasSnapshot {
  const parsed = JSON.parse(raw) as Partial<CanvasProjectExportPayload> | Partial<CanvasSnapshot>
  const maybePayload = parsed as Partial<CanvasProjectExportPayload>
  const snapshot = maybePayload.kind === 'spark.canvas.project' && maybePayload.snapshot
    ? maybePayload.snapshot
    : parsed as Partial<CanvasSnapshot>
  if (!snapshot.project || !snapshot.board || !Array.isArray(snapshot.nodes) || !Array.isArray(snapshot.edges) || !Array.isArray(snapshot.assets) || !Array.isArray(snapshot.tasks)) {
    throw new Error('无效的 Canvas 项目文件')
  }
  return snapshot as CanvasSnapshot
}

function isImageDataUrl(value: string | null | undefined): value is string {
  return typeof value === 'string' && /^data:image\/[^;,]+;base64,/i.test(value)
}

async function materializeImageDataUrl(
  dataUrl: string,
  suggestedBaseName: string,
  mimeType?: string | null,
  projectId?: string,
  projectRootPath?: string | null,
): Promise<{ filePath: string; fileUrl: string } | null> {
  try {
    const saved = projectId
      ? await window.spark.invoke('canvas:asset:write-data-url', {
          projectId,
          dataUrl,
          ...(mimeType ? { mimeType } : {}),
          suggestedBaseName,
          type: 'image',
          ...(projectRootPath ? { projectRootPath } : {}),
        })
      : await window.spark.invoke('file:save-pasted-image', {
          dataUrl,
          ...(mimeType ? { mimeType } : {}),
          suggestedBaseName,
          storageScope: 'canvas',
        })
    return { filePath: saved.filePath, fileUrl: encodeToSafeFileUrl(saved.filePath) }
  } catch {
    return null
  }
}

async function normalizeSnapshotForHotStorage(snapshot: CanvasSnapshot): Promise<{ snapshot: CanvasSnapshot; changed: boolean }> {
  const cache = new Map<string, Promise<{ filePath: string; fileUrl: string } | null>>()
  let changed = false
  const materialize = (dataUrl: string, name: string, mimeType?: string | null) => {
    const existing = cache.get(dataUrl)
    if (existing) return existing
    const next = materializeImageDataUrl(dataUrl, name, mimeType, snapshot.project.id, snapshot.project.rootPath)
    cache.set(dataUrl, next)
    return next
  }

  for (const asset of snapshot.assets) {
    const baseName = (asset.title ?? asset.id).replace(/\.[^.]+$/, '')
    if (isImageDataUrl(asset.url)) {
      const saved = await materialize(asset.url, baseName, asset.mimeType)
      if (saved) {
        asset.url = saved.fileUrl
        asset.storageKey = saved.filePath
        asset.metadata = { ...asset.metadata, storageAdapter: 'local-file', filePath: saved.filePath }
        changed = true
      }
    }
    if (isImageDataUrl(asset.thumbnailUrl)) {
      const saved = await materialize(asset.thumbnailUrl, `${baseName}-thumb`, asset.mimeType)
      if (saved) {
        asset.thumbnailUrl = saved.fileUrl
        asset.thumbnailKey = saved.filePath
        changed = true
      }
    }
  }

  for (const node of snapshot.nodes) {
    const baseName = node.title ?? node.id
    if (isImageDataUrl(node.data.url)) {
      const saved = await materialize(node.data.url, baseName, node.data.mimeType)
      if (saved) {
        node.data.url = saved.fileUrl
        changed = true
      }
    }
    if (isImageDataUrl(node.data.thumbnailUrl)) {
      const saved = await materialize(node.data.thumbnailUrl, `${baseName}-thumb`, node.data.mimeType)
      if (saved) {
        node.data.thumbnailUrl = saved.fileUrl
        changed = true
      }
    }
  }

  return { snapshot, changed }
}

async function loadSnapshotFromStorage(projectId: string): Promise<{ snapshot: CanvasSnapshot; changed: boolean } | null> {
  const { snapshotJson } = await window.spark.invoke('canvas:snapshot:load', { projectId })
  if (!snapshotJson) return null
  const snapshot = JSON.parse(snapshotJson) as Partial<CanvasSnapshot>
  if (!snapshot.project || !snapshot.board) return null
  if (!snapshot.project.rootPath) {
    snapshot.project.rootPath = await ensureCanvasProjectDirectory({
      projectId,
      title: snapshot.project.title,
    })
  }
  return normalizeSnapshotForHotStorage({
    project: snapshot.project,
    board: snapshot.board,
    nodes: snapshot.nodes ?? [],
    edges: snapshot.edges ?? [],
    assets: snapshot.assets ?? [],
    tasks: snapshot.tasks ?? [],
  })
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

function readDisplayImageDimensions(src: string): Promise<{ width: number; height: number } | null> {
  if (typeof Image === 'undefined') return Promise.resolve(null)
  return new Promise((resolve) => {
    const image = new Image()
    image.onload = () => {
      const width = image.naturalWidth || image.width || 0
      const height = image.naturalHeight || image.height || 0
      resolve(width > 0 && height > 0 ? { width, height } : null)
    }
    image.onerror = () => resolve(null)
    image.src = src
  })
}

// ─── 画布 AI 调用彩色日志（DevTools %c CSS） ───────────────────────────────
// 在 createMediaTask 发 IPC 前，把组装好的参数按产物类型分色打印成一块，
// 方便排查「prompt/model/inputFiles/modelParams 没拼对」。
// 颜色与主进程 adapter 的 ANSI 配色保持一致：image=品红 / audio=青 / video=黄 / text=绿。
type MediaCallKind = 'image' | 'audio' | 'video' | 'text' | 'other'

const MEDIA_CALL_STYLES: Record<MediaCallKind, { emoji: string; color: string }> = {
  image: { emoji: '🎨', color: '#a855f7' },
  audio: { emoji: '🔊', color: '#0891b2' },
  video: { emoji: '🎬', color: '#ca8a04' },
  text: { emoji: '📝', color: '#16a34a' },
  other: { emoji: '⚡', color: '#6b7280' },
}

function mediaCallKind(operation: CanvasOperationType): MediaCallKind {
  if (operation.includes('video')) return 'video'
  if (operation.includes('image')) return 'image'
  if (operation.includes('audio')) return 'audio'
  return 'text'
}

const LOG_PREVIEW_MAX = 80

function previewText(value: string | null | undefined): string {
  const text = (value ?? '').replace(/\s+/g, ' ').trim()
  if (text.length <= LOG_PREVIEW_MAX) return text || '(空)'
  return `${text.slice(0, LOG_PREVIEW_MAX)}…`
}

/** 截断 dataUrl 等 base64 内容，避免日志被一张图刷屏 */
function previewInputFiles(
  files: CanvasMediaTaskInputFile[] | undefined,
): { summary: string; types: string[] } {
  if (!files || files.length === 0) return { summary: '无', types: [] }
  const types = files.map((file) => file.type)
  const detail = files
    .map((file) => {
      const ref = file.url ?? file.dataUrl ?? file.path ?? '(空)'
      // dataUrl/base64 只保留前 50 字符
      const shown = ref.startsWith('data:') || ref.length > 60 ? `${ref.slice(0, 50)}…<len=${ref.length}>` : ref
      return `${file.type}:${shown}`
    })
    .join(', ')
  return { summary: `${files.length} 个：${detail}`, types }
}

function logCanvasMediaCall(
  operation: CanvasOperationType,
  request: {
    prompt?: string | null
    providerProfileId?: string | null
    manifestId?: string | null
    modelId?: string | null
    modelParams?: Record<string, unknown> | null
    inputFiles?: CanvasMediaTaskInputFile[]
  },
): void {
  if (typeof console === 'undefined' || typeof console.log !== 'function') return
  const kind = mediaCallKind(operation)
  const style = MEDIA_CALL_STYLES[kind]
  const dim = 'color:#9ca3af;font-weight:normal'
  const val = `color:${style.color};font-weight:600`
  const header = `color:#fff;background:${style.color};font-weight:bold;padding:2px 8px;border-radius:3px`

  const { summary: inputsSummary, types: inputTypes } = previewInputFiles(request.inputFiles)
  const params = request.modelParams && Object.keys(request.modelParams).length > 0
    ? JSON.stringify(request.modelParams)
    : '(默认)'

  const segments: Array<[string, string]> = [
    [`${style.emoji} ${operationLabel(operation)}`, header],
    [` → canvas:task:create-media\n`, dim],
    [`  prompt:   `, dim],
    [`${previewText(request.prompt)}\n`, val],
    [`  provider: `, dim],
    [`${request.providerProfileId || '(自动选择)'}\n`, val],
    [`  model:    `, dim],
    [`${request.modelId || '(默认)'}${request.manifestId ? `  · manifest=${request.manifestId}` : ''}\n`, val],
    [`  inputs:   `, dim],
    [`${inputsSummary}${inputTypes.length > 0 ? `  [${inputTypes.join(', ')}]` : ''}\n`, val],
    [`  params:   `, dim],
    [params, val],
  ]
  const format = segments.map(([text]) => `%c${text}`).join('')
  console.log(format, ...segments.map(([, css]) => css))
}

export const canvasApi = {
  async listProjects(): Promise<CanvasProject[]> {
    try {
      const { projects } = await window.spark.invoke('canvas:project:list', {})
      return projects
        .filter((project) => project.status !== 'deleted')
        .map(toCanvasProject)
    } catch {
      const db = readDb()
      return db.projects.filter((project) => project.status !== 'deleted')
    }
  },

  async getDefaultProjectsRoot(): Promise<string> {
    return getDefaultCanvasProjectsRoot()
  },

  async createProject(input: { title: string; description?: string; parentDirectory?: string }): Promise<CanvasSnapshot> {
    const db = readDb()
    const at = now()
    const projectId = uid('canvas_project')
    const boardId = uid('canvas_board')
    const rootPath = await ensureCanvasProjectDirectory({
      projectId,
      title: input.title,
      ...(input.parentDirectory ? { parentDirectory: input.parentDirectory } : {}),
    })
    const project: CanvasProject = {
      id: projectId,
      userId: USER_ID,
      title: input.title,
      description: input.description ?? null,
      status: 'active',
      rootPath,
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
    // 项目创建是关键操作：立即落库，确保关闭应用后 SQLite 里一定有这条记录。
    await flushPersist()
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
    // 覆盖 rename / archive / delete(soft)：状态变更立即落库，避免删了的项目重启后又冒回来。
    await flushPersist()
    return project
  },

  async exportProjectToFile(projectId: string): Promise<{ exported: boolean; filePath?: string }> {
    const db = readDb()
    let snapshot: CanvasSnapshot | null = null
    try {
      snapshot = fullSnapshotFromDb(db, projectId)
    } catch {
      try {
        const { snapshotJson } = await window.spark.invoke('canvas:snapshot:load', { projectId })
        if (snapshotJson) snapshot = parseCanvasProjectExport(snapshotJson)
      } catch {
        snapshot = null
      }
    }
    if (!snapshot) throw new Error('Canvas project not found')

    const portableSnapshot = await embedExportableImages(snapshot)
    const payload: CanvasProjectExportPayload = {
      kind: 'spark.canvas.project',
      version: 2,
      exportedAt: now(),
      app: 'Spark-Agent',
      ...(snapshot.project.rootPath ? { projectRootPath: snapshot.project.rootPath } : {}),
      snapshot: portableSnapshot,
    }
    const result = await window.spark.invoke('dialog:save-file', {
      title: '导出 Canvas 项目',
      defaultPath: `${sanitizeFileName(snapshot.project.title)}.spark-canvas.json`,
      filters: [
        { name: 'Spark Canvas Project', extensions: ['json'] },
      ],
    })
    if (result.canceled || !result.filePath) return { exported: false }
    await window.spark.invoke('file:write-text', {
      path: result.filePath,
      content: JSON.stringify(payload, null, 2),
    })
    return { exported: true, filePath: result.filePath }
  },

  async exportProjectPackage(projectId: string): Promise<{ exported: boolean; directoryPath?: string }> {
    const db = readDb()
    let snapshot: CanvasSnapshot | null = null
    try {
      snapshot = fullSnapshotFromDb(db, projectId)
    } catch {
      try {
        const { snapshotJson } = await window.spark.invoke('canvas:snapshot:load', { projectId })
        if (snapshotJson) snapshot = parseCanvasProjectExport(snapshotJson)
      } catch {
        snapshot = null
      }
    }
    if (!snapshot) throw new Error('Canvas project not found')
    const result = await window.spark.invoke('dialog:open-directory', {
      title: '选择 Canvas 项目包导出位置',
      ...(snapshot.project.rootPath ? { defaultPath: snapshot.project.rootPath } : {}),
    })
    if (result.canceled || !result.filePath) return { exported: false }
    const response = await window.spark.invoke('canvas:project:export-package', {
      projectId,
      title: snapshot.project.title,
      projectRootPath: snapshot.project.rootPath ?? null,
      snapshotJson: JSON.stringify(snapshot),
      targetParentDirectory: result.filePath,
    })
    return response
  },

  async openProjectFolder(projectId: string): Promise<{ opened: boolean; rootPath?: string; error?: string }> {
    const db = readDb()
    let project = db.projects.find((item) => item.id === projectId)
    if (!project) {
      const { snapshotJson } = await window.spark.invoke('canvas:snapshot:load', { projectId })
      if (snapshotJson) {
        const snapshot = parseCanvasProjectExport(snapshotJson)
        replaceProjectSnapshot(db, snapshot)
        project = snapshot.project
      }
    }
    if (!project) throw new Error('Canvas project not found')
    if (!project.rootPath) {
      project.rootPath = await ensureCanvasProjectDirectory({
        projectId,
        title: project.title,
      })
      writeDb(db)
      await flushPersist()
    }
    const result = await window.spark.invoke('tool:open-folder', { rootPath: project.rootPath })
    return {
      opened: result.opened,
      rootPath: project.rootPath,
      ...(result.error !== undefined ? { error: result.error } : {}),
    }
  },

  async importProjectFromFile(parentDirectory?: string): Promise<CanvasSnapshot | null> {
    const result = await window.spark.invoke('dialog:open-file', {
      title: '导入 Canvas 项目',
      filters: [
        { name: 'Spark Canvas Project', extensions: ['json'] },
      ],
    })
    if (result.canceled || !result.filePath) return null
    const { content } = await window.spark.invoke('file:read-text', { path: result.filePath })
    const parsedSnapshot = parseCanvasProjectExport(content)
    const clonedSnapshot = cloneImportedSnapshot(parsedSnapshot)
    clonedSnapshot.project.rootPath = await ensureCanvasProjectDirectory({
      projectId: clonedSnapshot.project.id,
      title: clonedSnapshot.project.title,
      ...(parentDirectory ? { parentDirectory } : {}),
    })
    try {
      const migrated = await window.spark.invoke('canvas:project:migrate-assets', {
        projectId: clonedSnapshot.project.id,
        projectRootPath: clonedSnapshot.project.rootPath,
        snapshotJson: JSON.stringify(clonedSnapshot),
      })
      clonedSnapshot.project = (JSON.parse(migrated.snapshotJson) as CanvasSnapshot).project
      Object.assign(clonedSnapshot, JSON.parse(migrated.snapshotJson) as CanvasSnapshot)
    } catch {
      // Import remains compatible with pure JSON projects even if local asset copy is unavailable.
    }
    const normalized = await normalizeSnapshotForHotStorage(clonedSnapshot)
    const db = readDb()
    replaceProjectSnapshot(db, normalized.snapshot)
    writeDb(db)
    await flushPersist()
    return normalized.snapshot
  },

  async migrateProjectAssetsToDirectory(projectId: string): Promise<{ movedAssets: number; skippedAssets: number }> {
    const db = readDb()
    const snapshot = fullSnapshotFromDb(db, projectId)
    if (!snapshot.project.rootPath) {
      snapshot.project.rootPath = await ensureCanvasProjectDirectory({
        projectId,
        title: snapshot.project.title,
      })
    }
    const result = await window.spark.invoke('canvas:project:migrate-assets', {
      projectId,
      projectRootPath: snapshot.project.rootPath,
      snapshotJson: JSON.stringify(snapshot),
    })
    const migrated = JSON.parse(result.snapshotJson) as CanvasSnapshot
    replaceProjectSnapshot(db, migrated)
    writeDb(db)
    await flushPersist()
    return { movedAssets: result.movedAssets, skippedAssets: result.skippedAssets }
  },

  async cleanupLegacyCanvasAssets(): Promise<{ deletedFiles: number; deletedBytes: number; scannedFiles: number }> {
    const result = await window.spark.invoke('canvas:project:cleanup-orphans', {})
    return {
      deletedFiles: result.deletedFiles,
      deletedBytes: result.deletedBytes,
      scannedFiles: result.scannedFiles,
    }
  },

  async deleteProject(projectId: string): Promise<void> {
    await window.spark.invoke('canvas:project:delete', { projectId })
    const db = readDb()
    const project = db.projects.find((item) => item.id === projectId)
    if (project) {
      Object.assign(project, { status: 'deleted' as const, updatedAt: now() })
      writeHotDb(db, false)
    }
  },

  async openSnapshot(projectId: string): Promise<CanvasSnapshot> {
    if (!canvasDirty) {
      try {
        const snapshot = await loadSnapshotFromStorage(projectId)
        if (snapshot) {
          snapshot.snapshot.project.lastOpenedAt = now()
          const db = emptyDb()
          replaceProjectSnapshot(db, snapshot.snapshot)
          writeHotDb(db, false)
          return snapshotFromDb(db, projectId)
        }
      } catch {
        // SQLite 不可用时回退到 localStorage 热存储。
      }
    }

    const db = readDb()
    const project = db.projects.find((item) => item.id === projectId)
    if (!project) throw new Error('Canvas project not found')
    if (!project.rootPath) {
      project.rootPath = await ensureCanvasProjectDirectory({
        projectId,
        title: project.title,
      })
    }
    project.lastOpenedAt = now()
    writeDb(db)
    return snapshotFromDb(db, projectId)
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
    filePath: string
    x: number
    y: number
    width?: number
    height?: number
    imageWidth?: number
    imageHeight?: number
  }): Promise<CanvasNode> {
    const db = readDb()
    const fileUrl = encodeToSafeFileUrl(input.filePath)
    const asset: CanvasAsset = {
      id: uid('canvas_asset'),
      projectId: input.projectId,
      userId: USER_ID,
      type: 'image',
      source: 'upload',
      title: input.file.name,
      mimeType: input.file.type,
      storageKey: input.filePath,
      url: fileUrl,
      thumbnailUrl: fileUrl,
      width: input.imageWidth ?? null,
      height: input.imageHeight ?? null,
      sizeBytes: input.file.size,
      metadata: { storageAdapter: 'local-file', filePath: input.filePath },
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
      data: { url: fileUrl, thumbnailUrl: fileUrl, mimeType: input.file.type },
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

  async cancelTask(projectId: string, taskId: string): Promise<CanvasSnapshot> {
    const db = readDb()
    const task = db.tasks.find((item) => item.id === taskId && item.projectId === projectId)
    const taskNode = db.nodes.find((item) => item.taskId === taskId && item.projectId === projectId)
    if (!task) return this.openSnapshot(projectId)
    if (task.status === 'completed' || task.status === 'failed' || task.status === 'cancelled') {
      return this.openSnapshot(projectId)
    }

    if (task.requestId) {
      try {
        const runtimeCancel = await window.spark.invoke('canvas:task:cancel-media', {
          runtimeTaskId: task.requestId,
        })
        if (runtimeCancel.status === 'succeeded' || runtimeCancel.status === 'failed') {
          return this.openSnapshot(projectId)
        }
      } catch {
        // Renderer-local cancellation still updates the canvas; runtime may already be gone after restart.
      }
    }

    const at = now()
    task.status = 'cancelled'
    task.progress = 100
    task.errorMsg = 'cancelled_by_user'
    task.errorDetail = '任务已由用户在画布任务队列中取消。'
    task.updatedAt = at
    task.completedAt = at
    if (taskNode) {
      taskNode.data = {
        ...taskNode.data,
        status: 'cancelled',
        progress: 100,
        message: '任务已取消',
      }
      taskNode.updatedAt = at
    }

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
    if (!project.rootPath) {
      project.rootPath = await ensureCanvasProjectDirectory({
        projectId,
        title: project.title,
      })
    }
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
      outputDir: `${project.rootPath}/assets`,
      waitForCompletion: false,
    }
    // 调 IPC 前打印彩色参数块，便于排查「prompt/model/inputs/params 没拼对」。
    logCanvasMediaCall(request.operation, request)
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
    if (task.status === 'cancelled') return this.openSnapshot(projectId)
    task.status = 'running'
    task.progress = Math.max(task.progress, 35)
    task.requestId = response.runtimeTaskId ?? response.requestId ?? null
    task.providerProfileId = response.providerProfileId || task.providerProfileId || null
    task.provider = response.provider || task.provider || null
    task.modelId = response.model || task.modelId || null
    task.requestCall = response.requestCall ?? task.requestCall ?? null
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
    if (task.status === 'cancelled') return this.openSnapshot(projectId)

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
    task.requestCall = response.requestCall ?? null

    const at = now()
    for (const [index, assetOut] of response.assets.entries()) {
      const assetType = (assetOut.type || 'file') as CanvasAssetType
      // 优先用 base64 预览（小图快），否则把磁盘路径编码成 safe-file:// 供 <audio>/<video>/<img> 加载
      const displayUrl = resolveMediaDisplayUrl({
        url: assetOut.url,
        dataUrl: assetOut.previewDataUrl,
        filePath: assetOut.filePath,
      })
      const detectedImageSize =
        assetType === 'image' && displayUrl && (assetOut.width == null || assetOut.height == null)
          ? await readDisplayImageDimensions(displayUrl)
          : null
      const assetWidth = assetOut.width ?? detectedImageSize?.width ?? null
      const assetHeight = assetOut.height ?? detectedImageSize?.height ?? null
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
        ...(assetWidth != null ? { width: assetWidth } : {}),
        ...(assetHeight != null ? { height: assetHeight } : {}),
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
      const resultNodeSize = fitMediaNodeSize(assetType, assetWidth, assetHeight)
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
    }

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
   * SQLite 是重启后的权威来源；如果当前会话已有未保存修改，则保留 localStorage 热存储。
   * 否则用 SQLite 快照重建 localStorage，避免旧缓存里的项目 ID 和列表不一致。
   */
  async hydrateFromStorage(): Promise<{ restored: number }> {
    if (canvasDirty) return { restored: 0 }
    const db = emptyDb()
    let restored = 0
    let migrated = false
    try {
      const { projects } = await window.spark.invoke('canvas:project:list', {})
      for (const project of projects) {
        if (project.status === 'deleted') continue
        try {
          const snapshot = await loadSnapshotFromStorage(project.id)
          if (!snapshot) continue
          replaceProjectSnapshot(db, snapshot.snapshot)
          migrated = migrated || snapshot.changed
          restored += 1
        } catch {
          // 单个项目解析失败跳过
        }
      }
      writeHotDb(db, false)
      if (migrated) {
        await persistAllProjects(db)
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

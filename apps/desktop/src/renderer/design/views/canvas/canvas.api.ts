import type {
  CanvasAsset,
  CanvasAssetType,
  CanvasBoard,
  CanvasEdge,
  CanvasNode,
  CanvasNodeType,
  CanvasOperationType,
  CanvasProject,
  CanvasProjectSettings,
  CanvasSnapshot,
  CanvasTask,
  CreateCanvasTaskRequest,
} from './canvas.types'
import { getCanvasCapability } from './canvas.capabilities'
import { encodeToSafeFileUrl, resolveMediaDisplayUrl } from './canvas-safe-file'
import {
  filmKindToAssetType,
  filmUid,
  migrateFilmAssetMetadata,
  readReferences,
  readTags,
  writeReferences,
  writeTags,
  type CreateFilmAssetInput,
  type FilmAssetKind,
  type ShotGroup,
  type ShotSegment,
  type FilmProjectData,
} from './canvasFilmAssets'
import type { FilmReference } from './canvasFilmTypes'
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
    const boards = readProjectBoards(db, project.id)
    // 序列化激活板优先用用户上次选择（project.metadata.activeBoardId），
    // 否则回退到 isDefault / 第一个 board
    const storedActiveBoardId = project.metadata?.activeBoardId
    const preferredBoardId =
      typeof storedActiveBoardId === 'string' ? storedActiveBoardId : undefined
    const resolved = resolveActiveBoard(boards, preferredBoardId)
    // 项目无 board（数据异常）时跳过，避免写空快照覆盖既有数据
    if (!resolved) {
      console.warn('[canvas] persist skipped: no board for project', project.id)
      continue
    }
    // 序列化时写 boards[] + 激活 board（向下兼容旧字段 board）
    const snapshot: CanvasSnapshot = {
      project,
      board: resolved.active,
      boards: resolved.boards,
      activeBoardId: resolved.active.id,
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
      // 兼容多 board：优先用 boards[]；旧快照只有单 board
      if (Array.isArray(snap.boards) && snap.boards.length > 0) {
        db.boards.push(...snap.boards)
      } else if (snap.board) {
        db.boards.push(snap.board)
      }
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

export type CanvasDb = {
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
    settings: {},
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
    const parsed = { ...emptyDb(), ...JSON.parse(raw) } as CanvasDb
    migrateFilmAssetDbInPlace(parsed)
    return parsed
  } catch {
    return emptyDb()
  }
}

/** 一次性迁移：老 imageAssetId/attributes 资产 -> references 数组（v2 资源库模型）。
 *  用模块级 flag 保证只跑一次，迁移完成后写回 localStorage。 */
let filmAssetV2MigrationApplied = false
function migrateFilmAssetDbInPlace(db: CanvasDb): void {
  if (filmAssetV2MigrationApplied) return
  // 检查是否存在未迁移的资产
  let touched = false
  for (const asset of db.assets) {
    const meta = asset.metadata
    if (!meta) continue
    if (Array.isArray(meta['references']) && Array.isArray(meta['tags'])) continue
    asset.metadata = migrateFilmAssetMetadata(meta)
    touched = true
  }
  // 兼容空库（无项目也无资产）也直接标记完成
  filmAssetV2MigrationApplied = true
  if (touched) {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(db))
    } catch {
      // localStorage 写入失败也不影响后续读路径
    }
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
  // 多 board：优先写入 boards[]；向下兼容只写单 board 的旧快照
  if (Array.isArray(snapshot.boards) && snapshot.boards.length > 0) {
    db.boards.push(...snapshot.boards)
  } else if (snapshot.board) {
    db.boards.push(snapshot.board)
  }
  db.nodes.push(...snapshot.nodes)
  db.edges.push(...snapshot.edges)
  db.assets.push(...snapshot.assets)
  db.tasks.push(...snapshot.tasks)
}

/** 读取项目内全部 board；旧快照（仅 db.boards 或单 board）归一化为数组 */
export function readProjectBoards(db: CanvasDb, projectId: string): CanvasBoard[] {
  return db.boards.filter((board) => board.projectId === projectId)
}

/**
 * 选择激活 board：优先用传入 boardId，其次 snapshot.activeBoardId，
 * 否则取标记 isDefault 的 board，最后取第一个。返回归一化的 boards 数组与激活 board。
 */
export function resolveActiveBoard(
  boards: CanvasBoard[],
  preferredBoardId?: string | null,
): { boards: CanvasBoard[]; active: CanvasBoard } | null {
  if (boards.length === 0) return null
  const pick =
    (preferredBoardId && boards.find((board) => board.id === preferredBoardId)) ||
    boards.find((board) => board.settings?.isDefault) ||
    boards[0]!
  return { boards, active: pick }
}

function fullSnapshotFromDb(
  db: CanvasDb,
  projectId: string,
  activeBoardId?: string | null,
): CanvasSnapshot {
  const project = db.projects.find((item) => item.id === projectId)
  if (!project) throw new Error('Canvas project not found')
  const boards = readProjectBoards(db, projectId)
  const resolved = resolveActiveBoard(boards, activeBoardId)
  if (!resolved) throw new Error('Canvas board not found')
  return {
    project,
    board: resolved.active,
    boards: resolved.boards,
    activeBoardId: resolved.active.id,
    nodes: sortCanvasNodes(db.nodes.filter((node) => node.projectId === projectId)),
    edges: db.edges.filter((edge) => edge.projectId === projectId),
    assets: db.assets.filter((asset) => asset.projectId === projectId),
    tasks: db.tasks.filter((task) => task.projectId === projectId),
  }
}

/**
 * 工作区展示用快照：按激活 board 过滤 nodes/edges/tasks（文档 §7.1：切换 board
 * 时不要把其他 board 的节点全部渲染进 Stage）。assets 保持项目级（无 boardId）。
 * assets/tasks 不过滤——assets 项目级共享；tasks 仍展示全项目任务以便任务队列复用。
 */
export function snapshotFromDb(
  db: CanvasDb,
  projectId: string,
  activeBoardId?: string | null,
): CanvasSnapshot {
  const project = db.projects.find((item) => item.id === projectId)
  if (!project) throw new Error('Canvas project not found')
  const boards = readProjectBoards(db, projectId)
  const resolved = resolveActiveBoard(boards, activeBoardId)
  if (!resolved) throw new Error('Canvas board not found')
  const boardId = resolved.active.id
  // 按激活 board 过滤节点/边（文档 §7.1：切换 board 不渲染其他 board 的节点）
  let nodes = db.nodes.filter(
    (node) => node.projectId === projectId && node.boardId === boardId && !node.hidden,
  )
  let edges = db.edges.filter(
    (edge) => edge.projectId === projectId && edge.boardId === boardId,
  )
  // 防御性兜底：若按 boardId 过滤后无节点，但项目实际存在非隐藏节点，
  // 说明节点 boardId 与当前 board 不匹配（旧数据 / 迁移残留），回退显示全部，
  // 避免画布「节点全部消失」。这种情况通常出现在旧项目首次进入多 board 视图时。
  if (nodes.length === 0) {
    const allProjectNodes = db.nodes.filter(
      (node) => node.projectId === projectId && !node.hidden,
    )
    if (allProjectNodes.length > 0) {
      nodes = allProjectNodes
      edges = db.edges.filter((edge) => edge.projectId === projectId)
    }
  }
  return {
    project,
    board: resolved.active,
    boards: resolved.boards,
    activeBoardId: boardId,
    nodes: sortCanvasNodes(nodes),
    edges,
    assets: db.assets.filter((asset) => asset.projectId === projectId),
    tasks: db.tasks.filter((task) => task.projectId === projectId),
  }
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function sanitizeFileName(value: string): string {
  const cleaned = value
    .trim()
    .replace(/[\\/:*?"<>|]+/g, '-')
    .replace(/\s+/g, '-')
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
  const embed = (
    url: string | null | undefined,
    mimeType?: string | null,
  ): Promise<string | null> => {
    if (!url) return Promise.resolve(null)
    if (mimeType && !mimeType.toLowerCase().startsWith('image/')) return Promise.resolve(null)
    if (!url.startsWith('safe-file://') && !url.startsWith('data:image/'))
      return Promise.resolve(null)
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
    Object.entries(value as Record<string, unknown>).map(([key, child]) => [
      key,
      remapUnknownIds(child, idMap),
    ]),
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
  // 多 board：把 boards[] 的每个 id 都登记到 idMap，旧快照只有单 board 时用 next.board
  const sourceBoards = Array.isArray(next.boards) && next.boards.length > 0 ? next.boards : [next.board]
  const oldActiveBoardId = next.activeBoardId ?? next.board.id
  for (const board of sourceBoards) mapId(board.id, 'canvas_board')
  const newActiveBoardId = idMap.get(oldActiveBoardId) ?? idMap.get(next.board.id)!
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
  // 重映射全部 board，并同步 activeBoardId / board（激活板）
  next.boards = sourceBoards.map((board) => ({
    ...board,
    id: mapId(board.id, 'canvas_board'),
    projectId,
    userId: USER_ID,
    createdAt: at,
    updatedAt: at,
  }))
  next.activeBoardId = newActiveBoardId
  next.board =
    next.boards.find((board) => board.id === newActiveBoardId) ?? next.boards[0]!
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
    // 保留节点原有 board 归属（映射到新 board id）；旧单 board 快照落到激活板
    boardId: idMap.get(node.boardId) ?? newActiveBoardId,
    userId: USER_ID,
    ...(node.assetId ? { assetId: mapId(node.assetId, 'canvas_asset') } : {}),
    ...(node.taskId ? { taskId: mapId(node.taskId, 'canvas_task') } : {}),
    ...(node.parentNodeId ? { parentNodeId: mapId(node.parentNodeId, 'canvas_node') } : {}),
  }))
  next.tasks = next.tasks.map((task) => ({
    ...task,
    id: mapId(task.id, 'canvas_task'),
    projectId,
    // 保留 task 所属 board 映射；旧单 board 快照落到激活板
    boardId: idMap.get(task.boardId) ?? newActiveBoardId,
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
    boardId: idMap.get(edge.boardId) ?? newActiveBoardId,
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
  const snapshot =
    maybePayload.kind === 'spark.canvas.project' && maybePayload.snapshot
      ? maybePayload.snapshot
      : (parsed as Partial<CanvasSnapshot>)
  // 兼容校验：多 board 快照可能只有 boards[] 而无单 board 字段
  const hasBoards = Array.isArray(snapshot.boards) && snapshot.boards.length > 0
  if (
    !snapshot.project ||
    !(snapshot.board || hasBoards) ||
    !Array.isArray(snapshot.nodes) ||
    !Array.isArray(snapshot.edges) ||
    !Array.isArray(snapshot.assets) ||
    !Array.isArray(snapshot.tasks)
  ) {
    throw new Error('无效的 Canvas 项目文件')
  }
  // 归一化：缺 board 时从 boards[] 推导激活板，保证下游统一能读 snapshot.board
  const normalized = snapshot as CanvasSnapshot
  if (!normalized.board && hasBoards) {
    const activeId = normalized.activeBoardId
    normalized.board =
      (activeId && normalized.boards!.find((b) => b.id === activeId)) ||
      normalized.boards!.find((b) => b.settings?.isDefault) ||
      normalized.boards![0]!
    normalized.activeBoardId = normalized.board.id
  }
  return normalized
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

async function normalizeSnapshotForHotStorage(
  snapshot: CanvasSnapshot,
): Promise<{ snapshot: CanvasSnapshot; changed: boolean }> {
  const cache = new Map<string, Promise<{ filePath: string; fileUrl: string } | null>>()
  let changed = false
  const materialize = (dataUrl: string, name: string, mimeType?: string | null) => {
    const existing = cache.get(dataUrl)
    if (existing) return existing
    const next = materializeImageDataUrl(
      dataUrl,
      name,
      mimeType,
      snapshot.project.id,
      snapshot.project.rootPath,
    )
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
        asset.metadata = {
          ...asset.metadata,
          storageAdapter: 'local-file',
          filePath: saved.filePath,
        }
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
      const saved = await materialize(
        node.data.thumbnailUrl,
        `${baseName}-thumb`,
        node.data.mimeType,
      )
      if (saved) {
        node.data.thumbnailUrl = saved.fileUrl
        changed = true
      }
    }
  }

  return { snapshot, changed }
}

async function loadSnapshotFromStorage(
  projectId: string,
): Promise<{ snapshot: CanvasSnapshot; changed: boolean } | null> {
  const { snapshotJson } = await window.spark.invoke('canvas:snapshot:load', { projectId })
  if (!snapshotJson) return null
  const snapshot = JSON.parse(snapshotJson) as Partial<CanvasSnapshot>
  // 兼容多 board：缺 board 时从 boards[] 推导；都没有则视为无效快照
  const hasBoards = Array.isArray(snapshot.boards) && snapshot.boards.length > 0
  if (!snapshot.project || !(snapshot.board || hasBoards)) return null
  if (!snapshot.board && hasBoards) {
    const activeId = snapshot.activeBoardId
    snapshot.board =
      (activeId && snapshot.boards!.find((b) => b.id === activeId)) ||
      snapshot.boards!.find((b) => b.settings?.isDefault) ||
      snapshot.boards![0]!
    snapshot.activeBoardId = snapshot.board.id
  }
  if (!snapshot.project.rootPath) {
    snapshot.project.rootPath = await ensureCanvasProjectDirectory({
      projectId,
      title: snapshot.project.title,
    })
  }
  return normalizeSnapshotForHotStorage({
    project: snapshot.project,
    board: snapshot.board!,
    ...(hasBoards ? { boards: snapshot.boards } : {}),
    ...(snapshot.activeBoardId ? { activeBoardId: snapshot.activeBoardId } : {}),
    ...(snapshot.uiState ? { uiState: snapshot.uiState } : {}),
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

function applyGroupLayout(groupNode: CanvasNode, members: GroupMemberLayout[], at: string): void {
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
      let nodeWidth = Math.min(
        Math.max(width, type === 'video' ? 320 : 260),
        type === 'video' ? 520 : 420,
      )
      let bodyHeight = Math.round(nodeWidth * aspect)
      const maxBodyHeight = type === 'video' ? 420 : 680
      if (bodyHeight > maxBodyHeight) {
        bodyHeight = maxBodyHeight
        nodeWidth = Math.max(type === 'video' ? 300 : 220, Math.round(bodyHeight / aspect))
      }
      return {
        width: Math.round(nodeWidth),
        height: Math.max(type === 'video' ? 220 : 220, bodyHeight + headerHeight),
      }
    }
    return type === 'video' ? { width: 360, height: 240 } : { width: 320, height: 260 }
  }
  if (type === 'audio') return { width: 320, height: 164 }
  return { width: 300, height: 164 }
}

function readDisplayImageDimensions(
  src: string,
): Promise<{ width: number; height: number } | null> {
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
function previewInputFiles(files: CanvasMediaTaskInputFile[] | undefined): {
  summary: string
  types: string[]
} {
  if (!files || files.length === 0) return { summary: '无', types: [] }
  const types = files.map((file) => file.type)
  const detail = files
    .map((file) => {
      const ref = file.url ?? file.dataUrl ?? file.path ?? '(空)'
      // dataUrl/base64 只保留前 50 字符
      const shown =
        ref.startsWith('data:') || ref.length > 60 ? `${ref.slice(0, 50)}…<len=${ref.length}>` : ref
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
  const params =
    request.modelParams && Object.keys(request.modelParams).length > 0
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
    [
      `${request.modelId || '(默认)'}${request.manifestId ? `  · manifest=${request.manifestId}` : ''}\n`,
      val,
    ],
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
      return projects.filter((project) => project.status !== 'deleted').map(toCanvasProject)
    } catch {
      const db = readDb()
      return db.projects.filter((project) => project.status !== 'deleted')
    }
  },

  async getDefaultProjectsRoot(): Promise<string> {
    return getDefaultCanvasProjectsRoot()
  },

  async createProject(input: {
    title: string
    description?: string
    parentDirectory?: string
  }): Promise<CanvasSnapshot> {
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
      settings: {},
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

  async updateProjectSettings(
    projectId: string,
    settings: CanvasProjectSettings,
  ): Promise<CanvasSnapshot> {
    const db = readDb()
    const project = db.projects.find((item) => item.id === projectId)
    if (!project) throw new Error('Canvas project not found')
    project.settings = {
      prompt: settings.prompt?.trim() ?? '',
      negativePrompt: settings.negativePrompt?.trim() ?? '',
    }
    project.updatedAt = now()
    writeDb(db)
    return this.openSnapshot(projectId)
  },

  /**
   * 局部更新项目级扩展元数据（浅合并 patch）。
   * 用于行业模式数据（如影视 CanvasFilmProjectMetadata），第一阶段挂 metadata JSON。
   */
  async updateProjectMetadata(
    projectId: string,
    patch: Record<string, unknown>,
  ): Promise<CanvasSnapshot> {
    const db = readDb()
    const project = db.projects.find((item) => item.id === projectId)
    if (!project) throw new Error('Canvas project not found')
    project.metadata = { ...(project.metadata ?? {}), ...patch }
    project.updatedAt = now()
    writeDb(db)
    return this.openSnapshot(projectId)
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
      filters: [{ name: 'Spark Canvas Project', extensions: ['json'] }],
    })
    if (result.canceled || !result.filePath) return { exported: false }
    await window.spark.invoke('file:write-text', {
      path: result.filePath,
      content: JSON.stringify(payload, null, 2),
    })
    return { exported: true, filePath: result.filePath }
  },

  async exportProjectPackage(
    projectId: string,
  ): Promise<{ exported: boolean; directoryPath?: string }> {
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

  async openProjectFolder(
    projectId: string,
  ): Promise<{ opened: boolean; rootPath?: string; error?: string }> {
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
      filters: [{ name: 'Spark Canvas Project', extensions: ['json'] }],
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

  async migrateProjectAssetsToDirectory(
    projectId: string,
  ): Promise<{ movedAssets: number; skippedAssets: number }> {
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

  async cleanupLegacyCanvasAssets(): Promise<{
    deletedFiles: number
    deletedBytes: number
    scannedFiles: number
  }> {
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

  async openSnapshot(
    projectId: string,
    activeBoardId?: string | null,
  ): Promise<CanvasSnapshot> {
    // 解析激活 board 优先级：显式参数 > project.metadata.activeBoardId（用户上次选择）> 默认
    const resolvePreferredBoard = (db: CanvasDb): string | null | undefined => {
      if (activeBoardId) return activeBoardId
      const project = db.projects.find((item) => item.id === projectId)
      const stored = project?.metadata?.activeBoardId
      return typeof stored === 'string' ? stored : undefined
    }

    if (!canvasDirty) {
      try {
        const snapshot = await loadSnapshotFromStorage(projectId)
        if (snapshot) {
          snapshot.snapshot.project.lastOpenedAt = now()
          const db = emptyDb()
          replaceProjectSnapshot(db, snapshot.snapshot)
          writeHotDb(db, false)
          return snapshotFromDb(db, projectId, resolvePreferredBoard(db))
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
    return snapshotFromDb(db, projectId, resolvePreferredBoard(db))
  },

  async updateViewport(
    projectId: string,
    viewport: CanvasBoard['viewport'],
    boardId?: string | null,
  ): Promise<void> {
    const db = readDb()
    // 多 board：按 boardId 精准定位；未指定时回退到项目第一个 board（兼容旧调用）
    const board = boardId
      ? db.boards.find((item) => item.id === boardId && item.projectId === projectId)
      : db.boards.find((item) => item.projectId === projectId)
    if (!board) return
    board.viewport = viewport
    board.updatedAt = now()
    writeDb(db)
  },

  // ─── 多 board 管理（文档 §7.1）──────────────────────────────────────────
  // board CRUD：新增/重命名/删除/复制/切换/排序/设封面。删除前做守卫（最后一个 board
  // 不允许删除、有内容时由 UI 层确认）。切换 board 持久化 viewport 与 activeBoardId。

  async createBoard(
    projectId: string,
    input?: { name?: string; templateId?: string | null },
  ): Promise<CanvasSnapshot> {
    const db = readDb()
    const project = db.projects.find((item) => item.id === projectId)
    if (!project) throw new Error('Canvas project not found')
    const at = now()
    const existingCount = db.boards.filter((b) => b.projectId === projectId).length
    const board: CanvasBoard = {
      id: uid('canvas_board'),
      projectId,
      userId: USER_ID,
      name: input?.name?.trim() || `Board ${existingCount + 1}`,
      viewport: { x: 0, y: 0, zoom: 1 },
      settings: { grid: true, snap: false, background: 'paper', sortOrder: existingCount },
      ...(input?.templateId ? { templateId: input.templateId } : {}),
      createdAt: at,
      updatedAt: at,
    }
    db.boards.push(board)
    // 新建 board 默认其 settings.templateId（无则 undefined，保持可选）
    if (input?.templateId) board.settings.templateId = input.templateId
    updateProjectCounts(db, projectId)
    writeDb(db)
    return this.openSnapshot(projectId, board.id)
  },

  async renameBoard(projectId: string, boardId: string, name: string): Promise<CanvasSnapshot> {
    const db = readDb()
    const board = db.boards.find((item) => item.id === boardId && item.projectId === projectId)
    if (!board) return this.openSnapshot(projectId)
    board.name = name.trim() || board.name
    board.updatedAt = now()
    writeDb(db)
    return this.openSnapshot(projectId)
  },

  /** 删除 board 及其名下节点/边/任务。资产保持项目级共享，不随 board 删除。 */
  async deleteBoard(projectId: string, boardId: string): Promise<CanvasSnapshot> {
    const db = readDb()
    const project = db.projects.find((item) => item.id === projectId)
    if (!project) throw new Error('Canvas project not found')
    const boards = db.boards.filter((item) => item.projectId === projectId)
    // 守卫：最后一个 board 不允许删除（文档 §7.1 注意点）
    if (boards.length <= 1) {
      throw new Error('项目至少保留一个画布，无法删除')
    }
    const target = boards.find((item) => item.id === boardId)
    if (!target) return this.openSnapshot(projectId)
    const at = now()
    // 软删 board 名下节点（保留可恢复），清理相关 edge
    db.nodes = db.nodes.map((node) =>
      node.boardId === boardId && node.projectId === projectId
        ? { ...node, hidden: true, updatedAt: at }
        : node,
    )
    db.edges = db.edges.filter(
      (edge) => !(edge.boardId === boardId && edge.projectId === projectId),
    )
    db.tasks = db.tasks.filter(
      (task) => !(task.boardId === boardId && task.projectId === projectId),
    )
    db.boards = db.boards.filter((item) => item.id !== boardId)
    updateProjectCounts(db, projectId)
    // 删除当前激活板时回退到第一个剩余 board，并同步持久化 activeBoardId
    const remaining = db.boards.filter((item) => item.projectId === projectId)
    const fallbackBoard = remaining.find((b) => b.settings?.isDefault) ?? remaining[0]
    const fallbackId = fallbackBoard?.id ?? null
    if (fallbackId) {
      project.metadata = { ...(project.metadata ?? {}), activeBoardId: fallbackId }
    }
    writeDb(db)
    return this.openSnapshot(projectId, fallbackId)
  },

  /**
   * 深拷贝 board：复制其名下节点/边/任务（重映射 id），资产项目级共享不复制文件。
   * group 结构、parentNodeId 关系一并保留。
   */
  async duplicateBoard(
    projectId: string,
    boardId: string,
    name?: string,
  ): Promise<CanvasSnapshot> {
    const db = readDb()
    const sourceBoard = db.boards.find((item) => item.id === boardId && item.projectId === projectId)
    if (!sourceBoard) return this.openSnapshot(projectId)
    const at = now()
    const newBoardId = uid('canvas_board')
    const existingCount = db.boards.filter((b) => b.projectId === projectId).length
    const newBoard: CanvasBoard = {
      ...sourceBoard,
      id: newBoardId,
      name: name?.trim() || `${sourceBoard.name} 副本`,
      viewport: { x: 0, y: 0, zoom: 1 },
      settings: {
        ...sourceBoard.settings,
        ...(sourceBoard.settings ?? {}),
        isDefault: false,
        sortOrder: existingCount,
      },
      createdAt: at,
      updatedAt: at,
    }
    db.boards.push(newBoard)

    // 复制源 board 名下节点（非 hidden），重映射 id 并保留 group 父子关系
    const sourceNodes = db.nodes.filter(
      (node) => node.boardId === boardId && node.projectId === projectId && !node.hidden,
    )
    const idMap = new Map<string, string>()
    for (const node of sourceNodes) idMap.set(node.id, uid('canvas_node'))
    for (const node of sourceNodes) {
      const clone: CanvasNode = {
        ...node,
        id: idMap.get(node.id)!,
        boardId: newBoardId,
        x: node.x + 32,
        y: node.y + 32,
        locked: false,
        createdAt: at,
        updatedAt: at,
        ...(node.parentNodeId && idMap.has(node.parentNodeId)
          ? { parentNodeId: idMap.get(node.parentNodeId)! }
          : { parentNodeId: null }),
      }
      db.nodes.push(clone)
    }
    // 复制 board 内 edge
    const sourceEdges = db.edges.filter(
      (edge) => edge.boardId === boardId && edge.projectId === projectId,
    )
    const clonedNodeIds = new Set(idMap.values())
    for (const edge of sourceEdges) {
      const sourceId = idMap.get(edge.sourceNodeId)
      const targetId = idMap.get(edge.targetNodeId)
      // 仅复制两端都被复制过来的 edge（group_contains 等内部关系）
      if (!sourceId || !targetId) continue
      db.edges.push({
        ...edge,
        id: uid('canvas_edge'),
        boardId: newBoardId,
        sourceNodeId: sourceId,
        targetNodeId: targetId,
        createdAt: at,
      })
    }
    // 复制 board 内 task（及其输入/输出节点引用，按 idMap 重映射）
    const sourceTasks = db.tasks.filter(
      (task) => task.boardId === boardId && task.projectId === projectId,
    )
    for (const task of sourceTasks) {
      const newTaskId = uid('canvas_task')
      const clone: CanvasTask = {
        ...task,
        id: newTaskId,
        boardId: newBoardId,
        status: 'cancelled',
        progress: 0,
        completedAt: null,
        errorMsg: 'duplicate_of_origin',
        errorDetail: '由复制画布生成，需手动重跑',
        inputNodeIds: task.inputNodeIds
          .map((id) => idMap.get(id))
          .filter((id): id is string => Boolean(id)),
        outputNodeIds: [],
        outputAssetIds: [],
        createdAt: at,
        updatedAt: at,
      }
      // 复制任务节点（type=task）的 taskId 指向新 task
      const clonedTaskNodes = db.nodes.filter(
        (n) =>
          n.boardId === newBoardId &&
          n.projectId === projectId &&
          n.taskId === task.id,
      )
      for (const tn of clonedTaskNodes) {
        tn.taskId = newTaskId
        tn.data = { ...tn.data, status: 'cancelled', progress: 0, message: '复制任务，需手动重跑' }
      }
      db.tasks.push(clone)
    }
    updateProjectCounts(db, projectId)
    writeDb(db)
    return this.openSnapshot(projectId, newBoardId)
  },

  /** 切换激活 board：持久化 activeBoardId + viewport，返回新 snapshot */
  /**
   * 切换激活 board：直接操作内存 db 并标记 dirty，确保切换立即生效且持久化。
   *
   * 不走 openSnapshot 的 loadSnapshotFromStorage 分支——那条路径在 canvasDirty=false 时
   * 会从 SQLite 重载，覆盖刚切换的 board 选择（这是「多 board 切换无效」的根因）。
   * activeBoardId 持久化在 project.metadata.activeBoardId，随 snapshot flush 落库。
   */
  async setActiveBoard(projectId: string, boardId: string): Promise<CanvasSnapshot> {
    const db = readDb()
    const project = db.projects.find((item) => item.id === projectId)
    if (!project) throw new Error('Canvas project not found')
    const targetBoard = db.boards.find((item) => item.id === boardId && item.projectId === projectId)
    if (!targetBoard) throw new Error('Canvas board not found')
    // 持久化用户选择的激活 board（跨会话保留）
    project.metadata = { ...(project.metadata ?? {}), activeBoardId: boardId }
    project.lastOpenedAt = now()
    project.updatedAt = now()
    writeDb(db)
    return snapshotFromDb(db, projectId, boardId)
  },

  /** 调整 board 顺序：按传入 id 顺序写 sortOrder */
  async reorderBoards(projectId: string, orderedBoardIds: string[]): Promise<CanvasSnapshot> {
    const db = readDb()
    orderedBoardIds.forEach((boardId, index) => {
      const board = db.boards.find((item) => item.id === boardId && item.projectId === projectId)
      if (board) {
        board.settings = { ...board.settings, sortOrder: index }
        board.updatedAt = now()
      }
    })
    writeDb(db)
    return this.openSnapshot(projectId)
  },

  /** 设置 board 封面资产（用于 board 列表缩略图） */
  async setBoardCover(
    projectId: string,
    boardId: string,
    coverAssetId: string | null,
  ): Promise<CanvasSnapshot> {
    const db = readDb()
    const board = db.boards.find((item) => item.id === boardId && item.projectId === projectId)
    if (!board) return this.openSnapshot(projectId)
    board.settings = { ...board.settings, coverAssetId }
    board.updatedAt = now()
    writeDb(db)
    return this.openSnapshot(projectId)
  },

  /** 设为默认打开 board */
  async setDefaultBoard(projectId: string, boardId: string): Promise<CanvasSnapshot> {
    const db = readDb()
    for (const board of db.boards) {
      if (board.projectId !== projectId) continue
      board.settings = { ...board.settings, isDefault: board.id === boardId }
      board.updatedAt = now()
    }
    writeDb(db)
    return this.openSnapshot(projectId)
  },

  /** 局部更新 board.settings（grid/snap/background 等显示选项） */
  async updateBoardSettings(
    projectId: string,
    boardId: string,
    patch: Partial<NonNullable<CanvasBoard['settings']>>,
  ): Promise<CanvasSnapshot> {
    const db = readDb()
    const board = db.boards.find((item) => item.id === boardId && item.projectId === projectId)
    if (!board) return this.openSnapshot(projectId)
    board.settings = { ...board.settings, ...patch }
    board.updatedAt = now()
    writeDb(db)
    return this.openSnapshot(projectId)
  },

  /**
   * 跨 board 复制节点：把选中节点复制到目标 board（资产共享，不复制文件）。
   * 保留 group 父子结构与内部 edge。
   */
  async copyNodesToBoard(
    projectId: string,
    nodeIds: string[],
    targetBoardId: string,
  ): Promise<CanvasSnapshot> {
    const db = readDb()
    const targetBoard = db.boards.find((item) => item.id === targetBoardId && item.projectId === projectId)
    if (!targetBoard) return this.openSnapshot(projectId)
    const selected = new Set(nodeIds)
    const sourceNodes = db.nodes.filter(
      (node) => selected.has(node.id) && node.projectId === projectId && !node.hidden,
    )
    if (sourceNodes.length === 0) return this.openSnapshot(projectId)
    const at = now()
    const idMap = new Map<string, string>()
    for (const node of sourceNodes) idMap.set(node.id, uid('canvas_node'))
    for (const node of sourceNodes) {
      db.nodes.push({
        ...node,
        id: idMap.get(node.id)!,
        boardId: targetBoardId,
        x: node.x + 40,
        y: node.y + 40,
        locked: false,
        createdAt: at,
        updatedAt: at,
        ...(node.parentNodeId && idMap.has(node.parentNodeId)
          ? { parentNodeId: idMap.get(node.parentNodeId)! }
          : { parentNodeId: null }),
      })
    }
    // 复制选中节点之间的内部 edge
    const sourceEdges = db.edges.filter(
      (edge) =>
        edge.projectId === projectId &&
        selected.has(edge.sourceNodeId) &&
        selected.has(edge.targetNodeId),
    )
    for (const edge of sourceEdges) {
      db.edges.push({
        ...edge,
        id: uid('canvas_edge'),
        boardId: targetBoardId,
        sourceNodeId: idMap.get(edge.sourceNodeId)!,
        targetNodeId: idMap.get(edge.targetNodeId)!,
        createdAt: at,
      })
    }
    updateProjectCounts(db, projectId)
    writeDb(db)
    return this.openSnapshot(projectId, targetBoardId)
  },

  /**
   * 应用模板：按 blueprint 在指定 board 的指定位置批量创建节点 + 连线（文档 §7.8）。
   *
   * 生产级实现：
   *   - 重映射 blueprint ref → 真实 node id
   *   - task 节点同步创建 CanvasTask（status=pending，等用户运行）
   *   - 连线按重映射后的 id 建立 edge
   *   - origin 标记为 'template'
   * 返回新 snapshot（已按 board 过滤）。
   */
  async applyTemplate(input: {
    projectId: string
    boardId: string
    originX: number
    originY: number
    nodes: Array<{
      ref: string
      type: CanvasNode['type']
      title?: string
      x: number
      y: number
      width?: number
      height?: number
      data?: Partial<CanvasNode['data']>
    }>
    edges?: Array<{
      from: string
      to: string
      type?: 'used_as_input' | 'generated' | 'references'
    }>
  }): Promise<CanvasSnapshot> {
    const db = readDb()
    const board = db.boards.find((item) => item.id === input.boardId && item.projectId === input.projectId)
    if (!board) throw new Error('Canvas board not found')
    const at = now()
    let maxZ = Math.max(
      0,
      ...db.nodes.filter((n) => n.projectId === input.projectId).map((n) => n.zIndex),
    )
    const refToId = new Map<string, string>()

    // 创建节点
    for (const bp of input.nodes) {
      const nodeId = uid('canvas_node')
      refToId.set(bp.ref, nodeId)
      const baseData: CanvasNode['data'] = { ...(bp.data ?? {}), origin: 'template' }
      const defaultSize =
        bp.type === 'group'
          ? { width: 360, height: 220 }
          : bp.type === 'task'
            ? { width: 300, height: 152 }
            : { width: 280, height: 164 }
      const node = createNodeBase({
        id: nodeId,
        projectId: input.projectId,
        boardId: input.boardId,
        type: bp.type,
        title: bp.title ?? null,
        x: input.originX + bp.x,
        y: input.originY + bp.y,
        width: bp.width ?? defaultSize.width,
        height: bp.height ?? defaultSize.height,
        data: baseData,
        at,
      })
      maxZ += 1
      node.zIndex = maxZ
      db.nodes.push(node)

      // text/prompt 节点同步创建 asset（与 createTextNode 一致）
      if (bp.type === 'text' || bp.type === 'prompt') {
        const asset: CanvasAsset = {
          id: uid('canvas_asset'),
          projectId: input.projectId,
          userId: USER_ID,
          type: 'text',
          source: 'manual',
          title: bp.title ?? null,
          contentText: baseData.text ?? '',
          metadata: { nodeId, origin: 'template' },
          createdAt: at,
          updatedAt: at,
        }
        node.assetId = asset.id
        db.assets.push(asset)
      }

      // task 节点同步创建 CanvasTask（pending，等用户运行）
      if (bp.type === 'task' && baseData.operation) {
        const taskId = uid('canvas_task')
        node.taskId = taskId
        const task: CanvasTask = {
          id: taskId,
          projectId: input.projectId,
          boardId: input.boardId,
          userId: USER_ID,
          operation: baseData.operation,
          status: 'pending',
          progress: 0,
          title: bp.title ?? null,
          prompt: baseData.prompt ?? null,
          negativePrompt: null,
          inputNodeIds: [],
          inputAssetIds: [],
          outputNodeIds: [],
          outputAssetIds: [],
          modelParams: {},
          createdAt: at,
          updatedAt: at,
        }
        db.tasks.push(task)
      }
    }

    // 创建连线
    if (input.edges) {
      for (const edgeBp of input.edges) {
        const sourceId = refToId.get(edgeBp.from)
        const targetId = refToId.get(edgeBp.to)
        if (!sourceId || !targetId) continue
        const edgeType: CanvasEdge['type'] = edgeBp.type ?? 'used_as_input'
        db.edges.push({
          id: uid('canvas_edge'),
          projectId: input.projectId,
          boardId: input.boardId,
          userId: USER_ID,
          sourceNodeId: sourceId,
          targetNodeId: targetId,
          type: edgeType,
          metadata: { fromTemplate: true },
          createdAt: at,
        })
        // 若目标节点是 task，把源节点加入 task.inputNodeIds（与 connectNodes 行为一致）
        const targetNode = db.nodes.find((n) => n.id === targetId)
        if (targetNode?.type === 'task' && targetNode.taskId) {
          const task = db.tasks.find((t) => t.id === targetNode.taskId)
          if (task && !task.inputNodeIds.includes(sourceId)) {
            task.inputNodeIds.push(sourceId)
            const sourceNode = db.nodes.find((n) => n.id === sourceId)
            if (sourceNode?.assetId && !task.inputAssetIds.includes(sourceNode.assetId)) {
              task.inputAssetIds.push(sourceNode.assetId)
            }
          }
        }
      }
    }

    updateProjectCounts(db, input.projectId)
    writeDb(db)
    return this.openSnapshot(input.projectId, input.boardId)
  },

  // ─── 资产 → board 操作（文档 §7.2）───────────────────────────────────────
  // 资产保持项目级共享；插入 = 基于已有 asset 创建引用节点，不复制文件。

  /** 把单个资产作为节点插入指定 board（复用已有 asset，不复制文件） */
  async insertAssetToBoard(input: {
    projectId: string
    boardId: string
    assetId: string
    x: number
    y: number
  }): Promise<CanvasNode | null> {
    const db = readDb()
    const asset = db.assets.find((item) => item.id === input.assetId && item.projectId === input.projectId)
    const board = db.boards.find((item) => item.id === input.boardId && item.projectId === input.projectId)
    if (!asset || !board) return null
    const maxZ = Math.max(
      0,
      ...db.nodes.filter((n) => n.projectId === input.projectId).map((n) => n.zIndex),
    )
    const nodeType: CanvasNode['type'] =
      asset.type === 'image'
        ? 'image'
        : asset.type === 'video'
          ? 'video'
          : asset.type === 'audio'
            ? 'audio'
            : asset.type === 'prompt'
              ? 'prompt'
              : 'text'
    const size = fitMediaNodeSize(asset.type, asset.width, asset.height)
    const data: CanvasNode['data'] =
      nodeType === 'text' || nodeType === 'prompt'
        ? { text: asset.contentText ?? '', format: nodeType === 'prompt' ? 'prompt' : 'plain', origin: 'asset' }
        : {
            ...(asset.url ? { url: asset.url } : {}),
            ...(asset.thumbnailUrl ? { thumbnailUrl: asset.thumbnailUrl } : {}),
            ...(asset.mimeType ? { mimeType: asset.mimeType } : {}),
            origin: 'asset',
          }
    const node = createNodeBase({
      projectId: input.projectId,
      boardId: input.boardId,
      type: nodeType,
      title: asset.title ?? asset.type,
      assetId: asset.id,
      x: input.x,
      y: input.y,
      width: size.width,
      height: size.height,
      data,
    })
    node.zIndex = maxZ + 1
    db.nodes.push(node)
    // 记录资产最近使用（挂 metadata，第一阶段）
    asset.metadata = { ...asset.metadata, lastUsedAt: now(), usageCount: ((asset.metadata.usageCount as number) ?? 0) + 1 }
    asset.updatedAt = now()
    updateProjectCounts(db, input.projectId)
    writeDb(db)
    return node
  },

  // ─── 影视公用资产管理（文档 §7.10）──────────────────────────────────────
  // 剧本/角色/场景/道具/特效/提示词库复用 CanvasAsset + metadata.kind；
  // 分镜分组存 project.metadata.film.shotGroups。
  // v2 模型：references 多图多描述 + tags 数组；老 imageAssetId/attributes 自动迁移。

  /** 创建影视公用资产 */
  async createFilmAsset(
    projectId: string,
    input: CreateFilmAssetInput,
  ): Promise<CanvasAsset> {
    const db = readDb()
    const at = now()
    const assetType = filmKindToAssetType(input.kind)
    const references = (input.references ?? []).map((ref) => ({
      id: ref.id,
      kind: ref.kind,
      assetId: ref.assetId,
      description: ref.description ?? '',
      ...(ref.label ? { label: ref.label } : {}),
      order: typeof ref.order === 'number' ? ref.order : 0,
    }))
    const tags = Array.isArray(input.tags)
      ? input.tags
          .map((tag) => (typeof tag === 'string' ? tag.trim() : ''))
          .filter((tag, idx, arr) => Boolean(tag) && arr.indexOf(tag) === idx)
      : []
    const asset: CanvasAsset = {
      id: filmUid('canvas_asset'),
      projectId,
      userId: USER_ID,
      type: assetType,
      source: 'manual',
      title: input.name,
      contentText: input.text ?? null,
      metadata: {
        kind: input.kind,
        ...(input.prompt ? { prompt: input.prompt } : {}),
        ...(input.attributes ? { attributes: input.attributes } : {}),
        references,
        tags,
      },
      createdAt: at,
      updatedAt: at,
    }
    db.assets.push(asset)
    updateProjectCounts(db, projectId)
    writeDb(db)
    return asset
  },

  /** 更新影视资产（名称/内容/references/tags/属性/默认 prompt） */
  async updateFilmAsset(
    projectId: string,
    assetId: string,
    patch: Partial<Pick<CanvasAsset, 'title' | 'contentText'>> & {
      prompt?: string
      references?: FilmReference[]
      tags?: string[]
      attributes?: Record<string, string>
    },
  ): Promise<CanvasSnapshot> {
    const db = readDb()
    const asset = db.assets.find((item) => item.id === assetId && item.projectId === projectId)
    if (!asset) return this.openSnapshot(projectId)
    if (patch.title !== undefined) asset.title = patch.title
    if (patch.contentText !== undefined) asset.contentText = patch.contentText
    let nextMeta: Record<string, unknown> = {
      ...asset.metadata,
      ...(patch.prompt !== undefined ? { prompt: patch.prompt } : {}),
      ...(patch.attributes !== undefined ? { attributes: patch.attributes } : {}),
    }
    if (patch.references !== undefined) {
      nextMeta = writeReferences(nextMeta, patch.references)
    }
    if (patch.tags !== undefined) {
      nextMeta = writeTags(nextMeta, patch.tags)
    }
    asset.metadata = nextMeta
    asset.updatedAt = now()
    writeDb(db)
    return this.openSnapshot(projectId)
  },

  /** 删除影视资产（从项目移除引用，保留文件由 cleanup 单独处理，文档 §11.3） */
  async deleteFilmAsset(projectId: string, assetId: string): Promise<CanvasSnapshot> {
    const db = readDb()
    db.assets = db.assets.filter((item) => !(item.id === assetId && item.projectId === projectId))
    updateProjectCounts(db, projectId)
    writeDb(db)
    return this.openSnapshot(projectId)
  },

  /** 列出项目内指定种类的影视资产 */
  listFilmAssets(
    db: CanvasDb,
    projectId: string,
    kind?: FilmAssetKind,
  ): CanvasAsset[] {
    return db.assets.filter((asset) => {
      if (asset.projectId !== projectId) return false
      const assetKind = asset.metadata?.kind
      if (typeof assetKind !== 'string') return false
      if (kind && assetKind !== kind) return false
      return true
    })
  },

  /** 搜索/筛选项目内影视资产（v2：query/kind/tags/usageCount） */
  searchFilmAssets(
    projectId: string,
    options: {
      query?: string
      kinds?: FilmAssetKind[]
      tags?: string[]
      sortBy?: 'updated' | 'created' | 'name' | 'usage'
    } = {},
  ): CanvasAsset[] {
    const db = readDb()
    const query = (options.query ?? '').trim().toLowerCase()
    const kinds = options.kinds && options.kinds.length > 0 ? new Set(options.kinds) : null
    const tagsFilter = options.tags && options.tags.length > 0 ? options.tags.map((t) => t.toLowerCase()) : null
    const list = this.listFilmAssets(db, projectId).filter((asset) => {
      if (kinds) {
        const k = asset.metadata?.['kind']
        if (typeof k !== 'string' || !kinds.has(k as FilmAssetKind)) return false
      }
      if (tagsFilter) {
        const assetTags = readTags(asset.metadata).map((t) => t.toLowerCase())
        if (!tagsFilter.every((t) => assetTags.includes(t))) return false
      }
      if (query) {
        const title = (asset.title ?? '').toLowerCase()
        const content = (asset.contentText ?? '').toLowerCase()
        const prompt = typeof asset.metadata?.['prompt'] === 'string' ? (asset.metadata['prompt'] as string).toLowerCase() : ''
        const attrs = asset.metadata?.['attributes']
        const attrText =
          attrs && typeof attrs === 'object' && !Array.isArray(attrs)
            ? Object.values(attrs as Record<string, unknown>)
                .filter((v): v is string => typeof v === 'string')
                .join(' ')
                .toLowerCase()
            : ''
        const tagText = readTags(asset.metadata).join(' ').toLowerCase()
        if (
          !title.includes(query) &&
          !content.includes(query) &&
          !prompt.includes(query) &&
          !attrText.includes(query) &&
          !tagText.includes(query)
        ) {
          return false
        }
      }
      return true
    })
    const sortBy = options.sortBy ?? 'updated'
    const usageMap = this.countFilmAssetUsage(projectId)
    return list.sort((a, b) => {
      if (sortBy === 'name') {
        return (a.title ?? '').localeCompare(b.title ?? '')
      }
      if (sortBy === 'created') {
        return b.createdAt.localeCompare(a.createdAt)
      }
      if (sortBy === 'usage') {
        return (usageMap.get(b.id) ?? 0) - (usageMap.get(a.id) ?? 0)
      }
      return b.updatedAt.localeCompare(a.updatedAt)
    })
  },

  /** 统计一个影视资产的引用次数（分镜引用 + 画布节点 assetId 引用） */
  countFilmAssetUsage(projectId: string): Map<string, number> {
    const db = readDb()
    const usage = new Map<string, number>()
    const bump = (assetId: string | null | undefined) => {
      if (!assetId) return
      usage.set(assetId, (usage.get(assetId) ?? 0) + 1)
    }
    // 画布节点 assetId 引用
    for (const node of db.nodes) {
      if (node.projectId !== projectId) continue
      bump(node.assetId)
    }
    // 分镜引用（characterAssetIds / sceneAssetId / propAssetIds）
    for (const project of db.projects) {
      if (project.id !== projectId) continue
      const film = project.metadata?.['film']
      if (!film || typeof film !== 'object') continue
      const groups = (film as Record<string, unknown>)['shotGroups']
      if (!Array.isArray(groups)) continue
      for (const group of groups) {
        if (!group || typeof group !== 'object') continue
        const segments = (group as Record<string, unknown>)['segments']
        if (!Array.isArray(segments)) continue
        for (const seg of segments) {
          if (!seg || typeof seg !== 'object') continue
          const s = seg as Record<string, unknown>
          if (Array.isArray(s['characterAssetIds'])) {
            for (const id of s['characterAssetIds'] as unknown[]) {
              if (typeof id === 'string') bump(id)
            }
          }
          if (typeof s['sceneAssetId'] === 'string') bump(s['sceneAssetId'])
          if (Array.isArray(s['propAssetIds'])) {
            for (const id of s['propAssetIds'] as unknown[]) {
              if (typeof id === 'string') bump(id)
            }
          }
        }
      }
    }
    return usage
  },

  /** 资源库的引用详情（被哪些分镜片段 / 画布节点引用） */
  getFilmAssetUsage(
    projectId: string,
    assetId: string,
  ): {
    shotSegments: Array<{ groupId: string; groupName: string; segmentId: string; segmentTitle: string; segmentIndex: number }>
    nodes: Array<{ id: string; type: string; title: string | null }>
  } {
    const db = readDb()
    const shotSegments: Array<{
      groupId: string
      groupName: string
      segmentId: string
      segmentTitle: string
      segmentIndex: number
    }> = []
    const nodes: Array<{ id: string; type: string; title: string | null }> = []
    for (const node of db.nodes) {
      if (node.projectId !== projectId) continue
      if (node.assetId === assetId) {
        nodes.push({ id: node.id, type: node.type, title: node.title ?? null })
      }
    }
    for (const project of db.projects) {
      if (project.id !== projectId) continue
      const film = project.metadata?.['film']
      if (!film || typeof film !== 'object') continue
      const groups = (film as Record<string, unknown>)['shotGroups']
      if (!Array.isArray(groups)) continue
      for (const group of groups) {
        if (!group || typeof group !== 'object') continue
        const g = group as Record<string, unknown>
        const segments = g['segments']
        if (!Array.isArray(segments)) continue
        for (const seg of segments) {
          if (!seg || typeof seg !== 'object') continue
          const s = seg as Record<string, unknown>
          const charIds = Array.isArray(s['characterAssetIds'])
            ? (s['characterAssetIds'] as unknown[]).filter((x): x is string => typeof x === 'string')
            : []
          const sceneId = typeof s['sceneAssetId'] === 'string' ? (s['sceneAssetId'] as string) : null
          const propIds = Array.isArray(s['propAssetIds'])
            ? (s['propAssetIds'] as unknown[]).filter((x): x is string => typeof x === 'string')
            : []
          if (
            charIds.includes(assetId) ||
            sceneId === assetId ||
            propIds.includes(assetId)
          ) {
            shotSegments.push({
              groupId: typeof g['id'] === 'string' ? (g['id'] as string) : '',
              groupName: typeof g['name'] === 'string' ? (g['name'] as string) : '未命名分组',
              segmentId: typeof s['id'] === 'string' ? (s['id'] as string) : '',
              segmentTitle: typeof s['title'] === 'string' ? (s['title'] as string) : '未命名片段',
              segmentIndex: typeof s['index'] === 'number' ? (s['index'] as number) : 0,
            })
          }
        }
      }
    }
    return { shotSegments, nodes }
  },

  /** 给资源加/移除标签（idempotent） */
  async setFilmAssetTags(
    projectId: string,
    assetId: string,
    tags: string[],
  ): Promise<CanvasSnapshot> {
    const db = readDb()
    const asset = db.assets.find((item) => item.id === assetId && item.projectId === projectId)
    if (!asset) return this.openSnapshot(projectId)
    asset.metadata = writeTags(asset.metadata, tags)
    asset.updatedAt = now()
    writeDb(db)
    return this.openSnapshot(projectId)
  },

  // ─── 分镜分组 CRUD（存 project.metadata.film.shotGroups）─────────────────

  /** 读取项目的分镜分组 */
  readShotGroups(
    db: CanvasDb,
    projectId: string,
  ): ShotGroup[] {
    const project = db.projects.find((item) => item.id === projectId)
    const film = project?.metadata?.film as FilmProjectData | undefined
    return film?.shotGroups ?? []
  },

  /** 写入分镜分组（不可变更新 project.metadata） */
  writeShotGroups(
    db: CanvasDb,
    projectId: string,
    groups: ShotGroup[],
  ): void {
    const project = db.projects.find((item) => item.id === projectId)
    if (!project) return
    const film = (project.metadata?.film ?? {}) as FilmProjectData
    film.shotGroups = groups
    project.metadata = { ...(project.metadata ?? {}), film }
    project.updatedAt = now()
  },

  /** 新建分镜分组 */
  async createShotGroup(
    projectId: string,
    input: { name: string; description?: string },
  ): Promise<{ shotGroups: ShotGroup[] }> {
    const db = readDb()
    const existing = this.readShotGroups(db, projectId)
    const group: ShotGroup = {
      id: filmUid('shot_group'),
      name: input.name,
      ...(input.description ? { description: input.description } : {}),
      sortOrder: existing.length,
      segments: [],
    }
    existing.push(group)
    this.writeShotGroups(db, projectId, existing)
    writeDb(db)
    return { shotGroups: existing }
  },

  /** 更新分镜分组（名称/描述） */
  async updateShotGroup(
    projectId: string,
    groupId: string,
    patch: Partial<Pick<ShotGroup, 'name' | 'description'>>,
  ): Promise<{ shotGroups: ShotGroup[] }> {
    const db = readDb()
    const groups = this.readShotGroups(db, projectId)
    const group = groups.find((item) => item.id === groupId)
    if (group) {
      if (patch.name !== undefined) group.name = patch.name
      if (patch.description !== undefined) group.description = patch.description
      this.writeShotGroups(db, projectId, groups)
      writeDb(db)
    }
    return { shotGroups: groups }
  },

  /** 删除分镜分组 */
  async deleteShotGroup(
    projectId: string,
    groupId: string,
  ): Promise<{ shotGroups: ShotGroup[] }> {
    const db = readDb()
    let groups = this.readShotGroups(db, projectId)
    groups = groups.filter((item) => item.id !== groupId)
    this.writeShotGroups(db, projectId, groups)
    writeDb(db)
    return { shotGroups: groups }
  },

  /** 新建分镜片段 */
  async createShotSegment(
    projectId: string,
    groupId: string,
    input: Partial<Omit<ShotSegment, 'id'>> & { title: string },
  ): Promise<{ shotGroups: ShotGroup[] }> {
    const db = readDb()
    const groups = this.readShotGroups(db, projectId)
    const group = groups.find((item) => item.id === groupId)
    if (!group) return { shotGroups: groups }
    const segment: ShotSegment = {
      id: filmUid('shot_seg'),
      index: group.segments.length + 1,
      title: input.title,
      ...(input.description ? { description: input.description } : {}),
      ...(input.dialogue ? { dialogue: input.dialogue } : {}),
      ...(input.narration ? { narration: input.narration } : {}),
      ...(input.characterAssetIds ? { characterAssetIds: input.characterAssetIds } : {}),
      ...(input.sceneAssetId ? { sceneAssetId: input.sceneAssetId } : {}),
      ...(input.propAssetIds ? { propAssetIds: input.propAssetIds } : {}),
      ...(input.shotPrompt ? { shotPrompt: input.shotPrompt } : {}),
    }
    group.segments.push(segment)
    this.writeShotGroups(db, projectId, groups)
    writeDb(db)
    return { shotGroups: groups }
  },

  /** 更新分镜片段 */
  async updateShotSegment(
    projectId: string,
    groupId: string,
    segmentId: string,
    patch: Partial<Omit<ShotSegment, 'id'>>,
  ): Promise<{ shotGroups: ShotGroup[] }> {
    const db = readDb()
    const groups = this.readShotGroups(db, projectId)
    const group = groups.find((item) => item.id === groupId)
    const segment = group?.segments.find((item) => item.id === segmentId)
    if (segment) {
      Object.assign(segment, patch)
      this.writeShotGroups(db, projectId, groups)
      writeDb(db)
    }
    return { shotGroups: groups }
  },

  /** 删除分镜片段 */
  async deleteShotSegment(
    projectId: string,
    groupId: string,
    segmentId: string,
  ): Promise<{ shotGroups: ShotGroup[] }> {
    const db = readDb()
    const groups = this.readShotGroups(db, projectId)
    const group = groups.find((item) => item.id === groupId)
    if (group) {
      group.segments = group.segments.filter((item) => item.id !== segmentId)
      // 重排镜号
      group.segments.forEach((seg, idx) => (seg.index = idx + 1))
      this.writeShotGroups(db, projectId, groups)
      writeDb(db)
    }
    return { shotGroups: groups }
  },

  async createTextNode(input: {
    projectId: string
    boardId: string
    text: string
    x: number
    y: number
  }): Promise<CanvasNode> {
    const db = readDb()
    const maxZ = Math.max(
      0,
      ...db.nodes.filter((node) => node.projectId === input.projectId).map((node) => node.zIndex),
    )
    const node = createNodeBase({
      projectId: input.projectId,
      boardId: input.boardId,
      type: 'text',
      title: 'Text note',
      x: input.x,
      y: input.y,
      width: 280,
      height: 164,
      data: { text: input.text, format: 'plain' },
    })
    node.zIndex = maxZ + 1
    const asset: CanvasAsset = {
      id: uid('canvas_asset'),
      projectId: input.projectId,
      userId: USER_ID,
      type: 'text',
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

  /** 仅创建 image asset（不创建节点），用于资源库 references 上传图 */
  async createImageAsset(input: {
    projectId: string
    file: File
    filePath: string
    imageWidth?: number
    imageHeight?: number
  }): Promise<CanvasAsset> {
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
    db.assets.push(asset)
    updateProjectCounts(db, input.projectId)
    writeDb(db)
    return asset
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
    const maxZ = Math.max(
      0,
      ...db.nodes.filter((node) => node.projectId === input.projectId).map((node) => node.zIndex),
    )
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
    node.zIndex = maxZ + 1
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
    const maxZ = Math.max(
      0,
      ...db.nodes.filter((node) => node.projectId === projectId).map((node) => node.zIndex),
    )
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
      (node) =>
        node.id === groupId &&
        node.projectId === projectId &&
        node.type === 'group' &&
        !node.hidden,
    )
    if (!groupNode) return this.openSnapshot(projectId)

    const at = now()
    for (const node of db.nodes) {
      if (node.projectId !== projectId || node.hidden || node.parentNodeId !== groupNode.id)
        continue
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

  async addNodesToGroup(
    projectId: string,
    groupId: string,
    nodeIds: string[],
  ): Promise<CanvasSnapshot> {
    const db = readDb()
    const groupNode = db.nodes.find(
      (node) =>
        node.id === groupId &&
        node.projectId === projectId &&
        node.type === 'group' &&
        !node.hidden,
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
      .filter(
        (node) =>
          node.projectId === projectId && !node.hidden && node.parentNodeId === groupNode.id,
      )
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
    const source = db.nodes.find(
      (node) => node.id === input.sourceNodeId && node.projectId === projectId && !node.hidden,
    )
    const target = db.nodes.find(
      (node) => node.id === input.targetNodeId && node.projectId === projectId && !node.hidden,
    )
    const board = db.boards.find((item) => item.projectId === projectId)
    if (!source || !target || !board) return this.openSnapshot(projectId)

    const edgeType: CanvasEdge['type'] =
      input.type ??
      (target.type === 'task'
        ? 'used_as_input'
        : source.type === 'task'
          ? 'generated'
          : 'references')
    const duplicate = db.edges.some(
      (edge) =>
        edge.projectId === projectId &&
        edge.sourceNodeId === source.id &&
        edge.targetNodeId === target.id &&
        edge.type === edgeType,
    )
    if (duplicate) return this.openSnapshot(projectId)

    const taskId =
      target.type === 'task' ? target.taskId : source.type === 'task' ? source.taskId : null
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
      if (source.assetId && !task.inputAssetIds.includes(source.assetId))
        task.inputAssetIds.push(source.assetId)
      task.updatedAt = at
    }
    if (task && edgeType === 'generated') {
      if (!task.outputNodeIds.includes(target.id)) task.outputNodeIds.push(target.id)
      if (target.assetId && !task.outputAssetIds.includes(target.assetId))
        task.outputAssetIds.push(target.assetId)
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
        .filter(
          (node) => remove.has(node.id) && node.projectId === projectId && node.type === 'group',
        )
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
      // 类型化操作节点：type === operation（如 text_to_image）
      type: request.operation as CanvasNodeType,
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
      negativePrompt: request.negativePrompt ?? null,
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
   * 创建类型化操作节点（文档：AI 操作按类型分拆节点）。
   * type=operation 的节点 + CanvasTask（pending）+ 输入 used_as_input 连线。
   */
  async createOperationNode(input: {
    projectId: string
    boardId: string
    operation: CanvasOperationType
    inputNodeIds: string[]
    x: number
    y: number
    title?: string
  }): Promise<CanvasSnapshot> {
    const db = readDb()
    const at = now()
    const taskId = uid('canvas_task')
    const board = db.boards.find((item) => item.id === input.boardId && item.projectId === input.projectId)
    if (!board) throw new Error('Canvas board not found')
    const inputNodes = db.nodes.filter(
      (n) => input.inputNodeIds.includes(n.id) && n.projectId === input.projectId && !n.hidden,
    )
    const promptContext = inputNodes
      .filter((n) => n.type === 'text' || n.type === 'prompt')
      .map((n) => n.data.text ?? '')
      .filter(Boolean)
      .join('\n\n')
    const maxZ = Math.max(0, ...db.nodes.filter((n) => n.projectId === input.projectId).map((n) => n.zIndex))
    const node = createNodeBase({
      projectId: input.projectId,
      boardId: input.boardId,
      type: input.operation as CanvasNodeType,
      taskId,
      title: input.title ?? operationLabel(input.operation),
      x: input.x,
      y: input.y,
      width: 300,
      height: 152,
      data: {
        operation: input.operation,
        status: 'pending',
        progress: 0,
        message: '点击下方编辑面板调整参数后运行',
        ...(promptContext ? { prompt: promptContext } : {}),
        origin: 'manual',
      },
      at,
    })
    node.zIndex = maxZ + 1
    db.nodes.push(node)
    const task: CanvasTask = {
      id: taskId,
      projectId: input.projectId,
      boardId: input.boardId,
      userId: USER_ID,
      operation: input.operation,
      status: 'pending',
      progress: 0,
      title: input.title ?? operationLabel(input.operation),
      prompt: promptContext || null,
      negativePrompt: null,
      inputNodeIds: input.inputNodeIds,
      inputAssetIds: inputNodes.map((n) => n.assetId).filter((id): id is string => Boolean(id)),
      outputNodeIds: [],
      outputAssetIds: [],
      modelParams: {},
      createdAt: at,
      updatedAt: at,
    }
    db.tasks.push(task)
    for (const sourceId of input.inputNodeIds) {
      const sourceNode = db.nodes.find((n) => n.id === sourceId && n.projectId === input.projectId)
      if (!sourceNode) continue
      db.edges.push({
        id: uid('canvas_edge'),
        projectId: input.projectId,
        boardId: input.boardId,
        userId: USER_ID,
        sourceNodeId: sourceId,
        targetNodeId: node.id,
        type: 'used_as_input',
        taskId,
        metadata: { manual: true },
        createdAt: at,
      })
    }
    updateProjectCounts(db, input.projectId)
    writeDb(db)
    return this.openSnapshot(input.projectId, input.boardId)
  },

  /**
   * 重试操作节点：基于原 task 参数创建全新 task + output 流程。
   * 旧 output 节点和旧 task 不动。新 output 放在旧 output 右侧。
   */
  async retryOperationNode(projectId: string, nodeId: string): Promise<CanvasSnapshot> {
    const db = readDb()
    const node = db.nodes.find((n) => n.id === nodeId && n.projectId === projectId && !n.hidden)
    if (!node || !node.taskId) throw new Error('操作节点未关联任务')
    const oldTask = db.tasks.find((t) => t.id === node.taskId && t.projectId === projectId)
    if (!oldTask) throw new Error('未找到原任务')
    const oldOutputNodes = db.nodes.filter((n) => oldTask.outputNodeIds.includes(n.id))
    const baseX = oldOutputNodes.length > 0
      ? Math.max(...oldOutputNodes.map((n) => n.x + n.width)) + 60
      : node.x + node.width + 60
    const baseY = node.y
    const request: CreateCanvasTaskRequest = {
      boardId: node.boardId,
      operation: oldTask.operation,
      prompt: oldTask.prompt ?? '',
      ...(oldTask.negativePrompt ? { negativePrompt: oldTask.negativePrompt } : {}),
      inputNodeIds: oldTask.inputNodeIds,
      ...(oldTask.inputAssetIds.length > 0 ? { inputAssetIds: oldTask.inputAssetIds } : {}),
      outputPlacement: { x: baseX, y: baseY },
      ...(oldTask.modelParams && Object.keys(oldTask.modelParams).length > 0
        ? { modelParams: oldTask.modelParams }
        : {}),
      ...(oldTask.providerProfileId ? { providerProfileId: oldTask.providerProfileId } : {}),
      ...(oldTask.manifestId ? { manifestId: oldTask.manifestId } : {}),
      ...(oldTask.modelId ? { modelId: oldTask.modelId } : {}),
    }
    // 复用 createMediaTask 完整链路（它创建新 task 节点 + IPC + 产出 output）
    return this.createMediaTask(projectId, request)
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
      // 类型化操作节点：type === operation（如 text_to_image）
      type: request.operation as CanvasNodeType,
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
      negativePrompt: request.negativePrompt ?? null,
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
      ...(request.negativePrompt != null ? { negativePrompt: request.negativePrompt } : {}),
      ...(request.inputFiles != null ? { inputFiles: request.inputFiles } : {}),
      ...(request.providerProfileId != null
        ? { providerProfileId: request.providerProfileId }
        : {}),
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
      !response.error &&
      response.status === 'succeeded' &&
      task.status === 'completed' &&
      task.outputAssetIds.length > 0 &&
      task.requestId === responseRequestId
    ) {
      return this.openSnapshot(projectId)
    }

    if (response.error || response.status === 'failed' || response.status === 'cancelled') {
      const isCancelled = response.status === 'cancelled'
      task.status = isCancelled ? 'cancelled' : 'failed'
      task.progress = 100
      task.errorMsg = response.error?.code ?? (isCancelled ? 'cancelled' : 'provider_task_failed')
      task.errorDetail =
        response.error?.message ?? (isCancelled ? '任务已取消' : 'Provider task failed')
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
        source:
          task.operation === 'image_edit' || task.operation === 'image_compose'
            ? 'ai_edited'
            : 'ai_generated',
        title: `${operationLabel(task.operation)} · ${response.provider}/${response.model}`,
        mimeType: assetOut.mimeType ?? null,
        storageKey: assetOut.filePath ?? null,
        url: displayUrl || null,
        thumbnailUrl: assetType === 'image' ? displayUrl || null : null,
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
        assetType === 'text'
          ? 'text'
          : assetType === 'image'
            ? 'image'
            : assetType === 'audio'
              ? 'audio'
              : assetType === 'video'
                ? 'video'
                : 'text'
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
  async listMediaModels(
    request: CanvasMediaModelsListRequest = {},
  ): Promise<CanvasMediaModelsListResponse> {
    return window.spark.invoke('canvas:media-models:list', request)
  },

  /** 查询单个 manifest 的完整调用/参数描述，供参数面板和 agent 节点编排使用 */
  async describeMediaModel(
    request: CanvasMediaModelDescribeRequest,
  ): Promise<CanvasMediaModelDescribeResponse> {
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

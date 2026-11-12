/**
 * 远程会话树的本地缓存。
 *
 * 为什么放在模块级而不是组件 state：视图是按需 lazy 挂载的，切走再回来组件就重建了，
 * 只有进程级缓存才能做到「回来立刻有内容、不重复拉」。
 *
 * 流量策略（目标端 GET /v1/projects 已带 sessionCount / runningSessionCount，
 * 所以项目层足够渲染层级与角标，会话只在该项目被展开时才拉）：
 *   - 项目列表 TTL 60s：一次响应约几百字节；
 *   - 单个项目会话 TTL 25s：只拉展开过的项目，每项目 limit 60；
 *   - 搜索命中才拉「全部会话」（limit 200），TTL 60s。
 * 旧的实现是一次拉 projects(100) + sessions(80)，后者带 preview 几十 KB，且滚不滚动都付。
 */
import type { MobileBridgeProjectSummary, MobileBridgeSessionSummary } from '@spark/protocol'

export const PROJECTS_TTL_MS = 60_000
export const SESSIONS_TTL_MS = 25_000
export const ALL_SESSIONS_TTL_MS = 60_000
/** 自动刷新间隔：只刷项目列表 + 已展开的项目，其余靠 TTL 跳过 */
export const REFRESH_INTERVAL_MS = 30_000
/** 未归属项目的虚拟 id（与目标端 / 小程序端同口径） */
export const UNASSIGNED_PROJECT_ID = 'default'

export interface RemoteSessionBucket {
  rows: MobileBridgeSessionSummary[]
  total: number
  fetchedAt: number
}

export interface RemoteDeviceSessionStore {
  /** 每次变更 +1，供 useSyncExternalStore 触发重渲染 */
  version: number
  projects: MobileBridgeProjectSummary[]
  /** 未归属（'default'）下的运行中会话数 */
  unassignedRunning: number
  projectsLoaded: boolean
  projectsFetchedAt: number
  /** projectId → 该项目的会话页 */
  sessions: Record<string, RemoteSessionBucket>
  /** 哪些项目当前展开（跨视图切换保留） */
  expanded: Record<string, boolean>
  /** 搜索用的全量会话（按需拉取） */
  allSessions: RemoteSessionBucket | null
}

const stores = new Map<string, RemoteDeviceSessionStore>()
const listeners = new Set<() => void>()

function createStore(): RemoteDeviceSessionStore {
  return {
    version: 0,
    projects: [],
    unassignedRunning: 0,
    projectsLoaded: false,
    projectsFetchedAt: 0,
    sessions: {},
    expanded: {},
    allSessions: null,
  }
}

export function getRemoteSessionStore(deviceId: string): RemoteDeviceSessionStore {
  const existing = stores.get(deviceId)
  if (existing != null) return existing
  const created = createStore()
  stores.set(deviceId, created)
  return created
}

export function subscribeRemoteSessionStore(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** 改完统一 bump version 并通知订阅者（store 是可变单例，调用点直接读最新值） */
export function updateRemoteSessionStore(
  deviceId: string,
  mutate: (store: RemoteDeviceSessionStore) => void,
): void {
  const store = getRemoteSessionStore(deviceId)
  mutate(store)
  store.version += 1
  for (const listener of listeners) listener()
}

export function isStale(fetchedAt: number, ttlMs: number, now = Date.now()): boolean {
  if (fetchedAt <= 0) return true
  return now - fetchedAt > ttlMs
}

// ─── 纯函数（单测覆盖） ─────────────────────────────────────────────────────

export interface RemoteProjectRow {
  id: string
  name: string
  /** 项目下会话总数（目标端给的，不用自己数） */
  sessionCount: number
  runningCount: number
  kind: 'project' | 'unassigned'
}

/**
 * 项目列表 → 渲染行。
 *
 * 目标端已按置顶/更新时间排好序，这里只把「未归属」补到最后一行：
 * 目标端只透出未归属的**运行中**数量，所以没有运行时默认不显示这一行
 * （与小程序端同口径），除非它被展开过 / 项目列表为空 / 搜索命中了它。
 */
export function buildProjectRows(
  projects: MobileBridgeProjectSummary[],
  unassignedRunning: number,
  includeUnassigned: boolean,
): RemoteProjectRow[] {
  const rows: RemoteProjectRow[] = projects.map((project) => ({
    id: project.id,
    name: project.name || '未命名项目',
    sessionCount: project.sessionCount ?? 0,
    runningCount: project.runningSessionCount ?? 0,
    kind: 'project',
  }))
  if (includeUnassigned) {
    rows.push({
      id: UNASSIGNED_PROJECT_ID,
      name: '未归属会话',
      sessionCount: 0,
      runningCount: unassignedRunning,
      kind: 'unassigned',
    })
  }
  return rows
}

/** 关键词匹配标题与预览（预览是最近一条用户消息，搜「我记得聊过什么」很有效） */
export function filterSessions(
  rows: MobileBridgeSessionSummary[],
  keyword: string,
): MobileBridgeSessionSummary[] {
  const normalized = keyword.trim().toLowerCase()
  if (normalized.length === 0) return rows
  return rows.filter((row) => {
    const title = (row.title ?? '').toLowerCase()
    const preview = (row.preview ?? '').toLowerCase()
    return title.includes(normalized) || preview.includes(normalized)
  })
}

export interface RemoteSearchGroup {
  projectId: string
  name: string
  sessions: MobileBridgeSessionSummary[]
}

/** 搜索结果按项目归组，顺序跟着项目列表，未归属/未知项目排最后 */
export function groupSessionsByProject(
  rows: MobileBridgeSessionSummary[],
  projects: MobileBridgeProjectSummary[],
): RemoteSearchGroup[] {
  const nameById = new Map(projects.map((project) => [project.id, project.name] as const))
  const buckets = new Map<string, MobileBridgeSessionSummary[]>()
  for (const row of rows) {
    const key = row.projectId ?? UNASSIGNED_PROJECT_ID
    const bucket = buckets.get(key)
    if (bucket == null) buckets.set(key, [row])
    else bucket.push(row)
  }

  const groups: RemoteSearchGroup[] = []
  for (const project of projects) {
    const bucket = buckets.get(project.id)
    if (bucket == null || bucket.length === 0) continue
    groups.push({ projectId: project.id, name: project.name || '未命名项目', sessions: bucket })
    buckets.delete(project.id)
  }
  for (const [projectId, bucket] of buckets) {
    groups.push({
      projectId,
      name:
        projectId === UNASSIGNED_PROJECT_ID
          ? '未归属会话'
          : (nameById.get(projectId) ?? '其它项目'),
      sessions: bucket,
    })
  }
  return groups
}

/** 相对时间：侧栏只到「天」，再久就没必要更细 */
export function formatRelativeTime(value: string, now = Date.now()): string {
  const then = new Date(value).getTime()
  if (Number.isNaN(then)) return ''
  const diff = now - then
  if (diff < 60_000) return '刚刚'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`
  return `${Math.floor(diff / 86_400_000)} 天前`
}

// ─── 本地写回（重命名 / 置顶 / 打标 / 删除 / 新建） ──────────────────────────

/**
 * 置顶区在前（按置顶时间倒序），其余按更新时间倒序。
 *
 * 目标端真实排序还叠了侧栏手动序，这里只是客户端写回后的近似——下一次
 * 定期刷新（30s）会用服务端结果覆盖，所以不需要在这里复刻手动序。
 */
export function sortSessionRows(rows: MobileBridgeSessionSummary[]): MobileBridgeSessionSummary[] {
  return [...rows].sort((a, b) => {
    const pinnedA = a.pinnedAt ?? null
    const pinnedB = b.pinnedAt ?? null
    if (pinnedA != null && pinnedB == null) return -1
    if (pinnedA == null && pinnedB != null) return 1
    if (pinnedA != null && pinnedB != null && pinnedA !== pinnedB) {
      return pinnedB.localeCompare(pinnedA)
    }
    return (b.updatedAt ?? '').localeCompare(a.updatedAt ?? '')
  })
}

function projectIdOf(session: MobileBridgeSessionSummary): string {
  return session.projectId ?? UNASSIGNED_PROJECT_ID
}

/** 写操作成功后本地回写，避免为一个字段再拉一次列表 */
export function patchSessionInStore(
  deviceId: string,
  sessionId: string,
  patch: Partial<MobileBridgeSessionSummary>,
): void {
  const resort = patch.pinnedAt !== undefined
  const apply = (rows: MobileBridgeSessionSummary[]) => {
    const next = rows.map((row) => (row.id === sessionId ? { ...row, ...patch } : row))
    return resort ? sortSessionRows(next) : next
  }
  updateRemoteSessionStore(deviceId, (store) => {
    for (const bucket of Object.values(store.sessions)) bucket.rows = apply(bucket.rows)
    if (store.allSessions != null) store.allSessions.rows = apply(store.allSessions.rows)
  })
}

/** 删除成功后本地移除，并把项目角标减一 */
export function removeSessionFromStore(
  deviceId: string,
  session: MobileBridgeSessionSummary,
): void {
  updateRemoteSessionStore(deviceId, (store) => {
    const projectId = projectIdOf(session)
    const bucket = store.sessions[projectId]
    if (bucket != null) {
      bucket.rows = bucket.rows.filter((row) => row.id !== session.id)
      bucket.total = Math.max(0, bucket.total - 1)
    }
    if (store.allSessions != null) {
      store.allSessions.rows = store.allSessions.rows.filter((row) => row.id !== session.id)
      store.allSessions.total = Math.max(0, store.allSessions.total - 1)
    }
    const project = store.projects.find((item) => item.id === projectId)
    if (project != null) {
      project.sessionCount = Math.max(0, (project.sessionCount ?? 0) - 1)
      if (session.status === 'running') {
        project.runningSessionCount = Math.max(0, (project.runningSessionCount ?? 0) - 1)
      }
    }
  })
}

/** 新建成功后插到对应项目顶部（该项目没展开过就不用管，展开时会重新拉） */
export function insertSessionInStore(deviceId: string, session: MobileBridgeSessionSummary): void {
  updateRemoteSessionStore(deviceId, (store) => {
    const projectId = projectIdOf(session)
    const bucket = store.sessions[projectId]
    if (bucket != null) {
      bucket.rows = [session, ...bucket.rows.filter((row) => row.id !== session.id)]
      bucket.total += 1
    }
    const project = store.projects.find((item) => item.id === projectId)
    if (project != null) project.sessionCount = (project.sessionCount ?? 0) + 1
  })
}

/** 项目改名 / 置顶走后端，回写项目行与已加载的会话所属项目名 */
export function patchProjectInStore(
  deviceId: string,
  projectId: string,
  patch: { name?: string; pinnedAt?: string | null },
): void {
  updateRemoteSessionStore(deviceId, (store) => {
    const project = store.projects.find((item) => item.id === projectId)
    if (project != null) {
      if (patch.name != null) project.name = patch.name
      if (patch.pinnedAt !== undefined) project.pinnedAt = patch.pinnedAt
    }
  })
}

/** 删除项目成功后整棵子树下架 */
export function removeProjectFromStore(deviceId: string, projectId: string): void {
  updateRemoteSessionStore(deviceId, (store) => {
    store.projects = store.projects.filter((item) => item.id !== projectId)
    delete store.sessions[projectId]
    delete store.expanded[projectId]
  })
}

/** 会话属于哪个项目（缓存的会话页是按项目存的，键就是 projectId） */
export function findSessionProjectId(deviceId: string, sessionId: string): string | null {
  const store = getRemoteSessionStore(deviceId)
  for (const [projectId, bucket] of Object.entries(store.sessions)) {
    if (bucket.rows.some((row) => row.id === sessionId)) return projectId
  }
  return null
}

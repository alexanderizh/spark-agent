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
import type {
  MobileBridgeEvent,
  MobileBridgeProjectSummary,
  MobileBridgeSessionSummary,
} from '@spark/protocol'

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
  /**
   * 目标端忽略了 offset（旧版本只认 limit）：「加载更多」返回的全是已加载的行。
   * 标上之后调用方不再给按钮，改为提示「目标电脑版本较旧」。
   */
  offsetUnsupported?: boolean
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

/**
 * 结果视图分页：按「全局条数」截断分组（不是每组各取 limit 条），
 * 返回截断后的分组与被折叠的条数，供「显示更多（还有 N 个）」使用。
 */
export function sliceSearchGroups(
  groups: RemoteSearchGroup[],
  limit: number,
): { groups: RemoteSearchGroup[]; hidden: number } {
  let budget = Math.max(0, limit)
  const sliced: RemoteSearchGroup[] = []
  let hidden = 0
  for (const group of groups) {
    if (budget <= 0) {
      hidden += group.sessions.length
      continue
    }
    const take = Math.min(budget, group.sessions.length)
    sliced.push({ ...group, sessions: group.sessions.slice(0, take) })
    budget -= take
    if (take < group.sessions.length) hidden += group.sessions.length - take
  }
  return { groups: sliced, hidden }
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

// ─── 实时事件回流（聊天区事件流 → 侧栏会话行） ──────────────────────────────

/** 与目标端 readSessionPreviews 同一截断口径（压缩空白 + 前 60 字） */
const PREVIEW_MAX_CHARS = 60

/** agent_status → 摘要 status（completed / cancelled 在摘要层都归为 idle） */
function statusFromAgentEvent(status: string): 'running' | 'idle' | 'error' | null {
  if (status === 'running') return 'running'
  if (status === 'idle' || status === 'completed' || status === 'cancelled') return 'idle'
  if (status === 'error') return 'error'
  return null
}

function previewFromContent(content: string): string {
  return content.replace(/\s+/g, ' ').trim().slice(0, PREVIEW_MAX_CHARS)
}

/**
 * 一批实时事件 → 会话摘要字段补丁（纯函数，单测覆盖）。
 *
 * 聊天区订阅的事件流此前只喂对话时间线，左侧列表要等下一轮 30s 轮询才看得到
 * 「运行中 ↔ 结束」与最新一条消息的变化。这里把 agent_status / user_message
 * 映射成 status / updatedAt / preview，让侧栏与聊天区保持同一节奏。
 *
 * 只做绝对值覆盖、不做计数增减：订阅重连会回放当前回合事件，绝对值幂等；
 * 项目角标仍由 30s 轮询校正，不在这里碰。无关事件（tool_call、assistant delta
 * 等）返回 null，调用方据此跳过写回。
 */
export function deriveLiveSessionPatch(
  events: readonly MobileBridgeEvent[],
): Partial<MobileBridgeSessionSummary> | null {
  let patch: Partial<MobileBridgeSessionSummary> | null = null
  for (const event of events) {
    if (event.type === 'user_message') {
      // user_message 没有 delta 语义，防御性跳过，避免把半截文本写进预览
      if (event.mode === 'delta') continue
      const preview = previewFromContent(event.content ?? '')
      if (preview.length === 0) continue
      patch = { ...(patch ?? {}), preview, updatedAt: event.timestamp }
    } else if (event.type === 'agent_status') {
      const status = statusFromAgentEvent(event.status ?? '')
      if (status == null) continue
      patch = { ...(patch ?? {}), status }
      // 回合开始的时间戳由 user_message 事件带；running 不动 updatedAt
      if (status !== 'running') patch.updatedAt = event.timestamp
    }
  }
  return patch
}

/** 实时事件写回侧栏缓存（会话不在任何已加载的桶里时跳过，避免无谓的 version bump） */
export function patchSessionFromLiveEvents(
  deviceId: string,
  sessionId: string,
  events: readonly MobileBridgeEvent[],
): void {
  const patch = deriveLiveSessionPatch(events)
  if (patch == null) return
  if (findSessionProjectId(deviceId, sessionId) == null) return
  patchSessionInStore(deviceId, sessionId, patch)
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

/**
 * 「加载更多」：把服务端下一页并进已有桶。
 *
 * 目标端返回的是「合并排序后的窗口」，所以只能追加、不能重排；
 * 若这一页一条新行都没有，说明目标端没认 offset（旧版本），标 offsetUnsupported
 * 让调用方收掉按钮——否则用户会看到一个点了没反应的「加载更多」。
 */
export function appendSessionPage(
  deviceId: string,
  projectId: string,
  page: { rows: MobileBridgeSessionSummary[]; total: number },
): void {
  updateRemoteSessionStore(deviceId, (store) => {
    const bucket = store.sessions[projectId]
    const existing = bucket?.rows ?? []
    const seen = new Set(existing.map((row) => row.id))
    const fresh = page.rows.filter((row) => !seen.has(row.id))
    if (bucket == null) {
      store.sessions[projectId] = { rows: page.rows, total: page.total, fetchedAt: Date.now() }
      return
    }
    bucket.rows = [...existing, ...fresh]
    bucket.total = Math.max(page.total, bucket.rows.length)
    bucket.fetchedAt = Date.now()
    if (fresh.length === 0 && page.rows.length > 0) bucket.offsetUnsupported = true
  })
}

/**
 * 新建成功后插到对应项目顶部（该项目没展开过就不用管，展开时会重新拉）。
 *
 * 全量窗口（搜索/筛选的结果视图）也要插：不插的话，刚建的会话在结果视图里
 * 既不会被后端那 200 条窗口带上，本地也找不到它——清掉筛选前等于凭空消失。
 */
export function insertSessionInStore(deviceId: string, session: MobileBridgeSessionSummary): void {
  updateRemoteSessionStore(deviceId, (store) => {
    const projectId = projectIdOf(session)
    const bucket = store.sessions[projectId]
    if (bucket != null) {
      bucket.rows = [session, ...bucket.rows.filter((row) => row.id !== session.id)]
      bucket.total += 1
    }
    if (store.allSessions != null && !store.allSessions.rows.some((row) => row.id === session.id)) {
      store.allSessions.rows = [session, ...store.allSessions.rows]
      store.allSessions.total += 1
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
  // 兜底：搜索/结果视图选中、或重启后恢复的会话，其项目桶可能从未展开过
  // （桶只在项目展开时才拉取）。从全量窗口里找，否则聊天头部「查看项目信息」
  // 在这类会话上点了没有任何反馈。
  const hit = store.allSessions?.rows.find((row) => row.id === sessionId)
  return hit?.projectId ?? (hit != null ? UNASSIGNED_PROJECT_ID : null)
}

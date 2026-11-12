/**
 * 远程视图的本地状态（上次选的设备 / 会话 / 展开的项目 / 输入区配置）。
 *
 * 为什么放在渲染端 localStorage 而不是主进程 settings：
 *   - 这些是「这台机器上这个窗口上次看到哪」的纯 UI 状态，不需要跨设备同步，
 *     也不需要主进程参与（设备备注名才要存 settings，因为它跟账号走）；
 *   - 同步读写，首帧就能拿到上次的会话，不会先渲染空态再跳一下。
 *
 * 数据是外来的（旧版本 / 手改 / 半截写入都可能），所以读的时候一律走
 * parseRemoteViewState 收敛：版本号不符直接重置，单个设备的脏字段丢掉，
 * 不影响其它设备。每类设备状态表最多 MAX_CACHED_DEVICES 项，超限后按写入顺序淘汰。
 */

export const REMOTE_VIEW_STATE_KEY = 'spark-agent:remote-view-state'
export const REMOTE_VIEW_STATE_VERSION = 1
/** 记住多少台设备的历史；超过按写入顺序淘汰最旧的（跳过当前设备） */
export const MAX_CACHED_DEVICES = 20

export interface RemoteSessionRef {
  sessionId: string
  /** 目标端项目 id；未归属 / 未知为 null */
  projectId: string | null
}

/** 输入区三件套的上次选择；新建会话时按目录校验后套用 */
export interface RemoteComposerPrefs {
  agentId?: string
  providerProfileId?: string
  /** null 表示自动路由或渠道默认模型，必须和 providerProfileId 一起持久化 */
  modelId?: string | null
  permissionMode?: string
}

export interface RemoteViewState {
  version: number
  /** 上次停留的设备（离线/不存在时由调用方回落，不在这里清） */
  lastDeviceId: string | null
  lastSessionByDevice: Record<string, RemoteSessionRef>
  /** 设备 → 展开过的项目 id 列表 */
  expandedByDevice: Record<string, string[]>
  composerByDevice: Record<string, RemoteComposerPrefs>
}

export interface RemoteViewStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

export function defaultRemoteViewState(): RemoteViewState {
  return {
    version: REMOTE_VIEW_STATE_VERSION,
    lastDeviceId: null,
    lastSessionByDevice: {},
    expandedByDevice: {},
    composerByDevice: {},
  }
}

function cleanString(value: unknown, maxLength = 200): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (trimmed.length === 0 || trimmed.length > maxLength) return null
  return trimmed
}

function asRecord(value: unknown): Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function parseSessionRef(value: unknown): RemoteSessionRef | null {
  const raw = asRecord(value)
  const sessionId = cleanString(raw.sessionId)
  if (sessionId == null) return null
  return { sessionId, projectId: cleanString(raw.projectId) }
}

function parseExpanded(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  const list: string[] = []
  for (const item of value) {
    const id = cleanString(item)
    if (id == null || seen.has(id)) continue
    seen.add(id)
    list.push(id)
    // 一个设备的展开列表没必要无限长
    if (list.length >= 100) break
  }
  return list
}

function parseComposerPrefs(value: unknown): RemoteComposerPrefs | null {
  const raw = asRecord(value)
  const prefs: RemoteComposerPrefs = {}
  const agentId = cleanString(raw.agentId)
  if (agentId != null) prefs.agentId = agentId
  const providerProfileId = cleanString(raw.providerProfileId)
  if (providerProfileId != null) prefs.providerProfileId = providerProfileId
  if (raw.modelId === null) prefs.modelId = null
  else {
    const modelId = cleanString(raw.modelId)
    if (modelId != null) prefs.modelId = modelId
  }
  const permissionMode = cleanString(raw.permissionMode)
  if (permissionMode != null) prefs.permissionMode = permissionMode
  return Object.keys(prefs).length > 0 ? prefs : null
}

/** 任意输入 → 合法状态（永不抛错） */
export function parseRemoteViewState(raw: string | null): RemoteViewState {
  const fallback = defaultRemoteViewState()
  if (raw == null || raw.trim().length === 0) return fallback
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return fallback
  }
  const data = asRecord(parsed)
  // 版本不符 = 结构可能已经变了，直接重置，不做迁移
  if (data.version !== REMOTE_VIEW_STATE_VERSION) return fallback

  const state = defaultRemoteViewState()
  state.lastDeviceId = cleanString(data.lastDeviceId)

  for (const [deviceId, value] of Object.entries(asRecord(data.lastSessionByDevice))) {
    const id = cleanString(deviceId)
    const ref = parseSessionRef(value)
    if (id == null || ref == null) continue
    state.lastSessionByDevice[id] = ref
  }
  for (const [deviceId, value] of Object.entries(asRecord(data.expandedByDevice))) {
    const id = cleanString(deviceId)
    if (id == null) continue
    const expanded = parseExpanded(value)
    if (expanded.length > 0) state.expandedByDevice[id] = expanded
  }
  for (const [deviceId, value] of Object.entries(asRecord(data.composerByDevice))) {
    const id = cleanString(deviceId)
    const prefs = parseComposerPrefs(value)
    if (id == null || prefs == null) continue
    state.composerByDevice[id] = prefs
  }
  return state
}

function resolveStorage(storage?: RemoteViewStorage | null): RemoteViewStorage | null {
  if (storage !== undefined) return storage
  if (typeof window === 'undefined') return null
  try {
    return window.localStorage
  } catch {
    // 隐私模式 / 被策略禁用：退化为不持久化，不影响功能
    return null
  }
}

export function readRemoteViewState(storage?: RemoteViewStorage | null): RemoteViewState {
  const target = resolveStorage(storage)
  if (target == null) return defaultRemoteViewState()
  try {
    return parseRemoteViewState(target.getItem(REMOTE_VIEW_STATE_KEY))
  } catch {
    return defaultRemoteViewState()
  }
}

function writeRemoteViewState(
  state: RemoteViewState,
  storage?: RemoteViewStorage | null,
): RemoteViewState {
  const target = resolveStorage(storage)
  if (target == null) return state
  try {
    target.setItem(REMOTE_VIEW_STATE_KEY, JSON.stringify(state))
  } catch {
    // 配额满 / 禁用：这次没存上就算了，下一次写还会再试
  }
  return state
}

/**
 * 设备数超限时淘汰：对象键序就是写入顺序（老设备在前），从头砍并始终保留当前设备。
 * 严格 LRU 要额外记访问序，这里够用——目的只是不让状态无限长胖。
 */
function capDeviceMap<T>(map: Record<string, T>, keepId: string): Record<string, T> {
  const ids = Object.keys(map)
  if (ids.length <= MAX_CACHED_DEVICES) return map
  for (const id of ids) {
    if (Object.keys(map).length <= MAX_CACHED_DEVICES) break
    if (id === keepId) continue
    delete map[id]
  }
  return map
}

/** 记住「上次在这台设备上」+ 上次停留的设备 */
export function rememberLastDevice(
  deviceId: string,
  storage?: RemoteViewStorage | null,
): RemoteViewState {
  const state = readRemoteViewState(storage)
  state.lastDeviceId = deviceId
  return writeRemoteViewState(state, storage)
}

/** 记住某台设备最后打开的会话（置 null 表示清掉） */
export function rememberLastSession(
  deviceId: string,
  ref: RemoteSessionRef | null,
  storage?: RemoteViewStorage | null,
): RemoteViewState {
  const state = readRemoteViewState(storage)
  if (ref == null) delete state.lastSessionByDevice[deviceId]
  else state.lastSessionByDevice[deviceId] = ref
  capDeviceMap(state.lastSessionByDevice, deviceId)
  return writeRemoteViewState(state, storage)
}

/** 记住展开的项目（顺序按传入顺序写，便于淘汰时判断新旧） */
export function rememberExpandedProjects(
  deviceId: string,
  expanded: Record<string, boolean> | string[],
  storage?: RemoteViewStorage | null,
): RemoteViewState {
  const state = readRemoteViewState(storage)
  const ids = Array.isArray(expanded)
    ? expanded
    : Object.entries(expanded)
        .filter(([, open]) => open)
        .map(([id]) => id)
  if (ids.length === 0) delete state.expandedByDevice[deviceId]
  else state.expandedByDevice[deviceId] = ids
  capDeviceMap(state.expandedByDevice, deviceId)
  return writeRemoteViewState(state, storage)
}

export function readExpandedProjects(
  deviceId: string,
  storage?: RemoteViewStorage | null,
): string[] {
  return readRemoteViewState(storage).expandedByDevice[deviceId] ?? []
}

export function readLastSession(
  deviceId: string,
  storage?: RemoteViewStorage | null,
): RemoteSessionRef | null {
  return readRemoteViewState(storage).lastSessionByDevice[deviceId] ?? null
}

/** 记住输入区上次选的助手/模型/权限（按设备，覆盖式合并） */
export function rememberComposerPrefs(
  deviceId: string,
  prefs: RemoteComposerPrefs,
  storage?: RemoteViewStorage | null,
): RemoteViewState {
  const state = readRemoteViewState(storage)
  const merged: RemoteComposerPrefs = { ...state.composerByDevice[deviceId], ...prefs }
  for (const key of Object.keys(merged) as (keyof RemoteComposerPrefs)[]) {
    // modelId=null 是自动路由 / 渠道默认模型的有效选择，不能按空值清理。
    if (merged[key] === undefined || merged[key] === '') delete merged[key]
  }
  if (Object.keys(merged).length === 0) delete state.composerByDevice[deviceId]
  else state.composerByDevice[deviceId] = merged
  capDeviceMap(state.composerByDevice, deviceId)
  return writeRemoteViewState(state, storage)
}

export function readComposerPrefs(
  deviceId: string,
  storage?: RemoteViewStorage | null,
): RemoteComposerPrefs | null {
  return readRemoteViewState(storage).composerByDevice[deviceId] ?? null
}

/** 会话被删 / 已不存在：只清「记住的会话」，展开状态与偏好保留 */
export function forgetLastSession(
  deviceId: string,
  sessionId: string,
  storage?: RemoteViewStorage | null,
): void {
  const state = readRemoteViewState(storage)
  if (state.lastSessionByDevice[deviceId]?.sessionId !== sessionId) return
  delete state.lastSessionByDevice[deviceId]
  writeRemoteViewState(state, storage)
}

/** 项目被删：该项目下记住的会话一起清掉（只清一个的话下次进来必定 404） */
export function forgetProjectSessions(
  deviceId: string,
  projectId: string,
  storage?: RemoteViewStorage | null,
): void {
  const state = readRemoteViewState(storage)
  if (state.lastSessionByDevice[deviceId]?.projectId !== projectId) return
  delete state.lastSessionByDevice[deviceId]
  writeRemoteViewState(state, storage)
}

/** 设备被删 / 退出账号时整台清掉 */
export function forgetDevice(deviceId: string, storage?: RemoteViewStorage | null): void {
  const state = readRemoteViewState(storage)
  delete state.lastSessionByDevice[deviceId]
  delete state.expandedByDevice[deviceId]
  delete state.composerByDevice[deviceId]
  if (state.lastDeviceId === deviceId) state.lastDeviceId = null
  writeRemoteViewState(state, storage)
}

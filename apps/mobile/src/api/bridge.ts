/**
 * 桌面端桥接 API。
 *
 * 小程序经局域网直连桌面端 MobileBridgeService（HTTP + WebSocket）：
 *   pair     账号 token 换设备令牌（同账号即授权）
 *   sessions 会话列表 / 新建
 *   messages 会话历史
 *   turns    提交回合 / 取消
 *   stream   WebSocket 增量事件流
 *
 * 服务端地址在「我的 → 移动桥接」里配置（如 http://192.168.1.5:3721）。
 */

import { getItem, removeItem, setItem } from '../utils/storage'

const BridgeKeys = {
  serverUrl: 'spark-mobile:bridge-url',
  deviceToken: 'spark-mobile:bridge-device-token',
  deviceId: 'spark-mobile:bridge-device-id',
} as const

export interface BridgeSessionRuntime {
  providerProfileId?: string
  modelId?: string | null
  agentAdapter?: string
  agentId?: string | null
  permissionMode?: string
  reasoningEffort?: string
  chatMode?: string
  /** 所属项目（workspace）id；'default' = 未归属 */
  projectId?: string
  workflowBinding?: { mode: 'inherit' | 'override' | 'disabled'; workflowId: string | null } | null
}

export interface BridgeSessionSummary {
  id: string
  title: string
  status: string
  updatedAt: string
  preview: string
  /** 所属项目 id（'default' 表示未归属项目）；旧版桌面端不返回该字段 */
  projectId?: string
  pinnedAt?: string | null
  /** 当前运行配置（配置条数据源；旧版桌面端不返回） */
  runtime?: BridgeSessionRuntime
}

export interface BridgeCatalogAgent {
  id: string
  name: string
  description: string
  agentAdapter: string
  providerProfileId?: string | null
  modelId?: string | null
  permissionMode?: string
  reasoningEffort?: string
  isDefault: boolean
}

export interface BridgeCatalogWorkflow {
  id: string
  name: string
  description: string
  enabled: boolean
}

export interface BridgeCatalogProvider {
  id: string
  name: string
  providerType: string
  isAutoRouter: boolean
  models: { id: string; name: string }[]
}

export interface BridgeCatalog {
  agents: BridgeCatalogAgent[]
  workflows: BridgeCatalogWorkflow[]
  providers: BridgeCatalogProvider[]
  permissionModes: Record<string, string[]>
  reasoningEfforts: string[]
}

export interface BridgeAttachment {
  type: 'image' | 'file'
  path: string
  name?: string
}

export interface BridgeScheduledTask {
  id: string
  name: string
  description: string
  enabled: boolean
  triggerType: 'interval' | 'cron' | 'once'
  intervalSeconds?: number | null
  cronExpression?: string | null
  runAt?: string | null
  prompt: string
  status: string
  executionCount: number
  lastRunAt?: string | null
  nextRunAt?: string | null
  lastError?: string | null
}

export interface BridgeCommandItem {
  name: string
  description: string
  layer: string
  usage?: string
}

export interface BridgeProjectSummary {
  id: string
  name: string
  rootPath: string
  projectKind: string
  pinnedAt: string | null
  updatedAt: string
  /** 项目下未归档会话数 */
  sessionCount: number
}

export type BridgeEventType =
  | 'user_message'
  | 'assistant_message'
  | 'tool_call'
  | 'tool_result'
  | 'agent_status'
  | 'agent_error'

export interface BridgeEvent {
  id: string
  seq: number
  turnId: string
  type: BridgeEventType
  timestamp: string
  content?: string
  mode?: 'delta' | 'complete'
  isFinal?: boolean
  segmentId?: string
  toolName?: string
  toolCallId?: string
  toolStatus?: 'success' | 'error'
  status?: string
  statusMessage?: string
}

export interface BridgePairResult {
  deviceToken: string
  deviceId: string
  account: string
  desktop: { name: string; version: string }
}

// ─── 连接配置 ─────────────────────────────────────────────────────────────────

export function getServerUrl(): string {
  return getItem<string>(BridgeKeys.serverUrl) ?? ''
}

/**
 * 归一化桌面端地址：扫码得到的内容可能是
 *   - 纯地址：`192.168.1.5:3721` / `http://192.168.1.5:3721`
 *   - JSON：`{"host":"192.168.1.5","port":3721}`（桌面端二维码可输出这种）
 * 非法内容返回 null。
 */
export function normalizeBridgeUrl(raw: string): string | null {
  const text = (raw ?? '').trim()
  if (!text) return null
  let candidate = text
  if (text.startsWith('{')) {
    try {
      const parsed = JSON.parse(text) as { url?: string; host?: string; port?: number | string }
      if (typeof parsed.url === 'string') candidate = parsed.url
      else if (typeof parsed.host === 'string')
        candidate = `http://${parsed.host}${parsed.port ? `:${parsed.port}` : ''}`
    } catch {
      return null
    }
  }
  if (!/^https?:\/\//i.test(candidate)) candidate = `http://${candidate}`
  candidate = candidate.replace(/\/+$/, '')
  if (!/^https?:\/\/[\w.-]+(:\d+)?(\/.*)?$/i.test(candidate)) return null
  return candidate
}

export function setServerUrl(url: string): void {
  setItem(BridgeKeys.serverUrl, url.replace(/\/+$/, ''))
}

export function getDeviceToken(): string | null {
  return getItem<string>(BridgeKeys.deviceToken)
}

function saveDevice(deviceToken: string, deviceId: string): void {
  setItem(BridgeKeys.deviceToken, deviceToken)
  setItem(BridgeKeys.deviceId, deviceId)
}

export function clearDevice(): void {
  removeItem(BridgeKeys.deviceToken)
  removeItem(BridgeKeys.deviceId)
}

export function isPaired(): boolean {
  return getDeviceToken() != null
}

// ─── 错误分类 ─────────────────────────────────────────────────────────────────
// 只抛一句「配对失败」没有任何排查价值，所以把失败原因分类并带上可执行的提示。

export type BridgeErrorReason =
  | 'NO_URL'
  | 'NETWORK'
  | 'DOMAIN'
  | 'DISABLED'
  | 'EXPIRED'
  | 'AUTH'
  | 'SERVER'
  | 'UNKNOWN'

export class BridgeError extends Error {
  readonly reason: BridgeErrorReason
  /** 给用户的下一步建议 */
  readonly hint: string

  constructor(reason: BridgeErrorReason, message: string, hint: string) {
    super(message)
    this.name = 'BridgeError'
    this.reason = reason
    this.hint = hint
  }
}

const HINTS: Record<BridgeErrorReason, string> = {
  NO_URL: '先在下方填写桌面端地址，或点「扫码」扫设置页的二维码',
  NETWORK: '确认手机与电脑在同一 Wi-Fi、桌面端「移动端桥接」已开启、端口未被防火墙拦截',
  DOMAIN:
    '开发期请在开发者工具「详情 → 本地设置」勾选「不校验合法域名」；正式版需在 mp 后台配置 request 合法域名',
  DISABLED: '请到桌面端「设置 → 生态 → 移动端桥接」打开开关',
  EXPIRED: '设备令牌已失效，请重新配对',
  AUTH: '两端必须登录同一个 edu-server 账号，请检查后重新配对',
  SERVER: '桌面端返回了错误，可在桌面端日志中查看原因',
  UNKNOWN: '可重试一次，仍失败请查看桌面端日志',
}

/**
 * 解析响应体。wx.request 在响应为 JSON（Content-Type: application/json）时会
 * 自动把 res.data 解析成对象，字符串分支只兜底纯文本响应；两者都不是则返回 null。
 */
function parseBody<T>(data: unknown): T | null {
  if (data != null && typeof data === 'object') return data as T
  if (typeof data === 'string' && data.trim()) {
    try {
      return JSON.parse(data) as T
    } catch {
      return null
    }
  }
  return null
}

/** wx.request 的 fail 原因归类 */
function classifyNetwork(errMsg: string): { reason: BridgeErrorReason; message: string } {
  if (/not in domain|不在以下/.test(errMsg)) {
    return { reason: 'DOMAIN', message: '小程序未允许访问该域名' }
  }
  if (/timeout|超时/.test(errMsg)) {
    return { reason: 'NETWORK', message: '连接桌面端超时' }
  }
  return { reason: 'NETWORK', message: '无法连接桌面端' }
}

function normalize(error: unknown): BridgeError {
  if (error instanceof BridgeError) return error
  const message = error instanceof Error ? error.message : String(error)
  return new BridgeError('UNKNOWN', message, HINTS.UNKNOWN)
}

/** 把任意错误转成一段可直接展示给用户的文案 */
export function describeBridgeError(error: unknown): { message: string; hint: string } {
  const e = normalize(error)
  return { message: e.message, hint: e.hint }
}

// ─── 请求 ─────────────────────────────────────────────────────────────────────

function buildUrl(path: string): string {
  const base = getServerUrl()
  if (!base) throw new BridgeError('NO_URL', '尚未配置桌面端地址', HINTS.NO_URL)
  return `${base}${path}`
}

function authHeader(): Record<string, string> {
  const token = getDeviceToken()
  return token ? { Authorization: `Bearer ${token}` } : {}
}

function request<T>(path: string, method: string, data?: Record<string, unknown>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    wx.request({
      url: buildUrl(path),
      method: method as 'GET' | 'POST',
      timeout: 30_000,
      data,
      header: { 'Content-Type': 'application/json', ...authHeader() },
      success: (res) => {
        if (res.statusCode === 401) {
          clearDevice()
          reject(new BridgeError('EXPIRED', '设备配对已失效，请重新配对', HINTS.EXPIRED))
          return
        }
        const body = parseBody<{ error?: { code?: string; message?: string } }>(res.data)
        if (!body) {
          reject(new BridgeError('SERVER', `桌面端响应异常 (${res.statusCode})`, HINTS.SERVER))
          return
        }
        if (res.statusCode >= 400) {
          const code = body?.error?.code
          const reason: BridgeErrorReason =
            code === 'BRIDGE_DISABLED' ? 'DISABLED' : code === 'UNAUTHORIZED' ? 'AUTH' : 'SERVER'
          reject(
            new BridgeError(
              reason,
              body?.error?.message ?? `请求失败 (${res.statusCode})`,
              HINTS[reason],
            ),
          )
          return
        }
        resolve(body as unknown as T)
      },
      fail: (err) => {
        const { reason, message } = classifyNetwork(err.errMsg || '')
        reject(new BridgeError(reason, message, HINTS[reason]))
      },
    })
  })
}

/** 配对：用 edu-server 账号 token 换设备令牌 */
export function pair(accountToken: string, deviceLabel?: string): Promise<BridgePairResult> {
  return new Promise<BridgePairResult>((resolve, reject) => {
    wx.request({
      url: buildUrl('/v1/pair'),
      method: 'POST',
      timeout: 20_000,
      data: { accountToken, ...(deviceLabel ? { deviceLabel } : {}) },
      header: { 'Content-Type': 'application/json' },
      success: (res) => {
        const body = parseBody<BridgePairResult & { error?: { code?: string; message?: string } }>(
          res.data,
        )
        if (!body) {
          reject(new BridgeError('SERVER', `配对响应异常 (${res.statusCode})`, HINTS.SERVER))
          return
        }
        if (res.statusCode >= 400 || body?.deviceToken == null) {
          const code = body?.error?.code
          const reason: BridgeErrorReason =
            code === 'BRIDGE_DISABLED'
              ? 'DISABLED'
              : code === 'UNAUTHORIZED'
                ? 'AUTH'
                : res.statusCode === 401
                  ? 'AUTH'
                  : 'SERVER'
          reject(new BridgeError(reason, body?.error?.message ?? '配对失败', HINTS[reason]))
          return
        }
        saveDevice(body.deviceToken, body.deviceId)
        resolve(body)
      },
      fail: (err) => {
        const { reason, message } = classifyNetwork(err.errMsg || '')
        reject(new BridgeError(reason, `${message}，无法完成配对`, HINTS[reason]))
      },
    })
  })
}

export function listSessions(
  limit = 50,
  projectId?: string,
): Promise<{ sessions: BridgeSessionSummary[]; total: number }> {
  const query = projectId ? `&projectId=${encodeURIComponent(projectId)}` : ''
  return request<{ sessions: BridgeSessionSummary[]; total: number }>(
    `/v1/sessions?limit=${limit}${query}`,
    'GET',
  )
}

export function listProjects(
  limit = 100,
): Promise<{ projects: BridgeProjectSummary[]; total: number }> {
  return request<{ projects: BridgeProjectSummary[]; total: number }>(
    `/v1/projects?limit=${limit}`,
    'GET',
  )
}

export function listProjectSessions(
  projectId: string,
  limit = 50,
): Promise<{ sessions: BridgeSessionSummary[]; total: number }> {
  return request<{ sessions: BridgeSessionSummary[]; total: number }>(
    `/v1/projects/${encodeURIComponent(projectId)}/sessions?limit=${limit}`,
    'GET',
  )
}

export function createSession(
  title?: string,
  projectId?: string,
): Promise<{ session: BridgeSessionSummary }> {
  return request<{ session: BridgeSessionSummary }>('/v1/sessions', 'POST', {
    ...(title ? { title } : {}),
    ...(projectId ? { projectId } : {}),
  })
}

/** 重命名 / 置顶 / 归档 / 运行时配置 / 项目归属（仅传需要修改的字段） */
export function updateSession(
  sessionId: string,
  patch: {
    title?: string
    pinned?: boolean
    archived?: boolean
    providerProfileId?: string
    modelId?: string | null
    agentAdapter?: string
    agentId?: string | null
    permissionMode?: string
    reasoningEffort?: string
    chatMode?: string
    projectId?: string
  },
): Promise<{ session: BridgeSessionSummary }> {
  return request<{ session: BridgeSessionSummary }>(
    `/v1/sessions/${encodeURIComponent(sessionId)}`,
    'PATCH',
    patch as unknown as Record<string, unknown>,
  )
}

export function renameSession(
  sessionId: string,
  title: string,
): Promise<{ session: BridgeSessionSummary }> {
  return updateSession(sessionId, { title })
}

export function deleteSession(sessionId: string): Promise<{ deleted: boolean }> {
  return new Promise<{ deleted: boolean }>((resolve, reject) => {
    wx.request({
      url: buildUrl(`/v1/sessions/${encodeURIComponent(sessionId)}`),
      method: 'DELETE',
      timeout: 30_000,
      header: { ...authHeader() },
      success: (res) => {
        if (res.statusCode === 401) {
          clearDevice()
          reject(new BridgeError('EXPIRED', '设备配对已失效，请重新配对', HINTS.EXPIRED))
          return
        }
        const body = parseBody<{ deleted?: boolean; error?: { message?: string } }>(res.data)
        if (res.statusCode >= 400 || body == null) {
          reject(
            new BridgeError(
              'SERVER',
              body?.error?.message ?? `删除失败 (${res.statusCode})`,
              HINTS.SERVER,
            ),
          )
          return
        }
        resolve({ deleted: body.deleted !== false })
      },
      fail: (err) => {
        const { reason, message } = classifyNetwork(err.errMsg || '')
        reject(new BridgeError(reason, message, HINTS[reason]))
      },
    })
  })
}

export function getMessages(
  sessionId: string,
  limit = 200,
): Promise<{ sessionId: string; events: BridgeEvent[]; running: boolean }> {
  return request<{ sessionId: string; events: BridgeEvent[]; running: boolean }>(
    `/v1/sessions/${encodeURIComponent(sessionId)}/messages?limit=${limit}`,
    'GET',
  )
}

export function submitTurn(
  sessionId: string,
  text: string,
  attachmentPaths?: string[],
): Promise<{ turnId: string }> {
  return request<{ turnId: string }>(
    `/v1/sessions/${encodeURIComponent(sessionId)}/turns`,
    'POST',
    {
      text,
      ...(attachmentPaths != null && attachmentPaths.length > 0 ? { attachmentPaths } : {}),
    },
  )
}

export function cancelTurn(sessionId: string): Promise<{ cancelled: boolean }> {
  return request<{ cancelled: boolean }>(
    `/v1/sessions/${encodeURIComponent(sessionId)}/cancel`,
    'POST',
  )
}

/** 探测桌面端是否可达（健康检查） */
export function ping(): Promise<boolean> {
  return new Promise((resolve) => {
    wx.request({
      url: buildUrl('/v1/health'),
      timeout: 5_000,
      success: (res) => resolve(res.statusCode === 200),
      fail: () => resolve(false),
    })
  })
}

// ─── 会话内配置与输入能力扩展（2026-10-14） ─────────────────────────────────────

/** 大 body 专用请求（附件上传/语音转写，放宽超时） */
function largeRequest<T>(path: string, data: Record<string, unknown>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    wx.request({
      url: buildUrl(path),
      method: 'POST',
      timeout: 120_000,
      data,
      header: { 'Content-Type': 'application/json', ...authHeader() },
      success: (res) => {
        if (res.statusCode === 401) {
          clearDevice()
          reject(new BridgeError('EXPIRED', '设备配对已失效，请重新配对', HINTS.EXPIRED))
          return
        }
        const body = parseBody<{ error?: { code?: string; message?: string } }>(res.data)
        if (!body || res.statusCode >= 400) {
          reject(
            new BridgeError(
              'SERVER',
              body?.error?.message ?? `请求失败 (${res.statusCode})`,
              HINTS.SERVER,
            ),
          )
          return
        }
        resolve(body as unknown as T)
      },
      fail: (err) => {
        const { reason, message } = classifyNetwork(err.errMsg || '')
        reject(new BridgeError(reason, message, HINTS[reason]))
      },
    })
  })
}

/** 选项目录（助手/工作流/对话渠道/权限与推理枚举），聊天页进入时一次拉全 */
export function getCatalog(): Promise<BridgeCatalog> {
  return request<BridgeCatalog>('/v1/catalog', 'GET')
}

/** 会话运行配置摘要 */
export function getSessionRuntime(sessionId: string): Promise<{ runtime: BridgeSessionRuntime }> {
  return request<{ runtime: BridgeSessionRuntime }>(
    `/v1/sessions/${encodeURIComponent(sessionId)}/runtime`,
    'GET',
  )
}

export interface BridgeWorkflowBinding {
  binding: { mode: 'inherit' | 'override' | 'disabled'; workflowId: string | null } | null
  effectiveName: string | null
  canChange: boolean
  error: string | null
}

export function getWorkflowBinding(sessionId: string): Promise<BridgeWorkflowBinding> {
  return request<BridgeWorkflowBinding>(
    `/v1/sessions/${encodeURIComponent(sessionId)}/workflow`,
    'GET',
  )
}

export function setWorkflowBinding(
  sessionId: string,
  mode: 'inherit' | 'override' | 'disabled',
  workflowId?: string,
): Promise<BridgeWorkflowBinding> {
  return request<BridgeWorkflowBinding>(
    `/v1/sessions/${encodeURIComponent(sessionId)}/workflow`,
    'PUT',
    { mode, ...(workflowId ? { workflowId } : {}) } as unknown as Record<string, unknown>,
  )
}

/** 附件上传（base64 → 桌面端白名单目录落盘；返回可直接随 turns 提交的 path） */
export function uploadAttachments(
  sessionId: string,
  files: { name: string; mimeType?: string; dataBase64: string }[],
): Promise<{ attachments: BridgeAttachment[] }> {
  return largeRequest<{ attachments: BridgeAttachment[] }>(
    `/v1/sessions/${encodeURIComponent(sessionId)}/attachments`,
    { files },
  )
}

/** 附件预览地址（wx.previewImage 无法带 header，走 query token） */
export function buildAttachmentPreviewUrl(path: string): string {
  const token = getDeviceToken() ?? ''
  return `${buildUrl('/v1/attachments/content')}?path=${encodeURIComponent(path)}&token=${encodeURIComponent(token)}`
}

/** 语音转写（本地 SenseVoice → 云渠道兜底） */
export function transcribeAudio(
  audioBase64: string,
  mimeType: string,
): Promise<{ text: string; engine: 'local' | 'cloud' }> {
  return largeRequest<{ text: string; engine: 'local' | 'cloud' }>('/v1/transcribe', {
    audioBase64,
    mimeType,
  })
}

export function listSessionTasks(sessionId: string): Promise<{ tasks: BridgeScheduledTask[] }> {
  return request<{ tasks: BridgeScheduledTask[] }>(
    `/v1/sessions/${encodeURIComponent(sessionId)}/tasks`,
    'GET',
  )
}

export interface BridgeCreateTaskInput {
  name: string
  prompt: string
  triggerType: 'interval' | 'cron' | 'once'
  intervalSeconds?: number
  cronExpression?: string
  runAt?: string
  timeoutSeconds?: number
  maxRetries?: number
}

export function createSessionTask(
  sessionId: string,
  input: BridgeCreateTaskInput,
): Promise<{ task: BridgeScheduledTask }> {
  return request<{ task: BridgeScheduledTask }>(
    `/v1/sessions/${encodeURIComponent(sessionId)}/tasks`,
    'POST',
    input as unknown as Record<string, unknown>,
  )
}

export function updateSessionTask(
  taskId: string,
  patch: {
    name?: string
    prompt?: string
    triggerType?: 'interval' | 'cron' | 'once'
    intervalSeconds?: number | null
    cronExpression?: string | null
    runAt?: string | null
    enabled?: boolean
  },
): Promise<{ task: BridgeScheduledTask }> {
  return request<{ task: BridgeScheduledTask }>(
    `/v1/tasks/${encodeURIComponent(taskId)}`,
    'PATCH',
    patch as unknown as Record<string, unknown>,
  )
}

export function deleteSessionTask(taskId: string): Promise<{ deleted: boolean }> {
  return new Promise<{ deleted: boolean }>((resolve, reject) => {
    wx.request({
      url: buildUrl(`/v1/tasks/${encodeURIComponent(taskId)}`),
      method: 'DELETE',
      timeout: 30_000,
      header: { ...authHeader() },
      success: (res) => {
        const body = parseBody<{ deleted?: boolean; error?: { message?: string } }>(res.data)
        if (res.statusCode >= 400 || body == null) {
          reject(
            new BridgeError(
              'SERVER',
              body?.error?.message ?? `删除失败 (${res.statusCode})`,
              HINTS.SERVER,
            ),
          )
          return
        }
        resolve({ deleted: body.deleted !== false })
      },
      fail: (err) => {
        const { reason, message } = classifyNetwork(err.errMsg || '')
        reject(new BridgeError(reason, message, HINTS[reason]))
      },
    })
  })
}

export function toggleSessionTask(
  taskId: string,
  enabled: boolean,
): Promise<{ task: BridgeScheduledTask }> {
  return request<{ task: BridgeScheduledTask }>(
    `/v1/tasks/${encodeURIComponent(taskId)}/toggle`,
    'POST',
    { enabled },
  )
}

export function runSessionTaskNow(taskId: string): Promise<{ started: boolean }> {
  return request<{ started: boolean }>(`/v1/tasks/${encodeURIComponent(taskId)}/run`, 'POST')
}

export function listCommands(sessionId: string): Promise<{ commands: BridgeCommandItem[] }> {
  return request<{ commands: BridgeCommandItem[] }>(
    `/v1/commands?sessionId=${encodeURIComponent(sessionId)}`,
    'GET',
  )
}

export function executeCommand(
  sessionId: string,
  raw: string,
): Promise<{ isCommand: boolean; forwardToAgent: boolean; queued?: boolean; message?: string }> {
  return request<{
    isCommand: boolean
    forwardToAgent: boolean
    queued?: boolean
    message?: string
  }>(`/v1/sessions/${encodeURIComponent(sessionId)}/commands`, 'POST', { raw })
}

// ─── WebSocket 流 ─────────────────────────────────────────────────────────────

export interface StreamHandlers {
  /** 连接真正建立（wx onOpen）后回调；connected 状态以此为准 */
  onOpen?(): void
  onEvent(events: BridgeEvent[]): void
  onError(message: string): void
  onClose(): void
}

/**
 * 连接会话事件流，断线自动重连（指数退避 1s→15s 封顶）。
 * 返回关闭函数；聊天页 onUnload 统一关闭。
 */
export function connectStream(sessionId: string, handlers: StreamHandlers): () => void {
  const base = getServerUrl()
  if (!base) {
    handlers.onError('尚未配置桌面端地址')
    return () => {}
  }
  const token = getDeviceToken()
  if (!token) {
    handlers.onError('设备未配对')
    return () => {}
  }
  const wsUrl =
    base.replace(/^http/, 'ws') +
    `/v1/stream?sessionId=${encodeURIComponent(sessionId)}&token=${encodeURIComponent(token)}`

  let closed = false
  let keepAlive: ReturnType<typeof setInterval> | null = null
  let retryTimer: ReturnType<typeof setTimeout> | null = null
  let retryCount = 0
  /** onError/onClose 可能同拍触发，防重复排程重连 */
  let reconnectPending = false

  const openSocket = () => {
    if (closed) return
    const socket = wx.connectSocket({ url: wsUrl, timeout: 12_000 })

    socket.onOpen(() => {
      retryCount = 0
      reconnectPending = false
      // 小程序侧 keep-alive：每 25s 发一个空文本帧，避免连接被中间网络回收
      if (keepAlive != null) clearInterval(keepAlive)
      keepAlive = setInterval(() => {
        if (!closed) socket.send({ data: '{}', fail: () => {} })
      }, 25_000)
      handlers.onOpen?.()
    })
    socket.onMessage((res) => {
      let payload: { type?: string; events?: BridgeEvent[]; message?: string }
      try {
        payload = JSON.parse(res.data as string)
      } catch {
        return
      }
      if (payload?.type === 'events' && Array.isArray(payload.events)) {
        handlers.onEvent(payload.events)
      } else if (payload?.type === 'error') {
        handlers.onError(payload.message ?? '流连接错误')
      }
    })
    const scheduleReconnect = () => {
      if (closed || reconnectPending) return
      reconnectPending = true
      if (keepAlive != null) {
        clearInterval(keepAlive)
        keepAlive = null
      }
      const delay = Math.min(1000 * 2 ** retryCount, 15_000)
      retryCount += 1
      retryTimer = setTimeout(() => {
        retryTimer = null
        reconnectPending = false
        openSocket()
      }, delay)
    }
    socket.onError(() => {
      if (closed) return
      handlers.onError('流连接失败')
      scheduleReconnect()
    })
    socket.onClose(() => {
      if (closed) return
      handlers.onClose()
      scheduleReconnect()
    })
  }

  openSocket()

  return () => {
    closed = true
    if (keepAlive != null) clearInterval(keepAlive)
    if (retryTimer != null) clearTimeout(retryTimer)
  }
}

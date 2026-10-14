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

import { getItem, removeItem, setItem, StorageKeys } from '../utils/storage'
import * as relay from './relay'
import { BridgeError, BRIDGE_HINTS } from './bridge-error'
import type { BridgeErrorReason } from './bridge-error'

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

// ─── 云端中继开关 ─────────────────────────────────────────────────────────────
// 中继是默认且推荐的通路：只要登录了同一账号就能接管桌面端会话，不受网络位置限制。

export function isRelayEnabled(): boolean {
  return relay.isRelayEnabled()
}

export function setRelayEnabled(enabled: boolean): void {
  relay.setRelayEnabled(enabled)
}

export function isRelayConnected(): boolean {
  return relay.isRelayConnected()
}

/** 桌面端是否经中继在线（null = 尚未收到服务端状态） */
export function isRelayDesktopOnline(): boolean | null {
  return relay.isDesktopOnline()
}

/** 关闭中继连接（页面 onUnload 时调用，避免后台空转） */
export function closeRelay(): void {
  relay.closeRelay()
}

/**
 * 是否已经可以发起会话调用。
 * 中继模式下不需要「填地址 + 配对」两步 —— 登录即达，所以只要求已登录。
 */
export function isReady(): boolean {
  if (isRelayEnabled()) return getItem<string>(StorageKeys.token) != null
  return getServerUrl() !== '' && isPaired()
}

// ─── 错误分类 ─────────────────────────────────────────────────────────────────
// 只抛一句「配对失败」没有任何排查价值，所以把失败原因分类并带上可执行的提示。
// 定义挪到了 ./bridge-error.ts（直连与云端中继共用），这里再导出一次，
// 既有页面的 import 路径不用动。

export { BridgeError, describeBridgeError } from './bridge-error'
export type { BridgeErrorReason } from './bridge-error'

/** HINTS 现在由 bridge-error.ts 提供（原 HINTS 常量改名 BRIDGE_HINTS） */
const HINTS = BRIDGE_HINTS

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

/** 一次调用的结果（HTTP 语义，便于直连与中继共用同一套判定逻辑） */
interface ExchangeResult {
  status: number
  body: unknown
}

/** 局域网直连：wx.request 包成 ExchangeResult */
function httpExchange(
  path: string,
  method: string,
  data: Record<string, unknown> | undefined,
  timeoutMs: number,
): Promise<ExchangeResult> {
  return new Promise<ExchangeResult>((resolve, reject) => {
    wx.request({
      url: buildUrl(path),
      // wx.request 的类型枚举里没有 PATCH，运行时是支持的
      // （会话重命名走的就是 PATCH /v1/sessions/:id）
      method: method as 'POST',
      timeout: timeoutMs,
      data,
      header: { 'Content-Type': 'application/json', ...authHeader() },
      success: (res) => {
        resolve({ status: res.statusCode, body: parseBody<unknown>(res.data) })
      },
      fail: (err) => {
        const { reason, message } = classifyNetwork(err.errMsg || '')
        reject(new BridgeError(reason, message, HINTS[reason]))
      },
    })
  })
}

/**
 * 传输层选择：云端中继优先，未开启时回落局域网直连。
 *
 * 中继模式下小程序只连 edu-server，桌面端也只连 edu-server，
 * 两边不需要在同一网络，也不需要电脑有可达端口。
 */
async function exchange(
  path: string,
  method: string,
  data?: Record<string, unknown>,
  timeoutMs = 30_000,
): Promise<ExchangeResult> {
  if (isRelayEnabled()) {
    const result = await relay.relayExchange(path, method, data, timeoutMs)
    // 503 DESKTOP_OFFLINE 是最常见也最需要明确指引的一种：转成中文原因 + 可执行提示
    const offline = relay.describeRelayStatus(result.status, result.body)
    if (offline != null) throw offline
    return result
  }
  return httpExchange(path, method, data, timeoutMs)
}

/** 状态码 → 业务结果 / BridgeError（直连与中继共用） */
function unwrap<T>(result: ExchangeResult): T {
  if (result.status === 401) {
    clearDevice()
    throw new BridgeError('EXPIRED', '设备配对已失效，请重新配对', HINTS.EXPIRED)
  }
  if (result.body == null) {
    throw new BridgeError('SERVER', `桌面端响应异常 (${result.status})`, HINTS.SERVER)
  }
  if (result.status >= 400) {
    const body = result.body as { error?: { code?: string; message?: string } }
    const code = body?.error?.code
    const reason: BridgeErrorReason =
      code === 'BRIDGE_DISABLED' ? 'DISABLED' : code === 'UNAUTHORIZED' ? 'AUTH' : 'SERVER'
    throw new BridgeError(
      reason,
      body?.error?.message ?? `请求失败 (${result.status})`,
      HINTS[reason],
    )
  }
  return result.body as unknown as T
}

function request<T>(path: string, method: string, data?: Record<string, unknown>): Promise<T> {
  return exchange(path, method, data).then(unwrap<T>)
}

/**
 * 配对：用 edu-server 账号 token 换设备令牌（仅局域网直连需要）。
 *
 * 云端中继模式下没有「配对」这一步：edu-server 用账号 JWT 鉴权，
 * 只把调用转发给本人名下的桌面端，所以这里只需确认中继链路已通。
 */
export function pair(accountToken: string, deviceLabel?: string): Promise<BridgePairResult> {
  if (isRelayEnabled()) {
    return relay.ensureRelayConnected().then(
      () =>
        ({
          deviceToken: '',
          deviceId: 'cloud-relay',
          account: '',
          desktop: { name: '云端中继', version: '' },
        }) satisfies BridgePairResult,
    )
  }
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
  return exchange(`/v1/sessions/${encodeURIComponent(sessionId)}`, 'DELETE')
    .then(unwrap<{ deleted?: boolean }>)
    .then((body) => ({ deleted: body?.deleted !== false }))
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
  if (isRelayEnabled()) {
    return exchange('/v1/health', 'GET', undefined, 5_000)
      .then((result) => result.status === 200)
      .catch(() => false)
  }
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
  return exchange(path, 'POST', data, 120_000).then(unwrap<T>)
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

/** 附件预览地址（wx.previewImage 无法带 header，走 query token；仅局域网直连可用） */
export function buildAttachmentPreviewUrl(path: string): string {
  const token = getDeviceToken() ?? ''
  return `${buildUrl('/v1/attachments/content')}?path=${encodeURIComponent(path)}&token=${encodeURIComponent(token)}`
}

/**
 * 云端模式下取附件内容：小程序访问不到桌面端的局域网地址，
 * 改为经中继取回 base64 并落成本地临时文件，返回可直接用于预览的 wxfile:// 路径。
 * 失败返回 null（调用方回退成「仅显示文件名」）。
 */
export function fetchRelayAttachmentTempPath(path: string): Promise<string | null> {
  return exchange(`/v1/attachments/content?path=${encodeURIComponent(path)}`, 'GET')
    .then(unwrap<{ base64?: string; mimeType?: string }>)
    .then((body) => {
      if (body?.base64 == null) return null
      const ext = mimeToExt(body.mimeType)
      const filePath = `${wx.env.USER_DATA_PATH}/relay-att-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`
      const fs = wx.getFileSystemManager()
      fs.writeFileSync(filePath, body.base64, 'base64')
      return filePath
    })
    .catch(() => null)
}

function mimeToExt(mimeType?: string): string {
  const value = (mimeType ?? '').toLowerCase()
  if (value.includes('png')) return 'png'
  if (value.includes('jpeg') || value.includes('jpg')) return 'jpg'
  if (value.includes('gif')) return 'gif'
  if (value.includes('webp')) return 'webp'
  if (value.includes('pdf')) return 'pdf'
  return 'bin'
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
  return exchange(`/v1/tasks/${encodeURIComponent(taskId)}`, 'DELETE')
    .then(unwrap<{ deleted?: boolean }>)
    .then((body) => ({ deleted: body?.deleted !== false }))
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
  // 云端中继：复用同一条 WS 订阅会话事件流（小程序对并发连接数敏感，不做第二条）
  if (isRelayEnabled()) {
    return relay.relaySubscribe(sessionId, {
      onOpen: handlers.onOpen,
      onEvent: (events) => handlers.onEvent(events as BridgeEvent[]),
      onError: handlers.onError,
      onClose: handlers.onClose,
    })
  }

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

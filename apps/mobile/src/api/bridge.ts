/**
 * 桌面端桥接 API（门面）。
 *
 * 云端中继是唯一传输（局域网直连已移除：体验版强制 https/wss + 域名白名单，
 * 局域网 http/ws 真机不可用）。小程序只连 Spark 平台服务（edu-server），
 * 由服务端按账号把调用转发给本人的桌面端：
 *
 *   sessions   会话列表 / 新建 / 更新 / 删除
 *   projects   项目列表 / 项目内会话
 *   messages   会话历史；turns 提交回合 / 取消
 *   stream     中继 WS 增量事件流（sub/unsub）
 *   catalog    助手 / 模型 / 权限等工作目录
 *   attachments / transcribe / tasks / commands 等输入能力扩展
 *
 * 多电脑：同一账号可有多台桌面端；需要定向的调用带可选 deviceId（透传为 req/sub 帧的 d，
 * 缺省 = 服务端选主桌面端）。
 */

import { getItem, StorageKeys } from '../utils/storage'
import * as relay from './relay'
import { BridgeError, BRIDGE_HINTS } from './bridge-error'
import type { BridgeErrorReason } from './bridge-error'

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

// ─── 中继链路（唯一传输） ─────────────────────────────────────────────────────

/** 确保中继 WS 已连接（页面 onShow 时调用，presence 增量依赖此连接） */
export function ensureRelay(): Promise<void> {
  return relay.ensureRelayConnected()
}

/** 关闭中继连接（页面 onUnload 时调用，避免后台空转） */
export function closeRelay(): void {
  relay.closeRelay()
}

export function isRelayConnected(): boolean {
  return relay.isRelayConnected()
}

/** 任一桌面端是否经中继在线（null = 尚未收到服务端状态） */
export function isRelayDesktopOnline(): boolean | null {
  return relay.isDesktopOnline()
}

/** 最近一次 presence/welcome 的在线桌面端快照 */
export function getRelayPresenceDevices(): relay.RelayDesktopInfo[] {
  return relay.getPresenceDevices()
}

/** 是否已收到过服务端设备列表（未收到时页面应退回 REST 的 online 快照） */
export function isRelayPresenceFresh(): boolean {
  return relay.isPresenceFresh()
}

/** 订阅设备列表变化（welcome / presence 到达时回调）；返回取消函数 */
export function onRelayDevicesChanged(
  listener: (devices: relay.RelayDesktopInfo[]) => void,
): () => void {
  return relay.onRelayDevicesChanged(listener)
}

// ─── 选中的桌面端（远程会话页电脑切换；跨页面共享） ───────────────────────────

export function getSelectedDeviceId(): string {
  return relay.getSelectedDeviceId()
}

export function setSelectedDeviceId(deviceId: string): void {
  relay.setSelectedDeviceId(deviceId)
}

// ─── 授信设备管理（REST，带账号 JWT） ─────────────────────────────────────────

export type { RelayDeviceInfo } from './relay'
export { listRelayDevices, revokeRelayDevice } from './relay'

/**
 * 是否已经可以发起会话调用。
 * 中继模式登录即达（无需填地址/配对），所以只要求已登录。
 */
export function isReady(): boolean {
  return getItem<string>(StorageKeys.token) != null
}

// ─── 错误分类 ─────────────────────────────────────────────────────────────────
// 只抛一句「请求失败」没有任何排查价值，所以把失败原因分类并带上可执行的提示。
// 定义在 ./bridge-error.ts，这里再导出一次，既有页面的 import 路径不用动。

export { BridgeError, describeBridgeError } from './bridge-error'
export type { BridgeErrorReason } from './bridge-error'

/** HINTS 由 bridge-error.ts 提供 */
const HINTS = BRIDGE_HINTS

// ─── 请求 ─────────────────────────────────────────────────────────────────────

/** 一次调用的结果（HTTP 语义） */
interface ExchangeResult {
  status: number
  body: unknown
}

/**
 * 经云端中继发起一次调用（可带 deviceId 定向到某台桌面端，缺省 = 主桌面端）。
 * 503 DESKTOP_OFFLINE / 504 TIMEOUT 转成中文原因 + 可执行提示。
 */
async function exchange(
  path: string,
  method: string,
  data?: Record<string, unknown>,
  timeoutMs = 30_000,
  deviceId?: string,
): Promise<ExchangeResult> {
  const result = await relay.relayExchange(path, method, data, timeoutMs, deviceId)
  const classified = relay.describeRelayStatus(result.status, result.body)
  if (classified != null) throw classified
  return result
}

/** 状态码 → 业务结果 / BridgeError */
function unwrap<T>(result: ExchangeResult): T {
  if (result.status === 401) {
    throw new BridgeError('AUTH', '账号鉴权失败，请重新登录后重试', HINTS.AUTH)
  }
  if (result.body == null) {
    throw new BridgeError('SERVER', `电脑端响应异常 (${result.status})`, HINTS.SERVER)
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

function request<T>(
  path: string,
  method: string,
  data?: Record<string, unknown>,
  deviceId?: string,
): Promise<T> {
  return exchange(path, method, data, 30_000, deviceId).then(unwrap<T>)
}

export function listSessions(
  limit = 50,
  projectId?: string,
  deviceId?: string,
): Promise<{ sessions: BridgeSessionSummary[]; total: number }> {
  const query = projectId ? `&projectId=${encodeURIComponent(projectId)}` : ''
  return request<{ sessions: BridgeSessionSummary[]; total: number }>(
    `/v1/sessions?limit=${limit}${query}`,
    'GET',
    undefined,
    deviceId,
  )
}

export function listProjects(
  limit = 100,
  deviceId?: string,
): Promise<{ projects: BridgeProjectSummary[]; total: number }> {
  return request<{ projects: BridgeProjectSummary[]; total: number }>(
    `/v1/projects?limit=${limit}`,
    'GET',
    undefined,
    deviceId,
  )
}

export function listProjectSessions(
  projectId: string,
  limit = 50,
  deviceId?: string,
): Promise<{ sessions: BridgeSessionSummary[]; total: number }> {
  return request<{ sessions: BridgeSessionSummary[]; total: number }>(
    `/v1/projects/${encodeURIComponent(projectId)}/sessions?limit=${limit}`,
    'GET',
    undefined,
    deviceId,
  )
}

export function createSession(
  title?: string,
  projectId?: string,
  deviceId?: string,
): Promise<{ session: BridgeSessionSummary }> {
  return request<{ session: BridgeSessionSummary }>(
    '/v1/sessions',
    'POST',
    {
      ...(title ? { title } : {}),
      ...(projectId ? { projectId } : {}),
    },
    deviceId,
  )
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
  deviceId?: string,
): Promise<{ session: BridgeSessionSummary }> {
  return request<{ session: BridgeSessionSummary }>(
    `/v1/sessions/${encodeURIComponent(sessionId)}`,
    'PATCH',
    patch as unknown as Record<string, unknown>,
    deviceId,
  )
}

export function renameSession(
  sessionId: string,
  title: string,
  deviceId?: string,
): Promise<{ session: BridgeSessionSummary }> {
  return updateSession(sessionId, { title }, deviceId)
}

export function deleteSession(sessionId: string, deviceId?: string): Promise<{ deleted: boolean }> {
  return exchange(
    `/v1/sessions/${encodeURIComponent(sessionId)}`,
    'DELETE',
    undefined,
    30_000,
    deviceId,
  )
    .then(unwrap<{ deleted?: boolean }>)
    .then((body) => ({ deleted: body?.deleted !== false }))
}

/**
 * 会话历史（事件级分页，桌面端排除流式 delta）。
 * beforeSeq：向上翻页游标，只取 seq 小于该值的更早事件；hasMore 缺省 = 旧版桌面端不支持分页。
 */
export function getMessages(
  sessionId: string,
  limit = 200,
  deviceId?: string,
  beforeSeq?: number,
): Promise<{ sessionId: string; events: BridgeEvent[]; running: boolean; hasMore?: boolean }> {
  return request<{ sessionId: string; events: BridgeEvent[]; running: boolean; hasMore?: boolean }>(
    `/v1/sessions/${encodeURIComponent(sessionId)}/messages?limit=${limit}${
      beforeSeq != null ? `&beforeSeq=${beforeSeq}` : ''
    }`,
    'GET',
    undefined,
    deviceId,
  )
}

export function submitTurn(
  sessionId: string,
  text: string,
  attachmentPaths?: string[],
  deviceId?: string,
): Promise<{ turnId: string }> {
  return request<{ turnId: string }>(
    `/v1/sessions/${encodeURIComponent(sessionId)}/turns`,
    'POST',
    {
      text,
      ...(attachmentPaths != null && attachmentPaths.length > 0 ? { attachmentPaths } : {}),
    },
    deviceId,
  )
}

export function cancelTurn(sessionId: string, deviceId?: string): Promise<{ cancelled: boolean }> {
  return request<{ cancelled: boolean }>(
    `/v1/sessions/${encodeURIComponent(sessionId)}/cancel`,
    'POST',
    undefined,
    deviceId,
  )
}

/** 探测桌面端是否可达（健康检查；可定向） */
export function ping(deviceId?: string): Promise<boolean> {
  return exchange('/v1/health', 'GET', undefined, 5_000, deviceId)
    .then((result) => result.status === 200)
    .catch(() => false)
}

// ─── 会话内配置与输入能力扩展 ─────────────────────────────────────────────────

/** 大 body 专用请求（附件上传/语音转写，放宽超时） */
function largeRequest<T>(
  path: string,
  data: Record<string, unknown>,
  deviceId?: string,
): Promise<T> {
  return exchange(path, 'POST', data, 120_000, deviceId).then(unwrap<T>)
}

/** 选项目录（助手/工作流/对话渠道/权限与推理枚举），聊天页进入时一次拉全 */
export function getCatalog(deviceId?: string): Promise<BridgeCatalog> {
  return request<BridgeCatalog>('/v1/catalog', 'GET', undefined, deviceId)
}

/** 会话运行配置摘要 */
export function getSessionRuntime(
  sessionId: string,
  deviceId?: string,
): Promise<{ runtime: BridgeSessionRuntime }> {
  return request<{ runtime: BridgeSessionRuntime }>(
    `/v1/sessions/${encodeURIComponent(sessionId)}/runtime`,
    'GET',
    undefined,
    deviceId,
  )
}

export interface BridgeWorkflowBinding {
  binding: { mode: 'inherit' | 'override' | 'disabled'; workflowId: string | null } | null
  effectiveName: string | null
  canChange: boolean
  error: string | null
}

export function getWorkflowBinding(
  sessionId: string,
  deviceId?: string,
): Promise<BridgeWorkflowBinding> {
  return request<BridgeWorkflowBinding>(
    `/v1/sessions/${encodeURIComponent(sessionId)}/workflow`,
    'GET',
    undefined,
    deviceId,
  )
}

export function setWorkflowBinding(
  sessionId: string,
  mode: 'inherit' | 'override' | 'disabled',
  workflowId?: string,
  deviceId?: string,
): Promise<BridgeWorkflowBinding> {
  return request<BridgeWorkflowBinding>(
    `/v1/sessions/${encodeURIComponent(sessionId)}/workflow`,
    'PUT',
    { mode, ...(workflowId ? { workflowId } : {}) } as unknown as Record<string, unknown>,
    deviceId,
  )
}

/** 附件上传（base64 → 桌面端白名单目录落盘；返回可直接随 turns 提交的 path） */
export function uploadAttachments(
  sessionId: string,
  files: { name: string; mimeType?: string; dataBase64: string }[],
  deviceId?: string,
): Promise<{ attachments: BridgeAttachment[] }> {
  return largeRequest<{ attachments: BridgeAttachment[] }>(
    `/v1/sessions/${encodeURIComponent(sessionId)}/attachments`,
    { files },
    deviceId,
  )
}

/**
 * 取附件内容：小程序访问不到桌面端本地路径，经中继取回 base64 并落成本地临时文件，
 * 返回可直接用于预览的 wxfile:// 路径。失败返回 null（调用方回退成「仅显示文件名」）。
 */
export function fetchRelayAttachmentTempPath(
  path: string,
  deviceId?: string,
): Promise<string | null> {
  return exchange(
    `/v1/attachments/content?path=${encodeURIComponent(path)}`,
    'GET',
    undefined,
    30_000,
    deviceId,
  )
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
  deviceId?: string,
): Promise<{ text: string; engine: 'local' | 'cloud' }> {
  return largeRequest<{ text: string; engine: 'local' | 'cloud' }>(
    '/v1/transcribe',
    { audioBase64, mimeType },
    deviceId,
  )
}

export function listSessionTasks(
  sessionId: string,
  deviceId?: string,
): Promise<{ tasks: BridgeScheduledTask[] }> {
  return request<{ tasks: BridgeScheduledTask[] }>(
    `/v1/sessions/${encodeURIComponent(sessionId)}/tasks`,
    'GET',
    undefined,
    deviceId,
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
  deviceId?: string,
): Promise<{ task: BridgeScheduledTask }> {
  return request<{ task: BridgeScheduledTask }>(
    `/v1/sessions/${encodeURIComponent(sessionId)}/tasks`,
    'POST',
    input as unknown as Record<string, unknown>,
    deviceId,
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
  deviceId?: string,
): Promise<{ task: BridgeScheduledTask }> {
  return request<{ task: BridgeScheduledTask }>(
    `/v1/tasks/${encodeURIComponent(taskId)}`,
    'PATCH',
    patch as unknown as Record<string, unknown>,
    deviceId,
  )
}

export function deleteSessionTask(
  taskId: string,
  deviceId?: string,
): Promise<{ deleted: boolean }> {
  return exchange(`/v1/tasks/${encodeURIComponent(taskId)}`, 'DELETE', undefined, 30_000, deviceId)
    .then(unwrap<{ deleted?: boolean }>)
    .then((body) => ({ deleted: body?.deleted !== false }))
}

export function toggleSessionTask(
  taskId: string,
  enabled: boolean,
  deviceId?: string,
): Promise<{ task: BridgeScheduledTask }> {
  return request<{ task: BridgeScheduledTask }>(
    `/v1/tasks/${encodeURIComponent(taskId)}/toggle`,
    'POST',
    { enabled },
    deviceId,
  )
}

export function runSessionTaskNow(
  taskId: string,
  deviceId?: string,
): Promise<{ started: boolean }> {
  return request<{ started: boolean }>(
    `/v1/tasks/${encodeURIComponent(taskId)}/run`,
    'POST',
    undefined,
    deviceId,
  )
}

export function listCommands(
  sessionId: string,
  deviceId?: string,
): Promise<{ commands: BridgeCommandItem[] }> {
  return request<{ commands: BridgeCommandItem[] }>(
    `/v1/commands?sessionId=${encodeURIComponent(sessionId)}`,
    'GET',
    undefined,
    deviceId,
  )
}

export function executeCommand(
  sessionId: string,
  raw: string,
  deviceId?: string,
): Promise<{ isCommand: boolean; forwardToAgent: boolean; queued?: boolean; message?: string }> {
  return request<{
    isCommand: boolean
    forwardToAgent: boolean
    queued?: boolean
    message?: string
  }>(`/v1/sessions/${encodeURIComponent(sessionId)}/commands`, 'POST', { raw }, deviceId)
}

// ─── WebSocket 流（中继多路复用） ─────────────────────────────────────────────

export interface StreamHandlers {
  /** 连接真正建立（wx onOpen）后回调；connected 状态以此为准 */
  onOpen?(): void
  onEvent(events: BridgeEvent[]): void
  onError(message: string): void
  onClose(): void
}

/**
 * 连接会话事件流（可带 deviceId 定向；断线自动重连由中继层负责）。
 * 返回关闭函数；聊天页 onUnload 统一关闭。
 */
export function connectStream(
  sessionId: string,
  handlers: StreamHandlers,
  deviceId?: string,
): () => void {
  return relay.relaySubscribe(
    sessionId,
    {
      onOpen: handlers.onOpen,
      onEvent: (events) => handlers.onEvent(events as BridgeEvent[]),
      onError: handlers.onError,
      onClose: handlers.onClose,
    },
    deviceId,
  )
}

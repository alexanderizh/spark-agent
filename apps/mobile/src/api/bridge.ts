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
import type { BridgeSessionLabelKey } from '../utils/sidebar-order'
import * as relay from './relay'
import { configureImageFetcher, resolveImagePath } from './image-cache'
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
  /** 会话标记（5 预置标签；null/缺省 = 未打标。有标记即归入置顶区，与桌面端同口径） */
  sessionLabel?: BridgeSessionLabelKey | null
  /** 打标时间（ISO；置顶区内排序时间 = pinnedAt ?? labeledAt） */
  labeledAt?: string | null
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
  /** 归档回显（列表投影恒 null；仅 PATCH 写响应携带真实值。缺省 = 旧版桌面端） */
  archivedAt?: string | null
  updatedAt: string
  /** 项目下未归档会话数 */
  sessionCount: number
}

export type BridgeEventType =
  | 'user_message'
  | 'assistant_message'
  | 'agent_thinking'
  | 'tool_call'
  | 'tool_result'
  | 'agent_status'
  | 'agent_error'
  | 'presented_files'

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
  /** presented_files：agent 呈现的产物文件（端上按扩展名过滤图片后走本地缓存展示） */
  files?: { path: string; title?: string }[]
  /**
   * user_message：随消息提交的附件（旧版桌面端不透出，缺省 undefined）。
   * 端上渲染历史附件缩略图（图片经本地缓存解析），文件仅显名。
   */
  attachments?: { type: 'image' | 'file'; path: string; name?: string }[]
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

/** 重命名 / 置顶 / 打标 / 归档 / 运行时配置 / 项目归属（仅传需要修改的字段） */
export function updateSession(
  sessionId: string,
  patch: {
    title?: string
    pinned?: boolean
    archived?: boolean
    /** 会话标记；null = 取消标记 */
    sessionLabel?: BridgeSessionLabelKey | null
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

// ─── 项目管理与侧栏手动排序（移动端反向设置桌面端侧栏） ─────────────────────────

/**
 * 项目重命名 / 置顶 / 归档；响应带更新后摘要，用于旧版桌面端「假成功」回显校验。
 * 「不使用项目」是桌面端系统保留项目：改名/归档/删除都会被桌面端拒绝（400 + 中文原因）。
 */
export function updateProject(
  projectId: string,
  patch: { name?: string; pinned?: boolean; archived?: boolean },
  deviceId?: string,
): Promise<{ project: BridgeProjectSummary }> {
  return request<{ project: BridgeProjectSummary }>(
    `/v1/projects/${encodeURIComponent(projectId)}`,
    'PATCH',
    patch as unknown as Record<string, unknown>,
    deviceId,
  )
}

/** 项目删除（桌面端级联删除项目下全部会话；响应 deleted=false 表示项目不存在） */
export function deleteProject(projectId: string, deviceId?: string): Promise<{ deleted: boolean }> {
  return request<{ deleted: boolean }>(
    `/v1/projects/${encodeURIComponent(projectId)}`,
    'DELETE',
    undefined,
    deviceId,
  )
}

/** 会话搜索结果（与桌面端 session:search 同构；snippet 为内容匹配片段） */
export interface BridgeSessionSearchResult {
  sessionId: string
  title: string
  snippet: string
  matchType: 'title' | 'content'
  updatedAt: string
}

/**
 * 会话搜索（标题 LIKE + 内容 FTS5）。projectId 省略 = 全部会话；
 * 'default' = 虚拟未归属项目（桌面端按 project_id 精确过滤）。
 * 旧版桌面端无此端点 → 404，调用方应静默降级为仅前端标题过滤。
 */
export function searchSessions(
  query: string,
  projectId: string | undefined,
  deviceId?: string,
): Promise<{ results: BridgeSessionSearchResult[] }> {
  // 小程序基础库不保证 URLSearchParams，与文件内其他端点一致手工拼 query
  const queryPart = `q=${encodeURIComponent(query)}&limit=20${
    projectId ? `&projectId=${encodeURIComponent(projectId)}` : ''
  }`
  return request<{ results: BridgeSessionSearchResult[] }>(
    `/v1/search?${queryPart}`,
    'GET',
    undefined,
    deviceId,
  )
}

/** 侧栏手动排序状态（与桌面端 sidebar-order:list 同构） */
export interface BridgeSidebarOrderState {
  projectIds: string[]
  sessionIdsByProject: Record<string, string[]>
  pinnedSessionIdsByProject: Record<string, string[]>
}

export type BridgeSidebarOrderUpdateRequest =
  | { scope: 'projects'; itemIds: string[] }
  | { scope: 'sessions'; projectId: string; itemIds: string[] }
  | { scope: 'pinned-sessions'; projectId: string; itemIds: string[] }

export function getSidebarOrder(deviceId?: string): Promise<BridgeSidebarOrderState> {
  return request<BridgeSidebarOrderState>('/v1/sidebar-order', 'GET', undefined, deviceId)
}

export function updateSidebarOrder(
  payload: BridgeSidebarOrderUpdateRequest,
  deviceId?: string,
): Promise<{ itemIds: string[] }> {
  return request<{ itemIds: string[] }>(
    '/v1/sidebar-order',
    'PUT',
    payload as unknown as Record<string, unknown>,
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

/** 桌面端每页返回完整对话轮次；nextBeforeSeq 指向原始事件，映射为空时也能继续翻页。 */
export interface BridgeHistoryQuery {
  deviceId?: string
  beforeSeq?: number
  turnLimit?: number
  eventLimit?: number
}

export function getMessages(
  sessionId: string,
  query: BridgeHistoryQuery = {},
): Promise<{
  sessionId: string
  events: BridgeEvent[]
  running: boolean
  hasMore?: boolean
  nextBeforeSeq?: number
}> {
  const search = [
    'limit=200',
    ...(query.turnLimit != null ? [`turnLimit=${query.turnLimit}`] : []),
    ...(query.eventLimit != null ? [`eventLimit=${query.eventLimit}`] : []),
    ...(query.beforeSeq != null ? [`beforeSeq=${query.beforeSeq}`] : []),
  ].join('&')
  return request<{
    sessionId: string
    events: BridgeEvent[]
    running: boolean
    hasMore?: boolean
    nextBeforeSeq?: number
  }>(
    `/v1/sessions/${encodeURIComponent(sessionId)}/messages?${search}`,
    'GET',
    undefined,
    query.deviceId,
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

// ─── 会话分支（Session Fork：对齐桌面端「从此处分支」） ────────────────────────

/** 分支血缘条目（与桌面端 SessionLineage 同构） */
export interface BridgeLineage {
  childSessionId: string
  parentSessionId: string
  /** 分支锚点 turn（null = 复制了全部已完成内容） */
  forkAnchorTurnId: string | null
  forkCutoffSeq: number
  sourceTitleSnapshot: string
  childTitle?: string
  createdAt: string
}

/**
 * 从指定会话 fork 出独立子会话（anchorTurnId 缺省 = 复制全部已完成内容）。
 * 锚点未完成等错误由桌面端原样透出（BridgeError，message 可直接 toast）。
 * 旧版桌面端无此端点会 404 → SERVER 错误，调用方可据此提示版本过低。
 */
export function forkSession(
  sessionId: string,
  input: { anchorTurnId?: string; title?: string },
  deviceId?: string,
): Promise<{
  session: BridgeSessionSummary
  lineage: BridgeLineage
  copiedTurnCount: number
  sourceWasRunning: boolean
  /** 复制的 workflow 绑定当前不可用（桌面端同源；调用方 toast 提示） */
  bindingWarning?: { code: string } | null
}> {
  return request<{
    session: BridgeSessionSummary
    lineage: BridgeLineage
    copiedTurnCount: number
    sourceWasRunning: boolean
    bindingWarning?: { code: string } | null
  }>(
    `/v1/sessions/${encodeURIComponent(sessionId)}/fork`,
    'POST',
    {
      ...(input.anchorTurnId ? { anchorTurnId: input.anchorTurnId } : {}),
      ...(input.title ? { title: input.title } : {}),
    } as unknown as Record<string, unknown>,
    deviceId,
  )
}

/** 会话分支血缘（来源 + 直接子分支；lineage=null = 该会话不是 fork 副本） */
export function getSessionLineage(
  sessionId: string,
  deviceId?: string,
): Promise<{ lineage: BridgeLineage | null; children: BridgeLineage[] }> {
  return request<{ lineage: BridgeLineage | null; children: BridgeLineage[] }>(
    `/v1/sessions/${encodeURIComponent(sessionId)}/lineage`,
    'GET',
    undefined,
    deviceId,
  )
}

// ─── 挂起交互（权限审批 + 用户问答；与桌面端审批卡/问答卡同源） ─────────────────

export interface BridgeApprovalItem {
  requestId: string
  sessionId: string
  toolName: string
  /** 权限动作分类（file_write / command_exec / …） */
  action: string
  riskLevel: 'low' | 'medium' | 'high'
  toolInput: Record<string, unknown>
  /** ISO；旧版桌面端缺省为空串 */
  createdAt: string
  defaultToNo?: boolean
}

export interface BridgeQuestionOption {
  label: string
  description?: string
  value?: string
  allowsFreeText?: boolean
  freeTextPlaceholder?: string
}

export interface BridgeQuestionPrompt {
  id?: string
  question: string
  header: string
  type?: 'single_choice' | 'multi_choice' | 'text'
  required?: boolean
  placeholder?: string
  multiline?: boolean
  allowSkip?: boolean
  allowOther?: boolean
  otherOptionLabel?: string
  otherPlaceholder?: string
  options?: BridgeQuestionOption[]
  multiSelect?: boolean
}

export interface BridgeQuestionItem {
  questionId: string
  sessionId: string
  createdAt: string
  questions: BridgeQuestionPrompt[]
}

export interface BridgeInteractions {
  approvals: BridgeApprovalItem[]
  questions: BridgeQuestionItem[]
}

export type BridgeApprovalDecision = 'allow-once' | 'allow-session' | 'deny'

/**
 * 会话挂起交互快照（审批卡 + 问答卡轮询数据源）。
 * 旧版桌面端没有该端点会 404：调用方 catch 后按空处理，不提示错误。
 */
export function getPendingInteractions(
  sessionId: string,
  deviceId?: string,
): Promise<BridgeInteractions> {
  return request<BridgeInteractions>(
    `/v1/sessions/${encodeURIComponent(sessionId)}/interactions`,
    'GET',
    undefined,
    deviceId,
  )
}

/** 应答权限审批（false = 审批已结束或不存在） */
export function resolveApproval(
  sessionId: string,
  requestId: string,
  decision: BridgeApprovalDecision,
  deviceId?: string,
): Promise<{ ok: boolean }> {
  return request<{ ok: boolean }>(
    `/v1/sessions/${encodeURIComponent(sessionId)}/approvals/${encodeURIComponent(requestId)}/resolve`,
    'POST',
    { decision },
    deviceId,
  )
}

/**
 * 应答用户问答。answers 与桌面端渲染端同形状：
 * { answers: [{ index, id, question, type, skipped, answer, … }], questionCount, answeredCount }。
 */
export function answerQuestion(
  sessionId: string,
  questionId: string,
  answers: Record<string, unknown>,
  deviceId?: string,
): Promise<{ ok: boolean }> {
  return request<{ ok: boolean }>(
    `/v1/sessions/${encodeURIComponent(sessionId)}/questions/${encodeURIComponent(questionId)}/answer`,
    'POST',
    { answers },
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
 * 取附件内容原始载荷（经中继 base64；图片缓存层的注入源，不直接对页面暴露）。
 * 失败返回 null（调用方降级）。
 */
function fetchRelayAttachmentBase64(
  path: string,
  deviceId?: string,
): Promise<{ base64: string; mimeType?: string } | null> {
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
      return { base64: body.base64, ...(body.mimeType != null ? { mimeType: body.mimeType } : {}) }
    })
    .catch(() => null)
}

// 图片缓存层的附件拉取器（image-cache 不反向 import bridge，避免循环依赖）
configureImageFetcher(fetchRelayAttachmentBase64)

/**
 * 取附件内容：小程序访问不到桌面端本地路径，经图片缓存层解析——
 * 命中本地缓存零中继传输；未命中拉取后落盘持久缓存（LRU 限量）。
 * 签名与旧版一致（调用方无感升级）。失败返回 null（调用方回退成「仅显示文件名」）。
 */
export function fetchRelayAttachmentTempPath(
  path: string,
  deviceId?: string,
): Promise<string | null> {
  return resolveImagePath(path, deviceId)
}

export { reconcileImageCache } from './image-cache'

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
    timeoutSeconds?: number
    maxRetries?: number
  },
  deviceId?: string,
): Promise<{ task: BridgeScheduledTask }> {
  return request<{ task: BridgeScheduledTask }>(
    `/v1/tasks/${encodeURIComponent(taskId)}`,
    'PATCH',
    patch as Record<string, unknown>,
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

// ─── 技能列表（移动端只读选择器；选中后以 @name 文本插入输入框） ───────────────

export interface BridgeSkillItem {
  id: string
  name: string
  description: string
  enabled: boolean
  /** db = 平台已安装技能；project = 会话工作区项目技能 */
  source: 'db' | 'project'
}

/**
 * 技能只读列表（平台已安装 + 会话项目技能，同名去重后平台技能优先）。
 * 旧版桌面端无此端点会 404：调用方 catch 后提示版本过低并隐藏技能入口。
 */
export function listSkills(
  sessionId: string,
  deviceId?: string,
): Promise<{ skills: BridgeSkillItem[] }> {
  return request<{ skills: BridgeSkillItem[] }>(
    `/v1/skills?sessionId=${encodeURIComponent(sessionId)}`,
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

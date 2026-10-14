/**
 * 移动桥接 IPC 注册 + 依赖装配。
 *
 * 装配层职责（本文件）：
 *   1. 创建 MobileBridgeService（设置与设备存 SettingsService，键 mobileBridge/store）
 *   2. 注入 deps 闭包（会话仓库 / SessionService / 账号校验），避免服务层反向依赖
 *   3. 注册设置 IPC（get-status / update-settings / revoke-device）
 *   4. 按设置启动 HTTP/WS 服务
 *
 * 主进程 ipc/index.ts 只加一行 registerMobileBridgeIpc({...}) 调用。
 */

import { app } from 'electron'
import fs from 'node:fs/promises'
import path from 'node:path'
import { hostname } from 'node:os'
import { randomUUID, randomBytes } from 'node:crypto'
import type {
  AgentEvent,
  MobileBridgeAttachment,
  MobileBridgeCatalog,
  MobileBridgeCommandItem,
  MobileBridgeCreateScheduledTaskRequest,
  MobileBridgeEvent,
  MobileBridgeProjectSummary,
  MobileBridgeRelaySettings,
  MobileBridgeRelayStatus,
  MobileBridgeScheduledTask,
  MobileBridgeSessionRuntime,
  MobileBridgeSessionSummary,
  MobileBridgeSetWorkflowBindingRequest,
  MobileBridgeSettings,
  MobileBridgeStatus,
  MobileBridgeUpdateScheduledTaskRequest,
  MobileBridgeUploadAttachmentsRequest,
  MobileBridgeWorkflowBindingResponse,
  ScheduledTaskItem,
} from '@spark/protocol'
import { isConversationalProviderCandidate } from '@spark/protocol'
import type {
  SessionChatMode,
  SessionPermissionMode,
  SessionReasoningEffort,
} from '@spark/protocol'
import type {
  ProviderService,
  ScheduledTaskService,
  SessionService,
  SettingsService,
  WorkspaceService,
} from '@spark/agent-runtime'
import { getDatabase } from '../db.js'
import { typedIpcHandle } from './typed-ipc.js'
import { AgentRepository, SessionRepository, WorkflowRepository } from '@spark/storage'
import { PASTED_IMAGE_MAX_EDGE, resizePastedImageBuffer } from '../services/PastedImageResizer.js'
import type { RemoteVoiceTranscriber } from '../services/remoteVoiceTranscription.js'
import {
  DEFAULT_MOBILE_BRIDGE_RELAY_SETTINGS,
  DEFAULT_MOBILE_BRIDGE_SETTINGS,
} from '@spark/protocol'
import {
  MobileBridgeService,
  type MobileBridgeDeps,
  type MobileBridgePersistedDevice,
} from '../services/MobileBridgeService.js'
import { MobileBridgeRelayClient } from '../services/MobileBridgeRelayClient.js'
import { createLogger } from '@spark/shared'

const log = createLogger('mobile-bridge:ipc')

const SETTINGS_CATEGORY = 'mobileBridge'
const SETTINGS_KEY = 'store'
/** 云端中继单独一个键：与局域网桥接的 store 互不干扰 */
const RELAY_SETTINGS_KEY = 'relay'

export interface MobileBridgeIpcDeps {
  getSessionService(): SessionService
  getSettingsService(): SettingsService
  getWorkspaceService(): WorkspaceService
  /** 删除会话时关闭该会话名下的内置终端 PTY（与 session:delete 行为对齐）；最小结构类型避免依赖桌面端本地实现 */
  getTerminalService(): { disposeBySession(sessionId: string, opts?: { defer?: boolean }): number }
  /** 归档会话时同步暂停关联定时任务（与 session:update 行为对齐） */
  getScheduledTaskService(): ScheduledTaskService
  /** 账号 token 校验（edu-server /me） */
  validateAccountToken(token: string): Promise<{ userId: string; account: string } | null>
  /** 新建会话（默认渠道/引擎/权限，与远程建会话同规则；projectId 归属项目） */
  createMobileSession(title?: string, projectId?: string): Promise<MobileBridgeSessionSummary>
  /** 渠道列表（catalog 过滤 LLM 渠道用） */
  getProviderService(): ProviderService
  /** 入站语音转写（本地 SenseVoice → 云渠道兜底；与远程连接共用实例） */
  getVoiceTranscriber(): RemoteVoiceTranscriber
  /** edu-server access token（云端中继握手用）；未登录返回 null */
  getRelayAccessToken(): Promise<string | null>
  /** edu-server 基址（中继地址留空时回落到这里） */
  getRelayBaseUrl(): string
}

/** 持久化形态：设备含 deviceToken（本机 Secrets，与远程连接凭据同存储） */
interface BridgeStoreShape {
  settings: MobileBridgeSettings
  devices: MobileBridgePersistedDevice[]
}

/** 云端中继持久化形态：开关/地址 + 本机设备身份（deviceId + secret，重新授信时整体换新） */
interface RelayStoreShape {
  settings: MobileBridgeRelaySettings
  deviceId: string
  /** 设备密钥：授信凭据，仅本机明文保存；服务端只存 SHA-256 哈希 */
  deviceSecret: string
}

let service: MobileBridgeService | null = null
let relayClient: MobileBridgeRelayClient | null = null

function readRelayStore(settings: SettingsService): RelayStoreShape {
  const raw = settings.get(SETTINGS_CATEGORY, RELAY_SETTINGS_KEY)
  if (raw == null || typeof raw !== 'object') {
    const fresh: RelayStoreShape = {
      settings: { ...DEFAULT_MOBILE_BRIDGE_RELAY_SETTINGS },
      deviceId: randomUUID(),
      deviceSecret: randomBytes(32).toString('hex'),
    }
    settings.set(SETTINGS_CATEGORY, RELAY_SETTINGS_KEY, fresh)
    return fresh
  }
  const record = raw as Record<string, unknown>
  const deviceId =
    typeof record.deviceId === 'string' && record.deviceId ? record.deviceId : randomUUID()
  // 旧版本 store 没有 secret：补生成（服务端首见即注册，等价于一次重新授信）
  const deviceSecret =
    typeof record.deviceSecret === 'string' && record.deviceSecret
      ? record.deviceSecret
      : randomBytes(32).toString('hex')
  const stored: MobileBridgeRelaySettings =
    record.settings != null && typeof record.settings === 'object'
      ? {
          ...DEFAULT_MOBILE_BRIDGE_RELAY_SETTINGS,
          ...(record.settings as MobileBridgeRelaySettings),
        }
      : { ...DEFAULT_MOBILE_BRIDGE_RELAY_SETTINGS }
  const shape: RelayStoreShape = { settings: stored, deviceId, deviceSecret }
  // 身份字段是首次读取时生成的，补写一次保证稳定
  if (deviceId !== record.deviceId || deviceSecret !== record.deviceSecret) {
    settings.set(SETTINGS_CATEGORY, RELAY_SETTINGS_KEY, shape)
  }
  return shape
}

function writeRelayStore(settings: SettingsService, shape: RelayStoreShape): void {
  settings.set(SETTINGS_CATEGORY, RELAY_SETTINGS_KEY, shape)
}

function getRelayClient(deps: MobileBridgeIpcDeps): MobileBridgeRelayClient {
  if (relayClient != null) return relayClient
  const bridge = getService(deps)
  const settings = deps.getSettingsService()
  relayClient = new MobileBridgeRelayClient({
    getSettings: () => readRelayStore(settings).settings,
    getDefaultBaseUrl: () => deps.getRelayBaseUrl(),
    getAccessToken: () => deps.getRelayAccessToken(),
    getDeviceId: () => readRelayStore(settings).deviceId,
    getDeviceSecret: () => readRelayStore(settings).deviceSecret,
    getDeviceLabel: () => `${hostname()} · ${app.getName()}`,
    getVersion: () => app.getVersion(),
    invoke: (method, urlPath, body) => bridge.invokeRelay(method, urlPath, body),
    subscribe: (sessionId, sendEvents) => bridge.addRelaySubscriber(sessionId, sendEvents),
  })
  return relayClient
}

function getService(deps: MobileBridgeIpcDeps): MobileBridgeService {
  if (service != null) return service
  const settings = deps.getSettingsService()
  service = new MobileBridgeService(
    () => {
      const raw = settings.get(SETTINGS_CATEGORY, SETTINGS_KEY)
      if (raw == null || typeof raw !== 'object') {
        return { settings: { ...DEFAULT_MOBILE_BRIDGE_SETTINGS }, devices: [] }
      }
      const record = raw as Record<string, unknown>
      return {
        settings:
          record.settings != null && typeof record.settings === 'object'
            ? { ...DEFAULT_MOBILE_BRIDGE_SETTINGS, ...(record.settings as MobileBridgeSettings) }
            : { ...DEFAULT_MOBILE_BRIDGE_SETTINGS },
        devices: Array.isArray(record.devices)
          ? (record.devices as MobileBridgePersistedDevice[])
          : [],
      } satisfies BridgeStoreShape
    },
    (store) => {
      settings.set(SETTINGS_CATEGORY, SETTINGS_KEY, {
        settings: store.settings,
        devices: store.devices,
      } satisfies BridgeStoreShape)
    },
  )
  service.setDeps(buildDeps(deps))
  return service
}

/** AgentEvent → 移动端子集（只留对话必需的字段） */
function toMobileEvent(event: AgentEvent): MobileBridgeEvent | null {
  const base = {
    id: event.id,
    seq: event.seq,
    turnId: event.turnId,
    timestamp: event.timestamp,
  }
  switch (event.type) {
    case 'user_message':
      return { ...base, type: 'user_message', content: event.content }
    case 'assistant_message':
      return {
        ...base,
        type: 'assistant_message',
        content: event.content,
        mode: event.mode,
        isFinal: event.isFinal,
        ...(event.segmentId != null ? { segmentId: event.segmentId } : {}),
      }
    case 'tool_call':
      return { ...base, type: 'tool_call', toolName: event.toolName, toolCallId: event.toolCallId }
    case 'tool_result':
      return {
        ...base,
        type: 'tool_result',
        toolName: event.toolName,
        toolCallId: event.toolCallId,
        toolStatus: event.status === 'success' ? 'success' : 'error',
      }
    case 'agent_status':
      return {
        ...base,
        type: 'agent_status',
        status: event.status,
        ...(event.message != null ? { statusMessage: event.message } : {}),
      }
    case 'agent_error':
      return { ...base, type: 'agent_error', statusMessage: event.message }
    default:
      return null
  }
}

/**
 * 解析 worktree workspace 的归属：worktree 会话在侧边栏归到原项目分组，
 * 移动端保持同一口径 —— 返回 base workspace id（非 worktree 返回 null）。
 */
function parseWorktreeBaseId(metaJson: string | null): string | null {
  if (metaJson == null) return null
  try {
    const meta = JSON.parse(metaJson) as { baseWorkspaceId?: string }
    return typeof meta.baseWorkspaceId === 'string' && meta.baseWorkspaceId
      ? meta.baseWorkspaceId
      : null
  } catch {
    return null
  }
}

// ─── 会话内配置与输入能力扩展：辅助 ─────────────────────────────────────────────

/** 各 adapter 合法的权限策略（与 SessionPermissionMode 前缀分组一致） */
const ADAPTER_PERMISSION_MODES: Record<string, string[]> = {
  claude: ['claude-ask', 'claude-auto-edits', 'claude-plan', 'claude-auto', 'claude-bypass'],
  'claude-sdk': ['claude-ask', 'claude-auto-edits', 'claude-plan', 'claude-auto', 'claude-bypass'],
  codex: ['codex-default', 'codex-auto-review', 'codex-full-access'],
  spark: ['spark-default', 'spark-accept-edits', 'spark-plan', 'spark-bypass', 'spark-auto'],
}

const REASONING_EFFORTS = ['minimal', 'low', 'medium', 'high', 'xhigh', 'max']

/** 会话行 + 工作流绑定 → 移动端运行配置摘要（exactOptionalPropertyTypes：缺省字段不写键） */
function toBridgeRuntime(
  row: {
    provider_profile_id: string | null
    model_id: string | null
    agent_adapter: string
    agent_id: string | null
    permission_mode: string
    reasoning_effort: string
    chat_mode: string
    project_id: string
  },
  binding: MobileBridgeWorkflowBindingResponse['binding'],
): MobileBridgeSessionRuntime {
  return {
    ...(row.provider_profile_id != null ? { providerProfileId: row.provider_profile_id } : {}),
    modelId: row.model_id,
    agentAdapter: row.agent_adapter,
    agentId: row.agent_id,
    permissionMode: row.permission_mode,
    reasoningEffort: row.reasoning_effort,
    chatMode: row.chat_mode,
    projectId: row.project_id,
    workflowBinding: binding,
  }
}

const SESSION_AGENT_ADAPTERS: ReadonlySet<string> = new Set([
  'claude',
  'claude-sdk',
  'codex',
  'spark',
])

/** 移动端传入的 adapter 合法性收敛（白名单外不透传） */
function normalizeAgentAdapter(
  candidate: string,
): 'claude' | 'claude-sdk' | 'codex' | 'spark' | null {
  return SESSION_AGENT_ADAPTERS.has(candidate)
    ? (candidate as 'claude' | 'claude-sdk' | 'codex' | 'spark')
    : null
}

const ALL_PERMISSION_MODES: ReadonlySet<string> = new Set(
  Object.values(ADAPTER_PERMISSION_MODES).flat(),
)

const ALL_REASONING_EFFORTS: ReadonlySet<string> = new Set(REASONING_EFFORTS)

const ALL_CHAT_MODES: ReadonlySet<string> = new Set(['agent', 'ask', 'edit', 'review'])

const CHANGE_BLOCKER_MESSAGES: Record<string, string> = {
  session_busy: '会话正在运行，请稍后再试',
  turn_queue_not_empty: '回合队列未清空，请等待执行完成',
  approval_pending: '有等待确认的审批，先在桌面端处理',
  question_pending: '有等待回答的提问，先在桌面端处理',
  goal_active: '有进行中的目标，先在桌面端结束',
  workflow_run_working: '工作流运行中，先在桌面端停止',
  binding_conflict: '绑定已被其他端修改，请刷新后重试',
}

/** ScheduledTaskItem → 移动端精简形态（列表/面板展示字段） */
function mapScheduledTask(item: ScheduledTaskItem): MobileBridgeScheduledTask {
  return {
    id: item.id,
    name: item.name,
    description: item.description,
    enabled: item.enabled,
    triggerType: item.triggerType,
    intervalSeconds: item.intervalSeconds,
    cronExpression: item.cronExpression,
    runAt: item.runAt,
    prompt: item.promptTemplate,
    status: item.status,
    executionCount: item.executionCount,
    lastRunAt: item.lastRunAt,
    nextRunAt: item.nextRunAt,
    lastError: item.lastError,
  }
}

/** 附件白名单根目录（与粘贴图片落盘同一目录，消息长期引用不能放 temp） */
function mobileAttachmentRootDir(): string {
  return path.join(app.getPath('userData'), 'attachments', 'pasted-images')
}

/** 路径是否落在附件白名单目录内（规范化后前缀校验，防 ../ 逃逸） */
function isWhitelistedAttachmentPath(candidate: string): boolean {
  const root = path.resolve(mobileAttachmentRootDir())
  const resolved = path.resolve(candidate)
  return resolved === root || resolved.startsWith(root + path.sep)
}

function mimeFromExtension(fileName: string): string {
  const ext = path.extname(fileName).toLowerCase()
  const table: Record<string, string> = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.gif': 'image/gif',
    '.bmp': 'image/bmp',
    '.pdf': 'application/pdf',
    '.txt': 'text/plain',
    '.md': 'text/markdown',
    '.json': 'application/json',
    '.csv': 'text/csv',
    '.doc': 'application/msword',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.xls': 'application/vnd.ms-excel',
    '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  }
  return table[ext] ?? 'application/octet-stream'
}

function imageExtensionFromMime(mimeType: string | undefined, fallbackName: string): string {
  const normalized = (mimeType ?? '').toLowerCase()
  if (normalized.includes('jpeg')) return 'jpg'
  if (normalized.includes('webp')) return 'webp'
  if (normalized.includes('gif')) return 'gif'
  if (normalized.includes('bmp')) return 'bmp'
  if (normalized.includes('png')) return 'png'
  const ext = path.extname(fallbackName).toLowerCase()
  return ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp'].includes(ext)
    ? ext.replace('.', '')
    : 'png'
}

function buildDeps(deps: MobileBridgeIpcDeps): MobileBridgeDeps {
  return {
    validateAccountToken: (token) => deps.validateAccountToken(token),

    listProjects: async (limit) => {
      const db = getDatabase()
      const workspaces = deps.getWorkspaceService().listWorkspaces(limit, 0, {})
      // 项目下会话数（排除归档；worktree 会话并入 base workspace，与桌面端侧边栏同口径）
      const countRows = db.raw
        .prepare(
          `SELECT project_id, COUNT(*) AS count FROM sessions WHERE archived_at IS NULL GROUP BY project_id`,
        )
        .all() as { project_id: string; count: number }[]
      const countByProject = new Map<string, number>()
      for (const row of countRows) {
        countByProject.set(row.project_id, row.count)
      }
      // workspace id → 是否 worktree（是则把计数并入 base 后从顶层剔除）
      const worktreeBase = new Map<string, string>()
      for (const workspace of workspaces) {
        const baseId = parseWorktreeBaseId(workspace.worktree_meta_json)
        if (baseId != null) worktreeBase.set(workspace.id, baseId)
      }
      const mergedCounts = new Map(countByProject)
      for (const [worktreeId, baseId] of worktreeBase) {
        const count = mergedCounts.get(worktreeId) ?? 0
        if (count > 0) mergedCounts.set(baseId, (mergedCounts.get(baseId) ?? 0) + count)
        mergedCounts.delete(worktreeId)
      }
      const projects: MobileBridgeProjectSummary[] = workspaces
        .filter((workspace) => !worktreeBase.has(workspace.id))
        .map((workspace) => ({
          id: workspace.id,
          name: workspace.name,
          rootPath: workspace.root_path,
          projectKind: workspace.project_kind,
          pinnedAt: workspace.pinned_at,
          updatedAt: workspace.updated_at,
          sessionCount: mergedCounts.get(workspace.id) ?? 0,
        }))
      return { projects, total: projects.length }
    },

    listSessions: async (limit, projectId) => {
      const db = getDatabase()
      const { sessions, total } = new SessionRepository(db).list({
        limit,
        ...(projectId != null ? { projectId } : {}),
      })
      const previewStmt = db.raw.prepare(
        `SELECT event_json FROM agent_events
         WHERE session_id = ? AND event_type = 'user_message'
         ORDER BY created_at DESC, rowid DESC LIMIT 1`,
      )
      const rows: MobileBridgeSessionSummary[] = sessions.map((row) => {
        let preview = ''
        try {
          const found = previewStmt.get(row.id) as { event_json?: string } | undefined
          if (found?.event_json != null) {
            const parsed = JSON.parse(found.event_json) as { content?: string }
            preview = (parsed.content ?? '').replace(/\s+/g, ' ').trim().slice(0, 60)
          }
        } catch {
          /* 预览缺失不阻塞列表 */
        }
        return {
          id: row.id,
          title: row.title,
          status: row.status,
          updatedAt: row.updated_at,
          preview,
          projectId: row.project_id,
          pinnedAt: row.pinned_at,
        }
      })
      return { sessions: rows, total }
    },

    createSession: async (input) => deps.createMobileSession(input.title, input.projectId),

    updateSession: async (sessionId, patch) => {
      const { agentId, agentAdapter, permissionMode, reasoningEffort, chatMode, ...rest } = patch
      const adapter = agentAdapter != null ? normalizeAgentAdapter(agentAdapter) : null
      if (agentAdapter != null && adapter == null) {
        throw new Error(`不支持的 adapter：${agentAdapter}`)
      }
      // 枚举字段做白名单收敛，非法值直接拒绝（不静默写入脏数据）
      if (permissionMode != null && !ALL_PERMISSION_MODES.has(permissionMode)) {
        throw new Error(`不支持的权限策略：${permissionMode}`)
      }
      if (reasoningEffort != null && !ALL_REASONING_EFFORTS.has(reasoningEffort)) {
        throw new Error(`不支持的推理强度：${reasoningEffort}`)
      }
      if (chatMode != null && !ALL_CHAT_MODES.has(chatMode)) {
        throw new Error(`不支持的聊天模式：${chatMode}`)
      }
      const result = await deps.getSessionService().updateSession({
        sessionId,
        ...rest,
        // SessionUpdateRequest.agentId 非空可空；移动端 null = 清除绑定，此处以「不修改」表达
        ...(agentId != null ? { agentId } : {}),
        ...(adapter != null ? { agentAdapter: adapter } : {}),
        // 白名单校验后显式收窄（Set.has 不改变静态类型）
        ...(permissionMode != null
          ? { permissionMode: permissionMode as SessionPermissionMode }
          : {}),
        ...(reasoningEffort != null
          ? { reasoningEffort: reasoningEffort as SessionReasoningEffort }
          : {}),
        ...(chatMode != null ? { chatMode: chatMode as SessionChatMode } : {}),
      })
      if (patch.archived !== undefined) {
        deps.getScheduledTaskService().setSessionArchived(sessionId, patch.archived)
      }
      const session = result.session
      return {
        id: session.id,
        title: session.title,
        status: session.status,
        updatedAt: session.updatedAt,
        preview: '',
        projectId: session.projectId,
        pinnedAt: session.pinnedAt ?? null,
      }
    },

    deleteSession: async (sessionId) => {
      // 关闭该 session 名下所有内置终端 PTY，再删数据（与 session:delete 行为对齐）
      deps.getTerminalService().disposeBySession(sessionId, { defer: true })
      return deps.getSessionService().deleteSession(sessionId)
    },

    getHistory: async (sessionId, limit) => {
      const history = await deps.getSessionService().getHistory({ sessionId, limit })
      const events: MobileBridgeEvent[] = []
      for (const event of history.events) {
        const mapped = toMobileEvent(event)
        if (mapped != null) events.push(mapped)
      }
      // 运行中 = 最后一条 agent_status 处于非终态。
      // 不能用 some() 扫全历史：历史会话永远残留 thinking 事件，会把 running 判成永真
      // （下游 WS 轮询器因此永不回收，客户端也永远显示「运行中」并锁死输入）。
      let running = false
      for (let i = events.length - 1; i >= 0; i -= 1) {
        const event = events[i]
        if (event != null && event.type === 'agent_status') {
          running =
            event.status === 'thinking' ||
            event.status === 'calling_tool' ||
            event.status === 'waiting_permission' ||
            event.status === 'waiting_user'
          break
        }
      }
      return { events, running }
    },

    submitTurn: async (sessionId, text, attachmentPaths) => {
      const result = await deps.getSessionService().submitTurn({
        sessionId,
        message: text,
        turnSource: 'remote_user',
        // 只信任本服务附件端点落盘产生的路径：白名单前缀校验，防任意路径注入
        ...(attachmentPaths != null && attachmentPaths.length > 0
          ? {
              attachments: attachmentPaths.filter(isWhitelistedAttachmentPath).map((filePath) => ({
                type: (/\.(png|jpe?g|webp|gif|bmp)$/i.test(filePath) ? 'image' : 'file') as
                  | 'image'
                  | 'file',
                path: filePath,
              })),
            }
          : {}),
      })
      return { turnId: result.turnId }
    },

    cancelTurn: async (sessionId) => {
      await deps.getSessionService().cancelTurn(sessionId)
    },

    getDesktopInfo: () => ({
      name: app.getName(),
      version: app.getVersion(),
    }),

    // ─── 会话内配置与输入能力扩展（2026-10-14） ────────────────────────────────

    getCatalog: async () => {
      const db = getDatabase()
      const agents = new AgentRepository(db)
        .list({ includeDisabled: false })
        .filter((agent) => agent.enabled)
        .map((agent) => ({
          id: agent.id,
          name: agent.name,
          description: agent.description,
          agentAdapter: agent.agentAdapter,
          providerProfileId: agent.providerProfileId ?? null,
          modelId: agent.modelId ?? null,
          permissionMode: agent.permissionMode,
          reasoningEffort: agent.reasoningEffort,
          isDefault: agent.isDefault,
        }))
      const workflows = new WorkflowRepository(db)
        .list({ includeArchived: false })
        .filter((workflow) => workflow.enabled)
        .map((workflow) => ({
          id: workflow.id,
          name: workflow.name,
          description: workflow.description,
          enabled: workflow.enabled,
        }))
      const profiles = await deps.getProviderService().listProviders()
      const providers = profiles
        .filter((profile) => profile.enabled !== false)
        .filter((profile) =>
          isConversationalProviderCandidate({
            provider: profile.provider,
            modelType: profile.modelType,
            codexApiKind: profile.codexApiKind,
            mediaProvider: profile.mediaProvider,
            mediaCapabilities: profile.mediaCapabilities,
          }),
        )
        .map((profile) => ({
          id: profile.id,
          name: profile.name,
          providerType: profile.providerType ?? profile.provider,
          isAutoRouter: (profile.providerType ?? '') === 'auto-router',
          models: profile.modelIds.map((modelId) => ({ id: modelId, name: modelId })),
        }))
      return {
        agents,
        workflows,
        providers,
        permissionModes: ADAPTER_PERMISSION_MODES,
        reasoningEfforts: REASONING_EFFORTS,
      }
    },

    getSessionRuntime: async (sessionId) => {
      const db = getDatabase()
      const row = new SessionRepository(db).get(sessionId)
      if (row == null) return null
      let binding: MobileBridgeWorkflowBindingResponse['binding'] = null
      try {
        const wf = deps.getSessionService().getWorkflowBinding(sessionId)
        binding =
          wf.binding == null
            ? null
            : { mode: wf.binding.mode, workflowId: wf.binding.workflowId ?? null }
      } catch {
        /* 绑定信息缺失不阻塞配置回显 */
      }
      return toBridgeRuntime(row, binding)
    },

    getWorkflowBinding: async (sessionId) => {
      const response = deps.getSessionService().getWorkflowBinding(sessionId)
      return {
        binding:
          response.binding == null
            ? null
            : { mode: response.binding.mode, workflowId: response.binding.workflowId ?? null },
        // override 生效时优先展示绑定的工作流名；inherit 时展示继承来源
        effectiveName: response.effective.workflowName ?? null,
        canChange: response.canChange,
        error:
          response.changeBlockers[0] != null
            ? (CHANGE_BLOCKER_MESSAGES[response.changeBlockers[0].code] ??
              response.changeBlockers[0].code)
            : null,
      }
    },

    setWorkflowBinding: async (sessionId, request) => {
      const service = deps.getSessionService()
      const current = service.getWorkflowBinding(sessionId)
      const payload =
        request.mode === 'override'
          ? {
              sessionId,
              mode: 'override' as const,
              workflowId: request.workflowId ?? '',
              expectedBindingInstanceId: current.binding?.bindingInstanceId ?? null,
            }
          : {
              sessionId,
              mode: request.mode,
              expectedBindingInstanceId: current.binding?.bindingInstanceId ?? null,
            }
      const response = service.setWorkflowBinding(payload)
      return {
        binding:
          response.binding == null
            ? null
            : { mode: response.binding.mode, workflowId: response.binding.workflowId ?? null },
        effectiveName: response.effective.workflowName ?? null,
        canChange: true,
        error:
          response.error != null
            ? (CHANGE_BLOCKER_MESSAGES[response.error.code] ?? response.error.code)
            : null,
      }
    },

    saveAttachments: async (sessionId, files) => {
      void sessionId
      const rootDir = mobileAttachmentRootDir()
      await fs.mkdir(rootDir, { recursive: true })
      const saved: MobileBridgeAttachment[] = []
      for (const file of files) {
        const buffer = Buffer.from(file.dataBase64, 'base64')
        if (buffer.length === 0) continue
        const isImage = (file.mimeType ?? '').startsWith('image/')
        const extension = isImage
          ? imageExtensionFromMime(file.mimeType, file.name)
          : path.extname(file.name).replace(/[^a-zA-Z0-9.]/g, '') || '.bin'
        const safeBase = file.name.replace(/[^a-zA-Z0-9._-]+/g, '-').slice(0, 64) || 'file'
        const fileName = `mobile-${safeBase.replace(/\.[^.]*$/, '')}-${randomUUID().slice(0, 8)}.${extension}`
        const filePath = path.join(rootDir, fileName)
        // 图片压缩到 ≤2000px（SDK read_file 限制）；失败内部降级返回原 buffer，不阻塞落盘
        const resized = isImage
          ? await resizePastedImageBuffer(buffer, { maxEdge: PASTED_IMAGE_MAX_EDGE })
          : { buffer }
        await fs.writeFile(filePath, resized.buffer)
        saved.push({
          type: isImage ? 'image' : 'file',
          path: filePath,
          name: file.name,
        })
      }
      return saved
    },

    readAttachmentContent: async (candidate) => {
      if (!isWhitelistedAttachmentPath(candidate)) return null
      try {
        const data = await fs.readFile(candidate)
        return { data, mimeType: mimeFromExtension(candidate) }
      } catch {
        return null
      }
    },

    transcribeAudio: (input) => deps.getVoiceTranscriber().transcribe(input),

    listSessionTasks: async (sessionId) =>
      deps
        .getScheduledTaskService()
        .listTasks({ scope: 'session', sessionId })
        .map(mapScheduledTask),

    createSessionTask: async (sessionId, request) => {
      const service = deps.getScheduledTaskService()
      const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
      const created = service.createTask({
        id,
        name: request.name.trim(),
        description: '',
        enabled: true,
        scope: 'session',
        session_id: sessionId,
        paused_by_archive: false,
        skip_if_session_running: true,
        continue_on_error: true,
        trigger_type: request.triggerType,
        interval_seconds: request.intervalSeconds ?? null,
        cron_expression: request.cronExpression ?? null,
        run_at: request.runAt ?? null,
        timezone: 'system',
        start_at: null,
        end_at: null,
        max_executions: 0,
        agent_id: null,
        team_id: null,
        model_id: request.modelId ?? null,
        workspace_id: null,
        prompt_template: request.prompt.trim(),
        permission_mode: 'auto',
        permission_profile_id: null,
        timeout_seconds: request.timeoutSeconds ?? 300,
        max_retries: request.maxRetries ?? 0,
        retry_delay_seconds: 60,
        retry_backoff: 'fixed',
        notifications: [],
        concurrency_policy: 'skip',
        tags: ['mobile'],
        history_retention_days: 30,
      } as unknown as Parameters<typeof service.createTask>[0])
      return mapScheduledTask(created)
    },

    updateSessionTask: async (taskId, request: MobileBridgeUpdateScheduledTaskRequest) => {
      const updates: Record<string, unknown> = {}
      if (request.name !== undefined) updates.name = request.name
      if (request.prompt !== undefined) updates.prompt_template = request.prompt
      if (request.triggerType !== undefined) updates.trigger_type = request.triggerType
      if (request.intervalSeconds !== undefined) updates.interval_seconds = request.intervalSeconds
      if (request.cronExpression !== undefined) updates.cron_expression = request.cronExpression
      if (request.runAt !== undefined) updates.run_at = request.runAt
      if (request.enabled !== undefined) updates.enabled = request.enabled
      const service = deps.getScheduledTaskService()
      if (Object.keys(updates).length === 0) {
        const existing = service.getTask(taskId)
        return existing != null ? mapScheduledTask(existing) : null
      }
      const updated = service.updateTask(taskId, updates)
      return updated != null ? mapScheduledTask(updated) : null
    },

    deleteSessionTask: async (taskId) => deps.getScheduledTaskService().deleteTask(taskId),

    toggleSessionTask: async (taskId, enabled) => {
      const service = deps.getScheduledTaskService()
      const task = enabled ? service.enableTask(taskId) : service.disableTask(taskId)
      return task != null ? mapScheduledTask(task) : null
    },

    runSessionTaskNow: async (taskId) => {
      await deps.getScheduledTaskService().runNow(taskId)
      return { started: true }
    },

    listCommands: async (sessionId) => {
      const items = deps.getSessionService().listCommands(sessionId || undefined)
      const commands: MobileBridgeCommandItem[] = items.map((item) => ({
        name: item.name,
        description: item.description,
        layer: item.layer,
        ...(item.usage != null ? { usage: item.usage } : {}),
      }))
      return commands
    },

    executeCommand: async (sessionId, raw) => {
      const result = await deps.getSessionService().executeCommandAsEvents({
        sessionId,
        message: raw,
      })
      if (!result.isCommand) {
        return { isCommand: false, forwardToAgent: false }
      }
      return {
        isCommand: true,
        forwardToAgent: result.forwardToAgent === true,
        // 会话运行中命令进队列等当前回合结束（桌面端同语义），端上据此提示
        ...(result.queued === true ? { queued: true } : {}),
        ...(result.forwardToAgent === true ? { message: '命令已转发给助手执行' } : {}),
      }
    },
  }
}

export function registerMobileBridgeIpc(deps: MobileBridgeIpcDeps): void {
  const bridge = getService(deps)

  typedIpcHandle('mobile-bridge:get-status', async () => bridge.getStatus())

  typedIpcHandle('mobile-bridge:update-settings', async (request) => {
    const current = bridge.getStatus().settings
    const next: MobileBridgeSettings = {
      enabled: request.enabled ?? current.enabled,
      port: request.port ?? current.port,
    }
    if (!Number.isInteger(next.port) || next.port < 0 || next.port > 65535) {
      throw new Error('端口必须是 0-65535 的整数（0 表示随机）')
    }
    await bridge.applySettings(next)
    return bridge.getStatus()
  })

  typedIpcHandle('mobile-bridge:revoke-device', async (request) => {
    bridge.revokeDevice(request.deviceId)
    return bridge.getStatus()
  })

  // ── 云端中继 ────────────────────────────────────────────────────────────────
  const settings = deps.getSettingsService()
  const relay = getRelayClient(deps)

  typedIpcHandle('mobile-bridge:get-relay-status', async () => relay.getStatus())

  typedIpcHandle('mobile-bridge:update-relay-settings', async (request) => {
    const store = readRelayStore(settings)
    const next: MobileBridgeRelaySettings = {
      enabled: request.enabled ?? store.settings.enabled,
      baseUrl: request.baseUrl ?? store.settings.baseUrl,
    }
    // ws/wss 也接受：设置页回显的是实际连接地址（wss://…），粘回来不该被拒
    if (next.baseUrl.trim() && !/^(https?|wss?):\/\//i.test(next.baseUrl.trim())) {
      throw new Error('中继地址必须以 http:// 或 https:// 开头')
    }
    writeRelayStore(settings, { ...store, settings: next })
    await relay.restart()
    return relay.getStatus()
  })

  typedIpcHandle('mobile-bridge:reset-relay-identity', async () => {
    // 重新授信：生成全新设备身份（旧 deviceId 已被服务端永久拉黑，复用无意义）
    const store = readRelayStore(settings)
    writeRelayStore(settings, {
      ...store,
      deviceId: randomUUID(),
      deviceSecret: randomBytes(32).toString('hex'),
    })
    log.info('relay identity reset (re-trust requested)')
    await relay.resetIdentity()
    return relay.getStatus()
  })

  // 按设置启动（关闭态不监听；端口冲突等错误只记日志，不阻塞启动序列）
  void bridge.start().catch((error) => {
    log.warn(
      `mobile bridge start failed: ${error instanceof Error ? error.message : String(error)}`,
    )
  })
  // 中继是出网长连接，无端口冲突风险；失败由客户端内部退避重试
  void relay.start().catch((error) => {
    log.warn(
      `mobile bridge relay start failed: ${error instanceof Error ? error.message : String(error)}`,
    )
  })
  log.info('mobile bridge ipc registered')
}

/** 测试辅助：重置单例 */
export function __resetMobileBridgeServiceForTesting(): void {
  service = null
  relayClient = null
}

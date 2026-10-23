/**
 * 移动桥接 IPC 注册 + 依赖装配。
 *
 * 装配层职责（本文件）：
 *   1. 创建 MobileBridgeService（中继合成请求的业务路由层；局域网直连已移除，
 *      服务本身不再有网络监听与独立持久化）
 *   2. 注入 deps 闭包（会话仓库 / SessionService），避免服务层反向依赖
 *   3. 注册设置 IPC（get-relay-status / update-relay-settings / reset-relay-identity）
 *   4. 按设置启动云端中继长连接（MobileBridgeRelayClient）
 *
 * 主进程 ipc/index.ts 只加一行 registerMobileBridgeIpc({...}) 调用。
 */

import { app } from 'electron'
import fs from 'node:fs/promises'
import { realpathSync } from 'node:fs'
import path from 'node:path'
import { hostname } from 'node:os'
import { randomUUID, randomBytes } from 'node:crypto'
import type {
  AgentEvent,
  MobileBridgeApprovalDecision,
  MobileBridgeApprovalItem,
  MobileBridgeAttachment,
  MobileBridgeCatalog,
  MobileBridgeCommandItem,
  MobileBridgeCreateScheduledTaskRequest,
  MobileBridgeEvent,
  MobileBridgeProjectSummary,
  MobileBridgeQuestionItem,
  MobileBridgeRelaySettings,
  MobileBridgeRelayStatus,
  MobileBridgeScheduledTask,
  MobileBridgeSessionRuntime,
  MobileBridgeSessionSummary,
  MobileBridgeSetWorkflowBindingRequest,
  MobileBridgeSkillItem,
  MobileBridgeUpdateScheduledTaskRequest,
  MobileBridgeUploadAttachmentsRequest,
  MobileBridgeWorkflowBindingResponse,
  PermissionApprovalRequest,
  ScheduledTaskItem,
  SessionListResponse,
  UserQuestionRequest,
} from '@spark/protocol'
import {
  isConversationalProviderCandidate,
  NO_PROJECT_WORKSPACE_NAME,
  SESSION_LABEL_KEYS,
} from '@spark/protocol'
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
  SkillService,
  WorkspaceService,
} from '@spark/agent-runtime'
import { getDatabase } from '../db.js'
import { typedIpcHandle, pushStreamEvent } from './typed-ipc.js'
import { SidebarOrderController } from './registerSidebarOrderIpc.js'
import {
  AgentRepository,
  SessionRepository,
  SettingsRepository,
  WorkflowRepository,
  WorkspaceRepository,
} from '@spark/storage'
import { PASTED_IMAGE_MAX_EDGE, resizePastedImageBuffer } from '../services/PastedImageResizer.js'
import { calibrateMobileBridgeSessionAdapter } from '../services/mobile-bridge-session-adapter.js'
import { isPathWithinRoots } from './mobile-bridge-path-policy.js'
import type { RemoteVoiceTranscriber } from '../services/remoteVoiceTranscription.js'
import { DEFAULT_MOBILE_BRIDGE_RELAY_SETTINGS } from '@spark/protocol'
import { MobileBridgeService, type MobileBridgeDeps } from '../services/MobileBridgeService.js'
import { MobileBridgeRelayClient } from '../services/MobileBridgeRelayClient.js'
import { RemoteAgentExecutionService } from '../services/RemoteAgentExecutionService.js'
import { getAuthService } from '../services/Auth/AuthService.js'
import { createLogger, SparkError } from '@spark/shared'

const log = createLogger('mobile-bridge:ipc')

const SETTINGS_CATEGORY = 'mobileBridge'
/**
 * 云端中继单独一个键（'relay'）：身份（deviceId/secret/label）+ 开关地址。
 * 旧版局域网桥接在同一分类的 'store' 键里留有 port/pairedDevices 等 LAN 字段，
 * 已不再读写——老用户配置原样保留、静默忽略（向后兼容，不炸配置）。
 */
const RELAY_SETTINGS_KEY = 'relay'

export interface MobileBridgeIpcDeps {
  getSessionService(): SessionService
  getSettingsService(): SettingsService
  getWorkspaceService(): WorkspaceService
  /**
   * 删除会话/项目时关闭名下内置终端 PTY（与 session:delete、workspace:delete 行为对齐）；
   * 最小结构类型避免依赖桌面端本地实现
   */
  getTerminalService(): {
    disposeBySession(sessionId: string, opts?: { defer?: boolean }): number
    disposeByWorkspaceId(workspaceId: string, opts?: { defer?: boolean }): number
  }
  /** 归档会话时同步暂停关联定时任务（与 session:update 行为对齐） */
  getScheduledTaskService(): ScheduledTaskService
  /**
   * 账号 token 校验（edu-server /me）。
   * ⚠️ LAN 配对移除后已无消费方；字段保留是因为装配入口（ipc/index.ts）仍在
   * 传入该参数，避免本次改动扩散到装配文件，后续清理装配层时可一并删除。
   */
  validateAccountToken(token: string): Promise<{ userId: string; account: string } | null>
  /** 新建会话（默认渠道/引擎/权限，与远程建会话同规则；projectId 归属项目） */
  createMobileSession(title?: string, projectId?: string): Promise<MobileBridgeSessionSummary>
  /** 渠道列表（catalog 过滤 LLM 渠道用） */
  getProviderService(): ProviderService
  /** 技能服务（移动端技能选择器只读列表；桥接不做 ensureBuiltInSkills 等重扫动作） */
  getSkillService(): SkillService
  /** 入站语音转写（本地 SenseVoice → 云渠道兜底；与远程连接共用实例） */
  getVoiceTranscriber(): RemoteVoiceTranscriber
  /** edu-server access token（云端中继握手用）；未登录返回 null */
  getRelayAccessToken(): Promise<string | null>
  /** edu-server 基址（中继地址留空时回落到这里） */
  getRelayBaseUrl(): string
  /** 权限审批服务（挂起列表 + 移动端应答；与桌面审批/远程连接共用同一实例） */
  getPermissionService(): {
    listPendingApprovals(sessionId: string): PermissionApprovalRequest[]
    resolveApproval(requestId: string, decision: MobileBridgeApprovalDecision): boolean
  }
  /** 挂起用户问答注册表（AskUserQuestion；与桌面弹卡/远程问答桥共用同一实例） */
  getPendingUserQuestions(): {
    list(sessionId?: string): UserQuestionRequest[]
    resolve(
      sessionId: string,
      questionId: string,
      answers: Record<string, unknown>,
    ): Promise<boolean>
  }
}

/** 云端中继持久化形态：开关/地址 + 本机设备身份（deviceId/secret/label，重置设备身份时整体换新） */
interface RelayStoreShape {
  settings: MobileBridgeRelaySettings
  deviceId: string
  /** 设备密钥：接入凭据，仅本机明文保存；服务端只存 SHA-256 哈希 */
  deviceSecret: string
  /** 设备展示名（默认取主机名；连接时上报，设置页与小程序设备管理展示用） */
  label: string
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
      label: hostname(),
    }
    settings.set(SETTINGS_CATEGORY, RELAY_SETTINGS_KEY, fresh)
    return fresh
  }
  const record = raw as Record<string, unknown>
  const deviceId =
    typeof record.deviceId === 'string' && record.deviceId ? record.deviceId : randomUUID()
  // 旧版本 store 没有 secret：补生成（服务端首见即自动注册）
  const deviceSecret =
    typeof record.deviceSecret === 'string' && record.deviceSecret
      ? record.deviceSecret
      : randomBytes(32).toString('hex')
  // 旧版本 store 没有 label：回落主机名并补写（与 deviceId/secret 同策略）
  const label = typeof record.label === 'string' && record.label.trim() ? record.label : hostname()
  const stored: MobileBridgeRelaySettings =
    record.settings != null && typeof record.settings === 'object'
      ? {
          ...DEFAULT_MOBILE_BRIDGE_RELAY_SETTINGS,
          ...(record.settings as MobileBridgeRelaySettings),
        }
      : { ...DEFAULT_MOBILE_BRIDGE_RELAY_SETTINGS }
  const shape: RelayStoreShape = { settings: stored, deviceId, deviceSecret, label }
  // 身份字段是首次读取时生成的，补写一次保证稳定
  if (
    deviceId !== record.deviceId ||
    deviceSecret !== record.deviceSecret ||
    label !== record.label
  ) {
    settings.set(SETTINGS_CATEGORY, RELAY_SETTINGS_KEY, shape)
  }
  return shape
}

export function getMobileBridgeDeviceId(settings: SettingsService): string {
  return readRelayStore(settings).deviceId
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
    getDeviceLabel: () => readRelayStore(settings).label,
    getVersion: () => app.getVersion(),
    invoke: (method, urlPath, body) => bridge.invokeRelay(method, urlPath, body),
    subscribe: (sessionId, sendEvents) => bridge.addRelaySubscriber(sessionId, sendEvents),
  })
  return relayClient
}

function getService(deps: MobileBridgeIpcDeps): MobileBridgeService {
  if (service != null) return service
  // 局域网直连移除后服务不再有独立持久化（旧 LAN store 见文件头注释）；
  // 这里只负责装配业务 deps，供中继合成请求按需调用。
  service = new MobileBridgeService()
  const bridgeDeps = buildDeps(deps)
  service.setDeps(bridgeDeps)
  const remoteAgentExecution = new RemoteAgentExecutionService({
    getDatabase,
    getSessionService: deps.getSessionService,
    getAccountUserId: () => {
      try {
        return getAuthService().getCurrentUserId()
      } catch {
        return null
      }
    },
    getDeviceId: () => readRelayStore(deps.getSettingsService()).deviceId,
    saveAttachments: bridgeDeps.saveAttachments,
  })
  service.setRemoteAgentRelayHandler((method, urlPath, body) =>
    remoteAgentExecution.handleRelayRequest(method, urlPath, body),
  )
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
      return {
        ...base,
        type: 'user_message',
        content: event.content,
        // 随消息附件透传（目录引用不透出）；端上渲染历史附件缩略图（图片走本地缓存）
        ...(event.attachments != null
          ? {
              attachments: event.attachments
                .filter((att) => att.type !== 'directory')
                .map((att) => ({
                  type: att.type as 'image' | 'file',
                  path: att.path,
                  ...(att.name != null ? { name: att.name } : {}),
                })),
            }
          : {}),
      }
    case 'assistant_message':
      return {
        ...base,
        type: 'assistant_message',
        content: event.content,
        mode: event.mode,
        isFinal: event.isFinal,
        ...(event.segmentId != null ? { segmentId: event.segmentId } : {}),
      }
    case 'agent_thinking':
      return {
        ...base,
        type: 'agent_thinking',
        content: event.content,
        mode: event.mode,
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
    case 'presented_files':
      // agent 呈现的产物文件全量透传；端上按扩展名过滤图片后走本地缓存展示
      return { ...base, type: 'presented_files', files: event.files }
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

// ─── 挂起交互投影：桌面审批/问答请求 → 移动端卡片数据（exactOptionalPropertyTypes 同口径） ──

function toBridgeApproval(request: PermissionApprovalRequest): MobileBridgeApprovalItem {
  return {
    requestId: request.requestId,
    sessionId: request.sessionId,
    toolName: request.toolName,
    action: request.action,
    riskLevel: request.riskLevel,
    toolInput: request.toolInput,
    createdAt: request.createdAt ?? '',
    ...(request.defaultToNo === true ? { defaultToNo: true } : {}),
  }
}

function toBridgeQuestion(request: UserQuestionRequest): MobileBridgeQuestionItem {
  return {
    questionId: request.questionId,
    sessionId: request.sessionId,
    createdAt: request.createdAt,
    questions: request.questions,
  }
}

/** SessionService 会话条目 → 移动端摘要（fork 子会话返回用；与 updateSession 装配同口径） */
function toBridgeSessionSummary(
  session: SessionListResponse['sessions'][number],
): MobileBridgeSessionSummary {
  return {
    id: session.id,
    title: session.title,
    status: session.status,
    updatedAt: session.updatedAt,
    preview: '',
    projectId: session.projectId,
    pinnedAt: session.pinnedAt ?? null,
    sessionLabel: session.sessionLabel ?? null,
    labeledAt: session.labeledAt ?? null,
  }
}

/** 附件白名单根目录（与粘贴图片落盘同一目录，消息长期引用不能放 temp） */
function mobileAttachmentRootDir(): string {
  return path.join(app.getPath('userData'), 'attachments', 'pasted-images')
}

/**
 * 工作区白名单根目录提供器（buildDeps 装配时注入）。
 * agent 产物落在本机工作区内，小程序经中继查看时必须放行——但项目会增删，
 * 根列表必须动态求值：装配层提供惰性取值 + 30s TTL 缓存（见 buildDeps）。
 * 未装配时（模块加载早期）只放行 pasted-images 根，行为与旧版一致。
 */
let workspaceRootsProvider: () => string[] = () => []

/** 路径是否落在附件/工作区白名单目录内（规范化后前缀校验，防 ../ 逃逸） */
function isWhitelistedAttachmentPath(candidate: string): boolean {
  return isPathWithinRoots(candidate, [mobileAttachmentRootDir(), ...workspaceRootsProvider()])
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

/**
 * 侧栏手动排序控制器（桥接用惰性单例）。
 * 与 registerSidebarOrderIpc 的 IPC 实例分开：桥接的数据库就绪时机不同，
 * 延迟到首次调用再建，避免装配期触碰 getDatabase()。
 */
let sidebarOrderController: SidebarOrderController | null = null
function getSidebarOrderController(): SidebarOrderController {
  if (sidebarOrderController != null) return sidebarOrderController
  const db = getDatabase()
  sidebarOrderController = new SidebarOrderController({
    settings: new SettingsRepository(db),
    workspaces: new WorkspaceRepository(db),
    sessions: new SessionRepository(db),
  })
  return sidebarOrderController
}

/** 附件单文件读取上限（工作区内大文件整体读入会放大 3 份峰值内存，超限拒绝） */
const MAX_ATTACHMENT_READ_BYTES = 20 * 1024 * 1024

function buildDeps(deps: MobileBridgeIpcDeps): MobileBridgeDeps {
  // 工作区白名单根：惰性求值 + 30s TTL（附件校验高频调用，不能每附件扫全表；
  // 拉取失败保留上一份缓存——启动早期 DB 未就绪时不放行任何工作区路径）
  const workspaceRootsCache: { roots: string[]; fetchedAt: number } = { roots: [], fetchedAt: 0 }
  const WORKSPACE_ROOTS_TTL_MS = 30_000
  workspaceRootsProvider = () => {
    const now = Date.now()
    if (now - workspaceRootsCache.fetchedAt < WORKSPACE_ROOTS_TTL_MS) {
      return workspaceRootsCache.roots
    }
    try {
      const workspaces = deps.getWorkspaceService().listWorkspaces(500, 0, {})
      workspaceRootsCache.roots = workspaces
        .map((workspace) => workspace.root_path)
        .filter(
          (rootPath): rootPath is string => typeof rootPath === 'string' && rootPath.length > 0,
        )
        .map((rootPath) => {
          try {
            // realpath 归一：macOS /tmp→/private/tmp、网盘同步目录等 symlink 根，
            // 不归一会让「前缀白名单」与「读取时 realpath 复核」两层互相打架，
            // 工作区内合法附件被整片误拒
            return realpathSync(rootPath)
          } catch {
            log.warn(`mobile bridge workspace root missing, skipped: ${rootPath}`)
            return null
          }
        })
        .filter((rootPath): rootPath is string => rootPath != null)
    } catch (error) {
      log.warn(
        `mobile bridge workspace roots refresh failed: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
    workspaceRootsCache.fetchedAt = now
    return workspaceRootsCache.roots
  }

  return {
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
          // 列表投影恒 null（listWorkspaces 默认排除已归档）；真实值仅写响应携带
          archivedAt: workspace.archived_at ?? null,
          updatedAt: workspace.updated_at,
          sessionCount: mergedCounts.get(workspace.id) ?? 0,
        }))
      return { projects, total: projects.length }
    },

    listSessions: async (limit, projectId) => {
      const db = getDatabase()
      const sessionRepository = new SessionRepository(db)
      let projectIds: string[] | null = null
      if (projectId != null && projectId !== 'default') {
        projectIds = [projectId]
        const worktrees = db.raw
          .prepare(
            `SELECT id, worktree_meta_json FROM workspaces
             WHERE archived_at IS NULL AND worktree_meta_json IS NOT NULL`,
          )
          .all() as { id: string; worktree_meta_json: string | null }[]
        for (const worktree of worktrees) {
          if (parseWorktreeBaseId(worktree.worktree_meta_json) === projectId) {
            projectIds.push(worktree.id)
          }
        }
      }
      const queryResults =
        projectIds == null
          ? [
              sessionRepository.list({
                limit,
                ...(projectId != null ? { projectId } : {}),
              }),
            ]
          : projectIds.map((id) => sessionRepository.list({ limit, projectId: id }))
      // 置顶区语义与桌面端渲染 sortSessionsByPinned 同口径：
      // pinnedAt 或会话标记任一存在即入置顶区，区内按有效置顶时间（pinnedAt ?? labeledAt）倒序，
      // 普通区按 updatedAt 倒序（session-pure-utils 解析语义：标记非法时两者都视为 null）。
      const toSessionLabelMeta = (row: { metadata_json: string }) => {
        let sessionLabel: MobileBridgeSessionSummary['sessionLabel'] = null
        let labeledAt: string | null = null
        try {
          const meta = JSON.parse(row.metadata_json || '{}') as {
            sessionLabel?: unknown
            labeledAt?: unknown
          }
          if (
            typeof meta.sessionLabel === 'string' &&
            (SESSION_LABEL_KEYS as readonly string[]).includes(meta.sessionLabel)
          ) {
            sessionLabel = meta.sessionLabel as MobileBridgeSessionSummary['sessionLabel']
            if (typeof meta.labeledAt === 'string' && meta.labeledAt) labeledAt = meta.labeledAt
          }
        } catch {
          /* 标记解析失败按未打标处理 */
        }
        return { sessionLabel, labeledAt }
      }
      const sessionRows = queryResults.flatMap((result) => result.sessions)
      const metaBySession = new Map(
        sessionRows.map((row) => [row.id, toSessionLabelMeta(row)] as const),
      )
      const sessions = sessionRows
        .sort((a, b) => {
          const metaA = metaBySession.get(a.id)
          const metaB = metaBySession.get(b.id)
          const zoneA = a.pinned_at != null || metaA?.sessionLabel != null
          const zoneB = b.pinned_at != null || metaB?.sessionLabel != null
          if (zoneA !== zoneB) return zoneA ? -1 : 1
          if (zoneA && zoneB) {
            const pinTimeA = a.pinned_at ?? metaA?.labeledAt ?? ''
            const pinTimeB = b.pinned_at ?? metaB?.labeledAt ?? ''
            const pinOrder = pinTimeB.localeCompare(pinTimeA)
            if (pinOrder !== 0) return pinOrder
          }
          return b.updated_at.localeCompare(a.updated_at)
        })
        .slice(0, limit)
      const total = queryResults.reduce((count, result) => count + result.total, 0)
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
        const labelMeta = metaBySession.get(row.id)
        return {
          id: row.id,
          title: row.title,
          status: row.status,
          updatedAt: row.updated_at,
          preview,
          projectId: row.project_id,
          pinnedAt: row.pinned_at,
          sessionLabel: labelMeta?.sessionLabel ?? null,
          labeledAt: labelMeta?.labeledAt ?? null,
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
      // 会话标记白名单（route 层已校验，这里兜底拒绝脏值；null = 取消标记，直接放行）
      if (
        patch.sessionLabel != null &&
        !(SESSION_LABEL_KEYS as readonly string[]).includes(patch.sessionLabel)
      ) {
        throw new Error(`不支持的会话标记：${String(patch.sessionLabel)}`)
      }
      // 引擎×渠道协议校准：移动端 PATCH 只带 provider/model，不带引擎。切换到
      // 与会话引擎不兼容的渠道协议时（如 codex 会话切 Anthropic 渠道），在此
      // 按新渠道校准引擎并回落权限档位，否则下一轮 turn 撞引擎守卫直接报错。
      // 调用方显式传了 agentAdapter 时不校准（显式值优先，不做二次改写）。
      const providerSwitchCalibration =
        patch.providerProfileId != null && adapter == null
          ? await calibrateMobileBridgeSessionAdapter({
              sessionId,
              providerProfileId: patch.providerProfileId,
              providers: await deps.getProviderService().listProviders(),
              getCurrentAdapter: (id) =>
                new SessionRepository(getDatabase()).get(id)?.agent_adapter ?? null,
            })
          : null
      const result = await deps.getSessionService().updateSession({
        sessionId,
        ...rest,
        // SessionUpdateRequest.agentId 非空可空；移动端 null = 清除绑定，此处以「不修改」表达
        ...(agentId != null ? { agentId } : {}),
        ...(adapter != null ? { agentAdapter: adapter } : {}),
        ...(providerSwitchCalibration != null
          ? {
              agentAdapter: providerSwitchCalibration.agentAdapter,
              // 引擎权限值集互斥（codex-* 原值跨引擎无效），未显式指定时回落新引擎默认档
              ...(permissionMode == null
                ? { permissionMode: providerSwitchCalibration.permissionMode }
                : {}),
            }
          : {}),
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
        // 打标回显：端上校验写请求是否真被桌面端接受（旧版本不识别该字段）
        sessionLabel: session.sessionLabel ?? null,
        labeledAt: session.labeledAt ?? null,
      }
    },

    // ─── 项目与侧栏排序（移动端反向设置桌面端侧栏） ──────────────────────────────

    updateProject: async (projectId, patch) => {
      // 保留项目守卫：桌面端侧栏按名称查找「不使用项目」工作区（分组不变量），
      // 重命名/归档会破坏该查找；删除在 deleteProject 单独守卫。
      if (patch.name !== undefined || patch.archived !== undefined) {
        const existing = new WorkspaceRepository(getDatabase()).get(projectId)
        if (existing?.name === NO_PROJECT_WORKSPACE_NAME) {
          throw new SparkError('VALIDATION_FAILED', '「不使用项目」是系统保留项目，不能改名或归档')
        }
      }
      // 反向守卫：把其他项目改名为保留名同样会产生重名，破坏按名称查找
      // （与保留项目同名的工作区会被 main 进程多处 find(w => w.name === ...) 误认）
      if (patch.name === NO_PROJECT_WORKSPACE_NAME) {
        throw new SparkError('VALIDATION_FAILED', '「不使用项目」是系统保留名称，不能作为项目名')
      }
      const workspace = deps.getWorkspaceService().updateWorkspace(projectId, {
        // 与 workspace:update IPC 同换算：name 原文；pinned/archived 布尔 → ISO 时间 / null
        ...(patch.name !== undefined ? { name: patch.name } : {}),
        ...(patch.pinned !== undefined
          ? { pinnedAt: patch.pinned ? new Date().toISOString() : null }
          : {}),
        ...(patch.archived !== undefined
          ? { archivedAt: patch.archived ? new Date().toISOString() : null }
          : {}),
      })
      const countRow = getDatabase()
        .raw.prepare(
          `SELECT COUNT(*) AS count FROM sessions WHERE project_id = ? AND archived_at IS NULL`,
        )
        .get(projectId) as { count: number }
      return {
        id: workspace.id,
        name: workspace.name,
        rootPath: workspace.root_path,
        projectKind: workspace.project_kind,
        pinnedAt: workspace.pinned_at,
        // 归档回显：端上据此校验写请求是否真被桌面端接受（旧版本 400 不会走到这里）
        archivedAt: workspace.archived_at ?? null,
        updatedAt: workspace.updated_at,
        sessionCount: countRow.count,
      }
    },

    deleteProject: async (projectId) => {
      // 保留项目守卫：删掉「不使用项目」会破坏桌面端侧栏的名称查找与新建临时会话落点
      const existing = new WorkspaceRepository(getDatabase()).get(projectId)
      if (existing?.name === NO_PROJECT_WORKSPACE_NAME) {
        throw new SparkError('VALIDATION_FAILED', '「不使用项目」是系统保留项目，不能删除')
      }
      // 与 workspace:delete IPC 同链路：级联删会话 + 后台清事件 + 关终端 PTY + 删项目
      const sessionRepo = new SessionRepository(getDatabase())
      const deletedSessionIds = sessionRepo.deleteByWorkspaceId(projectId)
      for (const sessionId of deletedSessionIds) {
        deps.getSessionService().cleanupSessionEventsInBackground(sessionId)
      }
      deps.getTerminalService().disposeByWorkspaceId(projectId, { defer: true })
      const deleted = deps.getWorkspaceService().deleteWorkspace(projectId)
      return { deleted }
    },

    searchSessions: async (query, projectId, limit) => {
      const effectiveLimit = Math.max(1, Math.min(limit ?? 20, 50))
      if (projectId != null && projectId !== 'default') {
        // 真实项目直接透传 workspaceId（与桌面端 session:search 同语义）
        return deps.getSessionService().searchSessions({
          query,
          workspaceId: projectId,
          limit: effectiveLimit,
        })
      }
      const result = await deps.getSessionService().searchSessions({
        query,
        limit: effectiveLimit,
      })
      if (projectId == null) return result
      // 'default'（虚拟未归属）会话 workspace_ids 为空数组，workspaceId 过滤命不中：
      // 全量搜索后按 project_id 精确回滤（结果 ≤ limit 条，逐条回查成本可忽略）
      const stmt = getDatabase().raw.prepare('SELECT project_id FROM sessions WHERE id = ?')
      const results = result.results.filter((item) => {
        const row = stmt.get(item.sessionId) as { project_id: string } | undefined
        return row?.project_id === 'default'
      })
      return { results }
    },

    getSidebarOrder: () => getSidebarOrderController().list(),

    updateSidebarOrder: async (request) => ({
      itemIds: getSidebarOrderController().update(request),
    }),

    // 手机上的置顶/打标/调序写成功后广播，桌面端侧栏订阅后立即重拉（双向同步闭环）
    notifySidebarChanged: () => {
      pushStreamEvent('stream:session:list-changed', { source: 'mobile-bridge' })
    },

    deleteSession: async (sessionId) => {
      // 关闭该 session 名下所有内置终端 PTY，再删数据（与 session:delete 行为对齐）
      deps.getTerminalService().disposeBySession(sessionId, { defer: true })
      return deps.getSessionService().deleteSession(sessionId)
    },

    getHistory: async (sessionId, query) => {
      const history = await deps.getSessionService().getHistory({
        sessionId,
        ...query,
      })
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
      const nextBeforeSeq = history.events[0]?.seq
      return {
        events,
        running,
        hasMore: history.hasMore,
        ...(nextBeforeSeq != null ? { nextBeforeSeq } : {}),
      }
    },

    getStreamEvents: async (sessionId, afterSeq) => {
      // 历史分页会有意排除 delta，避免加载完整历史时解析数千条增量事件。
      // 实时流按游标只读新事件，因此可以保留 assistant/thinking 的 delta 而不重扫历史。
      const rows = getDatabase()
        .raw.prepare(
          `SELECT event_json, seq FROM agent_events
           WHERE session_id = ? AND seq > ?
           ORDER BY seq ASC, created_at ASC, rowid ASC
           LIMIT 500`,
        )
        .all(sessionId, afterSeq) as Array<{ event_json: string; seq: number }>
      const events: MobileBridgeEvent[] = []
      for (const row of rows) {
        try {
          const event = JSON.parse(row.event_json) as AgentEvent
          const mapped = toMobileEvent(event)
          if (mapped != null) events.push(mapped)
        } catch {
          // 单条损坏事件不阻断后续事件；nextSeq 仍推进到原始行游标。
        }
      }
      const lastRow = rows[rows.length - 1]
      return { events, nextSeq: lastRow?.seq ?? afterSeq }
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

    // ─── 挂起交互（审批 + 问答；移动端审批卡/问答卡数据源与应答通道） ──────────

    listPendingInteractions: async (sessionId) => ({
      approvals: deps.getPermissionService().listPendingApprovals(sessionId).map(toBridgeApproval),
      questions: deps.getPendingUserQuestions().list(sessionId).map(toBridgeQuestion),
    }),

    resolveApproval: async (sessionId, requestId, decision) => {
      // 先确认 requestId 属于该会话再应答：防跨会话串单（桌面端渲染端按推送对账，无此问题）
      const pending = deps
        .getPermissionService()
        .listPendingApprovals(sessionId)
        .some((request) => request.requestId === requestId)
      if (!pending) return false
      return deps.getPermissionService().resolveApproval(requestId, decision)
    },

    answerQuestion: async (sessionId, questionId, answers) => {
      const store = deps.getPendingUserQuestions()
      if (!store.list(sessionId).some((request) => request.questionId === questionId)) return false
      return store.resolve(sessionId, questionId, answers)
    },

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
      if (!isWhitelistedAttachmentPath(candidate)) {
        // 安全敏感事件留痕（探测/越权读取在日志可追溯）
        log.warn(`mobile bridge attachment rejected (outside whitelist): ${candidate}`)
        return null
      }
      try {
        // realpath 复核：candidate 或其父级是 symlink 指向白名单外时拒绝（防逃逸），
        // 同步前缀校验防 ../ 逃逸，这里补上软链这一层
        const realPath = await fs.realpath(candidate)
        if (!isWhitelistedAttachmentPath(realPath)) {
          log.warn(`mobile bridge attachment rejected (symlink escape): ${candidate}`)
          return null
        }
        // 体积上限：工作区内构建产物/日志可能巨大，整体读入 + base64 + JSON 序列化
        // 会在主进程产生约 3 份峰值副本（本项目有长任务 OOM 前科），超限拒绝
        const stats = await fs.stat(realPath)
        if (stats.size > MAX_ATTACHMENT_READ_BYTES) {
          log.warn(`mobile bridge attachment rejected (too large ${stats.size}B): ${candidate}`)
          return null
        }
        const data = await fs.readFile(realPath)
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
      // 能力面收窄到 session 作用域（与协议声明一致，global/project 任务不经移动桥接改）
      const existing = deps.getScheduledTaskService().getTask(taskId)
      if (existing == null || existing.scope !== 'session') return null
      const updates: Record<string, unknown> = {}
      if (request.name !== undefined) updates.name = request.name
      if (request.prompt !== undefined) updates.prompt_template = request.prompt
      if (request.triggerType !== undefined) updates.trigger_type = request.triggerType
      if (request.intervalSeconds !== undefined) updates.interval_seconds = request.intervalSeconds
      if (request.cronExpression !== undefined) updates.cron_expression = request.cronExpression
      if (request.runAt !== undefined) updates.run_at = request.runAt
      if (request.enabled !== undefined) updates.enabled = request.enabled
      if (request.timeoutSeconds !== undefined) updates.timeout_seconds = request.timeoutSeconds
      if (request.maxRetries !== undefined) updates.max_retries = request.maxRetries
      const service = deps.getScheduledTaskService()
      if (Object.keys(updates).length === 0) {
        const existing = service.getTask(taskId)
        return existing != null ? mapScheduledTask(existing) : null
      }
      const updated = service.updateTask(taskId, updates)
      return updated != null ? mapScheduledTask(updated) : null
    },

    deleteSessionTask: async (taskId) => {
      const service = deps.getScheduledTaskService()
      const task = service.getTask(taskId)
      if (task == null || task.scope !== 'session') return false
      return service.deleteTask(taskId)
    },

    toggleSessionTask: async (taskId, enabled) => {
      const service = deps.getScheduledTaskService()
      const existing = service.getTask(taskId)
      if (existing == null || existing.scope !== 'session') return null
      const task = enabled ? service.enableTask(taskId) : service.disableTask(taskId)
      return task != null ? mapScheduledTask(task) : null
    },

    runSessionTaskNow: async (taskId) => {
      const service = deps.getScheduledTaskService()
      // 不存在任务先 404（runNow 内部抛普通 Error 会兜成 500），并约束 session 作用域
      const task = service.getTask(taskId)
      if (task == null || task.scope !== 'session') {
        throw new SparkError('NOT_FOUND', '任务不存在')
      }
      await service.runNow(taskId)
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

    // ─── 会话分支（Session Fork；与桌面端「从此处分支」同源） ──────────────────

    forkSession: async (sessionId, request) => {
      let result
      try {
        result = await deps.getSessionService().forkSession({
          sourceSessionId: sessionId,
          ...(request.anchorTurnId != null && request.anchorTurnId.trim()
            ? { anchorTurnId: request.anchorTurnId.trim() }
            : {}),
          ...(request.title != null && request.title.trim() ? { title: request.title.trim() } : {}),
        })
      } catch (error) {
        // 服务层抛普通 Error：已知用户错误转 SparkError 供路由层映射 404/400，
        // 未识别错误原样 rethrow（保持 500 兜底，不把内部故障伪装成用户错误）
        const message = error instanceof Error ? error.message : String(error)
        if (message.includes('不存在或已删除')) throw new SparkError('NOT_FOUND', message)
        if (message.includes('只能从已完成')) throw new SparkError('VALIDATION_FAILED', message)
        throw error
      }
      return {
        session: toBridgeSessionSummary(result.session),
        lineage: result.lineage,
        copiedTurnCount: result.copiedTurnCount,
        sourceWasRunning: result.sourceWasRunning,
        ...(result.bindingWarning != null ? { bindingWarning: result.bindingWarning } : {}),
      }
    },

    getSessionLineage: (sessionId) => deps.getSessionService().getSessionLineage(sessionId),

    // ─── 技能列表（移动端只读选择器；不做 ensureBuiltInSkills 等重扫动作） ──────

    listSkills: async (sessionId) => {
      const skills: MobileBridgeSkillItem[] = []
      try {
        for (const skill of deps.getSkillService().listSkills()) {
          let description = ''
          try {
            const manifest = JSON.parse(skill.manifestJson) as {
              description?: string
              desc?: string
            }
            description = (manifest.desc ?? manifest.description ?? '').trim()
          } catch {
            /* manifest 损坏按空描述展示，不阻塞列表 */
          }
          skills.push({
            id: skill.id,
            name: skill.name,
            description,
            enabled: skill.enabled,
            source: 'db',
          })
        }
      } catch (error) {
        log.warn(
          `mobile bridge skill list failed: ${error instanceof Error ? error.message : String(error)}`,
        )
      }
      if (sessionId) {
        // 会话工作区项目技能（扫描失败不拖垮平台技能列表）；同名以平台技能优先去重
        try {
          for (const project of deps.getSessionService().listProjectSkills(sessionId)) {
            // 去重按 trim+lowercase，与项目技能内部去重口径一致（避免 Search/search 重复出现）
            if (
              skills.some(
                (skill) => skill.name.trim().toLowerCase() === project.name.trim().toLowerCase(),
              )
            )
              continue
            skills.push({
              id: project.id,
              name: project.name,
              description: project.description,
              enabled: true,
              source: 'project',
            })
          }
        } catch (error) {
          log.warn(
            `mobile bridge project skills scan failed: ${error instanceof Error ? error.message : String(error)}`,
          )
        }
      }
      return { skills }
    },
  }
}

export function registerMobileBridgeIpc(deps: MobileBridgeIpcDeps): void {
  // ── 云端中继（唯一的移动桥接传输层；业务路由层随调用按需工作） ────────────────
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
    // 重置设备身份：生成全新设备身份（旧 deviceId 已被服务端永久拉黑，复用无意义），
    // 展示名同步刷新为主机名（主机名改动后重置设备身份即可更新上报的 label）
    const store = readRelayStore(settings)
    writeRelayStore(settings, {
      ...store,
      deviceId: randomUUID(),
      deviceSecret: randomBytes(32).toString('hex'),
      label: hostname(),
    })
    log.info('relay identity reset (re-trust requested)')
    await relay.resetIdentity()
    return relay.getStatus()
  })

  // 中继启动时序：本模块（IPC 注册）先于 Cloud Auth 初始化执行（index.ts 启动序列），
  // 而 relay.start() 需经 AuthService 获取访问令牌——直接启动会抛
  // "AuthService not initialized" 且失败后没有重试路径，中继会静默失效到用户手动重开。
  // 因此轮询等待 auth 就绪（上限 30s，正常启动约 1s 内完成）后再启动；
  // 超时仍未就绪（认证初始化失败/未登录环境）则保持关闭并在日志说明。
  const AUTH_READY_POLL_MS = 500
  const AUTH_READY_TIMEOUT_MS = 30_000
  void (async () => {
    const deadline = Date.now() + AUTH_READY_TIMEOUT_MS
    for (;;) {
      try {
        getAuthService()
        break
      } catch {
        if (Date.now() >= deadline) {
          log.warn('mobile bridge relay not started: auth service unavailable within 30s')
          return
        }
        await new Promise((resolve) => setTimeout(resolve, AUTH_READY_POLL_MS))
      }
    }
    try {
      await relay.start()
    } catch (error) {
      log.warn(
        `mobile bridge relay start failed: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  })()
  log.info('mobile bridge ipc registered')
}

/** 测试辅助：重置单例 */
export function __resetMobileBridgeServiceForTesting(): void {
  service = null
  relayClient = null
  sidebarOrderController = null
  workspaceRootsProvider = () => []
}

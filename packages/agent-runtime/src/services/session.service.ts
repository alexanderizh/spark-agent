import crypto from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { stat } from 'node:fs/promises'
import {
  EventRepository,
  ProviderProfileRepository,
  RulesRepository,
  SessionRepository,
  WorkspaceRepository,
  McpServerRepository,
  SettingsRepository,
  SkillRepository,
  ContextPreferenceRepository,
  AgentRepository,
  WorkflowRepository,
  TeamDispatchRepository,
  TeamDefinitionRepository,
  MediaModelManifestRepository,
  UsageLedgerRepository,
  GoalRepository,
} from '@spark/storage'
import type { AgentItem, WorkflowItem, SessionGoal as StoredSessionGoal, GoalProgressEntry, GoalStatus } from '@spark/storage'
import type { SparkDatabase } from '@spark/storage'
import type {
  AgentEvent,
  SessionCancelQueuedTurnResponse,
  SessionSendQueuedTurnNowResponse,
  SessionCreateResponse,
  SessionGetQueueResponse,
  SessionGoalResponse,
  SessionId,
  SessionListResponse,
  SessionQueuedTurn,
  SessionSearchResponse,
  UserMessageEvent,
  AssistantMessageEvent,
  AgentStatusEvent,
  SessionHistoryResetEvent,
  HookNode,
  SessionAttachment,
  UserQuestionPrompt,
  TeamModeConfig,
  TeamA2ATask,
  HistoryImportSource,
} from '@spark/protocol'
import type { SessionPermissionMode } from '@spark/protocol'
import {
  LOCAL_CLI_DEFAULT_MODEL,
  LOCAL_CODEX_CLI_DEFAULT_MODEL,
  isMediaProviderKind,
  isBuiltInLocalCliProvider,
  isLocalCodexCliProvider,
  type MediaProviderKind,
} from '@spark/protocol'
import { TeamDispatchService } from './team-dispatch.service.js'
import type { TeamMemberExecutionResult } from './team-dispatch.service.js'
import { loadSdkMcpFactory } from '../sdk/index.js'
import { z } from 'zod'
import { isCommand, parseCommand, createBuiltinRegistry } from '../core/index.js'
import { TodoStore } from '../core/todo-store.js'
import type {
  CheckpointRestoreResult,
  CheckpointSnapshot,
  CommandDeps,
  CommandListItem,
  CustomCommandConfig,
} from '../core/index.js'
import * as keystore from '@spark/shared/keystore'
import { McpService } from './mcp-server.service.js'
import type { McpChangeEvent } from './mcp-server.service.js'
import { PlatformBridgeService } from './platform-bridge.service.js'
import { getDebugLogServer } from './debug-log-server.service.js'
import { RuntimeCompositionService } from './runtime-composition.service.js'
import { ProjectContextService } from './project-context.service.js'
import { ValidationSuggestionService } from './validation-suggestion.service.js'
import { WorkspaceSnapshotService, type FileSnapshot } from './workspace-snapshot.service.js'
import { SkillLoader } from '../skills/skill-loader.js'
import { ClaudeSDKExecutor, CodexCliExecutor, CodexOpenAIExecutor, CodexSdkExecutor, isSDKAvailable } from '../sdk/index.js'
import type { SDKExecutorConfig, SDKMcpServerConfig, SDKTurnAttachment } from '../sdk/index.js'
import { getResumeCircuitBreaker } from '../sdk/index.js'
import { buildConversationHistoryWithSummary } from './conversation-summarizer.js'
import { generateSessionTitle } from './session-title-generator.js'
import { MemoryRepository } from '@spark/storage'
import { MemoryWriterService } from './memory/memory-writer.service.js'
import { MemoryReaderService } from './memory/memory-reader.service.js'
import { MemoryStoreService } from './memory/memory-store.service.js'
import { MediaModelCatalogService } from './media/media-model-catalog.service.js'
import {
  synthesizeMediaManifestForRef,
  type MediaProfileLike,
} from './media/media-model-resolver.js'
import type { ProviderMediaModelRef } from '@spark/protocol'
import {
  createLogger,
  resolveProviderContextWindow,
  resolveSoftContextLimitForWindow,
} from '@spark/shared'

const log = createLogger('session.service')

export type SessionEventHandler = (event: AgentEvent) => void
export type SessionQueueChangedHandler = (snapshot: SessionGetQueueResponse) => void
export type SessionRenamedHandler = (sessionId: string, title: string) => void
/**
 * 平台配置变更处理器：当 agent/team/provider/mcp/skill/workflow 等资源
 * 通过 Platform Bridge（即 MCP 工具，如 agents_create）被增删改时触发，
 * 用于向渲染进程广播 stream:config:changed 事件，让所有 UI 订阅方刷新缓存。
 */
export type PlatformConfigChangedHandler = (
  scope: 'provider' | 'agent' | 'team' | 'skill' | 'mcp' | 'workflow' | 'rule' | 'prompt',
  action: 'create' | 'update' | 'delete' | 'import',
  id?: string,
) => void
export type ApprovalHandler = (
  sessionId: string,
  toolName: string,
  toolInput: Record<string, unknown>,
) => Promise<boolean>
/** session 被取消时调用：用于拒绝该 session 下所有挂起的 approval 请求，避免 agent 永久挂起 */
export type ApprovalCancelHandler = (sessionId: string) => void
/** Hook 触发处理器：在关键节点触发提示音/通知等 */
export type HookTriggerHandler = (
  sessionId: string,
  node: HookNode,
  context?: { title?: string; body?: string },
) => void
/** Handler for AskUserQuestion tool - returns user's answers */
export type QuestionHandler = (
  sessionId: string,
  questions: UserQuestionPrompt[],
) => Promise<Record<string, unknown>>
type AgentAdapterKind = 'claude' | 'claude-sdk' | 'codex'
type ActiveExecution = {
  cancel(): void
  /** Hot-swap the permission mode for the currently executing turn. */
  setPermissionMode?(mode: SessionPermissionMode): void
}

export function createCodexExecutorForConfig(
  config: Pick<SDKExecutorConfig, 'useLocalConfig' | 'codexApiKind' | 'codexCliProvider'>,
): CodexCliExecutor | CodexOpenAIExecutor | CodexSdkExecutor {
  if (config.useLocalConfig === true) return new CodexCliExecutor()
  if (config.codexCliProvider != null) return new CodexCliExecutor()
  if (config.codexApiKind === 'chat') return new CodexOpenAIExecutor()
  return new CodexSdkExecutor()
}

type ImageGenerationRuntimeContext = {
  mcpServer: SDKMcpServerConfig
  systemPrompt: string
}
type MediaGenerationRuntimeContext = {
  mcpServer: SDKMcpServerConfig
  systemPrompt: string
}
interface FirstTurnTitleContext {
  providerType: string
  apiKey: string
  apiEndpoint?: string
  model: string
  userMessage: string
}
interface TryStartSDKTurnOptions {
  allowedMcpServerIds?: Set<string>
  firstTurnTitleContext?: FirstTurnTitleContext
  /**
   * 团队模式 @ 路由：当前 turn 实际由该 Member 直接响应。
   * 设置后：
   *  - 流式 assistant_message 会重写为 team_member_message（驱动 TeamMemberBubble）
   *  - emit user_message 时附带 mentionAgentId 字段
   */
  mentionAgentId?: string
  /** Memory System：当前 workspace id（用于 project scope 记忆写入） */
  primaryWorkspaceId?: string
  /** Memory System：当前 agent id（用于 agent scope 记忆写入） */
  agentId?: string
  /** Memory System：当前 workspace 根路径（project scope 记忆文件存放） */
  workspaceRootPath?: string
}
type SessionRuntimePatch = {
  providerProfileId?: string
  modelId?: string | null
  agentId?: string
  agentAdapter?: AgentAdapterKind
  permissionMode?: SessionPermissionMode
  chatMode?: 'agent' | 'ask' | 'edit' | 'review'
  reasoningEffort?: 'medium' | 'high' | 'xhigh' | 'max'
}
type PendingTurn = {
  turnId: string
  message: string
  enqueuedAt: string
  attachments?: SessionAttachment[]
  runtimePatch?: SessionRuntimePatch
  skillId?: string
  skillParams?: Record<string, unknown>
  /** 团队模式：用户通过 @ 指定的直接处理 Agent ID（mention routing） */
  mentionAgentId?: string
}

const DEFAULT_SESSION_TITLES = new Set(['New Session', '新会话', 'Workspace Session', '未命名会话'])
const SESSION_TITLE_MAX_LENGTH = 40
const RECOVERY_SESSION_LIMIT = 10_000
const HISTORY_CONTEXT_EVENT_LIMIT = 240
const HISTORY_CONTEXT_ENTRY_LIMIT = 40
const HISTORY_CONTEXT_MAX_CHARS = 24_000
const HISTORY_CONTEXT_ENTRY_MAX_CHARS = 4_000
const TERMINAL_AGENT_STATUSES = new Set<string>(['idle', 'completed', 'cancelled', 'error'])
// Keep SDK resume opt-in until the Claude Code child process can recover cleanly from resume failures.
const ENABLE_CLAUDE_SDK_RESUME = false

type SessionUsageTotals = { totalInputTokens: number; totalOutputTokens: number; totalCost: number }




function parseGoalStatusBlock(content: string): { status: 'continue' | 'completed' | 'blocked' | 'failed'; phase: 'review' | 'act' | 'validate'; summary: string; evidence?: string[]; nextStep?: string } | null {
  const match = /```spark-goal-status\s*([\s\S]*?)```/i.exec(content)
  if (match == null) return null
  const fields = new Map<string, string>()
  for (const line of match[1]!.split(/\r?\n/)) {
    const idx = line.indexOf(':')
    if (idx <= 0) continue
    fields.set(line.slice(0, idx).trim().toLowerCase(), line.slice(idx + 1).trim())
  }
  const status = fields.get('status')
  const phase = fields.get('phase')
  if (status !== 'continue' && status !== 'completed' && status !== 'blocked' && status !== 'failed') return null
  const normalizedPhase = phase === 'review' || phase === 'act' || phase === 'validate' ? phase : 'validate'
  const evidenceText = fields.get('evidence') ?? ''
  const evidence = evidenceText ? evidenceText.split(',').map((item) => item.trim()).filter(Boolean) : undefined
  const nextStep = fields.get('next_step') || fields.get('nextstep') || undefined
  return {
    status,
    phase: normalizedPhase,
    summary: fields.get('summary') || `Goal ${status}`,
    ...(evidence != null && evidence.length > 0 ? { evidence } : {}),
    ...(nextStep ? { nextStep } : {}),
  }
}

function toProtocolGoal(goal: StoredSessionGoal | null): SessionGoalResponse['goal'] {
  if (goal == null) return null
  return { ...goal, sessionId: goal.sessionId as SessionId } as SessionGoalResponse['goal']
}

function buildGoalIterationPrompt(goal: StoredSessionGoal): string {
  const progress = goal.progressLog.slice(-8).map((entry) => `- #${entry.iteration} [${entry.phase}/${entry.status}] ${entry.summary}${entry.nextStep ? ` Next: ${entry.nextStep}` : ''}`).join('\n') || '- No prior progress.'
  const criteria = goal.successCriteria.length > 0 ? goal.successCriteria.map((item) => `- ${item}`).join('\n') : '- Derive concrete, verifiable completion criteria from the objective and state them before acting.'
  const constraints = goal.constraints.length > 0 ? goal.constraints.map((item) => `- ${item}`).join('\n') : '- Preserve existing behavior unless the goal explicitly requires a change.'
  const commands = goal.validation.commands?.length ? goal.validation.commands.map((item) => `- ${item}`).join('\n') : '- Choose the narrowest safe validation command(s) available; if none can run, explain why.'
  return [
    'You are executing a managed persistent Goal. Work in a bounded Review → Act → Validate loop for this iteration only.',
    '',
    `Objective:\n${goal.objective}`,
    '',
    `Definition of done / success criteria:\n${criteria}`,
    '',
    `Constraints / non-goals:\n${constraints}`,
    '',
    `Validation plan:\n${commands}`,
    '',
    `Recent progress:\n${progress}`,
    '',
    'This iteration requirements:',
    '1. Review current state and identify the smallest useful next step.',
    '2. Act only on that step.',
    '3. Validate with the listed commands/checklist when possible.',
    '4. Stop if the definition of done is satisfied.',
    '',
    'Finish your answer with this exact machine-readable block:',
    '```spark-goal-status',
    'status: continue|completed|blocked|failed',
    'phase: review|act|validate',
    'summary: <one sentence>',
    'evidence: <comma separated evidence>',
    'next_step: <next step or empty>',
    '```',
  ].join('\n')
}

function getSessionUsageFromPersistence(db: SparkDatabase, eventRepo: EventRepository, sessionId: string): SessionUsageTotals | null {
  try {
    const ledgerUsage = new UsageLedgerRepository(db).getSessionUsage(sessionId)
    if (ledgerUsage.recordCount > 0) {
      return {
        totalInputTokens: ledgerUsage.totalInputTokens,
        totalOutputTokens: ledgerUsage.totalOutputTokens,
        totalCost: ledgerUsage.totalCostUsd,
      }
    }
  } catch {
    // Usage ledger may be unavailable in older test doubles or partially migrated databases.
  }

  let totalInputTokens = 0
  let totalOutputTokens = 0
  let totalCost = 0
  let usageEventCount = 0

  for (const row of eventRepo.queryBySession({ sessionId, eventType: 'usage_update', limit: 10_000 }).events) {
    try {
      const event = JSON.parse(row.event_json) as Partial<AgentEvent> & {
        inputTokens?: unknown
        outputTokens?: unknown
        estimatedCostUsd?: unknown
      }
      const inputTokens = typeof event.inputTokens === 'number' ? event.inputTokens : 0
      const outputTokens = typeof event.outputTokens === 'number' ? event.outputTokens : 0
      const estimatedCostUsd = typeof event.estimatedCostUsd === 'number' ? event.estimatedCostUsd : 0
      totalInputTokens += inputTokens
      totalOutputTokens += outputTokens
      totalCost += estimatedCostUsd
      usageEventCount += 1
    } catch {
      // Ignore malformed historical events.
    }
  }

  if (usageEventCount === 0) return null
  return { totalInputTokens, totalOutputTokens, totalCost }
}

/**
 * Canvas Agent 桥：由主进程注入。SessionService 在 sendTurn 时调用
 * `canvasMcpProvider(sessionId)` 拿到 in-process MCP server 配置；若 session
 * 没有 attach 到画布弹窗则返回 null，工具集不挂载。
 */
export type CanvasMcpProvider = (sessionId: string) => Promise<{
  server: import('../sdk/types.js').SDKMcpServerConfig
  allowedTools: string[]
} | null>

export class SessionService {
  private activeLoops = new Map<string, ActiveExecution>() // sessionId → active execution
  private pendingTurns = new Map<string, PendingTurn[]>()
  /** 画布 Agent MCP server 提供器（由主进程注入） */
  private canvasMcpProvider: CanvasMcpProvider | null = null
  /**
   * SDK 原生托管技能插件目录（由主进程 AppSkillsManager 注入）。
   * 设置后，Claude SDK 会以本地插件方式加载其中所有已启用技能，启用原生渐进式披露。
   */
  private skillsPluginDir: string | null = null
  /**
   * 用户技能落盘目录（由主进程 AppSkillsManager.userDir 注入）。
   * 提供后，bridge（SkillRegistryService）安装的市场/GitHub 技能才会落盘真实磁盘，
   * 使其能被 agent 运行时加载、被 Claude 原生渐进式披露发现；未提供时回落虚拟 registry:// 路径。
   */
  private userSkillsDir: string | null = null
  /** 等待用户对计划进行审批的 session 集合：处于此状态时 startNextQueuedTurn 不自动起跑队列。 */
  private pendingPlanApprovals = new Set<string>()
  private seqCounters = new Map<string, number>()
  private usageLedgerLastByTurn = new Map<string, { inputTokens: number; outputTokens: number; cacheHitTokens: number; estimatedCostUsd: number }>()
  private iterationOverrides = new Map<string, number>() // sessionId → per-session max turn iterations override
  private readonly commandRegistry = createBuiltinRegistry()
  private readonly mcpService: McpService
  private teamDispatchService: TeamDispatchService | null = null
  private readonly platformBridge: PlatformBridgeService

  /**
   * Increments whenever any MCP server is created/updated/deleted/started/stopped/
   * changes its tool list. Compared against `lastBuiltMcpVersion` at SDK turn build
   * time so that a change forces the next turn to start a fresh SDK query (i.e.
   * `continueSession: false`), bypassing the SDK's frozen tool list snapshot.
   */
  private mcpVersion = 0
  private lastBuiltMcpVersion = -1

  private getTeamDispatchService(): TeamDispatchService {
    if (this.teamDispatchService == null) {
      this.teamDispatchService = new TeamDispatchService(new TeamDispatchRepository(this.db))
    }
    return this.teamDispatchService
  }

  constructor(
    private readonly db: SparkDatabase,
    private readonly onEvent: SessionEventHandler,
    private readonly onApproval?: ApprovalHandler,
    private readonly onApprovalCancel?: ApprovalCancelHandler,
    private readonly onQueueChanged?: SessionQueueChangedHandler,
    private readonly onQuestion?: QuestionHandler,
    private readonly onHookTrigger?: HookTriggerHandler,
    private readonly onSessionRenamed?: SessionRenamedHandler,
    private readonly onPlatformConfigChanged?: PlatformConfigChangedHandler,
  ) {
    this.mcpService = new McpService(new McpServerRepository(db))
    this.platformBridge = new PlatformBridgeService()
    this.mcpService.onChange((_event: McpChangeEvent) => {
      this.mcpVersion += 1
    })
    this.recoverInterruptedSessions()
  }

  /** 注入画布 Agent MCP provider（主进程持有画布桥后调用一次） */
  setCanvasMcpProvider(provider: CanvasMcpProvider | null): void {
    this.canvasMcpProvider = provider
  }

  /** 注入 SDK 原生托管技能插件目录（主进程启动技能系统后调用） */
  setSkillsPluginDir(dir: string | null): void {
    this.skillsPluginDir = dir
  }

  /** 注入用户技能落盘目录（主进程启动技能系统后调用，供 bridge 的 SkillRegistryService 使用） */
  setUserSkillsDir(dir: string | null): void {
    this.userSkillsDir = dir
  }

  /**
   * 解析当前可用的原生技能插件目录列表。
   * 仅当目录存在且含合法 plugin.json 时返回，否则返回 null（回落到 skills_load 工具路径）。
   */
  private resolveNativeSkillPlugins(): string[] | null {
    const dir = this.skillsPluginDir
    if (dir == null) return null
    if (!existsSync(path.join(dir, '.claude-plugin', 'plugin.json'))) return null
    return [dir]
  }

  recoverInterruptedSessions(): { recovered: number } {
    const sessionRepo = new SessionRepository(this.db)
    const eventRepo = new EventRepository(this.db)

    // 回收上次进程残留的、卡在 pending/working 的 team dispatch（设计文档 §15）。
    // 单进程应用启动时不会有真正进行中的 dispatch，因此 now 之前的全部回收。
    try {
      const reclaimed = new TeamDispatchRepository(this.db).markStaleAsFailed(new Date().toISOString())
      if (reclaimed > 0) log.info(`Reclaimed ${reclaimed} stale team dispatch(es) after app restart`)
    } catch {
      // 团队功能未启用/表不存在时忽略
    }

    const { sessions } = sessionRepo.list({
      status: 'running',
      includeArchived: true,
      limit: RECOVERY_SESSION_LIMIT,
    })

    let recovered = 0
    for (const session of sessions) {
      if (this.activeLoops.has(session.id)) continue

      const latestStatus = getLatestAgentStatusFromEvents(eventRepo, session.id)
      if (latestStatus == null || !TERMINAL_AGENT_STATUSES.has(latestStatus)) {
        appendInterruptedTurnEvents(eventRepo, session.id)
      }

      sessionRepo.updateStatus(session.id, 'idle')
      this.pendingTurns.delete(session.id)
      this.onApprovalCancel?.(session.id)
      this.emitQueueChanged(session.id)
      recovered += 1
    }

    if (recovered > 0) {
      log.info(`Recovered ${recovered} interrupted running session(s) after app restart`)
    }
    return { recovered }
  }

  async createSession(params: {
    providerProfileId: string
    modelId?: string
    agentId?: string
    agentAdapter?: AgentAdapterKind
    permissionMode?: SessionPermissionMode
    chatMode?: 'agent' | 'ask' | 'edit' | 'review'
    reasoningEffort?: 'medium' | 'high' | 'xhigh' | 'max'
    title?: string
    workspaceId?: string
  }): Promise<SessionCreateResponse> {
    const sessionRepo = new SessionRepository(this.db)
    const id = crypto.randomUUID()
    const agent = this.resolveAgent(params.agentId)
    const row = sessionRepo.create({
      id,
      kind: 'agent',
      title: params.title?.trim() || '新会话',
      status: 'idle',
      projectId: params.workspaceId ?? 'default',
      workspaceIds: params.workspaceId != null ? [params.workspaceId] : [],
      providerProfileId: params.providerProfileId ?? agent.providerProfileId ?? '',
      ...(params.modelId !== undefined
        ? { modelId: params.modelId }
        : agent.modelId != null
          ? { modelId: agent.modelId }
          : {}),
      agentId: agent.id,
      agentAdapter: params.agentAdapter ?? normalizeAgentAdapter(agent.agentAdapter),
      permissionMode: params.permissionMode ?? normalizePermissionMode(agent.permissionMode),
      ...(params.chatMode !== undefined ? { chatMode: params.chatMode } : {}),
      reasoningEffort: params.reasoningEffort ?? normalizeReasoningEffort(agent.reasoningEffort),
    })
    return { sessionId: row.id as SessionId, createdAt: row.created_at }
  }

  async executeCommand(params: {
    sessionId: string
    message: string
  }): Promise<
    | {
        isCommand: true
        result: { success: boolean; message: string; data?: Record<string, unknown> }
      }
    | { isCommand: false }
  > {
    if (!isCommand(params.message)) return { isCommand: false }

    const parsed = parseCommand(params.message)
    if (parsed == null) return { isCommand: false }

    const sessionRepo = new SessionRepository(this.db)
    const providerRepo = new ProviderProfileRepository(this.db)
    const eventRepo = new EventRepository(this.db)
    const session = sessionRepo.get(params.sessionId)

    // Get workspace path for git/shell commands
    let workspacePath: string | null = null
    try {
      const workspaceIds: string[] = session?.workspace_ids_json
        ? JSON.parse(session.workspace_ids_json)
        : []
      const workspaceId = workspaceIds[0]
      if (workspaceId) {
        const wsRepo = new WorkspaceRepository(this.db)
        const ws = wsRepo.get(workspaceId)
        workspacePath = ws?.root_path ?? null
      }
    } catch {
      // ignore parse errors
    }

    const deps: CommandDeps = {
      getSession: (id) => {
        const s = sessionRepo.get(id)
        if (s == null) return null
        return {
          title: s.title,
          status: s.status,
          modelId: s.model_id ?? null,
          providerProfileId: s.provider_profile_id ?? '',
          agentAdapter: getAgentAdapterFromSession(s.agent_adapter, s.chat_mode, providerRepo.get(s.provider_profile_id ?? '')?.provider_type ?? null),
          permissionMode: getPermissionModeFromSession(
            s.permission_mode,
            getAgentAdapterFromSession(s.agent_adapter, s.chat_mode, providerRepo.get(s.provider_profile_id ?? '')?.provider_type ?? null),
          ),
          agentId: s.agent_id ?? null,
        }
      },
      updateSession: async (id, fields) => {
        if (fields.title !== undefined) sessionRepo.updateTitle(id, fields.title)
        if (fields.modelId !== undefined) sessionRepo.updateRuntime(id, { modelId: fields.modelId })
      },
      clearSessionEvents: async (id) => {
        eventRepo.deleteBySession(id)
        this.seqCounters.delete(id)
        this.clearUsageLedgerTurnState(id)
      },
      getProviderName: (id) => {
        return providerRepo.get(id)?.name ?? null
      },
      getProviderModelIds: (id) => getProviderModelIds(providerRepo.get(id)?.config_json),
      setApprovalMode: (id, enabled) => {
        this.applyApprovalToggle(id, enabled)
      },
      getWorkspacePath: () => workspacePath,
      execShell: async (command, cwd) => {
        const { exec } = await import('node:child_process')
        const { promisify } = await import('node:util')
        const execAsync = promisify(exec)
        try {
          const { stdout, stderr } = await execAsync(command, {
            cwd: cwd ?? workspacePath ?? undefined,
            timeout: 30000,
            maxBuffer: 1024 * 1024,
          })
          return { stdout: stdout || '', stderr: stderr || '', exitCode: 0 }
        } catch (err: unknown) {
          const execErr = err as { stdout?: string; stderr?: string; code?: number }
          return {
            stdout: execErr.stdout || '',
            stderr: execErr.stderr || '',
            exitCode: execErr.code ?? 1,
          }
        }
      },
      getSessionEventCount: (id) => {
        return eventRepo.countBySession(id)
      },
      getSessionUsage: (id) => getSessionUsageFromPersistence(this.db, eventRepo, id),
      listSessionCheckpoints: (id) => listSessionCheckpointsFromEvents(eventRepo, id),
      restoreCheckpoint: async (id, checkpointRef) =>
        restoreSessionCheckpoint({
          eventRepo,
          sessionId: id,
          workspacePath,
          checkpointRef,
        }),
      listSkills: (query) => listSkillSummaries(new SkillRepository(this.db), workspacePath, query),
      getSessionRuntimeInfo: (id) => {
        const s = sessionRepo.get(id)
        if (s == null) return null
        const provider = providerRepo.get(s.provider_profile_id ?? '')
        const adapter = getAgentAdapterFromSession(s.agent_adapter, s.chat_mode, provider?.provider_type ?? null)
        return {
          providerProfileId: s.provider_profile_id ?? null,
          providerName: provider?.name ?? null,
          modelId: s.model_id ?? null,
          agentAdapter: adapter,
          permissionMode: getPermissionModeFromSession(s.permission_mode, adapter),
        }
      },
      checkSdkAvailability: async () => ({
        claudeSdk: await isSDKAvailable(),
        codexCli: await checkCommandAvailable('codex --version', workspacePath),
        openaiSdk: await checkOpenAISdkAvailable(),
      }),
      checkWorkspaceShell: async (cwd) => checkWorkspaceShellAvailable(cwd ?? workspacePath),
      getMcpStatusSummary: () => this.mcpService.listServers().map((server) => ({
        id: server.id,
        name: server.name,
        enabled: server.enabled,
        ...this.mcpService.getServerStatus(server.id),
      })),
      getCurrentAgentSummary: (id) => {
        const s = sessionRepo.get(id)
        const agentId = s?.agent_id ?? 'platform-manager-agent'
        const agent = new AgentRepository(this.db).get(agentId)
        if (agent == null) return { id: agentId, name: agentId, exists: false, enabled: false, hasModelConfig: false }
        return {
          id: agent.id,
          name: agent.name,
          exists: true,
          enabled: agent.enabled,
          hasModelConfig: Boolean(agent.providerProfileId || agent.modelId),
          providerProfileId: agent.providerProfileId ?? null,
          modelId: agent.modelId ?? null,
        }
      },
      setGoal: async (id, objective, options) => (await this.setGoal({
        sessionId: id,
        objective,
        ...(options?.successCriteria != null ? { successCriteria: options.successCriteria } : {}),
        ...(options?.validationCommands != null ? { validation: { commands: options.validationCommands } } : {}),
      })).goal as unknown as Record<string, unknown>,
      getGoal: (id) => this.getGoal(id).goal as unknown as Record<string, unknown> | null,
      controlGoal: async (id, action, summary) => (await this.controlGoal({ sessionId: id, action, ...(summary != null ? { summary } : {}) })).goal as unknown as Record<string, unknown> | null,
    }

    const ctx = {
      sessionId: params.sessionId,
      ...(workspacePath != null ? { workspaceId: workspacePath } : {}),
      ...(session?.provider_profile_id != null ? { providerId: session.provider_profile_id } : {}),
      ...(session?.model_id != null ? { model: session.model_id } : {}),
    }

    this.registerConfiguredCommands()
    const result = await this.commandRegistry.execute(parsed, ctx, deps)
    if (result.forwardToAgent) return { isCommand: false }
    return { isCommand: true, result }
  }

  async executeCommandAsEvents(params: {
    sessionId: string
    message: string
  }): Promise<{ isCommand: boolean; forwardToAgent?: boolean; started?: boolean }> {
    if (!isCommand(params.message)) return { isCommand: false }
    const parsed = parseCommand(params.message)
    if (parsed == null) return { isCommand: false }

    const sessionRepo = new SessionRepository(this.db)
    const providerRepo = new ProviderProfileRepository(this.db)
    const eventRepo = new EventRepository(this.db)
    const session = sessionRepo.get(params.sessionId)

    let workspacePath: string | null = null
    try {
      const workspaceIds: string[] = session?.workspace_ids_json
        ? JSON.parse(session.workspace_ids_json)
        : []
      const workspaceId = workspaceIds[0]
      if (workspaceId) {
        const wsRepo = new WorkspaceRepository(this.db)
        const ws = wsRepo.get(workspaceId)
        workspacePath = ws?.root_path ?? null
      }
    } catch {
      /* ignore */
    }

    const deps: CommandDeps = {
      getSession: (id) => {
        const s = sessionRepo.get(id)
        if (s == null) return null
        return {
          title: s.title,
          status: s.status,
          modelId: s.model_id ?? null,
          providerProfileId: s.provider_profile_id ?? '',
          agentAdapter: getAgentAdapterFromSession(s.agent_adapter, s.chat_mode, providerRepo.get(s.provider_profile_id ?? '')?.provider_type ?? null),
          permissionMode: getPermissionModeFromSession(
            s.permission_mode,
            getAgentAdapterFromSession(s.agent_adapter, s.chat_mode, providerRepo.get(s.provider_profile_id ?? '')?.provider_type ?? null),
          ),
          agentId: s.agent_id ?? null,
        }
      },
      updateSession: async (id, fields) => {
        if (fields.title !== undefined) sessionRepo.updateTitle(id, fields.title)
        if (fields.modelId !== undefined) sessionRepo.updateRuntime(id, { modelId: fields.modelId })
      },
      clearSessionEvents: async (id) => {
        eventRepo.deleteBySession(id)
        this.seqCounters.delete(id)
        this.clearUsageLedgerTurnState(id)
      },
      getProviderName: (id) => providerRepo.get(id)?.name ?? null,
      getProviderModelIds: (id) => getProviderModelIds(providerRepo.get(id)?.config_json),
      setApprovalMode: (id, enabled) => {
        this.applyApprovalToggle(id, enabled)
      },
      getWorkspacePath: () => workspacePath,
      execShell: async (command, cwd) => {
        const { exec } = await import('node:child_process')
        const { promisify } = await import('node:util')
        const execAsync = promisify(exec)
        try {
          const { stdout, stderr } = await execAsync(command, {
            cwd: cwd ?? workspacePath ?? undefined,
            timeout: 30000,
            maxBuffer: 1024 * 1024,
          })
          return { stdout: stdout || '', stderr: stderr || '', exitCode: 0 }
        } catch (err: unknown) {
          const e = err as { stdout?: string; stderr?: string; code?: number }
          return { stdout: e.stdout || '', stderr: e.stderr || '', exitCode: e.code ?? 1 }
        }
      },
      getSessionEventCount: (id) => eventRepo.countBySession(id),
      getSessionUsage: (id) => getSessionUsageFromPersistence(this.db, eventRepo, id),
      listSessionCheckpoints: (id) => listSessionCheckpointsFromEvents(eventRepo, id),
      restoreCheckpoint: async (id, checkpointRef) =>
        restoreSessionCheckpoint({
          eventRepo,
          sessionId: id,
          workspacePath,
          checkpointRef,
        }),
      listSkills: (query) => listSkillSummaries(new SkillRepository(this.db), workspacePath, query),
      getSessionRuntimeInfo: (id) => {
        const s = sessionRepo.get(id)
        if (s == null) return null
        const provider = providerRepo.get(s.provider_profile_id ?? '')
        const adapter = getAgentAdapterFromSession(s.agent_adapter, s.chat_mode, provider?.provider_type ?? null)
        return {
          providerProfileId: s.provider_profile_id ?? null,
          providerName: provider?.name ?? null,
          modelId: s.model_id ?? null,
          agentAdapter: adapter,
          permissionMode: getPermissionModeFromSession(s.permission_mode, adapter),
        }
      },
      checkSdkAvailability: async () => ({
        claudeSdk: await isSDKAvailable(),
        codexCli: await checkCommandAvailable('codex --version', workspacePath),
        openaiSdk: await checkOpenAISdkAvailable(),
      }),
      checkWorkspaceShell: async (cwd) => checkWorkspaceShellAvailable(cwd ?? workspacePath),
      getMcpStatusSummary: () => this.mcpService.listServers().map((server) => ({
        id: server.id,
        name: server.name,
        enabled: server.enabled,
        ...this.mcpService.getServerStatus(server.id),
      })),
      getCurrentAgentSummary: (id) => {
        const s = sessionRepo.get(id)
        const agentId = s?.agent_id ?? 'platform-manager-agent'
        const agent = new AgentRepository(this.db).get(agentId)
        if (agent == null) return { id: agentId, name: agentId, exists: false, enabled: false, hasModelConfig: false }
        return {
          id: agent.id,
          name: agent.name,
          exists: true,
          enabled: agent.enabled,
          hasModelConfig: Boolean(agent.providerProfileId || agent.modelId),
          providerProfileId: agent.providerProfileId ?? null,
          modelId: agent.modelId ?? null,
        }
      },
      setGoal: async (id, objective, options) => (await this.setGoal({
        sessionId: id,
        objective,
        ...(options?.successCriteria != null ? { successCriteria: options.successCriteria } : {}),
        ...(options?.validationCommands != null ? { validation: { commands: options.validationCommands } } : {}),
      })).goal as unknown as Record<string, unknown>,
      getGoal: (id) => this.getGoal(id).goal as unknown as Record<string, unknown> | null,
      controlGoal: async (id, action, summary) => (await this.controlGoal({ sessionId: id, action, ...(summary != null ? { summary } : {}) })).goal as unknown as Record<string, unknown> | null,
    }

    const ctx = {
      sessionId: params.sessionId,
      ...(workspacePath != null ? { workspaceId: workspacePath } : {}),
      ...(session?.provider_profile_id != null ? { providerId: session.provider_profile_id } : {}),
      ...(session?.model_id != null ? { model: session.model_id } : {}),
    }

    this.registerConfiguredCommands()
    const result = await this.commandRegistry.execute(parsed, ctx, deps)

    if (result.forwardToAgent) return { isCommand: true, forwardToAgent: true }

    // Inject result as events into the chat stream. Internal commands that end here
    // emit a terminal agent_status so the UI can clear loading, but commands that
    // enqueue a follow-up Agent turn must not mark the overall user request complete.
    const followUpPrompt = result.followUpPrompt?.trim()
    const hasFollowUpPrompt = followUpPrompt != null && followUpPrompt.length > 0
    // 若命令 handler 已自行启动了一个 agent loop（典型：/goal 触发 goal iteration），
    // 这里就不能再注入 'completed' 终态——那会让 UI 把命令结果 bubble 标完，但 loop
    // 仍在跑，渲染器随之渲出一个空的「执行任务中」占位气泡（双气泡 bug）。
    const hasActiveLoopAfterHandler = this.activeLoops.has(params.sessionId)
    const shouldEmitCompleted = !hasFollowUpPrompt && !hasActiveLoopAfterHandler
    const wipeHistory = result.wipeHistory === true
    const turnId = crypto.randomUUID()
    const seq0 = this.seqCounters.get(params.sessionId) ?? 0
    // wipeHistory 的命令（典型 /clear）会先 emit 一条 SessionHistoryResetEvent，
    // 让 renderer 在新 user/assistant 事件到达前清空本地缓存。
    const baseEventCount = shouldEmitCompleted ? 3 : 2
    const totalEventCount = baseEventCount + (wipeHistory ? 1 : 0)
    this.seqCounters.set(params.sessionId, seq0 + totalEventCount)

    const commandEvents: AgentEvent[] = []
    let seqOffset = 0
    if (wipeHistory) {
      const resetEvent: SessionHistoryResetEvent = {
        id: crypto.randomUUID(),
        type: 'session_history_reset',
        sessionId: params.sessionId,
        turnId,
        timestamp: new Date().toISOString(),
        seq: seq0 + seqOffset,
        reason: `command:/${params.message.replace(/^\//, '').split(' ')[0]}`,
      }
      commandEvents.push(resetEvent)
      seqOffset += 1
    }

    const userEvent: UserMessageEvent = {
      id: crypto.randomUUID(),
      type: 'user_message',
      sessionId: params.sessionId,
      turnId,
      timestamp: new Date().toISOString(),
      seq: seq0 + seqOffset,
      content: params.message,
    }
    seqOffset += 1
    const cmdName = params.message.replace(/^\//, '').split(' ')[0]
    const icon = result.success ? '✅' : '❌'
    let content = `${icon} **/${cmdName}**\n\n${result.message}`
    if (result.data) content += '\n\n```json\n' + JSON.stringify(result.data, null, 2) + '\n```'

    const assistantEvent: AssistantMessageEvent = {
      id: crypto.randomUUID(),
      type: 'assistant_message',
      sessionId: params.sessionId,
      turnId,
      timestamp: new Date().toISOString(),
      seq: seq0 + seqOffset,
      mode: 'complete',
      content,
      provider: 'spark' as const,
      isFinal: true,
    }
    seqOffset += 1

    commandEvents.push(userEvent, assistantEvent)
    if (shouldEmitCompleted) {
      const completedEvent: AgentStatusEvent = {
        id: crypto.randomUUID(),
        type: 'agent_status',
        sessionId: params.sessionId,
        turnId,
        timestamp: new Date().toISOString(),
        seq: seq0 + seqOffset,
        status: 'completed',
        message: `/${cmdName} completed`,
      }
      commandEvents.push(completedEvent)
    }

    for (const event of commandEvents) {
      this.onEvent(event)
      try {
        eventRepo.insert({
          id: event.id,
          sessionId: params.sessionId,
          turnId,
          eventType: event.type,
          eventJson: JSON.stringify(event),
        })
      } catch {
        /* non-fatal */
      }
    }

    if (hasFollowUpPrompt) {
      const sendResult = await this.sendTurn({
        sessionId: params.sessionId,
        message: followUpPrompt,
        ...(result.followUpSkillId != null ? { skillId: result.followUpSkillId } : {}),
        ...(result.followUpSkillParams != null ? { skillParams: result.followUpSkillParams } : {}),
      })
      return { isCommand: true, forwardToAgent: false, started: sendResult.started }
    }

    return { isCommand: true, forwardToAgent: false, started: false }
  }

  listCommands(): CommandListItem[] {
    this.registerConfiguredCommands()
    return this.commandRegistry.listItems()
  }

  private registerConfiguredCommands(): void {
    const skills = listSkillSummaries(new SkillRepository(this.db))
    this.commandRegistry.registerSkillCommands(skills)
    this.commandRegistry.registerCustomCommands(this.listCustomCommands())
  }

  private listCustomCommands(): CustomCommandConfig[] {
    const raw = new SettingsRepository(this.db).get('custom-commands', 'items')
    if (typeof raw !== 'string' || raw.trim().length === 0) return []
    try {
      const parsed = JSON.parse(raw) as unknown
      if (!Array.isArray(parsed)) return []
      return parsed
        .map((item) => normalizeCustomCommandConfig(item))
        .filter((item): item is CustomCommandConfig => item != null)
    } catch {
      return []
    }
  }

  async sendTurn(params: {
    sessionId: string
    message: string
    providerProfileId?: string
    modelId?: string | null
    agentId?: string
    agentAdapter?: AgentAdapterKind
    permissionMode?: SessionPermissionMode
    chatMode?: 'agent' | 'ask' | 'edit' | 'review'
    reasoningEffort?: 'medium' | 'high' | 'xhigh' | 'max'
    /** 可选：要使用的 Skill ID */
    skillId?: string
    /** 可选：Skill 参数 */
    skillParams?: Record<string, unknown>
    attachments?: SessionAttachment[]
    /** 可选：团队模式配置（Team Mode 下随 turn 提交） */
    teamConfig?: TeamModeConfig
    /** 可选：团队模式 @ 路由——用户指定由该 Member 直接响应（替代 Host 主循环） */
    mentionAgentId?: string
    /**
     * 可选：若为 true，则当中途存在活跃 loop（典型场景：plan 批准时上一个 plan turn
     * 的 SDK 还没完全收尾）时，显式中断并立即起跑新 turn，而不是入队等待。
     * 与 sendQueuedTurnNow 的中断语义一致，避免 plan 批准后被卡在队尾不自动执行。
     */
    interruptActive?: boolean
  }): Promise<{ turnId: string; started: boolean }> {
    const { sessionId, message, skillId, skillParams, mentionAgentId } = params
    const attachments = normalizeTurnAttachments(params.attachments)
    const runtimePatch = getRuntimePatch(params)
    const turnId = crypto.randomUUID()
    // 团队配置随 turn 提交时，写入 session.metadata.team（startTurn 以此为单一真相源，
    // 无需穿过排队路径）。
    if (params.teamConfig != null) {
      new SessionRepository(this.db).patchMetadata(sessionId, { team: params.teamConfig })
    }
    // 用户提交新 turn = 已对计划做出响应（批准/继续提问/拒绝后再次发送）。
    // 解除 plan 审批闸门，让被阻塞的队列后续可以恢复自动起跑。
    this.pendingPlanApprovals.delete(sessionId)
    const currentGoal = new GoalRepository(this.db).getCurrent(sessionId)
    if (currentGoal?.status === 'active') {
      this.enqueueTurn(
        sessionId,
        this.makePendingTurn(turnId, message, runtimePatch, skillId, skillParams, attachments, mentionAgentId),
      )
      return { turnId, started: false }
    }

    if (this.activeLoops.has(sessionId)) {
      if (params.interruptActive === true) {
        // 显式中断当前 loop（与 sendQueuedTurnNow 同模式），让批准消息立即起跑，
        // 不再依赖上一个 plan turn 的 finally 兜底（时机不可控，会被用户感知为"卡住"）。
        const loop = this.activeLoops.get(sessionId)!
        this.onApprovalCancel?.(sessionId)
        this.teamDispatchService?.cancelAll()
        loop.cancel()
        this.activeLoops.delete(sessionId)
        new SessionRepository(this.db).updateStatus(sessionId, 'idle')
      } else {
        this.enqueueTurn(
          sessionId,
          this.makePendingTurn(turnId, message, runtimePatch, skillId, skillParams, attachments, mentionAgentId),
        )
        return { turnId, started: false }
      }
    }

    await this.startTurn(sessionId, turnId, message, runtimePatch, skillId, skillParams, attachments, mentionAgentId)
    return { turnId, started: true }
  }

  private async startTurn(
    sessionId: string,
    turnId: string,
    message: string,
    runtimePatch?: SessionRuntimePatch,
    skillId?: string,
    skillParams?: Record<string, unknown>,
    attachments?: SessionAttachment[],
    mentionAgentId?: string,
  ): Promise<void> {
    if (this.activeLoops.has(sessionId)) {
      this.enqueueTurn(
        sessionId,
        this.makePendingTurn(turnId, message, runtimePatch, skillId, skillParams, attachments, mentionAgentId),
      )
      return
    }

    const sessionRepo = new SessionRepository(this.db)
    const providerRepo = new ProviderProfileRepository(this.db)
    const eventRepo = new EventRepository(this.db)

    if (runtimePatch != null) {
      sessionRepo.updateRuntime(sessionId, runtimePatch)
    }

    const session = sessionRepo.findByIdOrFail(sessionId)
    // ── Mention 路由：解析"实际执行 turn 的 agent"。
    // mentionAgentId 必须命中当前会话团队成员（hostAgentId 等同未指定，回退主循环）。
    const sessionTeamConfig = readSessionTeamConfig(session)
    const isMentionTurn =
      mentionAgentId != null &&
      sessionTeamConfig?.enabled === true &&
      mentionAgentId !== sessionTeamConfig.hostAgentId &&
      sessionTeamConfig.memberAgentIds.includes(mentionAgentId)
    const agent = isMentionTurn
      ? this.resolveAgent(mentionAgentId)
      : this.resolveAgent(session.agent_id)
    const workflow = agent.workflowId != null ? new WorkflowRepository(this.db).get(agent.workflowId) : null
    // Provider / model：mention 时优先用被 @ Agent 自己的配置，未配置则回退会话默认。
    const effectiveProviderProfileId = isMentionTurn
      ? agent.providerProfileId ?? session.provider_profile_id
      : session.provider_profile_id
    if (effectiveProviderProfileId == null) {
      throw new Error(`Session ${sessionId} has no provider profile`)
    }

    const existingEventCount = eventRepo.countBySession(sessionId)
    const currentSeq = this.seqCounters.get(sessionId) ?? existingEventCount
    // Team Mode：构造 agentId→displayName 映射，让 conversation history 把 team_member_message
    // 也纳入历史（每条 member 发言前缀 [<name>]）。Mention 路径继承上下文的关键步骤。
    const agentNameById: Record<string, string> = {}
    if (sessionTeamConfig?.enabled === true) {
      const agentRepo = new AgentRepository(this.db)
      const hostAgent = agentRepo.get(sessionTeamConfig.hostAgentId)
      if (hostAgent != null) agentNameById[hostAgent.id] = hostAgent.name
      for (const memberId of sessionTeamConfig.memberAgentIds) {
        const m = agentRepo.get(memberId)
        if (m != null) agentNameById[m.id] = m.name
      }
    }
    const { prompt: conversationHistoryPrompt, summarization: summarizationStats } =
      buildConversationHistoryWithSummary(eventRepo, this.db, sessionId, currentSeq, {
        agentNameById,
      })
    const isFirstTurn = existingEventCount === 0 && shouldDeriveSessionTitle(session.title)
    if (isFirstTurn) {
      sessionRepo.updateTitle(sessionId, deriveSessionTitle(message))
    }
    const provider = providerRepo.get(effectiveProviderProfileId)
    if (provider == null) {
      throw new Error(`Provider profile not found: ${effectiveProviderProfileId}`)
    }
    const isLocalCli = isBuiltInLocalCliProvider(provider)
    if (!isLocalCli && provider.keystore_ref == null) {
      throw new Error(`Provider ${provider.id} has no keystore ref`)
    }

    const apiKey = isLocalCli
      ? ''
      : (await keystore.getSecret(provider.keystore_ref as keystore.KeystoreRef)) ?? ''
    if (!isLocalCli && apiKey.length === 0) {
      throw new Error(`API key not found for provider ${provider.id}`)
    }

    const config = JSON.parse(provider.config_json) as {
      defaultModel?: string
      model?: string
      modelIds?: string[]
      apiEndpoint?: string
      maxTokens?: number
      temperature?: number
      /** 'chat' (default, chat.completions) or 'responses' (OpenAI Responses API; Codex models) */
      codexApiKind?: 'chat' | 'responses'
      supportsMillionContext?: boolean
      contextWindow?: number
      haikuModel?: string
      sonnetModel?: string
      opusModel?: string
    }

    const model = isLocalCli
      ? getLocalCliDefaultModel(provider)
      : (isMentionTurn ? agent.modelId : null) ?? session.model_id ?? config.defaultModel ?? config.model
    if (model == null || model.length === 0) {
      throw new Error(`Provider ${provider.id} has no default model configured`)
    }

    const agentAdapter = getAgentAdapterFromSession(
      isMentionTurn ? agent.agentAdapter ?? session.agent_adapter : session.agent_adapter,
      session.chat_mode,
      provider.provider_type,
    )
    const adapterKind =
      agentAdapter === 'claude-sdk' || agentAdapter === 'claude' ? 'claude-sdk' : 'codex'
    // 非 mention turn 保持现有 hash（向后兼容续会话）；
    // mention turn 把被 @ 的 agent.id 加入 hash，避免与 Host SDK session 冲突且让重复 @ 同一 member 可续会话。
    const stableSdkSessionId = isMentionTurn
      ? makeSdkRuntimeSessionId(sessionId, effectiveProviderProfileId, model, agentAdapter, `mention:${agent.id}`)
      : makeSdkRuntimeSessionId(sessionId, effectiveProviderProfileId, model, agentAdapter)
    const sdkResumeSafe = isSdkResumeSafe({
      providerType: provider.provider_type,
      model,
      agentAdapter,
      ...(config.apiEndpoint != null ? { apiEndpoint: config.apiEndpoint } : {}),
    })
    const previousPromptSnapshot = getLatestTurnPromptSnapshot(eventRepo, sessionId)
    const canResumeSdkSession =
      sdkResumeSafe &&
      previousPromptSnapshot != null &&
      previousPromptSnapshot.adapterKind === adapterKind &&
      previousPromptSnapshot.model === model &&
      previousPromptSnapshot.providerProfileId === effectiveProviderProfileId &&
      previousPromptSnapshot.sdkSessionId === stableSdkSessionId
    const sdkSessionId = sdkResumeSafe
      ? stableSdkSessionId
      : makeSdkRuntimeSessionId(
          sessionId,
          effectiveProviderProfileId,
          model,
          agentAdapter,
          isMentionTurn ? `mention:${agent.id}:${turnId}` : turnId,
        )
    // 选中的模式即唯一权威：mention turn 用被 @ 成员自身的模式，否则用会话存储的模式。
    // 不再叠加 /approval override 层——bypass 一旦选中就不会被任何旁路降级。
    const permissionMode = isMentionTurn
      ? normalizePermissionMode(agent.permissionMode)
      : getPermissionModeFromSession(session.permission_mode, agentAdapter)

    log.debug('Resolved runtime for turn', {
      sparkSessionId: sessionId,
      turnId,
      providerProfileId: session.provider_profile_id,
      providerType: provider.provider_type,
      providerName: provider.name,
      model,
      apiEndpoint: config.apiEndpoint ?? null,
      agentAdapter,
      adapterKind,
      sdkSessionId,
      stableSdkSessionId,
      sdkResumeSafe,
      existingEventCount,
      canResumeSdkSession,
      previousSnapshot: previousPromptSnapshot,
      runtimePatch: runtimePatch ?? null,
      permissionMode,
    })

    // Workspace root path for tools
    let workspaceRootPath = process.cwd()
    let workspaceInfo: { name: string; rootPath: string; projectKind: string } | undefined
    const contextWindowTokens = resolveProviderContextWindow(
      config.supportsMillionContext === true,
      config.contextWindow,
    )
    const softContextLimitTokens = resolveSoftContextLimitForWindow(contextWindowTokens)
    const projectContextBudgetTokens = Math.max(
      2_000,
      Math.min(60_000, Math.floor(softContextLimitTokens * 0.25)),
    )
    const projectContextService = new ProjectContextService()
    let projectContext = projectContextService.discover(undefined, {
      mode: 'project-smart',
      budgetTokens: projectContextBudgetTokens,
    })
    const workspaceIds = sessionRepo.getWorkspaceIds(sessionId)
    const primaryWorkspaceId = workspaceIds[0]
    if (workspaceIds.length > 0) {
      const wsRepo = new WorkspaceRepository(this.db)
      const ws = wsRepo.get(primaryWorkspaceId ?? '')
      if (ws != null) {
        workspaceRootPath = ws.root_path
        workspaceInfo = { name: ws.name, rootPath: ws.root_path, projectKind: ws.project_kind }
        // Load Context Governor pin/exclude overrides for this workspace
        const ctxPrefRepo = new ContextPreferenceRepository(this.db)
        const { pinnedPaths, excludedPaths } = ctxPrefRepo.getOverrides(primaryWorkspaceId ?? '')
        projectContext = projectContextService.discover(ws.root_path, {
          mode: 'project-smart',
          budgetTokens: projectContextBudgetTokens,
          pinnedPaths,
          excludedPaths,
        })
      }
    }
    const turnAttachments = prepareTurnAttachments(attachments, workspaceRootPath)
    const attachmentDirectories = getAttachmentAdditionalDirectories(
      turnAttachments,
      workspaceRootPath,
    )

    // Query active rules (system + current project scope) and append workspace files.
    const rulesRepo = new RulesRepository(this.db)
    const activeRules = rulesRepo
      .list({ scope: 'system' })
      .concat(
        rulesRepo
          .list({ scope: 'project' })
          .filter(
            (r) =>
              r.scope_ref == null ||
              primaryWorkspaceId == null ||
              r.scope_ref === primaryWorkspaceId,
          ),
      )
      .filter((r) => r.enabled === 1)
      .map((r) => r.content)
      .concat(projectContext.rules)
    const managedRules = collectManagedRuleContents(rulesRepo, agent, workflow)
    const runtimeRulesPrompt = buildRuntimeRulesPrompt([...activeRules, ...managedRules])

    // Build explicit skill prompt if skillId is provided; available skills are composed below.
    let explicitSkillPrompt: string | undefined
    const skillRepo = new SkillRepository(this.db)
    if (skillId != null) {
      const loader = new SkillLoader(skillRepo)
      const projectSkillPrompt = projectContextService.buildSkillSystemPrompt(
        workspaceRootPath,
        skillId,
      )
      const sp = projectSkillPrompt ?? loader.buildSystemPrompt(skillId, skillParams ?? {})
      if (sp) explicitSkillPrompt = projectSkillPrompt ?? formatSelectedSkillPrompt(skillId, sp)
    }
    const runtimeComposition = new RuntimeCompositionService(
      skillRepo,
      new SettingsRepository(this.db),
    )
    const runtimeContext = runtimeComposition.composeRuntimeContext(
      {
        ...(primaryWorkspaceId != null ? { workspaceId: primaryWorkspaceId } : {}),
        sessionId,
        agentId: agent.id,
      },
      explicitSkillPrompt,
      {
        agentSkillIds: agent.skillIds,
        agentDisabledSkillIds: agent.disabledSkillIds,
      },
    )
    const imageGenerationContext = await this.resolveImageGenerationContext(workspaceRootPath)
    const mediaGenerationContext = await this.resolveMediaGenerationContext(workspaceRootPath)
    const platformMcpServer = await this.resolvePlatformManagementMcpServer(sessionId)
    const webSearchMcpServer = await this.resolveWebSearchMcpServer(workspaceRootPath)
    // 调试模式（per-session 能力开关）：开启时挂载 spark_debug + 注入状态机 prompt。
    const debugModeEnabled = getDebugModeFromMetadata(session.metadata_json)
    const debugMcpServer = debugModeEnabled
      ? await this.resolveDebugMcpServer(sessionId, workspaceRootPath)
      : null
    const sparkWebToolEnabled =
      runtimeContext.skillConfig.effectiveSkillIds.includes('builtin:spark-web-tool')
    const managedAgentPrompt = buildManagedAgentSystemPrompt(agent, workflow)

    // ── Team Mode：解析会话团队配置，构建 spark_team in-process MCP server + 花名册 ──
    // Mention 路由：被 @ 的 Member 直接响应，不注入 spark_team（不允许它再 dispatch，符合"互调暂缓"原则）。
    const teamConfig = sessionTeamConfig
    let teamMcpServer: SDKMcpServerConfig | undefined
    let teamRosterPrompt = ''
    let teamInstructionsPrompt = ''
    if (teamConfig?.enabled && !isMentionTurn) {
      const members = this.resolveTeamMembers(teamConfig.memberAgentIds, agent.id)
      teamRosterPrompt = buildTeamRosterPrompt(agent, members, teamConfig)
      // 若会话由某个长期团队（ManagedTeam）应用而来，则把团队专属 prompt 作为
      // [Team Instructions] 段注入，紧跟在 [Team Roster] 之后。即使长期团队被删除
      // 或被禁用，此处也按当前 DB 状态读取一次：缺失则跳过，不报错。
      if (teamConfig.teamId != null) {
        try {
          const team = new TeamDefinitionRepository(this.db).get(teamConfig.teamId)
          if (team != null && team.prompt.trim().length > 0) {
            teamInstructionsPrompt = `[Team Instructions]\n${team.prompt.trim()}`
          }
        } catch {
          // 静默：长期团队 prompt 是可选增强，DB 读取失败时降级为无 prompt 模式
        }
      }
      teamMcpServer =
        (await this.createTeamMcpServer({
          sessionId,
          turnId,
          hostAgent: agent,
          members,
          teamConfig,
          workspaceRootPath,
          eventRepo,
          hostPermissionMode: permissionMode,
        })) ?? undefined
    }
    // Mention 路由：注入"被 @ 的 Member 视角"，告诉它自己身份 + 上下文继承策略。
    let teamMemberContextPrompt = ''
    if (isMentionTurn && teamConfig?.enabled) {
      const hostName = agentNameById[teamConfig.hostAgentId] ?? teamConfig.hostAgentId
      teamMemberContextPrompt = [
        '[Team Member Context]',
        `You are ${agent.name} (${agent.id}), a member of the team led by ${hostName}.`,
        'The user explicitly @-mentioned you in the latest message — respond as yourself, inheriting the prior session context (including conversations with the host and other members above).',
        'Stay in character: do NOT impersonate the host or other members; do NOT prefix replies with their names. End the turn after addressing what the user asked you.',
      ].join('\n')
    }

    // ── Memory System：加载长期记忆注入 system prompt ──
    let memoryBlock: string | undefined
    try {
      const settingsRepo = new SettingsRepository(this.db)
      const memoryRepo = new MemoryRepository(this.db)
      const memoryStore = new MemoryStoreService(undefined, workspaceRootPath)
      const memoryReader = new MemoryReaderService(
        memoryRepo,
        memoryStore,
        (cat: string, key: string) => settingsRepo.get(cat, key),
      )
      const memoryInjection = await memoryReader.loadForSession({
        workspaceId: primaryWorkspaceId ?? '',
        agentId: agent.id,
      })
      memoryBlock = memoryInjection.block || undefined
      if (memoryBlock != null) {
        log.debug(`Memory injected: ${memoryInjection.injectedIds.length} entries`)
      }
    } catch (err) {
      log.warn(`Memory injection failed (non-fatal): ${err instanceof Error ? err.message : String(err)}`)
    }

    const composedSystemPrompt = joinPromptSections(
      managedAgentPrompt,
      teamMemberContextPrompt,
      teamRosterPrompt,
      teamInstructionsPrompt,
      runtimeRulesPrompt,
      memoryBlock,
      runtimeContext.systemPrompt,
      runtimeContext.envSystemPrompt,
      projectContext.systemPrompt,
      conversationHistoryPrompt,
    )
    const composedSkillSystemPrompt = joinPromptSections(
      runtimeContext.skillSystemPrompt,
      projectContext.skillSystemPrompt,
      imageGenerationContext?.systemPrompt,
      mediaGenerationContext?.systemPrompt,
      platformMcpServer != null ? PLATFORM_MANAGEMENT_SYSTEM_PROMPT : undefined,
      webSearchMcpServer != null ? WEB_SEARCH_SYSTEM_PROMPT : undefined,
      debugMcpServer != null ? DEBUG_MODE_SYSTEM_PROMPT : undefined,
      sparkWebToolEnabled ? SPARK_WEB_TOOL_SYSTEM_PROMPT : undefined,
    )

    // Initialize seq counter from existing event count
    if (!this.seqCounters.has(sessionId)) {
      this.seqCounters.set(sessionId, existingEventCount)
    }

    // ── SDK Execution Path ─────────────────────────────────────────────────
    // Claude execution is SDK-only. If the SDK is missing or cannot load, fail
    // the turn with an actionable error instead of falling back to direct API.
    this.emitAndPersist(
      sessionId,
      turnId,
      {
        id: crypto.randomUUID(),
        type: 'project_context_loaded',
        sessionId,
        turnId,
        timestamp: new Date().toISOString(),
        seq: 0,
        ...(workspaceInfo?.rootPath != null ? { workspaceRoot: workspaceInfo.rootPath } : {}),
        sources: projectContext.sources,
        ...(projectContext.budget != null ? { budget: projectContext.budget } : {}),
        counts: {
          rules: projectContext.sources.filter(
            (source) => source.kind === 'rule' && source.included !== false,
          ).length,
          skills: projectContext.sources.filter(
            (source) => source.kind === 'skill' && source.included !== false,
          ).length,
          agents: projectContext.sources.filter(
            (source) => source.kind === 'agent' && source.included !== false,
          ).length,
        },
      },
      eventRepo,
    )

    // ── 白盒提示词快照 ─────────────────────────────────────────────────────
    // 捕获本轮完整提示词组成，发送到 Renderer 供审计面板展示
    {
      const promptSections: Array<{ label: string; content: string; charCount: number }> = []
      if (composedSkillSystemPrompt && composedSkillSystemPrompt.trim().length > 0) {
        promptSections.push({
          label: 'Skill Prompt',
          content: composedSkillSystemPrompt,
          charCount: composedSkillSystemPrompt.length,
        })
      }
      if (composedSystemPrompt && composedSystemPrompt.trim().length > 0) {
        promptSections.push({
          label: 'System Prompt',
          content: composedSystemPrompt,
          charCount: composedSystemPrompt.length,
        })
      }
      if (agentAdapter === 'claude-sdk' || agentAdapter === 'claude') {
        promptSections.push({
          label: 'Claude Code 预设',
          content: '(SDK 内置系统提示词，约 15,000~20,000 字符，运行时由 Claude Code 注入)',
          charCount: 0,
        })
      }
      const toolCountEstimate = 12 // built-in coding agent tools (Read, Write, Edit, Bash, Glob, Grep, ...)
      const runtimeLoadStatus = [
        makeRuntimeLoadStatus('managed-agent', 'Managed Agent Prompt', managedAgentPrompt),
        makeRuntimeLoadStatus('team-member', 'Team Member Context', teamMemberContextPrompt),
        makeRuntimeLoadStatus('team-roster', 'Team Roster', teamRosterPrompt, teamConfig?.memberAgentIds.length),
        makeRuntimeLoadStatus('team-instructions', 'Team Instructions', teamInstructionsPrompt),
        makeRuntimeLoadStatus('rules', 'Rules', runtimeRulesPrompt, activeRules.length + managedRules.length),
        makeRuntimeLoadStatus('memory', 'Memory', memoryBlock),
        makeRuntimeLoadStatus('system-prompt', 'System Prompt Layer', runtimeContext.promptConfig.system.content),
        makeRuntimeLoadStatus('agent-prompt', 'Agent Prompt Layer', runtimeContext.promptConfig.agent.content),
        makeRuntimeLoadStatus('project-prompt', 'Project Prompt Layer', runtimeContext.promptConfig.project.content),
        makeRuntimeLoadStatus('session-prompt', 'Session Prompt Layer', runtimeContext.promptConfig.session.content),
        makeRuntimeLoadStatus('project-context', 'Project Context', projectContext.systemPrompt, projectContext.sources.length),
        makeRuntimeLoadStatus('selected-skill', 'Selected Skill Prompt', explicitSkillPrompt),
        makeRuntimeLoadStatus('available-skills', 'Available Skills Catalog', runtimeContext.skillSystemPrompt, runtimeContext.skillConfig.effectiveSkillIds.length),
        makeRuntimeLoadStatus('conversation-history', 'Conversation History', conversationHistoryPrompt),
      ]
      this.emitAndPersist(
        sessionId,
        turnId,
        {
          id: crypto.randomUUID(),
          type: 'turn_prompt_snapshot',
          sessionId,
          turnId,
          timestamp: new Date().toISOString(),
          seq: 0,
          userMessage: buildUserMessageSnapshot(message, turnAttachments),
          systemPromptSections: promptSections,
          model,
          providerProfileId: effectiveProviderProfileId,
          adapterKind,
          permissionMode,
          toolCount: toolCountEstimate,
          sdkSessionId,
          runtimeLoadStatus,
          ...(agentAdapter === 'claude-sdk' || agentAdapter === 'claude'
            ? { sdkPreset: 'claude_code' }
            : {}),
        },
        eventRepo,
      )
    }

    // ── Context Ledger ──────────────────────────────────────────────────
    // Emit a detailed token breakdown of all context sections for UI display
    {
      const estimateChars = (s: string | undefined): number => s?.trim().length ?? 0
      const estimateSectionTokens = (s: string | undefined): number =>
        Math.ceil(estimateChars(s) / 3)

      const ledgerSections = [
        {
          label: 'Skill Prompt',
          estimatedTokens: estimateSectionTokens(composedSkillSystemPrompt),
          charCount: estimateChars(composedSkillSystemPrompt),
          truncated: false,
        },
        {
          label: 'System Prompt',
          estimatedTokens: estimateSectionTokens(composedSystemPrompt),
          charCount: estimateChars(composedSystemPrompt),
          truncated: false,
        },
        {
          label: 'Project Context',
          estimatedTokens: projectContext.budget?.usedTokens ?? estimateSectionTokens(projectContext.systemPrompt),
          charCount: estimateChars(projectContext.systemPrompt),
          truncated: projectContext.budget?.truncated ?? false,
        },
        {
          label: 'Conversation History',
          estimatedTokens: estimateSectionTokens(conversationHistoryPrompt),
          charCount: estimateChars(conversationHistoryPrompt),
          truncated: false,
        },
        {
          label: 'User Message',
          estimatedTokens: estimateSectionTokens(message),
          charCount: estimateChars(message),
          truncated: false,
        },
        {
          label: 'Attachments',
          estimatedTokens: Math.ceil(buildAttachmentPromptLedger(turnAttachments).length / 3),
          charCount: buildAttachmentPromptLedger(turnAttachments).length,
          truncated: false,
        },
      ].filter((section) => section.charCount > 0 || section.estimatedTokens > 0)

      const totalEstimatedTokens = ledgerSections.reduce(
        (sum, section) => sum + section.estimatedTokens,
        0,
      )

      this.emitAndPersist(
        sessionId,
        turnId,
        {
          id: crypto.randomUUID(),
          type: 'context_ledger',
          sessionId,
          turnId,
          timestamp: new Date().toISOString(),
          seq: 0,
          sections: ledgerSections,
          totalEstimatedTokens,
          softLimitTokens: softContextLimitTokens,
          contextWindowTokens,
          usagePercent:
            softContextLimitTokens > 0
              ? Math.round((totalEstimatedTokens / softContextLimitTokens) * 100)
              : 0,
        },
        eventRepo,
      )
    }

    // ── Context Summarization Event ───────────────────────────────────────
    if (summarizationStats != null) {
      this.emitAndPersist(
        sessionId,
        turnId,
        {
          id: crypto.randomUUID(),
          type: 'context_summarized',
          sessionId,
          turnId,
          timestamp: new Date().toISOString(),
          seq: 0,
          summarizedEntryCount: summarizationStats.summarizedEntryCount,
          fromSeq: summarizationStats.fromSeq,
          toSeq: summarizationStats.toSeq,
          tokensSaved: summarizationStats.tokensSaved,
          summaryTokens: summarizationStats.summaryTokens,
        },
        eventRepo,
      )
    }

    const activeGoalForTurn = new GoalRepository(this.db).getCurrent(sessionId)
    const goalConfig = activeGoalForTurn?.status === 'active'
      ? {
          id: activeGoalForTurn.id,
          objective: activeGoalForTurn.objective,
          mode: activeGoalForTurn.mode,
          successCriteria: activeGoalForTurn.successCriteria,
          progressLog: activeGoalForTurn.progressLog,
        }
      : undefined

    if (agentAdapter === 'claude-sdk' || agentAdapter === 'claude') {
      const iterationOverride = this.iterationOverrides.get(sessionId)
      const sdkConfig: SDKExecutorConfig = {
        apiKey,
        ...(isLocalCli ? { useLocalConfig: true } : {}),
        model,
        workspaceRootPath,
        permissionMode,
        ...(config.apiEndpoint != null ? { apiEndpoint: config.apiEndpoint } : {}),
        ...(config.haikuModel != null ? { haikuModel: config.haikuModel } : {}),
        ...(config.sonnetModel != null ? { sonnetModel: config.sonnetModel } : {}),
        ...(config.opusModel != null ? { opusModel: config.opusModel } : {}),
        ...(composedSystemPrompt != null ? { systemPrompt: composedSystemPrompt } : {}),
        ...(composedSkillSystemPrompt != null
          ? { skillSystemPrompt: composedSkillSystemPrompt }
          : {}),
        ...(runtimeContext.customEnv != null ? { customEnv: runtimeContext.customEnv } : {}),
        ...((): { skillPlugins?: string[]; nativeSkills?: 'all' } => {
          // Claude 原生渐进式披露：以本地插件加载托管技能目录，SDK 注入 name+desc
          // 并提供原生 Skill 工具自主加载完整指令。失败/无插件时回落 skills_load 工具。
          const plugins = this.resolveNativeSkillPlugins()
          return plugins != null ? { skillPlugins: plugins, nativeSkills: 'all' } : {}
        })(),
        ...(imageGenerationContext != null
          ? { imageGenerationMcpServer: imageGenerationContext.mcpServer }
          : {}),
        ...(mediaGenerationContext != null
          ? { mediaGenerationMcpServer: mediaGenerationContext.mcpServer }
          : {}),
        ...(teamMcpServer != null ? { teamMcpServer } : {}),
        ...(platformMcpServer != null
          ? { platformManagementMcpServer: platformMcpServer }
          : {}),
        ...(webSearchMcpServer != null ? { webSearchMcpServer } : {}),
        ...(debugMcpServer != null ? { debugMcpServer } : {}),
        ...(iterationOverride != null ? { maxTurnCount: iterationOverride } : {}),
        ...(config.maxTokens != null ? { maxTokens: config.maxTokens } : {}),
        contextWindowTokens,
        ...(session.reasoning_effort != null
          ? { reasoningEffort: normalizeReasoningEffort(session.reasoning_effort) }
          : {}),
        ...(turnAttachments.length > 0 ? { attachments: turnAttachments } : {}),
        ...(attachmentDirectories.length > 0 ? { additionalDirectories: attachmentDirectories } : {}),
        enableCheckpoints: true,
        sdkSessionId,
        continueSession: canResumeSdkSession,
        ...(this.onApproval != null
          ? {
              approvalCallback: async (
                sid: string,
                toolName: string,
                toolInput: Record<string, unknown>,
              ) => {
                this.emitAgentStatusEvent(sid, turnId, eventRepo, 'waiting_permission')
                try {
                  return await this.onApproval!(sid, toolName, toolInput)
                } finally {
                  this.emitAgentStatusEvent(sid, turnId, eventRepo, 'thinking')
                }
              },
            }
          : {}),
        ...(this.onQuestion != null
          ? {
              questionCallback: async (sid: string, questions: UserQuestionPrompt[]) => {
                this.emitAgentStatusEvent(sid, turnId, eventRepo, 'waiting_user')
                try {
                  return await this.onQuestion!(sid, questions)
                } finally {
                  this.emitAgentStatusEvent(sid, turnId, eventRepo, 'thinking')
                }
              },
            }
          : {}),
        ...(goalConfig != null ? { goal: goalConfig } : {}),
      }
      const allowedMcpServerIds = getAllowedMcpServerIds(agent, workflow)
      const turnOptions: TryStartSDKTurnOptions = {
        ...(allowedMcpServerIds != null ? { allowedMcpServerIds } : {}),
        ...(isMentionTurn ? { mentionAgentId: agent.id } : {}),
        primaryWorkspaceId: primaryWorkspaceId ?? '',
        agentId: agent.id,
        workspaceRootPath,
      }
      // Local CLI 走宿主 OAuth，没有可直发的 apiKey；跳过远程标题精炼，
      // 仍保留首轮触发的简单本地标题（deriveSessionTitle）。
      // Mention turn 不参与首轮标题精炼（会话已有上下文）。
      if (isFirstTurn && !isLocalCli && !isMentionTurn) {
        turnOptions.firstTurnTitleContext = {
          providerType: provider.provider_type,
          apiKey,
          model,
          ...(config.apiEndpoint != null ? { apiEndpoint: config.apiEndpoint } : {}),
          userMessage: message,
        }
      }
      await this.tryStartSDKTurn(
        sessionId,
        turnId,
        message,
        eventRepo,
        sessionRepo,
        sdkConfig,
        turnOptions,
      )
      return
    }

    const codexConfig: SDKExecutorConfig = {
      apiKey,
      ...(isLocalCli ? { useLocalConfig: true } : {}),
      model,
      workspaceRootPath,
      permissionMode,
      ...(config.apiEndpoint != null ? { apiEndpoint: config.apiEndpoint } : {}),
      ...(config.codexApiKind != null ? { codexApiKind: config.codexApiKind } : {}),
      ...(!isLocalCli && provider.provider_type !== 'anthropic'
        ? {
            codexCliProvider: buildCodexCliModelProviderConfig({
              providerProfileId: effectiveProviderProfileId,
              providerName: provider.name,
              apiKind: config.codexApiKind ?? 'responses',
              apiKey,
              ...(config.apiEndpoint !== undefined ? { apiEndpoint: config.apiEndpoint } : {}),
            }),
          }
        : {}),
      ...(composedSystemPrompt != null ? { systemPrompt: composedSystemPrompt } : {}),
      ...(composedSkillSystemPrompt != null
        ? { skillSystemPrompt: composedSkillSystemPrompt }
        : {}),
      ...(runtimeContext.customEnv != null ? { customEnv: runtimeContext.customEnv } : {}),
      ...(platformMcpServer != null
        ? { platformManagementMcpServer: platformMcpServer }
        : {}),
      ...(webSearchMcpServer != null ? { webSearchMcpServer } : {}),
      ...(debugMcpServer != null ? { debugMcpServer } : {}),
      ...(config.maxTokens != null ? { maxTokens: config.maxTokens } : {}),
      contextWindowTokens,
      ...(session.reasoning_effort != null
        ? { reasoningEffort: normalizeReasoningEffort(session.reasoning_effort) }
        : {}),
      ...(turnAttachments.length > 0 ? { attachments: turnAttachments } : {}),
      ...(attachmentDirectories.length > 0 ? { additionalDirectories: attachmentDirectories } : {}),
      enableCheckpoints: false,
      sdkSessionId,
      continueSession: canResumeSdkSession,
      ...(goalConfig != null ? { goal: goalConfig } : {}),
    }
    const allowedMcpServerIds = getAllowedMcpServerIds(agent, workflow)
    await this.tryStartCodexCliTurn(
      sessionId,
      turnId,
      message,
      eventRepo,
      sessionRepo,
      codexConfig,
      {
        ...(allowedMcpServerIds != null ? { allowedMcpServerIds } : {}),
        ...(isMentionTurn ? { mentionAgentId: agent.id } : {}),
        primaryWorkspaceId: primaryWorkspaceId ?? '',
        agentId: agent.id,
        workspaceRootPath,
      },
    )
  }

  /**
   * Run the turn through the Claude Agent SDK, or fail explicitly when the SDK
   * is unavailable. Spark no longer falls back to direct Anthropic API.
   */
  private emitSdkRequiredError(params: {
    sessionId: string
    turnId: string
    message: string
    eventRepo: EventRepository
    sessionRepo: SessionRepository
    sdkName: string
    statusMessage: string
    detail: string
    rawError?: string
  }): void {
    const makeBase = () => ({
      id: crypto.randomUUID(),
      sessionId: params.sessionId,
      turnId: params.turnId,
      timestamp: new Date().toISOString(),
      seq: 0,
    })

    this.emitAndPersist(
      params.sessionId,
      params.turnId,
      {
        ...makeBase(),
        type: 'user_message',
        content: params.message,
      },
      params.eventRepo,
    )
    this.emitAndPersist(
      params.sessionId,
      params.turnId,
      {
        ...makeBase(),
        type: 'agent_error',
        code: 'SDK_REQUIRED',
        message: `${params.sdkName} is required. ${params.detail}`,
        retryable: false,
        ...(params.rawError != null ? { rawError: params.rawError } : {}),
      },
      params.eventRepo,
    )
    this.emitAndPersist(
      params.sessionId,
      params.turnId,
      {
        ...makeBase(),
        type: 'agent_status',
        status: 'error',
        message: params.statusMessage,
      },
      params.eventRepo,
    )
    params.sessionRepo.updateStatus(params.sessionId, 'error')
  }

  private async tryStartSDKTurn(
    sessionId: string,
    turnId: string,
    message: string,
    eventRepo: EventRepository,
    sessionRepo: SessionRepository,
    config: SDKExecutorConfig,
    options: TryStartSDKTurnOptions = {},
  ): Promise<void> {
    const makeBase = () => ({
      id: crypto.randomUUID(),
      sessionId,
      turnId,
      timestamp: new Date().toISOString(),
      seq: 0,
    })

    const emitSdkRequiredError = (rawError?: string) => {
      this.emitAndPersist(
        sessionId,
        turnId,
        {
          ...makeBase(),
          type: 'user_message',
          content: message,
        },
        eventRepo,
      )
      this.emitAndPersist(
        sessionId,
        turnId,
        {
          ...makeBase(),
          type: 'agent_error',
          code: 'SDK_REQUIRED',
          message:
            'Claude Agent SDK is required for Claude execution. Open Settings and install or repair the Claude Agent SDK.',
          retryable: false,
          ...(rawError != null ? { rawError } : {}),
        },
        eventRepo,
      )
      this.emitAndPersist(
        sessionId,
        turnId,
        {
          ...makeBase(),
          type: 'agent_status',
          status: 'error',
          message: 'Claude Agent SDK is not available',
        },
        eventRepo,
      )
      sessionRepo.updateStatus(sessionId, 'error')
    }

    const workspaceIssue = await getWorkspaceRootIssue(config.workspaceRootPath)
    if (workspaceIssue != null) {
      this.emitAndPersist(
        sessionId,
        turnId,
        {
          ...makeBase(),
          type: 'user_message',
          content: message,
        },
        eventRepo,
      )
      this.emitAndPersist(
        sessionId,
        turnId,
        {
          ...makeBase(),
          type: 'agent_error',
          code: 'WORKSPACE_UNAVAILABLE',
          message:
            `Workspace path is not available: ${config.workspaceRootPath}. ` +
            'Reopen the workspace or update the session workspace before running Claude.',
          retryable: false,
          rawError: workspaceIssue,
        },
        eventRepo,
      )
      this.emitAndPersist(
        sessionId,
        turnId,
        {
          ...makeBase(),
          type: 'agent_status',
          status: 'error',
          message: 'Workspace path is not available',
        },
        eventRepo,
      )
      sessionRepo.updateStatus(sessionId, 'error')
      return
    }

    try {
      const { isSDKAvailable: checkSDK } = await import('../sdk/index.js')
      if (!(await checkSDK())) {
        emitSdkRequiredError()
        return
      }
    } catch (err) {
      emitSdkRequiredError(err instanceof Error ? `${err.name}: ${err.message}` : String(err))
      return
    }

    // Build MCP server config from our McpService for the SDK
    const mcpServers = this.buildMcpServersForSDK(options.allowedMcpServerIds)
    if (config.imageGenerationMcpServer != null) {
      mcpServers.spark_image = config.imageGenerationMcpServer
    }
    if (config.mediaGenerationMcpServer != null) {
      mcpServers.spark_media = config.mediaGenerationMcpServer
    }
    if (config.teamMcpServer != null) {
      mcpServers.spark_team = config.teamMcpServer
    }

    // Platform management MCP server — auto-registered for all sessions
    if (config.platformManagementMcpServer != null) {
      mcpServers.spark_platform = config.platformManagementMcpServer
    }

    // Built-in web search MCP server — auto-registered for all sessions
    if (config.webSearchMcpServer != null) {
      mcpServers.spark_search = config.webSearchMcpServer
    }

    // Debug mode MCP server (spark_debug) — only when the session enabled debug mode
    if (config.debugMcpServer != null) {
      mcpServers.spark_debug = config.debugMcpServer
    }

    // Canvas Agent in-process MCP server — only when session is attached to a canvas modal
    let canvasAllowedTools: string[] | undefined
    if (this.canvasMcpProvider != null) {
      try {
        const canvas = await this.canvasMcpProvider(sessionId)
        if (canvas != null) {
          mcpServers.spark_canvas = canvas.server
          canvasAllowedTools = canvas.allowedTools
        }
      } catch (err) {
        log.warn(`canvas mcp provider failed: ${err instanceof Error ? err.message : String(err)}`)
      }
    }

    // MCP hot-reload: if the MCP set changed since the last SDK query was built,
    // force a fresh SDK session so the new tool inventory takes effect. The SDK
    // freezes the tool list at query start (ClaudeSDKExecutor passes mcpServers
    // into sdk.query once), so we can't mutate an in-flight session — but we can
    // guarantee the NEXT turn starts cleanly.
    if (this.mcpVersion !== this.lastBuiltMcpVersion) {
      config.continueSession = false
      this.lastBuiltMcpVersion = this.mcpVersion
    }

    const executor = new ClaudeSDKExecutor()
    const changedFiles = new Set<string>()
    // 工作目录快照：turn 开始前捕获一次，turn 完成后再捕获一次，diff 出
    // Bash/MCP 等间接产生但未被 edit_file/write_file 捕获的文件（PDF/DOCX/XLSX/PPTX 等产物）。
    // 合成 file_change 事件 emit，让 turn 文件变更卡片能完整展示。
    const workspaceRootPath = config.workspaceRootPath
    const snapshotService =
      workspaceRootPath != null && workspaceRootPath.length > 0
        ? new WorkspaceSnapshotService()
        : null
    const snapshotBeforePromise: Promise<FileSnapshot | null> =
      snapshotService != null && workspaceRootPath != null
        ? snapshotService
            .snapshot(workspaceRootPath)
            .catch((err) => {
              log.warn('workspace snapshot before failed', {
                err: err instanceof Error ? err.message : String(err),
              })
              return null
            })
        : Promise.resolve(null)
    let validationSuggestionEmitted = false
    const maybeEmitValidationSuggestion = () => {
      if (validationSuggestionEmitted || changedFiles.size === 0) return
      validationSuggestionEmitted = true
      // 调试模式下不弹通用「建议验证」卡：此时正确的下一步是让用户去复现（由调试快捷回复
      // 与 spark_debug 状态机驱动），提示跑 typecheck/test 反而打断闭环、属于噪声。
      if (config.debugMcpServer != null) return
      const suggestion = new ValidationSuggestionService().suggest({
        workspaceRootPath: config.workspaceRootPath,
        changedFiles: Array.from(changedFiles),
      })
      if (suggestion == null) return
      this.emitAndPersist(
        sessionId,
        turnId,
        {
          ...makeBase(),
          type: 'validation_suggestion',
          summary: suggestion.summary,
          changedFiles: suggestion.changedFiles,
          commands: suggestion.commands,
        },
        eventRepo,
      )
    }

    let firstAssistantText = ''
    const collectAssistantText = options.firstTurnTitleContext != null
    // Mention 路由：把 assistant_message 重写为 team_member_message（驱动 TeamMemberBubble + 进入历史时带 [name]）。
    // dispatchId 复用 turnId（mention 没有 dispatch 概念，UI 只需稳定标识对 delta 流聚合）。
    const mentionAgentId = options.mentionAgentId
    const mentionMemberContext = mentionAgentId != null
      ? { dispatchId: `mention:${turnId}`, memberAgentId: mentionAgentId }
      : undefined
    const turnAgent = this.resolveAgent(options.agentId)
    executor.onEvent((event) => {
      if (event.type === 'file_change') changedFiles.add(event.path)
      let outgoing: AgentEvent = withAgentSnapshot(event, turnAgent)
      if (mentionAgentId != null) {
        if (event.type === 'assistant_message' && typeof event.content === 'string') {
          outgoing = {
            id: event.id,
            type: 'team_member_message',
            sessionId: event.sessionId,
            turnId: event.turnId,
            timestamp: event.timestamp,
            seq: event.seq,
            dispatchId: `mention:${turnId}`,
            memberAgentId: mentionAgentId,
            mode: event.mode,
            content: event.content,
            isFinal: event.isFinal,
            ...(event.segmentId != null ? { segmentId: event.segmentId } : {}),
          }
        } else if (event.type === 'user_message') {
          outgoing = { ...event, mentionAgentId }
        } else if (
          mentionMemberContext != null &&
          (
            event.type === 'tool_call' ||
            event.type === 'tool_result' ||
            event.type === 'file_change' ||
            event.type === 'terminal_output'
          )
        ) {
          outgoing = { ...event, teamMemberContext: mentionMemberContext }
        }
      }
      this.emitAndPersist(sessionId, turnId, outgoing, eventRepo)
      if (event.type === 'agent_status' && event.status === 'completed') {
        maybeEmitValidationSuggestion()
      }
      // 立即更新 DB 中的 session status，不等 .then() 延迟。
      // 避免在此窗口期内 refreshData() 从 DB 读到旧 status 覆盖前端状态。
      if (event.type === 'agent_status') {
        if (event.status === 'completed' || event.status === 'cancelled') {
          sessionRepo.updateStatus(sessionId, 'idle')
        } else if (event.status === 'error') {
          sessionRepo.updateStatus(sessionId, 'error')
        }
      }
      // Plan 模式：agent 递交计划后，turn 即将完成。为避免 finally 里的
      // startNextQueuedTurn 把"用户审批前残留在队列里的旧 turn"自动顶出来执行
      // （这会让审批弹窗还没确认就执行了下一条用户消息），在这里只标记本 session
      // 处于"等待计划审批"状态，由 startNextQueuedTurn 的 pendingPlanApprovals
      // 拦截分支（L3590）阻断自动起跑；用户已排队的 turn 继续保留，等审批通过
      // 或被取消/拒绝后再决定继续执行还是丢弃。
      if (event.type === 'plan_proposed') {
        const justBlocked = !this.pendingPlanApprovals.has(sessionId)
        this.pendingPlanApprovals.add(sessionId)
        if (justBlocked) this.emitQueueChanged(sessionId)
      }
      if (
        collectAssistantText &&
        event.type === 'assistant_message' &&
        event.mode === 'complete' &&
        typeof event.content === 'string'
      ) {
        // Keep only the first complete assistant message of this turn
        if (firstAssistantText.length === 0) firstAssistantText = event.content
      }
      if (event.type === 'assistant_message' && event.mode === 'complete' && typeof event.content === 'string') {
        this.updateGoalFromAssistantBlock(sessionId, event.content)
      }
      if (event.type === 'assistant_message' && event.mode === 'complete' && typeof event.content === 'string') {
        this.updateGoalFromAssistantBlock(sessionId, event.content)
      }
    })

    this.activeLoops.set(sessionId, executor)
    sessionRepo.updateStatus(sessionId, 'running')
    this.emitQueueChanged(sessionId)

    // Compute allowed tools: merge image-gen / media / team / platform tools into config defaults
    let sdkAllowedTools = config.allowedTools
    if (config.imageGenerationMcpServer != null) {
      sdkAllowedTools = mergeUniqueStrings(sdkAllowedTools, ['mcp__spark_image__generate_image'])
    }
    if (config.mediaGenerationMcpServer != null) {
      sdkAllowedTools = mergeUniqueStrings(sdkAllowedTools, [
        'mcp__spark_media__list_models',
        'mcp__spark_media__describe_model',
        'mcp__spark_media__generate_image',
        'mcp__spark_media__edit_image',
        'mcp__spark_media__generate_audio',
        'mcp__spark_media__transcribe_audio',
        'mcp__spark_media__generate_video',
        'mcp__spark_media__get_task',
        'mcp__spark_media__cancel_task',
      ])
    }
    if (config.teamMcpServer != null) {
      sdkAllowedTools = mergeUniqueStrings(sdkAllowedTools, [
        'mcp__spark_team__agent_dispatch',
        'mcp__spark_team__agent_dispatch_batch',
      ])
    }
    if (config.platformManagementMcpServer != null) {
      sdkAllowedTools = mergeUniqueStrings(sdkAllowedTools, PLATFORM_TOOL_NAMES)
    }
    if (config.webSearchMcpServer != null) {
      sdkAllowedTools = mergeUniqueStrings(sdkAllowedTools, SEARCH_TOOL_NAMES)
    }
    if (config.debugMcpServer != null) {
      sdkAllowedTools = mergeUniqueStrings(sdkAllowedTools, DEBUG_TOOL_NAMES)
    }
    if (canvasAllowedTools != null) {
      sdkAllowedTools = mergeUniqueStrings(sdkAllowedTools, canvasAllowedTools)
    }

    const sdkConfig: SDKExecutorConfig = {
      ...config,
      ...(Object.keys(mcpServers).length > 0 ? { mcpServers } : {}),
      ...(sdkAllowedTools != null ? { allowedTools: sdkAllowedTools } : {}),
      // Team Mode 下禁用 SDK 内置 Task 工具，强制 A2A 走 spark_team.agent_dispatch（§7.4）
      ...(config.teamMcpServer != null
        ? { disallowedTools: mergeUniqueStrings(config.disallowedTools, ['Task']) }
        : {}),
    }

    // Fire-and-forget
    executor
      .executeTurn(sessionId, turnId, message, sdkConfig)
      .then(async () => {
        maybeEmitValidationSuggestion()
        sessionRepo.updateStatus(sessionId, 'idle')
        // Reset resume circuit breaker on successful turn completion
        getResumeCircuitBreaker().recordSuccess(sessionId)
        const titleCtx = options.firstTurnTitleContext
        if (titleCtx != null) {
          void this.refineSessionTitleAsync(sessionId, sessionRepo, {
            ...titleCtx,
            assistantMessage: firstAssistantText,
          })
        }

        // ── Memory System：turn 完成后异步写入记忆（fire-and-forget） ──
        void this.maybeWriteMemoryFromTurn(
          sessionId,
          options.primaryWorkspaceId ?? '',
          options.agentId ?? '',
          options.workspaceRootPath,
          message,
          firstAssistantText,
        ).catch(() => { /* swallow — never affect main flow */ })

        // ── 工作目录快照 diff：合成 file_change 事件 ──
        // 仅为 SDK 自身工具（edit/write/multi_edit）遗漏的产物文件（如 Bash 跑
        // python 生成的 pdf/docx/xlsx/pptx，或 MCP image_generation 产出的图）兜底。
        // 与现有 changedFiles 集合去重，避免重复 emit。
        if (snapshotService != null && workspaceRootPath != null) {
          try {
            const [before, after] = await Promise.all([
              snapshotBeforePromise,
              snapshotService.snapshot(workspaceRootPath),
            ])
            if (before != null && after != null) {
              const diffResult = snapshotService.diff(before, after)
              const emitFrom = (
                paths: string[],
                changeType: 'create' | 'modify' | 'delete',
              ): void => {
                for (const relPath of paths) {
                  const abs = path.isAbsolute(relPath)
                    ? relPath
                    : path.join(workspaceRootPath, relPath)
                  if (changedFiles.has(abs) || changedFiles.has(relPath)) continue
                  changedFiles.add(abs)
                  this.emitAndPersist(
                    sessionId,
                    turnId,
                    { ...makeBase(), type: 'file_change', changeType, path: abs },
                    eventRepo,
                  )
                }
              }
              emitFrom(diffResult.added, 'create')
              emitFrom(diffResult.modified, 'modify')
              emitFrom(diffResult.deleted, 'delete')
            }
          } catch (err) {
            log.warn('workspace snapshot diff failed', {
              err: err instanceof Error ? err.message : String(err),
            })
          }
        }
      })
      .catch(() => {
        sessionRepo.updateStatus(sessionId, 'error')
      })
      .finally(() => {
        // 清理本 turn 的 dispatch 预算计数，避免长生命周期进程内存增长
        this.teamDispatchService?.clearTurn(turnId)
        if (this.activeLoops.get(sessionId) === executor) {
          this.activeLoops.delete(sessionId)
          void this.continueGoalOrQueue(sessionId)
        }
      })
  }

  private async tryStartCodexCliTurn(
    sessionId: string,
    turnId: string,
    message: string,
    eventRepo: EventRepository,
    sessionRepo: SessionRepository,
    config: SDKExecutorConfig,
    options: TryStartSDKTurnOptions = {},
  ): Promise<void> {
    const makeBase = () => ({
      id: crypto.randomUUID(),
      sessionId,
      turnId,
      timestamp: new Date().toISOString(),
      seq: 0,
    })

    const workspaceIssue = await getWorkspaceRootIssue(config.workspaceRootPath)
    if (workspaceIssue != null) {
      this.emitAndPersist(
        sessionId,
        turnId,
        {
          ...makeBase(),
          type: 'user_message',
          content: message,
        },
        eventRepo,
      )
      this.emitAndPersist(
        sessionId,
        turnId,
        {
          ...makeBase(),
          type: 'agent_error',
          code: 'WORKSPACE_UNAVAILABLE',
          message:
            `Workspace path is not available: ${config.workspaceRootPath}. ` +
            'Reopen the workspace or update the session workspace before running Codex CLI.',
          retryable: false,
          rawError: workspaceIssue,
        },
        eventRepo,
      )
      this.emitAndPersist(
        sessionId,
        turnId,
        {
          ...makeBase(),
          type: 'agent_status',
          status: 'error',
          message: 'Workspace path is not available',
        },
        eventRepo,
      )
      sessionRepo.updateStatus(sessionId, 'error')
      return
    }

    const mcpServers = this.buildMcpServersForSDK(options.allowedMcpServerIds)
    if (config.platformManagementMcpServer != null) {
      mcpServers.spark_platform = config.platformManagementMcpServer
    }
    if (config.webSearchMcpServer != null) {
      mcpServers.spark_search = config.webSearchMcpServer
    }

    // Debug mode MCP server (spark_debug) — only when the session enabled debug mode
    if (config.debugMcpServer != null) {
      mcpServers.spark_debug = config.debugMcpServer
    }

    // MCP hot-reload: same as Claude SDK path — force a fresh session if the MCP
    // set changed since the last build.
    if (this.mcpVersion !== this.lastBuiltMcpVersion) {
      config.continueSession = false
      this.lastBuiltMcpVersion = this.mcpVersion
    }

    const useCodexCli = config.useLocalConfig === true || config.codexCliProvider != null
    const executor = createCodexExecutorForConfig(config)
    let firstAssistantText = ''
    const mentionAgentId = options.mentionAgentId
    const mentionMemberContext =
      mentionAgentId != null
        ? { dispatchId: `mention:${turnId}`, memberAgentId: mentionAgentId }
        : undefined
    const turnAgent = this.resolveAgent(options.agentId)
    const initialWorkspaceChangesPromise = collectWorkspaceChangeSnapshot(config.workspaceRootPath)
    const observedFileChangePaths = new Set<string>()
    let pendingTerminalStatus: AgentStatusEvent | null = null
    const emitDiscoveredWorkspaceChanges = async (): Promise<void> => {
      const initialWorkspaceChanges = await initialWorkspaceChangesPromise
      const discovered = await collectWorkspaceFileChangesSince(config.workspaceRootPath, initialWorkspaceChanges)
      for (const change of discovered) {
        if (observedFileChangePaths.has(change.path)) continue
        observedFileChangePaths.add(change.path)
        this.emitAndPersist(
          sessionId,
          turnId,
          {
            ...makeBase(),
            type: 'file_change',
            changeType: change.changeType,
            path: change.path,
          },
          eventRepo,
        )
      }
    }
    const emitPendingTerminalStatus = (): void => {
      if (pendingTerminalStatus == null) return
      this.emitAndPersist(sessionId, turnId, pendingTerminalStatus, eventRepo)
      if (pendingTerminalStatus.status === 'completed' || pendingTerminalStatus.status === 'cancelled') {
        sessionRepo.updateStatus(sessionId, 'idle')
      } else if (pendingTerminalStatus.status === 'error') {
        sessionRepo.updateStatus(sessionId, 'error')
      }
      pendingTerminalStatus = null
    }

    executor.onEvent((event) => {
      if (event.type === 'agent_status' && (event.status === 'completed' || event.status === 'cancelled' || event.status === 'error')) {
        pendingTerminalStatus = withAgentSnapshot(event, turnAgent) as AgentStatusEvent
        return
      }
      if (event.type === 'file_change') observedFileChangePaths.add(event.path)
      let outgoing: AgentEvent = withAgentSnapshot(event, turnAgent)
      if (mentionAgentId != null) {
        if (event.type === 'assistant_message' && typeof event.content === 'string') {
          outgoing = {
            id: event.id,
            type: 'team_member_message',
            sessionId: event.sessionId,
            turnId: event.turnId,
            timestamp: event.timestamp,
            seq: event.seq,
            dispatchId: `mention:${turnId}`,
            memberAgentId: mentionAgentId,
            mode: event.mode,
            content: event.content,
            isFinal: event.isFinal,
            ...(event.segmentId != null ? { segmentId: event.segmentId } : {}),
          }
        } else if (event.type === 'user_message') {
          outgoing = { ...event, mentionAgentId }
        } else if (
          mentionMemberContext != null &&
          (
            event.type === 'tool_call' ||
            event.type === 'tool_result' ||
            event.type === 'file_change' ||
            event.type === 'terminal_output'
          )
        ) {
          outgoing = { ...event, teamMemberContext: mentionMemberContext }
        }
      }
      this.emitAndPersist(sessionId, turnId, outgoing, eventRepo)
      if (event.type === 'agent_status') {
        if (event.status === 'completed' || event.status === 'cancelled') {
          sessionRepo.updateStatus(sessionId, 'idle')
        } else if (event.status === 'error') {
          sessionRepo.updateStatus(sessionId, 'error')
        }
      }
      if (
        event.type === 'assistant_message' &&
        event.mode === 'complete' &&
        typeof event.content === 'string' &&
        firstAssistantText.length === 0
      ) {
        firstAssistantText = event.content
      }
    })

    this.activeLoops.set(sessionId, executor)
    sessionRepo.updateStatus(sessionId, 'running')
    this.emitQueueChanged(sessionId)

    const cliMcpServers = useCodexCli
      ? filterCliCompatibleMcpServers(mcpServers)
      : mcpServers
    const cliConfig: SDKExecutorConfig = {
      ...config,
      ...(Object.keys(cliMcpServers).length > 0 ? { mcpServers: cliMcpServers } : {}),
    }

    executor
      .executeTurn(sessionId, turnId, message, cliConfig)
      .then(async () => {
        await emitDiscoveredWorkspaceChanges()
        emitPendingTerminalStatus()
        sessionRepo.updateStatus(sessionId, 'idle')
        void this.maybeWriteMemoryFromTurn(
          sessionId,
          options.primaryWorkspaceId ?? '',
          options.agentId ?? '',
          options.workspaceRootPath,
          message,
          firstAssistantText,
        ).catch(() => { /* swallow — never affect main flow */ })
      })
      .catch(async () => {
        await emitDiscoveredWorkspaceChanges().catch(() => undefined)
        emitPendingTerminalStatus()
        sessionRepo.updateStatus(sessionId, 'error')
      })
      .finally(() => {
        this.teamDispatchService?.clearTurn(turnId)
        if (this.activeLoops.get(sessionId) === executor) {
          this.activeLoops.delete(sessionId)
          void this.continueGoalOrQueue(sessionId)
        }
      })
  }

  /**
   * Memory System：turn 结束后异步调用 MemoryWriterService。
   * 全过程 try/catch，任何异常仅 log，绝不向上抛（fire-and-forget）。
   */
  private async maybeWriteMemoryFromTurn(
    sessionId: string,
    workspaceId: string,
    agentId: string,
    workspaceRootPath: string | undefined,
    userMessage: string,
    assistantMessage: string,
  ): Promise<void> {
    try {
      const settingsRepo = new SettingsRepository(this.db)
      const memoryRepo = new MemoryRepository(this.db)
      const memoryStore = new MemoryStoreService(undefined, workspaceRootPath)
      const writer = new MemoryWriterService(
        memoryRepo,
        memoryStore,
        (cat: string, key: string) => settingsRepo.get(cat, key),
        // LLM call：复用 conversation-summarizer 的提取式摘要策略，
        // 此处简化实现 — 生产环境应通过 ModelService 调用小模型
        async (_prompt: string) => '[]',
      )
      await writer.maybeWriteFromTurn({
        sessionId,
        workspaceId,
        agentId,
        userMessage,
        assistantMessage,
        recentSummary: '',
      })
    } catch (err) {
      log.warn(`maybeWriteMemoryFromTurn failed (non-fatal): ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  private async refineSessionTitleAsync(
    sessionId: string,
    sessionRepo: SessionRepository,
    ctx: FirstTurnTitleContext & { assistantMessage: string },
  ): Promise<void> {
    try {
      const current = sessionRepo.get(sessionId)
      if (current == null) return
      // Skip if user has manually renamed the session in the meantime
      const derivedFromFirst = deriveSessionTitle(ctx.userMessage)
      if (current.title !== derivedFromFirst && !shouldDeriveSessionTitle(current.title)) {
        return
      }
      const refined = await generateSessionTitle({
        providerType: ctx.providerType,
        apiKey: ctx.apiKey,
        ...(ctx.apiEndpoint != null ? { apiEndpoint: ctx.apiEndpoint } : {}),
        model: ctx.model,
        userMessage: ctx.userMessage,
        assistantMessage: ctx.assistantMessage,
      })
      if (refined == null || refined.length === 0 || refined === current.title) return
      sessionRepo.updateTitle(sessionId, refined)
      this.onSessionRenamed?.(sessionId, refined)
    } catch (err) {
      log.warn(`refineSessionTitleAsync failed: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  /**
   * Build MCP server configs in the SDK's expected format from our McpService.
   */
  private buildMcpServersForSDK(allowedServerIds?: Set<string>): Record<string, SDKMcpServerConfig> {
    const result: Record<string, SDKMcpServerConfig> = {}
    const servers = this.mcpService.listServers()

    for (const server of servers) {
      if (!server.enabled) continue
      if (allowedServerIds != null && !allowedServerIds.has(server.id)) continue
      try {
        const cfg = JSON.parse(server.configJson) as Record<string, unknown>
        if (cfg.type === 'sse' && typeof cfg.url === 'string') {
          result[server.name] = {
            type: 'sse',
            url: cfg.url,
            ...(cfg.headers != null ? { headers: cfg.headers as Record<string, string> } : {}),
          }
        } else {
          result[server.name] = {
            type: 'stdio',
            command: String(cfg.command ?? 'npx'),
            args: Array.isArray(cfg.args) ? cfg.args.map(String) : [],
            ...(cfg.env != null ? { env: cfg.env as Record<string, string> } : {}),
            ...(typeof cfg.cwd === 'string' ? { cwd: cfg.cwd } : {}),
          }
        }
      } catch {
        // Skip servers with invalid config
      }
    }
    return result
  }

  /**
   * Ensure the Platform Bridge HTTP server is running.
   * The bridge is long-lived (shared across all sessions) and lazily started.
   */
  private async ensurePlatformBridge(): Promise<number> {
    if (this.platformBridge.isRunning()) {
      return this.platformBridge.getPort()
    }

    const { SkillService } = await import('./skill.service.js')
    const { SkillLoader } = await import('../skills/skill-loader.js')
    const { SkillRegistryService } = await import('./skill-registry/index.js')
    const { SkillRepository, SettingsRepository, TeamDefinitionRepository } = await import('@spark/storage')

    const skillRepo = new SkillRepository(this.db)
    const settingsRepo = new SettingsRepository(this.db)
    const skillLoader = new SkillLoader(skillRepo)
    const skillRegistryService = new SkillRegistryService(this.db, this.userSkillsDir ?? undefined)

    // Initialize skill registry adapters (loads marketplace sources)
    try { skillRegistryService.initialize() } catch { /* non-critical */ }

    const deps = {
      skillService: new SkillService(skillRepo),
      skillLoader,
      skillRegistryService,
      mcpService: this.mcpService,
      mcpRepo: new McpServerRepository(this.db),
      providerRepo: new ProviderProfileRepository(this.db),
      workflowRepo: new WorkflowRepository(this.db),
      agentRepo: new AgentRepository(this.db),
      teamRepo: new TeamDefinitionRepository(this.db),
      settingsRepo,
      sessionService: this,
      onConfigChanged: ((scope, action, id) => {
        this.onPlatformConfigChanged?.(scope, action, id)
      }) as PlatformConfigChangedHandler,
    }

    return this.platformBridge.start(deps)
  }

  /**
   * Resolve the Platform Management MCP server config.
   * Returns null if the MCP server script cannot be found or the bridge fails to start.
   */
  private async resolvePlatformManagementMcpServer(sessionId: string): Promise<SDKMcpServerConfig | null> {
    const serverPath = resolvePlatformManagementMcpServerPath()
    if (serverPath == null) {
      log.warn('Platform management MCP server script not found')
      return null
    }

    try {
      const port = await this.ensurePlatformBridge()
      return {
        type: 'stdio',
        command: process.execPath,
        args: [serverPath],
        env: {
          ELECTRON_RUN_AS_NODE: '1',
          SPARK_PLATFORM_BRIDGE_PORT: String(port),
          SPARK_SESSION_ID: sessionId,
        },
      }
    } catch (err) {
      log.warn(`Failed to start platform bridge: ${err instanceof Error ? err.message : String(err)}`)
      return null
    }
  }

  /**
   * 解析内置联网搜索 MCP server（spark_search），对所有 session 默认挂载。
   *
   * 免密默认链（cn.bing → 百度 → DuckDuckGo）零配置可用；若 app_settings 的
   * `webSearch` 分类配置了 keyed provider（bocha/tavily/serper）+ apiKey，则
   * 自动优先走它。key 仅注入子进程环境变量，不外泄。
   */
  private async resolveWebSearchMcpServer(workspaceRootPath: string): Promise<SDKMcpServerConfig | null> {
    const serverPath = resolveWebSearchMcpServerPath()
    if (serverPath == null) {
      log.warn('Web search MCP server script not found')
      return null
    }
    let provider = ''
    let apiKey = ''
    let baseUrl = ''
    try {
      const settings = new SettingsRepository(this.db).getByCategory('webSearch')
      if (typeof settings.provider === 'string') provider = settings.provider.trim()
      if (typeof settings.apiKey === 'string') apiKey = settings.apiKey.trim()
      if (typeof settings.baseUrl === 'string') baseUrl = settings.baseUrl.trim()
    } catch {
      // settings 不可用时静默走免密默认链
    }
    return {
      type: 'stdio',
      command: process.execPath,
      args: [serverPath],
      cwd: workspaceRootPath,
      env: {
        ELECTRON_RUN_AS_NODE: '1',
        ...(provider ? { SPARK_SEARCH_PROVIDER: provider } : {}),
        ...(apiKey ? { SPARK_SEARCH_API_KEY: apiKey } : {}),
        ...(baseUrl ? { SPARK_SEARCH_BASE_URL: baseUrl } : {}),
      },
    }
  }

  /**
   * 解析调试模式 MCP server（spark_debug）。仅当 session 开启 debugMode 时调用。
   *
   * 长驻的 DebugLogServer 在主进程内懒启动（跨 turn 存活，承接浏览器侧 bug 日志，
   * CORS 已处理）。本 MCP 子进程只是瘦桥接：把 begin/read/next_round/status/finish
   * 代理到 `http://127.0.0.1:<port>`。注入 SPARK_DEBUG_SID = sessionId，保证同一
   * 对话跨 turn / 跨子进程重启都映射到同一 debug session 的 buffer。
   */
  private async resolveDebugMcpServer(
    sessionId: string,
    workspaceRootPath: string,
  ): Promise<SDKMcpServerConfig | null> {
    const serverPath = resolveDebugMcpServerPath()
    if (serverPath == null) {
      log.warn('Debug mode MCP server script not found')
      return null
    }
    let port = 0
    try {
      port = await getDebugLogServer().start()
    } catch (err) {
      log.warn(`Failed to start debug log server: ${err instanceof Error ? err.message : String(err)}`)
      return null
    }
    return {
      type: 'stdio',
      command: process.execPath,
      args: [serverPath],
      cwd: workspaceRootPath,
      env: {
        ELECTRON_RUN_AS_NODE: '1',
        SPARK_DEBUG_LOG_PORT: String(port),
        SPARK_DEBUG_SID: sessionId,
      },
    }
  }

  private async resolveImageGenerationContext(workspaceRootPath: string): Promise<ImageGenerationRuntimeContext | null> {
    const providerRepo = new ProviderProfileRepository(this.db)
    if (typeof providerRepo.listAll !== 'function') return null
    const imageProvider = providerRepo
      .listAll()
      .find((row) => {
        if (row.enabled !== 1) return false
        try {
          const config = JSON.parse(row.config_json) as { modelType?: string }
          return config.modelType === 'image'
        } catch {
          return false
        }
      })
    if (imageProvider == null || imageProvider.keystore_ref == null) return null

    const apiKey = await keystore.getSecret(imageProvider.keystore_ref as keystore.KeystoreRef)
    if (apiKey == null || apiKey.trim().length === 0) return null

    const config = JSON.parse(imageProvider.config_json) as {
      defaultModel?: string
      model?: string
      apiEndpoint?: string
      imageProvider?: string | null
      imageApiType?: 'sync' | 'async' | 'auto' | null
    }
    const model = (config.defaultModel ?? config.model ?? '').trim()
    if (!model) return null

    const serverPath = resolveImageGenerationMcpServerPath()
    if (serverPath == null) {
      log.warn('Image generation provider configured but MCP server script was not found')
      return null
    }

    const outputDir = path.join(workspaceRootPath, '.spark-artifacts', 'images')
    const providerName = config.imageProvider?.trim() || 'openai'
    const apiType = config.imageApiType ?? 'sync'
    return {
      mcpServer: {
        type: 'stdio',
        command: process.execPath,
        args: [serverPath],
        cwd: workspaceRootPath,
        env: {
          ELECTRON_RUN_AS_NODE: '1',
          SPARK_IMAGE_API_KEY: apiKey,
          SPARK_IMAGE_MODEL: model,
          SPARK_IMAGE_PROVIDER: providerName,
          SPARK_IMAGE_API_TYPE: apiType,
          SPARK_IMAGE_OUTPUT_DIR: outputDir,
          ...(config.apiEndpoint != null && config.apiEndpoint.trim().length > 0
            ? { SPARK_IMAGE_BASE_URL: config.apiEndpoint.trim() }
            : {}),
        },
      },
      systemPrompt: buildImageGenerationSystemPrompt({
        name: imageProvider.name,
        model,
        provider: providerName,
        apiType,
        outputDir,
        ...(config.apiEndpoint !== undefined ? { apiEndpoint: config.apiEndpoint } : {}),
      }),
    }
  }

  /**
   * 解析 spark_media MCP server 配置。
   *
   * 选择策略：首个 enabled 且 mediaCapabilities 包含 audio / video 能力的 provider
   * （图片生成继续走 spark_image，避免重复注入）。
   * 同时要求 keystore 可读 API key、有 defaultModel、MCP server 脚本可解析。
   */
  private async resolveMediaGenerationContext(workspaceRootPath: string): Promise<MediaGenerationRuntimeContext | null> {
    const providerRepo = new ProviderProfileRepository(this.db)
    if (typeof providerRepo.listAll !== 'function') return null
    const catalog = new MediaModelCatalogService(new MediaModelManifestRepository(this.db))
    catalog.seedBuiltinManifests()
    const VOICE_VIDEO = new Set([
      'audio.speech',
      'audio.transcription',
      'video.generate',
      'video.image_to_video',
      'video.reference_to_video',
      'video.edit',
      'video.extend',
    ])
    const selectedProvider = providerRepo
      .listAll()
      .find((row) => {
        if (row.enabled !== 1) return false
        try {
          const config = JSON.parse(row.config_json) as {
            modelType?: string
            mediaCapabilities?: string[]
            mediaModelRefs?: Array<{ manifestId?: string; enabled?: boolean }>
          }
          // voice/video 模型类型，或显式声明了 audio/video 能力
          const isMediaModelType = config.modelType === 'voice' || config.modelType === 'video'
          const caps = Array.isArray(config.mediaCapabilities) ? config.mediaCapabilities : []
          const hasMediaCap = caps.some((cap) => VOICE_VIDEO.has(cap))
          const refs = Array.isArray(config.mediaModelRefs) ? config.mediaModelRefs : []
          const hasManifestCap = refs
            .filter((ref) => ref.enabled !== false && typeof ref.manifestId === 'string')
            .some((ref) => {
              const manifest = catalog.describe(ref.manifestId!)
              return manifest?.capabilities.some((capability) => VOICE_VIDEO.has(capability.id)) === true
            })
          return isMediaModelType || hasMediaCap || hasManifestCap
        } catch {
          return false
        }
      })
    if (selectedProvider == null || selectedProvider.keystore_ref == null) return null

    const apiKey = await keystore.getSecret(selectedProvider.keystore_ref as keystore.KeystoreRef)
    if (apiKey == null || apiKey.trim().length === 0) return null

    const config = JSON.parse(selectedProvider.config_json) as {
      defaultModel?: string
      model?: string
      apiEndpoint?: string
      modelType?: string
      mediaProvider?: string | null
      mediaApiType?: string | null
      mediaCapabilities?: string[]
      mediaDefaults?: Record<string, unknown>
      mediaModelRefs?: ProviderMediaModelRef[]
    }
    const model = (config.defaultModel ?? config.model ?? '').trim()
    if (!model) return null

    const serverPath = resolveMediaGenerationMcpServerPath()
    if (serverPath == null) {
      log.warn('Media provider configured but spark_media MCP server script was not found')
      return null
    }

    const outputDir = path.join(workspaceRootPath, '.spark-artifacts', 'media')
    const mediaProviderKindValue = typeof config.mediaProvider === 'string' ? config.mediaProvider.trim() : ''
    const providerName = (isMediaProviderKind(mediaProviderKindValue) ? mediaProviderKindValue : 'openai-compatible') as MediaProviderKind
    const apiType = config.mediaApiType ?? 'auto'
    // 自定义 ref（manifestId 目录查不到）也要合成出 manifest，否则 agent 的 list_models /
    // describe_model 看不到这些模型，与画布行为不一致。合成所需的 providerKind / 域信息来自 profile。
    const mediaProfileLike: MediaProfileLike = {
      mediaModelRefs: Array.isArray(config.mediaModelRefs) ? config.mediaModelRefs : [],
      defaultModel: model,
      mediaProvider: config.mediaProvider ?? null,
      ...(config.modelType !== undefined ? { modelType: config.modelType } : {}),
      ...(config.mediaCapabilities !== undefined ? { mediaCapabilities: config.mediaCapabilities } : {}),
    }
    const mediaManifests = (Array.isArray(config.mediaModelRefs) ? config.mediaModelRefs : [])
      .filter((ref) => ref.enabled !== false)
      .map(
        (ref) =>
          catalog.describe(ref.manifestId) ??
          synthesizeMediaManifestForRef(mediaProfileLike, ref, catalog),
      )
      .filter((manifest): manifest is NonNullable<typeof manifest> => manifest != null)
    return {
      mcpServer: {
        type: 'stdio',
        command: process.execPath,
        args: [serverPath],
        cwd: workspaceRootPath,
        env: {
          ELECTRON_RUN_AS_NODE: '1',
          SPARK_MEDIA_API_KEY: apiKey,
          SPARK_MEDIA_MODEL: model,
          SPARK_MEDIA_PROVIDER: providerName,
          SPARK_MEDIA_API_TYPE: apiType,
          SPARK_MEDIA_OUTPUT_DIR: outputDir,
          ...(config.apiEndpoint != null && config.apiEndpoint.trim().length > 0
            ? { SPARK_MEDIA_BASE_URL: config.apiEndpoint.trim() }
            : {}),
          ...(config.mediaDefaults != null
            ? { SPARK_MEDIA_DEFAULTS_JSON: JSON.stringify(config.mediaDefaults) }
            : {}),
          ...(mediaManifests.length > 0
            ? { SPARK_MEDIA_MANIFESTS_JSON: JSON.stringify(mediaManifests) }
            : {}),
        },
      },
      systemPrompt: buildMediaGenerationSystemPrompt({
        name: selectedProvider.name,
        model,
        provider: providerName,
        apiType,
        outputDir,
        capabilities: Array.isArray(config.mediaCapabilities) ? config.mediaCapabilities : [],
        modelManifests: mediaManifests.map((manifest) => ({
          id: manifest.id,
          modelId: manifest.modelId,
          capabilities: manifest.capabilities.map((capability) => capability.id),
        })),
        ...(config.apiEndpoint !== undefined ? { apiEndpoint: config.apiEndpoint } : {}),
      }),
    }
  }

  private resolveAgent(agentId: string | undefined): AgentItem {
    const repo = new AgentRepository(this.db)
    return repo.get(agentId ?? 'platform-manager-agent') ?? repo.get('platform-manager-agent') ?? {
      id: 'platform-manager-agent',
      name: '平台管理',
      description: '系统内置平台管理智能体',
      builtIn: true,
      enabled: true,
      isDefault: true,
      providerProfileId: null,
      modelId: null,
      agentAdapter: 'claude-sdk',
      permissionMode: 'claude-ask',
      reasoningEffort: 'max',
      prompt: '',
      ruleIds: [],
      skillIds: [],
      disabledSkillIds: [],
      mcpServerIds: [],
      hookConfig: {},
      workflowId: null,
      metadata: {},
      createdAt: new Date(0).toISOString(),
      updatedAt: new Date(0).toISOString(),
    }
  }

  // ── Team Mode (A2A) ────────────────────────────────────────────────────────

  /** 解析会话启用的成员 Agent（排除 Host 自身、不存在或已禁用的 Agent） */
  private resolveTeamMembers(memberAgentIds: string[], hostAgentId: string): AgentItem[] {
    const repo = new AgentRepository(this.db)
    const members: AgentItem[] = []
    for (const id of memberAgentIds) {
      if (id === hostAgentId) continue
      const agent = repo.get(id)
      if (agent != null && agent.enabled) members.push(agent)
    }
    return members
  }

  /** 构建 spark_team in-process MCP server（agent_dispatch 工具）。SDK 不可用时返回 null。 */
  private async createTeamMcpServer(ctx: {
    sessionId: string
    turnId: string
    hostAgent: AgentItem
    members: AgentItem[]
    teamConfig: TeamModeConfig
    workspaceRootPath: string
    eventRepo: EventRepository
    /** 本层 dispatch 的深度（Host=0，嵌套时递增） */
    currentDepth?: number
    /** 宿主会话的生效权限模式：宿主选 bypass/full-access 时，成员同样完全放行（用户已信任整个会话）。 */
    hostPermissionMode?: SessionPermissionMode
  }): Promise<SDKMcpServerConfig | null> {
    const factory = await loadSdkMcpFactory()
    if (factory == null) return null
    const { createSdkMcpServer, tool } = factory

    // 单次 dispatch 的实际执行：构造 task 并交给 TeamDispatchService。
    // parallel=true 时绕过 turn 串行队列，由 batch 工具使用。
    const runSingleDispatch = async (
      args: Record<string, unknown>,
      parallel = false,
    ): Promise<import('@spark/protocol').TeamA2AReply> => {
      const task: TeamA2ATask = {
        taskId: crypto.randomUUID(),
        hostAgentId: ctx.hostAgent.id,
        memberAgentId: String(args.targetAgentId ?? ''),
        rootTurnId: ctx.turnId,
        instruction: String(args.instruction ?? ''),
        ...(args.inputs != null ? { inputs: args.inputs as Record<string, unknown> } : {}),
        ...(Array.isArray(args.attachments)
          ? { attachments: args.attachments as NonNullable<TeamA2ATask['attachments']> }
          : {}),
        ...(args.expectedOutput != null
          ? { expectedOutput: args.expectedOutput as NonNullable<TeamA2ATask['expectedOutput']> }
          : {}),
        ...(typeof args.timeoutMs === 'number' ? { timeoutMs: args.timeoutMs } : {}),
      }
      return this.getTeamDispatchService().run(
        task,
        {
          sessionId: ctx.sessionId,
          turnId: ctx.turnId,
          hostAgentId: ctx.hostAgent.id,
          members: ctx.members,
          teamConfig: ctx.teamConfig,
          currentDepth: ctx.currentDepth ?? 0,
          emitEvent: (event) => this.emitAndPersist(ctx.sessionId, ctx.turnId, event, ctx.eventRepo),
          executeMember: ({ member, task: memberTask, dispatchId, signal, memberDepth }) =>
            this.executeMemberTurn({
              member,
              task: memberTask,
              dispatchId,
              sessionId: ctx.sessionId,
              turnId: ctx.turnId,
              workspaceRootPath: ctx.workspaceRootPath,
              eventRepo: ctx.eventRepo,
              signal,
              memberDepth,
              members: ctx.members,
              teamConfig: ctx.teamConfig,
              ...(ctx.hostPermissionMode != null
                ? { hostPermissionMode: ctx.hostPermissionMode }
                : {}),
            }),
        },
        { parallel },
      )
    }

    // 单次 dispatch 工具：串行场景（前一结果决定下一步）
    const dispatchTool = tool(
      'agent_dispatch',
      TEAM_DISPATCH_TOOL_DESCRIPTION,
      {
        targetAgentId: z.string().describe('One of the team member IDs visible to you. Use the exact id.'),
        instruction: z.string().max(8000).describe('Clear, self-contained description of what the member should do.'),
        inputs: z.record(z.unknown()).optional(),
        attachments: z
          .array(z.object({ type: z.enum(['text', 'file_ref', 'image_ref']), value: z.string() }))
          .max(10)
          .optional(),
        expectedOutput: z.enum(['text', 'json', 'code', 'mixed']).optional(),
        timeoutMs: z.number().int().min(5000).max(600_000).optional(),
      } as Record<string, unknown>,
      async (args: Record<string, unknown>) => {
        const reply = await runSingleDispatch(args)
        return {
          content: [{ type: 'text' as const, text: formatReplyForHost(reply) }],
          structuredContent: reply as unknown,
        }
      },
    )

    // 批量 dispatch 工具：并行场景（多个相互独立的任务）
    const dispatchBatchTool = tool(
      'agent_dispatch_batch',
      TEAM_DISPATCH_BATCH_TOOL_DESCRIPTION,
      {
        dispatches: z
          .array(
            z.object({
              targetAgentId: z.string(),
              instruction: z.string().max(8000),
              inputs: z.record(z.unknown()).optional(),
              attachments: z
                .array(z.object({ type: z.enum(['text', 'file_ref', 'image_ref']), value: z.string() }))
                .max(10)
                .optional(),
              expectedOutput: z.enum(['text', 'json', 'code', 'mixed']).optional(),
              timeoutMs: z.number().int().min(5000).max(600_000).optional(),
            }),
          )
          .min(1)
          .max(10)
          .describe('A list of independent tasks to run in parallel. Each item is one dispatch.'),
      } as Record<string, unknown>,
      async (args: Record<string, unknown>) => {
        const items = Array.isArray(args.dispatches) ? (args.dispatches as Array<Record<string, unknown>>) : []
        // parallel=true 绕过 turn 串行队列，items 真正并发执行；
        // Promise.allSettled 保证一个失败不影响其他（service.run 自身已把失败转 reply，几乎总 fulfilled）。
        const settled = await Promise.allSettled(items.map((item) => runSingleDispatch(item, true)))
        const replies = settled.map((s, index) =>
          s.status === 'fulfilled'
            ? s.value
            : ({
                taskId: crypto.randomUUID(),
                memberAgentId: String(items[index]?.targetAgentId ?? ''),
                state: 'failed' as const,
                content: '',
                error: { code: 'internal' as const, message: s.reason instanceof Error ? s.reason.message : String(s.reason) },
              } satisfies import('@spark/protocol').TeamA2AReply),
        )
        const text = replies
          .map((r, i) => `[${i + 1}/${replies.length}] ${formatReplyForHost(r)}`)
          .join('\n\n---\n\n')
        return {
          content: [{ type: 'text' as const, text }],
          structuredContent: { replies } as unknown,
        }
      },
    )

    return createSdkMcpServer({
      name: 'spark_team',
      version: '0.2.0',
      tools: [dispatchTool, dispatchBatchTool],
    }) as SDKMcpServerConfig
  }

  /** 用某个成员 Agent 的配置运行一次 one-shot turn，流式输出 rebrand 为 team_member_message。 */
  private async executeMemberTurn(args: {
    member: AgentItem
    task: TeamA2ATask
    dispatchId: string
    sessionId: string
    turnId: string
    workspaceRootPath: string
    eventRepo: EventRepository
    signal: AbortSignal
    /** member 自身 dispatch 的深度（用于嵌套判定） */
    memberDepth: number
    members: AgentItem[]
    teamConfig: TeamModeConfig
    /** 宿主会话的生效权限模式（用于成员继承 bypass/full-access） */
    hostPermissionMode?: SessionPermissionMode
  }): Promise<TeamMemberExecutionResult> {
    const { member, task, dispatchId, sessionId, turnId, workspaceRootPath, eventRepo, signal, memberDepth, members, teamConfig, hostPermissionMode } =
      args

    // 团队模式下成员权限固定为 auto：会话框的权限切换只对 host 生效，成员一律使用自动放行
    // 策略（自动接受编辑、不向用户弹审批窗），避免多成员并发时审批窗互相打断。成员统一经
    // ClaudeSDKExecutor 执行，故取 claude-auto。
    // hostIsFullAccess 仅保留用于向下层嵌套团队透传“宿主已完全放行”标记（见下方 nestedTeamServer）。
    const hostIsFullAccess =
      hostPermissionMode === 'claude-bypass' || hostPermissionMode === 'codex-full-access'
    const effectiveMemberMode = 'claude-auto' as SDKExecutorConfig['permissionMode']

    // 解析 member 的 provider/apiKey/model；member 未配置 provider 时回落到会话 provider。
    const sessionRepo = new SessionRepository(this.db)
    const providerRepo = new ProviderProfileRepository(this.db)
    const session = sessionRepo.findByIdOrFail(sessionId)
    const providerProfileId = member.providerProfileId ?? session.provider_profile_id
    if (providerProfileId == null) throw new Error('Member has no provider profile and session has none')
    const provider = providerRepo.get(providerProfileId)
    if (provider?.keystore_ref == null) throw new Error('Member provider has no keystore ref')
    const apiKey = await keystore.getSecret(provider.keystore_ref as keystore.KeystoreRef)
    if (apiKey == null) throw new Error('Member provider API key not found')
    const providerConfig = JSON.parse(provider.config_json) as {
      defaultModel?: string
      model?: string
      apiEndpoint?: string
      haikuModel?: string
      sonnetModel?: string
      opusModel?: string
    }
    const model = (member.modelId ?? providerConfig.defaultModel ?? providerConfig.model ?? '').trim()
    if (!model) throw new Error('Member has no resolvable model')

    // 团队成员运行在同一会话内，沿用 host 会话/项目级自定义环境变量：注入真实值供其工具引用，
    // 并把脱敏清单追加进成员系统提示词，避免成员泄露敏感信息。
    let memberCustomEnv: Record<string, string> | undefined
    let memberEnvPrompt = ''
    try {
      const memberWorkspaceIds = new SessionRepository(this.db).getWorkspaceIds(sessionId)
      const envConfig = new RuntimeCompositionService(
        new SkillRepository(this.db),
        new SettingsRepository(this.db),
      ).getEnvConfig({
        ...(memberWorkspaceIds[0] != null ? { workspaceId: memberWorkspaceIds[0] } : {}),
        sessionId,
      })
      if (Object.keys(envConfig.effectiveEnv).length > 0) memberCustomEnv = envConfig.effectiveEnv
      memberEnvPrompt = envConfig.envSystemPrompt
    } catch (err) {
      log.warn(`Member env injection failed (non-fatal): ${err instanceof Error ? err.message : String(err)}`)
    }
    const memberSystemPrompt =
      joinPromptSections(buildManagedAgentSystemPrompt(member, null), memberEnvPrompt || undefined) ?? ''
    const userMessage = buildMemberUserMessage(task)
    // Claude Code SDK 要求 session_id 必须是合法 UUID，给每次 dispatch 全新 UUID
    // 避免与 Host 的 SDK session 冲突；member 不需要跨 dispatch 续会话。
    const memberSdkSessionId = crypto.randomUUID()

    // Member 自身的 MCP 工具
    const memberMcpServers = this.buildMcpServersForSDK(getAllowedMcpServerIds(member, null))
    // 内置联网搜索对团队成员同样默认挂载
    const memberWebSearchServer = await this.resolveWebSearchMcpServer(workspaceRootPath)
    if (memberWebSearchServer != null) memberMcpServers.spark_search = memberWebSearchServer
    // 嵌套：仅当 allowNesting 且 member 的 dispatch 深度仍 < maxDepth 时，给 member 注入
    // spark_team 工具（深度 = memberDepth），使其可再调用下一层成员。
    let nestedTeamServer: SDKMcpServerConfig | undefined
    if (teamConfig.allowNesting && memberDepth < teamConfig.maxDepth) {
      nestedTeamServer =
        (await this.createTeamMcpServer({
          sessionId,
          turnId,
          hostAgent: member,
          members,
          teamConfig,
          workspaceRootPath,
          eventRepo,
          currentDepth: memberDepth,
          ...(hostIsFullAccess && hostPermissionMode != null
            ? { hostPermissionMode }
            : {}),
        })) ?? undefined
      if (nestedTeamServer != null) memberMcpServers.spark_team = nestedTeamServer
    }

    const sdkConfig: SDKExecutorConfig = {
      apiKey,
      model,
      workspaceRootPath,
      permissionMode: effectiveMemberMode,
      ...(providerConfig.apiEndpoint != null ? { apiEndpoint: providerConfig.apiEndpoint } : {}),
      ...(providerConfig.haikuModel != null ? { haikuModel: providerConfig.haikuModel } : {}),
      ...(providerConfig.sonnetModel != null ? { sonnetModel: providerConfig.sonnetModel } : {}),
      ...(providerConfig.opusModel != null ? { opusModel: providerConfig.opusModel } : {}),
      ...(memberSystemPrompt.trim().length > 0 ? { systemPrompt: memberSystemPrompt } : {}),
      ...(memberCustomEnv != null ? { customEnv: memberCustomEnv } : {}),
      ...(Object.keys(memberMcpServers).length > 0 ? { mcpServers: memberMcpServers } : {}),
      // 嵌套时预批准 dispatch 工具（含内置搜索）；始终禁用内置 Task（§7.4）。
      ...(nestedTeamServer != null
        ? { allowedTools: ['mcp__spark_team__agent_dispatch', 'mcp__spark_team__agent_dispatch_batch', ...SEARCH_TOOL_NAMES] }
        : {}),
      disallowedTools: ['Task'],
      enableCheckpoints: false,
      sdkSessionId: memberSdkSessionId,
      continueSession: false,
      ...(this.onApproval != null
        ? {
            approvalCallback: async (
              sid: string,
              toolName: string,
              toolInput: Record<string, unknown>,
            ) => {
              this.emitAgentStatusEvent(sid, turnId, eventRepo, 'waiting_permission')
              try {
                return await this.onApproval!(sid, toolName, toolInput)
              } finally {
                this.emitAgentStatusEvent(sid, turnId, eventRepo, 'thinking')
              }
            },
          }
        : {}),
      ...(this.onQuestion != null
        ? {
            questionCallback: async (sid: string, questions: UserQuestionPrompt[]) => {
              this.emitAgentStatusEvent(sid, turnId, eventRepo, 'waiting_user')
              try {
                return await this.onQuestion!(sid, questions)
              } finally {
                this.emitAgentStatusEvent(sid, turnId, eventRepo, 'thinking')
              }
            },
          }
        : {}),
    }

    const executor = new ClaudeSDKExecutor()
    const onAbort = () => executor.cancel()
    signal.addEventListener('abort', onAbort)

    // 按 segment 收集 member 多段正文（被工具调用分隔的每段文本）。
    // 给 Host 的最终 content 拼接所有段，避免最后一段 result 覆盖前面段。
    const segments: Array<{ id: string | undefined; text: string }> = []
    let finalResultText = ''
    let deltaText = ''
    let inputTokens: number | undefined
    let outputTokens: number | undefined
    let memberError: string | undefined
    const makeBase = () => ({
      id: crypto.randomUUID(),
      sessionId,
      turnId,
      timestamp: new Date().toISOString(),
      seq: 0,
    })
    executor.onEvent((event) => {
      if (event.type === 'assistant_message') {
        this.emitAndPersist(
          sessionId,
          turnId,
          {
            ...makeBase(),
            type: 'team_member_message',
            dispatchId,
            memberAgentId: member.id,
            mode: event.mode,
            content: event.content,
            isFinal: event.isFinal,
            // 透传 segmentId：让 UI/历史按段聚合 member 的多段正文（与 Host 一致）
            ...(event.segmentId != null ? { segmentId: event.segmentId } : {}),
          },
          eventRepo,
        )
        if (event.mode === 'complete') {
          if (event.isFinal) {
            finalResultText = event.content
          } else if (event.content.length > 0) {
            const existing =
              event.segmentId != null ? segments.find((s) => s.id === event.segmentId) : undefined
            if (existing) existing.text = event.content
            else segments.push({ id: event.segmentId, text: event.content })
          }
        } else if (event.mode === 'delta') deltaText += event.content
      } else if (event.type === 'usage_update') {
        inputTokens = event.inputTokens
        outputTokens = event.outputTokens
      } else if (event.type === 'agent_error') {
        memberError = event.message
      } else if (
        event.type === 'tool_call' ||
        event.type === 'tool_result' ||
        event.type === 'file_change' ||
        event.type === 'terminal_output'
      ) {
        // 透传时重写 base 字段（seq 由 emitAndPersist 覆盖），保留原事件 payload
        this.emitAndPersist(
          sessionId,
          turnId,
          {
            ...event,
            sessionId,
            turnId,
            seq: 0,
            teamMemberContext: { dispatchId, memberAgentId: member.id },
          },
          eventRepo,
        )
      }
    })

    let aborted = false
    try {
      // 第二参数是 Spark 内部 turnId（仅用于 executor 内部日志/事件归属），不传给 SDK；
      // 用全新 UUID 避免与 Host 的 turnId 冲突（emit 时仍用 host turnId，见 makeBase）。
      await executor.executeTurn(sessionId, crypto.randomUUID(), userMessage, sdkConfig)
    } catch (err) {
      // 被超时/取消（signal abort）打断：不抛错，回传已累积的部分产出（partial）。
      // 真实执行错误才向上抛出，交由 TeamDispatchService 标记 failed。
      if (!signal.aborted) throw err
      aborted = true
    } finally {
      signal.removeEventListener('abort', onAbort)
    }

    // 优先拼接各段正文；无分段（result-only / 纯 delta provider）时依次回落。
    const segmentText = segments
      .map((s) => s.text)
      .filter((t) => t.trim().length > 0)
      .join('\n\n')
    const content = segmentText || finalResultText || deltaText

    // 真实错误（非 abort）才抛；abort 即便伴随 memberError 也走 partial 返回。
    if (memberError != null && !aborted) {
      throw new Error(memberError)
    }
    return {
      content,
      ...(aborted ? { partial: true } : {}),
      ...(inputTokens != null ? { inputTokens } : {}),
      ...(outputTokens != null ? { outputTokens } : {}),
    }
  }

  private usageLedgerKey(sessionId: string, turnId: string): string {
    return `${sessionId}:${turnId}`
  }

  private clearUsageLedgerTurnState(sessionId: string, turnId?: string): void {
    if (turnId != null) {
      this.usageLedgerLastByTurn.delete(this.usageLedgerKey(sessionId, turnId))
      return
    }
    const prefix = `${sessionId}:`
    for (const key of this.usageLedgerLastByTurn.keys()) {
      if (key.startsWith(prefix)) this.usageLedgerLastByTurn.delete(key)
    }
  }

  private recordUsageUpdate(sessionId: string, turnId: string, event: Extract<AgentEvent, { type: 'usage_update' }>): void {
    const key = this.usageLedgerKey(sessionId, turnId)
    const prev = this.usageLedgerLastByTurn.get(key) ?? { inputTokens: 0, outputTokens: 0, cacheHitTokens: 0, estimatedCostUsd: 0 }
    const current = {
      inputTokens: Math.max(0, event.inputTokens),
      outputTokens: Math.max(0, event.outputTokens),
      cacheHitTokens: Math.max(0, event.cacheHitTokens ?? 0),
      estimatedCostUsd: Math.max(0, event.estimatedCostUsd ?? 0),
    }
    this.usageLedgerLastByTurn.set(key, current)

    const inputTokens = Math.max(0, current.inputTokens - prev.inputTokens)
    const outputTokens = Math.max(0, current.outputTokens - prev.outputTokens)
    const cacheReadTokens = Math.max(0, current.cacheHitTokens - prev.cacheHitTokens)
    const costUsd = Math.max(0, current.estimatedCostUsd - prev.estimatedCostUsd)
    if (inputTokens === 0 && outputTokens === 0 && cacheReadTokens === 0 && costUsd === 0) return

    try {
      const session = new SessionRepository(this.db).get(sessionId)
      const providerId = session?.provider_profile_id ?? event.provider
      const modelId = event.model || session?.model_id || 'unknown'
      new UsageLedgerRepository(this.db).record({
        sessionId,
        providerId,
        modelId,
        inputTokens,
        outputTokens,
        cacheReadTokens,
        costUsd,
        requestTimestamp: event.timestamp,
      })
    } catch {
      // Non-fatal: usage dashboard data must not interrupt chat event streaming.
    }
  }

  private emitAndPersist(
    sessionId: string,
    turnId: string,
    event: AgentEvent,
    eventRepo: EventRepository,
  ): void {
    const seq = this.seqCounters.get(sessionId) ?? 0
    this.seqCounters.set(sessionId, seq + 1)
    const sequenced = { ...event, seq }
    this.onEvent(sequenced)
    if (event.type === 'usage_update') {
      this.recordUsageUpdate(sessionId, turnId, event)
    }
    try {
      eventRepo.insert({
        id: sequenced.id,
        sessionId,
        turnId,
        eventType: sequenced.type,
        eventJson: JSON.stringify(sequenced),
      })
    } catch {
      // Non-fatal: persistence failure should not crash the stream
    }

    // 触发 hook：检测 agent_status 事件的关键状态变化
    if (event.type === 'agent_status') {
      const status = event.status
      if (status === 'completed') {
        this.onHookTrigger?.(sessionId, 'session_end', {
          title: 'Spark Agent - 任务完成',
          body: '当前任务已完成',
        })
      } else if (status === 'error') {
        this.onHookTrigger?.(sessionId, 'session_fail', {
          title: 'Spark Agent - 任务失败',
          body: event.message ?? '任务执行出错，请检查',
        })
      } else if (status === 'waiting_user') {
        this.onHookTrigger?.(sessionId, 'ask_user_question', {
          title: 'Spark Agent - 需要您的输入',
          body: event.message ?? 'Agent 需要您提供更多信息',
        })
      }
      if (TERMINAL_AGENT_STATUSES.has(status)) {
        this.clearUsageLedgerTurnState(sessionId, turnId)
      }
    }
  }

  /**
   * 发送瞬态 agent_status 事件（waiting_user / waiting_permission / thinking 等），
   * 经 emitAndPersist 走统一的序列化、持久化与 hook 触发通路——这样 waiting_user
   * 既会点亮侧边栏状态符，也会触发 ask_user_question 桌面通知 hook。
   * 用于 executor 阻塞等待用户作答/授权时点亮会话状态。
   */
  private emitAgentStatusEvent(
    sessionId: string,
    turnId: string,
    eventRepo: EventRepository,
    status: AgentStatusEvent['status'],
    message?: string,
  ): void {
    const event: AgentStatusEvent = {
      id: crypto.randomUUID(),
      type: 'agent_status',
      sessionId,
      turnId,
      timestamp: new Date().toISOString(),
      seq: 0,
      status,
      ...(message != null ? { message } : {}),
    }
    this.emitAndPersist(sessionId, turnId, event, eventRepo)
  }

  /**
   * Clean up resources held by SessionService (platform bridge, etc.).
   * Call on application shutdown.
   */
  async dispose(): Promise<void> {
    await this.platformBridge.stop()
  }

  getQueueState(params: { sessionId: string }): SessionGetQueueResponse {
    return this.queueSnapshot(params.sessionId)
  }

  cancelQueuedTurn(params: { sessionId: string; turnId: string }): SessionCancelQueuedTurnResponse {
    const queue = this.pendingTurns.get(params.sessionId) ?? []
    const nextQueue = queue.filter((turn) => turn.turnId !== params.turnId)
    const cancelled = nextQueue.length !== queue.length
    if (nextQueue.length === 0) this.pendingTurns.delete(params.sessionId)
    else this.pendingTurns.set(params.sessionId, nextQueue)
    if (cancelled) this.emitQueueChanged(params.sessionId)
    return {
      cancelled,
      queuedTurns: this.queueSnapshot(params.sessionId).queuedTurns,
    }
  }

  /**
   * 立即执行队列中的某个 turn：中断当前任务，将该 turn 提到最前面执行，其余排队保持原序。
   * 上下文（会话历史事件）天然保留在 DB 中，新 turn 的 startTurn 会正常读取。
   */
  async sendQueuedTurnNow(params: { sessionId: string; turnId: string }): Promise<SessionSendQueuedTurnNowResponse> {
    const { sessionId, turnId } = params
    const queue = this.pendingTurns.get(sessionId) ?? []
    const targetIdx = queue.findIndex((t) => t.turnId === turnId)
    if (targetIdx === -1) {
      return { started: false, queuedTurns: this.queueSnapshot(sessionId).queuedTurns }
    }
    const targetTurn = queue.splice(targetIdx, 1)[0]!

    // 没有正在执行的任务 → 直接启动
    if (!this.activeLoops.has(sessionId)) {
      if (queue.length === 0) this.pendingTurns.delete(sessionId)
      else this.pendingTurns.set(sessionId, queue)
      this.pendingPlanApprovals.delete(sessionId)
      this.emitQueueChanged(sessionId)
      await this.startTurn(
        sessionId,
        targetTurn.turnId,
        targetTurn.message,
        targetTurn.runtimePatch,
        targetTurn.skillId,
        targetTurn.skillParams,
        targetTurn.attachments,
        targetTurn.mentionAgentId,
      )
      return { started: true, queuedTurns: this.queueSnapshot(sessionId).queuedTurns }
    }

    // 中断当前正在执行的任务（不清理队列）
    const loop = this.activeLoops.get(sessionId)!
    this.onApprovalCancel?.(sessionId)
    this.teamDispatchService?.cancelAll()
    loop.cancel()
    this.activeLoops.delete(sessionId)

    // 将目标 turn 放回队首，其余保持原序
    queue.unshift(targetTurn)
    this.pendingTurns.set(sessionId, queue)
    this.pendingPlanApprovals.delete(sessionId)

    const sessionRepo = new SessionRepository(this.db)
    sessionRepo.updateStatus(sessionId, 'idle')

    // 队首 turn 立即启动（旧 executor 的 finally 里 activeLoops 已删除，
    // 其 startNextQueuedTurn 不会重复触发）
    this.startNextQueuedTurn(sessionId)
    return { started: true, queuedTurns: this.queueSnapshot(sessionId).queuedTurns }
  }

  private enqueueTurn(sessionId: string, turn: PendingTurn): void {
    const queue = this.pendingTurns.get(sessionId) ?? []
    queue.push(turn)
    this.pendingTurns.set(sessionId, queue)
    this.emitQueueChanged(sessionId)
  }

  private makePendingTurn(
    turnId: string,
    message: string,
    runtimePatch?: SessionRuntimePatch,
    skillId?: string,
    skillParams?: Record<string, unknown>,
    attachments?: SessionAttachment[],
    mentionAgentId?: string,
  ): PendingTurn {
    return {
      turnId,
      message,
      enqueuedAt: new Date().toISOString(),
      ...(attachments != null && attachments.length > 0 ? { attachments } : {}),
      ...(runtimePatch != null ? { runtimePatch } : {}),
      ...(skillId != null ? { skillId } : {}),
      ...(skillParams != null ? { skillParams } : {}),
      ...(mentionAgentId != null ? { mentionAgentId } : {}),
    }
  }

  private startNextQueuedTurn(sessionId: string): void {
    // Plan 模式审批未完成前，队列暂停自动起跑：用户必须先批准/拒绝/切换权限模式，
    // 否则后续 turn 会跨越审批弹窗自行执行，破坏用户预期。
    if (this.pendingPlanApprovals.has(sessionId)) {
      this.emitQueueChanged(sessionId)
      return
    }
    const queue = this.pendingTurns.get(sessionId)
    const next = queue?.shift()
    if (queue == null || next == null) {
      this.pendingTurns.delete(sessionId)
      this.emitQueueChanged(sessionId)
      return
    }
    if (queue.length === 0) this.pendingTurns.delete(sessionId)
    this.emitQueueChanged(sessionId)
    void this.startTurn(
      sessionId,
      next.turnId,
      next.message,
      next.runtimePatch,
      next.skillId,
      next.skillParams,
      next.attachments,
      next.mentionAgentId,
    )
  }

  private queueSnapshot(sessionId: string): SessionGetQueueResponse {
    return {
      sessionId: sessionId as SessionId,
      running: this.activeLoops.has(sessionId),
      queuedTurns: this.toQueuedTurns(this.pendingTurns.get(sessionId) ?? []),
    }
  }

  private toQueuedTurns(turns: PendingTurn[]): SessionQueuedTurn[] {
    return turns.map((turn) => ({
      turnId: turn.turnId,
      message: turn.message,
      enqueuedAt: turn.enqueuedAt,
      ...(turn.attachments != null ? { attachments: turn.attachments } : {}),
    }))
  }

  private emitQueueChanged(sessionId: string): void {
    this.onQueueChanged?.(this.queueSnapshot(sessionId))
  }

  /**
   * `/approval on|off` 的实现：直接改写会话的 permission_mode（唯一权威），
   * 而不是维护一个会与下拉选择冲突的并行 override 开关。
   *   - off → 完全放行（claude-bypass / codex-full-access）
   *   - on  → 逐次审批（claude-ask / codex-default）
   * 适配器按当前 stored mode 的前缀判断，避免再查 agent 配置。
   * updateSession 会同时持久化并热切换正在运行的 executor。
   */
  private applyApprovalToggle(sessionId: string, enabled: boolean): void {
    const sessionRepo = new SessionRepository(this.db)
    const isCodex = (sessionRepo.get(sessionId)?.permission_mode ?? '').startsWith('codex-')
    const mode: SessionPermissionMode = enabled
      ? isCodex
        ? 'codex-default'
        : 'claude-ask'
      : isCodex
        ? 'codex-full-access'
        : 'claude-bypass'
    void this.updateSession({ sessionId, permissionMode: mode }).catch((err) => {
      log.warn(`/approval toggle failed for ${sessionId}: ${String(err)}`)
    })
  }



  private async continueGoalOrQueue(sessionId: string): Promise<void> {
    const goal = new GoalRepository(this.db).getCurrent(sessionId)
    if (goal?.status === 'active') {
      await this.startGoalLoop(sessionId)
      return
    }
    this.startNextQueuedTurn(sessionId)
  }

  private updateGoalFromAssistantBlock(sessionId: string, content: string): void {
    const repo = new GoalRepository(this.db)
    const goal = repo.getCurrent(sessionId)
    if (goal == null || goal.status !== 'active') return
    const parsed = parseGoalStatusBlock(content)
    if (parsed == null) return
    const nextStatus: GoalStatus | 'continue' | 'blocked' = parsed.status === 'completed'
      ? 'completed'
      : parsed.status === 'failed'
        ? 'failed'
        : parsed.status === 'blocked'
          ? 'blocked'
          : 'continue'
    const progressPatch = {
      iteration: goal.progressLog.length + 1,
      phase: parsed.phase,
      status: nextStatus,
      summary: parsed.summary,
      ...(parsed.evidence != null ? { evidence: parsed.evidence } : {}),
      ...(parsed.nextStep != null ? { nextStep: parsed.nextStep } : {}),
    }
    const updated = repo.appendProgress(goal.id, progressPatch) ?? goal
    this.emitGoalEvent(sessionId, updated, 'goal_progress', 'active', parsed.summary, {
      phase: parsed.phase,
      ...(parsed.evidence != null ? { evidence: parsed.evidence } : {}),
      ...(parsed.nextStep != null ? { nextStep: parsed.nextStep } : {}),
    })
    if (parsed.status === 'completed') {
      const done = repo.updateStatus(goal.id, 'completed') ?? updated
      this.emitGoalEvent(sessionId, done, 'goal_completed', 'completed', parsed.summary)
    } else if (parsed.status === 'failed') {
      const failed = repo.updateStatus(goal.id, 'failed', { lastError: parsed.summary }) ?? updated
      this.emitGoalEvent(sessionId, failed, 'goal_failed', 'failed', parsed.summary)
    } else if (parsed.status === 'blocked') {
      const paused = repo.updateStatus(goal.id, 'paused', { lastError: parsed.summary }) ?? updated
      this.emitGoalEvent(sessionId, paused, 'goal_paused', 'paused', parsed.summary)
    }
  }

  getGoal(sessionId: string): SessionGoalResponse {
    return { goal: toProtocolGoal(new GoalRepository(this.db).getCurrent(sessionId)) }
  }

  async setGoal(params: {
    sessionId: string
    objective: string
    successCriteria?: string[]
    constraints?: string[]
    validation?: { commands?: string[]; checklist?: string[] }
    budget?: { maxIterations?: number; maxRuntimeMinutes?: number; maxBudgetUsd?: number; maxConsecutiveFailures?: number; noProgressLimit?: number }
    mode?: 'spark-loop' | 'codex-native' | 'auto'
  }): Promise<SessionGoalResponse> {
    const repo = new GoalRepository(this.db)
    const session = new SessionRepository(this.db).get(params.sessionId)
    const mode = params.mode === 'codex-native' || (params.mode === 'auto' && session?.agent_adapter === 'codex') ? 'codex-native' : 'spark-loop'
    const goal = repo.createOrReplaceActiveGoal({
      sessionId: params.sessionId,
      objective: params.objective.trim(),
      successCriteria: params.successCriteria ?? [],
      constraints: params.constraints ?? [],
      validation: params.validation ?? {},
      budget: params.budget ?? { maxIterations: 12, maxConsecutiveFailures: 3, noProgressLimit: 3 },
      mode,
    })
    this.emitGoalEvent(params.sessionId, goal, 'goal_started', 'active', 'Goal started')
    await this.startGoalLoop(params.sessionId)
    return { goal: toProtocolGoal(goal) }
  }

  async controlGoal(params: { sessionId: string; action: 'pause' | 'resume' | 'clear' | 'complete'; summary?: string }): Promise<SessionGoalResponse> {
    const repo = new GoalRepository(this.db)
    const goal = repo.getCurrent(params.sessionId)
    if (goal == null) return { goal: null }
    if (params.action === 'pause') {
      const updated = repo.updateStatus(goal.id, 'paused')
      this.emitGoalEvent(params.sessionId, updated ?? goal, 'goal_paused', 'paused', params.summary ?? 'Goal paused')
      return { goal: toProtocolGoal(updated) }
    }
    if (params.action === 'resume') {
      const updated = repo.updateStatus(goal.id, 'active')
      this.emitGoalEvent(params.sessionId, updated ?? goal, 'goal_resumed', 'active', params.summary ?? 'Goal resumed')
      await this.startGoalLoop(params.sessionId)
      return { goal: toProtocolGoal(updated) }
    }
    if (params.action === 'complete') {
      const updated = repo.updateStatus(goal.id, 'completed')
      this.emitGoalEvent(params.sessionId, updated ?? goal, 'goal_completed', 'completed', params.summary ?? 'Goal completed')
      return { goal: toProtocolGoal(updated) }
    }
    this.activeLoops.get(params.sessionId)?.cancel()
    const updated = repo.clearCurrent(params.sessionId)
    this.emitGoalEvent(params.sessionId, updated ?? goal, 'goal_cleared', 'cleared', params.summary ?? 'Goal cleared')
    return { goal: toProtocolGoal(updated) }
  }

  private async startGoalLoop(sessionId: string): Promise<void> {
    const repo = new GoalRepository(this.db)
    const goal = repo.getCurrent(sessionId)
    if (goal == null || goal.status !== 'active') return
    if (this.activeLoops.has(sessionId)) return
    const budget = goal.budget ?? {}
    const maxIterations = budget.maxIterations ?? 12
    if (goal.progressLog.length >= maxIterations) {
      const stopped = repo.updateStatus(goal.id, 'stopped_by_budget') ?? goal
      this.emitGoalEvent(sessionId, stopped, 'goal_budget_stopped', 'stopped_by_budget', `Goal stopped after ${maxIterations} iterations.`)
      return
    }
    const turnId = crypto.randomUUID()
    const prompt = buildGoalIterationPrompt(goal)
    repo.appendProgress(goal.id, {
      iteration: goal.progressLog.length + 1,
      phase: 'review',
      status: 'continue',
      summary: 'Started review/act/validate iteration.',
      nextStep: 'Agent is working on the next verifiable step.',
    })
    this.emitGoalEvent(sessionId, goal, 'goal_progress', 'active', 'Started next Goal iteration', { phase: 'review' })
    await this.startTurn(sessionId, turnId, prompt)
  }

  private emitGoalEvent(
    sessionId: string,
    goal: StoredSessionGoal,
    type: 'goal_started' | 'goal_progress' | 'goal_paused' | 'goal_resumed' | 'goal_completed' | 'goal_failed' | 'goal_cleared' | 'goal_budget_stopped',
    status: GoalStatus,
    summary: string,
    extra: Partial<GoalProgressEntry> = {},
  ): void {
    const eventRepo = new EventRepository(this.db)
    const turnId = crypto.randomUUID()
    this.emitAndPersist(sessionId, turnId, {
      id: crypto.randomUUID(),
      type,
      sessionId,
      turnId,
      timestamp: new Date().toISOString(),
      seq: 0,
      goalId: goal.id,
      objective: goal.objective,
      status,
      iteration: goal.progressLog.length,
      summary,
      ...(extra.phase != null ? { phase: extra.phase } : {}),
      ...(extra.evidence != null ? { evidence: extra.evidence } : {}),
      ...(extra.nextStep != null ? { nextStep: extra.nextStep } : {}),
      ...(extra.validation != null ? { validation: extra.validation } : {}),
      budget: goal.budget as Record<string, unknown>,
    }, eventRepo)
  }

  /**
   * 为指定 session 设置临时的 maxTurnIterations 上限。
   * 用于 UI「调高迭代上限」按钮 / `/setiter` 命令。
   * 传入 null 清除 override。
   */
  setMaxIterations(sessionId: string, max: number | null): void {
    if (max == null) {
      this.iterationOverrides.delete(sessionId)
      return
    }
    if (!Number.isFinite(max) || max < 1 || max > 1000) {
      throw new Error(`maxTurnIterations must be 1~1000, got ${max}`)
    }
    this.iterationOverrides.set(sessionId, Math.floor(max))
  }

  async cancelTurn(sessionId: string): Promise<{ cancelled: boolean }> {
    const loop = this.activeLoops.get(sessionId)
    this.pendingPlanApprovals.delete(sessionId)
    // 先取消挂起的 approval（如果 agent 正卡在用户审批弹窗上）
    this.onApprovalCancel?.(sessionId)
    // 取消所有进行中的 team dispatch（连同其 member 执行器）
    this.teamDispatchService?.cancelAll()
    if (loop == null) {
      this.emitQueueChanged(sessionId)
      return { cancelled: false }
    }
    loop.cancel()
    this.activeLoops.delete(sessionId)
    const sessionRepo = new SessionRepository(this.db)
    sessionRepo.updateStatus(sessionId, 'idle')
    // 终止当前任务后，自动执行队列中的下一个任务
    this.startNextQueuedTurn(sessionId)
    return { cancelled: true }
  }

  /**
   * Session 删除时调用：清理 session 相关的内存状态。
   * 由 deleteSession 内部调用，避免 long-lived 进程内存泄漏。
   */
  private clearSessionMemory(sessionId: string): void {
    this.activeLoops.delete(sessionId)
    this.pendingTurns.delete(sessionId)
    this.pendingPlanApprovals.delete(sessionId)
    this.seqCounters.delete(sessionId)
    this.iterationOverrides.delete(sessionId)
    TodoStore.clear(sessionId)
    this.onApprovalCancel?.(sessionId)
    this.emitQueueChanged(sessionId)
  }

  async getHistory(params: {
    sessionId: string
    full?: boolean
    limit?: number
    turnLimit?: number
    beforeSeq?: number
  }): Promise<{ events: AgentEvent[]; hasMore: boolean }> {
    const eventRepo = new EventRepository(this.db)
    if (params.full === true) {
      const rows = eventRepo.queryAllBySession(params.sessionId)
      return {
        events: rows.map((row) => trimHistoryEvent(JSON.parse(row.event_json) as AgentEvent)),
        hasMore: false,
      }
    }
    // 按「轮次」分页（UI 历史加载首选）：每页都是完整轮次，永不把一个 agentic 轮次切碎，
    // 同时排除流式 delta、裁剪超大 prompt 快照，兼顾「完整查看」与「不卡顿」。
    if (params.turnLimit != null) {
      const { events: rows, hasMore } = eventRepo.queryRenderableTurns({
        sessionId: params.sessionId,
        turnLimit: params.turnLimit,
        ...(params.beforeSeq != null ? { beforeSeq: params.beforeSeq } : {}),
      })
      return {
        events: rows.map((row) => trimHistoryEvent(JSON.parse(row.event_json) as AgentEvent)),
        hasMore,
      }
    }
    // 事件级分页（其余调用方，如远程回复查找 / ProjectView 预览）：排除 delta 的最近 N 条。
    const { events: rows, hasMore } = eventRepo.queryRenderablePage({
      sessionId: params.sessionId,
      limit: params.limit ?? 80,
      ...(params.beforeSeq != null ? { beforeSeq: params.beforeSeq } : {}),
    })
    const events = rows.map((row) => trimHistoryEvent(JSON.parse(row.event_json) as AgentEvent))
    return { events, hasMore }
  }

  async listSessions(params?: {
    workspaceId?: string
    limit?: number
    offset?: number
    includeArchived?: boolean
  }): Promise<SessionListResponse> {
    const sessionRepo = new SessionRepository(this.db)
    const eventRepo = new EventRepository(this.db)
    const { sessions: rows, total } = sessionRepo.list(params ?? {})
    const sessions = rows.map((row) => ({
      id: row.id as SessionId,
      title: row.title,
      projectId: row.project_id,
      workspaceIds: sessionRepo.getWorkspaceIds(row.id),
      providerProfileId: row.provider_profile_id ?? '',
      modelId: row.model_id,
      agentId: row.agent_id ?? 'platform-manager-agent',
      agentAdapter: getAgentAdapterFromSession(row.agent_adapter, row.chat_mode, null),
      permissionMode: getPermissionModeFromSession(
        row.permission_mode,
        getAgentAdapterFromSession(row.agent_adapter, row.chat_mode, null),
      ),
      chatMode: getChatModeFromSession(row.chat_mode),
      reasoningEffort: normalizeReasoningEffort(row.reasoning_effort),
      status: row.status as 'idle' | 'running' | 'error',
      pinnedAt: row.pinned_at,
      archivedAt: row.archived_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      messageCount: eventRepo.countBySession(row.id),
      ...(getImportedFromMetadata(row.metadata_json) != null
        ? { importedFrom: getImportedFromMetadata(row.metadata_json)! }
        : {}),
      debugMode: getDebugModeFromMetadata(row.metadata_json),
    }))
    return { sessions, total }
  }

  /**
   * 搜索会话 — 按标题和消息内容模糊搜索
   *
   * 策略：
   *   1. 先按标题 LIKE 搜索
   *   2. 再按事件内容 LIKE 搜索
   *   3. 去重合并，标题匹配优先
   */
  async searchSessions(params: {
    query: string
    workspaceId?: string
    limit?: number
  }): Promise<SessionSearchResponse> {
    const { query, workspaceId, limit = 20 } = params
    const sessionRepo = new SessionRepository(this.db)
    const eventRepo = new EventRepository(this.db)

    const results: SessionSearchResponse['results'] = []
    const seenSessionIds = new Set<string>()

    // 1. Search by title
    const titleMatches = sessionRepo.searchByTitle(query, limit)
    for (const row of titleMatches) {
      // Filter by workspace if specified
      if (workspaceId != null) {
        const wsIds = sessionRepo.getWorkspaceIds(row.id)
        if (!wsIds.includes(workspaceId)) continue
      }
      seenSessionIds.add(row.id)
      results.push({
        sessionId: row.id as SessionId,
        title: row.title,
        snippet: '',
        matchType: 'title',
        updatedAt: row.updated_at,
      })
    }

    // 2. Search by event content
    const contentMatches = eventRepo.searchByContent(query, limit)
    for (const match of contentMatches) {
      if (seenSessionIds.has(match.sessionId)) continue
      if (results.length >= limit) break
      // Filter by workspace if specified
      if (workspaceId != null) {
        const wsIds = sessionRepo.getWorkspaceIds(match.sessionId)
        if (!wsIds.includes(workspaceId)) continue
      }
      // Get session title
      const session = sessionRepo.get(match.sessionId)
      if (session?.archived_at != null) continue
      results.push({
        sessionId: match.sessionId as SessionId,
        title: session?.title ?? 'Unknown Session',
        snippet: match.snippet,
        matchType: 'content',
        updatedAt: session?.updated_at ?? '',
      })
    }

    return { results }
  }

  async updateSession(params: {
    sessionId: string
    title?: string
    pinned?: boolean
    archived?: boolean
    providerProfileId?: string
    modelId?: string | null
    agentId?: string
    agentAdapter?: AgentAdapterKind
    permissionMode?: SessionPermissionMode
    chatMode?: 'agent' | 'ask' | 'edit' | 'review'
    reasoningEffort?: 'medium' | 'high' | 'xhigh' | 'max'
    debugMode?: boolean
  }): Promise<{ session: SessionListResponse['sessions'][number] }> {
    const sessionRepo = new SessionRepository(this.db)
    const eventRepo = new EventRepository(this.db)

    // 调试模式开关存 metadata（per-session 能力开关，不新增列），与 team 配置同策略。
    // 切换会改变 MCP 工具集（挂/卸 spark_debug），bump mcpVersion 让下一 turn 起新
    // SDK 会话以重新协商工具列表，避免沿用 SDK 冻结的旧快照。
    if (params.debugMode !== undefined) {
      sessionRepo.patchMetadata(params.sessionId, { debugMode: params.debugMode })
      this.mcpVersion += 1
    }

    if (params.title !== undefined) {
      sessionRepo.updateTitle(params.sessionId, params.title)
    }

    if (params.pinned !== undefined || params.archived !== undefined) {
      sessionRepo.updateLifecycle(params.sessionId, {
        ...(params.pinned !== undefined
          ? { pinnedAt: params.pinned ? new Date().toISOString() : null }
          : {}),
        ...(params.archived !== undefined
          ? { archivedAt: params.archived ? new Date().toISOString() : null }
          : {}),
      })
    }

    // 切换 permissionMode 通常意味着用户对 plan 模式审批弹窗做了选择
    // （批准会切到 claude-auto-edits）。此时解除闸门，让被阻塞的队列恢复推进。
    if (params.permissionMode !== undefined && this.pendingPlanApprovals.has(params.sessionId)) {
      this.pendingPlanApprovals.delete(params.sessionId)
      if (!this.activeLoops.has(params.sessionId)) {
        this.startNextQueuedTurn(params.sessionId)
      }
    }

    // Hot-swap: propagate permission-mode change to the running executor so it
    // takes effect on the very next tool call within the current turn.
    if (params.permissionMode !== undefined) {
      const active = this.activeLoops.get(params.sessionId)
      active?.setPermissionMode?.(params.permissionMode)
    }

    if (
      params.providerProfileId !== undefined ||
      params.modelId !== undefined ||
      params.agentId !== undefined ||
      params.agentAdapter !== undefined ||
      params.permissionMode !== undefined ||
      params.chatMode !== undefined ||
      params.reasoningEffort !== undefined
    ) {
      sessionRepo.updateRuntime(params.sessionId, {
        ...(params.providerProfileId !== undefined
          ? { providerProfileId: params.providerProfileId }
          : {}),
        ...(params.modelId !== undefined ? { modelId: params.modelId } : {}),
        ...(params.agentId !== undefined ? { agentId: params.agentId } : {}),
        ...(params.agentAdapter !== undefined ? { agentAdapter: params.agentAdapter } : {}),
        ...(params.permissionMode !== undefined ? { permissionMode: params.permissionMode } : {}),
        ...(params.chatMode !== undefined ? { chatMode: params.chatMode } : {}),
        ...(params.reasoningEffort !== undefined
          ? { reasoningEffort: params.reasoningEffort }
          : {}),
      })
    }

    const row = sessionRepo.findByIdOrFail(params.sessionId)
    return {
      session: {
        id: row.id as SessionId,
        title: row.title,
        projectId: row.project_id,
        workspaceIds: sessionRepo.getWorkspaceIds(row.id),
        providerProfileId: row.provider_profile_id ?? '',
        modelId: row.model_id,
        agentId: row.agent_id ?? 'platform-manager-agent',
        agentAdapter: getAgentAdapterFromSession(row.agent_adapter, row.chat_mode, null),
        permissionMode: getPermissionModeFromSession(
          row.permission_mode,
          getAgentAdapterFromSession(row.agent_adapter, row.chat_mode, null),
        ),
        chatMode: getChatModeFromSession(row.chat_mode),
      reasoningEffort: normalizeReasoningEffort(row.reasoning_effort),
        status: row.status as 'idle' | 'running' | 'error',
        pinnedAt: row.pinned_at,
        archivedAt: row.archived_at,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        messageCount: eventRepo.countBySession(row.id),
        debugMode: getDebugModeFromMetadata(row.metadata_json),
      },
    }
  }

  async getSessionRuntimeState(sessionId: string): Promise<Record<string, unknown>> {
    const sessionRepo = new SessionRepository(this.db)
    const row = sessionRepo.findByIdOrFail(sessionId)
    const providerRepo = new ProviderProfileRepository(this.db)
    const provider = providerRepo.get(row.provider_profile_id ?? '')
    let providerName = ''
    let providerType = ''
    let availableModels: string[] = []
    if (provider != null) {
      providerName = provider.name
      providerType = provider.provider_type
      try {
        const config = JSON.parse(provider.config_json) as { modelIds?: string[] }
        availableModels = config.modelIds ?? []
      } catch { /* ignore */ }
    }
    return {
      sessionId: row.id,
      title: row.title,
      providerProfileId: row.provider_profile_id ?? '',
      providerName,
      providerType,
      modelId: row.model_id,
      agentId: row.agent_id ?? '',
      agentAdapter: getAgentAdapterFromSession(row.agent_adapter, row.chat_mode, null),
      permissionMode: getPermissionModeFromSession(
        row.permission_mode,
        getAgentAdapterFromSession(row.agent_adapter, row.chat_mode, null),
      ),
      chatMode: getChatModeFromSession(row.chat_mode),
        reasoningEffort: normalizeReasoningEffort(row.reasoning_effort),
      debugMode: getDebugModeFromMetadata(row.metadata_json),
      status: row.status as 'idle' | 'running' | 'error',
      availableModels,
    }
  }

  async deleteSession(sessionId: string): Promise<{ deleted: boolean }> {
    const eventRepo = new EventRepository(this.db)
    const sessionRepo = new SessionRepository(this.db)
    this.clearSessionMemory(sessionId)
    eventRepo.deleteBySession(sessionId)
    return { deleted: sessionRepo.delete(sessionId) }
  }

  async clearEvents(sessionId: string): Promise<{ cleared: boolean }> {
    const eventRepo = new EventRepository(this.db)
    this.clearSessionMemory(sessionId)
    eventRepo.deleteBySession(sessionId)
    return { cleared: true }
  }

  async deleteMessage(sessionId: string, eventIds: string[]): Promise<{ deleted: number }> {
    const eventRepo = new EventRepository(this.db)
    const count = eventRepo.deleteEventsByIds(eventIds)
    return { deleted: count }
  }

  /**
   * 列出会话的所有还原点（代码检查点），最近在前。
   * 供 Checkpoint 时间线面板的「按会话撤回代码」视图使用。
   */
  listCheckpoints(sessionId: string): CheckpointSnapshot[] {
    const eventRepo = new EventRepository(this.db)
    // queryBySession 以 seq DESC 返回，即最近的还原点在前，符合时间线面板展示需要
    return listSessionCheckpointsFromEvents(eventRepo, sessionId)
  }
}

function shouldDeriveSessionTitle(title: string | null | undefined): boolean {
  const normalized = title?.trim() ?? ''
  return DEFAULT_SESSION_TITLES.has(normalized) || normalized.endsWith(' 会话')
}

function getLatestAgentStatusFromEvents(
  eventRepo: EventRepository,
  sessionId: string,
): string | null {
  const row = eventRepo.queryBySession({ sessionId, eventType: 'agent_status', limit: 1 }).events[0]
  if (row == null) return null
  try {
    const event = JSON.parse(row.event_json) as AgentEvent
    return event.type === 'agent_status' ? event.status : null
  } catch {
    return null
  }
}

function appendInterruptedTurnEvents(eventRepo: EventRepository, sessionId: string): void {
  const latestRow = eventRepo.queryBySession({ sessionId, limit: 1 }).events[0]
  let turnId: string = crypto.randomUUID()
  if (latestRow != null) {
    try {
      const event = JSON.parse(latestRow.event_json) as AgentEvent
      if (event.turnId != null && event.turnId.length > 0) turnId = event.turnId
    } catch {
      // Fall back to a synthetic turn id.
    }
  }

  const timestamp = new Date().toISOString()
  const seq = eventRepo.countBySession(sessionId)
  const events = createInterruptedTurnEvents(sessionId, turnId, seq, timestamp)

  eventRepo.insertBatch(
    events.map((event) => ({
      id: event.id,
      sessionId,
      turnId,
      eventType: event.type,
      eventJson: JSON.stringify(event),
    })),
  )
}

export function createInterruptedTurnEvents(
  sessionId: string,
  turnId: string,
  seq: number,
  timestamp: string = new Date().toISOString(),
): AgentEvent[] {
  return [
    {
      id: crypto.randomUUID(),
      type: 'agent_error',
      sessionId,
      turnId,
      timestamp,
      seq,
      code: 'APP_RESTARTED',
      message: 'The previous turn was stopped because Spark Agent restarted.',
      retryable: true,
    },
    {
      id: crypto.randomUUID(),
      type: 'agent_status',
      sessionId,
      turnId,
      timestamp,
      seq: seq + 1,
      status: 'cancelled',
      message: 'Stopped after app restart',
    },
  ]
}

function buildConversationHistoryPrompt(
  eventRepo: EventRepository,
  sessionId: string,
): string | undefined {
  const rows = eventRepo.queryBySession({
    sessionId,
    limit: HISTORY_CONTEXT_EVENT_LIMIT,
  }).events

  const events: AgentEvent[] = []
  for (const row of rows) {
    try {
      events.push(JSON.parse(row.event_json) as AgentEvent)
    } catch {
      // Ignore malformed historical rows.
    }
  }

  return buildConversationHistoryPromptFromEvents(events)
}

export function buildConversationHistoryPromptFromEvents(events: AgentEvent[]): string | undefined {
  const entries = limitHistoryContextEntries(buildDialogueEntries(events))
  if (entries.length === 0) return undefined

  const transcript = entries
    .map((entry) => `${entry.role}: ${truncateHistoryEntry(entry.content)}`)
    .join('\n\n')

  return [
    '[Spark Session History]',
    'The following transcript is persisted from earlier turns in this same Spark session. Use it as conversation context for the current user message. Do not restate it unless it is relevant.',
    transcript,
  ].join('\n\n')
}

type DialogueEntry = { role: 'User' | 'Assistant'; content: string }

function buildDialogueEntries(events: AgentEvent[]): DialogueEntry[] {
  const turns = new Map<
    string,
    {
      userParts: string[]
      snapshotUserMessage?: string
      assistantParts: string[]
      assistantFinal?: string
    }
  >()
  const turnOrder: string[] = []

  const getTurn = (turnId: string) => {
    let turn = turns.get(turnId)
    if (turn == null) {
      turn = { userParts: [], assistantParts: [] }
      turns.set(turnId, turn)
      turnOrder.push(turnId)
    }
    return turn
  }

  for (const event of events) {
    if (
      event.type !== 'user_message' &&
      event.type !== 'assistant_message' &&
      event.type !== 'turn_prompt_snapshot'
    )
      continue
    const turn = getTurn(event.turnId)
    if (event.type === 'turn_prompt_snapshot') {
      const userMessage = event.userMessage.trim()
      if (userMessage.length > 0) turn.snapshotUserMessage = userMessage
      continue
    }
    if (event.type === 'user_message') {
      turn.userParts.push(event.content)
      continue
    }
    if (event.mode === 'complete' && event.isFinal) {
      turn.assistantFinal = event.content
    } else {
      turn.assistantParts.push(event.content)
    }
  }

  const entries: DialogueEntry[] = []
  for (const turnId of turnOrder) {
    const turn = turns.get(turnId)
    if (turn == null) continue
    const userContent = joinHistoryParts(turn.userParts) || turn.snapshotUserMessage?.trim() || ''
    if (userContent.length > 0) entries.push({ role: 'User', content: userContent })
    const assistantContent = turn.assistantFinal?.trim() || joinHistoryParts(turn.assistantParts)
    if (assistantContent.length > 0) entries.push({ role: 'Assistant', content: assistantContent })
  }
  return entries
}

function joinHistoryParts(parts: string[]): string {
  return parts.join('\n').replace(/\s+\n/g, '\n').trim()
}

function limitHistoryContextEntries(entries: DialogueEntry[]): DialogueEntry[] {
  const selected = entries.slice(-HISTORY_CONTEXT_ENTRY_LIMIT)
  let total = selected.reduce((sum, entry) => sum + entry.content.length, 0)
  while (selected.length > 0 && total > HISTORY_CONTEXT_MAX_CHARS) {
    const removed = selected.shift()
    total -= removed?.content.length ?? 0
  }
  return selected
}

function truncateHistoryEntry(content: string): string {
  const normalized = content.trim()
  if (normalized.length <= HISTORY_CONTEXT_ENTRY_MAX_CHARS) return normalized
  return `${normalized.slice(0, HISTORY_CONTEXT_ENTRY_MAX_CHARS).trimEnd()}\n[truncated]`
}

function listSessionCheckpointsFromEvents(
  eventRepo: EventRepository,
  sessionId: string,
): CheckpointSnapshot[] {
  const rows = eventRepo.queryBySession({ sessionId, eventType: 'checkpoint', limit: 100 }).events
  const checkpoints: CheckpointSnapshot[] = []
  for (const row of rows) {
    try {
      const event = JSON.parse(row.event_json) as AgentEvent
      if (event.type !== 'checkpoint') continue
      checkpoints.push({
        checkpointId: event.checkpointId,
        ...(event.label != null ? { label: event.label } : {}),
        ...(event.path != null ? { path: event.path } : {}),
        ...(event.filePaths != null ? { filePaths: event.filePaths } : {}),
        timestamp: event.timestamp,
      })
    } catch {
      // Ignore malformed historical rows.
    }
  }
  return checkpoints
}

function restoreSessionCheckpoint(params: {
  eventRepo: EventRepository
  sessionId: string
  workspacePath: string | null
  checkpointRef: string
}): CheckpointRestoreResult {
  if (params.workspacePath == null) {
    throw new Error('No workspace is open for checkpoint restore.')
  }

  const checkpoints = listSessionCheckpointsFromEvents(params.eventRepo, params.sessionId)
  const checkpoint = checkpoints.find(
    (item) =>
      item.checkpointId === params.checkpointRef ||
      item.checkpointId.endsWith(params.checkpointRef) ||
      item.path === params.checkpointRef,
  )
  if (checkpoint == null) {
    throw new Error(`Checkpoint not found: ${params.checkpointRef}`)
  }
  if (checkpoint.path == null || checkpoint.path.trim().length === 0) {
    throw new Error(`Checkpoint ${checkpoint.checkpointId} does not include a restore path.`)
  }

  const workspaceRoot = path.resolve(params.workspacePath)
  const checkpointRoot = path.resolve(workspaceRoot, checkpoint.path)
  if (!existsSync(checkpointRoot)) {
    throw new Error(`Checkpoint path does not exist: ${checkpoint.path}`)
  }

  const rootStat = statSync(checkpointRoot)
  const requestedFiles = checkpoint.filePaths?.filter((file) => file.trim().length > 0) ?? []
  const filePaths =
    requestedFiles.length > 0
      ? requestedFiles
      : rootStat.isFile()
        ? [path.basename(checkpointRoot)]
        : listFilesUnder(checkpointRoot, 200)

  const restoredFiles: string[] = []
  const missingFiles: string[] = []
  for (const filePath of filePaths) {
    const safePath = normalizeWorkspaceRelativePath(filePath)
    if (safePath == null) {
      missingFiles.push(filePath)
      continue
    }

    const sourcePath = rootStat.isDirectory()
      ? path.resolve(checkpointRoot, safePath)
      : checkpointRoot
    if (rootStat.isDirectory() && !isInsidePath(checkpointRoot, sourcePath)) {
      missingFiles.push(filePath)
      continue
    }
    if (!existsSync(sourcePath) || !statSync(sourcePath).isFile()) {
      missingFiles.push(filePath)
      continue
    }

    const destPath = path.resolve(workspaceRoot, safePath)
    if (!isInsidePath(workspaceRoot, destPath)) {
      missingFiles.push(filePath)
      continue
    }
    mkdirSync(path.dirname(destPath), { recursive: true })
    copyFileSync(sourcePath, destPath)
    restoredFiles.push(safePath)
  }

  return {
    checkpointId: checkpoint.checkpointId,
    restoredFiles,
    missingFiles,
  }
}

function normalizeWorkspaceRelativePath(filePath: string): string | null {
  const normalized = filePath.replace(/\\/g, '/').replace(/^\/+/, '')
  if (normalized.length === 0 || normalized.split('/').includes('..')) return null
  return normalized
}

function listFilesUnder(root: string, limit: number): string[] {
  const files: string[] = []
  const visit = (dir: string) => {
    if (files.length >= limit) return
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (files.length >= limit) return
      const fullPath = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        visit(fullPath)
        continue
      }
      if (entry.isFile()) files.push(path.relative(root, fullPath).replace(/\\/g, '/'))
    }
  }
  visit(root)
  return files
}

function isInsidePath(root: string, target: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(target))
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
}

function normalizeTurnAttachments(
  attachments: SessionAttachment[] | undefined,
): SessionAttachment[] | undefined {
  if (attachments == null || attachments.length === 0) return undefined
  const seen = new Set<string>()
  const normalized: SessionAttachment[] = []
  for (const attachment of attachments) {
    const rawPath = attachment.path.trim()
    if (rawPath.length === 0) continue
    const absolutePath = path.isAbsolute(rawPath) ? path.normalize(rawPath) : path.resolve(rawPath)
    if (seen.has(absolutePath)) continue
    seen.add(absolutePath)
    normalized.push({ type: attachment.type, path: absolutePath })
  }
  return normalized.length > 0 ? normalized.slice(0, 20) : undefined
}

function prepareTurnAttachments(
  attachments: SessionAttachment[] | undefined,
  workspaceRootPath: string,
): SDKTurnAttachment[] {
  if (attachments == null || attachments.length === 0) return []
  return attachments.map((attachment) => {
    const absolutePath = path.isAbsolute(attachment.path)
      ? path.normalize(attachment.path)
      : path.resolve(workspaceRootPath, attachment.path)
    if (!existsSync(absolutePath)) {
      throw new Error(`附件不存在: ${absolutePath}`)
    }
    const fileStat = statSync(absolutePath)
    // directory 类型：作为上下文引用，校验是目录即可（不强制读取内容）
    if (attachment.type === 'directory') {
      if (!fileStat.isDirectory()) {
        throw new Error(`附件应是目录: ${absolutePath}`)
      }
      return {
        type: 'directory',
        path: absolutePath,
        name: path.basename(absolutePath),
      }
    }
    if (!fileStat.isFile()) {
      throw new Error(`附件必须是文件: ${absolutePath}`)
    }
    return {
      type: attachment.type,
      path: absolutePath,
      name: path.basename(absolutePath),
      sizeBytes: fileStat.size,
    }
  })
}

function getAttachmentAdditionalDirectories(
  attachments: SDKTurnAttachment[],
  workspaceRootPath: string,
): string[] {
  const directories = new Set<string>()
  for (const attachment of attachments) {
    // directory 类型：把目录本身加入可访问范围，让 agent 的文件工具能遍历它
    const target = attachment.type === 'directory' ? attachment.path : path.dirname(attachment.path)
    if (!isInsidePath(workspaceRootPath, target)) directories.add(target)
  }
  return Array.from(directories)
}

function buildUserMessageSnapshot(message: string, attachments: SDKTurnAttachment[]): string {
  if (attachments.length === 0) return message
  return [message, '', buildAttachmentPromptLedger(attachments)].join('\n')
}

function buildAttachmentPromptLedger(attachments: SDKTurnAttachment[]): string {
  if (attachments.length === 0) return ''
  const lines = attachments.map((attachment, index) => {
    return `${index + 1}. ${attachment.type}: ${attachment.name} (${attachment.path})`
  })
  return ['Attachments:', ...lines].join('\n')
}

function deriveSessionTitle(message: string): string {
  const normalized = message
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.length > 0)
    ?.replace(/^#{1,6}\s+/, '')
    .replace(/^[-*+]\s+/, '')
    .replace(/^\d+[.)]\s+/, '')
    .replace(/^>+\s*/, '')
    .replace(/[`*_~[\](){}<>]/g, '')
    .replace(/\s+/g, ' ')
    .trim()

  if (normalized == null || normalized.length === 0) return '新会话'
  return truncateTitle(normalized)
}

function truncateTitle(title: string): string {
  const chars = Array.from(title)
  if (chars.length <= SESSION_TITLE_MAX_LENGTH) return title
  return `${chars
    .slice(0, SESSION_TITLE_MAX_LENGTH - 3)
    .join('')
    .trimEnd()}...`
}

export function getAgentAdapterFromSession(
  value: string | null | undefined,
  legacyChatMode: string | null | undefined,
  providerType: string | null,
): AgentAdapterKind {
  if (value === 'claude-sdk' || value === 'codex') return value
  if (value === 'claude') return 'claude-sdk'
  if (legacyChatMode === 'claude-sdk' || legacyChatMode === 'codex') return legacyChatMode
  if (legacyChatMode === 'claude') return 'claude-sdk'
  // Default: Anthropic providers use claude-sdk. Direct Anthropic API is not a
  // supported execution path for the core code agent.
  return providerType === 'anthropic' ? 'claude-sdk' : 'codex'
}

export function getPermissionModeFromSession(
  value: string | null | undefined,
  adapter: AgentAdapterKind,
): SessionPermissionMode {
  if (
    value === 'claude-ask' ||
    value === 'claude-auto-edits' ||
    value === 'claude-plan' ||
    value === 'claude-auto' ||
    value === 'claude-bypass' ||
    value === 'codex-default' ||
    value === 'codex-auto-review' ||
    value === 'codex-full-access'
  ) {
    return value
  }
  return adapter === 'codex' ? 'codex-default' : 'claude-ask'
}

function normalizeAgentAdapter(value: string | null | undefined): AgentAdapterKind {
  if (value === 'claude' || value === 'claude-sdk') return 'claude-sdk'
  if (value === 'codex') return 'codex'
  return 'claude-sdk'
}

function normalizePermissionMode(value: string | null | undefined): SessionPermissionMode {
  const adapter = value?.startsWith('codex-') ? 'codex' : 'claude-sdk'
  return getPermissionModeFromSession(value, adapter)
}

function normalizeReasoningEffort(
  value: string | null | undefined,
): 'medium' | 'high' | 'xhigh' | 'max' {
  if (value === 'medium' || value === 'high' || value === 'xhigh' || value === 'max') return value
  return 'max'
}

function withAgentSnapshot(event: AgentEvent, agent: AgentItem): AgentEvent {
  if (
    event.type !== 'assistant_message' &&
    event.type !== 'agent_thinking' &&
    event.type !== 'agent_status'
  ) {
    return event
  }
  return {
    ...event,
    agentId: event.agentId ?? agent.id,
    agentName: event.agentName ?? agent.name,
  } as AgentEvent
}

// ── Team Mode helpers ────────────────────────────────────────────────────────

const TEAM_DISPATCH_TOOL_DESCRIPTION = [
  'Delegate ONE focused subtask to a teammate agent (serial).',
  'When to use: the next step depends on the previous member reply, or only one member needs to act.',
  'When NOT to use: you can answer the user directly, or the user asks several members in parallel (use agent_dispatch_batch instead).',
  'Returns a structured reply with the member content. You decide whether to call again or synthesize the final answer.',
].join('\n')

const TEAM_DISPATCH_BATCH_TOOL_DESCRIPTION = [
  'Delegate multiple INDEPENDENT subtasks to teammate agents IN PARALLEL.',
  'When to use: the user explicitly asks several members (e.g. "ask all agents", "have docs and qa each draft X"), or you have multiple unrelated tasks that can run concurrently.',
  'When NOT to use: tasks depend on each other (use agent_dispatch one at a time), or the user only mentioned one member.',
  'Each item is one independent dispatch; tasks may target the same or different members.',
  'Returns an array of structured replies in the same order as the input. A failure in one item does not abort the others.',
].join('\n')

/** 从 SessionRow.metadata_json 读取团队配置（不存在/无效返回 null） */
function readSessionTeamConfig(session: { metadata_json?: string }): TeamModeConfig | null {
  if (session.metadata_json == null || session.metadata_json === '') return null
  try {
    const meta = JSON.parse(session.metadata_json) as { team?: Partial<TeamModeConfig> }
    const team = meta.team
    if (team == null || typeof team !== 'object') return null
    return {
      enabled: team.enabled === true,
      hostAgentId: typeof team.hostAgentId === 'string' ? team.hostAgentId : 'platform-manager-agent',
      memberAgentIds: Array.isArray(team.memberAgentIds) ? team.memberAgentIds.filter((id) => typeof id === 'string') : [],
      maxDepth: typeof team.maxDepth === 'number' ? team.maxDepth : 1,
      allowNesting: team.allowNesting === true,
    }
  } catch {
    return null
  }
}

/** 构建团队花名册 system prompt 段，附加在 [Agent Instructions] 之后（设计文档 §8.2.3） */
export function buildTeamRosterPrompt(host: AgentItem, members: AgentItem[], teamConfig: TeamModeConfig): string {
  if (members.length === 0) return ''
  const lines: string[] = [
    '[Team Roster]',
    `You are ${host.name} (${host.id}), the host of a multi-agent team.`,
    'You have TWO dispatch tools:',
    '  - `mcp__spark_team__agent_dispatch` — delegate ONE subtask (serial; use when the next step depends on the previous reply).',
    '  - `mcp__spark_team__agent_dispatch_batch` — delegate MULTIPLE independent subtasks in PARALLEL (use when the user asks several members at once, e.g. "let all members introduce themselves", or when tasks are unrelated).',
    '',
    'Members available to you in this session:',
  ]
  for (const m of members) {
    const summary = m.description.trim().slice(0, 240)
    lines.push(`- id: ${m.id}`)
    lines.push(`  name: ${m.name}`)
    if (summary) lines.push(`  description: ${summary}`)
  }
  lines.push('')
  lines.push('Rules:')
  lines.push('- Call dispatch with a clear instruction and the minimum context the member needs (paste code/snippets into `attachments` instead of relying on shared memory).')
  lines.push(`- You may call at most ${teamConfig.maxDepth} chained dispatch level(s).`)
  lines.push('- Do NOT call dispatch if you can answer the user directly.')
  lines.push('')
  lines.push('IMPORTANT — avoid duplicating member output:')
  lines.push('- Member replies are streamed directly to the user in the chat UI. The user already sees them in full.')
  lines.push('- After dispatch(es) return, do NOT repeat, paraphrase, restate, summarize, or list out the member replies.')
  lines.push('- Default behavior: stay silent and end the turn. The dispatch cards plus member bubbles ARE the answer.')
  lines.push('- Only speak again if (a) the user explicitly asked you to compare/synthesize multiple members, or (b) you need to ask the user a follow-up question, or (c) a dispatch failed and you must report what is missing. In those cases, write only the synthesis / question / failure note — never the members\' content.')
  return lines.join('\n')
}

/** 把 task 拼成传给 member 的 user message（instruction + attachments + expectedOutput） */
function buildMemberUserMessage(task: TeamA2ATask): string {
  const parts: string[] = [task.instruction]
  if (task.attachments != null && task.attachments.length > 0) {
    parts.push('', '[Attachments]')
    for (const att of task.attachments) {
      parts.push(att.type === 'text' ? att.value : `${att.type}: ${att.value}`)
    }
  }
  if (task.expectedOutput != null) {
    parts.push('', `[Expected output] ${task.expectedOutput}`)
  }
  return parts.join('\n')
}

/** 把 member 的结构化回复格式化成给 Host LLM 看的工具结果文本（UI 不渲染此文本） */
export function formatReplyForHost(reply: import('@spark/protocol').TeamA2AReply): string {
  const usage = reply.usage
  const meta = [
    `member=${reply.memberName != null ? `${reply.memberName} (${reply.memberAgentId})` : reply.memberAgentId}`,
    `state=${reply.state}`,
    usage?.durationMs != null ? `${usage.durationMs}ms` : null,
    usage?.inputTokens != null && usage?.outputTokens != null
      ? `${usage.inputTokens}→${usage.outputTokens} tok`
      : null,
    reply.error != null ? `code=${reply.error.code}` : null,
  ]
    .filter(Boolean)
    .join(' · ')
  const header = `[Member Reply · ${meta}]`
  if (reply.state !== 'completed') {
    const errorLine = reply.error?.message ?? '(no content)'
    // 超时/取消但保留了部分产出时，把已产出内容一并带给 Host，避免盲目重派丢工作。
    const partial = reply.content.trim()
    return partial.length > 0
      ? `${header}\n${errorLine}\n\n[Partial output]\n${reply.content}`
      : `${header}\n${errorLine}`
  }
  const artifactsLine =
    reply.artifacts != null && reply.artifacts.length > 0
      ? `\n(artifacts: ${reply.artifacts.map((a) => a.name ?? a.type).join(', ')})`
      : ''
  return `${header}\n${reply.content}${artifactsLine}`
}

function buildManagedAgentSystemPrompt(agent: AgentItem, workflow: WorkflowItem | null): string {
  const sections: string[] = [
    '[Managed Agent]',
    `Agent: ${agent.name} (${agent.id})`,
    agent.description.trim() ? `Description: ${agent.description.trim()}` : '',
    agent.prompt.trim() ? `[Agent Instructions]\n${agent.prompt.trim()}` : '',
  ].filter((section) => section.trim().length > 0)

  const workflowPrompt = workflow != null ? buildWorkflowSystemPrompt(workflow) : ''
  if (workflowPrompt.trim().length > 0) sections.push(workflowPrompt)
  return sections.join('\n\n')
}

function resolveImageGenerationMcpServerPath(): string | null {
  const here = path.dirname(fileURLToPath(import.meta.url))
  const candidates = [
    path.resolve(here, 'tools/image-generation-mcp-server.mjs'),
    path.resolve(here, '../tools/image-generation-mcp-server.mjs'),
    path.resolve(process.cwd(), 'packages/agent-runtime/src/tools/image-generation-mcp-server.mjs'),
  ]
  return candidates.find((candidate) => existsSync(candidate)) ?? null
}

function resolveMediaGenerationMcpServerPath(): string | null {
  const here = path.dirname(fileURLToPath(import.meta.url))
  const candidates = [
    path.resolve(here, 'tools/media-generation-mcp-server.mjs'),
    path.resolve(here, '../tools/media-generation-mcp-server.mjs'),
    path.resolve(process.cwd(), 'packages/agent-runtime/src/tools/media-generation-mcp-server.mjs'),
  ]
  return candidates.find((candidate) => existsSync(candidate)) ?? null
}

function buildMediaGenerationSystemPrompt(input: {
  name: string
  model: string
  provider: string
  apiType: string
  outputDir: string
  capabilities: string[]
  modelManifests?: Array<{ id: string; modelId: string; capabilities: string[] }>
  apiEndpoint?: string
}): string {
  const caps = input.capabilities.length > 0 ? input.capabilities.join(', ') : 'audio.speech, video.generate'
  const manifestLines = (input.modelManifests ?? [])
    .map((manifest) => `  - ${manifest.id} (${manifest.modelId}): ${manifest.capabilities.join(', ') || 'no declared capabilities'}`)
  return [
    '## Media Generation Capability',
    'The current runtime has a configured multimedia model (image / audio / video).',
    'Credentials are injected only into the local media MCP server — never ask for or reveal API keys.',
    '',
    `- Configuration name: ${input.name}`,
    `- Model ID: ${input.model}`,
    `- Platform adapter: ${input.provider}`,
    `- Invocation mode: ${input.apiType}`,
    `- API base URL: ${input.apiEndpoint ?? '(provider default)'}`,
    `- Declared capabilities: ${caps}`,
    `- Output directory: ${input.outputDir}`,
    ...(manifestLines.length > 0
      ? ['', 'Configured model manifests:', ...manifestLines]
      : []),
    '',
    'Available tools (call the one matching the user intent):',
    '- `mcp__spark_media__list_models` — inspect configured media models and capabilities.',
    '- `mcp__spark_media__describe_model` — inspect parameter schema before calling a model.',
    '- `mcp__spark_media__generate_image` — text-to-image / image-to-image.',
    '- `mcp__spark_media__edit_image` — edit / compose existing images with a prompt.',
    '- `mcp__spark_media__generate_audio` — text-to-speech.',
    '- `mcp__spark_media__transcribe_audio` — audio-to-text transcription.',
    '- `mcp__spark_media__generate_video` — text-to-video / image-to-video.',
    '- `mcp__spark_media__get_task` — inspect a media task returned by generation tools.',
    '- `mcp__spark_media__cancel_task` — cancel a pending/running media task when supported.',
    '',
    'After success, show the generated `files` from the structured result. Local file paths can be shown as Markdown links.',
    'Do not auto-retry after a provider failure; report the error and suggest model, prompt, or provider-configuration adjustments.',
  ].join('\n')
}

function buildImageGenerationSystemPrompt(input: {
  name: string
  model: string
  provider: string
  apiType: string
  outputDir: string
  apiEndpoint?: string
}): string {
  return [
    '## Image Generation Capability',
    'The current runtime has a configured image generation model.',
    '',
    `- Configuration name: ${input.name}`,
    `- Model ID: ${input.model}`,
    `- Image provider: ${input.provider}`,
    `- Invocation mode: ${input.apiType}`,
    `- API base URL: ${input.apiEndpoint ?? '(provider default)'}`,
    `- Output directory: ${input.outputDir}`,
    '',
    'Use `mcp__spark_image__generate_image` when the user explicitly asks to create an image, poster, illustration, visual draft, icon, cover, or other generated image asset.',
    'Do not ask for or reveal API keys. Credentials are injected only into the local image MCP server.',
    'If the user gives semantic sizing such as square, portrait, landscape, poster, or banner, translate it to an appropriate `size` value before calling the tool.',
    'Pass provider-specific fields through `extraJson` only when they are relevant and reasonably supported by the configured provider.',
    'After success, show the generated `urls` or `files` from the structured result. Local file paths can be shown directly as Markdown image links.',
    'Do not auto-retry image generation after a provider failure; report the error and suggest model, prompt, size, or provider-configuration adjustments.',
  ].join('\n')
}

function mergeUniqueStrings(a: string[] | undefined, b: string[]): string[] {
  return [...new Set([...(a ?? []), ...b])]
}

/**
 * All platform management tool names (SDK namespace: mcp__spark_platform__).
 *
 * The Platform Management MCP server (`packages/agent-runtime/src/tools/platform-management-mcp-server.mjs`)
 * exposes this set; if you add a new tool to `toolDefinitions()` in that file,
 * also append its SDK-namespaced name here, otherwise Claude SDK will refuse
 * to dispatch the tool call (it filters by the `allowedTools` allow-list).
 */
const PLATFORM_TOOL_NAMES: string[] = [
  // Skills
  'mcp__spark_platform__skills_list',
  'mcp__spark_platform__skills_load',
  'mcp__spark_platform__skills_search',
  'mcp__spark_platform__skills_search_github',
  'mcp__spark_platform__skills_install',
  'mcp__spark_platform__skills_install_github',
  'mcp__spark_platform__skills_uninstall',
  'mcp__spark_platform__skills_toggle',
  // MCP Servers
  'mcp__spark_platform__mcp_list',
  'mcp__spark_platform__mcp_create',
  'mcp__spark_platform__mcp_update',
  'mcp__spark_platform__mcp_delete',
  'mcp__spark_platform__mcp_status',
  // Providers
  'mcp__spark_platform__providers_list',
  'mcp__spark_platform__providers_get',
  'mcp__spark_platform__providers_create',
  'mcp__spark_platform__providers_update',
  'mcp__spark_platform__providers_delete',
  'mcp__spark_platform__providers_health_check',
  'mcp__spark_platform__providers_set_default',
  'mcp__spark_platform__providers_set_default_model',
  // Workflows
  'mcp__spark_platform__workflows_list',
  'mcp__spark_platform__workflows_get',
  'mcp__spark_platform__workflows_create',
  'mcp__spark_platform__workflows_update',
  'mcp__spark_platform__workflows_delete',
  // Agents
  'mcp__spark_platform__agents_list',
  'mcp__spark_platform__agents_get',
  'mcp__spark_platform__agents_create',
  'mcp__spark_platform__agents_update',
  'mcp__spark_platform__agents_delete',
  // Teams
  'mcp__spark_platform__teams_list',
  'mcp__spark_platform__teams_get',
  'mcp__spark_platform__teams_create',
  'mcp__spark_platform__teams_update',
  'mcp__spark_platform__teams_delete',
  // Settings
  'mcp__spark_platform__settings_get',
  'mcp__spark_platform__settings_set',
  'mcp__spark_platform__settings_get_category',
  'mcp__spark_platform__settings_get_all',
  // Sessions (self-management)
  'mcp__spark_platform__sessions_get',
  'mcp__spark_platform__sessions_switch_model',
  'mcp__spark_platform__sessions_switch_provider',
  'mcp__spark_platform__sessions_switch_mode',
  'mcp__spark_platform__sessions_switch_permission',
  'mcp__spark_platform__sessions_switch_reasoning_effort',
  // Board Tasks
  'mcp__spark_platform__board_list',
  'mcp__spark_platform__board_get',
  'mcp__spark_platform__board_create',
  'mcp__spark_platform__board_update',
  'mcp__spark_platform__board_delete',
  'mcp__spark_platform__board_batch_create',
  'mcp__spark_platform__board_batch_update',
  'mcp__spark_platform__board_batch_delete',
  'mcp__spark_platform__board_restore',
  'mcp__spark_platform__board_permanent_delete',
]

function resolvePlatformManagementMcpServerPath(): string | null {
  const here = path.dirname(fileURLToPath(import.meta.url))
  const candidates = [
    // Packed desktop build: `apps/desktop/out/main/index.js` + copied `tools/*.mjs`
    path.resolve(here, 'tools/platform-management-mcp-server.mjs'),
    // When bundled one level deeper (defensive)
    path.resolve(here, '../tools/platform-management-mcp-server.mjs'),
    // Dev / monorepo source checkout
    path.resolve(process.cwd(), 'packages/agent-runtime/src/tools/platform-management-mcp-server.mjs'),
  ]
  return candidates.find((candidate) => existsSync(candidate)) ?? null
}

function resolveWebSearchMcpServerPath(): string | null {
  const here = path.dirname(fileURLToPath(import.meta.url))
  const candidates = [
    path.resolve(here, 'tools/web-search-mcp-server.mjs'),
    path.resolve(here, '../tools/web-search-mcp-server.mjs'),
    path.resolve(process.cwd(), 'packages/agent-runtime/src/tools/web-search-mcp-server.mjs'),
  ]
  return candidates.find((candidate) => existsSync(candidate)) ?? null
}

function resolveDebugMcpServerPath(): string | null {
  const here = path.dirname(fileURLToPath(import.meta.url))
  const candidates = [
    path.resolve(here, 'tools/debug-mode-mcp-server.mjs'),
    path.resolve(here, '../tools/debug-mode-mcp-server.mjs'),
    path.resolve(process.cwd(), 'packages/agent-runtime/src/tools/debug-mode-mcp-server.mjs'),
  ]
  return candidates.find((candidate) => existsSync(candidate)) ?? null
}

/** SDK-namespaced tool names exposed by the spark_search MCP server. */
const SEARCH_TOOL_NAMES: string[] = [
  'mcp__spark_search__web_search',
  'mcp__spark_search__fetch_url',
]

/**
 * System prompt section injected when the built-in web search MCP server is
 * available. The whole point: SDK 自带 WebSearch/WebFetch 在第三方 provider 下失效，
 * 这里指引模型改用始终可用的 spark_search 工具。
 */
const WEB_SEARCH_SYSTEM_PROMPT = [
  '## Web Search Capability (built-in, always available)',
  'You have a built-in internet search that works regardless of the model provider:',
  '- `mcp__spark_search__web_search` — search the web, returns ranked {title, url, snippet}.',
  '- `mcp__spark_search__fetch_url` — fetch a page and return its readable text.',
  '',
  'Use these whenever you need current information, to verify facts, or to read a page.',
  'Prefer them over the SDK built-in `WebSearch`/`WebFetch`, which are unavailable when',
  'running on third-party (non-default) API providers. Cite the source URLs you used.',
].join('\n')

/**
 * System prompt section injected when the built-in `builtin:spark-web-tool` skill is
 * available for the session. Nudges the model to prefer that skill for the common
 * "produce a document / deck / web page / report" intents instead of hand-rolling
 * output, and tells it how to load the skill on demand (progressive disclosure).
 */
const SPARK_WEB_TOOL_SYSTEM_PROMPT = [
  '## Content Authoring Capability (built-in skill: spark-web-tool)',
  'When the user asks to produce any of the following, prefer the `builtin:spark-web-tool` skill over hand-writing output:',
  '- 演示文稿 / PPT / slide decks / 幻灯片',
  '- 文档与文件（DOCX / Markdown / PPTX）',
  '- 调研报告、专题报告、数据分析报告',
  '- 网页 / HTML 内容',
  '- 课件、交互式讲解、数据可视化页面',
  '',
  'The skill runs a clarify → outline → produce workflow and emits high-quality artifacts.',
  'Load its full instructions on demand:',
  '  - via the native `Skill` tool with name `builtin:spark-web-tool`, OR',
  '  - via `mcp__spark_platform__skills_load` with id `builtin:spark-web-tool`.',
  'After loading, follow the skill\'s guidance instead of improvising the artifact by hand.',
].join('\n')

/** SDK-namespaced tool names exposed by the spark_debug MCP server. */
const DEBUG_TOOL_NAMES: string[] = [
  'mcp__spark_debug__begin',
  'mcp__spark_debug__read',
  'mcp__spark_debug__next_round',
  'mcp__spark_debug__status',
  'mcp__spark_debug__finish',
]

/**
 * System prompt section injected only when the session has debug mode enabled.
 * Brief — the full state machine lives in the `builtin:spark-debug` skill. The
 * point here is to make the agent aware the闭环 tools exist and the human is in
 * the loop for reproduction.
 */
const DEBUG_MODE_SYSTEM_PROMPT = [
  '## Debug Mode (enabled for this session)',
  'You are in interactive debug mode. A local log server is running; instrumentation you',
  'add reports back to it (browser/webview logs included — CORS is handled). Use the',
  '`mcp__spark_debug__*` tools to run a hypothesis-driven loop WITH the user in the loop:',
  '1. `begin` to get the session id + ready-to-paste instrumentation snippets.',
  '2. Form a hypothesis, instrument the code (wrap logs in the `__SPARK_DEBUG_*` markers',
  '   from the snippet), then ask the user to reproduce and END your turn.',
  '3. When the user says they reproduced, call `read` to pull this round\'s logs and analyze.',
  '   If `status.thisRound` is 0, they likely did not hit the path — adjust, do not guess.',
  '4. Fix or re-hypothesize; use `next_round` (record the hypothesis) before each new batch.',
  '5. When the user confirms it is fixed, call `finish`, then strip ALL instrumentation',
  '   (grep `__SPARK_DEBUG`), verify zero residue, and deliver root cause + fix + evidence.',
  'Never claim you reproduced the bug yourself — reproduction is always the user\'s step.',
].join('\n')

/**
 * System prompt section injected when the Platform Management MCP server is available.
 * Brief — the full instructions live in the `builtin:platform-manager` skill definition.
 */
const PLATFORM_MANAGEMENT_SYSTEM_PROMPT = [
  '## Platform Management Capability',
  'You can manage this platform using `mcp__spark_platform__*` tools.',
  'Available capabilities:',
  '- **Skills**: list, load, search, search_github, install, install_github, uninstall, toggle',
  '- **MCP Servers**: list, create, update, delete, status',
  '- **Providers**: list, get, create, update, delete, health_check, set_default, set_default_model',
  '- **Workflows**: list, get, create, update, delete',
  '- **Agents**: list, get, create, update, delete',
  '- **Teams**: list, get, create, update, delete',
  '- **Settings**: get, set, get_category, get_all',
  '- **Sessions (self)**: get, switch_model, switch_provider, switch_mode, switch_permission, switch_reasoning_effort',
  '- **Board Tasks**: list, get, create, update, delete, batch_create, batch_update, batch_delete, restore, permanent_delete',
  '',
  'When the user asks to manage any of these, use the corresponding tool directly.',
  'For destructive operations (delete, uninstall), always confirm with the user first.',
  'Never reveal or ask for full API keys — only show whether a key is configured.',
].join('\n')

function buildWorkflowSystemPrompt(workflow: WorkflowItem): string {
  const graph = normalizeWorkflowGraph(workflow.graph)
  if (graph.nodes.length === 0) return ''
  const ordered = orderWorkflowNodes(graph.nodes, graph.edges)
  const lines = ordered.map((node, index) => {
    const config = node.config
    const detail = [
      `kind=${node.kind}`,
      config.role != null ? `role=${String(config.role)}` : '',
      config.modelId != null && String(config.modelId).trim() ? `model=${String(config.modelId)}` : '',
      Array.isArray(config.skillIds) && config.skillIds.length > 0
        ? `skills=${config.skillIds.join(', ')}`
        : '',
      Array.isArray(config.toolIds) && config.toolIds.length > 0
        ? `tools=${config.toolIds.join(', ')}`
        : '',
      Array.isArray(config.ruleIds) && config.ruleIds.length > 0
        ? `rules=${config.ruleIds.join(', ')}`
        : '',
      Array.isArray(config.mcpServerIds) && config.mcpServerIds.length > 0
        ? `mcp=${config.mcpServerIds.join(', ')}`
        : '',
      typeof config.permissionMode === 'string' && config.permissionMode.trim()
        ? `permission=${config.permissionMode}`
        : '',
      typeof config.retryCount === 'number' ? `retry=${config.retryCount}` : '',
    ].filter(Boolean)
    const prompt = typeof config.prompt === 'string' && config.prompt.trim()
      ? `\n   prompt: ${config.prompt.trim()}`
      : ''
    return `${index + 1}. ${node.title} [${detail.join('; ')}]${prompt}`
  })

  return [
    '[Workflow Execution Plan]',
    `Workflow: ${workflow.name} (${workflow.id})`,
    workflow.description.trim() ? `Description: ${workflow.description.trim()}` : '',
    'Execute the task by following these workflow nodes in order. If a node declares a model, tool, skill, MCP server, or permission preference, treat it as the preferred configuration for that phase. When the SDK cannot literally switch model per node within one turn, preserve the node intent in your planning and execution notes.',
    lines.join('\n'),
  ].filter((line) => line.trim().length > 0).join('\n\n')
}

function collectManagedRuleContents(
  rulesRepo: RulesRepository,
  agent: AgentItem,
  workflow: WorkflowItem | null,
): string[] {
  const ruleIds = new Set(agent.ruleIds)
  const graph = workflow != null ? normalizeWorkflowGraph(workflow.graph) : null
  for (const node of graph?.nodes ?? []) {
    const configured = node.config.ruleIds
    if (!Array.isArray(configured)) continue
    for (const id of configured) {
      if (typeof id === 'string' && id.trim().length > 0) ruleIds.add(id)
    }
  }
  if (ruleIds.size === 0) return []
  const allRules = rulesRepo.list().filter((rule) => rule.enabled === 1)
  return allRules
    .filter((rule) => ruleIds.has(rule.id))
    .sort((a, b) => b.priority - a.priority)
    .map((rule) => `[${rule.name}]\n${rule.content}`)
}

function buildRuntimeRulesPrompt(rules: string[]): string | undefined {
  const unique = Array.from(new Set(rules.map((rule) => rule.trim()).filter(Boolean)))
  if (unique.length === 0) return undefined
  return ['[Runtime Rules]', ...unique.map((rule, index) => `${index + 1}. ${rule}`)].join('\n\n')
}

function getAllowedMcpServerIds(agent: AgentItem, workflow: WorkflowItem | null): Set<string> | undefined {
  const ids = new Set(agent.mcpServerIds)
  const graph = workflow != null ? normalizeWorkflowGraph(workflow.graph) : null
  for (const node of graph?.nodes ?? []) {
    const configured = node.config.mcpServerIds
    if (!Array.isArray(configured)) continue
    for (const id of configured) {
      if (typeof id === 'string' && id.trim().length > 0) ids.add(id)
    }
  }
  return ids.size > 0 ? ids : undefined
}

async function checkCommandAvailable(command: string, cwd: string | null): Promise<boolean> {
  const { exec } = await import('node:child_process')
  const { promisify } = await import('node:util')
  const execAsync = promisify(exec)
  try {
    await execAsync(command, { cwd: cwd ?? undefined, timeout: 5000, maxBuffer: 64 * 1024 })
    return true
  } catch {
    return false
  }
}

async function checkWorkspaceShellAvailable(cwd: string | null): Promise<{ available: boolean; shell?: string; error?: string }> {
  const { exec } = await import('node:child_process')
  const { promisify } = await import('node:util')
  const execAsync = promisify(exec)
  const shell = process.env.SHELL
  const withShell = (result: { available: boolean; error?: string }): { available: boolean; shell?: string; error?: string } => ({
    ...result,
    ...(shell != null ? { shell } : {}),
  })
  try {
    const { stdout } = await execAsync('echo spark-shell-ok', { cwd: cwd ?? undefined, timeout: 5000, maxBuffer: 64 * 1024 })
    return stdout.includes('spark-shell-ok')
      ? withShell({ available: true })
      : withShell({ available: false, error: 'unexpected shell output' })
  } catch (err) {
    return withShell({ available: false, error: err instanceof Error ? err.message : String(err) })
  }
}

async function checkOpenAISdkAvailable(): Promise<boolean> {
  try {
    await import('openai')
    return true
  } catch {
    return false
  }
}

type NormalizedWorkflowNode = {
  id: string
  kind: string
  title: string
  config: Record<string, unknown>
}

type NormalizedWorkflowEdge = { from: string; to: string }

function normalizeWorkflowGraph(graph: Record<string, unknown>): {
  nodes: NormalizedWorkflowNode[]
  edges: NormalizedWorkflowEdge[]
} {
  const nodes = Array.isArray(graph.nodes)
    ? graph.nodes.flatMap((node): NormalizedWorkflowNode[] => {
        if (node == null || typeof node !== 'object') return []
        const record = node as Record<string, unknown>
        const id = typeof record.id === 'string' ? record.id : ''
        if (!id) return []
        return [{
          id,
          kind: typeof record.kind === 'string' ? record.kind : 'agent',
          title: typeof record.title === 'string' ? record.title : id,
          config: record.config != null && typeof record.config === 'object'
            ? record.config as Record<string, unknown>
            : {},
        }]
      })
    : []
  const edges = Array.isArray(graph.edges)
    ? graph.edges.flatMap((edge): NormalizedWorkflowEdge[] => {
        if (edge == null || typeof edge !== 'object') return []
        const record = edge as Record<string, unknown>
        const from = typeof record.from === 'string' ? record.from : ''
        const to = typeof record.to === 'string' ? record.to : ''
        return from && to ? [{ from, to }] : []
      })
    : []
  return { nodes, edges }
}

function orderWorkflowNodes(
  nodes: NormalizedWorkflowNode[],
  edges: NormalizedWorkflowEdge[],
): NormalizedWorkflowNode[] {
  const byId = new Map(nodes.map((node) => [node.id, node]))
  const incoming = new Map(nodes.map((node) => [node.id, 0]))
  const outgoing = new Map<string, string[]>()
  for (const edge of edges) {
    if (!byId.has(edge.from) || !byId.has(edge.to)) continue
    incoming.set(edge.to, (incoming.get(edge.to) ?? 0) + 1)
    outgoing.set(edge.from, [...(outgoing.get(edge.from) ?? []), edge.to])
  }

  const queue = nodes.filter((node) => (incoming.get(node.id) ?? 0) === 0)
  const ordered: NormalizedWorkflowNode[] = []
  while (queue.length > 0) {
    const node = queue.shift()!
    ordered.push(node)
    for (const to of outgoing.get(node.id) ?? []) {
      const next = (incoming.get(to) ?? 0) - 1
      incoming.set(to, next)
      if (next === 0) {
        const target = byId.get(to)
        if (target != null) queue.push(target)
      }
    }
  }

  if (ordered.length !== nodes.length) return nodes
  return ordered
}

async function getWorkspaceRootIssue(rootPath: string): Promise<string | null> {
  try {
    const info = await stat(rootPath)
    return info.isDirectory() ? null : 'Workspace path exists but is not a directory'
  } catch (err) {
    return err instanceof Error ? `${err.name}: ${err.message}` : String(err)
  }
}

function getChatModeFromSession(
  value: string | null | undefined,
): 'agent' | 'ask' | 'edit' | 'review' {
  if (value === 'ask' || value === 'edit' || value === 'review') return value
  return 'agent'
}

/** 从 session.metadata_json 解析导入来源（用于侧边栏来源徽标）；非导入会话返回 null */
function getImportedFromMetadata(metadataJson: string | null | undefined): HistoryImportSource | null {
  if (metadataJson == null || metadataJson === '') return null
  try {
    const meta = JSON.parse(metadataJson) as { importedFrom?: unknown }
    if (meta.importedFrom === 'claude-code' || meta.importedFrom === 'codex') return meta.importedFrom
  } catch {
    // 忽略损坏的 metadata
  }
  return null
}

/** 从 session.metadata_json 解析调试模式开关（per-session 能力开关，缺省 false）。 */
function getDebugModeFromMetadata(metadataJson: string | null | undefined): boolean {
  if (metadataJson == null || metadataJson === '') return false
  try {
    const meta = JSON.parse(metadataJson) as { debugMode?: unknown }
    return meta.debugMode === true
  } catch {
    return false
  }
}

function getRuntimePatch(params: SessionRuntimePatch): SessionRuntimePatch | undefined {
  const patch: SessionRuntimePatch = {}
  if (params.providerProfileId !== undefined) patch.providerProfileId = params.providerProfileId
  if (params.modelId !== undefined) patch.modelId = params.modelId
  if (params.agentId !== undefined) patch.agentId = params.agentId
  if (params.agentAdapter !== undefined) patch.agentAdapter = params.agentAdapter
  if (params.permissionMode !== undefined) patch.permissionMode = params.permissionMode
  if (params.chatMode !== undefined) patch.chatMode = params.chatMode
  if (params.reasoningEffort !== undefined) patch.reasoningEffort = params.reasoningEffort
  return Object.keys(patch).length > 0 ? patch : undefined
}

function getProviderModelIds(configJson: string | null | undefined): string[] {
  if (configJson == null) return []
  try {
    const config = JSON.parse(configJson) as {
      defaultModel?: unknown
      model?: unknown
      modelIds?: unknown
    }
    const models = [
      typeof config.defaultModel === 'string' ? config.defaultModel : undefined,
      typeof config.model === 'string' ? config.model : undefined,
      ...(Array.isArray(config.modelIds)
        ? config.modelIds.filter((item): item is string => typeof item === 'string')
        : []),
    ]
    return Array.from(
      new Set(models.filter((model): model is string => model != null && model.trim().length > 0)),
    )
  } catch {
    return []
  }
}

export function makeSdkRuntimeSessionId(
  sessionId: string,
  providerProfileId: string,
  model: string,
  agentAdapter: AgentAdapterKind,
  turnId?: string,
): string {
  const hash = crypto
    .createHash('sha256')
    .update([sessionId, providerProfileId, model, agentAdapter, turnId ?? 'stable'].join('\0'))
    .digest()
  hash[6] = ((hash[6] ?? 0) & 0x0f) | 0x40
  hash[8] = ((hash[8] ?? 0) & 0x3f) | 0x80
  const hex = hash.subarray(0, 16).toString('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

function getLocalCliDefaultModel(provider: { id: string }): string {
  return isLocalCodexCliProvider(provider)
    ? LOCAL_CODEX_CLI_DEFAULT_MODEL
    : LOCAL_CLI_DEFAULT_MODEL
}

function buildCodexCliModelProviderConfig(params: {
  providerProfileId: string
  providerName: string
  apiEndpoint?: string
  apiKind: 'chat' | 'responses'
  apiKey: string
}): NonNullable<SDKExecutorConfig['codexCliProvider']> {
  const envKey = `SPARK_CODEX_API_KEY_${params.providerProfileId.replace(/[^A-Za-z0-9]/g, '_').toUpperCase()}`
  return {
    id: `spark_${params.providerProfileId}`,
    name: params.providerName,
    wireApi: params.apiKind,
    ...(params.apiEndpoint != null && params.apiEndpoint.trim().length > 0
      ? { baseUrl: params.apiEndpoint.trim() }
      : { baseUrl: 'https://api.openai.com/v1' }),
    envKey,
    env: { [envKey]: params.apiKey },
  }
}

export function isSdkResumeSafe(params: {
  providerType: string
  apiEndpoint?: string
  model: string
  agentAdapter: AgentAdapterKind
}): boolean {
  if (!ENABLE_CLAUDE_SDK_RESUME) return false

  if (params.agentAdapter !== 'claude' && params.agentAdapter !== 'claude-sdk') return false
  if (!params.model.toLowerCase().startsWith('claude')) return false
  if (params.providerType !== 'anthropic') return false
  if (params.apiEndpoint == null || params.apiEndpoint.length === 0) return true

  try {
    const url = new URL(params.apiEndpoint)
    return url.hostname === 'api.anthropic.com'
  } catch {
    return false
  }
}

function getLatestTurnPromptSnapshot(
  eventRepo: EventRepository,
  sessionId: string,
): {
  model: string
  providerProfileId?: string
  adapterKind: 'claude-sdk' | 'codex'
  sdkSessionId?: string
} | null {
  const row = eventRepo.queryBySession({ sessionId, eventType: 'turn_prompt_snapshot', limit: 1 })
    .events[0]
  if (row == null) return null
  try {
    const event = JSON.parse(row.event_json) as AgentEvent
    if (event.type !== 'turn_prompt_snapshot') return null
    return {
      model: event.model,
      adapterKind: event.adapterKind,
      ...(event.providerProfileId !== undefined
        ? { providerProfileId: event.providerProfileId }
        : {}),
      ...(event.sdkSessionId !== undefined ? { sdkSessionId: event.sdkSessionId } : {}),
    }
  } catch {
    return null
  }
}

function joinPromptSections(...sections: Array<string | undefined>): string | undefined {
  const joined = sections
    .map((section) => section?.trim())
    .filter((section): section is string => section != null && section.length > 0)
    .join('\n\n')
  return joined.length > 0 ? joined : undefined
}

function makeRuntimeLoadStatus(
  key: string,
  label: string,
  content: string | undefined,
  itemCount?: number,
): {
  key: string
  label: string
  loaded: boolean
  charCount: number
  itemCount?: number
} {
  const charCount = content?.trim().length ?? 0
  return {
    key,
    label,
    loaded: charCount > 0 || (itemCount ?? 0) > 0,
    charCount,
    ...(itemCount !== undefined ? { itemCount } : {}),
  }
}

function filterCliCompatibleMcpServers(
  servers: Record<string, SDKMcpServerConfig>,
): Record<string, SDKMcpServerConfig> {
  const result: Record<string, SDKMcpServerConfig> = {}
  for (const [name, server] of Object.entries(servers)) {
    if (server.type === 'sdk') continue
    if (server.command == null && server.url == null) continue
    result[name] = server
  }
  return result
}

function formatSelectedSkillPrompt(skillId: string, prompt: string): string {
  // IMPORTANT: do NOT use the word "Skill" as a label here. The Claude Code SDK
  // preset registers a built-in `Skill` tool (for loading Anthropic-shipped
  // skills from disk); if the LLM sees "[Selected Skill: <id>]" it will try
  // to call that tool with our custom id, which fails with "Unknown skill".
  // Our custom skills are already fully expanded into the system prompt
  // below — the agent should act on them directly, not via any tool dispatch.
  return [
    `## Active capability: ${skillId}`,
    'The full instructions for this capability are inlined below. Follow them directly. Do NOT call the built-in `Skill` tool to load it — it is already loaded.',
    prompt,
  ].join('\n\n')
}

function listSkillSummaries(
  skillRepo: SkillRepository,
  workspacePath?: string | null,
  query?: string,
): Array<{ id: string; name: string; description: string; tags: string[]; enabled: boolean }> {
  const loader = new SkillLoader(skillRepo)
  const infos = query?.trim() ? loader.search(query) : loader.listEnabled()
  const runtimeSkills = infos
    .filter((info) => {
      if (info.builtin) return true
      return info.dbRecord?.enabled === true
    })
    .map((info) => {
      const def = info.definition
      if (def != null) {
        return {
          id: def.id,
          name: def.name,
          description: def.description,
          tags: def.tags,
          enabled: true,
        }
      }
      return {
        id: info.dbRecord?.id ?? '',
        name: info.dbRecord?.name ?? '',
        description: '',
        tags: [],
        enabled: info.dbRecord?.enabled === true,
      }
    })
    .filter((skill) => skill.id.length > 0)
  const projectSkills = new ProjectContextService()
    .listSkillSummaries(workspacePath ?? undefined)
    .map((skill) => ({
      id: skill.id,
      name: skill.name,
      description: skill.description,
      tags: [],
      enabled: true,
    }))
    .filter((skill) => {
      const q = query?.trim().toLowerCase()
      if (!q) return true
      return (
        skill.id.toLowerCase().includes(q) ||
        skill.name.toLowerCase().includes(q) ||
        skill.description.toLowerCase().includes(q)
      )
    })
  return uniqueSkillSummaries([...runtimeSkills, ...projectSkills])
}

function uniqueSkillSummaries<T extends { id: string }>(skills: T[]): T[] {
  const seen = new Set<string>()
  const result: T[] = []
  for (const skill of skills) {
    if (seen.has(skill.id)) continue
    seen.add(skill.id)
    result.push(skill)
  }
  return result
}

/** 历史加载时单个 prompt 段落内容的字符上限（超出截断，原始长度仍由 charCount 记录）。 */
const HISTORY_PROMPT_SECTION_CHAR_CAP = 800

/**
 * trimHistoryEvent — 历史加载时裁剪超大事件载荷。
 *
 * 目前针对 turn_prompt_snapshot.systemPromptSections：完整系统提示词（CLAUDE.md/技能/
 * 工具/项目上下文）按「每回合」存一份，1M 上下文打满时单字段可达数 MB，每次加载、每回合
 * 都要序列化+传输+解析，是大会话卡顿的主因之一。这里把每段 content 截断到上限，charCount
 * 仍保留真实长度，Inspector 可据此提示「已截断」。其余字段（label/charCount/模型/工具数等）
 * 不动，提示词审计的概览仍可用；如需完整内容可后续按需单独拉取。
 */
function trimHistoryEvent(event: AgentEvent): AgentEvent {
  if (event.type !== 'turn_prompt_snapshot') return event
  const sections = event.systemPromptSections
  if (!Array.isArray(sections) || sections.length === 0) return event
  let trimmedAny = false
  const trimmedSections = sections.map((section) => {
    if (
      typeof section.content === 'string' &&
      section.content.length > HISTORY_PROMPT_SECTION_CHAR_CAP
    ) {
      trimmedAny = true
      return { ...section, content: section.content.slice(0, HISTORY_PROMPT_SECTION_CHAR_CAP) }
    }
    return section
  })
  if (!trimmedAny) return event
  return { ...event, systemPromptSections: trimmedSections }
}


type WorkspaceFileChangeSnapshot = Set<string>
type WorkspaceDetectedFileChange = { path: string; changeType: 'create' | 'modify' | 'delete' }

function normalizeCustomCommandConfig(value: unknown): CustomCommandConfig | null {
  if (value == null || typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  const id = typeof record.id === 'string' ? record.id : ''
  const name = typeof record.name === 'string' ? record.name : ''
  if (!id || !name) return null
  return {
    id,
    name,
    description: typeof record.description === 'string' ? record.description : '',
    prompt: typeof record.prompt === 'string' ? record.prompt : '',
    script: typeof record.script === 'string' ? record.script : '',
    scriptLanguage: record.scriptLanguage === 'python' ? 'python' : 'javascript',
    enabled: record.enabled !== false,
  }
}

async function collectWorkspaceChangeSnapshot(workspaceRootPath: string): Promise<WorkspaceFileChangeSnapshot> {
  try {
    const changes = await collectWorkspaceFileChanges(workspaceRootPath)
    return new Set(changes.map((change) => `${change.path}::${change.changeType}`))
  } catch (err) {
    log.warn(`Failed to collect workspace change snapshot: ${err instanceof Error ? err.message : String(err)}`)
    return new Set()
  }
}

async function collectWorkspaceFileChangesSince(
  workspaceRootPath: string,
  initial: WorkspaceFileChangeSnapshot,
): Promise<WorkspaceDetectedFileChange[]> {
  try {
    const changes = await collectWorkspaceFileChanges(workspaceRootPath)
    return changes.filter((change) => !initial.has(`${change.path}::${change.changeType}`))
  } catch (err) {
    log.warn(`Failed to collect workspace file changes: ${err instanceof Error ? err.message : String(err)}`)
    return []
  }
}

async function collectWorkspaceFileChanges(workspaceRootPath: string): Promise<WorkspaceDetectedFileChange[]> {
  const { execFile } = await import('node:child_process')
  const { promisify } = await import('node:util')
  const execFileAsync = promisify(execFile)
  const { stdout } = await execFileAsync('git', ['-C', workspaceRootPath, 'status', '--porcelain', '--untracked-files=all'], {
    maxBuffer: 1024 * 1024,
  })
  return stdout
    .split(/\r?\n/)
    .map(parseGitStatusPorcelainLine)
    .filter((change): change is WorkspaceDetectedFileChange => change != null)
}

function parseGitStatusPorcelainLine(line: string): WorkspaceDetectedFileChange | null {
  if (line.length < 4) return null
  const status = line.slice(0, 2)
  const rawPath = line.slice(3).trim()
  if (!rawPath || rawPath.startsWith('.spark/') || rawPath.startsWith('.spark-artifacts/')) return null
  const filePath = rawPath.includes(' -> ') ? rawPath.split(' -> ').pop()!.trim() : rawPath
  if (status === '??' || status.includes('A')) return { path: filePath, changeType: 'create' }
  if (status.includes('D')) return { path: filePath, changeType: 'delete' }
  return { path: filePath, changeType: 'modify' }
}

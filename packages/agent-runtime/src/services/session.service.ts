import crypto from 'node:crypto'
import { existsSync, realpathSync, statSync } from 'node:fs'
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
  WorkflowRunRepository,
  TeamDispatchRepository,
  TeamDiscussionRepository,
  TeamDefinitionRepository,
  MediaModelManifestRepository,
  UsageLedgerRepository,
  GoalRepository,
  ConnectorConnectionRepository,
  TurnRequestRepository,
} from '@spark/storage'
import type {
  AgentItem,
  WorkflowItem,
  SessionGoal as StoredSessionGoal,
  GoalProgressEntry,
  GoalStatus,
  TeamThreadMessageRow,
  ProviderProfileRow,
} from '@spark/storage'
import type { SparkDatabase, MemoryScopeFilter } from '@spark/storage'
import { resolveProviderApiKey } from './provider-credential-resolver.js'
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
  ProposedGoalContract,
} from '@spark/protocol'
import type { SessionPermissionMode } from '@spark/protocol'
import {
  LOCAL_CLI_DEFAULT_MODEL,
  LOCAL_CODEX_CLI_DEFAULT_MODEL,
  isMediaProviderKind,
  isBuiltInLocalCliProvider,
  isLocalCodexCliProvider,
  getAutoRouterAdapterForProviderId,
  WORKFLOW_RESTRICTABLE_TOOL_NAMES,
  type MediaProviderKind,
} from '@spark/protocol'
import { TeamDispatchService } from './team-dispatch.service.js'
import type { TeamMemberExecutionResult } from './team-dispatch.service.js'
import { runMemberExecutorIfActive } from './member-execution-lifecycle.js'
import {
  getTeamMcpHttpBridge,
  type TeamMcpBridgeHandle,
  type TeamToolDefinition,
} from './team-mcp-http-bridge.js'
import { buildMemberContinuityKey, buildTeamContinuityScope } from './team-continuity.js'
import {
  AGENT_MESSAGE_DELIVERY_MODES,
  qualifyTeamToolName,
  SPARK_TEAM_MCP_SERVER_NAME,
  type AgentMessageDeliveryMode,
  type TeamToolName,
} from './team-tool-names.js'
import { buildGoalContractDraftPrompt, parseGoalContractBlock } from './goal-contract.js'
import { loadSdkMcpFactory } from '../sdk/index.js'
import { StreamTerminalizer } from '../sdk/stream-terminalizer.js'
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
import { MANAGED_MCP_SCOPE, McpService } from './mcp-server.service.js'
import type { McpOAuthTokenProvider } from './mcp-server.service.js'
import { resolveMcpConfig } from '../mcp/index.js'
import type { McpChangeEvent } from './mcp-server.service.js'
import { PlatformBridgeService } from './platform-bridge.service.js'
import { getDebugLogServer } from './debug-log-server.service.js'
import { RuntimeCompositionService } from './runtime-composition.service.js'
import { ProjectContextService } from './project-context.service.js'
import { ValidationSuggestionService } from './validation-suggestion.service.js'
import {
  executeWorkflowAgentPlan,
  getWorkflowNodesDeep,
  getWorkflowNodeEffectiveWorkerId,
  getWorkflowNodeWorkerId,
  normalizeWorkflowGraph,
  orderWorkflowNodes,
  type NormalizedWorkflowEdge,
  type NormalizedWorkflowGraph,
  type NormalizedWorkflowNode,
  type WorkflowDispatchAttachment,
} from './workflow-executor.js'
import { WorkspaceSnapshotService, type FileSnapshot } from './workspace-snapshot.service.js'
import { CheckpointGitService } from './checkpoint-git.service.js'
import { SkillLoader } from '../skills/skill-loader.js'
import {
  ClaudeSDKExecutor,
  CodexCliExecutor,
  CodexSdkExecutor,
  isSDKAvailable,
} from '../sdk/index.js'
import type {
  SDKApprovalResult,
  SDKExecutorConfig,
  SDKMcpServerConfig,
  SDKPermissionRequestContext,
  SDKQuestionRequestContext,
  SDKTurnAttachment,
} from '../sdk/index.js'
import { getResumeCircuitBreaker } from '../sdk/index.js'
import type { CanvasToolSchema } from './canvas-mcp-server.js'
import {
  normalizeSparkReasoningEffort,
  type SparkReasoningEffort,
} from '../sdk/reasoning-effort.js'
import {
  buildConversationHistoryWithSummary,
  buildMemoryExtractionRecentContext,
} from './conversation-summarizer.js'
import { generateSessionTitle } from './session-title-generator.js'
import { MemoryRepository } from '@spark/storage'
import { MemorySearchRepository, ModelProfileRepository } from '@spark/storage'
import { MemoryEntityRepository } from '@spark/storage'
import { MemoryWriterService } from './memory/memory-writer.service.js'
import { MemoryReaderService } from './memory/memory-reader.service.js'
import { MemoryStoreService } from './memory/memory-store.service.js'
import { ModelService } from './model.service.js'
import { ModelRouterService, type ModelRouterProvider } from './model-router.service.js'
import { EmbeddingService } from './memory/embedding.service.js'
import { MemorySearchService } from './memory/memory-search.service.js'
import { MemoryEvolutionService } from './memory/memory-evolution.service.js'
import { MemoryConsolidationService } from './memory/memory-consolidation.service.js'
import { MediaModelCatalogService } from './media/media-model-catalog.service.js'
import { resolveProfileMediaModels, type MediaProfileLike } from './media/media-model-resolver.js'
import {
  AgentEventPersistenceError,
  SessionEventSequencer,
  persistAndPublishAgentEvent,
  persistAndPublishAgentEvents,
} from './session-event-sequencer.js'
import type { ProviderMediaModelRef } from '@spark/protocol'
import {
  createLogger,
  resolveProviderContextWindow,
  resolveSoftContextLimitForWindow,
} from '@spark/shared'

const log = createLogger('session.service')

type WorktreePromptMeta = {
  baseRepoRoot: string
  branch: string
  baseBranch: string
  baseWorkspaceId?: string
}

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
  context: SDKPermissionRequestContext,
) => Promise<boolean | SDKApprovalResult>
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
  context: SDKQuestionRequestContext,
) => Promise<Record<string, unknown>>
type AgentAdapterKind = 'claude' | 'claude-sdk' | 'codex'
type ActiveExecution = {
  cancel(): void
  /** Hot-swap the permission mode for the currently executing turn. */
  setPermissionMode?(mode: SessionPermissionMode): void | Promise<void>
}

export function createCodexExecutorForConfig(
  config: Pick<SDKExecutorConfig, 'useLocalConfig' | 'codexApiKind' | 'codexCliProvider'>,
): CodexCliExecutor | CodexSdkExecutor {
  if (config.useLocalConfig === true) return new CodexCliExecutor()
  void config.codexApiKind
  void config.codexCliProvider
  return new CodexSdkExecutor()
}

/** Legacy compatibility hook: Codex API providers now run through CodexSdkExecutor. */
export function isOpenAiOnlyCodexConsumer(args: {
  isCodex: boolean
  isLocalCli: boolean
  providerType: string
  codexApiKind?: 'chat' | 'responses' | undefined
}): boolean {
  void args
  return false
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
  reasoningEffort?: SparkReasoningEffort
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

type SendTurnParams = {
  sessionId: string
  message: string
  providerProfileId?: string
  modelId?: string | null
  agentId?: string
  agentAdapter?: AgentAdapterKind
  permissionMode?: SessionPermissionMode
  chatMode?: 'agent' | 'ask' | 'edit' | 'review'
  reasoningEffort?: SparkReasoningEffort
  skillId?: string
  skillParams?: Record<string, unknown>
  attachments?: SessionAttachment[]
  teamConfig?: TeamModeConfig
  mentionAgentId?: string
  interruptActive?: boolean
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
const UNATTENDED_AUTOMATION_SYSTEM_PROMPT = [
  '[Automation Execution]',
  'This turn is running as an unattended scheduled automation.',
  'Do not ask the user questions and do not call AskUserQuestion or request_user_input.',
  'Do not pause for approval or other interaction. If required context is missing, make the best reasonable assumption; if that would be unsafe, stop and return a concise blocker report instead of waiting.',
].join('\n')

type SessionUsageTotals = { totalInputTokens: number; totalOutputTokens: number; totalCost: number }

function parseGoalStatusBlock(content: string): {
  status: 'continue' | 'completed' | 'blocked' | 'failed'
  phase: 'review' | 'act' | 'validate'
  summary: string
  evidence?: string[]
  nextStep?: string
} | null {
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
  if (
    status !== 'continue' &&
    status !== 'completed' &&
    status !== 'blocked' &&
    status !== 'failed'
  )
    return null
  const normalizedPhase =
    phase === 'review' || phase === 'act' || phase === 'validate' ? phase : 'validate'
  const evidenceText = fields.get('evidence') ?? ''
  const evidence = evidenceText
    ? evidenceText
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean)
    : undefined
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
  const progress =
    goal.progressLog
      .slice(-8)
      .map(
        (entry) =>
          `- #${entry.iteration} [${entry.phase}/${entry.status}] ${entry.summary}${entry.nextStep ? ` Next: ${entry.nextStep}` : ''}`,
      )
      .join('\n') || '- No prior progress.'
  const criteria =
    goal.successCriteria.length > 0
      ? goal.successCriteria.map((item) => `- ${item}`).join('\n')
      : '- Derive concrete, verifiable completion criteria from the objective and state them before acting.'
  const constraints =
    goal.constraints.length > 0
      ? goal.constraints.map((item) => `- ${item}`).join('\n')
      : '- Preserve existing behavior unless the goal explicitly requires a change.'
  const commands = goal.validation.commands?.length
    ? goal.validation.commands.map((item) => `- ${item}`).join('\n')
    : '- Choose the narrowest safe validation command(s) available; if none can run, explain why.'
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

function getSessionUsageFromPersistence(
  db: SparkDatabase,
  eventRepo: EventRepository,
  sessionId: string,
): SessionUsageTotals | null {
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

  for (const row of eventRepo.queryBySession({
    sessionId,
    eventType: 'usage_update',
    limit: 10_000,
  }).events) {
    try {
      const event = JSON.parse(row.event_json) as Partial<AgentEvent> & {
        inputTokens?: unknown
        outputTokens?: unknown
        estimatedCostUsd?: unknown
      }
      const inputTokens = typeof event.inputTokens === 'number' ? event.inputTokens : 0
      const outputTokens = typeof event.outputTokens === 'number' ? event.outputTokens : 0
      const estimatedCostUsd =
        typeof event.estimatedCostUsd === 'number' ? event.estimatedCostUsd : 0
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
  server?: import('../sdk/types.js').SDKMcpServerConfig | undefined
  allowedTools: string[]
  toolSchemas?: ReadonlyArray<CanvasToolSchema> | undefined
  callTool?: ((sessionId: string, toolName: string, args: unknown) => Promise<unknown>) | undefined
} | null>

/** Desktop main-process provider for the visible in-app browser MCP bridge. */
export type BrowserAutomationMcpProvider = (
  sessionId: string,
  workspaceRootPath: string,
) => Promise<import('../sdk/types.js').SDKMcpServerConfig | null>

export class SessionService {
  private activeLoops = new Map<string, ActiveExecution>() // sessionId → active execution
  private activeExecutionPromises = new Map<
    ActiveExecution,
    { sessionId: string; promise: Promise<void> }
  >()
  private disposing = false
  private disposePromise: Promise<void> | null = null
  private pendingTurns = new Map<string, PendingTurn[]>()
  /** Guards the async preflight window before an executor is registered in activeLoops. */
  private readonly startingSessions = new Set<string>()
  private readonly pendingSessionEventCleanups = new Set<string>()
  private orphanEventCleanupPending = false
  /** 画布 Agent MCP server 提供器（由主进程注入） */
  private canvasMcpProvider: CanvasMcpProvider | null = null
  /** 应用内可见浏览器 MCP server 提供器（由桌面主进程注入） */
  private browserAutomationMcpProvider: BrowserAutomationMcpProvider | null = null
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
  private readonly eventSequencer = new SessionEventSequencer()
  /**
   * 当前 turn 该会话实际生效的对话模型 — 含 @mention agent 切换。
   * runFirstTurn 每解析一次 effective provider/model 就覆写一次，供
   * maybeWriteMemoryFromTurn 走 ModelService.complete() 的 settings 回退
   * 钩子读取。team 主持 agent 直接用 session 默认模型。
   */
  private readonly activeChatModelBySession = new Map<
    string,
    { providerId: string; model: string }
  >()
  private usageLedgerLastByTurn = new Map<
    string,
    {
      inputTokens: number
      outputTokens: number
      reasoningOutputTokens: number
      cacheHitTokens: number
      cacheWriteTokens: number
      estimatedCostUsd: number
    }
  >()
  private iterationOverrides = new Map<string, number>() // sessionId → per-session max turn iterations override
  private readonly commandRegistry = createBuiltinRegistry()
  private readonly mcpService: McpService
  private teamDispatchService: TeamDispatchService | null = null
  private readonly teamMcpToolNames = new WeakMap<object, ReadonlySet<string>>()
  /** FR-0b 修复（审查 B-1）：turnId → 该 turn 创建的 codex HTTP 桥接 handle；turn 结束统一 close 防 leak。 */
  private readonly teamMcpHandlesByTurn = new Map<string, Set<TeamMcpBridgeHandle>>()
  /** checkpoint git 服务（lazy；基于 git 仓库做还原点，尊重 .gitignore，还原非破坏性）。 */
  private checkpointGitService: CheckpointGitService | null = null
  /** 每会话保留的最近 checkpoint 数。 */
  private static readonly MAX_CHECKPOINTS_PER_SESSION = 20
  private readonly platformBridge: PlatformBridgeService
  /**
   * 跨 turn 复用的记忆检索栈（lazy 单例）。
   * 缓存 EmbeddingService 的 unavailableUntil 负缓存 + MemorySearchRepository 的
   * vecLoaded/vecLoadFailed 状态，避免每 turn 重建导致负缓存失效（embedding provider
   * 宕机时每轮注入首检索重走 15s HTTP 超时，直接加在用户感知首字延迟上）。
   */
  private memorySearchRepo?: MemorySearchRepository
  private memoryEmbeddingService?: EmbeddingService

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
      this.teamDispatchService = new TeamDispatchService(
        new TeamDispatchRepository(this.db),
        undefined,
        new TeamDiscussionRepository(this.db),
      )
    }
    return this.teamDispatchService
  }

  private getTeamDiscussionRepository(): TeamDiscussionRepository {
    return new TeamDiscussionRepository(this.db)
  }

  /**
   * 跨 turn 复用的记忆 embedding 服务（含 provider 宕机负缓存）。
   * 与 getMemorySearchRepo 配对初始化，确保负缓存状态跨 turn 生效。
   */
  private getMemoryEmbeddingService(): EmbeddingService {
    if (this.memoryEmbeddingService == null) {
      const settingsRepo = new SettingsRepository(this.db)
      const settingsGet = (c: string, k: string) => settingsRepo.get(c, k)
      const searchRepo = new MemorySearchRepository(this.db)
      const modelService = new ModelService(
        new ModelProfileRepository(this.db),
        new ProviderProfileRepository(this.db),
        settingsGet,
      )
      this.memorySearchRepo = searchRepo
      this.memoryEmbeddingService = new EmbeddingService(modelService, searchRepo, settingsGet)
    }
    return this.memoryEmbeddingService
  }

  /** 跨 turn 复用的 memory_search repo（vecLoaded/vecLoadFailed 状态持久）。 */
  private getMemorySearchRepo(): MemorySearchRepository {
    if (this.memorySearchRepo == null) this.getMemoryEmbeddingService()
    return this.memorySearchRepo!
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
    /**
     * 共享的 McpService 实例（来自 app 启动时的单例，已在其上跑过
     * `startAllEnabled()`）。不传时退回为自己新建一个 —— 但那个实例永远不会被
     * 启动，会导致 mcp_status / getServerStatus 对所有服务器（包括内置 playwright）
     * 永远报 disconnected，即便它们在别处已经真实连接。
     * 生产环境必须传入 apps/desktop/src/main/ipc/index.ts 的 getMcpService()。
     */
    mcpService?: McpService,
    private readonly mcpOAuthProvider?: McpOAuthTokenProvider,
  ) {
    this.mcpService = mcpService ?? new McpService(new McpServerRepository(db), mcpOAuthProvider)
    this.platformBridge = new PlatformBridgeService()
    this.mcpService.onChange((_event: McpChangeEvent) => {
      this.mcpVersion += 1
    })
    this.recoverInterruptedSessions()
    this.recoverAcceptedTurnRequests()
    this.cleanupOrphanedSessionEventsInBackground()
  }

  /** 注入画布 Agent MCP provider（主进程持有画布桥后调用一次） */
  setCanvasMcpProvider(provider: CanvasMcpProvider | null): void {
    this.canvasMcpProvider = provider
  }

  /** 注入应用内可见浏览器 MCP provider（主进程持有 BrowserWindow 桥后调用一次） */
  setBrowserAutomationMcpProvider(provider: BrowserAutomationMcpProvider | null): void {
    this.browserAutomationMcpProvider = provider
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
   * 设置当前 turn 该会话生效的对话模型（含 @mention 切换）。
   * ModelService.complete() 在 memory extraction settings 未配时调用它回退。
   */
  setActiveChatModel(sessionId: string, providerId: string, model: string): void {
    if (providerId.length === 0 || model.length === 0) return
    this.activeChatModelBySession.set(sessionId, { providerId, model })
  }

  /** 测试/调试用：清空某会话生效模型。 */
  clearActiveChatModel(sessionId: string): void {
    this.activeChatModelBySession.delete(sessionId)
  }

  /**
   * 从 sessionId 解析该会话生效的记忆 scope 集合（user + project + agent）。
   * codex CLI / claude CLI 的 stdio spark_memory 子进程通过 bridge RPC 回到主进程，
   * 这里复用与 claude SDK in-process MCP 完全相同的 scope 构造逻辑，保证两条路径
   * 的 agent 工具看到的记忆范围一致。
   */
  private resolveMemoryScopesForSession(sessionId: string): MemoryScopeFilter[] {
    const scopes: MemoryScopeFilter[] = [{ scope: 'user', scopeRef: null }]
    try {
      const sessionRepo = new SessionRepository(this.db)
      const session = sessionRepo.get(sessionId)
      if (session != null) {
        let workspaceIds: string[] = []
        try {
          workspaceIds = session.workspace_ids_json ? JSON.parse(session.workspace_ids_json) : []
        } catch {
          // ignore parse error
        }
        const workspaceId = workspaceIds[0]
        if (workspaceId != null && workspaceId.length > 0) {
          scopes.push({ scope: 'project', scopeRef: workspaceId })
        }
        if (session.agent_id != null && session.agent_id.length > 0) {
          scopes.push({ scope: 'agent', scopeRef: session.agent_id })
        }
      }
    } catch {
      // session 不在 / 表未就绪 → 仅返回 user scope
    }
    return scopes
  }

  /**
   * 记忆检索桥（codex CLI / claude CLI stdio spark_memory MCP 子进程走这条路径）。
   * 与 runFirstTurn 内 claude SDK in-process MCP 的 search_memory 工具行为一致：
   * FTS5+向量 RRF 检索 + 一跳实体扩展。
   */
  async bridgeMemorySearch(params: {
    sessionId: string
    query: string
    type?: 'user' | 'feedback' | 'project' | 'reference'
    limit?: number
  }): Promise<{
    hits: Array<{ id: string; name: string; type: string; description: string }>
    related: Array<{ id: string; name: string; type: string; description: string }>
    degraded?: boolean
  }> {
    const scopes = this.resolveMemoryScopesForSession(params.sessionId)
    const settingsRepo = new SettingsRepository(this.db)
    const settingsGet = (c: string, k: string) => settingsRepo.get(c, k)
    const searchRepo = new MemorySearchRepository(this.db)
    const modelService = new ModelService(
      new ModelProfileRepository(this.db),
      new ProviderProfileRepository(this.db),
      settingsGet,
      () => this.activeChatModelBySession.get(params.sessionId) ?? null,
    )
    const embeddingService = new EmbeddingService(modelService, searchRepo, settingsGet)
    const searchService = new MemorySearchService(searchRepo, embeddingService, settingsGet)
    const opts = {
      scopes,
      ...(params.type != null ? { type: params.type } : {}),
      limit: params.limit ?? 8,
    }
    const hits = await searchService.search(params.query, opts)
    if (hits == null) {
      return { hits: [], related: [], degraded: true }
    }
    const hitIds = new Set(hits.map((h) => h.entry.id))
    const relatedMap = new Map<
      string,
      { id: string; name: string; type: string; description: string }
    >()
    try {
      const entityRepo = new MemoryEntityRepository(this.db)
      for (const h of hits.slice(0, 3)) {
        for (const r of entityRepo.findRelated(h.entry.id, 3)) {
          if (!hitIds.has(r.id) && !relatedMap.has(r.id)) {
            relatedMap.set(r.id, {
              id: r.id,
              name: r.name,
              type: r.type,
              description: r.description,
            })
          }
        }
      }
    } catch {
      // entity 表未就绪 → 静默跳过扩展
    }
    return {
      hits: hits.map((h) => ({
        id: h.entry.id,
        name: h.entry.name,
        type: h.entry.type,
        description: h.entry.description,
      })),
      related: [...relatedMap.values()].slice(0, 5),
    }
  }

  /**
   * 记忆正文读取桥（codex CLI / claude CLI stdio spark_memory MCP 子进程用）。
   * 与 claude SDK in-process MCP 的 recall_memory 工具行为一致：读完整 markdown + bumpHit。
   */
  async bridgeMemoryRecall(params: { sessionId: string; id: string }): Promise<{
    content: string
    error?: string
  }> {
    const settingsRepo = new SettingsRepository(this.db)
    const settingsGet = (c: string, k: string) => settingsRepo.get(c, k)
    const repo = new MemoryRepository(this.db)
    // 从 sessionId 解析 workspaceRootPath（recall 读 markdown 文件需要）
    let workspaceRootPath: string | undefined
    try {
      const sessionRepo = new SessionRepository(this.db)
      const session = sessionRepo.get(params.sessionId)
      if (session != null) {
        let workspaceIds: string[] = []
        try {
          workspaceIds = session.workspace_ids_json ? JSON.parse(session.workspace_ids_json) : []
        } catch {
          // ignore
        }
        const workspaceId = workspaceIds[0]
        if (workspaceId != null && workspaceId.length > 0) {
          const wsRepo = new WorkspaceRepository(this.db)
          workspaceRootPath = wsRepo.get(workspaceId)?.root_path ?? undefined
        }
      }
    } catch {
      // ignore → recall 用默认路径
    }
    const store = new MemoryStoreService(undefined, workspaceRootPath)
    const reader = new MemoryReaderService(
      repo,
      store,
      settingsGet,
      null as unknown as MemorySearchService,
    )
    const r = await reader.recall(params.id)
    if (r.error != null) return { content: '', error: r.error }
    return { content: r.content }
  }

  /**
   * 画布工具桥（codex CLI / claude CLI stdio spark_canvas MCP 子进程走这条路径）。
   * 真实画布状态和 renderer IPC 仍由主进程 CanvasHostBridge 持有；这里仅按 sessionId
   * 找到已 attach 的桥并转发工具调用，保持 attach/detach 边界不变。
   */
  async bridgeCanvasToolCall(params: {
    sessionId: string
    toolName: string
    args: unknown
  }): Promise<unknown> {
    if (this.canvasMcpProvider == null) {
      throw new Error('Canvas MCP provider is not configured')
    }
    const canvas = await this.canvasMcpProvider(params.sessionId)
    if (canvas?.callTool == null) {
      throw new Error(`Canvas session ${params.sessionId} is not attached`)
    }
    return canvas.callTool(params.sessionId, params.toolName, params.args)
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
      const reclaimed = new TeamDispatchRepository(this.db).markStaleAsFailed(
        new Date().toISOString(),
      )
      if (reclaimed > 0)
        log.info(`Reclaimed ${reclaimed} stale team dispatch(es) after app restart`)
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

  private recoverAcceptedTurnRequests(): void {
    const repo = new TurnRequestRepository(this.db)
    const sessionsToStart = new Set<string>()
    for (const row of repo.listRecoverable()) {
      if (row.status === 'running') {
        repo.markFailed(row.id, 'Turn interrupted by application restart')
        continue
      }
      try {
        const payload = JSON.parse(row.payload_json) as PendingTurn
        if (typeof payload.message !== 'string') throw new Error('Invalid turn request payload')
        this.enqueueTurn(row.session_id, {
          ...payload,
          turnId: row.id,
          enqueuedAt: row.created_at,
        })
        sessionsToStart.add(row.session_id)
      } catch (error) {
        repo.markFailed(row.id, error instanceof Error ? error.message : String(error))
      }
    }
    for (const sessionId of sessionsToStart) {
      setTimeout(() => this.startNextQueuedTurn(sessionId), 0)
    }
  }

  async createSession(params: {
    providerProfileId: string
    modelId?: string
    agentId?: string
    agentAdapter?: AgentAdapterKind
    permissionMode?: SessionPermissionMode
    chatMode?: 'agent' | 'ask' | 'edit' | 'review'
    reasoningEffort?: SparkReasoningEffort
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
    const { session } = await this.updateSession({ sessionId: row.id })
    return { sessionId: row.id as SessionId, createdAt: row.created_at, session }
  }

  async executeCommand(params: { sessionId: string; message: string }): Promise<
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
          agentAdapter: getAgentAdapterFromSession(
            s.agent_adapter,
            s.chat_mode,
            providerRepo.get(s.provider_profile_id ?? '')?.provider_type ?? null,
          ),
          permissionMode: getPermissionModeFromSession(
            s.permission_mode,
            getAgentAdapterFromSession(
              s.agent_adapter,
              s.chat_mode,
              providerRepo.get(s.provider_profile_id ?? '')?.provider_type ?? null,
            ),
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
        this.eventSequencer.clear(id)
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
        this.restoreCheckpointViaSnapshot(id, checkpointRef),
      getCheckpointEnabled: (id) => this.getSessionCheckpointEnabled(id),
      setCheckpointEnabled: (id, enabled) => this.setSessionCheckpointEnabled(id, enabled),
      listSkills: (query) => listSkillSummaries(new SkillRepository(this.db), workspacePath, query),
      getSessionRuntimeInfo: (id) => {
        const s = sessionRepo.get(id)
        if (s == null) return null
        const provider = providerRepo.get(s.provider_profile_id ?? '')
        const adapter = getAgentAdapterFromSession(
          s.agent_adapter,
          s.chat_mode,
          provider?.provider_type ?? null,
        )
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
      getMcpStatusSummary: () =>
        this.mcpService.listServers().map((server) => ({
          id: server.id,
          name: server.name,
          enabled: server.enabled,
          ...this.mcpService.getServerStatus(server.id),
        })),
      getCurrentAgentSummary: (id) => {
        const s = sessionRepo.get(id)
        const agentId = s?.agent_id ?? 'platform-manager-agent'
        const agent = new AgentRepository(this.db).get(agentId)
        if (agent == null)
          return {
            id: agentId,
            name: agentId,
            exists: false,
            enabled: false,
            hasModelConfig: false,
          }
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
      setGoal: async (id, objective, options) =>
        (
          await this.setGoal({
            sessionId: id,
            objective,
            ...(options?.successCriteria != null
              ? { successCriteria: options.successCriteria }
              : {}),
            ...(options?.validationCommands != null
              ? { validation: { commands: options.validationCommands } }
              : {}),
          })
        ).goal as unknown as Record<string, unknown>,
      getGoal: (id) => this.getGoal(id).goal as unknown as Record<string, unknown> | null,
      controlGoal: async (id, action, summary) =>
        (await this.controlGoal({ sessionId: id, action, ...(summary != null ? { summary } : {}) }))
          .goal as unknown as Record<string, unknown> | null,
      confirmGoalContract: async (id) =>
        (await this.confirmGoalContract({ sessionId: id })).goal as unknown as Record<
          string,
          unknown
        > | null,
      rejectGoalContract: async (id) =>
        (await this.rejectGoalContract({ sessionId: id })).goal as unknown as Record<
          string,
          unknown
        > | null,
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
          agentAdapter: getAgentAdapterFromSession(
            s.agent_adapter,
            s.chat_mode,
            providerRepo.get(s.provider_profile_id ?? '')?.provider_type ?? null,
          ),
          permissionMode: getPermissionModeFromSession(
            s.permission_mode,
            getAgentAdapterFromSession(
              s.agent_adapter,
              s.chat_mode,
              providerRepo.get(s.provider_profile_id ?? '')?.provider_type ?? null,
            ),
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
        this.eventSequencer.clear(id)
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
        this.restoreCheckpointViaSnapshot(id, checkpointRef),
      getCheckpointEnabled: (id) => this.getSessionCheckpointEnabled(id),
      setCheckpointEnabled: (id, enabled) => this.setSessionCheckpointEnabled(id, enabled),
      listSkills: (query) => listSkillSummaries(new SkillRepository(this.db), workspacePath, query),
      getSessionRuntimeInfo: (id) => {
        const s = sessionRepo.get(id)
        if (s == null) return null
        const provider = providerRepo.get(s.provider_profile_id ?? '')
        const adapter = getAgentAdapterFromSession(
          s.agent_adapter,
          s.chat_mode,
          provider?.provider_type ?? null,
        )
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
      getMcpStatusSummary: () =>
        this.mcpService.listServers().map((server) => ({
          id: server.id,
          name: server.name,
          enabled: server.enabled,
          ...this.mcpService.getServerStatus(server.id),
        })),
      getCurrentAgentSummary: (id) => {
        const s = sessionRepo.get(id)
        const agentId = s?.agent_id ?? 'platform-manager-agent'
        const agent = new AgentRepository(this.db).get(agentId)
        if (agent == null)
          return {
            id: agentId,
            name: agentId,
            exists: false,
            enabled: false,
            hasModelConfig: false,
          }
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
      setGoal: async (id, objective, options) =>
        (
          await this.setGoal({
            sessionId: id,
            objective,
            ...(options?.successCriteria != null
              ? { successCriteria: options.successCriteria }
              : {}),
            ...(options?.validationCommands != null
              ? { validation: { commands: options.validationCommands } }
              : {}),
          })
        ).goal as unknown as Record<string, unknown>,
      getGoal: (id) => this.getGoal(id).goal as unknown as Record<string, unknown> | null,
      controlGoal: async (id, action, summary) =>
        (await this.controlGoal({ sessionId: id, action, ...(summary != null ? { summary } : {}) }))
          .goal as unknown as Record<string, unknown> | null,
      confirmGoalContract: async (id) =>
        (await this.confirmGoalContract({ sessionId: id })).goal as unknown as Record<
          string,
          unknown
        > | null,
      rejectGoalContract: async (id) =>
        (await this.rejectGoalContract({ sessionId: id })).goal as unknown as Record<
          string,
          unknown
        > | null,
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
    // wipeHistory 的命令（典型 /clear）会先 emit 一条 SessionHistoryResetEvent，
    // 让 renderer 在新 user/assistant 事件到达前清空本地缓存。
    const baseEventCount = shouldEmitCompleted ? 3 : 2
    const totalEventCount = baseEventCount + (wipeHistory ? 1 : 0)
    const seq0 = this.eventSequencer.reserve(params.sessionId, eventRepo, totalEventCount)
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

    try {
      persistAndPublishAgentEvents(eventRepo, commandEvents, this.onEvent)
    } catch (err) {
      if (err instanceof AgentEventPersistenceError) {
        log.error('Failed to persist command events', {
          sessionId: params.sessionId,
          turnId,
          error: err.message,
        })
      }
      throw err
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

  async sendTurn(params: SendTurnParams): Promise<{ turnId: string; started: boolean }> {
    return this.dispatchTurn(params, false)
  }

  async submitTurn(
    params: SendTurnParams,
    options: { startAfter?: Promise<unknown> } = {},
  ): Promise<{ turnId: string; accepted: true; started: boolean }> {
    const result = await this.dispatchTurn(params, true, options.startAfter)
    return { ...result, accepted: true }
  }

  private async dispatchTurn(
    params: SendTurnParams,
    durable: boolean,
    startAfter?: Promise<unknown>,
  ): Promise<{ turnId: string; started: boolean }> {
    if (this.disposing) throw new Error('Session service is shutting down')
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
    const pendingTurn = this.makePendingTurn(
      turnId,
      message,
      runtimePatch,
      skillId,
      skillParams,
      attachments,
      mentionAgentId,
    )
    if (durable) {
      new TurnRequestRepository(this.db).create({
        id: turnId,
        sessionId,
        payloadJson: JSON.stringify(pendingTurn),
        createdAt: pendingTurn.enqueuedAt,
      })
    }
    const currentGoal = new GoalRepository(this.db).getCurrent(sessionId)
    if (currentGoal?.status === 'active') {
      this.enqueueTurn(sessionId, pendingTurn)
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
        this.enqueueTurn(sessionId, pendingTurn)
        return { turnId, started: false }
      }
    }

    if (durable) {
      this.enqueueTurn(sessionId, pendingTurn)
      const scheduleStart = () => setTimeout(() => this.startNextQueuedTurn(sessionId), 0)
      if (startAfter == null) {
        scheduleStart()
      } else {
        void startAfter
          .catch((error) => {
            log.warn('Turn workspace preparation failed; runtime preflight will report the error', {
              sessionId,
              turnId,
              error: error instanceof Error ? error.message : String(error),
            })
          })
          .finally(scheduleStart)
      }
      return { turnId, started: true }
    }

    try {
      await this.startTurn(
        sessionId,
        turnId,
        message,
        runtimePatch,
        skillId,
        skillParams,
        attachments,
        mentionAgentId,
      )
    } catch (error) {
      this.handleQueuedTurnStartFailure(sessionId, pendingTurn, error)
      throw error
    }
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
        this.makePendingTurn(
          turnId,
          message,
          runtimePatch,
          skillId,
          skillParams,
          attachments,
          mentionAgentId,
        ),
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
    const automation = getAutomationMetadata(session.metadata_json)
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
    const workflow =
      agent.workflowId != null ? new WorkflowRepository(this.db).get(agent.workflowId) : null
    const workflowGraph = workflow != null ? normalizeWorkflowGraph(workflow.graph) : undefined
    const workflowMembers =
      workflowGraph != null ? this.resolveWorkflowMembers(workflowGraph, agent) : []
    const enabledWorkflowWorkerIds = new Set(workflowMembers.map((member) => member.id))
    // Provider / model：mention 时优先用被 @ Agent 自己的配置，未配置则回退会话默认。
    const effectiveProviderProfileId = isMentionTurn
      ? (agent.providerProfileId ?? session.provider_profile_id)
      : session.provider_profile_id
    if (effectiveProviderProfileId == null) {
      throw new Error(`Session ${sessionId} has no provider profile`)
    }

    const existingEventCount = eventRepo.countBySession(sessionId)
    const currentSeq = this.eventSequencer.peek(sessionId, eventRepo)
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
    let effectiveRuntimeProviderProfileId = effectiveProviderProfileId
    const modelProfilesForRouting = new ModelProfileRepository(this.db).list()
    const providersForRouting = providerRowsForModelRouter(providerRepo.listAll())
    const requestedModel = (isMentionTurn ? agent.modelId : null) ?? session.model_id
    const loadProvider = (providerProfileId: string) => {
      const row = providerRepo.get(providerProfileId)
      if (row == null) {
        throw new Error(`Provider profile not found: ${providerProfileId}`)
      }
      return row
    }
    const autoRouterAdapter = getAutoRouterAdapterForProviderId(effectiveRuntimeProviderProfileId)
    let provider: ProviderProfileRow
    let isLocalCli: boolean

    let config: {
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
    let model: string

    if (autoRouterAdapter != null) {
      const selectedRoutingModelId = requestedModel?.trim() ?? ''
      if (!selectedRoutingModelId) {
        throw new Error(
          `Auto router ${effectiveRuntimeProviderProfileId} requires a routing model card`,
        )
      }
      const routeSelection = new ModelRouterService().resolveModelSelection({
        selectedModelId: selectedRoutingModelId,
        modelProfiles: modelProfilesForRouting,
        providers: providersForRouting,
        message,
        estimatedTokens: Math.ceil(((conversationHistoryPrompt?.length ?? 0) + message.length) / 3),
      })
      if (routeSelection == null) {
        throw new Error(`Routing model not found or disabled: ${selectedRoutingModelId}`)
      }
      if (routeSelection.adapter !== autoRouterAdapter) {
        throw new Error(
          `Routing model adapter mismatch: expected ${autoRouterAdapter}, got ${routeSelection.adapter}`,
        )
      }
      effectiveRuntimeProviderProfileId = routeSelection.providerProfileId
      provider = loadProvider(effectiveRuntimeProviderProfileId)
      isLocalCli = isBuiltInLocalCliProvider(provider)
      config = JSON.parse(provider.config_json) as typeof config
      model = routeSelection.modelId
    } else {
      provider = loadProvider(effectiveRuntimeProviderProfileId)
      isLocalCli = isBuiltInLocalCliProvider(provider)
      config = JSON.parse(provider.config_json) as typeof config
      model = isLocalCli
        ? getLocalCliDefaultModel(provider)
        : (requestedModel ?? config.defaultModel ?? config.model ?? '')
      if (model.length === 0) {
        throw new Error(`Provider ${provider.id} has no default model configured`)
      }
    }
    if (!isLocalCli && provider.keystore_ref == null) {
      throw new Error(`Provider ${provider.id} has no keystore ref`)
    }

    const apiKey = isLocalCli ? '' : await resolveProviderApiKey(provider)
    if (!isLocalCli && apiKey.length === 0) {
      throw new Error(`API key not found for provider ${provider.id}`)
    }

    // 记忆抽取 settings 未配时回退：本 turn 该会话 / @mention agent 实际生效的对话模型。
    // team 主持 agent 走 session 默认值；@mention 切到成员 agent 时切到成员自己的
    // providerProfileId + agent.modelId。
    this.activeChatModelBySession.set(sessionId, { providerId: provider.id, model })

    const agentAdapter = getAgentAdapterFromSession(
      isMentionTurn ? (agent.agentAdapter ?? session.agent_adapter) : session.agent_adapter,
      session.chat_mode,
      provider.provider_type,
    )
    const adapterKind =
      agentAdapter === 'claude-sdk' || agentAdapter === 'claude' ? 'claude-sdk' : 'codex'
    // 非 mention turn 保持现有 hash（向后兼容续会话）；
    // mention turn 把被 @ 的 agent.id 加入 hash，避免与 Host SDK session 冲突且让重复 @ 同一 member 可续会话。
    const stableSdkSessionId = isMentionTurn
      ? makeSdkRuntimeSessionId(
          sessionId,
          effectiveRuntimeProviderProfileId,
          model,
          agentAdapter,
          `mention:${agent.id}`,
        )
      : makeSdkRuntimeSessionId(sessionId, effectiveRuntimeProviderProfileId, model, agentAdapter)
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
      previousPromptSnapshot.providerProfileId === effectiveRuntimeProviderProfileId &&
      previousPromptSnapshot.sdkSessionId === stableSdkSessionId
    const sdkSessionId = sdkResumeSafe
      ? stableSdkSessionId
      : makeSdkRuntimeSessionId(
          sessionId,
          effectiveRuntimeProviderProfileId,
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
    let workspaceInfo:
      | {
          name: string
          rootPath: string
          projectKind: string
          worktreeMeta?: WorktreePromptMeta
        }
      | undefined
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
        const worktreeMeta =
          typeof ws.worktree_meta_json === 'string' && ws.worktree_meta_json.trim().length > 0
            ? parseWorktreePromptMeta(ws.worktree_meta_json)
            : undefined
        workspaceInfo = {
          name: ws.name,
          rootPath: ws.root_path,
          projectKind: ws.project_kind,
          ...(worktreeMeta ? { worktreeMeta } : {}),
        }
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
    const presentFilesMcpServer = resolvePresentFilesMcpServer(workspaceRootPath)
    // 调试模式（per-session 能力开关）：开启时挂载 spark_debug + 注入状态机 prompt。
    const debugModeEnabled = getDebugModeFromMetadata(session.metadata_json)
    const debugMcpServer = debugModeEnabled
      ? await this.resolveDebugMcpServer(sessionId, workspaceRootPath)
      : null
    const browserAutomationMcpServer =
      this.browserAutomationMcpProvider != null
        ? await this.browserAutomationMcpProvider(sessionId, workspaceRootPath)
        : null
    const sparkWebToolEnabled =
      runtimeContext.skillConfig.effectiveSkillIds.includes('builtin:spark-web-tool')
    const workflowCanUseManagedExecutor =
      workflowGraph != null &&
      hasWorkflowExecutableNodes(workflowGraph, enabledWorkflowWorkerIds, agent.id)
    const workflowExecutionMode =
      workflowGraph == null || !workflowCanUseManagedExecutor || isMentionTurn
        ? 'guided'
        : agentAdapter === 'claude-sdk' || agentAdapter === 'claude'
          ? 'workflow_run'
          : 'codex_guided'
    const managedAgentPrompt = buildManagedAgentSystemPrompt(agent, workflow, workflowExecutionMode)

    // ── Team Mode：解析会话团队配置，构建 spark_team in-process MCP server + 花名册 ──
    // Mention 路由：被 @ 的 Member 直接响应，不注入 spark_team（不允许它再 dispatch，符合"互调暂缓"原则）。
    const teamConfig = sessionTeamConfig
    let teamMcpServer: SDKMcpServerConfig | undefined
    let teamRosterPrompt = ''
    let teamInstructionsPrompt = ''
    let orchestrationModePrompt = ''
    if (!isMentionTurn) {
      const teamMembers = teamConfig?.enabled
        ? this.resolveTeamMembers(teamConfig.memberAgentIds, agent.id)
        : []
      const hasDispatchableTeamMembers = teamMembers.length > 0
      let activeDiscussionId: string | undefined
      let activeDiscussionRound = 0
      const hasWorkflowExecutionPlan = workflowCanUseManagedExecutor
      const hasDispatchableWorkflow = workflowGraph != null && enabledWorkflowWorkerIds.size > 0
      if (teamConfig?.enabled) {
        teamRosterPrompt = buildTeamRosterPrompt(agent, teamMembers, teamConfig)
      }
      // 若会话由某个长期团队（ManagedTeam）应用而来，则把团队专属 prompt 作为
      // [Team Instructions] 段注入，紧跟在 [Team Roster] 之后。即使长期团队被删除
      // 或被禁用，此处也按当前 DB 状态读取一次：缺失则跳过，不报错。
      if (teamConfig?.enabled && teamConfig.teamId != null) {
        try {
          const team = new TeamDefinitionRepository(this.db).get(teamConfig.teamId)
          if (team != null && team.prompt.trim().length > 0) {
            teamInstructionsPrompt = `[Team Instructions]\n${team.prompt.trim()}`
          }
        } catch {
          // 静默：长期团队 prompt 是可选增强，DB 读取失败时降级为无 prompt 模式
        }
      }
      if (hasDispatchableTeamMembers || hasWorkflowExecutionPlan) {
        if (teamConfig?.enabled && hasDispatchableTeamMembers) {
          const discussionRepo = this.getTeamDiscussionRepository()
          const activeDiscussion =
            discussionRepo.findActiveBySession(sessionId) ??
            discussionRepo.createDiscussion({
              id: crypto.randomUUID(),
              sessionId,
              hostAgentId: agent.id,
              topic: message.slice(0, 240).trim() || null,
              maxRounds:
                teamConfig.maxDiscussionRounds ??
                TeamDiscussionRepository.clampMaxRounds(undefined),
            })
          activeDiscussionId = activeDiscussion.id
          activeDiscussionRound = activeDiscussion.round_index
        }
        const dispatchMembers = [
          ...new Map(
            [...teamMembers, ...workflowMembers].map((member) => [member.id, member]),
          ).values(),
        ]
        const dispatchTeamConfig =
          hasDispatchableTeamMembers && teamConfig?.enabled
            ? teamConfig
            : {
                enabled: true,
                hostAgentId: agent.id,
                memberAgentIds: [...enabledWorkflowWorkerIds],
                maxDepth: 1,
                allowNesting: false,
              }
        teamMcpServer =
          (await this.createTeamMcpServer({
            sessionId,
            turnId,
            hostAgent: agent,
            members: dispatchMembers,
            teamConfig: dispatchTeamConfig,
            workspaceRootPath,
            eventRepo,
            hostPermissionMode: permissionMode,
            consumerAdapter: agentAdapter,
            codexConsumerIsOpenAi: isOpenAiOnlyCodexConsumer({
              isCodex: agentAdapter !== 'claude' && agentAdapter !== 'claude-sdk',
              isLocalCli,
              providerType: provider.provider_type,
              codexApiKind: config.codexApiKind,
            }),
            exposeTeamDispatchTools: hasDispatchableTeamMembers,
            ...(hasWorkflowExecutionPlan
              ? {
                  workflowGraph,
                  workflowWorkerIds: enabledWorkflowWorkerIds,
                  ...(workflow?.id != null ? { workflowId: workflow.id } : {}),
                  ...(attachments != null && attachments.length > 0
                    ? { workflowAttachments: mapSessionAttachmentsToDispatch(attachments) }
                    : {}),
                }
              : {}),
            ...(activeDiscussionId != null
              ? {
                  discussionId: activeDiscussionId,
                  discussionRoundIndex: activeDiscussionRound,
                }
              : {}),
          })) ?? undefined
        // 告诉 UI（及下面拼进系统提示词的编排提示）：本轮宿主进入编排模式（保留全量
        // 工具，提示词引导「优先派发」——不再剥离 Edit/Write/Bash，产品决策 2026-07-04）。
        if (teamMcpServer != null) {
          this.emitAndPersist(
            sessionId,
            turnId,
            {
              id: crypto.randomUUID(),
              type: 'orchestration_status',
              sessionId,
              turnId,
              timestamp: new Date().toISOString(),
              seq: 0,
              active: true,
              source: hasDispatchableTeamMembers ? 'team' : 'workflow',
              hostAgentId: agent.id,
              hostAgentName: agent.name,
              memberCount: dispatchMembers.length,
            },
            eventRepo,
          )
          orchestrationModePrompt = buildOrchestrationModeSystemPrompt(
            hasDispatchableTeamMembers ? 'team' : 'workflow',
            dispatchMembers.length,
          )
        }
      }
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
      // peer messaging 开启时，被 @ 的成员同样要拿到「花名册 + agent_message 工具 + 讨论线程」——
      // 否则用户直接 @ 成员并让它找队友协作时，成员既不知道团队里有谁、也没有任何联系工具，
      // 只能回答"找不到那个成员"。exposeTeamDispatchTools=false：被 @ 成员可对话，不可派发。
      // 信息与能力分离（2026-07-04 空会话实测修正）：
      //  - 花名册（信息）**无条件**注入——peer messaging 关着时成员也必须知道团队里有谁，
      //    否则会答"当前会话只有我一个角色"甚至拿 agents_create 瞎凑方案；
      //  - agent_message 工具 + 讨论线程（能力）仍受 enablePeerMessaging 门控。
      const mentionTeamMembers = this.resolveTeamMembers(
        teamConfig.memberAgentIds,
        teamConfig.hostAgentId,
      )
      if (mentionTeamMembers.length > 0) {
        const mentionPeerOn = teamConfig.enablePeerMessaging === true
        let mentionDiscussion: { id: string; round_index: number } | undefined
        let mentionThreadSnippet: string | undefined
        if (mentionPeerOn) {
          const discussionRepo = this.getTeamDiscussionRepository()
          const activeDiscussion =
            discussionRepo.findActiveBySession(sessionId) ??
            discussionRepo.createDiscussion({
              id: crypto.randomUUID(),
              sessionId,
              hostAgentId: teamConfig.hostAgentId,
              topic: message.slice(0, 240).trim() || null,
              maxRounds:
                teamConfig.maxDiscussionRounds ??
                TeamDiscussionRepository.clampMaxRounds(undefined),
            })
          mentionDiscussion = activeDiscussion
          mentionThreadSnippet = discussionRepo.renderThreadForPrompt(
            activeDiscussion.id,
            teamConfig.threadContextTokenBudget,
            agent.id,
          )
        }
        const hostAgentItem = new AgentRepository(this.db).get(teamConfig.hostAgentId) ?? agent
        teamRosterPrompt = buildTeamRosterPrompt(hostAgentItem, mentionTeamMembers, teamConfig, {
          perspective: 'member',
          viewingMember: agent,
          enablePeerMessaging: mentionPeerOn,
          // mention 直答路径保留 SDK 原生 Task/SendMessage（用户点名的成员是完整 turn），
          // 提示词消歧两套通信系统，而不是禁用原生能力。
          nativeSubagentToolsAvailable: true,
          ...(mentionThreadSnippet != null ? { threadSnippet: mentionThreadSnippet } : {}),
        })
        if (mentionPeerOn && mentionDiscussion != null) {
          teamMcpServer =
            (await this.createTeamMcpServer({
              sessionId,
              turnId,
              hostAgent: agent,
              members: mentionTeamMembers,
              teamConfig,
              workspaceRootPath,
              eventRepo,
              hostPermissionMode: permissionMode,
              consumerAdapter: agentAdapter,
              codexConsumerIsOpenAi: isOpenAiOnlyCodexConsumer({
                isCodex: agentAdapter !== 'claude' && agentAdapter !== 'claude-sdk',
                isLocalCli,
                providerType: provider.provider_type,
                codexApiKind: config.codexApiKind,
              }),
              exposeTeamDispatchTools: false,
              discussionId: mentionDiscussion.id,
              discussionRoundIndex: mentionDiscussion.round_index,
            })) ?? undefined
        }
      }
    }

    // ── Memory System：加载长期记忆注入 system prompt ──
    let memoryBlock: string | undefined
    try {
      const settingsRepo = new SettingsRepository(this.db)
      const settingsGet = (cat: string, key: string) => settingsRepo.get(cat, key)
      const memoryEnabled = settingsGet('memory', 'enabled')
      const memoryDisabled = memoryEnabled === false || memoryEnabled === 0
      const memoryRepo = new MemoryRepository(this.db)
      const memoryStore = new MemoryStoreService(undefined, workspaceRootPath)
      // V2 检索栈：跨 turn 复用（getMemoryEmbeddingService 缓存负缓存状态），
      // 让会话注入从「全量 description」升级为「feedback 全量 + 其余按种子查询的相关子集」。
      const memorySearchRepo = this.getMemorySearchRepo()
      const embeddingService = this.getMemoryEmbeddingService()
      const modelService = new ModelService(
        new ModelProfileRepository(this.db),
        new ProviderProfileRepository(this.db),
        settingsGet,
        () => this.activeChatModelBySession.get(sessionId) ?? null,
      )
      const memorySearchService = new MemorySearchService(
        memorySearchRepo,
        embeddingService,
        settingsGet,
      )
      // 触发检索索引回填 + 整合 job —— 仅在 memory.enabled 时（禁用时不产生 embedding API
      // 调用 / 向量写入 / 整合 LLM 调用 / 全量 FTS 回填）。loadForSession 内部也有 enabled 短路。
      if (!memoryDisabled) {
        try {
          memorySearchRepo.backfillFtsIfNeeded()
        } catch (err) {
          log.debug(
            `memory FTS backfill skipped: ${err instanceof Error ? err.message : String(err)}`,
          )
        }
        void embeddingService.backfillMissingVectors()
        // 整合 job 触发（fire-and-forget）：条目达阈值 + 距上次整合≥间隔时回顾 MERGE/ELEVATE。
        try {
          const memModelService = modelService
          const memCallLLM = async (prompt: string): Promise<string> => {
            const r = await memModelService.complete(prompt)
            return r.available ? r.text : '[]'
          }
          const memEntityRepo = new MemoryEntityRepository(this.db)
          const consolidationService = new MemoryConsolidationService(
            memoryRepo,
            memoryStore,
            settingsGet,
            memCallLLM,
            memEntityRepo,
            (c: string, k: string, v: unknown) => settingsRepo.set(c, k, v),
          )
          const consoScopes: Array<{
            scope: 'user' | 'project' | 'agent'
            scopeRef: string | null
          }> = [{ scope: 'user', scopeRef: null }]
          if (primaryWorkspaceId != null && primaryWorkspaceId.length > 0) {
            consoScopes.push({ scope: 'project', scopeRef: primaryWorkspaceId })
          }
          consoScopes.push({ scope: 'agent', scopeRef: agent.id })
          // info 级让"整合 job 是否被触发"在默认日志级别下可观测（审查 HIGH#17）
          log.info(`memory consolidation trigger fired for agent=${agent.id} (fire-and-forget)`)
          void consolidationService.maybeConsolidate(consoScopes)
        } catch (err) {
          log.warn(
            `memory consolidation trigger failed: ${err instanceof Error ? err.message : String(err)}`,
          )
        }
      }
      const memoryReader = new MemoryReaderService(
        memoryRepo,
        memoryStore,
        settingsGet,
        memorySearchService,
      )
      // 种子查询：agent 身份 + workspace 名，驱动非 feedback 记忆的相关性检索
      const wsName = workspaceRootPath ? path.basename(workspaceRootPath) : ''
      const seedQuery = [agent.name, agent.description, wsName]
        .filter((s) => typeof s === 'string' && s.length > 0)
        .join(' ')
        .slice(0, 500)
      const memoryInjection = await memoryReader.loadForSession({
        workspaceId: primaryWorkspaceId ?? '',
        agentId: agent.id,
        ...(seedQuery.length > 0 ? { seedQuery } : {}),
      })
      memoryBlock = memoryInjection.block || undefined
      if (memoryBlock != null) {
        log.debug(`Memory injected: ${memoryInjection.injectedIds.length} entries`)
      }
    } catch (err) {
      log.warn(
        `Memory injection failed (non-fatal): ${err instanceof Error ? err.message : String(err)}`,
      )
    }

    const allowedMcpServerIds = getAllowedMcpServerIds(agent, workflow)
    const appMcpAvailabilityPrompt = buildAppMcpAvailabilityPrompt({
      servers: this.mcpService.listServers(),
      allowedServerIds: allowedMcpServerIds,
    })

    const composedSystemPrompt = joinPromptSections(
      managedAgentPrompt,
      teamMemberContextPrompt,
      orchestrationModePrompt,
      teamRosterPrompt,
      teamInstructionsPrompt,
      buildWorktreeSessionSystemPrompt(workspaceInfo),
      // Task 子代理是 Claude Agent SDK 的原生能力，Codex CLI 路径没有对应工具，
      // 引导语只在 claude-sdk/claude adapter 下注入，避免对 Codex 会话产生误导。
      agentAdapter === 'claude-sdk' || agentAdapter === 'claude'
        ? SUBAGENT_USAGE_HINT_SYSTEM_PROMPT
        : undefined,
      automation.unattended ? UNATTENDED_AUTOMATION_SYSTEM_PROMPT : undefined,
      runtimeRulesPrompt,
      appMcpAvailabilityPrompt,
      memoryBlock,
      // 记忆行为引导紧跟 memoryBlock：先让 agent 看到具体记忆摘要，再说明两套记忆的
      // 区别与"记住"路由规则。无条件注入（所有 adapter 都挂载了应用记忆工具）。
      MEMORY_BEHAVIOR_SYSTEM_PROMPT,
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
      presentFilesMcpServer != null ? PRESENT_FILES_SYSTEM_PROMPT : undefined,
      browserAutomationMcpServer != null ? BROWSER_AUTOMATION_SYSTEM_PROMPT : undefined,
      debugMcpServer != null ? DEBUG_MODE_SYSTEM_PROMPT : undefined,
      sparkWebToolEnabled ? SPARK_WEB_TOOL_SYSTEM_PROMPT : undefined,
    )

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
        makeRuntimeLoadStatus(
          'team-roster',
          'Team Roster',
          teamRosterPrompt,
          teamConfig?.memberAgentIds.length,
        ),
        makeRuntimeLoadStatus('team-instructions', 'Team Instructions', teamInstructionsPrompt),
        makeRuntimeLoadStatus(
          'rules',
          'Rules',
          runtimeRulesPrompt,
          activeRules.length + managedRules.length,
        ),
        makeRuntimeLoadStatus('memory', 'Memory', memoryBlock),
        makeRuntimeLoadStatus(
          'system-prompt',
          'System Prompt Layer',
          runtimeContext.promptConfig.system.content,
        ),
        makeRuntimeLoadStatus(
          'agent-prompt',
          'Agent Prompt Layer',
          runtimeContext.promptConfig.agent.content,
        ),
        makeRuntimeLoadStatus(
          'project-prompt',
          'Project Prompt Layer',
          runtimeContext.promptConfig.project.content,
        ),
        makeRuntimeLoadStatus(
          'session-prompt',
          'Session Prompt Layer',
          runtimeContext.promptConfig.session.content,
        ),
        makeRuntimeLoadStatus(
          'project-context',
          'Project Context',
          projectContext.systemPrompt,
          projectContext.sources.length,
        ),
        makeRuntimeLoadStatus('selected-skill', 'Selected Skill Prompt', explicitSkillPrompt),
        makeRuntimeLoadStatus(
          'available-skills',
          'Available Skills Catalog',
          runtimeContext.skillSystemPrompt,
          runtimeContext.skillConfig.effectiveSkillIds.length,
        ),
        makeRuntimeLoadStatus(
          'conversation-history',
          'Conversation History',
          conversationHistoryPrompt,
        ),
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
          providerProfileId: effectiveRuntimeProviderProfileId,
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
          estimatedTokens:
            projectContext.budget?.usedTokens ?? estimateSectionTokens(projectContext.systemPrompt),
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
    const goalConfig =
      activeGoalForTurn?.status === 'active'
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
        ...(automation.unattended ? { unattended: true } : {}),
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
        ...(platformMcpServer != null ? { platformManagementMcpServer: platformMcpServer } : {}),
        ...(webSearchMcpServer != null ? { webSearchMcpServer } : {}),
        ...(presentFilesMcpServer != null ? { presentFilesMcpServer } : {}),
        ...(browserAutomationMcpServer != null ? { browserAutomationMcpServer } : {}),
        ...(debugMcpServer != null ? { debugMcpServer } : {}),
        ...(iterationOverride != null ? { maxTurnCount: iterationOverride } : {}),
        ...(config.maxTokens != null ? { maxTokens: config.maxTokens } : {}),
        contextWindowTokens,
        ...(session.reasoning_effort != null
          ? { reasoningEffort: normalizeReasoningEffort(session.reasoning_effort) }
          : {}),
        ...(turnAttachments.length > 0 ? { attachments: turnAttachments } : {}),
        ...(attachmentDirectories.length > 0
          ? { additionalDirectories: attachmentDirectories }
          : {}),
        enableCheckpoints: true,
        sdkSessionId,
        continueSession: canResumeSdkSession,
        ...(this.onHookTrigger != null
          ? { applicationHookCallback: this.onHookTrigger }
          : {}),
        ...(this.onApproval != null
          ? {
              approvalCallback: async (
                sid: string,
                toolName: string,
                toolInput: Record<string, unknown>,
                context: SDKPermissionRequestContext,
              ) => {
                this.emitAgentStatusEvent(sid, turnId, eventRepo, 'waiting_permission')
                try {
                  return await this.onApproval!(sid, toolName, toolInput, context)
                } finally {
                  this.emitAgentStatusEvent(sid, turnId, eventRepo, 'thinking')
                }
              },
            }
          : {}),
        ...(this.onQuestion != null && !automation.unattended
          ? {
              questionCallback: async (
                sid: string,
                questions: UserQuestionPrompt[],
                context: SDKQuestionRequestContext,
              ) => {
                this.emitAgentStatusEvent(sid, turnId, eventRepo, 'waiting_user')
                try {
                  return await this.onQuestion!(sid, questions, context)
                } finally {
                  this.emitAgentStatusEvent(sid, turnId, eventRepo, 'thinking')
                }
              },
            }
          : {}),
        ...(goalConfig != null ? { goal: goalConfig } : {}),
      }
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
      ...(automation.unattended ? { unattended: true } : {}),
      ...(isLocalCli ? { useLocalConfig: true } : {}),
      model,
      workspaceRootPath,
      permissionMode,
      ...(config.apiEndpoint != null ? { apiEndpoint: config.apiEndpoint } : {}),
      ...(config.codexApiKind != null ? { codexApiKind: config.codexApiKind } : {}),
      ...(!isLocalCli && provider.provider_type !== 'anthropic'
        ? {
            codexCliProvider: buildCodexCliModelProviderConfig({
              providerProfileId: effectiveRuntimeProviderProfileId,
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
      ...(imageGenerationContext != null
        ? { imageGenerationMcpServer: imageGenerationContext.mcpServer }
        : {}),
      ...(mediaGenerationContext != null
        ? { mediaGenerationMcpServer: mediaGenerationContext.mcpServer }
        : {}),
      // FR-0b：codex Host 的团队工具面——createTeamMcpServer 对 codex consumer 返回
      // http 桥接型 server（Codex SDK chat-wire provider 同样可用），这里透传给
      // tryStartCodexCliTurn 挂载。漏掉此字段会导致 roster prompt 声称有工具而实际没有。
      ...(teamMcpServer != null ? { teamMcpServer } : {}),
      ...(platformMcpServer != null ? { platformManagementMcpServer: platformMcpServer } : {}),
      ...(webSearchMcpServer != null ? { webSearchMcpServer } : {}),
      ...(presentFilesMcpServer != null ? { presentFilesMcpServer } : {}),
      ...(browserAutomationMcpServer != null ? { browserAutomationMcpServer } : {}),
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
    const mcpServers = await this.buildMcpServersForSDK(options.allowedMcpServerIds)
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
    if (config.presentFilesMcpServer != null) {
      mcpServers.spark_files = config.presentFilesMcpServer
    }

    // Visible in-app browser MCP server (spark_browser) — desktop main process bridge.
    if (config.browserAutomationMcpServer != null) {
      mcpServers.spark_browser = config.browserAutomationMcpServer
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
        if (canvas?.server != null) {
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
        ? snapshotService.snapshot(workspaceRootPath).catch((err) => {
            log.warn('workspace snapshot before failed', {
              err: err instanceof Error ? err.message : String(err),
            })
            return null
          })
        : Promise.resolve(null)
    // 验证建议卡不再固定在轮末自动弹出——改为下面注册的 spark_verify 工具，
    // 由 agent 自主判断本轮是否值得建议验证后主动调用。
    let validationSuggestionEmitted = false
    const emitValidationSuggestion = (): { emitted: boolean; reason?: string } => {
      if (validationSuggestionEmitted)
        return { emitted: false, reason: 'Already shown once this turn.' }
      if (changedFiles.size === 0)
        return { emitted: false, reason: 'No file changes recorded yet this turn.' }
      // 调试模式下不弹通用「建议验证」卡：此时正确的下一步是让用户去复现（由调试快捷回复
      // 与 spark_debug 状态机驱动），提示跑 typecheck/test 反而打断闭环、属于噪声。
      if (config.debugMcpServer != null) {
        return {
          emitted: false,
          reason: 'Debug mode session — validation suggestions are suppressed.',
        }
      }
      const suggestion = new ValidationSuggestionService().suggest({
        workspaceRootPath: config.workspaceRootPath,
        changedFiles: Array.from(changedFiles),
      })
      if (suggestion == null) {
        return { emitted: false, reason: 'No matching validation scripts for the changed files.' }
      }
      validationSuggestionEmitted = true
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
      return { emitted: true }
    }

    // spark_verify: agent-invoked tool for suggesting a validation pass. Needs
    // `changedFiles`/`workspaceRootPath` from this turn's closure, so it's built
    // inline here rather than pre-resolved onto SDKExecutorConfig like the other
    // built-in MCP servers.
    if (workspaceRootPath != null && workspaceRootPath.length > 0) {
      const verifyFactory = await loadSdkMcpFactory()
      if (verifyFactory != null) {
        const { createSdkMcpServer, tool } = verifyFactory
        const suggestValidationTool = tool(
          'suggest_validation',
          VALIDATION_SUGGESTION_TOOL_DESCRIPTION,
          { reason: z.string().max(200).optional() } as Record<string, unknown>,
          async () => {
            const result = emitValidationSuggestion()
            const text = result.emitted
              ? 'Validation suggestion card shown to the user.'
              : `No validation suggestion shown: ${result.reason}`
            return { content: [{ type: 'text' as const, text }] }
          },
        )
        mcpServers.spark_verify = createSdkMcpServer({
          name: 'spark_verify',
          version: '1.0.0',
          tools: [suggestValidationTool],
        })
      }
    }

    // spark_memory（in-process 版，claude SDK 路径）：agent 可调用的 search_memory /
    // recall_memory 工具，进程内 MCP server（无子进程 / 无 bridge HTTP），直接闭包访问
    // this.db。CLI 路径（codex CLI / claude CLI）在 tryStartCodexCliTurn 里走 stdio
    // resolveSparkMemoryMcpServer；本方法（tryStartSDKTurn）只处理 SDK 路径。
    try {
      const memoryEnabled = new SettingsRepository(this.db).get('memory', 'enabled')
      if (memoryEnabled !== false && memoryEnabled !== 0) {
        const memFactory = await loadSdkMcpFactory()
        if (memFactory != null) {
          const { createSdkMcpServer: memCreateServer, tool: memTool } = memFactory
          const memSettingsRepo = new SettingsRepository(this.db)
          const memSettingsGet = (c: string, k: string) => memSettingsRepo.get(c, k)
          const memRepo = new MemoryRepository(this.db)
          const memStore = new MemoryStoreService(undefined, config.workspaceRootPath)
          const memSearchRepo = new MemorySearchRepository(this.db)
          const memEntityRepo = new MemoryEntityRepository(this.db)
          const memModelService = new ModelService(
            new ModelProfileRepository(this.db),
            new ProviderProfileRepository(this.db),
            memSettingsGet,
            () => this.activeChatModelBySession.get(sessionId) ?? null,
          )
          const memEmbeddingService = new EmbeddingService(
            memModelService,
            memSearchRepo,
            memSettingsGet,
          )
          const memSearchService = new MemorySearchService(
            memSearchRepo,
            memEmbeddingService,
            memSettingsGet,
          )
          const memReader = new MemoryReaderService(
            memRepo,
            memStore,
            memSettingsGet,
            memSearchService,
          )
          const memScopes: MemoryScopeFilter[] = [{ scope: 'user', scopeRef: null }]
          if (options.primaryWorkspaceId != null && options.primaryWorkspaceId.length > 0) {
            memScopes.push({ scope: 'project', scopeRef: options.primaryWorkspaceId })
          }
          if (options.agentId != null && options.agentId.length > 0) {
            memScopes.push({ scope: 'agent', scopeRef: options.agentId })
          }

          const searchMemoryTool = memTool(
            'search_memory',
            [
              '按语义/关键词搜索长期记忆（user/project/agent 三层，自动混合 FTS+向量检索）。',
              '返回匹配条目的 id + 摘要列表；需要某条的完整正文时再用 recall_memory。',
              '何时调用：system prompt 里的记忆摘要不足以决策、或想确认是否有相关历史记忆时。',
            ].join(' '),
            {
              query: z.string().min(1).max(500),
              type: z.enum(['user', 'feedback', 'project', 'reference']).optional(),
              limit: z.number().int().min(1).max(20).optional(),
            } as Record<string, unknown>,
            async (args: Record<string, unknown>) => {
              const query = typeof args.query === 'string' ? args.query : ''
              const type = typeof args.type === 'string' ? args.type : undefined
              const limit = typeof args.limit === 'number' ? args.limit : 8
              const opts = {
                scopes: memScopes,
                ...(type != null ? { type } : {}),
                limit,
              }
              const hits = await memSearchService.search(query, opts)
              if (hits == null) {
                return {
                  content: [{ type: 'text' as const, text: '记忆检索暂不可用（已降级）。' }],
                }
              }
              if (hits.length === 0) {
                return { content: [{ type: 'text' as const, text: '没有匹配的长期记忆。' }] }
              }
              const lines = hits.map(
                (h) =>
                  `- [${h.entry.id}] ${h.entry.name} (${h.entry.type}): ${h.entry.description}`,
              )
              // 一跳实体扩展：对 top 命中查共享实体的其他有效记忆，去重（排除已命中）
              const hitIds = new Set(hits.map((h) => h.entry.id))
              const relatedMap = new Map<
                string,
                { id: string; name: string; type: string; description: string }
              >()
              for (const h of hits.slice(0, 3)) {
                try {
                  for (const r of memEntityRepo.findRelated(h.entry.id, 3)) {
                    if (!hitIds.has(r.id) && !relatedMap.has(r.id)) {
                      relatedMap.set(r.id, {
                        id: r.id,
                        name: r.name,
                        type: r.type,
                        description: r.description,
                      })
                    }
                  }
                } catch {
                  // entity 表未就绪（旧库未跑 043）→ 静默跳过扩展
                }
              }
              let text = lines.join('\n')
              if (relatedMap.size > 0) {
                const relLines = [...relatedMap.values()]
                  .slice(0, 5)
                  .map((r) => `- [${r.id}] ${r.name} (${r.type}): ${r.description}`)
                text += `\n\n经实体关联的其他记忆：\n${relLines.join('\n')}`
              }
              return { content: [{ type: 'text' as const, text }] }
            },
          )

          const recallMemoryTool = memTool(
            'recall_memory',
            '读取一条长期记忆的完整正文（含 Why / How to apply）。传入 search_memory 返回或 system prompt 摘要里方括号内的 id。',
            { id: z.string().min(1) } as Record<string, unknown>,
            async (args: Record<string, unknown>) => {
              const id = typeof args.id === 'string' ? args.id : ''
              const r = await memReader.recall(id)
              const text = r.error != null ? `recall 失败：${r.error}` : r.content
              return { content: [{ type: 'text' as const, text }] }
            },
          )

          mcpServers.spark_memory = memCreateServer({
            name: 'spark_memory',
            version: '1.0.0',
            tools: [searchMemoryTool, recallMemoryTool],
          })
        }
      }
    } catch (err) {
      log.warn(
        `spark_memory MCP server setup failed (non-fatal): ${
          err instanceof Error ? err.message : String(err)
        }`,
      )
    }

    const completeAssistantEvents: AssistantMessageEvent[] = []
    // 标题精炼、目标契约/进度解析、记忆抽取都依赖完整 assistant 正文。
    // Codex SDK 现会先发各 segment 的 complete，再发整 turn 的 isFinal 汇总 complete；
    // 这里收集整轮 complete 事件，turn 结束后统一归并，避免只拿到第一段正文。
    let pendingTerminalStatus: AgentStatusEvent | null = null
    const emitPendingTerminalStatus = (): AgentStatusEvent['status'] | null => {
      if (pendingTerminalStatus == null) return null
      const status = pendingTerminalStatus.status
      this.emitAndPersist(sessionId, turnId, pendingTerminalStatus, eventRepo)
      if (status === 'completed' || status === 'cancelled') {
        sessionRepo.updateStatus(sessionId, 'idle')
      } else if (status === 'error') {
        sessionRepo.updateStatus(sessionId, 'error')
      }
      pendingTerminalStatus = null
      return status
    }
    // Mention 路由：把 assistant_message 重写为 team_member_message（驱动 TeamMemberBubble + 进入历史时带 [name]）。
    // dispatchId 复用 turnId（mention 没有 dispatch 概念，UI 只需稳定标识对 delta 流聚合）。
    const mentionAgentId = options.mentionAgentId
    const mentionMemberContext =
      mentionAgentId != null
        ? { dispatchId: `mention:${turnId}`, memberAgentId: mentionAgentId }
        : undefined
    const turnAgent = this.resolveAgent(options.agentId)
    executor.onEvent((event) => {
      if (
        event.type === 'agent_status' &&
        (event.status === 'completed' || event.status === 'cancelled' || event.status === 'error')
      ) {
        pendingTerminalStatus = withAgentSnapshot(event, turnAgent) as AgentStatusEvent
        return
      }
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
          (event.type === 'tool_call' ||
            event.type === 'tool_result' ||
            event.type === 'file_change' ||
            event.type === 'terminal_output')
        ) {
          outgoing = { ...event, teamMemberContext: mentionMemberContext }
        }
      }
      this.emitAndPersist(sessionId, turnId, outgoing, eventRepo)
      const presentedFiles = extractPresentedFiles(event, workspaceRootPath)
      if (presentedFiles != null) {
        this.emitAndPersist(
          sessionId,
          turnId,
          { ...makeBase(), type: 'presented_files', files: presentedFiles },
          eventRepo,
        )
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
        event.type === 'assistant_message' &&
        event.mode === 'complete' &&
        typeof event.content === 'string'
      ) {
        completeAssistantEvents.push(event)
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
      const teamToolNames =
        this.teamMcpToolNames.get(config.teamMcpServer) ??
        new Set(['agent_dispatch', 'agent_dispatch_batch'])
      sdkAllowedTools = mergeUniqueStrings(
        sdkAllowedTools,
        [...teamToolNames].map((name) => `mcp__${SPARK_TEAM_MCP_SERVER_NAME}__${name}`),
      )
    }
    if (config.platformManagementMcpServer != null) {
      sdkAllowedTools = mergeUniqueStrings(sdkAllowedTools, PLATFORM_TOOL_NAMES)
    }
    if (config.webSearchMcpServer != null) {
      sdkAllowedTools = mergeUniqueStrings(sdkAllowedTools, SEARCH_TOOL_NAMES)
    }
    if (config.presentFilesMcpServer != null) {
      sdkAllowedTools = mergeUniqueStrings(sdkAllowedTools, PRESENT_FILES_TOOL_NAMES)
    }
    if (config.browserAutomationMcpServer != null) {
      sdkAllowedTools = mergeUniqueStrings(sdkAllowedTools, BROWSER_TOOL_NAMES)
    }
    if (mcpServers.spark_verify != null) {
      sdkAllowedTools = mergeUniqueStrings(sdkAllowedTools, VALIDATION_SUGGESTION_TOOL_NAMES)
    }
    if (mcpServers.spark_memory != null) {
      sdkAllowedTools = mergeUniqueStrings(sdkAllowedTools, [
        'mcp__spark_memory__search_memory',
        'mcp__spark_memory__recall_memory',
      ])
    }
    if (config.debugMcpServer != null) {
      sdkAllowedTools = mergeUniqueStrings(sdkAllowedTools, DEBUG_TOOL_NAMES)
    }
    if (canvasAllowedTools != null) {
      sdkAllowedTools = mergeUniqueStrings(sdkAllowedTools, canvasAllowedTools)
    }

    // 编排宿主不再硬剥离 Edit/Write/Bash 等工具（产品决策 2026-07-04）：每个 agent
    // （含团队 Host / 挂工作流的 agent）保留全量工具权限，「优先派发、不要单干」
    // 只靠 [Orchestration Mode] + [Team Roster] 提示词引导，不用禁用来强制。
    const sdkConfig: SDKExecutorConfig = {
      ...config,
      ...(Object.keys(mcpServers).length > 0 ? { mcpServers } : {}),
      ...(sdkAllowedTools != null ? { allowedTools: sdkAllowedTools } : {}),
    }

    // Checkpoint（会话开启时）：在 agent 改动文件前捕获本轮起始状态作为可还原点，
    // 仅当工作区相对上个 checkpoint 有实际变更时才真正快照（gating 见 maybeCaptureCheckpoint）。
    if (workspaceRootPath != null && workspaceRootPath.length > 0) {
      await this.maybeCaptureCheckpoint(sessionId, turnId, workspaceRootPath, eventRepo, message)
    }

    if (this.disposing || this.activeLoops.get(sessionId) !== executor) {
      if (this.activeLoops.get(sessionId) === executor) {
        this.activeLoops.delete(sessionId)
        sessionRepo.updateStatus(sessionId, 'idle')
        this.emitQueueChanged(sessionId)
      }
      this.teamDispatchService?.clearTurn(turnId)
      this.closeTeamMcpHandlesForTurn(turnId)
      return
    }

    // Fire-and-forget
    const executionPromise = executor.executeTurn(sessionId, turnId, message, sdkConfig)
    this.activeExecutionPromises.set(executor, { sessionId, promise: executionPromise })
    executionPromise
      .then(async () => {
        if (!shouldRunTurnPostProcessing(pendingTerminalStatus?.status ?? null)) {
          const ownsSession = this.activeLoops.get(sessionId) === executor
          const terminalStatus = ownsSession ? emitPendingTerminalStatus() : null
          if (
            ownsSession &&
            (terminalStatus == null ||
              terminalStatus === 'completed' ||
              terminalStatus === 'cancelled')
          ) {
            sessionRepo.updateStatus(sessionId, 'idle')
          }
          return
        }
        // Reset resume circuit breaker on successful turn completion
        getResumeCircuitBreaker().recordSuccess(sessionId)
        const assistantTurnText = collectCompleteAssistantTurnText(completeAssistantEvents)
        const titleCtx = options.firstTurnTitleContext
        if (titleCtx != null) {
          void this.refineSessionTitleAsync(sessionId, sessionRepo, {
            ...titleCtx,
            assistantMessage: assistantTurnText,
          })
        }
        if (assistantTurnText.length > 0) {
          this.updateGoalFromAssistantBlock(sessionId, assistantTurnText)
          this.updateGoalContractFromAssistantBlock(sessionId, assistantTurnText)
        }

        // ── Memory System：turn 完成后异步写入记忆（fire-and-forget） ──
        void this.maybeWriteMemoryFromTurn(
          sessionId,
          options.primaryWorkspaceId ?? '',
          options.agentId ?? '',
          options.workspaceRootPath,
          message,
          assistantTurnText,
        ).catch(() => {
          /* swallow — never affect main flow */
        })

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
        const ownsSession = this.activeLoops.get(sessionId) === executor
        const terminalStatus = ownsSession ? emitPendingTerminalStatus() : null
        if (
          ownsSession &&
          (terminalStatus == null ||
            terminalStatus === 'completed' ||
            terminalStatus === 'cancelled')
        ) {
          sessionRepo.updateStatus(sessionId, 'idle')
        }
      })
      .catch(() => {
        const ownsSession = this.activeLoops.get(sessionId) === executor
        const terminalStatus = ownsSession ? emitPendingTerminalStatus() : null
        if (ownsSession && terminalStatus !== 'completed' && terminalStatus !== 'cancelled') {
          sessionRepo.updateStatus(sessionId, 'error')
        }
      })
      .finally(() => {
        this.activeExecutionPromises.delete(executor)
        // 清理本 turn 的 dispatch 预算计数，避免长生命周期进程内存增长
        this.teamDispatchService?.clearTurn(turnId)
        // FR-0b：claude Host 本身不用桥接，但本 turn 内 dispatch 的 codex 成员
        // （嵌套/peer messaging）会创建桥接 handle，这里与 codex 路径对称回收。
        this.closeTeamMcpHandlesForTurn(turnId)
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

    const mcpServers = await this.buildMcpServersForSDK(options.allowedMcpServerIds)
    if (config.imageGenerationMcpServer != null) {
      mcpServers.spark_image = config.imageGenerationMcpServer
    }
    if (config.mediaGenerationMcpServer != null) {
      mcpServers.spark_media = config.mediaGenerationMcpServer
    }
    if (config.platformManagementMcpServer != null) {
      mcpServers.spark_platform = config.platformManagementMcpServer
    }
    // FR-0b：codex Host 的 spark_team 是 http 桥接型 server（url+headers），
    // filterCliCompatibleMcpServers 对 url 型放行，CodexCli/CodexSdk 均可消费。
    if (config.teamMcpServer != null) {
      mcpServers.spark_team = config.teamMcpServer
    }
    if (config.webSearchMcpServer != null) {
      mcpServers.spark_search = config.webSearchMcpServer
    }
    if (config.presentFilesMcpServer != null) {
      mcpServers.spark_files = config.presentFilesMcpServer
    }
    if (config.browserAutomationMcpServer != null) {
      mcpServers.spark_browser = config.browserAutomationMcpServer
    }

    if (this.canvasMcpProvider != null) {
      try {
        const canvas = await this.canvasMcpProvider(sessionId)
        const canvasServer =
          canvas != null ? await this.resolveSparkCanvasMcpServer(sessionId, canvas) : null
        if (canvasServer != null) mcpServers.spark_canvas = canvasServer
      } catch (err) {
        log.warn(
          `spark_canvas stdio MCP setup failed (non-fatal): ${
            err instanceof Error ? err.message : String(err)
          }`,
        )
      }
    }

    // spark_memory（CLI 路径专用）—— stdio 子进程通过 PlatformBridgeService HTTP RPC 回到
    // 主进程的 bridgeMemorySearch / bridgeMemoryRecall。claude SDK 路径（tryStartSDKTurn）
    // 用 in-process SDK MCP；二者工具名/语义/检索后端完全一致。必须在 filterCliCompatibleMcpServers
    // 之前注入：本路径（tryStartCodexCliTurn）下方会用 filter 过滤掉 type='sdk' 的 server，
    // stdio 版本不受影响。
    try {
      const memServer = await this.resolveSparkMemoryMcpServer(sessionId, config.workspaceRootPath)
      if (memServer != null) mcpServers.spark_memory = memServer
    } catch (err) {
      log.warn(
        `spark_memory stdio MCP setup failed (non-fatal): ${err instanceof Error ? err.message : String(err)}`,
      )
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
    const completeAssistantEvents: AssistantMessageEvent[] = []
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
      const discovered = await collectWorkspaceFileChangesSince(
        config.workspaceRootPath,
        initialWorkspaceChanges,
      )
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
    const emitPendingTerminalStatus = (): AgentStatusEvent['status'] | null => {
      if (pendingTerminalStatus == null) return null
      const status = pendingTerminalStatus.status
      this.emitAndPersist(sessionId, turnId, pendingTerminalStatus, eventRepo)
      if (status === 'completed' || status === 'cancelled') {
        sessionRepo.updateStatus(sessionId, 'idle')
      } else if (status === 'error') {
        sessionRepo.updateStatus(sessionId, 'error')
      }
      pendingTerminalStatus = null
      return status
    }

    executor.onEvent((event) => {
      if (
        event.type === 'agent_status' &&
        (event.status === 'completed' || event.status === 'cancelled' || event.status === 'error')
      ) {
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
          (event.type === 'tool_call' ||
            event.type === 'tool_result' ||
            event.type === 'file_change' ||
            event.type === 'terminal_output')
        ) {
          outgoing = { ...event, teamMemberContext: mentionMemberContext }
        }
      }
      this.emitAndPersist(sessionId, turnId, outgoing, eventRepo)
      const presentedFiles = extractPresentedFiles(event, config.workspaceRootPath)
      if (presentedFiles != null) {
        this.emitAndPersist(
          sessionId,
          turnId,
          { ...makeBase(), type: 'presented_files', files: presentedFiles },
          eventRepo,
        )
      }
      if (
        event.type === 'assistant_message' &&
        event.mode === 'complete' &&
        typeof event.content === 'string'
      ) {
        completeAssistantEvents.push(event)
      }
    })

    this.activeLoops.set(sessionId, executor)
    sessionRepo.updateStatus(sessionId, 'running')
    this.emitQueueChanged(sessionId)

    const cliMcpServers = useCodexCli ? filterCliCompatibleMcpServers(mcpServers) : mcpServers
    const cliConfig: SDKExecutorConfig = {
      ...config,
      ...(Object.keys(cliMcpServers).length > 0 ? { mcpServers: cliMcpServers } : {}),
    }

    // Checkpoint（会话开启时）：codex 路径同样在 executor 改动文件前捕获本轮起始状态作为可还原点。
    if (config.workspaceRootPath != null && config.workspaceRootPath.length > 0) {
      await this.maybeCaptureCheckpoint(
        sessionId,
        turnId,
        config.workspaceRootPath,
        eventRepo,
        message,
      )
    }

    if (this.disposing || this.activeLoops.get(sessionId) !== executor) {
      if (this.activeLoops.get(sessionId) === executor) {
        this.activeLoops.delete(sessionId)
        sessionRepo.updateStatus(sessionId, 'idle')
        this.emitQueueChanged(sessionId)
      }
      this.teamDispatchService?.clearTurn(turnId)
      this.closeTeamMcpHandlesForTurn(turnId)
      return
    }

    const executionPromise = executor.executeTurn(sessionId, turnId, message, cliConfig)
    this.activeExecutionPromises.set(executor, { sessionId, promise: executionPromise })
    executionPromise
      .then(async () => {
        if (!shouldRunTurnPostProcessing(pendingTerminalStatus?.status ?? null)) {
          const ownsSession = this.activeLoops.get(sessionId) === executor
          const terminalStatus = ownsSession ? emitPendingTerminalStatus() : null
          if (
            ownsSession &&
            (terminalStatus == null ||
              terminalStatus === 'completed' ||
              terminalStatus === 'cancelled')
          ) {
            sessionRepo.updateStatus(sessionId, 'idle')
          }
          return
        }
        await emitDiscoveredWorkspaceChanges()
        const assistantTurnText = collectCompleteAssistantTurnText(completeAssistantEvents)
        const ownsSession = this.activeLoops.get(sessionId) === executor
        const terminalStatus = ownsSession ? emitPendingTerminalStatus() : null
        if (
          ownsSession &&
          (terminalStatus == null ||
            terminalStatus === 'completed' ||
            terminalStatus === 'cancelled')
        ) {
          sessionRepo.updateStatus(sessionId, 'idle')
        }
        void this.maybeWriteMemoryFromTurn(
          sessionId,
          options.primaryWorkspaceId ?? '',
          options.agentId ?? '',
          options.workspaceRootPath,
          message,
          assistantTurnText,
        ).catch(() => {
          /* swallow — never affect main flow */
        })
      })
      .catch(async () => {
        await emitDiscoveredWorkspaceChanges().catch(() => undefined)
        const ownsSession = this.activeLoops.get(sessionId) === executor
        const terminalStatus = ownsSession ? emitPendingTerminalStatus() : null
        if (ownsSession && terminalStatus !== 'completed' && terminalStatus !== 'cancelled') {
          sessionRepo.updateStatus(sessionId, 'error')
        }
      })
      .finally(() => {
        this.activeExecutionPromises.delete(executor)
        this.teamDispatchService?.clearTurn(turnId)
        // FR-0b 修复（审查 B-1）：回收本 turn 创建的 codex HTTP 桥接 handle（Host 主循环路径）。
        this.closeTeamMcpHandlesForTurn(turnId)
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
    // 入口日志（info）：让"抽取是否被触发"在默认日志级别下可见。审查反馈：用户配错
    // 抽取模型后只能从"记忆静默不生成"被动发现，根因是诊断日志都在 debug 级。
    const settingsRepo0 = new SettingsRepository(this.db)
    const extractionProviderId = settingsRepo0.get('memory', 'extractionProviderId')
    const extractionModel = settingsRepo0.get('memory', 'extractionModel')
    const settingsAbsent =
      (extractionProviderId == null || extractionProviderId === undefined) &&
      (extractionModel == null || extractionModel === undefined)
    const fallback = settingsAbsent ? (this.activeChatModelBySession.get(sessionId) ?? null) : null
    log.info(
      `memory extraction triggered for session=${sessionId} agent=${agentId} ` +
        `(source=${settingsAbsent ? (fallback != null ? 'fallback' : 'none') : 'settings'}, ` +
        `user=${userMessage.length} chars, assistant=${assistantMessage.length} chars)`,
    )
    try {
      const settingsRepo = new SettingsRepository(this.db)
      const settingsGet = (cat: string, key: string) => settingsRepo.get(cat, key)
      const memoryRepo = new MemoryRepository(this.db)
      const memoryStore = new MemoryStoreService(undefined, workspaceRootPath)
      const eventRepo = new EventRepository(this.db)
      const currentSeq = this.eventSequencer.peek(sessionId, eventRepo)
      const recentSummary = buildMemoryExtractionRecentContext(
        eventRepo,
        this.db,
        sessionId,
        currentSeq,
      )
      // 真实 LLM 抽取：走 ModelService.complete()（OpenAI 兼容 /chat/completions 或 anthropic /v1/messages）。
      // 未配置 extraction 模型 / 调用失败 → complete 返回 unavailable，这里降级为 '[]'，
      // 写入静默跳过（与原 stub 行为一致，绝不阻塞主对话）。
      const modelService = new ModelService(
        new ModelProfileRepository(this.db),
        new ProviderProfileRepository(this.db),
        settingsGet,
        () => this.activeChatModelBySession.get(sessionId) ?? null,
      )
      const callExtractionLLM = async (prompt: string): Promise<string> => {
        const result = await modelService.complete(prompt)
        if (!result.available) {
          // 提级到 info：让用户能看到"抽取为什么没发生"（unavailable 的 reason 通常是
          // 'no extraction model configured' / 'HTTP 401' / 'provider not found' 等可操作信息）
          log.info(
            `memory extraction LLM unavailable (turn will produce no new memories): ${result.reason}`,
          )
          return '[]'
        }
        return result.text
      }
      // V2 演化决策服务：FTS 召回相似 + LLM 判定 ADD/UPDATE/DELETE/NOOP
      const memorySearchRepo = new MemorySearchRepository(this.db)
      const evolutionService = new MemoryEvolutionService(memorySearchRepo, callExtractionLLM)
      // V2 实体关联图：抽取 prompt 的 entities 落库，供检索一跳扩展
      const entityRepo = new MemoryEntityRepository(this.db)
      const writer = new MemoryWriterService(
        memoryRepo,
        memoryStore,
        settingsGet,
        callExtractionLLM,
        evolutionService,
        entityRepo,
      )
      await writer.maybeWriteFromTurn({
        sessionId,
        workspaceId,
        agentId,
        userMessage,
        assistantMessage,
        recentSummary,
      })
    } catch (err) {
      log.warn(
        `maybeWriteMemoryFromTurn failed (non-fatal): ${err instanceof Error ? err.message : String(err)}`,
      )
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
      log.warn(
        `refineSessionTitleAsync failed: ${err instanceof Error ? err.message : String(err)}`,
      )
    }
  }

  /**
   * Build MCP server configs in the SDK's expected format from our McpService.
   */
  private async buildMcpServersForSDK(
    allowedServerIds?: Set<string>,
  ): Promise<Record<string, SDKMcpServerConfig>> {
    const result: Record<string, SDKMcpServerConfig> = {}
    const servers = this.mcpService.listServers()

    for (const server of servers) {
      if (!server.enabled) continue
      if (allowedServerIds != null && !allowedServerIds.has(server.id)) continue
      try {
        const cfg = JSON.parse(server.configJson) as Record<string, unknown>
        // 归一化：兼容 `transport`/`type` 字段名，支持 http(Streamable HTTP)/sse/stdio。
        // 无法解析出有效传输的（如 http 缺 url）直接跳过，而不是降级成坏的 stdio。
        const resolved = resolveMcpConfig(cfg)
        if (resolved == null) {
          log.warn(`Skipping MCP server "${server.name}": no valid transport in config`)
          continue
        }
        if (resolved.type === 'stdio') {
          result[server.name] = {
            type: 'stdio',
            command: resolved.command,
            args: resolved.args,
            ...(resolved.env != null ? { env: resolved.env } : {}),
            ...(resolved.cwd != null ? { cwd: resolved.cwd } : {}),
          }
        } else {
          const auth = cfg.auth as { type?: string } | undefined
          let headers = resolved.headers
          if (auth?.type === 'oauth2') {
            const token = await this.mcpOAuthProvider?.getAccessToken(server.id)
            if (token == null) {
              log.warn(`Skipping OAuth MCP server "${server.name}": authorization required`)
              continue
            }
            headers = { ...(headers ?? {}), Authorization: `Bearer ${token}` }
          }
          result[server.name] = {
            type: resolved.type,
            url: resolved.url,
            ...(headers != null ? { headers } : {}),
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
    const { GitHubConnectorService } = await import('./github-connector.service.js')
    const { SkillRepository, SettingsRepository, TeamDefinitionRepository } =
      await import('@spark/storage')

    const skillRepo = new SkillRepository(this.db)
    const settingsRepo = new SettingsRepository(this.db)
    const skillLoader = new SkillLoader(skillRepo)
    const skillRegistryService = new SkillRegistryService(this.db, this.userSkillsDir ?? undefined)

    // Initialize skill registry adapters (loads marketplace sources)
    try {
      skillRegistryService.initialize()
    } catch {
      /* non-critical */
    }

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
      githubConnectorService: new GitHubConnectorService(
        new ConnectorConnectionRepository(this.db),
      ),
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
  private async resolvePlatformManagementMcpServer(
    sessionId: string,
  ): Promise<SDKMcpServerConfig | null> {
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
      log.warn(
        `Failed to start platform bridge: ${err instanceof Error ? err.message : String(err)}`,
      )
      return null
    }
  }

  /**
   * 解析画布 MCP server（spark_canvas）—— codex CLI / claude CLI 路径专用。
   *
   * 画布的真实状态和 IPC pending call 都活在 Electron 主进程里；CLI/Codex 子进程消费不了
   * Claude SDK 的 in-process server。因此这里挂一个 stdio 瘦桥接，把工具调用经
   * PlatformBridgeService 的 canvas.call_tool RPC 转回主进程 CanvasHostBridge。
   */
  private async resolveSparkCanvasMcpServer(
    sessionId: string,
    canvas: NonNullable<Awaited<ReturnType<CanvasMcpProvider>>>,
  ): Promise<SDKMcpServerConfig | null> {
    if (canvas.toolSchemas == null || canvas.toolSchemas.length === 0) return null
    const serverPath = resolveSparkCanvasMcpServerPath()
    if (serverPath == null) {
      log.warn('Spark canvas MCP server script not found')
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
          SPARK_CANVAS_SID: sessionId,
          SPARK_CANVAS_TOOL_SCHEMAS_JSON: JSON.stringify(canvas.toolSchemas),
        },
      }
    } catch (err) {
      log.warn(
        `Failed to start spark_canvas MCP server: ${err instanceof Error ? err.message : String(err)}`,
      )
      return null
    }
  }

  /**
   * 解析长期记忆 MCP server（spark_memory）—— codex CLI / claude CLI 路径专用。
   *
   * claude SDK 路径用 in-process SDK MCP（createSdkMcpServer，闭包直访 this.db），
   * 但 codex CLI / claude CLI 是独立子进程，消费不了 type='sdk' 的 server。这里给它们
   * 挂一个 stdio 子进程，通过 PlatformBridgeService HTTP RPC 回到主进程的
   * bridgeMemorySearch / bridgeMemoryRecall —— 与 claude SDK 路径复用同一套
   * MemorySearchService / MemoryReaderService，agent 看到的记忆范围/排序/降级语义一致。
   *
   * 仅在长期记忆开启时挂载；否则返回 null（agent 看不到 search_memory/recall_memory 工具）。
   */
  private async resolveSparkMemoryMcpServer(
    sessionId: string,
    _workspaceRootPath: string,
  ): Promise<SDKMcpServerConfig | null> {
    let memoryEnabled: unknown = true
    try {
      memoryEnabled = new SettingsRepository(this.db).get('memory', 'enabled')
    } catch {
      // settings 不可用时按默认（启用）处理
    }
    if (memoryEnabled === false || memoryEnabled === 0) return null

    const serverPath = resolveSparkMemoryMcpServerPath()
    if (serverPath == null) {
      log.warn('Spark memory MCP server script not found')
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
          SPARK_MEMORY_SID: sessionId,
        },
      }
    } catch (err) {
      log.warn(
        `Failed to start spark_memory MCP server: ${err instanceof Error ? err.message : String(err)}`,
      )
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
  private async resolveWebSearchMcpServer(
    workspaceRootPath: string,
  ): Promise<SDKMcpServerConfig | null> {
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
    let port: number
    try {
      port = await getDebugLogServer().start()
    } catch (err) {
      log.warn(
        `Failed to start debug log server: ${err instanceof Error ? err.message : String(err)}`,
      )
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

  private async resolveImageGenerationContext(
    workspaceRootPath: string,
  ): Promise<ImageGenerationRuntimeContext | null> {
    const providerRepo = new ProviderProfileRepository(this.db)
    if (typeof providerRepo.listAll !== 'function') return null
    const imageProvider = providerRepo.listAll().find((row) => {
      if (row.enabled !== 1) return false
      try {
        const config = JSON.parse(row.config_json) as { modelType?: string }
        return config.modelType === 'image'
      } catch {
        return false
      }
    })
    if (imageProvider == null || imageProvider.keystore_ref == null) return null

    const apiKey = await resolveProviderApiKey(imageProvider)
    if (apiKey.trim().length === 0) return null

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
   * 选择策略：首个 enabled 且满足以下任一条件的 provider：
   *   - modelType=voice/video 的专用多媒体 provider
   *   - 非 legacy image profile，但显式声明了 image/audio/video 能力或 manifest
   *     （用于 Agnes 这类“文本 + 图片/视频”单 profile 场景）
   * 旧 modelType=image 仍继续走 spark_image，避免重复注入。
   * 同时要求 keystore 可读 API key、有 defaultModel、MCP server 脚本可解析。
   */
  private async resolveMediaGenerationContext(
    workspaceRootPath: string,
  ): Promise<MediaGenerationRuntimeContext | null> {
    const providerRepo = new ProviderProfileRepository(this.db)
    if (typeof providerRepo.listAll !== 'function') return null
    const catalog = new MediaModelCatalogService(new MediaModelManifestRepository(this.db))
    catalog.seedBuiltinManifests()
    const MEDIA_CAPABILITIES = new Set([
      'image.generate',
      'image.edit',
      'image.variations',
      'audio.speech',
      'audio.transcription',
      'video.generate',
      'video.image_to_video',
      'video.reference_to_video',
      'video.edit',
      'video.extend',
    ])
    const selectedProvider = providerRepo.listAll().find((row) => {
      if (row.enabled !== 1) return false
      try {
        const config = JSON.parse(row.config_json) as {
          modelType?: string
          mediaCapabilities?: string[]
          mediaModelRefs?: ProviderMediaModelRef[]
        }
        const isDedicatedMediaModelType =
          config.modelType === 'voice' || config.modelType === 'video'
        const caps = Array.isArray(config.mediaCapabilities) ? config.mediaCapabilities : []
        const hasExplicitMediaCap = caps.some((cap) => MEDIA_CAPABILITIES.has(cap))
        const refs = Array.isArray(config.mediaModelRefs) ? config.mediaModelRefs : []
        const hasManifestCap = refs
          .filter((ref) => ref.enabled !== false && typeof ref.manifestId === 'string')
          .some((ref) => {
            const manifest = ref.manifest ?? catalog.describe(ref.manifestId)
            return (
              manifest?.capabilities.some((capability) => MEDIA_CAPABILITIES.has(capability.id)) ===
              true
            )
          })
        const isNonLegacyMediaProfile =
          config.modelType !== 'image' && (hasExplicitMediaCap || hasManifestCap)
        return isDedicatedMediaModelType || isNonLegacyMediaProfile
      } catch {
        return false
      }
    })
    if (selectedProvider == null || selectedProvider.keystore_ref == null) return null

    const apiKey = await resolveProviderApiKey(selectedProvider)
    if (apiKey.trim().length === 0) return null

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
    const mediaProviderKindValue =
      typeof config.mediaProvider === 'string' ? config.mediaProvider.trim() : ''
    const providerName = (
      isMediaProviderKind(mediaProviderKindValue) ? mediaProviderKindValue : 'openai-compatible'
    ) as MediaProviderKind
    const apiType = config.mediaApiType ?? 'auto'
    // 与画布共用同一解析优先级：内联自定义 Manifest → 目录 → 旧引用合成兜底。
    const mediaProfileLike: MediaProfileLike = {
      mediaModelRefs: Array.isArray(config.mediaModelRefs) ? config.mediaModelRefs : [],
      defaultModel: model,
      mediaProvider: config.mediaProvider ?? null,
      ...(config.modelType !== undefined ? { modelType: config.modelType } : {}),
      ...(config.mediaCapabilities !== undefined
        ? { mediaCapabilities: config.mediaCapabilities }
        : {}),
    }
    const mediaManifests = resolveProfileMediaModels(mediaProfileLike, catalog, {
      enabledOnly: true,
    }).map((resolved) => resolved.manifest)
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
    return (
      repo.get(agentId ?? 'platform-manager-agent') ??
      repo.get('platform-manager-agent') ?? {
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
    )
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

  private resolveWorkflowMembers(
    graph: NormalizedWorkflowGraph,
    hostAgent: AgentItem,
  ): AgentItem[] {
    const repo = new AgentRepository(this.db)
    const membersById = new Map<string, AgentItem>()
    const nodes = getWorkflowNodesDeep(graph.nodes)
    for (const node of nodes) {
      if (node.kind !== 'agent') continue
      const workerId = getWorkflowNodeWorkerId(node)
      const configuredMember = workerId != null ? repo.get(workerId) : null
      const effectiveMember =
        configuredMember != null && configuredMember.enabled ? configuredMember : hostAgent
      if (membersById.has(effectiveMember.id)) continue
      membersById.set(effectiveMember.id, applyWorkflowNodeOverrides(effectiveMember, node))
    }
    for (const node of nodes) {
      if (node.kind !== 'subagent') continue
      const workerId = getWorkflowNodeWorkerId(node)
      if (workerId == null || workerId === hostAgent.id || membersById.has(workerId)) continue
      membersById.set(workerId, createWorkflowSubagentMember(node, hostAgent, workerId))
    }
    // 原子节点（skill/tool/mcp/plan/review/artifact）走真实执行时，也要有对应的临时 worker
    // 注册进花名册——TeamDispatchService 只放行 allowedWorkerIds（= 花名册 id 集）内的目标，
    // 不登记就无法经 runSingleDispatch 派发。每个原子 worker id 与节点一一对应（不会跨节点复用）。
    for (const node of nodes) {
      if (!shouldRunWorkflowAtomicNodeAsAgent(node)) continue
      const workerId = workflowAtomicMemberId(node.id)
      if (membersById.has(workerId)) continue
      membersById.set(workerId, createWorkflowAtomicMember(node, hostAgent))
    }
    return [...membersById.values()]
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
    /** Normalized managed workflow exposed through workflow_run. */
    workflowGraph?: NormalizedWorkflowGraph
    /** Enabled explicit workflow workers authorized for this turn. */
    workflowWorkerIds?: ReadonlySet<string>
    /** Managed workflow id, for run persistence/resume. */
    workflowId?: string
    /** 真实团队讨论上下文（workflow-only 合成 teamConfig 路径为空）。 */
    discussionId?: string
    discussionRoundIndex?: number
    /** Whether real team dispatch tools should be exposed. */
    exposeTeamDispatchTools: boolean
    /** 触发本轮的用户消息自带的附件，workflow_run 会原样转发给每个被派发节点。 */
    workflowAttachments?: WorkflowDispatchAttachment[]
    /** FR-0b：目标消费者 adapter——claude 用 in-process sdk server，codex 用 HTTP 桥接。调用方解析后传入。 */
    consumerAdapter?: AgentAdapterKind
    /** FR-0b：turn 取消信号；codex HTTP 桥接在 abort 时吊销 token。 */
    signal?: AbortSignal
    /** 外层 dispatch 的绝对截止时间，成员同步咨询队友时逐层传递。 */
    deadlineAt?: number
    /** Legacy flag kept for old callers; Codex API providers now use SDK-backed MCP-capable routing. */
    codexConsumerIsOpenAi?: boolean
  }): Promise<SDKMcpServerConfig | null> {
    // FR-0b：目标消费者是 codex 时用 HTTP 桥接（codex 子进程无法回调主进程 in-process sdk server）；
    // claude 消费者走 in-process（现状）。两形态共用下方 tool 定义，避免实现漂移。
    const isCodexConsumer =
      ctx.consumerAdapter != null &&
      ctx.consumerAdapter !== 'claude' &&
      ctx.consumerAdapter !== 'claude-sdk'
    const discussionId = ctx.discussionId
    const discussionRepo = discussionId != null ? this.getTeamDiscussionRepository() : null
    let currentDiscussionRound = ctx.discussionRoundIndex ?? 0
    let discussionConcludedReason: 'concluded' | 'canceled' | 'max_rounds' | null = null

    // targetAgentId 容错解析：模型经常拿显示名（如 "Rust Coder"）当 id 用——精确 id 优先，
    // 其次唯一的大小写不敏感名称匹配；解析失败由调用处报错并列出可用名单。
    const resolveMemberRef = (ref: string): AgentItem | undefined => {
      const trimmed = ref.trim()
      if (trimmed.length === 0) return undefined
      const byId = ctx.members.find((m) => m.id === trimmed)
      if (byId != null) return byId
      const lower = trimmed.toLowerCase()
      const byName = ctx.members.filter((m) => m.name.toLowerCase() === lower)
      return byName.length === 1 ? byName[0] : undefined
    }
    const rosterHint = (): string => ctx.members.map((m) => `${m.id} (${m.name})`).join(', ')

    // 线程增量回流：取 since 之后新写入的对等消息，过滤掉发起者自己发的，格式化成一段
    // 附加文本。无讨论 / 无新消息时返回 null。见 formatPeerBroadcastDelta 的场景说明。
    const collectPeerBroadcastDelta = (sinceIso: string, callerAgentId: string): string | null => {
      if (discussionId == null || discussionRepo == null) return null
      const fresh = discussionRepo.listPeerMessagesSince(discussionId, sinceIso)
      return formatPeerBroadcastDelta(fresh, callerAgentId)
    }
    const appendDelta = (text: string, delta: string | null): string =>
      delta == null ? text : `${text}\n\n${delta}`

    // 单次 dispatch 的实际执行：构造 task 并交给 TeamDispatchService。
    // parallel=true 时绕过 turn 串行队列，由 batch 工具使用。
    const runSingleDispatch = async (
      args: Record<string, unknown>,
      parallel = false,
    ): Promise<import('@spark/protocol').TeamA2AReply> => {
      if (discussionConcludedReason != null) {
        return {
          taskId: crypto.randomUUID(),
          memberAgentId: String(args.targetAgentId ?? ''),
          state: 'failed',
          content: '',
          error: {
            code: 'internal',
            message: `Discussion has already ended (${discussionConcludedReason}); dispatch is no longer allowed.`,
          },
        } as unknown as import('@spark/protocol').TeamA2AReply
      }
      const targetRef = String(args.targetAgentId ?? '')
      const task: TeamA2ATask = {
        taskId: crypto.randomUUID(),
        hostAgentId: ctx.hostAgent.id,
        // 名称→id 容错；解析失败原样透传，由 run() 的 member_disabled 报错并列出可用 id。
        memberAgentId: resolveMemberRef(targetRef)?.id ?? targetRef,
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
      if (ctx.discussionId != null && discussionRepo != null) {
        discussionRepo.appendMessage({
          id: crypto.randomUUID(),
          discussionId: ctx.discussionId,
          senderAgentId: ctx.hostAgent.id,
          targetAgentId: task.memberAgentId,
          roundIndex: currentDiscussionRound,
          kind: 'host_dispatch',
          content: task.instruction,
        })
      }
      return this.getTeamDispatchService().run(
        task,
        {
          sessionId: ctx.sessionId,
          turnId: ctx.turnId,
          hostAgentId: ctx.hostAgent.id,
          callerAgentId: ctx.hostAgent.id,
          ...(ctx.discussionId != null ? { discussionId: ctx.discussionId } : {}),
          roundIndex: currentDiscussionRound,
          members: ctx.members,
          teamConfig: ctx.teamConfig,
          allowedWorkerIds: new Set(ctx.members.map((member) => member.id)),
          currentDepth: ctx.currentDepth ?? 0,
          emitEvent: (event) =>
            this.emitAndPersist(ctx.sessionId, ctx.turnId, event, ctx.eventRepo),
          ...(ctx.deadlineAt != null ? { deadlineAt: ctx.deadlineAt } : {}),
          executeMember: ({
            member,
            task: memberTask,
            dispatchId,
            signal,
            memberDepth,
            deadlineAt,
          }) =>
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
              deadlineAt,
              members: ctx.members,
              teamConfig: ctx.teamConfig,
              ...(ctx.discussionId != null
                ? {
                    discussionId: ctx.discussionId,
                    discussionRoundIndex: currentDiscussionRound,
                  }
                : {}),
              ...(ctx.hostPermissionMode != null
                ? { hostPermissionMode: ctx.hostPermissionMode }
                : {}),
            }),
        },
        { parallel },
      )
    }

    // 单次 dispatch 工具：串行场景（前一结果决定下一步）
    const dispatchDef: TeamToolDefinition = {
      name: 'agent_dispatch',
      description: TEAM_DISPATCH_TOOL_DESCRIPTION,
      schema: {
        targetAgentId: z
          .string()
          .describe('One of the team member IDs visible to you. Use the exact id.'),
        instruction: z
          .string()
          .max(8000)
          .describe('Clear, self-contained description of what the member should do.'),
        inputs: z.record(z.unknown()).optional(),
        attachments: z
          .array(z.object({ type: z.enum(['text', 'file_ref', 'image_ref']), value: z.string() }))
          .max(10)
          .optional(),
        expectedOutput: z.enum(['text', 'json', 'code', 'mixed']).optional(),
        timeoutMs: z.number().int().min(5000).max(600_000).optional(),
      },
      handler: async (args: Record<string, unknown>) => {
        const since = new Date().toISOString()
        const reply = await runSingleDispatch(args)
        const delta = collectPeerBroadcastDelta(since, ctx.hostAgent.id)
        return {
          content: [{ type: 'text' as const, text: appendDelta(formatReplyForHost(reply), delta) }],
          structuredContent: reply as unknown as { [x: string]: unknown },
        }
      },
    }

    // 批量 dispatch 工具：并行场景（多个相互独立的任务）
    const dispatchBatchDef: TeamToolDefinition = {
      name: 'agent_dispatch_batch',
      description: TEAM_DISPATCH_BATCH_TOOL_DESCRIPTION,
      schema: {
        dispatches: z
          .array(
            z.object({
              targetAgentId: z.string(),
              instruction: z.string().max(8000),
              inputs: z.record(z.unknown()).optional(),
              attachments: z
                .array(
                  z.object({ type: z.enum(['text', 'file_ref', 'image_ref']), value: z.string() }),
                )
                .max(10)
                .optional(),
              expectedOutput: z.enum(['text', 'json', 'code', 'mixed']).optional(),
              timeoutMs: z.number().int().min(5000).max(600_000).optional(),
            }),
          )
          .min(1)
          .max(10)
          .describe('A list of independent tasks to run in parallel. Each item is one dispatch.'),
      },
      handler: async (args: Record<string, unknown>) => {
        const items = Array.isArray(args.dispatches)
          ? (args.dispatches as Array<Record<string, unknown>>)
          : []
        const since = new Date().toISOString()
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
                error: {
                  code: 'internal' as const,
                  message: s.reason instanceof Error ? s.reason.message : String(s.reason),
                },
              } satisfies import('@spark/protocol').TeamA2AReply),
        )
        const text = replies
          .map((r, i) => `[${i + 1}/${replies.length}] ${formatReplyForHost(r)}`)
          .join('\n\n---\n\n')
        const delta = collectPeerBroadcastDelta(since, ctx.hostAgent.id)
        return {
          content: [{ type: 'text' as const, text: appendDelta(text, delta) }],
          structuredContent: { replies } as unknown as { [x: string]: unknown },
        }
      },
    }

    const agentMessageDef: TeamToolDefinition | null =
      discussionId != null && ctx.teamConfig.enablePeerMessaging === true
        ? {
            name: 'agent_message',
            description: [
              'Send a message into the shared team discussion thread.',
              'Mode call (default): set targetAgentId to consult a teammate synchronously; they run immediately and their answer returns in this tool result.',
              'Mode note: set mode:"note" with targetAgentId to leave a targeted async note; the teammate sees [NOTE FOR YOU] next time they run and nobody is interrupted.',
              'Broadcast note: omit targetAgentId to leave an async note for everyone; nobody runs immediately.',
              `Use ${qualifyTeamToolName('agent_message')} mode "call" when your current answer depends on the teammate's reply; use mode "note" only when they do not need to act right now.`,
            ].join('\n'),
            schema: {
              content: z
                .string()
                .max(8000)
                .describe('The message to send into the shared discussion thread.'),
              targetAgentId: z
                .string()
                .optional()
                .describe(
                  'Optional teammate id. Required for a synchronous call or targeted note; omit to broadcast a note to everyone.',
                ),
              mode: z
                .enum(AGENT_MESSAGE_DELIVERY_MODES)
                .optional()
                .describe(
                  'call = trigger the target immediately (default); note = async targeted note only.',
                ),
            },
            handler: async (args: Record<string, unknown>) => {
              const content = String(args.content ?? '').trim()
              if (content.length === 0) {
                return {
                  content: [
                    { type: 'text' as const, text: 'agent_message requires non-empty content.' },
                  ],
                  isError: true,
                }
              }
              if (discussionConcludedReason != null) {
                return {
                  content: [
                    {
                      type: 'text' as const,
                      text: `Discussion has already ended (${discussionConcludedReason}).`,
                    },
                  ],
                  isError: true,
                }
              }
              // 名称→id 容错解析；解析失败直接报可用名单，不进 dispatch 链路。
              const targetRefRaw =
                typeof args.targetAgentId === 'string' ? args.targetAgentId.trim() : ''
              const resolvedTarget =
                targetRefRaw.length > 0 ? resolveMemberRef(targetRefRaw) : undefined
              const mode: AgentMessageDeliveryMode = args.mode === 'note' ? 'note' : 'call'
              if (targetRefRaw.length > 0 && resolvedTarget == null) {
                return {
                  content: [
                    {
                      type: 'text' as const,
                      text: `Unknown teammate "${targetRefRaw}". Use one of: ${rosterHint()}. Pass the exact id in targetAgentId.`,
                    },
                  ],
                  isError: true,
                }
              }
              const senderAgentId = ctx.hostAgent.id
              const since = new Date().toISOString()
              const result = await this.getTeamDispatchService().recordPeerMessage(
                {
                  content,
                  senderAgentId,
                  ...(resolvedTarget != null ? { targetAgentId: resolvedTarget.id } : {}),
                  delivery: resolvedTarget == null ? 'note' : mode,
                  discussionId,
                  roundIndex: currentDiscussionRound,
                },
                {
                  sessionId: ctx.sessionId,
                  turnId: ctx.turnId,
                  hostAgentId: ctx.teamConfig.hostAgentId,
                  callerAgentId: senderAgentId,
                  discussionId,
                  roundIndex: currentDiscussionRound,
                  members: ctx.members,
                  teamConfig: ctx.teamConfig,
                  allowedWorkerIds: new Set(ctx.members.map((member) => member.id)),
                  currentDepth: ctx.currentDepth ?? 0,
                  emitEvent: (event) =>
                    this.emitAndPersist(ctx.sessionId, ctx.turnId, event, ctx.eventRepo),
                  ...(ctx.signal != null ? { signal: ctx.signal } : {}),
                  ...(ctx.deadlineAt != null ? { deadlineAt: ctx.deadlineAt } : {}),
                  executeMember: ({
                    member,
                    task: memberTask,
                    dispatchId,
                    signal,
                    memberDepth,
                    deadlineAt,
                  }) =>
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
                      deadlineAt,
                      members: ctx.members,
                      teamConfig: ctx.teamConfig,
                      ...(discussionId != null
                        ? {
                            discussionId,
                            discussionRoundIndex: currentDiscussionRound,
                          }
                        : {}),
                      ...(ctx.hostPermissionMode != null
                        ? { hostPermissionMode: ctx.hostPermissionMode }
                        : {}),
                    }),
                },
              )
              if (!result.ok) {
                return {
                  content: [{ type: 'text' as const, text: result.message }],
                  isError: true,
                }
              }
              const text =
                resolvedTarget != null
                  ? mode === 'note'
                    ? `Note left for ${resolvedTarget.id}.`
                    : result.reply != null
                      ? formatReplyForHost(result.reply)
                      : `Message sent to ${resolvedTarget.id}.`
                  : 'Broadcast note added to the shared discussion thread.'
              // 同步 call 期间目标可能又向群里广播（现场 bug）：把这些同期广播回流给发起者。
              const delta = collectPeerBroadcastDelta(since, senderAgentId)
              return {
                content: [{ type: 'text' as const, text: appendDelta(text, delta) }],
                ...(result.reply != null
                  ? { structuredContent: result.reply as unknown as { [x: string]: unknown } }
                  : {}),
              }
            },
          }
        : null

    const roundAdvanceDef: TeamToolDefinition | null =
      discussionId != null && ctx.hostAgent.id === ctx.teamConfig.hostAgentId
        ? {
            name: 'team_round_advance',
            description:
              'Advance the shared team discussion to the next round and optionally store a short round summary.',
            schema: {
              summary: z
                .string()
                .max(8000)
                .optional()
                .describe('Optional round summary to anchor future prompt context.'),
            },
            handler: async (args: Record<string, unknown>) => {
              if (discussionRepo == null) {
                return {
                  content: [
                    {
                      type: 'text' as const,
                      text: 'Round control is unavailable without an active discussion.',
                    },
                  ],
                  isError: true,
                }
              }
              if (discussionConcludedReason != null) {
                return {
                  content: [
                    {
                      type: 'text' as const,
                      text: `Discussion has already ended (${discussionConcludedReason}).`,
                    },
                  ],
                  isError: true,
                }
              }
              const summary = String(args.summary ?? '')
              const advanced = discussionRepo.advanceRound(
                discussionId,
                summary,
                crypto.randomUUID(),
              )
              if (advanced == null) {
                const discussion = discussionRepo.getById(discussionId)
                const nextRound = currentDiscussionRound + 1
                if (discussion != null && nextRound > discussion.max_rounds) {
                  discussionRepo.conclude(discussionId, { reason: 'max_rounds' })
                  this.getTeamDispatchService().clearDiscussion(discussionId)
                  discussionConcludedReason = 'max_rounds'
                  this.emitAndPersist(
                    ctx.sessionId,
                    ctx.turnId,
                    {
                      id: crypto.randomUUID(),
                      type: 'team_discussion_concluded',
                      sessionId: ctx.sessionId,
                      turnId: ctx.turnId,
                      timestamp: new Date().toISOString(),
                      seq: 0,
                      discussionId,
                      reason: 'max_rounds',
                    },
                    ctx.eventRepo,
                  )
                  return {
                    content: [
                      {
                        type: 'text' as const,
                        text: `Max discussion rounds (${discussion.max_rounds}) reached. Discussion concluded.`,
                      },
                    ],
                    isError: true,
                  }
                }
                return {
                  content: [
                    { type: 'text' as const, text: 'Unable to advance the discussion round.' },
                  ],
                  isError: true,
                }
              }
              currentDiscussionRound = advanced.discussion.round_index
              this.emitAndPersist(
                ctx.sessionId,
                ctx.turnId,
                {
                  id: crypto.randomUUID(),
                  type: 'team_round_advanced',
                  sessionId: ctx.sessionId,
                  turnId: ctx.turnId,
                  timestamp: new Date().toISOString(),
                  seq: 0,
                  discussionId,
                  round: advanced.discussion.round_index,
                  maxRounds: advanced.discussion.max_rounds,
                },
                ctx.eventRepo,
              )
              return {
                content: [
                  {
                    type: 'text' as const,
                    text: `Discussion advanced to round ${advanced.discussion.round_index}/${advanced.discussion.max_rounds}.`,
                  },
                ],
              }
            },
          }
        : null

    const concludeDef: TeamToolDefinition | null =
      discussionId != null && ctx.hostAgent.id === ctx.teamConfig.hostAgentId
        ? {
            name: 'team_conclude',
            description:
              'Conclude the shared team discussion. After this, no more dispatch or peer messages are allowed in the current discussion.',
            schema: {},
            handler: async () => {
              if (discussionRepo == null) {
                return {
                  content: [
                    {
                      type: 'text' as const,
                      text: 'Conclude is unavailable without an active discussion.',
                    },
                  ],
                  isError: true,
                }
              }
              if (discussionConcludedReason != null) {
                return {
                  content: [
                    {
                      type: 'text' as const,
                      text: `Discussion already ended (${discussionConcludedReason}).`,
                    },
                  ],
                }
              }
              discussionRepo.conclude(discussionId, { reason: 'concluded' })
              this.getTeamDispatchService().clearDiscussion(discussionId)
              discussionConcludedReason = 'concluded'
              this.emitAndPersist(
                ctx.sessionId,
                ctx.turnId,
                {
                  id: crypto.randomUUID(),
                  type: 'team_discussion_concluded',
                  sessionId: ctx.sessionId,
                  turnId: ctx.turnId,
                  timestamp: new Date().toISOString(),
                  seq: 0,
                  discussionId,
                  reason: 'concluded',
                },
                ctx.eventRepo,
              )
              return {
                content: [{ type: 'text' as const, text: 'Discussion concluded.' }],
              }
            },
          }
        : null

    // 只读线程查询：凡有真实讨论（discussionId 非空）即注入给 Host 与全体成员，
    // **不**受 enablePeerMessaging / host 身份门控——注入进 prompt 的共享讨论快照是截断
    // 预览，任何参与者都可能需要翻聊天记录看某条被省略的全文或更早的历史。
    const threadReadDef: TeamToolDefinition | null =
      discussionId != null && discussionRepo != null
        ? {
            name: 'team_thread_read',
            description: [
              'Read the shared team discussion thread (the group chat log).',
              'Use this when the injected "[Discussion So Far]" snapshot is not enough: a message was truncated with 〔省略 …〕, you need the full text a teammate posted, or you want to see earlier history/another round that scrolled out of the snapshot.',
              'Two modes:',
              '  • Full one message: pass messageId (copy the id shown in a listing result) to get that single message UNtruncated.',
              '  • Browse the log: omit messageId to page through messages — filter by round and/or fromAgentId, use limit/offset to paginate, order "asc" (oldest first, default) or "desc" (newest first).',
              'This is READ-ONLY; it never notifies anyone. To actually talk to a teammate use agent_message instead.',
            ].join('\n'),
            schema: {
              messageId: z
                .string()
                .optional()
                .describe(
                  'Fetch this single message in full (untruncated). Copy the id from a prior listing result. When set, other filters are ignored.',
                ),
              round: z
                .number()
                .int()
                .min(0)
                .optional()
                .describe('Only messages from this discussion round.'),
              fromAgentId: z
                .string()
                .optional()
                .describe(
                  'Only messages sent by this participant (agent id or unique name; host id also works).',
                ),
              limit: z
                .number()
                .int()
                .min(1)
                .max(50)
                .optional()
                .describe('Max messages to return in browse mode (default 15, max 50).'),
              offset: z
                .number()
                .int()
                .min(0)
                .optional()
                .describe('Skip this many messages (for paging through a long thread).'),
              order: z
                .enum(['asc', 'desc'])
                .optional()
                .describe('asc = oldest first (default), desc = newest first.'),
            },
            handler: async (args: Record<string, unknown>) => {
              // 单条全文模式
              const messageIdRaw = typeof args.messageId === 'string' ? args.messageId.trim() : ''
              if (messageIdRaw.length > 0) {
                const msg = discussionRepo.findMessageById(messageIdRaw)
                if (msg == null || msg.discussion_id !== discussionId) {
                  return {
                    content: [
                      {
                        type: 'text' as const,
                        text: `No message "${messageIdRaw}" in this discussion. Browse the thread (omit messageId) to find valid ids.`,
                      },
                    ],
                    isError: true,
                  }
                }
                return { content: [{ type: 'text' as const, text: formatThreadMessageFull(msg) }] }
              }

              // 浏览模式
              const fromRaw = typeof args.fromAgentId === 'string' ? args.fromAgentId.trim() : ''
              const resolvedFrom =
                fromRaw.length > 0
                  ? (resolveMemberRef(fromRaw)?.id ??
                    (fromRaw === ctx.teamConfig.hostAgentId ? fromRaw : fromRaw))
                  : undefined
              const limit =
                typeof args.limit === 'number'
                  ? Math.min(Math.max(Math.trunc(args.limit), 1), 50)
                  : 15
              const offset =
                typeof args.offset === 'number' ? Math.max(Math.trunc(args.offset), 0) : 0
              const order: 'asc' | 'desc' = args.order === 'desc' ? 'desc' : 'asc'
              const { messages, total } = discussionRepo.queryMessages({
                discussionId,
                limit,
                offset,
                order,
                ...(typeof args.round === 'number' ? { roundIndex: Math.trunc(args.round) } : {}),
                ...(resolvedFrom != null ? { senderAgentId: resolvedFrom } : {}),
              })
              if (messages.length === 0) {
                return {
                  content: [
                    {
                      type: 'text' as const,
                      text: `No messages match (total in thread: ${total}).`,
                    },
                  ],
                }
              }
              const shownEnd = offset + messages.length
              const header = `Showing ${offset + 1}–${shownEnd} of ${total} message(s)${shownEnd < total ? ` — increase offset to ${shownEnd} for more.` : '.'}`
              const body = messages.map((m) => formatThreadMessageBrowse(m)).join('\n\n')
              return { content: [{ type: 'text' as const, text: `${header}\n\n${body}` }] }
            },
          }
        : null

    const workflowDef: TeamToolDefinition | null =
      ctx.workflowGraph != null &&
      hasWorkflowExecutableNodes(ctx.workflowGraph, ctx.workflowWorkerIds, ctx.hostAgent.id)
        ? {
            name: 'workflow_run',
            description:
              'Execute the managed workflow agent nodes sequentially for the current objective.',
            schema: { objective: z.string().max(8000) },
            handler: async (args: Record<string, unknown>) => {
              const objective = String(args.objective ?? '')
              const runRepo = new WorkflowRunRepository(this.db)
              const graphNodeIds = new Set(ctx.workflowGraph!.nodes.map((n) => n.id))
              // 每个节点实际会用到的派发目标 + 生效模型（节点自己的 config.modelId 优先，
              // 否则回落到该 agentId 在花名册里的默认值）——供下面的 workflow_progress 事件
              // 渲染实时进度面板时，展示的模型跟本次实际执行一致，而不是这个 agent 的静态默认值。
              const membersById = new Map(ctx.members.map((m) => [m.id, m]))
              const nodeMeta = new Map<
                string,
                {
                  title: string
                  kind: string
                  agentId?: string
                  agentName?: string
                  modelId?: string
                }
              >()
              const availableWorkerIds = new Set(ctx.members.map((m) => m.id))
              for (const node of ctx.workflowGraph!.nodes) {
                const agentId =
                  getWorkflowNodeEffectiveWorkerId(node, {
                    fallbackAgentId: ctx.hostAgent.id,
                    availableWorkerIds,
                  }) ?? undefined
                const member = agentId != null ? membersById.get(agentId) : undefined
                const modelId =
                  typeof node.config.modelId === 'string' && node.config.modelId.trim().length > 0
                    ? node.config.modelId.trim()
                    : (member?.modelId ?? undefined)
                nodeMeta.set(node.id, {
                  title: node.title,
                  kind: node.kind,
                  ...(agentId != null ? { agentId } : {}),
                  ...(member?.name != null ? { agentName: member.name } : {}),
                  ...(modelId != null ? { modelId } : {}),
                })
              }
              const emitWorkflowProgress = (
                runStatus: 'working' | 'completed' | 'failed' | 'canceled',
                runningNodeIds: ReadonlySet<string>,
                completedNodeIds: ReadonlySet<string>,
                failedNodeId?: string,
              ): void => {
                const nodes = ctx.workflowGraph!.nodes.map((node) => {
                  const meta = nodeMeta.get(node.id)
                  const status: import('@spark/protocol').WorkflowProgressNodeStatus =
                    node.id === failedNodeId
                      ? 'failed'
                      : completedNodeIds.has(node.id)
                        ? 'completed'
                        : runningNodeIds.has(node.id)
                          ? 'running'
                          : 'pending'
                  return {
                    nodeId: node.id,
                    title: meta?.title ?? node.id,
                    kind: meta?.kind ?? node.kind,
                    status,
                    ...(meta?.agentId != null ? { agentId: meta.agentId } : {}),
                    ...(meta?.agentName != null ? { agentName: meta.agentName } : {}),
                    ...(meta?.modelId != null ? { modelId: meta.modelId } : {}),
                  }
                })
                this.emitAndPersist(
                  ctx.sessionId,
                  ctx.turnId,
                  {
                    id: crypto.randomUUID(),
                    type: 'workflow_progress',
                    sessionId: ctx.sessionId,
                    turnId: ctx.turnId,
                    timestamp: new Date().toISOString(),
                    seq: 0,
                    workflowId: ctx.workflowId ?? '',
                    runStatus,
                    nodes,
                  },
                  ctx.eventRepo,
                )
              }

              // 自动续跑：同 (session, workflow) 有未完成 run 则复用其 state + 已完成节点（仅取仍存在于当前图的节点）。
              let runId: string | null = null
              let initialState: Record<string, unknown> | undefined
              let initialCompletedNodeIds: string[] | undefined
              if (ctx.workflowId != null) {
                const resumable = runRepo.findLatestResumable(ctx.sessionId, ctx.workflowId)
                if (resumable != null) {
                  runId = resumable.id
                  try {
                    initialState = JSON.parse(resumable.state_json) as Record<string, unknown>
                  } catch {
                    initialState = undefined
                  }
                  try {
                    const ids = JSON.parse(resumable.completed_node_ids_json) as string[]
                    initialCompletedNodeIds = Array.isArray(ids)
                      ? ids.filter((id) => graphNodeIds.has(id))
                      : undefined
                  } catch {
                    initialCompletedNodeIds = undefined
                  }
                  log.info('workflow run: resume', {
                    sessionId: ctx.sessionId,
                    workflowId: ctx.workflowId,
                    runId,
                    skipped: initialCompletedNodeIds?.length ?? 0,
                  })
                } else {
                  runId = runRepo.create({
                    sessionId: ctx.sessionId,
                    turnId: ctx.turnId,
                    workflowId: ctx.workflowId,
                    objective,
                    graph: ctx.workflowGraph as unknown as Record<string, unknown>,
                  }).id
                  log.info('workflow run: start', {
                    sessionId: ctx.sessionId,
                    workflowId: ctx.workflowId,
                    runId,
                  })
                }
              }

              const result = await executeWorkflowAgentPlan({
                graph: ctx.workflowGraph!,
                objective,
                ...(ctx.workflowAttachments != null && ctx.workflowAttachments.length > 0
                  ? { attachments: ctx.workflowAttachments }
                  : {}),
                fallbackAgentId: ctx.hostAgent.id,
                availableWorkerIds: new Set(ctx.members.map((member) => member.id)),
                ...(initialState != null ? { initialState } : {}),
                ...(initialCompletedNodeIds != null ? { initialCompletedNodeIds } : {}),
                onSnapshot: (snap) => {
                  if (runId != null) {
                    runRepo.updateSnapshot(runId, {
                      status: snap.status,
                      state: snap.state,
                      executions: snap.executions,
                      atomicExecutions: snap.atomicExecutions,
                      completedNodeIds: snap.completedNodeIds,
                      ...(snap.failedNode != null ? { failedNode: snap.failedNode } : {}),
                      ...(snap.status !== 'working' ? { endedAt: new Date().toISOString() } : {}),
                    })
                  }
                  emitWorkflowProgress(
                    snap.status,
                    new Set(snap.runningNodeIds),
                    new Set(snap.completedNodeIds),
                    snap.failedNode?.nodeId,
                  )
                },
                executeAtomicNode: async (request) => {
                  // 原子节点按 kind 显式自执行：
                  // - verify：跑校验命令（runWorkflowVerifyNode）。
                  // - approval：经 onQuestion 暂停等待用户审批，拒绝则节点失败、停止工作流。
                  // - input：LLM 把 prompt/objective/constraint/value 拆解为结构化 JSON；派发失败或
                  //   LLM 输出非法 JSON 时回落透传 getDefaultWorkflowAtomicContent 并追加提示。
                  // - skill/tool/mcp/plan/review/artifact：config.execution!=='static' 时经临时受限
                  //   worker 真实派发单轮执行（skill 只挂 skillIds、tool 收窄 toolIds、mcp 只挂
                  //   mcpServerIds、input/plan/review 只读工具集）；artifact 另外支持 exportPath 写盘。
                  //   配 execution:'static' 或该 kind 不在真实执行集内时，回落静态回显。
                  switch (request.kind) {
                    case 'verify':
                      return runWorkflowVerifyNode(request, ctx.workspaceRootPath)
                    case 'approval':
                      return this.runWorkflowApprovalNode(ctx.sessionId, request)
                    case 'input':
                    case 'skill':
                    case 'tool':
                    case 'mcp':
                    case 'plan':
                    case 'review':
                    case 'artifact': {
                      // config.execution:'static' 或该节点未登记临时 worker 时回落静态回显。
                      const execution =
                        typeof request.config.execution === 'string'
                          ? request.config.execution.trim()
                          : ''
                      const workerId = workflowAtomicMemberId(request.nodeId)
                      const isRegistered = ctx.members.some((m) => m.id === workerId)
                      if (execution === 'static' || !isRegistered) {
                        return this.finalizeWorkflowArtifactContent(
                          request,
                          getDefaultWorkflowAtomicContent(request),
                          ctx.workspaceRootPath,
                        )
                      }
                      const reply = await runSingleDispatch({
                        targetAgentId: workerId,
                        instruction: buildWorkflowAtomicInstruction(request),
                        inputs: request.inputs,
                      })
                      if (reply.state !== 'completed') {
                        return {
                          state: reply.state,
                          content: reply.content,
                          error: {
                            ...(reply.error?.code != null ? { code: reply.error.code } : {}),
                            message:
                              reply.error?.message ??
                              `Workflow ${request.kind} node ${request.nodeId} did not complete successfully.`,
                          },
                        }
                      }
                      // input 节点：校验 reply.content 为合法结构化 JSON；非法 JSON 回落透传 + 提示。
                      if (request.kind === 'input') {
                        const fallback = getDefaultWorkflowAtomicContent(request)
                        const validated = validateWorkflowInputStructuredContent(
                          reply.content,
                          fallback,
                        )
                        if (!validated.ok) {
                          log.warn(
                            'workflow input: invalid JSON from LLM, fallback to passthrough',
                            {
                              sessionId: ctx.sessionId,
                              node: request.nodeId,
                            },
                          )
                        }
                        return { content: validated.content }
                      }
                      // artifact 节点在成功后按 exportPath 写盘（其余 kind 该方法直接透传内容）。
                      return this.finalizeWorkflowArtifactContent(
                        request,
                        reply.content,
                        ctx.workspaceRootPath,
                      )
                    }
                    default:
                      return { content: getDefaultWorkflowAtomicContent(request) }
                  }
                },
                dispatch: async (request, options) => {
                  const reply = await runSingleDispatch(
                    {
                      targetAgentId: request.agentId,
                      instruction: request.instruction,
                      inputs: request.inputs,
                      ...(request.attachments != null && request.attachments.length > 0
                        ? { attachments: request.attachments }
                        : {}),
                    },
                    options?.parallel === true,
                  )
                  if (reply.state !== 'completed') {
                    const message =
                      reply.error?.message ??
                      `Workflow worker ${request.agentId} did not complete successfully.`
                    return {
                      state: reply.state,
                      content: reply.content,
                      error: {
                        ...(reply.error?.code != null ? { code: reply.error.code } : {}),
                        message,
                      },
                    }
                  }
                  return { state: 'completed', content: reply.content }
                },
              })
              const workflowRunLog = result.status === 'completed' ? log.info : log.warn
              workflowRunLog('workflow run: ' + result.status, {
                sessionId: ctx.sessionId,
                runId,
                executions: result.executions.length,
                failedNode: result.failedNode?.nodeId,
              })
              const text =
                result.status === 'completed'
                  ? `Workflow completed ${result.executions.length} agent node attempt(s). Final state: ${JSON.stringify(result.state)}`
                  : `Workflow ${result.status} at node ${result.failedNode?.nodeId ?? 'unknown'} after ${result.failedNode?.attempt ?? 0} attempt(s). Error: ${result.failedNode?.error.message ?? 'Unknown error'}. Final state: ${JSON.stringify(result.state)}`
              return {
                content: [
                  {
                    type: 'text' as const,
                    text,
                  },
                ],
                structuredContent: result as unknown as { [x: string]: unknown },
              }
            },
          }
        : null

    const defs: TeamToolDefinition[] = [
      ...(ctx.exposeTeamDispatchTools ? [dispatchDef, dispatchBatchDef] : []),
      ...(agentMessageDef != null ? [agentMessageDef] : []),
      ...(roundAdvanceDef != null ? [roundAdvanceDef] : []),
      ...(concludeDef != null ? [concludeDef] : []),
      ...(threadReadDef != null ? [threadReadDef] : []),
      ...(workflowDef != null ? [workflowDef] : []),
    ]
    if (defs.length === 0) return null

    if (isCodexConsumer) {
      // Codex consumers use the HTTP MCP bridge so SDK-backed chat-wire providers keep team tools.
      const handle = await getTeamMcpHttpBridge().serve(
        defs,
        ctx.signal != null ? { signal: ctx.signal } : undefined,
      )
      // FR-0b 修复（审查 B-1）：登记 handle 以便 turn 结束清理（防 codex Host 每 turn leak 一个 ServedSession）。
      const handleSet = this.teamMcpHandlesByTurn.get(ctx.turnId) ?? new Set<TeamMcpBridgeHandle>()
      handleSet.add(handle)
      this.teamMcpHandlesByTurn.set(ctx.turnId, handleSet)
      const server: SDKMcpServerConfig = {
        type: 'http',
        url: handle.url,
        headers: { Authorization: `Bearer ${handle.token}` },
      }
      this.teamMcpToolNames.set(server, new Set(defs.map((d) => d.name)))
      return server
    }

    // claude 消费者：in-process（现状）
    const factory = await loadSdkMcpFactory()
    if (factory == null) return null
    const tools = defs.map((d) => factory.tool(d.name, d.description, d.schema, d.handler))
    // 注：server 名保留 'spark_team' 以兼容现有代码/测试/文档；它现已是 goal/workflow/team
    // 通用的编排派发通道（agent_dispatch / agent_dispatch_batch / workflow_run），非仅团队模式。
    const server = factory.createSdkMcpServer({
      name: SPARK_TEAM_MCP_SERVER_NAME,
      version: '0.2.0',
      tools,
    }) as SDKMcpServerConfig
    this.teamMcpToolNames.set(server, new Set(defs.map((d) => d.name)))
    return server
  }

  /**
   * approval 原子节点：暂停工作流，经 onQuestion 向用户请求「批准/拒绝 + 修改意见」。
   * - 无问询通道（onQuestion 为空，例如无人值守自动化）时：默认放行并记审计，不阻塞自动化。
   * - 用户拒绝（或问询失败/未明确批准）时：节点失败，停止工作流。
   * - 批准时若附带修改意见：拼到 content 末尾（`[审批修改意见] ...`），随 outputKey 自动流向下游。
   *   零协议改动——复用现有 UserQuestionPrompt 一次问询两个 question（decision + comment）。
   */
  private async runWorkflowApprovalNode(
    sessionId: string,
    request: { title: string; objective: string; config: Record<string, unknown> },
  ): Promise<import('./workflow-executor.js').WorkflowAtomicNodeExecutionReply> {
    const content = getDefaultWorkflowAtomicContent(request)
    // 无人值守 / 无问询通道时：不阻塞自动化，默认放行并记审计。
    if (this.onQuestion == null) {
      log.info('workflow approval: auto-approved (no question handler)', {
        sessionId,
        node: request.title,
      })
      return { content }
    }
    const decisionQuestion: UserQuestionPrompt = {
      id: 'workflow-approval-decision',
      header: '工作流审批',
      question: `工作流节点「${request.title}」请求继续：\n${content}`,
      type: 'single_choice',
      options: [
        { label: '批准', value: 'approve' },
        { label: '拒绝', value: 'reject' },
      ],
    }
    const commentQuestion: UserQuestionPrompt = {
      id: 'workflow-approval-comment',
      header: '修改意见（可选）',
      question: '附带修改意见，将随审批结果传递给下游节点',
      type: 'text',
      multiline: true,
      placeholder: '可选：附带修改意见，将随审批结果传递给下游节点',
      allowSkip: true,
    }
    try {
      const answers = await this.onQuestion(sessionId, [decisionQuestion, commentQuestion], {})
      // 决策按既有 onQuestion 答案解析方式判断（参见 claude-sdk-executor 的
      // findRawQuestionAnswer / extractQuestionAnswerText）：answers.answers 可能是
      // 以 question/id/index 定位的对象数组，单条答案的取值候选为 answer/text/optionLabel/optionValue/value。
      const approved = this.isWorkflowApprovalApproved(answers, decisionQuestion, 0)
      if (!approved) {
        log.warn('workflow approval: rejected by user', { sessionId, node: request.title })
        return {
          state: 'failed',
          content,
          error: { code: 'denied', message: `用户拒绝了审批节点「${request.title}」。` },
        }
      }
      const comment = this.extractWorkflowApprovalComment(answers, commentQuestion, 1)
      log.info('workflow approval: approved', {
        sessionId,
        node: request.title,
        hasComment: comment.length > 0,
      })
      if (comment.length > 0) {
        return { content: `${content}\n\n[审批修改意见] ${comment}` }
      }
      return { content }
    } catch (err) {
      log.warn('workflow approval: error, treating as rejected', {
        sessionId,
        node: request.title,
        error: err instanceof Error ? err.message : String(err),
      })
      return {
        state: 'failed',
        content,
        error: { code: 'internal', message: '审批节点处理失败。' },
      }
    }
  }

  /**
   * 从 onQuestion 答案里提取审批修改意见（comment 问题的 answer/text/value 字段）。
   * 与 isWorkflowApprovalApproved 相对的「按 question 引用 + 数组下标」定位方式，
   * 取值候选：answer/text/value/optionValue/optionLabel；空串或 skipped/declined 视为无意见。
   */
  private extractWorkflowApprovalComment(
    answers: Record<string, unknown>,
    question: UserQuestionPrompt,
    index: number,
  ): string {
    return extractWorkflowApprovalCommentImpl(answers, question, index)
  }

  /**
   * artifact 节点收尾：配了 config.exportPath（工作区相对路径且不穿越）时，把最终内容写入 host
   * 工作区文件并在返回内容里追加导出提示；未配置或非 artifact 节点则原样透传内容。
   * 写盘失败不让整个节点失败——产物内容本身已经产出，导出只是附带副作用，失败降级为提示。
   */
  private async finalizeWorkflowArtifactContent(
    request: {
      nodeId: string
      kind: import('@spark/protocol').WorkflowNodeKind
      config: Record<string, unknown>
    },
    content: string,
    workspaceRootPath: string,
  ): Promise<import('./workflow-executor.js').WorkflowAtomicNodeExecutionReply> {
    if (request.kind !== 'artifact') return { content }
    const resolved = resolveWorkflowArtifactExportPath(request.config, workspaceRootPath)
    if (!resolved.ok) {
      // 只在「配了但非法」时提示；完全没配 exportPath（reason 为空）时静默透传。
      if (resolved.reason != null) {
        log.warn('workflow artifact: invalid exportPath', {
          node: request.nodeId,
          reason: resolved.reason,
        })
        return { content: `${content}\n\n[artifact 导出跳过：${resolved.reason}]` }
      }
      return { content }
    }
    try {
      const { writeFile, mkdir } = await import('node:fs/promises')
      await mkdir(path.dirname(resolved.absolutePath), { recursive: true })
      await writeFile(resolved.absolutePath, content, 'utf8')
      log.info('workflow artifact: exported', { node: request.nodeId, path: resolved.absolutePath })
      return { content: `${content}\n\n[artifact 已导出到 ${resolved.absolutePath}]` }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      log.warn('workflow artifact: export failed', { node: request.nodeId, error: message })
      return { content: `${content}\n\n[artifact 导出失败：${message}]` }
    }
  }

  /**
   * 解析 onQuestion 返回的答案，判断审批节点是否被「明确批准」。
   * 防御式：取消/拒绝/跳过，或取不到明确的 approve/批准 取值，一律视为未批准。
   * 复用 claude-sdk-executor 中相同的定位与取值约定。
   *
   * 现在 onQuestion 一次问两个问题（decision + comment），decision 在数组下标 0、comment 在 1。
   * index 显式传入定位（默认 0 兼容历史单问询调用），id/question 引用仍优先匹配。
   */
  private isWorkflowApprovalApproved(
    answers: Record<string, unknown>,
    question: UserQuestionPrompt,
    index = 0,
  ): boolean {
    return isWorkflowApprovalApprovedImpl(answers, question, index)
  }

  /** 在 answers.answers（对象数组或映射）里按 question 引用 + 数组下标定位原始答案条目。 */
  private findWorkflowApprovalAnswer(
    rawAnswers: unknown,
    question: UserQuestionPrompt,
    index = 0,
  ): unknown {
    return findWorkflowApprovalAnswerImpl(rawAnswers, question, index)
  }

  /** 从单条答案里取出可读文本（候选：answer/text/optionLabel/optionValue/value）。 */
  private extractWorkflowApprovalText(raw: unknown): string {
    return extractWorkflowApprovalTextImpl(raw)
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
    /** 外层 dispatch deadline，成员同步咨询队友时继续传给 agent_message call。 */
    deadlineAt?: number
    members: AgentItem[]
    teamConfig: TeamModeConfig
    discussionId?: string
    discussionRoundIndex?: number
    /** 宿主会话的生效权限模式（用于成员继承 bypass/full-access） */
    hostPermissionMode?: SessionPermissionMode
  }): Promise<TeamMemberExecutionResult> {
    const {
      member,
      task,
      dispatchId,
      sessionId,
      turnId,
      workspaceRootPath,
      eventRepo,
      signal,
      memberDepth,
      deadlineAt,
      members,
      teamConfig,
      discussionId,
      discussionRoundIndex,
      hostPermissionMode,
    } = args

    if (signal.aborted || this.disposing) return { content: '', partial: true }

    // 团队模式下成员权限固定为自动放行策略（自动接受编辑、不向用户弹审批窗），避免多成员
    // 并发时审批窗互相打断。会话框的权限切换只对 host 生效。
    // FR-0a：成员按 member.agentAdapter 选择执行器——claude 成员走 ClaudeSDKExecutor +
    // claude-auto，codex 成员走 createCodexExecutorForConfig + codex-auto-review（对齐各自
    // 体系“自动放行”档位）。hostIsFullAccess 仅用于向下层嵌套团队透传“宿主已完全放行”标记。
    const hostIsFullAccess =
      hostPermissionMode === 'claude-bypass' || hostPermissionMode === 'codex-full-access'

    // 解析 member 的 provider/apiKey/model；member 未配置 provider 时回落到会话 provider。
    // FR-0a：isLocalCli/apiKey 校验与 providerConfig 字段与 Host 主循环（~1131-1176）对齐，
    // 使 codex（含本地 codex CLI）成员可被 dispatch。
    const sessionRepo = new SessionRepository(this.db)
    const providerRepo = new ProviderProfileRepository(this.db)
    const session = sessionRepo.findByIdOrFail(sessionId)
    let providerProfileId = member.providerProfileId ?? session.provider_profile_id
    if (providerProfileId == null)
      throw new Error('Member has no provider profile and session has none')
    const loadProvider = (id: string) => {
      const row = providerRepo.get(id)
      if (row == null) throw new Error(`Member provider profile not found: ${id}`)
      return row
    }
    const memberRouteMessage = buildMemberUserMessage(task)
    const modelProfilesForRouting = new ModelProfileRepository(this.db).list()
    const providersForRouting = providerRowsForModelRouter(providerRepo.listAll())
    const autoRouterAdapter = getAutoRouterAdapterForProviderId(providerProfileId)
    let provider: ProviderProfileRow
    let isLocalCli: boolean
    let providerConfig: {
      defaultModel?: string
      model?: string
      modelIds?: string[]
      apiEndpoint?: string
      /** 'chat' (chat.completions) or 'responses' (OpenAI Responses API; Codex models) */
      codexApiKind?: 'chat' | 'responses'
      haikuModel?: string
      sonnetModel?: string
      opusModel?: string
    }
    let model: string

    if (autoRouterAdapter != null) {
      const selectedRoutingModelId = member.modelId?.trim() ?? ''
      if (!selectedRoutingModelId)
        throw new Error(`Member auto router ${providerProfileId} requires a routing model card`)
      const routeSelection = new ModelRouterService().resolveModelSelection({
        selectedModelId: selectedRoutingModelId,
        modelProfiles: modelProfilesForRouting,
        providers: providersForRouting,
        message: memberRouteMessage,
        estimatedTokens: Math.ceil(memberRouteMessage.length / 3),
      })
      if (routeSelection == null)
        throw new Error(`Member routing model not found or disabled: ${selectedRoutingModelId}`)
      if (routeSelection.adapter !== autoRouterAdapter) {
        throw new Error(
          `Member routing model adapter mismatch: expected ${autoRouterAdapter}, got ${routeSelection.adapter}`,
        )
      }
      providerProfileId = routeSelection.providerProfileId
      provider = loadProvider(providerProfileId)
      isLocalCli = isBuiltInLocalCliProvider(provider)
      providerConfig = JSON.parse(provider.config_json) as typeof providerConfig
      model = routeSelection.modelId
    } else {
      provider = loadProvider(providerProfileId)
      isLocalCli = isBuiltInLocalCliProvider(provider)
      providerConfig = JSON.parse(provider.config_json) as typeof providerConfig
      model = (
        isLocalCli
          ? getLocalCliDefaultModel(provider)
          : (member.modelId ?? providerConfig.defaultModel ?? providerConfig.model ?? '')
      ).trim()
      if (!model) throw new Error('Member has no resolvable model')
    }
    if (!isLocalCli && provider.keystore_ref == null)
      throw new Error('Member provider has no keystore ref')
    const apiKey = isLocalCli ? '' : await resolveProviderApiKey(provider)
    if (!isLocalCli && apiKey.length === 0) throw new Error('Member provider API key not found')
    // 成员 adapter：member 显式配置优先，否则回落会话级（与 Host mention 分支同款取数）。
    const memberAdapter = getAgentAdapterFromSession(
      member.agentAdapter ?? session.agent_adapter,
      session.chat_mode,
      provider.provider_type,
    )
    // FR-0a：按 adapter 解析执行器档位 + codex sdkConfig 扩展字段（抽纯函数
    // resolveCodexMemberExecutionProfile 便于单测、防 Host/member 漂移）。
    const memberProfile = resolveCodexMemberExecutionProfile({
      memberAdapter,
      isLocalCli,
      providerType: provider.provider_type,
      providerProfileId,
      providerName: provider.name,
      apiKey,
      codexApiKind: providerConfig.codexApiKind,
      apiEndpoint: providerConfig.apiEndpoint,
    })
    const { isCodexMember } = memberProfile
    const effectiveMemberMode = memberProfile.permissionMode

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
      log.warn(
        `Member env injection failed (non-fatal): ${err instanceof Error ? err.message : String(err)}`,
      )
    }
    const hostAgentForPrompt = new AgentRepository(this.db).get(teamConfig.hostAgentId) ?? member
    const memberCanUseNestedTeamTools = teamConfig.allowNesting && memberDepth < teamConfig.maxDepth
    // peer messaging（agent_message）与嵌套派发（agent_dispatch）是两个独立能力：
    // 前者只看 enablePeerMessaging + 真实讨论存在，不要求 allowNesting/maxDepth——
    // 否则默认配置（allowNesting=false, maxDepth=1）下成员永远拿不到 agent_message，
    // 表现为「成员知道讨论上下文却只能把话带回 Host 转发」的假 A2A。
    const memberCanPeerMessage = discussionId != null && teamConfig.enablePeerMessaging === true
    // 信息与能力分离（2026-07-04）：花名册 + 讨论线程（信息）只要是真实团队讨论
    // （discussionId 非空；workflow 合成 teamConfig 无 discussion，天然排除）就注入——
    // peer messaging 关着时成员也必须知道团队里有谁；agent_message 工具（能力）按开关。
    const memberTeamPrompt =
      discussionId != null
        ? buildTeamRosterPrompt(hostAgentForPrompt, members, teamConfig, {
            perspective: 'member',
            viewingMember: member,
            enablePeerMessaging: memberCanPeerMessage,
            threadSnippet: this.getTeamDiscussionRepository().renderThreadForPrompt(
              discussionId,
              teamConfig.threadContextTokenBudget,
              member.id,
            ),
          })
        : undefined
    const memberSystemPrompt =
      joinPromptSections(
        buildManagedAgentSystemPrompt(member, null),
        memberTeamPrompt,
        memberEnvPrompt || undefined,
      ) ?? ''
    const userMessage = memberRouteMessage
    const canContinueDiscussionSession =
      discussionId != null &&
      !isCodexMember &&
      isSdkResumeSafe({
        providerType: provider.provider_type,
        model,
        agentAdapter: memberAdapter,
        ...(providerConfig.apiEndpoint != null ? { apiEndpoint: providerConfig.apiEndpoint } : {}),
      })
    const memberSdkSessionId = canContinueDiscussionSession
      ? makeSdkRuntimeSessionId(
          sessionId,
          providerProfileId,
          model,
          memberAdapter,
          buildMemberContinuityKey(buildTeamContinuityScope(discussionId), member.id),
        )
      : crypto.randomUUID()

    // Member 自身的 MCP 工具
    const memberMcpServers = await this.buildMcpServersForSDK(getAllowedMcpServerIds(member, null))
    // 内置联网搜索对团队成员同样默认挂载
    const memberWebSearchServer = await this.resolveWebSearchMcpServer(workspaceRootPath)
    if (memberWebSearchServer != null) memberMcpServers.spark_search = memberWebSearchServer
    // 成员的 spark_team 工具面，三个独立触发条件（满足其一即注入 server）：
    //  - 嵌套派发（agent_dispatch/agent_dispatch_batch）：allowNesting && memberDepth < maxDepth；
    //  - 对等消息（agent_message）：enablePeerMessaging && 真实讨论存在（memberCanPeerMessage）；
    //  - 只读线程查询（team_thread_read）：只要是真实讨论（discussionId != null）——注入的讨论
    //    快照是截断预览，成员即便在 peer messaging 关着时也可能要翻聊天记录读被省略的全文。
    // exposeTeamDispatchTools 只跟嵌套条件走——peer/thread 开而嵌套关时，成员只拿到
    // agent_message / team_thread_read（createTeamMcpServer 按 defs 动态组装），不会越权获得 dispatch 能力。
    const memberCanReadThread = discussionId != null
    let memberTeamServer: SDKMcpServerConfig | undefined
    if (memberCanUseNestedTeamTools || memberCanPeerMessage || memberCanReadThread) {
      memberTeamServer =
        (await this.createTeamMcpServer({
          sessionId,
          turnId,
          hostAgent: member,
          members,
          teamConfig,
          workspaceRootPath,
          eventRepo,
          currentDepth: memberDepth,
          ...(deadlineAt != null ? { deadlineAt } : {}),
          consumerAdapter: memberAdapter,
          signal,
          codexConsumerIsOpenAi: isOpenAiOnlyCodexConsumer({
            isCodex: isCodexMember,
            isLocalCli,
            providerType: provider.provider_type,
            codexApiKind: providerConfig.codexApiKind,
          }),
          exposeTeamDispatchTools: memberCanUseNestedTeamTools,
          ...(discussionId != null
            ? {
                discussionId,
                discussionRoundIndex,
              }
            : {}),
          ...(hostIsFullAccess && hostPermissionMode != null ? { hostPermissionMode } : {}),
        })) ?? undefined
      if (memberTeamServer != null) memberMcpServers.spark_team = memberTeamServer
    }

    const sdkConfig: SDKExecutorConfig = {
      apiKey,
      model,
      workspaceRootPath,
      permissionMode: effectiveMemberMode,
      ...(providerConfig.apiEndpoint != null ? { apiEndpoint: providerConfig.apiEndpoint } : {}),
      // FR-0a：codex 扩展字段（useLocalConfig/codexApiKind/codexCliProvider）来自 memberProfile.extras。
      ...memberProfile.extras,
      ...(providerConfig.haikuModel != null ? { haikuModel: providerConfig.haikuModel } : {}),
      ...(providerConfig.sonnetModel != null ? { sonnetModel: providerConfig.sonnetModel } : {}),
      ...(providerConfig.opusModel != null ? { opusModel: providerConfig.opusModel } : {}),
      ...(memberSystemPrompt.trim().length > 0 ? { systemPrompt: memberSystemPrompt } : {}),
      ...(memberCustomEnv != null ? { customEnv: memberCustomEnv } : {}),
      ...(Object.keys(memberMcpServers).length > 0 ? { mcpServers: memberMcpServers } : {}),
      // 有团队工具时预批准（含内置搜索）；始终禁用内置 Task（§7.4）。
      // teamMcpToolNames 记录的是 server 实际注册的 defs（嵌套关时只有 agent_message）。
      ...(memberTeamServer != null
        ? {
            allowedTools: [
              ...[
                ...(this.teamMcpToolNames.get(memberTeamServer) ??
                  new Set<TeamToolName>(['agent_dispatch', 'agent_dispatch_batch'])),
              ].map((toolName) => qualifyTeamToolName(toolName as TeamToolName)),
              ...SEARCH_TOOL_NAMES,
            ],
          }
        : {}),
      // 始终禁用 Task；节点配了 toolIds（工作流「工具」选择器）时额外收窄到白名单——
      // 用 disallowedTools = 全量可限制工具 - toolIds，而不是直接把 toolIds 当 allowedTools，
      // 因为 allowedTools 在 SDK 里只是"免审批"名单，不是"仅允许"名单，压根挡不住其它工具。
      // SendMessage 是 Claude Agent SDK 原生子代理（Task 体系）的通信工具，与 spark_team
      // 的团队编排是两套系统——成员的 Task 已禁用，SendMessage 在成员上下文里零合法目标，
      // 只会诱导模型拿队友名字去调然后报 "No agent named X is currently addressable"，
      // 抢走本该走 mcp__spark_team__agent_message 的 A2A 流量，故一并禁用（真实线上误用案例 2026-07-04）。
      disallowedTools: mergeUniqueStrings(
        ['Task', 'SendMessage'],
        memberDisallowedToolsFromConfig(member),
      ),
      enableCheckpoints: false,
      sdkSessionId: memberSdkSessionId,
      continueSession: canContinueDiscussionSession,
      ...(this.onHookTrigger != null
        ? { applicationHookCallback: this.onHookTrigger }
        : {}),
      ...(this.onApproval != null
        ? {
            approvalCallback: async (
              sid: string,
              toolName: string,
              toolInput: Record<string, unknown>,
              context: SDKPermissionRequestContext,
            ) => {
              this.emitAgentStatusEvent(sid, turnId, eventRepo, 'waiting_permission')
              try {
                return await this.onApproval!(sid, toolName, toolInput, context)
              } finally {
                this.emitAgentStatusEvent(sid, turnId, eventRepo, 'thinking')
              }
            },
          }
        : {}),
      ...(this.onQuestion != null
        ? {
            questionCallback: async (
              sid: string,
              questions: UserQuestionPrompt[],
              context: SDKQuestionRequestContext,
            ) => {
              this.emitAgentStatusEvent(sid, turnId, eventRepo, 'waiting_user')
              try {
                return await this.onQuestion!(sid, questions, context)
              } finally {
                this.emitAgentStatusEvent(sid, turnId, eventRepo, 'thinking')
              }
            },
          }
        : {}),
    }

    // FR-0a：按成员 adapter 选择执行器——claude 走 ClaudeSDKExecutor，codex 复用 Host 路径
    // 同款工厂 createCodexExecutorForConfig（按 useLocalConfig/codexCliProvider/codexApiKind 选
    // CodexCli/CodexSdk）。四执行器 onEvent/cancel/executeTurn 签名一致，监听复用。
    const executor = isCodexMember
      ? createCodexExecutorForConfig(sdkConfig)
      : new ClaudeSDKExecutor()

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
      const started = await runMemberExecutorIfActive({
        signal,
        isDisposing: () => this.disposing,
        cancel: () => executor.cancel(),
        execute: () => executor.executeTurn(sessionId, crypto.randomUUID(), userMessage, sdkConfig),
      })
      if (!started) aborted = true
    } catch (err) {
      // 被超时/取消（signal abort）打断：不抛错，回传已累积的部分产出（partial）。
      // 真实执行错误才向上抛出，交由 TeamDispatchService 标记 failed。
      if (!signal.aborted) throw err
      aborted = true
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

  private recordUsageUpdate(
    sessionId: string,
    turnId: string,
    event: Extract<AgentEvent, { type: 'usage_update' }>,
  ): void {
    const key = this.usageLedgerKey(sessionId, turnId)
    const prev = this.usageLedgerLastByTurn.get(key) ?? {
      inputTokens: 0,
      outputTokens: 0,
      reasoningOutputTokens: 0,
      cacheHitTokens: 0,
      cacheWriteTokens: 0,
      estimatedCostUsd: 0,
    }
    const current = {
      inputTokens: Math.max(0, event.inputTokens),
      outputTokens: Math.max(0, event.outputTokens),
      reasoningOutputTokens: Math.max(0, event.reasoningOutputTokens ?? 0),
      cacheHitTokens: Math.max(0, event.cacheHitTokens ?? 0),
      cacheWriteTokens: Math.max(0, event.cacheWriteTokens ?? 0),
      estimatedCostUsd: Math.max(0, event.estimatedCostUsd ?? 0),
    }
    this.usageLedgerLastByTurn.set(key, current)

    const inputTokens = Math.max(0, current.inputTokens - prev.inputTokens)
    const outputTokens = Math.max(0, current.outputTokens - prev.outputTokens)
    const reasoningOutputTokens = Math.max(
      0,
      current.reasoningOutputTokens - prev.reasoningOutputTokens,
    )
    const cacheReadTokens = Math.max(0, current.cacheHitTokens - prev.cacheHitTokens)
    const cacheWriteTokens = Math.max(0, current.cacheWriteTokens - prev.cacheWriteTokens)
    const costUsd = Math.max(0, current.estimatedCostUsd - prev.estimatedCostUsd)
    if (
      inputTokens === 0 &&
      outputTokens === 0 &&
      reasoningOutputTokens === 0 &&
      cacheReadTokens === 0 &&
      cacheWriteTokens === 0 &&
      costUsd === 0
    )
      return

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
        reasoningOutputTokens,
        cacheReadTokens,
        cacheWriteTokens,
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
    const seq = this.eventSequencer.reserve(sessionId, eventRepo)
    const sequenced = { ...event, seq }
    try {
      persistAndPublishAgentEvent(eventRepo, sequenced, this.onEvent)
    } catch (err) {
      if (err instanceof AgentEventPersistenceError) {
        log.error('Failed to persist session event', {
          sessionId,
          turnId,
          eventId: sequenced.id,
          eventType: sequenced.type,
          seq,
          error: err.message,
        })
      }
      throw err
    }
    if (event.type === 'usage_update') {
      this.recordUsageUpdate(sessionId, turnId, event)
    }

    // 触发 hook：检测 agent_status 事件的关键状态变化
    if (event.type === 'agent_status') {
      const status = event.status
      const turnRequests = new TurnRequestRepository(this.db)
      if (status === 'completed' || status === 'idle') {
        turnRequests.markCompleted(turnId)
      } else if (status === 'cancelled') {
        turnRequests.cancel(turnId)
      } else if (status === 'error') {
        turnRequests.markFailed(turnId, event.message ?? 'Turn failed')
      }
      if (status === 'completed') {
        this.onHookTrigger?.(sessionId, 'session_end', {
          title: 'Spark Agent - 任务完成',
          body: '当前任务已完成',
        })
      } else if (status === 'error' || status === 'cancelled') {
        this.onHookTrigger?.(sessionId, 'session_fail', {
          title: status === 'cancelled' ? 'Spark Agent - 任务已取消' : 'Spark Agent - 任务失败',
          body:
            event.message ?? (status === 'cancelled' ? '当前任务已取消' : '任务执行出错，请检查'),
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
    if (this.disposePromise != null) return this.disposePromise
    this.disposing = true
    this.disposePromise = (async () => {
      const trackedExecutions = [...this.activeExecutionPromises.entries()]
      const executions = new Set<ActiveExecution>([
        ...trackedExecutions.map(([execution]) => execution),
        ...this.activeLoops.values(),
      ])
      const sessionIds = new Set([
        ...trackedExecutions.map(([, tracked]) => tracked.sessionId),
        ...this.activeLoops.keys(),
      ])

      for (const sessionId of sessionIds) this.onApprovalCancel?.(sessionId)
      const teamDispatchShutdown = this.teamDispatchService?.cancelAllAndWait()
      for (const execution of executions) execution.cancel()
      this.activeLoops.clear()
      this.startingSessions.clear()
      this.pendingTurns.clear()
      this.pendingPlanApprovals.clear()

      const pending = [
        ...trackedExecutions.map(([, tracked]) => tracked.promise),
        ...(teamDispatchShutdown != null ? [teamDispatchShutdown] : []),
      ]
      if (pending.length > 0) {
        await new Promise<void>((resolve) => {
          const timeout = setTimeout(resolve, 5_000)
          void Promise.allSettled(pending).then(() => {
            clearTimeout(timeout)
            resolve()
          })
        })
      }

      await this.platformBridge.stop()
      // FR-0b 修复（审查 B-3）：进程退出时关停所有残留桥接会话 + HTTP server。
      for (const turnId of this.teamMcpHandlesByTurn.keys()) {
        this.closeTeamMcpHandlesForTurn(turnId)
      }
      await getTeamMcpHttpBridge().dispose()
    })()
    return this.disposePromise
  }

  /** FR-0b 修复（审查 B-1）：关闭某 turn 期间创建的所有 codex HTTP 桥接 handle（防 leak）。 */
  private closeTeamMcpHandlesForTurn(turnId: string): void {
    const handles = this.teamMcpHandlesByTurn.get(turnId)
    if (handles == null) return
    this.teamMcpHandlesByTurn.delete(turnId)
    for (const handle of handles) {
      void handle.close().catch((err: unknown) => {
        log.warn('team MCP bridge handle close failed during turn cleanup', err)
      })
    }
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
    if (cancelled) {
      new TurnRequestRepository(this.db).cancel(params.turnId)
      this.emitQueueChanged(params.sessionId)
    }
    return {
      cancelled,
      queuedTurns: this.queueSnapshot(params.sessionId).queuedTurns,
    }
  }

  /**
   * 立即执行队列中的某个 turn：中断当前任务，将该 turn 提到最前面执行，其余排队保持原序。
   * 上下文（会话历史事件）天然保留在 DB 中，新 turn 的 startTurn 会正常读取。
   */
  async sendQueuedTurnNow(params: {
    sessionId: string
    turnId: string
  }): Promise<SessionSendQueuedTurnNowResponse> {
    const { sessionId, turnId } = params
    const queue = this.pendingTurns.get(sessionId) ?? []
    const targetIdx = queue.findIndex((t) => t.turnId === turnId)
    if (targetIdx === -1) {
      return { started: false, queuedTurns: this.queueSnapshot(sessionId).queuedTurns }
    }
    const targetTurn = queue.splice(targetIdx, 1)[0]!

    // 没有正在执行的任务 → 直接启动
    if (!this.activeLoops.has(sessionId)) {
      queue.unshift(targetTurn)
      this.pendingTurns.set(sessionId, queue)
      this.pendingPlanApprovals.delete(sessionId)
      this.emitQueueChanged(sessionId)
      setTimeout(() => this.startNextQueuedTurn(sessionId), 0)
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
    if (this.disposing) return
    // Plan 模式审批未完成前，队列暂停自动起跑：用户必须先批准/拒绝/切换权限模式，
    // 否则后续 turn 会跨越审批弹窗自行执行，破坏用户预期。
    if (this.pendingPlanApprovals.has(sessionId)) {
      this.emitQueueChanged(sessionId)
      return
    }
    if (this.activeLoops.has(sessionId) || this.startingSessions.has(sessionId)) {
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
    const requestRepo = new TurnRequestRepository(this.db)
    const durableRequest = requestRepo.get(next.turnId)
    if (durableRequest != null && !requestRepo.markRunning(next.turnId)) {
      this.emitQueueChanged(sessionId)
      setTimeout(() => this.startNextQueuedTurn(sessionId), 0)
      return
    }
    this.startingSessions.add(sessionId)
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
      .catch(error => this.handleQueuedTurnStartFailure(sessionId, next, error))
      .finally(() => {
        this.startingSessions.delete(sessionId)
        if (!this.activeLoops.has(sessionId)) this.startNextQueuedTurn(sessionId)
      })
  }

  private handleQueuedTurnStartFailure(
    sessionId: string,
    turn: PendingTurn,
    error: unknown,
  ): void {
    const eventRepo = new EventRepository(this.db)
    const sessionRepo = new SessionRepository(this.db)
    const existing = eventRepo.queryBySession({ sessionId, turnId: turn.turnId, limit: 200 }).events
    const eventTypes = new Set(existing.map(item => item.event_type))
    const hasTerminalStatus = existing.some(item => {
      if (item.event_type !== 'agent_status') return false
      try {
        const status = (JSON.parse(item.event_json) as { status?: string }).status
        return status === 'completed' || status === 'error' || status === 'cancelled'
      } catch {
        return false
      }
    })
    if (hasTerminalStatus) return
    const message = error instanceof Error ? error.message : String(error)
    const isPlatformCredentialError =
      message.includes('平台模型') ||
      message.includes('平台账户') ||
      message.includes('spark-platform-newapi')
    const base = () => ({
      id: crypto.randomUUID(),
      sessionId,
      turnId: turn.turnId,
      timestamp: new Date().toISOString(),
      seq: 0,
    })
    if (!eventTypes.has('user_message')) {
      this.emitAndPersist(sessionId, turn.turnId, {
        ...base(),
        type: 'user_message',
        content: turn.message,
        ...(turn.attachments ? { attachments: turn.attachments } : {}),
      }, eventRepo)
    }
    if (!eventTypes.has('agent_error')) {
      this.emitAndPersist(sessionId, turn.turnId, {
        ...base(),
        type: 'agent_error',
        code: isPlatformCredentialError ? 'PLATFORM_CREDENTIAL_UNAVAILABLE' : 'TURN_START_FAILED',
        message,
        retryable: true,
      }, eventRepo)
    }
    this.emitAndPersist(sessionId, turn.turnId, {
      ...base(),
      type: 'agent_status',
      status: 'error',
      message: isPlatformCredentialError
        ? '平台模型凭据暂不可用，请在账号中心选择“在本机继续”后重试'
        : 'Queued turn failed to start',
    }, eventRepo)
    sessionRepo.updateStatus(sessionId, 'error')
    new TurnRequestRepository(this.db).markFailed(turn.turnId, message)
    log.error('queued turn failed to start', { sessionId, turnId: turn.turnId, error: message })
  }

  private queueSnapshot(sessionId: string): SessionGetQueueResponse {
    return {
      sessionId: sessionId as SessionId,
      running: this.activeLoops.has(sessionId) || this.startingSessions.has(sessionId),
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
    if (this.disposing) return
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
    const nextStatus: GoalStatus | 'continue' | 'blocked' =
      parsed.status === 'completed'
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

  /**
   * 契约旁路：目标处于 pending_contract 时，从起草 turn 的助手输出里解析 spark-goal-contract，
   * 写入目标契约并 emit goal_contract_proposed（仍保持 pending_contract，等待用户确认）。
   */
  private updateGoalContractFromAssistantBlock(sessionId: string, content: string): void {
    const repo = new GoalRepository(this.db)
    const goal = repo.getCurrent(sessionId)
    if (goal == null || goal.status !== 'pending_contract') return
    const contract = parseGoalContractBlock(content)
    if (contract == null) return
    const updated =
      repo.updateContract(goal.id, {
        successCriteria: contract.successCriteria,
        constraints: contract.constraints,
        validation: contract.validation,
      }) ?? goal
    this.emitGoalEvent(
      sessionId,
      updated,
      'goal_contract_proposed',
      'pending_contract',
      'Acceptance contract proposed; awaiting confirmation',
      {},
      contract,
    )
    log.info('goal gate: contract proposed', {
      sessionId,
      goalId: goal.id,
      criteria: contract.successCriteria.length,
    })
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
    budget?: {
      maxIterations?: number
      maxRuntimeMinutes?: number
      maxBudgetUsd?: number
      maxConsecutiveFailures?: number
      noProgressLimit?: number
    }
    mode?: 'spark-loop' | 'codex-native' | 'auto'
  }): Promise<SessionGoalResponse> {
    const repo = new GoalRepository(this.db)
    const session = new SessionRepository(this.db).get(params.sessionId)
    const mode =
      params.mode === 'codex-native' ||
      (params.mode === 'auto' && session?.agent_adapter === 'codex')
        ? 'codex-native'
        : 'spark-loop'
    const goal = repo.createOrReplaceActiveGoal({
      sessionId: params.sessionId,
      objective: params.objective.trim(),
      successCriteria: params.successCriteria ?? [],
      constraints: params.constraints ?? [],
      validation: params.validation ?? {},
      budget: params.budget ?? { maxIterations: 12, maxConsecutiveFailures: 3, noProgressLimit: 3 },
      mode,
    })
    // 验收门槛（Gate）：spark-loop 且未显式提供验收标准时，先起草一份待确认契约，
    // 不直接起跑——目标进入 pending_contract，跑一次起草 turn 产出 spark-goal-contract 块，
    // 由 updateGoalContractFromAssistantBlock 解析并 emit goal_contract_proposed，等待用户 /goal confirm。
    const needsContract = mode === 'spark-loop' && (params.successCriteria?.length ?? 0) === 0
    if (needsContract) {
      const pending = repo.updateStatus(goal.id, 'pending_contract') ?? goal
      this.emitGoalEvent(
        params.sessionId,
        pending,
        'goal_contract_drafting',
        'pending_contract',
        'Drafting acceptance contract for confirmation',
      )
      log.info('goal gate: drafting contract', { sessionId: params.sessionId, goalId: goal.id })
      const draftTurnId = crypto.randomUUID()
      await this.startTurn(
        params.sessionId,
        draftTurnId,
        buildGoalContractDraftPrompt(pending.objective),
      )
      return { goal: toProtocolGoal(repo.getCurrent(params.sessionId)) }
    }
    this.emitGoalEvent(params.sessionId, goal, 'goal_started', 'active', 'Goal started')
    await this.startGoalLoop(params.sessionId)
    return { goal: toProtocolGoal(goal) }
  }

  /**
   * 确认验收契约：把 pending_contract 目标转为 active 并启动循环。
   * 可选传入用户编辑后的契约（CLI MVP 不传，直接确认起草稿）。
   * 契约缺少 successCriteria 时拒绝启动、保持 pending_contract。
   */
  async confirmGoalContract(params: {
    sessionId: string
    contract?: {
      successCriteria?: string[]
      constraints?: string[]
      validation?: { commands?: string[]; checklist?: string[] }
    }
  }): Promise<SessionGoalResponse> {
    const repo = new GoalRepository(this.db)
    const goal = repo.getCurrent(params.sessionId)
    if (goal == null || goal.status !== 'pending_contract') return { goal: toProtocolGoal(goal) }
    if (params.contract != null) repo.updateContract(goal.id, params.contract)
    const refreshed = repo.getCurrent(params.sessionId) ?? goal
    if (refreshed.successCriteria.length === 0) {
      // 契约不完整，拒绝起跑，保持待确认
      log.warn('goal gate: confirm rejected (no success criteria)', {
        sessionId: params.sessionId,
        goalId: refreshed.id,
      })
      return { goal: toProtocolGoal(refreshed) }
    }
    const activated = repo.updateStatus(refreshed.id, 'active') ?? refreshed
    this.emitGoalEvent(
      params.sessionId,
      activated,
      'goal_started',
      'active',
      'Goal confirmed and started',
    )
    log.info('goal gate: contract confirmed, starting loop', {
      sessionId: params.sessionId,
      goalId: activated.id,
    })
    await this.startGoalLoop(params.sessionId)
    return { goal: toProtocolGoal(activated) }
  }

  /** 拒绝验收契约：清除 pending_contract 目标。 */
  async rejectGoalContract(params: { sessionId: string }): Promise<SessionGoalResponse> {
    const repo = new GoalRepository(this.db)
    const goal = repo.getCurrent(params.sessionId)
    if (goal == null || goal.status !== 'pending_contract') return { goal: toProtocolGoal(goal) }
    this.activeLoops.get(params.sessionId)?.cancel()
    const cleared = repo.clearCurrent(params.sessionId)
    this.emitGoalEvent(
      params.sessionId,
      cleared ?? goal,
      'goal_cleared',
      'cleared',
      'Acceptance contract rejected; goal cleared',
    )
    log.info('goal gate: contract rejected, cleared', { sessionId: params.sessionId })
    return { goal: toProtocolGoal(cleared) }
  }

  async controlGoal(params: {
    sessionId: string
    action: 'pause' | 'resume' | 'clear' | 'complete'
    summary?: string
  }): Promise<SessionGoalResponse> {
    const repo = new GoalRepository(this.db)
    const goal = repo.getCurrent(params.sessionId)
    if (goal == null) return { goal: null }
    if (params.action === 'pause') {
      const updated = repo.updateStatus(goal.id, 'paused')
      this.emitGoalEvent(
        params.sessionId,
        updated ?? goal,
        'goal_paused',
        'paused',
        params.summary ?? 'Goal paused',
      )
      return { goal: toProtocolGoal(updated) }
    }
    if (params.action === 'resume') {
      const updated = repo.updateStatus(goal.id, 'active')
      this.emitGoalEvent(
        params.sessionId,
        updated ?? goal,
        'goal_resumed',
        'active',
        params.summary ?? 'Goal resumed',
      )
      await this.startGoalLoop(params.sessionId)
      return { goal: toProtocolGoal(updated) }
    }
    if (params.action === 'complete') {
      const updated = repo.updateStatus(goal.id, 'completed')
      this.emitGoalEvent(
        params.sessionId,
        updated ?? goal,
        'goal_completed',
        'completed',
        params.summary ?? 'Goal completed',
      )
      return { goal: toProtocolGoal(updated) }
    }
    this.activeLoops.get(params.sessionId)?.cancel()
    const updated = repo.clearCurrent(params.sessionId)
    this.emitGoalEvent(
      params.sessionId,
      updated ?? goal,
      'goal_cleared',
      'cleared',
      params.summary ?? 'Goal cleared',
    )
    return { goal: toProtocolGoal(updated) }
  }

  private getGoalLoopBudgetStopSummary(sessionId: string, goal: StoredSessionGoal): string | null {
    const budget = goal.budget ?? {}
    const maxIterations = budget.maxIterations ?? 12
    if (goal.progressLog.length >= maxIterations) {
      return `Goal stopped after ${maxIterations} iterations.`
    }

    if (budget.maxBudgetUsd != null && Number.isFinite(budget.maxBudgetUsd)) {
      try {
        const usage = new UsageLedgerRepository(this.db).getSessionUsage(sessionId)
        if (usage.totalCostUsd >= budget.maxBudgetUsd) {
          return `Goal stopped after reaching budget limit: $${usage.totalCostUsd.toFixed(4)} >= $${budget.maxBudgetUsd.toFixed(4)}.`
        }
      } catch {
        // Older test doubles or partially migrated databases may not expose the ledger yet.
      }
    }

    if (budget.maxRuntimeMinutes != null && Number.isFinite(budget.maxRuntimeMinutes)) {
      const createdAtMs = Date.parse(goal.createdAt)
      if (Number.isFinite(createdAtMs)) {
        const elapsedMinutes = (Date.now() - createdAtMs) / 60_000
        if (elapsedMinutes >= budget.maxRuntimeMinutes) {
          return `Goal stopped after reaching runtime limit: ${elapsedMinutes.toFixed(1)} minutes >= ${budget.maxRuntimeMinutes} minutes.`
        }
      }
    }

    if (budget.maxConsecutiveFailures != null && budget.maxConsecutiveFailures > 0) {
      const trailingFailures = this.countTrailingFailureLikeGoalProgress(goal.progressLog)
      if (trailingFailures >= budget.maxConsecutiveFailures) {
        return `Goal stopped after ${trailingFailures} consecutive failed or blocked iterations.`
      }
    }

    if (budget.noProgressLimit != null && budget.noProgressLimit > 0) {
      const trailingNoProgress = this.countTrailingContinueEntriesWithoutProgressEvidence(
        goal.progressLog,
      )
      if (trailingNoProgress >= budget.noProgressLimit) {
        return `Goal stopped after ${trailingNoProgress} consecutive iterations without progress evidence.`
      }
    }

    return null
  }

  private countTrailingFailureLikeGoalProgress(progressLog: GoalProgressEntry[]): number {
    let count = 0
    for (let index = progressLog.length - 1; index >= 0; index -= 1) {
      const status = progressLog[index]?.status
      if (status !== 'failed' && status !== 'blocked' && status !== 'paused') break
      count += 1
    }
    return count
  }

  private countTrailingContinueEntriesWithoutProgressEvidence(
    progressLog: GoalProgressEntry[],
  ): number {
    let count = 0
    for (let index = progressLog.length - 1; index >= 0; index -= 1) {
      const entry = progressLog[index]
      if (entry == null || entry.status !== 'continue') break
      if (this.hasGoalProgressEvidence(entry)) break
      if (this.hasGoalProgressNextStepChanged(progressLog, index)) break
      count += 1
    }
    return count
  }

  private hasGoalProgressEvidence(entry: GoalProgressEntry): boolean {
    if ((entry.evidence?.length ?? 0) > 0) return true
    if (entry.validation != null && Object.keys(entry.validation).length > 0) return true
    return false
  }

  private hasGoalProgressNextStepChanged(progressLog: GoalProgressEntry[], index: number): boolean {
    const current = progressLog[index]?.nextStep?.trim() ?? ''
    const previous = index > 0 ? (progressLog[index - 1]?.nextStep?.trim() ?? '') : ''
    return current !== previous
  }

  private stopGoalLoopByBudget(
    repo: GoalRepository,
    sessionId: string,
    goal: StoredSessionGoal,
    summary: string,
  ): void {
    const stopped = repo.updateStatus(goal.id, 'stopped_by_budget') ?? goal
    this.emitGoalEvent(sessionId, stopped, 'goal_budget_stopped', 'stopped_by_budget', summary)
  }

  private async startGoalLoop(sessionId: string): Promise<void> {
    const repo = new GoalRepository(this.db)
    const goal = repo.getCurrent(sessionId)
    if (goal == null || goal.status !== 'active') return
    if (this.activeLoops.has(sessionId)) return
    const budgetStopSummary = this.getGoalLoopBudgetStopSummary(sessionId, goal)
    if (budgetStopSummary != null) {
      log.warn('goal loop: stopped by budget', { sessionId, goalId: goal.id })
      this.stopGoalLoopByBudget(repo, sessionId, goal, budgetStopSummary)
      return
    }
    log.info('goal loop: iteration', { sessionId, iteration: goal.progressLog.length + 1 })
    const turnId = crypto.randomUUID()
    const prompt = buildGoalIterationPrompt(goal)
    repo.appendProgress(goal.id, {
      iteration: goal.progressLog.length + 1,
      phase: 'review',
      status: 'continue',
      summary: 'Started review/act/validate iteration.',
      nextStep: 'Agent is working on the next verifiable step.',
    })
    this.emitGoalEvent(sessionId, goal, 'goal_progress', 'active', 'Started next Goal iteration', {
      phase: 'review',
    })
    await this.startTurn(sessionId, turnId, prompt)
  }

  private emitGoalEvent(
    sessionId: string,
    goal: StoredSessionGoal,
    type:
      | 'goal_started'
      | 'goal_progress'
      | 'goal_paused'
      | 'goal_resumed'
      | 'goal_completed'
      | 'goal_failed'
      | 'goal_cleared'
      | 'goal_budget_stopped'
      | 'goal_contract_drafting'
      | 'goal_contract_proposed',
    status: GoalStatus,
    summary: string,
    extra: Partial<GoalProgressEntry> = {},
    proposedContract?: ProposedGoalContract,
  ): void {
    const eventRepo = new EventRepository(this.db)
    const turnId = crypto.randomUUID()
    this.emitAndPersist(
      sessionId,
      turnId,
      {
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
        ...(proposedContract != null ? { proposedContract } : {}),
        budget: goal.budget as Record<string, unknown>,
      },
      eventRepo,
    )
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
    const eventRepo = new EventRepository(this.db)
    const turnId = getLatestTurnIdFromEvents(eventRepo, sessionId)
    loop.cancel()
    this.activeLoops.delete(sessionId)
    const sessionRepo = new SessionRepository(this.db)
    this.emitAndPersist(
      sessionId,
      turnId,
      createUserCancelledTurnEvent(sessionId, turnId),
      eventRepo,
    )
    sessionRepo.updateStatus(sessionId, 'idle')
    // 终止当前任务后，自动执行队列中的下一个任务
    this.startNextQueuedTurn(sessionId)
    return { cancelled: true }
  }

  /**
   * 用户拒绝当前会话的待审批计划（plan_proposed）。
   *
   * 与 cancelTurn 不同：这是针对 plan 审批的精准操作，**不会**触发全局的
   * teamDispatchService.cancelAll()，因此不会误伤其他会话进行中的 team 协作。
   *
   * 行为：
   *   1. 解除该会话的 plan 审批闸门（pendingPlanApprovals），让被阻塞的排队 turn
   *      恢复自动起跑——无需用户先手动发一条消息。
   *   2. 写入一条持久化的 plan_rejected 标记（归到该计划所属 turn），使历史回放
   *      （切换/重开会话）时能据此清空待审批态，避免已拒绝的计划重新弹出审批面板。
   */
  rejectPlan(sessionId: string): { rejected: boolean } {
    const wasPending = this.pendingPlanApprovals.has(sessionId)
    this.pendingPlanApprovals.delete(sessionId)
    if (!wasPending) return { rejected: false }

    const eventRepo = new EventRepository(this.db)
    // 把 plan_rejected 归到最近一条 plan_proposed 所在 turn，确保两者总是一起被
    // queryRenderableTurns 加载，回放时 MessageBuilder 才能可靠地清空待审批态。
    const latestPlan = eventRepo.getLatestByType(sessionId, 'plan_proposed')
    const turnId = latestPlan?.turn_id ?? crypto.randomUUID()
    this.emitAndPersist(
      sessionId,
      turnId,
      {
        id: crypto.randomUUID(),
        type: 'plan_rejected',
        sessionId,
        turnId,
        timestamp: new Date().toISOString(),
        seq: 0,
      },
      eventRepo,
    )

    // 闸门解除后恢复队列：无活跃 loop 时主动起跑下一个排队 turn。
    if (this.activeLoops.has(sessionId)) {
      this.emitQueueChanged(sessionId)
    } else {
      this.startNextQueuedTurn(sessionId)
    }
    return { rejected: wasPending }
  }

  /**
   * Session 删除时调用：清理 session 相关的内存状态。
   * 由 deleteSession 内部调用，避免 long-lived 进程内存泄漏。
   */
  private clearSessionMemory(sessionId: string): void {
    this.activeLoops.delete(sessionId)
    this.startingSessions.delete(sessionId)
    this.pendingTurns.delete(sessionId)
    this.pendingPlanApprovals.delete(sessionId)
    this.eventSequencer.clear(sessionId)
    this.iterationOverrides.delete(sessionId)
    TodoStore.clear(sessionId)
    getDebugLogServer().deleteSession(sessionId)
    this.onApprovalCancel?.(sessionId)
    this.emitQueueChanged(sessionId)
  }

  async getHistory(params: {
    sessionId: string
    full?: boolean
    limit?: number
    turnLimit?: number
    eventLimit?: number
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
        ...(params.eventLimit != null ? { eventLimit: params.eventLimit } : {}),
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
    const { sessions: rows, total } = sessionRepo.list(params ?? {})
    const sessions = rows.map((row) => ({
      id: row.id as SessionId,
      title: row.title,
      projectId: row.project_id,
      workspaceIds: sessionRepo.getWorkspaceIdsFromRow(row),
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
      turnCount: row.turn_count,
      logicalMessageCount: row.logical_message_count,
      messageCount: row.logical_message_count,
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
      if (session == null || session.archived_at != null) continue
      results.push({
        sessionId: match.sessionId as SessionId,
        title: session.title,
        snippet: match.snippet,
        matchType: 'content',
        updatedAt: session.updated_at,
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
    reasoningEffort?: SparkReasoningEffort
    debugMode?: boolean
  }): Promise<{ session: SessionListResponse['sessions'][number] }> {
    const sessionRepo = new SessionRepository(this.db)

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
      void active?.setPermissionMode?.(params.permissionMode)
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
        turnCount: row.turn_count,
        logicalMessageCount: row.logical_message_count,
        messageCount: row.logical_message_count,
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
      } catch {
        /* ignore */
      }
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
    const sessionRepo = new SessionRepository(this.db)
    this.clearSessionMemory(sessionId)
    const deleted = sessionRepo.delete(sessionId)
    if (deleted) this.cleanupSessionEventsInBackground(sessionId)
    return { deleted }
  }

  cleanupSessionEventsInBackground(sessionId: string): void {
    if (this.pendingSessionEventCleanups.has(sessionId)) return
    this.pendingSessionEventCleanups.add(sessionId)

    this.runEventCleanupInBatches({
      label: 'session event',
      context: { sessionId },
      deleteBatch: (repo) => repo.deleteBySessionBatch(sessionId, 1000),
      onFinish: () => this.pendingSessionEventCleanups.delete(sessionId),
    })
  }

  cleanupOrphanedSessionEventsInBackground(): void {
    if (this.orphanEventCleanupPending) return
    this.orphanEventCleanupPending = true

    this.runEventCleanupInBatches({
      label: 'orphan session event',
      context: {},
      deleteBatch: (repo) => repo.deleteOrphanedSessionEventsBatch(1000),
      onFinish: () => {
        this.orphanEventCleanupPending = false
      },
    })
  }

  private runEventCleanupInBatches(params: {
    label: string
    context: Record<string, unknown>
    deleteBatch: (repo: EventRepository) => number
    onFinish: () => void
  }): void {
    const eventRepo = new EventRepository(this.db)
    let totalDeleted = 0
    const cleanupBatch = () => {
      let shouldFinish = false
      try {
        const deleted = params.deleteBatch(eventRepo)
        totalDeleted += deleted
        if (deleted > 0) {
          setTimeout(cleanupBatch, 0)
          return
        }
        shouldFinish = true
        if (totalDeleted > 0) {
          log.info(`${params.label} cleanup completed`, {
            ...params.context,
            deleted: totalDeleted,
          })
        }
      } catch (err) {
        shouldFinish = true
        log.warn(`${params.label} cleanup failed`, {
          ...params.context,
          error: err instanceof Error ? err.message : String(err),
        })
      } finally {
        if (shouldFinish) {
          params.onFinish()
        }
      }
    }

    setTimeout(cleanupBatch, 0)
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

  /**
   * 还原代码检查点：用 checkpoint 锚点（SDK user-message uuid + sdkSessionId）resume
   * 出 SDK 会话并调用 `Query.rewindFiles(checkpointId)` 把被追踪文件回退到那一轮的状态。
   *
   * 这取代了早期自研的「按 path 拷贝快照」逻辑——后者依赖一份磁盘快照目录，实际从未由
   * 当前写入路径生成，是死代码。现在还原走 SDK 的真实模型（与 /rewind 同源）。
   *
   * 安全降级：缺会话锚点（sdkSessionId 为空）、找不到 checkpoint、rewindFiles 返回
   * canRewind=false、或任何异常，都抛出明确错误而不是崩溃或假装成功。M6 前端据此隐藏
   * 不可还原的入口。
   *
   * NOTE: happy-path（resume → rewindFiles → dispose）需在运行中的桌面会话里做运行时
   * 验证——本地无 API key / 活动 SDK 会话，无法在 CI 中跑通。
   */
  private async restoreCheckpointViaRewind(
    sessionId: string,
    checkpointRef: string,
  ): Promise<CheckpointRestoreResult> {
    log.info('checkpoint restore: attempt', { sessionId, checkpointRef })
    const eventRepo = new EventRepository(this.db)
    const checkpoints = listSessionCheckpointsFromEvents(eventRepo, sessionId)
    const checkpoint = checkpoints.find(
      (item) => item.checkpointId === checkpointRef || item.checkpointId.endsWith(checkpointRef),
    )
    if (checkpoint == null) {
      throw new Error(`Checkpoint not found: ${checkpointRef}`)
    }
    if (checkpoint.sdkSessionId == null) {
      log.warn('checkpoint restore: unsupported (no anchor)', { sessionId, checkpointRef })
      throw new Error(
        '该还原点不支持还原（缺少会话锚点；仅宿主会话且开启 checkpoint 的轮次可还原）。',
      )
    }

    // 解析 workspace + provider 配置，沿用 executeMemberTurn 的取数方式。
    const sessionRepo = new SessionRepository(this.db)
    const providerRepo = new ProviderProfileRepository(this.db)
    const session = sessionRepo.findByIdOrFail(sessionId)

    let workspaceRootPath = process.cwd()
    const workspaceIds = sessionRepo.getWorkspaceIds(sessionId)
    if (workspaceIds.length > 0) {
      const ws = new WorkspaceRepository(this.db).get(workspaceIds[0] ?? '')
      if (ws != null) workspaceRootPath = ws.root_path
    }

    const providerProfileId = session.provider_profile_id
    if (providerProfileId == null) throw new Error('会话未配置 provider，无法还原 checkpoint。')
    const provider = providerRepo.get(providerProfileId)
    if (provider?.keystore_ref == null) throw new Error('Provider 缺少 keystore ref，无法还原。')
    const apiKey = await resolveProviderApiKey(provider)
    if (!apiKey) throw new Error('未找到 Provider 的 API key，无法还原。')
    const providerConfig = JSON.parse(provider.config_json) as {
      defaultModel?: string
      model?: string
      apiEndpoint?: string
    }
    const model = (providerConfig.defaultModel ?? providerConfig.model ?? '').trim()
    if (!model) throw new Error('Provider 未解析出模型，无法还原。')

    const result = await new ClaudeSDKExecutor().rewindFiles({
      apiKey,
      model,
      workspaceRootPath,
      sdkSessionId: checkpoint.sdkSessionId,
      ...(providerConfig.apiEndpoint != null ? { apiEndpoint: providerConfig.apiEndpoint } : {}),
      userMessageId: checkpoint.checkpointId,
      dryRun: false,
    })

    if (!result.canRewind) {
      log.warn('checkpoint restore: cannot rewind', {
        sessionId,
        checkpointRef,
        error: result.error,
      })
      throw new Error(result.error ?? '无法还原该 checkpoint（rewindFiles 返回 canRewind=false）。')
    }

    log.info('checkpoint restore: done', {
      sessionId,
      checkpointId: checkpoint.checkpointId,
      files: result.filesChanged?.length ?? 0,
    })
    return {
      checkpointId: checkpoint.checkpointId,
      restoredFiles: result.filesChanged ?? [],
      missingFiles: [],
    }
  }

  // ── Checkpoint（git 方案：尊重 .gitignore、还原非破坏性，替代失效的 SDK rewindFiles）──

  private getCheckpointGitService(): CheckpointGitService {
    if (this.checkpointGitService == null) this.checkpointGitService = new CheckpointGitService()
    return this.checkpointGitService
  }

  /** 解析会话的工作区根目录（无则返回 null）。 */
  private resolveSessionWorkspaceRoot(sessionId: string): string | null {
    const workspaceIds = new SessionRepository(this.db).getWorkspaceIds(sessionId)
    if (workspaceIds.length === 0) return null
    const ws = new WorkspaceRepository(this.db).get(workspaceIds[0] ?? '')
    return ws?.root_path ?? null
  }

  /** 读会话 checkpoint 开关（metadata.checkpointEnabled，默认关）。 */
  getSessionCheckpointEnabled(sessionId: string): boolean {
    return new SessionRepository(this.db).getMetadata(sessionId).checkpointEnabled === true
  }

  /** 功能可用性：仅 git 仓库工作区可用（非 git 前端隐藏入口）。 */
  async getSessionCheckpointAvailable(sessionId: string): Promise<boolean> {
    const root = this.resolveSessionWorkspaceRoot(sessionId)
    if (root == null) return false
    return this.getCheckpointGitService().isGitRepo(root)
  }

  /** 设置会话 checkpoint 开关（写 metadata，浅合并）。 */
  setSessionCheckpointEnabled(sessionId: string, enabled: boolean): boolean {
    const repo = new SessionRepository(this.db)
    if (repo.get(sessionId) == null) return false
    repo.patchMetadata(sessionId, { checkpointEnabled: enabled })
    if (!enabled) this.getCheckpointGitService().resetGatingBaseline(sessionId)
    log.info('checkpoint toggle', { sessionId, enabled })
    return true
  }

  /**
   * 智能采集：会话开启 checkpoint 且工作区为 git 仓库时，在本轮（改文件前）尝试快照。
   * git 按 tree SHA 去重：工作区相对上个 checkpoint 无变化则不新建。失败不阻塞 turn。
   */
  private async maybeCaptureCheckpoint(
    sessionId: string,
    turnId: string,
    workspaceRootPath: string,
    eventRepo: EventRepository,
    label: string,
  ): Promise<void> {
    try {
      if (!this.getSessionCheckpointEnabled(sessionId)) return
      const svc = this.getCheckpointGitService()
      if (!(await svc.isGitRepo(workspaceRootPath))) return
      const checkpointId = crypto.randomUUID()
      const snap = await svc.snapshot(workspaceRootPath, sessionId, checkpointId, label)
      if (!snap.created) return // 无变化，跳过
      this.emitAndPersist(
        sessionId,
        turnId,
        {
          id: crypto.randomUUID(),
          type: 'checkpoint',
          sessionId,
          turnId,
          timestamp: new Date().toISOString(),
          seq: 0,
          checkpointId,
          label: label.slice(0, 80),
        },
        eventRepo,
      )
      log.info('checkpoint captured', { sessionId, checkpointId, files: snap.fileCount })
      const ids = listSessionCheckpointsFromEvents(eventRepo, sessionId).map((c) => c.checkpointId)
      await svc.prune(
        workspaceRootPath,
        sessionId,
        ids.slice(0, SessionService.MAX_CHECKPOINTS_PER_SESSION),
      )
    } catch (err) {
      log.warn('checkpoint capture failed (non-fatal)', {
        sessionId,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }

  /** 用 git 还原 checkpoint：安全拦截（同工作区有其他会话在跑则阻止）+ 还原前自动备份 + 非破坏性 restore。 */
  private async restoreCheckpointViaSnapshot(
    sessionId: string,
    checkpointRef: string,
  ): Promise<CheckpointRestoreResult> {
    log.info('checkpoint restore: attempt', { sessionId, checkpointRef })
    const eventRepo = new EventRepository(this.db)
    const checkpoints = listSessionCheckpointsFromEvents(eventRepo, sessionId)
    const checkpoint = checkpoints.find(
      (item) => item.checkpointId === checkpointRef || item.checkpointId.endsWith(checkpointRef),
    )
    if (checkpoint == null) throw new Error(`Checkpoint not found: ${checkpointRef}`)

    const workspaceRootPath = this.resolveSessionWorkspaceRoot(sessionId)
    if (workspaceRootPath == null) throw new Error('会话没有打开的工作区，无法还原。')
    const svc = this.getCheckpointGitService()
    if (!(await svc.isGitRepo(workspaceRootPath))) {
      throw new Error('当前工作区不是 git 仓库，代码还原点不可用。')
    }
    if (!(await svc.hasCheckpoint(workspaceRootPath, sessionId, checkpoint.checkpointId))) {
      throw new Error(`还原点已失效或被清理：${checkpoint.checkpointId}`)
    }

    // 安全拦截（#4）：同一工作区若有其他会话正在跑 turn，阻止还原以免影响它们。
    const conflicting = this.findOtherActiveSessionsOnWorkspace(sessionId, workspaceRootPath)
    if (conflicting.length > 0) {
      throw new Error(
        `已阻止还原：同一项目目录下有其他会话正在运行（${conflicting.length} 个）。还原会改动共享文件、影响它们。请先停止这些会话再还原。`,
      )
    }

    // 还原前自动备份当前态，使本次还原可被再次还原（撤销）。
    try {
      const undoId = crypto.randomUUID()
      const undo = await svc.snapshot(
        workspaceRootPath,
        sessionId,
        undoId,
        `还原前自动备份（${new Date().toLocaleString()}）`,
      )
      if (undo.created) {
        const undoTurnId = crypto.randomUUID()
        this.emitAndPersist(
          sessionId,
          undoTurnId,
          {
            id: crypto.randomUUID(),
            type: 'checkpoint',
            sessionId,
            turnId: undoTurnId,
            timestamp: new Date().toISOString(),
            seq: 0,
            checkpointId: undoId,
            label: '还原前自动备份',
          },
          eventRepo,
        )
      }
    } catch (err) {
      log.warn('checkpoint pre-restore backup failed (non-fatal)', {
        sessionId,
        error: err instanceof Error ? err.message : String(err),
      })
    }

    const outcome = await svc.restore(workspaceRootPath, sessionId, checkpoint.checkpointId)
    log.info('checkpoint restore: done', {
      sessionId,
      checkpointId: checkpoint.checkpointId,
      restored: outcome.restoredFiles.length,
    })
    return {
      checkpointId: checkpoint.checkpointId,
      restoredFiles: outcome.restoredFiles,
      missingFiles: [],
    }
  }

  /** 找出「同一工作区目录、且当前有活跃 turn」的其他会话（用于还原安全拦截）。 */
  private findOtherActiveSessionsOnWorkspace(
    sessionId: string,
    workspaceRootPath: string,
  ): string[] {
    const result: string[] = []
    for (const otherId of this.activeLoops.keys()) {
      if (otherId === sessionId) continue
      if (this.resolveSessionWorkspaceRoot(otherId) === workspaceRootPath) result.push(otherId)
    }
    return result
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
  const turnId = getLatestTurnIdFromEvents(eventRepo, sessionId)
  const timestamp = new Date().toISOString()
  const seq = eventRepo.nextSeqBySession(sessionId)
  const persistedEvents = eventRepo.queryStreamEventsByTurn(sessionId, turnId).flatMap((row) => {
    try {
      return [JSON.parse(row.event_json) as AgentEvent]
    } catch {
      return []
    }
  })
  const events = createInterruptedTurnEvents(sessionId, turnId, seq, timestamp, persistedEvents)

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

function getLatestTurnIdFromEvents(eventRepo: EventRepository, sessionId: string): string {
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
  return turnId
}

export function createUserCancelledTurnEvent(
  sessionId: string,
  turnId: string,
  timestamp: string = new Date().toISOString(),
): AgentStatusEvent {
  return {
    id: crypto.randomUUID(),
    type: 'agent_status',
    sessionId,
    turnId,
    timestamp,
    seq: 0,
    status: 'cancelled',
    message: 'Stopped by user',
  }
}

export function createInterruptedTurnEvents(
  sessionId: string,
  turnId: string,
  seq: number,
  timestamp: string = new Date().toISOString(),
  persistedEvents: AgentEvent[] = [],
): AgentEvent[] {
  let nextSeq = seq
  const terminalizer = new StreamTerminalizer()
  for (const event of persistedEvents) terminalizer.observe(event)
  const completed = terminalizer.finalize(() => ({
    id: crypto.randomUUID(),
    sessionId,
    turnId,
    timestamp,
    seq: nextSeq++,
  }))
  return [
    ...completed,
    {
      id: crypto.randomUUID(),
      type: 'agent_error',
      sessionId,
      turnId,
      timestamp,
      seq: nextSeq++,
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
      seq: nextSeq,
      status: 'cancelled',
      message: 'Stopped after app restart',
    },
  ]
}

export function shouldRunTurnPostProcessing(status: AgentStatusEvent['status'] | null): boolean {
  return status === 'completed'
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
    const userContent = turn.snapshotUserMessage?.trim() || joinHistoryParts(turn.userParts) || ''
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
        ...(event.sdkSessionId != null ? { sdkSessionId: event.sdkSessionId } : {}),
        timestamp: event.timestamp,
      })
    } catch {
      // Ignore malformed historical rows.
    }
  }
  return checkpoints
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

function parseWorktreePromptMeta(raw: string): WorktreePromptMeta | null {
  try {
    const parsed = JSON.parse(raw) as Partial<WorktreePromptMeta> | null
    if (parsed == null || typeof parsed !== 'object') return null
    if (
      typeof parsed.baseRepoRoot !== 'string' ||
      typeof parsed.branch !== 'string' ||
      typeof parsed.baseBranch !== 'string'
    ) {
      return null
    }
    return {
      baseRepoRoot: parsed.baseRepoRoot,
      branch: parsed.branch,
      baseBranch: parsed.baseBranch,
      ...(typeof parsed.baseWorkspaceId === 'string'
        ? { baseWorkspaceId: parsed.baseWorkspaceId }
        : {}),
    }
  } catch {
    return null
  }
}

function buildWorktreeSessionSystemPrompt(
  workspaceInfo:
    | {
        name: string
        rootPath: string
        projectKind: string
        worktreeMeta?: WorktreePromptMeta
      }
    | undefined,
): string | undefined {
  if (workspaceInfo?.worktreeMeta == null) return undefined
  const { branch, baseBranch, baseRepoRoot } = workspaceInfo.worktreeMeta
  return [
    '[Worktree Session]',
    'This session runs inside an isolated git worktree, not the main checkout.',
    `Current worktree branch: ${branch}`,
    `Base branch: ${baseBranch}`,
    `Workspace root: ${workspaceInfo.rootPath}`,
    `Base repository root: ${baseRepoRoot}`,
    'Treat the current workspace as the source of truth for file edits, git status, and commands.',
    'Do not assume the main checkout path or branch is active unless the user explicitly asks you to leave this worktree workflow.',
  ].join('\n')
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

function normalizeReasoningEffort(value: string | null | undefined): SparkReasoningEffort {
  return normalizeSparkReasoningEffort(value)
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

/** Advisory, non-mandatory nudge toward using the native Task subagent tool — shown on every host turn. */
const SUBAGENT_USAGE_HINT_SYSTEM_PROMPT = [
  '[Subagent Usage]',
  "You have a general-purpose subagent tool (Task) available for delegating self-contained, parallelizable, or context-heavy sub-tasks — e.g. broad codebase research, independent multi-file investigations, or exploratory searches whose raw output you don't need in your own context.",
  'Consider offloading such work to it rather than doing everything inline; this keeps your context focused and can run independent work in parallel.',
  'After you dispatch a Task subagent, do not end the user-facing turn with a promise to wait; keep the turn alive and wait for the subagent result, or use SendMessage to retrieve/continue it when the tool result says the agent is running in the background. Only answer the user once you have incorporated the subagent result or can report a real failure.',
  'Use judgment — skip it for small, tightly sequential, or already-clear tasks.',
].join('\n')

/**
 * 记忆行为引导（每次会话无条件注入）。
 *
 * 解决"两套记忆语义冲突"：本应用同时存在两套长期记忆机制——
 *   1. 应用长期记忆：上方可能出现的 `<user-memory>`/`<project-memory>`/`<agent-memory>` 摘要块
 *      + search_memory / recall_memory 工具。由后台在每轮对话结束后**自动抽取**写入，
 *      桌面端「设置 → Agent → 记忆」面板可见、可管理。
 *   2. 项目规则文件：AGENTS.md / CLAUDE.md（Claude Code 原生 `/memory` 命令维护），
 *      存项目静态规则、团队约定，git 跟踪、手动维护。
 * 两者并存、各司其职。主 agent 此前从未被告知这一区别，导致用户说"记住"时 agent 可能
 * 误走 `/memory` 写进 CLAUDE.md（桌面端不可见）却回答"记住了"，用户无法分辨去向。
 * 本段统一约定：用户说"记住"默认指应用长期记忆，回复措辞需明确去向。
 */
const MEMORY_BEHAVIOR_SYSTEM_PROMPT = [
  '[Memory Behavior] 本应用有两套长期记忆，语义不同，必须区分：',
  '',
  '1. **应用长期记忆**（Application Memory）',
  '   - 即上方可能出现的 `<user-memory>` / `<project-memory>` / `<agent-memory>` 摘要块，',
  '     以及 search_memory / recall_memory 工具。',
  '   - 存什么：用户偏好与身份、项目级动态事实、给当前 Agent 的角色/风格反馈、外部稳定指针。',
  '   - **自动写入**：每轮对话结束后由后台自动抽取，你不需要、也不应该在本轮手动写文件。',
  '   - 用户可在桌面端「设置 → Agent → 记忆」面板查看和管理。',
  '',
  '2. **项目规则文件**（Project Rule Files）',
  '   - 指 AGENTS.md / CLAUDE.md，Claude Code 原生 `/memory` 命令维护的就是这一类。',
  '   - 存什么：项目静态规则、团队约定、协作流程——需要 git 跟踪、团队共享、人手动维护的内容。',
  '   - 写入是显式且手动的工作：编辑文件、提交到版本库。',
  '',
  '当用户说"记住这个" / "记一下" / "以后记得" / "写入记忆"时：',
  '- **默认指应用长期记忆**。例如"好，我记下了"，后台会自动抽取——',
  '',
  '回复措辞（重要——用户借此判断记忆去向）：',
  '- 走应用记忆：说"已记下 / 已进入长期记忆 / 下次会自动用到"。**不要**说"已写进 CLAUDE.md"。',
  '- 改了规则文件：明确说"已更新 AGENTS.md / CLAUDE.md"。',
  '',
  '不要把以下内容当作应记忆的内容（后台闸门会丢弃，回复时也别承诺记住）：',
  '日期 / 时间 / 当前时刻、实时数据（天气/股价/汇率）、单次查询结果、临时任务状态、',
  '可从代码或 git log 推导的事实——这些让 agent 当场处理即可。',
].join('\n')

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

/**
 * 编排宿主的行为引导（纯提示词，不禁用任何工具——产品决策 2026-07-04：所有 agent
 * 含团队 Host / 挂工作流的 agent 都保留全量工具权限，「优先派发」只靠引导实现）。
 */
function buildOrchestrationModeSystemPrompt(
  source: 'team' | 'workflow',
  memberCount: number,
): string {
  const reason =
    source === 'team'
      ? 'Team Mode is enabled for this session'
      : 'the agent you are running as has a workflow attached with dispatchable phases'
  return [
    '[Orchestration Mode]',
    `You are the orchestration host this turn. Reason: ${reason}. You have ${memberCount} member(s)/worker(s) you can delegate to.`,
    'You keep your FULL toolset (Edit/Write/Bash/etc.), but your primary job this turn is coordination, not solo execution:',
    '- Delegate substantive work to members/workers via your dispatch tools — that is why this mode exists.',
    '- Reserve direct tool use for glue work: final assembly of member outputs, quick verification commands, or tiny fixes that are clearly cheaper to do than to delegate.',
    '- Do NOT solo the whole task while capable members sit idle — if a member could plausibly own a piece, dispatch it.',
    '- If the user explicitly asks YOU to edit/run something directly, doing it yourself is fine.',
  ].join('\n')
}

/** 从 SessionRow.metadata_json 读取团队配置（不存在/无效返回 null） */
function readSessionTeamConfig(session: { metadata_json?: string }): TeamModeConfig | null {
  if (session.metadata_json == null || session.metadata_json === '') return null
  try {
    const meta = JSON.parse(session.metadata_json) as { team?: Partial<TeamModeConfig> }
    const team = meta.team
    if (team == null || typeof team !== 'object') return null
    return {
      enabled: team.enabled === true,
      hostAgentId:
        typeof team.hostAgentId === 'string' ? team.hostAgentId : 'platform-manager-agent',
      memberAgentIds: Array.isArray(team.memberAgentIds)
        ? team.memberAgentIds.filter((id) => typeof id === 'string')
        : [],
      maxDepth: typeof team.maxDepth === 'number' ? team.maxDepth : 1,
      allowNesting: team.allowNesting === true,
      ...(typeof team.dispatchTimeoutMs === 'number'
        ? { dispatchTimeoutMs: team.dispatchTimeoutMs }
        : {}),
      ...(typeof team.teamId === 'string' ? { teamId: team.teamId } : {}),
      ...(typeof team.maxDiscussionRounds === 'number'
        ? { maxDiscussionRounds: TeamDiscussionRepository.clampMaxRounds(team.maxDiscussionRounds) }
        : {}),
      ...(typeof team.enablePeerMessaging === 'boolean'
        ? { enablePeerMessaging: team.enablePeerMessaging }
        : {}),
      ...(typeof team.threadContextTokenBudget === 'number' &&
      Number.isFinite(team.threadContextTokenBudget)
        ? { threadContextTokenBudget: team.threadContextTokenBudget }
        : {}),
    }
  } catch {
    return null
  }
}

/** 构建团队花名册 system prompt 段，附加在 [Agent Instructions] 之后（设计文档 §8.2.3） */
export interface TeamRosterPromptOptions {
  /** 视角：host（编排者，默认，向后兼容）/ member（被注入 prompt 的成员） */
  perspective?: 'host' | 'member'
  /** member 视角必填：当前被注入 prompt 的成员（"You are X"） */
  viewingMember?: AgentItem
  /** 共享讨论线程片段（已按 token 预算截断）——member 视角拼进 [Discussion So Far] */
  threadSnippet?: string
  /** 是否启用对等消息（agent_message）——member 视角决定是否注入 agent_message 使用说明 */
  enablePeerMessaging?: boolean
  /** member 视角：SDK 原生子代理工具（Task/SendMessage）在本上下文是否可用。
   *  被派发的成员为 false（Task/SendMessage 已禁用）；被用户 @ 的成员为 true（保留原生能力，
   *  需要提示词消歧两套通信系统）。 */
  nativeSubagentToolsAvailable?: boolean
}

export function buildTeamRosterPrompt(
  host: AgentItem,
  members: AgentItem[],
  teamConfig: TeamModeConfig,
  opts: TeamRosterPromptOptions = {},
): string {
  if (members.length === 0) return ''
  if (opts.perspective === 'member') {
    if (opts.viewingMember == null) {
      throw new Error("buildTeamRosterPrompt: 'member' perspective requires viewingMember")
    }
    return buildMemberRosterPrompt(host, opts.viewingMember, members, teamConfig, opts)
  }
  return buildHostRosterPrompt(host, members, teamConfig)
}

/** Host 视角：编排者，显式轮次状态机替代旧的"CONVERGE do NOT loop"道德劝诫。 */
function buildHostRosterPrompt(
  host: AgentItem,
  members: AgentItem[],
  teamConfig: TeamModeConfig,
): string {
  const exampleMember = members[0]
  const lines: string[] = [
    '[Team Roster]',
    `You are ${host.name} (${host.id}), the HOST of a multi-agent team.`,
    'Your job is to ORCHESTRATE, not to execute alone — you coordinate specialists, they do the hands-on work.',
    '',
    '════ How to reach a team member — READ THIS BEFORE picking any tool ════',
    'Two different subagent systems exist. They do NOT share address spaces:',
    '  1. TEAM MEMBERS (the roster below): reachable ONLY via `mcp__spark_team__agent_dispatch` /',
    '     `agent_dispatch_batch` / `agent_message`. They will NEVER appear in the built-in',
    '     `SendMessage` addressable list.',
    '  2. PRIVATE SUBAGENTS (built-in Task/SendMessage): a separate system for spawning your own',
    '     disposable helpers (e.g. quick research probes). Team members are NOT in this system —',
    '     `SendMessage({ to: "<teammate name>" })` will always fail with "not currently addressable".',
    '',
    `  Correct (works):   mcp__spark_team__agent_dispatch({ targetAgentId: "${exampleMember?.id ?? '<member-id-from-roster-below>'}", instruction: "..." })`,
    `  Wrong (will fail): SendMessage({ to: "${exampleMember?.name ?? '<member-name>'}", ... })`,
    '',
    '  If SendMessage returns "not currently addressable" while reaching a teammate, do NOT retry',
    '  with a different name/id — switch tools to `mcp__spark_team__agent_dispatch` / `agent_message`.',
    '════════════════════════════════════════════════════════════════════════',
    '',
    'Core principles:',
    '- Collaboration first. This is a team session. Prefer delegating to the right specialist over doing the work yourself, even when you technically could answer directly.',
    "- Match by expertise. Read each member's description below and route each subtask to whoever does it best — coding to the coder, review to the reviewer, and so on.",
    '- You orchestrate, members execute. Decide WHAT needs doing and WHO does it, then dispatch. Do not write/edit code, run commands, or produce the deliverable yourself when a capable member exists — that is what delegation is for.',
    "- When unsure, lean toward delegating. If a member could plausibly help, err on the side of dispatching rather than defaulting to solo work — that's the point of this mode.",
    "- Talk with your team. Give each dispatch a clear instruction and the minimum context it needs (paste code/snippets into `attachments`, don't rely on shared memory). After replies come back, react, ask follow-ups, or chain to another member — treat it like a working conversation, not one-shot calls.",
    '- Cross-team @ is supported. The user may @-mention any member directly; you may also have members collaborate with each other within the depth limit below.',
    ...(teamConfig.enablePeerMessaging === true
      ? [
          '- Peer messaging is ON: members can talk to each other DIRECTLY via `agent_message` during their own turns. Members may consult each other before replying to you, so a reply you receive may already synthesize several teammates. Do NOT act as a relay between members; dispatch each member ONCE with an instruction like "use agent_message to ask your teammates directly", then let them talk.',
        ]
      : []),
    '',
    'Members available to you in this session:',
  ]
  for (const m of members) {
    const summary = m.description.trim().slice(0, 240)
    lines.push(`- id: ${m.id}`)
    lines.push(`  name: ${m.name}`)
    if (summary) lines.push(`  description: ${summary}`)
  }
  lines.push(
    '',
    'Tools:',
    '  - `mcp__spark_team__agent_dispatch` — delegate ONE subtask (serial; use when the next step depends on the previous reply).',
    '  - `mcp__spark_team__agent_dispatch_batch` — delegate MULTIPLE independent subtasks in PARALLEL (use when the user asks several members at once, or when tasks are unrelated).',
    '  - `mcp__spark_team__team_round_advance` — mark the current discussion round done (UI draws a divider, round counter advances). Call it once a round has gathered enough input, before starting the next round.',
    '  - `mcp__spark_team__team_conclude` — wrap up the whole discussion. No more dispatch/message after this.',
    '  - `mcp__spark_team__team_thread_read` — read back the shared discussion log (read-only). Use it when a member says "I already posted it" but you did not see the content, when a message was truncated with 〔省略 …〕, or when you need an earlier round\'s detail. Pass messageId for one message in full, or browse by round/fromAgentId with limit/offset.',
    '  (See the "How to reach a team member" box at the top for how these differ from built-in Task/SendMessage.)',
    '',
    'Guardrails:',
    `- You may call at most ${teamConfig.maxDepth} chained dispatch level(s).`,
    '- Drive the session in EXPLICIT rounds (not open-ended looping): gather input from the right members this round, then call team_round_advance to close it; repeat until the objective is met, then call team_conclude. If a round is going in circles, summarize for the user instead of dispatching again.',
    '- Do NOT repeat, paraphrase, or list out member replies — they stream directly to the user in the chat UI. Stay silent and end the turn unless the user explicitly asked you to synthesize across members, you must ask a follow-up question, or a dispatch failed and you need to report what is missing.',
  )
  return lines.join('\n')
}

/**
 * Member 视角（FR-1）：被 dispatch 的成员看到的团队上下文。只在真实团队会话 +
 * enablePeerMessaging 时注入（Phase C 强制验收点：workflow 合成 teamConfig 路径绝不注入）。
 */
function buildMemberRosterPrompt(
  host: AgentItem,
  viewingMember: AgentItem,
  members: AgentItem[],
  teamConfig: TeamModeConfig,
  opts: TeamRosterPromptOptions,
): string {
  const others = members.filter((m) => m.id !== viewingMember.id)
  const exampleTeammate = others[0]
  const lines: string[] = [
    '[Team Roster]',
    `You are ${viewingMember.name} (${viewingMember.id}), a MEMBER of ${host.name}'s multi-agent team.`,
    `Session context: a human USER leads this session and sees every reply in the group chat; ${host.name} (id: ${host.id}) is the HOST agent that coordinates the team. Messages you receive come either from the host (dispatch), from a teammate (directed @), or from the user (@-mention).`,
    'You were dispatched with a specific subtask. Focus on that subtask and reply with your result; do not take over the whole session.',
    ...(opts.enablePeerMessaging
      ? [
          '',
          '════ How to reach a teammate — READ THIS BEFORE picking any tool ════',
          'Two different subagent systems exist in this runtime. They do NOT share address spaces:',
          '',
          '  1. TEAM MEMBERS (this roster, listed below): reachable ONLY via the MCP tool',
          '     `mcp__spark_team__agent_message`. Team members will NEVER appear in the built-in',
          '     `SendMessage` addressable list — that list only contains subagents you spawn yourself.',
          '',
          '  2. PRIVATE SUBAGENTS (built-in Task/SendMessage): a separate system for spawning your',
          '     own disposable helpers. Team members are NOT in this system. Trying to `SendMessage`',
          '     a teammate always fails with "No agent named X is currently addressable" — that error',
          '     literally means "wrong tool, switch to agent_message".',
          '',
          `  Correct (works):   mcp__spark_team__agent_message({ targetAgentId: "${exampleTeammate?.id ?? '<teammate-id-from-roster-below>'}", content: "..." })`,
          `  Wrong (will fail): SendMessage({ to: "${exampleTeammate?.name ?? '<teammate-name>'}", ... })`,
          '',
          '  If you see "not currently addressable" while trying to reach a teammate: DO NOT try a',
          '  different name/id with the same tool. Switch tools — call `mcp__spark_team__agent_message`',
          '  instead. Do not report the addressing failure to the user unless you have already tried',
          '  agent_message and it also failed.',
          '════════════════════════════════════════════════════════════════════',
        ]
      : []),
    '',
    'Core principles:',
    '- Stay in your lane. Do the dispatched subtask well — that is your contribution to the team.',
    ...(opts.enablePeerMessaging
      ? [
          '- The host orchestrates the overall plan; you OWN your subtask — including talking to teammates directly (via agent_message) whenever the subtask needs their input. Only the final result goes back to whoever asked.',
        ]
      : [
          '- The host orchestrates. Do not start broad re-planning or re-dispatch others on your own; reply with your result and let the host decide next steps.',
          '- Direct member-to-member messaging is currently DISABLED for this team (the user has not turned on peer messaging). You can SEE the roster below, but you cannot contact teammates yourself. If your task requires talking to a teammate, tell the user: enable "Peer Messaging" in the team settings (Inspector → Team), or route the request through the host. Do NOT claim teammates "do not exist" — they are listed below.',
        ]),
    ...(opts.enablePeerMessaging
      ? [
          '',
          '[Collaboration Playbook] — choose one mode per situation:',
          'MODE 1 · Answer directly: you have what you need — reply normally; your answer returns to whoever asked.',
          'MODE 2 · Consult first, then answer: you need input from teammate C before you can answer? Call `mcp__spark_team__agent_message({ targetAgentId: "<C>", mode: "call", content: "..." })` NOW, in this very turn. C runs immediately and their answer comes back in the tool result. You may consult several teammates, or the same teammate twice, before composing your final answer. Do NOT tell the asker "I need to check with C first" and end your turn — that wastes a round; check DURING your turn.',
          "MODE 3 · Hand off: the question is really for C? End your reply with `@C <the question + context>` — it auto-forwards and C's answer continues the thread.",
          'MODE 4 · Leave a note (async): the teammate does not need to act right now? Call `mcp__spark_team__agent_message({ targetAgentId: "<C>", mode: "note", content: "..." })`; C sees `[NOTE FOR YOU]` next time they run and nobody is interrupted. Broadcast note to everyone: omit targetAgentId.',
          '- Decision rule: if your current answer depends on the teammate reply, use MODE 2 call; if the teammate only needs to know something for later, use MODE 4 note.',
          '- MULTI-ROUND conversations: each call is one question→answer exchange. To hold a longer conversation, call agent_message AGAIN with your next message. Never write your reply to a teammate in your own answer text and wait — plain answer text is shown to the user only and the teammate will NEVER see it unless it @-mentions them.',
          // 双系统消歧已在成员 prompt 顶部的「How to reach a teammate」盒子里前置详述，此处
          // 只保留 dispatched-context 独有的 Task/SendMessage 禁用告知；mention 直答（Task/
          // SendMessage 保留）不需要额外说话，顶部盒子已经解释「switch tools when addressable
          // 失败」的正确策略。
          ...(opts.nativeSubagentToolsAvailable
            ? []
            : [
                '- Note: in this dispatched context the built-in `Task`/`SendMessage` subagent tools are disabled — see the top box; `agent_message` is your only inter-agent channel here.',
              ]),
          '- Do NOT immediately ping back the member who just @-messaged you (prevents ping-pong loops). Reply only when you have something substantive to add.',
        ]
      : []),
    '',
    ...(others.length > 0
      ? ['Other team members:']
      : ['You are currently the only active member in this team.']),
  ]
  for (const m of others) {
    const summary = m.description.trim().slice(0, 240)
    lines.push(`- id: ${m.id}`)
    lines.push(`  name: ${m.name}`)
    if (summary) lines.push(`  description: ${summary}`)
  }
  if (others.length > 0 && opts.enablePeerMessaging) {
    lines.push(
      '',
      "When calling team tools, pass the teammate's exact `id` from the list above in targetAgentId (a unique display name also resolves, but the id is unambiguous).",
    )
  }
  if (opts.threadSnippet != null && opts.threadSnippet.trim().length > 0) {
    lines.push('', '[Discussion So Far]', opts.threadSnippet.trim())
  }
  // team_thread_read 手册：无条件注入（只要成员在真实讨论里就有这个只读工具）。
  // 关键：[Discussion So Far] 是**截断预览**，长消息会被 〔省略 …〕 掉——务必让成员
  // 知道全文/更早历史怎么拿，否则会像现场 bug 那样「以为队友没发」。
  lines.push(
    '',
    '[Reading the group chat]',
    '- The "[Discussion So Far]" above is a TRUNCATED preview: long messages are cut with 〔省略 …〕 and older ones may be dropped. It is NOT the full log.',
    '- To read more, use `mcp__spark_team__team_thread_read` (read-only, notifies nobody):',
    '    • A teammate says they posted something but you only see a short line, or a message is cut with 〔省略 …〕 → call team_thread_read({ messageId: "<the id shown>" }) for the full text.',
    '    • You need earlier history or a specific round → browse: team_thread_read({ round: N }) or team_thread_read({ fromAgentId: "<teammate>", limit, offset }).',
    '- Do this BEFORE concluding a teammate "did not answer" or re-asking something already covered — the content is almost always already in the thread, just not in the preview.',
  )
  lines.push(
    '',
    'Guardrails:',
    `- Chained dispatch depth limit is ${teamConfig.maxDepth}.`,
    '- Do NOT repeat or summarize what other members already said — the host sees the shared thread. Reply with your own result only.',
  )
  return lines.join('\n')
}

/** 把 task 拼成传给 member 的 user message（instruction + attachments + expectedOutput） */
/**
 * 触发 workflow_run 的用户消息自带的附件（图片/文件/目录）→ dispatch 附件形状。
 * 沿用宿主自己那份 attachment 的做法：不搬运二进制内容，只把磁盘路径转发过去，
 * 被派发的 agent 拿到路径后自己用 Read 工具读——见 buildPromptWithAttachments
 * 里给宿主自己的同款指引，这里在 buildMemberUserMessage 渲染时补上同样的提示。
 */
export function mapSessionAttachmentsToDispatch(
  attachments: SessionAttachment[],
): WorkflowDispatchAttachment[] {
  return attachments.map((attachment) => ({
    type: attachment.type === 'image' ? 'image_ref' : 'file_ref',
    value: attachment.path,
  }))
}

export function buildMemberUserMessage(task: TeamA2ATask): string {
  const parts: string[] = [task.instruction]
  // task.inputs 承载 agent_dispatch 的结构化入参，也是 workflow_run 里 outputKey → 下游节点
  // inputs 状态传递的落地点（见 buildWorkflowNodeInputs）。此前这里从未渲染这个字段——数据算出来
  // 了，但 member 实际看到的 prompt 里从来没有它，等于整条 outputKey 状态传递链路是断的。
  if (task.inputs != null && Object.keys(task.inputs).length > 0) {
    parts.push('', '[Inputs]', JSON.stringify(task.inputs, null, 2))
  }
  if (task.attachments != null && task.attachments.length > 0) {
    parts.push('', '[Attachments]')
    const hasFileRef = task.attachments.some((att) => att.type !== 'text')
    for (const att of task.attachments) {
      parts.push(att.type === 'text' ? att.value : `${att.type}: ${att.value}`)
    }
    if (hasFileRef) {
      parts.push(
        'Use the Read tool on file_ref/image_ref paths above to inspect their content when relevant.',
      )
    }
  }
  if (task.expectedOutput != null) {
    parts.push('', `[Expected output] ${task.expectedOutput}`)
  }
  return parts.join('\n')
}

/** team_thread_read 浏览模式：单条消息在列表里的最大正文字符数（超出提示用 messageId 读全文）。 */
const THREAD_READ_BROWSE_CONTENT_CAP = 2000

/** team_thread_read 单条全文模式：完整呈现一条消息（不截断正文）。 */
export function formatThreadMessageFull(m: TeamThreadMessageRow): string {
  const target = m.target_agent_id ? ` → ${m.target_agent_id}` : ' → all'
  const delivery = m.delivery != null ? `, ${m.delivery}` : ''
  return [
    `id: ${m.id}`,
    `[R${m.round_index}] ${m.sender_agent_id}${target} (${m.kind}${delivery}) @ ${m.created_at}`,
    '',
    m.content,
  ].join('\n')
}

/** team_thread_read 浏览模式：单条消息的一段式呈现（正文超上限则截断并提示用 messageId 读全文）。 */
export function formatThreadMessageBrowse(m: TeamThreadMessageRow): string {
  const target = m.target_agent_id ? ` → ${m.target_agent_id}` : ' → all'
  const delivery = m.delivery != null ? `, ${m.delivery}` : ''
  let content = m.content
  if (content.length > THREAD_READ_BROWSE_CONTENT_CAP) {
    const head = content.slice(0, THREAD_READ_BROWSE_CONTENT_CAP).trimEnd()
    content = `${head}…〔省略 ${m.content.length - head.length} 字，team_thread_read(messageId: "${m.id}") 读全文〕`
  }
  return `[R${m.round_index}] ${m.sender_agent_id}${target} (${m.kind}${delivery}) · id=${m.id}\n${content}`
}

/**
 * 把「调用期间别人发到共享讨论的对等消息」格式化成一段附加到工具结果的增量文本。
 *
 * 场景（现场 bug）：A 定向 call / dispatch 了 B，B 在自己 turn 内向群里广播了一份长消息，
 * 但 A 只拿到 B 的最终回复，看不到那条广播。这里把这些「同期广播」以预览形式回流给 A，
 * A 想看全文可用 team_thread_read。已按 sender != caller 过滤（A 自己发的不回流），
 * 且只含 peer_message（member_reply 通过回复链本就返回，不重复展示）。
 *
 * @returns 无可回流消息时返回 null（handler 据此决定是否拼接）。
 */
export function formatPeerBroadcastDelta(
  messages: TeamThreadMessageRow[],
  callerAgentId: string,
): string | null {
  const others = messages.filter((m) => m.sender_agent_id !== callerAgentId)
  if (others.length === 0) return null
  return [
    `[Meanwhile in the shared discussion — ${others.length} message(s) other members posted during this call; read full text with team_thread_read]`,
    ...others.map((m) => formatThreadMessageBrowse(m)),
  ].join('\n\n')
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

function buildManagedAgentSystemPrompt(
  agent: AgentItem,
  workflow: WorkflowItem | null,
  workflowExecutionMode: 'guided' | 'workflow_run' | 'codex_guided' = 'guided',
): string {
  const sections: string[] = [
    '[Managed Agent]',
    `Agent: ${agent.name} (${agent.id})`,
    agent.description.trim() ? `Description: ${agent.description.trim()}` : '',
    agent.prompt.trim() ? `[Agent Instructions]\n${agent.prompt.trim()}` : '',
  ].filter((section) => section.trim().length > 0)

  const workflowPrompt =
    workflow != null ? buildWorkflowSystemPrompt(workflow, workflowExecutionMode) : ''
  if (workflowPrompt.trim().length > 0) sections.push(workflowPrompt)
  return sections.join('\n\n')
}

/**
 * 判定一个 workflow 是否有真正可派发执行的节点——只有命中 true 时，宿主才会被
 * 归类为「编排宿主」（注入 workflow_run 工具面 + [Orchestration Mode] 引导提示词；
 * 不再剥离任何工具，见 buildOrchestrationModeSystemPrompt）。
 * kind:"agent" 节点若没有绑定 config.agentId，或绑定到不可用 worker，语义上是继承
 * fallbackAgentId 指向的宿主 Agent；没有 fallback 时才保持旧的 guided 判定。
 * 单独导出以便直接用真实 graph 数据做回归测试。
 */
export function hasWorkflowExecutableNodes(
  graph: NormalizedWorkflowGraph,
  enabledWorkflowWorkerIds?: ReadonlySet<string>,
  fallbackAgentId?: string,
): boolean {
  const fallback = typeof fallbackAgentId === 'string' ? fallbackAgentId.trim() : ''
  return graph.nodes.some((node) => {
    if (node.kind !== 'agent' && node.kind !== 'subagent') return true
    const workerId = getWorkflowNodeWorkerId(node)
    if (workerId == null || workerId.length === 0) return fallback.length > 0
    if (node.kind === 'subagent') return true
    if (enabledWorkflowWorkerIds == null) return true
    return enabledWorkflowWorkerIds.has(workerId) || fallback.length > 0
  })
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

export function buildMediaGenerationSystemPrompt(input: {
  name: string
  model: string
  provider: string
  apiType: string
  outputDir: string
  capabilities: string[]
  modelManifests?: Array<{ id: string; modelId: string; capabilities: string[] }>
  apiEndpoint?: string
}): string {
  const caps =
    input.capabilities.length > 0 ? input.capabilities.join(', ') : 'audio.speech, video.generate'
  const manifestLines = (input.modelManifests ?? []).map(
    (manifest) =>
      `  - ${manifest.id} (${manifest.modelId}): ${manifest.capabilities.join(', ') || 'no declared capabilities'}`,
  )
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
    ...(manifestLines.length > 0 ? ['', 'Configured model manifests:', ...manifestLines] : []),
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
    'Before calling `generate_video`, `generate_image`, or `edit_image`, you must call `mcp__spark_media__describe_model` for the selected model/capability unless you already inspected it in this turn.',
    'Use the returned `maxImages`, `rolePolicy`, and parameter schema to tell the user: supported input count, supported roles (first frame / last frame / reference image/video/audio), and the default role assignment rule.',
    'If the user provides more media inputs than `maxImages`, ask which inputs to keep before generation; do not silently drop extra inputs.',
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

function extractPresentedFiles(
  event: AgentEvent,
  workspaceRootPath: string,
): Array<{ path: string; title?: string }> | null {
  if (
    event.type !== 'tool_result' ||
    event.status !== 'success' ||
    !event.toolName.toLowerCase().endsWith('present_files')
  ) {
    return null
  }

  const payload = parsePresentedFilesPayload(event.output)
  if (payload == null || !Array.isArray(payload.files)) return null

  let workspaceRoot: string
  try {
    workspaceRoot = realpathSync(workspaceRootPath)
  } catch {
    return null
  }

  const files: Array<{ path: string; title?: string }> = []
  const seen = new Set<string>()
  for (const item of payload.files.slice(0, 20)) {
    if (item == null || typeof item !== 'object' || Array.isArray(item)) continue
    const record = item as Record<string, unknown>
    if (typeof record.path !== 'string' || record.path.trim().length === 0) continue
    try {
      const resolved = realpathSync(
        path.isAbsolute(record.path) ? record.path : path.resolve(workspaceRoot, record.path),
      )
      const relative = path.relative(workspaceRoot, resolved)
      const outsideWorkspace =
        relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)
      if (outsideWorkspace || !statSync(resolved).isFile()) {
        continue
      }
      if (seen.has(resolved)) continue
      seen.add(resolved)
      const title = typeof record.title === 'string' ? record.title.trim().slice(0, 120) : ''
      files.push({ path: resolved, ...(title ? { title } : {}) })
    } catch {
      // The tool result is untrusted input; silently drop invalid or vanished files.
    }
  }
  return files
}

function parsePresentedFilesPayload(output: unknown): Record<string, unknown> | null {
  if (output != null && typeof output === 'object' && !Array.isArray(output)) {
    const record = output as Record<string, unknown>
    if (Array.isArray(record.files)) return record
    if (Array.isArray(record.content)) {
      for (const block of record.content) {
        const parsed = parsePresentedFilesPayload(block)
        if (parsed != null) return parsed
      }
    }
    if (typeof record.text === 'string') return parsePresentedFilesPayload(record.text)
  }
  if (typeof output !== 'string') return null
  try {
    const parsed = JSON.parse(output) as unknown
    return parsePresentedFilesPayload(parsed)
  } catch {
    return null
  }
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
  // Spark install artifacts
  'mcp__spark_platform__artifacts_list',
  'mcp__spark_platform__artifacts_resolve',
  // Settings
  'mcp__spark_platform__settings_get',
  'mcp__spark_platform__settings_set',
  'mcp__spark_platform__settings_get_category',
  'mcp__spark_platform__settings_get_all',
  // GitHub Connector
  'mcp__spark_platform__github_status',
  'mcp__spark_platform__github_list_repositories',
  'mcp__spark_platform__github_get_repository',
  'mcp__spark_platform__github_read_repository_file',
  'mcp__spark_platform__github_create_branch',
  'mcp__spark_platform__github_upsert_repository_file',
  'mcp__spark_platform__github_list_issues',
  'mcp__spark_platform__github_get_issue',
  'mcp__spark_platform__github_create_issue',
  'mcp__spark_platform__github_update_issue',
  'mcp__spark_platform__github_comment_issue',
  'mcp__spark_platform__github_list_pull_requests',
  'mcp__spark_platform__github_get_pull_request',
  'mcp__spark_platform__github_create_pull_request',
  'mcp__spark_platform__github_comment_pull_request',
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
    path.resolve(
      process.cwd(),
      'packages/agent-runtime/src/tools/platform-management-mcp-server.mjs',
    ),
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

function resolveSparkMemoryMcpServerPath(): string | null {
  const here = path.dirname(fileURLToPath(import.meta.url))
  const candidates = [
    path.resolve(here, 'tools/spark-memory-mcp-server.mjs'),
    path.resolve(here, '../tools/spark-memory-mcp-server.mjs'),
    path.resolve(process.cwd(), 'packages/agent-runtime/src/tools/spark-memory-mcp-server.mjs'),
  ]
  return candidates.find((candidate) => existsSync(candidate)) ?? null
}

function resolveSparkCanvasMcpServerPath(): string | null {
  const here = path.dirname(fileURLToPath(import.meta.url))
  const candidates = [
    path.resolve(here, 'tools/spark-canvas-mcp-server.mjs'),
    path.resolve(here, '../tools/spark-canvas-mcp-server.mjs'),
    path.resolve(process.cwd(), 'packages/agent-runtime/src/tools/spark-canvas-mcp-server.mjs'),
  ]
  return candidates.find((candidate) => existsSync(candidate)) ?? null
}

function resolvePresentFilesMcpServer(workspaceRootPath: string): SDKMcpServerConfig | null {
  const here = path.dirname(fileURLToPath(import.meta.url))
  const candidates = [
    path.resolve(here, 'tools/present-files-mcp-server.mjs'),
    path.resolve(here, '../tools/present-files-mcp-server.mjs'),
    path.resolve(process.cwd(), 'packages/agent-runtime/src/tools/present-files-mcp-server.mjs'),
  ]
  const serverPath = candidates.find((candidate) => existsSync(candidate))
  if (serverPath == null) {
    log.warn('Present files MCP server script not found')
    return null
  }
  return {
    type: 'stdio',
    command: process.execPath,
    args: [serverPath],
    cwd: workspaceRootPath,
    env: {
      ELECTRON_RUN_AS_NODE: '1',
      SPARK_WORKSPACE_ROOT: workspaceRootPath,
    },
  }
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

const PRESENT_FILES_TOOL_NAMES = ['mcp__spark_files__present_files']

const VALIDATION_SUGGESTION_TOOL_NAMES = ['mcp__spark_verify__suggest_validation']

const VALIDATION_SUGGESTION_TOOL_DESCRIPTION = [
  'Show the user a "run validation" card suggesting relevant project scripts (typecheck/lint/tests) for the files you changed this turn.',
  'When to use: after making source-code changes, if a quick validation pass would genuinely help the user catch regressions.',
  'When NOT to use: trivial or doc-only edits, changes outside source code, or when you already ran the equivalent checks yourself this turn.',
  'This is optional — skip it whenever it would just be noise.',
].join('\n')

const PRESENT_FILES_SYSTEM_PROMPT = [
  '## User-facing file cards',
  'When this turn produces or identifies files that should be delivered to the user, call `mcp__spark_files__present_files` immediately before the final response.',
  'Include only files the user should open, preview, or otherwise receive as deliverables.',
  'Do not include source files, dependencies, temporary files, caches, build metadata, or incidental workspace changes unless the user explicitly asked to receive that file.',
  'Do not call the tool when there are no user-facing files to present.',
  'The tool call controls the app file cards; mentioning a path in prose does not add it to that list.',
  'After calling the tool, do not repeat the same paths as standalone file links in the final response.',
].join('\n')

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
  "After loading, follow the skill's guidance instead of improvising the artifact by hand.",
].join('\n')

/** SDK-namespaced tool names exposed by the spark_debug MCP server. */
const DEBUG_TOOL_NAMES: string[] = [
  'mcp__spark_debug__begin',
  'mcp__spark_debug__read',
  'mcp__spark_debug__next_round',
  'mcp__spark_debug__status',
  'mcp__spark_debug__finish',
]

/** SDK-namespaced tool names exposed by the spark_browser MCP server. */
const BROWSER_TOOL_NAMES: string[] = [
  'mcp__spark_browser__open',
  'mcp__spark_browser__navigate',
  'mcp__spark_browser__eval',
  'mcp__spark_browser__inject_script',
  'mcp__spark_browser__remove_script',
  'mcp__spark_browser__screenshot',
  'mcp__spark_browser__get_url',
  'mcp__spark_browser__get_title',
  'mcp__spark_browser__list_windows',
  'mcp__spark_browser__close',
  'mcp__spark_browser__console_start',
  'mcp__spark_browser__console_events',
  'mcp__spark_browser__console_clear',
  'mcp__spark_browser__network_set_rules',
  'mcp__spark_browser__network_events',
  'mcp__spark_browser__network_clear',
  'mcp__spark_browser__clear_profile',
]

const BROWSER_AUTOMATION_SYSTEM_PROMPT = [
  '## Visible In-App Browser Capability (spark_browser)',
  'You can use the `mcp__spark_browser__*` tools to control a visible Electron BrowserWindow inside the Spark app.',
  'Use spark_browser when the task benefits from a browser window the user can see and share, local `file://` HTML debugging, persistent injected scripts, reusable login/cache profiles, console capture, or network observation/interception.',
  'Use Playwright MCP when you need mature selector-based clicking/typing, robust web automation, crawling, or E2E-style validation. The two browser toolsets are complementary; if one is blocked, switch to the other and briefly explain why.',
  '',
  'Core spark_browser workflow:',
  '1. `open` with a URL and optional `profileId` to create/reuse a visible window. Same profileId preserves cookies, localStorage, IndexedDB, and cache across turns.',
  '2. `eval` for one-off JavaScript. Return only JSON-serializable values; stringify DOM nodes or complex objects inside the code.',
  '3. `inject_script` for persistent hooks that re-run after navigation; later call `remove_script` or `close` to clean up.',
  '4. `console_start` + `console_events` to read page logs/errors/warnings.',
  '5. `network_set_rules` + `network_events` to record, block, redirect, or add request headers. Response-body mock_response is not available unless the tool explicitly says it is supported.',
  '6. Use `screenshot`, `get_url`, `get_title`, and `list_windows` to observe current state, including manual user navigation.',
  '7. When finished, call `network_clear`, `console_clear`, `remove_script`, and/or `close`. Use `clear_profile` only when you intentionally want to sign pages out or reset browser state.',
  '',
  'Security model: pages stay sandboxed with no Node/Electron APIs. Your power comes from main-process controlled eval, webRequest, screenshot, console, and profile tools.',
].join('\n')

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
  "3. When the user says they reproduced, call `read` to pull this round's logs and analyze.",
  '   If `status.thisRound` is 0, they likely did not hit the path — adjust, do not guess.',
  '4. Fix or re-hypothesize; use `next_round` (record the hypothesis) before each new batch.',
  '5. When the user confirms it is fixed, call `finish`, then strip ALL instrumentation',
  '   (grep `__SPARK_DEBUG`), verify zero residue, and deliver root cause + fix + evidence.',
  "Never claim you reproduced the bug yourself — reproduction is always the user's step.",
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
  '- **Install Artifacts**: list, resolve (Spark self-hosted skill/runtime/dependency packages)',
  '- **Settings**: get, set, get_category, get_all',
  '- **Sessions (self)**: get, switch_model, switch_provider, switch_mode, switch_permission, switch_reasoning_effort',
  '- **Board Tasks**: list, get, create, update, delete, batch_create, batch_update, batch_delete, restore, permanent_delete',
  '',
  'When the user asks to manage any of these, use the corresponding tool directly.',
  'When a task requires external dependency, runtime, or environment installation, first call `mcp__spark_platform__artifacts_list` / `mcp__spark_platform__artifacts_resolve` to look in the Spark self-hosted artifact manifest (`https://minio.yiqibyte.com/spark-desktop/artifact-repository/v1/index.json`), then use domestic mirrors, and only then fall back to public overseas sources.',
  'For missing Python on Windows, do not start with `winget install Python...`; first resolve `runtime.python-3.11.9.win32-x64` from the Spark artifact manifest. For ppt-master Python packages, resolve the platform-specific `python-wheelhouse.ppt-master-py311.*` artifact before using pip indexes.',
  'Before installing Node.js on the host, check whether Spark exposes an app-bundled Electron Node runtime via `SPARK_ELECTRON_NODE` with `ELECTRON_RUN_AS_NODE=1`. Use it for Node-script/MCP subprocess needs when suitable; install a system/portable Node.js only when npm/npx or normal shell `node` is required and the bundled runtime is insufficient.',
  'When the environment is missing, prefer helping the user install and verify the needed environment after explaining the plan and obtaining consent for network/system changes; do not treat bypassing the missing environment as the first option.',
  'For destructive operations (delete, uninstall), always confirm with the user first.',
  'Never reveal or ask for full API keys — only show whether a key is configured.',
].join('\n')

function buildWorkflowSystemPrompt(
  workflow: WorkflowItem,
  workflowExecutionMode: 'guided' | 'workflow_run' | 'codex_guided' = 'guided',
): string {
  const graph = normalizeWorkflowGraph(workflow.graph)
  if (graph.nodes.length === 0) return ''
  const nodes: NormalizedWorkflowNode[] = graph.nodes
  const edges: NormalizedWorkflowEdge[] = graph.edges
  const ordered = orderWorkflowNodes(nodes, edges)
  const lines = ordered.map((node, index) => {
    const config = node.config
    const detail = [
      `kind=${node.kind}`,
      config.role != null ? `role=${String(config.role)}` : '',
      config.modelId != null && String(config.modelId).trim()
        ? `model=${String(config.modelId)}`
        : '',
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
      typeof config.retryCount === 'number' ? `retry=${config.retryCount}` : '',
    ].filter(Boolean)
    const prompt =
      typeof config.prompt === 'string' && config.prompt.trim()
        ? `\n   prompt: ${config.prompt.trim()}`
        : ''
    return `${index + 1}. ${node.title} [${detail.join('; ')}]${prompt}`
  })

  return [
    '[Workflow Execution Plan]',
    `Workflow: ${workflow.name} (${workflow.id})`,
    workflow.description.trim() ? `Description: ${workflow.description.trim()}` : '',
    workflowExecutionMode === 'workflow_run'
      ? 'When workflow_run is available, call `mcp__spark_team__workflow_run` exactly once with the current user objective. The tool executes explicit agent nodes sequentially and carries outputKey state between nodes.'
      : workflowExecutionMode === 'codex_guided'
        ? 'This runtime does not expose `workflow_run`. Execute the active workflow phases yourself in topological order within this turn. Keep an internal checklist of active nodes, do not skip a node unless an incoming condition is false based on established state, and clearly report the blocking node if the workflow cannot be completed.'
        : 'Execute the task by following these workflow nodes in order. If a node declares a model, tool, skill, MCP server, or permission preference, treat it as the preferred configuration for that phase. When the SDK cannot literally switch model per node within one turn, preserve the node intent in your planning and execution notes.',
    lines.join('\n'),
  ]
    .filter((line) => line.trim().length > 0)
    .join('\n\n')
}

function createWorkflowSubagentMember(
  node: NormalizedWorkflowNode,
  hostAgent: AgentItem,
  workerId: string,
): AgentItem {
  const now = new Date(0).toISOString()
  const prompt =
    typeof node.config.prompt === 'string' && node.config.prompt.trim().length > 0
      ? node.config.prompt.trim()
      : node.title
  const role =
    typeof node.config.role === 'string' && node.config.role.trim().length > 0
      ? node.config.role.trim()
      : ''
  return {
    id: workerId,
    name: node.title,
    description: role,
    builtIn: false,
    enabled: true,
    isDefault: false,
    providerProfileId:
      typeof node.config.providerProfileId === 'string'
        ? node.config.providerProfileId
        : (hostAgent.providerProfileId ?? null),
    modelId:
      typeof node.config.modelId === 'string' ? node.config.modelId : (hostAgent.modelId ?? null),
    agentAdapter:
      typeof node.config.agentAdapter === 'string'
        ? node.config.agentAdapter
        : hostAgent.agentAdapter,
    // 节点级 permissionMode 覆盖已下线：executeMemberTurn 里成员权限统一走 claude-auto
    // （避免并行 dispatch 时多个审批框互相打断），节点上配这个字段从来不会真正生效，
    // 干脆不再提供这个"看起来能配但没用"的入口。
    permissionMode: hostAgent.permissionMode,
    reasoningEffort:
      typeof node.config.reasoningEffort === 'string'
        ? node.config.reasoningEffort
        : hostAgent.reasoningEffort,
    prompt,
    ruleIds: stringArrayConfig(node.config.ruleIds),
    skillIds: stringArrayConfig(node.config.skillIds),
    disabledSkillIds: stringArrayConfig(node.config.disabledSkillIds),
    mcpServerIds: stringArrayConfig(node.config.mcpServerIds),
    hookConfig: {},
    workflowId: null,
    metadata: {
      workflowNodeId: node.id,
      temporaryWorkflowSubagent: true,
      ...workflowNodeToolIdsMeta(node),
    },
    createdAt: now,
    updatedAt: now,
  }
}

function applyWorkflowNodeOverrides(member: AgentItem, node: NormalizedWorkflowNode): AgentItem {
  const prompt =
    typeof node.config.prompt === 'string' && node.config.prompt.trim().length > 0
      ? node.config.prompt.trim()
      : member.prompt
  const description =
    typeof node.config.role === 'string' && node.config.role.trim().length > 0
      ? node.config.role.trim()
      : member.description
  return {
    ...member,
    description,
    providerProfileId: nullableStringConfig(
      node.config.providerProfileId,
      member.providerProfileId,
    ),
    modelId: nullableStringConfig(node.config.modelId, member.modelId),
    agentAdapter: stringConfig(node.config.agentAdapter, member.agentAdapter),
    reasoningEffort: stringConfig(node.config.reasoningEffort, member.reasoningEffort),
    prompt,
    ruleIds: Array.isArray(node.config.ruleIds)
      ? stringArrayConfig(node.config.ruleIds)
      : member.ruleIds,
    skillIds: Array.isArray(node.config.skillIds)
      ? stringArrayConfig(node.config.skillIds)
      : member.skillIds,
    disabledSkillIds: Array.isArray(node.config.disabledSkillIds)
      ? stringArrayConfig(node.config.disabledSkillIds)
      : member.disabledSkillIds,
    mcpServerIds: Array.isArray(node.config.mcpServerIds)
      ? stringArrayConfig(node.config.mcpServerIds)
      : member.mcpServerIds,
    metadata: {
      ...member.metadata,
      workflowNodeId: node.id,
      workflowNodeOverrides: true,
      ...workflowNodeToolIdsMeta(node),
    },
  }
}

/**
 * 只在节点显式配置了 toolIds 时才写入 metadata——省略时代表"不限制"，
 * 与"用户显式选了空集合"（理论上不该出现，TagPicker 不允许提交空选择又不同于未配置）区分开，
 * 避免 executeMemberTurn 把"未配置"误判成"限制为空工具集"。
 */
function workflowNodeToolIdsMeta(node: NormalizedWorkflowNode): { toolIds?: string[] } {
  const toolIds = stringArrayConfig(node.config.toolIds)
  return toolIds.length > 0 ? { toolIds } : {}
}

/** member.metadata.toolIds（工作流「工具」选择器）→ 该 member 这次 dispatch 要禁用的工具列表。未配置时不额外限制。 */
function memberDisallowedToolsFromConfig(member: AgentItem): string[] {
  const toolIds = stringArrayConfig(member.metadata?.toolIds)
  if (toolIds.length === 0) return []
  const allowed = new Set(toolIds)
  return WORKFLOW_RESTRICTABLE_TOOL_NAMES.filter((name) => !allowed.has(name))
}

function nullableStringConfig(value: unknown, fallback: string | null | undefined): string | null {
  if (value === null) return null
  if (typeof value !== 'string') return fallback ?? null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : (fallback ?? null)
}

function stringConfig(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : fallback
}

function stringArrayConfig(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    if (typeof item !== 'string') return []
    const trimmed = item.trim()
    return trimmed.length > 0 ? [trimmed] : []
  })
}

async function runWorkflowVerifyNode(
  request: {
    nodeId: string
    title: string
    objective: string
    config: Record<string, unknown>
  },
  workspaceRootPath: string,
): Promise<
  | { state?: 'completed'; content: string }
  | { state: 'failed'; content: string; error: { code: string; message: string } }
> {
  const commands = stringArrayConfig(request.config.verifyCommands)
  if (commands.length === 0) {
    return { content: getDefaultWorkflowAtomicContent(request) }
  }
  const { exec } = await import('node:child_process')
  const { promisify } = await import('node:util')
  const execAsync = promisify(exec)
  const outputs: string[] = []
  for (const command of commands) {
    try {
      const { stdout, stderr } = await execAsync(command, {
        cwd: workspaceRootPath,
        timeout: 600_000,
        // 1MB 对大型 monorepo 的 test/lint 输出太小，超限时 exec 直接抛错，把"命令其实跑成功
        // 只是输出太长"误报成 verify 失败。放宽到 20MB，给复杂项目留够余量。
        maxBuffer: 20 * 1024 * 1024,
      })
      outputs.push(formatWorkflowVerifyCommandOutput(command, stdout, stderr))
    } catch (error) {
      const stdout =
        typeof (error as { stdout?: unknown }).stdout === 'string'
          ? (error as { stdout: string }).stdout
          : ''
      const stderr =
        typeof (error as { stderr?: unknown }).stderr === 'string'
          ? (error as { stderr: string }).stderr
          : ''
      const message = error instanceof Error ? error.message : String(error)
      const content = formatWorkflowVerifyCommandOutput(command, stdout, stderr)
      return {
        state: 'failed',
        content,
        error: {
          code: 'verify_failed',
          message,
        },
      }
    }
  }
  return { content: outputs.join('\n\n') }
}

function formatWorkflowVerifyCommandOutput(
  command: string,
  stdout: string,
  stderr: string,
): string {
  return [
    `$ ${command}`,
    stdout.trim().length > 0 ? stdout.trim() : '',
    stderr.trim().length > 0 ? stderr.trim() : '',
  ]
    .filter(Boolean)
    .join('\n')
}

function getDefaultWorkflowAtomicContent(request: {
  title: string
  objective: string
  config: Record<string, unknown>
}): string {
  const value = request.config.value
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (value != null) return JSON.stringify(value)
  const prompt = typeof request.config.prompt === 'string' ? request.config.prompt.trim() : ''
  if (prompt.length > 0) return prompt
  if (request.objective.trim().length > 0) return request.objective.trim()
  return request.title
}

/**
 * 剥离 LLM 输出常见的 ```json / ``` 代码块围栏（仅当整段被 fence 包裹时），
 * 用于 input 节点结构化 JSON 校验前的预处理。非围栏包裹的原样返回。
 */
function trimJsonFence(text: string): string {
  const match = /^```(?:json|JSON)?\s*\n([\s\S]*?)\n```\s*$/.exec(text)
  if (match == null) return text
  return match[1] ?? text
}

/**
 * 校验 input 节点经 LLM 派发后的输出是否为合法 JSON。
 * - 合法（含 ```json fence 包裹）：返回原内容（保留 fence 不破坏 LLM 原意），ok:true。
 * - 非法：回落透传 fallback + 追加 `[input 结构化解析失败，已回落透传]` 提示，ok:false。
 *
 * 单独导出以便单测直接覆盖成功/失败两条路径（executeAtomicNode 回调里调用它）。
 */
export function validateWorkflowInputStructuredContent(
  rawContent: string,
  fallback: string,
): { ok: true; content: string } | { ok: false; content: string } {
  const stripped = trimJsonFence(rawContent.trim())
  try {
    JSON.parse(stripped)
    return { ok: true, content: rawContent }
  } catch {
    return { ok: false, content: `${fallback}\n\n[input 结构化解析失败，已回落透传]` }
  }
}

// ── 审批节点答案解析（双问询：decision + comment） ─────────────────────────────
//
// 现在 onQuestion 一次问两个问题：decision（single_choice，下标 0）+ comment（text，下标 1）。
// 这组纯函数把解析逻辑从 SessionService 私有方法里提出来导出，便于单测直接覆盖；
// answers.answers 可能是数组（按 id/question/index/rawIndex 定位）或映射（按 question/id/index key），
// 取值候选 answer/text/optionLabel/optionValue/value——与 claude-sdk-executor 的约定一致。

/** 在 answers.answers（对象数组或映射）里按 question 引用 + 数组下标定位原始答案条目。 */
export function findWorkflowApprovalAnswerImpl(
  rawAnswers: unknown,
  question: UserQuestionPrompt,
  index = 0,
): unknown {
  if (Array.isArray(rawAnswers)) {
    return rawAnswers.find((entry, rawIndex) => {
      if (typeof entry !== 'object' || entry == null) return rawIndex === index
      const obj = entry as Record<string, unknown>
      return (
        obj.id === question.id ||
        obj.question === question.question ||
        obj.index === index ||
        rawIndex === index
      )
    })
  }
  if (typeof rawAnswers === 'object' && rawAnswers != null) {
    const map = rawAnswers as Record<string, unknown>
    return (
      map[question.question] ??
      (question.id != null ? map[question.id] : undefined) ??
      map[String(index)]
    )
  }
  return undefined
}

/** 从单条答案里取出可读文本（候选：answer/text/optionLabel/optionValue/value）。 */
export function extractWorkflowApprovalTextImpl(raw: unknown): string {
  if (typeof raw === 'string') return raw
  if (typeof raw !== 'object' || raw == null) return ''
  const obj = raw as Record<string, unknown>
  for (const candidate of [obj.answer, obj.text, obj.optionLabel, obj.optionValue, obj.value]) {
    if (typeof candidate === 'string' && candidate.trim().length > 0) return candidate
  }
  return ''
}

/** 判断审批 decision 问题是否被「明确批准」（cancelled/declined/skipped/无明确 approve 视为未批准）。 */
export function isWorkflowApprovalApprovedImpl(
  answers: Record<string, unknown>,
  question: UserQuestionPrompt,
  index = 0,
): boolean {
  if (answers.cancelled === true || answers.declined === true) return false
  const raw = findWorkflowApprovalAnswerImpl(answers.answers, question, index)
  if (typeof raw === 'object' && raw != null) {
    const obj = raw as Record<string, unknown>
    if (obj.skipped === true || obj.declined === true) return false
  }
  const text = extractWorkflowApprovalTextImpl(raw).trim().toLowerCase()
  if (text.length === 0) return false
  return text.includes('批准') || text.includes('approve')
}

/** 从 answers 提取审批修改意见（comment 文本）；空串或 skipped/declined 一律视为无意见。 */
export function extractWorkflowApprovalCommentImpl(
  answers: Record<string, unknown>,
  question: UserQuestionPrompt,
  index: number,
): string {
  const raw = findWorkflowApprovalAnswerImpl(answers.answers, question, index)
  if (typeof raw === 'object' && raw != null) {
    const obj = raw as Record<string, unknown>
    if (obj.skipped === true || obj.declined === true) return ''
  }
  return extractWorkflowApprovalTextImpl(raw).trim()
}

// ── 原子节点真实执行（skill / tool / mcp / plan / review / artifact） ─────────────

/**
 * 允许经临时 worker 真实派发执行的原子节点类型。
 * verify（自跑命令）、approval（暂停问询）有各自的专用路径，不在此列；
 * input 走 LLM 结构化解析（与 plan/review 同机制：纯 LLM，不挂外部工具）。
 */
const WORKFLOW_LLM_ATOMIC_KINDS = new Set<import('@spark/protocol').WorkflowNodeKind>([
  'input',
  'skill',
  'tool',
  'mcp',
  'plan',
  'review',
  'artifact',
])

/**
 * plan / review 节点限制为「只读」工具集：禁掉写与执行类工具（Write/Edit/MultiEdit/NotebookEdit/Bash），
 * 只保留探索（Read/Grep/Glob/Web*）与协作类，产出计划/复核文本而不去改动工作区。
 * 用禁用名单而不是白名单，是为了与 memberDisallowedToolsFromConfig 的 disallowedTools 语义一致
 * （allowedTools 在 SDK 里只是免审批名单，挡不住其它工具）。
 */
const WORKFLOW_READONLY_DISALLOWED_TOOLS: string[] = [
  'Write',
  'Edit',
  'MultiEdit',
  'NotebookEdit',
  'Bash',
]

/** 供 plan/review 节点用的「只读」toolIds 白名单（= 全量可限制工具 - 写/执行类）。 */
const WORKFLOW_READONLY_ALLOWED_TOOL_IDS: string[] = WORKFLOW_RESTRICTABLE_TOOL_NAMES.filter(
  (name) => !WORKFLOW_READONLY_DISALLOWED_TOOLS.includes(name),
)

/** 临时原子 worker 的合成 id：与 agent/subagent 的真实 workerId 命名空间隔离，避免冲突。 */
export function workflowAtomicMemberId(nodeId: string): string {
  return `workflow-atomic:${nodeId}`
}

/**
 * 判断某原子节点这一轮该走「真实执行」还是「静态回显」。
 * - config.execution === 'static' 强制走旧的静态回显（兼容/降本）。
 * - config.execution === 'auto'（或缺省）时，input/skill/tool/mcp/plan/review/artifact 走真实执行；
 *   其中 artifact 只有配了 exportPath 或没配 value 静态值时才需要 LLM 产出内容——
 *   为保持行为可预期，这里对 auto 的 artifact 也一律走真实执行，导出/透传在回调里再分流。
 *   input 走 LLM 结构化解析（拆解 prompt/objective/constraint/value 为结构化 JSON），
 *   解析失败或 execution:'static' 时回落透传 getDefaultWorkflowAtomicContent。
 */
export function shouldRunWorkflowAtomicNodeAsAgent(node: NormalizedWorkflowNode): boolean {
  const execution = typeof node.config.execution === 'string' ? node.config.execution.trim() : ''
  if (execution === 'static') return false
  return WORKFLOW_LLM_ATOMIC_KINDS.has(node.kind)
}

/**
 * 为原子节点构造临时受限 worker：复用 createWorkflowSubagentMember 的 provider/model 继承逻辑，
 * 再按节点类型收窄能力面：
 * - skill：只挂节点所选 skillIds；tool：把 toolIds 交给 metadata（executeMemberTurn 换算 disallowedTools）；
 *   mcp：只挂所选 mcpServerIds。这些字段 createWorkflowSubagentMember 已从 config 读取，无需重复。
 * - input / plan / review：纯 LLM 任务（结构化解析 / 计划 / 复核），不需要外部写与执行类工具——
 *   额外用只读 toolIds 覆盖，禁掉 Write/Edit/Bash 等。
 */
function createWorkflowAtomicMember(node: NormalizedWorkflowNode, hostAgent: AgentItem): AgentItem {
  const workerId = workflowAtomicMemberId(node.id)
  const base = createWorkflowSubagentMember(node, hostAgent, workerId)
  if (node.kind !== 'input' && node.kind !== 'plan' && node.kind !== 'review') return base
  // input/plan/review：若节点自己配了 toolIds 就取「所选 ∩ 只读集」，否则直接用整个只读集。
  const configured = stringArrayConfig(node.config.toolIds)
  const readonlyIds =
    configured.length > 0
      ? configured.filter((id) => WORKFLOW_READONLY_ALLOWED_TOOL_IDS.includes(id))
      : WORKFLOW_READONLY_ALLOWED_TOOL_IDS
  return {
    ...base,
    metadata: {
      ...base.metadata,
      toolIds: readonlyIds,
    },
  }
}

/**
 * 原子节点真实执行时给临时 worker 的指令：config.prompt 优先（缺省用标题），
 * 再拼上工作流目标与上游 inputs——与 agent 节点派发路径的指令组装保持一致。
 *
 * 特例：input 节点要求 LLM 把节点的 prompt/objective/constraint/value 拆解为结构化 JSON，
 * 输出格式严格、只输出 JSON、不带任何解释（解析失败由 executeAtomicNode 回落透传兜底）。
 */
export function buildWorkflowAtomicInstruction(request: {
  kind?: import('@spark/protocol').WorkflowNodeKind
  title: string
  objective: string
  inputs: Record<string, unknown>
  config: Record<string, unknown>
}): string {
  if (request.kind === 'input') {
    return buildWorkflowInputStructuredInstruction(request)
  }
  const prompt =
    typeof request.config.prompt === 'string' && request.config.prompt.trim().length > 0
      ? request.config.prompt.trim()
      : request.title
  const parts = [prompt]
  if (request.objective.trim().length > 0) {
    parts.push(`[Workflow objective]\n${request.objective.trim()}`)
  }
  const inputKeys = Object.keys(request.inputs)
  if (inputKeys.length > 0) {
    parts.push(`[Upstream inputs]\n${JSON.stringify(request.inputs)}`)
  }
  return parts.join('\n\n')
}

/**
 * input 节点的结构化解析指令：把节点已有的 prompt/value/objective/constraint 喂给 LLM，
 * 要求输出固定 schema 的 JSON（objective/constraints/deliverables），且只输出 JSON、不要解释。
 */
function buildWorkflowInputStructuredInstruction(request: {
  title: string
  objective: string
  inputs: Record<string, unknown>
  config: Record<string, unknown>
}): string {
  const fields: string[] = []
  const prompt = typeof request.config.prompt === 'string' ? request.config.prompt.trim() : ''
  if (prompt.length > 0) fields.push(`prompt: ${prompt}`)
  const value = request.config.value
  if (value != null) {
    fields.push(typeof value === 'string' ? `value: ${value}` : `value: ${JSON.stringify(value)}`)
  }
  const objective =
    typeof request.config.objective === 'string' ? request.config.objective.trim() : ''
  if (objective.length > 0) {
    fields.push(`objective: ${objective}`)
  } else if (request.objective.trim().length > 0) {
    fields.push(`objective: ${request.objective.trim()}`)
  }
  const constraint = request.config.constraint
  if (constraint != null) {
    fields.push(
      typeof constraint === 'string'
        ? `constraint: ${constraint}`
        : `constraint: ${JSON.stringify(constraint)}`,
    )
  }
  const title = request.title.trim().length > 0 ? request.title.trim() : '(untitled input)'
  const inputKeys = Object.keys(request.inputs)
  if (inputKeys.length > 0) {
    fields.push(`upstream_inputs: ${JSON.stringify(request.inputs)}`)
  }
  return [
    `你是工作流「${title}」输入节点的结构化解析器。`,
    '请基于以下节点配置，把用户意图拆解为结构化 JSON。',
    '',
    '[Node fields]',
    fields.length > 0 ? fields.join('\n') : '(no fields configured)',
    '',
    '[Output format]',
    '严格输出以下 JSON（不要 ```json 围栏、不要任何解释文字、只输出 JSON 本身）：',
    '{"objective":"...","constraints":["..."],"deliverables":["..."]}',
    '- objective：本次输入的核心目标（一句话）。',
    '- constraints：约束/限制条件数组（每条一句话；没有就给空数组）。',
    '- deliverables：期望产出物数组（每条一句话；没有就给空数组）。',
  ].join('\n')
}

/**
 * artifact 节点的导出目标解析：config.exportPath 配置后，把 resolve 后的绝对路径交给调用方写文件。
 * 防路径穿越——resolve 后必须仍在 workspaceRootPath 内，否则返回 null 并给出原因。
 */
export function resolveWorkflowArtifactExportPath(
  config: Record<string, unknown>,
  workspaceRootPath: string,
): { ok: true; absolutePath: string } | { ok: false; reason?: string } {
  const raw = typeof config.exportPath === 'string' ? config.exportPath.trim() : ''
  if (raw.length === 0) return { ok: false }
  if (path.isAbsolute(raw)) return { ok: false, reason: 'exportPath 必须是工作区相对路径' }
  const root = path.resolve(workspaceRootPath)
  const absolutePath = path.resolve(root, raw)
  // 用 root + path.sep 前缀判定，避免 /root-evil 这类同前缀目录被误判为在 root 内。
  if (absolutePath !== root && !absolutePath.startsWith(root + path.sep)) {
    return { ok: false, reason: 'exportPath 超出工作区范围' }
  }
  return { ok: true, absolutePath }
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

function getAllowedMcpServerIds(agent: AgentItem, workflow: WorkflowItem | null): Set<string> {
  const ids = new Set(agent.mcpServerIds)
  const graph = workflow != null ? normalizeWorkflowGraph(workflow.graph) : null
  for (const node of graph?.nodes ?? []) {
    const configured = node.config.mcpServerIds
    if (!Array.isArray(configured)) continue
    for (const id of configured) {
      if (typeof id === 'string' && id.trim().length > 0) ids.add(id)
    }
  }
  return ids
}

function buildAppMcpAvailabilityPrompt(input: {
  servers: Array<{ id: string; name: string; scope: string; enabled: boolean }>
  allowedServerIds: Set<string>
}): string | undefined {
  const appServers = input.servers.filter((server) => server.scope !== MANAGED_MCP_SCOPE)
  if (appServers.length === 0) return undefined

  const available = appServers.filter(
    (server) => server.enabled && input.allowedServerIds.has(server.id),
  )
  if (available.length > 0) return undefined

  const enabled = appServers.filter((server) => server.enabled)
  const serverSummary = appServers
    .map((server) => `${server.name} (${server.enabled ? 'enabled' : 'disabled'}, ${server.scope})`)
    .join(', ')

  return [
    '## App MCP Availability',
    'The current Agent has no user-added app MCP servers available in this turn.',
    enabled.length > 0
      ? `The app has configured MCP server(s): ${serverSummary}. None of the enabled servers are bound to this Agent or workflow node.`
      : `The app has configured MCP server(s): ${serverSummary}, but none are enabled.`,
    'If the user asks to use a newly added MCP, explain both checks clearly: the MCP may have been added to the app successfully, but it must also be enabled and assigned to the current Agent helper (Agent Management > MCP) or the active workflow node before you can call its tools.',
    'Do not claim the MCP is broken only because no MCP tool is visible. State what you can observe from the current tool set and guide the user to bind the MCP to this Agent if needed.',
  ].join('\n')
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

async function checkWorkspaceShellAvailable(
  cwd: string | null,
): Promise<{ available: boolean; shell?: string; error?: string }> {
  const { exec } = await import('node:child_process')
  const { promisify } = await import('node:util')
  const execAsync = promisify(exec)
  const shell = process.env.SHELL
  const withShell = (result: {
    available: boolean
    error?: string
  }): { available: boolean; shell?: string; error?: string } => ({
    ...result,
    ...(shell != null ? { shell } : {}),
  })
  try {
    const { stdout } = await execAsync('echo spark-shell-ok', {
      cwd: cwd ?? undefined,
      timeout: 5000,
      maxBuffer: 64 * 1024,
    })
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
function getImportedFromMetadata(
  metadataJson: string | null | undefined,
): HistoryImportSource | null {
  if (metadataJson == null || metadataJson === '') return null
  try {
    const meta = JSON.parse(metadataJson) as { importedFrom?: unknown }
    if (meta.importedFrom === 'claude-code' || meta.importedFrom === 'codex')
      return meta.importedFrom
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

function getAutomationMetadata(metadataJson: string | null | undefined): {
  unattended: boolean
  source: string | null
} {
  if (metadataJson == null || metadataJson === '') {
    return { unattended: false, source: null }
  }
  try {
    const meta = JSON.parse(metadataJson) as {
      automation?: { unattended?: unknown; source?: unknown } | null
    }
    const automation = meta.automation
    if (automation == null || typeof automation !== 'object') {
      return { unattended: false, source: null }
    }
    return {
      unattended: automation.unattended === true,
      source: typeof automation.source === 'string' ? automation.source : null,
    }
  } catch {
    return { unattended: false, source: null }
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

export function collectCompleteAssistantTurnText(events: AssistantMessageEvent[]): string {
  const textBySegment = new Map<string, string>()
  const segmentOrder: string[] = []
  const anonymousParts: string[] = []
  let finalText = ''

  for (const event of events) {
    if (event.mode !== 'complete' || typeof event.content !== 'string') continue
    if (event.isFinal) {
      finalText = event.content
      continue
    }
    if (typeof event.segmentId === 'string' && event.segmentId.length > 0) {
      if (!textBySegment.has(event.segmentId)) segmentOrder.push(event.segmentId)
      textBySegment.set(event.segmentId, event.content)
      continue
    }
    anonymousParts.push(event.content)
  }

  if (finalText.length > 0) return finalText

  return [...segmentOrder.map((segmentId) => textBySegment.get(segmentId) ?? ''), ...anonymousParts]
    .map((text) => text.trim())
    .filter((text) => text.length > 0)
    .join('\n\n')
}

function getLocalCliDefaultModel(provider: { id: string }): string {
  return isLocalCodexCliProvider(provider) ? LOCAL_CODEX_CLI_DEFAULT_MODEL : LOCAL_CLI_DEFAULT_MODEL
}

function providerRowsForModelRouter(
  rows: Array<{ id: string; provider_type: string; config_json: string }>,
): ModelRouterProvider[] {
  return rows.map((row) => {
    const config = parseProviderConfigForModelRouter(row.config_json)
    return {
      id: row.id,
      provider: row.provider_type,
      defaultModel: stringConfigValue(config.defaultModel) ?? stringConfigValue(config.model) ?? '',
      modelIds: Array.isArray(config.modelIds)
        ? config.modelIds.filter((item): item is string => typeof item === 'string')
        : [],
      ...(isKnownModelType(config.modelType) ? { modelType: config.modelType } : {}),
      ...(typeof config.mediaProvider === 'string' ? { mediaProvider: config.mediaProvider } : {}),
      ...(Array.isArray(config.mediaCapabilities)
        ? {
            mediaCapabilities: config.mediaCapabilities.filter(
              (item): item is string => typeof item === 'string',
            ),
          }
        : {}),
    }
  })
}

function parseProviderConfigForModelRouter(configJson: string): Record<string, unknown> {
  try {
    return JSON.parse(configJson) as Record<string, unknown>
  } catch {
    return {}
  }
}

function stringConfigValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined
}

function isKnownModelType(value: unknown): value is NonNullable<ModelRouterProvider['modelType']> {
  return (
    value === 'image' ||
    value === 'text' ||
    value === 'multimodal' ||
    value === 'voice' ||
    value === 'video'
  )
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

/**
 * FR-0a：为团队成员按 adapter 解析执行器档位与 codex sdkConfig 扩展字段。
 * 与 Host 主循环 codex 分支（~1901-1920）对称；抽此纯函数便于单测 + 防 Host/member 漂移。
 *
 * - claude 成员 → permissionMode 'claude-auto'、无 codex 扩展（走 ClaudeSDKExecutor）
 * - codex 成员 → permissionMode 'codex-auto-review'（→ acceptEdits / workspace-write），并按
 *   isLocalCli/providerType/codexApiKind 构造 useLocalConfig/codexApiKind/codexCliProvider，
 *   供 createCodexExecutorForConfig 选 CodexCli/CodexSdk 执行器。
 *
 * 注：原方案 6.8 节写的 'codex-auto' 不在 SparkPermissionMode 联合类型内（非法字面量），
 * 故取语义最近的 codex-auto-review。
 */
export function resolveCodexMemberExecutionProfile(args: {
  memberAdapter: AgentAdapterKind
  isLocalCli: boolean
  providerType: string
  providerProfileId: string
  providerName: string
  apiKey: string
  codexApiKind?: 'chat' | 'responses' | undefined
  apiEndpoint?: string | undefined
}): {
  isCodexMember: boolean
  permissionMode: SDKExecutorConfig['permissionMode']
  extras: {
    useLocalConfig?: true
    codexApiKind?: 'chat' | 'responses'
    codexCliProvider?: SDKExecutorConfig['codexCliProvider']
  }
} {
  const isCodexMember = args.memberAdapter !== 'claude' && args.memberAdapter !== 'claude-sdk'
  const permissionMode: SDKExecutorConfig['permissionMode'] = isCodexMember
    ? 'codex-auto-review'
    : 'claude-auto'
  // useLocalConfig 对 claude/codex 本地 CLI provider 都需要（走宿主本地配置/OAuth）；
  // codexApiKind/codexCliProvider 是 codex 专属，仅 codex 成员构造——claude 成员即便挂在
  // 非 anthropic provider 下也不注入，保持与改动前逐字节一致。
  const extras: {
    useLocalConfig?: true
    codexApiKind?: 'chat' | 'responses'
    codexCliProvider?: SDKExecutorConfig['codexCliProvider']
  } = {
    ...(args.isLocalCli ? { useLocalConfig: true as const } : {}),
    ...(isCodexMember
      ? {
          ...(args.codexApiKind != null ? { codexApiKind: args.codexApiKind } : {}),
          ...(!args.isLocalCli && args.providerType !== 'anthropic'
            ? {
                codexCliProvider: buildCodexCliModelProviderConfig({
                  providerProfileId: args.providerProfileId,
                  providerName: args.providerName,
                  apiKind: args.codexApiKind ?? 'responses',
                  apiKey: args.apiKey,
                  ...(args.apiEndpoint !== undefined ? { apiEndpoint: args.apiEndpoint } : {}),
                }),
              }
            : {}),
        }
      : {}),
  }
  return { isCodexMember, permissionMode, extras }
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

async function collectWorkspaceChangeSnapshot(
  workspaceRootPath: string,
): Promise<WorkspaceFileChangeSnapshot> {
  try {
    const changes = await collectWorkspaceFileChanges(workspaceRootPath)
    return new Set(changes.map((change) => `${change.path}::${change.changeType}`))
  } catch (err) {
    log.warn(
      `Failed to collect workspace change snapshot: ${err instanceof Error ? err.message : String(err)}`,
    )
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
    log.warn(
      `Failed to collect workspace file changes: ${err instanceof Error ? err.message : String(err)}`,
    )
    return []
  }
}

async function collectWorkspaceFileChanges(
  workspaceRootPath: string,
): Promise<WorkspaceDetectedFileChange[]> {
  const { execFile } = await import('node:child_process')
  const { promisify } = await import('node:util')
  const execFileAsync = promisify(execFile)
  const { stdout } = await execFileAsync(
    'git',
    ['-C', workspaceRootPath, 'status', '--porcelain', '--untracked-files=all'],
    {
      maxBuffer: 1024 * 1024,
    },
  )
  return stdout
    .split(/\r?\n/)
    .map(parseGitStatusPorcelainLine)
    .filter((change): change is WorkspaceDetectedFileChange => change != null)
}

function parseGitStatusPorcelainLine(line: string): WorkspaceDetectedFileChange | null {
  if (line.length < 4) return null
  const status = line.slice(0, 2)
  const rawPath = line.slice(3).trim()
  if (!rawPath || rawPath.startsWith('.spark/') || rawPath.startsWith('.spark-artifacts/'))
    return null
  const filePath = rawPath.includes(' -> ') ? rawPath.split(' -> ').pop()!.trim() : rawPath
  if (status === '??' || status.includes('A')) return { path: filePath, changeType: 'create' }
  if (status.includes('D')) return { path: filePath, changeType: 'delete' }
  return { path: filePath, changeType: 'modify' }
}

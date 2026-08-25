import crypto from 'node:crypto'
import { existsSync } from 'node:fs'
import path from 'node:path'
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
  UsageLedgerRepository,
  GoalRepository,
  TurnRequestRepository,
  SessionSummaryRepository,
  SessionCollaborationRepository,
} from '@spark/storage'
import type {
  AgentItem,
  SessionGoal as StoredSessionGoal,
  GoalProgressEntry,
  GoalStatus,
  ProviderProfileRow,
} from '@spark/storage'
import type { SparkDatabase, MemoryScopeFilter } from '@spark/storage'
import { resolveProviderApiKey } from './provider-credential-resolver.js'
import {
  SessionWorktreeStateService,
  type SessionRuntimeWorktreeState,
  type SessionWorktreeStateInput,
} from './session-worktree-state.js'
import {
  buildComputerDecisionModelConfig,
  type ComputerDecisionModelConfig,
} from '../computer-use/computer-decision-model.js'
import { APPLICATION_FOUNDATION_SYSTEM_PROMPT } from './core-agent-behavior-prompt.js'
export { APP_IDENTITY_SYSTEM_PROMPT } from './core-agent-behavior-prompt.js'
import { MEMORY_PROVENANCE_SYSTEM_PROMPT } from './memory-provenance-prompt.js'
import type {
  AgentEvent,
  CliSparkOverride,
  SessionCancelQueuedTurnResponse,
  SessionChatMode,
  SessionClearQueuedTurnsResponse,
  SessionReorderQueuedTurnsResponse,
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
  AgentStatusValue,
  UserMessagePresentation,
  HookNode,
  SessionAttachment,
  UserQuestionPrompt,
  TeamModeConfig,
  TeamA2ATask,
  ProposedGoalContract,
  SessionReference,
  SessionReferenceInput,
  SessionReferenceCandidate,
} from '@spark/protocol'
import type { ProjectSkillSummaryItem, SessionPermissionMode } from '@spark/protocol'
import {
  COMMAND_FOLLOW_UP_TURN_PRESENTATION,
  GOAL_CONTRACT_DRAFT_TURN_PRESENTATION,
  GOAL_ITERATION_TURN_PRESENTATION,
  isBuiltInLocalCliProvider,
  pickUserMessagePresentation,
  getAutoRouterAdapterForProviderId,
} from '@spark/protocol'
import { estimateTokens, normalizeReasoningBudgetTokens } from '@spark/shared'
import { TeamDispatchService } from './team-dispatch.service.js'
import type { TeamMemberExecutionResult } from './team-dispatch.service.js'
import { createTeamDispatchGovernanceHooks } from './team-dispatch-governance.js'
import {
  TEAM_DISPATCH_AUTO_CONTINUATION_PRESENTATION,
  TEAM_DISPATCH_AUTO_CONTINUATION_PROMPT,
  TeamDispatchAutoContinuationTracker,
} from './team-dispatch-auto-continuation.js'
import { runMemberExecutorIfActive } from './member-execution-lifecycle.js'
import {
  getTeamMcpHttpBridge,
  type TeamMcpBridgeHandle,
  type TeamToolDefinition,
} from './team-mcp-http-bridge.js'
import { TeamLedgerRuntimeAdapter } from './team-ledger-runtime-adapter.js'
import {
  buildTeamRuntimeToolDefinitions,
  createTeamRuntimeAdapters,
  deleteTeamRuntimeState,
} from './team-runtime-tooling.js'
import { buildMemberContinuityKey, buildTeamContinuityScope } from './team-continuity.js'
import { buildWorkflowBindingAuthorityPrompt } from './workflow-system-prompt.js'
import { buildContextLedger } from './context-ledger.js'
import { joinDistinctPromptSections } from './prompt-deduplication.js'
import { TurnRuntimeMetricsTracker } from './turn-runtime-metrics.js'
import { createAuthoritativeUserMessageEvent } from './session-user-message-authority.js'
import { createCanvasMcpUnavailableEvents } from './canvas-mcp-startup-events.js'
import type { PluginManager } from './plugins/plugin-manager.service.js'
import {
  PluginRuntimeMcpBridge,
  type PluginRuntimeMcpHandle,
} from './plugin-runtime/plugin-runtime-mcp-bridge.js'
import { RuntimeBroker } from './plugin-runtime/runtime-broker.js'
import { registerBuiltinRuntimeAdapters } from './plugin-runtime/builtin-runtimes.js'

/** Read the runtime-log toggle from the telemetry settings object shared with the renderer. */
export function readRuntimeLogEnabled(settings: Pick<SettingsRepository, 'get'>): boolean {
  const telemetryData = settings.get('telemetry', 'data')
  if (telemetryData == null || typeof telemetryData !== 'object') return false
  return (telemetryData as { runtimeLogEnabled?: unknown }).runtimeLogEnabled === true
}

// ─── D-13 拆分出的小工具 ───
import { ResumeGateManager, type AgentAdapterKind } from './session-resume-gate.js'
export { isSdkResumeSafe, makeSdkRuntimeSessionId } from './session-resume-gate.js'
export type { AgentAdapterKind } from './session-resume-gate.js'

// ─── P1-W1-D4 引擎归一化（迁出至 ./session/engine-kinds.ts）───
import {
  getAgentAdapterFromSession,
  getPermissionModeFromSession,
  isCodexPermissionMode,
  normalizeAgentAdapter,
  normalizePermissionMode,
  resolveEngineKind,
} from './session/engine-kinds.js'
export { getAgentAdapterFromSession, getPermissionModeFromSession } from './session/engine-kinds.js'

// ─── P1-W1-D5 引擎注册表（迁出至 ./session/engine-registry.ts）───
import { createDefaultEngineRegistry } from './session/engine-registry.js'
import { isPersistentCodexRuntimeEnabled } from '../sdk/codex-app-server/codex-app-server-runtime.js'
import {
  buildCodexNativeThreadIdentityScope,
  buildPersistentCodexAppServerConfig,
  createCodexNativeThreadMetadataPatch,
  readCodexNativeThreadGeneration,
  scopeCodexNativeThreadBindingKey,
  shouldUsePersistentCodexAppServer,
} from './session/codex-native-thread-binding.js'
// 原 codex 载具工厂整体迁入 codex descriptor；re-export 保持既有 import 面。
export { createCodexExecutorForConfig } from './session/engine-registry.js'

// ─── P1-W2-D1 turn 所有权注册表（迁出至 ./session/turn-registry.ts）───
import { TurnRegistry } from './session/turn-registry.js'

// ─── P1-W3-S2 命令系统（迁出至 ./session/session-commands.ts）───
import { SessionCommandController } from './session/session-commands.js'

// ─── P1-W3-S3 checkpoint / 事件清理（迁出至 ./session/checkpoint.ts）───
import { SessionCheckpointManager } from './session/checkpoint.js'

// ─── P1-W3-S4 会话 CRUD / 引用 / fork（迁出至 ./session/session-crud.ts）───
import { SessionCrudController } from './session/session-crud.js'

// ─── P1-W3-S5 MCP 工具面装配（迁出至 ./session/session-mcp-tooling.ts）───
import { SessionMcpTooling } from './session/session-mcp-tooling.js'

// ─── P1-W3-S6 用量台账（迁出至 ./session/session-usage-ledger.ts）───
import { SessionUsageLedger } from './session/session-usage-ledger.js'

// ─── P1-W3-S1 类外纯函数（迁出至 ./session/session-pure-utils.ts）───
import {
  MEMORY_BEHAVIOR_SYSTEM_PROMPT,
  SESSION_WORKTREE_STATE_SYSTEM_PROMPT,
  SPARK_SESSION_WORKTREE_TOOL_DESCRIPTION,
  SUBAGENT_USAGE_HINT_SYSTEM_PROMPT,
  TEAM_DISPATCH_BATCH_TOOL_DESCRIPTION,
  TEAM_DISPATCH_TOOL_DESCRIPTION,
  WORKSPACE_TEMP_DIRS_SYSTEM_PROMPT,
  appendInterruptedTurnEventsForSession,
  buildAttachmentPromptLedger,
  buildCodexCliModelProviderConfig,
  buildMemberDispatchThreadContext,
  buildMemberUserMessage,
  buildOrchestrationModeSystemPrompt,
  buildRuntimeRulesPrompt,
  buildTeamRosterPrompt,
  buildUserMessageSnapshot,
  buildWorktreeSessionSystemPrompt,
  collectManagedRuleContents,
  computerVisionCandidateScore,
  deriveSessionTitle,
  deriveSubAppCreateSessionTitle,
  filterCliCompatibleMcpServers,
  formatPeerBroadcastDelta,
  formatReplyForHost,
  formatSelectedSkillPrompt,
  formatThreadMessageBrowse,
  formatThreadMessageFull,
  getAttachmentAdditionalDirectories,
  getAutomationMetadata,
  getCliSparkOverrideFromMetadata,
  getDebugModeFromMetadata,
  getLatestMatchingTurnPromptSnapshot,
  getLatestTurnIdFromEvents,
  getLocalCliDefaultModel,
  getProviderModelIds,
  getRuntimePatch,
  getWorkspaceRootIssue,
  isCliSparkOverrideCompatible,
  isComputerVisionCandidate,
  isTitlePrefixOfMessage,
  joinPromptSections,
  makeRuntimeLoadStatus,
  mapSessionAttachmentsToDispatch,
  normalizeCliSparkOverride,
  normalizeReasoningEffort,
  normalizeTurnAttachments,
  parseWorktreePromptMeta,
  pickGoalDrainableRuntimeSelection,
  prepareTurnAttachments,
  providerRowsForModelRouter,
  assertModelNotScheduledBlocked,
  readSessionTeamConfig,
  resolveCodexMemberExecutionProfile,
  shouldDeriveSessionTitle,
  withAgentSnapshot,
} from './session/session-pure-utils.js'
import type { SessionRuntimePatch, WorktreePromptMeta } from './session/session-pure-utils.js'
// 既有导出面保持不变（测试与同层模块直接 import 这些符号）。
export {
  MEMORY_BEHAVIOR_SYSTEM_PROMPT,
  buildMemberDispatchThreadContext,
  buildMemberUserMessage,
  buildTeamRosterPrompt,
  deriveSubAppCreateSessionTitle,
  formatPeerBroadcastDelta,
  formatReplyForHost,
  formatThreadMessageBrowse,
  formatThreadMessageFull,
  mapSessionAttachmentsToDispatch,
  resolveCodexMemberExecutionProfile,
}
export type { TeamRosterPromptOptions } from './session/session-pure-utils.js'

import {
  createUserCancelledTurnEvent,
  createInterruptedTurnEvents,
  shouldRunTurnPostProcessing,
  collectCompleteAssistantTurnText,
} from './session-event-helpers.js'
export {
  createUserCancelledTurnEvent,
  createInterruptedTurnEvents,
  shouldRunTurnPostProcessing,
  collectCompleteAssistantTurnText,
}

import {
  computeHistoryEntryTokenBudget,
  computeHistoryTokenBudget,
} from './session-history-helpers.js'
export { buildConversationHistoryPromptFromEvents } from './session-history-helpers.js'

import {
  PLATFORM_TOOL_NAMES,
  PLATFORM_MANAGEMENT_SYSTEM_PROMPT,
  DEBUG_TOOL_NAMES,
  DEBUG_MODE_SYSTEM_PROMPT,
  SEARCH_TOOL_NAMES,
  SUB_APP_TOOL_NAMES,
  PRESENT_FILES_TOOL_NAMES,
  PRESENT_FILES_SYSTEM_PROMPT,
  QUICK_REPLIES_TOOL_NAMES,
  QUICK_REPLIES_SYSTEM_PROMPT,
  RENDER_HTML_TOOL_NAMES,
  RENDER_HTML_SYSTEM_PROMPT,
  RENDER_DIAGRAM_TOOL_NAMES,
  RENDER_DIAGRAM_SYSTEM_PROMPT,
  TOOL_RESULT_SYSTEM_PROMPT,
  TOOL_RESULT_TOOL_NAMES,
  WEB_SEARCH_SYSTEM_PROMPT,
  SPARK_WEB_TOOL_SYSTEM_PROMPT,
  VALIDATION_SUGGESTION_TOOL_NAMES,
  VALIDATION_SUGGESTION_TOOL_DESCRIPTION,
  extractPresentedFiles,
  extractReportedFileChanges,
  workspaceRelativeChangeKey,
  mergeUniqueStrings,
  resolveMcpNodeRuntimeExecutable,
  resolvePresentFilesMcpServer,
  resolveQuickRepliesMcpServer,
  resolveSparkSessionMcpServerPath,
  resolveToolResultProxyMcpServerPath,
  resolveToolResultReaderMcpServer,
  tryResolveMcpNodeRuntimeExecutable,
} from './session-mcp-tooling-helpers.js'
import { governMcpServers } from './tool-result-mcp-governance.js'
import { governAgentToolResultEvent } from '../tools/tool-result-artifact-store.mjs'

import {
  buildManagedAgentSystemPrompt,
  buildWorkflowAtomicInstruction,
  extractWorkflowApprovalCommentImpl,
  extractWorkflowApprovalTextImpl,
  findWorkflowApprovalAnswerImpl,
  isWorkflowApprovalApprovedImpl,
  hasWorkflowExecutableNodes,
  resolveWorkflowArtifactExportPath,
  shouldRunWorkflowAtomicNodeAsAgent,
  validateWorkflowInputStructuredContent,
  validateWorkflowRouteDecisionContent,
  workflowAtomicMemberId,
  // 内部使用
  createWorkflowSubagentMember,
  applyWorkflowNodeOverrides,
  createWorkflowAtomicMember,
  getDefaultWorkflowAtomicContent,
  memberDisallowedToolsFromConfig,
  runWorkflowVerifyNode,
} from './session-workflow-helpers.js'
import { MediaPresentationCollector } from './media/media-presentation-collector.js'
export {
  buildWorkflowAtomicInstruction,
  extractWorkflowApprovalCommentImpl,
  isWorkflowApprovalApprovedImpl,
  hasWorkflowExecutableNodes,
  resolveWorkflowArtifactExportPath,
  shouldRunWorkflowAtomicNodeAsAgent,
  validateWorkflowInputStructuredContent,
  validateWorkflowRouteDecisionContent,
  workflowAtomicMemberId,
} from './session-workflow-helpers.js'
import {
  AGENT_MESSAGE_DELIVERY_MODES,
  qualifyTeamToolName,
  SPARK_TEAM_MCP_SERVER_NAME,
  type AgentMessageDeliveryMode,
  type TeamToolName,
} from './team-tool-names.js'
import { buildGoalContractDraftPrompt, parseGoalContractBlock } from './goal-contract.js'
import { loadSdkMcpFactory } from '../sdk/index.js'
import { z } from 'zod'
import { TodoStore } from '../core/todo-store.js'
import type { CheckpointRestoreResult, CheckpointSnapshot, CommandListItem } from '../core/index.js'
import { McpService } from './mcp-server.service.js'
import type { McpOAuthTokenProvider } from './mcp-server.service.js'
import type { McpChangeEvent } from './mcp-server.service.js'
import { PlatformBridgeService } from './platform-bridge.service.js'
import { SESSION_SCHEDULE_AGENT_SYSTEM_PROMPT } from './session-schedule-agent-tools.js'
import { getDebugLogServer } from './debug-log-server.service.js'
import {
  BROWSER_AUTOMATION_SYSTEM_PROMPT,
  BROWSER_TOOL_NAMES,
} from './browser-automation-prompt.js'
import { RuntimeCompositionService } from './runtime-composition.service.js'
import { ProjectContextService } from './project-context.service.js'
import { ValidationSuggestionService } from './validation-suggestion.service.js'
import { SessionQuestionGate } from './session-question-gate.js'
import {
  executeWorkflowAgentPlan,
  getWorkflowNodesDeep,
  getWorkflowNodeEffectiveWorkerId,
  getWorkflowNodeWorkerId,
  normalizeWorkflowGraph,
  type NormalizedWorkflowGraph,
  type WorkflowDispatchAttachment,
} from './workflow-executor.js'
import { SkillLoader } from '../skills/skill-loader.js'
import type {
  SDKApprovalResult,
  SDKExecutorConfig,
  SDKInvocationSnapshot,
  SDKMcpServerConfig,
  SDKPermissionRequestContext,
  SDKQuestionRequestContext,
} from '../sdk/index.js'
import { CodexRuntimeMcpResourceCoordinator } from './session/codex-runtime-mcp-resources.js'
import type { ActiveExecution } from '../sdk/index.js'
import { getResumeCircuitBreaker } from '../sdk/index.js'
import { isPermissionModeAware } from '../sdk/index.js'
import type { CanvasToolSchema } from './canvas-mcp-server.js'
import type { SparkReasoningEffort } from '../sdk/reasoning-effort.js'
import {
  buildConversationHistory,
  buildMemoryExtractionRecentContext,
} from './conversation-summarizer.js'
import { SessionContinuityCoordinator } from './session-continuity-coordinator.js'
import { generateSessionTitle } from './session-title-generator.js'
import { MemoryRepository } from '@spark/storage'
import { MemorySearchRepository, ModelProfileRepository } from '@spark/storage'
import { TurnPerfRepository } from '@spark/storage'
import { MemoryEntityRepository } from '@spark/storage'
import { MemoryWriterService } from './memory/memory-writer.service.js'
import { MemoryReaderService } from './memory/memory-reader.service.js'
import { MemoryStoreService } from './memory/memory-store.service.js'
import { ModelService } from './model.service.js'
import { ModelRouterService } from './model-router.service.js'
import { EmbeddingService } from './memory/embedding.service.js'
import { MemorySearchService } from './memory/memory-search.service.js'
import { MemoryEvolutionService } from './memory/memory-evolution.service.js'
import { MemoryConsolidationService } from './memory/memory-consolidation.service.js'
import { SPARK_MEDIA_TOOL_NAMES } from './media/media-mcp-contract.js'
import {
  AgentEventPersistenceError,
  SessionEventSequencer,
  persistAndPublishAgentEvent,
  persistAndPublishAgentEvents,
} from './session-event-sequencer.js'
import {
  createLogger,
  resolveModelContextWindowForProvider,
  resolveSoftContextLimitForWindow,
} from '@spark/shared'

export { buildMediaGenerationSystemPrompt } from './media/media-mcp-contract.js'

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
  scope:
    | 'provider'
    | 'agent'
    | 'team'
    | 'skill'
    | 'mcp'
    | 'workflow'
    | 'rule'
    | 'prompt'
    | 'scheduled-task'
    | 'sub-app',
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
// AgentAdapterKind 类型定义迁出至 ./session-resume.ts（D-13 拆分）
// ActiveExecution 类型定义迁出至 ../sdk/engine-executor.ts（P1-W1 引擎接口化）
// createCodexExecutorForConfig 迁出至 ./session/engine-registry.ts（P1-W1-D5 引擎注册表）

/** Chat-only Codex consumers use direct HTTP and cannot consume local MCP bridges. */
export function isOpenAiOnlyCodexConsumer(args: {
  isCodex: boolean
  isLocalCli: boolean
  providerType: string
  codexApiKind?: 'chat' | 'responses' | undefined
}): boolean {
  return args.isCodex && !args.isLocalCli && args.codexApiKind === 'chat'
}

interface FirstTurnTitleContext {
  providerType: string
  apiKey: string
  apiEndpoint?: string
  model: string
  userMessage: string
}
/** 首轮标题精炼失败后的补偿重试：后续 turn 完成时最多再尝试的次数。 */
const TITLE_REFINEMENT_MAX_RETRIES = 2
interface PendingTitleRefinement {
  ctx: FirstTurnTitleContext & { assistantMessage: string }
  retries: number
}
interface TryStartSDKTurnOptions extends UserMessagePresentation {
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
  /** 当前 turn 附带的只读会话参考，沿执行链传给 user_message 事件。 */
  sessionReferences?: SessionReferenceInput[]
  /** 当前 Host turn 的 prompt / MCP / cache / TTFT 增量观测器。 */
  runtimeMetrics?: TurnRuntimeMetricsTracker
  /** SessionService already persisted this turn's user_message before engine preparation. */
  userMessageAlreadyPersisted?: boolean
}
type PendingTurn = UserMessagePresentation & {
  turnId: string
  message: string
  enqueuedAt: string
  attachments?: SessionAttachment[]
  sessionReferences?: SessionReferenceInput[]
  runtimePatch?: SessionRuntimePatch
  skillId?: string
  skillParams?: Record<string, unknown>
  /** 团队模式：用户通过 @ 指定的直接处理 Agent ID（mention routing） */
  mentionAgentId?: string
  /** 内部续跑标记：只用于用户新消息/停止时从队列移除，不改变隐藏消息展示策略。 */
  isTeamDispatchAutoContinuation?: boolean
}

type SendTurnParams = UserMessagePresentation & {
  sessionId: string
  message: string
  providerProfileId?: string
  modelId?: string | null
  agentId?: string
  skillIds?: string[]
  agentAdapter?: AgentAdapterKind
  permissionMode?: SessionPermissionMode
  chatMode?: SessionChatMode
  reasoningEffort?: SparkReasoningEffort
  cliSparkOverride?: CliSparkOverride | null
  skillId?: string
  skillParams?: Record<string, unknown>
  attachments?: SessionAttachment[]
  sessionReferences?: SessionReferenceInput[]
  teamConfig?: TeamModeConfig
  mentionAgentId?: string
  interruptActive?: boolean
  /** 仅供同进程诊断调用；不会进入持久化 turn 队列。 */
  invocationObserver?: (snapshot: SDKInvocationSnapshot) => void
}

const RECOVERY_SESSION_LIMIT = 10_000
/**
 * 同时运行的会话执行器数量默认上限。
 *
 * 每个执行器 = 一个 Claude SDK query 或 Codex CLI 子进程，吃内存和文件句柄。
 * 6 覆盖「主任务 + 几个并行子任务/团队协作」的常见场景，对开发机不构成压力。
 */
const DEFAULT_MAX_CONCURRENT_SESSIONS = 6
// HISTORY_CONTEXT_* 常量与对话历史相关纯函数已迁出至 ./session-history-helpers.ts（D-13）。
const TERMINAL_AGENT_STATUSES = new Set<string>(['idle', 'completed', 'cancelled', 'error'])

/**
 * Executor 事件只能写回当前仍由 session 持有的 turn。
 *
 * cancel() 通常只是向 SDK/子进程发出中断信号，旧 executor 仍可能把已经缓冲的
 * 事件回调出来。用 activeLoops 做所有权校验，再叠加已取消 turn 集合，避免旧 turn
 * 在 cancelled 之后把会话状态重新写回 running。
 */
export function shouldAcceptSessionExecutorEvent(params: {
  activeLoops: ReadonlyMap<string, unknown>
  cancelledTurnIds: ReadonlySet<string>
  sessionId: string
  turnId: string
  executor: unknown
}): boolean {
  if (params.cancelledTurnIds.has(params.turnId)) return false
  return params.activeLoops.get(params.sessionId) === params.executor
}
// ENABLE_CLAUDE_SDK_RESUME 从 ./session-resume.ts 导入（D-13 拆分）。
const UNATTENDED_AUTOMATION_SYSTEM_PROMPT = [
  '[Automation Execution]',
  'This turn is running as an unattended scheduled automation.',
  'Do not ask the user questions and do not call AskUserQuestion or request_user_input.',
  'Do not pause for approval or other interaction. If required context is missing, make the best reasonable assumption; if that would be unsafe, stop and return a concise blocker report instead of waiting.',
].join('\n')

// getSessionUsageFromPersistence / SessionUsageTotals 迁出至 ./session/session-commands.ts（P1-W3-S2）

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

/**
 * 单条排队用户消息注入迭代 prompt 的长度上限与一次迭代最多注入的条数。
 * 防止超长排队内容把迭代 prompt 撑爆（上下文预算保护），超出部分留待下一轮。
 */
const GOAL_SUPPLEMENTARY_MESSAGE_MAX_CHARS = 2000
const GOAL_SUPPLEMENTARY_MESSAGE_MAX_COUNT = 8

function truncateGoalSupplementaryMessage(message: string): string {
  const trimmed = message.trim()
  if (trimmed.length <= GOAL_SUPPLEMENTARY_MESSAGE_MAX_CHARS) return trimmed
  return `${trimmed.slice(0, GOAL_SUPPLEMENTARY_MESSAGE_MAX_CHARS)}…[truncated]`
}

function buildGoalIterationPrompt(
  goal: StoredSessionGoal,
  supplementaryUserMessages: string[] = [],
): string {
  const progress =
    goal.progressLog
      .slice(-8)
      .map((entry) => {
        const evidence =
          entry.evidence != null && entry.evidence.length > 0
            ? ` (evidence: ${entry.evidence.join('; ')})`
            : ''
        return `- #${entry.iteration} [${entry.phase}/${entry.status}] ${entry.summary}${evidence}${entry.nextStep ? ` Next: ${entry.nextStep}` : ''}`
      })
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
  const maxIterations = goal.budget.maxIterations ?? 12
  const iterationHeader = `Recent progress (iteration ${goal.progressLog.length + 1} of ${maxIterations}):`
  const lastError =
    goal.lastError != null && goal.lastError.length > 0
      ? ['', `Last recorded error (already accounted for, do not repeat it):\n${goal.lastError}`]
      : []
  // goal 运行期间用户插话不再无限排队：排队消息作为「补充指令」注入本轮迭代。
  // 语义上它们是对目标的补充/修正/追问，不重置 objective，冲突时以更新的消息为准。
  const supplementary =
    supplementaryUserMessages.length > 0
      ? [
          '',
          'User supplementary instructions received since the last iteration (newest last; treat as updates to the objective, not a reset):',
          ...supplementaryUserMessages.map((message) => `- ${message}`),
        ]
      : []
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
    `${iterationHeader}\n${progress}`,
    ...lastError,
    ...supplementary,
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

/** Desktop main-process provider for governed Computer Use tools. */
export interface ComputerUseMcpProvider {
  (
    sessionId: string,
    workspaceRootPath: string,
    context: {
      turnId: string
      providerProfileId: string
      modelId: string
      permissionMode: SessionPermissionMode
    },
  ): Promise<{
    server: import('../sdk/types.js').SDKMcpServerConfig
    allowedTools: string[]
    systemPrompt: string
  } | null>
  /**
   * 轻量清理：仅撤销本 turn 的 MCP HTTP grant 与快照会话，**不取消**正在运行的
   * Computer Use 桌面任务。在每个 agent turn 结束时调用——任务生命周期完全交由
   * agent 自行管理（主动 stop 或用户 ESC 兜底），不再因 turn 边界被粗暴取消。
   */
  revokeSession?(sessionId: string): void
  /**
   * 真正停止该 agent 会话拥有的 Computer Use 桌面任务（stopOwnedSessions）。
   * 仅在会话被彻底销毁（clearSessionMemory）或用户显式 cancelTurn 时调用。
   */
  stopOwnedSessions?(sessionId: string): void
}

export class SessionService {
  /**
   * Turn 所有权状态的唯一管理者（W2-D1 收编）：activeLoops / runningTurnIds /
   * startingSessions / startingTurnIds / cancelledTurnIds / activeExecutionPromises
   * 六集合全部私有于 registry，本类经窄方法操作 —— 不变式见 turn-registry.ts。
   */
  private readonly turnRegistry = new TurnRegistry()
  private disposing = false
  private disposePromise: Promise<void> | null = null
  private pendingTurns = new Map<string, PendingTurn[]>()
  /** 画布 Agent MCP server 提供器（由主进程注入） */
  private canvasMcpProvider: CanvasMcpProvider | null = null
  /** 会话引擎级 worktree 状态变化回调（主进程注入，用于 UI 推流） */
  private sessionWorktreeChangedHandler?:
    | ((sessionId: string, worktree: SessionRuntimeWorktreeState | null) => void)
    | undefined
  /** 惰性创建的会话 worktree 状态服务（读写 metadata + git 校验） */
  private worktreeStateService: SessionWorktreeStateService | null = null
  /** checkpoint / 事件清理管理器（惰性创建，P1-W3-S3 迁出至 ./session/checkpoint.ts） */
  private checkpointManager: SessionCheckpointManager | null = null
  /** 会话 CRUD / 引用 / fork 控制器（惰性创建，P1-W3-S4 迁出至 ./session/session-crud.ts） */
  private crudController: SessionCrudController | null = null
  /** MCP 工具面装配器（惰性创建，P1-W3-S5 迁出至 ./session/session-mcp-tooling.ts） */
  private mcpTooling: SessionMcpTooling | null = null
  /** 应用内可见浏览器 MCP server 提供器（由桌面主进程注入） */
  private browserAutomationMcpProvider: BrowserAutomationMcpProvider | null = null
  /** 受治理的 Computer Use MCP server 提供器（由桌面主进程注入） */
  private computerUseMcpProvider: ComputerUseMcpProvider | null = null
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
  /**
   * 全局并发运行上限：同时执行的会话执行器（Claude SDK query / Codex CLI 子进程）数量。
   *
   * 每个执行器是一个 SDK query 或 CLI 子进程，吃内存 + 文件句柄。没有上限时用户连开十几个
   * 会话就能把机器打爆，且没有任何降级提示。超限的 turn 留在各 session 自己的队列里，
   * 等任意一个执行器结束（continueGoalOrQueue）时全局重新调度。
   *
   * 默认 6：覆盖「主任务 + 几个并行子任务/团队协作」的常见场景，对开发机不构成压力。
   * 可通过构造参数覆盖。
   */
  private readonly maxConcurrentSessions: number = DEFAULT_MAX_CONCURRENT_SESSIONS
  /** 结构化问答独立闸门：SDK 流提前结束时仍保持，直到用户回答或明确关闭。 */
  private readonly pendingUserQuestionGate = new SessionQuestionGate()
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
  /**
   * 首轮 LLM 标题精炼失败（思考模型 token 耗尽、网络抖动等）后保留的重试上下文。
   * 后续 turn 完成时若标题仍是临时形态（首条消息截断/默认名）自动重试，
   * 成功、用户手动改名、达到重试上限或会话删除时清除。
   */
  private readonly pendingTitleRefinements = new Map<string, PendingTitleRefinement>()
  /** 引擎注册表（P1-W1-D5）：kind → 执行器构造 + 能力声明；第三引擎接入只需 register。 */
  private readonly engineRegistry = createDefaultEngineRegistry()
  private readonly usageLedger: SessionUsageLedger
  private iterationOverrides = new Map<string, number>() // sessionId → per-session max turn iterations override
  private readonly commandController: SessionCommandController
  private readonly resumeGate = new ResumeGateManager()
  private readonly mcpService: McpService
  private teamDispatchService: TeamDispatchService | null = null
  /** Host 已终止但成员仍在收尾时，延后到会话所有执行都退出后再落库的真实终态。 */
  private readonly deferredHostTerminalStatus = new Map<string, AgentStatusValue>()
  private readonly teamMcpToolNames = new WeakMap<object, ReadonlySet<string>>()
  private readonly codexRuntimeMcpResources = new CodexRuntimeMcpResourceCoordinator()
  /** sessionId → the host turn whose dispatch budget was exhausted. */
  private readonly teamDispatchBudgetExhaustedTurns = new Map<string, string>()
  /** Bounds one budget-exhaustion continuation chain without imposing a user-visible turn limit. */
  private readonly teamDispatchAutoContinuationTracker = new TeamDispatchAutoContinuationTracker()
  /** FR-0b 修复（审查 B-1）：turnId → 该 turn 创建的 codex HTTP 桥接 handle；turn 结束统一 close 防 leak。 */
  private readonly teamMcpHandlesByTurn = new Map<string, Set<TeamMcpBridgeHandle>>()
  private readonly pluginRuntimeMcpHandlesByTurn = new Map<string, Set<PluginRuntimeMcpHandle>>()
  /** sessionId:turnId → Host 与所有成员共享的文件变更路径键，避免同轮重复归因。 */
  private readonly fileChangeKeysByTurn = new Map<string, Set<string>>()
  private readonly platformBridge: PlatformBridgeService
  private pluginManager: PluginManager | null = null
  private pluginManagerInitialization: Promise<void> | null = null
  private pluginRuntimeBroker: RuntimeBroker | null = null
  private pluginRuntimeMcpBridge: PluginRuntimeMcpBridge | null = null
  /**
   * 跨 turn 复用的记忆检索栈（lazy 单例）。
   * 缓存 EmbeddingService 的 unavailableUntil 负缓存 + MemorySearchRepository 的
   * vecLoaded/vecLoadFailed 状态，避免每 turn 重建导致负缓存失效（embedding provider
   * 宕机时每轮注入首检索重走 15s HTTP 超时，直接加在用户感知首字延迟上）。
   */
  private memorySearchRepo?: MemorySearchRepository
  private memoryEmbeddingService?: EmbeddingService
  private readonly continuityCoordinator: SessionContinuityCoordinator

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

  private markTeamDispatchBudgetExhausted(sessionId: string, turnId: string): void {
    // The callback is attached only to the Host's team MCP server. Keep the
    // running-turn check anyway so a late member callback cannot revive a
    // cancelled/replaced session turn.
    if (this.turnRegistry.runningTurnId(sessionId) !== turnId) return
    this.teamDispatchBudgetExhaustedTurns.set(sessionId, turnId)
  }

  private resetTeamDispatchAutoContinuation(sessionId: string): void {
    this.teamDispatchBudgetExhaustedTurns.delete(sessionId)
    this.teamDispatchAutoContinuationTracker.reset(sessionId)
  }

  /** Start a hidden Host turn after the previous Host turn has released all resources. */
  private async continueAfterTeamDispatchBudget(
    sessionId: string,
    exhaustedTurnId: string,
  ): Promise<void> {
    if (this.teamDispatchBudgetExhaustedTurns.get(sessionId) !== exhaustedTurnId) return
    this.teamDispatchBudgetExhaustedTurns.delete(sessionId)

    if (this.disposing) {
      this.resetTeamDispatchAutoContinuation(sessionId)
      return
    }

    // A continuation must never jump over an approval or a question that the
    // current Host turn has left for the user to resolve.
    if (
      this.pendingPlanApprovals.has(sessionId) ||
      this.pendingUserQuestionGate.isBlocked(sessionId)
    ) {
      this.resetTeamDispatchAutoContinuation(sessionId)
      this.emitQueueChanged(sessionId)
      return
    }

    // A visible user turn already waiting in FIFO order takes precedence over
    // an internal continuation. The user can then decide how to proceed.
    if ((this.pendingTurns.get(sessionId)?.length ?? 0) > 0) {
      this.resetTeamDispatchAutoContinuation(sessionId)
      await this.continueGoalOrQueue(sessionId)
      return
    }

    const attempt = this.teamDispatchAutoContinuationTracker.claim(sessionId)
    if (attempt == null) {
      log.warn('team dispatch auto-continuation safety valve reached', {
        sessionId,
      })
      this.resetTeamDispatchAutoContinuation(sessionId)
      await this.continueGoalOrQueue(sessionId)
      return
    }

    const continuationTurnId = crypto.randomUUID()
    log.info('starting hidden team dispatch continuation turn', {
      sessionId,
      exhaustedTurnId,
      continuationTurnId,
      attempt,
    })
    try {
      await this.startTurn(
        sessionId,
        continuationTurnId,
        TEAM_DISPATCH_AUTO_CONTINUATION_PROMPT,
        TEAM_DISPATCH_AUTO_CONTINUATION_PRESENTATION,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        true,
      )
    } catch (error) {
      log.warn('team dispatch auto-continuation failed to start', {
        sessionId,
        continuationTurnId,
        error: error instanceof Error ? error.message : String(error),
      })
      this.resetTeamDispatchAutoContinuation(sessionId)
      if (!this.hasActiveSessionExecution(sessionId)) await this.continueGoalOrQueue(sessionId)
    }
  }

  private getTurnFileChangeKeys(sessionId: string, turnId: string): Set<string> {
    const key = `${sessionId}:${turnId}`
    const existing = this.fileChangeKeysByTurn.get(key)
    if (existing != null) return existing
    const created = new Set<string>()
    this.fileChangeKeysByTurn.set(key, created)
    return created
  }

  private clearTurnFileChangeKeys(sessionId: string, turnId: string): void {
    this.fileChangeKeysByTurn.delete(`${sessionId}:${turnId}`)
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

  /** 惰性创建的会话 worktree 状态服务（供 spark_session 工具与运行时检测共用）。 */
  private getWorktreeStateService(): SessionWorktreeStateService {
    if (this.worktreeStateService == null) {
      this.worktreeStateService = new SessionWorktreeStateService(this.db)
    }
    return this.worktreeStateService
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
    this.commandController = new SessionCommandController(this.db, this)
    this.usageLedger = new SessionUsageLedger(this.db)
    this.platformBridge = new PlatformBridgeService()
    this.continuityCoordinator = new SessionContinuityCoordinator(
      db,
      (sessionId, turnId, event, eventRepo) =>
        this.emitAndPersist(sessionId, turnId, event, eventRepo),
      (sessionId) => this.activeChatModelBySession.get(sessionId) ?? null,
    )
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

  /**
   * 注入会话引擎级 worktree 状态变化回调（主进程接 UI 推流：
   * pushStreamEvent('stream:session:worktree-changed')）。
   */
  setSessionWorktreeChangedHandler(
    handler: ((sessionId: string, worktree: SessionRuntimeWorktreeState | null) => void) | null,
  ): void {
    this.sessionWorktreeChangedHandler = handler ?? undefined
  }

  /** 注入应用内可见浏览器 MCP provider（主进程持有 BrowserWindow 桥后调用一次） */
  setBrowserAutomationMcpProvider(provider: BrowserAutomationMcpProvider | null): void {
    this.browserAutomationMcpProvider = provider
  }

  /** 注入受治理的 Computer Use MCP provider（主进程启动后调用一次）。 */
  setComputerUseMcpProvider(provider: ComputerUseMcpProvider | null): void {
    this.computerUseMcpProvider = provider
  }

  /** Plugin lifecycle is the authority for built-in runtimes exposed to Agent tools. */
  setPluginManager(manager: PluginManager | null): void {
    this.pluginManager = manager
    this.pluginManagerInitialization = null
  }

  private revokeComputerUseSession(sessionId: string): void {
    try {
      this.computerUseMcpProvider?.revokeSession?.(sessionId)
    } catch (error) {
      log.warn('failed to revoke Computer Use session capability', {
        sessionId,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  /**
   * 真正停止该 agent 会话拥有的 Computer Use 桌面任务。仅在会话被彻底销毁
   * （clearSessionMemory）或用户显式 cancelTurn 时调用；普通 turn 结束不会触发，
   * 以保证长任务的生命周期完全由 agent 决定。
   */
  private stopComputerUseSession(sessionId: string): void {
    this.revokeComputerUseSession(sessionId)
    try {
      this.computerUseMcpProvider?.stopOwnedSessions?.(sessionId)
    } catch (error) {
      log.warn('failed to stop Computer Use sessions', {
        sessionId,
        error: error instanceof Error ? error.message : String(error),
      })
    }
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

  /** Resolves the current turn's real provider/model for the governed desktop decision loop. */
  async resolveComputerDecisionModel(sessionId: string): Promise<ComputerDecisionModelConfig> {
    const session = new SessionRepository(this.db).get(sessionId)
    if (session == null) throw new Error('Computer decision session does not exist')
    const active = this.activeChatModelBySession.get(sessionId)
    const providerId = active?.providerId ?? session.provider_profile_id
    if (providerId == null || providerId.trim().length === 0) {
      throw new Error('Computer decision provider is not configured')
    }
    const providers = new ProviderProfileRepository(this.db)
    const selected = providers.get(providerId)
    if (selected == null) throw new Error('Computer decision provider does not exist')
    const candidates = [selected, providers.getDefault(), ...providers.listAll()].filter(
      (provider, index, values): provider is ProviderProfileRow =>
        provider != null &&
        provider.enabled === 1 &&
        !isBuiltInLocalCliProvider(provider) &&
        values.findIndex((candidate) => candidate?.id === provider.id) === index,
    )
    const orderedCandidates = [
      selected,
      ...candidates
        .filter((provider) => provider.id !== selected.id && isComputerVisionCandidate(provider))
        .sort(
          (left, right) => computerVisionCandidateScore(right) - computerVisionCandidateScore(left),
        ),
    ]
    let lastError: unknown
    const resolved: ComputerDecisionModelConfig[] = []
    for (const provider of orderedCandidates) {
      try {
        const providerConfig = JSON.parse(provider.config_json) as {
          defaultModel?: unknown
          model?: unknown
        }
        const fallbackModel =
          typeof providerConfig.defaultModel === 'string'
            ? providerConfig.defaultModel
            : typeof providerConfig.model === 'string'
              ? providerConfig.model
              : ''
        const selectedModel =
          provider.id === selected.id ? (active?.model ?? session.model_id) : undefined
        resolved.push(
          buildComputerDecisionModelConfig({
            provider,
            model: selectedModel ?? fallbackModel,
            apiKey: await resolveProviderApiKey(provider),
          }),
        )
        if (resolved.length >= 3) break
      } catch (error) {
        lastError = error
      }
    }
    const primary = resolved[0]
    if (primary != null) {
      const fallbackModels = resolved.slice(1)
      return fallbackModels.length === 0 ? primary : { ...primary, fallbackModels }
    }
    throw lastError ?? new Error('No vision-capable Computer decision provider is configured')
  }

  /**
   * 从 sessionId 解析该会话生效的记忆 scope 集合（user + project + agent）。
   * codex CLI / claude CLI 的 stdio spark_memory 子进程通过 bridge RPC 回到主进程，
   * 这里复用与 claude SDK in-process MCP 完全相同的 scope 构造逻辑，保证两条路径
   * 的 agent 工具看到的记忆范围一致。
   */
  private resolveMemoryScopesForSession(
    sessionId: string,
    agentIdOverride?: string,
  ): MemoryScopeFilter[] {
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
        const agentId = agentIdOverride?.trim() || session.agent_id
        if (agentId != null && agentId.length > 0) {
          scopes.push({ scope: 'agent', scopeRef: agentId })
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
    agentId?: string
    query: string
    type?: 'user' | 'feedback' | 'project' | 'reference'
    limit?: number
  }): Promise<{
    hits: Array<{ id: string; name: string; type: string; description: string }>
    related: Array<{ id: string; name: string; type: string; description: string }>
    degraded?: boolean
  }> {
    const scopes = this.resolveMemoryScopesForSession(params.sessionId, params.agentId)
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
      if (this.turnRegistry.hasActiveSession(session.id)) continue

      // 断流轮按轮补齐终态（含挂起的 delta 段落定），多轮断流一次修完。
      appendInterruptedTurnEventsForSession(eventRepo, session.id)

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

  /**
   * 僵尸 running 会话的懒恢复：sessions.status='running' 但主进程已无该会话的
   * 任何执行（host executor / starting 过渡 / team dispatch 全部不在）。典型成因：
   * 应用退出或崩溃硬杀执行器、执行器异常死亡、以及启动时 recoverInterruptedSessions
   * 未覆盖到的会话。不修的话渲染端每次打开该会话都显示「运行中」，重放出的消息
   * 永远停留在 streaming（思考/工具日志持续转圈，重开会话也无法恢复）。
   * 在 history / queue / cancel 权威入口做幂等校验：补齐断流轮终态事件、状态落回
   * idle——数据一次治愈、对所有视图生效。判定源与 reconcileSessionExecutionStatus
   * 完全一致（queueSnapshot().running），不会误伤正在执行的会话。
   */
  private reconcileZombieRunningSession(sessionId: string): {
    reconciled: boolean
    appendedTurns: number
  } {
    try {
      if (this.queueSnapshot(sessionId).running) return { reconciled: false, appendedTurns: 0 }
      const sessionRepo = new SessionRepository(this.db)
      const session = sessionRepo.get(sessionId)
      if (session == null || session.status !== 'running') {
        return { reconciled: false, appendedTurns: 0 }
      }
      const eventRepo = new EventRepository(this.db)
      const appended = appendInterruptedTurnEventsForSession(eventRepo, sessionId)
      sessionRepo.updateStatus(sessionId, 'idle')
      this.deferredHostTerminalStatus.delete(sessionId)
      this.emitQueueChanged(sessionId)
      log.info('reconciled zombie running session', {
        sessionId,
        appendedTurns: appended,
      })
      return { reconciled: true, appendedTurns: appended }
    } catch (err) {
      // 权威健康核对失败不能影响历史加载、队列查询或取消主流程。
      log.warn('failed to reconcile zombie running session', {
        sessionId,
        error: err instanceof Error ? err.message : String(err),
      })
      return { reconciled: false, appendedTurns: 0 }
    }
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
    chatMode?: SessionChatMode
    reasoningEffort?: SparkReasoningEffort
    debugMode?: boolean
    cliSparkOverride?: CliSparkOverride | null
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
    if (params.debugMode !== undefined) {
      sessionRepo.patchMetadata(row.id, { debugMode: params.debugMode })
    }
    if (params.cliSparkOverride !== undefined) {
      sessionRepo.patchMetadata(row.id, {
        cliSparkOverride: normalizeCliSparkOverride(params.cliSparkOverride),
      })
    }
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
    return this.commandController.executeCommand(params)
  }

  async executeCommandAsEvents(params: {
    sessionId: string
    message: string
    attachments?: SessionAttachment[]
    sessionReferences?: SessionReferenceInput[]
  }): Promise<{ isCommand: boolean; forwardToAgent?: boolean; started?: boolean }> {
    return this.commandController.executeCommandAsEvents(params)
  }

  listCommands(sessionId?: string): CommandListItem[] {
    return this.commandController.listCommands(sessionId)
  }

  /** 列出会话工作区项目技能目录扫描到的项目级技能（供 skill:list 附带返回）。 */
  listProjectSkills(sessionId: string): ProjectSkillSummaryItem[] {
    return this.commandController.listProjectSkills(sessionId)
  }

  // ── SessionCommandHost 窄回调（P1-W3-S2 命令系统迁出）───

  clearSessionEventSequencer(sessionId: string): void {
    this.eventSequencer.clear(sessionId)
  }

  reserveEventSeqs(sessionId: string, eventRepo: EventRepository, count: number): number {
    return this.eventSequencer.reserve(sessionId, eventRepo, count)
  }

  persistAndPublishCommandEvents(eventRepo: EventRepository, events: AgentEvent[]): void {
    persistAndPublishAgentEvents(eventRepo, events, this.onEvent)
  }

  notifySessionRenamed(sessionId: string, title: string): void {
    this.onSessionRenamed?.(sessionId, title)
  }

  getMcpStatusSummary(): Array<{
    id: string
    name: string
    enabled: boolean
    connected: boolean
    toolCount: number
    error?: string
  }> {
    return this.mcpService.listServers().map((server) => ({
      id: server.id,
      name: server.name,
      enabled: server.enabled,
      ...this.mcpService.getServerStatus(server.id),
    }))
  }

  hasActiveTurnLoop(sessionId: string): boolean {
    return this.turnRegistry.hasActiveSession(sessionId)
  }

  startCommandFollowUpTurn(params: {
    sessionId: string
    message: string
    attachments?: SessionAttachment[]
    skillId?: string
    skillParams?: Record<string, unknown>
  }): Promise<{ started: boolean }> {
    return this.sendTurn({
      ...COMMAND_FOLLOW_UP_TURN_PRESENTATION,
      sessionId: params.sessionId,
      message: params.message,
      ...(params.attachments != null ? { attachments: params.attachments } : {}),
      ...(params.skillId != null ? { skillId: params.skillId } : {}),
      ...(params.skillParams != null ? { skillParams: params.skillParams } : {}),
    })
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
    const { sessionId, message, skillId, skillParams, mentionAgentId, invocationObserver } = params
    const userMessagePresentation = pickUserMessagePresentation(params)
    const attachments = normalizeTurnAttachments(params.attachments)
    const runtimePatch = getRuntimePatch(params)
    const sessionReferences = params.sessionReferences?.slice(0, 10) ?? []
    const turnId = crypto.randomUUID()
    if (userMessagePresentation.userMessageVisibility !== 'hidden') {
      // A new visible user turn supersedes any pending internal continuation.
      this.resetTeamDispatchAutoContinuation(sessionId)
      this.removeQueuedTeamDispatchAutoContinuations(sessionId)
    }
    // 团队配置随 turn 提交时，写入 session.metadata.team（startTurn 以此为单一真相源，
    // 无需穿过排队路径）。
    if (params.teamConfig != null) {
      new SessionRepository(this.db).patchMetadata(sessionId, { team: params.teamConfig })
    }
    if (params.cliSparkOverride !== undefined) {
      new SessionRepository(this.db).patchMetadata(sessionId, {
        cliSparkOverride: normalizeCliSparkOverride(params.cliSparkOverride),
      })
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
      userMessagePresentation,
      sessionReferences.length > 0 ? sessionReferences : undefined,
    )
    const collaboration =
      sessionReferences.length > 0 ? new SessionCollaborationRepository(this.db) : null
    const turnRequestRepository = durable ? new TurnRequestRepository(this.db) : null
    // Reference attachment and durable acceptance form one database boundary.
    // A bad reference or a failed turn-request insert therefore leaves neither
    // a partial authorization nor an orphaned accepted turn behind.
    const persistTurn = () => {
      if (collaboration != null) {
        collaboration.attachReferencesInTransaction({
          references: sessionReferences.map((reference) => ({
            targetSessionId: sessionId,
            sourceSessionId: reference.sourceSessionId,
            ...(reference.snapshotSeq !== undefined ? { snapshotSeq: reference.snapshotSeq } : {}),
            actor: 'user' as const,
          })),
        })
      }
      if (turnRequestRepository != null) {
        const request = {
          id: turnId,
          sessionId,
          payloadJson: JSON.stringify(pendingTurn),
          createdAt: pendingTurn.enqueuedAt,
        }
        // A few lightweight SessionService tests provide a repository double
        // that predates createInTransaction; keep that double compatible while
        // the real repository remains atomic in production.
        if (typeof turnRequestRepository.createInTransaction === 'function') {
          turnRequestRepository.createInTransaction(request)
        } else {
          turnRequestRepository.create(request)
        }
      }
    }
    if (collaboration != null || turnRequestRepository != null) {
      const database = this.db as unknown as {
        raw?: { transaction?: (work: () => void) => () => void }
      }
      if (typeof database.raw?.transaction === 'function') database.raw.transaction(persistTurn)()
      else persistTurn()
    }
    const currentGoal = new GoalRepository(this.db).getCurrent(sessionId)
    // spark-loop 目标活跃时用户消息入队，由下一轮迭代排空注入（drainQueuedUserTurnsForGoalIteration）。
    // codex-native 目标由 codex 侧自驱循环，Spark 不泵迭代——用户消息按普通流程执行
    // （若恰有 turn 在跑会落入下方 hasActiveSessionExecution 的常规排队，turn 结束即排空）。
    const goalOwnsDispatch = currentGoal?.status === 'active' && currentGoal.mode === 'spark-loop'
    if (goalOwnsDispatch || this.pendingUserQuestionGate.isBlocked(sessionId)) {
      this.enqueueTurn(sessionId, pendingTurn)
      // goal 仍 active 但会话已无任何执行在跑（中断/异常释放后）：迭代 turn 这个
      // 排水泵已不存在，入队消息会永久滞留（表现为中断后发"继续"无响应）。
      // 入队后补一次泵：spark-loop 由 startGoalLoop 把刚入队的消息注入下一轮迭代；
      // goal 已失效时 continueGoalOrQueue 退化为普通队列排空。仅 goal 分支需要——
      // question gate 的解除路径自带起跑；starting 过渡态由 startTurn 收尾链接续。
      if (
        goalOwnsDispatch &&
        !this.pendingUserQuestionGate.isBlocked(sessionId) &&
        !this.hasActiveSessionExecution(sessionId) &&
        !this.turnRegistry.isSessionStarting(sessionId)
      ) {
        void this.continueGoalOrQueue(sessionId)
      }
      return { turnId, started: false }
    }

    if (this.hasActiveSessionExecution(sessionId)) {
      if (params.interruptActive === true) {
        // 显式中断当前 loop（与 sendQueuedTurnNow 同模式），让批准消息立即起跑，
        // 不再依赖上一个 plan turn 的 finally 兜底（时机不可控，会被用户感知为"卡住"）。
        const loop = this.turnRegistry.executorFor(sessionId)
        const eventRepo = new EventRepository(this.db)
        const interruptedTurnId =
          this.turnRegistry.runningTurnId(sessionId) ??
          getLatestTurnIdFromEvents(eventRepo, sessionId)
        this.turnRegistry.markTurnCancelled(interruptedTurnId)
        this.onApprovalCancel?.(sessionId)
        // 仅收本会话的 team dispatch（原为 cancelAll，会误伤其他会话的协作）
        this.teamDispatchService?.cancelBySession(sessionId)
        loop?.cancel()
        this.turnRegistry.forceRelease(sessionId, interruptedTurnId)
        this.emitAndPersist(
          sessionId,
          interruptedTurnId,
          createUserCancelledTurnEvent(sessionId, interruptedTurnId),
          eventRepo,
        )
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
        userMessagePresentation,
        runtimePatch,
        skillId,
        skillParams,
        attachments,
        mentionAgentId,
        invocationObserver,
        false,
        sessionReferences.length > 0 ? sessionReferences : undefined,
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
    userMessagePresentation?: UserMessagePresentation,
    runtimePatch?: SessionRuntimePatch,
    skillId?: string,
    skillParams?: Record<string, unknown>,
    attachments?: SessionAttachment[],
    mentionAgentId?: string,
    invocationObserver?: (snapshot: SDKInvocationSnapshot) => void,
    /** true = 派发额度续跑的内部 turn；进入队列时必须保留该标记。 */
    isTeamDispatchAutoContinuation = false,
    sessionReferences?: SessionReferenceInput[],
  ): Promise<void> {
    if (this.hasActiveSessionExecution(sessionId)) {
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
          userMessagePresentation,
          sessionReferences,
          isTeamDispatchAutoContinuation,
        ),
      )
      return
    }
    // 全局并发上限兜底：startNextQueuedTurn 已有检查，但 sendTurn（非 durable 路径）、
    // 命令 follow-up、goal 迭代等直接调 startTurn 的路径会绕过它。这里统一拦截，
    // 超限时入队等待槽位释放（continueGoalOrQueue → schedulePendingQueuesGlobally 会重新调度）。
    //
    // goal 迭代不受误伤：它在该 session 的 turn 刚结束（activeLoops 已删、释放一个槽位）
    // 后发起，此时全局数 = max-1，不会触发这个检查。
    const existingStartingTurnId = this.turnRegistry.getStartingTurnId(sessionId)
    const ownsExistingStartingTurn = existingStartingTurnId === turnId
    const inflightSessions =
      this.turnRegistry.inflightSessionCount() - (ownsExistingStartingTurn ? 1 : 0)
    if (inflightSessions >= this.maxConcurrentSessions) {
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
          userMessagePresentation,
          sessionReferences,
          isTeamDispatchAutoContinuation,
        ),
      )
      return
    }

    if (existingStartingTurnId != null && existingStartingTurnId !== turnId) {
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
          userMessagePresentation,
          sessionReferences,
          isTeamDispatchAutoContinuation,
        ),
      )
      return
    }
    const ownsStartingTurn = existingStartingTurnId == null
    if (ownsStartingTurn) {
      this.turnRegistry.beginStarting(sessionId, turnId)
    }

    try {
      await this.startTurnExecution(
        sessionId,
        turnId,
        message,
        runtimePatch,
        skillId,
        skillParams,
        attachments,
        mentionAgentId,
        invocationObserver,
        userMessagePresentation,
        sessionReferences,
      )
    } finally {
      if (ownsStartingTurn && this.turnRegistry.getStartingTurnId(sessionId) === turnId) {
        this.turnRegistry.finishStarting(sessionId, turnId)
        if (!this.turnRegistry.hasActiveSession(sessionId)) this.startNextQueuedTurn(sessionId)
      }
    }
  }

  private async startTurnExecution(
    sessionId: string,
    turnId: string,
    message: string,
    runtimePatch?: SessionRuntimePatch,
    skillId?: string,
    skillParams?: Record<string, unknown>,
    attachments?: SessionAttachment[],
    mentionAgentId?: string,
    invocationObserver?: (snapshot: SDKInvocationSnapshot) => void,
    userMessagePresentation?: UserMessagePresentation,
    sessionReferences?: SessionReferenceInput[],
  ): Promise<void> {
    const sessionRepo = new SessionRepository(this.db)
    const providerRepo = new ProviderProfileRepository(this.db)
    const eventRepo = new EventRepository(this.db)
    // 吞吐口径落库（turn_perf_metrics，每 turn 一行）：provider/model 在下方解析，
    // 回调触发（终态）时闭包变量已定值；写入失败不阻塞事件流（非致命）。
    // 显式 undefined 初始化：变量在模型定值处唯一一次覆盖（闭包在终态时读取）。
    let effectiveRuntimeModelId: string | undefined = undefined
    const runtimeMetrics = new TurnRuntimeMetricsTracker({
      emit: (metrics) => {
        this.emitAndPersist(
          sessionId,
          turnId,
          {
            id: crypto.randomUUID(),
            type: 'turn_runtime_metrics',
            sessionId,
            turnId,
            timestamp: new Date().toISOString(),
            seq: 0,
            metrics,
          },
          eventRepo,
        )
      },
      onFinalized: (summary) => {
        try {
          new TurnPerfRepository(this.db).recordFinal({
            sessionId,
            turnId,
            providerId: effectiveRuntimeProviderProfileId ?? 'unknown',
            modelId: effectiveRuntimeModelId ?? session.model_id ?? 'unknown',
            terminalStatus: summary.terminalStatus,
            ttftMs: summary.requestToFirstOutputMs,
            streamActiveMs: summary.streamActiveMs,
            turnDurationMs: summary.turnDurationMs,
            outputTokens: summary.outputTokens,
            outputTokensPerSecond: summary.outputTokensPerSecond,
          })
        } catch (err) {
          log.warn('failed to persist turn perf metrics', { sessionId, turnId, error: err })
        }
      },
    })

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
    // 团队 Host 的实际配置优先于会话里上一次单 Agent 的运行时快照；没有配置的字段再回落到会话值。
    const runtimeAgent =
      !isMentionTurn && sessionTeamConfig?.enabled === true
        ? (new AgentRepository(this.db).get(sessionTeamConfig.hostAgentId) ?? agent)
        : agent
    const workflow =
      runtimeAgent.workflowId != null
        ? new WorkflowRepository(this.db).get(runtimeAgent.workflowId)
        : null
    const workflowGraph = workflow != null ? normalizeWorkflowGraph(workflow.graph) : undefined
    const workflowMembers =
      workflowGraph != null ? this.resolveWorkflowMembers(workflowGraph, agent) : []
    const enabledWorkflowWorkerIds = new Set(workflowMembers.map((member) => member.id))
    // Provider / model：会话运行时是普通 turn 的唯一权威，保证 UI 当前选择与实际执行一致。
    // Agent 绑定只用于 @mention、团队 Host，或旧会话缺少 provider 时的兼容兜底。
    const explicitProviderProfileId = isMentionTurn
      ? undefined
      : runtimePatch?.providerProfileId?.trim()
    const sessionProviderProfileId = session.provider_profile_id?.trim()
    const runtimeAgentSelectionTakesPrecedence =
      isMentionTurn || sessionTeamConfig?.enabled === true
    const runtimeAgentProviderProfileId = runtimeAgent.providerProfileId?.trim()
    const runtimeAgentProviderIsStale =
      !isMentionTurn &&
      (runtimeAgentSelectionTakesPrecedence || !sessionProviderProfileId) &&
      runtimeAgentProviderProfileId != null &&
      runtimeAgentProviderProfileId.length > 0 &&
      providerRepo.get(runtimeAgentProviderProfileId) == null
    const availableRuntimeAgentProviderProfileId = runtimeAgentProviderIsStale
      ? undefined
      : runtimeAgentProviderProfileId
    if (runtimeAgentProviderIsStale) {
      log.warn('agent provider profile is missing; falling back to session provider', {
        sessionId,
        agentId: runtimeAgent.id,
        providerProfileId: runtimeAgentProviderProfileId,
        fallbackProviderProfileId: session.provider_profile_id,
      })
    }
    const effectiveProviderProfileId =
      explicitProviderProfileId ||
      (runtimeAgentSelectionTakesPrecedence
        ? availableRuntimeAgentProviderProfileId || sessionProviderProfileId
        : sessionProviderProfileId || availableRuntimeAgentProviderProfileId)
    if (effectiveProviderProfileId == null) {
      throw new Error(`Session ${sessionId} has no provider profile`)
    }

    const existingEventCount = eventRepo.countBySession(sessionId)
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
    // W1.1b：history 加载延后到 sdkResume 判定后，避免 SDK resume 路径下重复摘要写入。
    const shouldGenerateSessionTitle =
      existingEventCount === 0 &&
      userMessagePresentation?.userMessageVisibility !== 'hidden' &&
      shouldDeriveSessionTitle(session.title)
    if (shouldGenerateSessionTitle) {
      const derivedTitle = deriveSessionTitle(message)
      sessionRepo.updateTitle(sessionId, derivedTitle)
      this.onSessionRenamed?.(sessionId, derivedTitle)
    }
    const authoritativeUserMessage = createAuthoritativeUserMessageEvent({
      sessionId,
      turnId,
      message,
      ...(attachments != null ? { attachments } : {}),
      ...(sessionReferences != null ? { sessionReferences } : {}),
      ...(userMessagePresentation != null ? { presentation: userMessagePresentation } : {}),
    })
    const userMessageAlreadyPersisted = authoritativeUserMessage != null
    if (authoritativeUserMessage != null) {
      this.emitAndPersist(sessionId, turnId, authoritativeUserMessage, eventRepo)
    }
    let effectiveRuntimeProviderProfileId = effectiveProviderProfileId
    const modelProfilesForRouting = new ModelProfileRepository(this.db).list()
    const providersForRouting = providerRowsForModelRouter(providerRepo.listAll())
    const explicitModelId = isMentionTurn ? undefined : runtimePatch?.modelId?.trim()
    const requestedModel =
      explicitModelId ||
      (runtimeAgentSelectionTakesPrecedence
        ? runtimeAgent.modelId?.trim() || session.model_id
        : sessionProviderProfileId
          ? session.model_id?.trim()
          : runtimeAgentProviderIsStale
            ? session.model_id
            : runtimeAgent.modelId?.trim() || session.model_id)
    const loadProvider = (providerProfileId: string) => {
      const row = providerRepo.get(providerProfileId)
      if (row == null) {
        throw new Error(`Provider profile not found: ${providerProfileId}`)
      }
      if (row.enabled === 0) {
        throw new Error(`Provider profile is disabled: ${providerProfileId}`)
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
      modelContextWindows?: Record<string, number>
      haikuModel?: string
      sonnetModel?: string
      opusModel?: string
      /** SDK resume 灰度开关（默认关）：显式 true 时允许第三方 Anthropic 兼容端点续会话。 */
      sdkResumeOptIn?: boolean
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
        // W1.1b：history 加载延后到 sdkResume 判定后，此处用 eventCount 估算。
        // 系数 100 token/event 是保守上界（typical assistant message 200-500 token，
        // user message 50-200）。消息本身统一走 shared tokenizer，避免中文低估；这里取保守值
        // 避免 longContext 路径（128k threshold）漏判。
        estimatedTokens: Math.max(estimateTokens(message), existingEventCount * 100),
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
      const configuredAgentModel =
        (isMentionTurn
          ? agent.modelId
          : runtimeAgentProviderIsStale ||
              (!runtimeAgentSelectionTakesPrecedence && sessionProviderProfileId)
            ? null
            : runtimeAgent.modelId
        )?.trim() ?? ''
      const sessionModel = session.model_id?.trim() ?? ''
      const configuredModels = Array.isArray(config.modelIds)
        ? config.modelIds.filter((item): item is string => typeof item === 'string')
        : []
      const inheritedModel =
        sessionModel.length > 0 &&
        (configuredModels.length === 0 || configuredModels.includes(sessionModel))
          ? sessionModel
          : ''
      model = isLocalCli
        ? getLocalCliDefaultModel(provider)
        : explicitModelId ||
          (runtimeAgentSelectionTakesPrecedence
            ? configuredAgentModel || inheritedModel
            : inheritedModel || configuredAgentModel) ||
          config.defaultModel ||
          config.model ||
          ''
      if (model.length === 0) {
        throw new Error(`Provider ${provider.id} has no default model configured`)
      }
    }
    const cliProvider = provider
    const activeCliSparkOverride = isLocalCli
      ? getCliSparkOverrideFromMetadata(session.metadata_json)
      : null
    let apiKey = ''
    if (activeCliSparkOverride != null) {
      const overrideProvider = loadProvider(activeCliSparkOverride.providerProfileId)
      const overrideConfig = JSON.parse(overrideProvider.config_json) as typeof config
      if (
        isBuiltInLocalCliProvider(overrideProvider) ||
        getAutoRouterAdapterForProviderId(overrideProvider.id) != null ||
        !isCliSparkOverrideCompatible(cliProvider, overrideProvider, overrideConfig)
      ) {
        throw new Error(
          `Provider ${overrideProvider.id} is not compatible with local CLI ${cliProvider.id}`,
        )
      }
      const validModels = getProviderModelIds(overrideProvider.config_json)
      if (!validModels.includes(activeCliSparkOverride.modelId)) {
        throw new Error(
          `Model ${activeCliSparkOverride.modelId} is not configured for provider ${overrideProvider.id}`,
        )
      }
      if (overrideProvider.keystore_ref == null) {
        throw new Error(`Provider ${overrideProvider.id} has no keystore ref`)
      }
      apiKey = await resolveProviderApiKey(overrideProvider)
      if (apiKey.length === 0) {
        throw new Error(`API key not found for provider ${overrideProvider.id}`)
      }
      provider = overrideProvider
      config = overrideConfig
      model = activeCliSparkOverride.modelId
      effectiveRuntimeProviderProfileId = overrideProvider.id
    } else if (!isLocalCli) {
      if (provider.keystore_ref == null) {
        throw new Error(`Provider ${provider.id} has no keystore ref`)
      }
      apiKey = await resolveProviderApiKey(provider)
      if (apiKey.length === 0) {
        throw new Error(`API key not found for provider ${provider.id}`)
      }
    }

    // 峰谷定时禁用硬校验：provider/model 至此定值（普通 / Auto Router / CLI override 分支均覆盖）。
    assertModelNotScheduledBlocked(provider.config_json, model)

    // 记忆抽取 settings 未配时回退：本 turn 该会话 / @mention agent 实际生效的对话模型。
    // team 主持 agent 走 session 默认值；@mention 切到成员 agent 时切到成员自己的
    // providerProfileId + agent.modelId。
    this.activeChatModelBySession.set(sessionId, { providerId: provider.id, model })
    // 供终态性能落库回调（tracker onFinalized）读取；provider/model 至此均已定值。
    effectiveRuntimeModelId = model

    const agentAdapter = getAgentAdapterFromSession(
      isMentionTurn
        ? (agent.agentAdapter ?? session.agent_adapter)
        : sessionTeamConfig?.enabled === true
          ? runtimeAgent.agentAdapter
          : session.agent_adapter,
      session.chat_mode,
      provider.provider_type,
    )
    const adapterKind = resolveEngineKind(agentAdapter)
    const resumeProviderProfileId =
      activeCliSparkOverride != null
        ? `${cliProvider.id}::${effectiveRuntimeProviderProfileId}`
        : effectiveRuntimeProviderProfileId
    // 非 mention turn 保持现有 hash（向后兼容续会话）；
    // mention turn 把被 @ 的 agent.id 加入 hash，避免与 Host SDK session 冲突且让重复 @ 同一 member 可续会话。
    const stableSdkSessionId = isMentionTurn
      ? this.resumeGate.makeRuntimeSessionId(
          sessionId,
          resumeProviderProfileId,
          model,
          agentAdapter,
          `mention:${agent.id}`,
        )
      : this.resumeGate.makeRuntimeSessionId(
          sessionId,
          resumeProviderProfileId,
          model,
          agentAdapter,
        )
    const codexNativeThreadBindingKey = scopeCodexNativeThreadBindingKey(
      this.resumeGate.makeRuntimeSessionId(
        sessionId,
        resumeProviderProfileId,
        model,
        agentAdapter,
        buildCodexNativeThreadIdentityScope({ agentId: agent.id, isMentionTurn }),
      ),
      readCodexNativeThreadGeneration(session.metadata_json),
    )
    const sdkResumeSafe = this.resumeGate.isSafe({
      providerType: provider.provider_type,
      model,
      agentAdapter,
      ...(config.sdkResumeOptIn === true ? { providerOptIn: true } : {}),
      ...(config.apiEndpoint != null ? { apiEndpoint: config.apiEndpoint } : {}),
    })
    const previousPromptSnapshot = getLatestMatchingTurnPromptSnapshot(eventRepo, sessionId, {
      adapterKind,
      model,
      providerProfileId: effectiveRuntimeProviderProfileId,
      sdkSessionId: stableSdkSessionId,
    })
    const canResumeSdkSession = sdkResumeSafe && previousPromptSnapshot != null
    const usePersistentCodexAppServer = shouldUsePersistentCodexAppServer({
      enabled: isPersistentCodexRuntimeEnabled(),
      adapterKind,
      useLocalConfig: isLocalCli,
      ...(config.codexApiKind != null ? { codexApiKind: config.codexApiKind } : {}),
      hasImageAttachments: (attachments ?? []).some((attachment) => attachment.type === 'image'),
    })
    const codexRuntimeLeaseKey = `host:${sessionId}`
    const sdkSessionId = sdkResumeSafe
      ? stableSdkSessionId
      : this.resumeGate.makeRuntimeSessionId(
          sessionId,
          resumeProviderProfileId,
          model,
          agentAdapter,
          isMentionTurn ? `mention:${agent.id}:${turnId}` : turnId,
        )
    const contextWindowTokens = resolveModelContextWindowForProvider(
      model,
      config.supportsMillionContext === true,
      config.contextWindow,
      config.modelContextWindows,
    )
    const storedContinuitySummary = new SessionSummaryRepository(this.db).getLatest(sessionId)
    // Provider 原生 resume 管理逐轮历史；Spark 的结构化胶囊 + 精确近期历史只服务
    // fresh 路径或 resume 失败恢复。成功 resume 时不再重复注入近期对话。
    const conversationContext = buildConversationHistory(eventRepo, sessionId, {
      agentNameById,
      excludeTurnId: turnId,
      historyTokenBudget: computeHistoryTokenBudget(contextWindowTokens),
      entryTokenBudget: computeHistoryEntryTokenBudget(contextWindowTokens),
      ...(storedContinuitySummary != null
        ? {
            continuitySummary: {
              summaryText: storedContinuitySummary.summary_text,
              summarizedToSeq: storedContinuitySummary.summarized_to_seq,
            },
          }
        : {}),
      ...(canResumeSdkSession || usePersistentCodexAppServer ? { deferForSdkResume: true } : {}),
    })
    const conversationHistoryPrompt = conversationContext.prompt
    const resumeRecoveryHistoryPrompt = conversationContext.recoveryPrompt
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
        agentId: runtimeAgent.id,
      },
      explicitSkillPrompt,
      {
        agentSkillIds: runtimePatch?.skillIds ?? runtimeAgent.skillIds,
        agentDisabledSkillIds: runtimeAgent.disabledSkillIds,
        ...(runtimePatch?.skillIds !== undefined ? { replaceAgentSkills: true } : {}),
      },
    )
    runtimeMetrics.markMcpConfigurationStarted()
    const mediaGenerationContext =
      await this.getMcpTooling().resolveMediaGenerationContext(workspaceRootPath)
    const imageGenerationContext =
      mediaGenerationContext == null
        ? await this.getMcpTooling().resolveImageGenerationContext(workspaceRootPath)
        : null
    const platformMcpServer =
      await this.getMcpTooling().resolvePlatformManagementMcpServer(sessionId)
    const pluginRuntimeMcp = await this.resolvePluginRuntimeMcpServer(
      turnId,
      usePersistentCodexAppServer ? codexRuntimeLeaseKey : undefined,
    )
    const webSearchMcpServer =
      await this.getMcpTooling().resolveWebSearchMcpServer(workspaceRootPath)
    const subAppMcpServer = await this.getMcpTooling().resolveSubAppMcpServer(
      sessionId,
      workspaceRootPath,
    )
    const presentFilesMcpServer = resolvePresentFilesMcpServer(workspaceRootPath)
    const quickRepliesMcpServer = resolveQuickRepliesMcpServer(workspaceRootPath)
    const toolResultReaderAvailable = resolveToolResultReaderMcpServer(workspaceRootPath) != null
    // 调试模式（per-session 能力开关）：开启时挂载 spark_debug + 注入状态机 prompt。
    const debugModeEnabled = getDebugModeFromMetadata(session.metadata_json)
    const debugMcpServer = debugModeEnabled
      ? await this.getMcpTooling().resolveDebugMcpServer(sessionId, workspaceRootPath)
      : null
    const browserAutomationMcpServer =
      this.browserAutomationMcpProvider != null
        ? await this.browserAutomationMcpProvider(sessionId, workspaceRootPath)
        : null
    let computerUseMcp: Awaited<ReturnType<ComputerUseMcpProvider>> = null
    if (this.computerUseMcpProvider != null) {
      try {
        computerUseMcp = await this.computerUseMcpProvider(sessionId, workspaceRootPath, {
          turnId,
          providerProfileId: effectiveRuntimeProviderProfileId,
          modelId: model,
          permissionMode,
        })
      } catch (error) {
        log.warn(
          `spark_computer MCP setup failed closed: ${error instanceof Error ? error.message : String(error)}`,
        )
      }
    }
    runtimeMetrics.pauseMcpConfiguration()
    const sparkWebToolEnabled =
      runtimeContext.skillConfig.effectiveSkillIds.includes('builtin:spark-web-tool')
    const workflowCanUseManagedExecutor =
      workflowGraph != null &&
      hasWorkflowExecutableNodes(workflowGraph, enabledWorkflowWorkerIds, runtimeAgent.id)
    const workflowExecutionMode =
      workflowGraph == null || !workflowCanUseManagedExecutor || isMentionTurn
        ? 'guided'
        : resolveEngineKind(agentAdapter) === 'claude-sdk'
          ? 'workflow_run'
          : 'codex_guided'
    const managedAgentPrompt = buildManagedAgentSystemPrompt(
      runtimeAgent,
      workflow,
      workflowExecutionMode,
    )

    // ── Team Mode：解析会话团队配置，构建 spark_team in-process MCP server + 花名册 ──
    // Mention 路由：被 @ 的 Member 直接响应，不注入 spark_team（不允许它再 dispatch，符合"互调暂缓"原则）。
    const teamConfig = sessionTeamConfig
    let teamMcpServer: SDKMcpServerConfig | undefined
    let teamRosterPrompt = ''
    let teamInstructionsPrompt = ''
    let orchestrationModePrompt = ''
    if (!isMentionTurn) {
      const teamMembers = teamConfig?.enabled
        ? this.resolveTeamMembers(teamConfig.memberAgentIds, runtimeAgent.id)
        : []
      const hasDispatchableTeamMembers = teamMembers.length > 0
      let activeDiscussionId: string | undefined
      let activeDiscussionRound = 0
      const hasWorkflowExecutionPlan = workflowCanUseManagedExecutor
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
              hostAgentId: runtimeAgent.id,
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
                hostAgentId: runtimeAgent.id,
                memberAgentIds: [...enabledWorkflowWorkerIds],
                maxDepth: 1,
                allowNesting: false,
              }
        teamMcpServer =
          (await this.createTeamMcpServer({
            sessionId,
            turnId,
            hostAgent: runtimeAgent,
            members: dispatchMembers,
            teamConfig: dispatchTeamConfig,
            workspaceRootPath,
            eventRepo,
            hostPermissionMode: permissionMode,
            consumerAdapter: agentAdapter,
            codexConsumerIsOpenAi: isOpenAiOnlyCodexConsumer({
              isCodex: resolveEngineKind(agentAdapter) === 'codex',
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
            ledgerActorAuthority: 'system-observed',
            onDispatchBudgetExceeded: () => this.markTeamDispatchBudgetExhausted(sessionId, turnId),
            ...(usePersistentCodexAppServer ? { codexRuntimeLeaseKey } : {}),
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
              hostAgentId: runtimeAgent.id,
              hostAgentName: runtimeAgent.name,
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
                isCodex: resolveEngineKind(agentAdapter) === 'codex',
                isLocalCli,
                providerType: provider.provider_type,
                codexApiKind: config.codexApiKind,
              }),
              exposeTeamDispatchTools: false,
              discussionId: mentionDiscussion.id,
              discussionRoundIndex: mentionDiscussion.round_index,
              ledgerActorAuthority: 'agent-inferred',
              ...(usePersistentCodexAppServer ? { codexRuntimeLeaseKey } : {}),
            })) ?? undefined
        }
      }
    }

    const memoryBlock = await this.loadMemoryBlockForTurn(
      sessionId,
      workspaceRootPath,
      primaryWorkspaceId,
      runtimeAgent,
    )

    const systemPromptSections = [
      APPLICATION_FOUNDATION_SYSTEM_PROMPT,
      managedAgentPrompt,
      teamMemberContextPrompt,
      orchestrationModePrompt,
      teamRosterPrompt,
      teamInstructionsPrompt,
      buildWorktreeSessionSystemPrompt(workspaceInfo),
      SESSION_WORKTREE_STATE_SYSTEM_PROMPT,
      // 平台临时目录的 git 处理规则只在会话挂了工作区时才有意义（无工作区不注入）。
      workspaceInfo != null && workspaceInfo.rootPath.trim().length > 0
        ? WORKSPACE_TEMP_DIRS_SYSTEM_PROMPT
        : undefined,
      // Task 子代理是 Claude Agent SDK 的原生能力，Codex CLI 路径没有对应工具，
      // 引导语只在 claude-sdk/claude adapter 下注入，避免对 Codex 会话产生误导。
      resolveEngineKind(agentAdapter) === 'claude-sdk'
        ? SUBAGENT_USAGE_HINT_SYSTEM_PROMPT
        : undefined,
      automation.unattended ? UNATTENDED_AUTOMATION_SYSTEM_PROMPT : undefined,
      runtimeRulesPrompt,
      runtimeContext.systemPrompt,
      runtimeContext.envSystemPrompt,
    ]
    const trailingSystemPromptSections = [
      workflow != null ? buildWorkflowBindingAuthorityPrompt(workflow) : undefined,
    ]
    const composedSystemPrompt = joinDistinctPromptSections(
      ...systemPromptSections,
      projectContext.systemPrompt,
      // 记忆三段紧邻对话历史（内容不变，仅段序调整）：memoryBlock 每轮可能因记忆
      // 抽取/更新而变化，原先排在项目上下文之前会连带废掉其后（可能很大的）
      // CLAUDE.md/AGENTS.md 段的前缀缓存；挪到项目上下文之后，变化只影响对话历史
      // 等本就逐轮变化的尾部段。记忆行为引导紧跟 memoryBlock：先让 agent 看到具体
      // 记忆摘要，再说明两套记忆的区别与"记住"路由规则。无条件注入（所有 adapter
      // 都挂载了应用记忆工具）。
      memoryBlock,
      MEMORY_BEHAVIOR_SYSTEM_PROMPT,
      MEMORY_PROVENANCE_SYSTEM_PROMPT,
      conversationHistoryPrompt,
      ...trailingSystemPromptSections,
    )
    // context_ledger 的各段必须互斥。实际运行 prompt 仍保持上面的原始顺序，
    // 这里只为账本把项目上下文和对话历史从 System Prompt 分类中排除。
    const contextLedgerSystemPrompt = joinDistinctPromptSections(
      ...systemPromptSections,
      // 记忆三段实际渲染在项目上下文之后（见 composedSystemPrompt），账本计量
      // 仍归入 System Prompt 分类——各段按类别字符串独立计 token，与顺序无关。
      memoryBlock,
      MEMORY_BEHAVIOR_SYSTEM_PROMPT,
      MEMORY_PROVENANCE_SYSTEM_PROMPT,
      ...trailingSystemPromptSections,
    )
    const composedSkillSystemPrompt = joinDistinctPromptSections(
      runtimeContext.skillSystemPrompt,
      projectContext.skillSystemPrompt,
      imageGenerationContext?.systemPrompt,
      mediaGenerationContext?.systemPrompt,
      platformMcpServer != null ? PLATFORM_MANAGEMENT_SYSTEM_PROMPT : undefined,
      platformMcpServer != null ? SESSION_SCHEDULE_AGENT_SYSTEM_PROMPT : undefined,
      webSearchMcpServer != null ? WEB_SEARCH_SYSTEM_PROMPT : undefined,
      presentFilesMcpServer != null ? PRESENT_FILES_SYSTEM_PROMPT : undefined,
      toolResultReaderAvailable ? TOOL_RESULT_SYSTEM_PROMPT : undefined,
      quickRepliesMcpServer != null ? QUICK_REPLIES_SYSTEM_PROMPT : undefined,
      quickRepliesMcpServer != null ? RENDER_HTML_SYSTEM_PROMPT : undefined,
      quickRepliesMcpServer != null ? RENDER_DIAGRAM_SYSTEM_PROMPT : undefined,
      browserAutomationMcpServer != null ? BROWSER_AUTOMATION_SYSTEM_PROMPT : undefined,
      computerUseMcp?.systemPrompt,
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
    // 捕获本轮完整提示词组成，发送到 Renderer 供审计面板展示。
    // 运行时日志开关（telemetry.data.runtimeLogEnabled，默认关闭）：关闭时仅保留续会话
    // 所需元数据，丢弃 systemPromptSections / userMessage / runtimeLoadStatus 三大
    // 文本块，避免每轮几十 KB 的提示词快照长期累积撑大 spark.db。
    {
      const runtimeLogEnabled = readRuntimeLogEnabled(new SettingsRepository(this.db))
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
      if (resolveEngineKind(agentAdapter) === 'claude-sdk') {
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
          userMessage: runtimeLogEnabled ? buildUserMessageSnapshot(message, turnAttachments) : '',
          systemPromptSections: runtimeLogEnabled ? promptSections : [],
          model,
          providerProfileId: effectiveRuntimeProviderProfileId,
          adapterKind,
          permissionMode,
          toolCount: toolCountEstimate,
          sdkSessionId,
          ...userMessagePresentation,
          ...(runtimeLogEnabled ? { runtimeLoadStatus } : {}),
          ...(resolveEngineKind(agentAdapter) === 'claude-sdk' ? { sdkPreset: 'claude_code' } : {}),
        },
        eventRepo,
      )
    }

    // ── Context Ledger ──────────────────────────────────────────────────
    // Emit a detailed token breakdown of all context sections for UI display
    {
      const attachmentPromptLedger = buildAttachmentPromptLedger(turnAttachments)
      const { sections: ledgerSections, totalEstimatedTokens } = buildContextLedger({
        skillPrompt: composedSkillSystemPrompt,
        systemPrompt: contextLedgerSystemPrompt,
        projectContextPrompt: projectContext.systemPrompt,
        ...(projectContext.budget?.usedTokens != null
          ? { projectContextUsedTokens: projectContext.budget.usedTokens }
          : {}),
        projectContextTruncated: projectContext.budget?.truncated ?? false,
        // resume 成功路径不注入 Spark 历史；SDK 内部维护完整 history。
        // resumeRecoveryHistoryPrompt 是 standby，不计入本轮实际 prompt ledger。
        conversationHistoryLabel: canResumeSdkSession
          ? 'Conversation History (native resume)'
          : storedContinuitySummary != null
            ? 'Continuity Capsule + Recent Exact History'
            : 'Conversation History',
        conversationHistoryPrompt,
        userMessage: message,
        attachmentPrompt: attachmentPromptLedger,
      })
      runtimeMetrics.recordPromptEstimate(totalEstimatedTokens)

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

    const activeGoalForTurn = new GoalRepository(this.db).getCurrent(sessionId)
    // goal 包装策略：
    // - spark-loop：迭代 turn 的 prompt 已自包含完整契约（buildGoalIterationPrompt），
    //   不再叠加执行器侧的 Goal Contract 包装（避免双份 prompt）；普通用户 turn 在
    //   goal 活跃期间执行（典型：sendQueuedTurnNow 打断迭代）时仍包装，驱动其输出
    //   spark-goal-status 块供循环解析续跑。
    // - codex-native：只有迭代 turn（startGoalLoop 派发）才翻译为 /goal <objective>；
    //   普通用户消息保持原文，避免每条消息都重述一遍目标。
    const isGoalIterationTurn = userMessagePresentation?.turnSource === 'goal_iteration'
    const shouldAttachGoalConfig =
      activeGoalForTurn?.status === 'active' &&
      (activeGoalForTurn.mode === 'codex-native' ? isGoalIterationTurn : !isGoalIterationTurn)
    const goalConfig = shouldAttachGoalConfig
      ? {
          id: activeGoalForTurn.id,
          objective: activeGoalForTurn.objective,
          mode: activeGoalForTurn.mode,
          successCriteria: activeGoalForTurn.successCriteria,
          progressLog: activeGoalForTurn.progressLog,
        }
      : undefined

    if (resolveEngineKind(agentAdapter) === 'claude-sdk') {
      const iterationOverride = this.iterationOverrides.get(sessionId)
      const observedInvocation = (snapshot: SDKInvocationSnapshot): void => {
        runtimeMetrics.markRequestSent()
        invocationObserver?.(snapshot)
      }
      const sdkConfig: SDKExecutorConfig = {
        apiKey,
        ...(automation.unattended ? { unattended: true } : {}),
        ...(isLocalCli && activeCliSparkOverride == null ? { useLocalConfig: true } : {}),
        model,
        workspaceRootPath,
        permissionMode,
        ...(config.apiEndpoint != null ? { apiEndpoint: config.apiEndpoint } : {}),
        ...(config.haikuModel != null ? { haikuModel: config.haikuModel } : {}),
        ...(config.sonnetModel != null ? { sonnetModel: config.sonnetModel } : {}),
        ...(config.opusModel != null ? { opusModel: config.opusModel } : {}),
        ...(composedSystemPrompt != null ? { systemPrompt: composedSystemPrompt } : {}),
        ...(resumeRecoveryHistoryPrompt != null
          ? { resumeFallbackSystemPrompt: resumeRecoveryHistoryPrompt }
          : {}),
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
        ...(pluginRuntimeMcp != null
          ? {
              pluginRuntimeMcpServer: pluginRuntimeMcp.server,
              pluginRuntimeToolNames: pluginRuntimeMcp.toolNames,
            }
          : {}),
        ...(webSearchMcpServer != null ? { webSearchMcpServer } : {}),
        ...(subAppMcpServer != null ? { subAppMcpServer } : {}),
        ...(presentFilesMcpServer != null ? { presentFilesMcpServer } : {}),
        ...(quickRepliesMcpServer != null ? { quickRepliesMcpServer } : {}),
        ...(browserAutomationMcpServer != null ? { browserAutomationMcpServer } : {}),
        ...(computerUseMcp != null
          ? {
              computerUseMcpServer: computerUseMcp.server,
              computerUseAllowedTools: computerUseMcp.allowedTools,
              allowedTools: computerUseMcp.allowedTools,
            }
          : {}),
        ...(debugMcpServer != null ? { debugMcpServer } : {}),
        ...(iterationOverride != null ? { maxTurnCount: iterationOverride } : {}),
        ...(config.maxTokens != null ? { maxTokens: config.maxTokens } : {}),
        contextWindowTokens,
        ...(session.reasoning_effort != null
          ? { reasoningEffort: normalizeReasoningEffort(session.reasoning_effort) }
          : {}),
        ...(normalizeReasoningBudgetTokens(agent.metadata.reasoningBudgetTokens) != null
          ? {
              reasoningBudgetTokens: normalizeReasoningBudgetTokens(
                agent.metadata.reasoningBudgetTokens,
              ),
            }
          : {}),
        ...(turnAttachments.length > 0 ? { attachments: turnAttachments } : {}),
        ...(attachmentDirectories.length > 0
          ? { additionalDirectories: attachmentDirectories }
          : {}),
        enableCheckpoints: true,
        sdkSessionId,
        continueSession: canResumeSdkSession,
        ...(this.onHookTrigger != null ? { applicationHookCallback: this.onHookTrigger } : {}),
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
                const releaseQuestionGate = this.pendingUserQuestionGate.enter(sid)
                this.emitAgentStatusEvent(sid, turnId, eventRepo, 'waiting_user')
                try {
                  return await this.onQuestion!(sid, questions, { ...context, turnId })
                } finally {
                  releaseQuestionGate()
                  this.emitAgentStatusEvent(sid, turnId, eventRepo, 'thinking')
                  if (!this.pendingUserQuestionGate.isBlocked(sid)) {
                    setTimeout(() => this.startNextQueuedTurn(sid), 0)
                  }
                }
              },
            }
          : {}),
        ...(goalConfig != null ? { goal: goalConfig } : {}),
        invocationObserver: observedInvocation,
      }
      const turnOptions: TryStartSDKTurnOptions = {
        ...(isMentionTurn ? { mentionAgentId: agent.id } : {}),
        primaryWorkspaceId: primaryWorkspaceId ?? '',
        agentId: agent.id,
        workspaceRootPath,
        ...userMessagePresentation,
        runtimeMetrics,
        ...(userMessageAlreadyPersisted ? { userMessageAlreadyPersisted: true } : {}),
        ...(sessionReferences != null && sessionReferences.length > 0 ? { sessionReferences } : {}),
      }
      // Local CLI 走宿主 OAuth，没有可直发的 apiKey；跳过远程标题精炼，
      // 仍保留首轮触发的简单本地标题（deriveSessionTitle）。
      // Mention turn 不参与首轮标题精炼（会话已有上下文）。
      if (shouldGenerateSessionTitle && !isLocalCli && !isMentionTurn) {
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

    const observedInvocation = (snapshot: SDKInvocationSnapshot): void => {
      runtimeMetrics.markRequestSent()
      invocationObserver?.(snapshot)
    }
    const codexConfig: SDKExecutorConfig = {
      apiKey,
      ...(automation.unattended ? { unattended: true } : {}),
      ...(isLocalCli ? { useLocalConfig: true } : {}),
      ...(isLocalCli && resolveEngineKind(agentAdapter) === 'codex'
        ? { disableCodexNativeSkills: true }
        : {}),
      model,
      workspaceRootPath,
      permissionMode,
      ...(config.apiEndpoint != null ? { apiEndpoint: config.apiEndpoint } : {}),
      ...(config.codexApiKind != null ? { codexApiKind: config.codexApiKind } : {}),
      ...(activeCliSparkOverride != null || (!isLocalCli && provider.provider_type !== 'anthropic')
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
      ...(usePersistentCodexAppServer
        ? buildPersistentCodexAppServerConfig({
            runtimeLeaseKey: codexRuntimeLeaseKey,
            bindingKey: codexNativeThreadBindingKey,
            metadataJson: session.metadata_json,
            ...(resumeRecoveryHistoryPrompt != null
              ? { resumeFallbackSystemPrompt: resumeRecoveryHistoryPrompt }
              : {}),
            onBinding: (binding) => {
              const patch = createCodexNativeThreadMetadataPatch(
                sessionRepo.getMetadata(sessionId),
                binding,
              )
              sessionRepo.patchMetadata(sessionId, patch)
            },
          })
        : {}),
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
      ...(pluginRuntimeMcp != null
        ? {
            pluginRuntimeMcpServer: pluginRuntimeMcp.server,
            pluginRuntimeToolNames: pluginRuntimeMcp.toolNames,
          }
        : {}),
      ...(usePersistentCodexAppServer
        ? this.codexRuntimeMcpResources.buildConfig([teamMcpServer, pluginRuntimeMcp?.server])
        : {}),
      ...(webSearchMcpServer != null ? { webSearchMcpServer } : {}),
      ...(subAppMcpServer != null ? { subAppMcpServer } : {}),
      ...(presentFilesMcpServer != null ? { presentFilesMcpServer } : {}),
      ...(quickRepliesMcpServer != null ? { quickRepliesMcpServer } : {}),
      ...(browserAutomationMcpServer != null ? { browserAutomationMcpServer } : {}),
      ...(computerUseMcp != null
        ? {
            computerUseMcpServer: computerUseMcp.server,
            computerUseAllowedTools: computerUseMcp.allowedTools,
            allowedTools: computerUseMcp.allowedTools,
          }
        : {}),
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
      ...(userMessagePresentation?.clientMessageId != null
        ? { clientUserMessageId: userMessagePresentation.clientMessageId }
        : {}),
      ...(goalConfig != null ? { goal: goalConfig } : {}),
      invocationObserver: observedInvocation,
      runtimeMetricsObserver: (metrics) => runtimeMetrics.recordAdapterMetrics(metrics),
      // app-server 载具的交互审批回路（P2-1）：codex 原生审批请求（命令/文件变更）
      // 经 approvalCallback 走用户审批卡；载具侧负责 waiting_permission 状态与
      // 确定性兜底（无回调/unattended/回调异常 → deny，杜绝上游 turn 挂起）。
      ...(this.onApproval != null
        ? {
            approvalCallback: async (
              sid: string,
              toolName: string,
              toolInput: Record<string, unknown>,
              context: SDKPermissionRequestContext,
            ) => this.onApproval!(sid, toolName, toolInput, context),
          }
        : {}),
    }
    const codexTurnOptions: TryStartSDKTurnOptions = {
      ...(isMentionTurn ? { mentionAgentId: agent.id } : {}),
      primaryWorkspaceId: primaryWorkspaceId ?? '',
      agentId: agent.id,
      workspaceRootPath,
      ...userMessagePresentation,
      runtimeMetrics,
      ...(userMessageAlreadyPersisted ? { userMessageAlreadyPersisted: true } : {}),
      ...(sessionReferences != null && sessionReferences.length > 0 ? { sessionReferences } : {}),
    }
    // 与 claude 分支同款首轮标题精炼上下文（W2-D3 行为补齐：此前仅 claude 路径
    // 携带，codex 会话首轮永远拿不到 LLM 精炼标题）。
    if (shouldGenerateSessionTitle && !isLocalCli && !isMentionTurn) {
      codexTurnOptions.firstTurnTitleContext = {
        providerType: provider.provider_type,
        apiKey,
        model,
        ...(config.apiEndpoint != null ? { apiEndpoint: config.apiEndpoint } : {}),
        userMessage: message,
      }
    }
    await this.tryStartCodexCliTurn(
      sessionId,
      turnId,
      message,
      eventRepo,
      sessionRepo,
      codexConfig,
      codexTurnOptions,
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
    sessionReferences?: SessionReferenceInput[]
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
        ...(params.sessionReferences != null && params.sessionReferences.length > 0
          ? { sessionReferences: params.sessionReferences }
          : {}),
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

  // ─── W2-D2 turn 收尾提炼：两引擎执行体逐字节对称的生命周期段 ────────────────
  // 以下四个方法从 tryStartSDKTurn / tryStartCodexCliTurn 的 promise 收尾链提炼，
  // 提炼前两引擎各自逐字节相同；then 成功分支的后处理差异（resume 熔断 / 标题精炼 /
  // goal 解析 / 收尾顺序）留在调用点，待 W2-D3 统一管道时显式处理。

  /**
   * 成功分支的统一后处理（W2-D3 归一后两引擎完全一致）：
   * 引擎前置钩子（claude：resume 熔断重置）→ 完整正文归并 → 首轮标题精炼/重试
   * → goal 状态与契约块解析 → continuity 胶囊 → 记忆写入 → 成功尾段收尾。
   */
  private runTurnPostProcessing(args: {
    sessionId: string
    turnId: string
    executor: ActiveExecution
    sessionRepo: SessionRepository
    eventRepo: EventRepository
    config: SDKExecutorConfig
    options: TryStartSDKTurnOptions
    message: string
    completeAssistantEvents: AssistantMessageEvent[]
    emitUnpresentedMedia: () => void
    settleTerminalStatus: () => AgentStatusEvent['status'] | null
    /** claude 路径传：成功完成后重置 SDK resume 熔断器。 */
    onTurnSucceeded?: () => void
  }): void {
    args.onTurnSucceeded?.()
    const { sessionId, turnId } = args
    const assistantTurnText = collectCompleteAssistantTurnText(args.completeAssistantEvents)
    const titleCtx = args.options.firstTurnTitleContext
    if (titleCtx != null) {
      void this.refineSessionTitleAsync(sessionId, args.sessionRepo, {
        ...titleCtx,
        assistantMessage: assistantTurnText,
      }).then((retryWorthy) => {
        if (retryWorthy) {
          this.pendingTitleRefinements.set(sessionId, {
            ctx: { ...titleCtx, assistantMessage: assistantTurnText },
            retries: 0,
          })
        }
      })
    } else {
      this.maybeRetrySessionTitleRefinement(sessionId, args.sessionRepo)
    }
    if (assistantTurnText.length > 0) {
      this.updateGoalFromAssistantBlock(sessionId, assistantTurnText)
      this.updateGoalContractFromAssistantBlock(sessionId, assistantTurnText)
    }

    // Context Architecture V2：异步推进结构化会话胶囊。成功 resume 不读取它，
    // 但 Provider 切换、fresh 路径或 resume 失败恢复时可用；失败不影响主 turn。
    this.continuityCoordinator.schedule(sessionId, turnId, args.config.model)

    // ── Memory System：turn 完成后异步写入记忆（fire-and-forget） ──
    void this.maybeWriteMemoryFromTurn(
      sessionId,
      args.options.primaryWorkspaceId ?? '',
      args.options.agentId ?? '',
      args.options.workspaceRootPath,
      args.message,
      assistantTurnText,
    ).catch(() => {
      /* swallow — never affect main flow */
    })

    this.settleTurnSuccessTail({
      sessionId,
      turnId: args.turnId,
      executor: args.executor,
      sessionRepo: args.sessionRepo,
      eventRepo: args.eventRepo,
      emitUnpresentedMedia: args.emitUnpresentedMedia,
      settleTerminalStatus: args.settleTerminalStatus,
    })
  }

  /**
   * 终态守恒兜底：executor 结束（then/catch）但从未发出终态 agent_status 时，
   * 事件流会缺一段收尾——历史重放时该轮消息永远停留在 streaming（UI 上
   * 「思考日志/工具」持续显示运行中，且重开会话也无法恢复）。此处合成一条
   * 终态事件补上，其余收尾（块落定、耗时、汇总）由渲染端对终态事件的
   * 既有处理完成。仅在仍持有会话所有权时补发；被 forceRelease 的路径
   * （插队/停止/删除）由各自入口负责补发 cancelled，避免双重终态。
   */
  private emitSyntheticTurnTerminalStatus(args: {
    sessionId: string
    turnId: string
    eventRepo: EventRepository
    status: 'completed' | 'error'
  }): void {
    const event: AgentStatusEvent = {
      id: crypto.randomUUID(),
      type: 'agent_status',
      sessionId: args.sessionId,
      turnId: args.turnId,
      timestamp: new Date().toISOString(),
      seq: 0,
      status: args.status,
      ...(args.status === 'error' ? { message: 'Turn ended without a terminal status' } : {}),
    }
    this.emitAndPersist(args.sessionId, args.turnId, event, args.eventRepo)
  }

  /**
   * 无后处理收尾（shouldRunTurnPostProcessing=false 的 then 分支）：
   * 媒体兜底 → computer-use 回收 → 终态补发（仍持有所有权时）。
   * executor 正常 resolve 却没发过终态时，合成 completed 补上（守恒兜底）。
   */
  private settleTurnWithoutPostProcessing(args: {
    sessionId: string
    turnId: string
    executor: ActiveExecution
    sessionRepo: SessionRepository
    eventRepo: EventRepository
    emitUnpresentedMedia: () => void
    settleTerminalStatus: () => AgentStatusEvent['status'] | null
  }): void {
    args.emitUnpresentedMedia()
    this.revokeComputerUseSession(args.sessionId)
    const ownsSession = this.turnRegistry.isActiveExecutor(args.sessionId, args.executor)
    const terminalStatus = ownsSession ? args.settleTerminalStatus() : null
    if (ownsSession && terminalStatus == null) {
      this.emitSyntheticTurnTerminalStatus({
        sessionId: args.sessionId,
        turnId: args.turnId,
        eventRepo: args.eventRepo,
        status: 'completed',
      })
    }
    if (
      ownsSession &&
      (terminalStatus == null || terminalStatus === 'completed' || terminalStatus === 'cancelled')
    ) {
      this.updateStatusAfterHostTerminal(args.sessionRepo, args.sessionId, 'completed')
    }
  }

  /**
   * 成功分支的收尾尾段（后处理跑完后的终态补发）。
   * claude 路径在后处理（标题/goal/continuity/memory）之后调用；
   * codex 路径在后处理（continuity/memory）之前调用 —— 顺序差异待 W2-D3 统一。
   */
  private settleTurnSuccessTail(args: {
    sessionId: string
    turnId: string
    executor: ActiveExecution
    sessionRepo: SessionRepository
    eventRepo: EventRepository
    emitUnpresentedMedia: () => void
    settleTerminalStatus: () => AgentStatusEvent['status'] | null
  }): void {
    args.emitUnpresentedMedia()
    this.revokeComputerUseSession(args.sessionId)
    const ownsSession = this.turnRegistry.isActiveExecutor(args.sessionId, args.executor)
    const terminalStatus = ownsSession ? args.settleTerminalStatus() : null
    if (ownsSession && terminalStatus == null) {
      this.emitSyntheticTurnTerminalStatus({
        sessionId: args.sessionId,
        turnId: args.turnId,
        eventRepo: args.eventRepo,
        status: 'completed',
      })
    }
    if (
      ownsSession &&
      (terminalStatus == null || terminalStatus === 'completed' || terminalStatus === 'cancelled')
    ) {
      this.updateStatusAfterHostTerminal(args.sessionRepo, args.sessionId, 'completed')
    }
  }

  /**
   * 异常收尾（catch 分支）：非 completed/cancelled 终态时会话标错。
   * executor 异常退出却没发过终态时，合成 error 补上（守恒兜底）。
   */
  private settleTurnFailure(args: {
    sessionId: string
    turnId: string
    executor: ActiveExecution
    sessionRepo: SessionRepository
    eventRepo: EventRepository
    emitUnpresentedMedia: () => void
    settleTerminalStatus: () => AgentStatusEvent['status'] | null
  }): void {
    args.emitUnpresentedMedia()
    this.revokeComputerUseSession(args.sessionId)
    const ownsSession = this.turnRegistry.isActiveExecutor(args.sessionId, args.executor)
    const terminalStatus = ownsSession ? args.settleTerminalStatus() : null
    if (ownsSession && terminalStatus == null) {
      this.emitSyntheticTurnTerminalStatus({
        sessionId: args.sessionId,
        turnId: args.turnId,
        eventRepo: args.eventRepo,
        status: 'error',
      })
    }
    if (ownsSession && terminalStatus !== 'completed' && terminalStatus !== 'cancelled') {
      this.updateStatusAfterHostTerminal(args.sessionRepo, args.sessionId, 'error')
    }
  }

  /**
   * turn 终结回收（finally 分支）：解除执行追踪与取消标记 → 团队/文件键/桥接
   * 句柄回收 → 守恒释放所有权 → 状态归并 → 队列/续跑推进。
   */
  private settleTurnFinally(args: {
    sessionId: string
    turnId: string
    executor: ActiveExecution
  }): void {
    const { sessionId, turnId, executor } = args
    this.turnRegistry.untrackExecution(executor)
    this.turnRegistry.forgetTurnCancelled(turnId)
    const shouldAutoContinue = this.teamDispatchBudgetExhaustedTurns.get(sessionId) === turnId
    this.teamDispatchService?.clearTurn(turnId)
    this.clearTurnFileChangeKeys(sessionId, turnId)
    this.closeTeamMcpHandlesForTurn(turnId)
    if (this.turnRegistry.isActiveExecutor(sessionId, executor)) {
      this.turnRegistry.releaseExecutorIfOwned(sessionId, turnId, executor)
      this.reconcileSessionExecutionStatus(sessionId)
      if (shouldAutoContinue) {
        void this.continueAfterTeamDispatchBudget(sessionId, turnId)
      } else {
        this.resetTeamDispatchAutoContinuation(sessionId)
        void this.continueGoalOrQueue(sessionId)
      }
    }
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
    const userMessagePresentation = pickUserMessagePresentation(options)
    const sessionReferences = options.sessionReferences
    const makeBase = () => ({
      id: crypto.randomUUID(),
      sessionId,
      turnId,
      timestamp: new Date().toISOString(),
      seq: 0,
    })

    const emitSdkRequiredError = (rawError?: string) => {
      if (options.userMessageAlreadyPersisted !== true) {
        this.emitAndPersist(
          sessionId,
          turnId,
          {
            ...makeBase(),
            type: 'user_message',
            content: message,
            ...userMessagePresentation,
            ...(sessionReferences != null && sessionReferences.length > 0
              ? { sessionReferences }
              : {}),
          },
          eventRepo,
        )
      }
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
      if (options.userMessageAlreadyPersisted !== true) {
        this.emitAndPersist(
          sessionId,
          turnId,
          {
            ...makeBase(),
            type: 'user_message',
            content: message,
            ...userMessagePresentation,
            ...(sessionReferences != null && sessionReferences.length > 0
              ? { sessionReferences }
              : {}),
          },
          eventRepo,
        )
      }
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
    options.runtimeMetrics?.markMcpConfigurationStarted()
    let mcpServers = await this.getMcpTooling().buildMcpServersForSDK()
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
    if (config.pluginRuntimeMcpServer != null) {
      mcpServers.spark_plugins = config.pluginRuntimeMcpServer
    }

    // Built-in web search MCP server — auto-registered for all sessions
    if (config.webSearchMcpServer != null) {
      mcpServers.spark_search = config.webSearchMcpServer
    }
    // Built-in sub app management MCP server (spark_app) — auto-registered for all sessions
    if (config.subAppMcpServer != null) {
      mcpServers.spark_app = config.subAppMcpServer
    }
    if (config.presentFilesMcpServer != null) {
      mcpServers.spark_files = config.presentFilesMcpServer
    }
    if (config.quickRepliesMcpServer != null) {
      mcpServers.spark_ui = config.quickRepliesMcpServer
    }

    // Visible in-app browser MCP server (spark_browser) — desktop main process bridge.
    if (config.browserAutomationMcpServer != null) {
      mcpServers.spark_browser = config.browserAutomationMcpServer
    }
    if (config.computerUseMcpServer != null) {
      mcpServers.spark_computer = config.computerUseMcpServer
    }

    // Debug mode MCP server (spark_debug) — only when the session enabled debug mode
    if (config.debugMcpServer != null) {
      mcpServers.spark_debug = config.debugMcpServer
    }

    // Canvas Agent in-process MCP server — only when session is attached to a canvas modal
    let canvasAllowedTools: string[] | undefined
    let canvasSetupFailure: string | null = null
    if (this.canvasMcpProvider != null) {
      try {
        const canvas = await this.canvasMcpProvider(sessionId)
        if (canvas?.server != null) {
          mcpServers.spark_canvas = canvas.server
          canvasAllowedTools = canvas.allowedTools
        } else if (canvas != null) {
          canvasSetupFailure = 'The attached canvas MCP runtime could not be created.'
        }
      } catch (err) {
        log.warn(`canvas mcp provider failed: ${err instanceof Error ? err.message : String(err)}`)
      }
    }
    if (canvasSetupFailure != null) {
      for (const event of createCanvasMcpUnavailableEvents({
        sessionId,
        turnId,
        userMessage: message,
        rawError: canvasSetupFailure,
      })) {
        if (options.userMessageAlreadyPersisted === true && event.type === 'user_message') continue
        this.emitAndPersist(
          sessionId,
          turnId,
          event.type === 'user_message'
            ? {
                ...event,
                ...userMessagePresentation,
                ...(sessionReferences != null && sessionReferences.length > 0
                  ? { sessionReferences }
                  : {}),
              }
            : event,
          eventRepo,
        )
      }
      sessionRepo.updateStatus(sessionId, 'error')
      return
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

    if (this.turnRegistry.isTurnCancelled(turnId)) return
    const executor = this.engineRegistry.get('claude-sdk').createExecutor(config)
    const changedFiles = new Set<string>()
    const workspaceRootPath = config.workspaceRootPath
    const observedFileChangeKeys = this.getTurnFileChangeKeys(sessionId, turnId)
    const mediaPresentationCollector = new MediaPresentationCollector(workspaceRootPath)
    const emitUnpresentedMedia = (): void => {
      const files = mediaPresentationCollector.takeUnpresented()
      if (files.length === 0) return
      this.emitAndPersist(
        sessionId,
        turnId,
        { ...makeBase(), type: 'presented_files', files },
        eventRepo,
      )
    }
    // 即时发出本轮新观察到的媒体：让生图/截图等产物紧跟对应工具调用就地展示，
    // 而不是攒到 turn 末尾的 emitUnpresentedMedia 统一发（那样会被堆到消息流末尾、
    // 与「在这里生成」的上下文脱节）。drainPending 内部按 emitted 去重，不会与
    // agent 主动 present_files 或 turn 末兜底重复。
    const emitPendingMedia = (): void => {
      const files = mediaPresentationCollector.drainPending()
      if (files.length === 0) return
      this.emitAndPersist(
        sessionId,
        turnId,
        { ...makeBase(), type: 'presented_files', files },
        eventRepo,
      )
    }
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
    await this.attachSparkMemoryMcpServer(
      sessionId,
      {
        workspaceRootPath: config.workspaceRootPath,
        ...(options.primaryWorkspaceId != null
          ? { primaryWorkspaceId: options.primaryWorkspaceId }
          : {}),
        ...(options.agentId != null ? { agentId: options.agentId } : {}),
      },
      mcpServers,
    )

    // spark_session（in-process 版）—— agent 上报引擎级 worktree 状态的工具
    await this.attachSparkSessionMcpServer(sessionId, mcpServers)
    mcpServers = governMcpServers(mcpServers, {
      workspaceRootPath,
      nodeExecutable: tryResolveMcpNodeRuntimeExecutable(),
      proxyServerPath: resolveToolResultProxyMcpServerPath(),
      readerServer: resolveToolResultReaderMcpServer(workspaceRootPath),
    })
    options.runtimeMetrics?.pauseMcpConfiguration()

    const completeAssistantEvents: AssistantMessageEvent[] = []
    // 标题精炼、目标契约/进度解析、记忆抽取都依赖完整 assistant 正文。
    // Codex SDK 现会先发各 segment 的 complete，再发整 turn 的 isFinal 汇总 complete；
    // 这里收集整轮 complete 事件，turn 结束后统一归并，避免只拿到第一段正文。
    let pendingTerminalStatus: AgentStatusEvent | null = null
    // 当前 pending 终态是否已即时广播（未广播时收尾须补发，保证终态守恒）。
    let pendingTerminalBroadcast = false
    // completed 终态本轮是否已广播过（防 result + 偶发流内 idle 双发）。
    let completedBroadcast = false
    // 终态事件在收到时即时广播（见下方 onEvent），这里只保留状态值供收尾使用：
    // 会话级状态落定（updateStatusAfterHostTerminal）仍等 executor promise 收尾，
    // 与队列推进（settleTurnFinally）保持同一时序；轮次级 UI 收尾则不再被扣留。
    const settlePendingTerminalStatus = (): AgentStatusEvent['status'] | null => {
      if (pendingTerminalStatus == null) return null
      const status = pendingTerminalStatus.status
      // 被扣留的终态（流中途可重试 error）在收尾时补发，保证每轮事件流必有终态。
      if (!pendingTerminalBroadcast) {
        this.emitAndPersist(sessionId, turnId, pendingTerminalStatus, eventRepo)
      }
      this.updateStatusAfterHostTerminal(sessionRepo, sessionId, status)
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
      if (options.userMessageAlreadyPersisted === true && event.type === 'user_message') return
      if (
        !shouldAcceptSessionExecutorEvent({
          activeLoops: this.turnRegistry.activeLoops,
          cancelledTurnIds: this.turnRegistry.cancelledTurns,
          sessionId,
          turnId,
          executor,
        })
      ) {
        return
      }
      options.runtimeMetrics?.observe(event)
      if (
        event.type === 'agent_status' &&
        (event.status === 'completed' || event.status === 'cancelled' || event.status === 'error')
      ) {
        // completed 只广播一次：result 消息与（偶发的）流内 idle 都会映射 completed，
        // 第一条已即时广播，后续重复直接吞掉；error → completed 的恢复序列不受影响。
        if (event.status === 'completed' && completedBroadcast) return
        if (event.status === 'completed') completedBroadcast = true
        // 终态即时广播：result 消息即真实完成信号，扣留到流关闭/后处理结束会让
        // UI 在内容已完成后继续显示「进行中」数秒。事件流中终态之后的 presented_files /
        // context_summarized 等追加事件渲染端均按独立块处理（此前 context_summarized
        // 就已落在终态之后），顺序不受影响。
        // 即时广播仅限 result 派生的真实终态（terminalSource 标记）；流中途的可重试
        // error（assistant 消息带 error 字段，SDK 可能续流）扣留到收尾补发定稿，
        // 避免一轮出现两个终态事件。
        const terminalEvent = withAgentSnapshot(event, turnAgent) as AgentStatusEvent
        pendingTerminalStatus = terminalEvent
        const broadcastNow = event.status !== 'error' || event.terminalSource === 'result'
        pendingTerminalBroadcast = broadcastNow
        if (broadcastNow) {
          this.emitAndPersist(sessionId, turnId, terminalEvent, eventRepo)
        }
        return
      }
      mediaPresentationCollector.observe(event)
      if (event.type === 'file_change') {
        changedFiles.add(event.path)
        const key = workspaceRelativeChangeKey(workspaceRootPath, event.path)
        if (key != null) observedFileChangeKeys.add(key)
      }
      let outgoing: AgentEvent = withAgentSnapshot(event, turnAgent)
      if (event.type === 'user_message') {
        outgoing = {
          ...outgoing,
          ...userMessagePresentation,
          ...(sessionReferences != null && sessionReferences.length > 0
            ? { sessionReferences }
            : {}),
        } as UserMessageEvent
      }
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
          outgoing = { ...(outgoing as UserMessageEvent), mentionAgentId }
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
      outgoing = governAgentToolResultEvent(outgoing, workspaceRootPath)
      this.emitAndPersist(sessionId, turnId, outgoing, eventRepo)
      // 媒体产物（生图/截图等）紧跟其工具调用发出，而非堆到 turn 末尾
      emitPendingMedia()
      const reportedChanges = extractReportedFileChanges(event, workspaceRootPath)
      if (reportedChanges != null) {
        for (const change of reportedChanges) {
          const key = workspaceRelativeChangeKey(workspaceRootPath, change.path)
          if (key == null || observedFileChangeKeys.has(key)) continue
          observedFileChangeKeys.add(key)
          changedFiles.add(change.path)
          const fileChangeEvent: AgentEvent = {
            ...makeBase(),
            type: 'file_change',
            path: change.path,
            changeType: change.changeType,
            ...(change.oldPath != null ? { oldPath: change.oldPath } : {}),
            collectionSource: 'agent_manifest',
            ...(mentionMemberContext != null ? { teamMemberContext: mentionMemberContext } : {}),
          }
          mediaPresentationCollector.observe(fileChangeEvent)
          this.emitAndPersist(sessionId, turnId, fileChangeEvent, eventRepo)
          emitPendingMedia()
        }
      }
      const presentedFiles = extractPresentedFiles(event, workspaceRootPath)
      if (presentedFiles != null) {
        // agent 主动展示：丢弃已被即时发出（emitPendingMedia）的相同文件，避免重复卡片
        const deduped = mediaPresentationCollector.markAgentPresented(presentedFiles)
        if (deduped.length > 0) {
          this.emitAndPersist(
            sessionId,
            turnId,
            { ...makeBase(), type: 'presented_files', files: deduped },
            eventRepo,
          )
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
        event.type === 'assistant_message' &&
        event.mode === 'complete' &&
        typeof event.content === 'string'
      ) {
        completeAssistantEvents.push(event)
      }
    })

    this.turnRegistry.registerExecutor(sessionId, turnId, executor)
    sessionRepo.updateStatus(sessionId, 'running')
    this.emitQueueChanged(sessionId)

    // Compute allowed tools: merge image-gen / media / team / platform tools into config defaults
    let sdkAllowedTools = config.allowedTools
    if (config.imageGenerationMcpServer != null) {
      sdkAllowedTools = mergeUniqueStrings(sdkAllowedTools, ['mcp__spark_image__generate_image'])
    }
    if (config.mediaGenerationMcpServer != null) {
      sdkAllowedTools = mergeUniqueStrings(sdkAllowedTools, [...SPARK_MEDIA_TOOL_NAMES])
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
    if (config.pluginRuntimeToolNames != null) {
      sdkAllowedTools = mergeUniqueStrings(sdkAllowedTools, config.pluginRuntimeToolNames)
    }
    if (config.webSearchMcpServer != null) {
      sdkAllowedTools = mergeUniqueStrings(sdkAllowedTools, SEARCH_TOOL_NAMES)
    }
    if (config.subAppMcpServer != null) {
      sdkAllowedTools = mergeUniqueStrings(sdkAllowedTools, SUB_APP_TOOL_NAMES)
    }
    if (config.presentFilesMcpServer != null) {
      sdkAllowedTools = mergeUniqueStrings(sdkAllowedTools, PRESENT_FILES_TOOL_NAMES)
    }
    if (config.quickRepliesMcpServer != null) {
      sdkAllowedTools = mergeUniqueStrings(sdkAllowedTools, QUICK_REPLIES_TOOL_NAMES)
      sdkAllowedTools = mergeUniqueStrings(sdkAllowedTools, RENDER_HTML_TOOL_NAMES)
      sdkAllowedTools = mergeUniqueStrings(sdkAllowedTools, RENDER_DIAGRAM_TOOL_NAMES)
    }
    if (config.browserAutomationMcpServer != null) {
      sdkAllowedTools = mergeUniqueStrings(sdkAllowedTools, BROWSER_TOOL_NAMES)
    }
    if (config.computerUseAllowedTools != null) {
      sdkAllowedTools = mergeUniqueStrings(sdkAllowedTools, config.computerUseAllowedTools)
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
    if (mcpServers.spark_tool_results != null) {
      sdkAllowedTools = mergeUniqueStrings(sdkAllowedTools, TOOL_RESULT_TOOL_NAMES)
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
    options.runtimeMetrics?.markMcpConfigurationStarted()
    options.runtimeMetrics?.recordMcpConfiguration(
      Object.keys(mcpServers),
      this.mcpService.getConnectedToolCatalogs(),
    )

    // Checkpoint（会话开启时）：在 agent 改动文件前捕获本轮起始状态作为可还原点，
    // 仅当工作区相对上个 checkpoint 有实际变更时才真正快照（gating 见 maybeCaptureCheckpoint）。
    if (workspaceRootPath != null && workspaceRootPath.length > 0) {
      await this.maybeCaptureCheckpoint(sessionId, turnId, workspaceRootPath, eventRepo, message)
    }

    if (this.disposing || !this.turnRegistry.isActiveExecutor(sessionId, executor)) {
      if (this.turnRegistry.isActiveExecutor(sessionId, executor)) {
        this.turnRegistry.releaseExecutorIfOwned(sessionId, turnId, executor)
        sessionRepo.updateStatus(sessionId, 'idle')
        this.emitQueueChanged(sessionId)
      }
      this.teamDispatchService?.clearTurn(turnId)
      this.closeTeamMcpHandlesForTurn(turnId)
      this.clearTurnFileChangeKeys(sessionId, turnId)
      return
    }

    // Fire-and-forget
    const executionPromise = executor.executeTurn(sessionId, turnId, message, sdkConfig)
    this.turnRegistry.trackExecution(executor, { sessionId, promise: executionPromise })
    executionPromise
      .then(async () => {
        if (!shouldRunTurnPostProcessing(pendingTerminalStatus?.status ?? null)) {
          this.settleTurnWithoutPostProcessing({
            sessionId,
            turnId,
            executor,
            sessionRepo,
            eventRepo,
            emitUnpresentedMedia,
            settleTerminalStatus: settlePendingTerminalStatus,
          })
          return
        }
        this.runTurnPostProcessing({
          sessionId,
          turnId,
          executor,
          sessionRepo,
          eventRepo,
          config,
          options,
          message,
          completeAssistantEvents,
          emitUnpresentedMedia,
          settleTerminalStatus: settlePendingTerminalStatus,
          // Reset resume circuit breaker on successful turn completion（claude 专属）
          onTurnSucceeded: () => getResumeCircuitBreaker().recordSuccess(sessionId),
        })
      })
      .catch(() => {
        this.settleTurnFailure({
          sessionId,
          turnId,
          executor,
          sessionRepo,
          eventRepo,
          emitUnpresentedMedia,
          settleTerminalStatus: settlePendingTerminalStatus,
        })
      })
      .finally(() => {
        this.settleTurnFinally({ sessionId, turnId, executor })
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
    const userMessagePresentation = pickUserMessagePresentation(options)
    const sessionReferences = options.sessionReferences
    const makeBase = () => ({
      id: crypto.randomUUID(),
      sessionId,
      turnId,
      timestamp: new Date().toISOString(),
      seq: 0,
    })

    const workspaceIssue = await getWorkspaceRootIssue(config.workspaceRootPath)
    if (workspaceIssue != null) {
      if (options.userMessageAlreadyPersisted !== true) {
        this.emitAndPersist(
          sessionId,
          turnId,
          {
            ...makeBase(),
            type: 'user_message',
            content: message,
            ...userMessagePresentation,
            ...(sessionReferences != null && sessionReferences.length > 0
              ? { sessionReferences }
              : {}),
          },
          eventRepo,
        )
      }
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

    options.runtimeMetrics?.markMcpConfigurationStarted()
    let mcpServers = await this.getMcpTooling().buildMcpServersForSDK()
    if (config.imageGenerationMcpServer != null) {
      mcpServers.spark_image = config.imageGenerationMcpServer
    }
    if (config.mediaGenerationMcpServer != null) {
      mcpServers.spark_media = config.mediaGenerationMcpServer
    }
    if (config.platformManagementMcpServer != null) {
      mcpServers.spark_platform = config.platformManagementMcpServer
    }
    if (config.pluginRuntimeMcpServer != null) {
      mcpServers.spark_plugins = config.pluginRuntimeMcpServer
    }
    // FR-0b：codex Host 的 spark_team 是 http 桥接型 server（url+headers），
    // filterCliCompatibleMcpServers 对 url 型放行，CodexCli/CodexSdk 均可消费。
    if (config.teamMcpServer != null) {
      mcpServers.spark_team = config.teamMcpServer
    }
    if (config.webSearchMcpServer != null) {
      mcpServers.spark_search = config.webSearchMcpServer
    }
    // Built-in sub app management MCP server (spark_app) — auto-registered for all sessions
    if (config.subAppMcpServer != null) {
      mcpServers.spark_app = config.subAppMcpServer
    }
    if (config.presentFilesMcpServer != null) {
      mcpServers.spark_files = config.presentFilesMcpServer
    }
    if (config.quickRepliesMcpServer != null) {
      mcpServers.spark_ui = config.quickRepliesMcpServer
    }
    if (config.browserAutomationMcpServer != null) {
      mcpServers.spark_browser = config.browserAutomationMcpServer
    }
    if (config.computerUseMcpServer != null) {
      mcpServers.spark_computer = config.computerUseMcpServer
    }

    let canvasSetupFailure: string | null = null
    let canvasAttached = false
    if (this.canvasMcpProvider != null) {
      try {
        const canvas = await this.canvasMcpProvider(sessionId)
        if (canvas != null) {
          canvasAttached = true
          const canvasServer = await this.getMcpTooling().resolveSparkCanvasMcpServer(
            sessionId,
            canvas,
          )
          if (canvasServer != null) {
            mcpServers.spark_canvas = canvasServer
          } else {
            canvasSetupFailure = 'The attached canvas MCP runtime could not be resolved or started.'
          }
        }
      } catch (err) {
        const detail = err instanceof Error ? err.message : String(err)
        if (canvasAttached) canvasSetupFailure = detail
        else log.warn(`spark_canvas provider lookup failed (non-fatal): ${detail}`)
      }
    }

    // 已绑定画布的会话必须真正拿到 spark_canvas 工具。若在这里静默降级，模型仍可能
    // 借助 Bash 直接改持久化文件并声称“已添加节点”，但 renderer 不会收到实时快照，
    // 造成必须重开画布才看见结果。这里 fail closed，明确告知用户本轮没有执行修改。
    if (canvasSetupFailure != null) {
      log.error(`spark_canvas stdio MCP setup failed: ${canvasSetupFailure}`)
      for (const event of createCanvasMcpUnavailableEvents({
        sessionId,
        turnId,
        userMessage: message,
        rawError: canvasSetupFailure,
      })) {
        if (options.userMessageAlreadyPersisted === true && event.type === 'user_message') continue
        this.emitAndPersist(
          sessionId,
          turnId,
          event.type === 'user_message'
            ? {
                ...event,
                ...userMessagePresentation,
                ...(sessionReferences != null && sessionReferences.length > 0
                  ? { sessionReferences }
                  : {}),
              }
            : event,
          eventRepo,
        )
      }
      sessionRepo.updateStatus(sessionId, 'error')
      return
    }

    // spark_memory（CLI 路径专用）—— stdio 子进程通过 PlatformBridgeService HTTP RPC 回到
    // 主进程的 bridgeMemorySearch / bridgeMemoryRecall。claude SDK 路径（tryStartSDKTurn）
    // 用 in-process SDK MCP；二者工具名/语义/检索后端完全一致。必须在 filterCliCompatibleMcpServers
    // 之前注入：本路径（tryStartCodexCliTurn）下方会用 filter 过滤掉 type='sdk' 的 server，
    // stdio 版本不受影响。
    try {
      const memServer = await this.getMcpTooling().resolveSparkMemoryMcpServer(
        sessionId,
        config.workspaceRootPath,
      )
      if (memServer != null) mcpServers.spark_memory = memServer
    } catch (err) {
      log.warn(
        `spark_memory stdio MCP setup failed (non-fatal): ${err instanceof Error ? err.message : String(err)}`,
      )
    }

    // spark_session（CLI 路径专用）—— agent 上报引擎级 worktree 状态的工具，
    // stdio 子进程经 PlatformBridgeService RPC 回到 setSessionRuntimeWorktree。
    try {
      const sessionServer = await this.resolveSparkSessionMcpServer(sessionId)
      if (sessionServer != null) mcpServers.spark_session = sessionServer
    } catch (err) {
      log.warn(
        `spark_session stdio MCP setup failed (non-fatal): ${
          err instanceof Error ? err.message : String(err)
        }`,
      )
    }

    // Debug mode MCP server (spark_debug) — only when the session enabled debug mode
    if (config.debugMcpServer != null) {
      mcpServers.spark_debug = config.debugMcpServer
    }
    mcpServers = governMcpServers(mcpServers, {
      workspaceRootPath: config.workspaceRootPath,
      nodeExecutable: tryResolveMcpNodeRuntimeExecutable(),
      proxyServerPath: resolveToolResultProxyMcpServerPath(),
      readerServer: resolveToolResultReaderMcpServer(config.workspaceRootPath),
    })
    options.runtimeMetrics?.pauseMcpConfiguration()

    // MCP hot-reload: same as Claude SDK path — force a fresh session if the MCP
    // set changed since the last build.
    if (this.mcpVersion !== this.lastBuiltMcpVersion) {
      config.continueSession = false
      this.lastBuiltMcpVersion = this.mcpVersion
    }

    const useCodexCli = config.useLocalConfig === true || config.codexCliProvider != null
    if (this.turnRegistry.isTurnCancelled(turnId)) return
    const executor = this.engineRegistry.get('codex').createExecutor(config)
    const completeAssistantEvents: AssistantMessageEvent[] = []
    const mentionAgentId = options.mentionAgentId
    const mentionMemberContext =
      mentionAgentId != null
        ? { dispatchId: `mention:${turnId}`, memberAgentId: mentionAgentId }
        : undefined
    const turnAgent = this.resolveAgent(options.agentId)
    const observedFileChangeKeys = this.getTurnFileChangeKeys(sessionId, turnId)
    const mediaPresentationCollector = new MediaPresentationCollector(config.workspaceRootPath)
    const emitUnpresentedMedia = (): void => {
      const files = mediaPresentationCollector.takeUnpresented()
      if (files.length === 0) return
      this.emitAndPersist(
        sessionId,
        turnId,
        { ...makeBase(), type: 'presented_files', files },
        eventRepo,
      )
    }
    // 即时发出本轮新观察到的媒体：让生图/截图等产物紧跟对应工具调用就地展示，
    // 而不是攒到 turn 末尾的 emitUnpresentedMedia 统一发（那样会被堆到消息流末尾、
    // 与「在这里生成」的上下文脱节）。drainPending 内部按 emitted 去重，不会与
    // agent 主动 present_files 或 turn 末兜底重复。
    const emitPendingMedia = (): void => {
      const files = mediaPresentationCollector.drainPending()
      if (files.length === 0) return
      this.emitAndPersist(
        sessionId,
        turnId,
        { ...makeBase(), type: 'presented_files', files },
        eventRepo,
      )
    }
    let pendingTerminalStatus: AgentStatusEvent | null = null
    // 当前 pending 终态是否已即时广播（未广播时收尾须补发，保证终态守恒）。
    let pendingTerminalBroadcast = false
    // completed 终态本轮是否已广播过（防重复完成信号双发）。
    let completedBroadcast = false
    // 终态事件在收到时即时广播（见下方 onEvent）；这里只保留状态值供收尾使用，
    // 会话级状态落定（updateStatusAfterHostTerminal）仍与队列推进保持同一时序。
    const settlePendingTerminalStatus = (): AgentStatusEvent['status'] | null => {
      if (pendingTerminalStatus == null) return null
      const status = pendingTerminalStatus.status
      // 被扣留的终态（无 result 标记的 error）在收尾时补发，保证每轮事件流必有终态。
      if (!pendingTerminalBroadcast) {
        this.emitAndPersist(sessionId, turnId, pendingTerminalStatus, eventRepo)
      }
      this.updateStatusAfterHostTerminal(sessionRepo, sessionId, status)
      pendingTerminalStatus = null
      return status
    }

    executor.onEvent((event) => {
      if (options.userMessageAlreadyPersisted === true && event.type === 'user_message') return
      if (
        !shouldAcceptSessionExecutorEvent({
          activeLoops: this.turnRegistry.activeLoops,
          cancelledTurnIds: this.turnRegistry.cancelledTurns,
          sessionId,
          turnId,
          executor,
        })
      ) {
        return
      }
      options.runtimeMetrics?.observe(event)
      if (
        event.type === 'agent_status' &&
        (event.status === 'completed' || event.status === 'cancelled' || event.status === 'error')
      ) {
        // completed 只广播一次，重复完成信号直接吞掉（与 claude 路径同因）。
        if (event.status === 'completed' && completedBroadcast) return
        if (event.status === 'completed') completedBroadcast = true
        // 终态即时广播（与 claude 路径同因）：完成信号一到即收尾 UI，
        // 不再扣留到流关闭/后处理结束。
        // 与 claude 路径一致：即时广播仅限 result 派生的真实终态（terminalSource
        // 标记）；无标记的 error 扣留到收尾补发，防御未来 adapter 出现流中途
        // 可重试 error 时破坏「每轮一个终态」守恒。
        const terminalEvent = withAgentSnapshot(event, turnAgent) as AgentStatusEvent
        pendingTerminalStatus = terminalEvent
        const broadcastNow = event.status !== 'error' || event.terminalSource === 'result'
        pendingTerminalBroadcast = broadcastNow
        if (broadcastNow) {
          this.emitAndPersist(sessionId, turnId, terminalEvent, eventRepo)
        }
        return
      }
      mediaPresentationCollector.observe(event)
      if (event.type === 'file_change') {
        const key = workspaceRelativeChangeKey(config.workspaceRootPath, event.path)
        if (key != null) observedFileChangeKeys.add(key)
      }
      let outgoing: AgentEvent = withAgentSnapshot(event, turnAgent)
      if (event.type === 'user_message') {
        outgoing = {
          ...outgoing,
          ...userMessagePresentation,
          ...(sessionReferences != null && sessionReferences.length > 0
            ? { sessionReferences }
            : {}),
        } as UserMessageEvent
      }
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
          outgoing = {
            ...event,
            ...userMessagePresentation,
            ...(sessionReferences != null && sessionReferences.length > 0
              ? { sessionReferences }
              : {}),
            mentionAgentId,
          }
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
      outgoing = governAgentToolResultEvent(outgoing, config.workspaceRootPath)
      this.emitAndPersist(sessionId, turnId, outgoing, eventRepo)
      // 媒体产物（生图/截图等）紧跟其工具调用发出，而非堆到 turn 末尾
      emitPendingMedia()
      const reportedChanges = extractReportedFileChanges(event, config.workspaceRootPath)
      if (reportedChanges != null) {
        for (const change of reportedChanges) {
          const key = workspaceRelativeChangeKey(config.workspaceRootPath, change.path)
          if (key == null || observedFileChangeKeys.has(key)) continue
          observedFileChangeKeys.add(key)
          const fileChangeEvent: AgentEvent = {
            ...makeBase(),
            type: 'file_change',
            path: change.path,
            changeType: change.changeType,
            ...(change.oldPath != null ? { oldPath: change.oldPath } : {}),
            collectionSource: 'agent_manifest',
            ...(mentionMemberContext != null ? { teamMemberContext: mentionMemberContext } : {}),
          }
          mediaPresentationCollector.observe(fileChangeEvent)
          this.emitAndPersist(sessionId, turnId, fileChangeEvent, eventRepo)
          emitPendingMedia()
        }
      }
      const presentedFiles = extractPresentedFiles(event, config.workspaceRootPath)
      if (presentedFiles != null) {
        // agent 主动展示：丢弃已被即时发出（emitPendingMedia）的相同文件，避免重复卡片
        const deduped = mediaPresentationCollector.markAgentPresented(presentedFiles)
        if (deduped.length > 0) {
          this.emitAndPersist(
            sessionId,
            turnId,
            { ...makeBase(), type: 'presented_files', files: deduped },
            eventRepo,
          )
        }
      }
      // Plan 模式：与 claude 路径（tryStartSDKTurn）对称 —— agent 递交计划后标记本
      // session 处于"等待计划审批"状态，由 startNextQueuedTurn 的 pendingPlanApprovals
      // 拦截分支阻断自动起跑；排队的 turn 等审批通过或被拒绝后再决定执行/丢弃。
      // （此前仅 claude 路径有此检查：codex 会话递交计划后，排队 turn 会跨越审批
      // 弹窗自动执行 —— W2-D0 行为锁 ⑧ 抓到的引擎不对称缺口。）
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

    this.turnRegistry.registerExecutor(sessionId, turnId, executor)
    sessionRepo.updateStatus(sessionId, 'running')
    this.emitQueueChanged(sessionId)

    options.runtimeMetrics?.markMcpConfigurationStarted()
    const cliMcpServers = useCodexCli ? filterCliCompatibleMcpServers(mcpServers) : mcpServers
    options.runtimeMetrics?.recordMcpConfiguration(
      Object.keys(cliMcpServers),
      this.mcpService.getConnectedToolCatalogs(),
    )
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

    if (this.disposing || !this.turnRegistry.isActiveExecutor(sessionId, executor)) {
      if (this.turnRegistry.isActiveExecutor(sessionId, executor)) {
        this.turnRegistry.releaseExecutorIfOwned(sessionId, turnId, executor)
        sessionRepo.updateStatus(sessionId, 'idle')
        this.emitQueueChanged(sessionId)
      }
      this.teamDispatchService?.clearTurn(turnId)
      this.closeTeamMcpHandlesForTurn(turnId)
      this.clearTurnFileChangeKeys(sessionId, turnId)
      return
    }

    const executionPromise = executor.executeTurn(sessionId, turnId, message, cliConfig)
    this.turnRegistry.trackExecution(executor, { sessionId, promise: executionPromise })
    executionPromise
      .then(async () => {
        if (!shouldRunTurnPostProcessing(pendingTerminalStatus?.status ?? null)) {
          this.settleTurnWithoutPostProcessing({
            sessionId,
            turnId,
            executor,
            sessionRepo,
            eventRepo,
            emitUnpresentedMedia,
            settleTerminalStatus: settlePendingTerminalStatus,
          })
          return
        }
        // W2-D3：与 claude 路径共用统一后处理（含此前缺失的标题精炼与 goal 解析）。
        this.runTurnPostProcessing({
          sessionId,
          turnId,
          executor,
          sessionRepo,
          eventRepo,
          config,
          options,
          message,
          completeAssistantEvents,
          emitUnpresentedMedia,
          settleTerminalStatus: settlePendingTerminalStatus,
        })
      })
      .catch(() => {
        this.settleTurnFailure({
          sessionId,
          turnId,
          executor,
          sessionRepo,
          eventRepo,
          emitUnpresentedMedia,
          settleTerminalStatus: settlePendingTerminalStatus,
        })
      })
      .finally(() => {
        this.settleTurnFinally({ sessionId, turnId, executor })
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
      const recentSummary = buildMemoryExtractionRecentContext(eventRepo, sessionId)
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

  /**
   * @returns true 表示本次 LLM 精炼失败、值得后续 turn 重试（LLM 返回空/异常）；
   *   false 表示无需重试（成功、会话已删除、用户已手动改名、或 LLM 成功但结果与现标题相同）。
   */
  private async refineSessionTitleAsync(
    sessionId: string,
    sessionRepo: SessionRepository,
    ctx: FirstTurnTitleContext & { assistantMessage: string },
  ): Promise<boolean> {
    try {
      const current = sessionRepo.get(sessionId)
      if (current == null) return false
      // Skip if user has manually renamed the session in the meantime
      const derivedFromFirst = deriveSessionTitle(ctx.userMessage)
      if (
        current.title !== derivedFromFirst &&
        !isTitlePrefixOfMessage(current.title, ctx.userMessage) &&
        !shouldDeriveSessionTitle(current.title)
      ) {
        return false
      }
      const refined = await generateSessionTitle({
        providerType: ctx.providerType,
        apiKey: ctx.apiKey,
        ...(ctx.apiEndpoint != null ? { apiEndpoint: ctx.apiEndpoint } : {}),
        model: ctx.model,
        userMessage: ctx.userMessage,
        assistantMessage: ctx.assistantMessage,
      })
      if (refined == null || refined.length === 0) return true
      if (refined === current.title) return false
      sessionRepo.updateTitle(sessionId, refined)
      this.onSessionRenamed?.(sessionId, refined)
      return false
    } catch (err) {
      log.warn(
        `refineSessionTitleAsync failed: ${err instanceof Error ? err.message : String(err)}`,
      )
      return true
    }
  }

  /**
   * goal 会话的标题精炼入口：用 goal objective 作为首条用户消息构造精炼上下文。
   * provider/apiKey 按会话当前配置解析；local CLI（无 keystore_ref）与配置缺失时静默跳过。
   */
  private async refineGoalSessionTitleAsync(sessionId: string, objective: string): Promise<void> {
    try {
      if (objective.trim().length === 0) return
      const sessionRepo = new SessionRepository(this.db)
      const session = sessionRepo.get(sessionId)
      if (session == null) return
      const provider =
        session.provider_profile_id != null
          ? new ProviderProfileRepository(this.db).get(session.provider_profile_id)
          : null
      if (provider == null || provider.keystore_ref == null) return
      const config = JSON.parse(provider.config_json) as {
        apiEndpoint?: string
        defaultModel?: string
      }
      const model = session.model_id?.trim() || config.defaultModel?.trim() || ''
      if (model.length === 0) return
      const apiKey = await resolveProviderApiKey(provider)
      if (apiKey.length === 0) return
      await this.refineSessionTitleAsync(sessionId, sessionRepo, {
        providerType: provider.provider_type,
        apiKey,
        ...(config.apiEndpoint != null && config.apiEndpoint.length > 0
          ? { apiEndpoint: config.apiEndpoint }
          : {}),
        model,
        userMessage: objective,
        assistantMessage: '',
      })
    } catch (err) {
      log.warn(
        `refineGoalSessionTitleAsync failed: ${err instanceof Error ? err.message : String(err)}`,
      )
    }
  }

  /**
   * 首轮标题精炼失败的补偿重试：后续任意 turn 完成时，若该会话仍有待重试上下文，
   * 且标题未被用户手动改名（由 refineSessionTitleAsync 内部守卫），则再试一次；
   * 成功或达到 TITLE_REFINEMENT_MAX_RETRIES 上限后清除条目，防止 Map 无限增长。
   */
  private maybeRetrySessionTitleRefinement(
    sessionId: string,
    sessionRepo: SessionRepository,
  ): void {
    const pending = this.pendingTitleRefinements.get(sessionId)
    if (pending == null) return
    pending.retries += 1
    void this.refineSessionTitleAsync(sessionId, sessionRepo, pending.ctx).then((retryWorthy) => {
      if (!retryWorthy || pending.retries >= TITLE_REFINEMENT_MAX_RETRIES) {
        this.pendingTitleRefinements.delete(sessionId)
      }
    })
  }

  /**
   * Attach spark_memory MCP server (search_memory + recall_memory tools) to the
   * provided mcpServers map. Skipped silently if memory is disabled or setup fails.
   *
   * Extracted from tryStartSDKTurn (W4.3 B-2.1) — closure-free, pure instance method.
   */
  private async attachSparkMemoryMcpServer(
    sessionId: string,
    context: {
      workspaceRootPath: string
      primaryWorkspaceId?: string
      agentId?: string
    },
    mcpServers: Record<string, SDKMcpServerConfig>,
  ): Promise<void> {
    try {
      const memoryEnabled = new SettingsRepository(this.db).get('memory', 'enabled')
      if (memoryEnabled !== false && memoryEnabled !== 0) {
        const memFactory = await loadSdkMcpFactory()
        if (memFactory != null) {
          const { createSdkMcpServer: memCreateServer, tool: memTool } = memFactory
          const memSettingsRepo = new SettingsRepository(this.db)
          const memSettingsGet = (c: string, k: string) => memSettingsRepo.get(c, k)
          const memRepo = new MemoryRepository(this.db)
          const memStore = new MemoryStoreService(undefined, context.workspaceRootPath)
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
          if (context.primaryWorkspaceId != null && context.primaryWorkspaceId.length > 0) {
            memScopes.push({ scope: 'project', scopeRef: context.primaryWorkspaceId })
          }
          if (context.agentId != null && context.agentId.length > 0) {
            memScopes.push({ scope: 'agent', scopeRef: context.agentId })
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
  }

  /**
   * spark_session（in-process 版，claude SDK 路径）：agent 可调用的
   * set_worktree_state 工具，用于上报引擎级 worktree 状态（进入/退出）。
   * 与 stdio 版（resolveSparkSessionMcpServer）同名同语义。
   */
  private async attachSparkSessionMcpServer(
    sessionId: string,
    mcpServers: Record<string, SDKMcpServerConfig>,
  ): Promise<void> {
    try {
      const factory = await loadSdkMcpFactory()
      if (factory == null) return
      const { createSdkMcpServer, tool } = factory
      const setWorktreeStateTool = tool(
        'set_worktree_state',
        SPARK_SESSION_WORKTREE_TOOL_DESCRIPTION,
        {
          action: z
            .enum(['enter', 'exit'])
            .describe('enter=进入/已在 worktree 开发；exit=退出 worktree 回到主仓库。'),
          path: z
            .string()
            .describe('worktree 根目录的绝对路径（action=enter 时必填）。')
            .optional(),
          branch: z
            .string()
            .describe('可选分支名；缺省由应用从 path 解析，仅在 detached HEAD 时用于展示。')
            .optional(),
        } as Record<string, unknown>,
        async (args: Record<string, unknown>) => {
          const action = args.action === 'exit' ? 'exit' : args.action === 'enter' ? 'enter' : null
          if (action == null) {
            return {
              content: [{ type: 'text' as const, text: 'action 必须是 "enter" 或 "exit"。' }],
              isError: true,
            }
          }
          const r = await this.setSessionRuntimeWorktree(sessionId, {
            action,
            ...(typeof args.path === 'string' && args.path !== '' ? { path: args.path } : {}),
            ...(typeof args.branch === 'string' && args.branch !== ''
              ? { branch: args.branch }
              : {}),
          })
          const text = !r.ok
            ? `更新失败：${r.error ?? '未知原因'}。请确认 path 是存在的 git worktree 目录绝对路径后重试。`
            : r.worktree == null
              ? '已清除会话 worktree 状态。'
              : `会话 worktree 状态已更新：${r.worktree.path}${r.worktree.branch ? `（分支 ${r.worktree.branch}）` : ''}`
          return { content: [{ type: 'text' as const, text }], isError: !r.ok }
        },
      )
      mcpServers.spark_session = createSdkMcpServer({
        name: 'spark_session',
        version: '1.0.0',
        tools: [setWorktreeStateTool],
      })
    } catch (err) {
      log.warn(
        `spark_session MCP server setup failed (non-fatal): ${
          err instanceof Error ? err.message : String(err)
        }`,
      )
    }
  }

  /**
   * 解析 stdio 版 spark_session MCP server（codex / claude CLI 路径）。
   * 子进程通过 PlatformBridgeService HTTP RPC 回调 setSessionRuntimeWorktree，
   * 与 in-process 版语义一致。
   */
  private async resolveSparkSessionMcpServer(
    sessionId: string,
  ): Promise<SDKMcpServerConfig | null> {
    const serverPath = resolveSparkSessionMcpServerPath()
    if (serverPath == null) {
      log.warn('Spark session MCP server script not found')
      return null
    }
    try {
      const port = await this.getMcpTooling().ensurePlatformBridge()
      return {
        type: 'stdio',
        command: resolveMcpNodeRuntimeExecutable(),
        args: [serverPath],
        env: {
          SPARK_PLATFORM_BRIDGE_PORT: String(port),
          SPARK_SESSION_SID: sessionId,
        },
      }
    } catch (err) {
      log.warn(
        `Failed to start spark_session MCP server: ${err instanceof Error ? err.message : String(err)}`,
      )
      return null
    }
  }

  /**
   * Load long-term memory block to inject into system prompt for the current turn.
   * Returns undefined if memory is disabled, not configured, or load failed (non-fatal).
   *
   * Extracted from startTurn (W4.3 B-2.2) — closure-free, pure instance method.
   * Fires memory consolidation job as fire-and-forget when enabled.
   */
  private async loadMemoryBlockForTurn(
    sessionId: string,
    workspaceRootPath: string | undefined,
    primaryWorkspaceId: string | undefined,
    runtimeAgent: { id: string; name: string; description?: string },
  ): Promise<string | undefined> {
    try {
      const settingsRepo = new SettingsRepository(this.db)
      const settingsGet = (cat: string, key: string) => settingsRepo.get(cat, key)
      const memoryEnabled = settingsGet('memory', 'enabled')
      const memoryDisabled = memoryEnabled === false || memoryEnabled === 0
      const memoryRepo = new MemoryRepository(this.db)
      const memoryStore = new MemoryStoreService(undefined, workspaceRootPath)
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
      if (!memoryDisabled) {
        try {
          memorySearchRepo.backfillFtsIfNeeded()
        } catch (err) {
          log.debug(
            `memory FTS backfill skipped: ${err instanceof Error ? err.message : String(err)}`,
          )
        }
        void embeddingService.backfillMissingVectors()
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
          consoScopes.push({ scope: 'agent', scopeRef: runtimeAgent.id })
          log.info(
            `memory consolidation trigger fired for agent=${runtimeAgent.id} (fire-and-forget)`,
          )
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
      const wsName = workspaceRootPath ? path.basename(workspaceRootPath) : ''
      const seedQuery = [runtimeAgent.name, runtimeAgent.description, wsName]
        .filter((s) => typeof s === 'string' && s.length > 0)
        .join(' ')
        .slice(0, 500)
      const memoryInjection = await memoryReader.loadForSession({
        workspaceId: primaryWorkspaceId ?? '',
        agentId: runtimeAgent.id,
        ...(seedQuery.length > 0 ? { seedQuery } : {}),
      })
      const memoryBlock = memoryInjection.block || undefined
      if (memoryBlock != null) {
        log.debug(`Memory injected: ${memoryInjection.injectedIds.length} entries`)
      }
      return memoryBlock
    } catch (err) {
      log.warn(
        `Memory injection failed (non-fatal): ${err instanceof Error ? err.message : String(err)}`,
      )
      return undefined
    }
  }

  /**
   * A-03 细致审查：构建 member turn 的 allowedTools 列表。
   *
   * 镜像 Host 路径（startTurn line 3253-3295）按 mcpServers 实际加载的 MCP
   * 推导免审批工具列表。否则 member 在 unattended dispatch 模式下会因工具
   * 未列入 allowedTools 而卡在 approval 等待。
   */
  private buildMemberAllowedTools(
    memberMcpServers: Record<string, SDKMcpServerConfig>,
    memberTeamServer: SDKMcpServerConfig | undefined,
  ): string[] {
    const tools: string[] = []
    if (memberMcpServers.spark_image != null) {
      tools.push('mcp__spark_image__generate_image')
    }
    if (memberMcpServers.spark_media != null) {
      tools.push(...SPARK_MEDIA_TOOL_NAMES)
    }
    if (memberTeamServer != null) {
      const teamToolNames =
        this.teamMcpToolNames.get(memberTeamServer) ??
        new Set<TeamToolName>(['agent_dispatch', 'agent_dispatch_batch'])
      tools.push(...[...teamToolNames].map((name) => qualifyTeamToolName(name as TeamToolName)))
    }
    if (memberMcpServers.spark_platform != null) tools.push(...PLATFORM_TOOL_NAMES)
    if (memberMcpServers.spark_search != null) tools.push(...SEARCH_TOOL_NAMES)
    if (memberMcpServers.spark_files != null) tools.push(...PRESENT_FILES_TOOL_NAMES)
    if (memberMcpServers.spark_browser != null) tools.push(...BROWSER_TOOL_NAMES)
    if (memberMcpServers.spark_memory != null) {
      tools.push('mcp__spark_memory__search_memory', 'mcp__spark_memory__recall_memory')
    }
    if (memberMcpServers.spark_debug != null) tools.push(...DEBUG_TOOL_NAMES)
    return Array.from(new Set(tools))
  }

  /**
   * Build MCP server configs in the SDK's expected format from our McpService.
   */

  // ── MCP 工具面装配（P1-W3-S5 迁出至 ./session/session-mcp-tooling.ts）───

  private getMcpTooling(): SessionMcpTooling {
    if (this.mcpTooling == null) {
      this.mcpTooling = new SessionMcpTooling(this.db, this)
    }
    return this.mcpTooling
  }

  // ── SessionMcpToolingHost 窄回调 ──

  getMcpService(): McpService {
    return this.mcpService
  }

  getMcpOAuthProvider(): McpOAuthTokenProvider | undefined {
    return this.mcpOAuthProvider
  }

  getPlatformBridge(): PlatformBridgeService {
    return this.platformBridge
  }

  getPluginManager(): PluginManager | null {
    return this.pluginManager
  }

  getUserSkillsDir(): string | null {
    return this.userSkillsDir
  }

  getPlatformConfigChangedHandler(): PlatformConfigChangedHandler | undefined {
    return this.onPlatformConfigChanged
  }

  getSessionService(): SessionService {
    return this
  }

  /**
   * Build a bearer-protected MCP snapshot for connected plugin runtimes. Ordinary executions
   * revoke the session at turn end; persistent Codex runtimes retain the bearer/connection while
   * deactivating the turn-specific handler generation until the next acquire.
   */
  private async resolvePluginRuntimeMcpServer(
    turnId: string,
    codexRuntimeLeaseKey?: string,
  ): Promise<{ server: SDKMcpServerConfig; toolNames: string[] } | null> {
    if (this.pluginManager != null) {
      this.pluginManagerInitialization ??= this.pluginManager.initialize()
      await this.pluginManagerInitialization
    }
    if (this.pluginRuntimeMcpBridge == null) {
      this.pluginRuntimeBroker = new RuntimeBroker({
        db: this.db,
        isPluginEnabled: (_pluginId, runtimeId) =>
          this.pluginManager?.isRuntimeEnabled(runtimeId) ?? true,
      })
      registerBuiltinRuntimeAdapters(this.pluginRuntimeBroker)
      this.pluginRuntimeMcpBridge = new PluginRuntimeMcpBridge(this.pluginRuntimeBroker)
    }
    try {
      const handle = await this.pluginRuntimeMcpBridge.serve({
        ...(codexRuntimeLeaseKey != null ? { runtimeLeaseKey: codexRuntimeLeaseKey } : {}),
      })
      if (handle == null) return null
      const handles =
        this.pluginRuntimeMcpHandlesByTurn.get(turnId) ?? new Set<PluginRuntimeMcpHandle>()
      handles.add(handle)
      this.pluginRuntimeMcpHandlesByTurn.set(turnId, handles)
      if (handle.runtimeResource != null) {
        this.codexRuntimeMcpResources.register(handle.config, handle.runtimeResource)
      }
      return { server: handle.config, toolNames: handle.toolNames }
    } catch (error) {
      log.warn(
        `Plugin runtime MCP setup failed: ${error instanceof Error ? error.message : String(error)}`,
      )
      return null
    }
  }

  private resolveAgent(agentId: string | undefined): AgentItem {
    const repo = new AgentRepository(this.db)
    return (
      repo.get(agentId ?? 'platform-manager-agent') ??
      repo.get('platform-manager-agent') ?? {
        id: 'platform-manager-agent',
        name: 'Spark助手',
        description: '系统内置通用助手，统一承担平台管理与全栈开发任务',
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
    /** Trusted runtime authority for ledger mutations; member turns are agent-inferred. */
    ledgerActorAuthority?: import('@spark/storage').RoomLedgerAuthority
    /** Host-only notification used to schedule a hidden continuation after cleanup. */
    onDispatchBudgetExceeded?: () => void
    /** Persistent Codex runtime lease that should own the HTTP bridge bearer/session. */
    codexRuntimeLeaseKey?: string
  }): Promise<SDKMcpServerConfig | null> {
    // FR-0b：目标消费者是 codex 时用 HTTP 桥接（codex 子进程无法回调主进程 in-process sdk server）；
    // claude 消费者走 in-process（现状）。两形态共用下方 tool 定义，避免实现漂移。
    const isCodexConsumer =
      ctx.consumerAdapter != null && resolveEngineKind(ctx.consumerAdapter) === 'codex'
    const discussionId = ctx.discussionId
    const discussionRepo = discussionId != null ? this.getTeamDiscussionRepository() : null
    const ledgerAdapter =
      discussionId != null
        ? new TeamLedgerRuntimeAdapter(this.db, {
            sessionId: ctx.sessionId,
            discussionId,
            actorId: ctx.hostAgent.id,
            actorAuthority: ctx.ledgerActorAuthority ?? 'system-observed',
            ...(ctx.teamConfig.threadContextTokenBudget != null
              ? {
                  maxEntries: 50,
                  maxChars: Math.min(6000, ctx.teamConfig.threadContextTokenBudget * 4),
                }
              : {}),
          })
        : null
    // Task Graph / Deliberation 与 Ledger 共用当前 turn 的可信 session + discussion
    // scope。工具参数只承载操作数据，身份由此处绑定；成员 turn 使用 agent capability，
    // 因而不会获得转派或最终裁决权限。
    const runtimeCapability: 'agent' | 'system' =
      ctx.ledgerActorAuthority === 'agent-inferred' ? 'agent' : 'system'
    const runtimeAdapters =
      discussionId != null
        ? createTeamRuntimeAdapters(
            this.db,
            {
              sessionId: ctx.sessionId,
              discussionId,
              actorId: ctx.hostAgent.id,
              capability: runtimeCapability,
            },
            ledgerAdapter ?? undefined,
          )
        : null
    let currentDiscussionRound = ctx.discussionRoundIndex ?? 0
    let discussionConcludedReason: 'concluded' | 'canceled' | 'max_rounds' | null = null

    const governanceHooks = createTeamDispatchGovernanceHooks(this.db, {
      sessionId: ctx.sessionId,
      ...(discussionId != null ? { discussionId } : {}),
      actorId: ctx.hostAgent.id,
    })

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
          onActivityChange: (sessionId) => this.handleTeamDispatchActivityChange(sessionId),
          ...(ctx.onDispatchBudgetExceeded != null
            ? { onDispatchBudgetExceeded: ctx.onDispatchBudgetExceeded }
            : {}),
          ...(ctx.deadlineAt != null ? { deadlineAt: ctx.deadlineAt } : {}),
          ...governanceHooks,
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
              ledgerActorAuthority: 'agent-inferred',
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
        inputs: z.record(z.string(), z.unknown()).optional(),
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
              inputs: z.record(z.string(), z.unknown()).optional(),
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
                  onActivityChange: (sessionId) => this.handleTeamDispatchActivityChange(sessionId),
                  ...(ctx.signal != null ? { signal: ctx.signal } : {}),
                  ...(ctx.deadlineAt != null ? { deadlineAt: ctx.deadlineAt } : {}),
                  ...governanceHooks,
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
                      ledgerActorAuthority: 'agent-inferred',
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
                skippedNodeIds: ReadonlySet<string>,
                failedNodeId?: string,
              ): void => {
                const nodes = ctx.workflowGraph!.nodes.map((node) => {
                  const meta = nodeMeta.get(node.id)
                  const status: import('@spark/protocol').WorkflowProgressNodeStatus =
                    node.id === failedNodeId
                      ? 'failed'
                      : completedNodeIds.has(node.id)
                        ? 'completed'
                        : skippedNodeIds.has(node.id)
                          ? 'skipped'
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
              let initialSkippedNodeIds: string[] | undefined
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
                  try {
                    const ids = JSON.parse(resumable.skipped_node_ids_json) as string[]
                    initialSkippedNodeIds = Array.isArray(ids)
                      ? ids.filter((id) => graphNodeIds.has(id))
                      : undefined
                  } catch {
                    initialSkippedNodeIds = undefined
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
                ...(initialSkippedNodeIds != null ? { initialSkippedNodeIds } : {}),
                onSnapshot: (snap) => {
                  if (runId != null) {
                    runRepo.updateSnapshot(runId, {
                      status: snap.status,
                      state: snap.state,
                      executions: snap.executions,
                      atomicExecutions: snap.atomicExecutions,
                      completedNodeIds: snap.completedNodeIds,
                      skippedNodeIds: snap.skippedNodeIds,
                      ...(snap.failedNode != null ? { failedNode: snap.failedNode } : {}),
                      ...(snap.status !== 'working' ? { endedAt: new Date().toISOString() } : {}),
                    })
                  }
                  emitWorkflowProgress(
                    snap.status,
                    new Set(snap.runningNodeIds),
                    new Set(snap.completedNodeIds),
                    new Set(snap.skippedNodeIds),
                    snap.failedNode?.nodeId,
                  )
                },
                executeAtomicNode: async (request) => {
                  // 原子节点按 kind 显式自执行：
                  // - verify：跑校验命令（runWorkflowVerifyNode）。
                  // - approval：经 onQuestion 暂停等待用户审批，拒绝则节点失败、停止工作流。
                  // - input：LLM 把 prompt/objective/constraint/value 拆解为结构化 JSON；派发失败或
                  //   LLM 输出非法 JSON 时回落透传 getDefaultWorkflowAtomicContent 并追加提示。
                  // - route：经纯 LLM 临时 worker 只输出 routeOptions 中的一个 value，用于条件边分流。
                  // - skill/tool/mcp/plan/review/artifact：config.execution!=='static' 时经临时受限
                  //   worker 真实派发单轮执行（skill 只挂 skillIds、tool 收窄 toolIds；MCP 使用
                  //   全局已启用集合；input/plan/review 使用只读工具集）；artifact 另外支持 exportPath 写盘。
                  //   配 execution:'static' 或该 kind 不在真实执行集内时，回落静态回显。
                  switch (request.kind) {
                    case 'verify':
                      return runWorkflowVerifyNode(request, ctx.workspaceRootPath)
                    case 'approval':
                      return this.runWorkflowApprovalNode(ctx.sessionId, request)
                    case 'input':
                    case 'route':
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
                      if (request.kind === 'route') {
                        const validated = validateWorkflowRouteDecisionContent(
                          reply.content,
                          request.config,
                        )
                        if (!validated.ok) {
                          log.warn('workflow route: invalid decision from LLM', {
                            sessionId: ctx.sessionId,
                            node: request.nodeId,
                            decision: validated.decision,
                          })
                          return {
                            state: 'failed',
                            content: reply.content,
                            error: {
                              code: 'workflow_route_invalid_output',
                              message: validated.message,
                            },
                          }
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
      ...(ledgerAdapter != null
        ? ledgerAdapter
            .buildToolDefinitions()
            .filter(
              (def) =>
                ctx.ledgerActorAuthority !== 'agent-inferred' ||
                def.name === 'team_ledger_read' ||
                def.name === 'team_ledger_propose',
            )
        : []),
      ...(runtimeAdapters != null ? buildTeamRuntimeToolDefinitions(runtimeAdapters) : []),
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
        ctx.signal != null || ctx.codexRuntimeLeaseKey != null
          ? {
              ...(ctx.signal != null ? { signal: ctx.signal } : {}),
              ...(ctx.codexRuntimeLeaseKey != null
                ? { runtimeLeaseKey: ctx.codexRuntimeLeaseKey }
                : {}),
            }
          : undefined,
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
      if (handle.runtimeResource != null) {
        this.codexRuntimeMcpResources.register(server, handle.runtimeResource)
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
    ledgerActorAuthority?: import('@spark/storage').RoomLedgerAuthority
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
      ledgerActorAuthority,
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
      if (row.enabled === 0) throw new Error(`Member provider profile is disabled: ${id}`)
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
      /** SDK resume 灰度开关（默认关）：显式 true 时允许第三方 Anthropic 兼容端点续会话。 */
      sdkResumeOptIn?: boolean
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
        estimatedTokens: estimateTokens(memberRouteMessage),
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
      const sessionModel = session.model_id?.trim() ?? ''
      const configuredModels = Array.isArray(providerConfig.modelIds)
        ? providerConfig.modelIds.filter((item): item is string => typeof item === 'string')
        : []
      const inheritedModel =
        sessionModel.length > 0 &&
        (configuredModels.length === 0 || configuredModels.includes(sessionModel))
          ? sessionModel
          : ''
      model = (
        isLocalCli
          ? getLocalCliDefaultModel(provider)
          : member.modelId?.trim() ||
            inheritedModel ||
            providerConfig.defaultModel ||
            providerConfig.model ||
            ''
      ).trim()
      if (!model) throw new Error('Member has no resolvable model')
    }
    const cliProvider = provider
    const activeCliSparkOverride = isLocalCli
      ? getCliSparkOverrideFromMetadata(session.metadata_json)
      : null
    let appliedCliSparkOverride: CliSparkOverride | null = null
    let apiKey = ''
    if (activeCliSparkOverride != null) {
      const overrideProvider = loadProvider(activeCliSparkOverride.providerProfileId)
      const overrideConfig = JSON.parse(overrideProvider.config_json) as typeof providerConfig
      const incompatible =
        isBuiltInLocalCliProvider(overrideProvider) ||
        getAutoRouterAdapterForProviderId(overrideProvider.id) != null ||
        !isCliSparkOverrideCompatible(cliProvider, overrideProvider, overrideConfig)
      if (!incompatible) {
        const validModels = getProviderModelIds(overrideProvider.config_json)
        if (!validModels.includes(activeCliSparkOverride.modelId)) {
          throw new Error(
            `Member model ${activeCliSparkOverride.modelId} is not configured for provider ${overrideProvider.id}`,
          )
        }
        if (overrideProvider.keystore_ref == null)
          throw new Error(`Member provider ${overrideProvider.id} has no keystore ref`)
        apiKey = await resolveProviderApiKey(overrideProvider)
        if (apiKey.length === 0)
          throw new Error(`Member provider API key not found for ${overrideProvider.id}`)
        provider = overrideProvider
        providerConfig = overrideConfig
        model = activeCliSparkOverride.modelId
        providerProfileId = overrideProvider.id
        appliedCliSparkOverride = activeCliSparkOverride
      }
    } else if (!isLocalCli) {
      if (provider.keystore_ref == null) throw new Error('Member provider has no keystore ref')
      apiKey = await resolveProviderApiKey(provider)
      if (apiKey.length === 0) throw new Error('Member provider API key not found')
    }
    // 峰谷定时禁用硬校验：member 的 provider/model 至此定值（含 override 分支）。
    assertModelNotScheduledBlocked(provider.config_json, model)
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
      cliSparkOverride: appliedCliSparkOverride != null,
      providerType: provider.provider_type,
      providerProfileId,
      providerName: provider.name,
      apiKey,
      codexApiKind: providerConfig.codexApiKind,
      apiEndpoint: providerConfig.apiEndpoint,
    })
    const { isCodexMember } = memberProfile
    const effectiveMemberMode = memberProfile.permissionMode
    // Workflow 的只读语义必须由显式能力标记表达，不能从 toolIds 是否非空反推。
    // tool/mcp 节点和普通 Agent 都可能主动配置 toolIds，但它们仍是可执行成员。
    const isReadonlyAtomicMember = member.metadata?.workflowCapability === 'readonly'

    // 团队成员运行在同一会话内，沿用 host 会话/项目级自定义环境变量：注入真实值供其工具引用，
    // 并把脱敏清单追加进成员系统提示词，避免成员泄露敏感信息。
    let memberCustomEnv: Record<string, string> | undefined
    let memberEnvPrompt = ''
    let memberSkillSystemPrompt: string | undefined
    try {
      // 三轮联合场景审查修复（Skill + Team）：member 也走 composeRuntimeContext 加载
      // 自己的 skillIds 对应的 skill system prompt，否则 member 看不到自己 agent 配置内
      // 启用的 skills（如 web-search / canvas-studio 等），无法主动调用。
      // 之前只调 getEnvConfig（env），完全忽略 skill 链路。
      const memberWorkspaceIds = sessionRepo.getWorkspaceIdsFromRow(session)
      const memberRuntimeContext = new RuntimeCompositionService(
        new SkillRepository(this.db),
        new SettingsRepository(this.db),
      ).composeRuntimeContext(
        {
          ...(memberWorkspaceIds[0] != null ? { workspaceId: memberWorkspaceIds[0] } : {}),
          sessionId,
          agentId: member.id,
        },
        undefined,
        {
          agentSkillIds: member.skillIds,
          agentDisabledSkillIds: member.disabledSkillIds,
        },
      )
      if (memberRuntimeContext.customEnv != null) {
        memberCustomEnv = memberRuntimeContext.customEnv
      }
      if (memberRuntimeContext.envSystemPrompt != null) {
        memberEnvPrompt = memberRuntimeContext.envSystemPrompt
      }
      if (
        memberRuntimeContext.skillSystemPrompt != null &&
        memberRuntimeContext.skillSystemPrompt.trim().length > 0
      ) {
        memberSkillSystemPrompt = memberRuntimeContext.skillSystemPrompt
      }
    } catch (err) {
      log.warn(
        `Member env + skill injection failed (non-fatal): ${
          err instanceof Error ? err.message : String(err)
        }`,
      )
    }
    // Member turn 注入 memory block（按 member.id scope），并在下方挂载与 Host 同源的
    // spark_memory MCP。提示词与真实工具能力必须一致，不能宣称存在 search/recall 却不提供。
    let memberWorkspaceId: string | undefined
    try {
      memberWorkspaceId = sessionRepo.getWorkspaceIdsFromRow(session)[0]
    } catch {
      // 旧库/精简测试仓储无该 helper 时按无 project scope 处理。
    }
    let memberMemoryBlock: string | undefined
    try {
      memberMemoryBlock = await this.loadMemoryBlockForTurn(
        sessionId,
        workspaceRootPath,
        memberWorkspaceId,
        member,
      )
    } catch (err) {
      log.warn(
        `Member memory injection failed (non-fatal): ${err instanceof Error ? err.message : String(err)}`,
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
          })
        : undefined
    // P1-2（缓存命中）：讨论线程快照与 ledger 摘要随讨论增长逐轮变化，原先拼进 member
    // system prompt，会让 canContinueDiscussionSession 续上的 SDK session 前缀每轮整体
    // 作废（continuity key 的设计意图被自身抵消）。现改为 per-dispatch 载荷——追加到发
    // 给执行器的 user message 尾部，内容逐字保留仅位置后移：member system 收敛为
    // (member, teamConfig, roster) 级稳定（member 记忆块已后置到段尾，记忆更新只影响
    // 尾部）。刻意不并入 memberRouteMessage：auto-router 分类（见上）与 memory 抽取
    // （见 maybeWriteMemoryFromTurn）只看任务本身，不看讨论上下文。
    const memberThreadContext =
      discussionId != null
        ? buildMemberDispatchThreadContext(
            this.getTeamDiscussionRepository().renderThreadForPrompt(
              discussionId,
              teamConfig.threadContextTokenBudget,
              member.id,
            ),
            new TeamLedgerRuntimeAdapter(this.db, {
              sessionId,
              discussionId,
              actorId: member.id,
              actorAuthority: 'agent-inferred',
              ...(teamConfig.threadContextTokenBudget != null
                ? { maxChars: Math.min(6000, teamConfig.threadContextTokenBudget * 4) }
                : {}),
            }).renderActiveSummary(),
          )
        : undefined
    const userMessage =
      memberThreadContext != null
        ? `${memberRouteMessage}\n\n${memberThreadContext}`
        : memberRouteMessage
    const canContinueDiscussionSession =
      discussionId != null &&
      !isCodexMember &&
      this.resumeGate.isSafe({
        ...(providerConfig.sdkResumeOptIn === true ? { providerOptIn: true } : {}),
        providerType: provider.provider_type,
        model,
        agentAdapter: memberAdapter,
        ...(providerConfig.apiEndpoint != null ? { apiEndpoint: providerConfig.apiEndpoint } : {}),
      })
    const stableMemberSessionId =
      discussionId != null
        ? this.resumeGate.makeRuntimeSessionId(
            sessionId,
            appliedCliSparkOverride != null
              ? `${cliProvider.id}::${providerProfileId}`
              : providerProfileId,
            model,
            memberAdapter,
            buildMemberContinuityKey(buildTeamContinuityScope(discussionId), member.id),
          )
        : null
    const memberSdkSessionId =
      canContinueDiscussionSession && stableMemberSessionId != null
        ? stableMemberSessionId
        : crypto.randomUUID()
    const usePersistentMemberCodexAppServer =
      stableMemberSessionId != null &&
      shouldUsePersistentCodexAppServer({
        enabled: isPersistentCodexRuntimeEnabled(),
        adapterKind: resolveEngineKind(memberAdapter),
        useLocalConfig: isLocalCli,
        ...(providerConfig.codexApiKind != null
          ? { codexApiKind: providerConfig.codexApiKind }
          : {}),
        hasImageAttachments: false,
      })
    const memberCodexRuntimeLeaseKey =
      usePersistentMemberCodexAppServer && stableMemberSessionId != null
        ? `member:${sessionId}:${stableMemberSessionId}`
        : null
    // 显式 readonly 原子节点从空能力集开始，避免在判断前加载用户自定义（可能写入型）MCP。
    // 普通 Team/Workflow tool/mcp 成员则与 Host 一致加载已启用的应用 MCP。
    let memberMcpServers = isReadonlyAtomicMember
      ? {}
      : await this.getMcpTooling().buildMcpServersForSDK()
    try {
      if (!isReadonlyAtomicMember) {
        const memberWebSearchServer =
          await this.getMcpTooling().resolveWebSearchMcpServer(workspaceRootPath)
        if (memberWebSearchServer != null) memberMcpServers.spark_search = memberWebSearchServer
        const memberMediaContext =
          await this.getMcpTooling().resolveMediaGenerationContext(workspaceRootPath)
        const memberImageContext =
          memberMediaContext == null
            ? await this.getMcpTooling().resolveImageGenerationContext(workspaceRootPath)
            : null
        const memberPlatformServer =
          await this.getMcpTooling().resolvePlatformManagementMcpServer(sessionId)
        const memberPresentFilesServer = resolvePresentFilesMcpServer(workspaceRootPath)
        if (memberMediaContext != null) {
          memberMcpServers.spark_media = memberMediaContext.mcpServer
        }
        if (memberImageContext != null) {
          memberMcpServers.spark_image = memberImageContext.mcpServer
        }
        if (memberPlatformServer != null) {
          memberMcpServers.spark_platform = memberPlatformServer
        }
        if (memberPresentFilesServer != null) {
          memberMcpServers.spark_files = memberPresentFilesServer
        }
        // 浏览器自动化：仅当 desktop 注入了 browserAutomationMcpProvider
        if (this.browserAutomationMcpProvider != null) {
          const memberBrowserServer = await this.browserAutomationMcpProvider(
            sessionId,
            workspaceRootPath,
          )
          if (memberBrowserServer != null) memberMcpServers.spark_browser = memberBrowserServer
        }
      }
      // spark_debug 对所有 member（含 readonly atomic）保持挂载——debug session 内
      // readonly atomic 也可能需要查询调试状态（如 spark_debug.get_hypotheses）。
      const memberDebugModeEnabled = getDebugModeFromMetadata(session.metadata_json)
      if (memberDebugModeEnabled) {
        const memberDebugServer = await this.getMcpTooling().resolveDebugMcpServer(
          sessionId,
          workspaceRootPath,
        )
        if (memberDebugServer != null) memberMcpServers.spark_debug = memberDebugServer
      }
    } catch (err) {
      log.warn(
        `Member conditional MCP load failed (non-fatal): ${
          err instanceof Error ? err.message : String(err)
        }`,
      )
    }

    // Memory 是只读检索能力。Claude SDK 使用进程内 MCP；Codex/CLI 使用 stdio bridge。
    if (isCodexMember) {
      const memoryServer = await this.getMcpTooling().resolveSparkMemoryMcpServer(
        sessionId,
        workspaceRootPath,
        member.id,
      )
      if (memoryServer != null) memberMcpServers.spark_memory = memoryServer
    } else {
      await this.attachSparkMemoryMcpServer(
        sessionId,
        {
          workspaceRootPath,
          ...(memberWorkspaceId != null ? { primaryWorkspaceId: memberWorkspaceId } : {}),
          agentId: member.id,
        },
        memberMcpServers,
      )
    }
    // 成员同样可以进入 worktree 开发：挂载 worktree 状态上报工具
    // （Codex/CLI 走 stdio，Claude SDK 走 in-process）。
    if (isCodexMember) {
      try {
        const memberSessionServer = await this.resolveSparkSessionMcpServer(sessionId)
        if (memberSessionServer != null) memberMcpServers.spark_session = memberSessionServer
      } catch (err) {
        log.warn(
          `member spark_session MCP setup failed (non-fatal): ${
            err instanceof Error ? err.message : String(err)
          }`,
        )
      }
    } else {
      await this.attachSparkSessionMcpServer(sessionId, memberMcpServers)
    }
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
          ...(ledgerActorAuthority != null ? { ledgerActorAuthority } : {}),
          ...(memberCodexRuntimeLeaseKey != null
            ? { codexRuntimeLeaseKey: memberCodexRuntimeLeaseKey }
            : {}),
        })) ?? undefined
      if (memberTeamServer != null) memberMcpServers.spark_team = memberTeamServer
    }

    memberMcpServers = governMcpServers(memberMcpServers, {
      workspaceRootPath,
      nodeExecutable: tryResolveMcpNodeRuntimeExecutable(),
      proxyServerPath: resolveToolResultProxyMcpServerPath(),
      readerServer: resolveToolResultReaderMcpServer(workspaceRootPath),
    })

    const memberSystemPrompt =
      joinPromptSections(
        APPLICATION_FOUNDATION_SYSTEM_PROMPT,
        buildManagedAgentSystemPrompt(member, null),
        memberTeamPrompt,
        memberEnvPrompt || undefined,
        memberMcpServers.spark_files != null ? PRESENT_FILES_SYSTEM_PROMPT : undefined,
        memberMcpServers.spark_tool_results != null ? TOOL_RESULT_SYSTEM_PROMPT : undefined,
        memberMcpServers.spark_platform != null ? PLATFORM_MANAGEMENT_SYSTEM_PROMPT : undefined,
        memberMcpServers.spark_platform != null ? SESSION_SCHEDULE_AGENT_SYSTEM_PROMPT : undefined,
        memberMcpServers.spark_debug != null ? DEBUG_MODE_SYSTEM_PROMPT : undefined,
        // 记忆三段后置到段尾（与 host 路径同构，内容不变仅段序）：member 记忆在
        // dispatch 完成后可能被抽取更新，放中段会让 member system 从中部开始前缀
        // 作废、抵消续会话收益；后置后记忆变化只影响尾部。
        memberMemoryBlock,
        memberMcpServers.spark_memory != null ? MEMORY_BEHAVIOR_SYSTEM_PROMPT : undefined,
        memberMcpServers.spark_memory != null ? MEMORY_PROVENANCE_SYSTEM_PROMPT : undefined,
      ) ?? ''

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
      ...(!isReadonlyAtomicMember && memberSkillSystemPrompt != null
        ? { skillSystemPrompt: memberSkillSystemPrompt }
        : {}),
      ...(memberCustomEnv != null ? { customEnv: memberCustomEnv } : {}),
      ...(Object.keys(memberMcpServers).length > 0 ? { mcpServers: memberMcpServers } : {}),
      ...(memberCodexRuntimeLeaseKey != null
        ? this.codexRuntimeMcpResources.buildConfig([memberTeamServer])
        : {}),
      ...(!isCodexMember && !isReadonlyAtomicMember
        ? (() => {
            const plugins = this.resolveNativeSkillPlugins()
            return plugins != null ? { skillPlugins: plugins, nativeSkills: 'all' as const } : {}
          })()
        : {}),
      // 三轮联合场景审查修复（Reasoning + Member）：member 继承 agent 配置的
      // reasoningEffort，否则 member 用 SDK 默认（standard），违背用户在 agent 上
      // 配置 max/high 的意图。createWorkflowSubagentMember 已让 atomic member
      // 继承 hostAgent.reasoningEffort，真实 team member 自己有 reasoningEffort 字段。
      ...(member.reasoningEffort != null
        ? { reasoningEffort: normalizeReasoningEffort(member.reasoningEffort) }
        : {}),
      ...(normalizeReasoningBudgetTokens(member.metadata.reasoningBudgetTokens) != null
        ? {
            reasoningBudgetTokens: normalizeReasoningBudgetTokens(
              member.metadata.reasoningBudgetTokens,
            ),
          }
        : {}),
      // 三轮功能逻辑审查修复（产品逻辑维度）：member dispatch 必须有 iteration limit。
      // SDK 默认 maxTurns=200，单个 member dispatch 跑 200 turn 会消耗巨量 token，
      // 且 dispatch timeout 限制总时间但不限制 iterations。设 maxTurnCount=30 让单个
      // member 任务最多 30 turn，足够完成多数子任务，避免 member 失控。
      // 节点级覆盖：node config.maxTurnCount 优先（如 review/input 节点可能需要更少）。
      maxTurnCount:
        typeof member.metadata?.maxTurnCount === 'number' &&
        Number.isFinite(member.metadata.maxTurnCount) &&
        member.metadata.maxTurnCount > 0
          ? Math.min(50, Math.floor(member.metadata.maxTurnCount))
          : 30,
      // A-03 细致审查修复：member allowedTools 必须包含所有已加载 MCP 的工具，否则
      // SDK 视为非免审批 → member 在 unattended dispatch 时卡在 approval 等待。
      // 镜像 Host 路径（line 3253-3295）按 mcpServers 实际加载的工具构建 allowedTools。
      allowedTools: mergeUniqueStrings(
        this.buildMemberAllowedTools(memberMcpServers, memberTeamServer),
        memberMcpServers.spark_tool_results != null ? TOOL_RESULT_TOOL_NAMES : [],
      ),
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
      ...(memberCodexRuntimeLeaseKey != null && stableMemberSessionId != null
        ? buildPersistentCodexAppServerConfig({
            runtimeLeaseKey: memberCodexRuntimeLeaseKey,
            bindingKey: scopeCodexNativeThreadBindingKey(
              stableMemberSessionId,
              readCodexNativeThreadGeneration(session.metadata_json),
            ),
            metadataJson: session.metadata_json,
            onBinding: (binding) => {
              const patch = createCodexNativeThreadMetadataPatch(
                sessionRepo.getMetadata(sessionId),
                binding,
              )
              sessionRepo.patchMetadata(sessionId, patch)
            },
          })
        : isCodexMember
          ? { codexRuntimeLeaseKey: `member:${sessionId}:${dispatchId}` }
          : {}),
      ...(this.onHookTrigger != null ? { applicationHookCallback: this.onHookTrigger } : {}),
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
              const releaseQuestionGate = this.pendingUserQuestionGate.enter(sid)
              this.emitAgentStatusEvent(sid, turnId, eventRepo, 'waiting_user')
              try {
                return await this.onQuestion!(sid, questions, { ...context, turnId })
              } finally {
                releaseQuestionGate()
                this.emitAgentStatusEvent(sid, turnId, eventRepo, 'thinking')
                if (!this.pendingUserQuestionGate.isBlocked(sid)) {
                  setTimeout(() => this.startNextQueuedTurn(sid), 0)
                }
              }
            },
          }
        : {}),
    }

    // FR-0a：按成员 adapter 经引擎注册表解析执行器（P1-W1-D5；codex 载具三选一
    // 收敛在 codex descriptor 内）。四执行器 onEvent/cancel/executeTurn 签名一致，监听复用。
    const executor = this.engineRegistry.resolveExecutor(memberAdapter, sdkConfig)

    // 按 segment 收集 member 多段正文（被工具调用分隔的每段文本）。
    // 给 Host 的最终 content 拼接所有段，避免最后一段 result 覆盖前面段。
    const segments: Array<{ id: string | undefined; text: string }> = []
    let finalResultText = ''
    let deltaText = ''
    let inputTokens: number | undefined
    let outputTokens: number | undefined
    let memberError: string | undefined
    const memberObservedFileChangeKeys = this.getTurnFileChangeKeys(sessionId, turnId)
    const makeBase = () => ({
      id: crypto.randomUUID(),
      sessionId,
      turnId,
      timestamp: new Date().toISOString(),
      seq: 0,
    })
    executor.onEvent((event) => {
      if (event.type === 'file_change') {
        const key = workspaceRelativeChangeKey(workspaceRootPath, event.path)
        if (key != null) memberObservedFileChangeKeys.add(key)
      }
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
        // SDK usage_update 是累计快照；按 dispatch 隔离 delta 状态，避免多次快照重复计费，
        // 也避免覆盖同一 Host turn 的累计基线。Provider/Model 必须使用成员实际路由结果。
        this.usageLedger.recordUpdate(sessionId, turnId, event, {
          sourceKey: `member:${dispatchId}`,
          providerId: providerProfileId,
          modelId: model,
        })
      } else if (event.type === 'agent_error') {
        memberError = event.message
      } else if (
        event.type === 'agent_thinking' ||
        event.type === 'tool_call' ||
        event.type === 'tool_result' ||
        event.type === 'file_change' ||
        event.type === 'terminal_output'
      ) {
        // 透传时重写 base 字段（seq 由 emitAndPersist 覆盖），保留原事件 payload
        const outgoing = governAgentToolResultEvent(
          {
            ...event,
            sessionId,
            turnId,
            seq: 0,
            teamMemberContext: { dispatchId, memberAgentId: member.id },
          },
          workspaceRootPath,
        )
        this.emitAndPersist(sessionId, turnId, outgoing, eventRepo)
      }
      const reportedChanges = extractReportedFileChanges(event, workspaceRootPath)
      if (reportedChanges != null) {
        for (const change of reportedChanges) {
          const key = workspaceRelativeChangeKey(workspaceRootPath, change.path)
          if (key == null || memberObservedFileChangeKeys.has(key)) continue
          memberObservedFileChangeKeys.add(key)
          this.emitAndPersist(
            sessionId,
            turnId,
            {
              ...makeBase(),
              type: 'file_change',
              path: change.path,
              changeType: change.changeType,
              ...(change.oldPath != null ? { oldPath: change.oldPath } : {}),
              collectionSource: 'agent_manifest',
              teamMemberContext: { dispatchId, memberAgentId: member.id },
            },
            eventRepo,
          )
        }
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
    // 三轮联合场景审查修复（Memory + Team）：member turn 完成后触发 memory 抽取
    // （按 member scope）。之前 member 回复不被 maybeWriteMemoryFromTurn 捕获——
    // Host 路径的 collectCompleteAssistantTurnText 只聚合 assistant_message 事件，
    // 不含 team_member_message。结果：member 的技术决策、用户偏好发现等不被记忆。
    // 这里按 member.id scope 触发抽取，与 Host 路径独立（不冲突，scope 不同）。
    if (content.trim().length > 0) {
      void this.maybeWriteMemoryFromTurn(
        sessionId,
        sessionRepo.getWorkspaceIdsFromRow(session)[0] ?? '',
        member.id,
        workspaceRootPath,
        memberRouteMessage,
        content,
      ).catch(() => {
        /* swallow — never affect member dispatch flow */
      })
    }
    return {
      content,
      ...(aborted ? { partial: true } : {}),
      ...(inputTokens != null ? { inputTokens } : {}),
      ...(outputTokens != null ? { outputTokens } : {}),
    }
  }

  /** 清除用量累计基线；委托 session-usage-ledger（P1-W3-S6）。命令系统 host 回调沿用此公共入口。 */
  clearUsageLedgerTurnState(sessionId: string, turnId?: string): void {
    this.usageLedger.clearTurnState(sessionId, turnId)
  }
  private emitAndPersist(
    sessionId: string,
    turnId: string,
    event: AgentEvent,
    eventRepo: EventRepository,
  ): void {
    // cancelTurn 先登记 turn，再取消 executor；这样同步/异步回调都不能在用户取消
    // 之后继续写入旧 turn。唯一允许穿过闸门的是我们自己补发的 cancelled 终态事件。
    if (
      this.turnRegistry.isTurnCancelled(turnId) &&
      !(event.type === 'agent_status' && event.status === 'cancelled')
    ) {
      return
    }
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
      this.usageLedger.recordUpdate(sessionId, turnId, event)
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
        this.usageLedger.clearTurnState(sessionId, turnId)
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
    if (
      !TERMINAL_AGENT_STATUSES.has(status) &&
      (this.turnRegistry.isTurnCancelled(turnId) || !this.turnRegistry.hasActiveSession(sessionId))
    ) {
      return
    }
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
      const trackedExecutions = this.turnRegistry.trackedExecutions()
      const executions = new Set<ActiveExecution>([
        ...trackedExecutions.map((tracked) => tracked.executor),
        ...this.turnRegistry.snapshotExecutors(),
      ])
      const sessionIds = new Set([
        ...trackedExecutions.map((tracked) => tracked.sessionId),
        ...this.turnRegistry.activeLoops.keys(),
      ])

      for (const sessionId of sessionIds) this.onApprovalCancel?.(sessionId)
      const teamDispatchShutdown = this.teamDispatchService?.cancelAllAndWait()
      for (const execution of executions) execution.cancel()
      this.turnRegistry.clearAll()
      this.teamDispatchBudgetExhaustedTurns.clear()
      this.teamDispatchAutoContinuationTracker.clear()
      this.pendingTurns.clear()
      this.pendingPlanApprovals.clear()
      this.pendingUserQuestionGate.clear()

      const pending = [
        ...trackedExecutions.map((tracked) => tracked.promise),
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

      await this.engineRegistry.dispose()
      await this.platformBridge.stop()
      // FR-0b 修复（审查 B-3）：进程退出时关停所有残留桥接会话 + HTTP server。
      for (const turnId of this.teamMcpHandlesByTurn.keys()) {
        this.closeTeamMcpHandlesForTurn(turnId)
      }
      await getTeamMcpHttpBridge().dispose()
      await this.pluginRuntimeMcpBridge?.dispose()
    })()
    return this.disposePromise
  }

  /** FR-0b 修复（审查 B-1）：关闭某 turn 期间创建的所有 codex HTTP 桥接 handle（防 leak）。 */
  private closeTeamMcpHandlesForTurn(turnId: string): void {
    const handles = this.teamMcpHandlesByTurn.get(turnId)
    if (handles != null) {
      this.teamMcpHandlesByTurn.delete(turnId)
      for (const handle of handles) {
        void handle.close().catch((err: unknown) => {
          log.warn('team MCP bridge handle close failed during turn cleanup', err)
        })
      }
    }
    this.closePluginRuntimeMcpHandlesForTurn(turnId)
  }

  private closePluginRuntimeMcpHandlesForTurn(turnId: string): void {
    const handles = this.pluginRuntimeMcpHandlesByTurn.get(turnId)
    if (handles == null) return
    this.pluginRuntimeMcpHandlesByTurn.delete(turnId)
    for (const handle of handles) {
      void handle.close().catch((err: unknown) => {
        log.warn('plugin runtime MCP bridge handle close failed during turn cleanup', err)
      })
    }
  }

  getQueueState(params: { sessionId: string }): SessionGetQueueResponse {
    // queueSnapshot 是当前主进程的执行权威。若库中仍残留 running，在返回给 UI 前
    // 一次性补齐断流终态并复位，避免历史会话长期显示无法取消的幽灵 spinner。
    this.reconcileZombieRunningSession(params.sessionId)
    return this.queueSnapshot(params.sessionId)
  }

  getCodexRuntimeDiagnostics() {
    return this.engineRegistry.getCodexRuntimeDiagnostics()
  }

  restartIdleCodexRuntimes(leaseKey?: string) {
    return this.engineRegistry.restartIdleCodexRuntimes(leaseKey)
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
   * 清空当前会话尚未启动的队列。这里只移除 pendingTurns，并将对应的持久化请求标记为
   * cancelled；activeLoops / team dispatch 不在此操作范围内，因此不会中断正在执行的任务。
   */
  clearQueuedTurns(params: { sessionId: string }): SessionClearQueuedTurnsResponse {
    const queue = this.pendingTurns.get(params.sessionId) ?? []
    if (queue.length === 0) {
      return { cancelledCount: 0, queuedTurns: this.queueSnapshot(params.sessionId).queuedTurns }
    }

    // 清空后不应因本轮团队预算耗尽状态再次自动补入隐藏 continuation。
    this.resetTeamDispatchAutoContinuation(params.sessionId)
    this.pendingTurns.delete(params.sessionId)
    const requestRepo = new TurnRequestRepository(this.db)
    for (const turn of queue) requestRepo.cancel(turn.turnId)
    this.emitQueueChanged(params.sessionId)

    return {
      cancelledCount: queue.length,
      queuedTurns: this.queueSnapshot(params.sessionId).queuedTurns,
    }
  }

  /**
   * Reorders only turns that are still pending. The active executor is not part of pendingTurns,
   * so changing this order cannot interrupt or replace the currently running turn.
   */
  reorderQueuedTurns(params: {
    sessionId: string
    turnIds: string[]
  }): SessionReorderQueuedTurnsResponse {
    const queue = this.pendingTurns.get(params.sessionId) ?? []
    const currentIds = queue.map((turn) => turn.turnId)
    const requestedIds = params.turnIds
    const currentIdSet = new Set(currentIds)
    const requestedIdSet = new Set(requestedIds)
    const isValidOrder =
      requestedIds.length === currentIds.length &&
      requestedIdSet.size === currentIdSet.size &&
      requestedIds.every((turnId) => currentIdSet.has(turnId))

    if (!isValidOrder) {
      const snapshot = this.queueSnapshot(params.sessionId)
      return {
        changed: false,
        running: snapshot.running,
        queuedTurns: snapshot.queuedTurns,
      }
    }

    const changed = requestedIds.some((turnId, index) => turnId !== currentIds[index])
    if (changed) {
      const turnsById = new Map(queue.map((turn) => [turn.turnId, turn]))
      const reorderedQueue = requestedIds.flatMap((turnId) => {
        const turn = turnsById.get(turnId)
        return turn == null ? [] : [turn]
      })
      this.pendingTurns.set(params.sessionId, reorderedQueue)
      this.emitQueueChanged(params.sessionId)
    }

    const snapshot = this.queueSnapshot(params.sessionId)
    return { changed, running: snapshot.running, queuedTurns: snapshot.queuedTurns }
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
    this.resetTeamDispatchAutoContinuation(sessionId)
    let queue = this.pendingTurns.get(sessionId) ?? []
    let targetIdx = queue.findIndex((t) => t.turnId === turnId)
    if (targetIdx === -1) {
      return { started: false, queuedTurns: this.queueSnapshot(sessionId).queuedTurns }
    }
    // Explicitly prioritizing a visible queued turn also cancels any older
    // continuation that was waiting behind the concurrency/member-dispatch gate.
    if (queue[targetIdx]?.isTeamDispatchAutoContinuation !== true) {
      this.removeQueuedTeamDispatchAutoContinuations(sessionId)
      queue = this.pendingTurns.get(sessionId) ?? []
      targetIdx = queue.findIndex((t) => t.turnId === turnId)
      if (targetIdx === -1) {
        return { started: false, queuedTurns: this.queueSnapshot(sessionId).queuedTurns }
      }
    }
    const targetTurn = queue.splice(targetIdx, 1)[0]!

    // 没有正在执行的任务 → 直接启动
    if (!this.turnRegistry.hasActiveSession(sessionId)) {
      queue.unshift(targetTurn)
      this.pendingTurns.set(sessionId, queue)
      this.pendingPlanApprovals.delete(sessionId)
      this.emitQueueChanged(sessionId)
      setTimeout(() => this.startNextQueuedTurn(sessionId), 0)
      return { started: true, queuedTurns: this.queueSnapshot(sessionId).queuedTurns }
    }

    // 中断当前正在执行的任务（不清理队列）
    const loop = this.turnRegistry.executorFor(sessionId)!
    const eventRepo = new EventRepository(this.db)
    const interruptedTurnId =
      this.turnRegistry.runningTurnId(sessionId) ?? getLatestTurnIdFromEvents(eventRepo, sessionId)
    this.turnRegistry.markTurnCancelled(interruptedTurnId)
    this.onApprovalCancel?.(sessionId)
    // 仅收本会话的 team dispatch，避免误伤其他会话（原为 cancelAll）
    this.teamDispatchService?.cancelBySession(sessionId)
    loop.cancel()
    this.turnRegistry.forceRelease(sessionId, interruptedTurnId)

    // 被插队打断的那一轮必须留下终结事件，否则时间线上是一段无解释的断尾：
    // 消息停在半截、没有终态 agent_status，回放时还会被当成"仍在运行"。
    this.emitAndPersist(
      sessionId,
      interruptedTurnId,
      createUserCancelledTurnEvent(sessionId, interruptedTurnId),
      eventRepo,
    )

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

  /** Remove queued internal continuations without touching visible/user turns. */
  private removeQueuedTeamDispatchAutoContinuations(sessionId: string): boolean {
    const queue = this.pendingTurns.get(sessionId)
    if (queue == null || queue.length === 0) return false
    const nextQueue = queue.filter((turn) => turn.isTeamDispatchAutoContinuation !== true)
    if (nextQueue.length === queue.length) return false
    if (nextQueue.length === 0) this.pendingTurns.delete(sessionId)
    else this.pendingTurns.set(sessionId, nextQueue)
    this.emitQueueChanged(sessionId)
    return true
  }

  private makePendingTurn(
    turnId: string,
    message: string,
    runtimePatch?: SessionRuntimePatch,
    skillId?: string,
    skillParams?: Record<string, unknown>,
    attachments?: SessionAttachment[],
    mentionAgentId?: string,
    userMessagePresentation?: UserMessagePresentation,
    sessionReferences?: SessionReferenceInput[],
    isTeamDispatchAutoContinuation = false,
  ): PendingTurn {
    return {
      turnId,
      message,
      enqueuedAt: new Date().toISOString(),
      ...(attachments != null && attachments.length > 0 ? { attachments } : {}),
      ...(sessionReferences != null && sessionReferences.length > 0 ? { sessionReferences } : {}),
      ...(runtimePatch != null ? { runtimePatch } : {}),
      ...(skillId != null ? { skillId } : {}),
      ...(skillParams != null ? { skillParams } : {}),
      ...(mentionAgentId != null ? { mentionAgentId } : {}),
      ...(isTeamDispatchAutoContinuation ? { isTeamDispatchAutoContinuation: true } : {}),
      ...userMessagePresentation,
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
    if (this.pendingUserQuestionGate.isBlocked(sessionId)) {
      this.emitQueueChanged(sessionId)
      return
    }
    if (
      this.hasActiveSessionExecution(sessionId) ||
      this.turnRegistry.isSessionStarting(sessionId)
    ) {
      this.emitQueueChanged(sessionId)
      return
    }
    // 全局并发上限：跨所有会话统计正在跑的执行器。超限时本 session 的 turn 留在
    // 队列里，等任意一个执行器结束（continueGoalOrQueue → schedulePendingQueuesGlobally）时重新调度。
    // 不阻断同一 session 自己的队列推进——上面那个 activeLoops.has 检查已经保证了
    // 单 session 串行；这里只压全局并行度。
    //
    // startingSessions 也要算：那是"已决定起跑、执行器尚未注册进 activeLoops"的过渡态，
    // 窗口虽短（一次事件循环），但多 session 同时被调度时会让实际并行度短暂超限。
    const inflight = this.turnRegistry.inflightSessionCount()
    if (inflight >= this.maxConcurrentSessions) {
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
    this.turnRegistry.beginStarting(sessionId, next.turnId)
    this.emitQueueChanged(sessionId)
    void this.startTurn(
      sessionId,
      next.turnId,
      next.message,
      pickUserMessagePresentation(next),
      next.runtimePatch,
      next.skillId,
      next.skillParams,
      next.attachments,
      next.mentionAgentId,
      undefined,
      next.isTeamDispatchAutoContinuation === true,
      next.sessionReferences,
    )
      .catch((error) => this.handleQueuedTurnStartFailure(sessionId, next, error))
      .finally(() => {
        this.turnRegistry.finishStartingForce(sessionId, next.turnId)
        if (!this.turnRegistry.hasActiveSession(sessionId)) this.startNextQueuedTurn(sessionId)
      })
  }

  private handleQueuedTurnStartFailure(sessionId: string, turn: PendingTurn, error: unknown): void {
    const eventRepo = new EventRepository(this.db)
    const sessionRepo = new SessionRepository(this.db)
    // startTurn 可能在 executor 注册为 active 后、真正 executeTurn 前的异步预处理阶段失败。
    // 此时若只写错误事件，activeLoops 会一直让 renderer 认为会话仍在运行。
    const activeLoop = this.turnRegistry.executorFor(sessionId)
    if (activeLoop != null) {
      activeLoop.cancel()
      this.turnRegistry.forceRelease(sessionId, turn.turnId)
    }
    this.teamDispatchService?.clearTurn(turn.turnId)
    this.closeTeamMcpHandlesForTurn(turn.turnId)
    const existing = eventRepo.queryBySession({ sessionId, turnId: turn.turnId, limit: 200 }).events
    const eventTypes = new Set(existing.map((item) => item.event_type))
    const hasTerminalStatus = existing.some((item) => {
      if (item.event_type !== 'agent_status') return false
      try {
        const status = (JSON.parse(item.event_json) as { status?: string }).status
        return status === 'completed' || status === 'error' || status === 'cancelled'
      } catch {
        return false
      }
    })
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
      this.emitAndPersist(
        sessionId,
        turn.turnId,
        {
          ...base(),
          type: 'user_message',
          content: turn.message,
          ...(turn.attachments ? { attachments: turn.attachments } : {}),
          ...(turn.sessionReferences != null && turn.sessionReferences.length > 0
            ? { sessionReferences: turn.sessionReferences }
            : {}),
          ...pickUserMessagePresentation(turn),
        },
        eventRepo,
      )
    }
    if (!eventTypes.has('agent_error')) {
      this.emitAndPersist(
        sessionId,
        turn.turnId,
        {
          ...base(),
          type: 'agent_error',
          code: isPlatformCredentialError ? 'PLATFORM_CREDENTIAL_UNAVAILABLE' : 'TURN_START_FAILED',
          message,
          retryable: true,
        },
        eventRepo,
      )
    }
    if (!hasTerminalStatus) {
      this.emitAndPersist(
        sessionId,
        turn.turnId,
        {
          ...base(),
          type: 'agent_status',
          status: 'error',
          message: isPlatformCredentialError
            ? '平台模型凭据暂不可用，请在账号中心选择“在本机继续”后重试'
            : 'Queued turn failed to start',
        },
        eventRepo,
      )
    }
    sessionRepo.updateStatus(sessionId, 'error')
    new TurnRequestRepository(this.db).markFailed(turn.turnId, message)
    log.error('queued turn failed to start', { sessionId, turnId: turn.turnId, error: message })
  }

  private queueSnapshot(sessionId: string): SessionGetQueueResponse {
    return {
      sessionId: sessionId as SessionId,
      running:
        this.turnRegistry.hasActiveSession(sessionId) ||
        this.turnRegistry.isSessionStarting(sessionId) ||
        this.teamDispatchService?.hasActiveDispatches(sessionId) === true,
      queuedTurns: this.toQueuedTurns(this.pendingTurns.get(sessionId) ?? []),
    }
  }

  private hasActiveSessionExecution(sessionId: string): boolean {
    return (
      this.turnRegistry.hasActiveSession(sessionId) ||
      this.teamDispatchService?.hasActiveDispatches(sessionId) === true
    )
  }

  private handleTeamDispatchActivityChange(sessionId: string): void {
    this.reconcileSessionExecutionStatus(sessionId)
    if (!this.queueSnapshot(sessionId).running) {
      setTimeout(() => this.startNextQueuedTurn(sessionId), 0)
    }
  }

  private reconcileSessionExecutionStatus(sessionId: string): void {
    const snapshot = this.queueSnapshot(sessionId)
    const sessionRepo = new SessionRepository(this.db)
    if (sessionRepo.get(sessionId) == null) return
    if (snapshot.running) {
      sessionRepo.updateStatus(sessionId, 'running')
    } else {
      const deferredTerminalStatus = this.deferredHostTerminalStatus.get(sessionId)
      this.deferredHostTerminalStatus.delete(sessionId)
      if (deferredTerminalStatus === 'error') {
        sessionRepo.updateStatus(sessionId, 'error')
      } else if (sessionRepo.get(sessionId)?.status === 'running') {
        sessionRepo.updateStatus(sessionId, 'idle')
      }
    }
    this.onQueueChanged?.(snapshot)
  }

  private updateStatusAfterHostTerminal(
    sessionRepo: SessionRepository,
    sessionId: string,
    status: AgentStatusValue,
  ): void {
    if (this.teamDispatchService?.hasActiveDispatches(sessionId) === true) {
      this.deferredHostTerminalStatus.set(sessionId, status)
      sessionRepo.updateStatus(sessionId, 'running')
      return
    }
    this.deferredHostTerminalStatus.delete(sessionId)
    sessionRepo.updateStatus(sessionId, status === 'error' ? 'error' : 'idle')
  }

  private toQueuedTurns(turns: PendingTurn[]): SessionQueuedTurn[] {
    return turns.map((turn) => ({
      turnId: turn.turnId,
      message: turn.message,
      enqueuedAt: turn.enqueuedAt,
      ...(turn.attachments != null ? { attachments: turn.attachments } : {}),
      ...(turn.sessionReferences != null
        ? {
            sessionReferences: turn.sessionReferences.map((reference) => ({
              sourceSessionId: reference.sourceSessionId as SessionId,
              ...(reference.snapshotSeq !== undefined
                ? { snapshotSeq: reference.snapshotSeq }
                : {}),
            })),
          }
        : {}),
      ...pickUserMessagePresentation(turn),
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
  applyApprovalToggle(sessionId: string, enabled: boolean): void {
    const sessionRepo = new SessionRepository(this.db)
    const isCodex = isCodexPermissionMode(sessionRepo.get(sessionId)?.permission_mode)
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
      // 仅 spark-loop 由 Spark 泵迭代。codex-native 的目标循环由 codex 侧自驱
      // （features.goals=true），Spark 若每轮 turn 结束都再派发一次 /goal <objective>，
      // 会无限重复派发（codex 不产出 spark-goal-status 块，goal 永远停在 active）。
      // codex-native：单次派发后不再自动续跑，用户消息按普通队列排空。
      if (goal.mode === 'spark-loop') {
        await this.startGoalLoop(sessionId)
        return
      }
    }
    this.startNextQueuedTurn(sessionId)
    // 全局并发上限可能让其他 session 的队列被阻塞；本 turn 结束腾出一个槽位，
    // 扫一遍所有有待发队列的 session，让它们重新尝试调度。
    this.schedulePendingQueuesGlobally()
  }

  /**
   * 全局队列调度：在并发上限内让每个有待发队列的 session 都有机会起跑。
   *
   * startNextQueuedTurn 本身有上限检查（activeLoops.size >= max），所以这里
   * 只是无脑遍历——超限的 session 会在自己的 startNextQueuedTurn 里被挡住并保留队列。
   * 用 setTimeout(0) 避免在 finally 链里同步触发大量 IPC 推送。
   */
  private schedulePendingQueuesGlobally(): void {
    if (this.disposing) return
    if (this.pendingTurns.size === 0) return
    setTimeout(() => {
      if (this.disposing) return
      // 排序保证可预测：按入队时间最早的 turn 优先（FIFO 跨 session 公平）
      const candidates: Array<{ sessionId: string; enqueuedAt: number }> = []
      for (const [sid, queue] of this.pendingTurns.entries()) {
        if (queue.length === 0) continue
        const first = queue[0]
        if (first == null) continue
        candidates.push({ sessionId: sid, enqueuedAt: Date.parse(first.enqueuedAt) || 0 })
      }
      candidates.sort((a, b) => a.enqueuedAt - b.enqueuedAt)
      for (const { sessionId: sid } of candidates) {
        // 必须算上 startingSessions：startNextQueuedTurn 调完后 startingSessions.add 是同步的，
        // 但 activeLoops.set 要等异步 startTurn 内部才发生。只看 activeLoops.size 会让循环
        // 放行全部 candidates——全局上限形同虚设。
        if (this.turnRegistry.inflightSessionCount() >= this.maxConcurrentSessions) break
        this.startNextQueuedTurn(sid)
      }
    }, 0)
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
    this.emitGoalEvent(
      sessionId,
      updated,
      'goal_progress',
      'active',
      parsed.summary,
      {
        phase: parsed.phase,
        ...(parsed.evidence != null ? { evidence: parsed.evidence } : {}),
        ...(parsed.nextStep != null ? { nextStep: parsed.nextStep } : {}),
      },
      undefined,
      'iteration_result',
    )
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
    attachments?: SessionAttachment[]
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
    const goalAttachments = normalizeTurnAttachments(params.attachments)
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
    // /goal 命令走 executeCommandAsEvents，不经过 dispatchTurn 的首轮标题派生与
    // firstTurnTitleContext 捕获——goal 会话的 LLM 标题精炼在此主动补挂一次
    //（fire-and-forget；标题已被手动改名时由 refineSessionTitleAsync 内部守卫拦截）。
    void this.refineGoalSessionTitleAsync(params.sessionId, goal.objective)
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
        GOAL_CONTRACT_DRAFT_TURN_PRESENTATION,
        this.goalSyntheticTurnRuntimePatch(params.sessionId),
        undefined,
        undefined,
        goalAttachments,
      )
      return { goal: toProtocolGoal(repo.getCurrent(params.sessionId)) }
    }
    this.emitGoalEvent(params.sessionId, goal, 'goal_started', 'active', 'Goal started')
    await this.startGoalLoop(params.sessionId, goalAttachments)
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
    this.turnRegistry.executorFor(params.sessionId)?.cancel()
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
    action: 'pause' | 'resume' | 'clear' | 'complete' | 'confirm' | 'reject'
    summary?: string
  }): Promise<SessionGoalResponse> {
    const repo = new GoalRepository(this.db)
    const goal = repo.getCurrent(params.sessionId)
    if (goal == null) return { goal: null }
    // 契约确认/拒绝复用 goal-control 通道，渲染端内联契约卡片按钮直接调用。
    if (params.action === 'confirm') {
      return this.confirmGoalContract({ sessionId: params.sessionId })
    }
    if (params.action === 'reject') {
      return this.rejectGoalContract({ sessionId: params.sessionId })
    }
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
    this.turnRegistry.executorFor(params.sessionId)?.cancel()
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

  /**
   * 累计目标暂停时长（ms）：按 goal_paused → goal_resumed 事件配对求和。
   * 未闭合的暂停（当前仍处于 paused）计到当前时刻。事件按 goalId 过滤，
   * 同会话旧目标的暂停不计入新目标。
   */
  private computeGoalPausedMs(sessionId: string, goal: StoredSessionGoal): number {
    try {
      const eventRepo = new EventRepository(this.db)
      const collectTimestamps = (eventType: string): number[] =>
        eventRepo
          .queryBySession({ sessionId, eventType, limit: 1000 })
          .events.flatMap((row) => {
            try {
              const parsed = JSON.parse(row.event_json) as { goalId?: unknown; timestamp?: unknown }
              if (parsed.goalId !== goal.id || typeof parsed.timestamp !== 'string') return []
              const ts = Date.parse(parsed.timestamp)
              return Number.isFinite(ts) ? [ts] : []
            } catch {
              return []
            }
          })
          .sort((a, b) => a - b)
      const pauses = collectTimestamps('goal_paused')
      if (pauses.length === 0) return 0
      const resumes = collectTimestamps('goal_resumed')
      let pausedMs = 0
      for (const pauseTs of pauses) {
        const resumeIdx = resumes.findIndex((resumeTs) => resumeTs >= pauseTs)
        if (resumeIdx === -1) {
          pausedMs += Date.now() - pauseTs
          break
        }
        pausedMs += resumes[resumeIdx]! - pauseTs
        resumes.splice(resumeIdx, 1)
      }
      return Math.max(0, pausedMs)
    } catch {
      // 事件查询失败（旧测试 double 等）按无暂停处理，保持向后兼容。
      return 0
    }
  }

  private getGoalLoopBudgetStopSummary(sessionId: string, goal: StoredSessionGoal): string | null {
    const budget = goal.budget ?? {}
    const maxIterations = budget.maxIterations ?? 12
    if (goal.progressLog.length >= maxIterations) {
      return `Goal stopped after ${maxIterations} iterations.`
    }

    if (budget.maxBudgetUsd != null && Number.isFinite(budget.maxBudgetUsd)) {
      try {
        // 预算只统计目标自身的消耗（goal 创建时刻起），不含目标开始前的会话聊天。
        const ledger = new UsageLedgerRepository(this.db)
        const usage =
          typeof ledger.getSessionUsageSince === 'function'
            ? ledger.getSessionUsageSince(sessionId, goal.createdAt)
            : ledger.getSessionUsage(sessionId)
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
        // 运行时长排除暂停时段：goal_paused → goal_resumed 的间隔不计入，
        // 否则暂停一小时会直接吃掉 maxRuntimeMinutes 的全部额度。
        const pausedMs = this.computeGoalPausedMs(sessionId, goal)
        const activeMinutes = (Date.now() - createdAtMs - pausedMs) / 60_000
        if (activeMinutes >= budget.maxRuntimeMinutes) {
          const pausedMinutes = pausedMs / 60_000
          const pausedNote =
            pausedMinutes >= 0.05 ? ` (excludes ${pausedMinutes.toFixed(1)} minutes paused)` : ''
          return `Goal stopped after reaching runtime limit: ${activeMinutes.toFixed(1)} active minutes${pausedNote} >= ${budget.maxRuntimeMinutes} minutes.`
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
    // 预算停止发生在 startGoalLoop 内（continueGoalOrQueue 派发它后直接 return），
    // 若队列还压着 goal 运行期间排队的用户消息，没有任何后续泵会来排空——
    // 补一次常规起跑让遗留消息按普通 turn 执行（startNextQueuedTurn 自带全部门闩）。
    setTimeout(() => this.startNextQueuedTurn(sessionId), 0)
  }

  /**
   * 排空 goal 运行期间排队的用户插话，注入下一轮迭代 prompt（P0-2 反饥饿）。
   *
   * 只内联「纯文本用户消息」：不带附件/skill/会话参考/mention 的 turn。runtimePatch
   * 仅含 provider/model 时视为纯文本等价（渲染端每条消息都携带当前选择，若要求
   * patch 为空则永远无法排空），并在排空时把该选择持久化到会话运行时，让用户
   * 插话时的模型切换对下一轮迭代生效。patch 含其他字段（agent/权限/模式等）的
   * turn 无法以文本注入等价表达，保留在队列里等目标结束后按普通 turn 执行。
   * 被内联的 turn：emit user_message 保留时间线可见性 + turn_requests 标记 completed。
   */
  private drainQueuedUserTurnsForGoalIteration(sessionId: string): string[] {
    const queue = this.pendingTurns.get(sessionId)
    if (queue == null || queue.length === 0) return []
    const requestRepo = new TurnRequestRepository(this.db)
    const eventRepo = new EventRepository(this.db)
    const remaining: PendingTurn[] = []
    const drainedMessages: string[] = []
    let drainedCount = 0
    let latestRuntimeSelection: { providerProfileId?: string; modelId?: string } | null = null
    for (const turn of queue) {
      const runtimeOnlyPatch = pickGoalDrainableRuntimeSelection(turn.runtimePatch)
      const isPlainUserTurn =
        turn.isTeamDispatchAutoContinuation !== true &&
        turn.userMessageVisibility !== 'hidden' &&
        (turn.attachments == null || turn.attachments.length === 0) &&
        turn.skillId == null &&
        runtimeOnlyPatch !== false &&
        (turn.sessionReferences == null || turn.sessionReferences.length === 0) &&
        turn.mentionAgentId == null &&
        turn.message.trim().length > 0
      // 超出单轮注入上限的纯文本消息留在队列（下一轮迭代再排空），避免撑爆迭代 prompt。
      if (!isPlainUserTurn || drainedCount >= GOAL_SUPPLEMENTARY_MESSAGE_MAX_COUNT) {
        remaining.push(turn)
        continue
      }
      drainedCount += 1
      if (runtimeOnlyPatch != null) latestRuntimeSelection = runtimeOnlyPatch
      drainedMessages.push(truncateGoalSupplementaryMessage(turn.message))
      // 时间线上仍要呈现用户发过这条消息：以原 turnId emit user_message，
      // 紧随其后的 goal 迭代 turn 会给出回应，不会留下无终态的悬挂 turn 预期。
      this.emitAndPersist(
        sessionId,
        turn.turnId,
        {
          id: crypto.randomUUID(),
          type: 'user_message',
          sessionId,
          turnId: turn.turnId,
          timestamp: new Date().toISOString(),
          seq: 0,
          content: turn.message,
        },
        eventRepo,
      )
      // 消息已被迭代消费，持久化请求闭环为 completed（durable=true 才有对应行，
      // cancel/markCompleted 都是无则 no-op）。
      try {
        requestRepo.markCompleted(turn.turnId)
      } catch {
        // 测试 double 或旧库可能没有对应行；闭环失败不影响迭代注入。
      }
    }
    if (drainedCount === 0) return []
    if (remaining.length === 0) this.pendingTurns.delete(sessionId)
    else this.pendingTurns.set(sessionId, remaining)
    // 用户在插话里切换了 provider/model：以最后一条为准写入会话运行时，
    // 让紧随其后的迭代 turn（goalSyntheticTurnRuntimePatch 读会话快照）真正用上新选择。
    if (latestRuntimeSelection != null) {
      new SessionRepository(this.db).updateRuntime(sessionId, latestRuntimeSelection)
    }
    this.emitQueueChanged(sessionId)
    log.info('goal loop: drained queued user messages into iteration', {
      sessionId,
      drainedCount,
      remainingQueued: remaining.length,
    })
    return drainedMessages
  }

  /**
   * goal 合成 turn（契约起草/迭代）由服务端自发派发，不像普通 turn 那样携带
   * 渲染端 runtimePatch，provider 解析会落到 Agent 自身绑定——出现「UI 选了 A，
   * goal turn 却跑 Agent 绑定的 B」（codex 会话绑到 anthropic 端点时直接 404 失败）。
   * 这里显式继承会话当前运行时选择（= 用户最近一次 UI 选择，由普通 turn 的
   * runtimePatch / updateSession 持久化），与普通 turn 的 explicit patch 语义对齐。
   * 团队会话例外：Host Agent 配置是既定路由语义，不继承会话快照。
   */
  private goalSyntheticTurnRuntimePatch(sessionId: string): SessionRuntimePatch | undefined {
    const session = new SessionRepository(this.db).get(sessionId)
    if (session == null) return undefined
    if (readSessionTeamConfig(session)?.enabled === true) return undefined
    const providerProfileId = session.provider_profile_id?.trim()
    const modelId = session.model_id?.trim()
    const patch: SessionRuntimePatch = {}
    if (providerProfileId != null && providerProfileId.length > 0) {
      patch.providerProfileId = providerProfileId
    }
    if (modelId != null && modelId.length > 0) patch.modelId = modelId
    return Object.keys(patch).length > 0 ? patch : undefined
  }

  private async startGoalLoop(sessionId: string, attachments?: SessionAttachment[]): Promise<void> {
    const repo = new GoalRepository(this.db)
    const goal = repo.getCurrent(sessionId)
    if (goal == null || goal.status !== 'active') return
    if (this.hasActiveSessionExecution(sessionId)) return
    const budgetStopSummary = this.getGoalLoopBudgetStopSummary(sessionId, goal)
    if (budgetStopSummary != null) {
      log.warn('goal loop: stopped by budget', { sessionId, goalId: goal.id })
      this.stopGoalLoopByBudget(repo, sessionId, goal, budgetStopSummary)
      return
    }
    log.info('goal loop: iteration', { sessionId, iteration: goal.progressLog.length + 1 })
    const turnId = crypto.randomUUID()
    const goalAttachments = attachments ?? this.findGoalSourceAttachments(sessionId, goal.objective)
    const supplementaryUserMessages = this.drainQueuedUserTurnsForGoalIteration(sessionId)
    const prompt = buildGoalIterationPrompt(goal, supplementaryUserMessages)
    // 启动只发事件、不写 progressLog：真实进度条目唯一来源是 turn 结束时解析的
    // spark-goal-status 块。此前每轮先 append 一条固定 nextStep 的"启动占位条目"，
    // 导致 progressLog 每轮 +2——迭代计数双倍（maxIterations 减半生效）、
    // noProgress 检测被占位文案隔断而几乎永远不触发、迭代 prompt 的进度摘要混入噪音。
    this.emitGoalEvent(
      sessionId,
      goal,
      'goal_progress',
      'active',
      `Started iteration ${goal.progressLog.length + 1}`,
      { phase: 'review', iteration: goal.progressLog.length + 1 },
      undefined,
      'iteration_start',
    )
    await this.startTurn(
      sessionId,
      turnId,
      prompt,
      GOAL_ITERATION_TURN_PRESENTATION,
      this.goalSyntheticTurnRuntimePatch(sessionId),
      undefined,
      undefined,
      goalAttachments,
    )
  }

  private findGoalSourceAttachments(
    sessionId: string,
    objective: string,
  ): SessionAttachment[] | undefined {
    try {
      const rows = new EventRepository(this.db).queryBySession({
        sessionId,
        eventType: 'user_message',
        limit: 200,
      }).events
      const expectedMessage = `/goal ${objective}`
      for (const row of rows) {
        const event = JSON.parse(row.event_json) as {
          content?: unknown
          attachments?: SessionAttachment[]
        }
        if (event.content !== expectedMessage || event.attachments == null) continue
        return normalizeTurnAttachments(event.attachments)
      }
    } catch {
      // Historical sessions and old test doubles may not expose command attachments.
    }
    return undefined
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
    progressKind?: 'iteration_start' | 'iteration_result',
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
        ...(extra.iteration != null
          ? { iteration: extra.iteration }
          : { iteration: goal.progressLog.length }),
        summary,
        ...(extra.phase != null ? { phase: extra.phase } : {}),
        ...(extra.evidence != null ? { evidence: extra.evidence } : {}),
        ...(extra.nextStep != null ? { nextStep: extra.nextStep } : {}),
        ...(extra.validation != null ? { validation: extra.validation } : {}),
        ...(proposedContract != null ? { proposedContract } : {}),
        ...(progressKind != null ? { progressKind } : {}),
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

  async cancelTurn(sessionId: string): Promise<{ cancelled: boolean; turnId?: string }> {
    this.resetTeamDispatchAutoContinuation(sessionId)
    const removedQueuedContinuation = this.removeQueuedTeamDispatchAutoContinuations(sessionId)
    const loop = this.turnRegistry.executorFor(sessionId)
    const startingTurnId = this.turnRegistry.getStartingTurnId(sessionId)
    const eventRepo = new EventRepository(this.db)
    const activeTurnId =
      loop != null
        ? (this.turnRegistry.runningTurnId(sessionId) ??
          getLatestTurnIdFromEvents(eventRepo, sessionId))
        : null
    const cancelledTurnId = activeTurnId ?? startingTurnId
    const wasAlreadyCancelled =
      cancelledTurnId != null && this.turnRegistry.isTurnCancelled(cancelledTurnId)
    if (cancelledTurnId != null && !wasAlreadyCancelled) {
      this.turnRegistry.markTurnCancelled(cancelledTurnId)
    }
    this.stopComputerUseSession(sessionId)
    this.pendingPlanApprovals.delete(sessionId)
    // 先取消挂起的 approval（如果 agent 正卡在用户审批弹窗上）
    this.onApprovalCancel?.(sessionId)
    // 只取消**本会话**进行中的 team dispatch（连同其 member 执行器）。
    // 这里曾经是 cancelAll()，会把其他会话正在跑的团队协作一并打断。
    const cancelledTeamDispatches = this.teamDispatchService?.cancelBySession(sessionId) ?? 0
    if (loop == null) {
      if (startingTurnId != null) {
        if (!wasAlreadyCancelled) {
          this.emitAndPersist(
            sessionId,
            startingTurnId,
            createUserCancelledTurnEvent(sessionId, startingTurnId),
            eventRepo,
          )
        }
        new SessionRepository(this.db).updateStatus(sessionId, 'idle')
        this.emitQueueChanged(sessionId)
        return { cancelled: true, turnId: startingTurnId }
      }
      if (cancelledTeamDispatches > 0) {
        new SessionRepository(this.db).updateStatus(sessionId, 'idle')
        this.emitQueueChanged(sessionId)
        return { cancelled: true }
      }
      if (removedQueuedContinuation) {
        this.emitQueueChanged(sessionId)
        return { cancelled: true }
      }
      // UI 可能仍依据持久化 running / 历史 agent_status 显示停止按钮，但内存执行
      // 已不存在。把这次停止视为成功收口，补齐断流终态并复位，而不是误报
      // “没有运行中的任务”。真实 starting/executor/Team dispatch 已由前面分支保护。
      const zombie = this.reconcileZombieRunningSession(sessionId)
      if (zombie.reconciled) return { cancelled: true }
      this.emitQueueChanged(sessionId)
      return { cancelled: false }
    }
    const turnId = activeTurnId ?? getLatestTurnIdFromEvents(eventRepo, sessionId)
    this.turnRegistry.markTurnCancelled(turnId)
    loop.cancel()
    this.turnRegistry.forceRelease(sessionId, turnId)
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
    return { cancelled: true, turnId }
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
    if (this.turnRegistry.hasActiveSession(sessionId)) {
      this.emitQueueChanged(sessionId)
    } else {
      this.startNextQueuedTurn(sessionId)
    }
    return { rejected: wasPending }
  }

  /**
   * 审批超时/取消时往会话事件流写一条可解释的时间线记录。
   *
   * 没有这条记录时，审批超时被拒的操作在会话历史里完全不可见——toast 10 秒后消失，
   * 用户翻历史只看到 agent 莫名跳过了某步。这条 agent_error 让"为什么跳过"可追溯。
   *
   * 不在 permission.service 里直接写：permission.service 是纯权限决策层，不持有
   * EventRepository/SessionService 引用；由调用方（ipc handler）在 onExpire 时调用本方法。
   */
  recordPermissionOutcome(
    sessionId: string,
    params: {
      reason: 'timeout' | 'cancelled'
      toolName: string
      timeoutMs?: number
    },
  ): void {
    const eventRepo = new EventRepository(this.db)
    // session 已不存在时不写——避免给已删除的会话留垃圾事件
    const sessionRepo = new SessionRepository(this.db)
    if (sessionRepo.get(sessionId) == null) return
    const turnId = getLatestTurnIdFromEvents(eventRepo, sessionId)
    const minutes = params.timeoutMs != null ? Math.round(params.timeoutMs / 60000) : 0
    const message =
      params.reason === 'timeout'
        ? `权限审批「${params.toolName}」等待超过 ${minutes} 分钟已自动拒绝，已跳过该操作`
        : `权限审批「${params.toolName}」因会话取消而失效`
    this.emitAndPersist(
      sessionId,
      turnId,
      {
        id: crypto.randomUUID(),
        type: 'agent_error',
        sessionId,
        turnId,
        timestamp: new Date().toISOString(),
        seq: 0,
        code: params.reason === 'timeout' ? 'PERMISSION_TIMEOUT' : 'PERMISSION_CANCELLED',
        message,
        retryable: true,
      },
      eventRepo,
    )
  }

  /**
   * Session 删除/清空时调用：终止在跑的执行器并清理 session 相关的内存状态。
   * 由 deleteSession / clearEvents 内部调用，避免 long-lived 进程内存泄漏。
   *
   * 关键：必须先 `cancel()` 再从 activeLoops 摘除。activeLoops 里存的是唯一能停掉
   * Claude SDK query / Codex CLI 子进程的句柄——只 delete 不 cancel 会让执行器变成
   * 孤儿：继续跑工具（Write/Edit/Bash 会真的改用户磁盘）、继续计费、继续往已删除的
   * session 写事件，而 UI 已经认为该会话不存在/已空闲。
   *
   * @returns 是否终止了一个正在运行的执行器（调用方据此决定要不要写取消事件）。
   */
  private clearSessionMemory(sessionId: string): boolean {
    this.resetTeamDispatchAutoContinuation(sessionId)
    const activeLoop = this.turnRegistry.executorFor(sessionId)
    const startingTurnId = this.turnRegistry.getStartingTurnId(sessionId)
    const runningTurnId = this.turnRegistry.runningTurnId(sessionId)
    if (runningTurnId != null) this.turnRegistry.markTurnCancelled(runningTurnId)
    if (startingTurnId != null) this.turnRegistry.markTurnCancelled(startingTurnId)
    this.stopComputerUseSession(sessionId)
    if (activeLoop != null) {
      try {
        activeLoop.cancel()
      } catch (error) {
        log.warn('failed to cancel active executor while clearing session', {
          sessionId,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }
    this.turnRegistry.forceRelease(sessionId, runningTurnId)
    // 同一会话下正在进行的团队成员执行也要一起收掉，否则 member executor 会成为孤儿。
    const cancelledTeamDispatches = this.teamDispatchService?.cancelBySession(sessionId) ?? 0
    this.turnRegistry.clearStartingEntries(sessionId)
    this.pendingTurns.delete(sessionId)
    this.pendingPlanApprovals.delete(sessionId)
    this.pendingUserQuestionGate.releaseSession(sessionId)
    this.eventSequencer.clear(sessionId)
    this.iterationOverrides.delete(sessionId)
    this.pendingTitleRefinements.delete(sessionId)
    TodoStore.clear(sessionId)
    getDebugLogServer().deleteSession(sessionId)
    // Runtime state is session-owned and must not survive a deleted session.
    deleteTeamRuntimeState(this.db, sessionId)
    this.onApprovalCancel?.(sessionId)
    this.emitQueueChanged(sessionId)
    return activeLoop != null || startingTurnId != null || cancelledTeamDispatches > 0
  }

  // ── 会话 CRUD / 引用 / fork（P1-W3-S4 迁出至 ./session/session-crud.ts）───

  private getCrudController(): SessionCrudController {
    if (this.crudController == null) {
      this.crudController = new SessionCrudController(this.db, this)
    }
    return this.crudController
  }

  async forkSession(params: {
    sourceSessionId: string
    anchorTurnId?: string
    title?: string
  }): Promise<import('@spark/protocol').SessionForkResponse> {
    return this.getCrudController().forkSession(params)
  }

  async getSessionLineage(
    sessionId: string,
  ): Promise<import('@spark/protocol').SessionLineageResponse> {
    return this.getCrudController().getSessionLineage(sessionId)
  }

  async listSessionReferenceCandidates(params: {
    targetSessionId: string
    workspaceId?: string
    query?: string
    includeArchived?: boolean
    limit?: number
  }): Promise<{ candidates: SessionReferenceCandidate[] }> {
    return this.getCrudController().listSessionReferenceCandidates(params)
  }

  async attachSessionReference(params: {
    targetSessionId: string
    sourceSessionId: string
    snapshotSeq?: number
  }): Promise<{ reference: SessionReference }> {
    return this.getCrudController().attachSessionReference(params)
  }

  async listSessionReferences(sessionId: string): Promise<{ references: SessionReference[] }> {
    return this.getCrudController().listSessionReferences(sessionId)
  }

  async listActiveSessionReferences(
    sessionId: string,
  ): Promise<{ references: SessionReference[] }> {
    return this.getCrudController().listActiveSessionReferences(sessionId)
  }

  async updateSessionReference(params: {
    targetSessionId: string
    referenceId: string
  }): Promise<{ reference: SessionReference }> {
    return this.getCrudController().updateSessionReference(params)
  }

  async revokeSessionReference(params: {
    targetSessionId: string
    referenceId: string
  }): Promise<{ revoked: boolean }> {
    return this.getCrudController().revokeSessionReference(params)
  }

  async readReferencedSession(params: {
    targetSessionId: string
    referenceId: string
    cursor?: number
    turnLimit?: number
    detail?: 'transcript' | 'user_visible_activity'
    actor?: 'user' | 'agent' | 'system'
  }): Promise<import('@spark/protocol').SessionReadReferenceResponse> {
    return this.getCrudController().readReferencedSession(params)
  }

  async searchReferencedSession(params: {
    targetSessionId: string
    referenceId: string
    query: string
    limit?: number
    actor?: 'user' | 'agent' | 'system'
  }): Promise<import('@spark/protocol').SessionSearchReferenceResponse> {
    return this.getCrudController().searchReferencedSession(params)
  }

  async getHistory(params: {
    sessionId: string
    full?: boolean
    limit?: number
    turnLimit?: number
    eventLimit?: number
    beforeSeq?: number
  }): Promise<{ events: AgentEvent[]; hasMore: boolean }> {
    // 首页加载（无 beforeSeq）时顺带做僵尸 running 会话懒恢复：断流轮在此补齐
    // 终态事件后，本次返回的事件里已包含收尾，渲染端正常重放即可复位 streaming。
    if (params.beforeSeq == null) {
      this.reconcileZombieRunningSession(params.sessionId)
    }
    return this.getCrudController().getHistory(params)
  }

  async listSessions(params?: {
    workspaceId?: string
    status?: 'idle' | 'running' | 'error'
    limit?: number
    offset?: number
    includeArchived?: boolean
  }): Promise<SessionListResponse> {
    return this.getCrudController().listSessions(params)
  }

  async searchSessions(params: {
    query: string
    workspaceId?: string
    limit?: number
  }): Promise<SessionSearchResponse> {
    return this.getCrudController().searchSessions(params)
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
    chatMode?: SessionChatMode
    reasoningEffort?: SparkReasoningEffort
    debugMode?: boolean
    cliSparkOverride?: CliSparkOverride | null
  }): Promise<{ session: SessionListResponse['sessions'][number] }> {
    return this.getCrudController().updateSession(params)
  }

  async getSessionRuntimeState(sessionId: string): Promise<Record<string, unknown>> {
    return this.getCrudController().getSessionRuntimeState(sessionId)
  }

  async deleteSession(sessionId: string): Promise<{ deleted: boolean }> {
    return this.getCrudController().deleteSession(sessionId)
  }

  // ── SessionCrudHost 窄回调 ──

  bumpMcpVersion(): void {
    this.mcpVersion += 1
  }

  applyPermissionModeChange(sessionId: string, permissionMode: SessionPermissionMode): void {
    // 切换 permissionMode 通常意味着用户对 plan 模式审批弹窗做了选择
    // （批准会切到 claude-auto-edits）。此时解除闸门，让被阻塞的队列恢复推进。
    if (this.pendingPlanApprovals.has(sessionId)) {
      this.pendingPlanApprovals.delete(sessionId)
      if (!this.turnRegistry.hasActiveSession(sessionId)) {
        this.startNextQueuedTurn(sessionId)
      }
    }
    // Hot-swap: propagate permission-mode change to the running executor so it
    // takes effect on the very next tool call within the current turn.
    // 经能力接口判定（W2-D4）：只有声明了热切换能力的执行器（claude）才会被调用，
    // 第三引擎带该能力即自动获得热切换，无需改这里。
    const active = this.turnRegistry.executorFor(sessionId)
    if (active != null && isPermissionModeAware(active)) {
      void active.setPermissionMode(permissionMode)
    }
  }

  /**
   * 设置会话的引擎级 worktree 状态（agent 工具上报 / 运行时检测共用入口）。
   *
   * 校验 + 持久化由 SessionWorktreeStateService 负责；发生变化时通过
   * sessionWorktreeChangedHandler 通知主进程推流 stream:session:worktree-changed。
   */
  async setSessionRuntimeWorktree(
    sessionId: string,
    input: SessionWorktreeStateInput,
  ): Promise<{ ok: boolean; worktree: SessionRuntimeWorktreeState | null; error?: string }> {
    let result: Awaited<ReturnType<SessionWorktreeStateService['apply']>>
    try {
      result = await this.getWorktreeStateService().apply(sessionId, input)
    } catch (err) {
      log.warn(
        `set session runtime worktree failed: ${err instanceof Error ? err.message : String(err)}`,
      )
      return {
        ok: false,
        worktree: null,
        error: err instanceof Error ? err.message : String(err),
      }
    }
    if (result.changed) {
      try {
        this.sessionWorktreeChangedHandler?.(sessionId, result.worktree)
      } catch (err) {
        log.warn(
          `session worktree changed handler failed: ${
            err instanceof Error ? err.message : String(err)
          }`,
        )
      }
    }
    return {
      ok: result.ok,
      worktree: result.worktree,
      ...(result.error ? { error: result.error } : {}),
    }
  }

  /** 读取会话当前引擎级 worktree 状态（无则 null）。 */
  getSessionRuntimeWorktree(sessionId: string): SessionRuntimeWorktreeState | null {
    return this.getWorktreeStateService().get(sessionId)
  }

  // ── checkpoint / 事件清理（P1-W3-S3 迁出至 ./session/checkpoint.ts）───

  private getCheckpointManager(): SessionCheckpointManager {
    if (this.checkpointManager == null) {
      this.checkpointManager = new SessionCheckpointManager(this.db, this)
    }
    return this.checkpointManager
  }

  cleanupSessionEventsInBackground(sessionId: string): void {
    this.getCheckpointManager().cleanupSessionEventsInBackground(sessionId)
  }

  cleanupOrphanedSessionEventsInBackground(): void {
    this.getCheckpointManager().cleanupOrphanedSessionEventsInBackground()
  }

  async clearEvents(sessionId: string): Promise<{ cleared: boolean }> {
    return this.getCheckpointManager().clearEvents(sessionId)
  }

  async deleteMessage(sessionId: string, eventIds: string[]): Promise<{ deleted: number }> {
    return this.getCheckpointManager().deleteMessage(sessionId, eventIds)
  }

  listCheckpoints(sessionId: string): CheckpointSnapshot[] {
    return this.getCheckpointManager().listCheckpoints(sessionId)
  }

  getSessionCheckpointEnabled(sessionId: string): boolean {
    return this.getCheckpointManager().getSessionCheckpointEnabled(sessionId)
  }

  async getSessionCheckpointAvailable(sessionId: string): Promise<boolean> {
    return this.getCheckpointManager().getSessionCheckpointAvailable(sessionId)
  }

  setSessionCheckpointEnabled(sessionId: string, enabled: boolean): boolean {
    return this.getCheckpointManager().setSessionCheckpointEnabled(sessionId, enabled)
  }

  async restoreCheckpointViaSnapshot(
    sessionId: string,
    checkpointRef: string,
  ): Promise<CheckpointRestoreResult> {
    return this.getCheckpointManager().restoreCheckpointViaSnapshot(sessionId, checkpointRef)
  }

  private async maybeCaptureCheckpoint(
    sessionId: string,
    turnId: string,
    workspaceRootPath: string,
    eventRepo: EventRepository,
    label: string,
  ): Promise<void> {
    return this.getCheckpointManager().maybeCaptureCheckpoint(
      sessionId,
      turnId,
      workspaceRootPath,
      eventRepo,
      label,
    )
  }

  // ── SessionCheckpointHost 窄回调 ──

  emitCheckpointEvent(
    sessionId: string,
    turnId: string,
    event: AgentEvent,
    eventRepo: EventRepository,
  ): void {
    this.emitAndPersist(sessionId, turnId, event, eventRepo)
  }

  clearSessionMemoryForEvents(sessionId: string): boolean {
    return this.clearSessionMemory(sessionId)
  }

  listActiveSessionIds(): string[] {
    return Array.from(this.turnRegistry.activeLoops.keys())
  }
}

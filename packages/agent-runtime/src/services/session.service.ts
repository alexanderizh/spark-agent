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
} from '@spark/storage'
import type { AgentItem, WorkflowItem } from '@spark/storage'
import type { SparkDatabase } from '@spark/storage'
import type {
  AgentEvent,
  SessionCancelQueuedTurnResponse,
  SessionSendQueuedTurnNowResponse,
  SessionCreateResponse,
  SessionGetQueueResponse,
  SessionId,
  SessionListResponse,
  SessionQueuedTurn,
  SessionSearchResponse,
  UserMessageEvent,
  AssistantMessageEvent,
  HookNode,
  SessionAttachment,
  UserQuestionPrompt,
  TeamModeConfig,
  TeamA2ATask,
} from '@spark/protocol'
import type { SessionPermissionMode } from '@spark/protocol'
import { LOCAL_CLI_PROVIDER_ID } from '@spark/protocol'
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
} from '../core/index.js'
import * as keystore from '@spark/shared/keystore'
import { McpService } from './mcp-server.service.js'
import { PlatformBridgeService } from './platform-bridge.service.js'
import { RuntimeCompositionService } from './runtime-composition.service.js'
import { ProjectContextService } from './project-context.service.js'
import { ValidationSuggestionService } from './validation-suggestion.service.js'
import { SkillLoader } from '../skills/skill-loader.js'
import { ClaudeSDKExecutor } from '../sdk/index.js'
import type { SDKExecutorConfig, SDKMcpServerConfig, SDKTurnAttachment } from '../sdk/index.js'
import { getResumeCircuitBreaker } from '../sdk/index.js'
import { buildConversationHistoryWithSummary } from './conversation-summarizer.js'
import { generateSessionTitle } from './session-title-generator.js'
import {
  createLogger,
  resolveProviderContextWindow,
  resolveSoftContextLimitForWindow,
} from '@spark/shared'

const log = createLogger('session.service')

export type SessionEventHandler = (event: AgentEvent) => void
export type SessionQueueChangedHandler = (snapshot: SessionGetQueueResponse) => void
export type SessionRenamedHandler = (sessionId: string, title: string) => void
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
type ImageGenerationRuntimeContext = {
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
}
type SessionRuntimePatch = {
  providerProfileId?: string
  modelId?: string | null
  agentId?: string
  agentAdapter?: AgentAdapterKind
  permissionMode?: SessionPermissionMode
  chatMode?: 'agent' | 'ask' | 'edit' | 'review'
  reasoningEffort?: 'low' | 'medium' | 'high' | 'xhigh'
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
export class SessionService {
  private activeLoops = new Map<string, ActiveExecution>() // sessionId → active execution
  private pendingTurns = new Map<string, PendingTurn[]>()
  /** 等待用户对计划进行审批的 session 集合：处于此状态时 startNextQueuedTurn 不自动起跑队列。 */
  private pendingPlanApprovals = new Set<string>()
  private seqCounters = new Map<string, number>()
  private approvalOverrides = new Map<string, boolean>() // sessionId → approval enabled
  private iterationOverrides = new Map<string, number>() // sessionId → per-session max turn iterations override
  private readonly commandRegistry = createBuiltinRegistry()
  private readonly mcpService: McpService
  private teamDispatchService: TeamDispatchService | null = null
  private readonly platformBridge: PlatformBridgeService

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
  ) {
    this.mcpService = new McpService(new McpServerRepository(db))
    this.platformBridge = new PlatformBridgeService()
    this.recoverInterruptedSessions()
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
    reasoningEffort?: 'low' | 'medium' | 'high' | 'xhigh'
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
        }
      },
      updateSession: async (id, fields) => {
        if (fields.title !== undefined) sessionRepo.updateTitle(id, fields.title)
        if (fields.modelId !== undefined) sessionRepo.updateRuntime(id, { modelId: fields.modelId })
      },
      clearSessionEvents: async (id) => {
        eventRepo.deleteBySession(id)
        this.seqCounters.delete(id)
      },
      getProviderName: (id) => {
        return providerRepo.get(id)?.name ?? null
      },
      getProviderModelIds: (id) => getProviderModelIds(providerRepo.get(id)?.config_json),
      setApprovalMode: (id, enabled) => {
        this.approvalOverrides.set(id, enabled)
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
      getSessionUsage: (_id) => {
        // TODO: integrate with UsageLedger
        return null
      },
      listSessionCheckpoints: (id) => listSessionCheckpointsFromEvents(eventRepo, id),
      restoreCheckpoint: async (id, checkpointRef) =>
        restoreSessionCheckpoint({
          eventRepo,
          sessionId: id,
          workspacePath,
          checkpointRef,
        }),
      listSkills: (query) => listSkillSummaries(new SkillRepository(this.db), workspacePath, query),
    }

    const ctx = {
      sessionId: params.sessionId,
      ...(workspacePath != null ? { workspaceId: workspacePath } : {}),
      ...(session?.provider_profile_id != null ? { providerId: session.provider_profile_id } : {}),
      ...(session?.model_id != null ? { model: session.model_id } : {}),
    }

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
        }
      },
      updateSession: async (id, fields) => {
        if (fields.title !== undefined) sessionRepo.updateTitle(id, fields.title)
        if (fields.modelId !== undefined) sessionRepo.updateRuntime(id, { modelId: fields.modelId })
      },
      clearSessionEvents: async (id) => {
        eventRepo.deleteBySession(id)
        this.seqCounters.delete(id)
      },
      getProviderName: (id) => providerRepo.get(id)?.name ?? null,
      getProviderModelIds: (id) => getProviderModelIds(providerRepo.get(id)?.config_json),
      setApprovalMode: (id, enabled) => {
        this.approvalOverrides.set(id, enabled)
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
      getSessionUsage: (_id) => null,
      listSessionCheckpoints: (id) => listSessionCheckpointsFromEvents(eventRepo, id),
      restoreCheckpoint: async (id, checkpointRef) =>
        restoreSessionCheckpoint({
          eventRepo,
          sessionId: id,
          workspacePath,
          checkpointRef,
        }),
      listSkills: (query) => listSkillSummaries(new SkillRepository(this.db), workspacePath, query),
    }

    const ctx = {
      sessionId: params.sessionId,
      ...(workspacePath != null ? { workspaceId: workspacePath } : {}),
      ...(session?.provider_profile_id != null ? { providerId: session.provider_profile_id } : {}),
      ...(session?.model_id != null ? { model: session.model_id } : {}),
    }

    const result = await this.commandRegistry.execute(parsed, ctx, deps)

    if (result.forwardToAgent) return { isCommand: true, forwardToAgent: true }

    // Inject result as events into the chat stream
    const turnId = crypto.randomUUID()
    const seq0 = this.seqCounters.get(params.sessionId) ?? 0
    this.seqCounters.set(params.sessionId, seq0 + 2)

    const userEvent: UserMessageEvent = {
      id: crypto.randomUUID(),
      type: 'user_message',
      sessionId: params.sessionId,
      turnId,
      timestamp: new Date().toISOString(),
      seq: seq0,
      content: params.message,
    }
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
      seq: seq0 + 1,
      mode: 'complete',
      content,
      provider: 'spark' as const,
      isFinal: true,
    }

    for (const event of [userEvent, assistantEvent]) {
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

    if (result.followUpPrompt != null && result.followUpPrompt.trim().length > 0) {
      const sendResult = await this.sendTurn({
        sessionId: params.sessionId,
        message: result.followUpPrompt,
        ...(result.followUpSkillId != null ? { skillId: result.followUpSkillId } : {}),
        ...(result.followUpSkillParams != null ? { skillParams: result.followUpSkillParams } : {}),
      })
      return { isCommand: true, forwardToAgent: false, started: sendResult.started }
    }

    return { isCommand: true, forwardToAgent: false, started: false }
  }

  listCommands(): CommandListItem[] {
    // Dynamically register enabled skills as Layer 3 commands
    const skills = listSkillSummaries(new SkillRepository(this.db))
    this.commandRegistry.registerSkillCommands(skills)
    return this.commandRegistry.listItems()
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
    reasoningEffort?: 'low' | 'medium' | 'high' | 'xhigh'
    /** 可选：要使用的 Skill ID */
    skillId?: string
    /** 可选：Skill 参数 */
    skillParams?: Record<string, unknown>
    attachments?: SessionAttachment[]
    /** 可选：团队模式配置（Team Mode 下随 turn 提交） */
    teamConfig?: TeamModeConfig
    /** 可选：团队模式 @ 路由——用户指定由该 Member 直接响应（替代 Host 主循环） */
    mentionAgentId?: string
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
    if (this.activeLoops.has(sessionId)) {
      this.enqueueTurn(
        sessionId,
        this.makePendingTurn(turnId, message, runtimePatch, skillId, skillParams, attachments, mentionAgentId),
      )
      return { turnId, started: false }
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
    const isLocalCli = provider.id === LOCAL_CLI_PROVIDER_ID
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
      haikuModel?: string
      sonnetModel?: string
      opusModel?: string
    }

    const model = (isMentionTurn ? agent.modelId : null) ?? session.model_id ?? config.defaultModel ?? config.model
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
    const storedPermissionMode = isMentionTurn
      ? normalizePermissionMode(agent.permissionMode)
      : getPermissionModeFromSession(session.permission_mode, agentAdapter)
    const permissionMode = this.getEffectivePermissionMode(
      sessionId,
      agentAdapter,
      storedPermissionMode,
    )

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
    const contextWindowTokens = resolveProviderContextWindow(config.supportsMillionContext === true)
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
    const platformMcpServer = await this.resolvePlatformManagementMcpServer()
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

    const composedSystemPrompt = joinPromptSections(
      managedAgentPrompt,
      teamMemberContextPrompt,
      teamRosterPrompt,
      teamInstructionsPrompt,
      runtimeRulesPrompt,
      runtimeContext.systemPrompt,
      projectContext.systemPrompt,
      conversationHistoryPrompt,
    )
    const composedSkillSystemPrompt = joinPromptSections(
      runtimeContext.skillSystemPrompt,
      projectContext.skillSystemPrompt,
      imageGenerationContext?.systemPrompt,
      platformMcpServer != null ? PLATFORM_MANAGEMENT_SYSTEM_PROMPT : undefined,
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
        ...(imageGenerationContext != null
          ? { imageGenerationMcpServer: imageGenerationContext.mcpServer }
          : {}),
        ...(teamMcpServer != null ? { teamMcpServer } : {}),
        ...(platformMcpServer != null
          ? { platformManagementMcpServer: platformMcpServer }
          : {}),
        ...(iterationOverride != null ? { maxTurnCount: iterationOverride } : {}),
        ...(config.maxTokens != null ? { maxTokens: config.maxTokens } : {}),
        contextWindowTokens,
        ...(session.reasoning_effort != null
          ? { reasoningEffort: session.reasoning_effort as 'low' | 'medium' | 'high' | 'xhigh' }
          : {}),
        ...(turnAttachments.length > 0 ? { attachments: turnAttachments } : {}),
        ...(attachmentDirectories.length > 0 ? { additionalDirectories: attachmentDirectories } : {}),
        enableCheckpoints: true,
        sdkSessionId,
        continueSession: canResumeSdkSession,
        ...(this.onApproval != null ? { approvalCallback: this.onApproval } : {}),
        ...(this.onQuestion != null ? { questionCallback: this.onQuestion } : {}),
      }
      const allowedMcpServerIds = getAllowedMcpServerIds(agent, workflow)
      const turnOptions: TryStartSDKTurnOptions = {
        ...(allowedMcpServerIds != null ? { allowedMcpServerIds } : {}),
        ...(isMentionTurn ? { mentionAgentId: agent.id } : {}),
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

    this.emitSdkRequiredError({
      sessionId,
      turnId,
      message,
      eventRepo,
      sessionRepo,
      sdkName: 'Codex SDK',
      statusMessage: 'Codex SDK is not connected',
      detail:
        'Codex execution must use the real Codex SDK. The legacy in-process AgentLoop has been removed as an execution path.',
    })
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
    if (config.teamMcpServer != null) {
      mcpServers.spark_team = config.teamMcpServer
    }

    // Platform management MCP server — auto-registered for all sessions
    if (config.platformManagementMcpServer != null) {
      mcpServers.spark_platform = config.platformManagementMcpServer
    }

    const executor = new ClaudeSDKExecutor()
    const changedFiles = new Set<string>()
    let validationSuggestionEmitted = false
    const maybeEmitValidationSuggestion = () => {
      if (validationSuggestionEmitted || changedFiles.size === 0) return
      validationSuggestionEmitted = true
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
    executor.onEvent((event) => {
      if (event.type === 'file_change') changedFiles.add(event.path)
      let outgoing: AgentEvent = event
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
          }
        } else if (event.type === 'user_message') {
          outgoing = { ...event, mentionAgentId }
        } else if (
          event.type === 'tool_call' ||
          event.type === 'tool_result' ||
          event.type === 'file_change' ||
          event.type === 'terminal_output'
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
      // （这会让审批弹窗还没确认就执行了下一条用户消息），在这里同步把队列清空
      // 并标记本 session 处于"等待计划审批"状态，阻断 startNextQueuedTurn 自动起跑。
      if (event.type === 'plan_proposed') {
        this.pendingPlanApprovals.add(sessionId)
        if ((this.pendingTurns.get(sessionId)?.length ?? 0) > 0) {
          this.pendingTurns.delete(sessionId)
          this.emitQueueChanged(sessionId)
        }
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
    })

    this.activeLoops.set(sessionId, executor)
    sessionRepo.updateStatus(sessionId, 'running')
    this.emitQueueChanged(sessionId)

    // Compute allowed tools: merge image-gen / team / platform tools into config defaults
    let sdkAllowedTools = config.allowedTools
    if (config.imageGenerationMcpServer != null) {
      sdkAllowedTools = mergeUniqueStrings(sdkAllowedTools, ['mcp__spark_image__generate_image'])
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
      .then(() => {
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
      })
      .catch(() => {
        sessionRepo.updateStatus(sessionId, 'error')
      })
      .finally(() => {
        // 清理本 turn 的 dispatch 预算计数，避免长生命周期进程内存增长
        this.teamDispatchService?.clearTurn(turnId)
        if (this.activeLoops.get(sessionId) === executor) {
          this.activeLoops.delete(sessionId)
          this.startNextQueuedTurn(sessionId)
        }
      })
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
    const { SkillRepository, SettingsRepository } = await import('@spark/storage')

    const skillRepo = new SkillRepository(this.db)
    const settingsRepo = new SettingsRepository(this.db)
    const skillLoader = new SkillLoader(skillRepo)
    const skillRegistryService = new SkillRegistryService(this.db)

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
      settingsRepo,
    }

    return this.platformBridge.start(deps)
  }

  /**
   * Resolve the Platform Management MCP server config.
   * Returns null if the MCP server script cannot be found or the bridge fails to start.
   */
  private async resolvePlatformManagementMcpServer(): Promise<SDKMcpServerConfig | null> {
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
        },
      }
    } catch (err) {
      log.warn(`Failed to start platform bridge: ${err instanceof Error ? err.message : String(err)}`)
      return null
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

  private resolveAgent(agentId: string | undefined): AgentItem {
    const repo = new AgentRepository(this.db)
    return repo.get(agentId ?? 'code-agent') ?? repo.get('code-agent') ?? {
      id: 'code-agent',
      name: '编码 Agent',
      description: '系统内置编码智能体',
      builtIn: true,
      enabled: true,
      providerProfileId: null,
      modelId: null,
      agentAdapter: 'claude-sdk',
      permissionMode: 'claude-ask',
      reasoningEffort: 'medium',
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
  }): Promise<TeamMemberExecutionResult> {
    const { member, task, dispatchId, sessionId, turnId, workspaceRootPath, eventRepo, signal, memberDepth, members, teamConfig } =
      args

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

    const memberSystemPrompt = buildManagedAgentSystemPrompt(member, null)
    const userMessage = buildMemberUserMessage(task)
    // Claude Code SDK 要求 session_id 必须是合法 UUID，给每次 dispatch 全新 UUID
    // 避免与 Host 的 SDK session 冲突；member 不需要跨 dispatch 续会话。
    const memberSdkSessionId = crypto.randomUUID()

    // Member 自身的 MCP 工具
    const memberMcpServers = this.buildMcpServersForSDK(getAllowedMcpServerIds(member, null))
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
        })) ?? undefined
      if (nestedTeamServer != null) memberMcpServers.spark_team = nestedTeamServer
    }

    const sdkConfig: SDKExecutorConfig = {
      apiKey,
      model,
      workspaceRootPath,
      permissionMode: member.permissionMode as SDKExecutorConfig['permissionMode'],
      ...(providerConfig.apiEndpoint != null ? { apiEndpoint: providerConfig.apiEndpoint } : {}),
      ...(providerConfig.haikuModel != null ? { haikuModel: providerConfig.haikuModel } : {}),
      ...(providerConfig.sonnetModel != null ? { sonnetModel: providerConfig.sonnetModel } : {}),
      ...(providerConfig.opusModel != null ? { opusModel: providerConfig.opusModel } : {}),
      ...(memberSystemPrompt.trim().length > 0 ? { systemPrompt: memberSystemPrompt } : {}),
      ...(Object.keys(memberMcpServers).length > 0 ? { mcpServers: memberMcpServers } : {}),
      // 嵌套时预批准 dispatch 工具；始终禁用内置 Task（§7.4）。
      ...(nestedTeamServer != null
        ? { allowedTools: ['mcp__spark_team__agent_dispatch', 'mcp__spark_team__agent_dispatch_batch'] }
        : {}),
      disallowedTools: ['Task'],
      enableCheckpoints: false,
      sdkSessionId: memberSdkSessionId,
      continueSession: false,
      ...(this.onApproval != null ? { approvalCallback: this.onApproval } : {}),
      ...(this.onQuestion != null ? { questionCallback: this.onQuestion } : {}),
    }

    const executor = new ClaudeSDKExecutor()
    const onAbort = () => executor.cancel()
    signal.addEventListener('abort', onAbort)

    let completeText = ''
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
          },
          eventRepo,
        )
        if (event.mode === 'complete' && event.content.length > 0) completeText = event.content
        else if (event.mode === 'delta') deltaText += event.content
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

    try {
      // 第二参数是 Spark 内部 turnId（仅用于 executor 内部日志/事件归属），不传给 SDK；
      // 用全新 UUID 避免与 Host 的 turnId 冲突（emit 时仍用 host turnId，见 makeBase）。
      await executor.executeTurn(sessionId, crypto.randomUUID(), userMessage, sdkConfig)
    } finally {
      signal.removeEventListener('abort', onAbort)
    }

    // 优先用 complete 文本；provider 只发 delta 时回落到累积的 delta 文本。
    if (memberError != null) {
      throw new Error(memberError)
    }
    return {
      content: completeText || deltaText,
      ...(inputTokens != null ? { inputTokens } : {}),
      ...(outputTokens != null ? { outputTokens } : {}),
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
    }
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

  private getEffectivePermissionMode(
    sessionId: string,
    adapter: AgentAdapterKind,
    storedMode: SessionPermissionMode,
  ): SessionPermissionMode {
    const override = this.approvalOverrides.get(sessionId)
    if (override === false) return adapter === 'claude' ? 'claude-bypass' : 'codex-full-access'
    if (
      override === true &&
      (storedMode === 'claude-bypass' || storedMode === 'codex-full-access')
    ) {
      return adapter === 'claude' ? 'claude-ask' : 'codex-default'
    }
    return storedMode
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
    this.approvalOverrides.delete(sessionId)
    this.iterationOverrides.delete(sessionId)
    TodoStore.clear(sessionId)
    this.onApprovalCancel?.(sessionId)
    this.emitQueueChanged(sessionId)
  }

  async getHistory(params: {
    sessionId: string
    limit?: number
    beforeSeq?: number
  }): Promise<{ events: AgentEvent[]; hasMore: boolean }> {
    const eventRepo = new EventRepository(this.db)
    const { events: rows, hasMore } = eventRepo.queryBySession({
      sessionId: params.sessionId,
      limit: params.limit ?? 50,
      ...(params.beforeSeq != null ? { beforeSeq: params.beforeSeq } : {}),
    })
    const events = rows.map((row) => JSON.parse(row.event_json) as AgentEvent)
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
      agentId: row.agent_id ?? 'code-agent',
      agentAdapter: getAgentAdapterFromSession(row.agent_adapter, row.chat_mode, null),
      permissionMode: getPermissionModeFromSession(
        row.permission_mode,
        getAgentAdapterFromSession(row.agent_adapter, row.chat_mode, null),
      ),
      chatMode: getChatModeFromSession(row.chat_mode),
      reasoningEffort: (row.reasoning_effort ?? 'medium') as 'low' | 'medium' | 'high' | 'xhigh',
      status: row.status as 'idle' | 'running' | 'error',
      pinnedAt: row.pinned_at,
      archivedAt: row.archived_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      messageCount: eventRepo.countBySession(row.id),
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
    reasoningEffort?: 'low' | 'medium' | 'high' | 'xhigh'
  }): Promise<{ session: SessionListResponse['sessions'][number] }> {
    const sessionRepo = new SessionRepository(this.db)
    const eventRepo = new EventRepository(this.db)

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
        agentId: row.agent_id ?? 'code-agent',
        agentAdapter: getAgentAdapterFromSession(row.agent_adapter, row.chat_mode, null),
        permissionMode: getPermissionModeFromSession(
          row.permission_mode,
          getAgentAdapterFromSession(row.agent_adapter, row.chat_mode, null),
        ),
        chatMode: getChatModeFromSession(row.chat_mode),
        reasoningEffort: (row.reasoning_effort ?? 'medium') as 'low' | 'medium' | 'high' | 'xhigh',
        status: row.status as 'idle' | 'running' | 'error',
        pinnedAt: row.pinned_at,
        archivedAt: row.archived_at,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        messageCount: eventRepo.countBySession(row.id),
      },
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
    const directory = path.dirname(attachment.path)
    if (!isInsidePath(workspaceRootPath, directory)) directories.add(directory)
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
): 'low' | 'medium' | 'high' | 'xhigh' {
  if (value === 'low' || value === 'medium' || value === 'high' || value === 'xhigh') return value
  return 'medium'
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
      hostAgentId: typeof team.hostAgentId === 'string' ? team.hostAgentId : 'code-agent',
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
    return `${header}\n${reply.error?.message ?? '(no content)'}`
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
    'The current Spark Agent runtime has a configured image generation model.',
    '',
    `- Configuration name: ${input.name}`,
    `- Model ID: ${input.model}`,
    `- Image provider: ${input.provider}`,
    `- Invocation mode: ${input.apiType}`,
    `- API base URL: ${input.apiEndpoint ?? '(provider default)'}`,
    `- Output directory: ${input.outputDir}`,
    '',
    'Use `mcp__spark_image__generate_image` when the user explicitly asks to create an image, poster, illustration, visual draft, icon, cover, or other generated image asset.',
    'Do not ask for or reveal API keys. Credentials are injected only into the local Spark image MCP server.',
    'If the user gives semantic sizing such as square, portrait, landscape, poster, or banner, translate it to an appropriate `size` value before calling the tool.',
    'Pass provider-specific fields through `extraJson` only when they are relevant and reasonably supported by the configured provider.',
    'After success, show the generated `urls` or `files` from the structured result. Local file paths can be shown directly as Markdown image links.',
    'Do not auto-retry image generation after a provider failure; report the error and suggest model, prompt, size, or provider-configuration adjustments.',
  ].join('\n')
}

function mergeUniqueStrings(a: string[] | undefined, b: string[]): string[] {
  return [...new Set([...(a ?? []), ...b])]
}

/** All 25 platform management tool names (SDK namespace: mcp__spark_platform__) */
const PLATFORM_TOOL_NAMES: string[] = [
  'mcp__spark_platform__skills_list',
  'mcp__spark_platform__skills_search',
  'mcp__spark_platform__skills_install',
  'mcp__spark_platform__skills_uninstall',
  'mcp__spark_platform__skills_toggle',
  'mcp__spark_platform__mcp_list',
  'mcp__spark_platform__mcp_create',
  'mcp__spark_platform__mcp_update',
  'mcp__spark_platform__mcp_delete',
  'mcp__spark_platform__mcp_status',
  'mcp__spark_platform__providers_list',
  'mcp__spark_platform__providers_create',
  'mcp__spark_platform__providers_update',
  'mcp__spark_platform__providers_delete',
  'mcp__spark_platform__providers_health_check',
  'mcp__spark_platform__workflows_list',
  'mcp__spark_platform__workflows_get',
  'mcp__spark_platform__workflows_create',
  'mcp__spark_platform__workflows_update',
  'mcp__spark_platform__workflows_delete',
  'mcp__spark_platform__agents_list',
  'mcp__spark_platform__agents_get',
  'mcp__spark_platform__agents_create',
  'mcp__spark_platform__agents_update',
  'mcp__spark_platform__agents_delete',
  'mcp__spark_platform__settings_get',
  'mcp__spark_platform__settings_set',
  'mcp__spark_platform__settings_get_category',
  'mcp__spark_platform__settings_get_all',
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
    path.resolve(here, 'tools/platform-management-mcp-server.mjs'),
    path.resolve(here, '../tools/platform-management-mcp-server.mjs'),
    path.resolve(process.cwd(), 'packages/agent-runtime/src/tools/platform-management-mcp-server.mjs'),
  ]
  return candidates.find((candidate) => existsSync(candidate)) ?? null
}

/**
 * System prompt section injected when the Platform Management MCP server is available.
 * Brief — the full instructions live in the `builtin:platform-manager` skill definition.
 */
const PLATFORM_MANAGEMENT_SYSTEM_PROMPT = [
  '## Platform Management Capability',
  'You can manage this Spark Agent platform using `mcp__spark_platform__*` tools.',
  'Available capabilities:',
  '- **Skills**: list, search, install, uninstall, toggle',
  '- **MCP Servers**: list, create, update, delete, status',
  '- **Providers**: list, create, update, delete, health_check',
  '- **Workflows**: list, get, create, update, delete',
  '- **Agents**: list, get, create, update, delete',
  '- **Settings**: get, set, get_category, get_all',
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

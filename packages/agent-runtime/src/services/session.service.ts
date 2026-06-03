import crypto from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
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
} from '@spark/storage'
import type { AgentItem, WorkflowItem } from '@spark/storage'
import type { SparkDatabase } from '@spark/storage'
import type {
  AgentEvent,
  SessionCancelQueuedTurnResponse,
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
} from '@spark/protocol'
import type { SessionPermissionMode } from '@spark/protocol'
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
import { RuntimeCompositionService } from './runtime-composition.service.js'
import { ProjectContextService } from './project-context.service.js'
import { ValidationSuggestionService } from './validation-suggestion.service.js'
import { SkillLoader } from '../skills/skill-loader.js'
import { ClaudeSDKExecutor } from '../sdk/index.js'
import type { SDKExecutorConfig, SDKMcpServerConfig, SDKTurnAttachment } from '../sdk/index.js'
import { getResumeCircuitBreaker } from '../sdk/index.js'
import { buildConversationHistoryWithSummary } from './conversation-summarizer.js'
import {
  createLogger,
  resolveProviderContextWindow,
  resolveSoftContextLimitForWindow,
} from '@spark/shared'

const log = createLogger('session.service')

export type SessionEventHandler = (event: AgentEvent) => void
export type SessionQueueChangedHandler = (snapshot: SessionGetQueueResponse) => void
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
  questions: Array<{
    question: string
    header: string
    options: Array<{ label: string; description?: string; preview?: string }>
  }>,
) => Promise<Record<string, unknown>>
type AgentAdapterKind = 'claude' | 'claude-sdk' | 'codex'
type ActiveExecution = { cancel(): void }
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
  private seqCounters = new Map<string, number>()
  private approvalOverrides = new Map<string, boolean>() // sessionId → approval enabled
  private iterationOverrides = new Map<string, number>() // sessionId → per-session max turn iterations override
  private readonly commandRegistry = createBuiltinRegistry()
  private readonly mcpService: McpService

  constructor(
    private readonly db: SparkDatabase,
    private readonly onEvent: SessionEventHandler,
    private readonly onApproval?: ApprovalHandler,
    private readonly onApprovalCancel?: ApprovalCancelHandler,
    private readonly onQueueChanged?: SessionQueueChangedHandler,
    private readonly onQuestion?: QuestionHandler,
    private readonly onHookTrigger?: HookTriggerHandler,
  ) {
    this.mcpService = new McpService(new McpServerRepository(db))
    this.recoverInterruptedSessions()
  }

  recoverInterruptedSessions(): { recovered: number } {
    const sessionRepo = new SessionRepository(this.db)
    const eventRepo = new EventRepository(this.db)
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
  }): Promise<{ turnId: string; started: boolean }> {
    const { sessionId, message, skillId, skillParams } = params
    const attachments = normalizeTurnAttachments(params.attachments)
    const runtimePatch = getRuntimePatch(params)
    const turnId = crypto.randomUUID()
    if (this.activeLoops.has(sessionId)) {
      this.enqueueTurn(
        sessionId,
        this.makePendingTurn(turnId, message, runtimePatch, skillId, skillParams, attachments),
      )
      return { turnId, started: false }
    }

    await this.startTurn(sessionId, turnId, message, runtimePatch, skillId, skillParams, attachments)
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
  ): Promise<void> {
    if (this.activeLoops.has(sessionId)) {
      this.enqueueTurn(
        sessionId,
        this.makePendingTurn(turnId, message, runtimePatch, skillId, skillParams, attachments),
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
    const agent = this.resolveAgent(session.agent_id)
    const workflow = agent.workflowId != null ? new WorkflowRepository(this.db).get(agent.workflowId) : null
    if (session.provider_profile_id == null) {
      throw new Error(`Session ${sessionId} has no provider profile`)
    }

    const existingEventCount = eventRepo.countBySession(sessionId)
    const currentSeq = this.seqCounters.get(sessionId) ?? existingEventCount
    const { prompt: conversationHistoryPrompt, summarization: summarizationStats } =
      buildConversationHistoryWithSummary(eventRepo, this.db, sessionId, currentSeq)
    if (existingEventCount === 0 && shouldDeriveSessionTitle(session.title)) {
      sessionRepo.updateTitle(sessionId, deriveSessionTitle(message))
    }
    const provider = providerRepo.get(session.provider_profile_id)
    if (provider == null) {
      throw new Error(`Provider profile not found: ${session.provider_profile_id}`)
    }
    if (provider.keystore_ref == null) {
      throw new Error(`Provider ${provider.id} has no keystore ref`)
    }

    const apiKey = await keystore.getSecret(provider.keystore_ref as keystore.KeystoreRef)
    if (apiKey == null) {
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

    const model = session.model_id ?? config.defaultModel ?? config.model
    if (model == null || model.length === 0) {
      throw new Error(`Provider ${provider.id} has no default model configured`)
    }

    const agentAdapter = getAgentAdapterFromSession(
      session.agent_adapter,
      session.chat_mode,
      provider.provider_type,
    )
    const adapterKind =
      agentAdapter === 'claude-sdk' || agentAdapter === 'claude' ? 'claude-sdk' : 'codex'
    const stableSdkSessionId = makeSdkRuntimeSessionId(
      sessionId,
      session.provider_profile_id,
      model,
      agentAdapter,
    )
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
      previousPromptSnapshot.providerProfileId === session.provider_profile_id &&
      previousPromptSnapshot.sdkSessionId === stableSdkSessionId
    const sdkSessionId = sdkResumeSafe
      ? stableSdkSessionId
      : makeSdkRuntimeSessionId(sessionId, session.provider_profile_id, model, agentAdapter, turnId)
    const storedPermissionMode = getPermissionModeFromSession(session.permission_mode, agentAdapter)
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
    const managedAgentPrompt = buildManagedAgentSystemPrompt(agent, workflow)
    const composedSystemPrompt = joinPromptSections(
      managedAgentPrompt,
      runtimeRulesPrompt,
      runtimeContext.systemPrompt,
      projectContext.systemPrompt,
      conversationHistoryPrompt,
    )
    const composedSkillSystemPrompt = joinPromptSections(
      runtimeContext.skillSystemPrompt,
      projectContext.skillSystemPrompt,
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
          providerProfileId: session.provider_profile_id,
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
      await this.tryStartSDKTurn(
        sessionId,
        turnId,
        message,
        eventRepo,
        sessionRepo,
        sdkConfig,
        allowedMcpServerIds != null ? { allowedMcpServerIds } : {},
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
    options: { allowedMcpServerIds?: Set<string> } = {},
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

    executor.onEvent((event) => {
      if (event.type === 'file_change') changedFiles.add(event.path)
      this.emitAndPersist(sessionId, turnId, event, eventRepo)
      if (event.type === 'agent_status' && event.status === 'completed') {
        maybeEmitValidationSuggestion()
      }
    })

    this.activeLoops.set(sessionId, executor)
    sessionRepo.updateStatus(sessionId, 'running')
    this.emitQueueChanged(sessionId)

    const sdkConfig: SDKExecutorConfig = {
      ...config,
      ...(Object.keys(mcpServers).length > 0 ? { mcpServers } : {}),
    }

    // Fire-and-forget
    executor
      .executeTurn(sessionId, turnId, message, sdkConfig)
      .then(() => {
        maybeEmitValidationSuggestion()
        sessionRepo.updateStatus(sessionId, 'idle')
        // Reset resume circuit breaker on successful turn completion
        getResumeCircuitBreaker().recordSuccess(sessionId)
      })
      .catch(() => {
        sessionRepo.updateStatus(sessionId, 'error')
      })
      .finally(() => {
        if (this.activeLoops.get(sessionId) === executor) {
          this.activeLoops.delete(sessionId)
          this.startNextQueuedTurn(sessionId)
        }
      })
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
  ): PendingTurn {
    return {
      turnId,
      message,
      enqueuedAt: new Date().toISOString(),
      ...(attachments != null && attachments.length > 0 ? { attachments } : {}),
      ...(runtimePatch != null ? { runtimePatch } : {}),
      ...(skillId != null ? { skillId } : {}),
      ...(skillParams != null ? { skillParams } : {}),
    }
  }

  private startNextQueuedTurn(sessionId: string): void {
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
    const hadQueuedTurns = (this.pendingTurns.get(sessionId)?.length ?? 0) > 0
    this.pendingTurns.delete(sessionId)
    // 先取消挂起的 approval（如果 agent 正卡在用户审批弹窗上）
    this.onApprovalCancel?.(sessionId)
    if (loop == null) {
      if (hadQueuedTurns) this.emitQueueChanged(sessionId)
      return { cancelled: false }
    }
    loop.cancel()
    this.activeLoops.delete(sessionId)
    const sessionRepo = new SessionRepository(this.db)
    sessionRepo.updateStatus(sessionId, 'idle')
    this.emitQueueChanged(sessionId)
    return { cancelled: true }
  }

  /**
   * Session 删除时调用：清理 session 相关的内存状态。
   * 由 deleteSession 内部调用，避免 long-lived 进程内存泄漏。
   */
  private clearSessionMemory(sessionId: string): void {
    this.activeLoops.delete(sessionId)
    this.pendingTurns.delete(sessionId)
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

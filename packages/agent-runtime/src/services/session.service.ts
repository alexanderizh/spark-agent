import crypto from 'node:crypto'
import {
  EventRepository,
  ProviderProfileRepository,
  RulesRepository,
  SessionRepository,
  WorkspaceRepository,
  McpServerRepository,
  SettingsRepository,
  SkillRepository,
} from '@spark/storage'
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
} from '@spark/protocol'
import type { SessionPermissionMode } from '@spark/protocol'
import { AgentLoop, ToolRegistry, isCommand, parseCommand, createBuiltinRegistry } from '../core/index.js'
import { TodoStore } from '../core/todo-store.js'
import type { AgentConfig, CommandDeps, CommandListItem } from '../core/index.js'
import type { ChatMessage } from '../adapters/types.js'
import * as keystore from '@spark/shared/keystore'
import { createAdapter } from './adapter-factory.js'
import { McpService } from './mcp-server.service.js'
import { RuntimeCompositionService } from './runtime-composition.service.js'
import { ProjectContextService } from './project-context.service.js'
import { ValidationSuggestionService } from './validation-suggestion.service.js'
import { ClaudeSDKExecutor } from '../sdk/index.js'
import type { SDKExecutorConfig, SDKMcpServerConfig } from '../sdk/index.js'
import { createLogger, resolveSoftContextLimit } from '@spark/shared'

const log = createLogger('session.service')

export type SessionEventHandler = (event: AgentEvent) => void
export type SessionQueueChangedHandler = (snapshot: SessionGetQueueResponse) => void
export type ApprovalHandler = (sessionId: string, toolName: string, toolInput: Record<string, unknown>) => Promise<boolean>
/** session 被取消时调用：用于拒绝该 session 下所有挂起的 approval 请求，避免 agent 永久挂起 */
export type ApprovalCancelHandler = (sessionId: string) => void
type AgentAdapterKind = 'claude' | 'claude-sdk' | 'codex'
type ActiveExecution = { cancel(): void }
type PendingTurn = {
  turnId: string
  message: string
  enqueuedAt: string
  skillId?: string
  skillParams?: Record<string, unknown>
}

const DEFAULT_SESSION_TITLES = new Set(['New Session', '新会话', 'Workspace Session', '未命名会话'])
const SESSION_TITLE_MAX_LENGTH = 40
const MODEL_HISTORY_EVENT_LIMIT = 400

export class SessionService {
  private activeLoops = new Map<string, ActiveExecution>()  // sessionId → active execution
  private pendingTurns = new Map<string, PendingTurn[]>()
  private seqCounters = new Map<string, number>()
  private approvalOverrides = new Map<string, boolean>()  // sessionId → approval enabled
  private iterationOverrides = new Map<string, number>()  // sessionId → per-session max turn iterations override
  private readonly commandRegistry = createBuiltinRegistry()
  private readonly mcpService: McpService

  constructor(
    private readonly db: SparkDatabase,
    private readonly onEvent: SessionEventHandler,
    private readonly onApproval?: ApprovalHandler,
    private readonly onApprovalCancel?: ApprovalCancelHandler,
    private readonly onQueueChanged?: SessionQueueChangedHandler,
  ) {
    this.mcpService = new McpService(new McpServerRepository(db))
  }

  async createSession(params: {
    providerProfileId: string
    modelId?: string
    agentAdapter?: AgentAdapterKind
    permissionMode?: SessionPermissionMode
    chatMode?: 'agent' | 'ask' | 'edit' | 'review'
    reasoningEffort?: 'low' | 'medium' | 'high' | 'xhigh'
    title?: string
    workspaceId?: string
  }): Promise<SessionCreateResponse> {
    const sessionRepo = new SessionRepository(this.db)
    const id = crypto.randomUUID()
    const row = sessionRepo.create({
      id,
      kind: 'agent',
      title: params.title?.trim() || '新会话',
      status: 'idle',
      projectId: params.workspaceId ?? 'default',
      workspaceIds: params.workspaceId != null ? [params.workspaceId] : [],
      providerProfileId: params.providerProfileId,
      ...(params.modelId !== undefined ? { modelId: params.modelId } : {}),
      agentAdapter: params.agentAdapter ?? 'codex',
      permissionMode: params.permissionMode ?? 'codex-default',
      ...(params.chatMode !== undefined ? { chatMode: params.chatMode } : {}),
      ...(params.reasoningEffort !== undefined ? { reasoningEffort: params.reasoningEffort } : {}),
    })
    return { sessionId: row.id as SessionId, createdAt: row.created_at }
  }

  async executeCommand(params: {
    sessionId: string
    message: string
  }): Promise<{ isCommand: true; result: { success: boolean; message: string; data?: Record<string, unknown> } } | { isCommand: false }> {
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
      const workspaceIds: string[] = session?.workspace_ids_json ? JSON.parse(session.workspace_ids_json) : []
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
        return { title: s.title, status: s.status, modelId: s.model_id ?? null, providerProfileId: s.provider_profile_id ?? '' }
      },
      updateSession: async (id, fields) => {
        sessionRepo.updateRuntime(id, fields)
      },
      clearSessionEvents: async (id) => {
        eventRepo.deleteBySession(id)
        this.seqCounters.delete(id)
      },
      getProviderName: (id) => {
        return providerRepo.get(id)?.name ?? null
      },
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
  }): Promise<{ isCommand: boolean; forwardToAgent?: boolean }> {
    if (!isCommand(params.message)) return { isCommand: false }
    const parsed = parseCommand(params.message)
    if (parsed == null) return { isCommand: false }

    const sessionRepo = new SessionRepository(this.db)
    const providerRepo = new ProviderProfileRepository(this.db)
    const eventRepo = new EventRepository(this.db)
    const session = sessionRepo.get(params.sessionId)

    let workspacePath: string | null = null
    try {
      const workspaceIds: string[] = session?.workspace_ids_json ? JSON.parse(session.workspace_ids_json) : []
      const workspaceId = workspaceIds[0]
      if (workspaceId) {
        const wsRepo = new WorkspaceRepository(this.db)
        const ws = wsRepo.get(workspaceId)
        workspacePath = ws?.root_path ?? null
      }
    } catch { /* ignore */ }

    const deps: CommandDeps = {
      getSession: (id) => {
        const s = sessionRepo.get(id)
        if (s == null) return null
        return { title: s.title, status: s.status, modelId: s.model_id ?? null, providerProfileId: s.provider_profile_id ?? '' }
      },
      updateSession: async (id, fields) => { sessionRepo.updateRuntime(id, fields) },
      clearSessionEvents: async (id) => {
        eventRepo.deleteBySession(id)
        this.seqCounters.delete(id)
      },
      getProviderName: (id) => providerRepo.get(id)?.name ?? null,
      setApprovalMode: (id, enabled) => { this.approvalOverrides.set(id, enabled) },
      getWorkspacePath: () => workspacePath,
      execShell: async (command, cwd) => {
        const { exec } = await import('node:child_process')
        const { promisify } = await import('node:util')
        const execAsync = promisify(exec)
        try {
          const { stdout, stderr } = await execAsync(command, { cwd: cwd ?? workspacePath ?? undefined, timeout: 30000, maxBuffer: 1024 * 1024 })
          return { stdout: stdout || '', stderr: stderr || '', exitCode: 0 }
        } catch (err: unknown) {
          const e = err as { stdout?: string; stderr?: string; code?: number }
          return { stdout: e.stdout || '', stderr: e.stderr || '', exitCode: e.code ?? 1 }
        }
      },
      getSessionEventCount: (id) => eventRepo.countBySession(id),
      getSessionUsage: (_id) => null,
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
        eventRepo.insert({ id: event.id, sessionId: params.sessionId, turnId, eventType: event.type, eventJson: JSON.stringify(event) })
      } catch { /* non-fatal */ }
    }

    return { isCommand: true, forwardToAgent: false }
  }

  listCommands(): CommandListItem[] {
    return this.commandRegistry.listItems()
  }

  async sendTurn(params: {
    sessionId: string
    message: string
    /** 可选：要使用的 Skill ID */
    skillId?: string
    /** 可选：Skill 参数 */
    skillParams?: Record<string, unknown>
  }): Promise<{ turnId: string; started: boolean }> {
    const { sessionId, message, skillId, skillParams } = params
    const turnId = crypto.randomUUID()
    if (this.activeLoops.has(sessionId)) {
      this.enqueueTurn(sessionId, this.makePendingTurn(turnId, message, skillId, skillParams))
      return { turnId, started: false }
    }

    await this.startTurn(sessionId, turnId, message, skillId, skillParams)
    return { turnId, started: true }
  }

  private async startTurn(
    sessionId: string,
    turnId: string,
    message: string,
    skillId?: string,
    skillParams?: Record<string, unknown>,
  ): Promise<void> {
    if (this.activeLoops.has(sessionId)) {
      this.enqueueTurn(sessionId, this.makePendingTurn(turnId, message, skillId, skillParams))
      return
    }

    const sessionRepo = new SessionRepository(this.db)
    const providerRepo = new ProviderProfileRepository(this.db)
    const eventRepo = new EventRepository(this.db)

    const session = sessionRepo.findByIdOrFail(sessionId)
    if (session.provider_profile_id == null) {
      throw new Error(`Session ${sessionId} has no provider profile`)
    }

    const existingEventCount = eventRepo.countBySession(sessionId)
    if (existingEventCount === 0 && shouldDeriveSessionTitle(session.title)) {
      sessionRepo.updateTitle(sessionId, deriveSessionTitle(message))
    }
    const historyMessages = buildModelHistoryMessages(eventRepo, sessionId)

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
    }

    const model = session.model_id ?? config.defaultModel ?? config.model
    if (model == null || model.length === 0) {
      throw new Error(`Provider ${provider.id} has no default model configured`)
    }

    const agentAdapter = getAgentAdapterFromSession(session.agent_adapter, session.chat_mode, provider.provider_type)
    const storedPermissionMode = getPermissionModeFromSession(session.permission_mode, agentAdapter)
    const permissionMode = this.getEffectivePermissionMode(sessionId, agentAdapter, storedPermissionMode)

    // Workspace root path for tools
    let workspaceRootPath = process.cwd()
    let workspaceInfo: { name: string; rootPath: string; projectKind: string } | undefined
    const projectContextBudgetTokens = Math.max(2_000, Math.min(60_000, Math.floor(resolveSoftContextLimit(model) * 0.25)))
    let projectContext = new ProjectContextService().discover(undefined, {
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
        projectContext = new ProjectContextService().discover(ws.root_path, {
          mode: 'project-smart',
          budgetTokens: projectContextBudgetTokens,
        })
      }
    }

    // Query active rules (system + current project scope) and append workspace files.
    const rulesRepo = new RulesRepository(this.db)
    const activeRules = rulesRepo.list({ scope: 'system' })
      .concat(
        rulesRepo.list({ scope: 'project' })
          .filter((r) => r.scope_ref == null || primaryWorkspaceId == null || r.scope_ref === primaryWorkspaceId),
      )
      .filter((r) => r.enabled === 1)
      .map((r) => r.content)
      .concat(projectContext.rules)

    // Build explicit skill prompt if skillId is provided; available skills are composed below.
    let explicitSkillPrompt: string | undefined
    const skillRepo = new SkillRepository(this.db)
    if (skillId != null) {
      const { SkillLoader } = await import('../skills/skill-loader.js')
      const loader = new SkillLoader(skillRepo)
      const sp = loader.buildSystemPrompt(skillId, skillParams ?? {})
      if (sp) explicitSkillPrompt = sp
    }
    const runtimeComposition = new RuntimeCompositionService(skillRepo, new SettingsRepository(this.db))
    const runtimeContext = runtimeComposition.composeRuntimeContext(
      {
        ...(primaryWorkspaceId != null ? { workspaceId: primaryWorkspaceId } : {}),
        sessionId,
      },
      explicitSkillPrompt,
    )
    const composedSystemPrompt = joinPromptSections(runtimeContext.systemPrompt, projectContext.systemPrompt)
    const composedSkillSystemPrompt = joinPromptSections(runtimeContext.skillSystemPrompt, projectContext.skillSystemPrompt)

    // Initialize seq counter from existing event count
    if (!this.seqCounters.has(sessionId)) {
      this.seqCounters.set(sessionId, existingEventCount)
    }

    // ── SDK Execution Path ─────────────────────────────────────────────────
    // Claude execution is SDK-only. If the SDK is missing or cannot load, fail
    // the turn with an actionable error instead of falling back to direct API.
    this.emitAndPersist(sessionId, turnId, {
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
        rules: projectContext.sources.filter((source) => source.kind === 'rule' && source.included !== false).length,
        skills: projectContext.sources.filter((source) => source.kind === 'skill' && source.included !== false).length,
        agents: projectContext.sources.filter((source) => source.kind === 'agent' && source.included !== false).length,
      },
    }, eventRepo)

    if (agentAdapter === 'claude-sdk' || agentAdapter === 'claude') {
      const sdkConfig: SDKExecutorConfig = {
        apiKey,
        model,
        workspaceRootPath,
        permissionMode,
        ...(config.apiEndpoint != null ? { apiEndpoint: config.apiEndpoint } : {}),
        ...(composedSystemPrompt != null ? { systemPrompt: composedSystemPrompt } : {}),
        ...(composedSkillSystemPrompt != null ? { skillSystemPrompt: composedSkillSystemPrompt } : {}),
        maxTurnCount: this.iterationOverrides.get(sessionId) ?? 25,
        ...(config.maxTokens != null ? { maxTokens: config.maxTokens } : {}),
        ...(session.reasoning_effort != null ? { reasoningEffort: session.reasoning_effort as 'low' | 'medium' | 'high' | 'xhigh' } : {}),
        enableCheckpoints: true,
        continueSession: existingEventCount > 0,
        ...(this.onApproval != null ? { approvalCallback: this.onApproval } : {}),
      }
      await this.tryStartSDKTurn(
        sessionId, turnId, message, eventRepo, sessionRepo, sdkConfig,
      )
      return
    }

    // ── Direct API Execution Path ──────────────────────────────────────────
    // Uses our own AgentLoop + ToolRegistry with the direct API adapters.
    const apiKind: 'chat' | 'responses' = config.codexApiKind === 'responses' ? 'responses' : 'chat'
    const adapter = createAdapter(agentAdapter, apiKind)

    const tools = new ToolRegistry()

    // Register MCP tools from connected servers
    try {
      this.mcpService.registerToToolRegistry(tools)
    } catch {
      // MCP tool registration failure is non-fatal
    }

    const agentConfig: AgentConfig = {
      adapter,
      apiKey,
      model,
      ...(config.apiEndpoint !== undefined && { apiEndpoint: config.apiEndpoint }),
      ...(composedSystemPrompt != null ? { systemPrompt: composedSystemPrompt } : {}),
      ...(composedSkillSystemPrompt != null ? { skillSystemPrompt: composedSkillSystemPrompt } : {}),
      tools,
      toolContext: { workspaceRootPath, sessionId },
      context: {
        ...(workspaceInfo != null ? { workspace: workspaceInfo } : {}),
        ...(activeRules.length > 0 ? { projectRules: activeRules } : {}),
      },
      ...(config.maxTokens != null ? { maxTokens: config.maxTokens } : {}),
      ...(config.temperature != null ? { temperature: config.temperature } : {}),
      ...(session.reasoning_effort != null ? { reasoningEffort: session.reasoning_effort as 'low' | 'medium' | 'high' | 'xhigh' } : {}),
      permissionMode,
      maxTurnIterations: this.iterationOverrides.get(sessionId) ?? defaultMaxIterations(agentAdapter),
      ...(this.onApproval != null ? { approvalCallback: this.onApproval } : {}),
    }

    const loop = new AgentLoop()
    const changedFiles = new Set<string>()
    let validationSuggestionEmitted = false
    const maybeEmitValidationSuggestion = () => {
      if (validationSuggestionEmitted || changedFiles.size === 0) return
      validationSuggestionEmitted = true
      const suggestion = new ValidationSuggestionService().suggest({
        workspaceRootPath,
        changedFiles: Array.from(changedFiles),
      })
      if (suggestion == null) return
      this.emitAndPersist(sessionId, turnId, {
        id: crypto.randomUUID(),
        type: 'validation_suggestion',
        sessionId,
        turnId,
        timestamp: new Date().toISOString(),
        seq: 0,
        summary: suggestion.summary,
        changedFiles: suggestion.changedFiles,
        commands: suggestion.commands,
      }, eventRepo)
    }

    loop.onEvent((event) => {
      if (event.type === 'file_change') changedFiles.add(event.path)
      this.emitAndPersist(sessionId, turnId, event, eventRepo)
      if (event.type === 'agent_status' && event.status === 'completed') {
        maybeEmitValidationSuggestion()
      }
    })

    this.activeLoops.set(sessionId, loop)
    sessionRepo.updateStatus(sessionId, 'running')
    this.emitQueueChanged(sessionId)

    // Fire-and-forget: start the loop without awaiting
    const execution = historyMessages.length > 0
      ? loop.executeTurn(sessionId, turnId, message, agentConfig, historyMessages)
      : loop.executeTurn(sessionId, turnId, message, agentConfig)
    execution
      .then(() => {
        maybeEmitValidationSuggestion()
        sessionRepo.updateStatus(sessionId, 'idle')
      })
      .catch(() => {
        sessionRepo.updateStatus(sessionId, 'error')
      })
      .finally(() => {
        if (this.activeLoops.get(sessionId) === loop) {
          this.activeLoops.delete(sessionId)
          this.startNextQueuedTurn(sessionId)
        }
      })
  }

  /**
   * Run the turn through the Claude Agent SDK, or fail explicitly when the SDK
   * is unavailable. Spark no longer falls back to direct Anthropic API.
   */
  private async tryStartSDKTurn(
    sessionId: string,
    turnId: string,
    message: string,
    eventRepo: EventRepository,
    sessionRepo: SessionRepository,
    config: SDKExecutorConfig,
  ): Promise<void> {
    const makeBase = () => ({
      id: crypto.randomUUID(),
      sessionId,
      turnId,
      timestamp: new Date().toISOString(),
      seq: 0,
    })

    const emitSdkRequiredError = (rawError?: string) => {
      this.emitAndPersist(sessionId, turnId, {
        ...makeBase(),
        type: 'user_message',
        content: message,
      }, eventRepo)
      this.emitAndPersist(sessionId, turnId, {
        ...makeBase(),
        type: 'agent_error',
        code: 'SDK_REQUIRED',
        message: 'Claude Agent SDK is required for Claude execution. Open Settings and install or repair the Claude Agent SDK.',
        retryable: false,
        ...(rawError != null ? { rawError } : {}),
      }, eventRepo)
      this.emitAndPersist(sessionId, turnId, {
        ...makeBase(),
        type: 'agent_status',
        status: 'error',
        message: 'Claude Agent SDK is not available',
      }, eventRepo)
      sessionRepo.updateStatus(sessionId, 'error')
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
    const mcpServers = this.buildMcpServersForSDK()

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
      this.emitAndPersist(sessionId, turnId, {
        ...makeBase(),
        type: 'validation_suggestion',
        summary: suggestion.summary,
        changedFiles: suggestion.changedFiles,
        commands: suggestion.commands,
      }, eventRepo)
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
  private buildMcpServersForSDK(): Record<string, SDKMcpServerConfig> {
    const result: Record<string, SDKMcpServerConfig> = {}
    const servers = this.mcpService.listServers()

    for (const server of servers) {
      if (!server.enabled) continue
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

  private emitAndPersist(sessionId: string, turnId: string, event: AgentEvent, eventRepo: EventRepository): void {
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
    skillId?: string,
    skillParams?: Record<string, unknown>,
  ): PendingTurn {
    return {
      turnId,
      message,
      enqueuedAt: new Date().toISOString(),
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
    void this.startTurn(sessionId, next.turnId, next.message, next.skillId, next.skillParams)
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
    if (override === true && (storedMode === 'claude-bypass' || storedMode === 'codex-full-access')) {
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
      agentAdapter: getAgentAdapterFromSession(row.agent_adapter, row.chat_mode, null),
      permissionMode: getPermissionModeFromSession(row.permission_mode, getAgentAdapterFromSession(row.agent_adapter, row.chat_mode, null)),
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
        ...(params.pinned !== undefined ? { pinnedAt: params.pinned ? new Date().toISOString() : null } : {}),
        ...(params.archived !== undefined ? { archivedAt: params.archived ? new Date().toISOString() : null } : {}),
      })
    }

    if (
      params.providerProfileId !== undefined
      || params.modelId !== undefined
      || params.agentAdapter !== undefined
      || params.permissionMode !== undefined
      || params.chatMode !== undefined
      || params.reasoningEffort !== undefined
    ) {
      sessionRepo.updateRuntime(params.sessionId, {
        ...(params.providerProfileId !== undefined ? { providerProfileId: params.providerProfileId } : {}),
        ...(params.modelId !== undefined ? { modelId: params.modelId } : {}),
        ...(params.agentAdapter !== undefined ? { agentAdapter: params.agentAdapter } : {}),
        ...(params.permissionMode !== undefined ? { permissionMode: params.permissionMode } : {}),
        ...(params.chatMode !== undefined ? { chatMode: params.chatMode } : {}),
        ...(params.reasoningEffort !== undefined ? { reasoningEffort: params.reasoningEffort } : {}),
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
        agentAdapter: getAgentAdapterFromSession(row.agent_adapter, row.chat_mode, null),
        permissionMode: getPermissionModeFromSession(row.permission_mode, getAgentAdapterFromSession(row.agent_adapter, row.chat_mode, null)),
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
  return `${chars.slice(0, SESSION_TITLE_MAX_LENGTH - 3).join('').trimEnd()}...`
}

function getAgentAdapterFromSession(value: string | null | undefined, legacyChatMode: string | null | undefined, providerType: string | null): AgentAdapterKind {
  if (value === 'claude-sdk' || value === 'codex') return value
  if (value === 'claude') return 'claude-sdk'
  if (legacyChatMode === 'claude-sdk' || legacyChatMode === 'codex') return legacyChatMode
  if (legacyChatMode === 'claude') return 'claude-sdk'
  // Default: Anthropic providers use claude-sdk. Direct Anthropic API is not a
  // supported execution path for the core code agent.
  return providerType === 'anthropic' ? 'claude-sdk' : 'codex'
}

function getPermissionModeFromSession(value: string | null | undefined, adapter: AgentAdapterKind): SessionPermissionMode {
  if (
    value === 'claude-ask'
    || value === 'claude-auto-edits'
    || value === 'claude-plan'
    || value === 'claude-auto'
    || value === 'claude-bypass'
    || value === 'codex-default'
    || value === 'codex-auto-review'
    || value === 'codex-full-access'
  ) {
    return value
  }
  return adapter === 'codex' ? 'codex-default' : 'claude-ask'
}

function defaultMaxIterations(adapter: AgentAdapterKind): number {
  // claude-sdk: SDK manages its own iteration limits internally
  if (adapter === 'claude-sdk') return 25
  // claude direct API: supports long chains
  if (adapter === 'claude') return 150
  // codex/openai: conservative
  return 100
}

function getChatModeFromSession(value: string | null | undefined): 'agent' | 'ask' | 'edit' | 'review' {
  if (value === 'ask' || value === 'edit' || value === 'review') return value
  return 'agent'
}

function buildModelHistoryMessages(eventRepo: EventRepository, sessionId: string): ChatMessage[] {
  const { events: rows } = eventRepo.queryBySession({
    sessionId,
    limit: MODEL_HISTORY_EVENT_LIMIT,
  })
  const messages: ChatMessage[] = []
  const openToolCallIds = new Set<string>()

  for (const row of rows) {
    const event = parseAgentEvent(row.event_json)
    if (event == null) continue

    switch (event.type) {
      case 'user_message':
        if (event.content.trim().length > 0) {
          messages.push({ role: 'user', content: event.content })
        }
        break
      case 'assistant_message':
        if (event.mode === 'complete' && event.content.trim().length > 0) {
          messages.push({ role: 'assistant', content: event.content })
        }
        break
      case 'tool_call':
        openToolCallIds.add(event.toolCallId)
        messages.push({
          role: 'assistant',
          content: [{
            type: 'tool_use',
            id: event.toolCallId,
            name: event.toolName,
            input: event.toolInput,
          }],
        })
        break
      case 'tool_result':
        if (!openToolCallIds.has(event.toolCallId)) break
        openToolCallIds.delete(event.toolCallId)
        messages.push({
          role: 'user',
          content: [{
            type: 'tool_result',
            tool_use_id: event.toolCallId,
            content: serializeToolResultForHistory(event),
          }],
        })
        break
      default:
        break
    }
  }

  if (openToolCallIds.size === 0) return messages
  return messages.filter((message) => !isUnresolvedToolUseMessage(message, openToolCallIds))
}

function joinPromptSections(...sections: Array<string | undefined>): string | undefined {
  const joined = sections
    .map((section) => section?.trim())
    .filter((section): section is string => section != null && section.length > 0)
    .join('\n\n')
  return joined.length > 0 ? joined : undefined
}

function parseAgentEvent(json: string): AgentEvent | null {
  try {
    return JSON.parse(json) as AgentEvent
  } catch {
    return null
  }
}

function serializeToolResultForHistory(event: Extract<AgentEvent, { type: 'tool_result' }>): string {
  if (event.status !== 'success') return event.error ?? 'error'
  return stringifyHistoryValue(event.output)
}

function stringifyHistoryValue(value: unknown): string {
  if (typeof value === 'string') return value
  if (value === undefined) return ''
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

function isUnresolvedToolUseMessage(message: ChatMessage, unresolvedToolCallIds: Set<string>): boolean {
  if (message.role !== 'assistant' || typeof message.content === 'string') return false
  return message.content.some((block) => block.type === 'tool_use' && unresolvedToolCallIds.has(block.id))
}

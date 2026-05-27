import crypto from 'node:crypto'
import {
  EventRepository,
  ProviderProfileRepository,
  RulesRepository,
  SessionRepository,
  WorkspaceRepository,
  McpServerRepository,
} from '@spark/storage'
import type { SparkDatabase } from '@spark/storage'
import type { AgentEvent, SessionCreateResponse, SessionId, SessionListResponse, SessionSearchResponse } from '@spark/protocol'
import type { SessionPermissionMode } from '@spark/protocol'
import { AgentLoop, ToolRegistry, isCommand, parseCommand, createBuiltinRegistry } from '../core/index.js'
import type { AgentConfig, CommandDeps } from '../core/index.js'
import * as keystore from '@spark/shared/keystore'
import { createAdapter } from './adapter-factory.js'
import { McpService } from './mcp-server.service.js'

export type SessionEventHandler = (event: AgentEvent) => void
export type ApprovalHandler = (sessionId: string, toolName: string, toolInput: Record<string, unknown>) => Promise<boolean>
type AgentAdapterKind = 'claude' | 'codex'
type PendingTurn = { turnId: string; message: string }

const DEFAULT_SESSION_TITLES = new Set(['New Session', '新会话', 'Workspace Session', '未命名会话'])
const SESSION_TITLE_MAX_LENGTH = 40

export class SessionService {
  private activeLoops = new Map<string, AgentLoop>()  // sessionId → AgentLoop
  private pendingTurns = new Map<string, PendingTurn[]>()
  private seqCounters = new Map<string, number>()
  private approvalOverrides = new Map<string, boolean>()  // sessionId → approval enabled
  private readonly commandRegistry = createBuiltinRegistry()
  private readonly mcpService: McpService

  constructor(
    private readonly db: SparkDatabase,
    private readonly onEvent: SessionEventHandler,
    private readonly onApproval?: ApprovalHandler,
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
    }

    const ctx = {
      sessionId: params.sessionId,
      ...(session?.provider_profile_id != null ? { providerId: session.provider_profile_id } : {}),
      ...(session?.model_id != null ? { model: session.model_id } : {}),
    }

    const result = await this.commandRegistry.execute(parsed, ctx, deps)
    return { isCommand: true, result }
  }

  listCommands(): Array<{ name: string; description: string; category: string; usage?: string; isDangerous?: boolean }> {
    return this.commandRegistry.list().map((c) => ({
      name: c.name,
      description: c.description,
      category: c.category,
      ...(c.usage !== undefined ? { usage: c.usage } : {}),
      ...(c.isDangerous === true ? { isDangerous: true } : {}),
    }))
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
      this.enqueueTurn(sessionId, { turnId, message })
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
      this.enqueueTurn(sessionId, { turnId, message })
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
    }

    const model = session.model_id ?? config.defaultModel ?? config.model
    if (model == null || model.length === 0) {
      throw new Error(`Provider ${provider.id} has no default model configured`)
    }

    const agentAdapter = getAgentAdapterFromSession(session.agent_adapter, session.chat_mode, provider.provider_type)
    const storedPermissionMode = getPermissionModeFromSession(session.permission_mode, agentAdapter)
    const permissionMode = this.getEffectivePermissionMode(sessionId, agentAdapter, storedPermissionMode)
    const adapter = createAdapter(agentAdapter)

    // Workspace root path for tools
    let workspaceRootPath = process.cwd()
    let workspaceInfo: { name: string; rootPath: string; projectKind: string } | undefined
    const workspaceIds = sessionRepo.getWorkspaceIds(sessionId)
    if (workspaceIds.length > 0) {
      const wsRepo = new WorkspaceRepository(this.db)
      const ws = wsRepo.get(workspaceIds[0] ?? '')
      if (ws != null) {
        workspaceRootPath = ws.root_path
        workspaceInfo = { name: ws.name, rootPath: ws.root_path, projectKind: ws.project_kind }
      }
    }

    // Query active rules (system + project scope)
    const rulesRepo = new RulesRepository(this.db)
    const activeRules = rulesRepo.list({ scope: 'system' })
      .concat(rulesRepo.list({ scope: 'project' }))
      .filter((r) => r.enabled === 1)
      .map((r) => r.content)

    const tools = new ToolRegistry()

    // Register MCP tools from connected servers
    try {
      this.mcpService.registerToToolRegistry(tools)
    } catch {
      // MCP tool registration failure is non-fatal
    }

    // Build skill system prompt if skillId is provided
    let skillSystemPrompt: string | undefined
    if (skillId != null) {
      const { SkillLoader } = await import('../skills/skill-loader.js')
      const { SkillRepository } = await import('@spark/storage')
      const skillRepo = new SkillRepository(this.db)
      const loader = new SkillLoader(skillRepo)
      const sp = loader.buildSystemPrompt(skillId, skillParams ?? {})
      if (sp) skillSystemPrompt = sp
    }

    const agentConfig: AgentConfig = {
      adapter,
      apiKey,
      model,
      ...(config.apiEndpoint !== undefined && { apiEndpoint: config.apiEndpoint }),
      ...(skillSystemPrompt != null ? { skillSystemPrompt } : {}),
      tools,
      toolContext: { workspaceRootPath },
      context: {
        ...(workspaceInfo != null ? { workspace: workspaceInfo } : {}),
        ...(activeRules.length > 0 ? { projectRules: activeRules } : {}),
      },
      ...(config.maxTokens != null ? { maxTokens: config.maxTokens } : {}),
      ...(config.temperature != null ? { temperature: config.temperature } : {}),
      ...(session.reasoning_effort != null ? { reasoningEffort: session.reasoning_effort as 'low' | 'medium' | 'high' | 'xhigh' } : {}),
      permissionMode,
      ...(this.onApproval != null ? { approvalCallback: this.onApproval } : {}),
    }

    // Initialize seq counter from existing event count
    if (!this.seqCounters.has(sessionId)) {
      this.seqCounters.set(sessionId, existingEventCount)
    }

    const loop = new AgentLoop()

    loop.onEvent((event) => {
      const seq = this.seqCounters.get(sessionId) ?? 0
      this.seqCounters.set(sessionId, seq + 1)
      const sequenced = { ...event, seq }
      this.onEvent(sequenced)
      // Persist (fire-and-forget, sync SQLite call)
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
    })

    this.activeLoops.set(sessionId, loop)
    sessionRepo.updateStatus(sessionId, 'running')

    // Fire-and-forget: start the loop without awaiting
    loop
      .executeTurn(sessionId, turnId, message, agentConfig)
      .then(() => {
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

  private enqueueTurn(sessionId: string, turn: PendingTurn): void {
    const queue = this.pendingTurns.get(sessionId) ?? []
    queue.push(turn)
    this.pendingTurns.set(sessionId, queue)
  }

  private startNextQueuedTurn(sessionId: string): void {
    const queue = this.pendingTurns.get(sessionId)
    const next = queue?.shift()
    if (queue == null || next == null) {
      this.pendingTurns.delete(sessionId)
      return
    }
    if (queue.length === 0) this.pendingTurns.delete(sessionId)
    void this.startTurn(sessionId, next.turnId, next.message)
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

  async cancelTurn(sessionId: string): Promise<{ cancelled: boolean }> {
    const loop = this.activeLoops.get(sessionId)
    this.pendingTurns.delete(sessionId)
    if (loop == null) return { cancelled: false }
    loop.cancel()
    this.activeLoops.delete(sessionId)
    const sessionRepo = new SessionRepository(this.db)
    sessionRepo.updateStatus(sessionId, 'idle')
    return { cancelled: true }
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
    eventRepo.deleteBySession(sessionId)
    return { deleted: sessionRepo.delete(sessionId) }
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
  if (value === 'claude' || value === 'codex') return value
  if (legacyChatMode === 'claude' || legacyChatMode === 'codex') return legacyChatMode
  return providerType === 'anthropic' ? 'claude' : 'codex'
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
  return adapter === 'claude' ? 'claude-ask' : 'codex-default'
}

function getChatModeFromSession(value: string | null | undefined): 'agent' | 'ask' | 'edit' | 'review' {
  if (value === 'ask' || value === 'edit' || value === 'review') return value
  return 'agent'
}

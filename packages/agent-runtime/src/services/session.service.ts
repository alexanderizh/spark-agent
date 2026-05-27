import crypto from 'node:crypto'
import {
  EventRepository,
  ProviderProfileRepository,
  RulesRepository,
  SessionRepository,
  WorkspaceRepository,
} from '@spark/storage'
import type { SparkDatabase } from '@spark/storage'
import type { AgentEvent, SessionCreateResponse, SessionId, SessionListResponse, SessionSearchResponse } from '@spark/protocol'
import type { SessionPermissionMode } from '@spark/protocol'
import { AgentLoop, ToolRegistry } from '../core/index.js'
import type { AgentConfig } from '../core/index.js'
import * as keystore from '@spark/shared/keystore'
import { createAdapter } from './adapter-factory.js'

export type SessionEventHandler = (event: AgentEvent) => void
export type ApprovalHandler = (sessionId: string, toolName: string, toolInput: Record<string, unknown>) => Promise<boolean>
type AgentAdapterKind = 'claude' | 'codex'

export class SessionService {
  private activeLoops = new Map<string, AgentLoop>()  // sessionId → AgentLoop
  private seqCounters = new Map<string, number>()

  constructor(
    private readonly db: SparkDatabase,
    private readonly onEvent: SessionEventHandler,
    private readonly onApproval?: ApprovalHandler,
  ) {}

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
      title: params.title ?? 'New Session',
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

  async sendTurn(params: {
    sessionId: string
    message: string
  }): Promise<{ turnId: string; started: boolean }> {
    const { sessionId, message } = params
    const sessionRepo = new SessionRepository(this.db)
    const providerRepo = new ProviderProfileRepository(this.db)
    const eventRepo = new EventRepository(this.db)

    const session = sessionRepo.findByIdOrFail(sessionId)
    if (session.provider_profile_id == null) {
      throw new Error(`Session ${sessionId} has no provider profile`)
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
    const agentConfig: AgentConfig = {
      adapter,
      apiKey,
      model,
      ...(config.apiEndpoint !== undefined && { apiEndpoint: config.apiEndpoint }),
      tools,
      toolContext: { workspaceRootPath },
      context: {
        ...(workspaceInfo != null ? { workspace: workspaceInfo } : {}),
        ...(activeRules.length > 0 ? { projectRules: activeRules } : {}),
      },
      ...(config.maxTokens != null ? { maxTokens: config.maxTokens } : {}),
      ...(config.temperature != null ? { temperature: config.temperature } : {}),
      ...(session.reasoning_effort != null ? { reasoningEffort: session.reasoning_effort as 'low' | 'medium' | 'high' | 'xhigh' } : {}),
      permissionMode: getPermissionModeFromSession(session.permission_mode, agentAdapter),
      ...(this.onApproval != null ? { approvalCallback: this.onApproval } : {}),
    }

    // Initialize seq counter from existing event count
    if (!this.seqCounters.has(sessionId)) {
      this.seqCounters.set(sessionId, eventRepo.countBySession(sessionId))
    }

    const turnId = crypto.randomUUID()
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
        this.activeLoops.delete(sessionId)
      })

    return { turnId, started: true }
  }

  async cancelTurn(sessionId: string): Promise<{ cancelled: boolean }> {
    const loop = this.activeLoops.get(sessionId)
    if (loop == null) return { cancelled: false }
    loop.cancel()
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

/**
 * 会话 CRUD / 引用 / fork（P1-W3-S4 迁出，2026-08-20）。
 *
 * 承接会话列表/搜索/历史/更新/删除与 fork、会话引用（reference）全套读写。
 * 对 SessionService 运行态的依赖（mcpVersion 计数、permissionMode 变更副作用链、
 * 执行器清理、事件后台清理）经窄接口 SessionCrudHost 注入。
 */
import {
  EventRepository,
  ProviderProfileRepository,
  SessionCollaborationRepository,
  SessionRepository,
} from '@spark/storage'
import type { SparkDatabase } from '@spark/storage'
import type {
  AgentEvent,
  CliSparkOverride,
  SessionId,
  SessionListResponse,
  SessionPermissionMode,
  SessionReference,
  SessionReferenceCandidate,
  SessionSearchResponse,
} from '@spark/protocol'
import { createLogger } from '@spark/shared'
import { readSessionRuntimeWorktree } from '../session-worktree-state.js'
import {
  getChatModeFromSession,
  getCliSparkOverrideFromMetadata,
  getDebugModeFromMetadata,
  getImportedFromMetadata,
  normalizeCliSparkOverride,
  normalizeReasoningEffort,
  toProtocolCandidate,
  toProtocolLineage,
  toProtocolReference,
  toProtocolReferenceTurn,
  trimHistoryEvent,
} from './session-pure-utils.js'
import { getAgentAdapterFromSession, getPermissionModeFromSession } from './engine-kinds.js'
import type { AgentAdapterKind } from '../session-resume-gate.js'
import type { SparkReasoningEffort } from '../../sdk/reasoning-effort.js'

const log = createLogger('session.crud')

/** 会话 CRUD 模块对 SessionService 的窄依赖面。 */
export interface SessionCrudHost {
  /** debugMode 等开关变更后 bump MCP 版本计数（下一 turn 重新协商工具面）。 */
  bumpMcpVersion(): void
  /** permissionMode 变更副作用链：plan 闸门解除 + 队列恢复 + 执行器热切换。 */
  applyPermissionModeChange(sessionId: string, permissionMode: SessionPermissionMode): void
  /** 终止并清理会话的运行中执行器与内存态，返回此前是否在跑。 */
  clearSessionMemoryForEvents(sessionId: string): boolean
  /** 会话删除后的残留事件后台清理。 */
  cleanupSessionEventsInBackground(sessionId: string): void
}

export class SessionCrudController {
  constructor(
    private readonly db: SparkDatabase,
    private readonly host: SessionCrudHost,
  ) {}

  /** Create an independent materialized child session from a completed turn. */
  async forkSession(params: {
    sourceSessionId: string
    anchorTurnId?: string
    title?: string
  }): Promise<import('@spark/protocol').SessionForkResponse> {
    const collaboration = new SessionCollaborationRepository(this.db)
    const result = collaboration.forkSession(params)
    const session = await this.updateSession({ sessionId: result.child.id })
    return {
      sessionId: result.child.id as SessionId,
      session: session.session,
      lineage: toProtocolLineage(result.lineage)!,
      copiedTurnCount: result.copiedTurnCount,
      sourceWasRunning: result.sourceWasRunning,
    }
  }

  async getSessionLineage(
    sessionId: string,
  ): Promise<import('@spark/protocol').SessionLineageResponse> {
    const collaboration = new SessionCollaborationRepository(this.db)
    return {
      lineage: toProtocolLineage(collaboration.getLineage(sessionId)),
      children: collaboration.listChildren(sessionId).map((row) => toProtocolLineage(row)!),
    }
  }

  async listSessionReferenceCandidates(params: {
    targetSessionId: string
    workspaceId?: string
    query?: string
    includeArchived?: boolean
    limit?: number
  }): Promise<{ candidates: SessionReferenceCandidate[] }> {
    return {
      candidates: new SessionCollaborationRepository(this.db)
        .listCandidates(params)
        .map(toProtocolCandidate),
    }
  }

  async attachSessionReference(params: {
    targetSessionId: string
    sourceSessionId: string
    snapshotSeq?: number
  }): Promise<{ reference: SessionReference }> {
    return {
      reference: toProtocolReference(
        new SessionCollaborationRepository(this.db).attachReference(params),
      ),
    }
  }

  async listSessionReferences(sessionId: string): Promise<{ references: SessionReference[] }> {
    return {
      references: new SessionCollaborationRepository(this.db)
        .listReferences(sessionId)
        .map(toProtocolReference),
    }
  }

  async listActiveSessionReferences(
    sessionId: string,
  ): Promise<{ references: SessionReference[] }> {
    const result = await this.listSessionReferences(sessionId)
    return { references: result.references.filter((reference) => reference.status === 'active') }
  }

  async updateSessionReference(params: {
    targetSessionId: string
    referenceId: string
  }): Promise<{ reference: SessionReference }> {
    return {
      reference: toProtocolReference(
        new SessionCollaborationRepository(this.db).updateReferenceSnapshot(params),
      ),
    }
  }

  async revokeSessionReference(params: {
    targetSessionId: string
    referenceId: string
  }): Promise<{ revoked: boolean }> {
    return { revoked: new SessionCollaborationRepository(this.db).revokeReference(params) }
  }

  async readReferencedSession(params: {
    targetSessionId: string
    referenceId: string
    cursor?: number
    turnLimit?: number
    detail?: 'transcript' | 'user_visible_activity'
    actor?: 'user' | 'agent' | 'system'
  }): Promise<import('@spark/protocol').SessionReadReferenceResponse> {
    const result = new SessionCollaborationRepository(this.db).readReference(params)
    return {
      reference: toProtocolReference(result.reference),
      turns: result.turns.map(toProtocolReferenceTurn),
      nextCursor: result.nextCursor,
      hasMore: result.hasMore,
    }
  }

  async searchReferencedSession(params: {
    targetSessionId: string
    referenceId: string
    query: string
    limit?: number
    actor?: 'user' | 'agent' | 'system'
  }): Promise<import('@spark/protocol').SessionSearchReferenceResponse> {
    const result = new SessionCollaborationRepository(this.db).searchReference(params)
    return {
      reference: toProtocolReference(result.reference),
      hits: result.hits.map((hit) => ({
        ...hit,
        turnId: hit.turnId as import('@spark/protocol').TurnId,
      })),
    }
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
    status?: 'idle' | 'running' | 'error'
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
      runtimeWorktree: readSessionRuntimeWorktree(row.metadata_json),
      cliSparkOverride: getCliSparkOverrideFromMetadata(row.metadata_json),
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
    cliSparkOverride?: CliSparkOverride | null
  }): Promise<{ session: SessionListResponse['sessions'][number] }> {
    const sessionRepo = new SessionRepository(this.db)

    // 调试模式开关存 metadata（per-session 能力开关，不新增列），与 team 配置同策略。
    // 切换会改变 MCP 工具集（挂/卸 spark_debug），bump mcpVersion 让下一 turn 起新
    // SDK 会话以重新协商工具列表，避免沿用 SDK 冻结的旧快照。
    if (params.debugMode !== undefined) {
      sessionRepo.patchMetadata(params.sessionId, { debugMode: params.debugMode })
      this.host.bumpMcpVersion()
    }

    if (params.cliSparkOverride !== undefined) {
      sessionRepo.patchMetadata(params.sessionId, {
        cliSparkOverride: normalizeCliSparkOverride(params.cliSparkOverride),
      })
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

    // permissionMode 变更副作用链（plan 闸门解除 / 队列恢复 / 执行器热切换）
    // 由宿主执行（SessionService.applyPermissionModeChange，P1-W3-S4）。
    if (params.permissionMode !== undefined) {
      this.host.applyPermissionModeChange(params.sessionId, params.permissionMode)
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
        runtimeWorktree: readSessionRuntimeWorktree(row.metadata_json),
        cliSparkOverride: getCliSparkOverrideFromMetadata(row.metadata_json),
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
    // 先终止在跑的执行器再删数据：否则子进程会成为孤儿，继续改磁盘、继续计费。
    const wasRunning = this.host.clearSessionMemoryForEvents(sessionId)
    if (wasRunning) {
      log.info('cancelled running executor before deleting session', { sessionId })
    }
    const deleted = sessionRepo.deleteWithRelatedData(sessionId)
    if (deleted) {
      this.host.cleanupSessionEventsInBackground(sessionId)
    }
    return { deleted }
  }
}

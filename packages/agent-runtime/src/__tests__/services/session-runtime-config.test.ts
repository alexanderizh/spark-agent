import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fileURLToPath } from 'node:url'
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { AgentEvent } from '@spark/protocol'
import * as keystore from '@spark/shared/keystore'
import {
  SessionService,
  buildMediaGenerationSystemPrompt,
  isSdkResumeSafe,
} from '../../services/session.service.js'

type SessionRow = {
  id: string
  kind: string
  title: string
  status: string
  project_id: string
  workspace_ids_json: string
  rule_bundle_id: string | null
  permission_profile_id: string | null
  provider_profile_id: string | null
  model_id: string | null
  agent_id: string | null
  agent_adapter: string
  permission_mode: string
  chat_mode: string
  reasoning_effort: string
  pinned_at: string | null
  archived_at: string | null
  metadata_json: string
  created_at: string
  updated_at: string
}

type ProviderRow = {
  id: string
  provider_type: string
  name: string
  config_json: string
  enabled: number
  keystore_ref: string | null
  is_default: number
  created_at: string
  updated_at: string
}

type EventRow = {
  id: string
  session_id: string
  run_id: string | null
  turn_id: string
  event_type: string
  event_json: string
  seq: number
  created_at: string
}

function requireEnvValue(env: Record<string, string>, key: string): string {
  const value = env[key]
  if (value == null || value.length === 0) throw new Error(`Missing required env value: ${key}`)
  return value
}

type MockAgentItem = {
  id: string
  name: string
  description: string
  builtIn: boolean
  enabled: boolean
  isDefault: boolean
  providerProfileId: string | null
  modelId: string | null
  agentAdapter: string
  permissionMode: string
  reasoningEffort: string
  prompt: string
  ruleIds: string[]
  skillIds: string[]
  disabledSkillIds: string[]
  mcpServerIds: string[]
  hookConfig: Record<string, unknown>
  workflowId: string | null
  metadata: Record<string, unknown>
  createdAt: string
  updatedAt: string
}

type MockWorkflowItem = {
  id: string
  name: string
  description: string
  graph: {
    nodes: Array<Record<string, unknown>>
    edges: Array<Record<string, unknown>>
  }
}

const mockState = vi.hoisted(() => ({
  sessions: new Map<string, SessionRow>(),
  providers: new Map<string, ProviderRow>(),
  mediaManifests: new Map<
    string,
    {
      id: string
      provider_kind: string
      model_id: string
      display_name: string
      version: string | null
      manifest_json: string
      built_in: number
      enabled: number
      source_urls_json: string
      last_checked_at: string | null
    }
  >(),
  providerMediaModels: [] as Array<{
    provider_profile_id: string
    manifest_id: string
    model_id: string | null
    enabled: number
    defaults_json: string
  }>,
  events: [] as EventRow[],
  mcpServers: [] as Array<{
    id: string
    scope: string
    name: string
    config_json: string
    enabled: number
    created_at: string
    updated_at: string
  }>,
  sdkConfigs: [] as Array<Record<string, unknown>>,
  sdkTurns: [] as Array<{ sessionId: string; turnId: string; message: string }>,
  workspaces: new Map<
    string,
    {
      id: string
      name: string
      root_path: string
      project_kind: string
      worktree_meta_json?: string | null
    }
  >(),
  agents: new Map<string, MockAgentItem>(),
  workflows: new Map<string, MockWorkflowItem>(),
  discussions: new Map<
    string,
    {
      id: string
      session_id: string
      host_agent_id: string
      topic: string | null
      round_index: number
      max_rounds: number
      state: 'active' | 'concluded' | 'canceled'
      started_at: string
      ended_at: string | null
    }
  >(),
  threadMessages: [] as Array<{
    id: string
    discussion_id: string
    sender_agent_id: string
    target_agent_id: string | null
    round_index: number
    kind: string
    content: string
    dispatch_id: string | null
    created_at: string
  }>,
  workflowRuns: new Map<
    string,
    {
      id: string
      session_id: string
      turn_id: string
      workflow_id: string
      status: 'working' | 'completed' | 'failed' | 'canceled'
      objective: string
      graph_json: string
      state_json: string
      executions_json: string
      atomic_executions_json: string
      completed_node_ids_json: string
      failed_node_json: string | null
      started_at: string
      updated_at: string
      ended_at: string | null
    }
  >(),
  nextSdkTurnErrors: [] as string[],
  nextSdkTurnStatuses: [] as Array<'completed' | 'cancelled' | 'error'>,
  nextSdkUsageEvents: [] as Array<Array<Extract<AgentEvent, { type: 'usage_update' }>>>,
  nextSdkTurnEvents: [] as AgentEvent[][],
  turnRequests: new Map<
    string,
    {
      id: string
      session_id: string
      payload_json: string
      status: 'accepted' | 'running' | 'completed' | 'failed' | 'cancelled'
      error_message: string | null
      created_at: string
      updated_at: string
    }
  >(),
  settings: new Map<string, unknown>(),
  usageRecords: [] as Array<{
    sessionId: string
    providerId: string
    modelId: string
    inputTokens: number
    outputTokens: number
    reasoningOutputTokens?: number
    cacheReadTokens?: number
    costUsd?: number
    requestTimestamp?: string
  }>,
}))

vi.mock('@spark/shared/keystore', () => ({
  getSecret: vi.fn(async () => 'test-api-key'),
  setSecret: vi.fn(),
  deleteSecret: vi.fn(),
  makeKeystoreRef: (provider: string, id: string) => `${provider}-${id}`,
  maskSecret: (secret: string) => `${secret.slice(0, 4)}****`,
}))

vi.mock('../../services/debug-log-server.service.js', () => ({
  getDebugLogServer: () => ({ start: async () => 43123 }),
}))

vi.mock('@spark/storage', () => {
  const now = () => '2026-05-28T00:00:00.000Z'

  class RoomLedgerService {
    static forAgent() { return new RoomLedgerService() }
    static forSystem() { return new RoomLedgerService() }
    static forUser() { return new RoomLedgerService() }
    getActiveContext() { return [] }
    create(input: Record<string, unknown>) { return input }
    correct(input: Record<string, unknown>) { return input }
    invalidate(input: Record<string, unknown>) { return input }
    tombstone(input: Record<string, unknown>) { return input }
    confirm(input: Record<string, unknown>) { return input }
    reject(input: Record<string, unknown>) { return input }
    restore(input: Record<string, unknown>) { return input }
    deleteRoom() { return 0 }
  }

  class SessionRepository {
    create(params: {
      id: string
      kind: string
      title: string
      status: string
      projectId: string
      workspaceIds?: string[]
      providerProfileId?: string
      modelId?: string
      agentId?: string
      agentAdapter?: string
      permissionMode?: string
      chatMode?: string
      reasoningEffort?: string
    }): SessionRow {
      const row: SessionRow = {
        id: params.id,
        kind: params.kind,
        title: params.title,
        status: params.status,
        project_id: params.projectId,
        workspace_ids_json: JSON.stringify(params.workspaceIds ?? []),
        rule_bundle_id: null,
        permission_profile_id: null,
        provider_profile_id: params.providerProfileId ?? null,
        model_id: params.modelId ?? null,
        agent_id: params.agentId ?? null,
        agent_adapter: params.agentAdapter ?? 'codex',
        permission_mode: params.permissionMode ?? 'codex-default',
        chat_mode: params.chatMode ?? 'agent',
        reasoning_effort: params.reasoningEffort ?? 'max',
        pinned_at: null,
        archived_at: null,
        metadata_json: '{}',
        created_at: now(),
        updated_at: now(),
      }
      mockState.sessions.set(row.id, row)
      return row
    }

    get(id: string): SessionRow | null {
      return mockState.sessions.get(id) ?? null
    }

    findByIdOrFail(id: string): SessionRow {
      const row = this.get(id)
      if (row == null) throw new Error(`Session not found: ${id}`)
      return row
    }

    getWorkspaceIds(id: string): string[] {
      const row = this.findByIdOrFail(id)
      return JSON.parse(row.workspace_ids_json) as string[]
    }

    getMetadata(id: string): Record<string, unknown> {
      const row = this.findByIdOrFail(id)
      try {
        return JSON.parse(row.metadata_json) as Record<string, unknown>
      } catch {
        return {}
      }
    }

    patchMetadata(id: string, patch: Record<string, unknown>): Record<string, unknown> {
      const row = this.findByIdOrFail(id)
      const next = { ...this.getMetadata(id), ...patch }
      row.metadata_json = JSON.stringify(next)
      row.updated_at = now()
      return next
    }

    updateTitle(id: string, title: string): void {
      const row = this.findByIdOrFail(id)
      row.title = title
      row.updated_at = now()
    }

    updateStatus(id: string, status: string): void {
      const row = this.get(id)
      if (row == null) return
      row.status = status
      row.updated_at = now()
    }

    updateRuntime(
      id: string,
      params: {
        providerProfileId?: string
        modelId?: string | null
        agentId?: string
        agentAdapter?: string
        permissionMode?: string
        chatMode?: string
        reasoningEffort?: string
      },
    ): void {
      const row = this.findByIdOrFail(id)
      if (params.providerProfileId !== undefined) row.provider_profile_id = params.providerProfileId
      if (params.modelId !== undefined) row.model_id = params.modelId
      if (params.agentId !== undefined) row.agent_id = params.agentId
      if (params.agentAdapter !== undefined) row.agent_adapter = params.agentAdapter
      if (params.permissionMode !== undefined) row.permission_mode = params.permissionMode
      if (params.chatMode !== undefined) row.chat_mode = params.chatMode
      if (params.reasoningEffort !== undefined) row.reasoning_effort = params.reasoningEffort
      row.updated_at = now()
    }

    list(params: { status?: string; limit?: number } = {}): {
      sessions: SessionRow[]
      total: number
    } {
      const rows = Array.from(mockState.sessions.values()).filter(
        (row) => params.status == null || row.status === params.status,
      )
      const limit = params.limit ?? rows.length
      return { sessions: rows.slice(0, limit), total: rows.length }
    }
  }

  class ProviderProfileRepository {
    get(id: string): ProviderRow | null {
      return mockState.providers.get(id) ?? null
    }

    listAll(): ProviderRow[] {
      return Array.from(mockState.providers.values())
    }
  }

  class MediaModelManifestRepository {
    ensureSchema(): void {}

    upsert(row: {
      id: string
      providerKind: string
      modelId: string
      displayName: string
      version: string | null
      manifestJson: string
      builtIn: boolean
      enabled: boolean
      sourceUrlsJson: string
      lastCheckedAt: string | null
    }): void {
      mockState.mediaManifests.set(row.id, {
        id: row.id,
        provider_kind: row.providerKind,
        model_id: row.modelId,
        display_name: row.displayName,
        version: row.version,
        manifest_json: row.manifestJson,
        built_in: row.builtIn ? 1 : 0,
        enabled: row.enabled ? 1 : 0,
        source_urls_json: row.sourceUrlsJson,
        last_checked_at: row.lastCheckedAt,
      })
    }

    list(_filters?: { providerKind?: string; enabledOnly?: boolean }) {
      return Array.from(mockState.mediaManifests.values())
    }

    getById(id: string) {
      return mockState.mediaManifests.get(id) ?? null
    }

    upsertProviderModel(row: {
      providerProfileId: string
      manifestId: string
      modelId: string | null
      enabled: boolean
      defaultsJson: string
    }): void {
      const existingIndex = mockState.providerMediaModels.findIndex(
        (item) =>
          item.provider_profile_id === row.providerProfileId && item.manifest_id === row.manifestId,
      )
      const next = {
        provider_profile_id: row.providerProfileId,
        manifest_id: row.manifestId,
        model_id: row.modelId,
        enabled: row.enabled ? 1 : 0,
        defaults_json: row.defaultsJson,
      }
      if (existingIndex >= 0) mockState.providerMediaModels[existingIndex] = next
      else mockState.providerMediaModels.push(next)
    }

    listProviderModels(providerProfileId: string) {
      return mockState.providerMediaModels.filter(
        (row) => row.provider_profile_id === providerProfileId,
      )
    }
  }

  class UsageLedgerRepository {
    record(params: {
      sessionId: string
      providerId: string
      modelId: string
      inputTokens: number
      outputTokens: number
      reasoningOutputTokens?: number
      cacheReadTokens?: number
      costUsd?: number
      requestTimestamp?: string
    }): string {
      mockState.usageRecords.push(params)
      return `usage-${mockState.usageRecords.length}`
    }

    getSessionUsage(_sessionId: string): {
      totalInputTokens: number
      totalOutputTokens: number
      totalCacheReadTokens: number
      totalCacheWriteTokens: number
      totalCostUsd: number
      recordCount: number
    } {
      return {
        totalInputTokens: 0,
        totalOutputTokens: 0,
        totalCacheReadTokens: 0,
        totalCacheWriteTokens: 0,
        totalCostUsd: 0,
        recordCount: 0,
      }
    }
  }

  class TeamDispatchRepository {
    create(): void {}
    update(): void {}
  }

  class TeamDiscussionRepository {
    static clampMaxRounds(value: number | null | undefined): number {
      if (value == null || !Number.isFinite(value)) return 6
      const n = Math.trunc(value)
      if (n < 1) return 1
      if (n > 20) return 20
      return n
    }

    findActiveBySession(sessionId: string) {
      const rows = [...mockState.discussions.values()]
        .filter((row) => row.session_id === sessionId && row.state === 'active')
        .sort((a, b) => a.started_at.localeCompare(b.started_at))
      return rows.at(-1) ?? null
    }

    createDiscussion(params: {
      id: string
      sessionId: string
      hostAgentId: string
      topic?: string | null
      maxRounds: number
    }) {
      const row = {
        id: params.id,
        session_id: params.sessionId,
        host_agent_id: params.hostAgentId,
        topic: params.topic ?? null,
        round_index: 0,
        max_rounds: TeamDiscussionRepository.clampMaxRounds(params.maxRounds),
        state: 'active' as const,
        started_at: now(),
        ended_at: null,
      }
      mockState.discussions.set(row.id, row)
      return row
    }

    getById(id: string) {
      return mockState.discussions.get(id) ?? null
    }

    appendMessage(params: {
      id: string
      discussionId: string
      senderAgentId: string
      targetAgentId?: string | null
      roundIndex: number
      kind: string
      content: string
      dispatchId?: string | null
    }) {
      const row = {
        id: params.id,
        discussion_id: params.discussionId,
        sender_agent_id: params.senderAgentId,
        target_agent_id: params.targetAgentId ?? null,
        round_index: params.roundIndex,
        kind: params.kind,
        content: params.content,
        dispatch_id: params.dispatchId ?? null,
        created_at: now(),
      }
      mockState.threadMessages.push(row)
      return row
    }

    renderThreadForPrompt(discussionId: string): string {
      return mockState.threadMessages
        .filter((row) => row.discussion_id === discussionId)
        .map((row) => `[R${row.round_index}] ${row.sender_agent_id}: ${row.content}`)
        .join('\n')
    }

    listPeerMessagesSince(discussionId: string, sinceIso: string): unknown[] {
      return mockState.threadMessages.filter(
        (row) =>
          row.discussion_id === discussionId &&
          row.kind === 'peer_message' &&
          row.created_at > sinceIso,
      )
    }

    findMessageById(messageId: string): unknown {
      return mockState.threadMessages.find((row) => row.id === messageId) ?? null
    }

    queryMessages(params: {
      discussionId: string
      limit?: number
      offset?: number
      roundIndex?: number
      senderAgentId?: string
      order?: 'asc' | 'desc'
    }): { messages: unknown[]; total: number } {
      let rows = mockState.threadMessages.filter((row) => row.discussion_id === params.discussionId)
      if (params.roundIndex != null)
        rows = rows.filter((row) => row.round_index === params.roundIndex)
      if (params.senderAgentId != null)
        rows = rows.filter((row) => row.sender_agent_id === params.senderAgentId)
      const total = rows.length
      if (params.order === 'desc') rows = [...rows].reverse()
      const offset = params.offset ?? 0
      const limit = params.limit ?? 20
      return { messages: rows.slice(offset, offset + limit), total }
    }

    advanceRound(discussionId: string, summary: string, messageId: string) {
      const row = mockState.discussions.get(discussionId)
      if (row == null || row.state !== 'active') return null
      if (row.round_index + 1 > row.max_rounds) return null
      row.round_index += 1
      let summaryMessage = null
      if (summary.trim().length > 0) {
        summaryMessage = this.appendMessage({
          id: messageId,
          discussionId,
          senderAgentId: row.host_agent_id,
          roundIndex: row.round_index,
          kind: 'round_summary',
          content: summary,
        })
      }
      return { discussion: row, summaryMessage }
    }

    conclude(discussionId: string, params: { reason: 'concluded' | 'canceled' | 'max_rounds' }) {
      const row = mockState.discussions.get(discussionId)
      if (row == null) return null
      row.state = params.reason === 'concluded' ? 'concluded' : 'canceled'
      row.ended_at = now()
      return row
    }
  }

  class EventRepository {
    countBySession(sessionId: string): number {
      return mockState.events.filter((row) => row.session_id === sessionId).length
    }

    nextSeqBySession(sessionId: string): number {
      const seqs = mockState.events
        .filter((row) => row.session_id === sessionId)
        .map((row) => row.seq ?? -1)
      return (seqs.length > 0 ? Math.max(...seqs) : -1) + 1
    }

    insert(params: {
      id: string
      sessionId: string
      turnId?: string
      eventType: string
      eventJson: string
    }): void {
      mockState.events.push({
        id: params.id,
        session_id: params.sessionId,
        run_id: null,
        turn_id: params.turnId ?? '',
        event_type: params.eventType,
        event_json: params.eventJson,
        seq: mockState.events.length,
        created_at: now(),
      })
    }

    insertBatch(
      rows: Array<{
        id: string
        sessionId: string
        turnId?: string
        eventType: string
        eventJson: string
      }>,
    ): void {
      for (const row of rows) this.insert(row)
    }

    queryBySession(params: { sessionId: string; eventType?: string; limit?: number }): {
      events: EventRow[]
      hasMore: boolean
    } {
      const rows = mockState.events
        .filter((row) => row.session_id === params.sessionId)
        .filter((row) => params.eventType == null || row.event_type === params.eventType)
        .slice()
        .reverse()
      const limit = params.limit ?? rows.length
      return { events: rows.slice(0, limit), hasMore: rows.length > limit }
    }

    queryDialogueEvents(_sessionId: string, _limit: number): EventRow[] {
      return []
    }

    queryDialogueEventsAfterSeq(_sessionId: string, _afterSeq: number, _limit: number): EventRow[] {
      return []
    }

    countDialogueEventsAfterSeq(_sessionId: string, _afterSeq: number): number {
      return 0
    }

    queryStreamEventsByTurn(sessionId: string, turnId: string): EventRow[] {
      return mockState.events
        .filter((row) => row.session_id === sessionId && row.turn_id === turnId)
        .filter((row) =>
          ['assistant_message', 'agent_thinking', 'team_member_message'].includes(row.event_type),
        )
        .slice()
        .sort((left, right) => left.seq - right.seq)
    }

    getLatestByType(sessionId: string, eventType: string): EventRow | null {
      const rows = mockState.events.filter(
        (row) => row.session_id === sessionId && row.event_type === eventType,
      )
      return rows.length > 0 ? rows[rows.length - 1]! : null
    }

    getLatestByTypeAndJsonValue(
      sessionId: string,
      eventType: string,
      jsonPath: string,
      value: string,
    ): EventRow | null {
      const key = jsonPath.replace(/^\$\./, '')
      const rows = mockState.events.filter((row) => {
        if (row.session_id !== sessionId || row.event_type !== eventType) return false
        const event = JSON.parse(row.event_json) as Record<string, unknown>
        return event[key] === value
      })
      return rows.length > 0 ? rows[rows.length - 1]! : null
    }
  }

  class RulesRepository {
    list(): unknown[] {
      return []
    }
  }
  class WorkspaceRepository {
    get(id: string): {
      id: string
      name: string
      root_path: string
      project_kind: string
      worktree_meta_json?: string | null
    } | null {
      return mockState.workspaces.get(id) ?? null
    }
  }
  class McpServerRepository {
    listAll(): unknown[] {
      return mockState.mcpServers
    }

    findByScope(scope: string): unknown[] {
      return mockState.mcpServers.filter((server) => server.scope === scope)
    }

    get(): null {
      return null
    }

    create(): void {}
    update(): void {}
    deleteById(): void {}
  }
  class SettingsRepository {
    get(scope?: string, key?: string): unknown | null {
      return mockState.settings.get(`${scope ?? ''}:${key ?? ''}`) ?? null
    }
  }
  class SkillRepository {
    list(): unknown[] {
      return []
    }
    get(): null {
      return null
    }
    create(): void {}
    update(): void {}
    deleteById(): void {}
  }
  class SkillRegistryRepository {
    ensureDefaults(): void {}
    listEnabled(): unknown[] {
      return []
    }
    list(): unknown[] {
      return []
    }
    update(): null {
      return null
    }
  }
  class TeamDefinitionRepository {
    get(): null {
      return null
    }
  }
  class AgentRepository {
    get(id: string): MockAgentItem | null {
      return mockState.agents.get(id) ?? null
    }
  }
  class WorkflowRepository {
    get(id: string): MockWorkflowItem | null {
      return mockState.workflows.get(id) ?? null
    }
  }
  class WorkflowRunRepository {
    constructor(_db?: unknown) {}

    create(params: {
      sessionId: string
      turnId: string
      workflowId: string
      objective: string
      graph: Record<string, unknown>
    }): { id: string } {
      const id = `workflow-run-${mockState.workflowRuns.size + 1}`
      mockState.workflowRuns.set(id, {
        id,
        session_id: params.sessionId,
        turn_id: params.turnId,
        workflow_id: params.workflowId,
        status: 'working',
        objective: params.objective,
        graph_json: JSON.stringify(params.graph),
        state_json: '{}',
        executions_json: '[]',
        atomic_executions_json: '[]',
        completed_node_ids_json: '[]',
        failed_node_json: null,
        started_at: now(),
        updated_at: now(),
        ended_at: null,
      })
      return { id }
    }

    findLatestResumable(sessionId: string, workflowId: string) {
      return (
        [...mockState.workflowRuns.values()]
          .filter(
            (row) =>
              row.session_id === sessionId &&
              row.workflow_id === workflowId &&
              (row.status === 'working' || row.status === 'failed'),
          )
          .sort((a, b) => b.updated_at.localeCompare(a.updated_at))[0] ?? null
      )
    }

    updateSnapshot(
      id: string,
      params: {
        status: 'working' | 'completed' | 'failed' | 'canceled'
        state: Record<string, unknown>
        executions: unknown[]
        atomicExecutions: unknown[]
        completedNodeIds: string[]
        failedNode?: unknown
        endedAt?: string | null
      },
    ) {
      const row = mockState.workflowRuns.get(id)
      if (row == null) return null
      row.status = params.status
      row.state_json = JSON.stringify(params.state)
      row.executions_json = JSON.stringify(params.executions)
      row.atomic_executions_json = JSON.stringify(params.atomicExecutions)
      row.completed_node_ids_json = JSON.stringify(params.completedNodeIds)
      row.failed_node_json =
        params.failedNode === undefined ? null : JSON.stringify(params.failedNode)
      row.updated_at = now()
      row.ended_at = params.endedAt ?? null
      return row
    }
  }
  class ContextPreferenceRepository {
    getPreference(): null {
      return null
    }
    getOverrides(): { pinnedPaths: string[]; excludedPaths: string[] } {
      return { pinnedPaths: [], excludedPaths: [] }
    }
    upsertPreference(): void {}
  }
  class SessionSummaryRepository {
    getLatest(): null {
      return null
    }
    create(): void {}
    deleteBySession(): number {
      return 0
    }
  }
  class GoalRepository {
    getCurrent(): null {
      return null
    }
  }
  class MemoryRepository {
    ensureSchema(): void {}
  }
  class MemorySearchRepository {
    ensureSchema(): void {}
  }
  class MemoryEntityRepository {
    ensureSchema(): void {}
  }
  class ModelProfileRepository {
    ensureSchema(): void {}
    list(): [] {
      return []
    }
  }
  class PluginRepository {
    list(): [] {
      return []
    }

    get(): null {
      return null
    }

    upsert(input: {
      id: string
      version: string
      displayName: string
      description: string
      authorName: string
      manifestJson: string
      installPath: string
      source: string
      enabled: boolean
      state: string
      trust: string
      integritySha256: string
    }) {
      return {
        id: input.id,
        version: input.version,
        display_name: input.displayName,
        description: input.description,
        author_name: input.authorName,
        manifest_json: input.manifestJson,
        install_path: input.installPath,
        source: input.source,
        enabled: input.enabled ? 1 : 0,
        state: input.state,
        trust: input.trust,
        integrity_sha256: input.integritySha256,
        installed_at: '2026-05-28T00:00:00.000Z',
        updated_at: '2026-05-28T00:00:00.000Z',
      }
    }

    listPermissions(): [] {
      return []
    }

    setPermission(): void {}
    replaceResources(): void {}
    listResources(): [] {
      return []
    }
    update(): void {}
    deletePlugin(): boolean {
      return true
    }
    listRegistries(): [] {
      return []
    }
  }
  class ConnectorConnectionRepository {}
  class ConnectorAccountRepository {
    list(): [] {
      return []
    }

    getDefault(): null {
      return null
    }

    get(): null {
      return null
    }

    getByExternalId(): null {
      return null
    }

    upsert(): never {
      throw new Error('ConnectorAccountRepository is not used by this mocked session')
    }

    setDefault(): void {}
    update(): null {
      return null
    }
    delete(): void {}
  }
  class PluginRuntimeAuditRepository {
    record(): void {}
  }
  class ScheduledTaskRepository {}
  class TaskExecutionRepository {}
  class TurnRequestRepository {
    create(params: {
      id: string
      sessionId: string
      payloadJson: string
      createdAt: string
    }): void {
      mockState.turnRequests.set(params.id, {
        id: params.id,
        session_id: params.sessionId,
        payload_json: params.payloadJson,
        status: 'accepted',
        error_message: null,
        created_at: params.createdAt,
        updated_at: params.createdAt,
      })
    }
    get(id: string) {
      return mockState.turnRequests.get(id) ?? null
    }
    listRecoverable() {
      return [...mockState.turnRequests.values()].filter(
        (row) => row.status === 'accepted' || row.status === 'running',
      )
    }
    markRunning(id: string): boolean {
      return this.update(id, 'running', ['accepted'])
    }
    markCompleted(id: string): boolean {
      return this.update(id, 'completed', ['accepted', 'running'])
    }
    markFailed(id: string, error: string): boolean {
      const row = mockState.turnRequests.get(id)
      if (row == null || (row.status !== 'accepted' && row.status !== 'running')) return false
      row.status = 'failed'
      row.error_message = error
      return true
    }
    cancel(id: string): boolean {
      return this.update(id, 'cancelled', ['accepted', 'running'])
    }
    private update(
      id: string,
      status: 'running' | 'completed' | 'cancelled',
      from: Array<'accepted' | 'running'>,
    ): boolean {
      const row = mockState.turnRequests.get(id)
      if (row == null || !from.includes(row.status as 'accepted' | 'running')) return false
      row.status = status
      row.error_message = null
      return true
    }
  }

  return {
    SessionRepository,
    ProviderProfileRepository,
    MediaModelManifestRepository,
    EventRepository,
    UsageLedgerRepository,
    TeamDispatchRepository,
    TeamDiscussionRepository,
    RulesRepository,
    WorkspaceRepository,
    McpServerRepository,
    SettingsRepository,
    SkillRepository,
    SkillRegistryRepository,
    TeamDefinitionRepository,
    AgentRepository,
    WorkflowRepository,
    WorkflowRunRepository,
    ContextPreferenceRepository,
    SessionSummaryRepository,
    GoalRepository,
    MemoryRepository,
    MemorySearchRepository,
    MemoryEntityRepository,
    ModelProfileRepository,
    PluginRepository,
    ConnectorConnectionRepository,
    ConnectorAccountRepository,
    PluginRuntimeAuditRepository,
    ScheduledTaskRepository,
    TaskExecutionRepository,
    TurnRequestRepository,
    RoomLedgerService,
  }
})

vi.mock('../../sdk/index.js', () => {
  class MockTurnExecutor {
    private handler: ((event: AgentEvent) => void) | null = null

    onEvent(handler: (event: AgentEvent) => void): void {
      this.handler = handler
    }

    cancel(): void {}

    async executeTurn(
      sessionId: string,
      turnId: string,
      message: string,
      config: Record<string, unknown>,
    ): Promise<void> {
      mockState.sdkTurns.push({ sessionId, turnId, message })
      mockState.sdkConfigs.push(config)
      const nextError = mockState.nextSdkTurnErrors.shift()
      if (nextError != null) {
        this.handler?.({
          id: `error-${turnId}`,
          sessionId,
          turnId,
          timestamp: '2026-05-28T00:00:00.000Z',
          seq: 0,
          type: 'agent_error',
          message: nextError,
          code: 'mock_error',
          retryable: false,
        })
      }
      for (const usageEvent of mockState.nextSdkUsageEvents.shift() ?? []) {
        this.handler?.({ ...usageEvent, sessionId, turnId })
      }
      for (const event of mockState.nextSdkTurnEvents.shift() ?? []) {
        this.handler?.({ ...event, sessionId, turnId })
      }
      const status = mockState.nextSdkTurnStatuses.shift() ?? 'completed'
      this.handler?.({
        id: `${status}-${turnId}`,
        sessionId,
        turnId,
        timestamp: '2026-05-28T00:00:00.000Z',
        seq: 0,
        type: 'agent_status',
        status,
      })
    }
  }
  return {
    isSDKAvailable: vi.fn(async () => true),
    loadSdkMcpFactory: vi.fn(async () => ({
      createSdkMcpServer: (opts: { name: string; tools: unknown[] }) => ({
        type: 'sdk',
        name: opts.name,
        instance: { tools: opts.tools },
      }),
      tool: (
        name: string,
        _description: string,
        _inputSchema: Record<string, unknown>,
        handler: unknown,
      ) => ({
        name,
        handler,
      }),
    })),
    getResumeCircuitBreaker: vi.fn(() => ({
      recordSuccess: () => {},
      recordFailure: () => {},
      shouldSkipResume: () => false,
    })),
    ClaudeSDKExecutor: MockTurnExecutor,
    CodexSdkExecutor: MockTurnExecutor,
    CodexCliExecutor: MockTurnExecutor,
    CodexOpenAIExecutor: MockTurnExecutor,
  }
})

function seedProvider(row: Omit<ProviderRow, 'enabled' | 'created_at' | 'updated_at'>): void {
  mockState.providers.set(row.id, {
    ...row,
    enabled: 1,
    created_at: '2026-05-28T00:00:00.000Z',
    updated_at: '2026-05-28T00:00:00.000Z',
  })
}

function makeAgent(
  params: Partial<MockAgentItem> & Pick<MockAgentItem, 'id' | 'name'>,
): MockAgentItem {
  return {
    id: params.id,
    name: params.name,
    description: params.description ?? '',
    builtIn: params.builtIn ?? false,
    enabled: params.enabled ?? true,
    isDefault: params.isDefault ?? false,
    providerProfileId: params.providerProfileId ?? null,
    modelId: params.modelId ?? null,
    agentAdapter: params.agentAdapter ?? 'claude-sdk',
    permissionMode: params.permissionMode ?? 'claude-plan',
    reasoningEffort: params.reasoningEffort ?? 'max',
    prompt: params.prompt ?? '',
    ruleIds: params.ruleIds ?? [],
    skillIds: params.skillIds ?? [],
    disabledSkillIds: params.disabledSkillIds ?? [],
    mcpServerIds: params.mcpServerIds ?? [],
    hookConfig: params.hookConfig ?? {},
    workflowId: params.workflowId ?? null,
    metadata: params.metadata ?? {},
    createdAt: params.createdAt ?? '2026-05-28T00:00:00.000Z',
    updatedAt: params.updatedAt ?? '2026-05-28T00:00:00.000Z',
  }
}

describe('buildMediaGenerationSystemPrompt', () => {
  it('requires model usage inspection before media generation calls', () => {
    const prompt = buildMediaGenerationSystemPrompt({
      name: 'Media',
      model: 'seedance',
      provider: 'volcengine-ark',
      apiType: 'sync',
      outputDir: '/tmp/media',
      capabilities: ['video.generate'],
      modelManifests: [
        {
          id: 'volcengine:seedance',
          modelId: 'doubao-seedance',
          capabilities: ['video.generate'],
        },
      ],
    })

    expect(prompt).toContain('must call `mcp__spark_media__describe_model`')
    expect(prompt).toContain('maxImages')
    expect(prompt).toContain('rolePolicy')
    expect(prompt).toContain('ask which inputs to keep')
    expect(prompt).toContain('mcp__spark_files__present_files')
    expect(prompt).toContain('not complete')
  })
})

describe('SessionService runtime provider/model resolution', () => {
  let events: AgentEvent[]

  beforeEach(() => {
    mockState.sessions.clear()
    mockState.providers.clear()
    mockState.mediaManifests.clear()
    mockState.providerMediaModels.length = 0
    mockState.events.length = 0
    mockState.mcpServers.length = 0
    mockState.sdkConfigs.length = 0
    mockState.sdkTurns.length = 0
    mockState.workspaces.clear()
    mockState.agents.clear()
    mockState.workflows.clear()
    mockState.discussions.clear()
    mockState.threadMessages.length = 0
    mockState.workflowRuns.clear()
    mockState.nextSdkTurnErrors.length = 0
    mockState.nextSdkTurnStatuses.length = 0
    mockState.nextSdkUsageEvents.length = 0
    mockState.nextSdkTurnEvents.length = 0
    mockState.turnRequests.clear()
    mockState.settings.clear()
    mockState.usageRecords.length = 0
    vi.mocked(keystore.getSecret).mockClear().mockResolvedValue('test-api-key')
    events = []

    seedProvider({
      id: 'tencent-provider',
      provider_type: 'anthropic',
      name: 'Tencent Coding',
      config_json: JSON.stringify({
        defaultModel: 'glm-5',
        modelIds: ['glm-5'],
        apiEndpoint: 'https://api.lkeap.cloud.tencent.com/coding/anthropic',
      }),
      keystore_ref: 'key-tencent',
      is_default: 1,
    })
    seedProvider({
      id: 'xiaomi-provider',
      provider_type: 'anthropic',
      name: 'Xiaomi MiMo',
      config_json: JSON.stringify({
        defaultModel: 'mimo-v2.5-pro',
        modelIds: ['mimo-v2.5-pro'],
        apiEndpoint: 'https://api.example.test/xiaomi/anthropic',
      }),
      keystore_ref: 'key-xiaomi',
      is_default: 0,
    })
    seedProvider({
      id: 'anthropic-provider',
      provider_type: 'anthropic',
      name: 'Anthropic Direct',
      config_json: JSON.stringify({
        defaultModel: 'claude-sonnet-4-5',
        modelIds: ['claude-sonnet-4-5'],
        apiEndpoint: 'https://api.anthropic.com',
      }),
      keystore_ref: 'key-anthropic',
      is_default: 0,
    })
  })

  it.each(['claude-sdk', 'codex'] as const)(
    'mounts the governed spark_computer server and prompt for every %s session',
    async (agentAdapter) => {
      const service = new SessionService({} as never, (event) => events.push(event))
      service.setComputerUseMcpProvider(async (sessionId) => ({
        server: {
          type: 'stdio',
          command: '/app/SparkWork',
          args: ['/resources/tools/computer-use-mcp-server.mjs'],
          env: { SPARK_COMPUTER_SESSION_ID: sessionId },
        },
        allowedTools: ['mcp__spark_computer__get_capabilities', 'mcp__spark_computer__start_task'],
        systemPrompt: 'GOVERNED COMPUTER USE PROMPT',
      }))
      const { sessionId } = await service.createSession({
        providerProfileId: 'tencent-provider',
        modelId: 'glm-5',
        agentAdapter,
        permissionMode: agentAdapter === 'codex' ? 'codex-default' : 'claude-auto-edits',
        title: 'Computer use session',
      })

      await service.sendTurn({ sessionId, message: 'Can you control my computer?' })
      await vi.waitFor(() => expect(mockState.sdkConfigs).toHaveLength(1))

      const config = mockState.sdkConfigs[0]
      expect(config?.mcpServers).toMatchObject({
        spark_computer: expect.objectContaining({ type: 'stdio' }),
        spark_platform: expect.objectContaining({
          type: 'stdio',
          env: expect.objectContaining({ SPARK_SESSION_ID: sessionId }),
        }),
      })
      expect(config?.allowedTools).toEqual(
        expect.arrayContaining([
          'mcp__spark_computer__get_capabilities',
          'mcp__spark_computer__start_task',
          ...(agentAdapter === 'claude-sdk'
            ? [
                'mcp__spark_platform__session_schedule_list',
                'mcp__spark_platform__session_schedule_create',
                'mcp__spark_platform__session_schedule_delete',
              ]
            : []),
        ]),
      )
      expect(String(config?.skillSystemPrompt ?? '')).toContain('GOVERNED COMPUTER USE PROMPT')
      expect(String(config?.skillSystemPrompt ?? '')).toContain(
        'After creation succeeds, tell the user briefly and end the current turn',
      )
    },
  )

  it('enables the debug MCP server and mandatory workflow prompt on the first turn', async () => {
    const service = new SessionService({} as never, (event) => events.push(event))
    const { sessionId, session } = await service.createSession({
      providerProfileId: 'tencent-provider',
      modelId: 'glm-5',
      agentAdapter: 'claude-sdk',
      permissionMode: 'claude-plan',
      debugMode: true,
      title: 'Debug mode session',
    })

    expect(session.debugMode).toBe(true)
    expect(mockState.sessions.get(sessionId)?.metadata_json).toBe(
      JSON.stringify({ debugMode: true }),
    )

    await service.sendTurn({ sessionId, message: 'The save button does not work' })
    await vi.waitFor(() => expect(mockState.sdkConfigs).toHaveLength(1))

    const config = mockState.sdkConfigs[0]
    expect(config?.mcpServers).toMatchObject({
      spark_debug: expect.objectContaining({
        type: 'stdio',
        env: expect.objectContaining({ SPARK_DEBUG_SID: sessionId }),
      }),
    })
    expect(config?.allowedTools).toEqual(
      expect.arrayContaining(['mcp__spark_debug__begin', 'mcp__spark_debug__read']),
    )
    expect(String(config?.skillSystemPrompt ?? '')).toContain(
      'MUST call `mcp__spark_debug__begin` before editing code',
    )
  })

  it('round-trips and clears the session-scoped local CLI Spark override', async () => {
    const service = new SessionService({} as never, (event) => events.push(event))
    const cliSparkOverride = {
      providerProfileId: 'anthropic-provider',
      modelId: 'claude-sonnet-4-5',
    }
    const created = await service.createSession({
      providerProfileId: 'tencent-provider',
      agentAdapter: 'claude-sdk',
      permissionMode: 'claude-plan',
      cliSparkOverride,
      title: 'CLI override metadata session',
    })

    expect(created.session.cliSparkOverride).toEqual(cliSparkOverride)
    expect(JSON.parse(mockState.sessions.get(created.sessionId)!.metadata_json)).toMatchObject({
      cliSparkOverride,
    })

    const cleared = await service.updateSession({
      sessionId: created.sessionId,
      cliSparkOverride: null,
    })
    expect(cleared.session.cliSparkOverride).toBeNull()
    expect(JSON.parse(mockState.sessions.get(created.sessionId)!.metadata_json)).toMatchObject({
      cliSparkOverride: null,
    })
  })

  it('persists a terminal error when a provider credential cannot be resolved before start', async () => {
    vi.mocked(keystore.getSecret).mockResolvedValueOnce(null)
    const service = new SessionService({} as never, (event) => events.push(event))
    const { sessionId } = await service.createSession({
      providerProfileId: 'tencent-provider',
      modelId: 'glm-5',
      agentAdapter: 'claude-sdk',
      title: 'Missing credential session',
    })

    await expect(service.sendTurn({ sessionId, message: 'hello' })).rejects.toThrow(
      'API key not found',
    )
    expect(events.map((event) => event.type)).toEqual([
      'user_message',
      'agent_error',
      'agent_status',
    ])
    expect(events.find((event) => event.type === 'agent_error')).toMatchObject({
      code: 'TURN_START_FAILED',
      retryable: true,
    })
    expect(mockState.sessions.get(sessionId)?.status).toBe('error')
    expect(mockState.turnRequests.size).toBe(0)
  })

  it('durably accepts an interactive turn before background preflight finishes', async () => {
    vi.mocked(keystore.getSecret).mockResolvedValueOnce(null)
    const service = new SessionService({} as never, (event) => events.push(event))
    const { sessionId } = await service.createSession({
      providerProfileId: 'tencent-provider',
      modelId: 'glm-5',
      agentAdapter: 'claude-sdk',
      title: 'Durable submit session',
    })

    const result = await service.submitTurn({ sessionId, message: 'hello' })

    expect(result).toMatchObject({ accepted: true, started: true })
    expect(mockState.turnRequests.get(result.turnId)?.status).toBe('accepted')
    await vi.waitFor(() => {
      expect(mockState.turnRequests.get(result.turnId)?.status).toBe('failed')
    })
    expect(service.getQueueState({ sessionId }).running).toBe(false)
    expect(mockState.sessions.get(sessionId)?.status).toBe('error')
    expect(events).toContainEqual(
      expect.objectContaining({
        type: 'agent_status',
        turnId: result.turnId,
        status: 'error',
      }),
    )
  })

  it('releases the active loop when turn startup fails after executor registration', async () => {
    const service = new SessionService({} as never, (event) => events.push(event))
    vi.spyOn(service as never, 'maybeCaptureCheckpoint' as never).mockRejectedValueOnce(
      new Error('checkpoint startup failed') as never,
    )
    const { sessionId } = await service.createSession({
      providerProfileId: 'tencent-provider',
      modelId: 'glm-5',
      agentAdapter: 'claude-sdk',
      title: 'Post-registration startup failure',
    })

    const result = await service.submitTurn({ sessionId, message: 'hello' })

    await vi.waitFor(() => {
      expect(mockState.turnRequests.get(result.turnId)?.status).toBe('failed')
    })
    expect(service.getQueueState({ sessionId }).running).toBe(false)
    expect(mockState.sessions.get(sessionId)?.status).toBe('error')
  })

  it('serializes background preflight for rapid interactive submissions in one session', async () => {
    let releaseCredential!: (value: string) => void
    const credential = new Promise<string>((resolve) => {
      releaseCredential = resolve
    })
    vi.mocked(keystore.getSecret).mockImplementation(() => credential)
    const service = new SessionService({} as never, (event) => events.push(event))
    const { sessionId } = await service.createSession({
      providerProfileId: 'tencent-provider',
      modelId: 'glm-5',
      agentAdapter: 'claude-sdk',
      title: 'Serialized submit session',
    })

    const first = await service.submitTurn({ sessionId, message: 'first' })
    const second = await service.submitTurn({ sessionId, message: 'second' })

    await vi.waitFor(() => expect(keystore.getSecret).toHaveBeenCalledTimes(1))
    expect(service.getQueueState({ sessionId }).running).toBe(true)
    expect(mockState.turnRequests.get(first.turnId)?.status).toBe('running')
    expect(mockState.turnRequests.get(second.turnId)?.status).toBe('accepted')
    releaseCredential('test-api-key')
    await vi.waitFor(() => expect(mockState.sdkTurns).toHaveLength(2))
    expect(mockState.sdkTurns.map((turn) => turn.message)).toEqual(['first', 'second'])
  })

  it('accepts a durable turn before workspace preparation settles', async () => {
    let finishWorkspacePreparation!: () => void
    const workspaceReady = new Promise<void>((resolve) => {
      finishWorkspacePreparation = resolve
    })
    const service = new SessionService({} as never, (event) => events.push(event))
    const { sessionId } = await service.createSession({
      providerProfileId: 'tencent-provider',
      modelId: 'glm-5',
      agentAdapter: 'claude-sdk',
      title: 'Deferred workspace preparation',
    })

    const result = await service.submitTurn(
      { sessionId, message: 'hello after workspace is ready' },
      { startAfter: workspaceReady },
    )

    expect(result.accepted).toBe(true)
    expect(mockState.turnRequests.get(result.turnId)?.status).toBe('accepted')
    expect(keystore.getSecret).not.toHaveBeenCalled()

    finishWorkspacePreparation()
    await vi.waitFor(() => expect(keystore.getSecret).toHaveBeenCalledTimes(1))
  })

  it('records usage_update deltas to the usage ledger without double-counting cumulative updates', async () => {
    const service = new SessionService({} as never, (event) => events.push(event))
    const { sessionId } = await service.createSession({
      providerProfileId: 'tencent-provider',
      modelId: 'glm-5',
      agentAdapter: 'claude-sdk',
      permissionMode: 'claude-plan',
      title: 'Usage ledger session',
    })
    const eventRepo = { insert: vi.fn(), nextSeqBySession: vi.fn(() => 0) }
    const persist = (
      service as unknown as {
        emitAndPersist: (
          sessionId: string,
          turnId: string,
          event: AgentEvent,
          eventRepo: {
            insert: ReturnType<typeof vi.fn>
            nextSeqBySession: ReturnType<typeof vi.fn>
          },
        ) => void
      }
    ).emitAndPersist.bind(service)

    persist(
      sessionId,
      'turn-usage',
      {
        id: 'usage-1',
        sessionId,
        turnId: 'turn-usage',
        timestamp: '2026-05-28T00:00:01.000Z',
        seq: 0,
        type: 'usage_update',
        provider: 'claude',
        model: '',
        inputTokens: 100,
        outputTokens: 20,
        reasoningOutputTokens: 8,
        cacheHitTokens: 5,
        estimatedCostUsd: 0.01,
      },
      eventRepo,
    )
    persist(
      sessionId,
      'turn-usage',
      {
        id: 'usage-2',
        sessionId,
        turnId: 'turn-usage',
        timestamp: '2026-05-28T00:00:02.000Z',
        seq: 0,
        type: 'usage_update',
        provider: 'claude',
        model: '',
        inputTokens: 140,
        outputTokens: 35,
        reasoningOutputTokens: 14,
        cacheHitTokens: 7,
        estimatedCostUsd: 0.015,
      },
      eventRepo,
    )

    expect(mockState.usageRecords).toEqual([
      expect.objectContaining({
        sessionId,
        providerId: 'tencent-provider',
        modelId: 'glm-5',
        inputTokens: 100,
        outputTokens: 20,
        reasoningOutputTokens: 8,
        cacheReadTokens: 5,
        costUsd: 0.01,
      }),
      expect.objectContaining({
        sessionId,
        providerId: 'tencent-provider',
        modelId: 'glm-5',
        inputTokens: 40,
        outputTokens: 15,
        reasoningOutputTokens: 6,
        cacheReadTokens: 2,
        costUsd: expect.closeTo(0.005),
      }),
    ])
  })

  it('uses the session provider default model when an old session has no model id', async () => {
    const service = new SessionService({} as never, (event) => events.push(event))
    const { sessionId } = await service.createSession({
      providerProfileId: 'tencent-provider',
      agentAdapter: 'claude-sdk',
      permissionMode: 'claude-plan',
      title: 'Old GLM session',
    })

    await service.sendTurn({ sessionId, message: 'hello old session' })

    await vi.waitFor(() => {
      expect(mockState.sdkConfigs).toHaveLength(1)
    })
    expect(mockState.sdkConfigs[0]).toMatchObject({
      model: 'glm-5',
      apiEndpoint: 'https://api.lkeap.cloud.tencent.com/coding/anthropic',
      permissionMode: 'claude-plan',
      continueSession: false,
    })
    expect(events).toContainEqual(
      expect.objectContaining({
        type: 'turn_prompt_snapshot',
        providerProfileId: 'tencent-provider',
        model: 'glm-5',
        permissionMode: 'claude-plan',
      }),
    )
  })

  it('broadcasts the locally derived title for a new session first turn', async () => {
    seedProvider({
      id: 'local-codex-cli',
      provider_type: 'openai',
      name: 'Local Codex CLI',
      config_json: JSON.stringify({
        defaultModel: 'codex cli',
        modelIds: ['codex cli'],
      }),
      keystore_ref: null,
      is_default: 0,
    })
    const onSessionRenamed = vi.fn()
    const service = new SessionService(
      {} as never,
      (event) => events.push(event),
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      onSessionRenamed,
    )
    const { sessionId } = await service.createSession({
      providerProfileId: 'local-codex-cli',
      modelId: 'codex cli',
      agentAdapter: 'codex',
      permissionMode: 'codex-default',
      title: '新会话',
    })

    await service.sendTurn({ sessionId, message: '修复 Codex CLI 重复输出问题' })

    expect(mockState.sessions.get(sessionId)?.title).toBe('修复 Codex CLI 重复输出问题')
    expect(onSessionRenamed).toHaveBeenCalledWith(sessionId, '修复 Codex CLI 重复输出问题')
  })

  it('does not derive a visible session title from a hidden internal first turn', async () => {
    seedProvider({
      id: 'local-codex-cli',
      provider_type: 'openai',
      name: 'Local Codex CLI',
      config_json: JSON.stringify({
        defaultModel: 'codex cli',
        modelIds: ['codex cli'],
      }),
      keystore_ref: null,
      is_default: 0,
    })
    const onSessionRenamed = vi.fn()
    const service = new SessionService(
      {} as never,
      (event) => events.push(event),
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      onSessionRenamed,
    )
    const { sessionId } = await service.createSession({
      providerProfileId: 'local-codex-cli',
      modelId: 'codex cli',
      agentAdapter: 'codex',
      permissionMode: 'codex-default',
      title: '新会话',
    })

    await service.sendTurn({
      sessionId,
      message: '[Goal Iteration] internal prompt that must stay hidden',
      turnSource: 'goal_iteration',
      userMessageVisibility: 'hidden',
    })

    expect(mockState.sessions.get(sessionId)?.title).toBe('新会话')
    expect(onSessionRenamed).not.toHaveBeenCalled()
    expect(events).toContainEqual(
      expect.objectContaining({
        type: 'turn_prompt_snapshot',
        turnSource: 'goal_iteration',
        userMessageVisibility: 'hidden',
      }),
    )
  })

  it('passes the application hook bridge into Claude SDK turns', async () => {
    const onHookTrigger = vi.fn()
    const service = new SessionService(
      {} as never,
      (event) => events.push(event),
      undefined,
      undefined,
      undefined,
      undefined,
      onHookTrigger,
    )
    const { sessionId } = await service.createSession({
      providerProfileId: 'tencent-provider',
      agentAdapter: 'claude-sdk',
      permissionMode: 'claude-plan',
      title: 'Hook bridge',
    })

    await service.sendTurn({ sessionId, message: 'request a tool' })
    await vi.waitFor(() => expect(mockState.sdkConfigs).toHaveLength(1))

    expect(mockState.sdkConfigs[0]?.applicationHookCallback).toBe(onHookTrigger)
  })

  it('exposes every enabled app MCP server without per-agent binding', async () => {
    mockState.mcpServers.push({
      id: 'mcp-search',
      scope: 'user',
      name: 'local_search',
      config_json: JSON.stringify({ command: 'node', args: ['local-search.mjs'] }),
      enabled: 1,
      created_at: '2026-05-28T00:00:00.000Z',
      updated_at: '2026-05-28T00:00:00.000Z',
    })
    mockState.agents.set(
      'plain-agent',
      makeAgent({
        id: 'plain-agent',
        name: 'Plain Agent',
        providerProfileId: 'tencent-provider',
        mcpServerIds: [],
      }),
    )
    const service = new SessionService({} as never, (event) => events.push(event))
    const { sessionId } = await service.createSession({
      providerProfileId: 'tencent-provider',
      agentId: 'plain-agent',
      agentAdapter: 'claude-sdk',
      permissionMode: 'claude-plan',
      title: 'Global MCP session',
    })

    await service.sendTurn({ sessionId, message: 'use my new MCP' })

    await vi.waitFor(() => {
      expect(mockState.sdkConfigs).toHaveLength(1)
    })
    expect(mockState.sdkConfigs[0]?.mcpServers).toHaveProperty('local_search')
    const prompt = String(mockState.sdkConfigs[0]?.systemPrompt ?? '')
    expect(prompt).not.toContain('App MCP Availability')
    expect(prompt).not.toContain('Agent Management > MCP')
  })

  it('does not expose disabled app MCP servers', async () => {
    mockState.mcpServers.push({
      id: 'mcp-disabled',
      scope: 'user',
      name: 'disabled_search',
      config_json: JSON.stringify({ command: 'node', args: ['disabled-search.mjs'] }),
      enabled: 0,
      created_at: '2026-07-16T00:00:00.000Z',
      updated_at: '2026-07-16T00:00:00.000Z',
    })
    const service = new SessionService({} as never, (event) => events.push(event))
    const { sessionId } = await service.createSession({
      providerProfileId: 'tencent-provider',
      agentAdapter: 'claude-sdk',
      permissionMode: 'claude-plan',
      title: 'Disabled MCP session',
    })

    await service.sendTurn({ sessionId, message: 'list available MCP tools' })

    await vi.waitFor(() => expect(mockState.sdkConfigs).toHaveLength(1))
    expect(mockState.sdkConfigs[0]?.mcpServers).not.toHaveProperty('disabled_search')
  })

  it('uses the updated same-adapter provider and model on the next turn', async () => {
    const service = new SessionService({} as never, (event) => events.push(event))
    const { sessionId } = await service.createSession({
      providerProfileId: 'tencent-provider',
      agentAdapter: 'claude-sdk',
      permissionMode: 'claude-plan',
      title: 'Switchable SDK session',
    })

    await service.sendTurn({ sessionId, message: 'first turn' })
    await vi.waitFor(() => {
      expect(mockState.sdkConfigs).toHaveLength(1)
    })

    await service.updateSession({
      sessionId,
      providerProfileId: 'xiaomi-provider',
      modelId: 'mimo-v2.5-pro',
      agentAdapter: 'claude-sdk',
      permissionMode: 'claude-plan',
    })
    await service.sendTurn({ sessionId, message: 'second turn after switch' })

    await vi.waitFor(() => {
      expect(mockState.sdkConfigs).toHaveLength(2)
    })
    expect(mockState.sdkConfigs[1]).toMatchObject({
      model: 'mimo-v2.5-pro',
      apiEndpoint: 'https://api.example.test/xiaomi/anthropic',
      permissionMode: 'claude-plan',
      continueSession: false,
    })
    expect(mockState.sdkConfigs[1]?.sdkSessionId).not.toBe(mockState.sdkConfigs[0]?.sdkSessionId)
    expect(mockState.sessions.get(sessionId)).toMatchObject({
      provider_profile_id: 'xiaomi-provider',
      model_id: 'mimo-v2.5-pro',
      agent_adapter: 'claude-sdk',
      permission_mode: 'claude-plan',
    })
  })

  it('injects spark_media for an Agnes multimodal provider with explicit image/video manifests', async () => {
    seedProvider({
      id: 'agnes-provider',
      provider_type: 'openai',
      name: 'Agnes AI',
      config_json: JSON.stringify({
        defaultModel: 'agnes-2.0-flash',
        modelIds: ['agnes-2.0-flash'],
        apiEndpoint: 'https://apihub.agnes-ai.com/v1',
        modelType: 'multimodal',
        mediaProvider: 'agnes',
        mediaApiType: 'auto',
        mediaCapabilities: [
          'image.generate',
          'image.edit',
          'video.generate',
          'video.image_to_video',
        ],
        mediaModelRefs: [
          {
            manifestId: 'agnes:agnes-image-2.0-flash',
            modelId: 'agnes-image-2.0-flash',
            enabled: true,
          },
          { manifestId: 'agnes:agnes-video-v2.0', modelId: 'agnes-video-v2.0', enabled: true },
        ],
      }),
      keystore_ref: 'key-agnes',
      is_default: 0,
    })
    const service = new SessionService({} as never, (event) => events.push(event))
    const { sessionId } = await service.createSession({
      providerProfileId: 'agnes-provider',
      agentAdapter: 'claude-sdk',
      permissionMode: 'claude-plan',
      title: 'Agnes multimodal session',
    })

    await service.sendTurn({ sessionId, message: 'draw and animate this idea' })

    await vi.waitFor(() => {
      expect(mockState.sdkConfigs).toHaveLength(1)
    })
    const config = mockState.sdkConfigs[0]
    expect(config?.mcpServers).toMatchObject({
      spark_media: expect.objectContaining({ type: 'stdio' }),
    })
    expect(config?.mcpServers).not.toHaveProperty('spark_image')
    expect(config?.allowedTools).toEqual(
      expect.arrayContaining([
        'mcp__spark_media__generate_image',
        'mcp__spark_media__generate_video',
      ]),
    )
    const mediaServer = (
      config?.mcpServers as {
        spark_media: { env: Record<string, string> }
      }
    ).spark_media
    expect(Object.keys(mediaServer.env).sort()).toEqual([
      'SPARK_MEDIA_API_KEY_0',
      'SPARK_MEDIA_CONFIG_FILE',
    ])
    expect(JSON.stringify(mediaServer.env).length).toBeLessThan(2_048)
    const serializedRuntimeConfig = readFileSync(
      requireEnvValue(mediaServer.env, 'SPARK_MEDIA_CONFIG_FILE'),
      'utf8',
    )
    const runtimeConfig = JSON.parse(serializedRuntimeConfig) as {
      provider: string
      model: string
      providers: Array<{ apiKeyEnv: string; apiKey?: string; manifests: Array<{ id: string }> }>
    }
    expect(mediaServer.env.SPARK_MEDIA_API_KEY_0).toBe('test-api-key')
    expect(serializedRuntimeConfig).not.toContain('test-api-key')
    expect(runtimeConfig.providers[0]).toMatchObject({ apiKeyEnv: 'SPARK_MEDIA_API_KEY_0' })
    expect(runtimeConfig.providers[0]).not.toHaveProperty('apiKey')
    expect(runtimeConfig.provider).toBe('agnes')
    expect(runtimeConfig.model).toBe('agnes-2.0-flash')
    expect(
      runtimeConfig.providers.flatMap((provider) => provider.manifests.map((item) => item.id)),
    ).toEqual(expect.arrayContaining(['agnes:agnes-image-2.0-flash', 'agnes:agnes-video-v2.0']))
  })

  it('emits presented_files inline right after the media tool when it forgot present_files', async () => {
    const workspaceRoot = mkdtempSync(path.join(tmpdir(), 'spark-media-presentation-'))
    const imagePath = path.join(workspaceRoot, 'generated-preview.png')
    writeFileSync(imagePath, Buffer.from([0x89, 0x50, 0x4e, 0x47]))
    try {
      mockState.workspaces.set('media-workspace', {
        id: 'media-workspace',
        name: 'media-workspace',
        root_path: workspaceRoot,
        project_kind: 'node',
        worktree_meta_json: null,
      })
      mockState.nextSdkTurnEvents.push([
        {
          id: 'generated-image-result',
          sessionId: 'placeholder-session',
          turnId: 'placeholder-turn',
          timestamp: '2026-05-28T00:00:00.000Z',
          seq: 0,
          type: 'tool_result',
          toolCallId: 'image-call-1',
          toolName: 'mcp__spark_media__generate_image',
          status: 'success',
          output: { files: [{ path: imagePath, title: 'Generated preview' }] },
        },
      ])
      const service = new SessionService({} as never, (event) => events.push(event))
      const { sessionId } = await service.createSession({
        providerProfileId: 'tencent-provider',
        agentAdapter: 'claude-sdk',
        permissionMode: 'claude-plan',
        title: 'Media delivery session',
        workspaceId: 'media-workspace',
      })

      await service.sendTurn({ sessionId, message: 'generate an image' })

      await vi.waitFor(() => {
        expect(events).toContainEqual(
          expect.objectContaining({
            type: 'presented_files',
            sessionId,
            files: [{ path: realpathSync(imagePath), title: 'Generated preview' }],
          }),
        )
      })
      const presentedIndex = events.findIndex((event) => event.type === 'presented_files')
      const resultIndex = events.findIndex(
        (event) => event.type === 'tool_result' && event.toolCallId === 'image-call-1',
      )
      const terminalIndex = events.findIndex(
        (event) => event.type === 'agent_status' && event.status === 'completed',
      )
      expect(presentedIndex).toBeGreaterThanOrEqual(0)
      // 媒体紧跟生图工具结果就地发出，而非堆到 turn 末尾
      expect(resultIndex).toBeGreaterThanOrEqual(0)
      expect(presentedIndex).toBeGreaterThan(resultIndex)
      expect(terminalIndex).toBeGreaterThan(presentedIndex)
    } finally {
      rmSync(workspaceRoot, { recursive: true, force: true })
    }
  })

  it('merges the agent turn manifest with direct edits without workspace-wide discovery', async () => {
    const workspaceRoot = mkdtempSync(path.join(tmpdir(), 'spark-turn-journal-'))
    const directPath = path.join(workspaceRoot, 'src', 'direct.ts')
    const shellPath = path.join(workspaceRoot, 'src', 'from-shell.ts')
    const nestedWorktreePath = path.join(
      workspaceRoot,
      '.claude',
      'worktrees',
      'agent-1',
      'src',
      'copy.ts',
    )
    mkdirSync(path.dirname(directPath), { recursive: true })
    mkdirSync(path.dirname(nestedWorktreePath), { recursive: true })
    writeFileSync(directPath, 'direct\n')
    writeFileSync(shellPath, 'shell\n')
    writeFileSync(nestedWorktreePath, 'copy\n')
    try {
      mockState.workspaces.set('journal-workspace', {
        id: 'journal-workspace',
        name: 'journal-workspace',
        root_path: workspaceRoot,
        project_kind: 'node',
        worktree_meta_json: null,
      })
      mockState.nextSdkTurnEvents.push([
        {
          id: 'direct-change',
          sessionId: 'placeholder-session',
          turnId: 'placeholder-turn',
          timestamp: '2026-05-28T00:00:00.000Z',
          seq: 0,
          type: 'file_change',
          path: 'src/direct.ts',
          changeType: 'modify',
        },
        {
          id: 'reported-changes',
          sessionId: 'placeholder-session',
          turnId: 'placeholder-turn',
          timestamp: '2026-05-28T00:00:00.000Z',
          seq: 1,
          type: 'tool_result',
          toolCallId: 'report-call-1',
          toolName: 'mcp__spark_files__report_file_changes',
          status: 'success',
          output: {
            changes: [
              { path: directPath, changeType: 'modify' },
              { path: shellPath, changeType: 'create' },
              { path: nestedWorktreePath, changeType: 'modify' },
            ],
          },
        },
      ])
      const service = new SessionService({} as never, (event) => events.push(event))
      const { sessionId } = await service.createSession({
        providerProfileId: 'tencent-provider',
        agentAdapter: 'claude-sdk',
        permissionMode: 'claude-plan',
        title: 'Turn journal session',
        workspaceId: 'journal-workspace',
      })

      await service.sendTurn({ sessionId, message: 'change two files' })

      await vi.waitFor(() => {
        expect(events).toContainEqual(
          expect.objectContaining({
            type: 'file_change',
            path: realpathSync(shellPath),
            changeType: 'create',
            collectionSource: 'agent_manifest',
          }),
        )
      })
      const fileChanges = events.filter((event) => event.type === 'file_change')
      expect(fileChanges.filter((event) => event.path.endsWith('direct.ts'))).toHaveLength(1)
      expect(fileChanges.some((event) => event.path.includes('.claude/worktrees'))).toBe(false)
      expect(fileChanges.some((event) => event.collectionSource === 'git_fallback')).toBe(false)
      expect(fileChanges.some((event) => event.collectionSource === 'workspace_snapshot')).toBe(
        false,
      )
    } finally {
      rmSync(workspaceRoot, { recursive: true, force: true })
    }
  })

  it('injects platform image aliases as manifest-routed spark_media models', async () => {
    seedProvider({
      id: 'spark-platform-newapi',
      provider_type: 'anthropic',
      name: 'Spark 平台模型',
      config_json: JSON.stringify({
        defaultModel: 'glm-5',
        modelIds: ['glm-5'],
        apiEndpoint: 'https://newapi.example',
        mediaApiEndpoint: 'https://newapi.example/v1',
        modelType: 'text',
        managedType: 'newapi',
        mediaModelRefs: [
          {
            manifestId: 'platform:spark-img:test',
            modelId: 'spark-img',
            templateManifestId: 'openai-images:gpt-image-2',
            displayName: 'spark-img',
            enabled: true,
          },
        ],
      }),
      keystore_ref: 'key-platform',
      is_default: 0,
    })
    const service = new SessionService({} as never, (event) => events.push(event))
    const { sessionId } = await service.createSession({
      providerProfileId: 'tencent-provider',
      agentAdapter: 'claude-sdk',
      permissionMode: 'claude-plan',
      title: 'Platform media session',
    })

    await service.sendTurn({ sessionId, message: 'draw with the platform image model' })
    await vi.waitFor(() => expect(mockState.sdkConfigs).toHaveLength(1))

    const mediaServer = (
      mockState.sdkConfigs[0]?.mcpServers as {
        spark_media: { env: Record<string, string> }
      }
    ).spark_media
    const runtimeConfig = JSON.parse(
      readFileSync(requireEnvValue(mediaServer.env, 'SPARK_MEDIA_CONFIG_FILE'), 'utf8'),
    ) as {
      providers: Array<{
        id: string
        model: string
        baseUrl?: string
        adapterFromManifest?: boolean
        manifests: Array<{ modelId: string; adapterModelId?: string; providerKind: string }>
      }>
    }
    const platformRoute = runtimeConfig.providers.find(
      (provider) => provider.id === 'spark-platform-newapi',
    )

    expect(platformRoute).toMatchObject({
      model: 'spark-img',
      baseUrl: 'https://newapi.example/v1',
      adapterFromManifest: true,
      manifests: [
        expect.objectContaining({
          modelId: 'spark-img',
          adapterModelId: 'gpt-image-2',
          providerKind: 'openai-images',
        }),
      ],
    })
  })

  it('injects all enabled image providers into one routable spark_media server', async () => {
    const imageManifest = (id: string, providerKind: string, modelId: string) => ({
      id,
      providerKind,
      modelId,
      displayName: modelId,
      domains: ['image'],
      capabilities: [
        {
          id: 'image.generate',
          label: '文生图',
          input: { required: ['prompt'] },
          output: { types: ['image'] },
          paramSchema: {},
        },
      ],
      invocation: {
        mode: 'sync',
        endpoint: '/images/generations',
        method: 'POST',
        contentType: 'json',
        requestTemplate: { model: '{{modelId}}', prompt: '{{prompt}}' },
        response: { kind: 'url', jsonPaths: ['data[].url'], download: true },
      },
      docs: { sourceUrls: [] },
    })
    seedProvider({
      id: 'xai-image-provider',
      provider_type: 'openai',
      name: 'xAI 图片',
      config_json: JSON.stringify({
        defaultModel: 'grok-imagine-image',
        modelIds: ['grok-imagine-image'],
        apiEndpoint: 'https://api.x.ai/v1',
        modelType: 'image',
        imageProvider: 'xai',
        imageApiType: 'sync',
        mediaProvider: 'xai',
        mediaApiType: 'sync',
        mediaCapabilities: ['image.generate'],
        mediaModelRefs: [
          {
            manifestId: 'xai:grok-imagine-image',
            modelId: 'grok-imagine-image',
            enabled: true,
            manifest: imageManifest('xai:grok-imagine-image', 'xai', 'grok-imagine-image'),
          },
        ],
      }),
      keystore_ref: 'key-xai-image',
      is_default: 0,
    })
    seedProvider({
      id: 'bailian-image-provider',
      provider_type: 'openai',
      name: '百炼图片',
      config_json: JSON.stringify({
        defaultModel: 'qwen-image-2.0-pro-2026-04-22',
        modelIds: ['qwen-image-2.0-pro-2026-04-22'],
        apiEndpoint: 'https://dashscope.aliyuncs.com/api/v1',
        modelType: 'image',
        imageProvider: 'bailian',
        imageApiType: 'async',
        mediaProvider: 'bailian',
        mediaApiType: 'async',
        mediaCapabilities: ['image.generate'],
        mediaModelRefs: [
          {
            manifestId: 'bailian:qwen-image-2.0-pro',
            modelId: 'qwen-image-2.0-pro-2026-04-22',
            enabled: true,
            manifest: imageManifest(
              'bailian:qwen-image-2.0-pro',
              'bailian',
              'qwen-image-2.0-pro-2026-04-22',
            ),
          },
        ],
      }),
      keystore_ref: 'key-bailian-image',
      is_default: 0,
    })
    const service = new SessionService({} as never, (event) => events.push(event))
    const { sessionId } = await service.createSession({
      providerProfileId: 'tencent-provider',
      agentAdapter: 'claude-sdk',
      permissionMode: 'claude-plan',
      title: 'Multi-provider image session',
    })

    await service.sendTurn({ sessionId, message: 'use qwen image model' })
    await vi.waitFor(() => expect(mockState.sdkConfigs).toHaveLength(1))

    const config = mockState.sdkConfigs[0]
    expect(config?.mcpServers).toHaveProperty('spark_media')
    expect(config?.mcpServers).not.toHaveProperty('spark_image')
    const mediaServer = (config?.mcpServers as { spark_media: { env: Record<string, string> } })
      .spark_media
    const providers = (
      JSON.parse(
        readFileSync(requireEnvValue(mediaServer.env, 'SPARK_MEDIA_CONFIG_FILE'), 'utf8'),
      ) as {
        providers: Array<{ id: string; model: string; provider: string }>
      }
    ).providers
    expect(providers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'xai-image-provider', model: 'grok-imagine-image' }),
        expect.objectContaining({
          id: 'bailian-image-provider',
          model: 'qwen-image-2.0-pro-2026-04-22',
          provider: 'bailian',
        }),
      ]),
    )
    expect(String(config?.skillSystemPrompt ?? '')).toContain('百炼图片')
    expect(String(config?.skillSystemPrompt ?? '')).toContain('qwen-image-2.0-pro-2026-04-22')
  })

  it('skips a media provider whose credential lookup fails and keeps other routes available', async () => {
    const manifest = {
      id: 'custom:working-image',
      providerKind: 'custom',
      modelId: 'working-image',
      displayName: 'Working Image',
      domains: ['image'],
      capabilities: [
        {
          id: 'image.generate',
          label: '文生图',
          input: { required: ['prompt'] },
          output: { types: ['image'] },
          paramSchema: {},
        },
      ],
      invocation: {
        mode: 'sync',
        endpoint: '/images/generations',
        method: 'POST',
        contentType: 'json',
        requestTemplate: { model: '{{modelId}}', prompt: '{{prompt}}' },
        response: { kind: 'url', jsonPaths: ['data[].url'], download: true },
      },
      docs: { sourceUrls: [] },
    }
    seedProvider({
      id: 'broken-image-provider',
      provider_type: 'openai',
      name: 'Broken Image',
      config_json: JSON.stringify({
        defaultModel: 'broken-image',
        modelType: 'image',
        mediaProvider: 'custom',
        mediaCapabilities: ['image.generate'],
        mediaModelRefs: [{ manifestId: 'custom:broken-image', modelId: 'broken-image', manifest }],
      }),
      keystore_ref: 'key-broken-image',
      is_default: 0,
    })
    seedProvider({
      id: 'working-image-provider',
      provider_type: 'openai',
      name: 'Working Image',
      config_json: JSON.stringify({
        defaultModel: 'working-image',
        modelType: 'image',
        mediaProvider: 'custom',
        mediaCapabilities: ['image.generate'],
        mediaModelRefs: [{ manifestId: manifest.id, modelId: manifest.modelId, manifest }],
      }),
      keystore_ref: 'key-working-image',
      is_default: 0,
    })
    vi.mocked(keystore.getSecret).mockImplementation(async (ref) => {
      if (String(ref) === 'key-broken-image') throw new Error('keychain unavailable')
      return 'test-api-key'
    })
    const service = new SessionService({} as never, (event) => events.push(event))
    const { sessionId } = await service.createSession({
      providerProfileId: 'tencent-provider',
      agentAdapter: 'claude-sdk',
      permissionMode: 'claude-plan',
      title: 'Credential isolation session',
    })

    await service.sendTurn({ sessionId, message: 'draw with the working provider' })
    await vi.waitFor(() => expect(mockState.sdkConfigs).toHaveLength(1))

    const mediaServer = (
      mockState.sdkConfigs[0]?.mcpServers as { spark_media: { env: Record<string, string> } }
    ).spark_media
    const providers = (
      JSON.parse(
        readFileSync(requireEnvValue(mediaServer.env, 'SPARK_MEDIA_CONFIG_FILE'), 'utf8'),
      ) as {
        providers: Array<{ id: string }>
      }
    ).providers
    expect(providers.map((provider) => provider.id)).toContain('working-image-provider')
    expect(providers.map((provider) => provider.id)).not.toContain('broken-image-provider')
  })

  it('injects spark_media into Codex adapter turns when media capabilities are configured', async () => {
    seedProvider({
      id: 'agnes-codex-provider',
      provider_type: 'openai',
      name: 'Agnes Codex',
      config_json: JSON.stringify({
        defaultModel: 'agnes-2.0-flash',
        modelIds: ['agnes-2.0-flash'],
        apiEndpoint: 'https://apihub.agnes-ai.com/v1',
        codexApiKind: 'responses',
        modelType: 'multimodal',
        mediaProvider: 'agnes',
        mediaApiType: 'auto',
        mediaCapabilities: ['image.generate', 'video.generate'],
        mediaModelRefs: [
          {
            manifestId: 'agnes:agnes-image-2.0-flash',
            modelId: 'agnes-image-2.0-flash',
            enabled: true,
          },
          { manifestId: 'agnes:agnes-video-v2.0', modelId: 'agnes-video-v2.0', enabled: true },
        ],
      }),
      keystore_ref: 'key-agnes',
      is_default: 0,
    })
    const service = new SessionService({} as never, (event) => events.push(event))
    const { sessionId } = await service.createSession({
      providerProfileId: 'agnes-codex-provider',
      agentAdapter: 'codex',
      permissionMode: 'codex-default',
      title: 'Codex Agnes media session',
    })

    await service.sendTurn({ sessionId, message: 'draw and animate this idea' })

    await vi.waitFor(() => {
      expect(mockState.sdkConfigs).toHaveLength(1)
    })
    const config = mockState.sdkConfigs[0]
    expect(config?.mcpServers).toMatchObject({
      spark_media: expect.objectContaining({ type: 'stdio' }),
    })
    expect(config?.mcpServers).not.toHaveProperty('spark_image')
    expect(String(config?.skillSystemPrompt ?? '')).toContain('mcp__spark_media__describe_model')
  })

  it('skips Codex post-turn memory work after cancellation', async () => {
    seedProvider({
      id: 'cancelled-codex-provider',
      provider_type: 'openai',
      name: 'Cancelled Codex',
      config_json: JSON.stringify({
        defaultModel: 'gpt-5.2-codex',
        modelIds: ['gpt-5.2-codex'],
        apiEndpoint: 'https://api.openai.com/v1',
        codexApiKind: 'responses',
      }),
      keystore_ref: 'key-cancelled-codex',
      is_default: 0,
    })
    mockState.nextSdkTurnStatuses.push('cancelled')
    const service = new SessionService({} as never, (event) => events.push(event))
    const writeMemory = vi.fn(async () => undefined)
    ;(
      service as unknown as { maybeWriteMemoryFromTurn: typeof writeMemory }
    ).maybeWriteMemoryFromTurn = writeMemory
    const { sessionId } = await service.createSession({
      providerProfileId: 'cancelled-codex-provider',
      agentAdapter: 'codex',
      permissionMode: 'codex-default',
      title: 'Cancelled Codex session',
    })

    await service.sendTurn({ sessionId, message: 'stop this turn' })

    await vi.waitFor(() => {
      expect(events).toContainEqual(
        expect.objectContaining({
          type: 'agent_status',
          status: 'cancelled',
        }),
      )
    })
    expect(writeMemory).not.toHaveBeenCalled()
  })

  it('bridges attached spark_canvas tools into Codex adapter turns as a stdio MCP server', async () => {
    seedProvider({
      id: 'codex-canvas-provider',
      provider_type: 'openai',
      name: 'Codex Canvas',
      config_json: JSON.stringify({
        defaultModel: 'gpt-5.2-codex',
        modelIds: ['gpt-5.2-codex'],
        apiEndpoint: 'https://api.openai.com/v1',
        codexApiKind: 'responses',
      }),
      keystore_ref: 'key-codex-canvas',
      is_default: 0,
    })

    const service = new SessionService({} as never, (event) => events.push(event))
    let attachedSessionId = ''
    service.setCanvasMcpProvider(async (sessionId) => {
      if (sessionId !== attachedSessionId) return null
      return {
        server: { type: 'sdk', name: 'spark_canvas', instance: { tools: [] } },
        allowedTools: ['mcp__spark_canvas__get_project'],
        toolSchemas: [
          {
            name: 'get_project',
            description: 'Read the attached canvas project summary.',
            inputSchema: { type: 'object', properties: {} },
          },
        ],
        callTool: async (_sessionId, toolName, args) => ({ toolName, args, ok: true }),
      }
    })
    const { sessionId } = await service.createSession({
      providerProfileId: 'codex-canvas-provider',
      agentAdapter: 'codex',
      permissionMode: 'codex-default',
      title: 'Codex canvas session',
    })
    attachedSessionId = sessionId

    await service.sendTurn({ sessionId, message: 'read the canvas' })

    await vi.waitFor(() => {
      expect(mockState.sdkConfigs).toHaveLength(1)
    })
    const config = mockState.sdkConfigs[0]
    const canvasServer = (
      config?.mcpServers as
        | Record<
            string,
            {
              type?: string
              command?: string
              args?: string[]
              env?: Record<string, string>
            }
          >
        | undefined
    )?.spark_canvas
    expect(canvasServer).toMatchObject({
      type: 'stdio',
      command: process.execPath,
    })
    expect(canvasServer?.args?.join(' ')).toContain('spark-canvas-mcp-server.mjs')
    expect(canvasServer?.env?.SPARK_CANVAS_SID).toBe(sessionId)
    expect(canvasServer?.env?.SPARK_CANVAS_TOOL_SCHEMAS_JSON).toContain('get_project')
    expect(config?.mcpServers).toMatchObject({
      spark_canvas: expect.not.objectContaining({ type: 'sdk' }),
    })
  })

  it('stops an attached Codex canvas turn when the canvas MCP runtime is unavailable', async () => {
    seedProvider({
      id: 'codex-canvas-missing-runtime-provider',
      provider_type: 'openai',
      name: 'Codex Canvas Missing Runtime',
      config_json: JSON.stringify({
        defaultModel: 'gpt-5.2-codex',
        modelIds: ['gpt-5.2-codex'],
        apiEndpoint: 'https://api.openai.com/v1',
        codexApiKind: 'responses',
      }),
      keystore_ref: 'key-codex-canvas-missing-runtime',
      is_default: 0,
    })

    const service = new SessionService({} as never, (event) => events.push(event))
    let attachedSessionId = ''
    service.setCanvasMcpProvider(async (sessionId) => {
      if (sessionId !== attachedSessionId) return null
      return {
        server: { type: 'sdk', name: 'spark_canvas', instance: { tools: [] } },
        allowedTools: [],
        toolSchemas: [],
        callTool: async () => ({ ok: true }),
      }
    })
    const { sessionId } = await service.createSession({
      providerProfileId: 'codex-canvas-missing-runtime-provider',
      agentAdapter: 'codex',
      permissionMode: 'codex-default',
      title: 'Codex canvas missing runtime session',
    })
    attachedSessionId = sessionId

    await service.sendTurn({ sessionId, message: 'add a node' })

    expect(mockState.sdkConfigs).toHaveLength(0)
    expect(events).toContainEqual(
      expect.objectContaining({
        type: 'agent_error',
        code: 'CANVAS_MCP_UNAVAILABLE',
        retryable: true,
      }),
    )
    expect(events).toContainEqual(
      expect.objectContaining({
        type: 'agent_status',
        status: 'error',
      }),
    )
  })

  it('stops an attached Claude canvas turn when its in-process MCP server is unavailable', async () => {
    const service = new SessionService({} as never, (event) => events.push(event))
    let attachedSessionId = ''
    service.setCanvasMcpProvider(async (sessionId) => {
      if (sessionId !== attachedSessionId) return null
      return {
        allowedTools: [],
        toolSchemas: [],
        callTool: async () => ({ ok: true }),
      }
    })
    const { sessionId } = await service.createSession({
      providerProfileId: 'tencent-provider',
      agentAdapter: 'claude-sdk',
      permissionMode: 'claude-plan',
      title: 'Claude canvas missing runtime session',
    })
    attachedSessionId = sessionId

    await service.sendTurn({ sessionId, message: 'add a node' })

    expect(mockState.sdkConfigs).toHaveLength(0)
    expect(events).toContainEqual(
      expect.objectContaining({
        type: 'agent_error',
        code: 'CANVAS_MCP_UNAVAILABLE',
        retryable: true,
      }),
    )
    expect(events).toContainEqual(
      expect.objectContaining({
        type: 'agent_status',
        status: 'error',
      }),
    )
  })

  it('updates the persisted session title when /rename is executed as chat events', async () => {
    const service = new SessionService({} as never, (event) => events.push(event))
    const { sessionId } = await service.createSession({
      providerProfileId: 'tencent-provider',
      agentAdapter: 'claude-sdk',
      permissionMode: 'claude-plan',
      title: 'Old title',
    })

    const result = await service.executeCommandAsEvents({
      sessionId,
      message: '/rename New command title',
    })

    expect(result).toMatchObject({ isCommand: true, forwardToAgent: false, started: false })
    expect(mockState.sessions.get(sessionId)?.title).toBe('New command title')
    expect(mockState.sdkTurns).toHaveLength(0)
    expect(events).toContainEqual(
      expect.objectContaining({
        type: 'assistant_message',
        provider: 'spark',
        isFinal: true,
      }),
    )
    expect(events).toContainEqual(
      expect.objectContaining({
        type: 'agent_status',
        status: 'completed',
        message: '/rename completed',
      }),
    )
  })

  it('forwards an unregistered slash-prefixed route to the Agent as ordinary text', async () => {
    const service = new SessionService({} as never, (event) => events.push(event))
    const { sessionId } = await service.createSession({
      providerProfileId: 'tencent-provider',
      agentAdapter: 'claude-sdk',
      permissionMode: 'claude-plan',
      title: 'Slash route session',
    })

    const result = await service.executeCommandAsEvents({
      sessionId,
      message:
        '/#/grid/workflow_backlog/budget_wfl_detail/2077664245723344898/YSDJ002/20776643296716308491 这个页面是不是在你项目中',
    })

    expect(result).toEqual({ isCommand: true, forwardToAgent: true })
    expect(events).not.toContainEqual(
      expect.objectContaining({
        type: 'assistant_message',
        provider: 'spark',
        content: expect.stringContaining('未知命令'),
      }),
    )
    expect(mockState.sdkTurns).toHaveLength(0)
  })

  it('does not inject command completed before /validate --repair follow-up Agent turn', async () => {
    const workspaceRoot = mkdtempSync(path.join(tmpdir(), 'spark-validate-repair-'))
    writeFileSync(
      path.join(workspaceRoot, 'package.json'),
      JSON.stringify({ scripts: { typecheck: 'node -e "process.exit(1)"' } }),
    )
    mockState.settings.set(
      'custom-commands:items',
      JSON.stringify([
        {
          id: 'validate',
          name: '/validate',
          description: 'Validate the current workspace command output and repair if needed',
          prompt: '验证命令:',
          script: '',
          scriptLanguage: 'javascript',
          enabled: true,
        },
      ]),
    )
    mockState.workspaces.set('repair-workspace', {
      id: 'repair-workspace',
      name: 'repair-workspace',
      root_path: workspaceRoot,
      project_kind: 'node',
      worktree_meta_json: null,
    })

    try {
      const service = new SessionService({} as never, (event) => events.push(event))
      const { sessionId } = await service.createSession({
        providerProfileId: 'tencent-provider',
        agentAdapter: 'claude-sdk',
        permissionMode: 'claude-plan',
        title: 'Repair validation session',
        workspaceId: 'repair-workspace',
      })

      const result = await service.executeCommandAsEvents({
        sessionId,
        message: '/validate npm run typecheck --repair',
      })

      expect(result).toMatchObject({ isCommand: true, forwardToAgent: false, started: true })
      expect(mockState.sdkTurns).toHaveLength(1)
      expect(mockState.sdkTurns[0]?.message).toContain('验证命令:')
      expect(mockState.sdkTurns[0]?.message).toContain('npm run typecheck')
      expect(events).toContainEqual(
        expect.objectContaining({
          type: 'assistant_message',
          provider: 'spark',
          isFinal: true,
        }),
      )
      const sparkCommandCompleted = events.find(
        (event) =>
          event.type === 'agent_status' &&
          event.status === 'completed' &&
          event.message === '/validate completed',
      )
      expect(sparkCommandCompleted).toBeUndefined()
    } finally {
      rmSync(workspaceRoot, { recursive: true, force: true })
    }
  })

  it('renders /status usage totals from persisted usage_update events when ledger is empty', async () => {
    const service = new SessionService({} as never, (event) => events.push(event))
    const { sessionId } = await service.createSession({
      providerProfileId: 'tencent-provider',
      agentAdapter: 'claude-sdk',
      permissionMode: 'claude-plan',
      title: 'Usage session',
    })

    mockState.events.push(
      {
        id: 'usage-1',
        session_id: sessionId,
        run_id: null,
        turn_id: 'turn-1',
        event_type: 'usage_update',
        event_json: JSON.stringify({
          id: 'usage-1',
          sessionId,
          turnId: 'turn-1',
          timestamp: '2026-05-28T00:00:00.000Z',
          seq: 0,
          type: 'usage_update',
          provider: 'claude',
          model: 'glm-5',
          inputTokens: 100,
          outputTokens: 40,
          estimatedCostUsd: 0.0123,
        }),
        seq: 0,
        created_at: '2026-05-28T00:00:00.000Z',
      },
      {
        id: 'usage-2',
        session_id: sessionId,
        run_id: null,
        turn_id: 'turn-2',
        event_type: 'usage_update',
        event_json: JSON.stringify({
          id: 'usage-2',
          sessionId,
          turnId: 'turn-2',
          timestamp: '2026-05-28T00:00:00.000Z',
          seq: 1,
          type: 'usage_update',
          provider: 'claude',
          model: 'glm-5',
          inputTokens: 25,
          outputTokens: 10,
          estimatedCostUsd: 0.0032,
        }),
        seq: 1,
        created_at: '2026-05-28T00:00:00.000Z',
      },
    )

    const result = await service.executeCommandAsEvents({ sessionId, message: '/status' })

    expect(result).toMatchObject({ isCommand: true, forwardToAgent: false, started: false })
    const assistant = events
      .slice()
      .reverse()
      .find((event: AgentEvent) => event.type === 'assistant_message')
    expect(assistant).toEqual(
      expect.objectContaining({
        type: 'assistant_message',
        provider: 'spark',
        content: expect.stringContaining('125'),
      }),
    )
    expect(
      (assistant as Extract<AgentEvent, { type: 'assistant_message' }> | undefined)?.content,
    ).toContain('50')
    expect(
      (assistant as Extract<AgentEvent, { type: 'assistant_message' }> | undefined)?.content,
    ).toContain('$0.0155')
  })

  it('passes selected attachments into the Claude SDK turn config', async () => {
    const attachmentPath = fileURLToPath(new URL('../../../package.json', import.meta.url))
    mockState.settings.set('telemetry:data', { runtimeLogEnabled: true })
    const service = new SessionService({} as never, (event) => events.push(event))
    const { sessionId } = await service.createSession({
      providerProfileId: 'tencent-provider',
      agentAdapter: 'claude-sdk',
      permissionMode: 'claude-plan',
      title: 'Attachment session',
    })

    await service.sendTurn({
      sessionId,
      message: 'inspect the selected file',
      attachments: [{ type: 'file', path: attachmentPath }],
    })

    await vi.waitFor(() => {
      expect(mockState.sdkConfigs).toHaveLength(1)
    })
    expect(mockState.sdkConfigs[0]).toMatchObject({
      attachments: [
        expect.objectContaining({
          type: 'file',
          name: 'package.json',
          path: attachmentPath,
        }),
      ],
    })
    expect(events).toContainEqual(
      expect.objectContaining({
        type: 'turn_prompt_snapshot',
        userMessage: expect.stringContaining('package.json'),
      }),
    )
  })

  it('marks scheduled automation turns as unattended in the SDK config', async () => {
    const service = new SessionService({} as never, (event) => events.push(event))
    const { sessionId } = await service.createSession({
      providerProfileId: 'tencent-provider',
      agentAdapter: 'claude-sdk',
      permissionMode: 'claude-auto',
      title: 'Scheduled automation session',
    })
    const row = mockState.sessions.get(sessionId)
    if (row == null) throw new Error('expected session row')
    row.metadata_json = JSON.stringify({
      automation: {
        source: 'scheduled-task',
        unattended: true,
      },
    })

    await service.sendTurn({ sessionId, message: 'run unattended automation' })

    await vi.waitFor(() => {
      expect(mockState.sdkConfigs).toHaveLength(1)
    })
    expect(mockState.sdkConfigs[0]).toMatchObject({
      permissionMode: 'claude-auto',
      unattended: true,
    })
    expect(mockState.sdkConfigs[0]).not.toHaveProperty('questionCallback')
    expect(String(mockState.sdkConfigs[0]?.systemPrompt ?? '')).toContain(
      'unattended scheduled automation',
    )
  })

  it('injects worktree session context into the system prompt', async () => {
    const workspaceRoot = mkdtempSync(path.join(tmpdir(), 'spark-worktree-session-'))
    mockState.workspaces.set('worktree-ws', {
      id: 'worktree-ws',
      name: 'spark-agent-worktree',
      root_path: workspaceRoot,
      project_kind: 'node',
      worktree_meta_json: JSON.stringify({
        baseRepoRoot: '/repo/base',
        branch: 'codex/worktree-sync-fix',
        baseBranch: 'develop',
        baseWorkspaceId: 'base-ws',
      }),
    })

    const service = new SessionService({} as never, (event) => events.push(event))
    const { sessionId } = await service.createSession({
      providerProfileId: 'tencent-provider',
      workspaceId: 'worktree-ws',
      agentAdapter: 'claude-sdk',
      permissionMode: 'claude-plan',
      title: 'Worktree session',
    })

    await service.sendTurn({ sessionId, message: 'fix the branch badge refresh issue' })

    await vi.waitFor(() => {
      expect(mockState.sdkConfigs).toHaveLength(1)
    })
    expect(String(mockState.sdkConfigs[0]?.systemPrompt ?? '')).toContain('[Worktree Session]')
    expect(String(mockState.sdkConfigs[0]?.systemPrompt ?? '')).toContain(
      'Current worktree branch: codex/worktree-sync-fix',
    )
    expect(String(mockState.sdkConfigs[0]?.systemPrompt ?? '')).toContain('Base branch: develop')
  })

  it('constrains team host tools to dispatch when resolved members exist', async () => {
    mockState.agents.set(
      'host-agent',
      makeAgent({
        id: 'host-agent',
        name: 'Host',
        providerProfileId: 'tencent-provider',
      }),
    )
    mockState.agents.set(
      'worker-1',
      makeAgent({
        id: 'worker-1',
        name: 'Worker One',
        providerProfileId: 'tencent-provider',
      }),
    )
    const service = new SessionService({} as never, (event) => events.push(event))
    const { sessionId } = await service.createSession({
      providerProfileId: 'tencent-provider',
      agentAdapter: 'claude-sdk',
      permissionMode: 'claude-plan',
      title: 'Team host session',
    })
    const row = mockState.sessions.get(sessionId)
    if (row == null) throw new Error('expected session row')
    row.metadata_json = JSON.stringify({
      team: {
        enabled: true,
        hostAgentId: 'host-agent',
        memberAgentIds: ['worker-1'],
      },
    })

    await service.sendTurn({ sessionId, message: 'orchestrate this', agentId: 'host-agent' })

    await vi.waitFor(() => {
      expect(mockState.sdkConfigs).toHaveLength(1)
    })
    expect(mockState.sdkConfigs[0]?.mcpServers).toMatchObject({
      spark_team: expect.objectContaining({ type: 'sdk', name: 'spark_team' }),
    })
    expect(mockState.sdkConfigs[0]?.allowedTools).toEqual(
      expect.arrayContaining([
        'mcp__spark_team__agent_dispatch',
        'mcp__spark_team__agent_dispatch_batch',
      ]),
    )
    // 产品决策（2026-07-04）：编排宿主不再硬剥离工具，「优先派发」只靠提示词引导。
    const hostDisallowed = (mockState.sdkConfigs[0]?.disallowedTools as string[] | undefined) ?? []
    expect(hostDisallowed).not.toContain('Edit')
    expect(hostDisallowed).not.toContain('Write')
    expect(hostDisallowed).not.toContain('Bash')
    expect(String(mockState.sdkConfigs[0]?.systemPrompt ?? '')).toContain('[Orchestration Mode]')
    expect(String(mockState.sdkConfigs[0]?.systemPrompt ?? '')).toContain('FULL toolset')
  })

  it('mounts the spark_team HTTP bridge for a codex host with team members (FR-0b)', async () => {
    mockState.mcpServers.push({
      id: 'mcp-codex-global',
      scope: 'user',
      name: 'global_search',
      config_json: JSON.stringify({ command: 'node', args: ['global-search.mjs'] }),
      enabled: 1,
      created_at: '2026-07-16T00:00:00.000Z',
      updated_at: '2026-07-16T00:00:00.000Z',
    })
    seedProvider({
      id: 'codex-provider',
      provider_type: 'openai',
      name: 'Codex Responses',
      config_json: JSON.stringify({
        defaultModel: 'gpt-5.2-codex',
        modelIds: ['gpt-5.2-codex'],
        apiEndpoint: 'https://api.openai.com/v1',
        codexApiKind: 'responses',
      }),
      keystore_ref: 'key-codex',
      is_default: 0,
    })
    mockState.agents.set(
      'codex-host',
      makeAgent({
        id: 'codex-host',
        name: 'Codex Host',
        providerProfileId: 'codex-provider',
        agentAdapter: 'codex',
        permissionMode: 'codex-default',
      }),
    )
    mockState.agents.set(
      'worker-1',
      makeAgent({
        id: 'worker-1',
        name: 'Worker One',
        providerProfileId: 'anthropic-provider',
      }),
    )
    const service = new SessionService({} as never, (event) => events.push(event))
    const { sessionId } = await service.createSession({
      providerProfileId: 'codex-provider',
      agentAdapter: 'codex',
      permissionMode: 'codex-default',
      title: 'Codex team host session',
    })
    const row = mockState.sessions.get(sessionId)
    if (row == null) throw new Error('expected session row')
    row.metadata_json = JSON.stringify({
      team: {
        enabled: true,
        hostAgentId: 'codex-host',
        memberAgentIds: ['worker-1'],
      },
    })

    await service.sendTurn({ sessionId, message: 'orchestrate this', agentId: 'codex-host' })

    await vi.waitFor(() => {
      expect(mockState.sdkConfigs).toHaveLength(1)
    })
    // codex Host 不能消费 in-process server，必须拿到 http 桥接形态（127.0.0.1 + Bearer token）
    const teamServer = (
      mockState.sdkConfigs[0]?.mcpServers as
        | Record<string, { type?: string; url?: string; headers?: Record<string, string> }>
        | undefined
    )?.spark_team
    expect(teamServer).toBeDefined()
    expect(teamServer?.type).toBe('http')
    expect(String(teamServer?.url)).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/mcp$/)
    expect(String(teamServer?.headers?.Authorization)).toMatch(/^Bearer .+/)
    expect(mockState.sdkConfigs[0]?.mcpServers).toHaveProperty('global_search')
  })

  it('falls back to the session provider when the Agent provider binding is stale', async () => {
    mockState.agents.set(
      'stale-provider-agent',
      makeAgent({
        id: 'stale-provider-agent',
        name: 'Stale Provider Agent',
        providerProfileId: 'deleted-on-another-device',
        modelId: 'stale-agent-model',
      }),
    )
    const service = new SessionService({} as never, (event) => events.push(event))
    const { sessionId } = await service.createSession({
      providerProfileId: 'tencent-provider',
      modelId: 'glm-5',
      agentId: 'stale-provider-agent',
      agentAdapter: 'claude-sdk',
      permissionMode: 'claude-plan',
      title: 'Cross-device stale provider binding',
    })

    await service.sendTurn({ sessionId, message: 'draft the goal contract' })

    await vi.waitFor(() => expect(mockState.sdkConfigs).toHaveLength(1))
    expect(mockState.sdkConfigs[0]).toMatchObject({
      model: 'glm-5',
      apiEndpoint: 'https://api.lkeap.cloud.tencent.com/coding/anthropic',
    })
  })

  it('uses the team Host Agent model over the previous solo-session model', async () => {
    seedProvider({
      id: 'team-host-provider',
      provider_type: 'anthropic',
      name: 'Team Host Provider',
      config_json: JSON.stringify({
        defaultModel: 'team-host-default',
        modelIds: ['team-host-model', 'team-host-default'],
        apiEndpoint: 'https://api.example.test/team-host/anthropic',
      }),
      keystore_ref: 'key-team-host',
      is_default: 0,
    })
    mockState.agents.set(
      'team-host',
      makeAgent({
        id: 'team-host',
        name: 'Team Host',
        providerProfileId: 'team-host-provider',
        modelId: 'team-host-model',
        metadata: { reasoningBudgetTokens: 8192 },
      }),
    )
    mockState.agents.set(
      'team-member',
      makeAgent({
        id: 'team-member',
        name: 'Team Member',
        providerProfileId: 'tencent-provider',
        metadata: { reasoningBudgetTokens: 4096 },
      }),
    )
    const service = new SessionService({} as never, (event) => events.push(event))
    const { sessionId } = await service.createSession({
      providerProfileId: 'tencent-provider',
      modelId: 'glm-5',
      agentId: 'team-host',
      agentAdapter: 'claude-sdk',
      permissionMode: 'claude-plan',
      title: 'Team host model precedence',
    })
    const row = mockState.sessions.get(sessionId)
    if (row == null) throw new Error('expected session row')
    row.metadata_json = JSON.stringify({
      team: { enabled: true, hostAgentId: 'team-host', memberAgentIds: ['team-member'] },
    })

    await service.sendTurn({ sessionId, message: 'use the host configuration' })

    await vi.waitFor(() => expect(mockState.sdkConfigs).toHaveLength(1))
    expect(mockState.sdkConfigs[0]).toMatchObject({
      model: 'team-host-model',
      apiEndpoint: 'https://api.example.test/team-host/anthropic',
      reasoningBudgetTokens: 8192,
    })
    const teamServer = (
      mockState.sdkConfigs[0]?.mcpServers as {
        spark_team: {
          instance: {
            tools: Array<{
              name: string
              handler: (args: Record<string, unknown>) => Promise<unknown>
            }>
          }
        }
      }
    ).spark_team
    const dispatchTool = teamServer.instance.tools.find((tool) => tool.name === 'agent_dispatch')
    if (dispatchTool == null) throw new Error('expected agent_dispatch tool')
    await dispatchTool.handler({
      targetAgentId: 'team-member',
      instruction: 'inherit the session model',
    })
    await vi.waitFor(() => expect(mockState.sdkConfigs).toHaveLength(2))
    expect(mockState.sdkConfigs[1]).toMatchObject({
      model: 'glm-5',
      apiEndpoint: 'https://api.lkeap.cloud.tencent.com/coding/anthropic',
      reasoningBudgetTokens: 4096,
    })
  })

  it('exposes peer messaging + round controls, and dispatched members respect the resume-safety gate', async () => {
    mockState.agents.set(
      'host-agent',
      makeAgent({
        id: 'host-agent',
        name: 'Host',
        providerProfileId: 'anthropic-provider',
      }),
    )
    mockState.agents.set(
      'worker-1',
      makeAgent({
        id: 'worker-1',
        name: 'Worker One',
        providerProfileId: 'anthropic-provider',
      }),
    )
    const service = new SessionService({} as never, (event) => events.push(event))
    const { sessionId } = await service.createSession({
      providerProfileId: 'anthropic-provider',
      agentAdapter: 'claude-sdk',
      permissionMode: 'claude-plan',
      title: 'Peer messaging session',
    })
    const row = mockState.sessions.get(sessionId)
    if (row == null) throw new Error('expected session row')
    row.metadata_json = JSON.stringify({
      team: {
        enabled: true,
        hostAgentId: 'host-agent',
        memberAgentIds: ['worker-1'],
        enablePeerMessaging: true,
        maxDiscussionRounds: 4,
      },
    })

    await service.sendTurn({ sessionId, message: 'coordinate this task', agentId: 'host-agent' })

    await vi.waitFor(() => {
      expect(mockState.sdkConfigs).toHaveLength(1)
    })
    const config = mockState.sdkConfigs[0]
    const teamServer = (
      config?.mcpServers as {
        spark_team: {
          instance: {
            tools: Array<{
              name: string
              handler: (args: Record<string, unknown>) => Promise<unknown>
            }>
          }
        }
      }
    ).spark_team
    expect(teamServer.instance.tools.map((tool) => tool.name)).toEqual([
      'agent_dispatch',
      'agent_dispatch_batch',
      'team_ledger_read',
      'team_ledger_propose',
      'team_ledger_confirm',
      'team_ledger_reject',
      'team_ledger_correct',
      'team_ledger_invalidate',
      'team_ledger_tombstone',
      'team_ledger_restore',
      'agent_message',
      'team_round_advance',
      'team_conclude',
      'team_thread_read',
    ])
    expect(config?.allowedTools).toEqual(
      expect.arrayContaining([
        'mcp__spark_team__agent_dispatch',
        'mcp__spark_team__agent_dispatch_batch',
        'mcp__spark_team__agent_message',
        'mcp__spark_team__team_round_advance',
        'mcp__spark_team__team_conclude',
        'mcp__spark_team__team_thread_read',
      ]),
    )

    const dispatchTool = teamServer.instance.tools.find((tool) => tool.name === 'agent_dispatch')
    if (dispatchTool == null) throw new Error('expected agent_dispatch tool')

    await dispatchTool.handler({ targetAgentId: 'worker-1', instruction: 'first pass' })
    await dispatchTool.handler({ targetAgentId: 'worker-1', instruction: 'second pass' })

    expect(mockState.sdkConfigs).toHaveLength(3)
    expect(String(mockState.sdkConfigs[1]?.systemPrompt ?? '')).toContain('a MEMBER of Host')
    expect(String(mockState.sdkConfigs[1]?.systemPrompt ?? '')).toContain('[Discussion So Far]')
    expect(String(mockState.sdkConfigs[1]?.systemPrompt ?? '')).toContain('first pass')
    const expectedResumeSafety = isSdkResumeSafe({
      providerType: 'anthropic',
      apiEndpoint: 'https://api.anthropic.com',
      model: 'claude-sonnet-4-5',
      agentAdapter: 'claude-sdk',
    })
    expect(mockState.sdkConfigs[1]?.continueSession).toBe(expectedResumeSafety)
    expect(mockState.sdkConfigs[2]?.continueSession).toBe(expectedResumeSafety)
    if (expectedResumeSafety) {
      expect(mockState.sdkConfigs[1]?.sdkSessionId).toBe(mockState.sdkConfigs[2]?.sdkSessionId)
    } else {
      expect(mockState.sdkConfigs[1]?.sdkSessionId).not.toBe(mockState.sdkConfigs[2]?.sdkSessionId)
    }
  })

  it('records cumulative member usage as deltas under the member provider and model', async () => {
    mockState.agents.set(
      'host-agent',
      makeAgent({
        id: 'host-agent',
        name: 'Host',
        providerProfileId: 'anthropic-provider',
      }),
    )
    mockState.agents.set(
      'worker-usage',
      makeAgent({
        id: 'worker-usage',
        name: 'Usage Worker',
        providerProfileId: 'xiaomi-provider',
        modelId: 'mimo-v2.5-pro',
      }),
    )
    const service = new SessionService({} as never, (event) => events.push(event))
    const { sessionId } = await service.createSession({
      providerProfileId: 'anthropic-provider',
      agentAdapter: 'claude-sdk',
      permissionMode: 'claude-plan',
      title: 'Member usage session',
    })
    const row = mockState.sessions.get(sessionId)
    if (row == null) throw new Error('expected session row')
    row.metadata_json = JSON.stringify({
      team: {
        enabled: true,
        hostAgentId: 'host-agent',
        memberAgentIds: ['worker-usage'],
      },
    })

    await service.sendTurn({ sessionId, message: 'coordinate usage', agentId: 'host-agent' })
    const teamServer = (
      mockState.sdkConfigs[0]?.mcpServers as {
        spark_team: {
          instance: {
            tools: Array<{
              name: string
              handler: (args: Record<string, unknown>) => Promise<unknown>
            }>
          }
        }
      }
    ).spark_team
    const dispatchTool = teamServer.instance.tools.find((tool) => tool.name === 'agent_dispatch')
    if (dispatchTool == null) throw new Error('expected agent_dispatch tool')
    mockState.nextSdkUsageEvents.push([
      {
        id: 'member-usage-1',
        type: 'usage_update',
        sessionId,
        turnId: 'member-turn',
        timestamp: '2026-05-28T00:00:01.000Z',
        seq: 0,
        provider: 'claude',
        model: 'mimo-v2.5-pro',
        inputTokens: 100,
        outputTokens: 20,
        reasoningOutputTokens: 8,
        cacheHitTokens: 5,
        estimatedCostUsd: 0.01,
      },
      {
        id: 'member-usage-2',
        type: 'usage_update',
        sessionId,
        turnId: 'member-turn',
        timestamp: '2026-05-28T00:00:02.000Z',
        seq: 0,
        provider: 'claude',
        model: 'mimo-v2.5-pro',
        inputTokens: 140,
        outputTokens: 35,
        reasoningOutputTokens: 14,
        cacheHitTokens: 7,
        estimatedCostUsd: 0.015,
      },
    ])

    await dispatchTool.handler({ targetAgentId: 'worker-usage', instruction: 'measure usage' })

    expect(mockState.usageRecords).toEqual([
      expect.objectContaining({
        providerId: 'xiaomi-provider',
        modelId: 'mimo-v2.5-pro',
        inputTokens: 100,
        outputTokens: 20,
        reasoningOutputTokens: 8,
        cacheReadTokens: 5,
        costUsd: 0.01,
      }),
      expect.objectContaining({
        providerId: 'xiaomi-provider',
        modelId: 'mimo-v2.5-pro',
        inputTokens: 40,
        outputTokens: 15,
        reasoningOutputTokens: 6,
        cacheReadTokens: 2,
        costUsd: expect.closeTo(0.005),
      }),
    ])
  })

  it('grants members agent_message (and only it) when peer messaging is on and nesting is off', async () => {
    mockState.mcpServers.push({
      id: 'mcp-member-global',
      scope: 'user',
      name: 'member_search',
      config_json: JSON.stringify({ command: 'node', args: ['member-search.mjs'] }),
      enabled: 1,
      created_at: '2026-07-16T00:00:00.000Z',
      updated_at: '2026-07-16T00:00:00.000Z',
    })
    mockState.agents.set(
      'host-agent',
      makeAgent({
        id: 'host-agent',
        name: 'Host',
        providerProfileId: 'anthropic-provider',
      }),
    )
    mockState.agents.set(
      'worker-1',
      makeAgent({
        id: 'worker-1',
        name: 'Worker One',
        providerProfileId: 'anthropic-provider',
        metadata: { toolIds: ['Read'] },
      }),
    )
    const service = new SessionService({} as never, (event) => events.push(event))
    const { sessionId } = await service.createSession({
      providerProfileId: 'anthropic-provider',
      agentAdapter: 'claude-sdk',
      permissionMode: 'claude-plan',
      title: 'Peer messaging without nesting',
    })
    const row = mockState.sessions.get(sessionId)
    if (row == null) throw new Error('expected session row')
    row.metadata_json = JSON.stringify({
      team: {
        enabled: true,
        hostAgentId: 'host-agent',
        memberAgentIds: ['worker-1'],
        enablePeerMessaging: true,
        allowNesting: false,
      },
    })

    await service.sendTurn({ sessionId, message: 'coordinate this task', agentId: 'host-agent' })

    await vi.waitFor(() => {
      expect(mockState.sdkConfigs).toHaveLength(1)
    })
    const hostTeamServer = (
      mockState.sdkConfigs[0]?.mcpServers as {
        spark_team: {
          instance: {
            tools: Array<{
              name: string
              handler: (args: Record<string, unknown>) => Promise<unknown>
            }>
          }
        }
      }
    ).spark_team
    const dispatchTool = hostTeamServer.instance.tools.find(
      (tool) => tool.name === 'agent_dispatch',
    )
    if (dispatchTool == null) throw new Error('expected agent_dispatch tool')

    await dispatchTool.handler({ targetAgentId: 'worker-1', instruction: 'first pass' })

    await vi.waitFor(() => {
      expect(mockState.sdkConfigs).toHaveLength(2)
    })
    const memberConfig = mockState.sdkConfigs[1]
    expect(memberConfig?.mcpServers).toHaveProperty('member_search')
    const memberPrompt = String(memberConfig?.systemPrompt ?? '')
    expect(memberPrompt).toContain('a MEMBER of Host')
    expect(memberPrompt).toContain('[Discussion So Far]')
    // peer messaging 与嵌套解耦：enablePeerMessaging=true 时成员必须拿到 agent_message
    // 工具 + 对应使用说明（旧实现误把这两者绑在 allowNesting 上 → 假 A2A：成员只能
    // 把话带回 Host 转发）。
    expect(memberPrompt).toContain('mcp__spark_team__agent_message')
    expect(memberPrompt).toContain('Do NOT immediately ping back')
    const memberTeamServer = (
      memberConfig?.mcpServers as
        | {
            spark_team?: { instance: { tools: Array<{ name: string }> } }
          }
        | undefined
    )?.spark_team
    expect(memberTeamServer).toBeDefined()
    // 嵌套关着：只有 agent_message + 只读 team_thread_read，不能越权获得 dispatch / 轮次控制工具
    expect(memberTeamServer?.instance.tools.map((tool) => tool.name)).toEqual([
      'team_ledger_read',
      'team_ledger_propose',
      'agent_message',
      'team_thread_read',
    ])
    expect(memberConfig?.allowedTools).toEqual(
      expect.arrayContaining(['mcp__spark_team__agent_message']),
    )
    expect(memberConfig?.allowedTools).not.toEqual(
      expect.arrayContaining(['mcp__spark_team__agent_dispatch']),
    )
    expect(memberConfig?.mcpServers).toHaveProperty('member_search')
    expect(memberConfig?.mcpServers).toHaveProperty('spark_memory')
    expect(String(memberConfig?.systemPrompt ?? '')).toContain('search_memory')
  })

  it('gives an @-mentioned member the roster + agent_message tools without stripping its work tools', async () => {
    mockState.agents.set(
      'host-agent',
      makeAgent({
        id: 'host-agent',
        name: 'Host',
        providerProfileId: 'anthropic-provider',
      }),
    )
    mockState.agents.set(
      'worker-1',
      makeAgent({
        id: 'worker-1',
        name: 'Worker One',
        providerProfileId: 'anthropic-provider',
      }),
    )
    mockState.agents.set(
      'worker-2',
      makeAgent({
        id: 'worker-2',
        name: 'Worker Two',
        providerProfileId: 'anthropic-provider',
      }),
    )
    const service = new SessionService({} as never, (event) => events.push(event))
    const { sessionId } = await service.createSession({
      providerProfileId: 'anthropic-provider',
      agentAdapter: 'claude-sdk',
      permissionMode: 'claude-plan',
      title: 'Mention peer messaging session',
    })
    const row = mockState.sessions.get(sessionId)
    if (row == null) throw new Error('expected session row')
    row.metadata_json = JSON.stringify({
      team: {
        enabled: true,
        hostAgentId: 'host-agent',
        memberAgentIds: ['worker-1', 'worker-2'],
        enablePeerMessaging: true,
      },
    })

    await service.sendTurn({
      sessionId,
      message: '去问问 Worker Two 的结论',
      mentionAgentId: 'worker-1',
    })

    await vi.waitFor(() => {
      expect(mockState.sdkConfigs).toHaveLength(1)
    })
    const config = mockState.sdkConfigs[0]
    const prompt = String(config?.systemPrompt ?? '')
    // 被 @ 成员必须知道：自己是谁、团队里有谁、怎么联系（旧实现 mention 路径完全不注入这些）
    expect(prompt).toContain('a MEMBER of Host')
    expect(prompt).toContain('id: worker-2')
    expect(prompt).toContain('mcp__spark_team__agent_message')
    const teamServer = (
      config?.mcpServers as
        | {
            spark_team?: { instance: { tools: Array<{ name: string }> } }
          }
        | undefined
    )?.spark_team
    expect(teamServer).toBeDefined()
    // 只可对话（agent_message）+ 只读翻线程（team_thread_read），不可派发
    expect(teamServer?.instance.tools.map((tool) => tool.name)).toEqual([
      'team_ledger_read',
      'team_ledger_propose',
      'agent_message',
      'team_thread_read',
    ])
    expect(teamServer?.instance.tools.map((tool) => tool.name)).not.toContain('team_ledger_confirm')
    expect(teamServer?.instance.tools.map((tool) => tool.name)).not.toContain('team_ledger_restore')
    // 关键回归：peer-only server 不得触发编排模式工具剥离（成员还要 Edit/Write/Bash 干活）
    const disallowed = (config?.disallowedTools as string[] | undefined) ?? []
    expect(disallowed).not.toContain('Edit')
    expect(disallowed).not.toContain('Bash')
  })

  it('resumes each stable SDK session after Host and mentioned Member turns alternate', async () => {
    mockState.agents.set(
      'host-agent',
      makeAgent({
        id: 'host-agent',
        name: 'Host',
        providerProfileId: 'anthropic-provider',
      }),
    )
    mockState.agents.set(
      'worker-1',
      makeAgent({
        id: 'worker-1',
        name: 'Worker One',
        providerProfileId: 'anthropic-provider',
      }),
    )
    const service = new SessionService({} as never, (event) => events.push(event))
    const { sessionId } = await service.createSession({
      providerProfileId: 'anthropic-provider',
      agentId: 'host-agent',
      agentAdapter: 'claude-sdk',
      permissionMode: 'claude-plan',
      title: 'Alternating resume session',
    })
    const row = mockState.sessions.get(sessionId)
    if (row == null) throw new Error('expected session row')
    row.metadata_json = JSON.stringify({
      team: {
        enabled: true,
        hostAgentId: 'host-agent',
        memberAgentIds: ['worker-1'],
      },
    })

    await service.sendTurn({ sessionId, message: 'host first', agentId: 'host-agent' })
    await vi.waitFor(() => expect(mockState.sdkConfigs).toHaveLength(1))
    await service.sendTurn({ sessionId, message: 'member turn', mentionAgentId: 'worker-1' })
    await vi.waitFor(() => expect(mockState.sdkConfigs).toHaveLength(2))
    await service.sendTurn({ sessionId, message: 'host returns', agentId: 'host-agent' })
    await vi.waitFor(() => expect(mockState.sdkConfigs).toHaveLength(3))

    expect(mockState.sdkConfigs[0]?.continueSession).toBe(false)
    expect(mockState.sdkConfigs[1]?.continueSession).toBe(false)
    expect(mockState.sdkConfigs[2]?.continueSession).toBe(true)
    expect(mockState.sdkConfigs[2]?.sdkSessionId).toBe(mockState.sdkConfigs[0]?.sdkSessionId)
    expect(mockState.sdkConfigs[1]?.sdkSessionId).not.toBe(mockState.sdkConfigs[0]?.sdkSessionId)
  })

  it('exposes workflow_run for a managed host with an enabled explicit workflow worker', async () => {
    mockState.agents.set(
      'workflow-host',
      makeAgent({
        id: 'workflow-host',
        name: 'Workflow Host',
        providerProfileId: 'tencent-provider',
        workflowId: 'workflow-1',
        prompt: 'My default workflow is Old six-step workflow. Always report that old workflow.',
      }),
    )
    mockState.agents.set(
      'workflow-worker',
      makeAgent({
        id: 'workflow-worker',
        name: 'Workflow Worker',
        providerProfileId: 'tencent-provider',
      }),
    )
    mockState.workflows.set('workflow-1', {
      id: 'workflow-1',
      name: 'Sequential workflow',
      description: 'Run the configured worker.',
      graph: {
        nodes: [
          {
            id: 'work',
            kind: 'agent',
            title: 'Do the work',
            config: { agentId: 'workflow-worker', outputKey: 'result' },
          },
        ],
        edges: [],
      },
    })
    const service = new SessionService({} as never, (event) => events.push(event))
    const { sessionId } = await service.createSession({
      providerProfileId: 'tencent-provider',
      agentId: 'workflow-host',
      agentAdapter: 'claude-sdk',
      permissionMode: 'claude-plan',
      title: 'Workflow host session',
    })

    await service.sendTurn({ sessionId, message: 'run the workflow' })

    await vi.waitFor(() => {
      expect(mockState.sdkConfigs).toHaveLength(1)
    })
    const config = mockState.sdkConfigs[0]
    expect(config?.mcpServers).toMatchObject({
      spark_team: expect.objectContaining({ type: 'sdk', name: 'spark_team' }),
    })
    const teamServer = (
      config?.mcpServers as {
        spark_team: { instance: { tools: Array<{ name: string }> } }
      }
    ).spark_team
    expect(teamServer.instance.tools.map((tool) => tool.name)).toEqual(['workflow_run'])
    expect(config?.allowedTools).toEqual(expect.arrayContaining(['mcp__spark_team__workflow_run']))
    // 产品决策（2026-07-04）：挂工作流的宿主同样保留全量工具，不再硬剥离。
    const workflowHostDisallowed = (config?.disallowedTools as string[] | undefined) ?? []
    expect(workflowHostDisallowed).not.toContain('Edit')
    expect(workflowHostDisallowed).not.toContain('Bash')
    const systemPrompt = String(config?.systemPrompt ?? '')
    expect(systemPrompt).toContain(
      'call `mcp__spark_team__workflow_run` exactly once with the current user objective',
    )
    expect(systemPrompt).toContain('My default workflow is Old six-step workflow')
    expect(systemPrompt.lastIndexOf('[Current Workflow Binding — Authoritative]')).toBeGreaterThan(
      systemPrompt.lastIndexOf('My default workflow is Old six-step workflow'),
    )
    expect(systemPrompt).toContain('When asked which workflow you use, report this workflow only.')
    expect(systemPrompt).toContain(
      'All unrelated system, agent, project, session, and user instructions remain in force.',
    )
  })

  it('uses the host agent for unbound or unavailable workflow agent nodes', async () => {
    mockState.agents.set(
      'workflow-host',
      makeAgent({
        id: 'workflow-host',
        name: 'Workflow Host',
        providerProfileId: 'tencent-provider',
        workflowId: 'workflow-host-fallback',
      }),
    )
    mockState.workflows.set('workflow-host-fallback', {
      id: 'workflow-host-fallback',
      name: 'Host fallback workflow',
      description: 'Run unbound agent nodes on the current host.',
      graph: {
        nodes: [
          {
            id: 'plan',
            kind: 'agent',
            title: 'Plan',
            config: { outputKey: 'plan' },
          },
          {
            id: 'implement',
            kind: 'agent',
            title: 'Implement',
            config: { agentId: 'deleted-worker', outputKey: 'implementation' },
          },
        ],
        edges: [{ id: 'plan-implement', from: 'plan', to: 'implement' }],
      },
    })
    const service = new SessionService({} as never, (event) => events.push(event))
    const { sessionId } = await service.createSession({
      providerProfileId: 'tencent-provider',
      agentId: 'workflow-host',
      agentAdapter: 'claude-sdk',
      permissionMode: 'claude-plan',
      title: 'Workflow host fallback session',
    })

    await service.sendTurn({ sessionId, message: 'run the workflow' })

    await vi.waitFor(() => {
      expect(mockState.sdkConfigs).toHaveLength(1)
    })
    const tool = (
      mockState.sdkConfigs[0]?.mcpServers as {
        spark_team: {
          instance: {
            tools: Array<{
              name: string
              handler: (args: Record<string, unknown>) => Promise<{
                structuredContent: unknown
              }>
            }>
          }
        }
      }
    ).spark_team.instance.tools.find((item) => item.name === 'workflow_run')
    if (tool == null) throw new Error('expected workflow_run tool')

    const response = await tool.handler({ objective: 'exercise host fallback' })

    expect(response.structuredContent).toMatchObject({
      status: 'completed',
      executions: [
        { nodeId: 'plan', agentId: 'workflow-host', state: 'completed' },
        { nodeId: 'implement', agentId: 'workflow-host', state: 'completed' },
      ],
    })
    expect(mockState.sdkConfigs).toHaveLength(3)
    expect(String(mockState.sdkConfigs[1]?.systemPrompt ?? '')).toContain(
      'Agent: Workflow Host (workflow-host)',
    )
    expect(String(mockState.sdkConfigs[2]?.systemPrompt ?? '')).toContain(
      'Agent: Workflow Host (workflow-host)',
    )
  })

  it('exposes workflow_run for a managed host with a temporary subagent workflow worker', async () => {
    mockState.agents.set(
      'workflow-host',
      makeAgent({
        id: 'workflow-host',
        name: 'Workflow Host',
        providerProfileId: 'tencent-provider',
        workflowId: 'workflow-subagent',
      }),
    )
    mockState.workflows.set('workflow-subagent', {
      id: 'workflow-subagent',
      name: 'Subagent workflow',
      description: 'Run a temporary subagent worker.',
      graph: {
        nodes: [
          {
            id: 'draft-temp',
            kind: 'subagent',
            title: 'Draft Temp',
            config: {
              prompt: 'Draft the section',
              outputKey: 'section',
              modelId: 'glm-5',
              providerProfileId: 'tencent-provider',
            },
          },
        ],
        edges: [],
      },
    })
    const service = new SessionService({} as never, (event) => events.push(event))
    const { sessionId } = await service.createSession({
      providerProfileId: 'tencent-provider',
      agentId: 'workflow-host',
      agentAdapter: 'claude-sdk',
      permissionMode: 'claude-plan',
      title: 'Subagent workflow host session',
    })

    await service.sendTurn({ sessionId, message: 'run the subagent workflow' })

    await vi.waitFor(() => {
      expect(mockState.sdkConfigs).toHaveLength(1)
    })
    const config = mockState.sdkConfigs[0]
    const teamServer = (
      config?.mcpServers as {
        spark_team: { instance: { tools: Array<{ name: string }> } }
      }
    ).spark_team
    expect(teamServer.instance.tools.map((tool) => tool.name)).toEqual(['workflow_run'])
    expect(config?.allowedTools).toEqual(expect.arrayContaining(['mcp__spark_team__workflow_run']))
  })

  it('exposes workflow_run for an atomic-only workflow so the host can execute it reliably', async () => {
    mockState.mcpServers.push({
      id: 'mcp-write-capable',
      scope: 'user',
      name: 'write_capable_custom',
      config_json: JSON.stringify({ command: 'node', args: ['write-capable.mjs'] }),
      enabled: 1,
      created_at: '2026-07-16T00:00:00.000Z',
      updated_at: '2026-07-16T00:00:00.000Z',
    })
    mockState.agents.set(
      'workflow-host',
      makeAgent({
        id: 'workflow-host',
        name: 'Workflow Host',
        providerProfileId: 'tencent-provider',
        workflowId: 'workflow-atomic',
      }),
    )
    mockState.workflows.set('workflow-atomic', {
      id: 'workflow-atomic',
      name: 'Atomic workflow',
      description: 'Run host-side atomic nodes.',
      graph: {
        nodes: [
          {
            id: 'brief',
            kind: 'input',
            title: 'Brief',
            config: { prompt: 'Atomic brief', outputKey: 'brief' },
          },
        ],
        edges: [],
      },
    })
    const service = new SessionService({} as never, (event) => events.push(event))
    const { sessionId } = await service.createSession({
      providerProfileId: 'tencent-provider',
      agentId: 'workflow-host',
      agentAdapter: 'claude-sdk',
      permissionMode: 'claude-plan',
      title: 'Atomic workflow host session',
    })

    await service.sendTurn({ sessionId, message: 'run the atomic workflow' })

    await vi.waitFor(() => {
      expect(mockState.sdkConfigs).toHaveLength(1)
    })
    const config = mockState.sdkConfigs[0]
    const teamServer = (
      config?.mcpServers as {
        spark_team: {
          instance: {
            tools: Array<{
              name: string
              handler: (args: Record<string, unknown>) => Promise<unknown>
            }>
          }
        }
      }
    ).spark_team
    expect(teamServer.instance.tools.map((tool) => tool.name)).toEqual(['workflow_run'])
    expect(config?.allowedTools).toEqual(expect.arrayContaining(['mcp__spark_team__workflow_run']))

    const workflowRun = teamServer.instance.tools[0]
    if (workflowRun == null) throw new Error('expected workflow_run tool')
    await workflowRun.handler({ objective: 'parse an atomic brief' })
    const atomicConfig = mockState.sdkConfigs[1]
    expect(atomicConfig?.mcpServers).not.toHaveProperty('write_capable_custom')
    expect(atomicConfig?.mcpServers).toHaveProperty('spark_memory')
    expect(atomicConfig).not.toHaveProperty('skillPlugins')
    expect(atomicConfig).not.toHaveProperty('nativeSkills')
  })

  it('returns a structured failed workflow_run result when a workflow worker fails', async () => {
    mockState.agents.set(
      'workflow-host',
      makeAgent({
        id: 'workflow-host',
        name: 'Workflow Host',
        providerProfileId: 'tencent-provider',
        workflowId: 'workflow-fail',
      }),
    )
    mockState.agents.set(
      'workflow-worker',
      makeAgent({
        id: 'workflow-worker',
        name: 'Workflow Worker',
        providerProfileId: 'tencent-provider',
      }),
    )
    mockState.workflows.set('workflow-fail', {
      id: 'workflow-fail',
      name: 'Failing workflow',
      description: 'Exercise failed worker responses.',
      graph: {
        nodes: [
          {
            id: 'work',
            kind: 'agent',
            title: 'Do the work',
            config: { agentId: 'workflow-worker', retryCount: 1, outputKey: 'result' },
          },
        ],
        edges: [],
      },
    })
    const service = new SessionService({} as never, (event) => events.push(event))
    const { sessionId } = await service.createSession({
      providerProfileId: 'tencent-provider',
      agentId: 'workflow-host',
      agentAdapter: 'claude-sdk',
      permissionMode: 'claude-plan',
      title: 'Workflow failure session',
    })

    await service.sendTurn({ sessionId, message: 'run the workflow' })

    await vi.waitFor(() => {
      expect(mockState.sdkConfigs).toHaveLength(1)
    })
    const tool = (
      mockState.sdkConfigs[0]?.mcpServers as {
        spark_team: {
          instance: {
            tools: Array<{
              name: string
              handler: (args: Record<string, unknown>) => Promise<{
                content: Array<{ text: string }>
                structuredContent: unknown
              }>
            }>
          }
        }
      }
    ).spark_team.instance.tools.find((item) => item.name === 'workflow_run')
    if (tool == null) throw new Error('expected workflow_run tool')
    mockState.nextSdkTurnErrors.push('member failure', 'member failure')

    const response = await tool.handler({ objective: 'attempt failed workflow' })

    expect(response.content[0]?.text).toContain('Workflow failed at node work after 2 attempt(s)')
    expect(response.structuredContent).toMatchObject({
      status: 'failed',
      failedNode: {
        nodeId: 'work',
        agentId: 'workflow-worker',
        attempt: 2,
        error: { message: 'member failure' },
      },
    })
  })

  it('applies workflow agent node runtime overrides to the dispatched member turn', async () => {
    mockState.agents.set(
      'workflow-host',
      makeAgent({
        id: 'workflow-host',
        name: 'Workflow Host',
        providerProfileId: 'tencent-provider',
        workflowId: 'workflow-overrides',
      }),
    )
    mockState.agents.set(
      'workflow-worker',
      makeAgent({
        id: 'workflow-worker',
        name: 'Workflow Worker',
        providerProfileId: 'tencent-provider',
        modelId: 'glm-5',
        permissionMode: 'claude-plan',
        prompt: 'Persisted worker prompt',
      }),
    )
    mockState.workflows.set('workflow-overrides', {
      id: 'workflow-overrides',
      name: 'Override workflow',
      description: 'Dispatch with node-level runtime config.',
      graph: {
        nodes: [
          {
            id: 'work',
            kind: 'agent',
            title: 'Do override work',
            config: {
              agentId: 'workflow-worker',
              prompt: 'Node prompt wins',
              modelId: 'mimo-v2.5-pro',
              providerProfileId: 'xiaomi-provider',
              permissionMode: 'claude-auto',
              outputKey: 'result',
            },
          },
        ],
        edges: [],
      },
    })
    const service = new SessionService({} as never, (event) => events.push(event))
    const { sessionId } = await service.createSession({
      providerProfileId: 'tencent-provider',
      agentId: 'workflow-host',
      agentAdapter: 'claude-sdk',
      permissionMode: 'claude-plan',
      title: 'Workflow override session',
    })

    await service.sendTurn({ sessionId, message: 'run the workflow' })

    await vi.waitFor(() => {
      expect(mockState.sdkConfigs).toHaveLength(1)
    })
    const tool = (
      mockState.sdkConfigs[0]?.mcpServers as {
        spark_team: {
          instance: {
            tools: Array<{
              name: string
              handler: (args: Record<string, unknown>) => Promise<unknown>
            }>
          }
        }
      }
    ).spark_team.instance.tools.find((item) => item.name === 'workflow_run')
    if (tool == null) throw new Error('expected workflow_run tool')

    await tool.handler({ objective: 'exercise overrides' })

    expect(mockState.sdkConfigs[1]).toMatchObject({
      model: 'mimo-v2.5-pro',
      permissionMode: 'claude-auto',
    })
    expect(String(mockState.sdkConfigs[1]?.apiEndpoint ?? '')).toContain('/xiaomi/')
    expect(String(mockState.sdkConfigs[1]?.systemPrompt ?? '')).toContain('Node prompt wins')
    expect(String(mockState.sdkConfigs[1]?.systemPrompt ?? '')).not.toContain(
      'Persisted worker prompt',
    )
  })

  it('runs workflow verify node commands through workflow_run atomic execution', async () => {
    const workspaceRoot = mkdtempSync(path.join(tmpdir(), 'spark-workflow-verify-'))
    try {
      mockState.workspaces.set('verify-workspace', {
        id: 'verify-workspace',
        name: 'verify-workspace',
        root_path: workspaceRoot,
        project_kind: 'node',
        worktree_meta_json: null,
      })
      mockState.agents.set(
        'workflow-host',
        makeAgent({
          id: 'workflow-host',
          name: 'Workflow Host',
          providerProfileId: 'tencent-provider',
          workflowId: 'workflow-verify',
        }),
      )
      mockState.agents.set(
        'workflow-worker',
        makeAgent({
          id: 'workflow-worker',
          name: 'Workflow Worker',
          providerProfileId: 'tencent-provider',
        }),
      )
      mockState.workflows.set('workflow-verify', {
        id: 'workflow-verify',
        name: 'Verify workflow',
        description: 'Run verification after work.',
        graph: {
          nodes: [
            {
              id: 'work',
              kind: 'agent',
              title: 'Work',
              config: { agentId: 'workflow-worker', outputKey: 'result' },
            },
            {
              id: 'verify',
              kind: 'verify',
              title: 'Verify',
              config: { verifyCommands: ['printf workflow-verified'], outputKey: 'verification' },
            },
          ],
          edges: [{ id: 'work-verify', from: 'work', to: 'verify' }],
        },
      })
      const service = new SessionService({} as never, (event) => events.push(event))
      const { sessionId } = await service.createSession({
        providerProfileId: 'tencent-provider',
        agentId: 'workflow-host',
        agentAdapter: 'claude-sdk',
        permissionMode: 'claude-plan',
        title: 'Workflow verify session',
        workspaceId: 'verify-workspace',
      })

      await service.sendTurn({ sessionId, message: 'run workflow verify' })

      await vi.waitFor(() => {
        expect(mockState.sdkConfigs).toHaveLength(1)
      })
      const tool = (
        mockState.sdkConfigs[0]?.mcpServers as {
          spark_team: {
            instance: {
              tools: Array<{
                name: string
                handler: (args: Record<string, unknown>) => Promise<{
                  structuredContent: {
                    atomicExecutions?: Array<{ nodeId: string; content: string; state: string }>
                  }
                }>
              }>
            }
          }
        }
      ).spark_team.instance.tools.find((item) => item.name === 'workflow_run')
      if (tool == null) throw new Error('expected workflow_run tool')

      const response = await tool.handler({ objective: 'exercise verify commands' })

      expect(response.structuredContent.atomicExecutions).toEqual([
        expect.objectContaining({
          nodeId: 'verify',
          state: 'completed',
          content: expect.stringContaining('workflow-verified'),
        }),
      ])
    } finally {
      rmSync(workspaceRoot, { recursive: true, force: true })
    }
  })

  it('exposes both team dispatch and workflow_run when a managed host has team members and workflow workers', async () => {
    mockState.agents.set(
      'hybrid-host',
      makeAgent({
        id: 'hybrid-host',
        name: 'Hybrid Host',
        providerProfileId: 'tencent-provider',
        workflowId: 'workflow-hybrid',
      }),
    )
    mockState.agents.set(
      'team-worker',
      makeAgent({
        id: 'team-worker',
        name: 'Team Worker',
        providerProfileId: 'tencent-provider',
      }),
    )
    mockState.agents.set(
      'workflow-worker',
      makeAgent({
        id: 'workflow-worker',
        name: 'Workflow Worker',
        providerProfileId: 'tencent-provider',
      }),
    )
    mockState.workflows.set('workflow-hybrid', {
      id: 'workflow-hybrid',
      name: 'Hybrid workflow',
      description: 'Dispatch through the managed workflow.',
      graph: {
        nodes: [
          {
            id: 'workflow-step',
            kind: 'agent',
            title: 'Workflow step',
            config: { agentId: 'workflow-worker', outputKey: 'result' },
          },
        ],
        edges: [],
      },
    })
    const service = new SessionService({} as never, (event) => events.push(event))
    const { sessionId } = await service.createSession({
      providerProfileId: 'tencent-provider',
      agentId: 'hybrid-host',
      agentAdapter: 'claude-sdk',
      permissionMode: 'claude-plan',
      title: 'Hybrid host session',
    })
    const row = mockState.sessions.get(sessionId)
    if (row == null) throw new Error('expected session row')
    row.metadata_json = JSON.stringify({
      team: {
        enabled: true,
        hostAgentId: 'hybrid-host',
        memberAgentIds: ['team-worker'],
      },
    })

    await service.sendTurn({ sessionId, message: 'orchestrate the hybrid workflow' })

    await vi.waitFor(() => {
      expect(mockState.sdkConfigs).toHaveLength(1)
    })
    const config = mockState.sdkConfigs[0]
    const teamServer = (
      config?.mcpServers as {
        spark_team: { instance: { tools: Array<{ name: string }> } }
      }
    ).spark_team
    expect(teamServer.instance.tools.map((tool) => tool.name)).toEqual([
      'agent_dispatch',
      'agent_dispatch_batch',
      'team_ledger_read',
      'team_ledger_propose',
      'team_ledger_confirm',
      'team_ledger_reject',
      'team_ledger_correct',
      'team_ledger_invalidate',
      'team_ledger_tombstone',
      'team_ledger_restore',
      'team_round_advance',
      'team_conclude',
      'team_thread_read',
      'workflow_run',
    ])
    expect(config?.allowedTools).toEqual(
      expect.arrayContaining([
        'mcp__spark_team__agent_dispatch',
        'mcp__spark_team__agent_dispatch_batch',
        'mcp__spark_team__team_round_advance',
        'mcp__spark_team__team_conclude',
        'mcp__spark_team__team_thread_read',
        'mcp__spark_team__workflow_run',
      ]),
    )
  })

  it('exposes workflow_run and falls back to host when explicit workers are blank, disabled, or missing', async () => {
    mockState.agents.set(
      'workflow-host',
      makeAgent({
        id: 'workflow-host',
        name: 'Workflow Host',
        providerProfileId: 'tencent-provider',
        workflowId: 'workflow-fallback',
      }),
    )
    mockState.agents.set(
      'disabled-worker',
      makeAgent({
        id: 'disabled-worker',
        name: 'Disabled Worker',
        enabled: false,
        providerProfileId: 'tencent-provider',
      }),
    )
    mockState.workflows.set('workflow-fallback', {
      id: 'workflow-fallback',
      name: 'Fallback workflow',
      description: 'Run unresolved agent nodes on the host.',
      graph: {
        nodes: [
          { id: 'blank', kind: 'agent', title: 'Blank', config: {} },
          {
            id: 'disabled',
            kind: 'agent',
            title: 'Disabled',
            config: { agentId: 'disabled-worker' },
          },
          { id: 'missing', kind: 'agent', title: 'Missing', config: { agentId: 'missing-worker' } },
        ],
        edges: [],
      },
    })
    const service = new SessionService({} as never, (event) => events.push(event))
    const { sessionId } = await service.createSession({
      providerProfileId: 'tencent-provider',
      agentId: 'workflow-host',
      agentAdapter: 'claude-sdk',
      permissionMode: 'claude-plan',
      title: 'Workflow fallback session',
    })

    await service.sendTurn({ sessionId, message: 'handle without dispatch' })

    await vi.waitFor(() => {
      expect(mockState.sdkConfigs).toHaveLength(1)
    })
    const teamServer = (
      mockState.sdkConfigs[0]?.mcpServers as
        | {
            spark_team?: { instance: { tools: Array<{ name: string }> } }
          }
        | undefined
    )?.spark_team
    expect(teamServer?.instance.tools.map((tool) => tool.name)).toEqual(['workflow_run'])
    expect(mockState.sdkConfigs[0]?.allowedTools).toEqual(
      expect.arrayContaining(['mcp__spark_team__workflow_run']),
    )
    expect(mockState.sdkConfigs[0]?.disallowedTools).not.toEqual(
      expect.arrayContaining(['Edit', 'Write', 'Bash']),
    )
    expect(String(mockState.sdkConfigs[0]?.systemPrompt ?? '')).toContain(
      'call `mcp__spark_team__workflow_run` exactly once with the current user objective',
    )
  })

  it('does not add orchestrator host restrictions when team members do not resolve', async () => {
    mockState.agents.set(
      'host-agent',
      makeAgent({
        id: 'host-agent',
        name: 'Host',
        providerProfileId: 'tencent-provider',
      }),
    )
    mockState.agents.set(
      'worker-1',
      makeAgent({
        id: 'worker-1',
        name: 'Disabled Worker',
        enabled: false,
        providerProfileId: 'tencent-provider',
      }),
    )
    const service = new SessionService({} as never, (event) => events.push(event))
    const { sessionId } = await service.createSession({
      providerProfileId: 'tencent-provider',
      agentAdapter: 'claude-sdk',
      permissionMode: 'claude-plan',
      title: 'Empty team host session',
    })
    const row = mockState.sessions.get(sessionId)
    if (row == null) throw new Error('expected session row')
    row.metadata_json = JSON.stringify({
      team: {
        enabled: true,
        hostAgentId: 'host-agent',
        memberAgentIds: ['worker-1', 'missing-worker'],
      },
    })

    await service.sendTurn({ sessionId, message: 'handle solo fallback', agentId: 'host-agent' })

    await vi.waitFor(() => {
      expect(mockState.sdkConfigs).toHaveLength(1)
    })
    expect(mockState.sdkConfigs[0]?.mcpServers).not.toHaveProperty('spark_team')
    expect(mockState.sdkConfigs[0]?.allowedTools).not.toEqual(
      expect.arrayContaining([
        'mcp__spark_team__agent_dispatch',
        'mcp__spark_team__agent_dispatch_batch',
      ]),
    )
    expect(mockState.sdkConfigs[0]?.disallowedTools).not.toEqual(
      expect.arrayContaining(['Edit', 'Write', 'Bash']),
    )
  })

  it('applies provider and model overrides atomically on send-turn', async () => {
    const service = new SessionService({} as never, (event) => events.push(event))
    const { sessionId } = await service.createSession({
      providerProfileId: 'tencent-provider',
      agentAdapter: 'claude-sdk',
      permissionMode: 'claude-plan',
      title: 'Runtime patch session',
    })

    await service.sendTurn({
      sessionId,
      message: 'send with runtime switch',
      providerProfileId: 'xiaomi-provider',
      modelId: 'mimo-v2.5-pro',
      agentAdapter: 'claude-sdk',
      permissionMode: 'claude-plan',
    })

    await vi.waitFor(() => {
      expect(mockState.sdkConfigs).toHaveLength(1)
    })
    expect(mockState.sdkConfigs[0]).toMatchObject({
      model: 'mimo-v2.5-pro',
      apiEndpoint: 'https://api.example.test/xiaomi/anthropic',
      permissionMode: 'claude-plan',
    })
    expect(mockState.sessions.get(sessionId)).toMatchObject({
      provider_profile_id: 'xiaomi-provider',
      model_id: 'mimo-v2.5-pro',
      agent_adapter: 'claude-sdk',
      permission_mode: 'claude-plan',
    })
  })

  it('keeps an explicit local Codex turn above the selected agent legacy binding', async () => {
    seedProvider({
      id: 'local-codex-cli',
      provider_type: 'openai',
      name: 'Local Codex CLI',
      config_json: JSON.stringify({
        defaultModel: 'codex cli',
        modelIds: ['codex cli'],
      }),
      keystore_ref: null,
      is_default: 0,
    })
    mockState.agents.set(
      'legacy-bound-agent',
      makeAgent({
        id: 'legacy-bound-agent',
        name: 'Legacy Bound Agent',
        providerProfileId: 'tencent-provider',
        modelId: 'glm-5',
      }),
    )
    const service = new SessionService({} as never, (event) => events.push(event))
    const { sessionId } = await service.createSession({
      providerProfileId: 'tencent-provider',
      modelId: 'glm-5',
      agentId: 'legacy-bound-agent',
      agentAdapter: 'claude-sdk',
      permissionMode: 'claude-plan',
      title: 'Explicit runtime provider wins',
    })

    await service.sendTurn({
      sessionId,
      message: 'run with the provider selected for this turn',
      providerProfileId: 'local-codex-cli',
      modelId: 'codex cli',
      agentAdapter: 'codex',
      permissionMode: 'codex-full-access',
    })

    await vi.waitFor(() => expect(mockState.sdkConfigs).toHaveLength(1))
    expect(mockState.sdkConfigs[0]).toMatchObject({
      model: 'codex cli',
      apiKey: '',
      useLocalConfig: true,
      disableCodexNativeSkills: true,
    })
    expect(mockState.sdkConfigs[0]).not.toHaveProperty('apiEndpoint')
    expect(mockState.sdkConfigs[0]).not.toHaveProperty('codexCliProvider')
  })

  it('rejectPlan clears the approval gate and persists a plan_rejected marker on the plan turn', async () => {
    const service = new SessionService({} as never, (event) => events.push(event))
    const { sessionId } = await service.createSession({
      providerProfileId: 'tencent-provider',
      agentAdapter: 'claude-sdk',
      permissionMode: 'claude-plan',
      title: 'Plan reject session',
    })

    // 模拟一个已提交、待审批的计划：写入 plan_proposed 并置 plan 审批闸门。
    const internals = service as unknown as {
      emitAndPersist: (
        sessionId: string,
        turnId: string,
        event: AgentEvent,
        eventRepo: { insert: (p: unknown) => void },
      ) => void
      pendingPlanApprovals: Set<string>
    }
    const eventRepo = {
      nextSeqBySession: () =>
        mockState.events.reduce((max, row) => Math.max(max, row.seq ?? -1), -1) + 1,
      insert: (p: unknown) => {
        const payload = p as {
          id: string
          sessionId: string
          turnId?: string
          eventType: string
          eventJson: string
        }
        mockState.events.push({
          id: payload.id,
          session_id: payload.sessionId,
          run_id: null,
          turn_id: payload.turnId ?? '',
          event_type: payload.eventType,
          event_json: payload.eventJson,
          seq: mockState.events.length,
          created_at: '2026-05-28T00:00:00.000Z',
        })
      },
    }
    internals.emitAndPersist(
      sessionId,
      'turn-plan',
      {
        id: 'plan-1',
        sessionId,
        turnId: 'turn-plan',
        timestamp: '2026-05-28T00:00:01.000Z',
        seq: 0,
        type: 'plan_proposed',
        plan: '# Plan\n\n1. do a thing',
      },
      eventRepo,
    )
    internals.pendingPlanApprovals.add(sessionId)

    const result = service.rejectPlan(sessionId)

    expect(result).toEqual({ rejected: true })
    // 闸门已解除
    expect(internals.pendingPlanApprovals.has(sessionId)).toBe(false)
    // 写入了一条 plan_rejected 事件，且归到计划所在 turn
    const rejected = mockState.events.filter((row) => row.event_type === 'plan_rejected')
    expect(rejected).toHaveLength(1)
    expect(rejected[0]?.turn_id).toBe('turn-plan')
    // 同一份 plan_rejected 也通过事件流回传给 UI
    expect(events).toContainEqual(
      expect.objectContaining({ type: 'plan_rejected', sessionId, turnId: 'turn-plan' }),
    )
  })

  it('rejectPlan returns rejected=false when there is no pending plan', () => {
    const service = new SessionService({} as never, (event) => events.push(event))
    const result = service.rejectPlan('nonexistent-session')
    expect(result).toEqual({ rejected: false })
    expect(mockState.events.filter((row) => row.event_type === 'plan_rejected')).toHaveLength(0)
  })
})

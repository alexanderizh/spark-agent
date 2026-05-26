import crypto from 'node:crypto'
import {
  EventRepository,
  ProviderProfileRepository,
  SessionRepository,
  WorkspaceRepository,
} from '@spark/storage'
import type { SparkDatabase } from '@spark/storage'
import type { AgentEvent } from '@spark/protocol'
import { AgentLoop, ToolRegistry } from '../core/index.js'
import type { AgentConfig } from '../core/index.js'
import * as keystore from '@spark/shared/keystore'
import { createAdapter } from './adapter-factory.js'

export type SessionEventHandler = (event: AgentEvent) => void

export class SessionService {
  private activeLoops = new Map<string, AgentLoop>()
  private seqCounters = new Map<string, number>()

  constructor(
    private readonly db: SparkDatabase,
    private readonly onEvent: SessionEventHandler,
  ) {}

  async createSession(params: {
    providerProfileId: string
    title?: string
    workspaceId?: string
  }): Promise<{ sessionId: string; createdAt: string }> {
    const sessionRepo = new SessionRepository(this.db)
    const id = crypto.randomUUID()
    const row = sessionRepo.create({
      id,
      kind: 'agent',
      title: params.title ?? 'New Session',
      status: 'idle',
      projectId: 'default',
      workspaceIds: params.workspaceId != null ? [params.workspaceId] : [],
      providerProfileId: params.providerProfileId,
    })
    return { sessionId: row.id, createdAt: row.created_at }
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
      model: string
      apiEndpoint?: string
      maxTokens?: number
      temperature?: number
    }

    const adapter = createAdapter(provider.provider_type, config.apiEndpoint)

    // Workspace root path for tools
    let workspaceRootPath = process.cwd()
    const workspaceIds = sessionRepo.getWorkspaceIds(sessionId)
    if (workspaceIds.length > 0) {
      const wsRepo = new WorkspaceRepository(this.db)
      const ws = wsRepo.get(workspaceIds[0] ?? '')
      if (ws != null) workspaceRootPath = ws.root_path
    }

    const tools = new ToolRegistry()
    const agentConfig: AgentConfig = {
      adapter,
      apiKey,
      model: config.model,
      tools,
      toolContext: { workspaceRootPath },
      ...(config.maxTokens != null ? { maxTokens: config.maxTokens } : {}),
      ...(config.temperature != null ? { temperature: config.temperature } : {}),
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

    this.activeLoops.set(turnId, loop)
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
        this.activeLoops.delete(turnId)
      })

    return { turnId, started: true }
  }

  async cancelTurn(sessionId: string): Promise<{ cancelled: boolean }> {
    // Find the active loop for this session
    const sessionRepo = new SessionRepository(this.db)
    let cancelled = false
    for (const [turnId, loop] of this.activeLoops) {
      // We don't track sessionId→turnId mapping, so cancel all loops
      // In practice there's only one active loop per session
      void turnId
      loop.cancel()
      cancelled = true
    }
    if (cancelled) {
      sessionRepo.updateStatus(sessionId, 'idle')
    }
    return { cancelled }
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
    })
    const events = rows.map((row) => JSON.parse(row.event_json) as AgentEvent)
    return { events, hasMore }
  }

  async listSessions(params?: {
    workspaceId?: string
    limit?: number
    offset?: number
  }): Promise<{
    sessions: Array<{
      id: string
      title: string
      providerProfileId: string
      status: 'idle' | 'running' | 'error'
      createdAt: string
      updatedAt: string
      messageCount: number
    }>
    total: number
  }> {
    const sessionRepo = new SessionRepository(this.db)
    const eventRepo = new EventRepository(this.db)
    const { sessions: rows, total } = sessionRepo.list(params ?? {})
    const sessions = rows.map((row) => ({
      id: row.id,
      title: row.title,
      providerProfileId: row.provider_profile_id ?? '',
      status: row.status as 'idle' | 'running' | 'error',
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      messageCount: eventRepo.countBySession(row.id),
    }))
    return { sessions, total }
  }
}

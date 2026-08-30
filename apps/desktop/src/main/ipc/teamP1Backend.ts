import type { TeamP1Mutation, TeamP1Snapshot } from '@spark/protocol'
import { SessionRepository, SteeringGateService, TeamDiscussionRepository, TeamHandoffService } from '@spark/storage'
import type { SparkDatabase, SteeringGateRecord, TeamHandoffRecord } from '@spark/storage'
import { SparkError } from '@spark/shared'

export interface TeamP1BackendDependencies {
  db: SparkDatabase
  sessionRepository?: Pick<SessionRepository, 'get' | 'getMetadata'>
  discussionRepository?: Pick<TeamDiscussionRepository, 'findActiveBySession' | 'listBySession'>
  now?: () => Date
  createOpId?: () => string
}

export class TeamP1Backend {
  private readonly sessions: Pick<SessionRepository, 'get' | 'getMetadata'>
  private readonly discussions: Pick<TeamDiscussionRepository, 'findActiveBySession' | 'listBySession'>
  private readonly now: () => Date
  private readonly createOpId: () => string

  constructor(private readonly dependencies: TeamP1BackendDependencies) {
    this.sessions = dependencies.sessionRepository ?? new SessionRepository(dependencies.db)
    this.discussions = dependencies.discussionRepository ?? new TeamDiscussionRepository(dependencies.db)
    this.now = dependencies.now ?? (() => new Date())
    this.createOpId = dependencies.createOpId ?? (() => crypto.randomUUID())
  }

  getSnapshot(sessionId: string): TeamP1Snapshot {
    const discussion = this.resolveDiscussion(sessionId)
    if (discussion == null) return { sessionId: sessionId as TeamP1Snapshot['sessionId'], discussionId: null, handoffs: [], gates: [], syncedAt: this.now().toISOString() }
    const scope = { sessionId, roomId: `team-room:${sessionId}`, discussionId: discussion.id, actorId: 'desktop-user' }
    return {
      sessionId: sessionId as TeamP1Snapshot['sessionId'], discussionId: discussion.id,
      handoffs: TeamHandoffService.forUser(this.dependencies.db, scope).list(100, 0).items.map(toHandoff),
      gates: SteeringGateService.forUser(this.dependencies.db, scope).list(100, 0).items.map(toGate),
      syncedAt: this.now().toISOString(),
    }
  }

  mutate(request: TeamP1Mutation): TeamP1Snapshot {
    const discussion = this.resolveDiscussion(request.sessionId)
    if (discussion == null) throw new SparkError('VALIDATION_FAILED', '当前团队会话尚未建立讨论。')
    if (discussion.id !== request.expectedDiscussionId) throw new SparkError('CONFLICT', '团队讨论已切换，请刷新后重试。')
    const scope = { sessionId: request.sessionId, roomId: `team-room:${request.sessionId}`, discussionId: discussion.id, actorId: 'desktop-user' }
    // The renderer owns the retry-safe operation identity. Generating it in the
    // main process made an IPC retry append a second audit event.
    const opId = request.opId
    if (request.kind === 'handoff') {
      const service = TeamHandoffService.forUser(this.dependencies.db, scope)
      if (request.action === 'create') service.create({ ...request, opId })
      else {
        const input = { id: request.id, expectedVersion: request.expectedVersion, opId }
        switch (request.action) {
          case 'submit': service.submit(input); break
          case 'accept': service.accept(input); break
          case 'request_clarification': service.requestClarification(input); break
          case 'reject': service.reject(input); break
          case 'complete': service.complete({ ...input,
            ...(request.artifactRefs !== undefined ? { artifactRefs: request.artifactRefs } : {}),
            ...(request.evidenceRefs !== undefined ? { evidenceRefs: request.evidenceRefs } : {}) }); break
          case 'cancel': service.cancel(input); break
        }
      }
    } else {
      const service = SteeringGateService.forUser(this.dependencies.db, scope)
      if (request.action === 'create') service.create({ ...request, opId })
      else {
        const input = { id: request.id, expectedVersion: request.expectedVersion, opId, ...(request.reason !== undefined ? { reason: request.reason } : {}) }
        switch (request.action) {
          case 'approve': service.approve(input); break
          case 'revise': service.revise(input); break
          case 'stop': service.stop(input); break
          case 'expire': service.expire(input); break
        }
      }
    }
    return this.getSnapshot(request.sessionId)
  }

  private resolveDiscussion(sessionId: string) {
    const session = this.sessions.get(sessionId)
    if (session == null) throw new SparkError('NOT_FOUND', '会话不存在或已被删除。')
    const metadata = this.sessions.getMetadata(sessionId)
    const team = isRecord(metadata.team) ? metadata.team : null
    if (team?.enabled !== true) throw new SparkError('VALIDATION_FAILED', '当前会话未启用团队模式。')
    return this.discussions.findActiveBySession(sessionId) ?? this.discussions.listBySession(sessionId, 1)[0] ?? null
  }
}

function toHandoff(record: TeamHandoffRecord) {
  const { sessionId: _sessionId, roomId: _roomId, discussionId: _discussionId, ...publicRecord } = record
  return publicRecord
}
function toGate(record: SteeringGateRecord) {
  const { sessionId: _sessionId, roomId: _roomId, discussionId: _discussionId, ...publicRecord } = record
  return publicRecord
}
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value != null && !Array.isArray(value) }

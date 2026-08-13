import type { DeliberationMutateRequest, DeliberationSnapshot, TaskGraphMutation, TaskGraphSnapshot } from '@spark/protocol'
import { SparkError } from '@spark/shared'
import { DeliberationService, SessionRepository, TaskGraphService, TeamDiscussionRepository } from '@spark/storage'
import type { SparkDatabase } from '@spark/storage'

type Sessions = Pick<SessionRepository, 'get' | 'getMetadata'>
type Discussions = Pick<TeamDiscussionRepository, 'findActiveBySession' | 'listBySession'>

export interface TeamRuntimeBackendDependencies {
  db: SparkDatabase
  sessionRepository?: Sessions
  discussionRepository?: Discussions
  now?: () => Date
}

export class TeamRuntimeBackend {
  private readonly sessions: Sessions
  private readonly discussions: Discussions
  private readonly now: () => Date

  constructor(private readonly dependencies: TeamRuntimeBackendDependencies) {
    this.sessions = dependencies.sessionRepository ?? new SessionRepository(dependencies.db)
    this.discussions = dependencies.discussionRepository ?? new TeamDiscussionRepository(dependencies.db)
    this.now = dependencies.now ?? (() => new Date())
  }

  getTaskGraph(sessionId: string): TaskGraphSnapshot {
    const discussion = this.resolveDiscussion(sessionId)
    if (discussion == null) return { sessionId: sessionId as TaskGraphSnapshot['sessionId'], discussionId: null, nodes: [], edges: [], syncedAt: this.now().toISOString() }
    return TaskGraphService.forUser(this.dependencies.db, this.scope(sessionId, discussion.id)).snapshot() as TaskGraphSnapshot
  }

  mutateTaskGraph(request: TaskGraphMutation): { snapshot: TaskGraphSnapshot } {
    const discussion = this.assertDiscussion(request.sessionId, request.expectedDiscussionId)
    const service = TaskGraphService.forUser(this.dependencies.db, this.scope(request.sessionId, discussion.id))
    try {
      if (request.kind === 'edge') {
        if (request.action !== 'create') throw new SparkError('VALIDATION_FAILED', '不支持的任务边操作。')
        service.createEdge({ id: request.id, fromNodeId: request.fromNodeId, toNodeId: request.toNodeId, type: request.type, opId: request.opId })
      } else if (request.action === 'create') {
        service.createNode({ id: request.id, title: request.title, opId: request.opId,
          ...(request.description !== undefined ? { description: request.description } : {}),
          ...(request.assigneeId !== undefined ? { assigneeId: request.assigneeId } : {}),
          ...(request.inputs !== undefined ? { inputs: request.inputs } : {}),
          ...(request.maxRetries !== undefined ? { maxRetries: request.maxRetries } : {}) })
      } else if (request.action === 'retry') {
        service.retry({ id: request.id, expectedVersion: request.expectedVersion, opId: request.opId })
      } else if (request.action === 'reassign') {
        service.reassign({ id: request.id, expectedVersion: request.expectedVersion, assigneeId: request.assigneeId, opId: request.opId })
      } else {
        service.transition({ id: request.id, expectedVersion: request.expectedVersion, status: request.status, outputs: request.outputs, acceptanceStatus: request.acceptanceStatus, opId: request.opId })
      }
      return { snapshot: service.snapshot() as TaskGraphSnapshot }
    } catch (error) {
      throw mapConflict(error)
    }
  }

  getDeliberation(sessionId: string): DeliberationSnapshot | null {
    const discussion = this.resolveDiscussion(sessionId)
    if (discussion == null) return null
    return DeliberationService.forUser(this.dependencies.db, this.scope(sessionId, discussion.id)).snapshot()
  }

  mutateDeliberation(request: DeliberationMutateRequest): { record: import('@spark/protocol').DeliberationRecord; snapshot: DeliberationSnapshot } {
    const discussion = this.assertDiscussion(request.sessionId, request.expectedDiscussionId)
    const service = DeliberationService.forUser(this.dependencies.db, this.scope(request.sessionId, discussion.id))
    const base = { id: request.id, opId: request.opId, expectedVersion: request.expectedVersion ?? 1 }
    try {
      const record = request.action === 'create'
        ? service.create({ id: request.id, topic: request.topic!, proposal: request.proposal!, opId: request.opId })
        : request.action === 'evidence' || request.action === 'vote'
          ? service.addEvidence({ ...base, evidence: request.action === 'vote' ? { summary: `Vote: ${request.vote?.position}; ${request.vote?.reason}`, sourceRef: request.vote?.sourceRef ?? `vote:${this.scope(request.sessionId, discussion.id).actorId}`, polarity: request.vote?.position === 'oppose' ? 'challenges' : request.vote?.position === 'support' ? 'supports' : 'neutral' } : request.evidence! })
          : request.action === 'alternative'
            ? service.addAlternative({ ...base, alternative: request.alternative! })
            : request.action === 'risk'
              ? service.addRisk({ ...base, risk: request.risk! })
              : request.action === 'decide'
                ? service.decide({ ...base, decision: request.decision! })
                : request.action === 'resolve'
                  ? service.resolve({ ...base, conflictingRecordId: request.conflictingRecordId!, reason: request.reason! })
                  : service.assignOwner({ ...base, ownerId: request.ownerId ?? null, deadline: request.deadline ?? null })
      return { record, snapshot: service.snapshot() }
    } catch (error) { throw mapConflict(error) }
  }

  private scope(sessionId: string, discussionId: string) { return { sessionId, roomId: `team-room:${sessionId}`, discussionId, actorId: 'desktop-user' } }
  private resolveDiscussion(sessionId: string) {
    if (this.sessions.get(sessionId) == null) throw new SparkError('NOT_FOUND', '会话不存在或已被删除。')
    const metadata = this.sessions.getMetadata(sessionId)
    const team = isRecord(metadata.team) ? metadata.team : null
    if (team?.enabled !== true) throw new SparkError('VALIDATION_FAILED', '当前会话未启用团队模式。')
    return this.discussions.findActiveBySession(sessionId) ?? this.discussions.listBySession(sessionId, 1)[0] ?? null
  }
  private assertDiscussion(sessionId: string, expected: string) { const discussion = this.resolveDiscussion(sessionId); if (discussion == null) throw new SparkError('VALIDATION_FAILED', '当前团队会话尚未建立讨论。'); if (discussion.id !== expected) throw new SparkError('CONFLICT', '团队讨论已切换，请刷新后重试。'); return discussion }
}

function mapConflict(error: unknown): unknown { return error instanceof Error && /conflict|version|quota|cycle|not found|retry/i.test(error.message) ? new SparkError('CONFLICT', error.message) : error }
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value != null && !Array.isArray(value) }

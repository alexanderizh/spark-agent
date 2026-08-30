import type {
  PlaybookMutationRequest,
  ReplayDiff,
  ReplayDiffRequest,
  ReplayForkRequest,
  ReplayForkResponse,
  ReplayTimeline,
  ReplayTimelineRequest,
  ReplayTimelineResponse,
} from '../../../../../packages/protocol/src/replay-playbook.js'
import { SparkError } from '@spark/shared'
import { SessionRepository, TeamDiscussionRepository } from '@spark/storage'
import type { SparkDatabase } from '@spark/storage'
import {
  ReplayPlaybookConflictError,
  ReplayPlaybookService,
  type ReplayCapability,
  type ReplayScope,
} from '../../../../../packages/storage/src/replay-playbook.service.js'

export type DesktopPlaybookMutationRequest = Omit<PlaybookMutationRequest, 'action'> & {
  action: 'propose' | 'publish' | 'apply' | 'archive'
}

export interface ReplayPlaybookListRequest {
  sessionId: string
  expectedDiscussionId: string
  id: string
  limit?: number
}

export interface ReplayPlaybookListResponse {
  playbook: ReturnType<ReplayPlaybookService['current']> | null
  versions: ReturnType<ReplayPlaybookService['listVersions']>
  applications: ReturnType<ReplayPlaybookService['listApplications']>
}

export interface TeamReplayPlaybookBackendDependencies {
  db: SparkDatabase
  sessionRepository?: Pick<SessionRepository, 'get' | 'getMetadata'>
  discussionRepository?: Pick<TeamDiscussionRepository, 'findActiveBySession' | 'listBySession'>
  actorId?: string
  capability?: ReplayCapability
}

/** Main-process boundary for discussion-scoped replay and playbook operations. */
export class TeamReplayPlaybookBackend {
  private readonly sessions: Pick<SessionRepository, 'get' | 'getMetadata'>
  private readonly discussions: Pick<TeamDiscussionRepository, 'findActiveBySession' | 'listBySession'>
  private readonly actorId: string
  private readonly capability: ReplayCapability

  constructor(private readonly dependencies: TeamReplayPlaybookBackendDependencies) {
    this.sessions = dependencies.sessionRepository ?? new SessionRepository(dependencies.db)
    this.discussions = dependencies.discussionRepository ?? new TeamDiscussionRepository(dependencies.db)
    this.actorId = dependencies.actorId ?? 'desktop-user'
    this.capability = dependencies.capability ?? 'user'
  }

  getTimeline(request: ReplayTimelineRequest): ReplayTimelineResponse {
    const discussion = this.assertDiscussion(request.sessionId, request.expectedDiscussionId)
    try {
      const timeline = this.service(request.sessionId, discussion.id).timeline({
        ...(request.cursor !== undefined ? { cursor: request.cursor } : {}),
        ...(request.limit !== undefined ? { limit: request.limit } : {}),
      })
      return { timeline }
    } catch (error) {
      throw mapReplayError(error)
    }
  }

  getDiff(request: ReplayDiffRequest): ReplayDiff {
    const discussion = this.assertDiscussion(request.sessionId, request.expectedDiscussionId)
    try {
      return this.service(request.sessionId, discussion.id).diff({
        fromSeq: request.fromSeq,
        toSeq: request.toSeq,
        ...(request.limit !== undefined ? { limit: request.limit } : {}),
      })
    } catch (error) {
      throw mapReplayError(error)
    }
  }

  fork(request: ReplayForkRequest): ReplayForkResponse {
    const discussion = this.assertDiscussion(request.sessionId, request.expectedDiscussionId)
    try {
      const result = this.service(request.sessionId, discussion.id).fork({
        branchId: request.branchId,
        sourceSeq: request.sourceSeq,
        reason: request.reason,
        ...(request.expectedVersion !== undefined ? { expectedVersion: request.expectedVersion } : {}),
        opId: request.opId,
      })
      return result
    } catch (error) {
      throw mapReplayError(error)
    }
  }

  listPlaybook(request: ReplayPlaybookListRequest): ReplayPlaybookListResponse {
    const discussion = this.assertDiscussion(request.sessionId, request.expectedDiscussionId)
    try {
      const service = this.service(request.sessionId, discussion.id)
      return {
        playbook: service.current(request.id) ?? null,
        versions: service.listVersions(request.id, request.limit),
        applications: service.listApplications(request.id, request.limit),
      }
    } catch (error) {
      throw mapReplayError(error)
    }
  }

  mutate(request: DesktopPlaybookMutationRequest): { playbook: ReturnType<ReplayPlaybookService['current']>; appliedDiscussionId?: string; applicationId?: string } {
    const discussion = this.assertDiscussion(request.sessionId, request.expectedDiscussionId)
    const service = this.service(request.sessionId, discussion.id)
    try {
      if (request.action === 'propose') {
        const playbook = service.propose({
          id: request.id,
          name: request.name!,
          graph: request.graph,
          roles: request.roles,
          handoffRules: request.handoffRules,
          gateRules: request.gateRules,
          deliberationRules: request.deliberationRules,
          ...(request.expectedVersion !== undefined ? { expectedVersion: request.expectedVersion } : {}),
          opId: request.opId,
        })
        return { playbook }
      }

      if (request.action === 'publish') {
        return { playbook: service.publish({ id: request.id, expectedVersion: request.expectedVersion!, opId: request.opId }) }
      }

      if (request.action === 'archive') {
        return { playbook: service.archive({ id: request.id, expectedVersion: request.expectedVersion!, opId: request.opId }) }
      }

      const result = service.apply({
        id: request.id,
        expectedVersion: request.expectedVersion!,
        targetDiscussionId: request.targetDiscussionId!,
        opId: request.opId,
      })
      return result
    } catch (error) {
      throw mapReplayError(error)
    }
  }

  private service(sessionId: string, discussionId: string): ReplayPlaybookService {
    const scope: ReplayScope = {
      sessionId,
      roomId: `team-room:${sessionId}`,
      discussionId,
      actorId: this.actorId,
    }
    if (this.capability === 'agent') return ReplayPlaybookService.forAgent(this.dependencies.db, scope)
    if (this.capability === 'system') return ReplayPlaybookService.forSystem(this.dependencies.db, scope)
    return ReplayPlaybookService.forUser(this.dependencies.db, scope)
  }

  private assertDiscussion(sessionId: string, expectedDiscussionId: string) {
    if (this.sessions.get(sessionId) == null) throw new SparkError('NOT_FOUND', '会话不存在或已被删除。')
    const metadata = this.sessions.getMetadata(sessionId)
    const team = isRecord(metadata.team) ? metadata.team : null
    if (team?.enabled !== true) throw new SparkError('VALIDATION_FAILED', '当前会话未启用团队模式。')
    const discussion = this.discussions.findActiveBySession(sessionId) ?? this.discussions.listBySession(sessionId, 1)[0] ?? null
    if (discussion == null) throw new SparkError('VALIDATION_FAILED', '当前团队会话尚未建立讨论。')
    if (discussion.id !== expectedDiscussionId) throw new SparkError('CONFLICT', '团队讨论已切换，请刷新后重试。')
    return discussion
  }
}

function mapReplayError(error: unknown): unknown {
  if (error instanceof ReplayPlaybookConflictError) return new SparkError('CONFLICT', error.message)
  return error
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value != null && !Array.isArray(value)
}

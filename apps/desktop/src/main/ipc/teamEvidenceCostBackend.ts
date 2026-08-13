import { SparkError } from '@spark/shared'
import { SessionRepository, TeamDiscussionRepository } from '@spark/storage'
import type { SparkDatabase } from '@spark/storage'
import { EvidenceCostConflictError, EvidenceCostService } from '../../../../../packages/storage/src/evidence-cost.service.js'
import type { CostEvent, EvidenceCostSnapshot, EvidenceRecord } from '../../../../../packages/protocol/src/evidence-cost.js'

export type EvidenceCostMutation =
  | { sessionId: string; expectedDiscussionId: string; opId: string; kind: 'evidence'; action: 'add'; id: string; claim: string; links: EvidenceRecord['links']; source: EvidenceRecord['source']; version?: string | null; summary: string; hash?: string | null }
  | { sessionId: string; expectedDiscussionId: string; opId: string; kind: 'evidence'; action: 'verify' | 'invalidate'; id: string; expectedVersion: number; reason?: string }
  | { sessionId: string; expectedDiscussionId: string; opId: string; kind: 'usage'; action: 'record'; id: string; taskId?: string | null; agentId?: string | null; dispatchId?: string | null; tokens?: number | null; amount?: number | null; currency?: string | null; latencyMs?: number | null; status: CostEvent['status']; source?: string | null }
  | { sessionId: string; expectedDiscussionId: string; opId: string; kind: 'budget'; action: 'set'; expectedVersion: number; tokens?: number | null; amount?: number | null; currency?: string | null }

export interface TeamEvidenceCostBackendDependencies {
  db: SparkDatabase
  sessionRepository?: Pick<SessionRepository, 'get' | 'getMetadata'>
  discussionRepository?: Pick<TeamDiscussionRepository, 'findActiveBySession' | 'listBySession'>
  now?: () => Date
}

export class TeamEvidenceCostBackend {
  private readonly sessions: Pick<SessionRepository, 'get' | 'getMetadata'>
  private readonly discussions: Pick<TeamDiscussionRepository, 'findActiveBySession' | 'listBySession'>
  private readonly now: () => Date

  constructor(private readonly dependencies: TeamEvidenceCostBackendDependencies) {
    this.sessions = dependencies.sessionRepository ?? new SessionRepository(dependencies.db)
    this.discussions = dependencies.discussionRepository ?? new TeamDiscussionRepository(dependencies.db)
    this.now = dependencies.now ?? (() => new Date())
  }

  getSnapshot(sessionId: string, expectedDiscussionId: string): EvidenceCostSnapshot {
    const discussion = this.resolveDiscussion(sessionId)
    if (discussion == null || discussion.id !== expectedDiscussionId) throw new SparkError('CONFLICT', '团队讨论已切换，请刷新后重试。')
    return this.snapshot(sessionId, discussion.id)
  }

  mutate(request: EvidenceCostMutation): EvidenceCostSnapshot {
    const discussion = this.resolveDiscussion(request.sessionId)
    if (discussion == null || discussion.id !== request.expectedDiscussionId) throw new SparkError('CONFLICT', '团队讨论已切换，请刷新后重试。')
    const service = EvidenceCostService.forUser(this.dependencies.db, this.scope(request.sessionId, discussion.id))
    try {
      if (request.kind === 'evidence') {
        if (request.action === 'add') service.addEvidence({ id: request.id, claim: request.claim, links: request.links, source: request.source, summary: request.summary, opId: request.opId,
          ...(request.version !== undefined ? { version: request.version } : {}),
          ...(request.hash !== undefined ? { hash: request.hash } : {}),
        })
        else if (request.action === 'verify') service.verifyEvidence({ id: request.id, expectedVersion: request.expectedVersion, opId: request.opId })
        else service.invalidateEvidence({ id: request.id, expectedVersion: request.expectedVersion, reason: request.reason ?? '未提供原因', opId: request.opId })
      } else if (request.kind === 'usage') {
        service.recordUsage({ ...request, opId: request.opId })
      } else {
        service.setBudget({ ...request, opId: request.opId })
      }
      return this.snapshot(request.sessionId, discussion.id)
    } catch (error) {
      if (error instanceof EvidenceCostConflictError) throw new SparkError('CONFLICT', error.message)
      throw error
    }
  }

  private snapshot(sessionId: string, discussionId: string): EvidenceCostSnapshot {
    const service = EvidenceCostService.forUser(this.dependencies.db, this.scope(sessionId, discussionId))
    const budget = service.budget()
    return { sessionId, roomId: `team-room:${sessionId}`, discussionId, evidence: service.listEvidence(100), costs: service.listCosts(100), aggregates: service.aggregate(), budgetTokens: budget?.tokens ?? null, budgetAmount: budget?.amount ?? null, budgetCurrency: budget?.currency ?? null, syncedAt: this.now().toISOString() }
  }

  private scope(sessionId: string, discussionId: string) { return { sessionId, roomId: `team-room:${sessionId}`, discussionId, actorId: 'desktop-user' } }

  private resolveDiscussion(sessionId: string) {
    if (this.sessions.get(sessionId) == null) throw new SparkError('NOT_FOUND', '会话不存在或已被删除。')
    const metadata = this.sessions.getMetadata(sessionId)
    const team = isRecord(metadata.team) ? metadata.team : null
    if (team?.enabled !== true) throw new SparkError('VALIDATION_FAILED', '当前会话未启用团队模式。')
    return this.discussions.findActiveBySession(sessionId) ?? this.discussions.listBySession(sessionId, 1)[0] ?? null
  }
}

function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value != null && !Array.isArray(value) }

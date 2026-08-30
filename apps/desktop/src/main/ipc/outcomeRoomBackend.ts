import type {
  OutcomeRoomMutateRequest,
  OutcomeRoomMutateResponse,
  OutcomeRoomRecord,
  OutcomeRoomSnapshot,
} from '@spark/protocol'
import { boundedLedgerJson, inspectLedgerJson } from '@spark/protocol'
import {
  RoomLedgerService,
  SessionRepository,
  TeamDiscussionRepository,
  type RoomLedgerRecord,
  type TeamDiscussionRow,
} from '@spark/storage'
import { RoomLedgerConflictError } from '@spark/storage'
import { SparkError } from '@spark/shared'
import type { SparkDatabase } from '@spark/storage'

type SessionScopeRepository = Pick<SessionRepository, 'get' | 'getMetadata'>
type DiscussionScopeRepository = Pick<
  TeamDiscussionRepository,
  'findActiveBySession' | 'listBySession'
>
type UserLedgerService = Pick<
  RoomLedgerService,
  'getCurrentProjection' | 'confirm' | 'reject' | 'correct' | 'invalidate' | 'restore'
>

export interface OutcomeRoomBackendDependencies {
  sessionRepository: SessionScopeRepository
  discussionRepository: DiscussionScopeRepository
  ledger: UserLedgerService
  now?: () => Date
  createOpId?: () => string
}

export class OutcomeRoomBackend {
  private readonly now: () => Date
  private readonly createOpId: () => string

  constructor(private readonly dependencies: OutcomeRoomBackendDependencies) {
    this.now = dependencies.now ?? (() => new Date())
    this.createOpId = dependencies.createOpId ?? (() => crypto.randomUUID())
  }

  static create(db: SparkDatabase): OutcomeRoomBackend {
    return new OutcomeRoomBackend({
      sessionRepository: new SessionRepository(db),
      discussionRepository: new TeamDiscussionRepository(db),
      ledger: RoomLedgerService.forUser(db, 'desktop-user'),
    })
  }

  async getSnapshot(sessionId: string): Promise<OutcomeRoomSnapshot> {
    const discussion = this.resolveScope(sessionId)
    const roomId = roomIdForSession(sessionId)
    const records = discussion == null
      ? []
      : this.dependencies.ledger
          .getCurrentProjection(roomId, discussion.id, 100)
          .filter((record) => record.discussionId === discussion.id)
          .map(toIpcRecord)
    return {
      sessionId: sessionId as OutcomeRoomSnapshot['sessionId'],
      discussion: toIpcDiscussion(discussion),
      records,
      syncedAt: this.now().toISOString(),
    }
  }

  async mutate(request: OutcomeRoomMutateRequest): Promise<OutcomeRoomMutateResponse> {
    const discussion = this.resolveScope(request.sessionId)
    if (discussion == null) {
      throw new SparkError('VALIDATION_FAILED', '当前团队会话尚未建立讨论，无法治理账本。')
    }
    if (discussion.id !== request.expectedDiscussionId) {
      throw new SparkError('CONFLICT', '团队讨论已切换，请刷新后重试。')
    }
    const input = {
      roomId: roomIdForSession(request.sessionId),
      discussionId: discussion.id,
      expectedSessionId: request.sessionId,
      expectedDiscussionId: request.expectedDiscussionId,
      expectedRecordId: request.expectedRecordId,
      logicalKey: request.logicalKey,
      expectedVersion: request.expectedVersion,
      opId: this.createOpId(),
      authority: 'user-confirmed' as const,
      ...(request.action === 'restore' ? { expiresAt: null } : {}),
      ...(request.value !== undefined ? { value: request.value } : {}),
      ...(request.reason !== undefined ? { reason: request.reason } : {}),
    }
    try {
      const record = this.dependencies.ledger[request.action](input)
      return { record: toIpcRecord(record), snapshot: await this.getSnapshot(request.sessionId) }
    } catch (error) {
      if (error instanceof RoomLedgerConflictError) {
        throw new SparkError('CONFLICT', '账本已被其他成员更新，请刷新后重试。')
      }
      throw error
    }
  }

  private resolveScope(sessionId: string) {
    if (this.dependencies.sessionRepository.get(sessionId) == null) {
      throw new SparkError('NOT_FOUND', '会话不存在或已被删除。')
    }
    const metadata = this.dependencies.sessionRepository.getMetadata(sessionId)
    const team = isRecord(metadata.team) ? metadata.team : null
    if (team?.enabled !== true) {
      throw new SparkError('VALIDATION_FAILED', '当前会话未启用团队模式。')
    }
    return (
      this.dependencies.discussionRepository.findActiveBySession(sessionId) ??
      this.dependencies.discussionRepository.listBySession(sessionId, 1)[0] ??
      null
    )
  }
}

function roomIdForSession(sessionId: string): string {
  return `team-room:${sessionId}`
}

function toIpcRecord(record: RoomLedgerRecord): OutcomeRoomRecord {
  if (record.status === 'superseded' || record.status === 'conflict') {
    throw new SparkError('VALIDATION_FAILED', '账本当前投影包含不可展示状态。')
  }
  return {
    id: record.id,
    logicalKey: record.logicalKey,
    value: inspectLedgerJson(record.value) == null ? record.value : boundedLedgerJson(record.value, 1_200),
    status: record.status,
    authority: record.authority,
    confidence: record.confidence,
    sourceRefs: record.sourceRefs.slice(0, 10).map((source) => clipText(source, 300)),
    version: record.version,
    updatedBy: clipText(record.updatedBy, 160),
    updatedAt: record.updatedAt,
    expiresAt: record.expiresAt,
    reason: record.reason == null ? null : clipText(record.reason, 1_000),
  }
}

function clipText(value: string, maxChars: number): string {
  return value.length <= maxChars ? value : `${value.slice(0, Math.max(0, maxChars - 1))}…`
}

function toIpcDiscussion(discussion: TeamDiscussionRow | null) {
  if (discussion == null) return null
  return {
    id: discussion.id,
    state: discussion.state,
    topic: discussion.topic,
    roundIndex: discussion.round_index,
    maxRounds: discussion.max_rounds,
    startedAt: discussion.started_at,
    endedAt: discussion.ended_at,
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value != null && !Array.isArray(value)
}

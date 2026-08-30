import { randomUUID } from 'crypto'
import type { SparkDatabase } from './database.js'
import { RoomLedgerRepository, type RoomLedgerAuthority, type RoomLedgerEvent, type RoomLedgerOperation, type RoomLedgerRecord, type RoomLedgerStatus } from './repositories/room-ledger.repository.js'

export const ROOM_LEDGER_MAX_CURRENT_KEYS = 100

const AUTHORITY_RANK: Record<RoomLedgerAuthority, number> = {
  'agent-inferred': 0,
  'system-observed': 1,
  'user-confirmed': 2,
}

export class RoomLedgerConflictError extends Error {
  constructor(message: string) { super(message); this.name = 'RoomLedgerConflictError' }
}

interface RoomLedgerActorContext {
  actorId: string
  authority: RoomLedgerAuthority
}

export interface RoomLedgerServiceOptions {
  now?: () => Date
  /** Test-only seam for exercising replay against an append made after replay starts. */
  beforeReplayTransaction?: () => void
}

export interface RoomLedgerMutationInput {
  roomId: string; discussionId?: string; logicalKey: string; value?: unknown; status?: Extract<RoomLedgerStatus, 'proposed' | 'active'>; authority?: RoomLedgerAuthority; confidence?: number; sourceRefs?: string[]; opId: string; expectedVersion?: number; expectedRecordId?: string; expectedSessionId?: string; expectedDiscussionId?: string; expiresAt?: string | null; reason?: string
}

export class RoomLedgerService {
  private readonly repository: RoomLedgerRepository
  private readonly now: () => Date
  private readonly actor: RoomLedgerActorContext
  private readonly beforeReplayTransaction: (() => void) | undefined

  private constructor(db: SparkDatabase, actor: RoomLedgerActorContext, options: RoomLedgerServiceOptions = {}) {
    this.repository = new RoomLedgerRepository(db)
    this.now = options.now ?? (() => new Date())
    this.beforeReplayTransaction = options.beforeReplayTransaction
    this.actor = actor
  }

  static forAgent(db: SparkDatabase, actorId = 'agent', options: RoomLedgerServiceOptions = {}): RoomLedgerService { return new RoomLedgerService(db, { actorId, authority: 'agent-inferred' }, options) }
  static forSystem(db: SparkDatabase, actorId = 'system', options: RoomLedgerServiceOptions = {}): RoomLedgerService { return new RoomLedgerService(db, { actorId, authority: 'system-observed' }, options) }
  static forUser(db: SparkDatabase, actorId = 'user', options: RoomLedgerServiceOptions = {}): RoomLedgerService { return new RoomLedgerService(db, { actorId, authority: 'user-confirmed' }, options) }

  create(input: RoomLedgerMutationInput): RoomLedgerRecord { return this.mutate('create', input, input.status ?? 'active') }
  replace(input: RoomLedgerMutationInput): RoomLedgerRecord { return this.mutate('replace', input, 'active') }
  correct(input: RoomLedgerMutationInput): RoomLedgerRecord { return this.mutate('correct', input, 'active') }
  invalidate(input: RoomLedgerMutationInput): RoomLedgerRecord { return this.mutate('invalidate', input, 'invalid') }
  tombstone(input: RoomLedgerMutationInput): RoomLedgerRecord { return this.mutate('tombstone', input, 'deleted') }

  confirm(input: RoomLedgerMutationInput): RoomLedgerRecord { return this.mutate('confirm', input, 'active') }
  reject(input: RoomLedgerMutationInput): RoomLedgerRecord { return this.mutate('reject', input, 'rejected') }
  expire(input: RoomLedgerMutationInput): RoomLedgerRecord { return this.mutate('expire', input, 'expired') }
  restore(input: RoomLedgerMutationInput): RoomLedgerRecord { return this.mutate('restore', input, 'active') }

  getActiveContext(roomId: string, discussionId?: string, limit = ROOM_LEDGER_MAX_CURRENT_KEYS): RoomLedgerRecord[] { return this.repository.listCurrent(roomId, discussionId, this.now().toISOString(), limit) }
  getCurrentProjection(roomId: string, discussionId: string, limit = 100): RoomLedgerRecord[] { return this.repository.listCurrentProjection(roomId, discussionId, limit) }
  listHistory(roomId: string, logicalKey?: string): RoomLedgerRecord[] { return this.repository.listHistory(roomId, undefined, logicalKey) }
  listDiscussionHistory(roomId: string, discussionId: string, logicalKey?: string): RoomLedgerRecord[] { return this.repository.listHistory(roomId, discussionId, logicalKey) }
  listEvents(roomId: string, discussionId?: string): RoomLedgerEvent[] { return this.repository.listEvents(roomId, discussionId) }
  deleteRoom(roomId: string): number { return this.repository.deleteByRoom(roomId) }

  replay(roomId: string): void {
    this.beforeReplayTransaction?.()
    this.repository.transact((tx) => {
      tx.clearProjection(roomId)
      for (const event of tx.listEvents(roomId)) tx.rebuild(event)
    })
  }

  private mutate(operation: RoomLedgerOperation, input: RoomLedgerMutationInput, status: RoomLedgerStatus): RoomLedgerRecord {
    const actor = this.actor
    const prior = this.repository.findByOpId(input.opId)
    if (prior) {
      assertLedgerReplayMatches(prior, operation, input, status, actor.authority)
      return prior.record
    }
    return this.repository.transact((tx) => {
      const concurrent = tx.findByOpId(input.opId)
      if (concurrent) {
        assertLedgerReplayMatches(concurrent, operation, input, status, actor.authority)
        return concurrent.record
      }
      if (input.expectedSessionId != null && input.expectedDiscussionId != null) {
        const scopedDiscussionId = tx.resolveDiscussionScope(input.expectedSessionId)
        if (scopedDiscussionId !== input.expectedDiscussionId) throw new RoomLedgerConflictError(`Expected discussion ${input.expectedDiscussionId}, current discussion is ${scopedDiscussionId ?? 'none'}`)
      }
      const discussionId = input.discussionId ?? input.expectedDiscussionId ?? null
      const current = this.repository.findCurrent(input.roomId, discussionId, input.logicalKey)
      if (operation === 'create' && current) throw new RoomLedgerConflictError(`Ledger key already exists: ${input.logicalKey}`)
      if (operation === 'create' && tx.countCurrentKeys(input.roomId, discussionId) >= ROOM_LEDGER_MAX_CURRENT_KEYS) throw new RoomLedgerConflictError(`Ledger current key quota exceeded: limit ${ROOM_LEDGER_MAX_CURRENT_KEYS} per discussion`)
      if (operation !== 'create' && !current) throw new RoomLedgerConflictError(`Ledger key does not exist: ${input.logicalKey}`)
      if (input.expectedVersion !== undefined && current?.version !== input.expectedVersion) throw new RoomLedgerConflictError(`Expected version ${input.expectedVersion}, current version is ${current?.version ?? 0}`)
      if (input.expectedRecordId !== undefined && current?.id !== input.expectedRecordId) throw new RoomLedgerConflictError(`Expected record ${input.expectedRecordId}, current record is ${current?.id ?? 'none'}`)
      if (input.expectedDiscussionId !== undefined && current?.discussionId !== input.expectedDiscussionId) throw new RoomLedgerConflictError(`Expected record discussion ${input.expectedDiscussionId}, current record discussion is ${current?.discussionId ?? 'none'}`)
      this.assertTransition(operation, current?.status)
      if (current != null && AUTHORITY_RANK[current.authority] > AUTHORITY_RANK[actor.authority]) throw new RoomLedgerConflictError(`${actor.authority} capability cannot overwrite ${current.authority} record`)

      const now = this.now().toISOString()
      const record: RoomLedgerRecord = { id: randomUUID(), roomId: input.roomId, discussionId, logicalKey: input.logicalKey, value: input.value ?? current?.value ?? null, status, authority: actor.authority, confidence: input.confidence ?? current?.confidence ?? 0, sourceRefs: input.sourceRefs ?? current?.sourceRefs ?? [], version: (current?.version ?? 0) + 1, createdBy: actor.actorId, createdAt: now, updatedBy: actor.actorId, updatedAt: now, expiresAt: Object.prototype.hasOwnProperty.call(input, 'expiresAt') ? input.expiresAt! : (current?.expiresAt ?? null), supersedes: current?.id ?? null, reason: input.reason ?? null }
      const event: RoomLedgerEvent = { id: randomUUID(), roomId: record.roomId, discussionId: record.discussionId, logicalKey: record.logicalKey, opId: input.opId, operation, recordId: record.id, previousRecordId: current?.id ?? null, record, actorId: actor.actorId, createdAt: now }
      tx.append(event)
      return record
    })
  }

  private assertTransition(operation: RoomLedgerOperation, current?: RoomLedgerStatus): void {
    if (operation === 'create') return
    const allowed: Record<Exclude<RoomLedgerOperation, 'create' | 'replace' | 'correct' | 'invalidate' | 'tombstone'> | 'replace' | 'correct' | 'invalidate' | 'tombstone', RoomLedgerStatus[]> = {
      replace: ['active', 'proposed'], correct: ['active', 'proposed'], invalidate: ['active', 'proposed'], tombstone: ['active', 'proposed', 'rejected', 'invalid', 'expired'],
      confirm: ['proposed'], reject: ['proposed'], expire: ['active', 'proposed'], restore: ['rejected', 'invalid', 'expired', 'deleted'],
    }
    if (!current || !allowed[operation].includes(current)) throw new RoomLedgerConflictError(`Illegal ledger transition: ${current ?? 'none'} -> ${operation}`)
  }
}

function assertLedgerReplayMatches(event: RoomLedgerEvent, operation: RoomLedgerOperation, input: RoomLedgerMutationInput, status: RoomLedgerStatus, authority: RoomLedgerAuthority): void {
  const expectedDiscussionId = input.discussionId ?? input.expectedDiscussionId ?? null
  if (event.operation !== operation || event.roomId !== input.roomId || event.discussionId !== expectedDiscussionId || event.logicalKey !== input.logicalKey) {
    throw new RoomLedgerConflictError(`opId conflicts with another ledger scope, target, or operation: ${input.opId}`)
  }
  const record = event.record
  if (record.status !== status || record.authority !== authority) {
    throw new RoomLedgerConflictError(`opId conflicts with a different ledger payload: ${input.opId}`)
  }
  if (Object.prototype.hasOwnProperty.call(input, 'value') && !sameJson(record.value, input.value)) throw new RoomLedgerConflictError(`opId conflicts with a different ledger value: ${input.opId}`)
  if (input.confidence !== undefined && record.confidence !== input.confidence) throw new RoomLedgerConflictError(`opId conflicts with a different ledger confidence: ${input.opId}`)
  if (input.sourceRefs !== undefined && !sameJson(record.sourceRefs, input.sourceRefs)) throw new RoomLedgerConflictError(`opId conflicts with different ledger source refs: ${input.opId}`)
  if (input.expectedVersion !== undefined && record.version - 1 !== input.expectedVersion) throw new RoomLedgerConflictError(`opId conflicts with a different ledger expected version: ${input.opId}`)
  if (input.expectedRecordId !== undefined && event.previousRecordId !== input.expectedRecordId) throw new RoomLedgerConflictError(`opId conflicts with a different ledger expected record: ${input.opId}`)
  if (Object.prototype.hasOwnProperty.call(input, 'expiresAt') && record.expiresAt !== input.expiresAt) throw new RoomLedgerConflictError(`opId conflicts with a different ledger expiry: ${input.opId}`)
  if (input.reason !== undefined && record.reason !== input.reason) throw new RoomLedgerConflictError(`opId conflicts with a different ledger reason: ${input.opId}`)
}

function sameJson(left: unknown, right: unknown): boolean {
  if (Array.isArray(left)) return Array.isArray(right) && left.length === right.length && left.every((item, index) => sameJson(item, right[index]))
  if (left != null && typeof left === 'object') {
    if (right == null || typeof right !== 'object' || Array.isArray(right)) return false
    const leftEntries = Object.entries(left as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b))
    const rightEntries = Object.entries(right as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b))
    return leftEntries.length === rightEntries.length && leftEntries.every(([key, value], index) => rightEntries[index]?.[0] === key && sameJson(value, rightEntries[index]?.[1]))
  }
  return Object.is(left, right)
}

import { randomUUID } from 'node:crypto'
import type { SparkDatabase } from './database.js'

export type DeliberationCapability = 'agent' | 'system' | 'user'
export type DeliberationProposalPosition = 'support' | 'oppose' | 'conditional'
export type DeliberationDecisionOutcome = 'approved' | 'rejected' | 'conditional'
export type DeliberationStatus = 'proposed' | 'decided' | 'conflicted' | 'superseded'
export type DeliberationOperation = 'create' | 'evidence' | 'alternative' | 'risk' | 'decide' | 'resolve' | 'owner'

export interface DeliberationScope {
  sessionId: string
  roomId: string
  discussionId: string
  actorId: string
}

export interface DeliberationEvidence {
  id: string
  summary: string
  sourceRef: string
  polarity: 'supports' | 'challenges' | 'neutral'
}

export interface DeliberationAlternative {
  id: string
  title: string
  summary: string
  tradeoffs: string[]
}

export interface DeliberationRisk {
  id: string
  title: string
  severity: 'low' | 'medium' | 'high' | 'critical'
  mitigation: string
}

export interface DeliberationProposal {
  claim: string
  position: DeliberationProposalPosition
  rationale: string
}

export interface DeliberationLedgerWrite {
  logicalKey: string
  value: unknown
  reason: string
}

export interface DeliberationDecision {
  outcome: DeliberationDecisionOutcome
  reason: string
  resolverId: string
  resolvedAt: string
  ledgerWrite: DeliberationLedgerWrite | null
}

export interface DeliberationConflict {
  id: string
  topic: string
  recordIds: string[]
  reason: string
  resolvedBy: string | null
  resolvedAt: string | null
}

export interface DeliberationRecord {
  id: string
  sessionId: string
  roomId: string
  discussionId: string
  topic: string
  proposal: DeliberationProposal
  evidence: DeliberationEvidence[]
  alternatives: DeliberationAlternative[]
  risks: DeliberationRisk[]
  decision: DeliberationDecision | null
  ownerId: string | null
  deadline: string | null
  status: DeliberationStatus
  capability: DeliberationCapability
  conflict: DeliberationConflict | null
  version: number
  createdAt: string
  updatedAt: string
}

export interface DeliberationAuditEvent {
  id: string
  deliberationId: string
  operation: DeliberationOperation
  actorId: string
  capability: DeliberationCapability
  request: Record<string, unknown>
  record: DeliberationRecord
  createdAt: string
}

export interface DeliberationSnapshot {
  sessionId: string
  discussionId: string
  records: DeliberationRecord[]
  conflicts: DeliberationConflict[]
  syncedAt: string
}

export interface DeliberationLedgerWriter {
  write(input: DeliberationLedgerWrite & {
    sessionId: string
    roomId: string
    discussionId: string
    deliberationId: string
    opId: string
  }): void
}

export interface DeliberationServiceOptions {
  /** Optional integration seam. Storage persists the contract before invoking it. */
  ledgerWriter?: DeliberationLedgerWriter
}

interface CreateInput {
  id: string
  topic: string
  proposal: DeliberationProposal
  opId: string
}

interface VersionedInput {
  id: string
  expectedVersion: number
  opId: string
}

interface EventPayload {
  record: DeliberationRecord
  request: Record<string, unknown>
}

type DeliberationRow = {
  id: string
  session_id: string
  room_id: string
  discussion_id: string
  topic: string
  proposal_json: string
  evidence_json: string
  alternatives_json: string
  risks_json: string
  decision_json: string | null
  owner_id: string | null
  deadline: string | null
  status: DeliberationStatus
  capability: DeliberationCapability
  conflict_json: string | null
  version: number
  created_at: string
  updated_at: string
}

type ConflictRow = {
  id: string
  session_id: string
  room_id: string
  discussion_id: string
  topic: string
  record_ids_json: string
  reason: string
  resolved_by: string | null
  resolved_at: string | null
  created_at: string
  updated_at: string
}

type EventRow = {
  id: string
  session_id: string
  room_id: string
  discussion_id: string
  deliberation_id: string
  op_id: string
  operation: DeliberationOperation
  actor_id: string
  capability: DeliberationCapability
  request_json: string
  record_json: string
  created_at: string
}

export const DELIBERATION_MAX_PER_DISCUSSION = 100
const MAX_TEXT = 4_000
const MAX_ID = 160
const MAX_JSON_BYTES = 12_000
const MAX_JSON_DEPTH = 8
const MAX_JSON_NODES = 160

export class DeliberationConflictError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DeliberationConflictError'
  }
}

export class DeliberationService {
  private constructor(
    private readonly db: SparkDatabase,
    private readonly scope: DeliberationScope,
    private readonly capability: DeliberationCapability,
    private readonly options: DeliberationServiceOptions = {},
  ) {}

  static forAgent(db: SparkDatabase, scope: DeliberationScope, options?: DeliberationServiceOptions): DeliberationService {
    return new DeliberationService(db, scope, 'agent', options)
  }

  static forSystem(db: SparkDatabase, scope: DeliberationScope, options?: DeliberationServiceOptions): DeliberationService {
    return new DeliberationService(db, scope, 'system', options)
  }

  static forUser(db: SparkDatabase, scope: DeliberationScope, options?: DeliberationServiceOptions): DeliberationService {
    return new DeliberationService(db, scope, 'user', options)
  }

  create(input: CreateInput): DeliberationRecord {
    assertId(input.id)
    assertText(input.topic, 'topic')
    assertProposal(input.proposal)
    const request = { id: input.id, topic: input.topic, proposal: input.proposal }
    return this.mutate('create', input.opId, input.id, request, () => {
      if (this.countScoped() >= DELIBERATION_MAX_PER_DISCUSSION) {
        throw new DeliberationConflictError(`Deliberation quota exceeded: limit ${DELIBERATION_MAX_PER_DISCUSSION}`)
      }
      const now = new Date().toISOString()
      const opposing = this.findOpposing(input.topic, input.proposal.position)
      const record: DeliberationRecord = {
        id: input.id,
        sessionId: this.scope.sessionId,
        roomId: this.scope.roomId,
        discussionId: this.scope.discussionId,
        topic: input.topic,
        proposal: input.proposal,
        evidence: [],
        alternatives: [],
        risks: [],
        decision: null,
        ownerId: null,
        deadline: null,
        status: opposing == null ? 'proposed' : 'conflicted',
        capability: this.capability,
        conflict: null,
        version: 1,
        createdAt: now,
        updatedAt: now,
      }
      if (opposing != null) {
        record.conflict = this.createConflict(record, opposing, now)
      }
      return record
    })
  }

  addEvidence(input: VersionedInput & { evidence: Omit<DeliberationEvidence, 'id'> }): DeliberationRecord {
    assertEvidence(input.evidence)
    return this.append('evidence', input, input.evidence, (record) => ({
      ...record,
      evidence: [...record.evidence, { id: randomUUID(), ...input.evidence }],
    }))
  }

  addAlternative(input: VersionedInput & { alternative: Omit<DeliberationAlternative, 'id'> }): DeliberationRecord {
    assertAlternative(input.alternative)
    return this.append('alternative', input, input.alternative, (record) => ({
      ...record,
      alternatives: [...record.alternatives, { id: randomUUID(), ...input.alternative }],
    }))
  }

  addRisk(input: VersionedInput & { risk: Omit<DeliberationRisk, 'id'> }): DeliberationRecord {
    assertRisk(input.risk)
    return this.append('risk', input, input.risk, (record) => ({
      ...record,
      risks: [...record.risks, { id: randomUUID(), ...input.risk }],
    }))
  }

  decide(input: VersionedInput & { decision: Omit<DeliberationDecision, 'resolverId' | 'resolvedAt'> }): DeliberationRecord {
    this.requireResolver('decide')
    assertDecision(input.decision)
    assertDeliberationJson(input.decision.ledgerWrite?.value)
    const request = { id: input.id, expectedVersion: input.expectedVersion, decision: input.decision }
    let ledgerWrite: DeliberationLedgerWrite | null = null
    const record = this.mutate('decide', input.opId, input.id, request, (current) => {
      this.requireCurrentVersion(current, input.expectedVersion)
      if (current.status !== 'proposed') throw new DeliberationConflictError(`Illegal deliberation transition: ${current.status} -> decide`)
      const conflictingDecision = this.findConflictingDecision(current)
      if (conflictingDecision != null) {
        throw new DeliberationConflictError(`Decision conflicts with deliberation ${conflictingDecision.id}`)
      }
      const now = new Date().toISOString()
      ledgerWrite = input.decision.ledgerWrite
      return {
        ...current,
        status: 'decided',
        capability: this.capability,
        decision: { ...input.decision, resolverId: this.scope.actorId, resolvedAt: now },
        version: current.version + 1,
        updatedAt: now,
      }
    })
    const write = ledgerWrite
    if (write != null) {
      this.options.ledgerWriter?.write(Object.assign({}, write, {
        sessionId: this.scope.sessionId,
        roomId: this.scope.roomId,
        discussionId: this.scope.discussionId,
        deliberationId: record.id,
        opId: input.opId,
      }))
    }
    return record
  }

  resolve(input: VersionedInput & { conflictingRecordId: string; reason: string }): DeliberationRecord {
    this.requireResolver('resolve')
    assertId(input.conflictingRecordId)
    assertText(input.reason, 'reason')
    const request = {
      id: input.id,
      expectedVersion: input.expectedVersion,
      conflictingRecordId: input.conflictingRecordId,
      reason: input.reason,
    }
    return this.mutate('resolve', input.opId, input.id, request, (current) => {
      this.requireCurrentVersion(current, input.expectedVersion)
      if (current.status !== 'conflicted' || current.conflict == null) {
        throw new DeliberationConflictError(`Deliberation ${input.id} has no unresolved conflict`)
      }
      if (!current.conflict.recordIds.includes(input.conflictingRecordId)) {
        throw new DeliberationConflictError(`Deliberation ${input.conflictingRecordId} is not a conflict participant`)
      }
      const other = this.findScoped(input.conflictingRecordId)
      if (other == null) throw new DeliberationConflictError(`Conflicting deliberation not found: ${input.conflictingRecordId}`)
      const now = new Date().toISOString()
      const resolved: DeliberationConflict = { ...current.conflict, resolvedBy: this.scope.actorId, resolvedAt: now, reason: input.reason }
      this.updateConflict(resolved, now)
      this.upsert({ ...other, status: 'superseded', conflict: resolved, version: other.version + 1, updatedAt: now })
      return {
        ...current,
        status: 'proposed',
        capability: this.capability,
        conflict: resolved,
        version: current.version + 1,
        updatedAt: now,
      }
    })
  }

  setOwner(input: VersionedInput & { ownerId: string | null; deadline: string | null }): DeliberationRecord {
    if (this.capability === 'agent') throw new DeliberationConflictError('System or user capability required to assign deliberation ownership')
    if (input.ownerId != null) assertId(input.ownerId)
    if (input.deadline != null) assertText(input.deadline, 'deadline')
    return this.mutate('owner', input.opId, input.id, {
      id: input.id, expectedVersion: input.expectedVersion, ownerId: input.ownerId, deadline: input.deadline,
    }, (current) => {
      this.requireCurrentVersion(current, input.expectedVersion)
      const now = new Date().toISOString()
      return { ...current, ownerId: input.ownerId, deadline: input.deadline, capability: this.capability, version: current.version + 1, updatedAt: now }
    })
  }

  /** Alias retained for callers that describe this operation as assigning an owner. */
  assignOwner(input: VersionedInput & { ownerId: string | null; deadline: string | null }): DeliberationRecord {
    return this.setOwner(input)
  }

  get(id: string): DeliberationRecord | null {
    const record = this.findScoped(id)
    return record ?? null
  }

  list(limit = 50, offset = 0): { items: DeliberationRecord[]; total: number } {
    const boundedLimit = clamp(limit, 1, 100)
    const boundedOffset = Math.max(0, Math.trunc(offset))
    const params = this.scopeParams()
    const total = this.countScoped()
    const rows = this.db.raw.prepare(`SELECT * FROM deliberations
      WHERE session_id = ? AND room_id = ? AND discussion_id = ? ORDER BY rowid LIMIT ? OFFSET ?`)
      .all(...params, boundedLimit, boundedOffset) as DeliberationRow[]
    return { items: rows.map(toRecord), total }
  }

  listEvents(deliberationId?: string, limit = 50, offset = 0): { items: DeliberationAuditEvent[]; total: number } {
    const boundedLimit = clamp(limit, 1, 100)
    const boundedOffset = Math.max(0, Math.trunc(offset))
    const where = deliberationId == null
      ? 'session_id = ? AND room_id = ? AND discussion_id = ?'
      : 'session_id = ? AND room_id = ? AND discussion_id = ? AND deliberation_id = ?'
    const params: unknown[] = [...this.scopeParams()]
    if (deliberationId != null) params.push(deliberationId)
    const total = (this.db.raw.prepare(`SELECT COUNT(*) AS count FROM deliberation_events WHERE ${where}`).get(...params) as { count: number }).count
    const rows = this.db.raw.prepare(`SELECT * FROM deliberation_events WHERE ${where} ORDER BY rowid LIMIT ? OFFSET ?`)
      .all(...params, boundedLimit, boundedOffset) as EventRow[]
    return { items: rows.map(toEvent), total }
  }

  snapshot(): DeliberationSnapshot {
    const records = this.db.raw.prepare(`SELECT * FROM deliberations
      WHERE session_id = ? AND room_id = ? AND discussion_id = ? ORDER BY rowid`)
      .all(...this.scopeParams()) as DeliberationRow[]
    const conflicts = this.db.raw.prepare(`SELECT * FROM deliberation_conflicts
      WHERE session_id = ? AND room_id = ? AND discussion_id = ? ORDER BY rowid`)
      .all(...this.scopeParams()) as ConflictRow[]
    return {
      sessionId: this.scope.sessionId,
      discussionId: this.scope.discussionId,
      records: records.map(toRecord),
      conflicts: conflicts.map(toConflict),
      syncedAt: new Date().toISOString(),
    }
  }

  static deleteBySession(db: SparkDatabase, sessionId: string): number {
    return db.raw.transaction(() => {
      let count = 0
      for (const table of ['deliberation_events', 'deliberation_conflicts', 'deliberations']) {
        count += db.raw.prepare(`DELETE FROM ${table} WHERE session_id = ?`).run(sessionId).changes
      }
      return count
    })()
  }

  private append<T extends DeliberationEvidence | DeliberationAlternative | DeliberationRisk>(
    operation: Exclude<DeliberationOperation, 'create' | 'decide' | 'resolve' | 'owner'>,
    input: VersionedInput,
    value: unknown,
    apply: (record: DeliberationRecord) => DeliberationRecord,
  ): DeliberationRecord {
    const request = { id: input.id, expectedVersion: input.expectedVersion, [operation]: value }
    return this.mutate(operation, input.opId, input.id, request, (current) => {
      this.requireCurrentVersion(current, input.expectedVersion)
      if (current.status !== 'proposed') throw new DeliberationConflictError(`Cannot add ${operation} to ${current.status} deliberation`)
      const next = apply(current)
      const now = new Date().toISOString()
      return { ...next, version: current.version + 1, updatedAt: now }
    })
  }

  private mutate(
    operation: DeliberationOperation,
    opId: string,
    targetId: string,
    request: Record<string, unknown>,
    build: (current: DeliberationRecord | undefined) => DeliberationRecord,
  ): DeliberationRecord {
    assertId(opId)
    return this.db.raw.transaction(() => {
      const prior = this.db.raw.prepare(`SELECT session_id, room_id, discussion_id, deliberation_id,
        operation, actor_id, capability, request_json, record_json FROM deliberation_events WHERE op_id = ?`)
        .get(opId) as EventRow | undefined
      if (prior != null) {
        if (prior.session_id !== this.scope.sessionId || prior.room_id !== this.scope.roomId || prior.discussion_id !== this.scope.discussionId ||
          prior.deliberation_id !== targetId || prior.operation !== operation || prior.actor_id !== this.scope.actorId || prior.capability !== this.capability ||
          canonicalJson(JSON.parse(prior.request_json)) !== canonicalJson(request)) {
          throw new DeliberationConflictError(`opId conflicts with another deliberation operation: ${opId}`)
        }
        return parseEventPayload(prior.record_json).record
      }
      if (operation === 'create' && this.db.raw.prepare('SELECT 1 FROM deliberations WHERE id = ?').get(targetId) != null) {
        throw new DeliberationConflictError(`Deliberation id already exists: ${targetId}`)
      }
      const current = operation === 'create' ? undefined : this.findScoped(targetId)
      const record = build(current)
      this.upsert(record)
      this.db.raw.prepare(`INSERT INTO deliberation_events
        (id, session_id, room_id, discussion_id, deliberation_id, op_id, operation, actor_id, capability, request_json, record_json, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(randomUUID(), record.sessionId, record.roomId, record.discussionId, record.id, opId, operation,
          this.scope.actorId, this.capability, JSON.stringify(request), JSON.stringify({ record, request } satisfies EventPayload), record.updatedAt)
      return record
    })()
  }

  private findScoped(id: string): DeliberationRecord | undefined {
    const row = this.db.raw.prepare(`SELECT * FROM deliberations WHERE id = ? AND session_id = ? AND room_id = ? AND discussion_id = ?`)
      .get(id, ...this.scopeParams()) as DeliberationRow | undefined
    return row == null ? undefined : toRecord(row)
  }

  private findOpposing(topic: string, position: DeliberationProposalPosition): DeliberationRecord | undefined {
    if (position === 'conditional') return undefined
    const opposite = position === 'support' ? 'oppose' : 'support'
    const row = this.db.raw.prepare(`SELECT * FROM deliberations
      WHERE session_id = ? AND room_id = ? AND discussion_id = ? AND topic = ? AND status != 'superseded'
        AND json_extract(proposal_json, '$.position') = ? ORDER BY rowid LIMIT 1`)
      .get(...this.scopeParams(), topic, opposite) as DeliberationRow | undefined
    return row == null ? undefined : toRecord(row)
  }

  private findConflictingDecision(current: DeliberationRecord): DeliberationRecord | undefined {
    const row = this.db.raw.prepare(`SELECT * FROM deliberations
      WHERE session_id = ? AND room_id = ? AND discussion_id = ? AND topic = ? AND id != ? AND status = 'decided'
        AND json_extract(decision_json, '$.outcome') != json_extract(?, '$.outcome') ORDER BY rowid LIMIT 1`)
      .get(...this.scopeParams(), current.topic, current.id, JSON.stringify(current.decision ?? { outcome: 'conditional' })) as DeliberationRow | undefined
    return row == null ? undefined : toRecord(row)
  }

  private createConflict(current: DeliberationRecord, opposing: DeliberationRecord, now: string): DeliberationConflict {
    const conflict: DeliberationConflict = {
      id: randomUUID(), topic: current.topic, recordIds: [opposing.id, current.id],
      reason: `Contradictory proposals: ${opposing.proposal.position} vs ${current.proposal.position}`,
      resolvedBy: null, resolvedAt: null,
    }
    this.db.raw.prepare(`INSERT INTO deliberation_conflicts
      (id, session_id, room_id, discussion_id, topic, record_ids_json, reason, resolved_by, resolved_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(conflict.id, this.scope.sessionId, this.scope.roomId, this.scope.discussionId, conflict.topic,
        JSON.stringify(conflict.recordIds), conflict.reason, null, null, now, now)
    return conflict
  }

  private updateConflict(conflict: DeliberationConflict, now: string): void {
    this.db.raw.prepare(`UPDATE deliberation_conflicts SET record_ids_json = ?, reason = ?, resolved_by = ?, resolved_at = ?, updated_at = ? WHERE id = ? AND session_id = ? AND room_id = ? AND discussion_id = ?`)
      .run(JSON.stringify(conflict.recordIds), conflict.reason, conflict.resolvedBy, conflict.resolvedAt, now,
        conflict.id, this.scope.sessionId, this.scope.roomId, this.scope.discussionId)
  }

  private upsert(record: DeliberationRecord): void {
    this.db.raw.prepare(`INSERT INTO deliberations
      (id, session_id, room_id, discussion_id, topic, proposal_json, evidence_json, alternatives_json, risks_json,
       decision_json, owner_id, deadline, status, capability, conflict_json, version, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET evidence_json = excluded.evidence_json, alternatives_json = excluded.alternatives_json,
        risks_json = excluded.risks_json, decision_json = excluded.decision_json, owner_id = excluded.owner_id,
        deadline = excluded.deadline, status = excluded.status, capability = excluded.capability,
        conflict_json = excluded.conflict_json, version = excluded.version, updated_at = excluded.updated_at`).run(
      record.id, record.sessionId, record.roomId, record.discussionId, record.topic, JSON.stringify(record.proposal),
      JSON.stringify(record.evidence), JSON.stringify(record.alternatives), JSON.stringify(record.risks),
      record.decision == null ? null : JSON.stringify(record.decision), record.ownerId, record.deadline,
      record.status, record.capability, record.conflict == null ? null : JSON.stringify(record.conflict),
      record.version, record.createdAt, record.updatedAt,
    )
  }

  private requireResolver(operation: 'decide' | 'resolve'): void {
    if (this.capability === 'agent') throw new DeliberationConflictError(`User or system capability required to ${operation} deliberation`)
  }

  private requireCurrentVersion(current: DeliberationRecord | undefined, expectedVersion: number): asserts current is DeliberationRecord {
    if (current == null) throw new DeliberationConflictError('Deliberation record not found in the current discussion')
    if (current.version !== expectedVersion) throw new DeliberationConflictError(`Expected version ${expectedVersion}, current version is ${current.version}`)
  }

  private scopeParams(): [string, string, string] {
    return [this.scope.sessionId, this.scope.roomId, this.scope.discussionId]
  }

  private countScoped(): number {
    return (this.db.raw.prepare('SELECT COUNT(*) AS count FROM deliberations WHERE session_id = ? AND room_id = ? AND discussion_id = ?')
      .get(...this.scopeParams()) as { count: number }).count
  }
}

export function assertDeliberationJson(value: unknown): void {
  if (value === undefined) return
  const seen = new Set<object>()
  let nodes = 0
  let bytes = 0
  const visit = (current: unknown, depth: number): void => {
    if (current == null) { bytes += 4; return }
    if (typeof current === 'string') { bytes += current.length + 2; return }
    if (typeof current === 'boolean') { bytes += current ? 4 : 5; return }
    if (typeof current === 'number') {
      if (!Number.isFinite(current)) throw new DeliberationConflictError('Deliberation JSON must contain finite numbers')
      bytes += String(current).length
      return
    }
    if (typeof current !== 'object') throw new DeliberationConflictError('Deliberation JSON must contain JSON values')
    if (seen.has(current)) throw new DeliberationConflictError('Deliberation JSON must not contain cycles')
    if (depth >= MAX_JSON_DEPTH) throw new DeliberationConflictError('Deliberation JSON exceeds maximum depth')
    seen.add(current)
    if (++nodes > MAX_JSON_NODES) throw new DeliberationConflictError('Deliberation JSON exceeds maximum node count')
    const entries = Array.isArray(current) ? current.entries() : Object.entries(current)
    for (const [key, item] of entries) {
      bytes += String(key).length + 3
      visit(item, depth + 1)
      if (bytes > MAX_JSON_BYTES) throw new DeliberationConflictError('Deliberation JSON exceeds serialized byte limit')
    }
    seen.delete(current)
  }
  visit(value, 0)
  if (bytes > MAX_JSON_BYTES) throw new DeliberationConflictError('Deliberation JSON exceeds serialized byte limit')
}

function assertId(value: string): void {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > MAX_ID) throw new DeliberationConflictError('Deliberation identifiers must be non-empty and at most 160 characters')
}

function assertText(value: string, field: string): void {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > MAX_TEXT) throw new DeliberationConflictError(`${field} must be non-empty and at most ${MAX_TEXT} characters`)
}

function assertProposal(proposal: DeliberationProposal): void {
  assertText(proposal.claim, 'claim')
  assertText(proposal.rationale, 'rationale')
  if (!['support', 'oppose', 'conditional'].includes(proposal.position)) throw new DeliberationConflictError('Invalid deliberation proposal position')
}

function assertEvidence(evidence: Omit<DeliberationEvidence, 'id'>): void {
  assertText(evidence.summary, 'evidence summary')
  assertId(evidence.sourceRef)
  if (!['supports', 'challenges', 'neutral'].includes(evidence.polarity)) throw new DeliberationConflictError('Invalid evidence polarity')
}

function assertAlternative(alternative: Omit<DeliberationAlternative, 'id'>): void {
  assertText(alternative.title, 'alternative title')
  assertText(alternative.summary, 'alternative summary')
  if (!Array.isArray(alternative.tradeoffs) || alternative.tradeoffs.length > 8) throw new DeliberationConflictError('Alternative tradeoffs are limited to 8 items')
  alternative.tradeoffs.forEach((tradeoff) => assertText(tradeoff, 'alternative tradeoff'))
}

function assertRisk(risk: Omit<DeliberationRisk, 'id'>): void {
  assertText(risk.title, 'risk title')
  assertText(risk.mitigation, 'risk mitigation')
  if (!['low', 'medium', 'high', 'critical'].includes(risk.severity)) throw new DeliberationConflictError('Invalid risk severity')
}

function assertDecision(decision: Omit<DeliberationDecision, 'resolverId' | 'resolvedAt'>): void {
  assertText(decision.reason, 'decision reason')
  if (!['approved', 'rejected', 'conditional'].includes(decision.outcome)) throw new DeliberationConflictError('Invalid decision outcome')
  if (decision.ledgerWrite != null) {
    assertId(decision.ledgerWrite.logicalKey)
    assertText(decision.ledgerWrite.reason, 'ledger write reason')
    assertDeliberationJson(decision.ledgerWrite.value)
  }
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (value != null && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(',')}}`
  }
  return JSON.stringify(value)
}

function parseEventPayload(raw: string): EventPayload {
  const parsed = JSON.parse(raw) as EventPayload | DeliberationRecord
  return typeof parsed === 'object' && parsed != null && 'record' in parsed
    ? parsed as EventPayload
    : { record: parsed as DeliberationRecord, request: {} }
}

function toRecord(row: DeliberationRow): DeliberationRecord {
  return {
    id: row.id, sessionId: row.session_id, roomId: row.room_id, discussionId: row.discussion_id, topic: row.topic,
    proposal: JSON.parse(row.proposal_json) as DeliberationProposal,
    evidence: JSON.parse(row.evidence_json) as DeliberationEvidence[],
    alternatives: JSON.parse(row.alternatives_json) as DeliberationAlternative[],
    risks: JSON.parse(row.risks_json) as DeliberationRisk[],
    decision: row.decision_json == null ? null : JSON.parse(row.decision_json) as DeliberationDecision,
    ownerId: row.owner_id, deadline: row.deadline, status: row.status, capability: row.capability,
    conflict: row.conflict_json == null ? null : JSON.parse(row.conflict_json) as DeliberationConflict,
    version: row.version, createdAt: row.created_at, updatedAt: row.updated_at,
  }
}

function toConflict(row: ConflictRow): DeliberationConflict {
  return {
    id: row.id, topic: row.topic, recordIds: JSON.parse(row.record_ids_json) as string[], reason: row.reason,
    resolvedBy: row.resolved_by, resolvedAt: row.resolved_at,
  }
}

function toEvent(row: EventRow): DeliberationAuditEvent {
  const payload = parseEventPayload(row.record_json)
  return {
    id: row.id, deliberationId: row.deliberation_id, operation: row.operation, actorId: row.actor_id,
    capability: row.capability, request: payload.request, record: payload.record, createdAt: row.created_at,
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.trunc(value)))
}

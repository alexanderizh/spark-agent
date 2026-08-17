import { randomUUID } from 'node:crypto'
import type { SparkDatabase } from './database.js'

export const TEAM_HANDOFF_MAX_PER_DISCUSSION = 100

export type TeamHandoffStatus =
  | 'draft'
  | 'submitted'
  | 'accepted'
  | 'needs_clarification'
  | 'rejected'
  | 'completed'
  | 'canceled'
export type TeamHandoffSensitivity = 'public' | 'internal' | 'confidential' | 'restricted'
export type TeamHandoffOperation =
  | 'create'
  | 'submit'
  | 'accept'
  | 'request_clarification'
  | 'reject'
  | 'complete'
  | 'cancel'

export interface TeamHandoffRecord {
  id: string
  sessionId: string
  roomId: string
  discussionId: string
  taskId: string | null
  dispatchId: string | null
  senderId: string
  recipientId: string
  purpose: string
  inputs: unknown
  attachments: string[]
  expectedOutput: string
  acceptanceCriteria: string[]
  deadline: string | null
  sensitivity: TeamHandoffSensitivity
  status: TeamHandoffStatus
  artifactRefs: string[]
  evidenceRefs: string[]
  version: number
  createdAt: string
  updatedAt: string
}

export interface TeamHandoffEvent {
  id: string
  handoffId: string
  operation: TeamHandoffOperation
  actorId: string
  record: TeamHandoffRecord
  createdAt: string
}

type TeamHandoffCapability = 'agent' | 'system' | 'user'
interface TeamHandoffScope {
  sessionId: string
  roomId: string
  discussionId: string
  actorId: string
  capability: TeamHandoffCapability
}
interface CreateHandoffInput {
  id: string
  taskId?: string
  dispatchId?: string
  recipientId: string
  purpose: string
  inputs: unknown
  attachments?: string[]
  expectedOutput: string
  acceptanceCriteria: string[]
  deadline?: string
  sensitivity: TeamHandoffSensitivity
  opId: string
}
interface TransitionInput {
  id: string
  expectedVersion: number
  opId: string
  artifactRefs?: string[]
  evidenceRefs?: string[]
}

const TEAM_P1_JSON_MAX_DEPTH = 10
const TEAM_P1_JSON_MAX_NODES = 200
const TEAM_P1_JSON_MAX_BYTES = 16_000

/** Keep direct storage callers subject to the same bounded JSON contract as IPC/runtime. */
export function assertTeamP1Json(value: unknown): void {
  const seen = new Set<object>()
  let nodes = 0
  let bytes = 0
  const visit = (current: unknown, depth: number): void => {
    if (current === null) {
      bytes += 4
      return
    }
    if (typeof current === 'string') {
      bytes += current.length + 2
      return
    }
    if (typeof current === 'boolean') {
      bytes += current ? 4 : 5
      return
    }
    if (typeof current === 'number') {
      if (!Number.isFinite(current))
        throw new TeamHandoffConflictError('P1 JSON must contain only finite JSON values')
      bytes += String(current).length
      return
    }
    if (typeof current !== 'object')
      throw new TeamHandoffConflictError('P1 JSON must contain only JSON values')
    if (seen.has(current)) throw new TeamHandoffConflictError('P1 JSON must not contain cycles')
    if (depth >= TEAM_P1_JSON_MAX_DEPTH)
      throw new TeamHandoffConflictError('P1 JSON exceeds the maximum nesting depth')
    seen.add(current)
    nodes += 1
    if (nodes > TEAM_P1_JSON_MAX_NODES)
      throw new TeamHandoffConflictError('P1 JSON exceeds the maximum node count')
    const entries = Array.isArray(current) ? current.entries() : Object.entries(current)
    for (const [key, item] of entries) {
      bytes += String(key).length + 3
      visit(item, depth + 1)
      if (bytes > TEAM_P1_JSON_MAX_BYTES)
        throw new TeamHandoffConflictError('P1 JSON exceeds the serialized size limit')
    }
    seen.delete(current)
  }
  visit(value, 0)
  if (bytes > TEAM_P1_JSON_MAX_BYTES)
    throw new TeamHandoffConflictError('P1 JSON exceeds the serialized size limit')
}

type HandoffRow = {
  id: string
  session_id: string
  room_id: string
  discussion_id: string
  task_id: string | null
  dispatch_id: string | null
  sender_id: string
  recipient_id: string
  purpose: string
  inputs_json: string
  attachments_json: string
  expected_output: string
  acceptance_criteria_json: string
  deadline: string | null
  sensitivity: TeamHandoffSensitivity
  status: TeamHandoffStatus
  artifact_refs_json: string
  evidence_refs_json: string
  version: number
  created_at: string
  updated_at: string
}
type EventRow = {
  id: string
  handoff_id: string
  operation: TeamHandoffOperation
  actor_id: string
  record_json: string
  created_at: string
}
type PersistedEventPayload = { record: TeamHandoffRecord; request: Record<string, unknown> }

export class TeamHandoffConflictError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'TeamHandoffConflictError'
  }
}

export class TeamHandoffService {
  private constructor(
    private readonly db: SparkDatabase,
    private readonly scope: TeamHandoffScope,
  ) {}

  static forAgent(
    db: SparkDatabase,
    scope: Omit<TeamHandoffScope, 'capability'>,
  ): TeamHandoffService {
    return new TeamHandoffService(db, { ...scope, capability: 'agent' })
  }
  static forSystem(
    db: SparkDatabase,
    scope: Omit<TeamHandoffScope, 'capability'>,
  ): TeamHandoffService {
    return new TeamHandoffService(db, { ...scope, capability: 'system' })
  }
  static forUser(
    db: SparkDatabase,
    scope: Omit<TeamHandoffScope, 'capability'>,
  ): TeamHandoffService {
    return new TeamHandoffService(db, { ...scope, capability: 'user' })
  }

  create(input: CreateHandoffInput): TeamHandoffRecord {
    assertTeamP1Json(input.inputs)
    return this.mutate(
      'create',
      input.opId,
      input.id,
      {
        recipientId: input.recipientId,
        purpose: input.purpose,
        inputs: input.inputs,
        taskId: input.taskId ?? null,
        dispatchId: input.dispatchId ?? null,
        attachments: input.attachments ?? [],
        expectedOutput: input.expectedOutput,
        acceptanceCriteria: input.acceptanceCriteria,
        deadline: input.deadline ?? null,
        sensitivity: input.sensitivity,
      },
      () => {
        const count = this.db.raw
          .prepare(
            'SELECT COUNT(*) AS count FROM team_handoffs WHERE session_id = ? AND room_id = ? AND discussion_id = ?',
          )
          .get(this.scope.sessionId, this.scope.roomId, this.scope.discussionId) as {
          count: number
        }
        if (count.count >= TEAM_HANDOFF_MAX_PER_DISCUSSION)
          throw new TeamHandoffConflictError(
            `Handoff quota exceeded: limit ${TEAM_HANDOFF_MAX_PER_DISCUSSION}`,
          )
        const now = new Date().toISOString()
        return {
          id: input.id,
          sessionId: this.scope.sessionId,
          roomId: this.scope.roomId,
          discussionId: this.scope.discussionId,
          taskId: input.taskId ?? null,
          dispatchId: input.dispatchId ?? null,
          senderId: this.scope.actorId,
          recipientId: input.recipientId,
          purpose: input.purpose,
          inputs: input.inputs,
          attachments: input.attachments ?? [],
          expectedOutput: input.expectedOutput,
          acceptanceCriteria: input.acceptanceCriteria,
          deadline: input.deadline ?? null,
          sensitivity: input.sensitivity,
          status: 'draft',
          artifactRefs: [],
          evidenceRefs: [],
          version: 1,
          createdAt: now,
          updatedAt: now,
        }
      },
    )
  }

  submit(input: TransitionInput): TeamHandoffRecord {
    return this.transition('submit', input, 'submitted', ['draft', 'needs_clarification'], 'sender')
  }
  accept(input: TransitionInput): TeamHandoffRecord {
    return this.transition('accept', input, 'accepted', ['submitted'], 'recipient')
  }
  requestClarification(input: TransitionInput): TeamHandoffRecord {
    return this.transition(
      'request_clarification',
      input,
      'needs_clarification',
      ['submitted'],
      'recipient',
    )
  }
  reject(input: TransitionInput): TeamHandoffRecord {
    return this.transition('reject', input, 'rejected', ['submitted'], 'recipient')
  }
  complete(input: TransitionInput): TeamHandoffRecord {
    return this.transition('complete', input, 'completed', ['accepted'], 'participant')
  }
  cancel(input: TransitionInput): TeamHandoffRecord {
    return this.transition(
      'cancel',
      input,
      'canceled',
      ['draft', 'submitted', 'accepted', 'needs_clarification'],
      'sender',
    )
  }

  list(limit = 50, offset = 0): { items: TeamHandoffRecord[]; total: number } {
    const boundedLimit = clamp(limit, 1, 100)
    const boundedOffset = Math.max(0, Math.trunc(offset))
    const params = [this.scope.sessionId, this.scope.roomId, this.scope.discussionId] as const
    const total = (
      this.db.raw
        .prepare(
          'SELECT COUNT(*) AS count FROM team_handoffs WHERE session_id = ? AND room_id = ? AND discussion_id = ?',
        )
        .get(...params) as { count: number }
    ).count
    const rows = this.db.raw
      .prepare(
        'SELECT * FROM team_handoffs WHERE session_id = ? AND room_id = ? AND discussion_id = ? ORDER BY rowid LIMIT ? OFFSET ?',
      )
      .all(...params, boundedLimit, boundedOffset) as HandoffRow[]
    return { items: rows.map(toRecord), total }
  }

  listEvents(
    handoffId?: string,
    limit = 50,
    offset = 0,
  ): { items: TeamHandoffEvent[]; total: number } {
    const boundedLimit = clamp(limit, 1, 100)
    const boundedOffset = Math.max(0, Math.trunc(offset))
    const where =
      handoffId == null
        ? 'session_id = ? AND room_id = ? AND discussion_id = ?'
        : 'session_id = ? AND room_id = ? AND discussion_id = ? AND handoff_id = ?'
    const params: unknown[] = [this.scope.sessionId, this.scope.roomId, this.scope.discussionId]
    if (handoffId != null) params.push(handoffId)
    const total = (
      this.db.raw
        .prepare(`SELECT COUNT(*) AS count FROM team_handoff_events WHERE ${where}`)
        .get(...params) as { count: number }
    ).count
    const rows = this.db.raw
      .prepare(`SELECT * FROM team_handoff_events WHERE ${where} ORDER BY rowid LIMIT ? OFFSET ?`)
      .all(...params, boundedLimit, boundedOffset) as EventRow[]
    return { items: rows.map(toEvent), total }
  }

  static deleteBySession(db: SparkDatabase, sessionId: string): number {
    return db.raw.transaction(() => {
      let count = 0
      for (const table of ['team_handoff_events', 'team_handoffs']) {
        count += db.raw.prepare(`DELETE FROM ${table} WHERE session_id = ?`).run(sessionId).changes
      }
      return count
    })()
  }

  private transition(
    operation: TeamHandoffOperation,
    input: TransitionInput,
    status: TeamHandoffStatus,
    allowed: TeamHandoffStatus[],
    actor: 'sender' | 'recipient' | 'participant',
  ): TeamHandoffRecord {
    const request: Record<string, unknown> = { expectedVersion: input.expectedVersion }
    if (input.artifactRefs !== undefined) request.artifactRefs = input.artifactRefs
    if (input.evidenceRefs !== undefined) request.evidenceRefs = input.evidenceRefs
    return this.mutate(operation, input.opId, input.id, request, (current) => {
      if (!current || !allowed.includes(current.status))
        throw new TeamHandoffConflictError(
          `Illegal handoff transition: ${current?.status ?? 'missing'} -> ${operation}`,
        )
      if (current.version !== input.expectedVersion)
        throw new TeamHandoffConflictError(
          `Expected version ${input.expectedVersion}, current version is ${current.version}`,
        )
      const permitted =
        this.scope.capability === 'user'
          ? true
          : actor === 'sender'
            ? current.senderId === this.scope.actorId
            : actor === 'recipient'
              ? current.recipientId === this.scope.actorId
              : current.senderId === this.scope.actorId ||
                current.recipientId === this.scope.actorId
      if (!permitted) throw new TeamHandoffConflictError(`Actor cannot ${operation} this handoff`)
      return {
        ...current,
        status,
        version: current.version + 1,
        updatedAt: new Date().toISOString(),
        artifactRefs: input.artifactRefs ?? current.artifactRefs,
        evidenceRefs: input.evidenceRefs ?? current.evidenceRefs,
      }
    })
  }

  private mutate(
    operation: TeamHandoffOperation,
    opId: string,
    handoffId: string | undefined,
    request: Record<string, unknown>,
    build: (current?: TeamHandoffRecord) => TeamHandoffRecord,
  ): TeamHandoffRecord {
    const run = this.db.raw.transaction(() => {
      const prior = this.db.raw
        .prepare(
          'SELECT session_id, room_id, discussion_id, handoff_id, operation, actor_id, record_json FROM team_handoff_events WHERE op_id = ?',
        )
        .get(opId) as
        | {
            session_id: string
            room_id: string
            discussion_id: string
            handoff_id: string
            operation: TeamHandoffOperation
            actor_id: string
            record_json: string
          }
        | undefined
      if (prior) {
        if (
          prior.session_id !== this.scope.sessionId ||
          prior.room_id !== this.scope.roomId ||
          prior.discussion_id !== this.scope.discussionId
        ) {
          throw new TeamHandoffConflictError(
            `opId already belongs to another handoff scope: ${opId}`,
          )
        }
        const priorPayload = parseEventPayload(prior.record_json)
        const priorRecord = priorPayload.record
        if (prior.actor_id !== this.scope.actorId) {
          throw new TeamHandoffConflictError(`opId belongs to another handoff actor: ${opId}`)
        }
        if (prior.operation !== operation || prior.handoff_id !== (handoffId ?? '')) {
          throw new TeamHandoffConflictError(
            `opId conflicts with another handoff operation or target: ${opId}`,
          )
        }
        if (priorPayload.request == null || !sameHandoffRequest(request, priorPayload.request)) {
          throw new TeamHandoffConflictError(
            `opId conflicts with a different handoff payload: ${opId}`,
          )
        }
        return priorRecord
      }
      if (operation === 'create' && handoffId != null) {
        const occupied = this.db.raw
          .prepare('SELECT 1 FROM team_handoffs WHERE id = ?')
          .get(handoffId)
        if (occupied) {
          throw new TeamHandoffConflictError(
            `Handoff id already belongs to another create operation: ${handoffId}`,
          )
        }
      }
      const current = handoffId == null ? undefined : this.findScoped(handoffId)
      const record = build(current)
      this.upsert(record)
      this.db.raw
        .prepare(
          `INSERT INTO team_handoff_events
        (id, handoff_id, session_id, room_id, discussion_id, op_id, operation, actor_id, record_json, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          randomUUID(),
          record.id,
          record.sessionId,
          record.roomId,
          record.discussionId,
          opId,
          operation,
          this.scope.actorId,
          JSON.stringify({ record, request } satisfies PersistedEventPayload),
          record.updatedAt,
        )
      return record
    })
    return run()
  }

  private findScoped(id: string): TeamHandoffRecord | undefined {
    const row = this.db.raw
      .prepare(
        'SELECT * FROM team_handoffs WHERE id = ? AND session_id = ? AND room_id = ? AND discussion_id = ?',
      )
      .get(id, this.scope.sessionId, this.scope.roomId, this.scope.discussionId) as
      | HandoffRow
      | undefined
    return row ? toRecord(row) : undefined
  }

  private upsert(record: TeamHandoffRecord): void {
    this.db.raw
      .prepare(
        `INSERT INTO team_handoffs
      (id, session_id, room_id, discussion_id, task_id, dispatch_id, sender_id, recipient_id, purpose, inputs_json,
       attachments_json, expected_output, acceptance_criteria_json, deadline, sensitivity, status, artifact_refs_json,
       evidence_refs_json, version, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET status=excluded.status, artifact_refs_json=excluded.artifact_refs_json,
        evidence_refs_json=excluded.evidence_refs_json, version=excluded.version, updated_at=excluded.updated_at`,
      )
      .run(
        record.id,
        record.sessionId,
        record.roomId,
        record.discussionId,
        record.taskId,
        record.dispatchId,
        record.senderId,
        record.recipientId,
        record.purpose,
        JSON.stringify(record.inputs),
        JSON.stringify(record.attachments),
        record.expectedOutput,
        JSON.stringify(record.acceptanceCriteria),
        record.deadline,
        record.sensitivity,
        record.status,
        JSON.stringify(record.artifactRefs),
        JSON.stringify(record.evidenceRefs),
        record.version,
        record.createdAt,
        record.updatedAt,
      )
  }
}

function sameHandoffRequest(
  request: Record<string, unknown>,
  priorRequest: Record<string, unknown>,
): boolean {
  const requestWithoutRefs = withoutRefFields(request)
  const priorWithoutRefs = withoutRefFields(priorRequest)
  if (canonicalJson(requestWithoutRefs) !== canonicalJson(priorWithoutRefs)) return false
  return (
    refRequestMatches(request, priorRequest, 'artifactRefs') &&
    refRequestMatches(request, priorRequest, 'evidenceRefs')
  )
}

function withoutRefFields(request: Record<string, unknown>): Record<string, unknown> {
  const result = { ...request }
  delete result.artifactRefs
  delete result.evidenceRefs
  return result
}

function refRequestMatches(
  request: Record<string, unknown>,
  priorRequest: Record<string, unknown>,
  key: 'artifactRefs' | 'evidenceRefs',
): boolean {
  const currentHas = Object.hasOwn(request, key)
  const priorHas = Object.hasOwn(priorRequest, key)
  if (!currentHas && !priorHas) return true
  if (currentHas && priorHas)
    return canonicalJson(request[key]) === canonicalJson(priorRequest[key])
  if (!currentHas && priorHas) {
    // A retry that omits refs may inherit refs explicitly supplied by the
    // first request, but omission must never silently repeat an explicit clear.
    return Array.isArray(priorRequest[key]) && priorRequest[key].length > 0
  }
  return false
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (value != null && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(',')}}`
  }
  return JSON.stringify(value)
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.trunc(value)))
}
function parseEventPayload(raw: string): {
  record: TeamHandoffRecord
  request?: Record<string, unknown>
} {
  const parsed = JSON.parse(raw) as TeamHandoffRecord | PersistedEventPayload
  if (isPersistedEventPayload(parsed)) return parsed
  return { record: parsed }
}
function isPersistedEventPayload(
  value: TeamHandoffRecord | PersistedEventPayload,
): value is PersistedEventPayload {
  return typeof value === 'object' && value !== null && 'record' in value && 'request' in value
}
function toRecord(row: HandoffRow): TeamHandoffRecord {
  return {
    id: row.id,
    sessionId: row.session_id,
    roomId: row.room_id,
    discussionId: row.discussion_id,
    taskId: row.task_id,
    dispatchId: row.dispatch_id,
    senderId: row.sender_id,
    recipientId: row.recipient_id,
    purpose: row.purpose,
    inputs: JSON.parse(row.inputs_json),
    attachments: JSON.parse(row.attachments_json) as string[],
    expectedOutput: row.expected_output,
    acceptanceCriteria: JSON.parse(row.acceptance_criteria_json) as string[],
    deadline: row.deadline,
    sensitivity: row.sensitivity,
    status: row.status,
    artifactRefs: JSON.parse(row.artifact_refs_json) as string[],
    evidenceRefs: JSON.parse(row.evidence_refs_json) as string[],
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}
function toEvent(row: EventRow): TeamHandoffEvent {
  return {
    id: row.id,
    handoffId: row.handoff_id,
    operation: row.operation,
    actorId: row.actor_id,
    record: parseEventPayload(row.record_json).record,
    createdAt: row.created_at,
  }
}

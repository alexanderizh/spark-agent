import { randomUUID } from 'node:crypto'
import type { SparkDatabase } from './database.js'
import { assertTeamP1Json } from './team-handoff.service.js'

export const STEERING_GATE_MAX_PER_DISCUSSION = 100

export type SteeringCapability = 'agent' | 'system' | 'user'
export type SteeringGateStatus = 'waiting' | 'approved' | 'revise' | 'stopped' | 'expired'
export type SteeringGateImpact = 'low' | 'medium' | 'high' | 'critical'
export type SteeringTargetType = 'ledger' | 'record' | 'artifact' | 'handoff' | 'task'
export type SteeringGateOperation = 'create' | 'approve' | 'revise' | 'stop' | 'expire'

export interface SteeringGateRecord {
  id: string
  sessionId: string
  roomId: string
  discussionId: string
  targetType: SteeringTargetType
  targetId: string
  trigger: string
  reason: string
  impact: SteeringGateImpact
  budgetSnapshot: unknown
  recommendedAction: string
  status: SteeringGateStatus
  capability: SteeringCapability
  version: number
  createdAt: string
  updatedAt: string
}

export interface SteeringGateEvent {
  id: string
  gateId: string
  operation: SteeringGateOperation
  actorId: string
  capability: SteeringCapability
  highImpact: boolean
  record: SteeringGateRecord
  createdAt: string
}

interface SteeringScope {
  sessionId: string
  roomId: string
  discussionId: string
  actorId: string
}
interface BoundScope extends SteeringScope {
  capability: SteeringCapability
}
interface CreateGateInput {
  id: string
  targetType: SteeringTargetType
  targetId: string
  trigger: string
  reason: string
  impact: SteeringGateImpact
  budgetSnapshot: unknown
  recommendedAction: string
  opId: string
}
interface DecisionInput {
  id: string
  expectedVersion: number
  opId: string
  reason?: string
}

type GateRow = {
  id: string
  session_id: string
  room_id: string
  discussion_id: string
  target_type: SteeringTargetType
  target_id: string
  trigger_text: string
  reason: string
  impact: SteeringGateImpact
  budget_snapshot_json: string
  recommended_action: string
  status: SteeringGateStatus
  capability: SteeringCapability
  version: number
  created_at: string
  updated_at: string
}
type EventRow = {
  id: string
  gate_id: string
  operation: SteeringGateOperation
  actor_id: string
  capability: SteeringCapability
  high_impact: number
  record_json: string
  created_at: string
}

export class SteeringGateConflictError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SteeringGateConflictError'
  }
}

/** gate 未放行时由 assertTargetRunnable 抛出；携带 gate 记录供上层展示/审计。 */
export class SteeringGateBlockedError extends Error {
  constructor(readonly gate: SteeringGateRecord) {
    super(
      `Steering gate ${gate.id} blocks ${gate.targetType} "${gate.targetId}" (status=${gate.status}): ${gate.reason}. Recommended action: ${gate.recommendedAction}`,
    )
    this.name = 'SteeringGateBlockedError'
  }
}

export class SteeringGateService {
  private constructor(
    private readonly db: SparkDatabase,
    private readonly scope: BoundScope,
  ) {}

  static forAgent(db: SparkDatabase, scope: SteeringScope): SteeringGateService {
    return new SteeringGateService(db, { ...scope, capability: 'agent' })
  }
  static forSystem(db: SparkDatabase, scope: SteeringScope): SteeringGateService {
    return new SteeringGateService(db, { ...scope, capability: 'system' })
  }
  static forUser(db: SparkDatabase, scope: SteeringScope): SteeringGateService {
    return new SteeringGateService(db, { ...scope, capability: 'user' })
  }

  create(input: CreateGateInput): SteeringGateRecord {
    assertTeamP1Json(input.budgetSnapshot)
    return this.mutate(
      'create',
      input.opId,
      input.id,
      {
        targetType: input.targetType,
        targetId: input.targetId,
        trigger: input.trigger,
        reason: input.reason,
        impact: input.impact,
        budgetSnapshot: input.budgetSnapshot,
        recommendedAction: input.recommendedAction,
      },
      () => {
        const count = this.countScoped('team_steering_gates')
        if (count >= STEERING_GATE_MAX_PER_DISCUSSION)
          throw new SteeringGateConflictError(
            `Steering gate quota exceeded: limit ${STEERING_GATE_MAX_PER_DISCUSSION}`,
          )
        const now = new Date().toISOString()
        return {
          id: input.id,
          sessionId: this.scope.sessionId,
          roomId: this.scope.roomId,
          discussionId: this.scope.discussionId,
          targetType: input.targetType,
          targetId: input.targetId,
          trigger: input.trigger,
          reason: input.reason,
          impact: input.impact,
          budgetSnapshot: input.budgetSnapshot,
          recommendedAction: input.recommendedAction,
          status: 'waiting',
          capability: this.scope.capability,
          version: 1,
          createdAt: now,
          updatedAt: now,
        }
      },
    )
  }

  approve(input: DecisionInput): SteeringGateRecord {
    return this.userDecision('approve', input, 'approved')
  }
  revise(input: DecisionInput): SteeringGateRecord {
    return this.userDecision('revise', input, 'revise')
  }
  stop(input: DecisionInput): SteeringGateRecord {
    return this.userDecision('stop', input, 'stopped')
  }
  expire(input: DecisionInput): SteeringGateRecord {
    if (this.scope.capability === 'agent')
      throw new SteeringGateConflictError(
        'System or user capability required to expire a steering gate',
      )
    return this.transition('expire', input, 'expired')
  }

  /**
   * 返回当前 scope 内阻塞指定目标执行的 gate（waiting/revise/stopped/expired 中最早创建
   * 的一条）；无 gate 或全部 approved 时返回 undefined。精确匹配 targetType+targetId，
   * 其他目标（或空 targetId）的 gate 不会阻塞本目标。
   */
  getBlockingGate(
    targetType: SteeringTargetType,
    targetId: string,
  ): SteeringGateRecord | undefined {
    const rows = this.db.raw
      .prepare(
        'SELECT * FROM team_steering_gates WHERE session_id = ? AND room_id = ? AND discussion_id = ? AND target_type = ? AND target_id = ? ORDER BY rowid',
      )
      .all(...this.scopeParams(), targetType, targetId) as GateRow[]
    return rows.map(toRecord).find((gate) => gate.status !== 'approved')
  }

  /** 断言目标当前可执行；存在未放行（非 approved）gate 时抛 SteeringGateBlockedError。 */
  assertTargetRunnable(targetType: SteeringTargetType, targetId: string): void {
    const gate = this.getBlockingGate(targetType, targetId)
    if (gate != null) throw new SteeringGateBlockedError(gate)
  }

  list(limit = 50, offset = 0): { items: SteeringGateRecord[]; total: number } {
    const boundedLimit = clamp(limit, 1, 100)
    const boundedOffset = Math.max(0, Math.trunc(offset))
    const params = this.scopeParams()
    const total = this.countScoped('team_steering_gates')
    const rows = this.db.raw
      .prepare(
        'SELECT * FROM team_steering_gates WHERE session_id = ? AND room_id = ? AND discussion_id = ? ORDER BY rowid LIMIT ? OFFSET ?',
      )
      .all(...params, boundedLimit, boundedOffset) as GateRow[]
    return { items: rows.map(toRecord), total }
  }

  listEvents(
    gateId?: string,
    limit = 50,
    offset = 0,
  ): { items: SteeringGateEvent[]; total: number } {
    const boundedLimit = clamp(limit, 1, 100)
    const boundedOffset = Math.max(0, Math.trunc(offset))
    const where =
      gateId == null
        ? 'session_id = ? AND room_id = ? AND discussion_id = ?'
        : 'session_id = ? AND room_id = ? AND discussion_id = ? AND gate_id = ?'
    const params: unknown[] = this.scopeParams()
    if (gateId != null) params.push(gateId)
    const total = (
      this.db.raw
        .prepare(`SELECT COUNT(*) AS count FROM team_steering_gate_events WHERE ${where}`)
        .get(...params) as { count: number }
    ).count
    const rows = this.db.raw
      .prepare(
        `SELECT * FROM team_steering_gate_events WHERE ${where} ORDER BY rowid LIMIT ? OFFSET ?`,
      )
      .all(...params, boundedLimit, boundedOffset) as EventRow[]
    return { items: rows.map(toEvent), total }
  }

  static deleteBySession(db: SparkDatabase, sessionId: string): number {
    return db.raw.transaction(() => {
      let count = 0
      for (const table of ['team_steering_gate_events', 'team_steering_gates']) {
        count += db.raw.prepare(`DELETE FROM ${table} WHERE session_id = ?`).run(sessionId).changes
      }
      return count
    })()
  }

  private userDecision(
    operation: 'approve' | 'revise' | 'stop',
    input: DecisionInput,
    status: SteeringGateStatus,
  ): SteeringGateRecord {
    if (this.scope.capability !== 'user')
      throw new SteeringGateConflictError(
        `User capability required to ${operation} a steering gate`,
      )
    return this.transition(operation, input, status)
  }

  private transition(
    operation: SteeringGateOperation,
    input: DecisionInput,
    status: SteeringGateStatus,
  ): SteeringGateRecord {
    return this.mutate(
      operation,
      input.opId,
      input.id,
      {
        expectedVersion: input.expectedVersion,
        reason: input.reason ?? null,
      },
      (current) => {
        if (!current || current.status !== 'waiting')
          throw new SteeringGateConflictError(
            `Illegal steering gate transition: ${current?.status ?? 'missing'} -> ${operation}`,
          )
        if (current.version !== input.expectedVersion)
          throw new SteeringGateConflictError(
            `Expected version ${input.expectedVersion}, current version is ${current.version}`,
          )
        return {
          ...current,
          status,
          reason: input.reason ?? current.reason,
          capability: this.scope.capability,
          version: current.version + 1,
          updatedAt: new Date().toISOString(),
        }
      },
    )
  }

  private mutate(
    operation: SteeringGateOperation,
    opId: string,
    gateId: string | undefined,
    request: Record<string, unknown>,
    build: (current?: SteeringGateRecord) => SteeringGateRecord,
  ): SteeringGateRecord {
    const run = this.db.raw.transaction(() => {
      const prior = this.db.raw
        .prepare(
          'SELECT session_id, room_id, discussion_id, gate_id, operation, actor_id, capability, record_json FROM team_steering_gate_events WHERE op_id = ?',
        )
        .get(opId) as
        | {
            session_id: string
            room_id: string
            discussion_id: string
            gate_id: string
            operation: SteeringGateOperation
            actor_id: string
            capability: SteeringCapability
            record_json: string
          }
        | undefined
      if (prior) {
        if (
          prior.session_id !== this.scope.sessionId ||
          prior.room_id !== this.scope.roomId ||
          prior.discussion_id !== this.scope.discussionId
        ) {
          throw new SteeringGateConflictError(
            `opId already belongs to another steering gate scope: ${opId}`,
          )
        }
        const priorRecord = JSON.parse(prior.record_json) as SteeringGateRecord
        if (prior.actor_id !== this.scope.actorId || prior.capability !== this.scope.capability) {
          throw new SteeringGateConflictError(
            `opId belongs to another steering gate actor or capability: ${opId}`,
          )
        }
        if (prior.operation !== operation || prior.gate_id !== (gateId ?? '')) {
          throw new SteeringGateConflictError(
            `opId conflicts with another steering gate operation or target: ${opId}`,
          )
        }
        if (!sameGateRequest(operation, request, priorRecord)) {
          throw new SteeringGateConflictError(
            `opId conflicts with a different steering gate payload: ${opId}`,
          )
        }
        return priorRecord
      }
      if (operation === 'create' && gateId != null) {
        const occupied = this.db.raw
          .prepare('SELECT 1 FROM team_steering_gates WHERE id = ?')
          .get(gateId)
        if (occupied) {
          throw new SteeringGateConflictError(
            `Steering gate id already belongs to another create operation: ${gateId}`,
          )
        }
      }
      const current = gateId == null ? undefined : this.findScoped(gateId)
      const record = build(current)
      this.upsert(record)
      const highImpact = record.impact === 'high' || record.impact === 'critical'
      this.db.raw
        .prepare(
          `INSERT INTO team_steering_gate_events
        (id, gate_id, session_id, room_id, discussion_id, op_id, operation, actor_id, capability, high_impact, record_json, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
          this.scope.capability,
          highImpact ? 1 : 0,
          JSON.stringify(record),
          record.updatedAt,
        )
      return record
    })
    return run()
  }

  private findScoped(id: string): SteeringGateRecord | undefined {
    const row = this.db.raw
      .prepare(
        'SELECT * FROM team_steering_gates WHERE id = ? AND session_id = ? AND room_id = ? AND discussion_id = ?',
      )
      .get(id, ...this.scopeParams()) as GateRow | undefined
    return row ? toRecord(row) : undefined
  }

  private upsert(record: SteeringGateRecord): void {
    this.db.raw
      .prepare(
        `INSERT INTO team_steering_gates
      (id, session_id, room_id, discussion_id, target_type, target_id, trigger_text, reason, impact, budget_snapshot_json,
       recommended_action, status, capability, version, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET reason=excluded.reason, status=excluded.status, capability=excluded.capability,
        version=excluded.version, updated_at=excluded.updated_at`,
      )
      .run(
        record.id,
        record.sessionId,
        record.roomId,
        record.discussionId,
        record.targetType,
        record.targetId,
        record.trigger,
        record.reason,
        record.impact,
        JSON.stringify(record.budgetSnapshot),
        record.recommendedAction,
        record.status,
        record.capability,
        record.version,
        record.createdAt,
        record.updatedAt,
      )
  }

  private scopeParams(): [string, string, string] {
    return [this.scope.sessionId, this.scope.roomId, this.scope.discussionId]
  }
  private countScoped(table: 'team_steering_gates'): number {
    return (
      this.db.raw
        .prepare(
          `SELECT COUNT(*) AS count FROM ${table} WHERE session_id = ? AND room_id = ? AND discussion_id = ?`,
        )
        .get(...this.scopeParams()) as { count: number }
    ).count
  }
}

function sameGateRequest(
  operation: SteeringGateOperation,
  request: Record<string, unknown>,
  prior: SteeringGateRecord,
): boolean {
  const actual =
    operation === 'create'
      ? {
          id: prior.id,
          targetType: prior.targetType,
          targetId: prior.targetId,
          trigger: prior.trigger,
          reason: prior.reason,
          impact: prior.impact,
          budgetSnapshot: prior.budgetSnapshot,
          recommendedAction: prior.recommendedAction,
        }
      : { id: prior.id, expectedVersion: prior.version - 1, reason: prior.reason }
  const expected = { ...request, id: prior.id, reason: request.reason ?? prior.reason }
  return canonicalJson(expected) === canonicalJson(actual)
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
function toRecord(row: GateRow): SteeringGateRecord {
  return {
    id: row.id,
    sessionId: row.session_id,
    roomId: row.room_id,
    discussionId: row.discussion_id,
    targetType: row.target_type,
    targetId: row.target_id,
    trigger: row.trigger_text,
    reason: row.reason,
    impact: row.impact,
    budgetSnapshot: JSON.parse(row.budget_snapshot_json),
    recommendedAction: row.recommended_action,
    status: row.status,
    capability: row.capability,
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}
function toEvent(row: EventRow): SteeringGateEvent {
  return {
    id: row.id,
    gateId: row.gate_id,
    operation: row.operation,
    actorId: row.actor_id,
    capability: row.capability,
    highImpact: row.high_impact === 1,
    record: JSON.parse(row.record_json) as SteeringGateRecord,
    createdAt: row.created_at,
  }
}

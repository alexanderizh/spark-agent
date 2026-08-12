import type { SparkDatabase } from '../database.js'

export interface RoomLedgerRecord {
  id: string
  roomId: string
  discussionId: string | null
  logicalKey: string
  value: unknown
  status: RoomLedgerStatus
  authority: RoomLedgerAuthority
  confidence: number
  sourceRefs: string[]
  version: number
  createdBy: string
  createdAt: string
  updatedBy: string
  updatedAt: string
  expiresAt: string | null
  supersedes: string | null
  reason: string | null
}

export type RoomLedgerStatus = 'proposed' | 'active' | 'rejected' | 'superseded' | 'invalid' | 'expired' | 'deleted' | 'conflict'
export type RoomLedgerAuthority = 'user-confirmed' | 'system-observed' | 'agent-inferred'
export type RoomLedgerOperation = 'create' | 'replace' | 'correct' | 'invalidate' | 'tombstone' | 'confirm' | 'reject' | 'expire' | 'restore'

export interface RoomLedgerEvent {
  id: string
  roomId: string
  discussionId: string | null
  logicalKey: string
  opId: string
  operation: RoomLedgerOperation
  recordId: string
  previousRecordId: string | null
  record: RoomLedgerRecord
  actorId: string
  createdAt: string
}

type RecordRow = Omit<RoomLedgerRecord, 'roomId' | 'discussionId' | 'logicalKey' | 'value' | 'status' | 'authority' | 'confidence' | 'sourceRefs' | 'version' | 'createdBy' | 'createdAt' | 'updatedBy' | 'updatedAt' | 'expiresAt' | 'supersedes' | 'reason'> & {
  room_id: string; discussion_id: string | null; logical_key: string; value_json: string; status: RoomLedgerStatus; authority: RoomLedgerAuthority; confidence: number; source_refs_json: string; version: number; created_by: string; created_at: string; updated_by: string; updated_at: string; expires_at: string | null; supersedes: string | null; reason: string | null
}

type EventRow = { id: string; room_id: string; discussion_id: string | null; logical_key: string; op_id: string; operation: RoomLedgerOperation; record_id: string; previous_record_id: string | null; record_json: string; actor_id: string; created_at: string }

export class RoomLedgerRepository {
  constructor(private readonly db: SparkDatabase) {}

  findByOpId(opId: string): RoomLedgerEvent | null {
    const row = this.db.raw.prepare('SELECT * FROM room_ledger_events WHERE op_id = ?').get(opId) as EventRow | undefined
    return row ? this.toEvent(row) : null
  }

  resolveDiscussionScope(sessionId: string): string | null {
    const row = this.db.raw
      .prepare(
        `SELECT id FROM team_discussions
         WHERE session_id = ?
         ORDER BY CASE WHEN state = 'active' THEN 0 ELSE 1 END, started_at DESC
         LIMIT 1`,
      )
      .get(sessionId) as { id: string } | undefined
    return row?.id ?? null
  }

  findCurrent(roomId: string, discussionId: string | null, logicalKey: string): RoomLedgerRecord | null {
    const row = this.db.raw
      .prepare('SELECT * FROM room_ledger_records WHERE room_id = ? AND discussion_id IS ? AND logical_key = ? AND is_current = 1')
      .get(roomId, discussionId, logicalKey) as RecordRow | undefined
    return row ? this.toRecord(row) : null
  }

  listCurrent(roomId: string, discussionId?: string, now = new Date().toISOString(), limit = 100): RoomLedgerRecord[] {
    const boundedLimit = Math.max(1, Math.min(100, Math.trunc(limit)))
    const query = discussionId
      ? 'SELECT * FROM room_ledger_records WHERE room_id = ? AND discussion_id = ? AND is_current = 1 AND status IN (\'active\', \'proposed\') AND (expires_at IS NULL OR expires_at > ?) ORDER BY logical_key ASC, id ASC LIMIT ?'
      : 'SELECT * FROM room_ledger_records WHERE room_id = ? AND is_current = 1 AND status IN (\'active\', \'proposed\') AND (expires_at IS NULL OR expires_at > ?) ORDER BY discussion_id ASC, logical_key ASC, id ASC LIMIT ?'
    const rows = (discussionId ? this.db.raw.prepare(query).all(roomId, discussionId, now, boundedLimit) : this.db.raw.prepare(query).all(roomId, now, boundedLimit)) as RecordRow[]
    return rows.map((row) => this.toRecord(row))
  }

  listCurrentProjection(roomId: string, discussionId: string, limit = 100): RoomLedgerRecord[] {
    const boundedLimit = Math.max(1, Math.min(100, Math.trunc(limit)))
    const rows = this.db.raw
      .prepare(
        `SELECT * FROM room_ledger_records
         WHERE room_id = ? AND discussion_id = ? AND is_current = 1
         ORDER BY updated_at DESC, logical_key ASC
         LIMIT ?`,
      )
      .all(roomId, discussionId, boundedLimit) as RecordRow[]
    return rows.map((row) => this.toRecord(row))
  }

  listHistory(roomId: string, discussionId?: string, logicalKey?: string): RoomLedgerRecord[] {
    const rows = (discussionId != null && logicalKey != null
      ? this.db.raw.prepare('SELECT * FROM room_ledger_records WHERE room_id = ? AND discussion_id = ? AND logical_key = ? ORDER BY version').all(roomId, discussionId, logicalKey)
      : discussionId != null
        ? this.db.raw.prepare('SELECT * FROM room_ledger_records WHERE room_id = ? AND discussion_id = ? ORDER BY logical_key, version').all(roomId, discussionId)
        : logicalKey != null
          ? this.db.raw.prepare('SELECT * FROM room_ledger_records WHERE room_id = ? AND logical_key = ? ORDER BY discussion_id, version').all(roomId, logicalKey)
          : this.db.raw.prepare('SELECT * FROM room_ledger_records WHERE room_id = ? ORDER BY discussion_id, logical_key, version').all(roomId)) as RecordRow[]
    return rows.map((row) => this.toRecord(row))
  }

  listEvents(roomId: string, discussionId?: string): RoomLedgerEvent[] {
    const rows = (discussionId == null
      ? this.db.raw.prepare('SELECT * FROM room_ledger_events WHERE room_id = ? ORDER BY rowid').all(roomId)
      : this.db.raw.prepare('SELECT * FROM room_ledger_events WHERE room_id = ? AND discussion_id = ? ORDER BY rowid').all(roomId, discussionId)) as EventRow[]
    return rows.map((row) => this.toEvent(row))
  }

  deleteByRoom(roomId: string): number {
    const remove = this.db.raw.transaction(() => {
      const events = this.db.raw.prepare('DELETE FROM room_ledger_events WHERE room_id = ?').run(roomId).changes
      this.db.raw.prepare('DELETE FROM room_ledger_records WHERE room_id = ?').run(roomId)
      return events
    })
    return remove()
  }

  transact<T>(fn: (tx: RoomLedgerTransaction) => T): T {
    const transaction = this.db.raw.transaction(() => fn(new RoomLedgerTransaction(this.db)))
    return transaction()
  }

  private toRecord(row: RecordRow): RoomLedgerRecord {
    return { id: row.id, roomId: row.room_id, discussionId: row.discussion_id, logicalKey: row.logical_key, value: JSON.parse(row.value_json), status: row.status, authority: row.authority, confidence: row.confidence, sourceRefs: JSON.parse(row.source_refs_json), version: row.version, createdBy: row.created_by, createdAt: row.created_at, updatedBy: row.updated_by, updatedAt: row.updated_at, expiresAt: row.expires_at, supersedes: row.supersedes, reason: row.reason }
  }

  private toEvent(row: EventRow): RoomLedgerEvent {
    return { id: row.id, roomId: row.room_id, discussionId: row.discussion_id, logicalKey: row.logical_key, opId: row.op_id, operation: row.operation, recordId: row.record_id, previousRecordId: row.previous_record_id, record: JSON.parse(row.record_json) as RoomLedgerRecord, actorId: row.actor_id, createdAt: row.created_at }
  }
}

export class RoomLedgerTransaction {
  constructor(private readonly db: SparkDatabase) {}

  resolveDiscussionScope(sessionId: string): string | null {
    const row = this.db.raw
      .prepare(
        `SELECT id FROM team_discussions
         WHERE session_id = ?
         ORDER BY CASE WHEN state = 'active' THEN 0 ELSE 1 END, started_at DESC
         LIMIT 1`,
      )
      .get(sessionId) as { id: string } | undefined
    return row?.id ?? null
  }

  listEvents(roomId: string): RoomLedgerEvent[] {
    return (this.db.raw.prepare('SELECT * FROM room_ledger_events WHERE room_id = ? ORDER BY rowid').all(roomId) as EventRow[]).map((row) => ({
      id: row.id,
      roomId: row.room_id,
      discussionId: row.discussion_id,
      logicalKey: row.logical_key,
      opId: row.op_id,
      operation: row.operation,
      recordId: row.record_id,
      previousRecordId: row.previous_record_id,
      record: JSON.parse(row.record_json) as RoomLedgerRecord,
      actorId: row.actor_id,
      createdAt: row.created_at,
    }))
  }

  findByOpId(opId: string): RoomLedgerEvent | null {
    const row = this.db.raw.prepare('SELECT * FROM room_ledger_events WHERE op_id = ?').get(opId) as EventRow | undefined
    if (!row) return null
    return {
      id: row.id,
      roomId: row.room_id,
      discussionId: row.discussion_id,
      logicalKey: row.logical_key,
      opId: row.op_id,
      operation: row.operation,
      recordId: row.record_id,
      previousRecordId: row.previous_record_id,
      record: JSON.parse(row.record_json) as RoomLedgerRecord,
      actorId: row.actor_id,
      createdAt: row.created_at,
    }
  }

  countCurrentKeys(roomId: string, discussionId: string | null): number {
    const row = this.db.raw
      .prepare('SELECT COUNT(*) AS count FROM room_ledger_records WHERE room_id = ? AND discussion_id IS ? AND is_current = 1')
      .get(roomId, discussionId) as { count: number }
    return row.count
  }

  append(event: RoomLedgerEvent): void {
    this.appendRecord(event)
    this.db.raw.prepare(`INSERT INTO room_ledger_events
      (id, room_id, discussion_id, logical_key, op_id, operation, record_id, previous_record_id, record_json, actor_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(event.id, event.roomId, event.discussionId, event.logicalKey, event.opId, event.operation, event.recordId, event.previousRecordId, JSON.stringify(event.record), event.actorId, event.createdAt)
  }

  /** Rebuild only the projection; the append-only event row remains untouched. */
  rebuild(event: RoomLedgerEvent): void {
    this.appendRecord(event)
  }

  private appendRecord(event: RoomLedgerEvent): void {
    if (event.previousRecordId) {
      this.db.raw.prepare("UPDATE room_ledger_records SET is_current = 0, status = CASE WHEN ? IN ('replace','correct') THEN 'superseded' ELSE status END WHERE id = ?").run(event.operation, event.previousRecordId)
    }
    const record = event.record
    this.db.raw.prepare(`INSERT INTO room_ledger_records
      (id, room_id, discussion_id, logical_key, value_json, status, authority, confidence, source_refs_json, version, created_by, created_at, updated_by, updated_at, expires_at, supersedes, reason, is_current)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`).run(
      record.id, record.roomId, record.discussionId, record.logicalKey, JSON.stringify(record.value), record.status, record.authority, record.confidence, JSON.stringify(record.sourceRefs), record.version, record.createdBy, record.createdAt, record.updatedBy, record.updatedAt, record.expiresAt, record.supersedes, record.reason,
    )
  }

  clearProjection(roomId: string): void {
    this.db.raw.prepare('DELETE FROM room_ledger_records WHERE room_id = ?').run(roomId)
  }
}

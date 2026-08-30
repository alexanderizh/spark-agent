import type { SparkDatabase } from '../database.js'
import { BaseRepository } from './base.repository.js'

export interface ComputerActivityEventRow {
  id: string
  computer_session_id: string
  session_id: string
  turn_id: string
  seq: number
  event_type: string
  event_json: string
  created_at: string
}

export interface CreateComputerActivityEventParams {
  id: string
  computerSessionId: string
  sessionId: string
  turnId: string
  seq: number
  eventType: string
  event: Record<string, unknown>
  createdAt: string
}

export class ComputerActivityEventRepository extends BaseRepository {
  constructor(db: SparkDatabase) {
    super(db, 'computer_use_activity_events')
  }

  create(params: CreateComputerActivityEventParams): ComputerActivityEventRow {
    this.raw
      .prepare(
        `INSERT INTO computer_use_activity_events (
           id, computer_session_id, session_id, turn_id, seq, event_type, event_json, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        params.id,
        params.computerSessionId,
        params.sessionId,
        params.turnId,
        params.seq,
        params.eventType,
        this.toJson(params.event),
        params.createdAt,
      )
    const row = this.findById<ComputerActivityEventRow>(params.id)
    if (row == null) throw new Error(`Computer activity event ${params.id} was not persisted`)
    return row
  }

  listAfter(
    computerSessionId: string,
    afterSeq: number,
    limit: number,
  ): ComputerActivityEventRow[] {
    return this.raw
      .prepare(
        `SELECT * FROM computer_use_activity_events
         WHERE computer_session_id = ? AND seq > ?
         ORDER BY seq ASC
         LIMIT ?`,
      )
      .all(computerSessionId, afterSeq, limit) as ComputerActivityEventRow[]
  }

  nextSeq(computerSessionId: string): number {
    const row = this.raw
      .prepare(
        `SELECT COALESCE(MAX(seq) + 1, 0) AS next_seq
         FROM computer_use_activity_events
         WHERE computer_session_id = ?`,
      )
      .get(computerSessionId) as { next_seq: number }
    return row.next_seq
  }
}

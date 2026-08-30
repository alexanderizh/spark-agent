import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdirSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { SparkDatabase } from '../database.js'
import { RoomLedgerService } from '../room-ledger.service.js'

describe('Room Ledger discussion scope migration', () => {
  let db: SparkDatabase
  let dir: string

  beforeEach(() => {
    dir = join(tmpdir(), `spark-room-ledger-migration-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    mkdirSync(dir, { recursive: true })
    db = new SparkDatabase(join(dir, 'test.db'))
  })

  afterEach(() => {
    db.close()
    rmSync(dir, { recursive: true, force: true })
  })

  it('preserves 072/073 records and events while backfilling discussion scope', () => {
    const migrations = join(process.cwd(), 'migrations')
    db.raw.exec(readFileSync(join(migrations, '072_team_room_ledger.sql'), 'utf8'))
    db.raw.exec(readFileSync(join(migrations, '073_team_room_ledger_event_history.sql'), 'utf8'))
    const record = {
      id: 'record-1', roomId: 'room-1', discussionId: 'discussion-1', logicalKey: 'goal',
      value: 'ready', status: 'active', authority: 'system-observed', confidence: 1,
      sourceRefs: ['message-1'], version: 1, createdBy: 'system', createdAt: '2026-08-12T00:00:00.000Z',
      updatedBy: 'system', updatedAt: '2026-08-12T00:00:00.000Z', expiresAt: null,
      supersedes: null, reason: null,
    }
    db.raw.prepare(`INSERT INTO room_ledger_records
      (id, room_id, discussion_id, logical_key, value_json, status, authority, confidence,
       source_refs_json, version, created_by, created_at, updated_by, updated_at, expires_at,
       supersedes, reason, is_current)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`)
      .run(record.id, record.roomId, record.discussionId, record.logicalKey, JSON.stringify(record.value), record.status, record.authority, record.confidence, JSON.stringify(record.sourceRefs), record.version, record.createdBy, record.createdAt, record.updatedBy, record.updatedAt, record.expiresAt, record.supersedes, record.reason)
    db.raw.prepare(`INSERT INTO room_ledger_events
      (id, room_id, logical_key, op_id, operation, record_id, previous_record_id, record_json, actor_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run('event-1', record.roomId, record.logicalKey, 'op-1', 'create', record.id, null, JSON.stringify(record), 'system', record.createdAt)

    db.raw.exec(readFileSync(join(migrations, '074_room_ledger_discussion_scope.sql'), 'utf8'))

    expect(db.raw.prepare('SELECT id, discussion_id FROM room_ledger_records').all()).toEqual([
      { id: 'record-1', discussion_id: 'discussion-1' },
    ])
    expect(db.raw.prepare('SELECT id, discussion_id, record_json FROM room_ledger_events').all()).toEqual([
      { id: 'event-1', discussion_id: 'discussion-1', record_json: JSON.stringify(record) },
    ])

    const service = RoomLedgerService.forSystem(db)
    service.replay('room-1')
    expect(service.getCurrentProjection('room-1', 'discussion-1')).toEqual([record])
    expect(service.listEvents('room-1', 'discussion-1')).toHaveLength(1)
  })
})

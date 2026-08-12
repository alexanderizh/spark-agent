import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdirSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { SparkDatabase } from './database.js'

describe('Team P1 migration compatibility', () => {
  let db: SparkDatabase
  let dir: string

  beforeEach(() => {
    dir = join(tmpdir(), `spark-team-p1-migration-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    mkdirSync(dir, { recursive: true })
    db = new SparkDatabase(join(dir, 'test.db'))
  })

  afterEach(() => {
    db.close()
    rmSync(dir, { recursive: true, force: true })
  })

  it('upgrades a 074 database to handoff and steering tables without changing P0 data', () => {
    const migrations = join(process.cwd(), 'migrations')
    for (const name of [
      '072_team_room_ledger.sql',
      '073_team_room_ledger_event_history.sql',
      '074_room_ledger_discussion_scope.sql',
    ]) db.raw.exec(readFileSync(join(migrations, name), 'utf8'))

    db.raw.prepare(`INSERT INTO room_ledger_records
      (id, room_id, discussion_id, logical_key, value_json, status, authority, confidence, source_refs_json,
       version, created_by, created_at, updated_by, updated_at, is_current)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`).run(
      'record-1', 'team-room:session-a', 'discussion-a', 'goal', '"ship"', 'active', 'user-confirmed', 1,
      '[]', 1, 'user', '2026-08-13T00:00:00.000Z', 'user', '2026-08-13T00:00:00.000Z',
    )

    db.raw.exec(readFileSync(join(migrations, '075_team_typed_handoffs.sql'), 'utf8'))
    db.raw.exec(readFileSync(join(migrations, '076_team_steering_gates.sql'), 'utf8'))

    expect(db.raw.prepare('SELECT id, logical_key FROM room_ledger_records').all()).toEqual([
      { id: 'record-1', logical_key: 'goal' },
    ])
    expect(db.raw.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'team_%' ORDER BY name").all())
      .toEqual(expect.arrayContaining([
        { name: 'team_handoffs' }, { name: 'team_handoff_events' },
        { name: 'team_steering_gates' }, { name: 'team_steering_gate_events' },
      ]))
  })
})

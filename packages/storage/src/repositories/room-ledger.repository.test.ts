import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdirSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { SparkDatabase } from '../database.js'
import { RoomLedgerConflictError, RoomLedgerService } from '../room-ledger.service.js'

describe('RoomLedgerService', () => {
  let db: SparkDatabase
  let service: RoomLedgerService
  let testDir: string

  beforeEach(() => {
    testDir = join(tmpdir(), `spark-room-ledger-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    mkdirSync(testDir, { recursive: true })
    db = new SparkDatabase(join(testDir, 'test.db'))
    db.runMigrations(join(process.cwd(), 'migrations'))
    service = RoomLedgerService.forAgent(db)
  })

  afterEach(() => {
    db.close()
    rmSync(testDir, { recursive: true, force: true })
  })

  it('creates active context and returns the same revision for a repeated opId', () => {
    const input = {
      roomId: 'room-1', discussionId: 'discussion-1', logicalKey: 'deadline', value: 'Friday',
      authority: 'user-confirmed' as const, confidence: 1, sourceRefs: ['msg-1'],
      opId: 'op-create-1',
    }
    const first = service.create(input)
    const repeated = service.create(input)

    expect(repeated).toEqual(first)
    expect(service.getActiveContext('room-1', 'discussion-1')).toEqual([first])
  })

  it('rejects opId reuse across room, discussion, operation, or payload', () => {
    const first = service.create({
      roomId: 'room-1', discussionId: 'discussion-1', logicalKey: 'deadline', value: 'Friday',
      authority: 'user-confirmed', confidence: 1, sourceRefs: ['msg-1'], opId: 'op-collision',
    })
    expect(() => service.create({
      roomId: 'room-2', discussionId: 'discussion-1', logicalKey: 'deadline', value: 'Friday',
      authority: 'user-confirmed', confidence: 1, sourceRefs: ['msg-1'], opId: 'op-collision',
    })).toThrow(/opId|scope/i)
    expect(() => service.create({
      roomId: 'room-1', discussionId: 'discussion-2', logicalKey: 'deadline', value: 'Friday',
      authority: 'user-confirmed', confidence: 1, sourceRefs: ['msg-1'], opId: 'op-collision',
    })).toThrow(/opId|scope/i)
    expect(() => service.replace({
      roomId: first.roomId, ...(first.discussionId == null ? {} : { discussionId: first.discussionId }), logicalKey: first.logicalKey,
      value: 'Monday', expectedVersion: first.version, opId: 'op-collision',
    })).toThrow(/opId|operation|payload/i)
  })

  it.each([
    ['agent', 'agent-inferred', 'user-confirmed'],
    ['system', 'system-observed', 'user-confirmed'],
    ['user', 'user-confirmed', 'agent-inferred'],
  ] as const)('derives create/replace/correct/restore authority from the %s capability', (kind, expected, forged) => {
    const scoped = kind === 'agent'
      ? RoomLedgerService.forAgent(db, 'actor')
      : kind === 'system'
        ? RoomLedgerService.forSystem(db, 'actor')
        : RoomLedgerService.forUser(db, 'actor')
    const input = { roomId: 'room-authority', discussionId: kind, logicalKey: 'fact' }
    const created = scoped.create({ ...input, value: 'v1', authority: forged, opId: `${kind}-create` })
    const replaced = scoped.replace({ ...input, value: 'v2', authority: forged, expectedVersion: created.version, opId: `${kind}-replace` })
    const corrected = scoped.correct({ ...input, value: 'v3', authority: forged, expectedVersion: replaced.version, opId: `${kind}-correct` })
    const expired = scoped.expire({ ...input, expectedVersion: corrected.version, opId: `${kind}-expire` })
    const restored = scoped.restore({ ...input, authority: forged, expectedVersion: expired.version, opId: `${kind}-restore` })

    expect([created, replaced, corrected, restored].map((record) => record.authority)).toEqual([
      expected,
      expected,
      expected,
      expected,
    ])
  })

  it.each([
    ['agent', 'system'],
    ['agent', 'user'],
    ['system', 'user'],
  ] as const)('does not let %s capability overwrite a %s-confirmed record', (lower, higher) => {
    const owner = higher === 'user'
      ? RoomLedgerService.forUser(db, 'owner')
      : RoomLedgerService.forSystem(db, 'owner')
    const attacker = lower === 'agent'
      ? RoomLedgerService.forAgent(db, 'attacker')
      : RoomLedgerService.forSystem(db, 'attacker')
    const input = { roomId: 'room-rank', discussionId: `${lower}-${higher}`, logicalKey: 'fact' }
    const created = owner.create({ ...input, value: 'trusted', opId: `${lower}-${higher}-create` })

    expect(() => attacker.correct({
      ...input,
      value: 'forged',
      authority: 'user-confirmed',
      expectedVersion: created.version,
      opId: `${lower}-${higher}-correct`,
    })).toThrow(/authority|capability/i)
  })

  it('rejects a stale expectedVersion without silently overwriting the current revision', () => {
    const created = service.create({ roomId: 'room-1', logicalKey: 'owner', value: 'A', authority: 'system-observed', confidence: .8, sourceRefs: [], opId: 'op-1' })
    service.replace({ roomId: 'room-1', logicalKey: 'owner', value: 'B', authority: 'system-observed', confidence: .8, sourceRefs: [], opId: 'op-2', expectedVersion: created.version })

    expect(() => service.replace({ roomId: 'room-1', logicalKey: 'owner', value: 'C', authority: 'system-observed', confidence: .8, sourceRefs: [], opId: 'op-3', expectedVersion: created.version })).toThrow(RoomLedgerConflictError)
    expect(service.getActiveContext('room-1')).toHaveLength(1)
    expect(service.getActiveContext('room-1')[0]!.value).toBe('B')
  })

  it('rejects a mutation when the current record or discussion changed after the UI snapshot', () => {
    db.raw.prepare(`INSERT INTO sessions (id, kind, title, status, project_id, workspace_ids_json, created_at, updated_at) VALUES ('session-1', 'chat', 'Test', 'active', 'project-1', '[]', '2026-08-12T00:00:00.000Z', '2026-08-12T00:00:00.000Z')`).run()
    db.raw.prepare(`INSERT INTO team_discussions (id, session_id, host_agent_id, round_index, max_rounds, state, started_at) VALUES ('discussion-1', 'session-1', 'host', 0, 6, 'concluded', '2026-08-12T00:00:00.000Z')`).run()
    const created = service.create({ roomId: 'room-1', discussionId: 'discussion-1', logicalKey: 'owner', value: 'A', status: 'proposed', opId: 'op-scope-1' })
    db.raw.prepare(`INSERT INTO team_discussions (id, session_id, host_agent_id, round_index, max_rounds, state, started_at) VALUES ('discussion-2', 'session-1', 'host', 0, 6, 'active', '2026-08-12T00:01:00.000Z')`).run()

    expect(() => service.confirm({
      roomId: 'room-1', discussionId: 'discussion-2', logicalKey: 'owner', opId: 'op-scope-2',
      expectedVersion: created.version, expectedRecordId: created.id, expectedSessionId: 'session-1', expectedDiscussionId: 'discussion-1',
    })).toThrow(RoomLedgerConflictError)
    expect(service.listEvents('room-1')).toHaveLength(1)
  })

  it('creates a correction chain and keeps superseded history', () => {
    const original = service.create({ roomId: 'room-1', logicalKey: 'plan', value: 'v1', authority: 'agent-inferred', confidence: .4, sourceRefs: ['m1'], opId: 'op-1' })
    const corrected = service.correct({ roomId: 'room-1', logicalKey: 'plan', value: 'v2', authority: 'user-confirmed', confidence: 1, sourceRefs: ['m2'], opId: 'op-2', expectedVersion: 1, reason: 'user correction' })

    expect(corrected.version).toBe(2)
    expect(corrected.supersedes).toBe(original.id)
    expect(service.listHistory('room-1', 'plan').map((r) => r.status)).toEqual(['superseded', 'active'])
  })

  it('reads only bounded current projection rows for one discussion as history grows', () => {
    for (let index = 0; index < 30; index += 1) {
      service.create({ roomId: 'room-1', discussionId: 'discussion-1', logicalKey: `key-${index}`, value: index, opId: `op-current-${index}` })
    }
    for (let version = 0; version < 20; version += 1) {
      const current = service.getCurrentProjection('room-1', 'discussion-1', 100).find((record) => record.logicalKey === 'key-0')!
      service.replace({ roomId: 'room-1', discussionId: 'discussion-1', logicalKey: 'key-0', value: version, opId: `op-history-${version}`, expectedVersion: current.version })
    }
    service.create({ roomId: 'room-1', discussionId: 'discussion-2', logicalKey: 'foreign', value: true, opId: 'op-foreign' })

    const projection = service.getCurrentProjection('room-1', 'discussion-1', 12)
    expect(projection).toHaveLength(12)
    expect(projection.every((record) => record.discussionId === 'discussion-1')).toBe(true)
    expect(projection.filter((record) => record.logicalKey === 'key-0')).toHaveLength(1)
  })

  it('applies a stable SQL limit when reading active context', () => {
    for (let index = 0; index < 5; index += 1) {
      service.create({
        roomId: 'room-active-limit', discussionId: 'discussion-1', logicalKey: `key-${index}`,
        value: index, opId: `active-limit-${index}`,
      })
    }

    expect(service.getActiveContext('room-active-limit', 'discussion-1', 1).map((record) => record.logicalKey)).toEqual(['key-0'])
  })

  it('caps current keys per discussion without blocking revisions or another discussion', () => {
    const scoped = RoomLedgerService.forAgent(db)
    for (let index = 0; index < 100; index += 1) {
      scoped.create({
        roomId: 'room-quota', discussionId: 'discussion-1', logicalKey: `key-${index}`,
        value: index, opId: `quota-create-${index}`,
      })
    }

    expect(() => scoped.create({
      roomId: 'room-quota', discussionId: 'discussion-1', logicalKey: 'key-100',
      value: 100, opId: 'quota-overflow',
    })).toThrow(/limit|quota/i)

    const revised = scoped.replace({
      roomId: 'room-quota', discussionId: 'discussion-1', logicalKey: 'key-0',
      value: 'revised', expectedVersion: 1, opId: 'quota-revision',
    })
    expect(revised.version).toBe(2)
    expect(scoped.create({
      roomId: 'room-quota', discussionId: 'discussion-2', logicalKey: 'key-100',
      value: 'independent', opId: 'quota-other-discussion',
    }).version).toBe(1)
  })

  it('isolates the same logical key across discussions through governance and replay', () => {
    const d1 = service.create({
      roomId: 'room-1', discussionId: 'discussion-1', logicalKey: 'goal', value: 'draft-d1',
      status: 'proposed', opId: 'op-d1-create',
    })
    const d2 = service.create({
      roomId: 'room-1', discussionId: 'discussion-2', logicalKey: 'goal', value: 'active-d2',
      opId: 'op-d2-create',
    })

    const confirmedD1 = service.confirm({
      roomId: 'room-1', discussionId: 'discussion-1', logicalKey: 'goal',
      expectedVersion: d1.version, expectedRecordId: d1.id, expectedDiscussionId: 'discussion-1',
      opId: 'op-d1-confirm',
    })

    expect(service.getCurrentProjection('room-1', 'discussion-1')).toEqual([confirmedD1])
    expect(service.getCurrentProjection('room-1', 'discussion-2')).toEqual([d2])
    expect(service.getActiveContext('room-1', 'discussion-1')).toEqual([confirmedD1])
    expect(service.getActiveContext('room-1', 'discussion-2')).toEqual([d2])

    service.replay('room-1')

    expect(service.getCurrentProjection('room-1', 'discussion-1')).toEqual([confirmedD1])
    expect(service.getCurrentProjection('room-1', 'discussion-2')).toEqual([d2])
    expect(service.listEvents('room-1').map((event) => event.record.discussionId)).toEqual([
      'discussion-1',
      'discussion-2',
      'discussion-1',
    ])
  })

  it('removes invalidated and deleted facts from active context while preserving history', () => {
    const created = service.create({ roomId: 'room-1', logicalKey: 'fact', value: true, authority: 'system-observed', confidence: .9, sourceRefs: [], opId: 'op-1' })
    const invalidated = service.invalidate({ roomId: 'room-1', logicalKey: 'fact', opId: 'op-2', expectedVersion: created.version, reason: 'contradicted' })

    expect(invalidated.status).toBe('invalid')
    expect(service.getActiveContext('room-1')).toEqual([])
    expect(service.listHistory('room-1', 'fact')).toHaveLength(2)
  })

  it('rejects an inferred agent attempting to replace a user-confirmed active fact', () => {
    const owner = RoomLedgerService.forUser(db, 'owner')
    const created = owner.create({ roomId: 'room-1', logicalKey: 'policy', value: 'strict', confidence: 1, sourceRefs: [], opId: 'op-1' })

    expect(() => service.replace({ roomId: 'room-1', logicalKey: 'policy', value: 'loose', authority: 'agent-inferred', confidence: .7, sourceRefs: [], opId: 'op-2', expectedVersion: created.version })).toThrow(/user-confirmed/)
    expect(service.getActiveContext('room-1')[0]!.value).toBe('strict')
  })

  it('replays the event log into an equivalent active projection', () => {
    const created = service.create({ roomId: 'room-1', logicalKey: 'status', value: 'draft', authority: 'system-observed', confidence: .6, sourceRefs: [], opId: 'op-1' })
    service.replace({ roomId: 'room-1', logicalKey: 'status', value: 'ready', authority: 'system-observed', confidence: .9, sourceRefs: ['m2'], opId: 'op-2', expectedVersion: created.version })
    const before = service.getActiveContext('room-1')

    service.replay('room-1')

    expect(service.getActiveContext('room-1')).toEqual(before)
    expect(service.listEvents('room-1')).toHaveLength(2)
  })

  it('rebuilds from an event snapshot taken after a concurrent append', () => {
    const created = service.create({ roomId: 'room-1', logicalKey: 'status', value: 'draft', authority: 'system-observed', confidence: .6, sourceRefs: [], opId: 'op-1' })
    const concurrentService = RoomLedgerService.forSystem(db, 'system-2')
    service = RoomLedgerService.forSystem(db, 'system-1', {
      beforeReplayTransaction: () => {
        concurrentService.replace({ roomId: 'room-1', logicalKey: 'status', value: 'ready', authority: 'system-observed', confidence: .9, sourceRefs: [], opId: 'op-concurrent', expectedVersion: created.version })
      },
    })

    service.replay('room-1')

    expect(service.getActiveContext('room-1')[0]!.value).toBe('ready')
    expect(service.listEvents('room-1').map((event) => event.opId)).toEqual(['op-1', 'op-concurrent'])
  })

  it('does not let a mutation authority bypass the trusted agent actor context', () => {
    const owner = RoomLedgerService.forUser(db, 'owner')
    const created = owner.create({ roomId: 'room-1', logicalKey: 'policy', value: 'strict', confidence: 1, sourceRefs: [], opId: 'op-1' })

    expect(() => service.replace({ roomId: 'room-1', logicalKey: 'policy', value: 'loose', authority: 'system-observed', confidence: .7, sourceRefs: [], opId: 'op-2', expectedVersion: created.version })).toThrow(/user-confirmed/)
    expect(service.getActiveContext('room-1')[0]!.value).toBe('strict')
  })

  it('excludes records whose expiry is in the past from active context', () => {
    service = RoomLedgerService.forAgent(db, 'agent', { now: () => new Date('2026-08-12T00:00:00.000Z') })
    service.create({ roomId: 'room-1', logicalKey: 'temporary', value: true, authority: 'system-observed', confidence: .8, sourceRefs: [], opId: 'op-1', expiresAt: '2026-08-11T23:59:59.000Z' })

    expect(service.getActiveContext('room-1')).toEqual([])
  })

  it('supports proposed confirmation, rejection, expiry, restore, and rejects illegal transitions', () => {
    const proposed = service.create({ roomId: 'room-1', logicalKey: 'decision', value: 'draft', authority: 'agent-inferred', confidence: .4, sourceRefs: [], opId: 'op-1', status: 'proposed' })
    const confirmed = service.confirm({ roomId: 'room-1', logicalKey: 'decision', opId: 'op-2', expectedVersion: proposed.version })
    expect(confirmed.status).toBe('active')

    const rejected = service.create({ roomId: 'room-1', logicalKey: 'rejected-decision', value: 'no', authority: 'agent-inferred', confidence: .4, sourceRefs: [], opId: 'op-rejected', status: 'proposed' })
    expect(service.reject({ roomId: 'room-1', logicalKey: 'rejected-decision', opId: 'op-reject', expectedVersion: rejected.version }).status).toBe('rejected')

    const expired = service.expire({ roomId: 'room-1', logicalKey: 'decision', opId: 'op-3', expectedVersion: confirmed.version })
    expect(expired.status).toBe('expired')
    expect(service.getActiveContext('room-1')).toEqual([])

    const restored = service.restore({ roomId: 'room-1', logicalKey: 'decision', opId: 'op-4', expectedVersion: expired.version })
    expect(restored.status).toBe('active')
    expect(() => service.reject({ roomId: 'room-1', logicalKey: 'decision', opId: 'op-5', expectedVersion: restored.version })).toThrow(/transition/)
  })

  it('allows restore to explicitly clear an expired timestamp', () => {
    service = RoomLedgerService.forAgent(db, 'agent', { now: () => new Date('2026-08-12T00:00:00.000Z') })
    const created = service.create({ roomId: 'room-1', logicalKey: 'temporary', value: true, authority: 'system-observed', confidence: .8, sourceRefs: [], opId: 'op-expiring', expiresAt: '2026-08-11T23:59:59.000Z' })
    const expired = service.expire({ roomId: 'room-1', logicalKey: 'temporary', opId: 'op-expire', expectedVersion: created.version })

    const restored = service.restore({ roomId: 'room-1', logicalKey: 'temporary', opId: 'op-restore', expectedVersion: expired.version, expiresAt: null })

    expect(restored.expiresAt).toBeNull()
    expect(service.getActiveContext('room-1')).toEqual([restored])
  })

  it('retains the existing expiry when restore omits expiresAt', () => {
    const created = service.create({ roomId: 'room-1', logicalKey: 'temporary', value: true, authority: 'system-observed', confidence: .8, sourceRefs: [], opId: 'op-expiring', expiresAt: '2099-08-11T23:59:59.000Z' })
    const expired = service.expire({ roomId: 'room-1', logicalKey: 'temporary', opId: 'op-expire', expectedVersion: created.version })

    const restored = service.restore({ roomId: 'room-1', logicalKey: 'temporary', opId: 'op-restore', expectedVersion: expired.version })

    expect(restored.expiresAt).toBe(created.expiresAt)
  })

  it('keeps the default agent authority when a caller passes a forged mutation actor', () => {
    const owner = RoomLedgerService.forUser(db, 'owner')
    const created = owner.create({ roomId: 'room-1', logicalKey: 'policy', value: 'strict', confidence: 1, sourceRefs: [], opId: 'op-forged-1' })

    expect(() => Reflect.apply(service.replace, service, [{ roomId: 'room-1', logicalKey: 'policy', value: 'loose', authority: 'system-observed', confidence: .7, sourceRefs: [], opId: 'op-forged-2', expectedVersion: created.version }, { actorId: 'attacker', authority: 'user-confirmed' }])).toThrow(/user-confirmed/)
    expect(service.getActiveContext('room-1')[0]!.value).toBe('strict')
  })
})

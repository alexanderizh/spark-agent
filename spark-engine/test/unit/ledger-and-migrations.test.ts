import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { JsonlSessionStore, SessionLedger, encodeProjectDir } from '../../src/events/ledger.js'
import { decodeLine } from '../../src/events/migrations.js'
import { SteppingClock } from '../../src/kernel/clock.js'

const temporaryDirectories: string[] = []

afterEach(async () => {
  for (const directory of temporaryDirectories.splice(0)) {
    await rm(directory, { recursive: true, force: true })
  }
})

describe('ledger durability and schema migration boundaries', () => {
  it('serializes concurrent appends into a contiguous JSONL sequence', async () => {
    const root = await mkdtemp(join(tmpdir(), 'spark-ledger-'))
    temporaryDirectories.push(root)
    const store = new JsonlSessionStore({
      dataRoot: root,
      projectDir: '/workspace',
      fsync: 'always',
    })
    const ledger = new SessionLedger('session1', store, new SteppingClock())
    await Promise.all(
      Array.from({ length: 20 }, (_, index) =>
        ledger.append({
          type: 'turn.queued',
          schemaVersion: 1,
          turnId: `turn${index}`,
        }),
      ),
    )
    const events = []
    for await (const event of ledger.read()) events.push(event)
    expect(events.map((event) => event.seq)).toEqual(
      Array.from({ length: 20 }, (_, index) => index),
    )
    const project = encodeProjectDir('/workspace')
    const disk = await readFile(join(root, 'projects', project, 'session1', 'events.jsonl'), 'utf8')
    expect(disk.trim().split('\n')).toHaveLength(20)
  })

  it('rejects future schemas loudly instead of misreading them', () => {
    expect(() => decodeLine('{"schemaVersion":2,"type":"turn.started"}')).toThrow(
      'requires a newer engine',
    )
  })

  it('uses a readable project key with a collision-resistant suffix', () => {
    expect(encodeProjectDir('/a/b')).not.toBe(encodeProjectDir('/a-b'))
    expect(encodeProjectDir('/a/b')).toMatch(/-[a-f0-9]{12}$/)
  })

  it('extracts a first-input preview for session listings', async () => {
    const root = await mkdtemp(join(tmpdir(), 'spark-ledger-'))
    temporaryDirectories.push(root)
    const store = new JsonlSessionStore({
      dataRoot: root,
      projectDir: '/workspace',
      fsync: 'always',
    })
    const ledger = new SessionLedger('sessionA', store, new SteppingClock())
    await ledger.append({
      type: 'turn.started',
      schemaVersion: 1,
      turnId: 'turn1',
      input: { kind: 'text', text: '  hello   world  ' },
    })
    await ledger.append({
      type: 'turn.started',
      schemaVersion: 1,
      turnId: 'turn2',
      input: { kind: 'text', text: 'second turn' },
    })
    const sessions = await store.list(null)
    expect(sessions).toHaveLength(1)
    expect(sessions[0]?.preview).toBe('hello world')
  })

  it('truncates long previews and omits sessions without user input', async () => {
    const root = await mkdtemp(join(tmpdir(), 'spark-ledger-'))
    temporaryDirectories.push(root)
    const store = new JsonlSessionStore({
      dataRoot: root,
      projectDir: '/workspace',
      fsync: 'always',
    })
    const longInput = 'x'.repeat(120)
    const withLongTurn = new SessionLedger('sessionLong', store, new SteppingClock())
    await withLongTurn.append({
      type: 'turn.started',
      schemaVersion: 1,
      turnId: 'turn1',
      input: { kind: 'text', text: longInput },
    })
    const withoutTurn = new SessionLedger('sessionEmpty', store, new SteppingClock())
    await withoutTurn.append({ type: 'turn.queued', schemaVersion: 1, turnId: 'turnX' })
    const sessions = await store.list(null)
    const long = sessions.find((session) => session.sessionId === 'sessionLong')
    const empty = sessions.find((session) => session.sessionId === 'sessionEmpty')
    expect(long?.preview).toBe(`${'x'.repeat(80)}…`)
    expect(empty?.preview).toBeUndefined()
  })

  it('hides task subagent ledgers from normal session listings but exposes them on request', async () => {
    const root = await mkdtemp(join(tmpdir(), 'spark-ledger-'))
    temporaryDirectories.push(root)
    const store = new JsonlSessionStore({
      dataRoot: root,
      projectDir: '/workspace',
      fsync: 'always',
    })
    const parent = new SessionLedger('parent', store, new SteppingClock())
    await parent.append({
      type: 'session.started',
      schemaVersion: 1,
      engineVersion: 'test',
      cwd: '/workspace',
      configSnapshot: '{"permissionMode":"manual"}',
    })
    const child = new SessionLedger('child', store, new SteppingClock())
    await child.append({
      type: 'session.started',
      schemaVersion: 1,
      engineVersion: 'test',
      cwd: '/workspace',
      configSnapshot: '{"kind":"subagent","parentSessionId":"parent"}',
    })

    const visible = await store.list(null)
    expect(visible.map((session) => session.sessionId)).toEqual(['parent'])
    expect(visible[0]?.kind).toBe('main')

    const all = await store.list(null, { includeSubagents: true })
    expect(all.map((session) => session.sessionId)).toEqual(['child', 'parent'])
    expect(all[0]).toMatchObject({ kind: 'subagent', parentSessionId: 'parent' })
  })
})

import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { SessionKvStore } from '../../src/kernel/session-kv.js'

let root: string | undefined

async function tempRoot(): Promise<string> {
  root = await mkdtemp(join(tmpdir(), 'spark-session-kv-'))
  return root
}

afterEach(async () => {
  if (root !== undefined) {
    await rm(root, { recursive: true, force: true })
    root = undefined
  }
})

describe('SessionKvStore', () => {
  it('creates then replaces an attachment idempotently', async () => {
    const store = new SessionKvStore({ stateRoot: await tempRoot(), now: () => 1_000 })
    const first = await store.set('session-1', 'task-state', 'counter', { value: 1 })
    expect(first.outcome).toBe('created')
    expect(first.attachment.payload).toEqual({ value: 1 })

    const second = await store.set('session-1', 'task-state', 'counter', { value: 2 })
    expect(second.outcome).toBe('existing')
    expect(second.attachment.id).toBe(first.attachment.id)
    expect(second.attachment.payload).toEqual({ value: 2 })
  })

  it('lists across types, filters by type, and isolates sessions', async () => {
    let tick = 1_000
    const store = new SessionKvStore({ stateRoot: await tempRoot(), now: () => (tick += 1) })
    await store.set('session-1', 'task-state', 'a', 1)
    await store.set('session-1', 'user-pref', 'b', 'x')
    await store.set('session-2', 'task-state', 'a', 99)

    expect((await store.list('session-1')).map((entry) => entry.identityKey)).toEqual(['a', 'b'])
    expect(await store.list('session-1', { attachmentType: 'user-pref' })).toHaveLength(1)
    expect(await store.list('session-2')).toHaveLength(1)
  })

  it('survives store recreation from the same state root (resume semantics)', async () => {
    const stateRoot = await tempRoot()
    const first = new SessionKvStore({ stateRoot })
    await first.set('session-1', 'task-state', 'progress', { step: 3 })

    const resumed = new SessionKvStore({ stateRoot })
    const entries = await resumed.list('session-1')
    expect(entries).toHaveLength(1)
    expect(entries[0]?.payload).toEqual({ step: 3 })
  })

  it('removes an attachment and tolerates missing entries', async () => {
    const store = new SessionKvStore({ stateRoot: await tempRoot() })
    await store.set('session-1', 'task-state', 'gone', true)
    await store.remove('session-1', 'task-state', 'gone')
    expect(await store.list('session-1')).toHaveLength(0)
    await expect(store.remove('session-1', 'task-state', 'gone')).resolves.toBeUndefined()
  })

  it('rejects oversized payloads and invalid keys', async () => {
    const store = new SessionKvStore({ stateRoot: await tempRoot() })
    await expect(
      store.set('session-1', 'task-state', 'big', { blob: 'x'.repeat(600_000) }),
    ).rejects.toThrow(/too large/u)
    await expect(store.set('session-1', '', 'key', 1)).rejects.toThrow(/attachment type/u)
    await expect(store.set('session-1', 'type', '', 1)).rejects.toThrow(/identity key/u)
  })

  it('keeps dot-segment ids inside the state root (path-escape defense)', async () => {
    const stateRoot = await tempRoot()
    const store = new SessionKvStore({ stateRoot, now: () => 1_000 })
    // ".."、"."、前导点段不得拼出 stateRoot 之外的路径；统一收进目录内。
    await store.set('..', 'task-state', 'escape', 1)
    await store.set('.', 'task-state', 'escape', 2)
    await store.set('.hidden/session', 'task-state', 'k', 3)
    expect(await store.list('..')).toEqual([
      expect.objectContaining({ payload: 1, identityKey: 'escape' }),
    ])
    expect(await store.list('.')).toEqual([
      expect.objectContaining({ payload: 2, identityKey: 'escape' }),
    ])
    // stateRoot 本层不落任何附件文件（全部进子目录）
    const { readdir } = await import('node:fs/promises')
    const top = await readdir(stateRoot)
    for (const name of top) expect(name.endsWith('.json')).toBe(false)
  })
})

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { WorkspaceSnapshotService } from './workspace-snapshot.service.js'

describe('WorkspaceSnapshotService', () => {
  let root: string
  let service: WorkspaceSnapshotService

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'spark-snap-'))
    service = new WorkspaceSnapshotService()
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  it('snapshots files and respects ignore patterns', async () => {
    await writeFile(join(root, 'a.txt'), 'hello')
    await mkdir(join(root, 'node_modules'))
    await writeFile(join(root, 'node_modules', 'dep.js'), 'x')
    await mkdir(join(root, '.spark-artifacts'))
    await writeFile(join(root, '.spark-artifacts', 'img.png'), 'x')

    const snap = await service.snapshot(root)
    expect(snap.has('a.txt')).toBe(true)
    expect(snap.has('node_modules/dep.js')).toBe(false)
    expect(snap.has('.spark-artifacts/img.png')).toBe(false)
  })

  it('diff detects added / modified / deleted', async () => {
    await writeFile(join(root, 'keep.txt'), 'init')
    await writeFile(join(root, 'gone.txt'), 'bye')
    const before = await service.snapshot(root)

    await writeFile(join(root, 'keep.txt'), 'changed content')
    await rm(join(root, 'gone.txt'))
    await writeFile(join(root, 'fresh.txt'), 'new')
    const after = await service.snapshot(root)

    const d = service.diff(before, after)
    expect(d.added).toContain('fresh.txt')
    expect(d.modified).toContain('keep.txt')
    expect(d.deleted).toContain('gone.txt')
  })

  it('diff is empty when nothing changed', async () => {
    await writeFile(join(root, 'x.txt'), 'same')
    const before = await service.snapshot(root)
    const after = await service.snapshot(root)
    const d = service.diff(before, after)
    expect(d.added).toHaveLength(0)
    expect(d.modified).toHaveLength(0)
    expect(d.deleted).toHaveLength(0)
  })
})

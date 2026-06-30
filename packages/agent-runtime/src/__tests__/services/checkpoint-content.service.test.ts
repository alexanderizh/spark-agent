import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CheckpointContentService } from '../../services/checkpoint-content.service.js'

describe('CheckpointContentService', () => {
  let root: string
  let workspace: string
  let store: string
  let svc: CheckpointContentService

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'spark-ckpt-'))
    workspace = join(root, 'ws')
    store = join(root, 'store')
    mkdirSync(workspace, { recursive: true })
    mkdirSync(join(workspace, 'src'), { recursive: true })
    writeFileSync(join(workspace, 'a.txt'), 'A1')
    writeFileSync(join(workspace, 'src', 'b.ts'), 'B1')
    mkdirSync(join(workspace, 'node_modules'), { recursive: true })
    writeFileSync(join(workspace, 'node_modules', 'dep.js'), 'IGNORED')
    svc = new CheckpointContentService(store)
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  it('snapshots controlled files and ignores node_modules', async () => {
    const res = await svc.snapshot(workspace, 'sess-1', 'cp-1')
    expect(res.filePaths.sort()).toEqual(['a.txt', join('src', 'b.ts')].sort())
    expect(res.truncated).toBe(false)
    // node_modules not copied
    expect(existsSync(join(res.storageDir, 'node_modules', 'dep.js'))).toBe(false)
  })

  it('restore reverts modified + deletes files added after the checkpoint', async () => {
    await svc.snapshot(workspace, 'sess-1', 'cp-1')
    // mutate workspace: modify a.txt, delete b.ts, add c.txt
    writeFileSync(join(workspace, 'a.txt'), 'A-CHANGED')
    rmSync(join(workspace, 'src', 'b.ts'))
    writeFileSync(join(workspace, 'c.txt'), 'NEW')

    const out = await svc.restore(workspace, 'sess-1', 'cp-1')

    expect(readFileSync(join(workspace, 'a.txt'), 'utf8')).toBe('A1') // reverted
    expect(readFileSync(join(workspace, 'src', 'b.ts'), 'utf8')).toBe('B1') // restored
    expect(existsSync(join(workspace, 'c.txt'))).toBe(false) // deleted (added after checkpoint)
    expect(out.deletedFiles).toContain('c.txt')
    expect(out.restoredFiles.sort()).toEqual(['a.txt', join('src', 'b.ts')].sort())
  })

  it('prune keeps only the given checkpoint ids', async () => {
    await svc.snapshot(workspace, 'sess-1', 'cp-1')
    await svc.snapshot(workspace, 'sess-1', 'cp-2')
    await svc.snapshot(workspace, 'sess-1', 'cp-3')
    await svc.prune('sess-1', ['cp-3', 'cp-2'])
    expect(existsSync(svc.checkpointDir('sess-1', 'cp-1'))).toBe(false)
    expect(existsSync(svc.checkpointDir('sess-1', 'cp-2'))).toBe(true)
    expect(existsSync(svc.checkpointDir('sess-1', 'cp-3'))).toBe(true)
  })
})

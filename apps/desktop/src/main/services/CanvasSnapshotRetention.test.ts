import { mkdtemp, mkdir, readdir, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  CANVAS_SNAPSHOT_KEEP,
  CANVAS_SNAPSHOT_KEEP_ON_EXIT,
  pruneCanvasSnapshots,
} from './CanvasSnapshotRetention.js'

const DAY_MS = 24 * 60 * 60 * 1000

async function createSnapshotsDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'canvas-snapshots-test-'))
}

async function createSnapshot(
  snapshotsDir: string,
  name: string,
  mtime: Date,
): Promise<void> {
  await writeFile(join(snapshotsDir, name), JSON.stringify({ kind: 'snapshot', name }), 'utf-8')
  await utimes(join(snapshotsDir, name), mtime, mtime)
}

describe('pruneCanvasSnapshots', () => {
  it('只保留最近 keep 份时间戳快照', async () => {
    const snapshotsDir = await createSnapshotsDir()
    const base = Date.now() - 30 * DAY_MS
    for (let index = 0; index < 14; index += 1) {
      await createSnapshot(
        snapshotsDir,
        `2026-08-${String(index + 1).padStart(2, '0')}T10-00-00-000Z.json`,
        new Date(base + index * DAY_MS),
      )
    }

    const removed = await pruneCanvasSnapshots(snapshotsDir)

    expect(removed).toHaveLength(4)
    const remaining = (await readdir(snapshotsDir)).sort()
    expect(remaining).toHaveLength(CANVAS_SNAPSHOT_KEEP)
    // 最旧的 4 份被删，最新 10 份保留
    expect(remaining[0]).toBe('2026-08-05T10-00-00-000Z.json')
    expect(remaining.at(-1)).toBe('2026-08-14T10-00-00-000Z.json')
  })

  it('latest.json 与非时间戳文件永不删除', async () => {
    const snapshotsDir = await createSnapshotsDir()
    const base = Date.now() - 30 * DAY_MS
    for (let index = 0; index < 12; index += 1) {
      await createSnapshot(
        snapshotsDir,
        `2026-08-${String(index + 1).padStart(2, '0')}T10-00-00-000Z.json`,
        new Date(base + index * DAY_MS),
      )
    }
    await writeFile(join(snapshotsDir, 'latest.json'), '{}', 'utf-8')
    await writeFile(join(snapshotsDir, 'notes.txt'), 'keep me', 'utf-8')

    await pruneCanvasSnapshots(snapshotsDir)

    const remaining = (await readdir(snapshotsDir)).sort()
    expect(remaining).toContain('latest.json')
    expect(remaining).toContain('notes.txt')
    expect(remaining.filter((name) => name.endsWith('.json') && name !== 'latest.json')).toHaveLength(CANVAS_SNAPSHOT_KEEP)
  })

  it('数量未超上限时不删除任何文件', async () => {
    const snapshotsDir = await createSnapshotsDir()
    await createSnapshot(snapshotsDir, '2026-08-26T10-00-00-000Z.json', new Date())
    await createSnapshot(snapshotsDir, '2026-08-27T10-00-00-000Z.json', new Date())

    const removed = await pruneCanvasSnapshots(snapshotsDir)

    expect(removed).toEqual([])
    expect(await readdir(snapshotsDir)).toHaveLength(2)
  })

  it('目录不存在时返回空列表且不报错', async () => {
    const removed = await pruneCanvasSnapshots(join(tmpdir(), 'canvas-snapshots-missing'))

    expect(removed).toEqual([])
  })

  it('keep 小于 1 时直接跳过', async () => {
    const snapshotsDir = await createSnapshotsDir()
    await mkdir(snapshotsDir, { recursive: true })
    await createSnapshot(snapshotsDir, '2026-08-27T10-00-00-000Z.json', new Date())

    const removed = await pruneCanvasSnapshots(snapshotsDir, 0)

    expect(removed).toEqual([])
    expect(await readdir(snapshotsDir)).toHaveLength(1)
  })

  it('退出编辑场景收紧到 CANVAS_SNAPSHOT_KEEP_ON_EXIT 份', async () => {
    const snapshotsDir = await createSnapshotsDir()
    const base = Date.now() - 30 * DAY_MS
    for (let index = 0; index < 6; index += 1) {
      await createSnapshot(
        snapshotsDir,
        `2026-08-${String(index + 1).padStart(2, '0')}T10-00-00-000Z.json`,
        new Date(base + index * DAY_MS),
      )
    }
    await writeFile(join(snapshotsDir, 'latest.json'), '{}', 'utf-8')

    const removed = await pruneCanvasSnapshots(snapshotsDir, CANVAS_SNAPSHOT_KEEP_ON_EXIT)

    expect(removed).toHaveLength(4)
    const remaining = (await readdir(snapshotsDir)).sort()
    expect(remaining).toEqual(['2026-08-05T10-00-00-000Z.json', '2026-08-06T10-00-00-000Z.json', 'latest.json'])
    expect(CANVAS_SNAPSHOT_KEEP_ON_EXIT).toBeLessThan(CANVAS_SNAPSHOT_KEEP)
  })
})

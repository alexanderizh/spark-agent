import * as fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { getUntrackedFileLineStats, getUntrackedFilesLineStats } from './git-status-utils.js'

const tempDirs: string[] = []

async function createTempDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'spark-git-status-'))
  tempDirs.push(dir)
  return dir
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })))
})

describe('untracked Git file line statistics', () => {
  it('counts text lines with and without a trailing newline', async () => {
    const root = await createTempDir()
    await fs.writeFile(path.join(root, 'with-newline.txt'), 'first\nsecond\n')
    await fs.writeFile(path.join(root, 'without-newline.txt'), 'first\nsecond')

    await expect(getUntrackedFileLineStats(root, 'with-newline.txt')).resolves.toEqual({
      additions: 2,
      deletions: 0,
    })
    await expect(getUntrackedFileLineStats(root, 'without-newline.txt')).resolves.toEqual({
      additions: 2,
      deletions: 0,
    })
  })

  it('returns zero text lines for empty and binary files', async () => {
    const root = await createTempDir()
    await fs.writeFile(path.join(root, 'empty.txt'), '')
    await fs.writeFile(path.join(root, 'binary.bin'), Buffer.from([1, 2, 0, 3, 10]))

    const stats = await getUntrackedFilesLineStats(root, ['empty.txt', 'binary.bin'])
    expect(stats.get('empty.txt')).toEqual({ additions: 0, deletions: 0 })
    expect(stats.get('binary.bin')).toEqual({ additions: 0, deletions: 0 })
  })

  it('does not read paths outside the workspace', async () => {
    const root = await createTempDir()
    await expect(getUntrackedFileLineStats(root, '../outside.txt')).resolves.toEqual({
      additions: 0,
      deletions: 0,
    })
  })
})

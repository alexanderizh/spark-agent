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

  it('skips files larger than the size cap instead of scanning them', async () => {
    const root = await createTempDir()
    // 写一个超过 2MB 上限的文本文件：若被扫描会返回真实行数，此处必须返回 0。
    await fs.writeFile(path.join(root, 'large.txt'), 'x\n'.repeat(1024 * 1024 + 8))

    await expect(getUntrackedFileLineStats(root, 'large.txt')).resolves.toEqual({
      additions: 0,
      deletions: 0,
    })
  })

  it('caps how many untracked files are scanned in one batch', async () => {
    const root = await createTempDir()
    const paths: string[] = []
    for (let index = 0; index < 250; index += 1) {
      const filePath = `file-${index.toString().padStart(3, '0')}.txt`
      paths.push(filePath)
      await fs.writeFile(path.join(root, filePath), `${index}\n`)
    }

    const stats = await getUntrackedFilesLineStats(root, paths)
    expect(stats.size).toBe(200)
  })

  it('reuses cached stats when the file size and mtime are unchanged', async () => {
    const root = await createTempDir()
    const filePath = path.join(root, 'cached.txt')
    await fs.writeFile(filePath, 'first\nsecond\n')

    const first = await getUntrackedFileLineStats(root, 'cached.txt')
    expect(first).toEqual({ additions: 2, deletions: 0 })

    // 缓存命中路径：文件不变时再次统计必须返回相同结果。
    const second = await getUntrackedFileLineStats(root, 'cached.txt')
    expect(second).toEqual(first)

    // 文件内容变化（size/mtime 指纹变化）后缓存失效，重新统计出新行数。
    await fs.writeFile(filePath, 'first\nsecond\nthird\n')
    await expect(getUntrackedFileLineStats(root, 'cached.txt')).resolves.toEqual({
      additions: 3,
      deletions: 0,
    })
  })
})

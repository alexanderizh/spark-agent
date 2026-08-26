import { mkdtemp, mkdir, utimes, writeFile, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { MAX_CACHED_RELEASE_DIRS, pruneUpdaterCacheDirs } from './updaterCache.js'

async function createCacheRoot(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'updater-cache-test-'))
}

async function createVersionDir(cacheRoot: string, version: string, mtime: Date): Promise<void> {
  const dir = join(cacheRoot, version)
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, `Spark-Agent-${version}-mac-arm64.dmg`), 'fake installer payload')
  await utimes(dir, mtime, mtime)
}

describe('pruneUpdaterCacheDirs', () => {
  it('按 mtime 保留最近 keep 个版本目录，删除更旧的', async () => {
    const cacheRoot = await createCacheRoot()
    const base = Date.now() - 10 * 24 * 60 * 60 * 1000
    await createVersionDir(cacheRoot, '0.9.0', new Date(base))
    await createVersionDir(cacheRoot, '0.10.0', new Date(base + 24 * 60 * 60 * 1000))
    await createVersionDir(cacheRoot, '0.11.0', new Date(base + 2 * 24 * 60 * 60 * 1000))
    await createVersionDir(cacheRoot, '0.11.12', new Date(base + 3 * 24 * 60 * 60 * 1000))

    const removed = await pruneUpdaterCacheDirs(cacheRoot)

    expect(removed.map((entry) => entry.directory.split('/').pop()).sort()).toEqual(['0.10.0', '0.9.0'])
    expect((await readdir(cacheRoot)).sort()).toEqual(['0.11.0', '0.11.12'])
  })

  it('目录不存在时返回空列表且不报错', async () => {
    const removed = await pruneUpdaterCacheDirs(join(tmpdir(), 'updater-cache-missing-path'))

    expect(removed).toEqual([])
  })

  it('非版本形态的目录不参与清理', async () => {
    const cacheRoot = await createCacheRoot()
    await createVersionDir(cacheRoot, '0.11.12', new Date())
    await mkdir(join(cacheRoot, 'logs'), { recursive: true })
    await createVersionDir(cacheRoot, '0.11.13', new Date())

    const removed = await pruneUpdaterCacheDirs(cacheRoot)

    expect(removed).toEqual([])
    expect((await readdir(cacheRoot)).sort()).toEqual(['0.11.12', '0.11.13', 'logs'])
  })

  it('keep 小于 1 时直接跳过', async () => {
    const cacheRoot = await createCacheRoot()
    await createVersionDir(cacheRoot, '0.11.12', new Date())

    const removed = await pruneUpdaterCacheDirs(cacheRoot, 0)

    expect(removed).toEqual([])
    expect(await readdir(cacheRoot)).toEqual(['0.11.12'])
  })

  it('默认保留数覆盖当前版本加待安装下载两个目录', () => {
    expect(MAX_CACHED_RELEASE_DIRS).toBe(2)
  })
})

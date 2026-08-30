import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  clearMediaTransferCacheForTest,
  evictMediaTransferCache,
  lookupMediaTransferCache,
  mediaTransferScopeOf,
  recordMediaTransferCache,
} from './media-input-transfer-cache.js'

describe('media-input-transfer-cache', () => {
  let dir: string

  beforeEach(async () => {
    clearMediaTransferCacheForTest()
    dir = await mkdtemp(join(tmpdir(), 'spark-transfer-cache-test-'))
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('按 buffer 内容指纹命中同一 provider/scope 的缓存', async () => {
    const identity = { provider: 'xai', scope: 'scope-a' }
    const content = { buffer: Buffer.from('same-bytes') }
    await recordMediaTransferCache(identity, content, { kind: 'file_id', fileId: 'file-1' })

    await expect(
      lookupMediaTransferCache(identity, { buffer: Buffer.from('same-bytes') }),
    ).resolves.toEqual({ kind: 'file_id', fileId: 'file-1' })
  })

  it('不同 provider 或 scope 互不串号', async () => {
    const content = { buffer: Buffer.from('same-bytes') }
    await recordMediaTransferCache({ provider: 'xai', scope: 'scope-a' }, content, {
      kind: 'file_id',
      fileId: 'xai-file',
    })
    await recordMediaTransferCache({ provider: 'spark', scope: 'scope-b' }, content, {
      kind: 'url',
      url: 'https://example.com/a',
    })

    await expect(
      lookupMediaTransferCache({ provider: 'xai', scope: 'scope-b' }, content),
    ).resolves.toBeNull()
    await expect(
      lookupMediaTransferCache({ provider: 'spark', scope: 'scope-a' }, content),
    ).resolves.toBeNull()
    await expect(
      lookupMediaTransferCache({ provider: 'spark', scope: 'scope-b' }, content),
    ).resolves.toEqual({ kind: 'url', url: 'https://example.com/a' })
  })

  it('本地文件用 path+mtime+size 指纹；文件变化后 miss', async () => {
    const identity = { provider: 'volcengine-ark', scope: 'scope-v' }
    const filePath = join(dir, 'ref.png')
    await writeFile(filePath, 'v1')
    await recordMediaTransferCache(identity, { filePath }, { kind: 'file_id', fileId: 'f-1' })
    await expect(lookupMediaTransferCache(identity, { filePath })).resolves.toEqual({
      kind: 'file_id',
      fileId: 'f-1',
    })

    await writeFile(filePath, 'v2-longer-content')
    await expect(lookupMediaTransferCache(identity, { filePath })).resolves.toBeNull()
  })

  it('TTL 过期后 miss', async () => {
    const identity = { provider: 'xai', scope: 'scope-a' }
    const content = { buffer: Buffer.from('ttl-bytes') }
    await recordMediaTransferCache(
      identity,
      content,
      { kind: 'file_id', fileId: 'f-ttl' },
      1, // 1ms
    )
    await new Promise((resolve) => setTimeout(resolve, 5))
    await expect(lookupMediaTransferCache(identity, content)).resolves.toBeNull()
  })

  it('evict 后立即 miss（渠道侧 file_id 失效场景）', async () => {
    const identity = { provider: 'minimax-hailuo', scope: 'scope-m' }
    const content = { buffer: Buffer.from('evict-bytes') }
    await recordMediaTransferCache(identity, content, { kind: 'file_id', fileId: 'f-evict' })
    await evictMediaTransferCache(identity, content)
    await expect(lookupMediaTransferCache(identity, content)).resolves.toBeNull()
  })

  it('mediaTransferScopeOf 对 apiKey 只输出哈希指纹且区分不同 key', () => {
    const a = mediaTransferScopeOf({ apiEndpoint: 'https://api.x.ai', apiKey: 'sk-a' })
    const b = mediaTransferScopeOf({ apiEndpoint: 'https://api.x.ai', apiKey: 'sk-b' })
    const anonymous = mediaTransferScopeOf({ apiEndpoint: 'https://api.x.ai' })

    expect(a).not.toEqual(b)
    expect(a).not.toContain('sk-a')
    expect(anonymous).toContain('anonymous')
  })
})

import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { readTextFileForRenderer } from './file-read.js'

describe('readTextFileForRenderer', () => {
  let root: string

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'spark-file-read-'))
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  it('rejects an oversized file before returning its content', async () => {
    const filePath = join(root, 'large.ts')
    await writeFile(filePath, 'x'.repeat(32))

    const result = await readTextFileForRenderer({ filePath, maxBytes: 16, rejectBinary: true })

    expect(result.errorCode).toBe('file-too-large')
    expect(result.size).toBe(32)
    expect(result.content).toBeUndefined()
  })

  it('rejects binary files when the caller requests text-only reading', async () => {
    const filePath = join(root, 'image.bin')
    await writeFile(filePath, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 1, 2]))

    const result = await readTextFileForRenderer({ filePath, maxBytes: 1024, rejectBinary: true })

    expect(result.errorCode).toBe('binary-file')
    expect(result.content).toBeUndefined()
  })

  it('keeps legacy unrestricted text reads compatible', async () => {
    const filePath = join(root, 'source.ts')
    await writeFile(filePath, 'export const answer = 42\n')

    const result = await readTextFileForRenderer({ filePath })

    expect(result.error).toBeUndefined()
    expect(result.content).toBe('export const answer = 42\n')
  })

  it('reads guarded text from the beginning after binary sniffing', async () => {
    const filePath = join(root, 'guarded.ts')
    await writeFile(filePath, 'const guarded = true\n')

    const result = await readTextFileForRenderer({
      filePath,
      maxBytes: 1024,
      rejectBinary: true,
    })

    expect(result.error).toBeUndefined()
    expect(result.content).toBe('const guarded = true\n')
  })
})

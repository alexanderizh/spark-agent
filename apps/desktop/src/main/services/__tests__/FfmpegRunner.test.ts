import { existsSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { ensureOutputDirectory } from '../FfmpegRunner'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('ensureOutputDirectory', () => {
  it('creates the parent directory required by trim and concat outputs', async () => {
    const root = await mkdtemp(join(tmpdir(), 'spark-video-output-'))
    roots.push(root)
    const outputPath = join(root, 'nested', 'video-workbench', 'clip.mp4')

    ensureOutputDirectory(outputPath)

    expect(existsSync(join(root, 'nested', 'video-workbench'))).toBe(true)
  })
})

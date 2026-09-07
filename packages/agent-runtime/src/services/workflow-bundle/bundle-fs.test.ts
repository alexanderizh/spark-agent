import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { zipSync } from 'fflate'
import { afterEach, describe, expect, it } from 'vitest'
import { BundleLimitError, collectDirectory, unzipBundle } from './bundle-fs.js'

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe('workflow bundle file system helpers', () => {
  it('follows a top-level skill directory symlink while skipping nested links', async () => {
    const root = await mkdtemp(join(tmpdir(), 'wf-bundle-fs-'))
    tempDirs.push(root)
    const realDir = join(root, 'real-skill')
    const linkedDir = join(root, 'linked-skill')
    await mkdir(join(realDir, 'nested'), { recursive: true })
    await writeFile(join(realDir, 'SKILL.md'), '# Skill')
    await writeFile(join(realDir, 'nested', 'guide.md'), '# Guide')
    await symlink(realDir, linkedDir, 'dir')

    const entries = await collectDirectory(linkedDir)

    expect(Array.from(entries.keys()).sort()).toEqual(['SKILL.md', 'nested/guide.md'])
    expect(new TextDecoder().decode(entries.get('SKILL.md'))).toBe('# Skill')
    expect(await readFile(join(realDir, 'nested', 'guide.md'), 'utf8')).toBe('# Guide')
  })

  it('rejects unsafe paths instead of silently dropping them', () => {
    const bytes = zipSync({ '../outside.txt': new TextEncoder().encode('unsafe') })

    expect(() => unzipBundle(bytes)).toThrow(BundleLimitError)
    expect(() => unzipBundle(bytes)).toThrow('非法包内路径')
  })
})

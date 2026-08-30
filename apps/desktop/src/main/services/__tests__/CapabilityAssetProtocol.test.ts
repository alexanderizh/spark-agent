import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { resolveCapabilityAssetPath } from '../CapabilityAssetProtocol'

const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('CapabilityAssetProtocol', () => {
  it('resolves an Office asset under the active package root', async () => {
    const root = await mkdtemp(join(tmpdir(), 'spark-capability-assets-'))
    roots.push(root)
    await mkdir(join(root, 'vendor/docx'), { recursive: true })
    await writeFile(join(root, 'vendor/docx/docx.worker.js'), 'worker')

    await expect(
      resolveCapabilityAssetPath(
        'capability-asset://office-viewer/vendor/docx/docx.worker.js',
        async () => root,
      ),
    ).resolves.toBe(join(root, 'vendor/docx/docx.worker.js'))
  })

  it('rejects traversal and symbolic-link escapes', async () => {
    const root = await mkdtemp(join(tmpdir(), 'spark-capability-assets-'))
    const outsideRoot = await mkdtemp(join(tmpdir(), 'spark-capability-assets-outside-'))
    roots.push(root, outsideRoot)
    const outside = join(outsideRoot, 'outside.js')
    await writeFile(outside, 'outside')
    await symlink(outside, join(root, 'linked.js'))

    await expect(
      resolveCapabilityAssetPath(
        'capability-asset://office-viewer/%2e%2e/outside.js',
        async () => root,
      ),
    ).rejects.toThrow()
    await expect(
      resolveCapabilityAssetPath(
        'capability-asset://office-viewer/linked.js',
        async () => root,
      ),
    ).rejects.toThrow('escape')
  })
})

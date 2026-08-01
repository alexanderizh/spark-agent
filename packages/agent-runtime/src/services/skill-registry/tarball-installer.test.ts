import { spawnSync } from 'node:child_process'
import { createReadStream } from 'node:fs'
import { createServer } from 'node:http'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { installBinaryArchive } from './tarball-installer'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('installBinaryArchive', () => {
  it('preserves archive-root files when contentRoot is explicitly dot', async () => {
    const root = await mkdtemp(join(tmpdir(), 'spark-binary-root-'))
    roots.push(root)
    const sourceDir = join(root, 'source')
    const archivePath = join(root, 'fixture.tar.gz')
    const destDir = join(root, 'installed')
    await mkdir(join(sourceDir, 'onnx'), { recursive: true })
    await writeFile(join(sourceDir, 'model-package.json'), '{"schemaVersion":1}')
    await writeFile(join(sourceDir, 'onnx', 'model.onnx'), 'fixture')

    const tar = spawnSync('tar', ['-czf', archivePath, '-C', sourceDir, '.'])
    if (tar.status !== 0) throw new Error(tar.stderr.toString() || 'failed to create test archive')

    const server = createServer((_request, response) => {
      createReadStream(archivePath).pipe(response)
    })
    await new Promise<void>((resolveListen) => server.listen(0, '127.0.0.1', resolveListen))
    try {
      const address = server.address()
      if (!address || typeof address === 'string') throw new Error('test server has no TCP port')
      await installBinaryArchive({
        url: `http://127.0.0.1:${address.port}/fixture.tar.gz`,
        format: 'tar.gz',
        contentRoot: '.',
        destDir,
      })

      await expect(readFile(join(destDir, 'model-package.json'), 'utf8')).resolves.toContain(
        'schemaVersion',
      )
      await expect(readFile(join(destDir, 'onnx', 'model.onnx'), 'utf8')).resolves.toBe('fixture')
    } finally {
      await new Promise<void>((resolveClose) => server.close(() => resolveClose()))
    }
  })
})

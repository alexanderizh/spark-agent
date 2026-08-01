import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { prepareOfficeViewerArtifact } from '../prepare-office-viewer-artifact.mjs'

const roots = []
test.afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'spark-office-artifact-'))
  roots.push(root)
  const source = join(root, 'source')
  await mkdir(join(source, 'vendor/docx'), { recursive: true })
  await mkdir(join(source, 'wasm'), { recursive: true })
  await writeFile(join(source, 'vendor/docx/docx.worker.js'), 'worker')
  await writeFile(join(source, 'wasm/viewer.wasm'), 'wasm')
  await writeFile(join(source, 'flyfish-viewer-assets.json'), '{}')
  return { root, source }
}

test('creates a reproducible Office Viewer archive with per-file hashes', async () => {
  const { root, source } = await fixture()
  const first = await prepareOfficeViewerArtifact(source, join(root, 'first'), {
    version: '2.2.3-1',
  })
  const second = await prepareOfficeViewerArtifact(source, join(root, 'second'), {
    version: '2.2.3-1',
  })

  assert.equal(first.entry.id, 'archive.optional-office-viewer-2.2.3-1')
  assert.equal(first.entry.sha256, second.entry.sha256)
  assert.equal(first.entry.size, second.entry.size)
  const packageManifest = JSON.parse(await readFile(first.packageManifestPath, 'utf8'))
  assert.deepEqual(Object.keys(packageManifest.files).sort(), [
    'flyfish-viewer-assets.json',
    'vendor/docx/docx.worker.js',
    'wasm/viewer.wasm',
  ])
})

test('rejects symbolic links instead of publishing link targets', async () => {
  const { root, source } = await fixture()
  const outside = join(root, 'outside.txt')
  await writeFile(outside, 'secret')
  await symlink(outside, join(source, 'vendor/docx/linked.js'))

  await assert.rejects(
    prepareOfficeViewerArtifact(source, join(root, 'output'), { version: '2.2.3-1' }),
    /symbolic link/i,
  )
})

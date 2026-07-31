import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DepthModelIntegrityService } from '../DepthModelIntegrityService'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

async function modelFixture(): Promise<{ root: string; modelDir: string }> {
  const root = await mkdtemp(join(tmpdir(), 'spark-depth-model-'))
  roots.push(root)
  const modelDir = join(root, 'models', 'depth-anything-v2-small-int8')
  await writeModelPackage(modelDir)
  return { root, modelDir }
}

async function writeModelPackage(modelDir: string): Promise<void> {
  await mkdir(join(modelDir, 'onnx'), { recursive: true })
  const files: Record<string, string> = {
    'config.json': '{"model_type":"depth_anything"}',
    'preprocessor_config.json': '{"size":518}',
    'onnx/model_int8.onnx': 'onnx-fixture',
    LICENSE: 'Apache License 2.0',
  }
  const hashes: Record<string, string> = {}
  for (const [relativePath, content] of Object.entries(files)) {
    await writeFile(join(modelDir, relativePath), content)
    hashes[relativePath] = createHash('sha256').update(content).digest('hex')
  }
  await writeFile(
    join(modelDir, 'model-package.json'),
    JSON.stringify({
      schemaVersion: 1,
      modelId: 'depth-anything-v2-small-int8',
      version: '1.0.0',
      files: hashes,
    }),
  )
}

describe('DepthModelIntegrityService', () => {
  it('marks a complete hash-verified model package ready', async () => {
    const fixture = await modelFixture()
    const service = new DepthModelIntegrityService({ userDataDir: fixture.root })

    await expect(service.inspect()).resolves.toEqual({
      state: 'ready',
      version: '1.0.0',
      modelDir: fixture.modelDir,
    })
  })

  it('reports a corrupted model file instead of using it', async () => {
    const fixture = await modelFixture()
    await writeFile(join(fixture.modelDir, 'onnx/model_int8.onnx'), 'tampered')
    const service = new DepthModelIntegrityService({ userDataDir: fixture.root })

    await expect(service.inspect()).resolves.toMatchObject({
      state: 'error',
      error: expect.stringContaining('SHA-256'),
    })
  })

  it('deduplicates concurrent installs and verifies the installed package', async () => {
    const root = await mkdtemp(join(tmpdir(), 'spark-depth-install-'))
    roots.push(root)
    const installArchive = vi.fn(async (input: { destDir: string }) => {
      await writeModelPackage(input.destDir)
      return { destPath: input.destDir, entries: [], fileCount: 5 }
    })
    const service = new DepthModelIntegrityService({
      userDataDir: root,
      fetchManifest: async () => ({
        schemaVersion: 1,
        updatedAt: '2026-08-01',
        baseUrl: 'https://minio.example/artifact-repository/v1',
        artifacts: [
          {
            id: 'model.depth-anything-v2-small-int8-1.0.0',
            type: 'model',
            name: 'Depth Anything V2 Small INT8',
            version: '1.0.0',
            url: 'models/depth-anything-v2/depth-anything-v2-small-int8-1.0.0.tar.gz',
            sha256: 'a'.repeat(64),
            size: 123,
            archive: { format: 'tar.gz' },
          },
        ],
      }),
      installArchive,
    })

    const [first, second] = await Promise.all([service.install(), service.install()])

    expect(first).toMatchObject({ state: 'ready', version: '1.0.0' })
    expect(second).toEqual(first)
    expect(installArchive).toHaveBeenCalledTimes(1)
    expect(installArchive).toHaveBeenCalledWith(
      expect.objectContaining({
        url: expect.stringContaining('depth-anything-v2-small-int8-1.0.0.tar.gz'),
        sha256: 'a'.repeat(64),
        destDir: expect.stringContaining('depth-anything-v2-small-int8.staging-'),
      }),
    )
  })

  it('keeps the active model directory when a staged package fails verification', async () => {
    const fixture = await modelFixture()
    await writeFile(join(fixture.modelDir, 'onnx/model_int8.onnx'), 'existing-corrupt-model')
    const service = new DepthModelIntegrityService({
      userDataDir: fixture.root,
      fetchManifest: async () => ({
        schemaVersion: 1,
        updatedAt: '2026-08-01',
        artifacts: [
          {
            id: 'model.depth-anything-v2-small-int8-1.0.0',
            type: 'model',
            name: 'Depth Anything V2 Small INT8',
            version: '1.0.0',
            url: 'models/depth.tar.gz',
            sha256: 'a'.repeat(64),
            size: 123,
            archive: { format: 'tar.gz' },
          },
        ],
      }),
      installArchive: async ({ destDir }) => {
        await mkdir(destDir, { recursive: true })
        await writeFile(join(destDir, 'model-package.json'), '{}')
        return { destPath: destDir, entries: [], fileCount: 1 }
      },
    })

    await expect(service.install()).rejects.toThrow('model-package.json')
    await expect(readFile(join(fixture.modelDir, 'onnx/model_int8.onnx'), 'utf8')).resolves.toBe(
      'existing-corrupt-model',
    )
  })
})

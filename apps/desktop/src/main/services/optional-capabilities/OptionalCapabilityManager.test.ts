import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, symlink, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SparkInstallManifest } from '../../../../../../packages/agent-runtime/src/services/skill-registry/artifact-manifest'
import { OPTIONAL_CAPABILITY_DEFINITIONS } from './definitions'
import { OptionalCapabilityManager } from './OptionalCapabilityManager'

const roots: string[] = []
const OFFICE_HEALTH_FILES = [
  'flyfish-viewer-manifest.json',
  'flyfish-viewer-assets.json',
  'vendor/docx/docx.worker.js',
  'vendor/docx/jszip.min.js',
  'vendor/xlsx/sheet.worker.js',
  'vendor/pptx/pptx.worker.js',
  'vendor/ppt/index.mjs',
  'vendor/ppt/worker.mjs',
  'vendor/ppt/frame-cache.mjs',
  'vendor/ppt/ppt-native.wasm',
  'vendor/ppt/ppt-font-cjk.otf',
  'vendor/ppt/manifest.json',
  'vendor/ppt/package.json',
  'vendor/ppt/LICENSE',
  'vendor/ppt/NOTICE',
] as const

function deferred<T>(): {
  promise: Promise<T>
  resolve: (value: T | PromiseLike<T>) => void
  reject: (reason?: unknown) => void
} {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

async function fixtureRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'spark-optional-capabilities-'))
  roots.push(root)
  return root
}

function manifest(): SparkInstallManifest {
  return {
    schemaVersion: 1,
    updatedAt: '2026-08-02',
    baseUrl: 'https://minio.example/artifact-repository/v1',
    artifacts: [
      {
        id: 'archive.optional-office-viewer-2.2.3-1',
        type: 'archive',
        name: 'Office Viewer',
        version: '2.2.3-1',
        platform: 'any',
        arch: 'any',
        url: 'dependencies/office/office-viewer.tar.gz',
        sha256: 'a'.repeat(64),
        size: 120,
        archive: { format: 'tar.gz', contentRoot: '.' },
      },
      {
        id: 'runtime.optional-depth-transformers-4.2.0-onnx-1.24.3-1-darwin-arm64',
        type: 'runtime',
        name: 'Depth Runtime',
        version: '4.2.0-1.24.3-1',
        platform: 'darwin',
        arch: 'arm64',
        url: 'dependencies/depth/runtime-darwin-arm64.tar.gz',
        sha256: 'b'.repeat(64),
        size: 80,
        archive: { format: 'tar.gz', contentRoot: '.' },
      },
      {
        id: 'model.depth-anything-v2-small-int8-1.0.0',
        type: 'model',
        name: 'Depth Model',
        version: '1.0.0',
        platform: 'any',
        arch: 'any',
        url: 'dependencies/depth/model.tar.gz',
        sha256: 'c'.repeat(64),
        size: 40,
        archive: { format: 'tar.gz', contentRoot: '.' },
      },
    ],
  }
}

async function writePackage(
  destination: string,
  capabilityId: 'office-viewer' | 'local-depth',
  artifactId: string,
  version: string,
): Promise<void> {
  await mkdir(destination, { recursive: true })
  const payload = 'verified payload'
  await writeFile(join(destination, 'payload.bin'), payload)
  const files: Record<string, string> = {
    'payload.bin': createHash('sha256').update(payload).digest('hex'),
  }
  if (capabilityId === 'office-viewer') {
    for (const relativePath of OFFICE_HEALTH_FILES) {
      const content = `fixture:${relativePath}`
      await mkdir(join(destination, relativePath, '..'), { recursive: true })
      await writeFile(join(destination, relativePath), content)
      files[relativePath] = createHash('sha256').update(content).digest('hex')
    }
  }
  await writeFile(
    join(destination, 'capability-package.json'),
    JSON.stringify({
      schemaVersion: 1,
      capabilityId,
      artifactId,
      version,
      files,
    }),
  )
}

async function writeHashedFiles(
  destination: string,
  files: Record<string, string>,
): Promise<Record<string, string>> {
  const hashes: Record<string, string> = {}
  for (const [relativePath, content] of Object.entries(files)) {
    await mkdir(join(destination, relativePath, '..'), { recursive: true })
    await writeFile(join(destination, relativePath), content)
    hashes[relativePath] = createHash('sha256').update(content).digest('hex')
  }
  return hashes
}

async function writeDepthRuntimePackage(
  destination: string,
  artifactId: string,
  version: string,
): Promise<void> {
  const runtimeEntry = 'node_modules/@huggingface/transformers/src/transformers.js'
  const nativeRoot = 'node_modules/onnxruntime-node/bin/napi-v6/darwin/arm64'
  const files = await writeHashedFiles(destination, {
    [runtimeEntry]: 'export const pipeline = () => undefined',
    'node_modules/@huggingface/transformers/package.json': '{"version":"4.2.0"}',
    'node_modules/onnxruntime-node/package.json': '{"version":"1.24.3"}',
    [`${nativeRoot}/onnxruntime_binding.node`]: 'native-binding',
    [`${nativeRoot}/libonnxruntime.1.24.3.dylib`]: 'native-library',
  })
  await writeFile(
    join(destination, 'capability-package.json'),
    JSON.stringify({
      schemaVersion: 1,
      capabilityId: 'local-depth',
      artifactId,
      version,
      platform: 'darwin',
      arch: 'arm64',
      runtimeEntry,
      packages: {
        '@huggingface/transformers': '4.2.0',
        'onnxruntime-node': '1.24.3',
      },
      files,
    }),
  )
}

async function writeDepthModelPackage(destination: string, version: string): Promise<void> {
  const files = await writeHashedFiles(destination, {
    LICENSE: 'Apache-2.0',
    'config.json': '{"model_type":"depth_anything"}',
    'preprocessor_config.json': '{"size":518}',
    'onnx/model_int8.onnx': 'fixture-onnx',
  })
  await writeFile(
    join(destination, 'model-package.json'),
    JSON.stringify({
      schemaVersion: 1,
      modelId: 'depth-anything-v2-small-int8',
      version,
      files,
    }),
  )
}

describe('OptionalCapabilityManager', () => {
  it('defines only Office Viewer and local depth capabilities', () => {
    expect(OPTIONAL_CAPABILITY_DEFINITIONS.map((definition) => definition.id)).toEqual([
      'office-viewer',
      'local-depth',
    ])
  })

  it('selects compatible artifacts and installs a capability once for concurrent callers', async () => {
    const root = await fixtureRoot()
    const installArchive = vi.fn(async ({ destDir }: { destDir: string }) => {
      await writePackage(
        destDir,
        'office-viewer',
        'archive.optional-office-viewer-2.2.3-1',
        '2.2.3-1',
      )
      return { destPath: destDir, entries: [], fileCount: 1 }
    })
    const progress: string[] = []
    const manager = new OptionalCapabilityManager({
      userDataDir: root,
      platform: 'darwin',
      arch: 'arm64',
      fetchManifest: async () => manifest(),
      installArchive,
      onProgress: (event) => progress.push(event.phase),
    })

    const [first, second] = await Promise.all([
      manager.install('office-viewer'),
      manager.install('office-viewer'),
    ])

    expect(first.success).toBe(true)
    expect(second).toEqual(first)
    expect(installArchive).toHaveBeenCalledTimes(1)
    expect(progress).toEqual(
      expect.arrayContaining(['queued', 'downloading', 'verifying', 'activating', 'ready']),
    )
    expect(first.snapshot.capabilities.find((item) => item.id === 'office-viewer')).toMatchObject({
      state: 'ready',
      installedVersion: '2.2.3-1',
      targetVersion: '2.2.3-1',
      downloadSize: 120,
    })
    expect(
      first.snapshot.capabilities.find((item) => item.id === 'office-viewer')?.installedSize,
    ).toBeGreaterThan(120)
  })

  it('activates local depth only after both runtime and model pass health checks', async () => {
    const root = await fixtureRoot()
    const installArchive = vi.fn(async ({ destDir }: { destDir: string }) => {
      if (destDir.includes('runtime.optional-depth-')) {
        await writeDepthRuntimePackage(
          destDir,
          'runtime.optional-depth-transformers-4.2.0-onnx-1.24.3-1-darwin-arm64',
          '4.2.0-1.24.3-1',
        )
      } else {
        await writeDepthModelPackage(destDir, '1.0.0')
      }
      return { destPath: destDir, entries: [], fileCount: 5 }
    })
    const manager = new OptionalCapabilityManager({
      userDataDir: root,
      platform: 'darwin',
      arch: 'arm64',
      fetchManifest: async () => manifest(),
      installArchive,
    })

    const result = await manager.install('local-depth')

    expect(result).toMatchObject({ success: true })
    expect(installArchive).toHaveBeenCalledTimes(2)
    expect(result.snapshot.capabilities.find((item) => item.id === 'local-depth')).toMatchObject({
      state: 'ready',
      installedVersion: '4.2.0-1.24.3-1+1.0.0',
      downloadSize: 120,
    })
    await expect(
      manager.getArtifactDirectory('local-depth', 'runtime.optional-depth-'),
    ).resolves.toEqual(expect.stringContaining('runtime.optional-depth-'))
    await expect(
      manager.getArtifactDirectory('local-depth', 'model.depth-anything-v2-small-int8-'),
    ).resolves.toEqual(expect.stringContaining('model.depth-anything-v2-small-int8-'))
  })

  it('keeps the active version when an update fails before activation', async () => {
    const root = await fixtureRoot()
    let fail = false
    const manager = new OptionalCapabilityManager({
      userDataDir: root,
      platform: 'darwin',
      arch: 'arm64',
      fetchManifest: async () => manifest(),
      installArchive: async ({ destDir }) => {
        if (fail) throw new Error('download interrupted')
        await writePackage(
          destDir,
          'office-viewer',
          'archive.optional-office-viewer-2.2.3-1',
          '2.2.3-1',
        )
        return { destPath: destDir, entries: [], fileCount: 1 }
      },
    })
    await manager.install('office-viewer')
    fail = true

    await expect(manager.repair('office-viewer')).resolves.toMatchObject({ success: false })

    const active = JSON.parse(
      await readFile(join(root, 'optional-capabilities', 'office-viewer', 'active.json'), 'utf8'),
    ) as { version: string }
    expect(active.version).toBe('2.2.3-1')
    await expect(manager.list()).resolves.toMatchObject({
      capabilities: expect.arrayContaining([
        expect.objectContaining({ id: 'office-viewer', installedVersion: '2.2.3-1' }),
      ]),
    })
  })

  it('marks an installed capability damaged when a package file hash changes', async () => {
    const root = await fixtureRoot()
    const manager = new OptionalCapabilityManager({
      userDataDir: root,
      platform: 'darwin',
      arch: 'arm64',
      fetchManifest: async () => manifest(),
      installArchive: async ({ destDir }) => {
        await writePackage(
          destDir,
          'office-viewer',
          'archive.optional-office-viewer-2.2.3-1',
          '2.2.3-1',
        )
        return { destPath: destDir, entries: [], fileCount: 2 }
      },
    })
    const installed = await manager.install('office-viewer')
    const item = installed.snapshot.capabilities.find((entry) => entry.id === 'office-viewer')
    expect(item?.state).toBe('ready')
    const active = JSON.parse(
      await readFile(join(root, 'optional-capabilities', 'office-viewer', 'active.json'), 'utf8'),
    ) as { artifacts: Record<string, { directory: string }> }
    const directory = Object.values(active.artifacts)[0]!.directory
    await writeFile(join(directory, 'payload.bin'), 'tampered')

    await expect(manager.list()).resolves.toMatchObject({
      capabilities: expect.arrayContaining([
        expect.objectContaining({ id: 'office-viewer', state: 'damaged' }),
      ]),
    })
  })

  it('anchors the package manifest hash so coordinated local tampering is detected', async () => {
    const root = await fixtureRoot()
    const manager = new OptionalCapabilityManager({
      userDataDir: root,
      platform: 'darwin',
      arch: 'arm64',
      fetchManifest: async () => manifest(),
      installArchive: async ({ destDir }) => {
        await writePackage(
          destDir,
          'office-viewer',
          'archive.optional-office-viewer-2.2.3-1',
          '2.2.3-1',
        )
        return { destPath: destDir, entries: [], fileCount: 2 }
      },
    })
    await manager.install('office-viewer')
    const active = JSON.parse(
      await readFile(join(root, 'optional-capabilities', 'office-viewer', 'active.json'), 'utf8'),
    ) as { artifacts: Record<string, { directory: string }> }
    const directory = Object.values(active.artifacts)[0]!.directory
    const tamperedPayload = 'tampered with matching file hash'
    await writeFile(join(directory, 'payload.bin'), tamperedPayload)
    const packageManifestPath = join(directory, 'capability-package.json')
    const packageManifest = JSON.parse(await readFile(packageManifestPath, 'utf8')) as {
      files: Record<string, string>
    }
    packageManifest.files['payload.bin'] = createHash('sha256')
      .update(tamperedPayload)
      .digest('hex')
    await writeFile(packageManifestPath, JSON.stringify(packageManifest))

    await expect(manager.list()).resolves.toMatchObject({
      capabilities: expect.arrayContaining([
        expect.objectContaining({ id: 'office-viewer', state: 'damaged' }),
      ]),
    })
  })

  it('rejects package files that escape through a symbolic link', async () => {
    const root = await fixtureRoot()
    const manager = new OptionalCapabilityManager({
      userDataDir: root,
      platform: 'darwin',
      arch: 'arm64',
      fetchManifest: async () => manifest(),
      installArchive: async ({ destDir }) => {
        await writePackage(
          destDir,
          'office-viewer',
          'archive.optional-office-viewer-2.2.3-1',
          '2.2.3-1',
        )
        const outside = join(root, 'outside-payload.bin')
        await writeFile(outside, 'verified payload')
        await unlink(join(destDir, 'payload.bin'))
        await symlink(outside, join(destDir, 'payload.bin'))
        return { destPath: destDir, entries: [], fileCount: 2 }
      },
    })

    await expect(manager.install('office-viewer')).resolves.toMatchObject({
      success: false,
      errorCode: 'package_invalid',
      message: expect.stringContaining('完整性校验未通过'),
    })
  })

  it('queues updates only for installed capabilities with automatic updates enabled', async () => {
    const root = await fixtureRoot()
    let releaseVersion = '2.2.3-1'
    const fetchManifest = vi.fn(async () => {
      const next = manifest()
      const office = next.artifacts[0]!
      office.id = `archive.optional-office-viewer-${releaseVersion}`
      office.version = releaseVersion
      office.url = `dependencies/office/office-viewer-${releaseVersion}.tar.gz`
      return next
    })
    const installArchive = vi.fn(async ({ destDir }: { destDir: string }) => {
      await writePackage(
        destDir,
        'office-viewer',
        `archive.optional-office-viewer-${releaseVersion}`,
        releaseVersion,
      )
      return { destPath: destDir, entries: [], fileCount: 2 }
    })
    const manager = new OptionalCapabilityManager({
      userDataDir: root,
      platform: 'darwin',
      arch: 'arm64',
      fetchManifest,
      installArchive,
    })
    await manager.install('office-viewer')
    releaseVersion = '2.2.3-2'

    await manager.check(true)

    await vi.waitFor(() => expect(installArchive).toHaveBeenCalledTimes(2))
    expect(installArchive).toHaveBeenCalledTimes(2)
    // local-depth is missing and must not be installed merely because its artifacts exist.
    expect(
      installArchive.mock.calls.some(([input]) => String(input.destDir).includes('local-depth')),
    ).toBe(false)
  })

  it('lists local state without making an eager manifest request', async () => {
    const root = await fixtureRoot()
    const fetchManifest = vi.fn(async () => manifest())
    const manager = new OptionalCapabilityManager({
      userDataDir: root,
      platform: 'darwin',
      arch: 'arm64',
      fetchManifest,
    })

    await expect(manager.list()).resolves.toMatchObject({ remoteAvailable: false })
    expect(fetchManifest).not.toHaveBeenCalled()
  })

  it('reuses a successful manifest check for 24 hours without treating the cache as live network', async () => {
    const root = await fixtureRoot()
    let now = new Date('2026-08-02T00:00:00.000Z')
    const firstFetch = vi.fn(async () => manifest())
    const first = new OptionalCapabilityManager({
      userDataDir: root,
      platform: 'darwin',
      arch: 'arm64',
      fetchManifest: firstFetch,
      now: () => now,
    })
    await expect(first.check(false)).resolves.toMatchObject({ remoteAvailable: true })
    expect(firstFetch).toHaveBeenCalledOnce()

    now = new Date('2026-08-02T12:00:00.000Z')
    const cachedFetch = vi.fn(async () => {
      throw new Error('offline')
    })
    const cached = new OptionalCapabilityManager({
      userDataDir: root,
      platform: 'darwin',
      arch: 'arm64',
      fetchManifest: cachedFetch,
      now: () => now,
    })
    await expect(cached.check(false)).resolves.toMatchObject({
      remoteAvailable: false,
      capabilities: expect.arrayContaining([
        expect.objectContaining({ id: 'office-viewer', targetVersion: '2.2.3-1' }),
      ]),
    })
    expect(cachedFetch).not.toHaveBeenCalled()

    now = new Date('2026-08-03T01:00:00.000Z')
    const expiredFetch = vi.fn(async () => manifest())
    const expired = new OptionalCapabilityManager({
      userDataDir: root,
      platform: 'darwin',
      arch: 'arm64',
      fetchManifest: expiredFetch,
      now: () => now,
    })
    await expect(expired.check(false)).resolves.toMatchObject({ remoteAvailable: true })
    expect(expiredFetch).toHaveBeenCalledOnce()
  })

  it('rejects an artifact whose declared type does not match the capability definition', async () => {
    const root = await fixtureRoot()
    const invalidManifest = manifest()
    invalidManifest.artifacts[0]!.type = 'binary'
    const installArchive = vi.fn()
    const manager = new OptionalCapabilityManager({
      userDataDir: root,
      platform: 'darwin',
      arch: 'arm64',
      fetchManifest: async () => invalidManifest,
      installArchive,
    })

    await expect(manager.install('office-viewer')).resolves.toMatchObject({
      success: false,
      errorCode: 'artifact_unavailable',
      message: expect.stringContaining('当前平台暂无可用制品'),
    })
    expect(installArchive).not.toHaveBeenCalled()
  })

  it('does not resolve an active artifact directory that was redirected outside its capability root', async () => {
    const root = await fixtureRoot()
    const manager = new OptionalCapabilityManager({
      userDataDir: root,
      platform: 'darwin',
      arch: 'arm64',
      fetchManifest: async () => manifest(),
      installArchive: async ({ destDir }) => {
        await writePackage(
          destDir,
          'office-viewer',
          'archive.optional-office-viewer-2.2.3-1',
          '2.2.3-1',
        )
        return { destPath: destDir, entries: [], fileCount: 2 }
      },
    })
    await manager.install('office-viewer')
    const activePath = join(root, 'optional-capabilities', 'office-viewer', 'active.json')
    const active = JSON.parse(await readFile(activePath, 'utf8')) as {
      artifacts: Record<string, { directory: string }>
    }
    const artifactId = Object.keys(active.artifacts)[0]!
    const outside = join(root, 'outside', artifactId)
    await writePackage(outside, 'office-viewer', artifactId, '2.2.3-1')
    active.artifacts[artifactId]!.directory = outside
    await writeFile(activePath, JSON.stringify(active))

    await expect(
      manager.getArtifactDirectory('office-viewer', 'archive.optional-office-viewer-'),
    ).resolves.toBeNull()
  })

  it('cancels an active download and reports a stable client error without leaking the raw URL', async () => {
    const root = await fixtureRoot()
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
    const installStarted = deferred<void>()
    const manager = new OptionalCapabilityManager({
      userDataDir: root,
      platform: 'darwin',
      arch: 'arm64',
      fetchManifest: async () => manifest(),
      logger,
      installArchive: async ({ signal }: { signal?: AbortSignal }) => {
        installStarted.resolve(undefined)
        await new Promise<void>((_resolve, reject) => {
          signal?.addEventListener(
            'abort',
            () => reject(new Error('download aborted https://example.invalid/file?secret=value')),
            { once: true },
          )
        })
        throw new Error('unreachable')
      },
    })

    const installing = manager.install('office-viewer')
    await installStarted.promise
    await expect(manager.cancel('office-viewer')).resolves.toMatchObject({ success: true })
    await expect(installing).resolves.toMatchObject({
      success: false,
      errorCode: 'cancelled',
      message: '离线 Office 预览安装已取消',
    })
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringMatching(
        /event=optional_capability_install capability=office-viewer stage=(cancelled|error)/,
      ),
    )
    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain('secret=value')
  })

  it('cancels and drains an active install before uninstalling its files', async () => {
    const root = await fixtureRoot()
    const installStarted = deferred<void>()
    let activeSignal: AbortSignal | undefined
    const manager = new OptionalCapabilityManager({
      userDataDir: root,
      platform: 'darwin',
      arch: 'arm64',
      fetchManifest: async () => manifest(),
      installArchive: async ({ signal }) => {
        activeSignal = signal
        installStarted.resolve(undefined)
        await new Promise<void>((_resolve, reject) => {
          signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
        })
        throw new Error('unreachable')
      },
    })

    const installing = manager.install('office-viewer')
    await installStarted.promise
    const uninstalled = await manager.uninstall('office-viewer')
    const abortedBeforeCleanup = activeSignal?.aborted
    if (!abortedBeforeCleanup) await manager.cancel('office-viewer')

    expect(abortedBeforeCleanup).toBe(true)
    expect(uninstalled).toMatchObject({ success: true })
    await expect(installing).resolves.toMatchObject({ errorCode: 'cancelled' })
  })
})

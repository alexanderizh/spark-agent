import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, symlink, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SparkInstallManifest } from '../../../../../../packages/agent-runtime/src/services/skill-registry/artifact-manifest'
import { OPTIONAL_CAPABILITY_DEFINITIONS } from './definitions'
import { OptionalCapabilityManager } from './OptionalCapabilityManager'

const roots: string[] = []

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
  await writeFile(
    join(destination, 'capability-package.json'),
    JSON.stringify({
      schemaVersion: 1,
      capabilityId,
      artifactId,
      version,
      files: { 'payload.bin': createHash('sha256').update(payload).digest('hex') },
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
      message: expect.stringContaining('符号链接'),
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
      installArchive.mock.calls.some(([input]) =>
        String(input.destDir).includes('local-depth'),
      ),
    ).toBe(false)
  })
})

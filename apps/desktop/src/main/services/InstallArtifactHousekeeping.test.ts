import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createSystemInstallArtifactHousekeepingDependencies,
  runInstallArtifactHousekeeping,
  scheduleInstallArtifactHousekeeping,
  type InstallArtifactHousekeepingDependencies,
} from './InstallArtifactHousekeeping.js'
import { findReadOnlyInstallerMount } from './MacInstallerMount.js'
import {
  fingerprintInstallerImage,
  readMacInstallerReceipt,
  recordMacInstaller,
} from './MacInstallerReceipt.js'

const mocks = vi.hoisted(() => ({ warn: vi.fn(), info: vi.fn(), command: vi.fn() }))
vi.mock('@spark/shared', () => ({ createLogger: () => mocks }))
vi.mock('./MacInstallerMount.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./MacInstallerMount.js')>()),
  runMacInstallerCommand: mocks.command,
}))

const bundleIdentifier = 'com.spark-agent.desktop'
const runningExecutable = '/Applications/Spark Agent.app/Contents/MacOS/Spark Agent'
const mount = { mountPath: '/Volumes/Spark Agent', deviceNode: '/dev/disk7s1' }
const receipt = {
  imagePath: '/cache/updater-fixture.dmg',
  targetVersion: '0.15.32',
  fingerprint: 'fixture',
}
const bundle = `${mount.mountPath}/Spark Agent.app`
const helper = `${bundle}/Contents/Frameworks/Spark Agent Helper.app`

function createDependencies(overrides: Partial<InstallArtifactHousekeepingDependencies> = {}) {
  const deps = {
    currentVersion: receipt.targetVersion,
    runningExecutable,
    readReceipt: vi.fn(async () => receipt),
    getReadOnlyMount: vi.fn(async () => mount),
    listAppDirectories: vi.fn(async (path: string) => {
      if (path === mount.mountPath) return ['Spark Agent.app']
      if (path === `${bundle}/Contents/Frameworks`) return ['Spark Agent Helper.app']
      return []
    }),
    readBundleInfo: vi.fn(async () => ({ bundleIdentifier, shortVersion: receipt.targetVersion })),
    volumeIdentity: vi.fn(async (path: string) => (path === runningExecutable ? 1 : 77)),
    unregisterBundle: vi.fn(async (_path: string) => {}),
    detachVolume: vi.fn(async () => {}),
    ...overrides,
  } satisfies InstallArtifactHousekeepingDependencies
  return deps
}

describe('installer provenance', () => {
  const image = {
    'image-path': receipt.imagePath,
    writeable: false,
    'system-entities': [
      { 'dev-entry': '/dev/disk7' },
      { 'mount-point': mount.mountPath, 'dev-entry': mount.deviceNode },
    ],
  }

  it('matches only the exact read-only disk image and refuses ambiguous or writable mounts', () => {
    expect(findReadOnlyInstallerMount({ images: [image] }, receipt.imagePath)).toEqual(mount)
    for (const entry of [
      { ...image, 'image-path': '/elsewhere/updater-fixture.dmg' },
      { ...image, writeable: true },
      { ...image, writeable: undefined },
      { ...image, 'shadow-path': '/tmp/image.shadow' },
      {
        ...image,
        'system-entities': [...image['system-entities'], { 'mount-point': '/Volumes/Other' }],
      },
      {
        ...image,
        'system-entities': [{ 'mount-point': '/Volumes/../Other', 'dev-entry': mount.deviceNode }],
      },
    ]) {
      expect(findReadOnlyInstallerMount({ images: [entry] }, receipt.imagePath)).toBeNull()
    }
    expect(findReadOnlyInstallerMount({ images: [image, image] }, receipt.imagePath)).toBeNull()
  })

  it('persists the receipt and detects modifications to the recorded installer', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'installer-receipt-test-'))
    try {
      expect(await readMacInstallerReceipt(dir)).toBeNull()
      const imagePath = join(dir, 'installer.dmg')
      await writeFile(imagePath, 'first')
      const canonicalPath = recordMacInstaller(dir, imagePath, receipt.targetVersion)
      const saved = await readMacInstallerReceipt(dir)
      expect(saved).toEqual({
        imagePath: canonicalPath,
        targetVersion: receipt.targetVersion,
        fingerprint: fingerprintInstallerImage(canonicalPath),
      })
      await writeFile(imagePath, 'replacement')
      expect(fingerprintInstallerImage(canonicalPath)).not.toBe(saved?.fingerprint)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

describe('installer cleanup', () => {
  it('unregisters the app and all helpers before requesting ordinary detach', async () => {
    const callOrder: string[] = []
    const deps = createDependencies({
      unregisterBundle: async (path) => {
        callOrder.push(path)
      },
      detachVolume: async ({ deviceNode }) => {
        callOrder.push(deviceNode)
      },
    })
    expect(await runInstallArtifactHousekeeping(deps)).toEqual({
      unregistered: [bundle, helper],
      detached: [mount.mountPath],
      errors: [],
    })
    expect(callOrder).toEqual([bundle, helper, mount.deviceNode])
  })

  it('keeps unknown images, uninstalled versions, foreign bundles and the running volume', async () => {
    const cases = [
      { readReceipt: async () => null },
      { getReadOnlyMount: async () => null },
      { currentVersion: '0.15.31' },
      { currentVersion: '0.15.32-beta.1' },
      { readBundleInfo: async () => ({ bundleIdentifier, shortVersion: '0.15.31' }) },
      {
        readBundleInfo: async () => ({
          bundleIdentifier: `${bundleIdentifier}.dev`,
          shortVersion: receipt.targetVersion,
        }),
      },
      { runningExecutable: `${bundle}/Contents/MacOS/Spark Agent` },
      { volumeIdentity: async () => 77 },
    ]
    for (const overrides of cases) {
      const deps = createDependencies(overrides)
      expect(await runInstallArtifactHousekeeping(deps)).toEqual({
        unregistered: [],
        detached: [],
        errors: [],
      })
      expect(deps.unregisterBundle).not.toHaveBeenCalled()
      expect(deps.detachVolume).not.toHaveBeenCalled()
    }
  })

  it('keeps the installer attached if any helper could not be unregistered', async () => {
    const deps = createDependencies({
      unregisterBundle: async (path) => {
        if (path === helper) throw new Error('lsregister refused')
      },
    })
    const report = await runInstallArtifactHousekeeping(deps)
    expect(report.unregistered).toEqual([bundle])
    expect(report.errors).toEqual([`unregister ${helper} failed: lsregister refused`])
    expect(deps.detachVolume).not.toHaveBeenCalled()
  })

  it('requires a successful unregister even after recovering from an already-absent registration', async () => {
    const { unregisterBundle } = createSystemInstallArtifactHousekeepingDependencies({
      currentVersion: receipt.targetVersion,
      runningExecutable,
      userData: '/fixture',
    })
    mocks.command.mockReset()
    mocks.command
      .mockRejectedValueOnce(new Error(`failed to scan ${bundle}: -10814`))
      .mockResolvedValueOnce({ stdout: '', stderr: '' })
      .mockRejectedValueOnce(new Error('unregister still failing'))
    await expect(unregisterBundle(bundle)).rejects.toThrow('unregister still failing')
    expect(mocks.command.mock.calls.map(([, args]) => args)).toEqual([
      ['-u', bundle],
      ['-f', bundle],
      ['-u', bundle],
    ])
  })

  it('never detaches if the mount changed during cleanup', async () => {
    const readMount = vi
      .fn()
      .mockResolvedValueOnce(mount)
      .mockResolvedValueOnce(mount)
      .mockResolvedValue({ ...mount, deviceNode: '/dev/disk8s1' })
    const deps = createDependencies({ getReadOnlyMount: readMount })
    await runInstallArtifactHousekeeping(deps)
    expect(deps.detachVolume).not.toHaveBeenCalled()
  })

  it('reports a busy volume after a single detach attempt', async () => {
    const detachVolume = vi.fn(async () => {
      throw new Error('Resource busy')
    })
    const deps = createDependencies({ detachVolume })
    const result = await runInstallArtifactHousekeeping(deps)
    expect(result.detached).toEqual([])
    expect(result.errors).toEqual([`detach ${mount.mountPath} failed: Resource busy`])
    expect(detachVolume).toHaveBeenCalledTimes(1)
  })
})

describe('cleanup scheduling', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.clearAllMocks()
  })
  const options = {
    platform: 'darwin' as const,
    isPackaged: true,
    isDevPackage: false,
    currentVersion: receipt.targetVersion,
    runningExecutable,
    userData: '/fixture',
    delayMs: 10,
  }

  it('uses an explicit macOS platform and logs stage failures', async () => {
    vi.useFakeTimers()
    const deps = createDependencies({
      detachVolume: async () => {
        throw new Error('Resource busy')
      },
    })
    scheduleInstallArtifactHousekeeping({ ...options, dependencies: deps })
    expect(deps.readReceipt).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(10)
    expect(deps.readReceipt).toHaveBeenCalledOnce()
    expect(mocks.warn).toHaveBeenCalledWith(expect.stringContaining('Resource busy'))
  })

  it('skips dev, unbundled, other platforms and opt-out', async () => {
    vi.useFakeTimers()
    const deps = createDependencies()
    for (const overrides of [
      { isDevPackage: true },
      { isPackaged: false },
      { platform: 'linux' as const },
      { env: { SPARK_SKIP_INSTALL_HOUSEKEEPING: '1' } },
    ])
      scheduleInstallArtifactHousekeeping({ ...options, ...overrides, dependencies: deps })
    await vi.advanceTimersByTimeAsync(10)
    expect(deps.readReceipt).not.toHaveBeenCalled()
  })
})

/** Recycle the updater's own read-only macOS installer after the target app starts. */
import { readdir, realpath, stat } from 'node:fs/promises'
import { isAbsolute, join, relative, sep } from 'node:path'
import { createLogger } from '@spark/shared'
import { APP_BUNDLE_ID } from '../build-flavor.js'
import { shouldRunInstallArtifactHousekeeping } from '../startup-isolation.js'
import { readMacInstallerReceipt, type MacInstallerReceipt } from './MacInstallerReceipt.js'
import {
  detachMacInstaller,
  getReadOnlyInstallerMount,
  readPlistAsJson,
  runMacInstallerCommand,
  type MacInstallerMount,
} from './MacInstallerMount.js'

const log = createLogger('install-housekeeping')
const LSREGISTER =
  '/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister'
const DEFAULT_DELAY_MS = 15_000
const NESTED_BUNDLE_DIRS = ['Contents/Frameworks', 'Contents/Resources'] as const

export interface HousekeepingReport {
  unregistered: string[]
  detached: string[]
  errors: string[]
}

export interface InstallArtifactHousekeepingDependencies {
  currentVersion: string
  runningExecutable: string
  readReceipt: () => Promise<MacInstallerReceipt | null>
  getReadOnlyMount: (receipt: MacInstallerReceipt) => Promise<MacInstallerMount | null>
  listAppDirectories: (directory: string) => Promise<string[]>
  readBundleInfo: (appPath: string) => Promise<{ bundleIdentifier: unknown; shortVersion: unknown }>
  volumeIdentity: (path: string) => Promise<number>
  unregisterBundle: (bundlePath: string) => Promise<void>
  detachVolume: (mount: MacInstallerMount) => Promise<void>
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function isInside(directory: string, candidate: string): boolean {
  const path = relative(directory, candidate)
  return path !== '' && path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path)
}

export async function runInstallArtifactHousekeeping(
  deps: InstallArtifactHousekeepingDependencies,
): Promise<HousekeepingReport> {
  const report: HousekeepingReport = { unregistered: [], detached: [], errors: [] }
  let stage = 'read installer receipt'
  try {
    const receipt = await deps.readReceipt()
    if (receipt == null || receipt.targetVersion !== deps.currentVersion) return report
    if (deps.runningExecutable.split(sep).includes('AppTranslocation')) return report

    stage = 'verify read-only installer mount'
    const mount = await deps.getReadOnlyMount(receipt)
    if (mount == null || isInside(mount.mountPath, deps.runningExecutable)) return report
    const mountDevice = await deps.volumeIdentity(mount.mountPath)
    if (mountDevice === (await deps.volumeIdentity(deps.runningExecutable))) return report

    stage = `inspect installer bundle at ${mount.mountPath}`
    const apps = await deps.listAppDirectories(mount.mountPath)
    if (apps.length !== 1 || apps[0] == null) return report
    const appPath = join(mount.mountPath, apps[0])
    const info = await deps.readBundleInfo(appPath)
    if (info.bundleIdentifier !== APP_BUNDLE_ID || info.shortVersion !== receipt.targetVersion)
      return report

    const bundles = [appPath]
    for (const directory of NESTED_BUNDLE_DIRS) {
      const nested = join(appPath, directory)
      for (const name of await deps.listAppDirectories(nested)) bundles.push(join(nested, name))
    }

    // Check before mutating and again before detach. Never act on a replaced mount.
    const stillMounted = async (): Promise<boolean> => {
      const latest = await deps.getReadOnlyMount(receipt)
      return (
        latest?.mountPath === mount.mountPath &&
        latest.deviceNode === mount.deviceNode &&
        (await deps.volumeIdentity(mount.mountPath)) === mountDevice
      )
    }
    stage = `recheck installer mount at ${mount.mountPath}`
    if (!(await stillMounted())) return report
    for (const bundlePath of bundles) {
      stage = `unregister ${bundlePath}`
      if ((await deps.volumeIdentity(bundlePath)) !== mountDevice) return report
      await deps.unregisterBundle(bundlePath)
      report.unregistered.push(bundlePath)
    }

    stage = `detach ${mount.mountPath}`
    if (!(await stillMounted())) return report
    await deps.detachVolume(mount)
    report.detached.push(mount.mountPath)
    log.info(`installer volume recycled: ${mount.mountPath}`)
  } catch (error) {
    report.errors.push(`${stage} failed: ${describeError(error)}`)
  }
  return report
}

async function listAppDirectories(directory: string): Promise<string[]> {
  try {
    if ((await realpath(directory)) !== directory)
      throw new Error('Unexpected symlink in installer layout')
    const entries = await readdir(directory, { withFileTypes: true })
    return entries
      .filter((entry) => entry.isDirectory() && entry.name.endsWith('.app'))
      .map((entry) => entry.name)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
}

async function readBundleInfo(appPath: string) {
  const plistPath = join(appPath, 'Contents', 'Info.plist')
  if ((await realpath(plistPath)) !== plistPath)
    throw new Error('Unexpected symlink in installer Info.plist')
  const plist = (await readPlistAsJson(plistPath)) as Record<string, unknown>
  return {
    bundleIdentifier: plist.CFBundleIdentifier,
    shortVersion: plist.CFBundleShortVersionString,
  }
}

async function runLaunchServices(args: string[]): Promise<void> {
  const { stdout, stderr } = await runMacInstallerCommand(LSREGISTER, args)
  if (/failed|error/i.test(`${stdout}\n${stderr}`)) {
    throw new Error(`${stdout} ${stderr}`.trim())
  }
}

async function unregisterBundle(bundlePath: string): Promise<void> {
  try {
    await runLaunchServices(['-u', bundlePath])
  } catch (error) {
    if (!/failed to scan [^\n]+: -10814\b/.test(describeError(error))) throw error
    // macOS also reports -10814 after a previous successful unregister (e.g. the
    // volume was busy). Refresh this exact bundle, then require unregister to succeed.
    await runLaunchServices(['-f', bundlePath])
    await runLaunchServices(['-u', bundlePath])
  }
}

export interface ScheduleInstallArtifactHousekeepingOptions {
  isPackaged: boolean
  isDevPackage: boolean
  userData: string
  currentVersion: string
  runningExecutable: string
  platform?: NodeJS.Platform
  env?: Record<string, string | undefined>
  delayMs?: number
  dependencies?: Partial<InstallArtifactHousekeepingDependencies>
}

export function createSystemInstallArtifactHousekeepingDependencies(
  options: Pick<
    ScheduleInstallArtifactHousekeepingOptions,
    'userData' | 'currentVersion' | 'runningExecutable'
  >,
): InstallArtifactHousekeepingDependencies {
  return {
    currentVersion: options.currentVersion,
    runningExecutable: options.runningExecutable,
    readReceipt: () => readMacInstallerReceipt(options.userData),
    getReadOnlyMount: getReadOnlyInstallerMount,
    listAppDirectories,
    readBundleInfo,
    volumeIdentity: async (path) => (await stat(path)).dev,
    unregisterBundle,
    detachVolume: detachMacInstaller,
  }
}

export function scheduleInstallArtifactHousekeeping(
  options: ScheduleInstallArtifactHousekeepingOptions,
): void {
  if (
    (options.platform ?? process.platform) !== 'darwin' ||
    !options.isPackaged ||
    options.isDevPackage
  )
    return
  if (!shouldRunInstallArtifactHousekeeping(options.env ?? process.env)) return

  setTimeout(() => {
    void runInstallArtifactHousekeeping({
      ...createSystemInstallArtifactHousekeepingDependencies(options),
      ...options.dependencies,
    })
      .then((report) => {
        for (const error of report.errors) log.warn(error)
      })
      .catch((error: unknown) => {
        log.warn(`install artifact housekeeping crashed: ${describeError(error)}`)
      })
  }, options.delayMs ?? DEFAULT_DELAY_MS)
}

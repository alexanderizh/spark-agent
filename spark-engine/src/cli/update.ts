import { execFile } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import {
  lstat,
  mkdir,
  mkdtemp,
  open,
  realpath,
  readdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { delimiter, basename, dirname, join } from 'node:path'
import { promisify } from 'node:util'

import {
  installLauncher,
  isSparkOwnedLauncher,
  launcherPathFor,
  resolveSparkInstall,
  type SparkInstall,
} from './install.js'
import {
  checkNodeCompatibility,
  globalPackageDir,
  npmGlobalBin,
  npmGlobalRoot,
  npmRootForPrefix,
  readPackageManifestAt,
  readTarballPackageManifest,
  runNpm,
} from './npm-env.js'
import { fetchBounded } from './net.js'
import {
  fetchLatestManifest,
  fetchPinnedManifest,
  RELEASE_PACKAGE_NAME,
  resolveUpdateSource,
  tarballUrlFor,
  type ReleaseManifest,
} from './release.js'
import { compareSemVer, isPrerelease, parseSemVer, type SemVer } from './semver.js'

const executeFile = promisify(execFile)
const TARBALL_TIMEOUT_MS = 120_000
const TARBALL_MAX_BYTES = 256 * 1024 * 1024
const VERSION_PROBE_TIMEOUT_MS = 60_000
const BACKUP_PREFIX = '.spark-agent-backup-'
const LOCK_FILENAME = 'update.lock'
const LOCK_STALE_MS = 15 * 60_000

export type UpdateStatus =
  | 'update_available'
  | 'up_to_date'
  | 'remote_older'
  | 'prerelease_available'
  | 'updated'
  | 'locked'
  | 'failed'

/** Deterministic exit codes for scripts; documented in README and --help. */
export const UPDATE_EXIT_CODES = {
  acted: 0,
  nothingToDo: 1,
  usage: 2,
  failed: 3,
  locked: 4,
} as const

export interface UpdateReport {
  readonly status: UpdateStatus
  readonly current: string
  readonly latest?: string
  readonly base: string
  readonly pinned: boolean
  readonly root?: string
  readonly warnings: readonly string[]
}

export class UpdateError extends Error {
  constructor(message: string, options: { readonly cause?: unknown } = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause })
    this.name = 'UpdateError'
  }
}

/**
 * Prerelease gating: an identical version is up to date first; a prerelease
 * latest is reported as such unless explicitly allowed (or the version was
 * pinned); otherwise strict SemVer precedence decides upgrade vs downgrade.
 */
export function classifyUpdate(
  current: SemVer,
  latest: SemVer,
  allowPrerelease: boolean,
): 'update_available' | 'up_to_date' | 'remote_older' | 'prerelease_available' {
  const comparison = compareSemVer(current, latest)
  if (comparison === 0) return 'up_to_date'
  if (comparison > 0) return 'remote_older'
  if (isPrerelease(latest) && !allowPrerelease) return 'prerelease_available'
  return 'update_available'
}

export interface UpdateLock {
  readonly path: string
  release(): Promise<void>
}

/**
 * Cross-process update lock: exclusive create (~/.spark/update.lock) holding
 * the owner pid and acquisition time. A live owner is always honored. A
 * provably dead owner (ESRCH) is retaken immediately; an unreadable or
 * recycled owner pid falls back to the stale threshold, so a crashed updater
 * can never wedge updates and a reused pid can never steal a live one.
 */
export async function acquireUpdateLock(
  sparkHome: string,
  options: { readonly now?: () => number; readonly staleMs?: number } = {},
): Promise<UpdateLock | undefined> {
  const now = options.now ?? Date.now
  const staleMs = options.staleMs ?? LOCK_STALE_MS
  await mkdir(sparkHome, { recursive: true })
  const path = join(sparkHome, LOCK_FILENAME)
  const token = randomUUID()
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const handle = await open(path, 'wx')
      try {
        await handle.write(
          `${JSON.stringify({ pid: process.pid, token, acquiredAt: new Date().toISOString() })}\n`,
        )
      } finally {
        await handle.close()
      }
      return {
        path,
        release: async () => {
          const current = await readLock(path)
          if (current?.token === token) await rm(path, { force: true })
        },
      }
    } catch (error) {
      if (!isFileExistsError(error)) {
        throw new UpdateError(`unable to create the update lock at ${path}`, { cause: error })
      }
      if (attempt === 1) return undefined
      const owner = await readLock(path)
      if (owner !== undefined && lockOwnerIsDead(owner.pid)) {
        await rm(path, { force: true })
        continue
      }
      let mtimeMs: number
      try {
        mtimeMs = (await stat(path)).mtimeMs
      } catch {
        continue
      }
      if (now() - mtimeMs <= staleMs) return undefined
      await rm(path, { force: true })
    }
  }
  return undefined
}

/** True only when the kernel confirms no such process exists (ESRCH). */
function lockOwnerIsDead(pid: number): boolean {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return false
  } catch (error) {
    return (
      error instanceof Error && 'code' in error && (error as { code?: string }).code === 'ESRCH'
    )
  }
}

export interface UpdateCheckOutcome {
  readonly status: 'update_available' | 'up_to_date' | 'remote_older' | 'prerelease_available'
  readonly manifest: ReleaseManifest
  readonly current: string
  readonly base: string
  readonly pinned: boolean
  readonly downgrade: boolean
}

/**
 * Resolves the release manifest for the configured source and classifies it
 * against the running install. A pinned --target is deliberate user intent, so
 * prerelease gating is bypassed and downgrades are allowed with a note.
 */
export async function checkForUpdate(input: {
  readonly base?: string
  readonly target?: string
  readonly allowPrerelease: boolean
  readonly env?: NodeJS.ProcessEnv
  readonly sparkHome: string
  readonly install?: SparkInstall
}): Promise<UpdateCheckOutcome> {
  const install = input.install ?? (await resolveSparkInstall())
  const current = parseSemVer(install.version)
  if (current === undefined) {
    throw new UpdateError(
      `the running install reports version "${install.version}", which is not strict SemVer; unable to compare releases`,
    )
  }
  const source = resolveUpdateSource({
    ...(input.base === undefined ? {} : { flagBase: input.base }),
    ...(input.target === undefined ? {} : { flagVersion: input.target }),
    ...(input.env === undefined ? {} : { env: input.env }),
    sparkHome: input.sparkHome,
  })
  const pinnedVersion = source.version
  const manifest =
    pinnedVersion !== undefined
      ? await fetchPinnedManifest(source.base, pinnedVersion)
      : await fetchLatestManifest(source.base)
  const latest = parseSemVer(manifest.version)
  if (latest === undefined) {
    throw new UpdateError(`release version "${manifest.version}" is not strict SemVer`)
  }
  let status = classifyUpdate(current, latest, input.allowPrerelease || pinnedVersion !== undefined)
  let downgrade = false
  if (pinnedVersion !== undefined && status === 'remote_older') {
    status = 'update_available'
    downgrade = true
  }
  return {
    status,
    manifest,
    current: install.version,
    base: source.base,
    pinned: pinnedVersion !== undefined,
    downgrade,
  }
}

export interface UpdateIo {
  stdout(text: string): void
  stderr(text: string): void
}

/**
 * `spark update` / `spark upgrade` entry point. The transaction is:
 * download + checksum → package identity/engines verification → snapshot the
 * current install → npm install → verify the installed entry runs the expected
 * version → relink the bin launcher. Any failure restores the snapshot so the
 * previous spark keeps working.
 */
export async function executeUpdate(
  input: {
    readonly checkOnly: boolean
    readonly base?: string
    readonly target?: string
    readonly allowPrerelease: boolean
    readonly json: boolean
    readonly sparkHome: string
    readonly env?: NodeJS.ProcessEnv
    /** Overrides the fixed ~/.spark lock home; for isolated tests only. */
    readonly lockHome?: string
  },
  io: UpdateIo,
): Promise<number> {
  // The lock lives in the real user home, deliberately not under SPARK_HOME:
  // a redirected SPARK_HOME must never let two updaters race the same install.
  const lockHome = input.lockHome ?? process.env.SPARK_UPDATE_LOCK_DIR ?? join(homedir(), '.spark')
  try {
    const outcome = await checkForUpdate(input)
    if (input.checkOnly || outcome.status !== 'update_available') {
      emitCheckReport(outcome, input.json, io)
      return outcome.status === 'update_available'
        ? UPDATE_EXIT_CODES.acted
        : UPDATE_EXIT_CODES.nothingToDo
    }
    const lock = await acquireUpdateLock(lockHome)
    if (lock === undefined) {
      const lockWarning = `another spark update holds ${join(lockHome, LOCK_FILENAME)}; retry when it finishes`
      const report: UpdateReport = {
        status: 'locked',
        current: outcome.current,
        latest: outcome.manifest.version,
        base: outcome.base,
        pinned: outcome.pinned,
        warnings: [lockWarning],
      }
      io.stdout(input.json ? line(report, true) : `${lockWarning}\n`)
      return UPDATE_EXIT_CODES.locked
    }
    const staging = await mkdtemp(join(tmpdir(), 'spark-update-'))
    const warnings: string[] = []
    try {
      const root = await installVerifiedRelease({
        manifest: outcome.manifest,
        base: outcome.base,
        staging,
        sparkHome: input.sparkHome,
        warnings,
      })
      const note = outcome.downgrade
        ? `downgraded to ${outcome.manifest.version} as requested by the pinned target`
        : undefined
      const report: UpdateReport = {
        status: 'updated',
        current: outcome.current,
        latest: outcome.manifest.version,
        base: outcome.base,
        pinned: outcome.pinned,
        root,
        warnings,
      }
      if (input.json) {
        io.stdout(line(report, true))
      } else {
        const text = [`Updated spark ${outcome.current} -> ${outcome.manifest.version} at ${root}`]
        if (note) text.push(note)
        for (const warning of warnings) text.push(`NOTE: ${warning}`)
        text.push('Verify with: spark doctor')
        io.stdout(`${text.join('\n')}\n`)
      }
      return UPDATE_EXIT_CODES.acted
    } finally {
      await lock.release()
      await rm(staging, { recursive: true, force: true })
    }
  } catch (error) {
    return reportFailure(error, input.json, io)
  }
}

function emitCheckReport(outcome: UpdateCheckOutcome, json: boolean, io: UpdateIo): void {
  const report: UpdateReport = {
    status: outcome.status,
    current: outcome.current,
    latest: outcome.manifest.version,
    base: outcome.base,
    pinned: outcome.pinned,
    warnings: [],
  }
  if (json) {
    io.stdout(line(report, true))
    return
  }
  const lines: string[] = []
  switch (outcome.status) {
    case 'update_available':
      lines.push(
        `Update available: ${outcome.current} -> ${outcome.manifest.version} (from ${outcome.base})`,
      )
      break
    case 'up_to_date':
      lines.push(`spark ${outcome.current} is up to date (checked ${outcome.base}).`)
      break
    case 'remote_older':
      lines.push(
        `The latest release is ${outcome.manifest.version}, older than the installed ${outcome.current}; refusing to downgrade.`,
      )
      break
    case 'prerelease_available':
      lines.push(
        `The latest release ${outcome.manifest.version} is a prerelease; pass --allow-prerelease to install it.`,
      )
      break
  }
  io.stdout(`${lines.join('\n')}\n`)
}

/**
 * Resolves the real update/uninstall target: the npm global tree that hosts
 * THIS installation (derived from resolveSparkInstall and cross-checked
 * against the companion npm), not whatever the first npm on PATH would pick.
 */
export async function resolveUpdateTarget(): Promise<{
  readonly npmRoot: string
  readonly npmBin: string
  readonly liveDir: string
}> {
  const npmRoot = await npmGlobalRoot()
  const npmBin = await npmGlobalBin()
  const runningInstall = await resolveSparkInstall()
  const expectedNpmRoot = dirname(dirname(runningInstall.root))
  if (
    basename(expectedNpmRoot) === 'node_modules' &&
    !(await sameDirectory(npmRoot, expectedNpmRoot))
  ) {
    throw new UpdateError(
      `this spark runs from ${runningInstall.root}, but the configured npm global tree is ${npmRoot}; align them (same node/npm) or operate on that installation directly`,
    )
  }
  return { npmRoot, npmBin, liveDir: globalPackageDir(npmRoot) }
}

async function installVerifiedRelease(options: {
  readonly manifest: ReleaseManifest
  readonly base: string
  readonly staging: string
  readonly sparkHome: string
  readonly warnings: string[]
}): Promise<string> {
  const { manifest, base, staging, sparkHome, warnings } = options

  const tarballPath = join(staging, manifest.tarball)
  const { bytes } = await fetchBounded(tarballUrlFor(base, manifest), {
    timeoutMs: TARBALL_TIMEOUT_MS,
    maxBytes: TARBALL_MAX_BYTES,
  })
  await writeFile(tarballPath, bytes)
  const actualSha = createHash('sha256').update(bytes).digest('hex')
  if (actualSha !== manifest.sha256) {
    throw new UpdateError(
      `checksum mismatch for ${manifest.version}: the manifest says ${manifest.sha256}, the download hashed ${actualSha}`,
    )
  }

  const { manifest: packageManifest } = await readTarballPackageManifest(tarballPath)
  if (packageManifest.name !== RELEASE_PACKAGE_NAME) {
    throw new UpdateError(
      `tarball package identity is "${packageManifest.name ?? 'unknown'}", expected "${RELEASE_PACKAGE_NAME}"`,
    )
  }
  if (packageManifest.version !== manifest.version) {
    throw new UpdateError(
      `the tarball reports version ${packageManifest.version ?? 'unknown'}, but the release manifest says ${manifest.version}`,
    )
  }
  const nodeCheck = checkNodeCompatibility(packageManifest.nodeEngines)
  if (!nodeCheck.ok) {
    throw new UpdateError(
      `the new release requires a different Node.js runtime (${packageManifest.nodeEngines ?? 'unknown range'}): ${nodeCheck.detail ?? 'incompatible'}`,
    )
  }

  const { npmBin, liveDir } = await resolveUpdateTarget()
  const scopeDir = dirname(liveDir)
  await mkdir(scopeDir, { recursive: true })
  await recoverInterruptedUpdate(scopeDir, liveDir, warnings)

  const liveLink = await lstat(liveDir).catch(() => undefined)
  if (liveLink?.isSymbolicLink()) {
    throw new UpdateError(
      `${liveDir} is a symlink (typically an \`npm link\` development checkout); refusing to replace it — run \`npm unlink -g @spark/agent\` first or update via npm in the linked repository`,
    )
  }

  const existing = await readPackageManifestAt(liveDir)
  if (existing?.name !== undefined && existing.name !== RELEASE_PACKAGE_NAME) {
    throw new UpdateError(
      `${liveDir} belongs to package "${existing.name}"; refusing to replace it — uninstall that package first`,
    )
  }

  const stagePrefix = await mkdtemp(join(scopeDir, '.spark-agent-stage-'))
  await runNpm(['install', '-g', '--prefix', stagePrefix, '--no-audit', '--no-fund', tarballPath])
  const stagedDir = globalPackageDir(npmRootForPrefix(stagePrefix))
  await verifyInstalledVersion(stagedDir, manifest.version)

  let backup: SwapBackup | undefined
  try {
    backup = await swapStagedPackage({ stagedDir, liveDir, scopeDir })
    warnings.push(...(await ensureBinLauncher(liveDir, npmBin, manifest.version)))
    warnings.push(...(await ensureBinLauncher(liveDir, join(sparkHome, 'bin'), manifest.version)))
    await verifyInstalledHealth(liveDir, manifest.version, npmBin, staging)
  } catch (error) {
    let restoreNote: string | undefined
    if (backup !== undefined) restoreNote = await rollbackSwap(liveDir, backup)
    const base2 = error instanceof Error ? error.message : String(error)
    throw new UpdateError(restoreNote ? `${base2} — ${restoreNote}` : base2, { cause: error })
  }

  if (backup !== undefined) await rm(backup.dir, { recursive: true, force: true })
  await rm(stagePrefix, { recursive: true, force: true })
  return liveDir
}

interface SwapBackup {
  readonly dir: string
  readonly packagePath: string
}

/**
 * Swaps the verified staged package directory into the live global tree by a
 * pair of renames: the previous package moves aside atomically, then the whole
 * staged package (dependencies ride inside `@spark/agent/node_modules`, as the
 * companion npm installs them for a tarball install) moves in. Same volume, so
 * each rename is atomic and any failure rolls the old version back.
 */
async function swapStagedPackage(options: {
  readonly stagedDir: string
  readonly liveDir: string
  readonly scopeDir: string
}): Promise<SwapBackup> {
  const { stagedDir, liveDir, scopeDir } = options
  const backupDir = join(scopeDir, `${BACKUP_PREFIX}${process.pid}`)
  const packageBackup = join(backupDir, 'package')
  await rm(backupDir, { recursive: true, force: true })
  await mkdir(backupDir, { recursive: true })
  try {
    if (await pathExists(liveDir)) await rename(liveDir, packageBackup)
    await rename(stagedDir, liveDir)
    return { dir: backupDir, packagePath: packageBackup }
  } catch (error) {
    await rollbackSwap(liveDir, { dir: backupDir, packagePath: packageBackup })
    throw new UpdateError(
      `the staged install could not be swapped into ${liveDir}: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    )
  }
}

/**
 * Restores the pre-swap package. Returns a manual-action note when something
 * could not be restored automatically.
 */
async function rollbackSwap(liveDir: string, backup: SwapBackup): Promise<string | undefined> {
  let note: string | undefined
  await rm(liveDir, { recursive: true, force: true }).catch(() => undefined)
  if (await pathExists(backup.packagePath)) {
    try {
      await rename(backup.packagePath, liveDir)
    } catch {
      note = `the previous version could not be restored automatically; move ${backup.packagePath} back to ${liveDir}`
    }
  }
  return note
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

/**
 * Equality that survives macOS `/var` vs `/private/var` style symlinks: both
 * directories exist at this point, so realpath is safe on either side.
 */
async function sameDirectory(left: string, right: string): Promise<boolean> {
  if (left === right) return true
  const [leftReal, rightReal] = await Promise.all([
    realpath(left).catch(() => undefined),
    realpath(right).catch(() => undefined),
  ])
  return leftReal !== undefined && leftReal === rightReal
}

/**
 * Restores consistency after an updater that was killed mid-transaction. The
 * backup directory holds the previous package under `package/`; if the live
 * package is missing it is renamed back, and any leftover snapshot is removed.
 */
export async function recoverInterruptedUpdate(
  scopeDir: string,
  liveDir: string,
  warnings: string[],
): Promise<void> {
  let entries: readonly string[]
  try {
    entries = await readdir(scopeDir)
  } catch {
    return
  }
  for (const entry of entries) {
    if (!entry.startsWith(BACKUP_PREFIX)) continue
    const backupDir = join(scopeDir, entry)
    const packageBackup = join(backupDir, 'package')
    const backupManifest = await readPackageManifestAt(packageBackup)
    if (backupManifest?.name === RELEASE_PACKAGE_NAME && !(await pathExists(liveDir))) {
      // Only a snapshot that provably belongs to spark is promoted back.
      await mkdir(dirname(liveDir), { recursive: true })
      await rename(packageBackup, liveDir)
      warnings.push(
        `restored the previous spark version from ${backupDir} (an earlier update was interrupted)`,
      )
    } else if (backupManifest?.name !== undefined) {
      warnings.push(
        `removed leftover backup ${backupDir} belonging to "${backupManifest.name}" from an interrupted update`,
      )
    } else {
      warnings.push(`removed leftover backup ${backupDir} from an interrupted update`)
    }
    await rm(backupDir, { recursive: true, force: true })
  }
}

async function verifyInstalledVersion(liveDir: string, expected: string): Promise<void> {
  const entry = join(liveDir, 'dist', 'cli', 'main.js')
  try {
    const { stdout } = await executeFile(process.execPath, [entry, '--version'], {
      timeout: VERSION_PROBE_TIMEOUT_MS,
      encoding: 'utf8',
    })
    if (stdout.trim() !== expected) {
      throw new UpdateError(
        `the installed spark reports ${stdout.trim() || 'no version'}, expected ${expected}`,
      )
    }
  } catch (error) {
    if (error instanceof UpdateError) throw error
    throw new UpdateError(`the updated spark at ${entry} did not run: ${inlineError(error)}`, {
      cause: error,
    })
  }
}

async function verifyInstalledHealth(
  liveDir: string,
  expected: string,
  npmBin: string,
  staging: string,
): Promise<void> {
  await verifyInstalledVersion(liveDir, expected)
  const entry = join(liveDir, 'dist', 'cli', 'main.js')
  const healthHome = join(staging, 'doctor-home')
  await mkdir(healthHome, { recursive: true })
  const { stdout, code } = await executeForStatus(process.execPath, [entry, 'doctor', '--json'], {
    cwd: staging,
    env: {
      ...process.env,
      SPARK_HOME: healthHome,
      PATH: [npmBin, process.env.PATH ?? ''].join(delimiter),
    },
  })
  if (code !== 0 && code !== 1) {
    throw new UpdateError(`the updated spark doctor exited with code ${code}`)
  }
  try {
    const report: unknown = JSON.parse(stdout)
    if (typeof report !== 'object' || report === null) throw new Error('not an object')
    const install: unknown = Reflect.get(report, 'install')
    if (typeof install !== 'object' || install === null)
      throw new Error('missing install diagnostics')
    const running: unknown = Reflect.get(install, 'running')
    if (
      typeof running !== 'object' ||
      running === null ||
      Reflect.get(running, 'version') !== expected
    ) {
      throw new Error('running version does not match')
    }
  } catch (error) {
    throw new UpdateError(
      `the updated spark doctor returned invalid diagnostics: ${inlineError(error)}`,
    )
  }
}

/**
 * Keeps the npm bin launcher correct after the swap: a launcher that provably
 * belongs to spark (a symlink into the package, or a shim referencing it) is
 * refreshed; a foreign entry is reported and never clobbered without --force.
 */
async function ensureBinLauncher(
  liveDir: string,
  npmBin: string,
  version: string,
): Promise<readonly string[]> {
  const warnings: string[] = []
  const entry = join(liveDir, 'dist', 'cli', 'main.js')
  const launcherPath = launcherPathFor(npmBin, process.platform)
  const existing = await stat(launcherPath).catch(() => undefined)
  if (
    existing !== undefined &&
    !(await isSparkOwnedLauncher(launcherPath, process.platform, liveDir))
  ) {
    warnings.push(
      `${launcherPath} already exists and is not a spark launcher; it was left untouched`,
    )
    return warnings
  }
  await installLauncher({ install: { root: liveDir, version, entry }, binDir: npmBin })
  return warnings
}

function executeForStatus(
  command: string,
  args: readonly string[],
  options: { readonly cwd: string; readonly env: NodeJS.ProcessEnv },
): Promise<{ stdout: string; stderr: string; code: number | null }> {
  return new Promise((resolveStatus) => {
    execFile(
      command,
      [...args],
      { ...options, encoding: 'utf8', timeout: VERSION_PROBE_TIMEOUT_MS },
      (error, stdout, stderr) => {
        const code =
          error instanceof Error && 'code' in error && typeof error.code === 'number'
            ? error.code
            : error
              ? null
              : 0
        resolveStatus({ stdout, stderr, code })
      },
    )
  })
}

async function readLock(path: string): Promise<{ pid: number; token?: string } | undefined> {
  try {
    const value: unknown = JSON.parse(await readFile(path, 'utf8'))
    if (typeof value !== 'object' || value === null) return undefined
    const pid: unknown = Reflect.get(value, 'pid')
    const token: unknown = Reflect.get(value, 'token')
    if (!Number.isSafeInteger(pid) || Number(pid) <= 0) return undefined
    return { pid: Number(pid), ...(typeof token === 'string' ? { token } : {}) }
  } catch {
    return undefined
  }
}

function line(report: UpdateReport, json: boolean): string {
  if (!json) return ''
  return `${JSON.stringify({
    status: report.status,
    current: report.current,
    ...(report.latest === undefined ? {} : { latest: report.latest }),
    base: report.base,
    pinned: report.pinned,
    ...(report.root === undefined ? {} : { root: report.root }),
    ...(report.warnings.length === 0 ? {} : { warnings: report.warnings }),
  })}\n`
}

function reportFailure(error: unknown, json: boolean, io: UpdateIo): number {
  const text = `spark update failed: ${inlineError(error)}`
  io.stderr(`${text}\n`)
  if (json) io.stdout(`${JSON.stringify({ status: 'failed', error: text })}\n`)
  return UPDATE_EXIT_CODES.failed
}

function inlineError(error: unknown): string {
  if (error instanceof Error) return error.message.replace(/\s+/gu, ' ').trim()
  return String(error)
}

function isFileExistsError(error: unknown): boolean {
  return error instanceof Error && 'code' in error && (error as { code?: string }).code === 'EEXIST'
}

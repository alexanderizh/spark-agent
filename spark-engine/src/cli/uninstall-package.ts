import { lstat, readFile, readlink, realpath, rename, rm } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'

import { launcherPathFor, uninstallLauncher } from './install.js'
import { readPackageManifestAt } from './npm-env.js'
import { RELEASE_PACKAGE_NAME } from './release.js'
import { resolveUpdateTarget, UPDATE_EXIT_CODES } from './update.js'

const PRESERVED_NOTE = '~/.spark configuration, sessions, and caches are never removed by spark'

export interface PackageUninstallReport {
  readonly status: 'removed' | 'absent' | 'failed'
  readonly removed: readonly string[]
  readonly preserved: readonly string[]
  readonly warnings: readonly string[]
  readonly packageDir?: string
}

/**
 * `spark uninstall --package`: removes only what provably belongs to spark —
 * the npm-managed @spark/agent package, its npm bin shims, and the
 * ~/.spark/bin launcher. ~/.spark configuration, sessions, and caches are
 * never touched, and foreign `spark` entries on PATH are reported, not
 * deleted. Returns the process exit code.
 */
export async function uninstallSparkPackage(
  options: {
    readonly sparkHome: string
    readonly binDir: string
    readonly platform?: NodeJS.Platform
  },
  io: { stdout(text: string): void; stderr(text: string): void },
  json: boolean,
): Promise<number> {
  const platform = options.platform ?? process.platform
  const removed: string[] = []
  const warnings: string[] = []

  try {
    const { npmRoot, npmBin, liveDir } = await resolveUpdateTarget()
    const existing = await readPackageManifestAt(liveDir)
    if (existing?.name === RELEASE_PACKAGE_NAME) {
      // Ownership of every entry must be proven and the launchers removed
      // WHILE the package is still in place: ownership verification reads the
      // launcher target's package.json, which would be gone after the swap.
      const liveDirAliases = await liveDirIdentities(liveDir)
      const shims = await provableShims(npmBin, liveDirAliases, platform)
      try {
        const launcher = await uninstallLauncher({ binDir: options.binDir, platform })
        if (launcher === 'removed') removed.push(launcherPathFor(options.binDir, platform))
      } catch (error) {
        warnings.push(
          `${launcherPathFor(options.binDir, platform)} was not removed: ${error instanceof Error ? error.message : String(error)}`,
        )
      }
      for (const shim of shims) {
        await rm(shim, { force: true })
        removed.push(shim)
      }
      const pending = join(dirname(liveDir), `.spark-agent-uninstall-${process.pid}`)
      await rm(pending, { recursive: true, force: true })
      await rename(liveDir, pending)
      await rm(pending, { recursive: true, force: true })
      removed.push(liveDir)
      const leftovers = await foreignSparkEntries(npmBin, platform)
      for (const shim of leftovers) {
        warnings.push(`${shim} exists but does not provably belong to spark; left untouched`)
      }
    } else if (existing !== undefined) {
      throw new Error(
        `${liveDir} belongs to package "${existing.name ?? 'unknown'}"; refusing to remove it — uninstall that package with its own tooling`,
      )
    } else {
      warnings.push(`no @spark/agent package is installed under ${npmRoot}`)
      try {
        const launcher = await uninstallLauncher({ binDir: options.binDir, platform })
        if (launcher === 'removed') removed.push(launcherPathFor(options.binDir, platform))
      } catch (error) {
        warnings.push(
          `${launcherPathFor(options.binDir, platform)} was not removed: ${error instanceof Error ? error.message : String(error)}`,
        )
      }
    }

    const status = removed.length > 0 ? 'removed' : 'absent'
    emit(status, removed, warnings, json, io)
    return UPDATE_EXIT_CODES.acted
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    io.stderr(`spark uninstall --package failed: ${message}\n`)
    if (json) {
      io.stdout(`${JSON.stringify({ status: 'failed', error: message, removed, warnings })}\n`)
    }
    return UPDATE_EXIT_CODES.failed
  }
}

/** Every path spelling that should be treated as the same live directory. */
async function liveDirIdentities(liveDir: string): Promise<readonly string[]> {
  const identities = new Set<string>([liveDir])
  const canonical = await realpath(liveDir).catch(() => undefined)
  if (canonical !== undefined) identities.add(canonical)
  return [...identities]
}

/** npm bin entries whose target resolves into the spark package directory. */
async function provableShims(
  npmBin: string,
  liveDirAliases: readonly string[],
  platform: NodeJS.Platform,
): Promise<readonly string[]> {
  const targetsLive = (target: string): boolean => {
    const resolved = resolve(npmBin, target)
    return liveDirAliases.some((alias) => isInside(resolved, alias))
  }
  if (platform === 'win32') {
    const names = ['spark.cmd', 'spark.ps1', 'spark']
    const proven: string[] = []
    for (const name of names) {
      const path = join(npmBin, name)
      const info = await lstat(path).catch(() => undefined)
      if (info?.isFile() !== true) continue
      const content = await readFile(path, 'utf8').catch(() => '')
      if (
        liveDirAliases.some((alias) => content.includes(alias)) ||
        content.includes('@spark/agent launcher')
      ) {
        proven.push(path)
      }
    }
    return proven
  }
  const path = join(npmBin, 'spark')
  const info = await lstat(path).catch(() => undefined)
  if (!info?.isSymbolicLink()) return []
  const target = await readlink(path).catch(() => undefined)
  if (target === undefined) return []
  return targetsLive(target) ? [path] : []
}

/** True when `child` equals or lives under `parent`, compared by segments. */
function isInside(child: string, parent: string): boolean {
  const rel = relative(parent, child)
  return rel === '' || (!(rel.startsWith(`..${sep}`) || rel === '..') && !isAbsolute(rel))
}

/** npm bin entries named spark that are NOT provably ours (reported, kept). */
async function foreignSparkEntries(
  npmBin: string,
  platform: NodeJS.Platform,
): Promise<readonly string[]> {
  const candidates = platform === 'win32' ? ['spark.cmd', 'spark.ps1', 'spark'] : ['spark']
  const foreign: string[] = []
  for (const name of candidates) {
    const path = join(npmBin, name)
    if ((await lstat(path).catch(() => undefined)) === undefined) continue
    // Called after the package was removed, so anything left cannot resolve
    // into it anymore; dangling symlinks that pointed at spark are reported
    // as foreign-but-kept for manual review rather than deleted.
    foreign.push(path)
  }
  return foreign
}

function emit(
  status: 'removed' | 'absent',
  removed: readonly string[],
  warnings: readonly string[],
  json: boolean,
  io: { stdout(text: string): void },
): void {
  if (json) {
    io.stdout(
      `${JSON.stringify({
        status,
        ...(removed.length === 0 ? {} : { removed }),
        preserved: PRESERVED_NOTE,
        ...(warnings.length === 0 ? {} : { warnings }),
      })}\n`,
    )
    return
  }
  const lines: string[] = []
  if (removed.length > 0) {
    lines.push('Removed:')
    for (const path of removed) lines.push(`  ${path}`)
  } else {
    lines.push('Nothing spark-owned was found to remove.')
  }
  for (const warning of warnings) lines.push(`NOTE: ${warning}`)
  lines.push(`Kept: ${PRESERVED_NOTE}.`)
  io.stdout(`${lines.join('\n')}\n`)
}

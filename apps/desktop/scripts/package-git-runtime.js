/**
 * package-git-runtime - Ship the bundled Git runtime into the installer.
 *
 * Phase 1 of docs/plans/2026-08-24-bundled-git-runtime-fallback.md.
 *
 * Fail-closed contract:
 *   The runtime lock (apps/desktop/runtime/git-runtime-lock.json) must contain
 *   an entry matching the build target platform/arch. Missing entry, missing
 *   archive, or SHA256 mismatch aborts the pack - never fall back to "rely on
 *   the user's system Git".
 *
 * Source archive resolution (in order):
 *   1. SPARK_GIT_RUNTIME_ARCHIVE  - absolute path to the verified archive
 *   2. SPARK_GIT_RUNTIME_DIR      - directory containing <artifactId>.<ext>
 */

const fs = require('fs/promises')
const path = require('path')
const crypto = require('crypto')
const { execFile } = require('child_process')
const { promisify } = require('util')
const { Arch } = require('builder-util')

const execFileAsync = promisify(execFile)

const LOCK_PATH = path.join(__dirname, '..', 'runtime', 'git-runtime-lock.json')

const ARCHIVE_EXTENSIONS = ['.tar.gz', '.zip']

async function loadGitRuntimeLock(lockPath = LOCK_PATH) {
  const raw = await fs.readFile(lockPath, 'utf-8')
  const lock = JSON.parse(raw)
  if (lock.schemaVersion !== 1 || !Array.isArray(lock.targets)) {
    throw new Error(`Invalid Git runtime lock: ${lockPath}`)
  }
  return lock
}

function targetArchitecture(value) {
  const architecture = typeof value === 'number' ? Arch[value] : value
  if (architecture !== 'x64' && architecture !== 'arm64') {
    throw new Error(`Git runtime does not support target architecture: ${architecture}`)
  }
  return architecture
}

function findLockEntry(lock, platform, arch) {
  return (
    lock.targets.find(
      (target) => target.platform === platform && target.arch === arch,
    ) ?? null
  )
}

async function resolveSourceArchive(entry, environment) {
  const explicit = environment.SPARK_GIT_RUNTIME_ARCHIVE
  if (explicit) {
    await fs.access(explicit)
    return explicit
  }
  const dir = environment.SPARK_GIT_RUNTIME_DIR
  if (dir) {
    for (const ext of ARCHIVE_EXTENSIONS) {
      const candidate = path.join(dir, `${entry.artifactId}${ext}`)
      try {
        await fs.access(candidate)
        return candidate
      } catch {
        // try next extension
      }
    }
  }
  throw new Error(
    `Git runtime archive for ${entry.artifactId} not found. Set SPARK_GIT_RUNTIME_ARCHIVE or SPARK_GIT_RUNTIME_DIR.`,
  )
}

async function sha256File(filePath) {
  const hash = crypto.createHash('sha256')
  await pipelineFile(filePath, (chunk) => hash.update(chunk))
  return hash.digest('hex')
}

function pipelineFile(filePath, onData) {
  const { createReadStream } = require('fs')
  return new Promise((resolve, reject) => {
    const stream = createReadStream(filePath)
    stream.on('data', onData)
    stream.on('error', reject)
    stream.on('end', resolve)
  })
}

function destinationRoot(context) {
  const platform = context.electronPlatformName
  if (platform === 'darwin') {
    const appName = context.packager.appInfo.productFilename
    return path.join(context.appOutDir, `${appName}.app`, 'Contents`, 'Resources', 'runtime', 'git')
  }
  return path.join(context.appOutDir, 'resources', 'runtime', 'git')
}

async function extractArchive(archivePath, destinationRoot) {
  await fs.mkdir(destinationRoot, { recursive: true })
  if (archivePath.endsWith('.zip')) {
    // Windows runners: PowerShell Expand-Archive handles long paths.
    await execFileAsync(
      'powershell.exe',
      [
        '-NoProfile',
        '-Command',
        `Expand-Archive -LiteralPath "${archivePath}" -DestinationPath "${destinationRoot}" -Force`,
      ],
      { timeout: 10 * 60 * 1000 },
    )
    return
  }
  await execFileAsync(
    'tar',
    ['-xzf', archivePath, '-C', destinationRoot, '--strip-components', '1'],
    { timeout: 10 * 60 * 1000 },
  )
}

async function verifyPackagedGitRuntime(root, entry, expectedVersion, environment) {
  const executablePath = path.join(root, ...entry.entry.split('/'))
  try {
    await fs.access(executablePath)
  } catch {
    throw new Error(`Bundled Git entry executable missing after extraction: ${entry.entry}`)
  }
  const { stdout } = await execFileAsync(executablePath, ['--version'], {
    timeout: 15000,
    env: environment,
  })
  const match = stdout.match(/git version (\d+\.\d+(\.\d+)?)/i)
  if (match?.[1] !== expectedVersion) {
    throw new Error(
      `Bundled Git version mismatch: expected ${expectedVersion}, got ${match?.[1] ?? stdout.trim()}`,
    )
  }
  const gitCore = path.join(root, 'libexec', 'git-core')
  try {
    await fs.access(gitCore)
  } catch {
    throw new Error('Bundled Git runtime is missing libexec/git-core helpers')
  }
  return { executablePath, version: match[1] }
}

async function packageGitRuntime(context, options = {}) {
  const platform = context.electronPlatformName
  const arch = targetArchitecture(context.arch)
  const environment = options.environment ?? process.env
  const lock = options.lock ?? (await loadGitRuntimeLock())

  const entry = findLockEntry(lock, platform, arch)
  if (!entry) {
    throw new Error(
      `Git runtime lock has no entry for ${platform}/${arch}. Releases must fail closed: ` +
        'add a lock entry after the Phase 0 artifact gates pass, or this target cannot ship.',
    )
  }

  const archivePath = options.archivePath ?? (await resolveSourceArchive(entry, environment))
  const archiveSha = await sha256File(archivePath)
  if (archiveSha !== entry.archiveSha256) {
    throw new Error(
      `Git runtime archive SHA256 mismatch for ${entry.artifactId}: expected ${entry.archiveSha256}, got ${archiveSha}`,
    )
  }

  const root = destinationRoot(context)
  await extractArchive(archivePath, root)
  const verified = await verifyPackagedGitRuntime(
    root,
    entry,
    entry.version,
    environment,
  )

  await fs.writeFile(
    path.join(root, 'git-runtime.json'),
    `${JSON.stringify(
      {
        version: verified.version,
        platform,
        arch,
        entry: entry.entry,
        artifactId: entry.artifactId,
        archiveSha256: entry.archiveSha256,
      },
      null,
      2,
    )}\n`,
    'utf-8',
  )

  console.log(
    `[after-pack] Git runtime: ${entry.artifactId} -> ${root} (git ${verified.version})`,
  )
  return { root, ...verified, artifactId: entry.artifactId }
}

module.exports = {
  packageGitRuntime,
  verifyPackagedGitRuntime,
  loadGitRuntimeLock,
  findLockEntry,
  targetArchitecture,
  destinationRoot,
  LOCK_PATH,
}

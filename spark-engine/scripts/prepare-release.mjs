// Prepares a distributable release directory for the one-line installers:
//
//   node scripts/prepare-release.mjs [output-dir]
//
// Produces:
//   spark-agent-<version>.tgz          npm tarball (npm pack) — immutable
//   spark-agent-<version>.tgz.sha256   "<hash>  <file>" sidecar — immutable
//   latest.json                        { name, version, sha256, tarball, publishedAt }
//   install.sh / install.ps1 / install.cmd
//
// Contracts:
// - Versioned artifacts are immutable: republishing the same version with
//   different content is a hard error (republishing identical bytes is a no-op).
// - latest.json is the only mutable pointer and is replaced atomically
//   (write temp + rename), so clients never observe a torn file.
//
// The directory can be uploaded to any static host (including the repository
// MinIO artifact conventions); install.sh / install.ps1 consume it via --base,
// and `spark update` consumes latest.json plus the .sha256 sidecars.

import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  access,
  chmod,
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'

// Shared release contract: base URL constant, strict SemVer, latest.json
// schema — see scripts/release-contract.mjs. The TS runtime twin is enforced
// equal by the DEFAULT_RELEASE_BASE test in test/unit/release-manifest.test.ts.
import {
  DEFAULT_RELEASE_BASE as RELEASE_BASE,
  INSTALLER_NAMES,
  parseReleaseManifest,
} from './release-contract.mjs'

const execute = promisify(execFile)
const packageRoot = resolve(import.meta.dirname, '..')
const outputDir = resolve(process.argv[2] ?? join(packageRoot, 'release'))
const staging = await mkdtemp(join(tmpdir(), 'spark-release-'))

async function writeAtomic(target, bytes) {
  const temporary = `${target}.${process.pid}.tmp`
  await writeFile(temporary, bytes)
  await rename(temporary, target)
}

async function pathExists(path) {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

try {
  const pack = await execute('npm', ['pack', '--pack-destination', staging, '--json'], {
    cwd: packageRoot,
  })
  const packResult = JSON.parse(pack.stdout)
  const filename = packResult[0]?.filename
  if (typeof filename !== 'string' || !filename.endsWith('.tgz')) {
    throw new Error('npm pack did not return a tarball filename')
  }
  const manifest = JSON.parse(await readFile(join(packageRoot, 'package.json'), 'utf8'))
  const version = manifest.version
  if (filename !== `spark-agent-${version}.tgz`) {
    throw new Error(`packed tarball ${filename} does not match package version ${version}`)
  }

  await mkdir(outputDir, { recursive: true })

  // Fail closed BEFORE producing anything: a release directory without every
  // installer would silently break the curl|sh / irm|iex entry points.
  for (const installer of INSTALLER_NAMES) {
    try {
      await access(join(packageRoot, installer))
    } catch {
      throw new Error(
        `installer ${installer} is missing from ${packageRoot}; refusing to prepare the release`,
      )
    }
  }

  const target = join(outputDir, filename)
  const bytes = await readFile(join(staging, filename))
  const sha256 = createHash('sha256').update(bytes).digest('hex')

  if (await pathExists(target)) {
    // Immutability contract: same version, different bytes is a publisher bug.
    const existing = await readFile(target)
    const existingSha = createHash('sha256').update(existing).digest('hex')
    if (existingSha !== sha256) {
      throw new Error(
        `${filename} already exists with different content (${existingSha}); bump package.json version instead of republishing`,
      )
    }
    const sidecar = join(outputDir, `${filename}.sha256`)
    if (await pathExists(sidecar)) {
      const sidecarSha = (await readFile(sidecar, 'utf8')).trim().split(/\s+/)[0]
      if (sidecarSha !== sha256) {
        throw new Error(
          `${filename}.sha256 disagrees with the immutable tarball; fix the release directory`,
        )
      }
    }
    process.stdout.write(`${filename} already published identically; keeping the immutable copy.\n`)
  } else {
    await rename(join(staging, filename), target)
    await writeAtomic(
      join(outputDir, `${filename}.sha256`),
      Buffer.from(`${sha256}  ${filename}\n`, 'utf8'),
    )
  }

  // The one-line installers are fetched from the same base URL as the tarball;
  // a release directory without them is not consumable by curl | sh users.
  await copyFile(join(packageRoot, 'install.sh'), join(outputDir, 'install.sh'))
  await chmod(join(outputDir, 'install.sh'), 0o755)
  await copyFile(join(packageRoot, 'install.ps1'), join(outputDir, 'install.ps1'))
  await copyFile(join(packageRoot, 'install.cmd'), join(outputDir, 'install.cmd'))

  await writeAtomic(
    join(outputDir, 'latest.json'),
    Buffer.from(
      `${JSON.stringify(
        {
          name: manifest.name,
          version,
          sha256,
          tarball: filename,
          publishedAt: new Date().toISOString(),
        },
        null,
        2,
      )}\n`,
      'utf8',
    ),
  )
  // Self-check: the generated pointer must satisfy the exact schema that
  // publish/verify/installers parse; a generator bug fails here, not in prod.
  parseReleaseManifest(await readFile(join(outputDir, 'latest.json'), 'utf8'))

  process.stdout.write(
    [
      `Release prepared in ${outputDir}:`,
      `  ${filename} (${bytes.length} bytes, sha256 ${sha256})`,
      `  ${filename}.sha256`,
      '  latest.json (atomic pointer)',
      '  install.sh / install.ps1 / install.cmd',
      'Upload the directory to a static host, then install with:',
      `  curl -fsSL ${RELEASE_BASE}/install.sh | sh`,
      `  powershell -File install.ps1 -Base ${RELEASE_BASE}`,
      `Update an existing install with: spark update --base ${RELEASE_BASE}`,
      '',
    ].join('\n'),
  )
} finally {
  await rm(staging, { recursive: true, force: true })
}

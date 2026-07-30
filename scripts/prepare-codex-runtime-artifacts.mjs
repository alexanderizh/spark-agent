#!/usr/bin/env node

import { createHash } from 'node:crypto'
import {
  chmodSync,
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'

const version = process.argv[2]
const outputRoot = resolve(process.argv[3] || `artifacts/codex-runtime-${version || 'unknown'}`)

if (!version || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
  console.error('Usage: node scripts/prepare-codex-runtime-artifacts.mjs <version> [output-dir]')
  process.exit(1)
}

const targets = [
  {
    npmVersion: `${version}-darwin-arm64`,
    suffix: 'darwin-arm64',
    platform: 'darwin',
    arch: 'arm64',
    targetTriple: 'aarch64-apple-darwin',
    executable: 'bin/codex',
    label: 'macOS arm64',
  },
  {
    npmVersion: `${version}-darwin-x64`,
    suffix: 'darwin-x64',
    platform: 'darwin',
    arch: 'x64',
    targetTriple: 'x86_64-apple-darwin',
    executable: 'bin/codex',
    label: 'macOS x64',
  },
  {
    npmVersion: `${version}-linux-arm64`,
    suffix: 'linux-arm64',
    platform: 'linux',
    arch: 'arm64',
    targetTriple: 'aarch64-unknown-linux-musl',
    executable: 'bin/codex',
    label: 'Linux arm64',
  },
  {
    npmVersion: `${version}-linux-x64`,
    suffix: 'linux-x64',
    platform: 'linux',
    arch: 'x64',
    targetTriple: 'x86_64-unknown-linux-musl',
    executable: 'bin/codex',
    label: 'Linux x64',
  },
  {
    npmVersion: `${version}-win32-arm64`,
    suffix: 'win32-arm64',
    platform: 'win32',
    arch: 'arm64',
    targetTriple: 'aarch64-pc-windows-msvc',
    executable: 'bin/codex.exe',
    label: 'Windows arm64',
  },
  {
    npmVersion: `${version}-win32-x64`,
    suffix: 'win32-x64',
    platform: 'win32',
    arch: 'x64',
    targetTriple: 'x86_64-pc-windows-msvc',
    executable: 'bin/codex.exe',
    label: 'Windows x64',
  },
]

mkdirSync(outputRoot, { recursive: true })
const workRoot = mkdtempSync(join(tmpdir(), `spark-codex-${version}-`))
const manifestEntries = []

try {
  for (const target of targets) {
    console.log(`[codex-runtime] preparing ${target.label}`)
    const metadataUrl = `https://registry.npmjs.org/%40openai%2Fcodex/${encodeURIComponent(target.npmVersion)}`
    const metadata = await fetchJson(metadataUrl)
    const tarballUrl = metadata?.dist?.tarball
    const tarballIntegrity = metadata?.dist?.integrity
    if (typeof tarballUrl !== 'string') {
      throw new Error(`npm metadata has no tarball for @openai/codex@${target.npmVersion}`)
    }
    if (typeof tarballIntegrity !== 'string') {
      throw new Error(`npm metadata has no integrity for @openai/codex@${target.npmVersion}`)
    }

    const targetWork = join(workRoot, target.suffix)
    const npmTarball = join(targetWork, 'npm-package.tgz')
    mkdirSync(targetWork, { recursive: true })
    await download(tarballUrl, npmTarball)
    await verifyIntegrity(npmTarball, tarballIntegrity)
    run('tar', ['-xzf', npmTarball, '-C', targetWork])

    const contentRoot = join(targetWork, 'package', 'vendor', target.targetTriple)
    const executablePath = join(contentRoot, target.executable)
    const packageManifestPath = join(contentRoot, 'codex-package.json')
    if (!existsSync(executablePath) || !existsSync(packageManifestPath)) {
      throw new Error(`invalid platform package for ${target.targetTriple}`)
    }
    if (target.platform !== 'win32') chmodSync(executablePath, 0o755)

    const fileName = `codex-agent-${version}-${target.suffix}.tar.gz`
    const archivePath = join(outputRoot, fileName)
    run('tar', ['-czf', archivePath, '-C', contentRoot, '.'])
    const sha256 = await sha256File(archivePath)
    const size = statSync(archivePath).size

    manifestEntries.push({
      id: `runtime.codex-agent.${version}.${target.suffix}`,
      type: 'binary',
      name: `Codex Agent native runtime ${version} (${target.label})`,
      version,
      platform: target.platform,
      arch: target.arch,
      targetTriple: target.targetTriple,
      runtime: 'codex',
      sdkPackage: `@openai/codex-sdk@${version}`,
      executablePath: target.executable,
      dependencies: [`@openai/codex-sdk@${version}`],
      url: `dependencies/runtime/codex/${fileName}`,
      sha256,
      size,
      archive: { format: 'tar.gz', contentRoot: '.' },
      notes:
        'Codex native runtime is downloaded on demand from Settings > Integrity or before the first Codex SDK conversation.',
    })
  }

  const manifestPath = join(outputRoot, `codex-runtime-${version}-manifest.json`)
  writeFileSync(manifestPath, `${JSON.stringify(manifestEntries, null, 2)}\n`)
  console.log(`[codex-runtime] wrote ${manifestEntries.length} artifacts to ${outputRoot}`)
} finally {
  rmSync(workRoot, { recursive: true, force: true })
}

async function fetchJson(url) {
  const response = await fetch(url, { headers: { Accept: 'application/json' } })
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`)
  return await response.json()
}

async function download(url, destination) {
  const response = await fetch(url, { redirect: 'follow' })
  if (!response.ok || !response.body) throw new Error(`HTTP ${response.status} for ${url}`)
  await pipeline(Readable.fromWeb(response.body), createWriteStream(destination))
}

function run(command, args) {
  const result = spawnSync(command, args, { stdio: 'inherit' })
  if (result.status !== 0) {
    throw new Error(`${command} failed with exit code ${result.status ?? 'unknown'}`)
  }
}

function sha256File(path) {
  return new Promise((resolveHash, rejectHash) => {
    const hash = createHash('sha256')
    const stream = createReadStream(path)
    stream.on('data', (chunk) => hash.update(chunk))
    stream.on('error', rejectHash)
    stream.on('end', () => resolveHash(hash.digest('hex')))
  })
}

function verifyIntegrity(path, integrity) {
  const strongest = integrity
    .split(/\s+/)
    .map((value) => value.match(/^(sha512|sha384|sha256|sha1)-(.+)$/))
    .filter(Boolean)
    .sort(
      (left, right) =>
        ['sha512', 'sha384', 'sha256', 'sha1'].indexOf(left[1]) -
        ['sha512', 'sha384', 'sha256', 'sha1'].indexOf(right[1]),
    )[0]
  if (!strongest) {
    throw new Error(`unsupported npm integrity value: ${integrity}`)
  }

  return new Promise((resolveIntegrity, rejectIntegrity) => {
    const [, algorithm, expected] = strongest
    const hash = createHash(algorithm)
    const stream = createReadStream(path)
    stream.on('data', (chunk) => hash.update(chunk))
    stream.on('error', rejectIntegrity)
    stream.on('end', () => {
      const actual = hash.digest('base64')
      if (actual !== expected) {
        rejectIntegrity(new Error(`npm tarball integrity mismatch for ${path}`))
        return
      }
      resolveIntegrity()
    })
  })
}

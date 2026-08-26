#!/usr/bin/env node

// Verifies a published Spark CLI release through the public HTTPS surface that
// installers and `spark update` actually consume:
//
//   node scripts/verify-release.mjs [release-dir] [--base <url>]
//
// Base resolution order: --base > SPARK_RELEASE_BASE > SPARK_INSTALL_BASE >
// BUCKET_BASE_URL/spark-cli/v1 > the built-in DEFAULT_RELEASE_BASE.
//
// Remote-only checks:
//   1. latest.json exists, parses, and passes strict schema validation;
//   2. the versioned tarball downloads and hashes to latest.json sha256;
//   3. the .sha256 sidecar agrees with latest.json;
//   4. all three installers exist and are non-empty.
// With a release directory argument the artifacts are additionally compared
// byte-for-byte against the local copies (latest.json by version/sha/tarball,
// so re-running prepare-release does not create false conflicts over
// publishedAt timestamps).
//
// Exit code 0 means every check passed; anything else failed.

import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

// Shared, dependency-free release contract: base URL constant, strict SemVer,
// and the latest.json schema — see scripts/release-contract.mjs.
import { DEFAULT_RELEASE_BASE, INSTALLER_NAMES, parseReleaseManifest } from './release-contract.mjs'

export { DEFAULT_RELEASE_BASE }
const MANIFEST_MAX_BYTES = 64 * 1024
const SIDECAR_MAX_BYTES = 1024
const INSTALLER_MAX_BYTES = 16 * 1024 * 1024
const TARBALL_MAX_BYTES = 256 * 1024 * 1024
const DEFAULT_TIMEOUT_MS = 60 * 1000

export class VerifyError extends Error {
  constructor(message) {
    super(message)
    this.name = 'VerifyError'
  }
}

/**
 * Hardened bounded fetch mirroring src/cli/net.ts: https only (loopback http
 * allowed for local exercise), no embedded credentials, redirects must stay on
 * the first origin and are capped, bodies are size-bounded under a deadline.
 */
export async function fetchBounded(url, { timeoutMs, maxBytes }) {
  const origin = validateUrl(url).origin
  const deadline = Date.now() + timeoutMs
  let current = url
  for (let hop = 0; ; hop += 1) {
    const target = validateUrl(current)
    const response = await rawFetch(target, Math.max(deadline - Date.now(), 1))
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      if (hop >= 3) throw new VerifyError(`${current} exceeded 3 redirects`)
      const location = response.headers.get('location')
      if (!location) throw new VerifyError(`${current} redirected without a Location header`)
      const next = new URL(location, target)
      if (next.origin !== origin)
        throw new VerifyError(`${current} redirected cross-origin to ${next.origin}`)
      current = next.href
      continue
    }
    if (response.status < 200 || response.status >= 300) {
      throw new VerifyError(`${current} returned HTTP ${response.status}`)
    }
    const declared = Number(response.headers.get('content-length') ?? Number.NaN)
    if (Number.isFinite(declared) && declared > maxBytes) {
      throw new VerifyError(
        `${current} declares ${declared} bytes, over the ${maxBytes} byte limit`,
      )
    }
    const body = Buffer.from(await response.arrayBuffer())
    if (body.length > maxBytes)
      throw new VerifyError(`${current} exceeded the ${maxBytes} byte limit`)
    return body
  }
}

function validateUrl(raw) {
  let parsed
  try {
    parsed = new URL(raw)
  } catch {
    throw new VerifyError(`not a valid URL: ${raw}`)
  }
  if (parsed.username || parsed.password)
    throw new VerifyError('embedded credentials are not allowed in release URLs')
  if (parsed.protocol === 'https:') return parsed
  const loopback = ['localhost', '127.0.0.1', '[::1]', '::1'].includes(parsed.hostname)
  if (parsed.protocol === 'http:' && loopback) return parsed
  throw new VerifyError(`release URLs must be https (http is only allowed on loopback): ${raw}`)
}

async function rawFetch(url, timeoutMsLeft) {
  try {
    return await fetch(url, {
      redirect: 'manual',
      signal: AbortSignal.timeout(timeoutMsLeft),
      headers: { 'user-agent': 'spark-release-verify' },
      cache: 'no-store',
    })
  } catch (error) {
    throw new VerifyError(
      `request to ${url} failed: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
}

/** Strict manifest schema — delegated to the shared release contract module. */
export function parseRemoteManifest(raw) {
  try {
    return parseReleaseManifest(raw)
  } catch (error) {
    throw new VerifyError(error instanceof Error ? error.message : String(error))
  }
}

export function resolveVerifyBase({ baseOverride, env = process.env }) {
  const candidate =
    baseOverride ??
    env.SPARK_RELEASE_BASE ??
    env.SPARK_INSTALL_BASE ??
    (env.BUCKET_BASE_URL
      ? `${env.BUCKET_BASE_URL.replace(/\/+$/u, '')}/spark-cli/v1`
      : undefined) ??
    DEFAULT_RELEASE_BASE
  return candidate.replace(/\/+$/u, '')
}

/**
 * Runs the full verification suite. Returns 0 when every check passed, 1
 * otherwise; usable programmatically (exit code returned) or as a CLI.
 */
export async function run(argv, out = (text) => process.stdout.write(text)) {
  let positional = []
  let baseOverride
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--base') baseOverride = argv[++index]
    else if (!arg.startsWith('--')) positional.push(arg)
    else throw new VerifyError(`unknown flag: ${arg}`)
  }
  if (positional.length > 1)
    throw new VerifyError('usage: verify-release.mjs [release-dir] [--base <url>]')
  const releaseDir = positional[0] === undefined ? undefined : resolve(positional[0])
  const base = resolveVerifyBase({ baseOverride })

  const checks = []
  const record = (name, pass, detail) => {
    checks.push({ name, pass, detail })
    out(`${pass ? '  ✓' : '  ✗'} ${name}${detail ? ` — ${detail}` : ''}\n`)
  }

  out(`Verifying spark CLI release at ${base}/\n`)

  const manifestBytes = await fetchBounded(`${base}/latest.json`, {
    timeoutMs: DEFAULT_TIMEOUT_MS,
    maxBytes: MANIFEST_MAX_BYTES,
  })
  const manifest = parseRemoteManifest(manifestBytes.toString('utf8'))
  record(
    'latest.json schema',
    true,
    `${manifest.version} @ ${manifest.publishedAt ?? 'unknown time'}`,
  )

  const tarballBytes = await fetchBounded(`${base}/${manifest.tarball}`, {
    timeoutMs: DEFAULT_TIMEOUT_MS,
    maxBytes: TARBALL_MAX_BYTES,
  })
  const actualSha = createHash('sha256').update(tarballBytes).digest('hex')
  record(
    'tarball sha256',
    actualSha === manifest.sha256,
    actualSha === manifest.sha256
      ? `${manifest.tarball} (${tarballBytes.length} bytes)`
      : `expected ${manifest.sha256}, got ${actualSha}`,
  )

  const sidecarText = (
    await fetchBounded(`${base}/${manifest.tarball}.sha256`, {
      timeoutMs: DEFAULT_TIMEOUT_MS,
      maxBytes: SIDECAR_MAX_BYTES,
    })
  ).toString('utf8')
  const match = /^([0-9a-f]{64}) {2}(.+)\n?$/u.exec(sidecarText.trim())
  const sidecarOk = Boolean(match && match[1] === manifest.sha256 && match[2] === manifest.tarball)
  record(
    '.sha256 sidecar',
    sidecarOk,
    sidecarOk
      ? `${manifest.tarball}.sha256 agrees with latest.json`
      : `invalid sidecar: ${JSON.stringify(sidecarText.slice(0, 120))}`,
  )

  const installers = {}
  for (const filename of INSTALLER_NAMES) {
    const bytes = await fetchBounded(`${base}/${filename}`, {
      timeoutMs: DEFAULT_TIMEOUT_MS,
      maxBytes: INSTALLER_MAX_BYTES,
    })
    installers[filename] = bytes
    record(`installer ${filename}`, bytes.length > 0, `${bytes.length} bytes`)
  }

  if (releaseDir !== undefined) {
    let localManifestRaw
    try {
      localManifestRaw = await readFile(join(releaseDir, 'latest.json'), 'utf8')
    } catch {
      throw new VerifyError(`${releaseDir} does not contain latest.json`)
    }
    const local = parseRemoteManifest(localManifestRaw)
    const consistent =
      local.version === manifest.version &&
      local.sha256 === manifest.sha256 &&
      local.tarball === manifest.tarball
    record(
      'local latest.json matches remote',
      consistent,
      consistent
        ? `both point at ${manifest.version}`
        : `local ${local.version}/${local.sha256.slice(0, 12)}… vs remote ${manifest.version}/${manifest.sha256.slice(0, 12)}…`,
    )
    for (const filename of [manifest.tarball, ...INSTALLER_NAMES]) {
      let localBytes
      try {
        localBytes = await readFile(join(releaseDir, filename))
      } catch {
        throw new VerifyError(`${releaseDir} is missing ${filename}`)
      }
      record(
        `local copy identical: ${filename}`,
        localBytes.equals(filename === manifest.tarball ? tarballBytes : installers[filename]),
        `${localBytes.length} bytes`,
      )
    }
  }

  const failed = checks.filter((item) => !item.pass)
  if (failed.length > 0) {
    out(`FAILED: ${failed.length} of ${checks.length} checks did not pass\n`)
    return 1
  }
  out(`OK: ${checks.length} checks passed for spark-agent ${manifest.version}\n`)
  return 0
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run(process.argv.slice(2))
    .then((code) => {
      process.exitCode = code
    })
    .catch((error) => {
      process.stderr.write(
        `verify-release: ${error instanceof Error ? error.message : String(error)}\n`,
      )
      process.exitCode = 1
    })
}

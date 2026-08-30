import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { parse } from 'smol-toml'

import { fetchBounded, validateReleaseBaseUrl } from './net.js'
import { parseSemVer } from './semver.js'

/**
 * ============================================================================
 * Canonical Spark self-hosted release channel.
 * ============================================================================
 * It is intentionally duplicated in the standalone installers and release
 * scripts (those runtimes cannot import TypeScript). A contract test enforces
 * byte-for-byte equality between every copy.
 */
export const DEFAULT_RELEASE_BASE = 'https://raw.githubusercontent.com/alexanderizh/spark-agent/spark-cli-releases'

export const RELEASE_PACKAGE_NAME = '@spark/agent'
const TARBALL_PREFIX = 'spark-agent'
const MANIFEST_MAX_BYTES = 64 * 1024
const SIDECAR_MAX_BYTES = 1024
const MANIFEST_TIMEOUT_MS = 15_000

export class ReleaseError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ReleaseError'
  }
}

export interface ReleaseManifest {
  readonly name: typeof RELEASE_PACKAGE_NAME
  readonly version: string
  readonly sha256: string
  readonly tarball: string
  readonly publishedAt?: string
}

const MANIFEST_KEYS = ['name', 'version', 'sha256', 'tarball', 'publishedAt'] as const

/**
 * Strict, fail-closed manifest schema: exact known keys, the package identity
 * must be @spark/agent, the version must be strict SemVer, the sha256 a
 * lowercase hex64 digest, and the tarball name must be the deterministic
 * versioned filename — no paths, queries, or substitutions.
 */
export function parseReleaseManifest(raw: string): ReleaseManifest {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (error) {
    throw new ReleaseError(`latest.json is not valid JSON: ${errorMessage(error)}`)
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new ReleaseError('latest.json must be a JSON object')
  }
  const record = parsed as Record<string, unknown>
  for (const key of Object.keys(record)) {
    if (!(MANIFEST_KEYS as readonly string[]).includes(key)) {
      throw new ReleaseError(`latest.json contains an unknown field: ${key}`)
    }
  }
  if (typeof record.name !== 'string' || record.name !== RELEASE_PACKAGE_NAME) {
    throw new ReleaseError(`latest.json name must be "${RELEASE_PACKAGE_NAME}"`)
  }
  if (typeof record.version !== 'string' || parseSemVer(record.version) === undefined) {
    throw new ReleaseError('latest.json version must be a strict SemVer string')
  }
  if (typeof record.sha256 !== 'string' || !/^[0-9a-f]{64}$/u.test(record.sha256)) {
    throw new ReleaseError('latest.json sha256 must be a lowercase 64-character hex digest')
  }
  if (
    typeof record.tarball !== 'string' ||
    record.tarball !== expectedTarballFilename(record.version)
  ) {
    throw new ReleaseError(
      `latest.json tarball must be "${expectedTarballFilename(record.version)}", got: ${String(record.tarball)}`,
    )
  }
  if (
    record.publishedAt !== undefined &&
    (typeof record.publishedAt !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/u.test(
        record.publishedAt,
      ) ||
      !Number.isFinite(Date.parse(record.publishedAt)))
  ) {
    throw new ReleaseError('latest.json publishedAt must be an ISO 8601 timestamp')
  }
  return {
    name: RELEASE_PACKAGE_NAME,
    version: record.version,
    sha256: record.sha256,
    tarball: record.tarball,
    ...(record.publishedAt === undefined ? {} : { publishedAt: record.publishedAt }),
  }
}

export function expectedTarballFilename(version: string): string {
  return `${TARBALL_PREFIX}-${version}.tgz`
}

export function normalizeReleaseBase(base: string): string {
  return validateReleaseBaseUrl(base).href.replace(/\/+$/u, '')
}

export function latestManifestUrl(base: string): string {
  return `${normalizeReleaseBase(base)}/latest.json`
}

export function tarballUrlFor(base: string, manifest: ReleaseManifest): string {
  return `${normalizeReleaseBase(base)}/${manifest.tarball}`
}

export function sidecarUrlFor(base: string, version: string): string {
  return `${normalizeReleaseBase(base)}/${expectedTarballFilename(version)}.sha256`
}

export async function fetchLatestManifest(
  base: string,
  options: { readonly timeoutMs?: number } = {},
): Promise<ReleaseManifest> {
  const { bytes } = await fetchBounded(latestManifestUrl(base), {
    timeoutMs: options.timeoutMs ?? MANIFEST_TIMEOUT_MS,
    maxBytes: MANIFEST_MAX_BYTES,
  })
  return parseReleaseManifest(bytes.toString('utf8'))
}

/**
 * Pinned installs never read latest.json: the checksum comes from the
 * immutable `.sha256` sidecar shipped next to the versioned tarball.
 */
export async function fetchPinnedManifest(
  base: string,
  version: string,
  options: { readonly timeoutMs?: number } = {},
): Promise<ReleaseManifest> {
  if (parseSemVer(version) === undefined) {
    throw new ReleaseError(`--target must be a strict SemVer version, got: ${version}`)
  }
  const { bytes } = await fetchBounded(sidecarUrlFor(base, version), {
    timeoutMs: options.timeoutMs ?? MANIFEST_TIMEOUT_MS,
    maxBytes: SIDECAR_MAX_BYTES,
  })
  const sidecar = bytes.toString('utf8').trim()
  const match = /^([0-9a-f]{64}) {2}(spark-agent-[^/\\\s]+\.tgz)$/u.exec(sidecar)
  const digest = match?.[1]
  if (digest === undefined || match?.[2] !== expectedTarballFilename(version)) {
    throw new ReleaseError(`checksum sidecar for ${version} is invalid`)
  }
  return {
    name: RELEASE_PACKAGE_NAME,
    version,
    sha256: digest,
    tarball: expectedTarballFilename(version),
  }
}

export interface UpdateSettings {
  readonly base?: string
  readonly version?: string
  readonly noticeEnabled?: boolean
}

/**
 * Resolves where updates come from, in precedence order:
 * CLI flag > environment (SPARK_RELEASE_BASE / SPARK_INSTALL_BASE,
 * SPARK_INSTALL_VERSION) > `[update]` in ~/.spark/config.toml >
 * DEFAULT_RELEASE_BASE. The project `.spark/config.toml` deliberately cannot
 * change the update source: a repository must never control which package the
 * user's machine executes — it may only silence the notice.
 */
export function resolveUpdateSource(input: {
  readonly flagBase?: string
  readonly flagVersion?: string
  readonly env?: NodeJS.ProcessEnv
  readonly sparkHome?: string
}): { base: string; version?: string } {
  const env = input.env ?? process.env
  const settings = readUpdateSettings(
    input.sparkHome === undefined ? {} : { sparkHome: input.sparkHome },
  )
  const base =
    input.flagBase ??
    env.SPARK_RELEASE_BASE ??
    env.SPARK_INSTALL_BASE ??
    settings.base ??
    DEFAULT_RELEASE_BASE
  const version = input.flagVersion ?? env.SPARK_INSTALL_VERSION ?? settings.version
  return { base: normalizeReleaseBase(base), ...(version === undefined ? {} : { version }) }
}

/**
 * `[update]` settings. Global config contributes base_url/version/enabled;
 * project config can only turn the notice off (or re-enable what the global
 * file disabled), and its base_url/version are ignored by design.
 */
export function readUpdateSettings(
  options: { sparkHome?: string; cwd?: string } = {},
): UpdateSettings {
  const merged: { base?: string; version?: string; noticeEnabled?: boolean } = {}
  if (options.sparkHome !== undefined) {
    mergeUpdateSection(join(resolve(options.sparkHome), 'config.toml'), merged)
  }
  if (options.cwd !== undefined) {
    const project: { base?: string; version?: string; noticeEnabled?: boolean } = {}
    mergeUpdateSection(join(resolve(options.cwd), '.spark', 'config.toml'), project)
    // A local "enabled = true" must not override a global kill switch, but a
    // local opt-out is always honored.
    if (project.noticeEnabled !== undefined) {
      if (!project.noticeEnabled || merged.noticeEnabled === undefined) {
        merged.noticeEnabled = project.noticeEnabled
      }
    }
  }
  return merged
}

function mergeUpdateSection(
  path: string,
  into: { base?: string; version?: string; noticeEnabled?: boolean },
): void {
  let parsed: unknown
  try {
    parsed = parse(readFileSync(path, 'utf8'))
  } catch {
    return
  }
  if (typeof parsed !== 'object' || parsed === null) return
  const update: unknown = Reflect.get(parsed, 'update')
  if (typeof update !== 'object' || update === null) return
  const baseUrl: unknown = Reflect.get(update, 'base_url')
  if (typeof baseUrl === 'string' && baseUrl.trim()) into.base = baseUrl.trim()
  const version: unknown = Reflect.get(update, 'version')
  if (typeof version === 'string' && version.trim()) into.version = version.trim()
  const enabled: unknown = Reflect.get(update, 'enabled')
  if (typeof enabled === 'boolean') into.noticeEnabled = enabled
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

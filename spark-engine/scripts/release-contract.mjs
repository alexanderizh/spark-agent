/**
 * ============================================================================
 * Single-source release contract for the .mjs tooling.
 * ============================================================================
 * Shared by scripts/prepare-release.mjs,
 * and scripts/verify-release.mjs so they cannot drift apart. The TypeScript
 * runtime twin lives in src/cli/release.ts (+ src/cli/semver.ts); those
 * runtimes cannot import this file, so their copies are enforced equal by the
 * DEFAULT_RELEASE_BASE contract test in test/unit/release-manifest.test.ts.
 */

/** SYNC CONSTANT — keep identical to DEFAULT_RELEASE_BASE in src/cli/release.ts,
 * DEFAULT_BASE in install.sh and $DefaultBase in install.ps1. */
export const DEFAULT_RELEASE_BASE = 'https://raw.githubusercontent.com/alexanderizh/spark-agent/spark-cli-releases'

export const RELEASE_PACKAGE_NAME = '@spark/agent'
export const TARBALL_PREFIX = 'spark-agent'
export const INSTALLER_NAMES = ['install.sh', 'install.ps1', 'install.cmd']

/** Exact SemVer 2.0.0 grammar — no zero-padded cores, no empty identifiers. */
const SEMVER_PATTERN =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/u

const MANIFEST_KEYS = ['name', 'version', 'sha256', 'tarball', 'publishedAt']
const SHA256_PATTERN = /^[0-9a-f]{64}$/u
const ISO_8601_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/u

export function isStrictSemVer(version) {
  return typeof version === 'string' && SEMVER_PATTERN.test(version)
}

export function expectedTarballFilename(version) {
  return `${TARBALL_PREFIX}-${version}.tgz`
}

function failure(message) {
  throw new Error(`latest.json ${message}`)
}

/**
 * Strict, fail-closed manifest schema, mirroring parseReleaseManifest in
 * src/cli/release.ts: exact known keys, @spark/agent identity, strict SemVer,
 * lowercase hex64 sha256, deterministic versioned tarball name, ISO 8601
 * publishedAt. Throws Error with a "latest.json …" message on any violation.
 */
export function parseReleaseManifest(raw) {
  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch (error) {
    return failure(`is not valid JSON: ${error instanceof Error ? error.message : String(error)}`)
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return failure('must be a JSON object')
  }
  const record = parsed
  for (const key of Object.keys(record)) {
    if (!MANIFEST_KEYS.includes(key)) {
      return failure(`contains an unknown field: ${key}`)
    }
  }
  if (record.name !== RELEASE_PACKAGE_NAME) {
    return failure(`name must be "${RELEASE_PACKAGE_NAME}"`)
  }
  if (!isStrictSemVer(record.version)) {
    return failure('version must be a strict SemVer string')
  }
  if (typeof record.sha256 !== 'string' || !SHA256_PATTERN.test(record.sha256)) {
    return failure('sha256 must be a lowercase 64-character hex digest')
  }
  const expectedTarball = expectedTarballFilename(record.version)
  if (record.tarball !== expectedTarball) {
    return failure(`tarball must be "${expectedTarball}", got: ${JSON.stringify(record.tarball)}`)
  }
  if (
    record.publishedAt !== undefined &&
    (typeof record.publishedAt !== 'string' ||
      !ISO_8601_PATTERN.test(record.publishedAt) ||
      !Number.isFinite(Date.parse(record.publishedAt)))
  ) {
    return failure('publishedAt must be an ISO 8601 timestamp')
  }
  return record
}

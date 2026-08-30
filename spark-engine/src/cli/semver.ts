/**
 * Strict SemVer 2.0.0 parsing and precedence (https://semver.org/). The update
 * protocol refuses to act on versions it cannot parse exactly, so this module
 * never coerces and never accepts partial versions.
 */

const SEMVER_PATTERN =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/u

export interface SemVer {
  readonly major: bigint
  readonly minor: bigint
  readonly patch: bigint
  readonly prerelease: readonly string[]
  /** Build metadata is parsed for validity but ignored by precedence. */
  readonly build: readonly string[]
  readonly raw: string
}

export function parseSemVer(input: string): SemVer | undefined {
  const match = SEMVER_PATTERN.exec(input.trim())
  if (!match) return undefined
  const [, major, minor, patch, prerelease, build] = match
  if (major === undefined || minor === undefined || patch === undefined) return undefined
  return {
    major: BigInt(major),
    minor: BigInt(minor),
    patch: BigInt(patch),
    ...(prerelease === undefined ? { prerelease: [] } : { prerelease: prerelease.split('.') }),
    ...(build === undefined ? { build: [] } : { build: build.split('.') }),
    raw: input.trim(),
  }
}

export function isPrerelease(version: SemVer): boolean {
  return version.prerelease.length > 0
}

/**
 * SemVer precedence: numeric identifiers compare numerically, alphanumeric
 * lexically, numeric identifiers are lower than alphanumeric, and a larger
 * prerelease set wins when all preceding identifiers are equal. A release
 * (empty prerelease) always outranks a prerelease of the same core version.
 */
export function compareSemVer(left: SemVer, right: SemVer): number {
  if (left.major !== right.major) return left.major < right.major ? -1 : 1
  if (left.minor !== right.minor) return left.minor < right.minor ? -1 : 1
  if (left.patch !== right.patch) return left.patch < right.patch ? -1 : 1
  if (left.prerelease.length === 0 && right.prerelease.length === 0) return 0
  if (left.prerelease.length === 0) return 1
  if (right.prerelease.length === 0) return -1
  const shared = Math.min(left.prerelease.length, right.prerelease.length)
  for (let index = 0; index < shared; index += 1) {
    const leftPart = left.prerelease[index] ?? ''
    const rightPart = right.prerelease[index] ?? ''
    const leftNumeric = /^\d+$/u.test(leftPart)
    const rightNumeric = /^\d+$/u.test(rightPart)
    if (leftNumeric && rightNumeric) {
      const numericComparison = compareNumericIdentifier(leftPart, rightPart)
      if (numericComparison !== 0) return numericComparison
    } else if (leftNumeric !== rightNumeric) {
      return leftNumeric ? -1 : 1
    } else if (leftPart !== rightPart) {
      return leftPart < rightPart ? -1 : 1
    }
  }
  if (left.prerelease.length === right.prerelease.length) return 0
  return left.prerelease.length < right.prerelease.length ? -1 : 1
}

export function formatSemVer(version: SemVer): string {
  let text = `${version.major}.${version.minor}.${version.patch}`
  if (version.prerelease.length > 0) text += `-${version.prerelease.join('.')}`
  if (version.build.length > 0) text += `+${version.build.join('.')}`
  return text
}

function compareNumericIdentifier(left: string, right: string): number {
  if (left.length !== right.length) return left.length < right.length ? -1 : 1
  if (left === right) return 0
  return left < right ? -1 : 1
}

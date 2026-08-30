import { describe, expect, it } from 'vitest'

import { compareSemVer, formatSemVer, isPrerelease, parseSemVer } from '../../src/cli/semver.js'

describe('strict SemVer parsing', () => {
  it('accepts exact SemVer 2.0.0 strings and exposes their parts', () => {
    const parsed = parseSemVer('1.2.3-beta.1+build.5')
    expect(parsed).toBeDefined()
    // Core identifiers are BigInt so huge prerelease counters never lose
    // precision to the double number range.
    expect(parsed?.major).toBe(1n)
    expect(parsed?.minor).toBe(2n)
    expect(parsed?.patch).toBe(3n)
    expect(parsed?.prerelease).toEqual(['beta', '1'])
    expect(parsed?.build).toEqual(['build', '5'])
    expect(formatSemVer(parsed!)).toBe('1.2.3-beta.1+build.5')
  })

  it('rejects coercible but invalid inputs', () => {
    for (const invalid of [
      '',
      '1',
      '1.2',
      'v1.2.3',
      '1.02.3',
      '1.2.3-01',
      '1.2.3-',
      '1.2.3+',
      '1.2.3-beta..1',
      '01.2.3',
      '1.2.3-βeta',
      '~1.2.3',
      '1.2.3 || 2.0.0',
    ]) {
      expect(parseSemVer(invalid), invalid).toBeUndefined()
    }
  })

  it('trims surrounding whitespace only', () => {
    expect(parseSemVer('  1.2.3  ')?.raw).toBe('1.2.3')
  })
})

describe('SemVer precedence', () => {
  it('orders core versions numerically', () => {
    expect(compareSemVer(parseSemVer('0.9.9')!, parseSemVer('0.10.0')!)).toBe(-1)
    expect(compareSemVer(parseSemVer('1.0.0')!, parseSemVer('1.0.0')!)).toBe(0)
    expect(compareSemVer(parseSemVer('2.0.0')!, parseSemVer('1.99.99')!)).toBe(1)
  })

  it('follows the SemVer prerelease rules from the spec examples', () => {
    const ordered = [
      '1.0.0-alpha',
      '1.0.0-alpha.1',
      '1.0.0-alpha.beta',
      '1.0.0-beta',
      '1.0.0-beta.2',
      '1.0.0-beta.11',
      '1.0.0-rc.1',
      '1.0.0',
    ]
    for (let index = 1; index < ordered.length; index += 1) {
      const left = parseSemVer(ordered[index - 1]!)
      const right = parseSemVer(ordered[index]!)
      expect(compareSemVer(left!, right!), `${ordered[index - 1]} < ${ordered[index]}`).toBe(-1)
      expect(compareSemVer(right!, left!)).toBe(1)
    }
  })

  it('ignores build metadata in precedence', () => {
    expect(compareSemVer(parseSemVer('1.0.0+one')!, parseSemVer('1.0.0+two')!)).toBe(0)
  })

  it('detects prereleases', () => {
    expect(isPrerelease(parseSemVer('1.0.0-rc.1')!)).toBe(true)
    expect(isPrerelease(parseSemVer('1.0.0')!)).toBe(false)
  })
})

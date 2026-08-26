import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import {
  DEFAULT_RELEASE_BASE,
  expectedTarballFilename,
  latestManifestUrl,
  parseReleaseManifest,
  readUpdateSettings,
  ReleaseError,
  resolveUpdateSource,
  sidecarUrlFor,
  tarballUrlFor,
} from '../../src/cli/release.js'

const roots: string[] = []

afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

function validManifest(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    name: '@spark/agent',
    version: '0.2.0',
    sha256: 'a'.repeat(64),
    tarball: 'spark-agent-0.2.0.tgz',
    publishedAt: '2026-08-26T12:00:00.000Z',
    ...overrides,
  })
}

describe('latest.json schema validation', () => {
  it('accepts a well-formed manifest', () => {
    const manifest = parseReleaseManifest(validManifest())
    expect(manifest).toMatchObject({
      name: '@spark/agent',
      version: '0.2.0',
      sha256: 'a'.repeat(64),
      tarball: 'spark-agent-0.2.0.tgz',
    })
  })

  it('accepts a manifest without publishedAt', () => {
    expect(
      parseReleaseManifest(
        JSON.stringify({
          name: '@spark/agent',
          version: '0.2.0',
          sha256: 'b'.repeat(64),
          tarball: 'spark-agent-0.2.0.tgz',
        }),
      ).publishedAt,
    ).toBeUndefined()
  })

  it('rejects malformed, non-object, and unknown-field manifests', () => {
    for (const raw of ['not json', '[]', '"string"', '{}']) {
      expect(() => parseReleaseManifest(raw), raw).toThrow(ReleaseError)
    }
    expect(() => parseReleaseManifest(validManifest({ extra: 'field' }))).toThrow(
      /unknown field: extra/,
    )
  })

  it('rejects wrong package identity', () => {
    expect(() => parseReleaseManifest(validManifest({ name: '@evil/agent' }))).toThrow(
      /name must be/,
    )
  })

  it('rejects non-SemVer versions', () => {
    for (const version of ['0.2', 'v0.2.0', 'latest', '0.2.0.1']) {
      expect(() => parseReleaseManifest(validManifest({ version })), version).toThrow(/SemVer/)
    }
  })

  it('rejects malformed digests', () => {
    for (const sha256 of ['A'.repeat(64), 'f'.repeat(63), 'xyz', '']) {
      expect(() => parseReleaseManifest(validManifest({ sha256 })), sha256).toThrow(/sha256/)
    }
  })

  it('rejects tarball names that are not the deterministic versioned filename', () => {
    for (const tarball of [
      'spark-agent-0.2.1.tgz',
      '../spark-agent-0.2.0.tgz',
      '/etc/spark-agent-0.2.0.tgz',
      'spark-agent-0.2.0.tgz?x=1',
      'other-1.0.0.tgz',
    ]) {
      expect(() => parseReleaseManifest(validManifest({ tarball })), tarball).toThrow(/tarball/)
    }
  })

  it('rejects malformed publishedAt values', () => {
    expect(() => parseReleaseManifest(validManifest({ publishedAt: 'yesterday' }))).toThrow(
      /ISO 8601/,
    )
  })
})

describe('release URL construction', () => {
  it('derives manifest, tarball, and sidecar URLs from the base', () => {
    expect(latestManifestUrl('https://releases.example.com/dir/')).toBe(
      'https://releases.example.com/dir/latest.json',
    )
    expect(
      tarballUrlFor('https://releases.example.com', parseReleaseManifest(validManifest())),
    ).toBe('https://releases.example.com/spark-agent-0.2.0.tgz')
    expect(sidecarUrlFor('https://releases.example.com', '0.2.0')).toBe(
      'https://releases.example.com/spark-agent-0.2.0.tgz.sha256',
    )
    expect(expectedTarballFilename('0.2.0-rc.1')).toBe('spark-agent-0.2.0-rc.1.tgz')
  })
})

describe('update source precedence', () => {
  it('prefers flag > env > config > built-in default', () => {
    const withEnv = {
      SPARK_RELEASE_BASE: 'https://env.example.com',
      SPARK_INSTALL_BASE: 'https://env2.example.com',
    }
    expect(resolveUpdateSource({ flagBase: 'https://flag.example.com', env: withEnv }).base).toBe(
      'https://flag.example.com',
    )
    expect(resolveUpdateSource({ env: withEnv }).base).toBe('https://env.example.com')
    expect(
      resolveUpdateSource({ env: { SPARK_INSTALL_BASE: 'https://env2.example.com' } }).base,
    ).toBe('https://env2.example.com')
    expect(resolveUpdateSource({ env: {}, sparkHome: '/nonexistent' }).base).toBe(
      DEFAULT_RELEASE_BASE,
    )
  })

  it('takes [update] base/version from global config only; the project file cannot steer updates', async () => {
    const root = await mkdtemp(join(tmpdir(), 'spark-release-'))
    roots.push(root)
    const home = join(root, 'home')
    const project = join(root, 'project')
    await mkdir(join(home), { recursive: true })
    await mkdir(join(project, '.spark'), { recursive: true })
    await writeFile(
      join(home, 'config.toml'),
      '[update]\nbase_url = "https://global.example.com"\nversion = "0.2.0"\n',
    )
    await writeFile(
      join(project, '.spark', 'config.toml'),
      '[update]\nbase_url = "https://project.example.com"\nversion = "9.9.9"\nenabled = false\n',
    )

    // Anti-hijack contract: the update channel is steered only by the trusted
    // global file (plus flags/env); a repo-local file may only opt the daily
    // notice out.
    const resolved = resolveUpdateSource({ env: {}, sparkHome: home })
    expect(resolved.base).toBe('https://global.example.com')
    expect(resolved.version).toBe('0.2.0')

    const notices = readUpdateSettings({ sparkHome: home, cwd: project })
    expect(notices.noticeEnabled).toBe(false)

    // A local re-enable never overrides a global kill switch.
    await writeFile(join(home, 'config.toml'), '[update]\nenabled = false\n')
    await writeFile(join(project, '.spark', 'config.toml'), '[update]\nenabled = true\n')
    expect(readUpdateSettings({ sparkHome: home, cwd: project }).noticeEnabled).toBe(false)

    await writeFile(join(project, '.spark', 'config.toml'), 'this is not = toml {{{')
    expect(resolveUpdateSource({ env: {}, sparkHome: '/nonexistent' }).base).toBe(
      DEFAULT_RELEASE_BASE,
    )
  })

  it('rejects bases that are not https (loopback http excepted)', () => {
    expect(() =>
      resolveUpdateSource({ flagBase: 'http://releases.example.com', env: {} }),
    ).toThrow()
    expect(resolveUpdateSource({ flagBase: 'http://127.0.0.1:9', env: {} }).base).toBe(
      'http://127.0.0.1:9',
    )
  })
})

describe('DEFAULT_RELEASE_BASE single source of truth', () => {
  it('is identical in src, both installers, and the shared mjs contract module', async () => {
    const shell = /DEFAULT_BASE='([^']+)'/u.exec(await readFile(resolve('install.sh'), 'utf8'))?.[1]
    const powershell = /\$DefaultBase = '([^']+)'/u.exec(
      await readFile(resolve('install.ps1'), 'utf8'),
    )?.[1]
    // The .mjs tooling imports this module instead of carrying their own copy.
    const shared = /export const DEFAULT_RELEASE_BASE = '([^']+)'/u.exec(
      await readFile(resolve('scripts', 'release-contract.mjs'), 'utf8'),
    )?.[1]
    expect(shell).toBe(DEFAULT_RELEASE_BASE)
    expect(powershell).toBe(DEFAULT_RELEASE_BASE)
    expect(shared).toBe(DEFAULT_RELEASE_BASE)
  })
})

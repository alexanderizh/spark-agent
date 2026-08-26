import { createHash } from 'node:crypto'
import { createServer, type Server } from 'node:http'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import {
  discoverReleaseArtifacts,
  VerifyError,
  parseRemoteManifest,
  resolveVerifyBase,
  run as runVerify,
} from '../../scripts/verify-release.mjs'

const roots: string[] = []
const closers: (() => Promise<void>)[] = []

afterEach(async () => {
  for (const close of closers.splice(0)) await close()
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

function sha256Hex(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex')
}

describe('discoverReleaseArtifacts', () => {
  it('validates manifest, tarball hash, sidecar pairing, and installers', async () => {
    const fixture = await releaseFixture()
    const discovered = await discoverReleaseArtifacts(fixture.releaseDir)
    expect(discovered.manifest.version).toBe('0.2.0')
    expect(discovered.artifacts.map(({ filename }) => filename)).toEqual([
      'spark-agent-0.2.0.tgz',
      'spark-agent-0.2.0.tgz.sha256',
      'install.sh',
      'install.ps1',
      'install.cmd',
    ])
    expect(discovered.artifacts[0]?.sha256).toBe(fixture.tarballSha256)
  })

  it('fails closed on a missing installer or a disagreeing sidecar', async () => {
    const fixture = await releaseFixture()
    await rm(join(fixture.releaseDir, 'install.ps1'))
    await expect(discoverReleaseArtifacts(fixture.releaseDir)).rejects.toThrow(
      /install\.ps1 is missing/u,
    )

    const second = await releaseFixture()
    await writeFile(
      join(second.releaseDir, 'spark-agent-0.2.0.tgz.sha256'),
      `${'a'.repeat(64)}  spark-agent-0.2.0.tgz\n`,
      'utf8',
    )
    await expect(discoverReleaseArtifacts(second.releaseDir)).rejects.toThrow(VerifyError)
  })

  it('rejects manifests with foreign package names', async () => {
    const fixture = await releaseFixture()
    await writeFile(
      join(fixture.releaseDir, 'latest.json'),
      JSON.stringify({
        name: '@other/pkg',
        version: '0.2.0',
        sha256: fixture.tarballSha256,
        tarball: 'spark-agent-0.2.0.tgz',
      }),
      'utf8',
    )
    await expect(discoverReleaseArtifacts(fixture.releaseDir)).rejects.toThrow(/name must be/u)
  })
})

describe('verify-release helpers', () => {
  it('parses strict manifests and resolves the base precedence chain', () => {
    const manifest = parseRemoteManifest(
      JSON.stringify({
        name: '@spark/agent',
        version: '1.0.0-rc.1',
        sha256: 'c'.repeat(64),
        tarball: 'spark-agent-1.0.0-rc.1.tgz',
      }),
    )
    expect(manifest.version).toBe('1.0.0-rc.1')
    expect(() => parseRemoteManifest('{"name":"@spark/agent"}')).toThrow(/version must be/u)
    // Strict SemVer parity with the TS runtime: zero-padded cores are refused.
    expect(() =>
      parseRemoteManifest(
        JSON.stringify({
          name: '@spark/agent',
          version: '01.2.3',
          sha256: 'c'.repeat(64),
          tarball: 'spark-agent-01.2.3.tgz',
        }),
      ),
    ).toThrow(/strict SemVer/u)
    // publishedAt is validated too (the duplicated pre-contract copy skipped it).
    expect(() =>
      parseRemoteManifest(
        JSON.stringify({
          name: '@spark/agent',
          version: '1.2.3',
          sha256: 'c'.repeat(64),
          tarball: 'spark-agent-1.2.3.tgz',
          publishedAt: 'yesterday',
        }),
      ),
    ).toThrow(/ISO 8601/u)

    expect(resolveVerifyBase({ env: {} })).toBe(
      'https://raw.githubusercontent.com/alexanderizh/spark-agent/spark-cli-releases',
    )
    expect(resolveVerifyBase({ env: { SPARK_RELEASE_BASE: 'https://flag.example/base/' } })).toBe(
      'https://flag.example/base',
    )
    expect(
      resolveVerifyBase({
        env: {
          SPARK_INSTALL_BASE: 'https://env2.example/b',
          SPARK_RELEASE_BASE: 'https://env1.example/b',
        },
      }),
    ).toBe('https://env1.example/b')
  })

  it('runs end to end against a local static server, failing on tampered bytes', async () => {
    const fixture = await releaseFixture()
    const files = new Map<string, Buffer>()
    files.set('latest.json', await readFile(join(fixture.releaseDir, 'latest.json')))
    files.set('spark-agent-0.2.0.tgz', Buffer.from('tampered', 'utf8'))
    files.set(
      'spark-agent-0.2.0.tgz.sha256',
      Buffer.from(`${fixture.tarballSha256}  spark-agent-0.2.0.tgz\n`, 'utf8'),
    )
    for (const name of ['install.sh', 'install.ps1', 'install.cmd']) {
      files.set(name, Buffer.from(`# ${name}\n`, 'utf8'))
    }
    const { baseUrl, close } = await serveFiles(files)
    closers.push(close)

    const lines: string[] = []
    const collect = (text: string) => lines.push(text)

    // Tampered tarball content versus manifest sha256 fails with exit code 1.
    expect(await runVerify(['--base', baseUrl], collect)).toBe(1)
    expect(lines.join('\n')).toContain('✗ tarball sha256')
    expect(lines.join('\n')).toContain('FAILED:')
    expect(lines.join('\n')).not.toContain('OK:')

    // The same server with true bytes passes, including local cross-checks.
    lines.length = 0
    files.set('spark-agent-0.2.0.tgz', Buffer.from('tarball-bytes', 'utf8'))
    expect(await runVerify([fixture.releaseDir, '--base', baseUrl], collect)).toBe(0)
    expect(lines.join('\n')).toContain(`OK:`)
    expect(lines.join('\n')).toContain('local copy identical: install.sh')
  }, 30_000)
})

async function serveFiles(
  files: Map<string, Buffer>,
): Promise<{ baseUrl: string; close: () => Promise<void> }> {
  const server: Server = createServer((request, response) => {
    void (async () => {
      const path = decodeURIComponent((request.url ?? '').replace(/\?.*$/u, '')).replace(/^\//u, '')
      if (!path) {
        response.writeHead(400).end()
        return
      }
      if (request.method === 'PUT') {
        response.writeHead(405).end()
        return
      }
      const body = files.get(path)
      if (body === undefined) {
        response.writeHead(404).end()
        return
      }
      response.writeHead(200, { 'content-length': String(body.length) }).end(body)
    })().catch(() => {
      response.writeHead(500).end()
    })
  })
  await new Promise<void>((resolveListen) => server.listen(0, '127.0.0.1', resolveListen))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('test server failed to bind')
  const close = () =>
    new Promise<void>((resolveClose) => {
      server.close(() => {
        resolveClose()
      })
    })
  return { baseUrl: `http://127.0.0.1:${address.port}`, close }
}

interface ReleaseFixtureResult {
  readonly releaseDir: string
  readonly tarballSha256: string
}

async function releaseFixture(): Promise<ReleaseFixtureResult> {
  const root = await mkdtemp(join(tmpdir(), 'spark-release-pub-'))
  roots.push(root)
  const releaseDir = join(root, 'release')
  await mkdir(releaseDir, { recursive: true })
  const bytes = Buffer.from('tarball-bytes', 'utf8')
  const sha = sha256Hex(bytes)
  await writeFile(join(releaseDir, 'spark-agent-0.2.0.tgz'), bytes)
  await writeFile(
    join(releaseDir, 'spark-agent-0.2.0.tgz.sha256'),
    `${sha}  spark-agent-0.2.0.tgz\n`,
  )
  await writeFile(
    join(releaseDir, 'latest.json'),
    `${JSON.stringify(
      {
        name: '@spark/agent',
        version: '0.2.0',
        sha256: sha,
        tarball: 'spark-agent-0.2.0.tgz',
        publishedAt: '2026-08-26T12:00:00.000Z',
      },
      null,
      2,
    )}\n`,
  )
  for (const name of ['install.sh', 'install.ps1', 'install.cmd']) {
    await writeFile(join(releaseDir, name), `# ${name}\n`)
  }
  return { releaseDir, tarballSha256: sha }
}

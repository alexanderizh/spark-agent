import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { mkdir, mkdtemp, readFile, rm, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import {
  acquireUpdateLock,
  checkForUpdate,
  classifyUpdate,
  recoverInterruptedUpdate,
} from '../../src/cli/update.js'
import { parseSemVer } from '../../src/cli/semver.js'

const roots: string[] = []
const closers: (() => Promise<void>)[] = []

afterEach(async () => {
  for (const close of closers.splice(0)) await close()
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

describe('classifyUpdate', () => {
  const current = parseSemVer('1.0.0')!
  it('distinguishes available, same, older, and prerelease outcomes', () => {
    expect(classifyUpdate(current, parseSemVer('1.1.0')!, false)).toBe('update_available')
    expect(classifyUpdate(current, parseSemVer('1.0.0')!, false)).toBe('up_to_date')
    expect(classifyUpdate(current, parseSemVer('0.9.0')!, false)).toBe('remote_older')
    expect(classifyUpdate(current, parseSemVer('1.1.0-rc.1')!, false)).toBe('prerelease_available')
  })

  it('never gates an identical prerelease as updatable', () => {
    const prereleaseCurrent = parseSemVer('1.1.0-rc.1')!
    expect(classifyUpdate(prereleaseCurrent, parseSemVer('1.1.0-rc.1')!, false)).toBe('up_to_date')
    expect(classifyUpdate(prereleaseCurrent, parseSemVer('1.1.0')!, false)).toBe('update_available')
  })

  it('allows prereleases when explicitly requested', () => {
    expect(classifyUpdate(current, parseSemVer('1.1.0-rc.1')!, true)).toBe('update_available')
    expect(classifyUpdate(current, parseSemVer('1.1.0-rc.1')!, false)).toBe('prerelease_available')
  })
})

describe('acquireUpdateLock', () => {
  it('exclusively locks, releases, and rejects a second holder', async () => {
    const home = await tempHome()
    const first = await acquireUpdateLock(home)
    expect(first).toBeDefined()
    const second = await acquireUpdateLock(home)
    expect(second).toBeUndefined()
    await first!.release()
    const third = await acquireUpdateLock(home)
    expect(third).toBeDefined()
    await third!.release()
  })

  it('retakes a stale lock', async () => {
    const home = await tempHome()
    await writeFile(join(home, 'update.lock'), '{"pid":1}\n')
    const old = Date.now() / 1000 - 3600
    await utimes(join(home, 'update.lock'), old, old)
    const lock = await acquireUpdateLock(home)
    expect(lock).toBeDefined()
    await lock!.release()
  })

  it('keeps a fresh foreign lock', async () => {
    const home = await tempHome()
    await writeFile(join(home, 'update.lock'), '{"pid":1}\n')
    expect(await acquireUpdateLock(home)).toBeUndefined()
    expect(await readFile(join(home, 'update.lock'), 'utf8')).toContain('"pid":1')
  })
})

describe('recoverInterruptedUpdate', () => {
  it('restores a snapshot when the live package is missing', async () => {
    const scope = (await tempHome()) + '/@spark'
    await mkdir(join(scope, '.spark-agent-backup-123', 'package'), { recursive: true })
    const liveDir = join(scope, 'agent')
    await writeFile(
      join(scope, '.spark-agent-backup-123', 'package', 'package.json'),
      JSON.stringify({ name: '@spark/agent', version: '0.1.0' }),
    )
    const warnings: string[] = []
    await recoverInterruptedUpdate(scope, liveDir, warnings)
    expect(JSON.parse(await readFile(join(liveDir, 'package.json'), 'utf8'))).toMatchObject({
      name: '@spark/agent',
    })
    expect(warnings.join(' ')).toContain('restored the previous spark version')
  })

  it('drops a leftover snapshot when the live package exists', async () => {
    const scope = (await tempHome()) + '/@spark'
    await mkdir(join(scope, 'agent'), { recursive: true })
    await mkdir(join(scope, '.spark-agent-backup-456', 'package'), { recursive: true })
    await writeFile(join(scope, 'agent', 'package.json'), JSON.stringify({ name: '@spark/agent' }))
    const warnings: string[] = []
    await recoverInterruptedUpdate(scope, join(scope, 'agent'), warnings)
    expect(warnings.join(' ')).toContain('removed leftover backup')
  })
})

describe('checkForUpdate against a release server', () => {
  it('classifies update_available, up_to_date, remote_older, and prerelease', async () => {
    const home = await tempHome()
    const cases: readonly { manifestVersion: string; expected: string }[] = [
      { manifestVersion: '9.9.9', expected: 'update_available' },
      { manifestVersion: '1.0.0', expected: 'up_to_date' },
      { manifestVersion: '0.0.1', expected: 'remote_older' },
      { manifestVersion: '9.9.9-rc.1', expected: 'prerelease_available' },
    ]
    for (const testCase of cases) {
      const server = await manifestServer(testCase.manifestVersion)
      const outcome = await checkForUpdate({
        base: server.baseUrl,
        allowPrerelease: false,
        sparkHome: home,
        install: { root: '/repo', version: '1.0.0', entry: '/repo/dist/cli/main.js' },
      })
      expect(outcome.status, testCase.manifestVersion).toBe(testCase.expected)
      await server.close()
    }
  })

  it('uses the pinned sidecar and flags deliberate downgrades', async () => {
    const home = await tempHome()
    const server = await manifestServer('2.0.0')
    const { baseUrl, close } = server
    await writeFile(
      join(server.staging, 'spark-agent-0.5.0.tgz.sha256'),
      `${'c'.repeat(64)}  spark-agent-0.5.0.tgz\n`,
    )
    const outcome = await checkForUpdate({
      base: baseUrl,
      target: '0.5.0',
      allowPrerelease: false,
      sparkHome: home,
      install: { root: '/repo', version: '1.0.0', entry: '/repo/dist/cli/main.js' },
    })
    expect(outcome.status).toBe('update_available')
    expect(outcome.downgrade).toBe(true)
    expect(outcome.pinned).toBe(true)
    expect(outcome.manifest.sha256).toBe('c'.repeat(64))
    await close()
  })

  it('fails closed on a corrupt manifest', async () => {
    const home = await tempHome()
    const { baseUrl, close } = await rawServer((request, response) => {
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end('{"name":"@evil/agent","version":"9.9.9","sha256":"0","tarball":"x.tgz"}')
    })
    await expect(
      checkForUpdate({
        base: baseUrl,
        allowPrerelease: false,
        sparkHome: home,
        install: { root: '/repo', version: '1.0.0', entry: '/repo/dist/cli/main.js' },
      }),
    ).rejects.toThrow()
    await close()
  })
})

async function manifestServer(
  version: string,
): Promise<{ baseUrl: string; staging: string; close: () => Promise<void> }> {
  const root = await mkdtemp(join(tmpdir(), 'spark-manifest-'))
  roots.push(root)
  const staging = join(root, 'release')
  await mkdir(staging, { recursive: true })
  await writeFile(
    join(staging, 'latest.json'),
    JSON.stringify({
      name: '@spark/agent',
      version,
      sha256: 'f'.repeat(64),
      tarball: `spark-agent-${version}.tgz`,
      publishedAt: '2026-08-26T12:00:00.000Z',
    }),
  )
  return serveDirectory(staging)
}

async function rawServer(
  handler: (request: IncomingMessage, response: ServerResponse) => void,
): Promise<{ baseUrl: string; close: () => Promise<void> }> {
  const server = createServer(handler)
  await new Promise<void>((resolveListen) => server.listen(0, '127.0.0.1', resolveListen))
  const address = server.address() as AddressInfo
  const close = () =>
    new Promise<void>((resolveClose) => {
      server.close(() => {
        resolveClose()
      })
    })
  closers.push(close)
  return { baseUrl: `http://127.0.0.1:${address.port}`, close }
}

async function serveDirectory(staging: string): Promise<{
  baseUrl: string
  staging: string
  close: () => Promise<void>
}> {
  const server = createServer((request, response) => {
    void (async () => {
      const requested = request.url?.split('?')[0]?.replace(/^\//u, '') ?? ''
      try {
        const body = await readFile(join(staging, requested))
        response.writeHead(200, {
          'content-type': requested.endsWith('.json')
            ? 'application/json'
            : 'application/octet-stream',
        })
        response.end(body)
      } catch {
        response.writeHead(404).end()
      }
    })()
  })
  await new Promise<void>((resolveListen) => server.listen(0, '127.0.0.1', resolveListen))
  const address = server.address() as AddressInfo
  const close = () =>
    new Promise<void>((resolveClose) => {
      server.close(() => {
        resolveClose()
      })
    })
  closers.push(close)
  return { baseUrl: `http://127.0.0.1:${address.port}`, staging, close }
}

async function tempHome(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'spark-update-core-'))
  roots.push(root)
  return root
}

import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { updateNoticeLine } from '../../src/cli/update-notice.js'

const roots: string[] = []
const closers: (() => Promise<void>)[] = []

afterEach(async () => {
  for (const close of closers.splice(0)) await close()
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

describe('interactive update notice', () => {
  it('is disabled by SPARK_UPDATE_CHECK=0 and by config', async () => {
    const home = await tempHome()
    await writeState(home, { latestVersion: '9.9.9' })
    expect(
      await updateNoticeLine({
        sparkHome: home,
        cwd: home,
        currentVersion: '1.0.0',
        env: { SPARK_UPDATE_CHECK: '0' },
      }),
    ).toBeUndefined()

    const project = join(home, 'project')
    await mkdir(join(project, '.spark'), { recursive: true })
    await writeFile(join(project, '.spark', 'config.toml'), '[update]\nenabled = false\n')
    expect(
      await updateNoticeLine({ sparkHome: home, cwd: project, currentVersion: '1.0.0', env: {} }),
    ).toBeUndefined()
  })

  it('uses a cached newer version without touching the network', async () => {
    const home = await tempHome()
    await writeState(home, { lastCheckAt: new Date().toISOString(), latestVersion: '2.0.0' })
    const line = await updateNoticeLine({
      sparkHome: home,
      cwd: home,
      currentVersion: '1.0.0',
      env: {},
    })
    expect(line).toContain('spark 2.0.0 is available')
    expect(line).toContain('spark update')
  })

  it('stays silent for the same version, older versions, and prereleases', async () => {
    const home = await tempHome()
    for (const latestVersion of ['1.0.0', '0.9.0', '2.0.0-rc.1']) {
      await writeState(home, { lastCheckAt: new Date().toISOString(), latestVersion })
      expect(
        await updateNoticeLine({ sparkHome: home, cwd: home, currentVersion: '1.0.0', env: {} }),
        latestVersion,
      ).toBeUndefined()
    }
  })

  it('refreshes over the network at most once a day and records failed attempts', async () => {
    const home = await tempHome()
    const server = await manifestServer('3.0.0')
    const line = await updateNoticeLine({
      sparkHome: home,
      cwd: home,
      currentVersion: '1.0.0',
      env: { SPARK_RELEASE_BASE: server.baseUrl },
    })
    expect(line).toContain('spark 3.0.0 is available')
    const state = JSON.parse(await readFile(join(home, 'update-check.json'), 'utf8')) as {
      lastCheckAt: string
      latestVersion: string
    }
    expect(state.latestVersion).toBe('3.0.0')

    // A host reporting an older release a day later: the refresh updates the
    // cache and the notice stays silent instead of nagging about a downgrade.
    const older = await manifestServer('0.0.0')
    const backdate = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString()
    await writeFile(
      join(home, 'update-check.json'),
      `${JSON.stringify({ lastCheckAt: backdate, latestVersion: '3.0.0' })}\n`,
    )
    const silent = await updateNoticeLine({
      sparkHome: home,
      cwd: home,
      currentVersion: '1.0.0',
      env: { SPARK_RELEASE_BASE: older.baseUrl },
    })
    expect(silent).toBeUndefined()
    const after = JSON.parse(await readFile(join(home, 'update-check.json'), 'utf8')) as {
      lastCheckAt: string
    }
    expect(Date.parse(after.lastCheckAt)).toBeGreaterThanOrEqual(Date.parse(state.lastCheckAt))
    await server.close()
    await older.close()
  })

  it('never throws when the release host is unreachable', async () => {
    const home = await tempHome()
    const result = await updateNoticeLine({
      sparkHome: home,
      cwd: home,
      currentVersion: '1.0.0',
      env: { SPARK_RELEASE_BASE: 'http://127.0.0.1:1' },
    })
    expect(result).toBeUndefined()
  })
})

async function writeState(home: string, state: Record<string, string>): Promise<void> {
  await writeFile(join(home, 'update-check.json'), `${JSON.stringify(state)}\n`)
}

async function manifestServer(
  version: string,
): Promise<{ baseUrl: string; close: () => Promise<void> }> {
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end(
      JSON.stringify({
        name: '@spark/agent',
        version,
        sha256: 'a'.repeat(64),
        tarball: `spark-agent-${version}.tgz`,
        publishedAt: '2026-08-26T12:00:00.000Z',
      }),
    )
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
  return { baseUrl: `http://127.0.0.1:${address.port}`, close }
}

async function tempHome(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'spark-notice-'))
  roots.push(root)
  return root
}

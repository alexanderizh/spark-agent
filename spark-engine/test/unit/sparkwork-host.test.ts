import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { discoverSparkWorkHost } from '../../src/config/sparkwork-host.js'

const roots: string[] = []

afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

describe('sparkwork host discovery', () => {
  it('prefers the live bridge among dead descriptors and reports the stale count', async () => {
    const root = await createRoot()
    await writeDescriptor(root, 'bridge-dead-port.json', {
      endpoint: 'http://127.0.0.1:39871',
      instanceId: 'instance-deadport-aaaaa',
      startedAt: '2026-08-26T09:00:00.000Z',
    })
    await writeDescriptor(root, 'bridge-dead-http.json', {
      endpoint: 'http://127.0.0.1:39872',
      instanceId: 'instance-deadhttp-bbbb',
      startedAt: '2026-08-26T09:30:00.000Z',
    })
    await writeDescriptor(root, 'bridge-live.json', {
      endpoint: 'http://127.0.0.1:39873',
      instanceId: 'instance-live-cccccccc',
      startedAt: '2026-08-26T10:00:00.000Z',
    })
    const fetches: string[] = []
    const discovery = await discoverSparkWorkHost({
      sparkHome: root,
      fetch: async (input) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
        fetches.push(url)
        if (url.startsWith('http://127.0.0.1:39871')) {
          throw new TypeError('bridge connection refused (stale port)')
        }
        if (url.startsWith('http://127.0.0.1:39872')) {
          return new Response('not ok', { status: 404 })
        }
        expect(url.startsWith('http://127.0.0.1:39873/v1/catalog')).toBe(true)
        return catalogResponse('sparkwork:provider-1:gpt-live')
      },
    })

    expect(fetches).toHaveLength(3)
    expect(discovery.catalog?.defaultRoute).toBe('sparkwork:provider-1:gpt-live')
    expect(discovery.staleBridgeDescriptors).toBe(2)
    expect(discovery.diagnostic).toBeUndefined()
  })

  it('picks the most recently started live bridge when several instances answer', async () => {
    const root = await createRoot()
    await writeDescriptor(root, 'bridge-older.json', {
      endpoint: 'http://127.0.0.1:39881',
      instanceId: 'instance-older-aaaaaaaaaa',
      startedAt: '2026-08-26T10:00:00.000Z',
    })
    await writeDescriptor(root, 'bridge-newer.json', {
      endpoint: 'http://127.0.0.1:39882',
      instanceId: 'instance-newer-bbbbbbbbbb',
      startedAt: '2026-08-26T11:00:00.000Z',
    })

    const discovery = await discoverSparkWorkHost({
      sparkHome: root,
      fetch: async (input) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
        return catalogResponse(
          url.startsWith('http://127.0.0.1:39882')
            ? 'sparkwork:provider-1:gpt-newer'
            : 'sparkwork:provider-1:gpt-older',
        )
      },
    })

    expect(discovery.catalog?.defaultRoute).toBe('sparkwork:provider-1:gpt-newer')
    expect(discovery.staleBridgeDescriptors).toBe(0)
  })

  it('fails with a diagnostic when every descriptor is unreachable', async () => {
    const root = await createRoot()
    await writeDescriptor(root, 'bridge-unreachable.json', {
      endpoint: 'http://127.0.0.1:39878',
      instanceId: 'instance-unreachable-d',
      startedAt: '2026-08-26T10:00:00.000Z',
    })
    const discovery = await discoverSparkWorkHost({
      sparkHome: root,
      fetch: async () => {
        throw new TypeError('fetch failed')
      },
    })

    expect(discovery.catalog).toBeUndefined()
    expect(discovery.staleBridgeDescriptors).toBe(1)
    expect(discovery.diagnostic).toContain('SparkWork bridge is not reachable')
  })

  it('ignores legacy and temporary descriptor files during directory scans', async () => {
    const root = await createRoot()
    await writeDescriptor(root, 'bridge.json', {
      endpoint: 'http://127.0.0.1:39891',
      instanceId: 'instance-legacy-cccccccc',
      startedAt: '2026-08-26T10:00:00.000Z',
    })
    await writeDescriptor(root, '.bridge-temporary.tmp', {
      endpoint: 'http://127.0.0.1:39892',
      instanceId: 'instance-tmp-dddddddddd',
      startedAt: '2026-08-26T10:00:00.000Z',
    })
    let fetches = 0

    const discovery = await discoverSparkWorkHost({
      sparkHome: root,
      fetch: async () => {
        fetches += 1
        return catalogResponse('sparkwork:provider-1:gpt-any')
      },
    })

    expect(fetches).toBe(0)
    expect(discovery).toEqual({ staleBridgeDescriptors: 0 })
  })

  it('treats a world-readable or malformed descriptor as stale, not fatal', async () => {
    const root = await createRoot()
    await writeDescriptor(root, 'bridge-valid.json', {
      endpoint: 'http://127.0.0.1:39901',
      instanceId: 'instance-valid-eeeeeeeeee',
      startedAt: '2026-08-26T10:00:00.000Z',
    })
    const loosePath = join(root, 'hosts', 'sparkwork', 'bridge-loose.json')
    await writeFile(loosePath, validDescriptorJson('http://127.0.0.1:39902'), { mode: 0o644 })
    if (process.platform !== 'win32') await chmod(loosePath, 0o644)
    await writeFile(
      join(root, 'hosts', 'sparkwork', 'bridge-broken.json'),
      '{not json',
      { mode: 0o600 },
    )

    const discovery = await discoverSparkWorkHost({
      sparkHome: root,
      fetch: async () => catalogResponse('sparkwork:provider-1:gpt-valid'),
    })

    expect(discovery.catalog?.defaultRoute).toBe('sparkwork:provider-1:gpt-valid')
    expect(discovery.staleBridgeDescriptors).toBe(2)
  })

  it('returns a quiet negative when no bridge directory exists', async () => {
    const root = await mkdtemp(join(tmpdir(), 'spark-host-empty-'))
    roots.push(root)
    const discovery = await discoverSparkWorkHost({ sparkHome: root, fetch: async () => {
      throw new Error('must not probe anything')
    } })
    expect(discovery).toEqual({ staleBridgeDescriptors: 0 })
  })

  it('still probes an explicitly configured descriptor path', async () => {
    const root = await createRoot()
    const explicitPath = join(root, 'explicit.json')
    const discovery = await discoverSparkWorkHost({
      sparkHome: root,
      descriptorPath: explicitPath,
      fetch: async () => catalogResponse('sparkwork:provider-1:gpt-explicit'),
    })
    expect(discovery.catalog).toBeUndefined()
    expect(discovery.staleBridgeDescriptors).toBe(0)
    expect(discovery.diagnostic).toBeUndefined()

    await writeFile(explicitPath, validDescriptorJson('http://127.0.0.1:39911'), { mode: 0o600 })
    if (process.platform !== 'win32') await chmod(explicitPath, 0o600)
    const found = await discoverSparkWorkHost({
      sparkHome: root,
      descriptorPath: explicitPath,
      fetch: async () => catalogResponse('sparkwork:provider-1:gpt-explicit'),
    })
    expect(found.catalog?.defaultRoute).toBe('sparkwork:provider-1:gpt-explicit')
  })
})

async function createRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'spark-host-'))
  roots.push(root)
  await mkdir(join(root, 'hosts', 'sparkwork'), { recursive: true })
  return root
}

interface DescriptorOverride {
  readonly endpoint: string
  readonly instanceId: string
  readonly startedAt: string
}

async function writeDescriptor(
  root: string,
  name: string,
  override: DescriptorOverride,
): Promise<void> {
  const path = join(root, 'hosts', 'sparkwork', name)
  await writeFile(path, validDescriptorJson(override.endpoint, override), { mode: 0o600 })
  if (process.platform !== 'win32') await chmod(path, 0o600)
}

function validDescriptorJson(endpoint: string, override?: Partial<DescriptorOverride>): string {
  return JSON.stringify({
    schemaVersion: 1,
    host: 'sparkwork',
    instanceId: override?.instanceId ?? 'instance-default-ffffffff',
    endpoint,
    token: 'bridge-token-that-is-long-enough-to-be-private',
    pid: process.pid,
    startedAt: override?.startedAt ?? '2026-08-26T12:00:00.000Z',
  })
}

function catalogResponse(defaultRoute: string): Response {
  return new Response(
    JSON.stringify({
      schemaVersion: 1,
      host: 'sparkwork',
      revision: 'a'.repeat(64),
      generatedAt: '2026-08-26T12:00:00.000Z',
      defaultRoute,
      routes: [
        {
          routeId: defaultRoute,
          providerId: 'provider-1',
          providerName: 'Provider One',
          protocol: 'openai-responses',
          model: defaultRoute.split(':').pop() ?? '',
        },
      ],
    }),
    { headers: { 'content-type': 'application/json' } },
  )
}

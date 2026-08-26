import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { startSparkCliBridge, type SparkCliBridge } from './SparkCliBridgeService.js'

const bridges: SparkCliBridge[] = []
const roots: string[] = []

afterEach(async () => {
  await Promise.all(bridges.splice(0).map(async (bridge) => bridge.stop()))
  await Promise.all(roots.splice(0).map(async (root) => rm(root, { recursive: true, force: true })))
})

describe('SparkCliBridgeService', () => {
  it('publishes the effective catalog and proxies without exposing provider credentials', async () => {
    const sparkHome = await mkdtemp(join(tmpdir(), 'spark-cli-bridge-'))
    roots.push(sparkHome)
    let captured:
      | {
          url: string
          authorization: string | null
          body: string
          redirect: 'error' | 'follow' | 'manual' | undefined
        }
      | undefined
    const upstreamFetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const headers = new Headers(init?.headers)
      captured = {
        url: String(input),
        authorization: headers.get('authorization'),
        body: String(init?.body),
        redirect: init?.redirect,
      }
      return new Response('data: {"type":"response.completed","response":{"output":[]}}\n\n', {
        headers: { 'content-type': 'text/event-stream' },
      })
    })
    const bridge = await startSparkCliBridge({
      sparkHome,
      now: () => new Date('2026-08-26T12:00:00.000Z'),
      listProviders: async () => [
        {
          id: 'openai-main',
          name: 'Primary OpenAI',
          provider: 'openai',
          enabled: true,
          defaultModel: 'gpt-test',
          modelIds: [],
          apiEndpoint: 'https://models.example/v1',
          codexApiKind: 'responses',
          contextWindow: 200_000,
          isDefault: true,
        },
        {
          id: 'local-codex-cli',
          name: 'Local Codex CLI',
          provider: 'openai',
          enabled: true,
          defaultModel: 'codex cli',
          modelIds: ['codex cli'],
          codexApiKind: 'responses',
          isDefault: false,
        },
        {
          id: 'disabled',
          name: 'Disabled',
          provider: 'anthropic',
          enabled: false,
          defaultModel: 'hidden',
          modelIds: ['hidden'],
          isDefault: false,
        },
      ],
      resolveCredential: async () => 'provider-secret',
      fetch: upstreamFetch as typeof fetch,
    })
    bridges.push(bridge)

    const descriptor = JSON.parse(await readFile(bridge.descriptorPath, 'utf8')) as {
      token: string
    }
    if (process.platform !== 'win32') {
      expect((await stat(bridge.descriptorPath)).mode & 0o077).toBe(0)
    }
    const unauthorized = await fetch(`${bridge.endpoint}/v1/catalog`)
    expect(unauthorized.status).toBe(401)

    const catalogResponse = await fetch(`${bridge.endpoint}/v1/catalog`, {
      headers: { authorization: `Bearer ${descriptor.token}` },
    })
    const catalogText = await catalogResponse.text()
    expect(catalogResponse.status).toBe(200)
    expect(catalogText).not.toContain('provider-secret')
    expect(JSON.parse(catalogText)).toMatchObject({
      defaultRoute: 'sparkwork:openai-main:gpt-test',
      routes: [
        {
          providerId: 'openai-main',
          protocol: 'openai-responses',
          model: 'gpt-test',
          contextWindow: 200_000,
        },
      ],
    })

    const proxyResponse = await fetch(`${bridge.endpoint}/v1/proxy/openai-main/v1/responses`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${descriptor.token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ model: 'gpt-test', stream: true }),
    })
    expect(proxyResponse.status).toBe(200)
    expect(await proxyResponse.text()).toContain('response.completed')
    expect(captured).toEqual({
      url: 'https://models.example/v1/responses',
      authorization: 'Bearer provider-secret',
      body: JSON.stringify({ model: 'gpt-test', stream: true }),
      redirect: 'error',
    })
  })

  it('re-reads providers for every catalog request so updates need no CLI config copy', async () => {
    const sparkHome = await mkdtemp(join(tmpdir(), 'spark-cli-bridge-refresh-'))
    roots.push(sparkHome)
    let modelIds = ['model-a']
    const bridge = await startSparkCliBridge({
      sparkHome,
      listProviders: async () => [
        {
          id: 'anthropic-main',
          name: 'Anthropic',
          provider: 'anthropic',
          enabled: true,
          defaultModel: modelIds[0] ?? '',
          modelIds,
          isDefault: true,
        },
      ],
      resolveCredential: async () => 'secret',
    })
    bridges.push(bridge)
    const descriptor = JSON.parse(await readFile(bridge.descriptorPath, 'utf8')) as {
      token: string
    }
    const readModels = async () => {
      const response = await fetch(`${bridge.endpoint}/v1/catalog`, {
        headers: { authorization: `Bearer ${descriptor.token}` },
      })
      const catalog = (await response.json()) as { routes: Array<{ model: string }> }
      return catalog.routes.map((route) => route.model)
    }

    await expect(readModels()).resolves.toEqual(['model-a'])
    modelIds = ['model-b']
    await expect(readModels()).resolves.toEqual(['model-b'])
  })

  it('keeps concurrent instances independent: stopping one never deletes the other', async () => {
    const sparkHome = await mkdtemp(join(tmpdir(), 'spark-cli-bridge-multi-'))
    roots.push(sparkHome)
    const first = await startSparkCliBridge({
      sparkHome,
      listProviders: async () => [],
      resolveCredential: async () => 'secret',
    })
    bridges.push(first)
    const second = await startSparkCliBridge({
      sparkHome,
      listProviders: async () => [],
      resolveCredential: async () => 'secret',
    })

    expect(first.descriptorPath).not.toBe(second.descriptorPath)
    expect((await readFile(first.descriptorPath, 'utf8')).length).toBeGreaterThan(0)
    expect((await readFile(second.descriptorPath, 'utf8')).length).toBeGreaterThan(0)

    await second.stop()
    expect(await exists(first.descriptorPath)).toBe(true)
    expect(await exists(second.descriptorPath)).toBe(false)

    const catalogResponse = await fetch(`${first.endpoint}/v1/catalog`, {
      headers: {
        authorization: `Bearer ${(JSON.parse(await readFile(first.descriptorPath, 'utf8')) as { token: string }).token}`,
      },
    })
    expect(catalogResponse.status).toBe(200)
  })

  it('collects descriptors left by dead instances but never touches live ones', async () => {
    const sparkHome = await mkdtemp(join(tmpdir(), 'spark-cli-bridge-gc-'))
    roots.push(sparkHome)
    const bridgeDir = join(sparkHome, 'hosts', 'sparkwork')
    await mkdir(bridgeDir, { recursive: true })
    const deadPid = await exitedProcessPid()
    const stalePath = join(bridgeDir, `bridge-stale-${deadPid}.json`)
    await writeFile(
      stalePath,
      JSON.stringify({ schemaVersion: 1, pid: deadPid, instanceId: `stale-${deadPid}` }),
      'utf8',
    )
    const legacyPath = join(bridgeDir, 'bridge.json')
    await writeFile(legacyPath, JSON.stringify({ schemaVersion: 1, pid: deadPid }), 'utf8')
    const livePath = join(bridgeDir, `bridge-live-${process.pid}.json`)
    await writeFile(
      livePath,
      JSON.stringify({ schemaVersion: 1, pid: process.pid, instanceId: `live-${process.pid}` }),
      'utf8',
    )

    const bridge = await startSparkCliBridge({
      sparkHome,
      listProviders: async () => [],
      resolveCredential: async () => 'secret',
    })
    bridges.push(bridge)

    expect(await exists(stalePath)).toBe(false)
    expect(await exists(legacyPath)).toBe(false)
    expect(await exists(livePath)).toBe(true)
    expect(await exists(bridge.descriptorPath)).toBe(true)
  })
})

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

async function exitedProcessPid(): Promise<number> {
  const child = spawn(process.execPath, ['--eval', 'process.exit(0)'], { stdio: 'ignore' })
  const [code] = await new Promise<[number | null]>((resolveExit) => {
    child.once('close', (exitCode) => resolveExit([exitCode]))
  })
  expect(code).toBe(0)
  return child.pid ?? -1
}

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
          maxTokens: 64_000,
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
          maxOutputTokens: 64_000,
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

  it.each([
    {
      provider: 'anthropic',
      protocolPath: 'messages',
      upstreamEvent: 'event: message_start\ndata: {"type":"message_start"}\n\n',
      expectedCode: 'bridge_stream_error',
    },
    {
      provider: 'openai',
      protocolPath: 'responses',
      upstreamEvent: 'data: {"type":"response.created"}\n\n',
      expectedCode: 'bridge_stream_error',
    },
  ])(
    'turns an upstream $provider disconnect into a structured stream error',
    async ({ provider, protocolPath, upstreamEvent, expectedCode }) => {
      const sparkHome = await mkdtemp(join(tmpdir(), 'spark-cli-bridge-stream-error-'))
      roots.push(sparkHome)
      let sentInitialChunk = false
      const body = new ReadableStream<Uint8Array>({
        pull(controller) {
          if (!sentInitialChunk) {
            sentInitialChunk = true
            controller.enqueue(new TextEncoder().encode(`${upstreamEvent}data: {"type":"truncated`))
            return
          }
          controller.error(
            new TypeError('terminated', {
              cause: Object.assign(new Error('socket reset by peer'), { code: 'ECONNRESET' }),
            }),
          )
        },
      })
      const bridge = await startSparkCliBridge({
        sparkHome,
        listProviders: async () => [
          {
            id: 'provider-1',
            name: 'Provider',
            provider,
            defaultModel: 'model-1',
            modelIds: ['model-1'],
            ...(provider === 'openai' ? { codexApiKind: 'responses' as const } : {}),
            isDefault: true,
          },
        ],
        resolveCredential: async () => 'secret',
        fetch: vi.fn(
          async () => new Response(body, { headers: { 'content-type': 'text/event-stream' } }),
        ) as typeof fetch,
      })
      bridges.push(bridge)
      const descriptor = JSON.parse(await readFile(bridge.descriptorPath, 'utf8')) as {
        token: string
      }
      const response = await fetch(`${bridge.endpoint}/v1/proxy/provider-1/v1/${protocolPath}`, {
        method: 'POST',
        headers: { authorization: `Bearer ${descriptor.token}` },
        body: JSON.stringify({ model: 'model-1', stream: true }),
      })
      const text = await response.text()
      expect(text).toContain(upstreamEvent.trim())
      expect(text).toContain(expectedCode)
      expect(text).toContain('socket reset by peer')
      expect(text).toContain('ECONNRESET')
      expect(text).not.toContain('truncated')
    },
  )

  it('replaces a truncated final SSE event at normal EOF with a structured error', async () => {
    const sparkHome = await mkdtemp(join(tmpdir(), 'spark-cli-bridge-truncated-eof-'))
    roots.push(sparkHome)
    const bridge = await startSparkCliBridge({
      sparkHome,
      listProviders: async () => [
        {
          id: 'provider-1',
          name: 'Provider',
          provider: 'openai',
          defaultModel: 'model-1',
          modelIds: ['model-1'],
          codexApiKind: 'responses',
          isDefault: true,
        },
      ],
      resolveCredential: async () => 'secret',
      fetch: vi.fn(
        async () =>
          new Response('data: {"type":"truncated', {
            headers: { 'content-type': 'text/event-stream' },
          }),
      ) as typeof fetch,
    })
    bridges.push(bridge)
    const descriptor = JSON.parse(await readFile(bridge.descriptorPath, 'utf8')) as {
      token: string
    }
    const response = await fetch(`${bridge.endpoint}/v1/proxy/provider-1/v1/responses`, {
      method: 'POST',
      headers: { authorization: `Bearer ${descriptor.token}` },
      body: JSON.stringify({ model: 'model-1', stream: true }),
    })
    const text = await response.text()
    expect(text).toContain('bridge_stream_error')
    expect(text).toContain('SPARK_CLI_BRIDGE_INCOMPLETE_SSE_EVENT')
    expect(text).not.toContain('"type":"truncated')
  })

  it('returns a structured root cause when the upstream connection fails before headers', async () => {
    const sparkHome = await mkdtemp(join(tmpdir(), 'spark-cli-bridge-connect-error-'))
    roots.push(sparkHome)
    const bridge = await startSparkCliBridge({
      sparkHome,
      listProviders: async () => [
        {
          id: 'provider-1',
          name: 'Provider',
          provider: 'openai',
          defaultModel: 'model-1',
          modelIds: ['model-1'],
          codexApiKind: 'responses',
          isDefault: true,
        },
      ],
      resolveCredential: async () => 'secret',
      fetch: vi.fn(async () => {
        throw new TypeError('fetch failed', {
          cause: Object.assign(new Error('connection refused'), { code: 'ECONNREFUSED' }),
        })
      }) as typeof fetch,
    })
    bridges.push(bridge)
    const descriptor = JSON.parse(await readFile(bridge.descriptorPath, 'utf8')) as {
      token: string
    }
    const response = await fetch(`${bridge.endpoint}/v1/proxy/provider-1/v1/responses`, {
      method: 'POST',
      headers: { authorization: `Bearer ${descriptor.token}` },
      body: JSON.stringify({ model: 'model-1', stream: true }),
    })
    const payload = (await response.json()) as {
      error: { type: string; message: string; cause: { cause?: { code?: string } } }
    }
    expect(response.status).toBe(502)
    expect(payload.error.type).toBe('bridge_transport_error')
    expect(payload.error.message).toContain('ECONNREFUSED')
    expect(payload.error.cause.cause?.code).toBe('ECONNREFUSED')
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

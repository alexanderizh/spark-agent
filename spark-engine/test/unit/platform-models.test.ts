import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import type { FetchLike } from '../../src/llm/http/client.js'
import {
  NewApiClient,
  NewApiAuthenticationError,
  NewApiSessionConflictError,
} from '../../src/platform/new-api-client.js'
import { PlatformModelStore } from '../../src/platform/model-store.js'
import { bootstrapPlatformModels, readPlatformModelSnapshot } from '../../src/platform/models.js'
import { canonicalDirectory } from '../../src/fs/real-path.js'
import { inspectConfiguredModels } from '../../src/config/model-config.js'

const roots: string[] = []

afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

async function tempHome(prefix = 'spark-platform-'): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), prefix))
  roots.push(root)
  return root
}

const GATEWAY = 'http://gateway.test'
function urlOf(input: Parameters<FetchLike>[0]): string {
  return typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
}

const EDU = 'http://edu.test'

interface Scenario {
  readonly calls: { url: string; method: string; body?: unknown }[]
}

function scenarioFetch(): { fetch: FetchLike; scenario: Scenario } {
  const scenario: Scenario = { calls: [] }
  const fetch: FetchLike = async (input, init) => {
    const url = urlOf(input)
    const method = init?.method ?? 'GET'
    const body =
      typeof init?.body === 'string'
        ? (JSON.parse(init.body) as { username?: string; password?: string })
        : undefined
    scenario.calls.push({ url, method, body })
    return route(url, method, body)
  }
  return { fetch, scenario }
  function route(url: string, method: string, rawBody: unknown): Response {
    const body = rawBody as { username?: string; password?: string } | undefined
    // new-api gateway endpoints
    if (url === `${GATEWAY}/api/user/login`) {
      if (body?.username === 'na-user' && body?.password === 'na-pass') {
        return jsonResponse(200, { success: true }, { 'set-cookie': 'session=abc123; Path=/' })
      }
      return jsonResponse(401, { success: false, message: '用户名或密码不正确' })
    }
    if (url === `${GATEWAY}/api/user/token`) {
      return jsonResponse(200, { success: true, data: 'dashboard-token' })
    }
    if (url === `${GATEWAY}/api/user/self`) {
      return jsonResponse(200, { success: true, data: { id: 7, username: 'na-user' } })
    }
    if (url.startsWith(`${GATEWAY}/api/user/models`)) {
      const page = Number(new URL(url).searchParams.get('p') ?? '1')
      if (page === 1) {
        return jsonResponse(200, {
          success: true,
          data: {
            page: 1,
            page_size: 2,
            total: 3,
            items: [
              { model_name: 'gpt-platform', status: 1, tags: 'flagship,chat' },
              { model_name: 'claude-platform', status: 1 },
            ],
          },
        })
      }
      return jsonResponse(200, {
        success: true,
        data: {
          page: 2,
          page_size: 2,
          total: 3,
          items: [{ model_name: 'hidden-model', status: 2 }],
        },
      })
    }
    if (url === `${GATEWAY}/api/token/`) {
      return jsonResponse(200, {
        success: true,
        data: { items: [{ id: 3, name: 'Spark平台令牌', status: 1 }] },
      })
    }
    if (url === `${GATEWAY}/api/token/3/key`) {
      return jsonResponse(200, { success: true, data: { key: 'sk-platform-key' } })
    }
    if (url === `${GATEWAY}/api/token/`) return jsonResponse(500, {})
    // Spark account server
    if (url === `${EDU}/api/v1/platform-model/bootstrap`) {
      return jsonResponse(200, {
        code: 0,
        data: {
          baseUrl: GATEWAY,
          newapiUserId: 7,
          newapiUsername: 'na-user',
          password: 'na-pass',
        },
      })
    }
    if (url === `${EDU}/api/v1/platform-model/rebuild`) {
      return jsonResponse(200, {
        code: 0,
        data: { baseUrl: GATEWAY, newapiUserId: 7, newapiUsername: 'na-user', password: 'na-pass' },
      })
    }
    return new Response('not found', { status: 404 })
  }
}

function jsonResponse(
  status: number,
  payload: unknown,
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  })
}

describe('NewApiClient', () => {
  it('logs in, exchanges the session cookie for a dashboard token, and lists the catalog', async () => {
    const { fetch, scenario } = scenarioFetch()
    const client = new NewApiClient(GATEWAY, 7, fetch, null)

    const token = await client.loginAndGenerateAccessToken('na-user', 'na-pass')
    expect(token).toBe('dashboard-token')

    const catalog = await client.getModelCatalog()
    // Disabled models are skipped; paging continues until total is reached.
    expect(catalog.map((item) => item.modelId)).toEqual(['gpt-platform', 'claude-platform'])
    expect(catalog[0]?.tags).toEqual(['flagship', 'chat'])

    expect(
      scenario.calls.some((call) => call.url === `${GATEWAY}/api/user/models?p=2&page_size=2`),
    ).toBe(true)
  })

  it('classifies a rejected login as an authentication error', async () => {
    const { fetch } = scenarioFetch()
    const client = new NewApiClient(GATEWAY, 7, fetch, null)
    await expect(client.loginAndGenerateAccessToken('na-user', 'wrong')).rejects.toBeInstanceOf(
      NewApiAuthenticationError,
    )
  })

  it('surfaces a session conflict when the dashboard token is stale', async () => {
    const { fetch } = scenarioFetch()
    const client = new NewApiClient(GATEWAY, 7, fetch, 'stale-token')
    // Force the dashboard to reject the token regardless of the scenario's
    // default self response.
    const conflictFetch: FetchLike = async (input, init) => {
      const url = urlOf(input)
      if (url === `${GATEWAY}/api/user/self`) return jsonResponse(401, { success: false })
      return fetch(input, init)
    }
    const conflicted = new NewApiClient(GATEWAY, 7, conflictFetch, 'stale-token')
    await expect(conflicted.validateSession()).rejects.toBeInstanceOf(NewApiSessionConflictError)
    void client
  })

  it('reuses the existing dashboard token and returns its key', async () => {
    const { fetch, scenario } = scenarioFetch()
    const client = new NewApiClient(GATEWAY, 7, fetch, 'dashboard-token')
    expect(await client.ensureApiKey()).toBe('sk-platform-key')
    expect(
      scenario.calls.some((call) => call.method === 'POST' && call.url === `${GATEWAY}/api/token/`),
    ).toBe(false)
  })
})

describe('PlatformModelStore', () => {
  it('round-trips a binding and hardens permissions', async () => {
    const home = await tempHome()
    const store = new PlatformModelStore({ sparkHome: home })
    await store.save({ baseUrl: GATEWAY, newApiUserId: 7, apiKey: 'sk-x', models: ['m1'] })

    const loaded = await store.load()
    expect(loaded?.baseUrl).toBe(GATEWAY)
    expect(loaded?.newApiUserId).toBe(7)
    expect(loaded?.models).toEqual(['m1'])

    const stats = await stat(store.path)
    if (process.platform !== 'win32') {
      // Windows reports a fixed mode mask; access control there is ACL-based.
      expect(stats.mode & 0o777).toBe(0o600)
    }
  })

  it('degrades a corrupt binding to null instead of failing every command', async () => {
    const home = await tempHome()
    const store = new PlatformModelStore({ sparkHome: home })
    await writeFile(join(home, 'platform-model.json'), '{not json', 'utf8')
    expect(await store.load()).toBeNull()
  })
})

describe('bootstrapPlatformModels', () => {
  it('binds the gateway end to end and persists the snapshot', async () => {
    const home = await tempHome()
    const { fetch } = scenarioFetch()

    const status = await bootstrapPlatformModels({
      sparkHome: home,
      serverUrl: EDU,
      session: { token: 'spark-token', refreshToken: 'spark-refresh', userId: '99' },
      fetch,
    })

    expect(status).toMatchObject({
      bound: true,
      providerReady: true,
      baseUrl: GATEWAY,
      apiKey: 'sk-platform-key',
      models: ['gpt-platform', 'claude-platform'],
    })
    const stored = JSON.parse(await readFile(join(home, 'platform-model.json'), 'utf8')) as {
      accessToken?: string
      apiKey?: string
    }
    expect(stored.accessToken).toBe('dashboard-token')
    expect(stored.apiKey).toBe('sk-platform-key')

    const snapshot = await readPlatformModelSnapshot(home)
    expect(snapshot?.models).toEqual(['gpt-platform', 'claude-platform'])
  })

  it('reports a session conflict instead of silently taking the dashboard over', async () => {
    const home = await tempHome()
    const store = new PlatformModelStore({ sparkHome: home })
    await store.save({ baseUrl: GATEWAY, newApiUserId: 7, accessToken: 'stale-token' })
    const { fetch } = scenarioFetch()
    const conflictFetch: FetchLike = async (input, init) => {
      const url = urlOf(input)
      if (url === `${GATEWAY}/api/user/self`) return jsonResponse(401, { success: false })
      return fetch(input, init)
    }

    const status = await bootstrapPlatformModels({
      sparkHome: home,
      serverUrl: EDU,
      session: { token: 'spark-token', refreshToken: 'spark-refresh', userId: '99' },
      fetch: conflictFetch,
    })

    expect(status).toMatchObject({ bound: true, providerReady: false, sessionConflict: true })
  })

  it('rebuilds the dashboard credentials once when the login is rejected', async () => {
    const home = await tempHome()
    let loginCalls = 0
    const { fetch } = scenarioFetch()
    const rebuildFetch: FetchLike = async (input, init) => {
      const url = urlOf(input)
      // The first login attempt is rejected, simulating rotated dashboard
      // credentials; the engine must rebuild once and retry successfully.
      if (url === `${GATEWAY}/api/user/login`) {
        loginCalls += 1
        if (loginCalls === 1) {
          return jsonResponse(401, { success: false, message: '用户名或密码不正确' })
        }
      }
      return fetch(input, init)
    }

    const status = await bootstrapPlatformModels({
      sparkHome: home,
      serverUrl: EDU,
      session: { token: 'spark-token', refreshToken: 'spark-refresh', userId: '99' },
      fetch: rebuildFetch,
    })

    expect(status.providerReady).toBe(true)
    expect(loginCalls).toBe(2)
  })
})

describe('model-config platform integration', () => {
  it('lists and registers platform models from the stored binding without any network call', async () => {
    const home = await tempHome()
    const store = new PlatformModelStore({ sparkHome: home })
    await store.save({
      baseUrl: GATEWAY,
      newApiUserId: 7,
      apiKey: 'sk-platform-key',
      models: ['gpt-platform', 'claude-platform'],
    })

    const catalog = await inspectConfiguredModels({
      cwd: process.cwd(),
      env: { ...process.env, SPARK_HOME: home },
    })
    expect(catalog.platformConnected).toBe(true)
    const platformEntries = catalog.entries.filter((entry) => entry.source === 'platform')
    expect(platformEntries.map((entry) => entry.id)).toEqual([
      'platform:gpt-platform',
      'platform:claude-platform',
    ])
    // The first platform model is the default route for a fresh login.
    expect(catalog.selectedModel).toBe('platform:gpt-platform')

    const snapshot = await readPlatformModelSnapshot(canonicalDirectory(home))
    expect(snapshot?.apiKey).toBe('sk-platform-key')
    void snapshot
  })
})

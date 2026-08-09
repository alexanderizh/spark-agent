import { mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { RuntimeHttpClient } from '../runtime-http-client.js'
import { RuntimePolicy } from '../runtime-policy.js'
import { RuntimeTokenService } from '../token-service.js'
import type { RuntimeContext } from '../runtime-types.js'
import { GitHubRuntimeAdapter } from './github-runtime.adapter.js'
import { GoogleWorkspaceRuntimeAdapter } from './google-runtime.adapter.js'
import { NotionRuntimeAdapter } from './notion-runtime.adapter.js'
import { ObsidianRuntimeAdapter } from './obsidian-runtime.adapter.js'

const temporaryRoots: string[] = []

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  )
})

describe('built-in connector runtime adapters', () => {
  it('exposes official credential setup guides for built-in connectors', () => {
    expect(new GitHubRuntimeAdapter().descriptor.authGuides?.token?.url).toBe(
      'https://github.com/settings/personal-access-tokens/new',
    )
    expect(new GoogleWorkspaceRuntimeAdapter().descriptor.authGuides?.oauth?.url).toBe(
      'https://console.cloud.google.com/apis/credentials',
    )
    expect(new NotionRuntimeAdapter().descriptor.authGuides?.token?.url).toBe(
      'https://www.notion.so/my-integrations',
    )
  })

  it('executes GitHub REST reads inside repository scope and rejects path escapes', async () => {
    const calls: string[] = []
    const fetchImpl = jsonFetch((url) => {
      calls.push(url)
      if (url.endsWith('/user')) return { id: 42, login: 'spark-qa' }
      if (url.includes('/contents/README.md'))
        return { content: Buffer.from('# Spark', 'utf8').toString('base64'), encoding: 'base64' }
      return [{ full_name: 'acme/demo' }]
    })
    const adapter = new GitHubRuntimeAdapter()
    const connect = await adapter.connect(
      {
        descriptor: adapter.descriptor,
        http: new RuntimeHttpClient({ fetchImpl }),
        getSecret: (name) => (name === 'token' ? 'github-token' : null),
      },
      {
        authMethod: 'pat',
        config: { apiBaseUrl: 'https://api.github.test', selectedRepos: ['acme/demo'] },
      },
    )
    const ctx = context(adapter, connect, fetchImpl, {
      resourceScope: { repos: ['acme/demo'] },
      enabledCapabilities: ['repositories', 'contents', 'identity'],
      config: { apiBaseUrl: 'https://api.github.test/', allowWrites: false },
    })

    await expect(
      adapter.invokeTool(ctx, 'read_file', { owner: 'acme', repo: 'demo', path: 'README.md' }),
    ).resolves.toMatchObject({
      decodedContent: '# Spark',
    })
    await expect(adapter.invokeTool(ctx, 'list_repositories', {})).resolves.toEqual([
      { full_name: 'acme/demo' },
    ])
    await expect(
      adapter.invokeTool(ctx, 'read_file', { owner: 'acme', repo: 'demo', path: '../secret' }),
    ).rejects.toMatchObject({ code: 'INVALID_PROVIDER_RESPONSE' })
    await expect(
      adapter.invokeTool(ctx, 'get_repository', { owner: 'other', repo: 'private' }),
    ).rejects.toMatchObject({ code: 'RESOURCE_OUT_OF_SCOPE' })
    expect(calls.every((url) => !url.includes('github-token'))).toBe(true)
  })

  it('keeps Gmail and Calendar under one Google account while enforcing header and scope rules', async () => {
    const calls: Array<{ url: string; init: RequestInit | undefined }> = []
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = String(input)
      calls.push({ url, init })
      if (url.includes('/userinfo'))
        return jsonResponse({ sub: 'google-user', email: 'qa@example.test' })
      if (url.includes('/messages?')) return jsonResponse({ messages: [{ id: 'm1' }] })
      return jsonResponse({ ok: true })
    }
    const adapter = new GoogleWorkspaceRuntimeAdapter()
    const connect = await adapter.connect(
      {
        descriptor: adapter.descriptor,
        http: new RuntimeHttpClient({ fetchImpl }),
        getSecret: (name) => (name === 'accessToken' ? 'google-token' : null),
      },
      {
        authMethod: 'oauth2',
        config: {
          grantedScopes: [
            'https://www.googleapis.com/auth/gmail.readonly',
            'https://www.googleapis.com/auth/calendar.readonly',
          ],
          calendars: ['primary'],
        },
      },
    )
    expect(connect.externalAccountId).toBe('google-user')
    const ctx = context(adapter, connect, fetchImpl, {
      enabledCapabilities: ['gmail_read', 'calendar_read'],
      resourceScope: { calendars: ['primary'] },
    })

    await expect(
      adapter.invokeTool(ctx, 'gmail_search_messages', { query: 'from:qa@example.test' }),
    ).resolves.toEqual({
      messages: [{ id: 'm1' }],
    })
    await expect(
      adapter.invokeTool(ctx, 'gmail_create_draft', {
        to: 'qa@example.test\r\nBcc: attacker@example.test',
        subject: 'test',
        body: 'hello',
      }),
    ).rejects.toMatchObject({ code: 'INVALID_PROVIDER_RESPONSE' })
    await expect(
      adapter.invokeTool(ctx, 'calendar_query_freebusy', {
        timeMin: '2026-08-09T00:00:00Z',
        timeMax: '2026-08-10T00:00:00Z',
        calendarIds: ['private-calendar'],
      }),
    ).rejects.toMatchObject({ code: 'RESOURCE_OUT_OF_SCOPE' })
    expect(calls.every(({ init }) => !String(init?.headers ?? '').includes('google-token'))).toBe(
      true,
    )
  })

  it('requires a scoped Notion parent for writes and uses the pinned API version', async () => {
    const requests: Array<{ url: string; init: RequestInit | undefined }> = []
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = String(input)
      requests.push({ url, init })
      if (url.endsWith('/users/me')) return jsonResponse({ id: 'bot-1', name: 'Spark QA' })
      if (url.endsWith('/search'))
        return jsonResponse({
          results: [
            { id: 'page-1', object: 'page' },
            { id: 'page-outside', object: 'page' },
          ],
        })
      return jsonResponse({ object: 'page', id: 'page-2' })
    }
    const adapter = new NotionRuntimeAdapter()
    const connect = await adapter.connect(
      {
        descriptor: adapter.descriptor,
        http: new RuntimeHttpClient({ fetchImpl }),
        getSecret: (name) => (name === 'token' ? 'notion-token' : null),
      },
      { authMethod: 'api-key', resourceScope: { pages: ['page-1'] } },
    )
    const ctx = context(adapter, connect, fetchImpl, {
      enabledCapabilities: ['notion_read', 'notion_write'],
      resourceScope: { pages: ['page-1'] },
    })

    await expect(adapter.invokeTool(ctx, 'search', { query: 'roadmap' })).resolves.toEqual({
      results: [{ id: 'page-1', object: 'page' }],
    })

    await expect(
      adapter.invokeTool(ctx, 'create_page', {
        parent: { page_id: 'page-outside' },
        properties: {},
      }),
    ).rejects.toMatchObject({ code: 'RESOURCE_OUT_OF_SCOPE' })
    await expect(
      adapter.invokeTool(ctx, 'create_page', {
        parent: { page_id: 'page-1' },
        properties: {},
      }),
    ).resolves.toMatchObject({ id: 'page-2' })
    expect(
      requests.some(
        ({ init }) => new Headers(init?.headers).get('Notion-Version') === '2026-03-11',
      ),
    ).toBe(true)
    expect(requests.every(({ url }) => !url.includes('notion-token'))).toBe(true)
  })

  it('reads and writes an Obsidian vault with conflict and symlink protection', async () => {
    const vault = await mkdtemp(join(tmpdir(), 'spark-runtime-vault-'))
    const outside = await mkdtemp(join(tmpdir(), 'spark-runtime-outside-'))
    temporaryRoots.push(vault, outside)
    await writeFile(join(vault, 'daily.md'), '# Today\nhello', 'utf8')
    await writeFile(join(vault, 'index.md'), 'See [[daily]]', 'utf8')
    await writeFile(join(outside, 'secret.md'), 'outside', 'utf8')
    await symlink(join(outside, 'secret.md'), join(vault, 'linked.md'))

    const adapter = new ObsidianRuntimeAdapter()
    const connect = await adapter.connect(
      {
        descriptor: adapter.descriptor,
        http: new RuntimeHttpClient(),
        getSecret: () => null,
      },
      { authMethod: 'none', config: { vaultPath: vault } },
    )
    const ctx = context(adapter, connect, undefined, {
      enabledCapabilities: ['vault_read', 'vault_write'],
      config: { vaultPath: vault },
    })

    await expect(adapter.invokeTool(ctx, 'get_note', { path: 'daily.md' })).resolves.toMatchObject({
      content: '# Today\nhello',
    })
    await expect(adapter.invokeTool(ctx, 'get_backlinks', { path: 'daily.md' })).resolves.toEqual([
      { path: 'index.md', matches: ['See [[daily]]'] },
    ])
    const current = (await adapter.invokeTool(ctx, 'get_note', { path: 'daily.md' })) as {
      sha256: string
    }
    await expect(
      adapter.invokeTool(ctx, 'update_note', {
        path: 'daily.md',
        content: 'changed',
        expectedHash: 'stale',
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT' })
    await expect(
      adapter.invokeTool(ctx, 'update_note', {
        path: 'daily.md',
        content: 'changed',
        expectedHash: current.sha256,
      }),
    ).resolves.toMatchObject({ path: 'daily.md' })
    await expect(adapter.invokeTool(ctx, 'get_note', { path: 'linked.md' })).rejects.toMatchObject({
      code: 'RESOURCE_OUT_OF_SCOPE',
    })
    await expect(
      adapter.invokeTool(ctx, 'get_note', { path: '../secret.md' }),
    ).rejects.toMatchObject({
      code: 'RESOURCE_OUT_OF_SCOPE',
    })
    await expect(readFile(join(vault, 'daily.md'), 'utf8')).resolves.toBe('changed')
  })
})

function jsonFetch(factory: (url: string) => unknown): typeof fetch {
  return async (input) => jsonResponse(factory(String(input)))
}

function jsonResponse(
  value: unknown,
  status = 200,
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  })
}

function context(
  adapter: { descriptor: RuntimeContext['descriptor'] },
  result: {
    externalAccountId: string
    displayName: string
    config?: Record<string, unknown>
    resourceScope?: Record<string, unknown>
    grantedScopes?: string[]
  },
  fetchImpl: typeof fetch | undefined,
  overrides: Partial<RuntimeContext['account']> = {},
): RuntimeContext {
  const account = {
    id: 'account-1',
    pluginId: adapter.descriptor.pluginId,
    runtimeId: adapter.descriptor.id,
    provider: adapter.descriptor.provider,
    externalAccountId: result.externalAccountId,
    displayName: result.displayName,
    authMethod: 'oauth2' as const,
    status: 'connected' as const,
    enabled: true,
    grantedScopes: result.grantedScopes ?? [],
    enabledCapabilities: [],
    resourceScope: result.resourceScope ?? {},
    config: result.config ?? {},
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  }
  return {
    descriptor: adapter.descriptor,
    account,
    row: {} as RuntimeContext['row'],
    http: new RuntimeHttpClient({
      ...(fetchImpl ? { fetchImpl } : {}),
      ...(fetchImpl ? { accessToken: async () => 'runtime-token' } : {}),
    }),
    credentials: new RuntimeTokenService(),
    policy: new RuntimePolicy(),
  }
}

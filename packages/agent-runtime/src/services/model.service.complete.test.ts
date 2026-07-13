/**
 * @module model.service.complete.test
 *
 * 单测：ModelService.complete() — 记忆抽取/演化决策用的 OpenAI 兼容补全。
 * 覆盖降级链（不抛异常）+ 成功解析 + agent 对话模型回退（OpenAI / anthropic）。
 */

import { describe, it, expect, afterEach, vi } from 'vitest'
import { ModelService } from './model.service.js'
import type { ProviderProfileRepository, ModelProfileRepository, ProviderProfileRow } from '@spark/storage'

vi.mock('@spark/shared/keystore', () => ({
  getSecret: vi.fn(async () => 'test-key'),
}))

/** 构造一个配好 extraction provider 的 ModelService（settings 可覆盖） */
function makeService(
  settings: Record<string, unknown> = {},
  fetchMock: ReturnType<typeof vi.fn> = vi.fn(),
  opts: { providers?: Record<string, Partial<ProviderProfileRow>>; getActiveChatModel?: () => { providerId: string; model: string } | null } = {},
): { svc: ModelService; fetchMock: ReturnType<typeof vi.fn> } {
  const providers = opts.providers ?? {
    'prov-1': { id: 'prov-1', keystore_ref: 'ks-1', provider_type: 'openai-compatible', config_json: JSON.stringify({ apiEndpoint: 'https://ex.example.com/v1' }) },
  }
  const providerRepo = {
    get: (id: string) => (providers[id] ?? null) as ProviderProfileRow | null,
  } as unknown as ProviderProfileRepository
  const repo = { ensureSchema: () => {} } as unknown as ModelProfileRepository
  const defaults: Record<string, unknown> = {
    extractionProviderId: 'prov-1',
    extractionModel: 'small-llm',
    ...settings,
  }
  const svc = new ModelService(
    repo,
    providerRepo,
    (cat, key) => (cat === 'memory' ? defaults[key] ?? null : null),
    opts.getActiveChatModel,
  )
  return { svc, fetchMock }
}

describe('ModelService.complete', () => {
  const realFetch = globalThis.fetch

  afterEach(() => {
    globalThis.fetch = realFetch
    vi.restoreAllMocks()
  })

  it('returns text on success (OpenAI choices parsing)', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            choices: [{ message: { content: '["candidate"]' } }],
          }),
          { status: 200 },
        ),
    )
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch
    const { svc } = makeService()
    const r = await svc.complete('extract memories from this turn')
    expect(r.available).toBe(true)
    if (r.available) expect(r.text).toBe('["candidate"]')
    // 端点推导 + body 形状
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://ex.example.com/v1/chat/completions')
    const body = JSON.parse((init as RequestInit).body as string)
    expect(body.model).toBe('small-llm')
    expect(body.messages[0]).toEqual({ role: 'user', content: 'extract memories from this turn' })
    expect(body.temperature).toBe(0)
  })

  it('unavailable when settings explicitly empty (treats empty as disabled, no fallback)', async () => {
    const fetchMock = vi.fn()
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch
    // 即便 resolver 给值，settings 给的是字符串空值，按"显式禁用"语义不回退
    const { svc } = makeService(
      { extractionProviderId: '', extractionModel: '' },
      fetchMock,
      { getActiveChatModel: () => ({ providerId: 'prov-1', model: 'should-not-be-used' }) },
    )
    const r = await svc.complete('prompt')
    expect(r.available).toBe(false)
    if (!r.available) expect(r.reason).toMatch(/no extraction model configured/)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('unavailable when provider not found', async () => {
    const fetchMock = vi.fn()
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch
    const { svc } = makeService({ extractionProviderId: 'nope', extractionModel: 'm' })
    const r = await svc.complete('prompt')
    expect(r.available).toBe(false)
    if (!r.available) expect(r.reason).toMatch(/provider not found/)
  })

  it('unavailable on HTTP error (never throws)', async () => {
    globalThis.fetch = vi.fn(
      async () => new Response('rate limited', { status: 429 }),
    ) as unknown as typeof globalThis.fetch
    const { svc } = makeService()
    const r = await svc.complete('prompt')
    expect(r.available).toBe(false)
    if (!r.available) expect(r.reason).toMatch(/HTTP 429/)
  })

  it('unavailable on network error (caught, never throws)', async () => {
    globalThis.fetch = vi.fn(async () => { throw new Error('connection refused') }) as unknown as typeof globalThis.fetch
    const { svc } = makeService()
    const r = await svc.complete('prompt')
    expect(r.available).toBe(false)
    if (!r.available) expect(r.reason).toMatch(/connection refused/)
  })

  it('unavailable on malformed response (empty content)', async () => {
    globalThis.fetch = vi.fn(
      async () => new Response(JSON.stringify({ choices: [{ message: { content: '' } }] }), { status: 200 }),
    ) as unknown as typeof globalThis.fetch
    const { svc } = makeService()
    const r = await svc.complete('prompt')
    expect(r.available).toBe(false)
    if (!r.available) expect(r.reason).toMatch(/malformed/)
  })

  it('unavailable when dependencies not wired (no providerRepo)', async () => {
    const fetchMock = vi.fn()
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch
    const repo = { ensureSchema: () => {} } as unknown as ModelProfileRepository
    const svc = new ModelService(repo) // no providerRepo / settingsGet
    const r = await svc.complete('prompt')
    expect(r.available).toBe(false)
    if (!r.available) expect(r.reason).toMatch(/not wired/)
  })
})

describe('ModelService.complete — agent chat model fallback', () => {
  const realFetch = globalThis.fetch

  afterEach(() => {
    globalThis.fetch = realFetch
    vi.restoreAllMocks()
  })

  it('falls back to OpenAI-compatible chat model when settings absent', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({ choices: [{ message: { content: '["from-fallback"]' } }] }),
          { status: 200 },
        ),
    )
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch
    const { svc } = makeService(
      { extractionProviderId: undefined, extractionModel: undefined },
      fetchMock,
      {
        providers: {
          'chat-prov': {
            id: 'chat-prov',
            keystore_ref: null,
            provider_type: 'openai-compatible',
            config_json: JSON.stringify({ apiEndpoint: 'https://chat.example.com/v1' }),
          },
        },
        getActiveChatModel: () => ({ providerId: 'chat-prov', model: 'gpt-4o-mini' }),
      },
    )
    const r = await svc.complete('extract')
    expect(r.available).toBe(true)
    if (r.available) expect(r.text).toBe('["from-fallback"]')
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://chat.example.com/v1/chat/completions')
    const body = JSON.parse((init as RequestInit).body as string)
    expect(body.model).toBe('gpt-4o-mini')
    expect(body.messages[0].content).toBe('extract')
    // OpenAI 分支：空 apiKey 时省略 Authorization（与 anthropic 分支一致）
    const headers = (init as RequestInit).headers as Record<string, string>
    expect(headers.Authorization).toBeUndefined()
    expect(headers['x-api-key']).toBeUndefined()
    expect(headers['anthropic-version']).toBeUndefined()
  })

  it('falls back to anthropic chat model when settings absent (uses /v1/messages + x-api-key)', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            content: [{ type: 'text', text: '["from-claude"]' }],
          }),
          { status: 200 },
        ),
    )
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch
    const { svc } = makeService(
      { extractionProviderId: undefined, extractionModel: undefined },
      fetchMock,
      {
        providers: {
          'claude-prov': {
            id: 'claude-prov',
            keystore_ref: null,
            provider_type: 'anthropic',
            config_json: JSON.stringify({ apiEndpoint: 'https://api.anthropic.com' }),
          },
        },
        getActiveChatModel: () => ({ providerId: 'claude-prov', model: 'claude-3-5-haiku-20241022' }),
      },
    )
    const r = await svc.complete('extract')
    expect(r.available).toBe(true)
    if (r.available) expect(r.text).toBe('["from-claude"]')
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://api.anthropic.com/v1/messages')
    const headers = (init as RequestInit).headers as Record<string, string>
    expect(headers['anthropic-version']).toBe('2023-06-01')
    // 空 apiKey 时省略 x-api-key（不主动发出）
    expect(headers['x-api-key']).toBeUndefined()
    expect(headers.Authorization).toBeUndefined()
    const body = JSON.parse((init as RequestInit).body as string)
    expect(body.model).toBe('claude-3-5-haiku-20241022')
    expect(body.max_tokens).toBe(1024)
    expect(body.messages).toEqual([{ role: 'user', content: 'extract' }])
  })

  it('unavailable when settings absent AND resolver returns null', async () => {
    const fetchMock = vi.fn()
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch
    const { svc } = makeService(
      { extractionProviderId: undefined, extractionModel: undefined },
      fetchMock,
      { getActiveChatModel: () => null },
    )
    const r = await svc.complete('prompt')
    expect(r.available).toBe(false)
    if (!r.available) expect(r.reason).toMatch(/no extraction model configured/)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

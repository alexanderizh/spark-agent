/**
 * @module model.service.complete.test
 *
 * 单测：ModelService.complete() — 记忆抽取/演化决策用的 OpenAI 兼容补全。
 * 覆盖降级链（不抛异常）+ 成功解析。
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { ModelService } from './model.service.js'
import type { ProviderProfileRepository, ModelProfileRepository } from '@spark/storage'

/** 构造一个配好 extraction provider 的 ModelService（settings 可覆盖） */
function makeService(
  settings: Record<string, unknown> = {},
  fetchMock: ReturnType<typeof vi.fn> = vi.fn(),
): { svc: ModelService; fetchMock: ReturnType<typeof vi.fn> } {
  const providerRepo = {
    get: (id: string) =>
      id === 'prov-1'
        ? { id: 'prov-1', keystore_ref: 'ks-1', config_json: JSON.stringify({ apiEndpoint: 'https://ex.example.com/v1' }) }
        : null,
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

  it('unavailable when no extraction model configured', async () => {
    const fetchMock = vi.fn()
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch
    const { svc } = makeService({ extractionProviderId: '', extractionModel: '' })
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

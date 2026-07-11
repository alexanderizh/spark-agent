import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  NewApiAuthenticationError,
  NewApiClient,
  NewApiSessionConflictError,
} from './NewApiClient.js'

describe('NewApiClient', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('logs in with the session cookie and generates a management token', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { 'set-cookie': 'session=abc123; Path=/; HttpOnly' },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ success: true, data: 'management-token' })))
    vi.stubGlobal('fetch', fetchMock)

    const client = new NewApiClient('https://newapi.example', 42, null)
    await expect(client.loginAndGenerateAccessToken('sp_42', 'secret-password')).resolves.toBe('management-token')
    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({
      headers: expect.objectContaining({ Cookie: 'session=abc123', 'New-Api-User': '42' }),
    })
  })

  it('treats HTTP 200 token-invalid as a multi-device session conflict', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ success: false, message: 'access token is invalid' }), { status: 200 }),
    ))
    const client = new NewApiClient('https://newapi.example', 42, 'old-token')
    await expect(client.validateSession()).rejects.toBeInstanceOf(NewApiSessionConflictError)
  })

  it('classifies rejected username/password login separately from network errors', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ success: false, message: '用户名或密码错误' }), { status: 200 }),
    ))
    const client = new NewApiClient('https://newapi.example', 42, null)
    await expect(client.loginAndGenerateAccessToken('sp_42', 'old-password'))
      .rejects.toBeInstanceOf(NewApiAuthenticationError)
  })

  it('reuses an existing named API token and fetches its full key', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        success: true,
        data: [{ id: 7, name: 'Spark平台令牌', key: 'sk-***', status: 1 }],
      })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ success: true, data: { key: 'sk-full-key' } })))
    vi.stubGlobal('fetch', fetchMock)
    const client = new NewApiClient('https://newapi.example', 42, 'management-token')
    await expect(client.ensureApiKey()).resolves.toBe('sk-full-key')
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain('/api/token/7/key')
  })

  it('keeps a valid inference key without touching the management token', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const client = new NewApiClient('https://newapi.example', 42, 'management-token')
    await expect(client.recoverApiKey('sk-valid')).resolves.toBe('sk-valid')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      headers: expect.objectContaining({ Authorization: 'Bearer sk-valid' }),
    })
  })

  it('does not rotate a key on quota, rate-limit, or server errors', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 429 })))
    const client = new NewApiClient('https://newapi.example', 42, 'management-token')
    await expect(client.recoverApiKey('sk-current')).rejects.toThrow('凭据检查失败 (429)')
  })

  it('recovers an explicitly invalid inference key from the existing token', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response('{}', { status: 401 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        success: true,
        data: [{ id: 7, name: 'Spark平台令牌', status: 1 }],
      })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ success: true, data: { key: 'sk-recovered' } })))
      .mockResolvedValueOnce(new Response('{}', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const client = new NewApiClient('https://newapi.example', 42, 'management-token')
    await expect(client.recoverApiKey('sk-invalid')).resolves.toBe('sk-recovered')
    expect(fetchMock).toHaveBeenCalledTimes(4)
  })

  it('normalizes the production NewAPI subscription wrapper and timestamp fields', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      success: true,
      data: {
        subscriptions: [{
          subscription: {
            id: 6,
            plan_id: 3,
            status: 'active',
            start_time: 1_700_000_000,
            end_time: 1_800_000_000,
            amount_total: 1000,
            amount_used: 250,
            next_reset_time: 1_710_000_000,
          },
        }],
      },
    }))))
    const client = new NewApiClient('https://newapi.example', 42, 'management-token')
    await expect(client.getSubscription()).resolves.toMatchObject({
      id: 6,
      planId: 3,
      startsAt: 1_700_000_000,
      expiresAt: 1_800_000_000,
      amountUsed: 250,
    })
  })

  it('converts quota points with the NewAPI public display settings', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
      const url = String(input)
      if (url.endsWith('/api/status')) {
        return envelope({
          quota_per_unit: 500_000,
          quota_display_type: 'CNY',
          usd_exchange_rate: 7.3,
        })
      }
      if (url.endsWith('/api/user/self')) {
        return envelope({ quota: 1_369_863, used_quota: 500_000 })
      }
      if (url.includes('/api/log/self')) {
        return envelope({ items: [{ id: 1, quota: 250_000 }] })
      }
      throw new Error(`unexpected mock request: ${url}`)
    }))

    const client = new NewApiClient('https://newapi.example', 42, 'management-token')
    await expect(client.getUsage()).resolves.toMatchObject({
      walletQuota: 19.9999998,
      cumulativeUsedQuota: 7.3,
      currencySymbol: '¥',
      logs: [{ quota: 3.65 }],
    })
  })

  it('returns an external EPay POST form without leaking signed fields into a URL', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response(JSON.stringify({
        success: true,
        url: 'https://pay.example/submit',
        data: { pid: 'merchant-1', money: 9.9, sign: 'signed' },
      })),
    ))
    const client = new NewApiClient('https://newapi.example', 42, 'management-token')
    const result = await client.createPayment(3, 'alipay')
    expect(result.url).toBeNull()
    expect(result.postForm).toEqual({
      action: 'https://pay.example/submit',
      fields: { pid: 'merchant-1', money: '9.9', sign: 'signed' },
    })
  })

  it('completes the NewAPI account, model, subscription, payment, redeem, and usage workflow', async () => {
    const requests: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input)
      requests.push(`${init?.method ?? 'GET'} ${new URL(url).pathname}`)
      if (url.endsWith('/api/user/login')) {
        return new Response(JSON.stringify({ success: true }), {
          headers: { 'set-cookie': 'session=e2e-session; Path=/; HttpOnly' },
        })
      }
      if (url.endsWith('/api/user/token')) return envelope('management-token')
      if (url.endsWith('/api/user/models')) return envelope(['glm-5', 'deepseek-v4'])
      if (url.endsWith('/api/token/')) {
        return init?.method === 'POST'
          ? envelope(null)
          : envelope([{ id: 7, name: 'Spark平台令牌', status: 1 }])
      }
      if (url.endsWith('/api/token/7/key')) return envelope({ key: 'sk-model-token' })
      if (url.endsWith('/api/subscription/plans')) {
        return envelope([{ id: 3, title: '基础套餐', price_amount: 990, total_amount: 100000 }])
      }
      if (url.endsWith('/api/subscription/self')) {
        return envelope({ subscriptions: [{
          id: 8,
          plan_id: 3,
          plan_title: '基础套餐',
          status: 'active',
          amount_total: 100000,
          amount_used: 1200,
        }] })
      }
      if (url.endsWith('/api/subscription/epay/pay')) {
        return new Response(JSON.stringify({
          success: true,
          url: 'https://pay.example/submit',
          data: { pid: 'merchant-1', money: 9.9, sign: 'signed' },
        }))
      }
      if (url.endsWith('/api/user/topup')) return envelope({ quota: 5000 })
      if (url.includes('/api/log/self')) {
        return envelope({ items: [{ id: 1, model: 'glm-5', prompt_tokens: 10, completion_tokens: 20, quota: 30 }] })
      }
      if (url.endsWith('/api/user/self')) return envelope({ quota: 5000, used_quota: 1200 })
      throw new Error(`unexpected mock request: ${url}`)
    }))

    const client = new NewApiClient('https://newapi.example', 42, null)
    await client.loginAndGenerateAccessToken('sp_42', 'secret-password')
    await expect(client.getModels()).resolves.toEqual(['glm-5', 'deepseek-v4'])
    await expect(client.ensureApiKey()).resolves.toBe('sk-model-token')
    await expect(client.getPlans()).resolves.toMatchObject([{ id: 3, title: '基础套餐' }])
    await expect(client.getSubscription()).resolves.toMatchObject({ planId: 3, status: 'active' })
    await expect(client.createPayment(3, 'alipay')).resolves.toMatchObject({ mode: 'browser' })
    await expect(client.redeemQuota('QUOTA-CODE')).resolves.toBe(5000)
    await expect(client.getUsage()).resolves.toMatchObject({
      walletQuota: 0.01,
      cumulativeUsedQuota: 0.0024,
      currencySymbol: '$',
    })
    expect(requests).toEqual(expect.arrayContaining([
      'POST /api/user/login',
      'GET /api/user/token',
      'GET /api/user/models',
      'GET /api/subscription/plans',
      'POST /api/subscription/epay/pay',
      'POST /api/user/topup',
    ]))
  })
})

function envelope(data: unknown): Response {
  return new Response(JSON.stringify({ success: true, data }))
}

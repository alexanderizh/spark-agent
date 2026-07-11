import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { NewApiClient, NewApiSessionConflictError } from './NewApiClient.js'

type MockToken = {
  id: number
  key: string
  name: string
  status: number
}

type MockState = {
  activeManagementToken: string | null
  managementTokenSequence: number
  quota: number
  subscriptionPlanId: number
  tokens: MockToken[]
}

describe('NewApiClient HTTP integration', () => {
  let server: Server
  let baseUrl: string
  let state: MockState

  beforeEach(async () => {
    state = {
      activeManagementToken: null,
      managementTokenSequence: 0,
      quota: 100,
      subscriptionPlanId: 1,
      tokens: [],
    }
    server = createMockNewApiServer(state)
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', resolve)
    })
    const address = server.address() as AddressInfo
    baseUrl = `http://127.0.0.1:${address.port}`
  })

  afterEach(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close(error => error ? reject(error) : resolve())
    })
  })

  it('covers account, token, subscription, payment, quota, usage, and two-device conflicts', async () => {
    const deviceA = new NewApiClient(baseUrl, 42, null)
    const managementTokenA = await deviceA.loginAndGenerateAccessToken('sp_42', 'server-managed-password')
    expect(managementTokenA).toBe('management-1')
    await expect(deviceA.validateSession()).resolves.toBeUndefined()

    await expect(deviceA.getModels()).resolves.toEqual(['gpt-5.4-mini', 'gpt-5.5'])
    const inferenceKey = await deviceA.ensureApiKey()
    expect(inferenceKey).toBe('sk-inference-1')
    await expect(deviceA.validateApiKey(inferenceKey)).resolves.toBe(true)

    await expect(deviceA.getPlans()).resolves.toEqual([
      expect.objectContaining({
        id: 1,
        title: '入门版',
        priceAmount: 9.9,
        currency: 'CNY',
        allowBalancePay: true,
      }),
      expect.objectContaining({ id: 2, title: '专业版', priceAmount: 29.9 }),
    ])
    await expect(deviceA.getSubscription()).resolves.toEqual(expect.objectContaining({
      planId: 1,
      planTitle: '',
      status: 'active',
      amountTotal: 1_000,
      amountUsed: 125,
    }))

    const epay = await deviceA.createPayment(2, 'alipay')
    expect(epay).toEqual(expect.objectContaining({ mode: 'browser', paid: false }))
    expect(epay.url).toBeNull()
    expect(epay.postForm).toEqual({
      action: 'https://pay.example/epay',
      fields: expect.objectContaining({ pid: 'merchant-42', type: 'alipay' }),
    })
    const wechatPay = await deviceA.createPayment(2, 'wxpay')
    expect(wechatPay.postForm).toEqual({
      action: 'https://pay.example/epay',
      fields: expect.objectContaining({ pid: 'merchant-42', type: 'wxpay' }),
    })

    await expect(deviceA.redeemQuota('QUOTA-50')).resolves.toBe(50)
    await expect(deviceA.getUsage()).resolves.toEqual({
      walletQuota: 150,
      cumulativeUsedQuota: 25,
      currencySymbol: '',
      logs: [
        {
          id: 9001,
          createdAt: 1_720_000_000,
          model: 'gpt-5.4-mini',
          promptTokens: 12,
          completionTokens: 34,
          quota: 7,
        },
      ],
    })

    const deviceB = new NewApiClient(baseUrl, 42, null)
    const managementTokenB = await deviceB.loginAndGenerateAccessToken('sp_42', 'server-managed-password')
    expect(managementTokenB).toBe('management-2')
    expect(managementTokenB).not.toBe(managementTokenA)

    await expect(deviceA.validateSession()).rejects.toBeInstanceOf(NewApiSessionConflictError)
    await expect(deviceA.ensureApiKey()).rejects.toBeInstanceOf(NewApiSessionConflictError)
    await expect(deviceB.validateSession()).resolves.toBeUndefined()

    // NewAPI 的 dashboard access token 是单活的，但模型推理 token 是独立凭据。
    await expect(deviceA.validateApiKey(inferenceKey)).resolves.toBe(true)
    await expect(deviceA.recoverApiKey(inferenceKey)).resolves.toBe(inferenceKey)
    const inferenceResponse = await fetch(`${baseUrl}/v1/models`, {
      headers: { Authorization: `Bearer ${inferenceKey}` },
    })
    expect(inferenceResponse.status).toBe(200)
    await expect(inferenceResponse.json()).resolves.toEqual({
      object: 'list',
      data: [{ id: 'gpt-5.4-mini' }, { id: 'gpt-5.5' }],
    })

    // 新设备能恢复同一枚长期推理 key；无需轮换，也不会受 dashboard 冲突影响。
    await expect(deviceB.ensureApiKey()).resolves.toBe(inferenceKey)
    expect(state.tokens).toHaveLength(1)
  })
})

function createMockNewApiServer(state: MockState): Server {
  return createServer(async (request, response) => {
    try {
      await handleMockNewApiRequest(request, response, state)
    } catch (error) {
      sendJson(response, 500, {
        success: false,
        message: error instanceof Error ? error.message : String(error),
      })
    }
  })
}

async function handleMockNewApiRequest(
  request: IncomingMessage,
  response: ServerResponse,
  state: MockState,
): Promise<void> {
  const url = new URL(request.url ?? '/', 'http://mock-newapi.local')

  if (request.method === 'GET' && url.pathname === '/api/status') {
    sendJson(response, 200, {
      success: true,
      data: { quota_per_unit: 500_000, quota_display_type: 'TOKENS' },
    })
    return
  }

  if (request.method === 'POST' && url.pathname === '/api/user/login') {
    const body = await readJsonBody(request)
    if (body.username !== 'sp_42' || body.password !== 'server-managed-password') {
      sendJson(response, 401, { success: false, message: 'invalid credentials' })
      return
    }
    response.setHeader('Set-Cookie', 'session=session-42; Path=/; HttpOnly; SameSite=Lax')
    sendJson(response, 200, { success: true })
    return
  }

  if (request.method === 'GET' && url.pathname === '/api/user/token') {
    if (!String(request.headers.cookie ?? '').includes('session=session-42') || request.headers['new-api-user'] !== '42') {
      sendJson(response, 401, { success: false, message: 'invalid session' })
      return
    }
    state.managementTokenSequence += 1
    state.activeManagementToken = `management-${state.managementTokenSequence}`
    sendJson(response, 200, { success: true, data: state.activeManagementToken })
    return
  }

  if (url.pathname === '/v1/models') {
    const inferenceKey = bearerToken(request)
    if (!state.tokens.some(token => token.key === inferenceKey && token.status !== 2)) {
      sendJson(response, 401, { error: { message: 'invalid api key' } })
      return
    }
    sendJson(response, 200, {
      object: 'list',
      data: [{ id: 'gpt-5.4-mini' }, { id: 'gpt-5.5' }],
    })
    return
  }

  if (request.headers['new-api-user'] !== '42' || bearerToken(request) !== state.activeManagementToken) {
    // 真实 NewAPI 会出现 HTTP 200 + success:false 的 token 失效响应。
    sendJson(response, 200, { success: false, message: 'access token is invalid' })
    return
  }

  if (request.method === 'GET' && url.pathname === '/api/user/self') {
    sendJson(response, 200, { success: true, data: { id: 42, quota: state.quota, used_quota: 25 } })
    return
  }
  if (request.method === 'GET' && url.pathname === '/api/user/models') {
    sendJson(response, 200, {
      success: true,
      data: { models: ['gpt-5.4-mini', { id: 'gpt-5.5' }, 'gpt-5.4-mini'] },
    })
    return
  }
  if (request.method === 'GET' && url.pathname === '/api/subscription/plans') {
    sendJson(response, 200, {
      success: true,
      data: [
        {
          id: 1,
          title: '入门版',
          subtitle: '适合轻量使用',
          price_amount: 9.9,
          currency: 'CNY',
          duration_value: 1,
          duration_unit: 'month',
          total_amount: 1_000,
          allow_balance_pay: true,
        },
        {
          plan: {
            id: 2,
            title: '专业版',
            price_amount: 29.9,
            currency: 'CNY',
            duration_value: 1,
            duration_unit: 'month',
            total_amount: 10_000,
          },
        },
      ],
    })
    return
  }
  if (request.method === 'GET' && url.pathname === '/api/subscription/self') {
    const professional = state.subscriptionPlanId === 2
    sendJson(response, 200, {
      success: true,
      data: {
        subscriptions: [{
          subscription: {
            id: 88,
            plan_id: state.subscriptionPlanId,
            status: 'active',
            start_time: 1_720_000_000,
            end_time: 1_722_678_400,
            amount_total: professional ? 10_000 : 1_000,
            amount_used: 125,
            next_reset_time: 1_720_086_400,
          },
        }],
      },
    })
    return
  }
  if (request.method === 'GET' && url.pathname === '/api/log/self') {
    sendJson(response, 200, {
      success: true,
      data: {
        items: [{
          id: 9001,
          created_at: 1_720_000_000,
          model: 'gpt-5.4-mini',
          prompt_tokens: 12,
          completion_tokens: 34,
          quota: 7,
        }],
      },
    })
    return
  }
  if (request.method === 'GET' && url.pathname === '/api/token/') {
    sendJson(response, 200, {
      success: true,
      data: state.tokens.map(({ id, name, status }) => ({ id, name, status, key: 'sk-***' })),
    })
    return
  }
  if (request.method === 'POST' && url.pathname === '/api/token/') {
    const body = await readJsonBody(request)
    const id = state.tokens.length + 1
    state.tokens.push({ id, key: `sk-inference-${id}`, name: String(body.name), status: 1 })
    sendJson(response, 200, { success: true, data: { id } })
    return
  }
  const tokenKeyMatch = url.pathname.match(/^\/api\/token\/(\d+)\/key$/)
  if (request.method === 'POST' && tokenKeyMatch) {
    const token = state.tokens.find(item => item.id === Number(tokenKeyMatch[1]))
    if (!token) {
      sendJson(response, 404, { success: false, message: 'token not found' })
      return
    }
    sendJson(response, 200, { success: true, data: { key: token.key } })
    return
  }
  if (request.method === 'POST' && url.pathname === '/api/subscription/epay/pay') {
    const body = await readJsonBody(request)
    sendJson(response, 200, {
      success: true,
      url: 'https://pay.example/epay',
      data: {
        pid: 'merchant-42',
        type: String(body.payment_method),
        money: 29.9,
        sign: 'signed-request',
      },
    })
    return
  }
  if (request.method === 'POST' && url.pathname === '/api/user/topup') {
    const body = await readJsonBody(request)
    if (body.key !== 'QUOTA-50') {
      sendJson(response, 200, { success: false, message: '兑换码无效' })
      return
    }
    state.quota += 50
    sendJson(response, 200, { success: true, data: { quota: 50 } })
    return
  }

  sendJson(response, 404, { success: false, message: `${request.method} ${url.pathname} not mocked` })
}

function bearerToken(request: IncomingMessage): string | null {
  const match = String(request.headers.authorization ?? '').match(/^Bearer\s+(.+)$/i)
  return match?.[1] ?? null
}

async function readJsonBody(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []
  for await (const chunk of request) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  if (chunks.length === 0) return {}
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>
}

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { 'Content-Type': 'application/json' })
  response.end(JSON.stringify(body))
}

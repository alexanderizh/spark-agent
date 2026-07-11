import type { PlatformModelPlan, PlatformModelSubscription, PlatformModelUsage } from '@spark/protocol'

type Envelope<T> = { success?: boolean; code?: number; message?: string; data?: T; url?: string }
type TokenSummary = { id: number; name: string; key?: string; status?: number }

export class NewApiSessionConflictError extends Error {
  constructor(message = '平台账户已在其他设备使用') {
    super(message)
    this.name = 'NewApiSessionConflictError'
  }
}

export class NewApiAuthenticationError extends Error {
  constructor(message = '平台模型账户凭据失效') {
    super(message)
    this.name = 'NewApiAuthenticationError'
  }
}

export class NewApiClient {
  constructor(
    private readonly baseUrl: string,
    private readonly userId: number,
    private accessToken: string | null,
  ) {}

  setAccessToken(token: string): void {
    this.accessToken = token
  }

  async loginAndGenerateAccessToken(username: string, password: string): Promise<string> {
    const loginResponse = await fetch(`${this.baseUrl}/api/user/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ username, password }),
    })
    const loginJson = await parseEnvelope<unknown>(loginResponse)
    if (!loginResponse.ok || loginJson.success === false || (loginJson.code != null && loginJson.code !== 0)) {
      throw new NewApiAuthenticationError(loginJson.message || `平台模型登录失败 (${loginResponse.status})`)
    }
    assertSuccess(loginResponse, loginJson, '登录平台模型账户失败')
    const cookie = extractSessionCookie(loginResponse.headers.get('set-cookie') || '')
    if (!cookie) throw new Error('平台模型登录未返回 session cookie')

    const tokenResponse = await fetch(`${this.baseUrl}/api/user/token`, {
      headers: { Cookie: cookie, 'New-Api-User': String(this.userId), Accept: 'application/json' },
    })
    const tokenJson = await parseEnvelope<string>(tokenResponse)
    assertSuccess(tokenResponse, tokenJson, '换取平台管理凭据失败')
    if (typeof tokenJson.data !== 'string' || !tokenJson.data) throw new Error('平台管理凭据格式无效')
    this.accessToken = tokenJson.data
    return tokenJson.data
  }

  async validateSession(): Promise<void> {
    await this.dashboardGet('/api/user/self')
  }

  async validateApiKey(apiKey: string): Promise<boolean> {
    if (!apiKey.trim()) return false
    const response = await fetch(`${this.baseUrl}/v1/models`, {
      headers: { Accept: 'application/json', Authorization: `Bearer ${apiKey.trim()}` },
    })
    if (response.ok) return true
    if (response.status === 401 || response.status === 403) return false
    throw new Error(`平台模型凭据检查失败 (${response.status})`)
  }

  async getPlans(): Promise<PlatformModelPlan[]> {
    const value = await this.dashboardGet<unknown>('/api/subscription/plans')
    const rows = Array.isArray(value) ? value : []
    return rows.map(item => normalizePlan(item)).filter((item): item is PlatformModelPlan => item != null)
  }

  async getSubscription(): Promise<PlatformModelSubscription | null> {
    const value = await this.dashboardGet<Record<string, unknown>>('/api/subscription/self')
    const rows = Array.isArray(value?.subscriptions) ? value.subscriptions : []
    const active = rows.find(item => {
      const raw = isRecord(item) && isRecord(item.subscription) ? item.subscription : item
      return isRecord(raw) && String(raw.status).toLowerCase() === 'active'
    }) ?? rows[0]
    return active ? normalizeSubscription(active) : null
  }

  async getModels(): Promise<string[]> {
    const value = await this.dashboardGet<unknown>('/api/user/models')
    const rows = Array.isArray(value) ? value : isRecord(value) && Array.isArray(value.models) ? value.models : []
    return [...new Set(rows.map(item => typeof item === 'string' ? item : isRecord(item) ? String(item.id ?? item.model ?? '') : '').filter(Boolean))]
  }

  async getUsage(): Promise<PlatformModelUsage> {
    const [self, logsValue, display] = await Promise.all([
      this.dashboardGet<Record<string, unknown>>('/api/user/self'),
      this.dashboardGet<unknown>('/api/log/self?p=1&page_size=10'),
      this.getQuotaDisplaySettings(),
    ])
    const rows = Array.isArray(logsValue)
      ? logsValue
      : isRecord(logsValue) && Array.isArray(logsValue.items)
        ? logsValue.items
        : isRecord(logsValue) && Array.isArray(logsValue.logs)
          ? logsValue.logs
          : []
    const convertQuota = (quota: unknown): number => Number(quota ?? 0) / display.quotaPerUnit * display.rate
    return {
      walletQuota: convertQuota(self.quota),
      cumulativeUsedQuota: convertQuota(self.used_quota ?? self.usedQuota),
      currencySymbol: display.symbol,
      logs: rows.filter(isRecord).map(item => ({
        id: Number(item.id),
        createdAt: Number(item.created_at ?? item.createdAt ?? 0),
        model: String(item.model_name ?? item.model ?? ''),
        promptTokens: Number(item.prompt_tokens ?? item.promptTokens ?? 0),
        completionTokens: Number(item.completion_tokens ?? item.completionTokens ?? 0),
        quota: convertQuota(item.quota),
      })),
    }
  }

  private async getQuotaDisplaySettings(): Promise<{ quotaPerUnit: number; rate: number; symbol: string }> {
    try {
      const response = await fetch(`${this.baseUrl}/api/status`, { headers: { Accept: 'application/json' } })
      const json = await parseEnvelope<Record<string, unknown>>(response)
      assertSuccess(response, json, '读取平台额度展示设置失败')
      const status = json.data ?? {}
      const quotaPerUnit = positiveNumber(status.quota_per_unit, 500_000)
      const type = String(status.quota_display_type ?? (status.display_in_currency ? 'USD' : 'TOKENS')).toUpperCase()
      if (type === 'TOKENS') return { quotaPerUnit: 1, rate: 1, symbol: '' }
      if (type === 'CNY') {
        return { quotaPerUnit, rate: positiveNumber(status.usd_exchange_rate, 7.3), symbol: '¥' }
      }
      if (type === 'CUSTOM') {
        return {
          quotaPerUnit,
          rate: positiveNumber(status.custom_currency_exchange_rate, 1),
          symbol: String(status.custom_currency_symbol ?? '¤'),
        }
      }
      return { quotaPerUnit, rate: 1, symbol: '$' }
    } catch {
      return { quotaPerUnit: 500_000, rate: 1, symbol: '$' }
    }
  }

  async redeemQuota(code: string): Promise<number> {
    const value = await this.dashboardPost<unknown>('/api/user/topup', { key: code.trim() })
    const quota = Number(isRecord(value) ? value.quota ?? value.data : value)
    return Number.isFinite(quota) ? quota : 0
  }

  async createPayment(planId: number, paymentMethod: 'alipay' | 'wxpay') {
    const value = await this.dashboardPost<unknown>('/api/subscription/epay/pay', {
      plan_id: planId,
      payment_method: paymentMethod,
    })
    if (!isRecord(value) || typeof value.url !== 'string') throw new Error('支付接口未返回跳转地址')
    const formEntries = Object.entries(value).flatMap(([key, item]): Array<[string, string]> => {
      if (key === 'url' || (typeof item !== 'string' && typeof item !== 'number')) return []
      return [[key, String(item)]]
    })
    return {
      mode: 'browser' as const,
      paid: false,
      url: null,
      postForm: { action: value.url, fields: Object.fromEntries(formEntries) },
    }
  }

  async ensureApiKey(tokenName = 'Spark平台令牌'): Promise<string> {
    let tokens = await this.listTokens()
    let token = tokens.find(item => item.name.startsWith(tokenName) && item.status !== 2)
    if (!token) {
      await this.createApiToken(tokenName)
      tokens = await this.listTokens()
      token = tokens.find(item => item.name.startsWith(tokenName) && item.status !== 2)
    }
    if (!token) throw new Error('平台模型令牌创建后无法查询')
    const result = await this.dashboardPost<unknown>(`/api/token/${token.id}/key`)
    const key = isRecord(result) ? result.key : null
    if (typeof key !== 'string' || !key) throw new Error('平台模型令牌恢复失败')
    return key
  }

  async recoverApiKey(currentApiKey: string | null, tokenName = 'Spark平台令牌'): Promise<string> {
    if (currentApiKey && await this.validateApiKey(currentApiKey)) return currentApiKey

    const tokens = (await this.listTokens())
      .filter(item => item.name.startsWith(tokenName) && item.status !== 2)
      .sort((a, b) => b.id - a.id)
    for (const existing of tokens) {
      const result = await this.dashboardPost<unknown>(`/api/token/${existing.id}/key`)
      const key = isRecord(result) ? result.key : null
      if (typeof key === 'string' && key && await this.validateApiKey(key)) return key
    }

    const replacementName = `${tokenName}-恢复-${Date.now()}`
    await this.createApiToken(replacementName)
    const replacement = (await this.listTokens()).find(item => item.name === replacementName)
    if (!replacement) throw new Error('平台模型令牌重建后无法查询')
    const result = await this.dashboardPost<unknown>(`/api/token/${replacement.id}/key`)
    const key = isRecord(result) ? result.key : null
    if (typeof key !== 'string' || !key) throw new Error('平台模型令牌重建失败')
    return key
  }

  private createApiToken(name: string): Promise<unknown> {
    return this.dashboardPost('/api/token/', {
      name,
      expired_time: -1,
      unlimited_quota: true,
      model_limits_enabled: false,
    })
  }

  private async listTokens(): Promise<TokenSummary[]> {
    const value = await this.dashboardGet<unknown>('/api/token/')
    const rows = Array.isArray(value) ? value : isRecord(value) && Array.isArray(value.items) ? value.items : []
    return rows.filter(isRecord).map(item => ({
      id: Number(item.id),
      name: String(item.name ?? ''),
      ...(typeof item.key === 'string' ? { key: item.key } : {}),
      ...(item.status == null ? {} : { status: Number(item.status) }),
    })).filter(item => Number.isInteger(item.id) && item.name.length > 0)
  }

  private dashboardGet<T = unknown>(path: string): Promise<T> {
    return this.dashboardRequest<T>(path, { method: 'GET' })
  }

  private dashboardPost<T = unknown>(path: string, body?: unknown): Promise<T> {
    return this.dashboardRequest<T>(path, {
      method: 'POST',
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
  }

  private async dashboardRequest<T>(path: string, init: RequestInit): Promise<T> {
    if (!this.accessToken) throw new NewApiSessionConflictError('平台管理凭据不存在')
    const response = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.accessToken}`,
        'New-Api-User': String(this.userId),
      },
    })
    const json = await parseEnvelope<T>(response)
    if (isTokenInvalid(response, json)) throw new NewApiSessionConflictError()
    assertSuccess(response, json, '平台模型请求失败')
    if (isRecord(json.data) && typeof json.url === 'string') {
      return { ...json.data, url: json.url } as T
    }
    return (json.data ?? json) as T
  }
}

function extractSessionCookie(setCookie: string): string | null {
  const match = setCookie.match(/(?:^|[,;]\s*)session=([^;,"]+)/i)
  return match ? `session=${match[1]}` : null
}

async function parseEnvelope<T>(response: Response): Promise<Envelope<T>> {
  return (await response.json().catch(() => ({}))) as Envelope<T>
}

function assertSuccess(response: Response, json: Envelope<unknown>, fallback: string): void {
  if (!response.ok || json.success === false || (json.code != null && json.code !== 0)) {
    throw new Error(json.message || `${fallback} (${response.status})`)
  }
}

function isTokenInvalid(response: Response, json: Envelope<unknown>): boolean {
  if (response.status === 401 || response.status === 403) return true
  const message = String(json.message || '').toLowerCase()
  return json.success === false && (message.includes('access token') || message.includes('access_token') || message.includes('invalid token') || message.includes('用户不存在'))
}

function normalizePlan(value: unknown): PlatformModelPlan | null {
  const raw = isRecord(value) && isRecord(value.plan) ? value.plan : value
  if (!isRecord(raw) || !Number.isFinite(Number(raw.id))) return null
  return {
    id: Number(raw.id),
    title: String(raw.title ?? ''),
    subtitle: String(raw.subtitle ?? ''),
    priceAmount: Number(raw.price_amount ?? raw.priceAmount ?? 0),
    currency: String(raw.currency ?? ''),
    durationValue: Number(raw.duration_value ?? raw.durationValue ?? 0),
    durationUnit: String(raw.duration_unit ?? raw.durationUnit ?? ''),
    totalAmount: Number(raw.total_amount ?? raw.totalAmount ?? 0),
    allowBalancePay: Boolean(raw.allow_balance_pay ?? raw.allowBalancePay),
  }
}

function normalizeSubscription(value: unknown): PlatformModelSubscription | null {
  const raw = isRecord(value) && isRecord(value.subscription) ? value.subscription : value
  if (!isRecord(raw) || !Number.isFinite(Number(raw.id))
      || !Number.isFinite(Number(raw.plan_id ?? raw.planId))) return null
  return {
    id: Number(raw.id),
    planId: Number(raw.plan_id ?? raw.planId),
    planTitle: String(raw.plan_title ?? raw.planTitle ?? ''),
    status: String(raw.status ?? ''),
    startsAt: Number(raw.start_time ?? raw.starts_at ?? raw.startsAt ?? 0),
    expiresAt: Number(raw.end_time ?? raw.expires_at ?? raw.expiresAt ?? 0),
    amountTotal: Number(raw.amount_total ?? raw.amountTotal ?? 0),
    amountUsed: Number(raw.amount_used ?? raw.amountUsed ?? 0),
    nextResetTime: Number(raw.next_reset_time ?? raw.nextResetTime ?? 0),
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value)
}

function positiveNumber(value: unknown, fallback: number): number {
  const number = Number(value)
  return Number.isFinite(number) && number > 0 ? number : fallback
}

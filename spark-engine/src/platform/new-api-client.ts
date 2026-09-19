import type { FetchLike } from '../llm/http/client.js'

/**
 * Minimal new-api (platform model gateway) client for the standalone CLI.
 *
 * It mirrors the desktop's `NewApiClient` contract — the same envelope shape,
 * the same login → access-token handshake, and the same session-conflict
 * classification — so one platform account behaves identically in both
 * surfaces. Anything the desktop needs only for its wallet UI (plans,
 * payments, quota displays) is left out.
 */

export const PLATFORM_TOKEN_NAME = 'Spark平台令牌'
/** The platform gateway serves Anthropic-protocol models with 1M windows. */
export const PLATFORM_CONTEXT_WINDOW_TOKENS = 1_000_000

interface Envelope<T = unknown> {
  success?: boolean
  code?: number
  message?: string
  data?: T
  url?: string
}

interface TokenSummary {
  id: number
  name: string
  status?: number
}

export interface NewApiCatalogItem {
  readonly modelId: string
  readonly tags: readonly string[]
}

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
  #accessToken: string | null

  constructor(
    private readonly baseUrl: string,
    private readonly userId: number,
    readonly fetchImpl: FetchLike,
    accessToken: string | null,
  ) {
    this.#accessToken = accessToken
  }

  setAccessToken(token: string): void {
    this.#accessToken = token
  }

  /**
   * Exchanges new-api username/password for a dashboard access token. The
   * login response's session cookie authorizes the token request that follows.
   */
  async loginAndGenerateAccessToken(username: string, password: string): Promise<string> {
    const loginResponse = await this.fetchImpl(`${this.baseUrl}/api/user/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ username, password }),
    })
    const loginJson = await parseEnvelope(loginResponse)
    if (
      !loginResponse.ok ||
      loginJson.success === false ||
      (loginJson.code != null && loginJson.code !== 0)
    ) {
      throw new NewApiAuthenticationError(
        withFallback(asText(loginJson.message), `平台模型登录失败 (${loginResponse.status})`),
      )
    }
    assertSuccess(loginResponse, loginJson, '登录平台模型账户失败')
    const cookie = extractSessionCookie(loginResponse.headers.get('set-cookie') ?? '')
    if (!cookie) throw new Error('平台模型登录未返回 session cookie')

    const tokenResponse = await this.fetchImpl(`${this.baseUrl}/api/user/token`, {
      headers: { Cookie: cookie, 'New-Api-User': String(this.userId), Accept: 'application/json' },
    })
    const tokenJson = await parseEnvelope<string>(tokenResponse)
    assertSuccess(tokenResponse, tokenJson, '换取平台管理凭据失败')
    if (typeof tokenJson.data !== 'string' || !tokenJson.data) {
      throw new Error('平台管理凭据格式无效')
    }
    this.#accessToken = tokenJson.data
    return tokenJson.data
  }

  /** Probes the dashboard session; a conflict means the account moved devices. */
  async validateSession(): Promise<void> {
    await this.dashboardGet('/api/user/self')
  }

  /** OpenAI-compatible surface check for a stored API key. */
  async validateApiKey(apiKey: string): Promise<boolean> {
    if (!apiKey.trim()) return false
    const response = await this.fetchImpl(`${this.baseUrl}/v1/models`, {
      headers: { Accept: 'application/json', Authorization: `Bearer ${apiKey.trim()}` },
    })
    if (response.ok) return true
    if (response.status === 401 || response.status === 403) return false
    throw new Error(`平台模型凭据检查失败 (${response.status})`)
  }

  /** Every enabled model the account can call, following the catalog paging. */
  async getModelCatalog(): Promise<readonly NewApiCatalogItem[]> {
    const catalog = new Map<string, NewApiCatalogItem>()
    let value = await this.dashboardGet('/api/user/models')
    let fetchedRows = 0
    let page = modelCatalogPage(value)
    for (let pageCount = 0; pageCount < 100; pageCount += 1) {
      const rows = modelCatalogRows(value)
      fetchedRows += rows.length
      appendModelCatalogRows(catalog, rows)
      if (!page || fetchedRows >= page.total || rows.length === 0) break
      const nextPage = page.page + 1
      value = await this.dashboardGet(`/api/user/models?p=${nextPage}&page_size=${page.pageSize}`)
      page = modelCatalogPage(value) ?? { ...page, page: nextPage }
    }
    return [...catalog.values()]
  }

  /** Finds or creates the CLI's dashboard token and returns its API key. */
  async ensureApiKey(tokenName = PLATFORM_TOKEN_NAME): Promise<string> {
    let tokens = await this.listTokens()
    let token = tokens.find((item) => item.name.startsWith(tokenName) && item.status !== 2)
    if (!token) {
      await this.dashboardPost('/api/token/', {
        name: tokenName,
        expired_time: -1,
        unlimited_quota: true,
        model_limits_enabled: false,
      })
      tokens = await this.listTokens()
      token = tokens.find((item) => item.name.startsWith(tokenName) && item.status !== 2)
    }
    if (!token) throw new Error('平台模型令牌创建后无法查询')
    const result = await this.dashboardPost(`/api/token/${token.id}/key`)
    const key = isRecord(result) ? result.key : null
    if (typeof key !== 'string' || !key) throw new Error('平台模型令牌恢复失败')
    return key
  }

  private async listTokens(): Promise<TokenSummary[]> {
    const value = await this.dashboardGet('/api/token/')
    const rows = Array.isArray(value)
      ? value
      : isRecord(value) && Array.isArray(value.items)
        ? value.items
        : []
    return rows
      .filter(isRecord)
      .map((item) => ({
        id: Number(item.id),
        name: asText(item.name),
        ...(item.status == null ? {} : { status: Number(item.status) }),
      }))
      .filter((item) => Number.isInteger(item.id) && item.name.length > 0)
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
    if (!this.#accessToken) throw new NewApiSessionConflictError('平台管理凭据不存在')
    const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
      ...init,
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.#accessToken}`,
        'New-Api-User': String(this.userId),
      },
    })
    const json = await parseEnvelope<T>(response)
    if (isTokenInvalid(response, json)) throw new NewApiSessionConflictError()
    assertSuccess(response, json, '平台模型请求失败')
    return (json.data ?? json) as T
  }
}

function modelCatalogRows(value: unknown): unknown[] {
  if (Array.isArray(value)) return value
  if (!isRecord(value)) return []
  if (Array.isArray(value.items)) return value.items
  if (Array.isArray(value.models)) return value.models
  return []
}

function modelCatalogPage(
  value: unknown,
): { page: number; pageSize: number; total: number } | null {
  if (!isRecord(value)) return null
  const page = Number(value.page)
  const pageSize = Number(value.page_size ?? value.pageSize)
  const total = Number(value.total)
  if (!Number.isInteger(page) || page < 1) return null
  if (!Number.isInteger(pageSize) || pageSize < 1) return null
  if (!Number.isInteger(total) || total < 0) return null
  return { page, pageSize, total }
}

function appendModelCatalogRows(
  catalog: Map<string, NewApiCatalogItem>,
  rows: readonly unknown[],
): void {
  for (const item of rows) {
    if (isRecord(item) && item.status != null && Number(item.status) !== 1) continue
    const modelId =
      typeof item === 'string'
        ? item.trim()
        : isRecord(item)
          ? (asText(item.model_name) || asText(item.model) || asText(item.id)).trim()
          : ''
    if (!modelId || catalog.has(modelId)) continue
    const rawTags = isRecord(item) ? item.tags : undefined
    const tags = Array.isArray(rawTags)
      ? rawTags
          .filter((tag): tag is string => typeof tag === 'string')
          .map((tag) => tag.trim())
          .filter(Boolean)
      : asText(rawTags) !== ''
        ? asText(rawTags)
            .split(',')
            .map((tag) => tag.trim())
            .filter(Boolean)
        : []
    catalog.set(modelId, { modelId, tags })
  }
}

function extractSessionCookie(setCookie: string): string | null {
  const match = /(?:^|[,;]\s*)session=([^;,"]+)/i.exec(setCookie)
  return match ? `session=${match[1]}` : null
}

async function parseEnvelope<T>(response: Response): Promise<Envelope<T>> {
  return (await response.json().catch(() => ({}))) as Envelope<T>
}

function assertSuccess(response: Response, json: Envelope, fallback: string): void {
  if (!response.ok || json.success === false || (json.code != null && json.code !== 0)) {
    throw new Error(withFallback(asText(json.message), `${fallback} (${response.status})`))
  }
}

function isTokenInvalid(response: Response, json: Envelope): boolean {
  if (response.status === 401 || response.status === 403) return true
  const message = asText(json.message).toLowerCase()
  return (
    json.success === false &&
    (message.includes('access token') ||
      message.includes('access_token') ||
      message.includes('invalid token') ||
      message.includes('用户不存在'))
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value)
}

/** Empty-safe string extraction: objects never reach the error text. */
function asText(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function withFallback(value: string | undefined, fallback: string): string {
  return value !== undefined && value !== '' ? value : fallback
}

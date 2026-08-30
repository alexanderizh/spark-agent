import { RuntimeError, runtimeErrorCodeForHttp } from './runtime-errors.js'

export interface RuntimeHttpClientOptions {
  baseUrl?: string
  accessToken?: () => Promise<string>
  fetchImpl?: typeof fetch
  timeoutMs?: number
  userAgent?: string
}

export interface RuntimeHttpRequestOptions extends RequestInit {
  path: string
  query?: Record<string, string | number | boolean | undefined>
  json?: unknown
  maxResponseBytes?: number
}

const DEFAULT_MAX_RESPONSE_BYTES = 8 * 1024 * 1024

export class RuntimeHttpClient {
  private readonly fetchImpl: typeof fetch

  constructor(private readonly options: RuntimeHttpClientOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? fetch
  }

  async request(request: RuntimeHttpRequestOptions): Promise<Response> {
    const url = this.resolveUrl(request.path, request.query)
    const headers = new Headers(request.headers)
    headers.set('Accept', 'application/json')
    headers.set('User-Agent', this.options.userAgent ?? 'Spark-Agent-Plugin-Runtime/2')
    if (request.json !== undefined) {
      headers.set('Content-Type', 'application/json')
    }
    if (this.options.accessToken != null && !headers.has('Authorization')) {
      const token = await this.options.accessToken()
      headers.set('Authorization', `Bearer ${token}`)
    }
    const body = request.json === undefined ? request.body : JSON.stringify(request.json)
    const {
      path: _path,
      query: _query,
      json: _json,
      maxResponseBytes: _maxResponseBytes,
      ...requestInit
    } = request
    const init: RequestInit = {
      ...requestInit,
      headers,
      signal: request.signal ?? AbortSignal.timeout(this.options.timeoutMs ?? 30_000),
    }
    if (body !== undefined) init.body = body
    let response: Response
    try {
      response = await this.fetchImpl(url, init)
    } catch (error) {
      if (error instanceof RuntimeError) throw error
      throw new RuntimeError(
        'PROVIDER_UNAVAILABLE',
        `Provider request failed: ${error instanceof Error ? error.message : 'network error'}`,
      )
    }
    if (!response.ok) await this.throwHttpError(response)
    return response
  }

  async requestJson<T>(request: RuntimeHttpRequestOptions): Promise<T> {
    const response = await this.request(request)
    const text = await response.text()
    if (text.length > (request.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES)) {
      throw new RuntimeError(
        'INVALID_PROVIDER_RESPONSE',
        'Provider response exceeds the runtime size limit',
      )
    }
    try {
      return JSON.parse(text) as T
    } catch {
      throw new RuntimeError('INVALID_PROVIDER_RESPONSE', 'Provider returned invalid JSON')
    }
  }

  private resolveUrl(path: string, query?: RuntimeHttpRequestOptions['query']): string {
    let url: URL
    try {
      url = new URL(path, this.options.baseUrl ?? undefined)
    } catch {
      throw new RuntimeError('RUNTIME_UNAVAILABLE', `Invalid provider URL: ${path}`)
    }
    for (const [key, value] of Object.entries(query ?? {})) {
      if (value !== undefined) url.searchParams.set(key, String(value))
    }
    return url.toString()
  }

  private async throwHttpError(response: Response): Promise<never> {
    const retryAfterHeader = response.headers.get('retry-after')
    const retryAfterMs =
      retryAfterHeader != null && /^\d+$/.test(retryAfterHeader)
        ? Number(retryAfterHeader) * 1_000
        : undefined
    throw new RuntimeError(
      runtimeErrorCodeForHttp(response.status),
      `Provider request failed (${response.status})`,
      undefined,
      retryAfterMs,
    )
  }
}

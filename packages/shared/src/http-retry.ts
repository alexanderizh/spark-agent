/**
 * 通用 HTTP + 重试工具，去除任何 provider 特定错误类型耦合。
 *
 * 设计：
 * - `fetchJson` 内置 timeout + retry + backoff，调用方不再各自实现。
 * - 错误归一由 `errorFactory` 注入：默认抛 HttpError，调用方可注入自己的错误类型
 *   （如 MediaProviderError）。
 * - 网络错误识别（isRetryableHttpError / describeNetworkError）从 media-http.util 上移，
 *   全项目共用一份。
 *
 * 兼容：`@spark/agent-runtime` 的 `media-http.util.ts` re-export 这些函数，并保留
 * MediaProviderError 版本以兼容旧调用方。
 */

export class HttpError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode?: number,
  ) {
    super(message)
    this.name = 'HttpError'
  }
}

export type ErrorFactory = (
  status: number,
  body: unknown,
  rawText: string,
  url: string,
) => Error

export interface RetryOptions {
  /** 瞬时错误最大重试次数，默认 3。GET/幂等请求安全；非幂等请传 0。 */
  maxRetries?: number
  /** 退避基数（ms），默认 1000，每次 ×2、上限 8s。 */
  retryBackoffMs?: number
  /** 自定义「是否可重试」判定。默认：网络错误或 5xx。 */
  isRetryable?: (error: unknown) => boolean
  /** 每次重试触发，便于日志/监控。 */
  onRetry?: (info: {
    attempt: number
    retryCount: number
    maxRetries: number
    backoffMs: number
    error: unknown
  }) => void
}

export interface FetchJsonOptions extends RetryOptions {
  method?: string
  headers?: Record<string, string>
  body?: string | Buffer | Uint8Array
  timeoutMs?: number
  /** 注入的 fetch（测试用） */
  fetchImpl?: typeof fetch
  /** 期望二进制响应时为 true，返回 Buffer */
  binary?: boolean
  /**
   * 自定义错误工厂。命中非 2xx 时调用，返回要抛出的 Error。
   * 默认抛 HttpError('provider_http_error', `HTTP ${status}: ...`, status)。
   */
  errorFactory?: ErrorFactory
}

const DEFAULT_MAX_RETRIES = 3
const DEFAULT_RETRY_BACKOFF_MS = 1_000
const MAX_RETRY_BACKOFF_MS = 8_000

/** JSON fetch + timeout + retry + 统一错误包装 */
export async function fetchJson<T = unknown>(
  url: string,
  opts: FetchJsonOptions = {},
): Promise<T> {
  const fetchImpl = opts.fetchImpl ?? fetch
  const timeoutMs = opts.timeoutMs ?? 30_000
  const maxRetries = Math.max(0, opts.maxRetries ?? DEFAULT_MAX_RETRIES)
  const retryBackoffMs = Math.max(1, opts.retryBackoffMs ?? DEFAULT_RETRY_BACKOFF_MS)
  const isRetryable = opts.isRetryable ?? isRetryableHttpError
  const method = opts.method ?? 'GET'
  const safeUrl = sanitizeRequestUrl(url)

  let retryCount = 0
  let nextBackoffMs = retryBackoffMs
  for (let attempt = 0; ; attempt += 1) {
    const controller = new AbortController()
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      controller.abort()
    }, timeoutMs)
    try {
      const init: RequestInit = { method, signal: controller.signal }
      if (opts.headers !== undefined) init.headers = opts.headers
      if (opts.body !== undefined) {
        init.body = typeof opts.body === 'string' ? opts.body : new Uint8Array(opts.body)
      }
      const res = await fetchImpl(url, init)
      if (opts.binary) {
        const buf = Buffer.from(await res.arrayBuffer())
        if (!res.ok) {
          throw buildError(res.status, buf.toString('utf8'), null, url, opts)
        }
        return buf as unknown as T
      }
      const text = await res.text()
      let body: unknown = null
      try {
        body = text ? JSON.parse(text) : null
      } catch {
        if (res.ok) {
          throw new HttpError(
            'invalid_json_response',
            `Expected JSON response from ${safeUrl}, received: ${text.slice(0, 200)}`,
            res.status,
          )
        }
        body = text
      }
      if (!res.ok) {
        throw buildError(res.status, text, body, url, opts)
      }
      return body as T
    } catch (err) {
      const meaningful = normalizeError(err, timedOut, controller.signal.aborted, method, safeUrl, url, timeoutMs)
      if (retryCount >= maxRetries || !isRetryable(meaningful)) {
        throw meaningful
      }
      retryCount += 1
      const backoff = Math.min(nextBackoffMs, MAX_RETRY_BACKOFF_MS)
      nextBackoffMs = Math.min(nextBackoffMs * 2, MAX_RETRY_BACKOFF_MS)
      opts.onRetry?.({
        attempt,
        retryCount,
        maxRetries,
        backoffMs: backoff,
        error: meaningful,
      })
      await new Promise((resolve) => setTimeout(resolve, backoff))
    } finally {
      clearTimeout(timer)
    }
  }
}

/** Text/binary-safe GET helper backed by the same timeout/retry/error policy as fetchJson. */
export async function fetchText(
  url: string,
  opts: Omit<FetchJsonOptions, 'binary'> = {},
): Promise<string> {
  const buffer = await fetchJson<Buffer>(url, { ...opts, binary: true })
  return buffer.toString('utf8')
}

function buildError(
  status: number,
  rawText: string,
  body: unknown,
  url: string,
  opts: FetchJsonOptions,
): Error {
  if (opts.errorFactory) {
    return opts.errorFactory(status, body, rawText, url)
  }
  return new HttpError(
    'provider_http_error',
    `HTTP ${status}: ${String(rawText).slice(0, 800)}`,
    status,
  )
}

function normalizeError(
  err: unknown,
  timedOut: boolean,
  aborted: boolean,
  method: string,
  safeUrl: string,
  url: string,
  timeoutMs: number,
): unknown {
  // HttpError 已是规范化错误
  if (err instanceof HttpError) return err
  // 自定义 errorFactory 抛出的错误（带 statusCode 字段）：原样返回，不重新包装
  if (err instanceof Error && typeof (err as { statusCode?: unknown }).statusCode === 'number') {
    return err
  }
  // timeout / abort
  if (timedOut || (aborted && isAbortError(err))) {
    return new HttpError(
      'provider_http_error',
      `${method} ${safeUrl} timed out after ${timeoutMs}ms`,
    )
  }
  // 网络/连接错误（fetch failed 等）转可读消息
  if (err instanceof Error) {
    const hint = describeNetworkError(err, method, url)
    return new HttpError('provider_http_error', hint ?? err.message)
  }
  return new HttpError('provider_http_error', String(err))
}

/**
 * 判断错误是否为可安全重试的瞬时错误：底层网络错误（无 statusCode）
 * 或 HTTP 5xx。4xx、确定性失败不在此列。
 */
export function isRetryableHttpError(error: unknown): boolean {
  if (error instanceof HttpError) {
    if (error.code !== 'provider_http_error') return false
    if (error.statusCode === undefined) return true
    return error.statusCode >= 500
  }
  // 其它 Error 类型（如调用方自定义）：检查 statusCode 字段
  if (error instanceof Error) {
    const anyErr = error as Error & { statusCode?: number }
    if (typeof anyErr.statusCode === 'number') {
      return anyErr.statusCode >= 500
    }
    // 无 statusCode：当作网络错误，可重试
    return true
  }
  return false
}

const TRANSIENT_NETWORK_ERROR_MARKERS = [
  'fetch failed',
  'enotfound',
  'econnrefused',
  'econnreset',
  'econnaborted',
  'eai_again',
  'etimedout',
  'ehostunreach',
  'enetunreach',
  'und_err_connect_timeout',
  'und_err_socket',
  'other side closed',
  'hang up',
  'socket hang up',
] as const

/**
 * 识别 Node fetch 的 'fetch failed' 等对用户毫无信息量的网络错误，从 err.cause
 * 提取具体原因并给出可读提示。命中返回提示文本，未命中返回 undefined。
 */
export function describeNetworkError(
  error: unknown,
  method: string,
  url: string,
): string | undefined {
  if (!(error instanceof Error)) return undefined
  const msg = error.message ?? ''
  const cause = (error as { cause?: unknown }).cause
  const causeText =
    cause instanceof Error ? (cause.message ?? '') : typeof cause === 'string' ? cause : ''
  const haystack = `${msg} ${causeText}`.toLowerCase()
  if (!TRANSIENT_NETWORK_ERROR_MARKERS.some((marker) => haystack.includes(marker))) return undefined
  const detail = (causeText || msg || '连接失败').slice(0, 300)
  return `${method} ${sanitizeRequestUrl(url)} 网络请求失败：${detail}。可能原因：endpoint 不可达、网络中断、DNS 解析失败或 TLS 握手失败。`
}

export function sanitizeRequestUrl(url: string): string {
  try {
    const parsed = new URL(url)
    return `${parsed.origin}${parsed.pathname}`
  } catch {
    return url.split(/[?#]/, 1)[0] ?? '(invalid-url)'
  }
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError'
}

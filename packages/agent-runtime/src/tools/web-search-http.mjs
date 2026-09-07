import { URL } from 'node:url'

const DEFAULT_TIMEOUT_MS = 15_000
const DEFAULT_RETRIES = 1
const DEFAULT_BACKOFF_MS = 250
const MAX_RETRY_AFTER_MS = 2_000

export class SearchRequestError extends Error {
  constructor(category, message, statusCode, retryAfterMs) {
    super(message)
    this.name = 'SearchRequestError'
    this.category = category
    this.statusCode = statusCode
    this.retryAfterMs = retryAfterMs
  }
}

export function parseBoundedInt(value, fallback, min, max) {
  const parsed = Number.parseInt(value ?? '', 10)
  return Number.isFinite(parsed) && parsed >= min && parsed <= max ? parsed : fallback
}

export function createDeadline(timeoutMs) {
  return Date.now() + timeoutMs
}

export function sanitizeUrl(value) {
  try {
    const url = new URL(value)
    return `${url.origin}${url.pathname}`
  } catch {
    return String(value).split(/[?#]/, 1)[0] || '(invalid-url)'
  }
}

function parseRetryAfter(value) {
  if (!value) return undefined
  const seconds = Number(value)
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1_000, MAX_RETRY_AFTER_MS)
  const timestamp = Date.parse(value)
  if (Number.isNaN(timestamp)) return undefined
  return Math.min(Math.max(0, timestamp - Date.now()), MAX_RETRY_AFTER_MS)
}

function isRetryable(error) {
  return ['timeout', 'network', 'rate_limited', 'server_error'].includes(error.category)
}

function networkError(url, method, error, timedOut) {
  const safeUrl = sanitizeUrl(url)
  if (timedOut || error?.name === 'AbortError') {
    return new SearchRequestError('timeout', `${method} ${safeUrl} timed out [timeout]`)
  }
  const detail = error instanceof Error ? error.message : String(error)
  return new SearchRequestError(
    'network',
    `${method} ${safeUrl} failed: ${detail.slice(0, 200)} [network]`,
  )
}

function statusError(url, method, response) {
  const status = response.status
  const category = status === 429 ? 'rate_limited' : status >= 500 ? 'server_error' : 'http_4xx'
  const retryAfterMs = parseRetryAfter(response.headers.get('retry-after'))
  return new SearchRequestError(
    category,
    `${method} ${sanitizeUrl(url)} returned HTTP ${status} [${category}]`,
    status,
    retryAfterMs,
  )
}

async function cancelResponseBody(response) {
  try {
    await response.body?.cancel()
  } catch {
    // The status error is more useful than a best-effort body cancellation error.
  }
}

function budgetError(url, method) {
  return new SearchRequestError(
    'budget_exhausted',
    `${method} ${sanitizeUrl(url)} exceeded request budget [budget_exhausted]`,
  )
}

function bodyReadError(url, method, error, timedOut) {
  if (timedOut || error?.name === 'AbortError') {
    return new SearchRequestError('timeout', `${method} ${sanitizeUrl(url)} timed out [timeout]`)
  }
  const detail = error instanceof Error ? error.message : String(error)
  return new SearchRequestError(
    'network',
    `${method} ${sanitizeUrl(url)} body read failed: ${detail.slice(0, 200)} [network]`,
  )
}

async function readResponseText(response, url, method, deadline, requestTimeoutMs) {
  if (!response.body) return ''

  const remainingMs = deadline - Date.now()
  if (remainingMs <= 0) {
    await cancelResponseBody(response)
    throw budgetError(url, method)
  }

  const reader = response.body.getReader()
  const chunks = []
  let timedOut = false
  const timer = setTimeout(
    () => {
      timedOut = true
      void reader.cancel().catch(() => {})
    },
    Math.min(remainingMs, requestTimeoutMs),
  )

  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      if (value) chunks.push(Buffer.from(value))
    }
    if (timedOut) throw bodyReadError(url, method, undefined, true)
    return Buffer.concat(chunks).toString('utf8')
  } catch (error) {
    throw bodyReadError(url, method, error, timedOut)
  } finally {
    clearTimeout(timer)
  }
}

function delayFor(error, retryCount, baseDelayMs) {
  const exponential = Math.min(baseDelayMs * 2 ** retryCount, MAX_RETRY_AFTER_MS)
  const requested = error.retryAfterMs ?? exponential
  const jitter = Math.round(requested * (Math.random() * 0.2))
  return Math.min(requested + jitter, MAX_RETRY_AFTER_MS)
}

export async function resilientFetch(url, options = {}) {
  const {
    deadline: suppliedDeadline,
    timeoutMs,
    perAttemptTimeoutMs,
    maxRetries: suppliedMaxRetries,
    retryBackoffMs: suppliedRetryBackoffMs,
    consumeBody = false,
    ...request
  } = options
  const deadline = suppliedDeadline ?? createDeadline(timeoutMs ?? DEFAULT_TIMEOUT_MS)
  const maxRetries = parseBoundedInt(suppliedMaxRetries, DEFAULT_RETRIES, 0, 3)
  const baseDelayMs = parseBoundedInt(
    suppliedRetryBackoffMs,
    DEFAULT_BACKOFF_MS,
    1,
    MAX_RETRY_AFTER_MS,
  )
  const requestTimeoutMs = parseBoundedInt(
    perAttemptTimeoutMs,
    timeoutMs ?? DEFAULT_TIMEOUT_MS,
    1,
    60_000,
  )
  const method = request.method ?? 'GET'
  let retryCount = 0

  for (;;) {
    const remainingMs = deadline - Date.now()
    if (remainingMs <= 0) {
      throw budgetError(url, method)
    }
    const controller = new AbortController()
    let timedOut = false
    const timer = setTimeout(
      () => {
        timedOut = true
        controller.abort()
      },
      Math.min(remainingMs, requestTimeoutMs),
    )
    try {
      const response = await fetch(url, {
        ...request,
        redirect: 'follow',
        signal: controller.signal,
      })
      if (!response.ok) {
        const failure = statusError(url, method, response)
        await cancelResponseBody(response)
        throw failure
      }
      if (!consumeBody) return response
      return {
        response,
        body: await readResponseText(response, url, method, deadline, requestTimeoutMs),
      }
    } catch (error) {
      const normalized =
        error instanceof SearchRequestError ? error : networkError(url, method, error, timedOut)
      if (retryCount >= maxRetries || !isRetryable(normalized)) throw normalized
      const remainingAfterFailureMs = deadline - Date.now()
      const delayMs = Math.min(
        delayFor(normalized, retryCount, baseDelayMs),
        Math.max(0, remainingAfterFailureMs),
      )
      if (remainingAfterFailureMs <= 0) throw normalized
      retryCount += 1
      await new Promise((resolve) => setTimeout(resolve, delayMs))
    } finally {
      clearTimeout(timer)
    }
  }
}

export function formatSearchError(error) {
  return error instanceof SearchRequestError ? error.message : String(error)
}

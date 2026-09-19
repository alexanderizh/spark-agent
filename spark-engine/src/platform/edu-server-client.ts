import { errorMessage } from '../config/config-file.js'
import type { FetchLike } from '../llm/http/client.js'
import { NULL_RUNTIME_LOGGER, type RuntimeLogger } from '../observability/logger.js'

import type { PlatformAccount, PlatformSession } from './credentials.js'

/**
 * Minimal Spark account (edu-server) client for the standalone CLI.
 *
 * It mirrors the desktop contract closely enough to share one account: the same
 * `/auth/desktop/*` browser-login handshake, the same `{ code, message, data }`
 * envelope, and the same 401 → refresh → retry behavior. Anything the desktop
 * only needs for its own UI (captcha, WeChat QR, avatar upload) is left out so
 * the CLI surface stays small and auditable.
 */
const API_PREFIX = '/api/v1'
const DEFAULT_TIMEOUT_MS = 30_000

export const DESKTOP_LOGIN_POLL_STATUSES = ['pending', 'bound', 'expired'] as const
export type DesktopLoginPollStatus = (typeof DESKTOP_LOGIN_POLL_STATUSES)[number]

interface Envelope<T> {
  readonly code?: number
  readonly message?: string
  readonly data?: T
}

export class PlatformApiError extends Error {
  readonly status: number | undefined

  constructor(
    message: string,
    options: { readonly status?: number; readonly cause?: unknown } = {},
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause })
    this.name = 'PlatformApiError'
    this.status = options.status
  }
}

/** The stored session is gone (expired, revoked, or rejected after a refresh). */
export class PlatformAuthExpiredError extends PlatformApiError {
  constructor(message = 'Spark account session expired') {
    super(message)
    this.name = 'PlatformAuthExpiredError'
  }
}

/** Transport-level failure: DNS, offline, TLS, or timeout. */
export class PlatformUnavailableError extends PlatformApiError {
  constructor(message: string, options: { readonly cause?: unknown } = {}) {
    super(message, options)
    this.name = 'PlatformUnavailableError'
  }
}

export interface EduServerClientOptions {
  readonly baseUrl: string
  readonly fetch?: FetchLike
  readonly timeoutMs?: number
  readonly logger?: RuntimeLogger
  readonly session?: PlatformSession | null
  /**
   * Called whenever a refresh produced a new session, so the caller can persist
   * rotated tokens. Without it a long-running CLI session would keep using the
   * refreshed token in memory only and lose it on exit.
   */
  readonly onSessionRefreshed?: (session: PlatformSession) => void | Promise<void>
}

export class EduServerClient {
  readonly #baseUrl: string
  readonly #fetch: FetchLike
  readonly #timeoutMs: number
  readonly #logger: RuntimeLogger
  readonly #onSessionRefreshed: ((session: PlatformSession) => void | Promise<void>) | undefined
  #session: PlatformSession | null
  #refreshInflight: Promise<PlatformSession | null> | null = null

  constructor(options: EduServerClientOptions) {
    this.#baseUrl = options.baseUrl.replace(/\/+$/u, '')
    this.#fetch = options.fetch ?? fetch
    this.#timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
    this.#logger = options.logger ?? NULL_RUNTIME_LOGGER
    this.#session = options.session ?? null
    this.#onSessionRefreshed = options.onSessionRefreshed
  }

  get baseUrl(): string {
    return this.#baseUrl
  }

  get session(): PlatformSession | null {
    return this.#session
  }

  setSession(session: PlatformSession | null): void {
    this.#session = session
  }

  /** Public client config; used to discover the web login page for this environment. */
  async getClientConfig(): Promise<{ readonly webLoginUrl?: string }> {
    const data = await this.#request<unknown>('GET', '/client-config', { auth: 'none' })
    if (typeof data !== 'object' || data === null) return {}
    const value = (data as { readonly webLoginUrl?: unknown }).webLoginUrl
    return typeof value === 'string' && value.trim() !== '' ? { webLoginUrl: value.trim() } : {}
  }

  /** Read-only probe of the browser-login binding; it never returns credentials. */
  async pollDesktopLogin(state: string): Promise<DesktopLoginPollStatus> {
    const data = await this.#request<unknown>(
      'GET',
      `/auth/desktop/poll?state=${encodeURIComponent(state)}`,
      { auth: 'none' },
    )
    const status =
      typeof data === 'object' && data !== null
        ? (data as { readonly status?: unknown }).status
        : undefined
    if (status === 'pending' || status === 'bound' || status === 'expired') return status
    throw new PlatformApiError(`Unexpected desktop login poll status: ${String(status)}`)
  }

  /**
   * Single-use exchange of `state` + PKCE verifier for a fresh token pair.
   * The verifier never leaves this process except in this request body.
   */
  async exchangeDesktopLogin(input: {
    readonly state: string
    readonly codeVerifier: string
  }): Promise<PlatformSession> {
    const data = await this.#request<unknown>('POST', '/auth/desktop/exchange', {
      auth: 'none',
      body: { state: input.state, codeVerifier: input.codeVerifier },
    })
    return parseSession(data, 'desktop login exchange')
  }

  /** Current account profile. Refreshes an expired access token once when possible. */
  async getMe(): Promise<PlatformAccount> {
    const data = await this.#request<unknown>('GET', '/me', { auth: 'required' })
    if (typeof data !== 'object' || data === null) {
      throw new PlatformApiError('Account profile response is not an object')
    }
    const record = data as Record<string, unknown>
    const id = Number(record.id)
    if (!Number.isFinite(id)) throw new PlatformApiError('Account profile is missing an id')
    return {
      id: Math.trunc(id),
      account: stringField(record, 'account'),
      nickname: stringField(record, 'nickname'),
      role: stringField(record, 'role'),
    }
  }

  /**
   * Authenticated POST against a platform feature endpoint (e.g.
   * `/platform-model/bootstrap`). Refreshes an expired access token once.
   */
  async postPlatform<T>(path: string, body?: unknown): Promise<T> {
    return this.#request<T>('POST', path, { auth: 'required', body })
  }

  /** Rotates the session tokens. Concurrent callers share one request. */
  refresh(): Promise<PlatformSession | null> {
    const existing = this.#refreshInflight
    if (existing !== null) return existing
    const operation = this.#refreshInternal().finally(() => {
      if (this.#refreshInflight === operation) this.#refreshInflight = null
    })
    this.#refreshInflight = operation
    return operation
  }

  async #refreshInternal(): Promise<PlatformSession | null> {
    const refreshToken = this.#session?.refreshToken
    if (refreshToken === undefined || refreshToken === '') return null
    const userId = this.#session?.userId ?? ''
    try {
      const data = await this.#request<unknown>('POST', '/auth/refresh', {
        auth: 'none',
        body: { refreshToken },
      })
      const session = parseSession(data, 'token refresh')
      // Keep the previous userId when the server only returns rotated tokens.
      const normalized: PlatformSession = {
        token: session.token,
        refreshToken: session.refreshToken,
        userId: session.userId === '' ? userId : session.userId,
      }
      this.#session = normalized
      this.#logger.info(`platform session refreshed for user=${normalized.userId}`)
      if (this.#onSessionRefreshed !== undefined) {
        try {
          await this.#onSessionRefreshed(normalized)
        } catch (error) {
          this.#logger.warn(`cannot persist refreshed platform session: ${errorMessage(error)}`)
        }
      }
      return normalized
    } catch (error) {
      this.#logger.warn(`platform token refresh failed: ${errorMessage(error)}`)
      // A transport failure says nothing about the session: reporting it as
      // "expired" would delete a perfectly valid credential on a network blip.
      if (error instanceof PlatformUnavailableError) throw error
      return null
    }
  }

  async #request<T>(
    method: 'GET' | 'POST' | 'PUT',
    path: string,
    options: { readonly auth: 'none' | 'required'; readonly body?: unknown },
  ): Promise<T> {
    let response = await this.#send(method, path, options.body, options.auth)
    if (response.status === 401 && options.auth === 'required') {
      const refreshed = await this.refresh()
      if (refreshed === null) {
        this.#session = null
        throw new PlatformAuthExpiredError()
      }
      response = await this.#send(method, path, options.body, options.auth)
      if (response.status === 401) {
        this.#session = null
        throw new PlatformAuthExpiredError()
      }
    }
    return parseEnvelope<T>(response, `${method} ${path}`)
  }

  async #send(
    method: string,
    path: string,
    body: unknown,
    auth: 'none' | 'required',
  ): Promise<Response> {
    const headers: Record<string, string> = {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    }
    if (auth === 'required') {
      const token = this.#session?.token
      if (token === undefined || token === '') throw new PlatformAuthExpiredError()
      headers.Authorization = `Bearer ${token}`
    }
    const controller = new AbortController()
    const timer = setTimeout(() => {
      controller.abort()
    }, this.#timeoutMs)
    try {
      return await this.#fetch(this.#resolveUrl(path), {
        method,
        headers,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: controller.signal,
      })
    } catch (error) {
      const reason = controller.signal.aborted
        ? `timed out after ${this.#timeoutMs}ms`
        : errorMessage(error)
      throw new PlatformUnavailableError(
        `Cannot reach the Spark account server at ${this.#baseUrl}: ${reason}`,
        { cause: error },
      )
    } finally {
      clearTimeout(timer)
    }
  }

  #resolveUrl(path: string): string {
    const normalized = path.startsWith('/') ? path : `/${path}`
    if (normalized.startsWith('/api/')) return `${this.#baseUrl}${normalized}`
    return `${this.#baseUrl}${API_PREFIX}${normalized}`
  }
}

async function parseEnvelope<T>(response: Response, label: string): Promise<T> {
  const text = await response.text().catch(() => '')
  let parsed: Envelope<T> | null = null
  if (text.trim() !== '') {
    try {
      parsed = JSON.parse(text) as Envelope<T>
    } catch {
      parsed = null
    }
  }
  const message = typeof parsed?.message === 'string' ? parsed.message : undefined
  if (parsed !== null && typeof parsed.code === 'number' && parsed.code !== 0) {
    throw new PlatformApiError(message ?? `${label} failed (${response.status})`, {
      status: response.status,
    })
  }
  if (!response.ok) {
    throw new PlatformApiError(message ?? `${label} failed with HTTP ${response.status}`, {
      status: response.status,
    })
  }
  if (parsed === null) {
    throw new PlatformApiError(`${label} returned a non-JSON response`)
  }
  return parsed.data as T
}

function parseSession(data: unknown, label: string): PlatformSession {
  if (typeof data !== 'object' || data === null) {
    throw new PlatformApiError(`${label} response is not an object`)
  }
  const record = data as Record<string, unknown>
  const token = typeof record.token === 'string' ? record.token : ''
  const refreshToken = typeof record.refreshToken === 'string' ? record.refreshToken : ''
  if (token === '' || refreshToken === '') {
    throw new PlatformApiError(`${label} response is missing session tokens`)
  }
  // The server may return a number for userId; compare and store it as text.
  const rawUserId = record.userId
  const userId =
    typeof rawUserId === 'string'
      ? rawUserId
      : typeof rawUserId === 'number' && Number.isFinite(rawUserId)
        ? String(Math.trunc(rawUserId))
        : ''
  return { token, refreshToken, userId }
}

function stringField(record: Record<string, unknown>, key: string): string {
  const value = record[key]
  return typeof value === 'string' ? value : ''
}

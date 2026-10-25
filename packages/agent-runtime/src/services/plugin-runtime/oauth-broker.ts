import { createServer, type Server } from 'node:http'
import { randomBytes, createHash } from 'node:crypto'
import type { StoredCredentialBundle } from './token-service.js'
import { RuntimeError } from './runtime-errors.js'

export type OAuthTokenExchangeMode = 'form' | 'notion'

export interface OAuthBrokerConfig {
  clientId: string
  clientSecret?: string
  authorizationUrl: string
  tokenUrl: string
  scopes: string[]
  authorizeExternal: (url: string) => Promise<void>
  redirectPath?: string
  /** A provider-registered loopback URI. Required by Notion public connections. */
  redirectUri?: string
  /** PKCE is enabled by default. Providers that do not support it can disable it. */
  usePkce?: boolean
  tokenExchangeMode?: OAuthTokenExchangeMode
  extraAuthorizationParams?: Record<string, string>
}

export interface OAuthCallbackResult {
  code: string
  state: string
}

export class OAuthBroker {
  constructor(private readonly fetchImpl: typeof fetch = fetch) {}

  async authorize(config: OAuthBrokerConfig): Promise<StoredCredentialBundle> {
    assertSafeExtraAuthorizationParams(config.extraAuthorizationParams)
    const callback = await createLoopbackCallback(
      config.redirectPath ?? '/oauth/callback',
      config.redirectUri,
    )
    const state = randomBytes(24).toString('base64url')
    const verifier = randomBytes(48).toString('base64url')
    const challenge = createHash('sha256').update(verifier).digest('base64url')
    const usePkce = config.usePkce ?? true
    const url = new URL(config.authorizationUrl)
    url.searchParams.set('response_type', 'code')
    url.searchParams.set('client_id', config.clientId)
    url.searchParams.set('redirect_uri', callback.redirectUrl)
    if (config.scopes.length > 0) url.searchParams.set('scope', config.scopes.join(' '))
    url.searchParams.set('state', state)
    if (usePkce) {
      url.searchParams.set('code_challenge', challenge)
      url.searchParams.set('code_challenge_method', 'S256')
    }
    for (const [key, value] of Object.entries(config.extraAuthorizationParams ?? {})) {
      url.searchParams.set(key, value)
    }
    try {
      await config.authorizeExternal(url.toString())
      const result = await callback.wait()
      if (result.state !== state)
        throw new RuntimeError('AUTH_REQUIRED', 'OAuth state validation failed')
      return await this.exchangeCode(
        config,
        result.code,
        usePkce ? verifier : undefined,
        callback.redirectUrl,
      )
    } finally {
      callback.close()
    }
  }

  async exchangeCode(
    config: Pick<OAuthBrokerConfig, 'clientId' | 'clientSecret' | 'tokenUrl' | 'tokenExchangeMode'>,
    code: string,
    verifier: string | undefined,
    redirectUri: string,
  ): Promise<StoredCredentialBundle> {
    const fields: Record<string, string> = {
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
    }
    if (config.tokenExchangeMode === 'notion') {
      return this.exchange(config.tokenUrl, fields, config)
    }
    fields.client_id = config.clientId
    if (verifier != null) fields.code_verifier = verifier
    return this.exchange(config.tokenUrl, fields, config)
  }

  async refresh(
    config: Pick<OAuthBrokerConfig, 'clientId' | 'clientSecret' | 'tokenUrl' | 'tokenExchangeMode'>,
    refreshToken: string,
  ): Promise<StoredCredentialBundle> {
    const fields: Record<string, string> = {
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    }
    if (config.tokenExchangeMode !== 'notion') fields.client_id = config.clientId
    const result = await this.exchange(config.tokenUrl, fields, config)
    return { ...result, refreshToken: result.refreshToken ?? refreshToken }
  }

  private async exchange(
    tokenUrl: string,
    fields: Record<string, string>,
    config: Pick<OAuthBrokerConfig, 'clientId' | 'clientSecret' | 'tokenExchangeMode'>,
  ): Promise<StoredCredentialBundle> {
    const notionMode = config.tokenExchangeMode === 'notion'
    if (notionMode && config.clientSecret == null)
      throw new RuntimeError('AUTH_REQUIRED', 'Notion OAuth Client Secret is required')
    const headers = new Headers({ Accept: 'application/json' })
    let body: string | URLSearchParams
    if (notionMode) {
      headers.set('Content-Type', 'application/json')
      headers.set(
        'Authorization',
        `Basic ${Buffer.from(`${config.clientId}:${config.clientSecret}`, 'utf8').toString('base64')}`,
      )
      body = JSON.stringify(fields)
    } else {
      headers.set('Content-Type', 'application/x-www-form-urlencoded')
      body = new URLSearchParams(fields)
    }
    let response: Response
    try {
      response = await this.fetchImpl(tokenUrl, {
        method: 'POST',
        headers,
        body,
        signal: AbortSignal.timeout(30_000),
      })
    } catch (error) {
      throw new RuntimeError(
        'PROVIDER_UNAVAILABLE',
        `OAuth token request failed: ${error instanceof Error ? error.message : 'network error'}`,
      )
    }
    if (!response.ok)
      throw new RuntimeError('AUTH_REQUIRED', `OAuth token request failed (${response.status})`)
    let payload: Record<string, unknown>
    try {
      payload = (await response.json()) as Record<string, unknown>
    } catch {
      throw new RuntimeError('INVALID_PROVIDER_RESPONSE', 'OAuth provider returned invalid JSON')
    }
    const accessToken = typeof payload.access_token === 'string' ? payload.access_token : ''
    if (accessToken.length === 0)
      throw new RuntimeError('AUTH_REQUIRED', 'OAuth provider returned no access token')
    const expiresIn = typeof payload.expires_in === 'number' ? payload.expires_in : undefined
    return {
      accessToken,
      ...(typeof payload.refresh_token === 'string' ? { refreshToken: payload.refresh_token } : {}),
      ...(typeof payload.token_type === 'string' ? { tokenType: payload.token_type } : {}),
      ...(typeof payload.scope === 'string'
        ? {
            scopes: payload.scope
              .split(/\s+/)
              .map((scope) => scope.trim())
              .filter(Boolean),
          }
        : {}),
      ...(expiresIn !== undefined
        ? { expiresAt: new Date(Date.now() + expiresIn * 1_000).toISOString() }
        : {}),
    }
  }
}

function assertSafeExtraAuthorizationParams(params: Record<string, string> | undefined): void {
  const reserved = new Set([
    'client_id',
    'redirect_uri',
    'response_type',
    'scope',
    'state',
    'code_challenge',
    'code_challenge_method',
  ])
  const override = Object.keys(params ?? {}).find((key) => reserved.has(key))
  if (override != null)
    throw new RuntimeError('AUTH_REQUIRED', `OAuth parameter cannot be overridden: ${override}`)
}

async function createLoopbackCallback(
  defaultPathname: string,
  registeredRedirectUri?: string,
): Promise<{
  redirectUrl: string
  wait: () => Promise<OAuthCallbackResult>
  close: () => void
}> {
  const redirect =
    registeredRedirectUri == null
      ? { hostname: '127.0.0.1', pathname: defaultPathname, port: 0, redirectUrl: null }
      : parseLoopbackRedirectUri(registeredRedirectUri)
  let resolveResult!: (result: OAuthCallbackResult) => void
  let rejectResult!: (error: Error) => void
  let consumed = false
  const result = new Promise<OAuthCallbackResult>((resolve, reject) => {
    resolveResult = resolve
    rejectResult = reject
  })
  const server: Server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1')
    if (url.pathname !== redirect.pathname) {
      response.writeHead(404).end()
      return
    }
    if (consumed) {
      response.writeHead(409).end('OAuth callback already consumed')
      return
    }
    consumed = true
    const error = url.searchParams.get('error')
    const code = url.searchParams.get('code')
    const state = url.searchParams.get('state')
    if (error != null || code == null || state == null) {
      response.writeHead(400).end('Authorization failed. You can close this window.')
      rejectResult(
        new RuntimeError(
          'AUTH_REQUIRED',
          'OAuth callback did not contain a valid authorization code',
        ),
      )
      return
    }
    response
      .writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      .end('<p>Authorization complete. You can close this window.</p>')
    resolveResult({ code, state })
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(redirect.port, redirect.hostname, () => {
      server.off('error', reject)
      resolve()
    })
  }).catch((error: unknown) => {
    if (registeredRedirectUri != null)
      throw new RuntimeError(
        'RUNTIME_UNAVAILABLE',
        'The registered OAuth callback port is unavailable; close the app using it and try again',
      )
    throw error
  })
  const address = server.address()
  if (address == null || typeof address === 'string')
    throw new RuntimeError('RUNTIME_UNAVAILABLE', 'Failed to bind OAuth callback')
  const redirectUrl = redirect.redirectUrl ?? `http://127.0.0.1:${address.port}${redirect.pathname}`
  const timeout = setTimeout(() => {
    if (!consumed) {
      consumed = true
      rejectResult(new RuntimeError('AUTH_REQUIRED', 'OAuth authorization timed out'))
    }
  }, 5 * 60_000)
  result.finally(() => clearTimeout(timeout)).catch(() => undefined)
  return {
    redirectUrl,
    wait: () => result,
    close: () => server.close(),
  }
}

function parseLoopbackRedirectUri(value: string): {
  hostname: string
  pathname: string
  port: number
  redirectUrl: string
} {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new RuntimeError('AUTH_REQUIRED', 'OAuth redirect URI is invalid')
  }
  if (
    url.protocol !== 'http:' ||
    !['127.0.0.1', 'localhost'].includes(url.hostname) ||
    url.port.length === 0 ||
    url.username.length > 0 ||
    url.password.length > 0 ||
    url.search.length > 0 ||
    url.hash.length > 0
  ) {
    throw new RuntimeError(
      'AUTH_REQUIRED',
      'OAuth redirect URI must be a registered HTTP loopback URI with an explicit port and no query or fragment',
    )
  }
  return {
    hostname: url.hostname,
    pathname: url.pathname,
    port: Number(url.port),
    redirectUrl: url.toString(),
  }
}

import { createServer, type Server } from 'node:http'
import { randomBytes, createHash } from 'node:crypto'
import type { StoredCredentialBundle } from './token-service.js'
import { RuntimeError } from './runtime-errors.js'

export interface OAuthBrokerConfig {
  clientId: string
  authorizationUrl: string
  tokenUrl: string
  scopes: string[]
  authorizeExternal: (url: string) => Promise<void>
  redirectPath?: string
  extraAuthorizationParams?: Record<string, string>
}

export interface OAuthCallbackResult {
  code: string
  state: string
}

export class OAuthBroker {
  constructor(private readonly fetchImpl: typeof fetch = fetch) {}

  async authorize(config: OAuthBrokerConfig): Promise<StoredCredentialBundle> {
    const callback = await createLoopbackCallback(config.redirectPath ?? '/oauth/callback')
    const state = randomBytes(24).toString('base64url')
    const verifier = randomBytes(48).toString('base64url')
    const challenge = createHash('sha256').update(verifier).digest('base64url')
    const url = new URL(config.authorizationUrl)
    url.searchParams.set('response_type', 'code')
    url.searchParams.set('client_id', config.clientId)
    url.searchParams.set('redirect_uri', callback.redirectUrl)
    url.searchParams.set('scope', config.scopes.join(' '))
    url.searchParams.set('state', state)
    url.searchParams.set('code_challenge', challenge)
    url.searchParams.set('code_challenge_method', 'S256')
    for (const [key, value] of Object.entries(config.extraAuthorizationParams ?? {})) {
      url.searchParams.set(key, value)
    }
    try {
      await config.authorizeExternal(url.toString())
      const result = await callback.wait()
      if (result.state !== state)
        throw new RuntimeError('AUTH_REQUIRED', 'OAuth state validation failed')
      return await this.exchangeCode(config, result.code, verifier, callback.redirectUrl)
    } finally {
      callback.close()
    }
  }

  async exchangeCode(
    config: Pick<OAuthBrokerConfig, 'clientId' | 'tokenUrl'>,
    code: string,
    verifier: string,
    redirectUri: string,
  ): Promise<StoredCredentialBundle> {
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: config.clientId,
      code,
      code_verifier: verifier,
      redirect_uri: redirectUri,
    })
    return this.exchange(config.tokenUrl, body)
  }

  async refresh(
    config: Pick<OAuthBrokerConfig, 'clientId' | 'tokenUrl'>,
    refreshToken: string,
  ): Promise<StoredCredentialBundle> {
    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: config.clientId,
      refresh_token: refreshToken,
    })
    const result = await this.exchange(config.tokenUrl, body)
    return { ...result, refreshToken: result.refreshToken ?? refreshToken }
  }

  private async exchange(tokenUrl: string, body: URLSearchParams): Promise<StoredCredentialBundle> {
    let response: Response
    try {
      response = await this.fetchImpl(tokenUrl, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/x-www-form-urlencoded',
        },
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
    const payload = (await response.json()) as Record<string, unknown>
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

async function createLoopbackCallback(pathname: string): Promise<{
  redirectUrl: string
  wait: () => Promise<OAuthCallbackResult>
  close: () => void
}> {
  let resolveResult!: (result: OAuthCallbackResult) => void
  let rejectResult!: (error: Error) => void
  let consumed = false
  const result = new Promise<OAuthCallbackResult>((resolve, reject) => {
    resolveResult = resolve
    rejectResult = reject
  })
  const server: Server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1')
    if (url.pathname !== pathname) {
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
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject)
      resolve()
    })
  })
  const address = server.address()
  if (address == null || typeof address === 'string')
    throw new RuntimeError('RUNTIME_UNAVAILABLE', 'Failed to bind OAuth callback')
  const timeout = setTimeout(() => {
    if (!consumed) {
      consumed = true
      rejectResult(new RuntimeError('AUTH_REQUIRED', 'OAuth authorization timed out'))
    }
  }, 5 * 60_000)
  result.finally(() => clearTimeout(timeout)).catch(() => undefined)
  return {
    redirectUrl: `http://127.0.0.1:${address.port}${pathname}`,
    wait: () => result,
    close: () => server.close(),
  }
}

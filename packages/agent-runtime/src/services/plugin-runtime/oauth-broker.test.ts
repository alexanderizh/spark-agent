import { createServer } from 'node:net'
import { describe, expect, it } from 'vitest'
import { OAuthBroker } from './oauth-broker.js'

describe('OAuthBroker', () => {
  it('uses PKCE loopback authorization and returns scopes without exposing token in URLs', async () => {
    const requests: Array<{ url: string; init: RequestInit | undefined }> = []
    const broker = new OAuthBroker(async (input, init) => {
      requests.push({ url: String(input), init })
      return new Response(
        JSON.stringify({
          access_token: 'access-secret',
          refresh_token: 'refresh-secret',
          token_type: 'Bearer',
          expires_in: 3600,
          scope: 'scope.read scope.write',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      )
    })

    const credentials = await broker.authorize({
      clientId: 'desktop-client',
      authorizationUrl: 'https://provider.example/authorize',
      tokenUrl: 'https://provider.example/token',
      scopes: ['scope.read'],
      authorizeExternal: async (url) => {
        const authorization = new URL(url)
        expect(authorization.searchParams.get('code_challenge_method')).toBe('S256')
        expect(authorization.searchParams.get('code_challenge')).toBeTruthy()
        const redirectUri = authorization.searchParams.get('redirect_uri')
        const state = authorization.searchParams.get('state')
        if (redirectUri == null || state == null) throw new Error('OAuth parameters were missing')
        const callback = new URL(redirectUri)
        callback.searchParams.set('code', 'one-time-code')
        callback.searchParams.set('state', state)
        await fetch(callback)
      },
    })

    expect(credentials).toMatchObject({
      accessToken: 'access-secret',
      refreshToken: 'refresh-secret',
      scopes: ['scope.read', 'scope.write'],
    })
    expect(requests).toHaveLength(1)
    expect(requests[0]?.url).toBe('https://provider.example/token')
    expect(requests[0]?.url).not.toContain('access-secret')
    expect(String(requests[0]?.init?.body)).toContain('code_verifier=')
  })

  it('preserves refresh token rotation semantics when a provider omits it', async () => {
    const broker = new OAuthBroker(
      async () =>
        new Response(JSON.stringify({ access_token: 'new-access', expires_in: 120 }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
    )
    await expect(
      broker.refresh(
        { clientId: 'desktop-client', tokenUrl: 'https://provider.example/token' },
        'old-refresh',
      ),
    ).resolves.toMatchObject({ accessToken: 'new-access', refreshToken: 'old-refresh' })
  })

  it('uses Notion registered loopback redirect, owner=user, Basic auth, and JSON exchange', async () => {
    const port = await availableLoopbackPort()
    const requests: Array<{ url: string; init: RequestInit | undefined }> = []
    const broker = new OAuthBroker(async (input, init) => {
      requests.push({ url: String(input), init })
      return new Response(JSON.stringify({ access_token: 'notion-access', bot_id: 'bot-1' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    })
    const redirectUri = `http://127.0.0.1:${port}/oauth/callback`
    const credentials = await broker.authorize({
      clientId: 'notion-client',
      clientSecret: 'notion-secret',
      authorizationUrl: 'https://api.notion.com/v1/oauth/authorize',
      tokenUrl: 'https://api.notion.com/v1/oauth/token',
      scopes: [],
      redirectUri,
      tokenExchangeMode: 'notion',
      usePkce: false,
      extraAuthorizationParams: { owner: 'user' },
      authorizeExternal: async (authorizationUrl) => {
        const authorization = new URL(authorizationUrl)
        expect(authorization.searchParams.get('redirect_uri')).toBe(redirectUri)
        expect(authorization.searchParams.get('owner')).toBe('user')
        expect(authorization.searchParams.get('code_challenge')).toBeNull()
        const callback = new URL(redirectUri)
        callback.searchParams.set('code', 'temporary-code')
        callback.searchParams.set('state', authorization.searchParams.get('state') ?? '')
        await fetch(callback)
      },
    })

    expect(credentials.accessToken).toBe('notion-access')
    expect(requests).toHaveLength(1)
    expect(requests[0]?.url).toBe('https://api.notion.com/v1/oauth/token')
    const headers = new Headers(requests[0]?.init?.headers)
    expect(headers.get('content-type')).toBe('application/json')
    expect(headers.get('authorization')).toBe(
      `Basic ${Buffer.from('notion-client:notion-secret').toString('base64')}`,
    )
    expect(JSON.parse(String(requests[0]?.init?.body))).toEqual({
      grant_type: 'authorization_code',
      code: 'temporary-code',
      redirect_uri: redirectUri,
    })
    expect(JSON.stringify(requests[0]?.init)).not.toContain('notion-access')
  })

  it('refreshes Notion credentials using Basic auth and the JSON refresh-token body', async () => {
    let request: { url: string; init: RequestInit | undefined } | undefined
    const broker = new OAuthBroker(async (input, init) => {
      request = { url: String(input), init }
      return new Response(
        JSON.stringify({ access_token: 'rotated-access', refresh_token: 'rotated-refresh' }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      )
    })

    await expect(
      broker.refresh(
        {
          clientId: 'notion-client',
          clientSecret: 'notion-secret',
          tokenUrl: 'https://api.notion.com/v1/oauth/token',
          tokenExchangeMode: 'notion',
        },
        'previous-refresh',
      ),
    ).resolves.toMatchObject({
      accessToken: 'rotated-access',
      refreshToken: 'rotated-refresh',
    })
    expect(request?.url).toBe('https://api.notion.com/v1/oauth/token')
    expect(new Headers(request?.init?.headers).get('authorization')).toBe(
      `Basic ${Buffer.from('notion-client:notion-secret').toString('base64')}`,
    )
    expect(JSON.parse(String(request?.init?.body))).toEqual({
      grant_type: 'refresh_token',
      refresh_token: 'previous-refresh',
    })
  })
})

async function availableLoopbackPort(): Promise<number> {
  const server = createServer()
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve())
  })
  const address = server.address()
  if (address == null || typeof address === 'string') throw new Error('Missing local test port')
  const { port } = address
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()))
  })
  return port
}

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
        const callback = new URL(authorization.searchParams.get('redirect_uri')!)
        callback.searchParams.set('code', 'one-time-code')
        callback.searchParams.set('state', authorization.searchParams.get('state')!)
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
})

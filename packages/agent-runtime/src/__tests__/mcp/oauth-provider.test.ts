import { describe, expect, it } from 'vitest'
import { InMemoryMcpOAuthStore, SparkMcpOAuthProvider } from '../../mcp/oauth/index.js'

describe('SparkMcpOAuthProvider', () => {
  it('builds OAuth client metadata with PKCE authorization code settings', () => {
    const provider = new SparkMcpOAuthProvider({
      serverId: 'server-1',
      redirectUrl: 'http://127.0.0.1:1234/callback',
      store: new InMemoryMcpOAuthStore(),
      scope: 'openid profile',
    })

    expect(provider.clientMetadata).toMatchObject({
      client_name: 'Spark Agent',
      redirect_uris: ['http://127.0.0.1:1234/callback'],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
      scope: 'openid profile',
    })
  })

  it('persists tokens, client information, discovery state and supports invalidation scopes', async () => {
    const store = new InMemoryMcpOAuthStore()
    const provider = new SparkMcpOAuthProvider({
      serverId: 'server-1',
      redirectUrl: 'http://127.0.0.1:1234/callback',
      store,
    })

    await provider.saveClientInformation({ client_id: 'client-1', client_secret: 'secret' })
    await provider.saveTokens({ access_token: 'access', refresh_token: 'refresh', token_type: 'Bearer', expires_in: 60 })
    await provider.saveDiscoveryState({ authorizationServerUrl: 'https://auth.example.com' })

    expect(await provider.clientInformation()).toMatchObject({ client_id: 'client-1', client_secret: 'secret' })
    expect(await provider.tokens()).toMatchObject({ access_token: 'access', refresh_token: 'refresh', expires_at: expect.any(Number) })
    expect(await provider.discoveryState()).toMatchObject({ authorizationServerUrl: 'https://auth.example.com' })

    await provider.invalidateCredentials('tokens')
    expect(await provider.tokens()).toBeUndefined()
    expect(await provider.clientInformation()).toMatchObject({ client_id: 'client-1' })

    await provider.invalidateCredentials('all')
    expect(await provider.clientInformation()).toBeUndefined()
    expect(await provider.discoveryState()).toBeUndefined()
  })

  it('uses static client information when DCR is disabled', async () => {
    const provider = new SparkMcpOAuthProvider({
      serverId: 'server-1',
      redirectUrl: 'http://127.0.0.1:1234/callback',
      store: new InMemoryMcpOAuthStore(),
      staticClient: { clientId: 'static-client', clientSecret: 'static-secret' },
    })

    expect(provider.clientMetadata.token_endpoint_auth_method).toBe('client_secret_post')
    await expect(provider.clientInformation()).resolves.toMatchObject({
      client_id: 'static-client',
      client_secret: 'static-secret',
    })
  })
})

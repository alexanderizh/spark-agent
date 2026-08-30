import type { OAuthClientInformationMixed, OAuthClientMetadata, OAuthTokens } from '@modelcontextprotocol/sdk/shared/auth.js'
import type { OAuthClientProvider, OAuthDiscoveryState } from '@modelcontextprotocol/sdk/client/auth.js'
import type { McpOAuthStore, SparkOAuthTokens } from './oauth-store.js'

export interface SparkMcpOAuthProviderOptions {
  serverId: string
  redirectUrl: string
  store: McpOAuthStore
  scope?: string
  staticClient?: { clientId?: string; clientSecret?: string }
  onAuthorizationUrl?: (url: URL) => void | Promise<void>
  state?: string
}

export class SparkMcpOAuthProvider implements OAuthClientProvider {
  private verifier: string | undefined
  private readonly requestedScope: string | undefined

  constructor(private readonly options: SparkMcpOAuthProviderOptions) {
    this.requestedScope = options.scope?.trim() || undefined
  }

  get redirectUrl(): string { return this.options.redirectUrl }

  get clientMetadata(): OAuthClientMetadata {
    return {
      client_name: 'Spark Agent',
      redirect_uris: [this.redirectUrl],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: this.options.staticClient?.clientSecret ? 'client_secret_post' : 'none',
      ...(this.requestedScope != null ? { scope: this.requestedScope } : {}),
    }
  }

  state(): string { return this.options.state ?? 'spark-oauth' }

  async clientInformation(): Promise<OAuthClientInformationMixed | undefined> {
    const saved = await this.options.store.getClientInformation(this.options.serverId)
    if (saved != null) return saved
    const clientId = this.options.staticClient?.clientId?.trim()
    if (!clientId) return undefined
    return {
      client_id: clientId,
      ...(this.options.staticClient?.clientSecret ? { client_secret: this.options.staticClient.clientSecret } : {}),
    }
  }

  async saveClientInformation(clientInformation: OAuthClientInformationMixed): Promise<void> {
    await this.options.store.saveClientInformation(this.options.serverId, clientInformation)
  }

  async tokens(): Promise<OAuthTokens | undefined> { return await this.options.store.getTokens(this.options.serverId) }

  async saveTokens(tokens: OAuthTokens): Promise<void> {
    const now = Math.floor(Date.now() / 1000)
    const withExpiry: SparkOAuthTokens = {
      ...tokens,
      ...(tokens.expires_in != null ? { expires_at: now + Number(tokens.expires_in) } : {}),
    }
    await this.options.store.saveTokens(this.options.serverId, withExpiry)
  }

  async redirectToAuthorization(authorizationUrl: URL): Promise<void> {
    await this.options.onAuthorizationUrl?.(authorizationUrl)
  }

  saveCodeVerifier(codeVerifier: string): void { this.verifier = codeVerifier }

  codeVerifier(): string {
    if (this.verifier == null) throw new Error('OAuth code verifier is missing')
    return this.verifier
  }

  async saveDiscoveryState(state: OAuthDiscoveryState): Promise<void> {
    await this.options.store.saveDiscoveryState(this.options.serverId, state)
  }

  async discoveryState(): Promise<OAuthDiscoveryState | undefined> {
    return await this.options.store.getDiscoveryState(this.options.serverId)
  }

  async invalidateCredentials(scope: 'all' | 'client' | 'tokens' | 'verifier' | 'discovery'): Promise<void> {
    if (scope === 'all') await this.options.store.clearAll(this.options.serverId)
    if (scope === 'client') await this.options.store.clearClientInformation(this.options.serverId)
    if (scope === 'tokens') await this.options.store.clearTokens(this.options.serverId)
    if (scope === 'discovery') await this.options.store.clearDiscoveryState(this.options.serverId)
    if (scope === 'verifier' || scope === 'all') this.verifier = undefined
  }
}

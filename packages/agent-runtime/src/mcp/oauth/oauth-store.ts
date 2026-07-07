import type { OAuthClientInformationMixed, OAuthTokens } from '@modelcontextprotocol/sdk/shared/auth.js'
import type { OAuthDiscoveryState } from '@modelcontextprotocol/sdk/client/auth.js'

export type SparkOAuthTokens = OAuthTokens & { expires_at?: number }

export interface McpOAuthStore {
  getTokens(serverId: string): Promise<SparkOAuthTokens | undefined>
  saveTokens(serverId: string, tokens: SparkOAuthTokens): Promise<void>
  clearTokens(serverId: string): Promise<void>
  getClientInformation(serverId: string): Promise<OAuthClientInformationMixed | undefined>
  saveClientInformation(serverId: string, info: OAuthClientInformationMixed): Promise<void>
  clearClientInformation(serverId: string): Promise<void>
  getDiscoveryState(serverId: string): Promise<OAuthDiscoveryState | undefined>
  saveDiscoveryState(serverId: string, state: OAuthDiscoveryState): Promise<void>
  clearDiscoveryState(serverId: string): Promise<void>
  clearAll(serverId: string): Promise<void>
}

export class InMemoryMcpOAuthStore implements McpOAuthStore {
  private readonly tokens = new Map<string, SparkOAuthTokens>()
  private readonly clients = new Map<string, OAuthClientInformationMixed>()
  private readonly discovery = new Map<string, OAuthDiscoveryState>()

  async getTokens(serverId: string): Promise<SparkOAuthTokens | undefined> { return this.tokens.get(serverId) }
  async saveTokens(serverId: string, tokens: SparkOAuthTokens): Promise<void> { this.tokens.set(serverId, tokens) }
  async clearTokens(serverId: string): Promise<void> { this.tokens.delete(serverId) }
  async getClientInformation(serverId: string): Promise<OAuthClientInformationMixed | undefined> { return this.clients.get(serverId) }
  async saveClientInformation(serverId: string, info: OAuthClientInformationMixed): Promise<void> { this.clients.set(serverId, info) }
  async clearClientInformation(serverId: string): Promise<void> { this.clients.delete(serverId) }
  async getDiscoveryState(serverId: string): Promise<OAuthDiscoveryState | undefined> { return this.discovery.get(serverId) }
  async saveDiscoveryState(serverId: string, state: OAuthDiscoveryState): Promise<void> { this.discovery.set(serverId, state) }
  async clearDiscoveryState(serverId: string): Promise<void> { this.discovery.delete(serverId) }
  async clearAll(serverId: string): Promise<void> {
    this.tokens.delete(serverId)
    this.clients.delete(serverId)
    this.discovery.delete(serverId)
  }
}

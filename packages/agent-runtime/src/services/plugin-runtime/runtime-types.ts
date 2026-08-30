import type {
  ConnectorAccount,
  ConnectorRuntimeDescriptor,
  RuntimeConnectRequest,
  RuntimeHealth,
  RuntimeToolDefinition,
} from '@spark/protocol'
import type { ConnectorAccountRow } from '@spark/storage'
import type { RuntimeHttpClient } from './runtime-http-client.js'
import type { RuntimePolicy } from './runtime-policy.js'
import type { RuntimeTokenService, StoredCredentialBundle } from './token-service.js'

export interface RuntimeConnectContext {
  descriptor: ConnectorRuntimeDescriptor
  http: RuntimeHttpClient
  getSecret(name: string): string | null
}

export interface RuntimeConnectResult {
  externalAccountId: string
  displayName: string
  avatarUrl?: string
  grantedScopes?: string[]
  config?: Record<string, unknown>
  resourceScope?: Record<string, unknown>
  enabledCapabilities?: string[]
  credential?: StoredCredentialBundle
  tokenExpiresAt?: string
}

export interface RuntimeContext {
  descriptor: ConnectorRuntimeDescriptor
  account: ConnectorAccount
  row: ConnectorAccountRow
  http: RuntimeHttpClient
  credentials: RuntimeTokenService
  policy: RuntimePolicy
  refreshCredentials?: (bundle: StoredCredentialBundle) => Promise<StoredCredentialBundle>
}

export interface ConnectorRuntimeAdapter {
  readonly descriptor: ConnectorRuntimeDescriptor
  connect(ctx: RuntimeConnectContext, request: RuntimeConnectRequest): Promise<RuntimeConnectResult>
  disconnect?(ctx: RuntimeContext): Promise<void>
  healthCheck(ctx: RuntimeContext): Promise<RuntimeHealth>
  listTools(ctx: RuntimeContext): Promise<RuntimeToolDefinition[]>
  invokeTool(ctx: RuntimeContext, toolName: string, input: unknown): Promise<unknown>
}

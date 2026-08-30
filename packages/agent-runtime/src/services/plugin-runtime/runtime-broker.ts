import { randomUUID } from 'node:crypto'
import type {
  ConnectorAccount,
  ConnectorRuntimeDescriptor,
  PluginRuntimeStatusItem,
  RuntimeConnectRequest,
  RuntimeHealth,
  RuntimeToolDefinition,
  RuntimeToolInvokeRequest,
  RuntimeUpdateAccountRequest,
} from '@spark/protocol'
import {
  ConnectorAccountRepository,
  ConnectorConnectionRepository,
  PluginRuntimeAuditRepository,
  type ConnectorAccountRow,
  type SparkDatabase,
} from '@spark/storage'
import { RuntimeAuditService } from './audit-service.js'
import { RuntimeError } from './runtime-errors.js'
import { RuntimeHttpClient } from './runtime-http-client.js'
import { OAuthBroker } from './oauth-broker.js'
import { RuntimePolicy } from './runtime-policy.js'
import { RuntimeRegistry } from './runtime-registry.js'
import type { ConnectorRuntimeAdapter, RuntimeContext } from './runtime-types.js'
import { RuntimeTokenService } from './token-service.js'

interface ConfirmationRecord {
  runtimeId: string
  accountId: string
  toolName: string
  expiresAt: number
}

export interface RuntimeBrokerOptions {
  db: SparkDatabase
  isPluginEnabled?: (pluginId: string, runtimeId: string) => boolean
  tokenService?: RuntimeTokenService
  fetchImpl?: typeof fetch
}

export class RuntimeBroker {
  readonly registry = new RuntimeRegistry()
  private readonly db: SparkDatabase
  private readonly accounts: ConnectorAccountRepository
  private readonly audit: RuntimeAuditService
  private readonly tokens: RuntimeTokenService
  private readonly policy: RuntimePolicy
  private readonly confirmations = new Map<string, ConfirmationRecord>()
  private readonly fetchImpl: typeof fetch | undefined
  private readonly isPluginEnabled: ((pluginId: string, runtimeId: string) => boolean) | undefined
  private readonly oauth: OAuthBroker

  constructor(options: RuntimeBrokerOptions) {
    this.db = options.db
    this.accounts = new ConnectorAccountRepository(options.db)
    this.audit = new RuntimeAuditService(new PluginRuntimeAuditRepository(options.db))
    this.tokens = options.tokenService ?? new RuntimeTokenService()
    this.fetchImpl = options.fetchImpl
    this.oauth = new OAuthBroker(options.fetchImpl ?? fetch)
    this.isPluginEnabled = options.isPluginEnabled
    this.policy = new RuntimePolicy({
      ...(options.isPluginEnabled ? { isPluginEnabled: options.isPluginEnabled } : {}),
      validateConfirmation: (token, request) => this.consumeConfirmation(token, request),
    })
  }

  register(adapter: ConnectorRuntimeAdapter): void {
    this.registry.replace(adapter)
  }

  listRuntimeDescriptors(): ConnectorRuntimeDescriptor[] {
    return this.registry.list()
  }

  listRuntimeStatus(): PluginRuntimeStatusItem[] {
    return this.registry.list().map((runtime) => {
      this.ensureLegacyCompatibility(runtime)
      const accounts = this.accounts.list(runtime.pluginId, runtime.id)
      const defaultAccountId = this.accounts.getDefault(runtime.pluginId, runtime.id) ?? undefined
      return {
        runtime,
        enabled: this.isEnabled(runtime),
        accountCount: accounts.length,
        ...(defaultAccountId !== undefined ? { defaultAccountId } : {}),
      }
    })
  }

  listAccounts(runtimeId: string): ConnectorAccount[] {
    const adapter = this.registry.require(runtimeId)
    this.ensureLegacyCompatibility(adapter.descriptor)
    return this.accounts
      .list(adapter.descriptor.pluginId, runtimeId)
      .map((row) => this.toAccount(row))
  }

  async connect(runtimeId: string, request: RuntimeConnectRequest): Promise<ConnectorAccount> {
    const adapter = this.registry.require(runtimeId)
    this.policy.requireRuntimeEnabled(adapter.descriptor)
    this.ensureLegacyCompatibility(adapter.descriptor)
    const safeRequest = sanitizeConnectRequest(request)
    if (!adapter.descriptor.authMethods.includes(safeRequest.authMethod)) {
      throw new RuntimeError(
        'AUTH_REQUIRED',
        `${adapter.descriptor.displayName} does not support ${safeRequest.authMethod} authentication`,
      )
    }
    const requestedCapabilities =
      safeRequest.enabledCapabilities ?? this.defaultCapabilities(adapter.descriptor)
    validateCapabilityIds(adapter.descriptor, requestedCapabilities)
    const connectContext = {
      descriptor: adapter.descriptor,
      http: new RuntimeHttpClient({ ...(this.fetchImpl ? { fetchImpl: this.fetchImpl } : {}) }),
      getSecret: (name: string) => safeRequest.secrets?.[name] ?? null,
    }
    const result = await adapter.connect(connectContext, safeRequest)
    const existing = this.accounts.getByExternalId(
      adapter.descriptor.pluginId,
      runtimeId,
      result.externalAccountId,
    )
    const existingAccounts = this.accounts.list(adapter.descriptor.pluginId, runtimeId)
    if (
      adapter.descriptor.accountMode === 'single' &&
      existingAccounts.some((row) => row.external_account_id !== result.externalAccountId)
    ) {
      throw new RuntimeError(
        'CONFLICT',
        `${adapter.descriptor.displayName} only supports one connected account`,
      )
    }
    const enabledCapabilities = result.enabledCapabilities ?? requestedCapabilities
    validateCapabilityIds(adapter.descriptor, enabledCapabilities)
    const credentialRef =
      result.credential != null
        ? this.tokens.createRef(adapter.descriptor.pluginId, runtimeId, result.externalAccountId)
        : (existing?.credential_ref ?? null)
    if (result.credential != null && credentialRef != null) {
      const oauthClientId = stringConfigValue(safeRequest.config, 'oauthClientId')
      await this.tokens.save(credentialRef, {
        ...result.credential,
        ...(result.credential.clientId == null && oauthClientId != null
          ? { clientId: oauthClientId }
          : {}),
      })
    }
    const row = this.accounts.upsert({
      id: existing?.id ?? randomUUID(),
      pluginId: adapter.descriptor.pluginId,
      runtimeId,
      provider: adapter.descriptor.provider,
      externalAccountId: result.externalAccountId,
      displayName: result.displayName,
      ...(result.avatarUrl !== undefined ? { avatarUrl: result.avatarUrl } : {}),
      authMethod: safeRequest.authMethod,
      status: 'connected',
      enabled: true,
      grantedScopes: result.grantedScopes ?? [],
      enabledCapabilities,
      resourceScope: sanitizeMetadataRecord(
        result.resourceScope ?? safeRequest.resourceScope ?? {},
      ),
      config: sanitizeMetadataRecord(result.config ?? safeRequest.config ?? {}),
      credentialRef,
      ...(result.tokenExpiresAt !== undefined ? { tokenExpiresAt: result.tokenExpiresAt } : {}),
      lastError: null,
    })
    if (this.accounts.getDefault(adapter.descriptor.pluginId, runtimeId) == null) {
      this.accounts.setDefault(adapter.descriptor.pluginId, runtimeId, row.id)
    }
    return this.toAccount(row)
  }

  async disconnect(runtimeId: string, accountId: string): Promise<void> {
    const context = await this.getContext(runtimeId, accountId, false, true)
    await context.adapter.disconnect?.(context.runtime)
    await this.tokens.delete(context.row.credential_ref)
    const wasDefault = this.accounts.getDefault(context.row.plugin_id, runtimeId) === accountId
    if (wasDefault) this.accounts.clearDefault(context.row.plugin_id, runtimeId)
    this.accounts.delete(accountId)
    this.removeLegacyAccountAfterDisconnect(context.row)
  }

  updateAccount(
    runtimeId: string,
    accountId: string,
    request: RuntimeUpdateAccountRequest,
  ): ConnectorAccount {
    this.requireRow(runtimeId, accountId)
    const adapter = this.registry.require(runtimeId)
    const enabledCapabilities =
      request.enabledCapabilities === undefined
        ? undefined
        : validateCapabilityIds(adapter.descriptor, request.enabledCapabilities)
    const updated = this.accounts.update(accountId, {
      ...(request.enabled !== undefined
        ? { enabled: request.enabled, status: request.enabled ? 'connected' : 'disabled' }
        : {}),
      ...(request.config !== undefined ? { config: sanitizeMetadataRecord(request.config) } : {}),
      ...(enabledCapabilities !== undefined ? { enabledCapabilities } : {}),
      ...(request.resourceScope !== undefined
        ? { resourceScope: sanitizeMetadataRecord(request.resourceScope) }
        : {}),
    })
    if (updated == null) throw new RuntimeError('RUNTIME_UNAVAILABLE', 'Account update failed')
    return this.toAccount(updated)
  }

  setDefault(runtimeId: string, accountId: string): ConnectorAccount {
    const row = this.requireRow(runtimeId, accountId)
    this.accounts.setDefault(row.plugin_id, runtimeId, accountId)
    return this.toAccount(row)
  }

  async healthCheck(runtimeId: string, accountId: string): Promise<RuntimeHealth> {
    const context = await this.getContext(runtimeId, accountId, false)
    const checkedAt = new Date().toISOString()
    try {
      const health = await context.adapter.healthCheck(context.runtime)
      this.accounts.update(accountId, {
        lastHealthAt: health.checkedAt,
        status:
          health.status === 'needs-auth'
            ? 'needs_auth'
            : health.status === 'healthy'
              ? 'connected'
              : 'error',
        lastError: health.message ?? null,
      })
      return health
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Health check failed'
      this.accounts.update(accountId, {
        lastHealthAt: checkedAt,
        status: 'error',
        lastError: message,
      })
      throw error
    }
  }

  async listTools(runtimeId: string, accountId?: string): Promise<RuntimeToolDefinition[]> {
    const context = await this.getContext(runtimeId, accountId, true)
    return context.adapter.listTools(context.runtime)
  }

  async listAvailableTools(
    runtimeId: string,
    accountId?: string,
  ): Promise<RuntimeToolDefinition[]> {
    const adapter = this.registry.require(runtimeId)
    this.ensureLegacyCompatibility(adapter.descriptor)
    const accounts = accountId
      ? [this.resolveAccount(adapter.descriptor, accountId)]
      : this.accounts.list(adapter.descriptor.pluginId, adapter.descriptor.id)
    const connected = accounts.filter((row) => row.enabled === 1 && row.status === 'connected')
    if (connected.length === 0) return []
    const firstConnected = connected[0]
    if (firstConnected == null) return []
    const tools = await this.listTools(runtimeId, firstConnected.id)
    return tools.filter((tool) =>
      connected.some((row) => {
        const account = this.toAccount(row)
        return tool.requiredCapabilities.every((capability) => {
          try {
            this.policy.requireCapability(adapter.descriptor, account, capability)
            return true
          } catch {
            return false
          }
        })
      }),
    )
  }

  async invoke(request: RuntimeToolInvokeRequest): Promise<unknown> {
    const context = await this.getContext(request.runtimeId, request.accountId, true)
    const tool = (await context.adapter.listTools(context.runtime)).find(
      (item) => item.name === request.toolName,
    )
    if (tool == null)
      throw new RuntimeError('RUNTIME_UNAVAILABLE', `Runtime tool not found: ${request.toolName}`)
    try {
      for (const capability of tool.requiredCapabilities) {
        this.policy.requireCapability(
          context.runtime.descriptor,
          context.runtime.account,
          capability,
        )
      }
      this.policy.requireRiskApproval(tool.risk, request.confirmationToken, {
        runtimeId: request.runtimeId,
        accountId: context.runtime.account.id,
        toolName: tool.name,
      })
    } catch (error) {
      this.audit.record({
        ...this.auditParams(context, tool),
        outcome: 'denied',
        durationMs: 0,
        ...(error instanceof RuntimeError ? { errorCode: error.code } : {}),
      })
      throw error
    }
    const startedAt = performance.now()
    try {
      const result = await context.adapter.invokeTool(context.runtime, tool.name, request.input)
      this.audit.record({
        ...this.auditParams(context, tool),
        outcome: 'success',
        durationMs: performance.now() - startedAt,
      })
      return result
    } catch (error) {
      const errorCode = error instanceof RuntimeError ? error.code : undefined
      this.audit.record({
        ...this.auditParams(context, tool),
        outcome: 'error',
        durationMs: performance.now() - startedAt,
        ...(errorCode ? { errorCode } : {}),
      })
      throw error
    }
  }

  issueConfirmation(
    runtimeId: string,
    accountId: string,
    toolName: string,
    ttlMs = 60_000,
  ): { token: string; expiresAt: string } {
    this.requireRow(runtimeId, accountId)
    const token = randomUUID()
    const expiresAt = Date.now() + Math.max(1_000, Math.min(ttlMs, 5 * 60_000))
    this.confirmations.set(token, { runtimeId, accountId, toolName, expiresAt })
    return { token, expiresAt: new Date(expiresAt).toISOString() }
  }

  private async getContext(
    runtimeId: string,
    accountId: string | undefined,
    requireAuth: boolean,
    allowDisabled = false,
  ): Promise<{
    adapter: ConnectorRuntimeAdapter
    runtime: RuntimeContext
    row: ConnectorAccountRow
  }> {
    const adapter = this.registry.require(runtimeId)
    if (!allowDisabled) this.policy.requireRuntimeEnabled(adapter.descriptor)
    this.ensureLegacyCompatibility(adapter.descriptor)
    const row = this.resolveAccount(adapter.descriptor, accountId)
    const account = this.toAccount(row)
    if (requireAuth) this.policy.requireAccountUsable(account)
    const http = new RuntimeHttpClient({
      ...(this.fetchImpl ? { fetchImpl: this.fetchImpl } : {}),
      accessToken: () =>
        this.tokens.withAccessToken(
          row.credential_ref,
          async (token) => token,
          (bundle) => this.refreshCredentials(row, bundle),
        ),
    })
    return {
      adapter,
      row,
      runtime: {
        descriptor: adapter.descriptor,
        account,
        row,
        http,
        credentials: this.tokens,
        policy: this.policy,
        refreshCredentials: (bundle) => this.refreshCredentials(row, bundle),
      },
    }
  }

  private resolveAccount(
    descriptor: ConnectorRuntimeDescriptor,
    accountId?: string,
  ): ConnectorAccountRow {
    if (accountId != null) {
      const row = this.accounts.get(accountId)
      if (row == null || row.runtime_id !== descriptor.id || row.plugin_id !== descriptor.pluginId)
        throw new RuntimeError('ACCOUNT_REQUIRED', 'Requested runtime account was not found')
      return row
    }
    const rows = this.accounts.list(descriptor.pluginId, descriptor.id)
    if (rows.length === 0)
      throw new RuntimeError(
        'ACCOUNT_REQUIRED',
        `${descriptor.displayName} has no connected account`,
      )
    const defaultId = this.accounts.getDefault(descriptor.pluginId, descriptor.id)
    if (defaultId != null) {
      const row = rows.find((item) => item.id === defaultId)
      if (row != null) return row
    }
    if (rows.length > 1)
      throw new RuntimeError(
        'ACCOUNT_SELECTION_REQUIRED',
        `${descriptor.displayName} has multiple accounts; choose one`,
      )
    const only = rows[0]
    if (only == null) throw new RuntimeError('ACCOUNT_REQUIRED', 'Runtime account was not found')
    return only
  }

  private requireRow(runtimeId: string, accountId: string): ConnectorAccountRow {
    const adapter = this.registry.require(runtimeId)
    const row = this.accounts.get(accountId)
    if (
      row == null ||
      row.runtime_id !== runtimeId ||
      row.plugin_id !== adapter.descriptor.pluginId
    )
      throw new RuntimeError('ACCOUNT_REQUIRED', 'Runtime account was not found')
    return row
  }

  private isEnabled(descriptor: ConnectorRuntimeDescriptor): boolean {
    return this.isPluginEnabled?.(descriptor.pluginId, descriptor.id) ?? true
  }

  private async refreshCredentials(
    row: ConnectorAccountRow,
    bundle: import('./token-service.js').StoredCredentialBundle,
  ): Promise<import('./token-service.js').StoredCredentialBundle> {
    const refreshToken = bundle.refreshToken
    const config = parseObject(row.config_json)
    const clientId = bundle.clientId ?? stringConfigValue(config, 'oauthClientId')
    const tokenUrl = stringConfigValue(config, 'oauthTokenUrl')
    if (refreshToken == null || clientId == null || tokenUrl == null)
      throw new RuntimeError('AUTH_EXPIRED', 'Provider authorization requires reconnecting')
    return this.oauth.refresh({ clientId, tokenUrl }, refreshToken).then((updated) => ({
      ...updated,
      clientId,
      ...(updated.scopes == null ? { scopes: parseArray(row.granted_scopes_json) } : {}),
    }))
  }

  private ensureLegacyCompatibility(descriptor: ConnectorRuntimeDescriptor): void {
    const pluginExists = this.db.raw
      .prepare('SELECT 1 FROM plugins WHERE id = ? LIMIT 1')
      .get(descriptor.pluginId)
    if (pluginExists == null) return
    const legacy = new ConnectorConnectionRepository(this.db).getByProvider(descriptor.provider)
    const existingAccounts = this.accounts.list(descriptor.pluginId, descriptor.id)
    if (existingAccounts.length > 0) {
      for (const account of existingAccounts) {
        const currentCapabilities = parseArray(account.enabled_capabilities_json)
        const normalizedCapabilities = normalizeRuntimeCapabilities(
          descriptor,
          currentCapabilities,
          currentCapabilities.length > 0,
        )
        if (
          normalizedCapabilities.length !== currentCapabilities.length ||
          normalizedCapabilities.some(
            (capability, index) => capability !== currentCapabilities[index],
          )
        ) {
          this.accounts.update(account.id, { enabledCapabilities: normalizedCapabilities })
        }
      }
      return
    }
    if (legacy == null) return
    const account = parseObject(legacy.account_json)
    const config = parseObject(legacy.config_json)
    const externalAccountId =
      typeof account.id === 'string' && account.id.length > 0 ? account.id : legacy.id
    const configuredCapabilities = parseArray(config.enabledCapabilities)
    const migratedCapabilities = normalizeRuntimeCapabilities(
      descriptor,
      configuredCapabilities,
      true,
    )
    const row = this.accounts.upsert({
      id: `runtime-${legacy.id}`,
      pluginId: descriptor.pluginId,
      runtimeId: descriptor.id,
      provider: descriptor.provider,
      externalAccountId,
      displayName: legacyAccountDisplayName(account, legacy.name),
      ...(typeof account.avatarUrl === 'string' ? { avatarUrl: account.avatarUrl } : {}),
      authMethod: legacy.auth_method,
      status: legacy.status,
      enabled: legacy.enabled === 1,
      grantedScopes: parseArray(legacy.granted_scopes_json),
      enabledCapabilities:
        migratedCapabilities.length > 0
          ? migratedCapabilities
          : this.defaultCapabilities(descriptor),
      resourceScope: { repos: parseArray(config.selectedRepos) },
      config,
      credentialRef: legacy.keystore_ref,
      lastError: legacy.last_error,
    })
    if (this.accounts.getDefault(descriptor.pluginId, descriptor.id) == null)
      this.accounts.setDefault(descriptor.pluginId, descriptor.id, row.id)
  }

  private removeLegacyAccountAfterDisconnect(row: ConnectorAccountRow): void {
    const legacy = new ConnectorConnectionRepository(this.db).getByProvider(row.provider)
    if (legacy != null && row.id === `runtime-${legacy.id}`) {
      new ConnectorConnectionRepository(this.db).delete(legacy.id)
    }
  }

  private defaultCapabilities(descriptor: ConnectorRuntimeDescriptor): string[] {
    return descriptor.capabilities.filter((item) => item.enabledByDefault).map((item) => item.id)
  }

  private toAccount(row: ConnectorAccountRow): ConnectorAccount {
    return {
      id: row.id,
      pluginId: row.plugin_id,
      runtimeId: row.runtime_id,
      provider: row.provider,
      externalAccountId: row.external_account_id,
      displayName: row.display_name,
      ...(row.avatar_url != null ? { avatarUrl: row.avatar_url } : {}),
      authMethod: row.auth_method as ConnectorAccount['authMethod'],
      status: row.status as ConnectorAccount['status'],
      enabled: row.enabled === 1,
      grantedScopes: parseArray(row.granted_scopes_json),
      enabledCapabilities: parseArray(row.enabled_capabilities_json),
      resourceScope: parseObject(row.resource_scope_json),
      config: parseObject(row.config_json),
      ...(row.token_expires_at != null ? { tokenExpiresAt: row.token_expires_at } : {}),
      ...(row.last_health_at != null ? { lastHealthAt: row.last_health_at } : {}),
      ...(row.last_error != null ? { lastError: row.last_error } : {}),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }
  }

  private auditParams(context: { runtime: RuntimeContext }, tool: RuntimeToolDefinition) {
    return {
      pluginId: context.runtime.descriptor.pluginId,
      runtimeId: context.runtime.descriptor.id,
      accountId: context.runtime.account.id,
      tool,
    }
  }

  private consumeConfirmation(
    token: string | undefined,
    request: { runtimeId: string; accountId: string; toolName: string },
  ): boolean {
    if (token == null) return false
    const record = this.confirmations.get(token)
    if (record == null) return false
    this.confirmations.delete(token)
    return (
      record.expiresAt > Date.now() &&
      record.runtimeId === request.runtimeId &&
      record.accountId === request.accountId &&
      record.toolName === request.toolName
    )
  }
}

function parseArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === 'string')
  if (typeof value !== 'string') return []
  try {
    const parsed = JSON.parse(value) as unknown
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === 'string')
      : []
  } catch {
    return []
  }
}

function normalizeRuntimeCapabilities(
  descriptor: ConnectorRuntimeDescriptor,
  capabilities: readonly string[],
  fallbackOnEmpty: boolean,
): string[] {
  const known = new Set(descriptor.capabilities.map((capability) => capability.id))
  const normalized = [...new Set(capabilities)].filter((capability) => known.has(capability))
  if (normalized.length > 0 || !fallbackOnEmpty) return normalized
  return descriptor.capabilities
    .filter((capability) => capability.enabledByDefault)
    .map((capability) => capability.id)
}

function parseObject(value: unknown): Record<string, unknown> {
  if (typeof value !== 'string') return {}
  try {
    const parsed = JSON.parse(value) as unknown
    return parsed != null && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {}
  } catch {
    return {}
  }
}

function legacyAccountDisplayName(account: Record<string, unknown>, fallback: string): string {
  for (const key of ['displayName', 'login', 'email', 'name', 'username', 'vaultName']) {
    const value = account[key]
    if (typeof value === 'string' && value.trim().length > 0) return value.trim()
  }
  return fallback
}

function stringConfigValue(value: Record<string, unknown> | undefined, key: string): string | null {
  const candidate = value?.[key]
  return typeof candidate === 'string' && candidate.trim().length > 0 ? candidate.trim() : null
}

const SENSITIVE_METADATA_KEY =
  /(?:^|[_-])(access[_-]?token|refresh[_-]?token|token|secret|password|authorization|cookie|credential|private[_-]?key)(?:$|[_-])/i

function sanitizeConnectRequest(request: RuntimeConnectRequest): RuntimeConnectRequest {
  const secrets = request.secrets == null ? undefined : validateSecrets(request.secrets)
  const config = request.config == null ? undefined : sanitizeMetadataRecord(request.config)
  const resourceScope =
    request.resourceScope == null ? undefined : sanitizeMetadataRecord(request.resourceScope)
  return {
    authMethod: request.authMethod,
    ...(secrets !== undefined ? { secrets } : {}),
    ...(config !== undefined ? { config } : {}),
    ...(request.enabledCapabilities !== undefined
      ? { enabledCapabilities: [...request.enabledCapabilities] }
      : {}),
    ...(resourceScope !== undefined ? { resourceScope } : {}),
  }
}

function validateCapabilityIds(
  descriptor: ConnectorRuntimeDescriptor,
  capabilities: readonly string[],
): string[] {
  const known = new Set(descriptor.capabilities.map((capability) => capability.id))
  const normalized = [...new Set(capabilities)]
  const unknown = normalized.filter((capability) => !known.has(capability))
  if (unknown.length > 0) {
    throw new RuntimeError(
      'CAPABILITY_DISABLED',
      `Unknown runtime capability: ${unknown[0] ?? 'unknown'}`,
    )
  }
  return normalized
}

function validateSecrets(value: Record<string, string>): Record<string, string> {
  const entries = Object.entries(value)
  if (entries.length > 32) throw new RuntimeError('AUTH_REQUIRED', 'Too many provider secrets')
  for (const [name, secret] of entries) {
    if (name.length > 120 || secret.length > 16_000)
      throw new RuntimeError('AUTH_REQUIRED', 'Provider secret exceeds the runtime limit')
  }
  return { ...value }
}

function sanitizeMetadataRecord(value: Record<string, unknown>): Record<string, unknown> {
  const result = sanitizeMetadataValue(value, 'metadata', 0)
  if (result == null || typeof result !== 'object' || Array.isArray(result)) return {}
  return result as Record<string, unknown>
}

function sanitizeMetadataValue(value: unknown, path: string, depth: number): unknown {
  if (depth > 6)
    throw new RuntimeError('RUNTIME_UNAVAILABLE', 'Runtime metadata is too deeply nested')
  if (
    value == null ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    if (typeof value === 'string' && value.length > 16_000)
      throw new RuntimeError('RUNTIME_UNAVAILABLE', `Runtime metadata is too large: ${path}`)
    return value
  }
  if (Array.isArray(value)) {
    if (value.length > 256)
      throw new RuntimeError('RUNTIME_UNAVAILABLE', `Runtime metadata array is too large: ${path}`)
    return value.map((item, index) => sanitizeMetadataValue(item, `${path}[${index}]`, depth + 1))
  }
  if (typeof value !== 'object')
    throw new RuntimeError('RUNTIME_UNAVAILABLE', `Unsupported runtime metadata value: ${path}`)
  const entries = Object.entries(value as Record<string, unknown>)
  if (entries.length > 128)
    throw new RuntimeError('RUNTIME_UNAVAILABLE', `Runtime metadata object is too large: ${path}`)
  const result: Record<string, unknown> = {}
  for (const [key, item] of entries) {
    if (SENSITIVE_METADATA_KEY.test(key))
      throw new RuntimeError(
        'AUTH_REQUIRED',
        `Secret-like field must be sent through secrets: ${key}`,
      )
    result[key] = sanitizeMetadataValue(item, `${path}.${key}`, depth + 1)
  }
  return result
}

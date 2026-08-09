import type { ConnectorAccount, ConnectorRuntimeDescriptor, RuntimeRisk } from '@spark/protocol'
import { RuntimeError } from './runtime-errors.js'

export interface RuntimePolicyOptions {
  isPluginEnabled?: (pluginId: string, runtimeId: string) => boolean
  validateConfirmation?: (
    token: string | undefined,
    input: { runtimeId: string; accountId: string; toolName: string },
  ) => boolean
}

export class RuntimePolicy {
  constructor(private readonly options: RuntimePolicyOptions = {}) {}

  requireRuntimeEnabled(descriptor: ConnectorRuntimeDescriptor): void {
    if (this.options.isPluginEnabled?.(descriptor.pluginId, descriptor.id) === false) {
      throw new RuntimeError('PLUGIN_DISABLED', `${descriptor.displayName} plugin is disabled`)
    }
  }

  requireAccountUsable(account: ConnectorAccount): void {
    if (!account.enabled || account.status === 'disabled') {
      throw new RuntimeError(
        'PLUGIN_DISABLED',
        `Account ${account.displayName || account.id} is disabled`,
      )
    }
    if (account.status === 'needs_auth' || account.status === 'not_configured') {
      throw new RuntimeError(
        'AUTH_REQUIRED',
        `Account ${account.displayName || account.id} requires authorization`,
      )
    }
    if (account.status === 'error') {
      throw new RuntimeError(
        'RUNTIME_UNAVAILABLE',
        `Account ${account.displayName || account.id} is unhealthy`,
      )
    }
  }

  requireCapability(
    descriptor: ConnectorRuntimeDescriptor,
    account: ConnectorAccount,
    capability: string,
  ): void {
    if (!account.enabledCapabilities.includes(capability)) {
      throw new RuntimeError('CAPABILITY_DISABLED', `Capability is disabled: ${capability}`)
    }
    const descriptorCapability = descriptor.capabilities.find((item) => item.id === capability)
    if (descriptorCapability == null) {
      throw new RuntimeError('CAPABILITY_DISABLED', `Unknown runtime capability: ${capability}`)
    }
    const missingScopes = (descriptorCapability.requiredScopes ?? []).filter(
      (scope) => !account.grantedScopes.includes(scope),
    )
    if (missingScopes.length > 0) {
      throw new RuntimeError(
        'SCOPE_REQUIRED',
        `Provider authorization is missing required scope(s) for ${capability}`,
        { capability, missingScopeCount: missingScopes.length },
      )
    }
  }

  requireResource(account: ConnectorAccount, type: string, value: string): void {
    const configured = account.resourceScope[type]
    if (!Array.isArray(configured) || configured.length === 0) return
    const normalized = value.trim().toLowerCase()
    const allowed = configured.some(
      (item) => typeof item === 'string' && item.trim().toLowerCase() === normalized,
    )
    if (!allowed) {
      throw new RuntimeError(
        'RESOURCE_OUT_OF_SCOPE',
        `Resource is outside the authorized ${type} scope`,
      )
    }
  }

  requireRiskApproval(
    risk: RuntimeRisk,
    token: string | undefined,
    request: { runtimeId: string; accountId: string; toolName: string },
  ): void {
    if (risk !== 'high-write' && risk !== 'destructive') return
    if (this.options.validateConfirmation?.(token, request) !== true) {
      throw new RuntimeError(
        'CONFIRMATION_REQUIRED',
        'This action requires an explicit confirmation preview',
      )
    }
  }
}

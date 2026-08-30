import type {
  PluginRuntimeAccountsAuthorizeRequest,
  PluginRuntimeAccountsConnectRequest,
  PluginRuntimeAccountsDisconnectRequest,
  PluginRuntimeAccountsListRequest,
  PluginRuntimeAccountsSetDefaultRequest,
  PluginRuntimeAccountsUpdateRequest,
  PluginRuntimeHealthCheckRequest,
  PluginRuntimeIssueConfirmationRequest,
  PluginRuntimeToolsListRequest,
} from '@spark/protocol'
import { shell } from 'electron'
import {
  OAuthBroker,
  PluginRuntimeMcpBridge,
  RuntimeBroker,
  registerBuiltinRuntimeAdapters,
} from '@spark/agent-runtime'
import { getDatabase } from '../../db.js'
import { getPluginManager } from '../../ipc/registerPluginIpc.js'
import { pushStreamEvent, typedIpcHandle } from '../../ipc/typed-ipc.js'

let broker: RuntimeBroker | null = null

export function getPluginRuntimeBroker(): RuntimeBroker {
  if (broker == null) {
    const pluginManager = getPluginManager()
    broker = new RuntimeBroker({
      db: getDatabase(),
      isPluginEnabled: (_pluginId, runtimeId) => pluginManager.isRuntimeEnabled(runtimeId),
    })
    registerBuiltinRuntimeAdapters(broker)
  }
  return broker
}

export function resetPluginRuntimeForTests(): void {
  broker = null
}

async function ensureRuntime(): Promise<RuntimeBroker> {
  await getPluginManager().initialize()
  return getPluginRuntimeBroker()
}

export function registerPluginRuntimeIpc(): void {
  typedIpcHandle('plugin-runtime:list', async () => ({
    runtimes: (await ensureRuntime()).listRuntimeStatus(),
  }))

  typedIpcHandle(
    'plugin-runtime:accounts:list',
    async (request: PluginRuntimeAccountsListRequest) => ({
      accounts: (await ensureRuntime()).listAccounts(request.runtimeId),
    }),
  )

  typedIpcHandle(
    'plugin-runtime:accounts:connect',
    async (request: PluginRuntimeAccountsConnectRequest) => {
      const account = await (await ensureRuntime()).connect(request.runtimeId, request.request)
      pushStreamEvent('stream:config:changed', {
        scope: 'plugin',
        action: 'update',
        id: account.pluginId,
      })
      return { account }
    },
  )

  typedIpcHandle(
    'plugin-runtime:accounts:authorize',
    async (request: PluginRuntimeAccountsAuthorizeRequest) => {
      const runtime = await ensureRuntime()
      const tokens = await new OAuthBroker().authorize({
        clientId: request.clientId,
        authorizationUrl: request.authorizationUrl,
        tokenUrl: request.tokenUrl,
        scopes: request.scopes,
        ...(request.redirectPath !== undefined ? { redirectPath: request.redirectPath } : {}),
        ...(request.extraAuthorizationParams !== undefined
          ? { extraAuthorizationParams: request.extraAuthorizationParams }
          : {}),
        authorizeExternal: async (url) => shell.openExternal(url),
      })
      const config = {
        ...(request.config ?? {}),
        oauthClientId: request.clientId,
        oauthAuthorizationUrl: request.authorizationUrl,
        oauthTokenUrl: request.tokenUrl,
        // A provider that omits `scope` must not be treated as having granted
        // every requested scope. The runtime policy will keep those tools
        // unavailable until the provider reports the actual grant.
        grantedScopes: tokens.scopes ?? [],
      }
      const account = await runtime.connect(request.runtimeId, {
        authMethod: 'oauth2',
        secrets: {
          accessToken: tokens.accessToken,
          ...(tokens.refreshToken !== undefined ? { refreshToken: tokens.refreshToken } : {}),
          ...(tokens.expiresAt !== undefined ? { expiresAt: tokens.expiresAt } : {}),
        },
        config,
        ...(request.enabledCapabilities !== undefined
          ? { enabledCapabilities: request.enabledCapabilities }
          : {}),
        ...(request.resourceScope !== undefined ? { resourceScope: request.resourceScope } : {}),
      })
      pushStreamEvent('stream:config:changed', {
        scope: 'plugin',
        action: 'update',
        id: account.pluginId,
      })
      return { account }
    },
  )

  typedIpcHandle(
    'plugin-runtime:accounts:update',
    async (request: PluginRuntimeAccountsUpdateRequest) => {
      const account = (await ensureRuntime()).updateAccount(
        request.runtimeId,
        request.accountId,
        request.request,
      )
      pushStreamEvent('stream:config:changed', {
        scope: 'plugin',
        action: 'update',
        id: account.pluginId,
      })
      return { account }
    },
  )

  typedIpcHandle(
    'plugin-runtime:accounts:disconnect',
    async (request: PluginRuntimeAccountsDisconnectRequest) => {
      await (await ensureRuntime()).disconnect(request.runtimeId, request.accountId)
      pushStreamEvent('stream:config:changed', {
        scope: 'plugin',
        action: 'update',
        id: request.accountId,
      })
      return { disconnected: true }
    },
  )

  typedIpcHandle(
    'plugin-runtime:accounts:set-default',
    async (request: PluginRuntimeAccountsSetDefaultRequest) => ({
      account: (await ensureRuntime()).setDefault(request.runtimeId, request.accountId),
    }),
  )

  typedIpcHandle(
    'plugin-runtime:health-check',
    async (request: PluginRuntimeHealthCheckRequest) => ({
      health: await (await ensureRuntime()).healthCheck(request.runtimeId, request.accountId),
    }),
  )

  typedIpcHandle('plugin-runtime:tools:list', async (request: PluginRuntimeToolsListRequest) => ({
    tools: await (await ensureRuntime()).listTools(request.runtimeId, request.accountId),
  }))

  typedIpcHandle(
    'plugin-runtime:issue-confirmation',
    async (request: PluginRuntimeIssueConfirmationRequest) =>
      (await ensureRuntime()).issueConfirmation(
        request.runtimeId,
        request.accountId,
        request.toolName,
        request.ttlMs,
      ),
  )
}

/** Main-process owner for Agent sessions. The MCP handle is per session/turn. */
export async function createPluginRuntimeMcpBridge(): Promise<PluginRuntimeMcpBridge> {
  return new PluginRuntimeMcpBridge(await ensureRuntime())
}

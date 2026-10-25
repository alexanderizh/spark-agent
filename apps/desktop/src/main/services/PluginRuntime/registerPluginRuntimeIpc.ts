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
import type { ConnectorAccount } from '@spark/protocol'
import { shell } from 'electron'
import {
  OAuthBroker,
  PluginRuntimeMcpBridge,
  RuntimeBroker,
  registerBuiltinRuntimeAdapters,
} from '@spark/agent-runtime'
import { getDatabase } from '../../db.js'
import { createLogger } from '@spark/shared'
import { getPluginManager } from '../../ipc/registerPluginIpc.js'
import { pushStreamEvent, typedIpcHandle } from '../../ipc/typed-ipc.js'

let broker: RuntimeBroker | null = null
const log = createLogger('plugin-runtime:ipc')

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
      const oauth = oauthConfigFor(request)
      const runtime = await ensureRuntime()
      let account: ConnectorAccount
      try {
        const tokens = await new OAuthBroker().authorize({
          clientId: request.clientId,
          ...(request.clientSecret ? { clientSecret: request.clientSecret } : {}),
          authorizationUrl: oauth.authorizationUrl,
          tokenUrl: oauth.tokenUrl,
          scopes: request.scopes,
          ...(request.redirectPath !== undefined ? { redirectPath: request.redirectPath } : {}),
          ...(oauth.redirectUri !== undefined ? { redirectUri: oauth.redirectUri } : {}),
          ...(oauth.tokenExchangeMode !== undefined
            ? { tokenExchangeMode: oauth.tokenExchangeMode }
            : {}),
          ...(oauth.usePkce !== undefined ? { usePkce: oauth.usePkce } : {}),
          ...(oauth.extraAuthorizationParams !== undefined
            ? { extraAuthorizationParams: oauth.extraAuthorizationParams }
            : {}),
          authorizeExternal: async (url) => shell.openExternal(url),
        })
        const config = {
          ...(request.config ?? {}),
          oauthClientId: request.clientId,
          oauthAuthorizationUrl: oauth.authorizationUrl,
          oauthTokenUrl: oauth.tokenUrl,
          ...(oauth.redirectUri !== undefined ? { oauthRedirectUri: oauth.redirectUri } : {}),
          ...(oauth.tokenExchangeMode !== undefined
            ? { oauthTokenExchangeMode: oauth.tokenExchangeMode }
            : {}),
          // A provider that omits `scope` must not be treated as having granted
          // every requested scope. The runtime policy will keep those tools
          // unavailable until the provider reports the actual grant.
          grantedScopes: tokens.scopes ?? [],
        }
        account = await runtime.connect(request.runtimeId, {
          authMethod: 'oauth2',
          secrets: {
            accessToken: tokens.accessToken,
            ...(tokens.refreshToken !== undefined ? { refreshToken: tokens.refreshToken } : {}),
            ...(tokens.expiresAt !== undefined ? { expiresAt: tokens.expiresAt } : {}),
            ...(request.clientSecret !== undefined ? { clientSecret: request.clientSecret } : {}),
          },
          config,
          ...(request.enabledCapabilities !== undefined
            ? { enabledCapabilities: request.enabledCapabilities }
            : {}),
          ...(request.resourceScope !== undefined ? { resourceScope: request.resourceScope } : {}),
        })
      } catch (error) {
        log.warn(
          `connector oauth failed runtime=${request.runtimeId} code=${oauthFailureCode(error)}`,
        )
        throw error
      }
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

function oauthConfigFor(request: PluginRuntimeAccountsAuthorizeRequest): {
  authorizationUrl: string
  tokenUrl: string
  redirectUri?: string
  tokenExchangeMode?: 'form' | 'notion'
  usePkce?: boolean
  extraAuthorizationParams?: Record<string, string>
} {
  if (request.runtimeId === 'google') {
    if (
      request.authorizationUrl !== 'https://accounts.google.com/o/oauth2/v2/auth' ||
      request.tokenUrl !== 'https://oauth2.googleapis.com/token' ||
      request.clientSecret != null ||
      request.redirectUri != null
    ) {
      throw new Error('Google OAuth endpoint configuration is invalid')
    }
    return {
      authorizationUrl: request.authorizationUrl,
      tokenUrl: request.tokenUrl,
      extraAuthorizationParams: {
        ...request.extraAuthorizationParams,
        access_type: request.extraAuthorizationParams?.access_type ?? 'offline',
      },
    }
  }
  if (request.runtimeId === 'notion') {
    if (
      request.authorizationUrl !== 'https://api.notion.com/v1/oauth/authorize' ||
      request.tokenUrl !== 'https://api.notion.com/v1/oauth/token' ||
      request.clientSecret == null ||
      request.redirectUri == null
    ) {
      throw new Error(
        'Notion OAuth requires its official endpoints, Client Secret, and registered redirect URI',
      )
    }
    return {
      authorizationUrl: request.authorizationUrl,
      tokenUrl: request.tokenUrl,
      redirectUri: request.redirectUri,
      tokenExchangeMode: 'notion',
      usePkce: false,
      extraAuthorizationParams: { ...request.extraAuthorizationParams, owner: 'user' },
    }
  }
  throw new Error(`OAuth is not supported by runtime ${request.runtimeId}`)
}

function oauthFailureCode(error: unknown): string {
  if (typeof error === 'object' && error != null && 'code' in error) {
    const code = (error as { code?: unknown }).code
    return typeof code === 'string' ? code : 'UNKNOWN'
  }
  return 'UNKNOWN'
}

/** Main-process owner for Agent sessions. The MCP handle is per session/turn. */
export async function createPluginRuntimeMcpBridge(): Promise<PluginRuntimeMcpBridge> {
  return new PluginRuntimeMcpBridge(await ensureRuntime())
}

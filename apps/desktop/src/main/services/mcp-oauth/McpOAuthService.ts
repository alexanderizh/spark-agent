import { createServer, type Server } from 'node:http'
import { randomBytes } from 'node:crypto'
import {
  auth,
  discoverOAuthServerInfo,
  refreshAuthorization,
} from '@modelcontextprotocol/sdk/client/auth.js'
import type { OAuthClientInformationMixed, OAuthTokens } from '@modelcontextprotocol/sdk/shared/auth.js'
import type { OAuthDiscoveryState } from '@modelcontextprotocol/sdk/client/auth.js'
import { createLogger } from '@spark/shared'
import { SparkMcpOAuthProvider, type McpOAuthStore, type SparkOAuthTokens } from '@spark/agent-runtime'

const log = createLogger('mcp:oauth')
const REFRESH_SKEW_SECONDS = 120
const AUTHORIZE_TIMEOUT_MS = 180_000

export type McpOAuthStatus = 'unconfigured' | 'needs-auth' | 'authorizing' | 'authorized' | 'failed'

type OAuthConfig = {
  type?: string
  scope?: string
  dcr?: boolean
  clientId?: string
  clientSecret?: string
}

type ServerConfig = { url?: string; auth?: OAuthConfig }
type McpServerLike = { id: string; configJson: string }

export interface McpOAuthServerSource { get(id: string): McpServerLike | null | undefined }

export class DesktopMcpOAuthStore implements McpOAuthStore {
  private stores = new Map<string, import('../Auth/TokenStore.js').TokenStore>()

  async getTokens(serverId: string): Promise<SparkOAuthTokens | undefined> { return await this.read(serverId, 'tokens') }
  async saveTokens(serverId: string, tokens: SparkOAuthTokens): Promise<void> { await this.write(serverId, 'tokens', tokens) }
  async clearTokens(serverId: string): Promise<void> { await this.remove(serverId, 'tokens') }
  async getClientInformation(serverId: string): Promise<OAuthClientInformationMixed | undefined> { return await this.read(serverId, 'client_information') }
  async saveClientInformation(serverId: string, info: OAuthClientInformationMixed): Promise<void> { await this.write(serverId, 'client_information', info) }
  async clearClientInformation(serverId: string): Promise<void> { await this.remove(serverId, 'client_information') }
  async getDiscoveryState(serverId: string): Promise<OAuthDiscoveryState | undefined> { return await this.read(serverId, 'discovery_state') }
  async saveDiscoveryState(serverId: string, state: OAuthDiscoveryState): Promise<void> { await this.write(serverId, 'discovery_state', state) }
  async clearDiscoveryState(serverId: string): Promise<void> { await this.remove(serverId, 'discovery_state') }
  async clearAll(serverId: string): Promise<void> { await (await this.store(serverId)).clear() }

  private async store(serverId: string) {
    let store = this.stores.get(serverId)
    if (store == null) {
      const { TokenStore } = await import('../Auth/TokenStore.js')
      store = new TokenStore(`spark-mcp-oauth:${serverId}`)
      await store.load()
      this.stores.set(serverId, store)
    }
    return store
  }

  private async payload(serverId: string): Promise<Record<string, unknown>> {
    const session = (await this.store(serverId)).get() as Record<string, unknown>
    if (typeof session.token !== 'string' || session.token.trim().length === 0) return {}
    try {
      const parsed = JSON.parse(session.token) as unknown
      return parsed != null && typeof parsed === 'object' ? parsed as Record<string, unknown> : {}
    } catch (err) {
      log.warn(`Ignoring corrupted MCP OAuth secure payload for ${serverId}: ${err instanceof Error ? err.message : String(err)}`)
      return {}
    }
  }

  private async read<T>(serverId: string, key: string): Promise<T | undefined> {
    const payload = await this.payload(serverId)
    const raw = payload[key]
    if (typeof raw !== 'string') return undefined
    try { return JSON.parse(raw) as T } catch { return undefined }
  }

  private async write(serverId: string, key: string, value: unknown): Promise<void> {
    const store = await this.store(serverId)
    const payload = await this.payload(serverId)
    await store.save({ token: JSON.stringify({ ...payload, [key]: JSON.stringify(value) }), refreshToken: 'mcp-oauth', userId: serverId })
  }

  private async remove(serverId: string, key: string): Promise<void> {
    const store = await this.store(serverId)
    const payload = await this.payload(serverId)
    delete payload[key]
    await store.save({ token: JSON.stringify(payload), refreshToken: 'mcp-oauth', userId: serverId })
  }
}

export class McpOAuthService {
  private readonly authorizing = new Set<string>()
  private readonly failed = new Map<string, string>()

  constructor(
    private readonly source: McpOAuthServerSource,
    private readonly store: McpOAuthStore = new DesktopMcpOAuthStore(),
  ) {}

  async saveStaticClient(serverId: string, client: { clientId?: string; clientSecret?: string }): Promise<void> {
    const clientId = client.clientId?.trim()
    if (!clientId) return
    const existing = await this.store.getClientInformation(serverId)
    const existingSecret = existing != null && 'client_secret' in existing && typeof existing.client_secret === 'string'
      ? existing.client_secret
      : undefined
    const clientSecret = client.clientSecret != null && client.clientSecret.length > 0 ? client.clientSecret : existingSecret
    await this.store.saveClientInformation(serverId, {
      client_id: clientId,
      ...(clientSecret != null && clientSecret.length > 0 ? { client_secret: clientSecret } : {}),
    })
  }

  async getAccessToken(serverId: string): Promise<string | null> {
    const server = this.source.get(serverId)
    const cfg = parseServerConfig(server?.configJson)
    if (cfg?.auth?.type !== 'oauth2' || cfg.url == null) return null
    const tokens = await this.refreshIfNeeded(serverId, cfg)
    return tokens?.access_token ?? null
  }

  async refreshIfNeeded(serverId: string, cfg = parseServerConfig(this.source.get(serverId)?.configJson)): Promise<SparkOAuthTokens | undefined> {
    if (cfg?.auth?.type !== 'oauth2' || cfg.url == null) return undefined
    const tokens = await this.store.getTokens(serverId)
    if (tokens?.access_token == null) return undefined
    if (tokens.expires_at == null || tokens.expires_at - nowSeconds() > REFRESH_SKEW_SECONDS) return tokens
    if (tokens.refresh_token == null) {
      await this.store.clearTokens(serverId)
      this.failed.set(serverId, 'OAuth token expired and no refresh token is available')
      return undefined
    }
    try {
      const clientInformation = await this.store.getClientInformation(serverId)
      if (clientInformation == null) throw new Error('OAuth client information is missing')
      const serverInfo = await discoverOAuthServerInfo(cfg.url)
      const refreshed = await refreshAuthorization(serverInfo.authorizationServerUrl, {
        ...(serverInfo.authorizationServerMetadata != null ? { metadata: serverInfo.authorizationServerMetadata } : {}),
        clientInformation,
        refreshToken: tokens.refresh_token,
        ...(serverInfo.resourceMetadata?.resource != null ? { resource: new URL(serverInfo.resourceMetadata.resource) } : {}),
      })
      const saved = withExpiresAt({ ...refreshed, refresh_token: refreshed.refresh_token ?? tokens.refresh_token })
      await this.store.saveTokens(serverId, saved)
      this.failed.delete(serverId)
      return saved
    } catch (err) {
      await this.store.clearTokens(serverId)
      const message = err instanceof Error ? err.message : String(err)
      this.failed.set(serverId, message)
      log.warn(`MCP OAuth refresh failed for ${serverId}: ${message}`)
      return undefined
    }
  }

  async getAuthStatus(serverId: string): Promise<McpOAuthStatus> {
    if (this.authorizing.has(serverId)) return 'authorizing'
    const server = this.source.get(serverId)
    const cfg = parseServerConfig(server?.configJson)
    if (cfg?.auth?.type !== 'oauth2') return 'unconfigured'
    return (await this.getAccessToken(serverId)) != null ? 'authorized' : this.failed.has(serverId) ? 'failed' : 'needs-auth'
  }

  async deauthorize(serverId: string): Promise<void> {
    await this.store.clearAll(serverId)
    this.failed.delete(serverId)
  }

  async authorize(serverId: string): Promise<void> {
    const server = this.source.get(serverId)
    const cfg = parseServerConfig(server?.configJson)
    if (server == null || cfg?.url == null || cfg.auth?.type !== 'oauth2') throw new Error('MCP OAuth server is not configured')
    if (this.authorizing.has(serverId)) throw new Error('MCP OAuth authorization is already in progress')
    if (cfg.auth.dcr === false && !cfg.auth.clientId?.trim() && (await this.store.getClientInformation(serverId)) == null) {
      throw new Error('OAuth static client_id is required when DCR is disabled')
    }
    const { server: callbackServer, redirectUrl, waitForCode } = await createLoopbackCallback()
    const state = randomBytes(16).toString('hex')
    this.authorizing.add(serverId)
    this.failed.delete(serverId)
    try {
      const provider = new SparkMcpOAuthProvider({
        serverId,
        redirectUrl,
        store: this.store,
        ...(cfg.auth.scope != null ? { scope: cfg.auth.scope } : {}),
        ...(cfg.auth.dcr === false ? { staticClient: { ...(cfg.auth.clientId != null ? { clientId: cfg.auth.clientId } : {}), ...(cfg.auth.clientSecret != null ? { clientSecret: cfg.auth.clientSecret } : {}) } } : {}),
        state,
        onAuthorizationUrl: async (url: URL) => {
          const { shell } = await import('electron')
          await shell.openExternal(url.toString())
        },
      })
      await auth(provider, { serverUrl: cfg.url, ...(cfg.auth.scope != null ? { scope: cfg.auth.scope } : {}) })
      const params = await waitForCode
      if (params.state !== state) throw new Error('OAuth state mismatch')
      await auth(provider, { serverUrl: cfg.url, authorizationCode: params.code, ...(cfg.auth.scope != null ? { scope: cfg.auth.scope } : {}) })
      const tokens = await this.store.getTokens(serverId)
      if (tokens?.access_token == null) throw new Error('OAuth authorization completed without an access token')
      this.failed.delete(serverId)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      this.failed.set(serverId, message)
      throw err
    } finally {
      this.authorizing.delete(serverId)
      callbackServer.close()
    }
    log.info(`MCP OAuth authorization completed for ${serverId}`)
  }
}

function parseServerConfig(configJson?: string): ServerConfig | null {
  if (configJson == null) return null
  try { return JSON.parse(configJson) as ServerConfig } catch { return null }
}
function nowSeconds(): number { return Math.floor(Date.now() / 1000) }
function withExpiresAt(tokens: OAuthTokens): SparkOAuthTokens {
  const expiresAt = tokens.expires_in != null ? nowSeconds() + Number(tokens.expires_in) : undefined
  return { ...tokens, ...(expiresAt != null ? { expires_at: expiresAt } : {}) }
}

async function createLoopbackCallback(): Promise<{ server: Server; redirectUrl: string; waitForCode: Promise<{ code: string; state?: string }> }> {
  let done = false
  let settle!: (value: { code: string; state?: string }) => void
  let reject!: (error: Error) => void
  const waitForCode = new Promise<{ code: string; state?: string }>((resolve, rejectPromise) => { settle = resolve; reject = rejectPromise })
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1')
    if (url.pathname !== '/callback') { res.writeHead(404).end(); return }
    if (done) { res.writeHead(409).end('OAuth callback already consumed'); return }
    done = true
    const error = url.searchParams.get('error')
    if (error != null) {
      const desc = url.searchParams.get('error_description')
      res.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' }).end('Authorization failed. You can close this window.')
      reject(new Error(desc != null ? `${error}: ${desc}` : error))
      return
    }
    const code = url.searchParams.get('code')
    if (!code) { res.writeHead(400).end('Missing code'); reject(new Error('OAuth callback missing code')); return }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end('<html><body>Authorization complete. You can close this window.</body></html>')
    const state = url.searchParams.get('state') ?? undefined
    settle({ code, ...(state != null ? { state } : {}) })
  })
  await new Promise<void>((resolve, rejectListen) => {
    server.once('error', rejectListen)
    server.listen(0, '127.0.0.1', () => {
      server.off('error', rejectListen)
      resolve()
    })
  })
  const address = server.address()
  if (address == null || typeof address === 'string') throw new Error('Failed to bind OAuth callback server')
  const timer = setTimeout(() => {
    if (!done) {
      done = true
      reject(new Error('OAuth authorization timed out'))
    }
  }, AUTHORIZE_TIMEOUT_MS)
  waitForCode.finally(() => clearTimeout(timer)).catch(() => undefined)
  return { server, redirectUrl: `http://127.0.0.1:${address.port}/callback`, waitForCode }
}

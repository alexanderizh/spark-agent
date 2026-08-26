import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { chmod, mkdir, open, readdir, readFile, rename, rm } from 'node:fs/promises'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { homedir } from 'node:os'
import { resolve } from 'node:path'

const MAX_REQUEST_BYTES = 32 * 1024 * 1024
const NON_HTTP_PROVIDER_IDS = new Set([
  'local-cli',
  'local-codex-cli',
  'claude-auto-router',
  'codex-auto-router',
])
// bridge.json 是单实例时代的遗留名；每实例独立文件（bridge-<instanceId>.json）
// 之后，旧名仍会被启动期 GC 清理，避免升级残留永久霸占发现路径。
const DESCRIPTOR_NAME = /^bridge(-[A-Za-z0-9._-]{1,200})?\.json$/u

export interface SparkCliProviderProfile {
  id: string
  name: string
  provider: string
  enabled?: boolean
  defaultModel: string
  modelIds: string[]
  apiEndpoint?: string
  codexApiKind?: 'chat' | 'responses' | 'embedding'
  contextWindow?: number
  modelContextWindows?: Record<string, number>
  modelType?: string
  isDefault: boolean
}

export interface SparkCliBridgeDependencies {
  listProviders(): Promise<SparkCliProviderProfile[]>
  resolveCredential(providerId: string): Promise<string>
  fetch?: typeof fetch
  sparkHome?: string
  now?: () => Date
}

interface CatalogRoute {
  routeId: string
  providerId: string
  providerName: string
  protocol: 'anthropic-messages' | 'openai-responses'
  model: string
  contextWindow?: number
}

interface BridgeDescriptor {
  schemaVersion: 1
  host: 'sparkwork'
  instanceId: string
  endpoint: string
  token: string
  pid: number
  startedAt: string
}

export interface SparkCliBridge {
  readonly descriptorPath: string
  readonly endpoint: string
  stop(): Promise<void>
}

export async function startSparkCliBridge(
  dependencies: SparkCliBridgeDependencies,
): Promise<SparkCliBridge> {
  const sparkHome = resolve(
    dependencies.sparkHome ?? process.env.SPARK_HOME ?? resolve(homedir(), '.spark'),
  )
  const bridgeDir = resolve(sparkHome, 'hosts', 'sparkwork')
  const token = randomBytes(32).toString('base64url')
  const instanceId = randomUUID()
  // 每个实例写自己的描述文件：并发实例互不覆盖，退出互不误删，崩溃残留可被
  // 后续实例按 pid 存活判定安全回收。
  const descriptorPath = resolve(bridgeDir, `bridge-${instanceId}.json`)
  await collectStaleDescriptors(bridgeDir)
  const server = createServer((request, response) => {
    void handleRequest(request, response, dependencies, token).catch((error: unknown) => {
      response.destroy(error instanceof Error ? error : new Error(String(error)))
    })
  })

  await listen(server)
  const address = server.address()
  if (address == null || typeof address === 'string') {
    await close(server)
    throw new Error('Spark CLI bridge failed to bind a TCP port')
  }
  const descriptor: BridgeDescriptor = {
    schemaVersion: 1,
    host: 'sparkwork',
    instanceId,
    endpoint: `http://127.0.0.1:${address.port}`,
    token,
    pid: process.pid,
    startedAt: (dependencies.now ?? (() => new Date()))().toISOString(),
  }
  try {
    await writePrivateDescriptor(bridgeDir, descriptorPath, descriptor)
  } catch (error) {
    await close(server)
    throw error
  }

  let stopped = false
  return {
    descriptorPath,
    endpoint: descriptor.endpoint,
    async stop() {
      if (stopped) return
      stopped = true
      const closing = close(server)
      server.closeAllConnections()
      await closing
      // 描述文件按 instanceId 命名，天然只属于本实例，直接删除即可。
      await rm(descriptorPath, { force: true })
    },
  }
}

async function handleRequest(
  request: IncomingMessage,
  response: ServerResponse,
  dependencies: SparkCliBridgeDependencies,
  token: string,
): Promise<void> {
  response.setHeader('cache-control', 'no-store')
  response.setHeader('x-content-type-options', 'nosniff')
  if (!authorized(request, token)) {
    sendJson(response, 401, { error: 'unauthorized' })
    return
  }
  try {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1')
    if (request.method === 'GET' && url.pathname === '/v1/health') {
      sendJson(response, 200, { ok: true, schemaVersion: 1, host: 'sparkwork' })
      return
    }
    if (request.method === 'GET' && url.pathname === '/v1/catalog') {
      sendJson(response, 200, await buildCatalog(dependencies))
      return
    }
    if (request.method === 'POST' && url.pathname.startsWith('/v1/proxy/')) {
      await proxyModelRequest(request, response, url.pathname, dependencies)
      return
    }
    sendJson(response, 404, { error: 'not_found' })
  } catch (error) {
    if (!response.headersSent) sendJson(response, statusFor(error), { error: safeError(error) })
    else response.destroy(error instanceof Error ? error : new Error(String(error)))
  }
}

async function buildCatalog(dependencies: SparkCliBridgeDependencies) {
  const providers = await dependencies.listProviders()
  const routes = providers
    .flatMap(providerRoutes)
    .sort((a, b) => a.routeId.localeCompare(b.routeId))
  const defaultProvider = providers.find((provider) => provider.isDefault)
  const defaultRoute = defaultProvider
    ? routes.find(
        (route) =>
          route.providerId === defaultProvider.id && route.model === defaultProvider.defaultModel,
      )?.routeId
    : undefined
  const stable = JSON.stringify({ defaultRoute: defaultRoute ?? null, routes })
  return {
    schemaVersion: 1 as const,
    host: 'sparkwork' as const,
    revision: createHash('sha256').update(stable).digest('hex'),
    generatedAt: (dependencies.now ?? (() => new Date()))().toISOString(),
    ...(defaultRoute ? { defaultRoute } : {}),
    routes,
  }
}

function providerRoutes(provider: SparkCliProviderProfile): CatalogRoute[] {
  const protocol = providerProtocol(provider)
  if (
    provider.enabled === false ||
    NON_HTTP_PROVIDER_IDS.has(provider.id) ||
    !protocol ||
    provider.modelType === 'image'
  ) {
    return []
  }
  const configuredModels =
    provider.modelIds.length > 0 ? provider.modelIds : [provider.defaultModel]
  const models = [...new Set(configuredModels.map((model) => model.trim()).filter(Boolean))]
  return models.map((model) => ({
    routeId: routeId(provider.id, model),
    providerId: provider.id,
    providerName: provider.name,
    protocol,
    model,
    ...contextWindow(provider, model),
  }))
}

function providerProtocol(provider: SparkCliProviderProfile): CatalogRoute['protocol'] | undefined {
  if (provider.provider === 'anthropic') return 'anthropic-messages'
  if (provider.provider === 'openai' && provider.codexApiKind === 'responses') {
    return 'openai-responses'
  }
  return undefined
}

function contextWindow(
  provider: SparkCliProviderProfile,
  model: string,
): Pick<CatalogRoute, 'contextWindow'> {
  const value = provider.modelContextWindows?.[model] ?? provider.contextWindow
  return typeof value === 'number' && Number.isInteger(value) && value > 0
    ? { contextWindow: value }
    : {}
}

async function proxyModelRequest(
  request: IncomingMessage,
  response: ServerResponse,
  pathname: string,
  dependencies: SparkCliBridgeDependencies,
): Promise<void> {
  const parsed = parseProxyPath(pathname)
  const providers = await dependencies.listProviders()
  const provider = providers.find((item) => item.id === parsed.providerId)
  const protocol = provider ? providerProtocol(provider) : undefined
  if (!provider || !protocol || provider.enabled === false) {
    throw httpError(404, 'provider_not_available')
  }
  if (parsed.protocol !== protocol) throw httpError(400, 'provider_protocol_mismatch')

  const body = await readBody(request)
  const model = parseRequestedModel(body)
  const allowedModels = new Set(providerRoutes(provider).map((route) => route.model))
  if (!allowedModels.has(model)) throw httpError(400, 'model_not_available')
  const credential = (await dependencies.resolveCredential(provider.id)).trim()
  if (!credential) throw httpError(503, 'provider_credential_unavailable')

  const controller = new AbortController()
  response.once('close', () => {
    if (!response.writableEnded) controller.abort('client disconnected')
  })
  const upstream = await (dependencies.fetch ?? fetch)(upstreamUrl(provider, protocol), {
    method: 'POST',
    headers: upstreamHeaders(request, protocol, credential),
    body,
    signal: controller.signal,
    redirect: 'error',
  })
  response.statusCode = upstream.status
  copyResponseHeaders(upstream.headers, response)
  if (!upstream.body) {
    response.end()
    return
  }
  const reader = upstream.body.getReader()
  try {
    while (true) {
      const item = await reader.read()
      if (item.done) break
      if (!response.write(item.value)) await waitForDrain(response)
    }
    response.end()
  } finally {
    reader.releaseLock()
  }
}

function waitForDrain(response: ServerResponse): Promise<void> {
  return new Promise((resolveDrain, reject) => {
    const onDrain = () => {
      cleanup()
      resolveDrain()
    }
    const onClose = () => {
      cleanup()
      reject(new Error('bridge client disconnected'))
    }
    const cleanup = () => {
      response.removeListener('drain', onDrain)
      response.removeListener('close', onClose)
    }
    response.once('drain', onDrain)
    response.once('close', onClose)
  })
}

function parseProxyPath(pathname: string): {
  providerId: string
  protocol: CatalogRoute['protocol']
} {
  const match = /^\/v1\/proxy\/([^/]+)\/v1\/(messages|responses)$/u.exec(pathname)
  if (!match) throw httpError(404, 'proxy_route_not_found')
  const providerId = decodeURIComponent(match[1] ?? '')
  const protocol = match[2] === 'messages' ? 'anthropic-messages' : 'openai-responses'
  return { providerId, protocol }
}

function upstreamUrl(
  provider: SparkCliProviderProfile,
  protocol: CatalogRoute['protocol'],
): string {
  const fallback =
    protocol === 'anthropic-messages' ? 'https://api.anthropic.com' : 'https://api.openai.com/v1'
  const base = (provider.apiEndpoint?.trim() || fallback).replace(/\/+$/u, '')
  if (protocol === 'anthropic-messages') {
    if (base.endsWith('/v1/messages')) return base
    return base.endsWith('/v1') ? `${base}/messages` : `${base}/v1/messages`
  }
  if (base.endsWith('/responses')) return base
  if (base.endsWith('/chat/completions'))
    return `${base.slice(0, -'/chat/completions'.length)}/responses`
  return base.endsWith('/v1') ? `${base}/responses` : `${base}/v1/responses`
}

function upstreamHeaders(
  request: IncomingMessage,
  protocol: CatalogRoute['protocol'],
  credential: string,
): Headers {
  const headers = new Headers({ accept: 'text/event-stream', 'content-type': 'application/json' })
  for (const name of [
    'anthropic-version',
    'anthropic-beta',
    'openai-organization',
    'openai-project',
  ]) {
    const value = request.headers[name]
    if (typeof value === 'string' && value.length <= 4_096) headers.set(name, value)
  }
  if (protocol === 'anthropic-messages') headers.set('x-api-key', credential)
  else headers.set('authorization', `Bearer ${credential}`)
  return headers
}

function copyResponseHeaders(headers: Headers, response: ServerResponse): void {
  for (const name of [
    'content-type',
    'retry-after',
    'request-id',
    'x-request-id',
    'anthropic-request-id',
    'openai-request-id',
  ]) {
    const value = headers.get(name)
    if (value) response.setHeader(name, value)
  }
}

async function readBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += buffer.length
    if (size > MAX_REQUEST_BYTES) throw httpError(413, 'request_too_large')
    chunks.push(buffer)
  }
  return Buffer.concat(chunks).toString('utf8')
}

function parseRequestedModel(body: string): string {
  try {
    const value = JSON.parse(body) as { model?: unknown }
    if (typeof value.model === 'string' && value.model.trim()) return value.model.trim()
  } catch {
    // Fall through to the same non-oracular client error.
  }
  throw httpError(400, 'invalid_model_request')
}

function authorized(request: IncomingMessage, token: string): boolean {
  const authorization = request.headers.authorization
  const apiKey = request.headers['x-api-key']
  return authorization === `Bearer ${token}` || apiKey === token
}

function routeId(providerId: string, model: string): string {
  return `sparkwork:${providerId}:${model}`
}

async function writePrivateDescriptor(
  directory: string,
  target: string,
  descriptor: BridgeDescriptor,
): Promise<void> {
  await mkdir(directory, { recursive: true, mode: 0o700 })
  if (process.platform !== 'win32') await chmod(directory, 0o700)
  const temporary = resolve(directory, `.bridge.${descriptor.instanceId}.tmp`)
  const handle = await open(temporary, 'wx', 0o600)
  try {
    await handle.writeFile(`${JSON.stringify(descriptor)}\n`, 'utf8')
    await handle.sync()
  } finally {
    await handle.close()
  }
  await rename(temporary, target)
  if (process.platform !== 'win32') await chmod(target, 0o600)
}

async function collectStaleDescriptors(bridgeDir: string): Promise<void> {
  let entries
  try {
    entries = await readdir(bridgeDir)
  } catch (error) {
    if (typeof error === 'object' && error !== null && Reflect.get(error, 'code') === 'ENOENT')
      return
    throw error
  }
  await Promise.all(
    entries
      .filter((name) => DESCRIPTOR_NAME.test(name))
      .map(async (name) => {
        try {
          const raw = JSON.parse(await readFile(resolve(bridgeDir, name), 'utf8')) as {
            pid?: unknown
          }
          // 只回收可证明死亡的残留：pid 存活的描述一定属于某个活实例（包括
          // 正在启动的并发实例），绝不能动。
          if (typeof raw.pid === 'number' && Number.isInteger(raw.pid) && !isPidAlive(raw.pid)) {
            await rm(resolve(bridgeDir, name), { force: true })
          }
        } catch {
          // 解析失败的文件交给 CLI 侧校验跳过；启动不被残留垃圾阻塞。
        }
      }),
  )
}

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
  } catch (error) {
    // EPERM 表示进程存在但属于其他用户；只有 ESRCH 能证明 pid 已消失。
    return typeof error === 'object' && error !== null && Reflect.get(error, 'code') !== 'ESRCH'
  }
  return true
}

function listen(server: Server): Promise<void> {
  return new Promise((resolveListen, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      server.removeListener('error', reject)
      resolveListen()
    })
  })
}

function close(server: Server): Promise<void> {
  return new Promise((resolveClose, reject) => {
    server.close((error) => (error ? reject(error) : resolveClose()))
  })
}

function sendJson(response: ServerResponse, status: number, value: unknown): void {
  response.statusCode = status
  response.setHeader('content-type', 'application/json; charset=utf-8')
  response.end(`${JSON.stringify(value)}\n`)
}

function httpError(status: number, code: string): Error & { status: number } {
  return Object.assign(new Error(code), { status })
}

function statusFor(error: unknown): number {
  const status =
    typeof error === 'object' && error !== null ? Reflect.get(error, 'status') : undefined
  return typeof status === 'number' && status >= 400 && status < 600 ? status : 500
}

function safeError(error: unknown): string {
  return statusFor(error) < 500 && error instanceof Error ? error.message : 'bridge_request_failed'
}

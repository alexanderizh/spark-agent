import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'
import type { SubAppManagedRequest, SubAppManagedResponse } from '@spark/protocol'
import {
  ConnectorConnectionRepository,
  ProviderProfileRepository,
  SubAppPlatformRepository,
} from '@spark/storage'
import type { SparkDatabase } from '@spark/storage'
import { SparkError } from '@spark/shared'
import * as keystore from '@spark/shared/keystore'
import { resolveProviderApiKeyForProfile } from '@spark/agent-runtime'

const MAX_RESPONSE_BYTES = 2 * 1024 * 1024
const MAX_REDIRECTS = 3
const FORBIDDEN_HEADERS = new Set([
  'authorization',
  'x-api-key',
  'x-goog-api-key',
  'api-key',
  'cookie',
  'host',
  'origin',
  'referer',
  'connection',
  'content-length',
])
const MANAGED_CREDENTIAL_HEADERS = new Set([
  'authorization',
  'x-api-key',
  'x-goog-api-key',
  'api-key',
])

interface ResolvedConnection {
  baseUrl: URL
  allowedOrigins: Set<string>
  allowPrivateNetwork: boolean
  credentialHeaders: Record<string, string>
}

export class SubAppNetworkGateway {
  private readonly platform: SubAppPlatformRepository
  private readonly providers: ProviderProfileRepository
  private readonly connectors: ConnectorConnectionRepository

  constructor(database: SparkDatabase) {
    this.platform = new SubAppPlatformRepository(database)
    this.providers = new ProviderProfileRepository(database)
    this.connectors = new ConnectorConnectionRepository(database)
  }

  async request(input: SubAppManagedRequest): Promise<SubAppManagedResponse> {
    const connection = await this.resolveConnection(input.appId, input.slot)
    const initial = resolveRequestUrl(connection.baseUrl, input.path)
    let target = initial
    let method = input.method ?? 'GET'
    const timeoutMs = Math.min(Math.max(input.timeoutMs ?? 15_000, 1_000), 30_000)
    const headers = new Headers()
    for (const [name, value] of Object.entries(input.headers ?? {})) {
      if (FORBIDDEN_HEADERS.has(name.toLowerCase())) continue
      headers.set(name, value)
    }
    for (const [name, value] of Object.entries(connection.credentialHeaders))
      headers.set(name, value)
    let body = encodeBody(input.body, headers)
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      for (let redirects = 0; ; redirects += 1) {
        await this.assertTargetAllowed(target, connection)
        const response = await fetch(target, {
          method,
          headers,
          ...(body !== undefined ? { body } : {}),
          redirect: 'manual',
          signal: controller.signal,
        })
        if (response.status >= 300 && response.status < 400) {
          if (redirects >= MAX_REDIRECTS)
            throw new SparkError('VALIDATION_FAILED', '受管请求重定向次数超限。')
          const location = response.headers.get('location')
          if (location == null)
            throw new SparkError('VALIDATION_FAILED', '重定向响应缺少 Location。')
          target = new URL(location, target)
          if (
            response.status === 303 ||
            ((response.status === 301 || response.status === 302) && method === 'POST')
          ) {
            method = 'GET'
            body = undefined
          }
          continue
        }
        const bytes = await readBounded(response, MAX_RESPONSE_BYTES)
        const contentType = response.headers.get('content-type') ?? ''
        const text = new TextDecoder().decode(bytes)
        let responseBody: unknown = text
        if (contentType.includes('application/json') && text.length > 0) {
          try {
            responseBody = JSON.parse(text)
          } catch {
            responseBody = text
          }
        }
        const secrets = Object.values(connection.credentialHeaders)
          .map((value) => value.replace(/^\S+\s+/, ''))
          .filter(Boolean)
        return {
          status: response.status,
          ok: response.ok,
          headers: safeResponseHeaders(response.headers),
          body: redactSecrets(responseBody, secrets),
        }
      }
    } catch (error) {
      if (controller.signal.aborted) throw new SparkError('EXECUTION_FAILED', '受管网络请求超时。')
      throw error
    } finally {
      clearTimeout(timer)
    }
  }

  private async resolveConnection(appId: string, slot: string): Promise<ResolvedConnection> {
    if (!this.platform.isEnabledPublished(appId)) {
      throw new SparkError('PERMISSION_DENIED', '子应用未启用，不能发起受管网络请求。')
    }
    const published = this.platform.getPublishedPackage(appId)
    if (published == null)
      throw new SparkError('VALIDATION_FAILED', '受管网络仅供已发布的 V2 子应用使用。')
    const declaration = published.manifest.connections?.[slot]
    if (declaration == null || !published.manifest.permissions.connections.includes(slot)) {
      throw new SparkError('PERMISSION_DENIED', `应用未声明连接权限：${slot}`)
    }
    const binding = this.platform.listBindings(appId).find((item) => item.slot === slot)
    if (binding == null) throw new SparkError('VALIDATION_FAILED', `连接槽 ${slot} 尚未绑定。`)
    const declaredOrigins = new Set<string>(declaration.allowedOrigins.map(normalizeOrigin))
    const granted =
      binding.grantedOrigins.length === 0
        ? declaredOrigins
        : new Set<string>(
            binding.grantedOrigins
              .map(normalizeOrigin)
              .filter((value: string) => declaredOrigins.has(value)),
          )
    if (granted.size === 0) throw new SparkError('PERMISSION_DENIED', '连接没有可用的授权 origin。')

    if (binding.bindingKind === 'provider-profile') {
      const row = this.providers.get(binding.bindingId)
      if (row == null || row.enabled !== 1)
        throw new SparkError('NOT_FOUND', '绑定的 Provider 不存在或已停用。')
      const config = parseObject(row.config_json)
      const endpoint = typeof config.apiEndpoint === 'string' ? config.apiEndpoint : null
      if (endpoint == null)
        throw new SparkError('VALIDATION_FAILED', 'Provider 未配置 API endpoint。')
      const secret = await resolveProviderApiKeyForProfile({
        id: row.id,
        keystoreRef: row.keystore_ref ?? '',
        managed: config.managed === true,
        ...(config.managedType === 'newapi' ? { managedType: 'newapi' as const } : {}),
        ...(typeof config.managedOwnerUserId === 'string'
          ? { managedOwnerUserId: config.managedOwnerUserId }
          : {}),
      })
      if (!secret) throw new SparkError('VALIDATION_FAILED', 'Provider 凭据未配置。')
      return {
        baseUrl: new URL(endpoint),
        allowedOrigins: granted,
        allowPrivateNetwork:
          declaration.allowPrivateNetwork === true && binding.allowPrivateNetwork,
        credentialHeaders: providerCredentialHeaders(row.provider_type, secret),
      }
    }

    const row = this.connectors.get(binding.bindingId)
    if (row == null || row.enabled !== 1)
      throw new SparkError('NOT_FOUND', '绑定的 API Connection 不存在或已停用。')
    const config = parseObject(row.config_json)
    const endpoint =
      typeof config.baseUrl === 'string'
        ? config.baseUrl
        : typeof config.apiEndpoint === 'string'
          ? config.apiEndpoint
          : null
    if (endpoint == null)
      throw new SparkError('VALIDATION_FAILED', 'API Connection 未配置 baseUrl。')
    const secret =
      row.keystore_ref == null
        ? null
        : await keystore.getSecret(row.keystore_ref as keystore.KeystoreRef)
    const headerName =
      typeof config.authHeader === 'string' ? config.authHeader.toLowerCase() : 'authorization'
    if (secret != null && !MANAGED_CREDENTIAL_HEADERS.has(headerName))
      throw new SparkError('VALIDATION_FAILED', '连接配置的凭据头不在受管允许列表中。')
    const scheme = typeof config.authScheme === 'string' ? config.authScheme.trim() : 'Bearer'
    return {
      baseUrl: new URL(endpoint),
      allowedOrigins: granted,
      allowPrivateNetwork: declaration.allowPrivateNetwork === true && binding.allowPrivateNetwork,
      credentialHeaders:
        secret == null
          ? {}
          : {
              [headerName]: headerName === 'authorization' ? `${scheme} ${secret}`.trim() : secret,
            },
    }
  }

  private async assertTargetAllowed(target: URL, connection: ResolvedConnection): Promise<void> {
    if (!['http:', 'https:'].includes(target.protocol) || target.username || target.password) {
      throw new SparkError('PERMISSION_DENIED', '受管请求仅允许无内嵌凭据的 HTTP(S) URL。')
    }
    if (!connection.allowedOrigins.has(target.origin))
      throw new SparkError('PERMISSION_DENIED', `目标 origin 未授权：${target.origin}`)
    const addresses = await lookup(target.hostname, { all: true, verbatim: true })
    if (addresses.length === 0) throw new SparkError('NOT_FOUND', '目标域名无可用地址。')
    if (
      !connection.allowPrivateNetwork &&
      addresses.some((item) => isPrivateAddress(item.address))
    ) {
      throw new SparkError('PERMISSION_DENIED', '目标解析到本地或私网地址，应用未获得私网权限。')
    }
  }
}

function resolveRequestUrl(base: URL, value: string): URL {
  if (/^https?:\/\//i.test(value)) return new URL(value)
  const normalizedBase = base.toString().endsWith('/') ? base : new URL(`${base.toString()}/`)
  return new URL(value.replace(/^\/+/, ''), normalizedBase)
}

function normalizeOrigin(value: string): string {
  return new URL(value).origin
}
function parseObject(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value)
    return parsed != null && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
  } catch {
    return {}
  }
}
function encodeBody(value: unknown, headers: Headers): string | undefined {
  if (value === undefined || value === null) return undefined
  if (typeof value === 'string') return value
  if (!headers.has('content-type')) headers.set('content-type', 'application/json')
  return JSON.stringify(value)
}
function isPrivateAddress(address: string): boolean {
  if (isIP(address) === 4) {
    const [a = 0, b = 0] = address.split('.').map(Number)
    return (
      a === 10 ||
      a === 127 ||
      a === 0 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168)
    )
  }
  const normalized = address.toLowerCase()
  return (
    normalized === '::1' ||
    normalized === '::' ||
    normalized.startsWith('fc') ||
    normalized.startsWith('fd') ||
    normalized.startsWith('fe8') ||
    normalized.startsWith('fe9') ||
    normalized.startsWith('fea') ||
    normalized.startsWith('feb')
  )
}
async function readBounded(response: Response, limit: number): Promise<Uint8Array> {
  if (Number(response.headers.get('content-length') ?? 0) > limit)
    throw new SparkError('VALIDATION_FAILED', '受管响应超过 2 MB 上限。')
  const reader = response.body?.getReader()
  if (reader == null) return new Uint8Array()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const next = await reader.read()
    if (next.done) break
    total += next.value.byteLength
    if (total > limit) {
      await reader.cancel()
      throw new SparkError('VALIDATION_FAILED', '受管响应超过 2 MB 上限。')
    }
    chunks.push(next.value)
  }
  const merged = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    merged.set(chunk, offset)
    offset += chunk.byteLength
  }
  return merged
}
function safeResponseHeaders(headers: Headers): Record<string, string> {
  const output: Record<string, string> = {}
  for (const name of ['content-type', 'etag', 'last-modified', 'cache-control', 'x-request-id']) {
    const value = headers.get(name)
    if (value != null) output[name] = value
  }
  return output
}

function providerCredentialHeaders(providerType: string, secret: string): Record<string, string> {
  const normalized = providerType.toLowerCase()
  if (normalized.includes('anthropic')) {
    return { 'x-api-key': secret, 'anthropic-version': '2023-06-01' }
  }
  if (normalized.includes('google') || normalized.includes('gemini')) {
    return { 'x-goog-api-key': secret }
  }
  return { authorization: `Bearer ${secret}` }
}

function redactSecrets(value: unknown, secrets: string[], depth = 0): unknown {
  if (depth > 12) return '[redacted-depth]'
  if (typeof value === 'string') {
    return secrets.reduce(
      (text, secret) => (secret ? text.replaceAll(secret, '[REDACTED]') : text),
      value,
    )
  }
  if (Array.isArray(value)) return value.map((item) => redactSecrets(item, secrets, depth + 1))
  if (value != null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => [
        key,
        redactSecrets(item, secrets, depth + 1),
      ]),
    )
  }
  return value
}

import { mkdir, rm } from 'node:fs/promises'
import { createHash, createPublicKey, verify } from 'node:crypto'
import { join, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import {
  PluginManifestSchema,
  PluginPermissionSchema,
  type InstalledPluginItem,
  type PluginInspection,
  type PluginMarketplace,
  type PluginMarketplaceItem,
  type PluginManifest,
  type PluginPermission,
  type PluginPermissionGrant,
} from '@spark/protocol'
import {
  ConnectorAccountRepository,
  McpServerRepository,
  PluginRepository,
  SkillRepository,
  type PluginRow,
} from '@spark/storage'
import type { SparkDatabase } from '@spark/storage'
import { SparkError } from '@spark/shared'
import { deleteSecret } from '@spark/shared/keystore'
import {
  inspectPluginDirectory,
  installPluginArchive,
  installPluginDirectoryAtomic,
} from './plugin-package.js'
import { BUILTIN_PLUGIN_MANIFESTS } from './builtin-plugins.js'

function rowToMarketplace(
  row: ReturnType<PluginRepository['listRegistries']>[number],
): PluginMarketplace {
  let trustedKeyFingerprints: string[] = []
  try {
    trustedKeyFingerprints = JSON.parse(row.trusted_key_fingerprints_json) as string[]
  } catch {
    /* keep empty */
  }
  const configured = row.enabled === 1 && trustedKeyFingerprints.length > 0
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    apiBaseUrl: row.api_base_url,
    enabled: row.enabled === 1,
    configured,
    trustedKeyFingerprints,
    ...(row.last_sync_at ? { lastSyncAt: row.last_sync_at } : {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function pluginPermissionGrants(
  manifest: PluginManifest,
  rows: ReturnType<PluginRepository['listPermissions']>,
): PluginPermissionGrant[] {
  const states = new Map(rows.map((row) => [row.permission, row]))
  const permissions = [
    ...new Set([...manifest.permissions.required, ...manifest.permissions.optional]),
  ]
  return permissions.map((permission) => {
    const row = states.get(permission)
    return {
      permission,
      state: row?.state ?? 'pending',
      ...(row?.granted_at ? { grantedAt: row.granted_at } : {}),
    }
  })
}

function isWithin(root: string, candidate: string): boolean {
  const normalizedRoot = resolve(root)
  const normalizedCandidate = resolve(candidate)
  return (
    normalizedCandidate === normalizedRoot ||
    normalizedCandidate.startsWith(`${normalizedRoot}/`) ||
    normalizedCandidate.startsWith(`${normalizedRoot}\\`)
  )
}

function requiredPermissionsGranted(
  manifest: PluginManifest,
  grants: PluginPermissionGrant[],
): boolean {
  const granted = new Set(
    grants.filter((grant) => grant.state === 'granted').map((grant) => grant.permission),
  )
  return manifest.permissions.required.every((permission) => granted.has(permission))
}

function normalizedFingerprint(value: string): string {
  return value.replace(/^sha256:/i, '').toLowerCase()
}

function verifyMarketplaceSignature(
  item: Pick<
    PluginMarketplaceItem,
    'id' | 'version' | 'packageSha256' | 'signature' | 'signingKey'
  >,
  marketplace: PluginMarketplace,
): boolean {
  if (item.signature == null || item.signingKey == null) return false
  try {
    const publicKey = item.signingKey.includes('BEGIN')
      ? createPublicKey(item.signingKey)
      : createPublicKey({
          key: Buffer.from(item.signingKey, 'base64'),
          format: 'der',
          type: 'spki',
        })
    const keyDer = publicKey.export({ format: 'der', type: 'spki' })
    const fingerprint = createHash('sha256').update(keyDer).digest('hex')
    if (
      !marketplace.trustedKeyFingerprints.some(
        (trusted) => normalizedFingerprint(trusted) === fingerprint,
      )
    )
      return false
    const signedPayload = `${item.id}\n${item.version}\n${item.packageSha256.toLowerCase()}`
    return verify(
      null,
      Buffer.from(signedPayload, 'utf8'),
      publicKey,
      Buffer.from(item.signature, 'base64'),
    )
  } catch {
    return false
  }
}

function comparePluginVersions(left: string, right: string): number {
  const leftParts = left.split(/[.+-]/, 1)[0]?.split('.').map(Number) ?? []
  const rightParts = right.split(/[.+-]/, 1)[0]?.split('.').map(Number) ?? []
  for (let index = 0; index < 3; index += 1) {
    const difference = (leftParts[index] ?? 0) - (rightParts[index] ?? 0)
    if (difference !== 0) return difference
  }
  return left.localeCompare(right)
}

function preferMarketplaceItem(
  candidate: PluginMarketplaceItem,
  current: PluginMarketplaceItem,
): boolean {
  if (candidate.trust !== current.trust) return candidate.trust === 'verified'
  if (candidate.installed !== current.installed) return !candidate.installed
  const versionDifference = comparePluginVersions(candidate.version, current.version)
  if (versionDifference !== 0) return versionDifference > 0
  return candidate.marketplaceId.localeCompare(current.marketplaceId) < 0
}

function dedupeMarketplaceItems(items: PluginMarketplaceItem[]): PluginMarketplaceItem[] {
  const byPluginId = new Map<string, PluginMarketplaceItem>()
  for (const item of items) {
    const current = byPluginId.get(item.id)
    if (current == null || preferMarketplaceItem(item, current)) byPluginId.set(item.id, item)
  }
  return Array.from(byPluginId.values())
}

export class PluginPermissionError extends SparkError {
  readonly permissions: PluginPermission[]
  constructor(permissions: PluginPermission[]) {
    super('PERMISSION_DENIED', `Plugin requires explicit permission: ${permissions.join(', ')}`, {
      permissions,
    })
    this.name = 'PluginPermissionError'
    this.permissions = permissions
  }
}

export interface PluginManagerOptions {
  db: SparkDatabase
  pluginRoot: string
  tempRoot?: string
}

export class PluginManager {
  readonly repository: PluginRepository
  private readonly db: SparkDatabase
  private readonly skills: SkillRepository
  private readonly mcpServers: McpServerRepository
  private readonly pluginRoot: string
  private readonly tempRoot: string
  private initialized = false
  private initializationPromise: Promise<void> | null = null

  constructor(options: PluginManagerOptions) {
    this.db = options.db
    this.repository = new PluginRepository(options.db)
    this.skills = new SkillRepository(options.db)
    this.mcpServers = new McpServerRepository(options.db)
    this.pluginRoot = resolve(options.pluginRoot)
    this.tempRoot = resolve(options.tempRoot ?? join(this.pluginRoot, '.tmp'))
  }

  async initialize(): Promise<void> {
    if (this.initialized) return
    if (this.initializationPromise != null) return this.initializationPromise
    const initialization = this.initializeInternal()
    this.initializationPromise = initialization
    try {
      await initialization
      this.initialized = true
    } finally {
      if (this.initializationPromise === initialization) this.initializationPromise = null
    }
  }

  private async initializeInternal(): Promise<void> {
    await mkdir(this.pluginRoot, { recursive: true })
    await mkdir(this.tempRoot, { recursive: true })
    this.ensureBuiltinPlugins()
    for (const row of this.repository.list()) {
      if (row.source === 'bundled') continue
      const manifest = this.readManifest(row)
      const grants = pluginPermissionGrants(manifest, this.repository.listPermissions(row.id))
      this.syncResources(
        row.id,
        manifest,
        row.enabled === 1 && requiredPermissionsGranted(manifest, grants),
        grants,
      )
    }
  }

  private ensureBuiltinPlugins(): void {
    for (const manifest of BUILTIN_PLUGIN_MANIFESTS) {
      const existing = this.repository.get(manifest.id)
      const manifestJson = JSON.stringify(manifest)
      const integritySha256 = createHash('sha256').update(manifestJson).digest('hex')
      const row = this.repository.upsert({
        id: manifest.id,
        version: manifest.version,
        displayName: manifest.displayName,
        description: manifest.description,
        authorName: manifest.author.name,
        manifestJson,
        installPath: existing?.install_path ?? `builtin://${manifest.id}`,
        source: 'bundled',
        enabled: existing?.enabled !== 0,
        state: existing?.state ?? 'installed',
        trust: 'bundled',
        integritySha256,
      })
      for (const permission of manifest.permissions.required) {
        const current = this.repository
          .listPermissions(manifest.id)
          .find((item) => item.permission === permission)
        if (current == null || current.state === 'granted' || existing == null) {
          this.repository.setPermission(manifest.id, permission, 'granted')
        }
      }
      const grants = pluginPermissionGrants(manifest, this.repository.listPermissions(manifest.id))
      this.syncResources(
        manifest.id,
        manifest,
        row.enabled === 1 && requiredPermissionsGranted(manifest, grants),
        grants,
      )
    }
  }

  list(includeDisabled = true): InstalledPluginItem[] {
    return this.repository.list(includeDisabled).map((row) => this.toItem(row))
  }

  async inspectLocal(sourcePath: string): Promise<PluginInspection> {
    return inspectPluginDirectory(sourcePath)
  }

  async installLocal(
    sourcePath: string,
    approvedPermissions: PluginPermission[],
    enable = true,
  ): Promise<InstalledPluginItem> {
    if (isWithin(this.pluginRoot, sourcePath)) {
      throw new Error('Plugin source must be outside the managed plugin directory')
    }
    const inspection = await inspectPluginDirectory(sourcePath)
    return this.installDirectory(inspection, approvedPermissions, enable, 'local', 'unverified')
  }

  async installMarketplace(
    plugin: PluginMarketplaceItem,
    approvedPermissions: PluginPermission[],
    enable = true,
  ): Promise<InstalledPluginItem> {
    if (plugin.trust !== 'verified') {
      throw new Error('Marketplace plugin is not signed by a trusted registry key')
    }
    const extracted = await installPluginArchive(
      plugin.packageUrl,
      plugin.packageSha256,
      this.tempRoot,
    )
    try {
      const inspection = await inspectPluginDirectory(extracted)
      if (inspection.manifest.id !== plugin.id || inspection.manifest.version !== plugin.version) {
        throw new Error('Downloaded plugin manifest does not match the marketplace listing')
      }
      return await this.installDirectory(
        inspection,
        approvedPermissions,
        enable,
        'marketplace',
        'verified',
      )
    } finally {
      // installPluginArchive uses a unique work directory; the package directory is
      // copied atomically before cleanup. The best-effort cleanup also covers errors.
      await rm(resolve(extracted, '..', '..'), { recursive: true, force: true }).catch(
        () => undefined,
      )
    }
  }

  async setEnabled(id: string, enabled: boolean): Promise<InstalledPluginItem> {
    const row = this.requireRow(id)
    const manifest = this.readManifest(row)
    const grants = pluginPermissionGrants(manifest, this.repository.listPermissions(id))
    if (enabled && !requiredPermissionsGranted(manifest, grants)) {
      throw new PluginPermissionError(
        manifest.permissions.required.filter(
          (permission) =>
            !grants.some((grant) => grant.permission === permission && grant.state === 'granted'),
        ),
      )
    }
    this.repository.update(id, { enabled, state: enabled ? 'installed' : 'installed' })
    this.syncResources(id, manifest, enabled, grants)
    return this.toItem(this.requireRow(id))
  }

  async setPermission(
    id: string,
    permission: PluginPermission,
    state: 'granted' | 'denied',
  ): Promise<InstalledPluginItem> {
    const row = this.requireRow(id)
    const manifest = this.readManifest(row)
    if (
      ![...manifest.permissions.required, ...manifest.permissions.optional].includes(permission)
    ) {
      throw new Error(`Plugin does not declare permission: ${permission}`)
    }
    this.repository.setPermission(id, permission, state)
    const grants = pluginPermissionGrants(manifest, this.repository.listPermissions(id))
    const requiredOk = requiredPermissionsGranted(manifest, grants)
    const enabled = row.enabled === 1 && requiredOk
    this.repository.update(id, { enabled, state: requiredOk ? 'installed' : 'blocked' })
    this.syncResources(id, manifest, enabled, grants)
    return this.toItem(this.requireRow(id))
  }

  async uninstall(id: string): Promise<boolean> {
    const row = this.requireRow(id)
    if (row.source === 'bundled') throw new Error('内置能力包不能移除，只能停用')
    if (!isWithin(this.pluginRoot, row.install_path))
      throw new Error('Plugin install path is outside the managed plugin directory')
    const accounts = new ConnectorAccountRepository(this.db).listByPlugin(id)
    for (const account of accounts) {
      if (account.credential_ref != null) {
        await deleteSecret(account.credential_ref as import('@spark/shared/keystore').KeystoreRef)
      }
    }
    for (const resource of this.repository.listResources(id)) {
      if (resource.resource_type === 'skill') this.skills.deleteById(resource.resource_id)
      if (resource.resource_type === 'mcp-server') this.mcpServers.deleteById(resource.resource_id)
    }
    const deleted = this.repository.deletePlugin(id)
    await rm(row.install_path, { recursive: true, force: true })
    return deleted
  }

  getRuntimeStatus(runtimeId: string): import('@spark/protocol').PluginRuntimeStatus | null {
    const row = this.repository
      .list(true)
      .map((item) => ({ row: item, manifest: this.readManifest(item) }))
      .map(({ row: item, manifest }) => ({
        row: item,
        manifest,
        runtime:
          manifest.contributions.runtimes?.find((runtime) => runtime.id === runtimeId) ??
          (manifest.runtime?.id === runtimeId
            ? {
                execution: { type: 'builtin' as const, adapter: manifest.runtime.id },
              }
            : undefined),
      }))
      .find(({ runtime }) => runtime != null)
    if (row == null) return null
    const grants = pluginPermissionGrants(row.manifest, this.repository.listPermissions(row.row.id))
    const runtimeSupported = row.runtime?.execution.type === 'builtin'
    return {
      runtimeId,
      pluginId: row.row.id,
      enabled: row.row.enabled === 1 && runtimeSupported,
      state: row.row.state,
      permissionsReady: requiredPermissionsGranted(row.manifest, grants),
    }
  }

  isRuntimeEnabled(runtimeId: string): boolean {
    const status = this.getRuntimeStatus(runtimeId)
    return status?.enabled === true && status.state === 'installed' && status.permissionsReady
  }

  listMarketplaces(): PluginMarketplace[] {
    return this.repository.listRegistries().map(rowToMarketplace)
  }

  updateMarketplace(
    id: string,
    fields: { enabled?: boolean; apiBaseUrl?: string; trustedKeyFingerprints?: string[] },
  ): PluginMarketplace {
    if (fields.apiBaseUrl != null) new URL(fields.apiBaseUrl)
    const row = this.repository.updateRegistry(id, {
      ...fields,
      ...(fields.trustedKeyFingerprints
        ? { trustedKeyFingerprintsJson: JSON.stringify(fields.trustedKeyFingerprints) }
        : {}),
    })
    if (row == null) throw new Error(`Marketplace not found: ${id}`)
    return rowToMarketplace(row)
  }

  async searchMarketplace(request: {
    query: string
    marketplaceId?: string
    category?: string
    limit?: number
    offset?: number
  }): Promise<{ plugins: PluginMarketplaceItem[]; total: number }> {
    const marketplaces = this.listMarketplaces().filter(
      (marketplace) =>
        marketplace.configured &&
        (request.marketplaceId == null || marketplace.id === request.marketplaceId),
    )
    const results = await Promise.all(
      marketplaces.map(async (marketplace) => {
        const url = new URL('plugins/search', `${marketplace.apiBaseUrl.replace(/\/$/, '')}/`)
        if (request.query.trim()) url.searchParams.set('q', request.query.trim())
        if (request.category) url.searchParams.set('category', request.category)
        url.searchParams.set('limit', String(request.limit ?? 24))
        url.searchParams.set('offset', String(request.offset ?? 0))
        const response = await fetch(url, {
          headers: { Accept: 'application/json', 'User-Agent': 'Spark-Agent-Plugin-Manager/1' },
          signal: AbortSignal.timeout(20_000),
        })
        if (!response.ok)
          throw new Error(`${marketplace.name} unavailable (HTTP ${response.status})`)
        const payload = (await response.json()) as {
          plugins?: unknown
          items?: unknown
          total?: unknown
        }
        const rawItems = Array.isArray(payload.plugins)
          ? payload.plugins
          : Array.isArray(payload.items)
            ? payload.items
            : []
        const plugins = rawItems
          .map((item) => this.parseMarketplaceItem(item, marketplace))
          .filter((item): item is PluginMarketplaceItem => item != null)
        this.repository.updateRegistry(marketplace.id, { lastSyncAt: new Date().toISOString() })
        return {
          plugins,
          total: typeof payload.total === 'number' ? payload.total : plugins.length,
        }
      }),
    )
    const plugins = dedupeMarketplaceItems(results.flatMap((result) => result.plugins))
    return { plugins, total: plugins.length }
  }

  private async installDirectory(
    inspection: PluginInspection,
    approvedPermissions: PluginPermission[],
    enable: boolean,
    source: 'local' | 'marketplace',
    trust: 'verified' | 'unverified',
  ): Promise<InstalledPluginItem> {
    const required = inspection.manifest.permissions.required
    if (enable) {
      const missing = required.filter((permission) => !approvedPermissions.includes(permission))
      if (missing.length > 0) throw new PluginPermissionError(missing)
    }
    const installPath = await installPluginDirectoryAtomic(
      inspection.sourcePath,
      this.pluginRoot,
      inspection.manifest.id,
    )
    const manifestJson = JSON.stringify(inspection.manifest)
    const row = this.repository.upsert({
      id: inspection.manifest.id,
      version: inspection.manifest.version,
      displayName: inspection.manifest.displayName,
      description: inspection.manifest.description,
      authorName: inspection.manifest.author.name,
      manifestJson,
      installPath,
      source,
      enabled: enable,
      state: enable ? 'installed' : 'blocked',
      trust,
      integritySha256: inspection.packageSha256,
    })
    for (const permission of [
      ...new Set([
        ...inspection.manifest.permissions.required,
        ...inspection.manifest.permissions.optional,
      ]),
    ]) {
      this.repository.setPermission(
        inspection.manifest.id,
        permission,
        approvedPermissions.includes(permission) ? 'granted' : 'pending',
      )
    }
    const grants = pluginPermissionGrants(
      inspection.manifest,
      this.repository.listPermissions(inspection.manifest.id),
    )
    this.syncResources(
      inspection.manifest.id,
      inspection.manifest,
      enable && requiredPermissionsGranted(inspection.manifest, grants),
      grants,
    )
    return this.toItem(this.requireRow(row.id))
  }

  private syncResources(
    pluginId: string,
    manifest: PluginManifest,
    enabled: boolean,
    grants: PluginPermissionGrant[],
  ): void {
    const granted = new Set(
      grants.filter((grant) => grant.state === 'granted').map((grant) => grant.permission),
    )
    const resourceRows: Array<{
      id: string
      type: 'skill' | 'mcp-server' | 'connector' | 'runtime'
      resourceId: string
      sourcePath?: string
      enabled: boolean
      metadataJson?: string
    }> = []
    for (const skill of manifest.contributions.skills) {
      const resourceId = `plugin:${pluginId}:skill:${skill.id}`
      const rootPath = join(this.pluginRoot, pluginId, skill.path)
      const skillManifestJson = JSON.stringify({
        pluginId,
        contributionId: skill.id,
        description: skill.description ?? manifest.description,
        author: manifest.author.name,
        category: manifest.categories[0] ?? 'utility',
        ...(manifest.icon ? { icon: manifest.icon } : {}),
        tags: manifest.tags,
      })
      const existing = this.skills.get(resourceId)
      if (existing == null) {
        this.skills.create({
          id: resourceId,
          scope: 'plugin',
          name: skill.name ?? skill.id,
          version: manifest.version,
          rootPath,
          manifestJson: skillManifestJson,
          enabled,
        })
      } else {
        this.skills.update(resourceId, {
          enabled,
          rootPath,
          version: manifest.version,
          manifestJson: skillManifestJson,
        })
      }
      resourceRows.push({
        id: randomUUID(),
        type: 'skill',
        resourceId,
        sourcePath: skill.path,
        enabled,
      })
    }
    for (const server of manifest.contributions.mcpServers) {
      const resourceId = `plugin:${pluginId}:mcp:${server.id}`
      const contributionEnabled =
        enabled && (server.permissions ?? []).every((permission) => granted.has(permission))
      const configJson = JSON.stringify({
        ...server.config,
        _sparkPluginId: pluginId,
        _sparkPluginContributionId: server.id,
      })
      const existing = this.mcpServers.get(resourceId)
      if (existing == null)
        this.mcpServers.create({
          id: resourceId,
          scope: 'plugin',
          name: server.name,
          configJson,
          enabled: contributionEnabled,
        })
      else
        this.mcpServers.update(resourceId, {
          name: server.name,
          configJson,
          enabled: contributionEnabled,
        })
      resourceRows.push({
        id: randomUUID(),
        type: 'mcp-server',
        resourceId,
        enabled: contributionEnabled,
        metadataJson: JSON.stringify({ permissions: server.permissions ?? [] }),
      })
    }
    for (const connector of manifest.contributions.connectors) {
      const resourceId = `plugin:${pluginId}:connector:${connector.id}`
      const contributionEnabled =
        enabled && (connector.permissions ?? []).every((permission) => granted.has(permission))
      resourceRows.push({
        id: randomUUID(),
        type: 'connector',
        resourceId,
        enabled: contributionEnabled,
        metadataJson: JSON.stringify({
          manifest: connector.manifest,
          permissions: connector.permissions ?? [],
        }),
      })
    }
    for (const runtime of manifest.contributions.runtimes ?? []) {
      const resourceId = `plugin:${pluginId}:runtime:${runtime.id}`
      const runtimeSupported = runtime.execution.type === 'builtin'
      resourceRows.push({
        id: randomUUID(),
        type: 'runtime',
        resourceId,
        enabled: enabled && runtimeSupported,
        metadataJson: JSON.stringify({
          runtime,
          ...(runtimeSupported ? {} : { unavailableReason: 'isolated-runtime-host-required' }),
        }),
      })
    }
    this.repository.replaceResources(pluginId, resourceRows)
  }

  private parseMarketplaceItem(
    value: unknown,
    marketplace: PluginMarketplace,
  ): PluginMarketplaceItem | null {
    if (value == null || typeof value !== 'object') return null
    const item = value as Record<string, unknown>
    const id = typeof item.id === 'string' ? item.id : ''
    const version = typeof item.version === 'string' ? item.version : ''
    const packageUrl = typeof item.packageUrl === 'string' ? item.packageUrl : ''
    const packageSha256 = typeof item.packageSha256 === 'string' ? item.packageSha256 : ''
    if (!id || !version || !packageUrl || !/^[a-f0-9]{64}$/i.test(packageSha256)) return null
    new URL(packageUrl)
    const installed = this.repository.get(id)
    const result: PluginMarketplaceItem = {
      marketplaceId: marketplace.id,
      id,
      version,
      displayName: typeof item.displayName === 'string' ? item.displayName : id,
      description: typeof item.description === 'string' ? item.description : '',
      author: typeof item.author === 'string' ? item.author : 'Unknown',
      categories: Array.isArray(item.categories)
        ? item.categories.filter((value): value is string => typeof value === 'string')
        : [],
      tags: Array.isArray(item.tags)
        ? item.tags.filter((value): value is string => typeof value === 'string')
        : [],
      ...(typeof item.iconUrl === 'string' ? { iconUrl: item.iconUrl } : {}),
      ...(typeof item.homepageUrl === 'string' ? { homepageUrl: item.homepageUrl } : {}),
      manifestUrl:
        typeof item.manifestUrl === 'string'
          ? item.manifestUrl
          : `${marketplace.apiBaseUrl}/plugins/${encodeURIComponent(id)}/manifest.json`,
      packageUrl,
      packageSha256,
      requiredPermissions: Array.isArray(item.requiredPermissions)
        ? item.requiredPermissions.filter(
            (value): value is PluginPermission => PluginPermissionSchema.safeParse(value).success,
          )
        : [],
      ...(typeof item.signature === 'string' ? { signature: item.signature } : {}),
      ...(typeof item.signingKey === 'string' ? { signingKey: item.signingKey } : {}),
      trust: 'unverified',
      installed: installed != null,
      ...(installed ? { installedVersion: installed.version } : {}),
    }
    result.trust = verifyMarketplaceSignature(result, marketplace) ? 'verified' : 'unverified'
    return result
  }

  private requireRow(id: string): PluginRow {
    const row = this.repository.get(id)
    if (row == null) throw new Error(`Plugin not found: ${id}`)
    return row
  }

  private readManifest(row: PluginRow): PluginManifest {
    return PluginManifestSchema.parse(JSON.parse(row.manifest_json)) as unknown as PluginManifest
  }

  private toItem(row: PluginRow): InstalledPluginItem {
    const manifest = this.readManifest(row)
    const resources = this.repository.listResources(row.id)
    const runtimeId = manifest.runtime?.id ?? manifest.contributions.runtimes?.[0]?.id
    return {
      id: row.id,
      version: row.version,
      displayName: row.display_name,
      description: row.description,
      author: row.author_name,
      ...(manifest.icon ? { icon: manifest.icon } : {}),
      ...(runtimeId != null ? { runtimeId } : {}),
      installPath: row.install_path,
      source: row.source,
      enabled: row.enabled === 1,
      state: row.state,
      trust: row.trust,
      integritySha256: row.integrity_sha256,
      permissions: pluginPermissionGrants(manifest, this.repository.listPermissions(row.id)),
      contributionCounts: {
        skills: resources.filter((resource) => resource.resource_type === 'skill').length,
        mcpServers: resources.filter((resource) => resource.resource_type === 'mcp-server').length,
        connectors: resources.filter((resource) => resource.resource_type === 'connector').length,
        ...(resources.filter((resource) => resource.resource_type === 'runtime').length > 0
          ? {
              runtimes: resources.filter((resource) => resource.resource_type === 'runtime').length,
            }
          : {}),
      },
      installedAt: row.installed_at,
      updatedAt: row.updated_at,
    }
  }
}

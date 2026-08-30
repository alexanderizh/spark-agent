import type {
  ToolPackageConfigScope,
  ToolPackageManifest,
  ToolPackageSecureRequestStatus,
  ToolPackageSource,
  ToolPackageTool,
  ToolPackageTrust,
} from '@spark/protocol'
import type { SparkDatabase } from '../database.js'
import { BaseRepository } from './base.repository.js'

export type ToolPackageState =
  | 'inspected'
  | 'installed-disabled'
  | 'configuration-ready'
  | 'enabled'
  | 'error'

export type ToolPackageVersionStatus = 'staged' | 'installed' | 'failed' | 'archived'
export type ToolPackagePermissionKind = 'os-effect' | 'spark-capability'
export type ToolPackagePermissionState = 'pending' | 'granted' | 'denied'

export interface ToolPackageRow {
  id: string
  display_name: string
  description: string
  source: ToolPackageSource
  trust: ToolPackageTrust
  state: ToolPackageState
  enabled_version: string | null
  created_at: string
  updated_at: string
}

export interface ToolPackageVersionRow {
  package_id: string
  version: string
  manifest_json: string
  install_path: string
  source_path: string | null
  integrity_sha256: string
  status: ToolPackageVersionStatus
  installed_at: string
}

export interface ToolPackageToolRow {
  package_id: string
  version: string
  tool_name: string
  enabled: number
  definition_json: string
}

export interface ToolPackageConfigRow {
  package_id: string
  scope: ToolPackageConfigScope
  scope_id: string
  tool_name: string
  name: string
  is_secret: number
  value_json: string | null
  keystore_ref: string | null
  updated_at: string
}

export interface ToolPackagePermissionRow {
  package_id: string
  version: string
  kind: ToolPackagePermissionKind
  permission: string
  required: number
  state: ToolPackagePermissionState
  reviewed_at: string | null
  updated_at: string
}

export interface ToolPackageSecureRequestRow {
  id: string
  package_id: string
  version: string
  name: string
  scope: ToolPackageConfigScope
  scope_id: string
  tool_name: string
  requested_by: 'agent' | 'user'
  status: ToolPackageSecureRequestStatus
  expires_at: string
  created_at: string
  completed_at: string | null
}

export interface InstallToolPackageVersionParams {
  manifest: ToolPackageManifest
  source: ToolPackageSource
  trust: ToolPackageTrust
  installPath: string
  sourcePath?: string
  integritySha256: string
}

export class ToolPackageRepository extends BaseRepository {
  constructor(db: SparkDatabase) {
    super(db, 'tool_packages')
  }

  list(): ToolPackageRow[] {
    return this.raw
      .prepare('SELECT * FROM tool_packages ORDER BY display_name COLLATE NOCASE ASC')
      .all() as ToolPackageRow[]
  }

  get(packageId: string): ToolPackageRow | undefined {
    return this.raw.prepare('SELECT * FROM tool_packages WHERE id = ?').get(packageId) as
      | ToolPackageRow
      | undefined
  }

  getVersion(packageId: string, version: string): ToolPackageVersionRow | undefined {
    return this.raw
      .prepare('SELECT * FROM tool_package_versions WHERE package_id = ? AND version = ?')
      .get(packageId, version) as ToolPackageVersionRow | undefined
  }

  listVersions(packageId: string): ToolPackageVersionRow[] {
    return this.raw
      .prepare(
        'SELECT * FROM tool_package_versions WHERE package_id = ? ORDER BY installed_at DESC',
      )
      .all(packageId) as ToolPackageVersionRow[]
  }

  listTools(packageId: string, version: string): ToolPackageToolRow[] {
    return this.raw
      .prepare(
        'SELECT * FROM tool_package_tools WHERE package_id = ? AND version = ? ORDER BY tool_name ASC',
      )
      .all(packageId, version) as ToolPackageToolRow[]
  }

  installVersion(params: InstallToolPackageVersionParams): ToolPackageVersionRow {
    const existing = this.getVersion(params.manifest.id, params.manifest.version)
    if (existing != null) {
      if (
        existing.integrity_sha256 !== params.integritySha256 ||
        existing.manifest_json !== JSON.stringify(params.manifest)
      ) {
        throw new Error(
          `Tool package version is immutable: ${params.manifest.id}@${params.manifest.version}`,
        )
      }
      return existing
    }
    const now = new Date().toISOString()
    const transaction = this.raw.transaction(() => {
      this.raw
        .prepare(
          `
          INSERT INTO tool_packages (
            id, display_name, description, source, trust, state,
            enabled_version, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, 'installed-disabled', NULL, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            display_name = excluded.display_name,
            description = excluded.description,
            source = excluded.source,
            trust = CASE
              WHEN tool_packages.trust = 'blocked' THEN tool_packages.trust
              ELSE excluded.trust
            END,
            updated_at = excluded.updated_at
        `,
        )
        .run(
          params.manifest.id,
          params.manifest.name,
          params.manifest.description,
          params.source,
          params.trust,
          now,
          now,
        )

      this.raw
        .prepare(
          `
          INSERT INTO tool_package_versions (
            package_id, version, manifest_json, install_path, source_path,
            integrity_sha256, status, installed_at
          ) VALUES (?, ?, ?, ?, ?, ?, 'installed', ?)
        `,
        )
        .run(
          params.manifest.id,
          params.manifest.version,
          JSON.stringify(params.manifest),
          params.installPath,
          params.sourcePath ?? null,
          params.integritySha256,
          now,
        )

      this.replaceTools(params.manifest.id, params.manifest.version, params.manifest.tools)
      this.replacePermissions(params.manifest, now)
    })
    transaction()
    return this.getVersion(params.manifest.id, params.manifest.version)!
  }

  setEnabledVersion(packageId: string, version: string | null): ToolPackageRow | undefined {
    if (version != null) {
      const versionRow = this.getVersion(packageId, version)
      if (versionRow == null || versionRow.status !== 'installed') {
        throw new Error(`Tool package version is not installed: ${packageId}@${version}`)
      }
    }
    const state: ToolPackageState = version == null ? 'installed-disabled' : 'enabled'
    this.raw
      .prepare(
        'UPDATE tool_packages SET enabled_version = ?, state = ?, updated_at = ? WHERE id = ?',
      )
      .run(version, state, new Date().toISOString(), packageId)
    return this.get(packageId)
  }

  setToolEnabled(packageId: string, version: string, toolName: string, enabled: boolean): boolean {
    const result = this.raw
      .prepare(
        `UPDATE tool_package_tools SET enabled = ?
         WHERE package_id = ? AND version = ? AND tool_name = ?`,
      )
      .run(enabled ? 1 : 0, packageId, version, toolName)
    return result.changes > 0
  }

  /** Delete a package and every version/tool/config/permission/secure-request row via cascade. */
  deletePackage(packageId: string): boolean {
    const result = this.raw.prepare('DELETE FROM tool_packages WHERE id = ?').run(packageId)
    return result.changes > 0
  }

  /** Delete one version row; version-scoped tools/permissions/secure requests cascade. */
  deleteVersion(packageId: string, version: string): boolean {
    const result = this.raw
      .prepare('DELETE FROM tool_package_versions WHERE package_id = ? AND version = ?')
      .run(packageId, version)
    return result.changes > 0
  }

  listConfig(packageId: string): ToolPackageConfigRow[] {
    return this.raw
      .prepare(
        `SELECT * FROM tool_package_config
         WHERE package_id = ? ORDER BY scope, scope_id, tool_name, name`,
      )
      .all(packageId) as ToolPackageConfigRow[]
  }

  setConfig(params: {
    packageId: string
    scope: ToolPackageConfigScope
    scopeId?: string
    toolName?: string
    name: string
    value?: unknown
    keystoreRef?: string
  }): ToolPackageConfigRow {
    const secret = params.keystoreRef != null
    if (secret === (params.value !== undefined)) {
      throw new Error('Tool package config must provide exactly one of value or keystoreRef')
    }
    const scopeId = params.scopeId ?? ''
    const toolName = params.toolName ?? ''
    const now = new Date().toISOString()
    this.raw
      .prepare(
        `
        INSERT INTO tool_package_config (
          package_id, scope, scope_id, tool_name, name,
          is_secret, value_json, keystore_ref, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(package_id, scope, scope_id, tool_name, name) DO UPDATE SET
          is_secret = excluded.is_secret,
          value_json = excluded.value_json,
          keystore_ref = excluded.keystore_ref,
          updated_at = excluded.updated_at
      `,
      )
      .run(
        params.packageId,
        params.scope,
        scopeId,
        toolName,
        params.name,
        secret ? 1 : 0,
        secret ? null : JSON.stringify(params.value),
        params.keystoreRef ?? null,
        now,
      )
    return this.raw
      .prepare(
        `SELECT * FROM tool_package_config
         WHERE package_id = ? AND scope = ? AND scope_id = ? AND tool_name = ? AND name = ?`,
      )
      .get(params.packageId, params.scope, scopeId, toolName, params.name) as ToolPackageConfigRow
  }

  deleteConfig(params: {
    packageId: string
    scope: ToolPackageConfigScope
    scopeId?: string
    toolName?: string
    name: string
  }): boolean {
    const result = this.raw
      .prepare(
        `DELETE FROM tool_package_config
         WHERE package_id = ? AND scope = ? AND scope_id = ? AND tool_name = ? AND name = ?`,
      )
      .run(params.packageId, params.scope, params.scopeId ?? '', params.toolName ?? '', params.name)
    return result.changes > 0
  }

  listPermissions(packageId: string, version: string): ToolPackagePermissionRow[] {
    return this.raw
      .prepare(
        `SELECT * FROM tool_package_permissions
         WHERE package_id = ? AND version = ? ORDER BY kind, permission`,
      )
      .all(packageId, version) as ToolPackagePermissionRow[]
  }

  createSecureRequest(params: {
    id: string
    packageId: string
    version: string
    name: string
    scope: ToolPackageConfigScope
    scopeId?: string
    toolName?: string
    requestedBy: 'agent' | 'user'
    expiresAt: string
  }): ToolPackageSecureRequestRow {
    const createdAt = new Date().toISOString()
    this.raw
      .prepare(
        `INSERT INTO tool_package_secure_requests (
          id, package_id, version, name, scope, scope_id, tool_name,
          requested_by, status, expires_at, created_at, completed_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, NULL)`,
      )
      .run(
        params.id,
        params.packageId,
        params.version,
        params.name,
        params.scope,
        params.scopeId ?? '',
        params.toolName ?? '',
        params.requestedBy,
        params.expiresAt,
        createdAt,
      )
    return this.getSecureRequest(params.id)!
  }

  getSecureRequest(id: string): ToolPackageSecureRequestRow | undefined {
    return this.raw.prepare('SELECT * FROM tool_package_secure_requests WHERE id = ?').get(id) as
      | ToolPackageSecureRequestRow
      | undefined
  }

  listSecureRequests(status?: ToolPackageSecureRequestStatus): ToolPackageSecureRequestRow[] {
    return (
      status == null
        ? this.raw
            .prepare('SELECT * FROM tool_package_secure_requests ORDER BY created_at DESC')
            .all()
        : this.raw
            .prepare(
              'SELECT * FROM tool_package_secure_requests WHERE status = ? ORDER BY created_at DESC',
            )
            .all(status)
    ) as ToolPackageSecureRequestRow[]
  }

  setSecureRequestStatus(
    id: string,
    status: Exclude<ToolPackageSecureRequestStatus, 'pending'>,
  ): boolean {
    const completedAt = status === 'completed' ? new Date().toISOString() : null
    const result = this.raw
      .prepare(
        `UPDATE tool_package_secure_requests
         SET status = ?, completed_at = ?
         WHERE id = ? AND status = 'pending'`,
      )
      .run(status, completedAt, id)
    return result.changes > 0
  }

  setPermissionState(params: {
    packageId: string
    version: string
    kind: ToolPackagePermissionKind
    permission: string
    state: ToolPackagePermissionState
  }): boolean {
    const now = new Date().toISOString()
    const result = this.raw
      .prepare(
        `UPDATE tool_package_permissions
         SET state = ?, reviewed_at = ?, updated_at = ?
         WHERE package_id = ? AND version = ? AND kind = ? AND permission = ?`,
      )
      .run(
        params.state,
        params.state === 'pending' ? null : now,
        now,
        params.packageId,
        params.version,
        params.kind,
        params.permission,
      )
    return result.changes > 0
  }

  private replaceTools(packageId: string, version: string, tools: ToolPackageTool[]): void {
    this.raw
      .prepare('DELETE FROM tool_package_tools WHERE package_id = ? AND version = ?')
      .run(packageId, version)
    const insert = this.raw.prepare(
      `INSERT INTO tool_package_tools
       (package_id, version, tool_name, enabled, definition_json)
       VALUES (?, ?, ?, 1, ?)`,
    )
    for (const tool of tools) insert.run(packageId, version, tool.name, JSON.stringify(tool))
  }

  private replacePermissions(manifest: ToolPackageManifest, now: string): void {
    this.raw
      .prepare('DELETE FROM tool_package_permissions WHERE package_id = ? AND version = ?')
      .run(manifest.id, manifest.version)
    const insert = this.raw.prepare(
      `INSERT INTO tool_package_permissions
       (package_id, version, kind, permission, required, state, reviewed_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'pending', NULL, ?)`,
    )
    for (const effect of manifest.permissions.declaredOsEffects) {
      insert.run(manifest.id, manifest.version, 'os-effect', effect, 1, now)
    }
    for (const capability of manifest.permissions.requiredSparkCapabilities) {
      insert.run(manifest.id, manifest.version, 'spark-capability', capability, 1, now)
    }
    for (const capability of manifest.permissions.optionalSparkCapabilities) {
      insert.run(manifest.id, manifest.version, 'spark-capability', capability, 0, now)
    }
  }
}

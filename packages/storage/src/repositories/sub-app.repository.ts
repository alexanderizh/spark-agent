import { randomUUID } from 'crypto'
import type {
  SubAppDataRecord,
  SubAppDetails,
  SubAppDraft,
  SubAppDraftPatch,
  SubAppListRequest,
  SubAppManifest,
  SubAppPublicationStatus,
  SubAppRelease,
  SubAppReleaseSummary,
  SubAppSummary,
  SubAppSurface,
} from '@spark/protocol'
import { BaseRepository } from './base.repository.js'
import type { SparkDatabase } from '../database.js'

export interface SubAppRow {
  id: string
  name: string
  description: string
  icon: string | null
  entry: string
  surface: SubAppSurface
  publication_status: SubAppPublicationStatus
  enabled: number
  draft_source: string
  draft_config_json: string
  draft_permissions_json: string
  draft_revision: number
  published_release_id: string | null
  created_at: string
  updated_at: string
}

export interface SubAppReleaseRow {
  id: string
  app_id: string
  version: number
  source: string
  config_json: string
  permissions_json: string
  entry: string
  surface: SubAppSurface
  name: string
  description: string
  icon: string | null
  published_at: string
}

export interface SubAppDataRow {
  app_id: string
  namespace: string
  key: string
  value_json: string
  revision: number
  created_at: string
  updated_at: string
}

export interface CreateSubAppParams {
  id?: string
  name: string
  description?: string
  icon?: string | null
  entry?: string
  surface?: SubAppSurface
  permissions?: string[]
  source?: string
  config?: Record<string, unknown>
}

/**
 * 应用数据只属于当前 appId 的命名空间，不会读取其他应用或会话数据。
 * 因此新建应用默认开放 data 能力，保证 Agent 生成的可持久化应用开箱可用；
 * 调用方显式传入 [] 仍然表示拒绝 data 权限。
 */
export const DEFAULT_SUB_APP_PERMISSIONS = ['data'] as const

export interface SubAppListPage {
  items: SubAppSummary[]
  total: number
}

export class SubAppConflictError extends Error {
  constructor(message = '子应用草稿已被其他操作更新，请刷新后重试。') {
    super(message)
    this.name = 'SubAppConflictError'
  }
}

export class SubAppDataConflictError extends Error {
  constructor(message = '子应用数据已被其他操作更新，请读取最新 revision 后重试。') {
    super(message)
    this.name = 'SubAppDataConflictError'
  }
}

export class SubAppStateError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SubAppStateError'
  }
}

export class SubAppNotFoundError extends Error {
  constructor(message = '子应用不存在或已被删除。') {
    super(message)
    this.name = 'SubAppNotFoundError'
  }
}

export class SubAppReleaseNotFoundError extends Error {
  constructor(message = '指定的子应用发布版本不存在。') {
    super(message)
    this.name = 'SubAppReleaseNotFoundError'
  }
}

export class SubAppDataValidationError extends Error {
  constructor(message = '子应用数据不是可持久化的 JSON 值。') {
    super(message)
    this.name = 'SubAppDataValidationError'
  }
}

export class SubAppRepository extends BaseRepository {
  constructor(db: SparkDatabase) {
    super(db, 'sub_apps')
  }

  create(params: CreateSubAppParams): SubAppDetails {
    const id = params.id ?? randomUUID()
    const now = new Date().toISOString()
    this.raw
      .prepare(
        `INSERT INTO sub_apps (
          id, name, description, icon, entry, surface, publication_status, enabled,
          draft_source, draft_config_json, draft_permissions_json, draft_revision,
          published_release_id, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, 'draft', 0, ?, ?, ?, 1, NULL, ?, ?)`,
      )
      .run(
        id,
        params.name,
        params.description ?? '',
        params.icon ?? null,
        params.entry ?? 'index.html',
        params.surface ?? 'content',
        params.source ?? '',
        this.toJson(params.config ?? {}),
        this.toJson(params.permissions ?? DEFAULT_SUB_APP_PERMISSIONS),
        now,
        now,
      )
    const created = this.get(id)
    if (created == null) throw new SubAppStateError('子应用创建后无法读取。')
    return created
  }

  get(id: string, releaseVersion?: number): SubAppDetails | null {
    const row = this.getRow(id)
    if (row == null) return null

    let release: SubAppReleaseRow | null = null
    if (releaseVersion !== undefined) {
      release = this.getReleaseRow(id, releaseVersion)
    } else if (row.published_release_id != null) {
      release = this.getReleaseById(row.published_release_id)
    }

    return this.toDetails(row, release)
  }

  list(params: SubAppListRequest = {}): SubAppListPage {
    const conditions: string[] = []
    const values: Array<string | number> = []

    if (params.menuOnly === true) {
      conditions.push("publication_status = 'published'")
      conditions.push('enabled = 1')
    } else if (params.includeArchived !== true) {
      conditions.push("publication_status != 'archived'")
    }

    const query = params.query?.trim()
    if (query) {
      const pattern = `%${query}%`
      conditions.push('(name LIKE ? OR description LIKE ?)')
      values.push(pattern, pattern)
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
    const totalRow = this.raw
      .prepare(`SELECT COUNT(*) AS count FROM sub_apps ${where}`)
      .get(...values) as { count: number }
    const limit = Math.min(Math.max(params.limit ?? 100, 1), 100)
    const offset = Math.max(params.offset ?? 0, 0)
    const rows = this.raw
      .prepare(
        `SELECT * FROM sub_apps ${where}
         ORDER BY updated_at DESC, created_at DESC
         LIMIT ? OFFSET ?`,
      )
      .all(...values, limit, offset) as SubAppRow[]

    return {
      items: rows.map((row) => this.toSummary(row)),
      total: totalRow.count,
    }
  }

  updateDraft(
    id: string,
    expectedDraftRevision: number,
    patch: SubAppDraftPatch,
  ): SubAppDetails | null {
    const current = this.getRow(id)
    if (current == null) return null
    this.assertDraftRevision(current, expectedDraftRevision)
    this.assertMutable(current)

    const hasChanges = Object.keys(patch).length > 0
    if (!hasChanges) return this.get(id)

    const now = new Date().toISOString()
    const updateResult = this.raw
      .prepare(
        `UPDATE sub_apps SET
          name = ?, description = ?, icon = ?, entry = ?, surface = ?,
          draft_source = ?, draft_config_json = ?, draft_permissions_json = ?,
          draft_revision = ?, updated_at = ?
         WHERE id = ? AND draft_revision = ?`,
      )
      .run(
        patch.name ?? current.name,
        patch.description ?? current.description,
        patch.icon !== undefined ? patch.icon : current.icon,
        patch.entry ?? current.entry,
        patch.surface ?? current.surface,
        patch.source ?? current.draft_source,
        patch.config !== undefined ? this.toJson(patch.config) : current.draft_config_json,
        patch.permissions !== undefined
          ? this.toJson(patch.permissions)
          : current.draft_permissions_json,
        current.draft_revision + 1,
        now,
        id,
        expectedDraftRevision,
      )

    if (updateResult.changes !== 1) throw new SubAppConflictError()
    return this.get(id)
  }

  publish(id: string, expectedDraftRevision: number): SubAppDetails | null {
    return this.raw.transaction(() => {
      const current = this.getRow(id)
      if (current == null) return null
      this.assertDraftRevision(current, expectedDraftRevision)
      this.assertMutable(current)
      // 空源码发布出去必然白屏：在发布口拦下，避免空壳版本进入菜单。
      if (current.draft_source.trim().length === 0) {
        throw new SubAppStateError('草稿源码为空，无法发布：请先用源码更新草稿。')
      }

      const nextVersionRow = this.raw
        .prepare(
          'SELECT COALESCE(MAX(version), 0) AS version FROM sub_app_releases WHERE app_id = ?',
        )
        .get(id) as { version: number }
      const releaseId = randomUUID()
      const nextVersion = nextVersionRow.version + 1
      const now = new Date().toISOString()
      this.raw
        .prepare(
          `INSERT INTO sub_app_releases (
            id, app_id, version, source, config_json, permissions_json,
            entry, surface, name, description, icon, published_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          releaseId,
          id,
          nextVersion,
          current.draft_source,
          current.draft_config_json,
          current.draft_permissions_json,
          current.entry,
          current.surface,
          current.name,
          current.description,
          current.icon,
          now,
        )
      // 发布即启用：菜单只显示「已发布 + 已启用」，若发布后仍为禁用，
      // 用户还得再手动开一次开关才可见——不符合直觉。禁用可随时再关。
      const updateResult = this.raw
        .prepare(
          `UPDATE sub_apps
           SET publication_status = 'published', published_release_id = ?, enabled = 1, updated_at = ?
           WHERE id = ? AND draft_revision = ?`,
        )
        .run(releaseId, now, id, expectedDraftRevision)
      if (updateResult.changes !== 1) throw new SubAppConflictError()
      return this.get(id)
    })()
  }

  setEnabled(id: string, enabled: boolean): SubAppSummary | null {
    const current = this.getRow(id)
    if (current == null) return null
    if (current.publication_status === 'archived' && enabled) {
      throw new SubAppStateError('已归档的子应用不能直接启用，请先恢复到草稿或发布状态。')
    }
    // 菜单可见性由 list({menuOnly}) 的 published+enabled 双条件保证，
    // 这里不再限制「仅已发布可启用」——否则草稿态应用一旦禁用就无法恢复，
    // 形成状态死角。
    this.raw
      .prepare('UPDATE sub_apps SET enabled = ?, updated_at = ? WHERE id = ?')
      .run(enabled ? 1 : 0, new Date().toISOString(), id)
    const updated = this.getRow(id)
    if (updated == null) throw new SubAppNotFoundError()
    return this.toSummary(updated)
  }

  archive(id: string): SubAppSummary | null {
    const current = this.getRow(id)
    if (current == null) return null
    this.raw
      .prepare(
        "UPDATE sub_apps SET publication_status = 'archived', enabled = 0, updated_at = ? WHERE id = ?",
      )
      .run(new Date().toISOString(), id)
    const archived = this.getRow(id)
    if (archived == null) throw new SubAppNotFoundError()
    return this.toSummary(archived)
  }

  listReleases(
    id: string,
    options: { limit?: number; offset?: number } = {},
  ): { items: SubAppReleaseSummary[]; total: number } | null {
    const app = this.getRow(id)
    if (app == null) return null
    const totalRow = this.raw
      .prepare('SELECT COUNT(*) AS count FROM sub_app_releases WHERE app_id = ?')
      .get(id) as { count: number }
    const limit = Math.min(Math.max(options.limit ?? 50, 1), 100)
    const offset = Math.max(options.offset ?? 0, 0)
    const rows = this.raw
      .prepare(
        `SELECT * FROM sub_app_releases WHERE app_id = ?
         ORDER BY version DESC
         LIMIT ? OFFSET ?`,
      )
      .all(id, limit, offset) as SubAppReleaseRow[]
    return {
      items: rows.map((row) => ({
        id: row.id,
        version: row.version,
        name: row.name,
        description: row.description,
        icon: row.icon,
        surface: row.surface,
        entry: row.entry,
        publishedAt: row.published_at,
        isPublished: row.id === app.published_release_id,
      })),
      total: totalRow.count,
    }
  }

  /**
   * 删除历史发布版本。当前生效版本必须保留，否则 published_release_id
   * 会失去指向，已发布应用也会变成无法运行的空壳。
   */
  deleteRelease(id: string, version: number): boolean {
    const app = this.getRow(id)
    if (app == null) throw new SubAppNotFoundError()
    const release = this.getReleaseRow(id, version)
    if (release == null) throw new SubAppReleaseNotFoundError()
    if (release.id === app.published_release_id) {
      throw new SubAppStateError('当前生效版本不能删除，请先发布其他版本后再删除。')
    }
    const result = this.raw
      .prepare('DELETE FROM sub_app_releases WHERE app_id = ? AND version = ?')
      .run(id, version)
    return result.changes === 1
  }

  /**
   * 硬删除应用及其全部发布版本和应用数据。
   * 调用方（IPC/Agent 层）必须先完成影响范围确认；这里只保证删除的原子性。
   */
  delete(id: string): boolean {
    return this.raw.transaction(() => {
      const current = this.getRow(id)
      if (current == null) return false
      // foreign_keys = ON 时 releases/data 随 CASCADE 删除；显式删除兜底旧库 pragma 缺失的情况。
      this.raw.prepare('DELETE FROM sub_app_releases WHERE app_id = ?').run(id)
      this.raw.prepare('DELETE FROM sub_app_data WHERE app_id = ?').run(id)
      const result = this.raw.prepare('DELETE FROM sub_apps WHERE id = ?').run(id)
      return result.changes === 1
    })()
  }

  deleteData(appId: string, namespace: string, key: string, expectedRevision: number): boolean {
    this.assertAppExists(appId)
    const result = this.raw
      .prepare(
        `DELETE FROM sub_app_data
         WHERE app_id = ? AND namespace = ? AND key = ? AND revision = ?`,
      )
      .run(appId, namespace, key, expectedRevision)
    if (result.changes === 0) {
      // 区分“记录不存在”与“revision 不匹配”：先查再报，避免把冲突误报成成功。
      const current = this.raw
        .prepare('SELECT revision FROM sub_app_data WHERE app_id = ? AND namespace = ? AND key = ?')
        .get(appId, namespace, key) as { revision: number } | undefined
      if (current != null) throw new SubAppDataConflictError()
      throw new SubAppNotFoundError('指定的应用数据不存在。')
    }
    return true
  }

  rollbackDraft(
    id: string,
    releaseVersion: number,
    expectedDraftRevision: number,
  ): SubAppDetails | null {
    const current = this.getRow(id)
    if (current == null) return null
    this.assertDraftRevision(current, expectedDraftRevision)
    this.assertMutable(current)
    const release = this.getReleaseRow(id, releaseVersion)
    if (release == null) throw new SubAppReleaseNotFoundError()

    const updateResult = this.raw
      .prepare(
        `UPDATE sub_apps SET
          name = ?, description = ?, icon = ?, entry = ?, surface = ?,
          draft_source = ?, draft_config_json = ?, draft_permissions_json = ?,
          draft_revision = ?, updated_at = ?
         WHERE id = ? AND draft_revision = ?`,
      )
      .run(
        release.name,
        release.description,
        release.icon,
        release.entry,
        release.surface,
        release.source,
        release.config_json,
        release.permissions_json,
        current.draft_revision + 1,
        new Date().toISOString(),
        id,
        expectedDraftRevision,
      )
    if (updateResult.changes !== 1) throw new SubAppConflictError()
    return this.get(id)
  }

  getData(appId: string, namespace: string, key: string): SubAppDataRecord | null {
    this.assertAppExists(appId)
    const row = this.raw
      .prepare('SELECT * FROM sub_app_data WHERE app_id = ? AND namespace = ? AND key = ?')
      .get(appId, namespace, key) as SubAppDataRow | undefined
    return row == null ? null : this.toDataRecord(row)
  }

  listData(
    appId: string,
    namespace: string,
    options: { prefix?: string; limit?: number; offset?: number } = {},
  ): { items: SubAppDataRecord[]; total: number } {
    this.assertAppExists(appId)
    const conditions = ['app_id = ?', 'namespace = ?']
    const values: string[] = [appId, namespace]
    if (options.prefix) {
      conditions.push("key LIKE ? ESCAPE '\\'")
      values.push(`${escapeLikePattern(options.prefix)}%`)
    }
    const where = conditions.join(' AND ')
    const totalRow = this.raw
      .prepare(`SELECT COUNT(*) AS count FROM sub_app_data WHERE ${where}`)
      .get(...values) as { count: number }
    const limit = Math.min(Math.max(options.limit ?? 100, 1), 200)
    const offset = Math.max(options.offset ?? 0, 0)
    const rows = this.raw
      .prepare(
        `SELECT * FROM sub_app_data WHERE ${where}
         ORDER BY key COLLATE NOCASE ASC
         LIMIT ? OFFSET ?`,
      )
      .all(...values, limit, offset) as SubAppDataRow[]
    return { items: rows.map((row) => this.toDataRecord(row)), total: totalRow.count }
  }

  upsertData(
    appId: string,
    namespace: string,
    key: string,
    value: unknown,
    expectedRevision?: number,
  ): SubAppDataRecord {
    const currentApp = this.getRow(appId)
    if (currentApp == null) throw new SubAppStateError('子应用不存在或已被删除。')
    if (currentApp.publication_status === 'archived') {
      throw new SubAppStateError('已归档的子应用不能写入数据。')
    }

    let serialized: string
    try {
      serialized = JSON.stringify(value)
      if (serialized === undefined || serialized.length > 512_000) throw new Error('size')
    } catch {
      throw new SubAppDataValidationError('子应用数据必须是可持久化且不超过 512 KB 的 JSON 值。')
    }

    return this.raw.transaction(() => {
      const current = this.raw
        .prepare('SELECT * FROM sub_app_data WHERE app_id = ? AND namespace = ? AND key = ?')
        .get(appId, namespace, key) as SubAppDataRow | undefined
      const now = new Date().toISOString()
      if (current == null) {
        if (expectedRevision !== undefined) throw new SubAppDataConflictError()
        this.raw
          .prepare(
            `INSERT INTO sub_app_data
              (app_id, namespace, key, value_json, revision, created_at, updated_at)
             VALUES (?, ?, ?, ?, 1, ?, ?)`,
          )
          .run(appId, namespace, key, serialized, now, now)
      } else {
        // 不传 expectedRevision 表示本地应用明确接受 last-write-wins；
        // 传入时才启用 CAS，供 Agent 或并发写入场景避免覆盖新数据。
        if (expectedRevision !== undefined && current.revision !== expectedRevision) {
          throw new SubAppDataConflictError()
        }
        const revisionCondition = expectedRevision ?? current.revision
        const updateResult = this.raw
          .prepare(
            `UPDATE sub_app_data
             SET value_json = ?, revision = ?, updated_at = ?
             WHERE app_id = ? AND namespace = ? AND key = ? AND revision = ?`,
          )
          .run(serialized, current.revision + 1, now, appId, namespace, key, revisionCondition)
        if (updateResult.changes !== 1) throw new SubAppDataConflictError()
      }
      const saved = this.getData(appId, namespace, key)
      if (saved == null) throw new SubAppDataValidationError('子应用数据写入后无法读取。')
      return saved
    })()
  }

  private getRow(id: string): SubAppRow | null {
    return this.findById<SubAppRow>(id)
  }

  private getReleaseById(id: string): SubAppReleaseRow | null {
    return (
      (this.raw.prepare('SELECT * FROM sub_app_releases WHERE id = ?').get(id) as
        | SubAppReleaseRow
        | undefined) ?? null
    )
  }

  private getReleaseRow(appId: string, version: number): SubAppReleaseRow | null {
    return (
      (this.raw
        .prepare('SELECT * FROM sub_app_releases WHERE app_id = ? AND version = ?')
        .get(appId, version) as SubAppReleaseRow | undefined) ?? null
    )
  }

  private assertAppExists(id: string): void {
    if (this.getRow(id) == null) throw new SubAppNotFoundError()
  }

  private assertDraftRevision(row: SubAppRow, expected: number): void {
    if (row.draft_revision !== expected) throw new SubAppConflictError()
  }

  private assertMutable(row: SubAppRow): void {
    if (row.publication_status === 'archived') {
      throw new SubAppStateError('已归档的子应用不能修改，请先恢复后再操作。')
    }
  }

  private toSummary(row: SubAppRow): SubAppSummary {
    const published =
      row.published_release_id == null ? null : this.getReleaseById(row.published_release_id)
    return {
      id: row.id,
      name: row.name,
      description: row.description,
      icon: row.icon,
      surface: row.surface,
      publicationStatus: row.publication_status,
      enabled: row.enabled === 1,
      draftRevision: row.draft_revision,
      publishedVersion: published?.version ?? null,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }
  }

  private toDetails(row: SubAppRow, release: SubAppReleaseRow | null): SubAppDetails {
    const manifest = this.toManifest(row)
    const draft: SubAppDraft = {
      revision: row.draft_revision,
      source: row.draft_source,
      config: this.parseJson<Record<string, unknown>>(row.draft_config_json, '草稿配置'),
      manifest,
      updatedAt: row.updated_at,
    }
    return {
      ...this.toSummary(row),
      draft,
      publishedRelease: release == null ? null : this.toRelease(release),
    }
  }

  private toManifest(row: SubAppRow): SubAppManifest {
    return {
      name: row.name,
      description: row.description,
      icon: row.icon,
      entry: row.entry,
      surface: row.surface,
      permissions: this.parseJson<string[]>(row.draft_permissions_json, '子应用权限'),
    }
  }

  private toRelease(row: SubAppReleaseRow): SubAppRelease {
    return {
      id: row.id,
      appId: row.app_id,
      version: row.version,
      source: row.source,
      config: this.parseJson<Record<string, unknown>>(row.config_json, '发布配置'),
      manifest: {
        name: row.name,
        description: row.description,
        icon: row.icon,
        entry: row.entry,
        surface: row.surface,
        permissions: this.parseJson<string[]>(row.permissions_json, '发布权限'),
      },
      publishedAt: row.published_at,
    }
  }

  private toDataRecord(row: SubAppDataRow): SubAppDataRecord {
    return {
      appId: row.app_id,
      namespace: row.namespace,
      key: row.key,
      value: this.parseJson<unknown>(row.value_json, '子应用数据'),
      revision: row.revision,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }
  }

  private parseJson<T>(value: string, label: string): T {
    try {
      return JSON.parse(value) as T
    } catch {
      throw new SubAppDataValidationError(`${label}已损坏，无法安全读取。`)
    }
  }
}

function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`)
}

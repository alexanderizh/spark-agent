import { randomUUID } from 'node:crypto'
import type {
  SubAppConnectionBinding,
  SubAppJob,
  SubAppJobStatus,
  SubAppPackageDescriptor,
  SubAppPackageManifest,
} from '@spark/protocol'
import type { SparkDatabase } from '../database.js'
import { SubAppConflictError, SubAppNotFoundError, SubAppStateError } from './sub-app.repository.js'

interface AppV2Row {
  id: string
  draft_revision: number
  draft_format: 'v1' | 'v2'
  publication_status: 'draft' | 'published' | 'archived'
}

interface ArtifactDescriptorRow {
  release_id: string
  sha256: string
  byte_length: number
  file_count: number
  manifest_json: string
  frontend_entry: string
  service_entry: string | null
  relative_path: string
}

interface JobRow {
  id: string
  app_id: string
  release_id: string
  type: string
  status: SubAppJobStatus
  input_json: string
  progress: number
  message: string | null
  checkpoint_json: string
  result_json: string
  error_json: string | null
  cancel_requested: number
  created_at: string
  started_at: string | null
  finished_at: string | null
  updated_at: string
}

export interface PublishSubAppPackageInput {
  appId: string
  expectedDraftRevision: number
  descriptor: SubAppPackageDescriptor
  relativePath: string
  buildInfo?: Record<string, unknown>
}

export interface PublishedSubAppPackage {
  releaseId: string
  version: number
  descriptor: SubAppPackageDescriptor
}

export class SubAppPlatformRepository {
  constructor(private readonly database: SparkDatabase) {}

  private get raw() {
    return this.database.raw
  }

  assertAppRevision(appId: string, expectedDraftRevision: number): AppV2Row {
    const app = this.raw.prepare('SELECT * FROM sub_apps WHERE id = ?').get(appId) as
      | AppV2Row
      | undefined
    if (app == null) throw new SubAppNotFoundError()
    if (app.publication_status === 'archived') {
      throw new SubAppStateError('已归档的子应用不能修改或发布。')
    }
    if (app.draft_revision !== expectedDraftRevision) throw new SubAppConflictError()
    return app
  }

  markDraftAsV2(
    appId: string,
    expectedDraftRevision: number,
    projectRevision: number,
    manifest: SubAppPackageManifest,
  ): number {
    this.assertAppRevision(appId, expectedDraftRevision)
    const nextRevision = expectedDraftRevision + 1
    const result = this.raw
      .prepare(
        `UPDATE sub_apps SET
          name = ?, description = ?, icon = ?, entry = ?, surface = ?,
          draft_permissions_json = ?, draft_format = 'v2', draft_project_revision = ?,
          draft_package_manifest_json = ?, draft_revision = ?, updated_at = ?
         WHERE id = ? AND draft_revision = ?`,
      )
      .run(
        manifest.name,
        manifest.description ?? '',
        manifest.icon ?? null,
        manifest.frontend.entry,
        manifest.surface,
        JSON.stringify(manifest.permissions.sparkCapabilities),
        projectRevision,
        JSON.stringify(manifest),
        nextRevision,
        new Date().toISOString(),
        appId,
        expectedDraftRevision,
      )
    if (result.changes !== 1) throw new SubAppConflictError()
    return nextRevision
  }

  getDraftFormat(appId: string): {
    format: 'v1' | 'v2'
    draftRevision: number
    projectRevision: number | null
    manifest: SubAppPackageManifest | null
  } {
    const row = this.raw
      .prepare(
        `SELECT draft_format, draft_revision, draft_project_revision,
                draft_package_manifest_json FROM sub_apps WHERE id = ?`,
      )
      .get(appId) as
      | {
          draft_format: 'v1' | 'v2'
          draft_revision: number
          draft_project_revision: number | null
          draft_package_manifest_json: string | null
        }
      | undefined
    if (row == null) throw new SubAppNotFoundError()
    return {
      format: row.draft_format,
      draftRevision: row.draft_revision,
      projectRevision: row.draft_project_revision,
      manifest: this.parseJson<SubAppPackageManifest | null>(row.draft_package_manifest_json, null),
    }
  }

  publishPackage(input: PublishSubAppPackageInput): PublishedSubAppPackage {
    return this.raw.transaction(() => {
      const app = this.assertAppRevision(input.appId, input.expectedDraftRevision)
      if (app.draft_format !== 'v2') throw new SubAppStateError('当前草稿不是 V2 应用包。')
      const now = new Date().toISOString()
      const artifactId = randomUUID()
      this.raw
        .prepare(
          `INSERT INTO sub_app_artifacts (
            id, sha256, schema_version, relative_path, byte_length, file_count,
            manifest_json, build_info_json, created_at
          ) VALUES (?, ?, 2, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(sha256) DO NOTHING`,
        )
        .run(
          artifactId,
          input.descriptor.digest,
          input.relativePath,
          input.descriptor.byteLength,
          input.descriptor.fileCount,
          JSON.stringify(input.descriptor.manifest),
          JSON.stringify(input.buildInfo ?? {}),
          now,
        )
      const artifact = this.raw
        .prepare('SELECT id FROM sub_app_artifacts WHERE sha256 = ?')
        .get(input.descriptor.digest) as { id: string } | undefined
      if (artifact == null) throw new SubAppStateError('子应用制品记录创建失败。')
      const versionRow = this.raw
        .prepare(
          'SELECT COALESCE(MAX(version), 0) AS version FROM sub_app_releases WHERE app_id = ?',
        )
        .get(input.appId) as { version: number }
      const version = versionRow.version + 1
      const releaseId = randomUUID()
      const manifest = input.descriptor.manifest
      this.raw
        .prepare(
          `INSERT INTO sub_app_releases (
            id, app_id, version, source, config_json, permissions_json,
            entry, surface, name, description, icon, published_at
          ) VALUES (?, ?, ?, '', '{}', ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          releaseId,
          input.appId,
          version,
          JSON.stringify(manifest.permissions.sparkCapabilities),
          manifest.frontend.entry,
          manifest.surface,
          manifest.name,
          manifest.description ?? '',
          manifest.icon ?? null,
          now,
        )
      this.raw
        .prepare(
          `INSERT INTO sub_app_release_artifacts (
            release_id, artifact_id, frontend_entry, service_entry,
            contract_digest, permission_digest
          ) VALUES (?, ?, ?, ?, NULL, ?)`,
        )
        .run(
          releaseId,
          artifact.id,
          input.descriptor.frontendEntry,
          input.descriptor.serviceEntry,
          this.digestPermissions(manifest),
        )
      const updated = this.raw
        .prepare(
          `UPDATE sub_apps SET publication_status = 'published',
             published_release_id = ?, enabled = 0, updated_at = ?
           WHERE id = ? AND draft_revision = ?`,
        )
        .run(releaseId, now, input.appId, input.expectedDraftRevision)
      if (updated.changes !== 1) throw new SubAppConflictError()
      return { releaseId, version, descriptor: input.descriptor }
    })()
  }

  getPackageForRelease(
    releaseId: string,
  ): (SubAppPackageDescriptor & { relativePath: string }) | null {
    const row = this.readArtifactRow(
      `SELECT ra.release_id, a.sha256, a.byte_length, a.file_count, a.manifest_json,
              ra.frontend_entry, ra.service_entry, a.relative_path
       FROM sub_app_release_artifacts ra JOIN sub_app_artifacts a ON a.id = ra.artifact_id
       WHERE ra.release_id = ?`,
      releaseId,
    )
    return row == null ? null : this.toDescriptor(row)
  }

  getPackageByVersion(
    appId: string,
    version: number,
  ): (SubAppPackageDescriptor & { relativePath: string }) | null {
    const row = this.readArtifactRow(
      `SELECT ra.release_id, a.sha256, a.byte_length, a.file_count, a.manifest_json,
              ra.frontend_entry, ra.service_entry, a.relative_path
       FROM sub_app_releases r
       JOIN sub_app_release_artifacts ra ON ra.release_id=r.id
       JOIN sub_app_artifacts a ON a.id=ra.artifact_id
       WHERE r.app_id=? AND r.version=?`,
      appId,
      version,
    )
    return row == null ? null : this.toDescriptor(row)
  }

  getPublishedPackage(
    appId: string,
  ): (SubAppPackageDescriptor & { relativePath: string; releaseId: string }) | null {
    const row = this.readArtifactRow(
      `SELECT ra.release_id, a.sha256, a.byte_length, a.file_count, a.manifest_json,
              ra.frontend_entry, ra.service_entry, a.relative_path
       FROM sub_apps s
       JOIN sub_app_release_artifacts ra ON ra.release_id = s.published_release_id
       JOIN sub_app_artifacts a ON a.id = ra.artifact_id WHERE s.id = ?`,
      appId,
    )
    return row == null ? null : { ...this.toDescriptor(row), releaseId: row.release_id }
  }

  isEnabledPublished(appId: string): boolean {
    const row = this.raw
      .prepare("SELECT enabled FROM sub_apps WHERE id=? AND publication_status='published'")
      .get(appId) as { enabled: number } | undefined
    return row?.enabled === 1
  }

  listBindings(appId: string): SubAppConnectionBinding[] {
    this.assertAppExists(appId)
    const rows = this.raw
      .prepare('SELECT * FROM sub_app_connection_bindings WHERE app_id = ? ORDER BY slot')
      .all(appId) as Array<Record<string, unknown>>
    return rows.map((row) => ({
      appId: String(row.app_id),
      slot: String(row.slot),
      bindingKind: row.binding_kind as SubAppConnectionBinding['bindingKind'],
      bindingId: String(row.binding_id),
      grantedOrigins: this.parseJson<string[]>(String(row.granted_origins_json), []),
      allowPrivateNetwork: row.allow_private_network === 1,
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
    }))
  }

  upsertBinding(
    binding: Omit<SubAppConnectionBinding, 'createdAt' | 'updatedAt'>,
  ): SubAppConnectionBinding {
    this.assertAppExists(binding.appId)
    const now = new Date().toISOString()
    this.raw
      .prepare(
        `INSERT INTO sub_app_connection_bindings (
          app_id, slot, binding_kind, binding_id, granted_origins_json,
          allow_private_network, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(app_id, slot) DO UPDATE SET
          binding_kind=excluded.binding_kind, binding_id=excluded.binding_id,
          granted_origins_json=excluded.granted_origins_json,
          allow_private_network=excluded.allow_private_network, updated_at=excluded.updated_at`,
      )
      .run(
        binding.appId,
        binding.slot,
        binding.bindingKind,
        binding.bindingId,
        JSON.stringify(binding.grantedOrigins),
        binding.allowPrivateNetwork ? 1 : 0,
        now,
        now,
      )
    const stored = this.listBindings(binding.appId).find((item) => item.slot === binding.slot)
    if (stored == null) throw new SubAppStateError('连接绑定保存失败。')
    return stored
  }

  deleteBinding(appId: string, slot: string): boolean {
    this.assertAppExists(appId)
    return (
      this.raw
        .prepare('DELETE FROM sub_app_connection_bindings WHERE app_id = ? AND slot = ?')
        .run(appId, slot).changes === 1
    )
  }

  createJob(appId: string, type: string, input: unknown): SubAppJob {
    if (!this.isEnabledPublished(appId))
      throw new SubAppStateError('子应用未启用，不能创建后台任务。')
    const published = this.getPublishedPackage(appId)
    if (published == null) throw new SubAppStateError('子应用尚未发布 V2 应用包。')
    assertBoundedJson(input, '任务输入')
    const id = randomUUID()
    const now = new Date().toISOString()
    this.raw
      .prepare(
        `INSERT INTO sub_app_jobs (
          id, app_id, release_id, type, status, input_json, progress,
          checkpoint_json, result_json, cancel_requested, created_at, updated_at
        ) VALUES (?, ?, ?, ?, 'queued', ?, 0, 'null', 'null', 0, ?, ?)`,
      )
      .run(id, appId, published.releaseId, type, JSON.stringify(input ?? null), now, now)
    return this.getJob(appId, id) as SubAppJob
  }

  getJob(appId: string, jobId: string): SubAppJob | null {
    const row = this.raw
      .prepare('SELECT * FROM sub_app_jobs WHERE app_id = ? AND id = ?')
      .get(appId, jobId) as JobRow | undefined
    return row == null ? null : this.toJob(row)
  }

  listJobs(
    appId: string,
    options: { status?: SubAppJobStatus; limit?: number; offset?: number } = {},
  ) {
    this.assertAppExists(appId)
    const where = options.status == null ? 'app_id = ?' : 'app_id = ? AND status = ?'
    const values: Array<string> = options.status == null ? [appId] : [appId, options.status]
    const total = this.raw
      .prepare(`SELECT COUNT(*) AS count FROM sub_app_jobs WHERE ${where}`)
      .get(...values) as { count: number }
    const rows = this.raw
      .prepare(
        `SELECT * FROM sub_app_jobs WHERE ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
      )
      .all(
        ...values,
        Math.min(Math.max(options.limit ?? 50, 1), 100),
        Math.max(options.offset ?? 0, 0),
      ) as JobRow[]
    return { items: rows.map((row) => this.toJob(row)), total: total.count }
  }

  listQueuedJobs(limit = 100): SubAppJob[] {
    const rows = this.raw
      .prepare(`SELECT * FROM sub_app_jobs WHERE status='queued' ORDER BY created_at ASC LIMIT ?`)
      .all(Math.min(Math.max(limit, 1), 500)) as JobRow[]
    return rows.map((row) => this.toJob(row))
  }

  requestJobCancel(appId: string, jobId: string): SubAppJob {
    const current = this.getJob(appId, jobId)
    if (current == null) throw new SubAppStateError('指定的子应用任务不存在。')
    if (['succeeded', 'failed', 'cancelled', 'interrupted'].includes(current.status)) return current
    this.raw
      .prepare('UPDATE sub_app_jobs SET cancel_requested=1, updated_at=? WHERE id=?')
      .run(new Date().toISOString(), jobId)
    return this.getJob(appId, jobId) as SubAppJob
  }

  transitionJob(
    appId: string,
    jobId: string,
    expected: SubAppJobStatus[],
    patch: Partial<Pick<SubAppJob, 'progress' | 'message' | 'checkpoint' | 'result' | 'error'>> & {
      status: SubAppJobStatus
    },
  ): SubAppJob {
    const current = this.getJob(appId, jobId)
    if (current == null) throw new SubAppStateError('指定的子应用任务不存在。')
    if (!expected.includes(current.status)) {
      throw new SubAppStateError(`任务状态 ${current.status} 不允许转换为 ${patch.status}。`)
    }
    if (patch.checkpoint !== undefined) assertBoundedJson(patch.checkpoint, '任务 checkpoint')
    if (patch.result !== undefined) assertBoundedJson(patch.result, '任务结果')
    if (patch.error !== undefined) assertBoundedJson(patch.error, '任务错误')
    const now = new Date().toISOString()
    const terminal = ['succeeded', 'failed', 'cancelled', 'interrupted'].includes(patch.status)
    this.raw
      .prepare(
        `UPDATE sub_app_jobs SET status=?, progress=?, message=?, checkpoint_json=?,
          result_json=?, error_json=?, started_at=?, finished_at=?, updated_at=?
         WHERE id=? AND app_id=?`,
      )
      .run(
        patch.status,
        patch.progress ?? current.progress,
        patch.message !== undefined ? patch.message : current.message,
        JSON.stringify(patch.checkpoint !== undefined ? patch.checkpoint : current.checkpoint),
        JSON.stringify(patch.result !== undefined ? patch.result : current.result),
        patch.error !== undefined
          ? patch.error == null
            ? null
            : JSON.stringify(patch.error)
          : current.error == null
            ? null
            : JSON.stringify(current.error),
        current.startedAt ?? (patch.status === 'running' ? now : null),
        terminal ? now : null,
        now,
        jobId,
        appId,
      )
    return this.getJob(appId, jobId) as SubAppJob
  }

  interruptRunningJobs(): number {
    const now = new Date().toISOString()
    return this.raw
      .prepare(
        `UPDATE sub_app_jobs SET status='interrupted', finished_at=?, updated_at=?, error_json=? WHERE status='running'`,
      )
      .run(now, now, JSON.stringify({ code: 'HOST_RESTARTED', message: '宿主重启，任务已中断。' }))
      .changes
  }

  pruneUnreferencedArtifacts(): string[] {
    const rows = this.raw
      .prepare(
        `SELECT a.id, a.relative_path FROM sub_app_artifacts a
         LEFT JOIN sub_app_release_artifacts ra ON ra.artifact_id=a.id
         WHERE ra.artifact_id IS NULL`,
      )
      .all() as Array<{ id: string; relative_path: string }>
    const remove = this.raw.prepare('DELETE FROM sub_app_artifacts WHERE id=?')
    this.raw.transaction(() => {
      for (const row of rows) remove.run(row.id)
    })()
    return rows.map((row) => row.relative_path)
  }

  hasArtifactDigest(digest: string): boolean {
    return this.raw.prepare('SELECT 1 FROM sub_app_artifacts WHERE sha256=?').get(digest) != null
  }

  listApplicationServiceApps(): string[] {
    const rows = this.raw
      .prepare(
        `SELECT s.id, a.manifest_json FROM sub_apps s
         JOIN sub_app_release_artifacts ra ON ra.release_id=s.published_release_id
         JOIN sub_app_artifacts a ON a.id=ra.artifact_id
         WHERE s.enabled=1 AND s.publication_status='published'`,
      )
      .all() as Array<{ id: string; manifest_json: string }>
    return rows
      .filter((row) => {
        const manifest = this.parseJson<SubAppPackageManifest | null>(row.manifest_json, null)
        return manifest?.service?.lifecycle === 'application'
      })
      .map((row) => row.id)
  }

  saveServiceState(state: {
    appId: string
    releaseId: string | null
    status: 'stopped' | 'starting' | 'running' | 'degraded' | 'crashed'
    restartCount: number
    startedAt: string | null
    lastExitAt: string | null
    lastError: string | null
  }): void {
    this.raw
      .prepare(
        `INSERT INTO sub_app_service_state (
          app_id, release_id, status, restart_count, started_at,
          last_exit_at, last_error, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(app_id) DO UPDATE SET release_id=excluded.release_id,
          status=excluded.status, restart_count=excluded.restart_count,
          started_at=excluded.started_at, last_exit_at=excluded.last_exit_at,
          last_error=excluded.last_error, updated_at=excluded.updated_at`,
      )
      .run(
        state.appId,
        state.releaseId,
        state.status,
        state.restartCount,
        state.startedAt,
        state.lastExitAt,
        state.lastError,
        new Date().toISOString(),
      )
  }

  getServiceState(appId: string) {
    this.assertAppExists(appId)
    const row = this.raw
      .prepare('SELECT * FROM sub_app_service_state WHERE app_id=?')
      .get(appId) as Record<string, unknown> | undefined
    if (row == null) return null
    return {
      appId,
      releaseId: typeof row.release_id === 'string' ? row.release_id : null,
      status: String(row.status),
      pid: null,
      startedAt: typeof row.started_at === 'string' ? row.started_at : null,
      lastExitAt: typeof row.last_exit_at === 'string' ? row.last_exit_at : null,
      lastError: typeof row.last_error === 'string' ? row.last_error : null,
      restartCount: Number(row.restart_count ?? 0),
    }
  }

  private readArtifactRow(
    sql: string,
    ...values: Array<string | number>
  ): ArtifactDescriptorRow | null {
    return (this.raw.prepare(sql).get(...values) as ArtifactDescriptorRow | undefined) ?? null
  }

  private assertAppExists(appId: string): void {
    if (this.raw.prepare('SELECT 1 FROM sub_apps WHERE id=?').get(appId) == null) {
      throw new SubAppNotFoundError()
    }
  }

  private toDescriptor(
    row: ArtifactDescriptorRow,
  ): SubAppPackageDescriptor & { relativePath: string } {
    const manifest = this.parseJson<SubAppPackageManifest | null>(row.manifest_json, null)
    if (manifest == null) throw new SubAppStateError('子应用制品 manifest 损坏。')
    return {
      schemaVersion: 2,
      digest: row.sha256,
      byteLength: row.byte_length,
      fileCount: row.file_count,
      frontendEntry: row.frontend_entry,
      serviceEntry: row.service_entry,
      manifest,
      relativePath: row.relative_path,
    }
  }

  private toJob(row: JobRow): SubAppJob {
    return {
      id: row.id,
      appId: row.app_id,
      releaseId: row.release_id,
      type: row.type,
      status: row.status,
      input: this.parseJson(row.input_json, null),
      progress: row.progress,
      message: row.message,
      checkpoint: this.parseJson(row.checkpoint_json, null),
      result: this.parseJson(row.result_json, null),
      error: this.parseJson(row.error_json, null),
      cancelRequested: row.cancel_requested === 1,
      createdAt: row.created_at,
      startedAt: row.started_at,
      finishedAt: row.finished_at,
      updatedAt: row.updated_at,
    }
  }

  private parseJson<T>(value: string | null, fallback: T): T {
    if (value == null) return fallback
    try {
      return JSON.parse(value) as T
    } catch {
      return fallback
    }
  }

  private digestPermissions(manifest: SubAppPackageManifest): string {
    return JSON.stringify({
      sparkCapabilities: [...manifest.permissions.sparkCapabilities].sort(),
      osEffects: [...manifest.permissions.osEffects].sort(),
      connections: [...manifest.permissions.connections].sort(),
    })
  }
}

function assertBoundedJson(value: unknown, label: string): void {
  let serialized: string | undefined
  try {
    serialized = JSON.stringify(value ?? null)
  } catch {
    throw new SubAppStateError(`${label}不是可序列化 JSON。`)
  }
  if (serialized == null || Buffer.byteLength(serialized, 'utf8') > 512_000) {
    throw new SubAppStateError(`${label}超过 512 KB 上限。`)
  }
}

import type {
  CustomToolDraft,
  CustomToolInvocationSource,
  CustomToolInvocationStatus,
  CustomToolInvocationTrace,
  CustomToolInputSchema,
  CustomToolOrigin,
  CustomToolRecord,
  CustomToolType,
  CustomToolVersionStatus,
  CustomToolVersionSummary,
  HttpToolSpec,
  PromptToolSpec,
  ProviderVisionToolSpec,
  RuntimeEffect,
  RuntimeIdempotency,
  RuntimeRisk,
  SqlToolSpec,
  CommandToolSpec,
  CodeToolSpec,
} from '@spark/protocol'
import {
  CUSTOM_TOOL_INVOCATION_RETENTION_DEFAULT_DAYS,
  CUSTOM_TOOL_INVOCATION_RETENTION_MAX_DAYS,
  CUSTOM_TOOL_INVOCATION_RETENTION_MIN_DAYS,
} from '@spark/protocol'
import { BaseRepository } from './base.repository.js'
import type { SparkDatabase } from '../database.js'

export interface CustomToolRow {
  id: string
  title: string
  description: string
  type: CustomToolType
  input_schema_json: string
  spec_json: string
  risk: RuntimeRisk
  effect: RuntimeEffect
  idempotency: RuntimeIdempotency
  timeout_ms: number
  enabled: number
  origin: CustomToolOrigin
  published_version: number | null
  draft_version: number
  last_test_at: string | null
  created_at: string
  updated_at: string
}

export interface CustomToolVersionRow {
  tool_id: string
  version: number
  status: CustomToolVersionStatus
  snapshot_json: string
  source_version: number | null
  created_at: string
  published_at: string | null
}

export interface CustomToolInvocationRow {
  id: number
  tool_id: string
  tool_version: number | null
  session_id: string | null
  turn_id: string | null
  source: CustomToolInvocationSource
  status: CustomToolInvocationStatus
  duration_ms: number
  error_code: string | null
  output_bytes: number | null
  created_at: string
}

export interface RecordCustomToolInvocationInput {
  toolId: string
  toolVersion: number | null
  sessionId?: string
  turnId?: string
  inputSha256: string
  source: CustomToolInvocationSource
  status: CustomToolInvocationStatus
  durationMs: number
  errorCode?: string
  outputBytes?: number
}

/** spec_json 落库信封：类型专属 spec + 密钥引用（仅引用，无明文） */
export interface CustomToolSpecEnvelope {
  spec:
    | HttpToolSpec
    | SqlToolSpec
    | CommandToolSpec
    | PromptToolSpec
    | CodeToolSpec
    | ProviderVisionToolSpec
  secretRefs?: Record<string, string>
}

const FALLBACK_INPUT_SCHEMA: CustomToolInputSchema = { type: 'object', properties: {} }

export class CustomToolRepository extends BaseRepository {
  constructor(db: SparkDatabase) {
    super(db, 'custom_tools')
  }

  list(query?: string): CustomToolRecord[] {
    const trimmed = query?.trim() ?? ''
    if (trimmed === '') {
      const rows = this.raw
        .prepare('SELECT * FROM custom_tools ORDER BY updated_at DESC, id ASC')
        .all() as CustomToolRow[]
      return rows.map((row) => this.toRecord(row))
    }
    const pattern = `%${trimmed}%`
    const rows = this.raw
      .prepare(
        `SELECT * FROM custom_tools
         WHERE id LIKE ? OR title LIKE ? OR description LIKE ?
         ORDER BY updated_at DESC, id ASC`,
      )
      .all(pattern, pattern, pattern) as CustomToolRow[]
    return rows.map((row) => this.toRecord(row))
  }

  listEnabled(): CustomToolRecord[] {
    const rows = this.raw
      .prepare('SELECT * FROM custom_tools WHERE enabled = 1 ORDER BY id ASC')
      .all() as CustomToolRow[]
    return rows.map((row) => this.toRecord(row))
  }

  /** Backfill immutable version-1 snapshots for databases upgraded from 0.11.27. */
  ensureVersionHistory(): void {
    const missing = this.raw
      .prepare(
        `SELECT * FROM custom_tools AS tool
         WHERE NOT EXISTS (
           SELECT 1 FROM custom_tool_versions AS version
           WHERE version.tool_id = tool.id
         )`,
      )
      .all() as CustomToolRow[]
    if (missing.length === 0) return
    const insert = this.raw.prepare(
      `INSERT INTO custom_tool_versions
         (tool_id, version, status, snapshot_json, source_version, created_at, published_at)
       VALUES (?, 1, 'published', ?, NULL, ?, ?)`,
    )
    this.raw.transaction(() => {
      for (const row of missing) {
        const record = this.toRecord(row)
        insert.run(record.id, this.toJson(this.toDraft(record)), record.createdAt, record.createdAt)
      }
    })()
  }

  get(id: string): CustomToolRecord | undefined {
    const row = this.findById<CustomToolRow>(id)
    return row == null ? undefined : this.toRecord(row)
  }

  exists(id: string): boolean {
    return this.get(id) != null
  }

  create(
    record: CustomToolRecord,
    initialStatus: Extract<CustomToolVersionStatus, 'draft' | 'published'> = 'published',
  ): CustomToolRecord {
    const { spec, secretRefs, ...draft } = record
    const envelope: CustomToolSpecEnvelope = {
      spec,
      ...(secretRefs != null && Object.keys(secretRefs).length > 0 ? { secretRefs } : {}),
    }
    const insertTool = this.raw.prepare(
      `INSERT INTO custom_tools
           (id, title, description, type, input_schema_json, spec_json,
            risk, effect, idempotency, timeout_ms, enabled, origin,
            published_version, draft_version, last_test_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    const insertVersion = this.raw.prepare(
      `INSERT INTO custom_tool_versions
         (tool_id, version, status, snapshot_json, source_version, created_at, published_at)
       VALUES (?, ?, ?, ?, NULL, ?, ?)`,
    )
    this.raw.transaction(() => {
      insertTool.run(
        draft.id,
        draft.title,
        draft.description,
        draft.type,
        this.toJson(draft.inputSchema),
        this.toJson(envelope),
        draft.risk,
        draft.effect,
        draft.idempotency,
        draft.timeoutMs,
        draft.enabled ? 1 : 0,
        draft.origin,
        draft.publishedVersion,
        draft.draftVersion,
        draft.lastTestAt,
        draft.createdAt,
        draft.updatedAt,
      )
      insertVersion.run(
        draft.id,
        draft.draftVersion,
        initialStatus,
        this.toJson(this.toDraft(record)),
        draft.createdAt,
        initialStatus === 'published' ? draft.createdAt : null,
      )
    })()
    return record
  }

  update(
    id: string,
    fields: Partial<
      Pick<
        CustomToolRecord,
        | 'title'
        | 'description'
        | 'risk'
        | 'effect'
        | 'idempotency'
        | 'timeoutMs'
        | 'enabled'
        | 'publishedVersion'
        | 'draftVersion'
      >
    > & {
      inputSchema?: CustomToolInputSchema
      envelope?: CustomToolSpecEnvelope
      lastTestAt?: string | null
    },
  ): CustomToolRecord | undefined {
    const sets: string[] = []
    const values: unknown[] = []

    if (fields.title !== undefined) {
      sets.push('title = ?')
      values.push(fields.title)
    }
    if (fields.description !== undefined) {
      sets.push('description = ?')
      values.push(fields.description)
    }
    if (fields.inputSchema !== undefined) {
      sets.push('input_schema_json = ?')
      values.push(this.toJson(fields.inputSchema))
    }
    if (fields.envelope !== undefined) {
      sets.push('spec_json = ?')
      values.push(this.toJson(fields.envelope))
    }
    if (fields.risk !== undefined) {
      sets.push('risk = ?')
      values.push(fields.risk)
    }
    if (fields.effect !== undefined) {
      sets.push('effect = ?')
      values.push(fields.effect)
    }
    if (fields.idempotency !== undefined) {
      sets.push('idempotency = ?')
      values.push(fields.idempotency)
    }
    if (fields.timeoutMs !== undefined) {
      sets.push('timeout_ms = ?')
      values.push(fields.timeoutMs)
    }
    if (fields.enabled !== undefined) {
      sets.push('enabled = ?')
      values.push(fields.enabled ? 1 : 0)
    }
    if (fields.publishedVersion !== undefined) {
      sets.push('published_version = ?')
      values.push(fields.publishedVersion)
    }
    if (fields.draftVersion !== undefined) {
      sets.push('draft_version = ?')
      values.push(fields.draftVersion)
    }
    if (fields.lastTestAt !== undefined) {
      sets.push('last_test_at = ?')
      values.push(fields.lastTestAt)
    }
    if (sets.length === 0) return this.get(id)

    sets.push('updated_at = ?')
    values.push(new Date().toISOString(), id)
    this.raw.prepare(`UPDATE custom_tools SET ${sets.join(', ')} WHERE id = ?`).run(...values)
    return this.get(id)
  }

  override deleteById(id: string): boolean {
    return this.raw.transaction(() => {
      this.raw.prepare('DELETE FROM custom_tool_invocations WHERE tool_id = ?').run(id)
      return super.deleteById(id)
    })()
  }

  override count(): number {
    return super.count()
  }

  getDraft(id: string): CustomToolDraft | undefined {
    const record = this.get(id)
    if (record == null) return undefined
    return this.getVersionDraft(id, record.draftVersion)
  }

  getPublished(id: string): CustomToolDraft | null | undefined {
    const record = this.get(id)
    if (record == null) return undefined
    if (record.publishedVersion == null) return null
    return this.getVersionDraft(id, record.publishedVersion) ?? this.toDraft(record)
  }

  getVersionDraft(toolId: string, version: number): CustomToolDraft | undefined {
    const row = this.raw
      .prepare(`SELECT snapshot_json FROM custom_tool_versions WHERE tool_id = ? AND version = ?`)
      .get(toolId, version) as { snapshot_json: string } | undefined
    return row == null
      ? undefined
      : this.fromJson<CustomToolDraft | undefined>(row.snapshot_json, undefined)
  }

  listVersions(toolId: string): CustomToolVersionSummary[] {
    const rows = this.raw
      .prepare(
        `SELECT version, status, source_version, created_at, published_at
         FROM custom_tool_versions
         WHERE tool_id = ?
         ORDER BY version DESC`,
      )
      .all(toolId) as Array<Omit<CustomToolVersionRow, 'tool_id' | 'snapshot_json'>>
    return rows.map((row) => ({
      version: row.version,
      status: row.status,
      sourceVersion: row.source_version,
      createdAt: row.created_at,
      publishedAt: row.published_at,
    }))
  }

  saveDraft(id: string, draft: CustomToolDraft): CustomToolRecord | undefined {
    return this.raw.transaction(() => {
      const current = this.get(id)
      if (current == null) return undefined
      const hasPendingDraft =
        current.publishedVersion == null || current.draftVersion > current.publishedVersion
      const version = hasPendingDraft ? current.draftVersion : this.nextVersion(id)
      const now = new Date().toISOString()
      this.raw
        .prepare(
          `INSERT INTO custom_tool_versions
             (tool_id, version, status, snapshot_json, source_version, created_at, published_at)
           VALUES (?, ?, 'draft', ?, NULL, ?, NULL)
           ON CONFLICT(tool_id, version) DO UPDATE SET
             status = 'draft', snapshot_json = excluded.snapshot_json, published_at = NULL`,
        )
        .run(id, version, this.toJson(draft), now)

      if (current.publishedVersion == null) {
        this.updateRecordBody(id, draft, {
          enabled: false,
          publishedVersion: null,
          draftVersion: version,
        })
      } else {
        this.update(id, { draftVersion: version })
      }
      return this.get(id)
    })()
  }

  publishDraft(id: string, expectedDraftVersion?: number): CustomToolRecord | undefined {
    return this.raw.transaction(() => {
      const current = this.get(id)
      if (current == null) return undefined
      if (expectedDraftVersion != null && current.draftVersion !== expectedDraftVersion) {
        throw new Error('CUSTOM_TOOL_DRAFT_CONFLICT')
      }
      if (current.publishedVersion != null && current.draftVersion === current.publishedVersion) {
        throw new Error('CUSTOM_TOOL_NO_PENDING_DRAFT')
      }
      const draft = this.getVersionDraft(id, current.draftVersion)
      if (draft == null) throw new Error('CUSTOM_TOOL_DRAFT_MISSING')
      const now = new Date().toISOString()
      if (current.publishedVersion != null) {
        this.raw
          .prepare(
            `UPDATE custom_tool_versions SET status = 'archived'
             WHERE tool_id = ? AND version = ?`,
          )
          .run(id, current.publishedVersion)
      }
      this.raw
        .prepare(
          `UPDATE custom_tool_versions
           SET status = 'published', published_at = ?
           WHERE tool_id = ? AND version = ?`,
        )
        .run(now, id, current.draftVersion)
      this.updateRecordBody(id, draft, {
        enabled: current.publishedVersion == null ? true : current.enabled,
        publishedVersion: current.draftVersion,
        draftVersion: current.draftVersion,
      })
      return this.get(id)
    })()
  }

  /** Legacy API compatibility: atomically replaces the stable runtime body. */
  publishImmediate(id: string, draft: CustomToolDraft): CustomToolRecord | undefined {
    return this.raw.transaction(() => {
      const current = this.get(id)
      if (current == null) return undefined
      const version = this.nextVersion(id)
      const now = new Date().toISOString()
      this.raw
        .prepare(
          `UPDATE custom_tool_versions SET status = 'archived'
           WHERE tool_id = ? AND status IN ('draft', 'published')`,
        )
        .run(id)
      this.raw
        .prepare(
          `INSERT INTO custom_tool_versions
             (tool_id, version, status, snapshot_json, source_version, created_at, published_at)
           VALUES (?, ?, 'published', ?, NULL, ?, ?)`,
        )
        .run(id, version, this.toJson(draft), now, now)
      this.updateRecordBody(id, draft, {
        enabled: current.enabled,
        publishedVersion: version,
        draftVersion: version,
      })
      return this.get(id)
    })()
  }

  rollback(id: string, sourceVersion: number): CustomToolRecord | undefined {
    return this.raw.transaction(() => {
      const current = this.get(id)
      if (current == null) return undefined
      const snapshot = this.getVersionDraft(id, sourceVersion)
      if (snapshot == null) throw new Error('CUSTOM_TOOL_VERSION_MISSING')
      const version = this.nextVersion(id)
      const now = new Date().toISOString()
      this.raw
        .prepare(
          `UPDATE custom_tool_versions SET status = 'archived'
           WHERE tool_id = ? AND status = 'published'`,
        )
        .run(id)
      this.raw
        .prepare(
          `INSERT INTO custom_tool_versions
             (tool_id, version, status, snapshot_json, source_version, created_at, published_at)
           VALUES (?, ?, 'published', ?, ?, ?, ?)`,
        )
        .run(id, version, this.toJson(snapshot), sourceVersion, now, now)
      this.updateRecordBody(id, snapshot, {
        enabled: current.enabled,
        publishedVersion: version,
        draftVersion: version,
      })
      return this.get(id)
    })()
  }

  recordInvocation(input: RecordCustomToolInvocationInput): number {
    const result = this.raw
      .prepare(
        `INSERT INTO custom_tool_invocations
           (tool_id, tool_version, session_id, turn_id, input_sha256, source,
            status, duration_ms, error_code, output_bytes, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.toolId,
        input.toolVersion,
        input.sessionId ?? null,
        input.turnId ?? null,
        input.inputSha256,
        input.source,
        input.status,
        input.durationMs,
        input.errorCode ?? null,
        input.outputBytes ?? null,
        new Date().toISOString(),
      )
    return Number(result.lastInsertRowid)
  }

  listInvocations(params: {
    toolId?: string
    status?: CustomToolInvocationStatus
    limit?: number
  }): CustomToolInvocationTrace[] {
    const clauses: string[] = []
    const values: unknown[] = []
    if (params.toolId != null) {
      clauses.push('tool_id = ?')
      values.push(params.toolId)
    }
    if (params.status != null) {
      clauses.push('status = ?')
      values.push(params.status)
    }
    const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : ''
    values.push(Math.min(Math.max(params.limit ?? 50, 1), 200))
    const rows = this.raw
      .prepare(
        `SELECT id, tool_id, tool_version, session_id, turn_id, source, status,
                duration_ms, error_code, output_bytes, created_at
         FROM custom_tool_invocations
         ${where}
         ORDER BY created_at DESC, id DESC
         LIMIT ?`,
      )
      .all(...values) as CustomToolInvocationRow[]
    return rows.map((row) => ({
      id: row.id,
      toolId: row.tool_id,
      toolVersion: row.tool_version,
      sessionId: row.session_id,
      turnId: row.turn_id,
      source: row.source,
      status: row.status,
      durationMs: row.duration_ms,
      errorCode: row.error_code,
      outputBytes: row.output_bytes,
      createdAt: row.created_at,
    }))
  }

  getInvocationRetentionDays(): number {
    const row = this.raw
      .prepare('SELECT retention_days FROM custom_tool_trace_settings WHERE id = 1')
      .get() as { retention_days: number } | undefined
    return row?.retention_days ?? CUSTOM_TOOL_INVOCATION_RETENTION_DEFAULT_DAYS
  }

  setInvocationRetentionDays(retentionDays: number): number {
    const normalized = Math.min(
      Math.max(Math.round(retentionDays), CUSTOM_TOOL_INVOCATION_RETENTION_MIN_DAYS),
      CUSTOM_TOOL_INVOCATION_RETENTION_MAX_DAYS,
    )
    this.raw
      .prepare(
        `UPDATE custom_tool_trace_settings
         SET retention_days = ?, updated_at = ?
         WHERE id = 1`,
      )
      .run(normalized, new Date().toISOString())
    return normalized
  }

  deleteInvocations(toolId?: string): number {
    const result =
      toolId == null
        ? this.raw.prepare('DELETE FROM custom_tool_invocations').run()
        : this.raw.prepare('DELETE FROM custom_tool_invocations WHERE tool_id = ?').run(toolId)
    return result.changes
  }

  pruneInvocations(referenceTimeMs = Date.now()): number {
    const retentionMs = this.getInvocationRetentionDays() * 24 * 60 * 60 * 1_000
    const cutoff = new Date(referenceTimeMs - retentionMs).toISOString()
    return this.raw.prepare('DELETE FROM custom_tool_invocations WHERE created_at < ?').run(cutoff)
      .changes
  }

  private nextVersion(toolId: string): number {
    const row = this.raw
      .prepare(
        `SELECT COALESCE(MAX(version), 0) AS version FROM custom_tool_versions WHERE tool_id = ?`,
      )
      .get(toolId) as { version: number }
    return row.version + 1
  }

  private updateRecordBody(
    id: string,
    draft: CustomToolDraft,
    versions: { enabled: boolean; publishedVersion: number | null; draftVersion: number },
  ): void {
    const envelope: CustomToolSpecEnvelope = {
      spec: draft.spec,
      ...(draft.secretRefs != null && Object.keys(draft.secretRefs).length > 0
        ? { secretRefs: draft.secretRefs }
        : {}),
    }
    this.update(id, {
      title: draft.title,
      description: draft.description,
      inputSchema: draft.inputSchema,
      envelope,
      risk: draft.risk,
      effect: draft.effect,
      idempotency: draft.idempotency,
      timeoutMs: draft.timeoutMs,
      enabled: versions.enabled,
      publishedVersion: versions.publishedVersion,
      draftVersion: versions.draftVersion,
    })
  }

  private toDraft(record: CustomToolRecord): CustomToolDraft {
    const {
      enabled: _enabled,
      origin: _origin,
      publishedVersion: _publishedVersion,
      draftVersion: _draftVersion,
      lastTestAt: _lastTestAt,
      createdAt: _createdAt,
      updatedAt: _updatedAt,
      ...draft
    } = record
    return draft
  }

  private toRecord(row: CustomToolRow): CustomToolRecord {
    const envelope = this.fromJson<CustomToolSpecEnvelope>(row.spec_json, {
      spec: {} as CustomToolSpecEnvelope['spec'],
    })
    const draft: CustomToolDraft = {
      id: row.id,
      title: row.title,
      description: row.description,
      type: row.type,
      inputSchema: this.fromJson<CustomToolInputSchema>(
        row.input_schema_json,
        FALLBACK_INPUT_SCHEMA,
      ),
      risk: row.risk,
      effect: row.effect,
      idempotency: row.idempotency,
      timeoutMs: row.timeout_ms,
      ...(envelope.secretRefs != null && Object.keys(envelope.secretRefs).length > 0
        ? { secretRefs: envelope.secretRefs }
        : {}),
      spec: envelope.spec,
    } as CustomToolDraft
    return {
      ...draft,
      enabled: row.enabled === 1,
      origin: row.origin,
      publishedVersion: row.published_version ?? null,
      draftVersion: row.draft_version ?? row.published_version ?? 1,
      lastTestAt: row.last_test_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }
  }
}

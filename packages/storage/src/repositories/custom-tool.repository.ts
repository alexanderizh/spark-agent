import type {
  CustomToolDraft,
  CustomToolInputSchema,
  CustomToolOrigin,
  CustomToolRecord,
  CustomToolType,
  HttpToolSpec,
  PromptToolSpec,
  RuntimeEffect,
  RuntimeIdempotency,
  RuntimeRisk,
  SqlToolSpec,
  CommandToolSpec,
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
  last_test_at: string | null
  created_at: string
  updated_at: string
}

/** spec_json 落库信封：类型专属 spec + 密钥引用（仅引用，无明文） */
export interface CustomToolSpecEnvelope {
  spec: HttpToolSpec | SqlToolSpec | CommandToolSpec | PromptToolSpec
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

  get(id: string): CustomToolRecord | undefined {
    const row = this.findById<CustomToolRow>(id)
    return row == null ? undefined : this.toRecord(row)
  }

  exists(id: string): boolean {
    return this.get(id) != null
  }

  create(record: CustomToolRecord): CustomToolRecord {
    const { spec, secretRefs, ...draft } = record
    const envelope: CustomToolSpecEnvelope = {
      spec,
      ...(secretRefs != null && Object.keys(secretRefs).length > 0 ? { secretRefs } : {}),
    }
    this.raw
      .prepare(
        `INSERT INTO custom_tools
           (id, title, description, type, input_schema_json, spec_json,
            risk, effect, idempotency, timeout_ms, enabled, origin,
            last_test_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
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
        draft.lastTestAt,
        draft.createdAt,
        draft.updatedAt,
      )
    return record
  }

  update(
    id: string,
    fields: Partial<
      Pick<
        CustomToolRecord,
        'title' | 'description' | 'risk' | 'effect' | 'idempotency' | 'timeoutMs' | 'enabled'
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
    return super.deleteById(id)
  }

  count(): number {
    return super.count()
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
      lastTestAt: row.last_test_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }
  }
}

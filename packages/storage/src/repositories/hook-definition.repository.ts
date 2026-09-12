import { randomUUID } from 'node:crypto'
import type {
  HookActionV1,
  HookConditionV1,
  HookConcurrencyPolicyV1,
  HookDefinitionV1,
  HookEventNameV1,
  HookRetryPolicyV1,
  HookValueExpressionV1,
} from '@spark/protocol'
import type { SparkDatabase } from '../database.js'
import { BaseRepository } from './base.repository.js'

export interface HookDefinitionRow {
  id: string
  name: string
  description: string | null
  enabled: number
  schema_version: number
  event_name: string
  condition_json: string | null
  action_json: string
  input_mapping_json: string
  timeout_ms: number
  retry_policy_json: string
  concurrency_policy: string
  revision: number
  execution_hash: string
  created_at: string
  updated_at: string
}

export interface CreateHookDefinitionParams {
  id?: string
  name: string
  description?: string
  enabled: boolean
  eventName: HookEventNameV1
  condition?: HookConditionV1
  action: HookActionV1
  inputMapping: Record<string, HookValueExpressionV1>
  timeoutMs: number
  retryPolicy: HookRetryPolicyV1
  concurrencyPolicy: HookConcurrencyPolicyV1
  revision: number
  executionHash: string
}

export interface UpdateHookDefinitionParams {
  name?: string
  description?: string | null
  enabled?: boolean
  eventName?: HookEventNameV1
  condition?: HookConditionV1 | null
  action?: HookActionV1
  inputMapping?: Record<string, HookValueExpressionV1>
  timeoutMs?: number
  retryPolicy?: HookRetryPolicyV1
  concurrencyPolicy?: HookConcurrencyPolicyV1
  revision?: number
  executionHash?: string
}

function toDomain(row: HookDefinitionRow): HookDefinitionV1 {
  const condition = row.condition_json
    ? (JSON.parse(row.condition_json) as HookConditionV1)
    : undefined
  return {
    id: row.id,
    name: row.name,
    ...(row.description != null ? { description: row.description } : {}),
    enabled: row.enabled === 1,
    eventName: row.event_name as HookEventNameV1,
    ...(condition != null ? { condition } : {}),
    action: JSON.parse(row.action_json) as HookActionV1,
    inputMapping: JSON.parse(row.input_mapping_json) as Record<string, HookValueExpressionV1>,
    timeoutMs: row.timeout_ms,
    retryPolicy: JSON.parse(row.retry_policy_json) as HookRetryPolicyV1,
    concurrencyPolicy: row.concurrency_policy as HookConcurrencyPolicyV1,
    revision: row.revision,
    executionHash: row.execution_hash,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export class HookDefinitionRepository extends BaseRepository {
  constructor(db: SparkDatabase) {
    super(db, 'hook_definitions')
  }

  create(params: CreateHookDefinitionParams): HookDefinitionV1 {
    const id = params.id ?? randomUUID()
    const now = new Date().toISOString()
    this.raw
      .prepare(
        `INSERT INTO hook_definitions (
          id, name, description, enabled, schema_version, event_name, condition_json,
          action_json, input_mapping_json, timeout_ms, retry_policy_json, concurrency_policy,
          revision, execution_hash, created_at, updated_at
        ) VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        params.name,
        params.description ?? null,
        params.enabled ? 1 : 0,
        params.eventName,
        params.condition != null ? JSON.stringify(params.condition) : null,
        JSON.stringify(params.action),
        JSON.stringify(params.inputMapping),
        params.timeoutMs,
        JSON.stringify(params.retryPolicy),
        params.concurrencyPolicy,
        params.revision,
        params.executionHash,
        now,
        now,
      )
    return this.get(id)! // eslint-disable-line @typescript-eslint/no-non-null-assertion
  }

  get(id: string): HookDefinitionV1 | null {
    const row = this.raw.prepare('SELECT * FROM hook_definitions WHERE id = ?').get(id) as
      | HookDefinitionRow
      | undefined
    return row != null ? toDomain(row) : null
  }

  list(eventName?: HookEventNameV1): HookDefinitionV1[] {
    const rows = (
      eventName != null
        ? this.raw
            .prepare('SELECT * FROM hook_definitions WHERE event_name = ? ORDER BY created_at, id')
            .all(eventName)
        : this.raw.prepare('SELECT * FROM hook_definitions ORDER BY created_at, id').all()
    ) as HookDefinitionRow[]
    return rows.map(toDomain)
  }

  listEnabledByEvent(eventName: HookEventNameV1): HookDefinitionV1[] {
    const rows = this.raw
      .prepare('SELECT * FROM hook_definitions WHERE event_name = ? AND enabled = 1')
      .all(eventName) as HookDefinitionRow[]
    return rows.map(toDomain)
  }

  update(id: string, patch: UpdateHookDefinitionParams): HookDefinitionV1 | null {
    const current = this.get(id)
    if (current == null) return null
    const sets: string[] = []
    const values: unknown[] = []
    const set = (column: string, value: unknown): void => {
      sets.push(`${column} = ?`)
      values.push(value)
    }
    if (patch.name != null) set('name', patch.name)
    if (patch.description !== undefined) set('description', patch.description ?? null)
    if (patch.enabled != null) set('enabled', patch.enabled ? 1 : 0)
    if (patch.eventName != null) set('event_name', patch.eventName)
    if (patch.condition !== undefined) {
      set('condition_json', patch.condition != null ? JSON.stringify(patch.condition) : null)
    }
    if (patch.action != null) set('action_json', JSON.stringify(patch.action))
    if (patch.inputMapping != null) {
      set('input_mapping_json', JSON.stringify(patch.inputMapping))
    }
    if (patch.timeoutMs != null) set('timeout_ms', patch.timeoutMs)
    if (patch.retryPolicy != null) set('retry_policy_json', JSON.stringify(patch.retryPolicy))
    if (patch.concurrencyPolicy != null) set('concurrency_policy', patch.concurrencyPolicy)
    if (patch.revision != null) set('revision', patch.revision)
    if (patch.executionHash != null) set('execution_hash', patch.executionHash)
    if (sets.length === 0) return current
    set('updated_at', new Date().toISOString())
    this.raw
      .prepare(`UPDATE hook_definitions SET ${sets.join(', ')} WHERE id = ?`)
      .run(...values, id)
    return this.get(id)
  }

  delete(id: string): boolean {
    const result = this.raw.prepare('DELETE FROM hook_definitions WHERE id = ?').run(id)
    return result.changes > 0
  }

  countBindings(hookId: string): number {
    const row = this.raw
      .prepare('SELECT COUNT(*) AS n FROM hook_bindings WHERE hook_id = ?')
      .get(hookId) as { n: number }
    return row.n
  }

  countRuns(hookId: string): number {
    const row = this.raw
      .prepare('SELECT COUNT(*) AS n FROM hook_runs WHERE hook_id = ?')
      .get(hookId) as { n: number }
    return row.n
  }
}

export { toDomain as hookDefinitionRowToDomain }

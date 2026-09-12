import { randomUUID } from 'node:crypto'
import type { HookBindingStateV1, HookBindingV1, HookScopeKindV1 } from '@spark/protocol'
import type { SparkDatabase } from '../database.js'
import { BaseRepository } from './base.repository.js'

export interface HookBindingRow {
  id: string
  hook_id: string
  scope_kind: string
  scope_id: string
  enabled: number
  state: string
  trusted_execution_hash: string | null
  authorized_effect: string | null
  authorized_at: string | null
  created_at: string
  updated_at: string
}

export interface UpsertHookBindingParams {
  id?: string
  hookId: string
  scopeKind: HookScopeKindV1
  /** application 作用域传 ''。 */
  scopeId: string
  enabled: boolean
  state: HookBindingStateV1
  trustedExecutionHash?: string | null
  authorizedEffect?: string | null
  authorizedAt?: string | null
}

function toDomain(row: HookBindingRow): HookBindingV1 {
  return {
    id: row.id,
    hookId: row.hook_id,
    scopeKind: row.scope_kind as HookScopeKindV1,
    scopeId: row.scope_id,
    enabled: row.enabled === 1,
    state: row.state as HookBindingStateV1,
    ...(row.trusted_execution_hash != null
      ? { trustedExecutionHash: row.trusted_execution_hash }
      : {}),
    ...(row.authorized_effect != null ? { authorizedEffect: row.authorized_effect } : {}),
    ...(row.authorized_at != null ? { authorizedAt: row.authorized_at } : {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export class HookBindingRepository extends BaseRepository {
  constructor(db: SparkDatabase) {
    super(db, 'hook_bindings')
  }

  upsert(params: UpsertHookBindingParams): HookBindingV1 {
    const id = params.id ?? randomUUID()
    const now = new Date().toISOString()
    this.raw
      .prepare(
        `INSERT INTO hook_bindings (
          id, hook_id, scope_kind, scope_id, enabled, state,
          trusted_execution_hash, authorized_effect, authorized_at, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (hook_id, scope_kind, scope_id) DO UPDATE SET
          enabled = excluded.enabled,
          state = excluded.state,
          trusted_execution_hash = excluded.trusted_execution_hash,
          authorized_effect = excluded.authorized_effect,
          authorized_at = excluded.authorized_at,
          updated_at = excluded.updated_at`,
      )
      .run(
        id,
        params.hookId,
        params.scopeKind,
        params.scopeId,
        params.enabled ? 1 : 0,
        params.state,
        params.trustedExecutionHash ?? null,
        params.authorizedEffect ?? null,
        params.authorizedAt ?? null,
        now,
        now,
      )
    // upsert 冲突分支已保证行存在。
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    return this.findByScope(params.hookId, params.scopeKind, params.scopeId)!
  }

  findByScope(hookId: string, scopeKind: HookScopeKindV1, scopeId: string): HookBindingV1 | null {
    const row = this.raw
      .prepare('SELECT * FROM hook_bindings WHERE hook_id = ? AND scope_kind = ? AND scope_id = ?')
      .get(hookId, scopeKind, scopeId) as HookBindingRow | undefined
    return row != null ? toDomain(row) : null
  }

  get(id: string): HookBindingV1 | null {
    const row = this.raw.prepare('SELECT * FROM hook_bindings WHERE id = ?').get(id) as
      | HookBindingRow
      | undefined
    return row != null ? toDomain(row) : null
  }

  list(
    filters: { hookId?: string; scopeKind?: HookScopeKindV1; scopeId?: string } = {},
  ): HookBindingV1[] {
    const conditions: string[] = []
    const values: unknown[] = []
    if (filters.hookId != null) {
      conditions.push('hook_id = ?')
      values.push(filters.hookId)
    }
    if (filters.scopeKind != null) {
      conditions.push('scope_kind = ?')
      values.push(filters.scopeKind)
    }
    if (filters.scopeId != null) {
      conditions.push('scope_id = ?')
      values.push(filters.scopeId)
    }
    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
    const rows = this.raw
      .prepare(`SELECT * FROM hook_bindings ${where} ORDER BY created_at, id`)
      .all(...values) as HookBindingRow[]
    return rows.map(toDomain)
  }

  listForScopes(scopes: Array<{ scopeKind: HookScopeKindV1; scopeId: string }>): HookBindingV1[] {
    if (scopes.length === 0) return []
    const conditions = scopes.map(() => '(scope_kind = ? AND scope_id = ?)')
    const values: unknown[] = []
    for (const scope of scopes) {
      values.push(scope.scopeKind, scope.scopeId)
    }
    const rows = this.raw
      .prepare(`SELECT * FROM hook_bindings WHERE ${conditions.join(' OR ')}`)
      .all(...values) as HookBindingRow[]
    return rows.map(toDomain)
  }

  updateState(
    id: string,
    state: HookBindingStateV1,
    options: { trustedExecutionHash?: string | null; enabled?: boolean } = {},
  ): HookBindingV1 | null {
    const sets = ['state = ?', 'updated_at = ?']
    const values: unknown[] = [state, new Date().toISOString()]
    if (options.trustedExecutionHash !== undefined) {
      sets.push('trusted_execution_hash = ?')
      values.push(options.trustedExecutionHash ?? null)
    }
    if (options.enabled != null) {
      sets.push('enabled = ?')
      values.push(options.enabled ? 1 : 0)
    }
    this.raw.prepare(`UPDATE hook_bindings SET ${sets.join(', ')} WHERE id = ?`).run(...values, id)
    return this.get(id)
  }

  /**
   * 定义执行哈希变化后使未匹配授权失效：state != disabled 且授权哈希不等于当前哈希的
   * 绑定进入 needs_review。返回失效数量。
   */
  invalidateStaleAuthorizations(hookId: string, currentExecutionHash: string): number {
    const result = this.raw
      .prepare(
        `UPDATE hook_bindings SET state = 'needs_review', updated_at = ?
         WHERE hook_id = ?
           AND state != 'disabled'
           AND (trusted_execution_hash IS NULL OR trusted_execution_hash != ?)`,
      )
      .run(new Date().toISOString(), hookId, currentExecutionHash)
    return result.changes
  }

  delete(id: string): boolean {
    const result = this.raw.prepare('DELETE FROM hook_bindings WHERE id = ?').run(id)
    return result.changes > 0
  }
}

import { BaseRepository } from './base.repository.js'
import type { SparkDatabase } from '../database.js'

export interface RuleRow {
  id: string
  scope: string
  scope_ref: string | null
  name: string
  content: string
  priority: number
  enabled: number
  created_at: string
  updated_at: string
}

export interface CreateRuleParams {
  id: string
  scope: string
  scopeRef?: string | null
  name: string
  content: string
  priority?: number
  enabled?: boolean
}

export interface UpdateRuleParams {
  name?: string
  content?: string
  priority?: number
  enabled?: boolean
}

export interface ListRulesParams {
  scope?: string
  scopeRef?: string
}

export class RulesRepository extends BaseRepository {
  constructor(db: SparkDatabase) {
    super(db, 'rules')
  }

  list(filters: ListRulesParams = {}): RuleRow[] {
    const conditions: string[] = []
    const values: unknown[] = []

    if (filters.scope !== undefined) {
      conditions.push('scope = ?')
      values.push(filters.scope)
    }
    if (filters.scopeRef !== undefined) {
      conditions.push('scope_ref = ?')
      values.push(filters.scopeRef)
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
    return this.raw
      .prepare(`SELECT * FROM rules ${where} ORDER BY priority DESC, updated_at DESC`)
      .all(...values) as RuleRow[]
  }

  getById(id: string): RuleRow | null {
    return this.findById<RuleRow>(id)
  }

  create(params: CreateRuleParams): RuleRow {
    const now = new Date().toISOString()
    this.raw
      .prepare(
        `INSERT INTO rules (id, scope, scope_ref, name, content, priority, enabled, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        params.id,
        params.scope,
        params.scopeRef ?? null,
        params.name,
        params.content,
        params.priority ?? 0,
        (params.enabled ?? true) ? 1 : 0,
        now,
        now,
      )
    return this.getById(params.id)!
  }

  update(id: string, fields: Partial<UpdateRuleParams>): RuleRow | null {
    const sets: string[] = ['updated_at = ?']
    const values: unknown[] = [new Date().toISOString()]

    if (fields.name !== undefined) {
      sets.push('name = ?')
      values.push(fields.name)
    }
    if (fields.content !== undefined) {
      sets.push('content = ?')
      values.push(fields.content)
    }
    if (fields.priority !== undefined) {
      sets.push('priority = ?')
      values.push(fields.priority)
    }
    if (fields.enabled !== undefined) {
      sets.push('enabled = ?')
      values.push(fields.enabled ? 1 : 0)
    }

    values.push(id)
    this.raw.prepare(`UPDATE rules SET ${sets.join(', ')} WHERE id = ?`).run(...values)
    return this.getById(id)
  }

  delete(id: string): boolean {
    return this.deleteById(id)
  }

  toggle(id: string, enabled: boolean): RuleRow | null {
    return this.update(id, { enabled })
  }

  hasAny(): boolean {
    return this.count() > 0
  }
}

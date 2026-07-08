import { randomUUID } from 'crypto'
import { BaseRepository } from './base.repository.js'
import type { SparkDatabase } from '../database.js'

export type WorkflowStatus = 'draft' | 'active' | 'archived'

export interface WorkflowRow {
  id: string
  scope: string
  name: string
  version: string
  graph_json: string
  description: string
  status: WorkflowStatus
  tags_json: string
  enabled: number
  created_at: string
  updated_at: string
}

export interface WorkflowItem {
  id: string
  scope: string
  name: string
  version: string
  description: string
  status: WorkflowStatus
  tags: string[]
  enabled: boolean
  graph: Record<string, unknown>
  createdAt: string
  updatedAt: string
}

export interface CreateWorkflowParams {
  id?: string
  scope?: string
  name: string
  version?: string
  description?: string
  status?: WorkflowStatus
  tags?: string[]
  enabled?: boolean
  graph?: Record<string, unknown>
}

export interface UpdateWorkflowParams extends Partial<CreateWorkflowParams> {}

export class WorkflowRepository extends BaseRepository {
  constructor(db: SparkDatabase) {
    super(db, 'workflows')
  }

  list(filters: { scope?: string; includeArchived?: boolean } = {}): WorkflowItem[] {
    const conditions: string[] = []
    const values: unknown[] = []
    if (filters.scope !== undefined) {
      conditions.push('scope = ?')
      values.push(filters.scope)
    }
    if (filters.includeArchived !== true) conditions.push("status != 'archived'")
    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
    const rows = this.raw
      .prepare(`SELECT * FROM workflows ${where} ORDER BY updated_at DESC`)
      .all(...values) as WorkflowRow[]
    return rows.map((row) => this.toItem(row))
  }

  get(id: string): WorkflowItem | null {
    const row = this.findById<WorkflowRow>(id)
    return row == null ? null : this.toItem(row)
  }

  create(params: CreateWorkflowParams): WorkflowItem {
    const id = params.id ?? randomUUID()
    const now = new Date().toISOString()
    this.raw
      .prepare(
        `INSERT INTO workflows (
          id, scope, name, version, graph_json, description, status, tags_json,
          enabled, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        params.scope ?? 'system',
        params.name,
        params.version ?? '1.0.0',
        this.toJson(params.graph ?? defaultWorkflowGraph()),
        params.description ?? '',
        params.status ?? 'draft',
        this.toJson(params.tags ?? []),
        params.enabled === false ? 0 : 1,
        now,
        now,
      )
    return this.get(id)!
  }

  update(id: string, fields: UpdateWorkflowParams): WorkflowItem | null {
    const sets: string[] = []
    const values: unknown[] = []
    const add = (column: string, value: unknown) => {
      sets.push(`${column} = ?`)
      values.push(value)
    }

    if (fields.scope !== undefined) add('scope', fields.scope)
    if (fields.name !== undefined) add('name', fields.name)
    if (fields.version !== undefined) add('version', fields.version)
    if (fields.description !== undefined) add('description', fields.description)
    if (fields.status !== undefined) add('status', fields.status)
    if (fields.tags !== undefined) add('tags_json', this.toJson(fields.tags))
    if (fields.enabled !== undefined) add('enabled', fields.enabled ? 1 : 0)
    if (fields.graph !== undefined) add('graph_json', this.toJson(fields.graph))

    if (sets.length === 0) return this.get(id)
    sets.push('updated_at = ?')
    values.push(new Date().toISOString(), id)
    this.raw.prepare(`UPDATE workflows SET ${sets.join(', ')} WHERE id = ?`).run(...values)
    return this.get(id)
  }

  delete(id: string): boolean {
    return this.deleteById(id)
  }

  private toItem(row: WorkflowRow): WorkflowItem {
    return {
      id: row.id,
      scope: row.scope,
      name: row.name,
      version: row.version,
      description: row.description,
      status: row.status,
      tags: this.fromJson<string[]>(row.tags_json, []),
      enabled: row.enabled === 1,
      graph: this.fromJson<Record<string, unknown>>(row.graph_json, defaultWorkflowGraph()),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }
  }
}

function defaultWorkflowGraph(): Record<string, unknown> {
  return {
    nodes: [
      {
        id: 'input',
        kind: 'input',
        title: '需求输入',
        x: 56,
        y: 120,
        config: { prompt: '读取用户需求，提炼目标、约束和交付物。' },
      },
      {
        id: 'plan',
        kind: 'agent',
        title: '计划节点',
        x: 320,
        y: 120,
        config: { role: 'planner', prompt: '拆解任务，给出可执行步骤。' },
      },
      {
        id: 'execute',
        kind: 'agent',
        title: '执行节点',
        x: 584,
        y: 120,
        config: { role: 'coder', prompt: '按计划完成实现，并记录关键决策。' },
      },
      {
        id: 'review',
        kind: 'review',
        title: '验证复核',
        x: 848,
        y: 120,
        config: { prompt: '运行必要验证，总结风险和结果。' },
      },
    ],
    edges: [
      { id: 'input-plan', from: 'input', to: 'plan' },
      { id: 'plan-execute', from: 'plan', to: 'execute' },
      { id: 'execute-review', from: 'execute', to: 'review' },
    ],
  }
}

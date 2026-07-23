import { BaseRepository } from './base.repository.js'
import type { SparkDatabase } from '../database.js'

export type CanvasWorkflowScope = 'project' | 'library' | 'builtin'
export type CanvasWorkflowStatus = 'draft' | 'published' | 'archived'

export interface CanvasWorkflowRow {
  id: string
  user_id: number
  project_id: string | null
  name: string
  description: string | null
  scope: CanvasWorkflowScope
  status: CanvasWorkflowStatus
  version: number
  tags_json: string
  package_json: string
  created_at: string
  updated_at: string
}

export interface CanvasWorkflowItem<TPackage = unknown> {
  id: string
  userId: number
  projectId: string | null
  name: string
  description: string | null
  scope: CanvasWorkflowScope
  status: CanvasWorkflowStatus
  version: number
  tags: string[]
  package: TPackage
  createdAt: string
  updatedAt: string
}

export interface CreateCanvasWorkflowParams<TPackage = unknown> {
  id: string
  userId?: number
  projectId?: string | null
  name: string
  description?: string | null
  scope: CanvasWorkflowScope
  status?: CanvasWorkflowStatus
  version?: number
  tags?: string[]
  packageJson: TPackage
  createdAt?: string
  updatedAt?: string
}

export interface UpdateCanvasWorkflowParams<TPackage = unknown> {
  name?: string
  description?: string | null
  status?: CanvasWorkflowStatus
  version?: number
  tags?: string[]
  packageJson?: TPackage
  updatedAt?: string
}

export interface ListCanvasWorkflowsParams {
  userId?: number
  projectId?: string
  scope?: CanvasWorkflowScope
  status?: CanvasWorkflowStatus
  query?: string
  includeArchived?: boolean
  limit?: number
  offset?: number
}

export interface CanvasWorkflowListPage {
  rows: CanvasWorkflowRow[]
  total: number
}

export interface DuplicateCanvasWorkflowParams {
  id: string
  name: string
  scope: 'project' | 'library'
  projectId?: string | null
  userId?: number
  createdAt?: string
}

export class CanvasWorkflowRepository extends BaseRepository {
  constructor(db: SparkDatabase) {
    super(db, 'canvas_workflows')
  }

  create<TPackage>(params: CreateCanvasWorkflowParams<TPackage>): CanvasWorkflowRow {
    const now = params.createdAt ?? new Date().toISOString()
    const updatedAt = params.updatedAt ?? now
    this.raw
      .prepare(
        `INSERT INTO canvas_workflows (
          id, user_id, project_id, name, description, scope, status, version,
          tags_json, package_json, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        params.id,
        params.userId ?? 0,
        params.projectId ?? null,
        params.name,
        params.description ?? null,
        params.scope,
        params.status ?? 'draft',
        params.version ?? 1,
        this.toJson(params.tags ?? []),
        this.toJson(params.packageJson),
        now,
        updatedAt,
      )
    return this.get(params.id)!
  }

  get(id: string): CanvasWorkflowRow | null {
    return this.findById<CanvasWorkflowRow>(id)
  }

  withTransaction<T>(work: () => T): T {
    return this.raw.transaction(work)()
  }

  private buildListFilter(params: ListCanvasWorkflowsParams): {
    where: string
    values: Array<string | number>
  } {
    const clauses = [
      'user_id = ?',
      `(scope != 'project' OR EXISTS (
        SELECT 1 FROM canvas_projects cp
        WHERE cp.id = canvas_workflows.project_id AND cp.status != 'deleted'
      ))`,
    ]
    const values: Array<string | number> = [params.userId ?? 0]
    if (params.scope) {
      clauses.push('scope = ?')
      values.push(params.scope)
    }
    if (params.projectId) {
      clauses.push('project_id = ?')
      values.push(params.projectId)
    }
    if (params.status) {
      clauses.push('status = ?')
      values.push(params.status)
    } else if (!params.includeArchived) {
      clauses.push("status != 'archived'")
    }
    const query = params.query?.trim()
    if (query) {
      clauses.push('(name LIKE ? OR description LIKE ? OR tags_json LIKE ?)')
      const pattern = `%${query}%`
      values.push(pattern, pattern, pattern)
    }
    return { where: clauses.join(' AND '), values }
  }

  listPage(params: ListCanvasWorkflowsParams = {}): CanvasWorkflowListPage {
    const { where, values } = this.buildListFilter(params)
    const limit = Math.min(Math.max(params.limit ?? 100, 1), 200)
    const offset = Math.max(params.offset ?? 0, 0)
    const totalRow = this.raw
      .prepare(`SELECT COUNT(*) AS count FROM canvas_workflows WHERE ${where}`)
      .get(...values) as { count: number }
    const rows = this.raw
      .prepare(
        `SELECT * FROM canvas_workflows
         WHERE ${where}
         ORDER BY updated_at DESC, created_at DESC
         LIMIT ? OFFSET ?`,
      )
      .all(...values, limit, offset) as CanvasWorkflowRow[]
    return { rows, total: totalRow.count }
  }

  list(params: ListCanvasWorkflowsParams = {}): CanvasWorkflowRow[] {
    return this.listPage(params).rows
  }

  update<TPackage>(
    id: string,
    patch: UpdateCanvasWorkflowParams<TPackage>,
  ): CanvasWorkflowRow | null {
    const current = this.get(id)
    if (!current) return null
    this.raw
      .prepare(
        `UPDATE canvas_workflows SET
          name = ?, description = ?, status = ?, version = ?, tags_json = ?,
          package_json = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(
        patch.name ?? current.name,
        patch.description !== undefined ? patch.description : current.description,
        patch.status ?? current.status,
        patch.version ?? current.version,
        patch.tags !== undefined ? this.toJson(patch.tags) : current.tags_json,
        patch.packageJson !== undefined ? this.toJson(patch.packageJson) : current.package_json,
        patch.updatedAt ?? new Date().toISOString(),
        id,
      )
    return this.get(id)
  }

  duplicate(sourceId: string, params: DuplicateCanvasWorkflowParams): CanvasWorkflowRow | null {
    const source = this.get(sourceId)
    if (!source) return null
    return this.create({
      id: params.id,
      userId: params.userId ?? source.user_id,
      projectId: params.projectId ?? null,
      name: params.name,
      description: source.description,
      scope: params.scope,
      status: 'draft',
      version: 1,
      tags: this.fromJson<string[]>(source.tags_json, []),
      packageJson: this.fromJson<unknown>(source.package_json, {}),
      ...(params.createdAt ? { createdAt: params.createdAt } : {}),
    })
  }

  delete(id: string): boolean {
    return this.deleteById(id)
  }

  toItem<TPackage = unknown>(row: CanvasWorkflowRow): CanvasWorkflowItem<TPackage> {
    return {
      id: row.id,
      userId: row.user_id,
      projectId: row.project_id,
      name: row.name,
      description: row.description,
      scope: row.scope,
      status: row.status,
      version: row.version,
      tags: this.fromJson<string[]>(row.tags_json, []),
      package: this.fromJson<TPackage>(row.package_json, {} as TPackage),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }
  }
}

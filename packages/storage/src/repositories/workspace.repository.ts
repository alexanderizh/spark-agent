/**
 * @module workspace.repository
 *
 * Workspace 领域 Repository
 *
 * 职责：
 *   - 工作区的 CRUD 操作
 *   - 按 root_path 查找工作区（避免重复打开）
 *   - workspace 初始化状态管理
 */

import { BaseRepository } from './base.repository.js'
import type { SparkDatabase } from '../database.js'

/** Workspace 表行类型 */
export interface WorkspaceRow {
  id: string
  name: string
  root_path: string
  spark_config_path: string
  agent_runtime_path: string
  project_kind: string
  relocated_from_json: string | null
  worktree_meta_json: string | null
  pinned_at: string | null
  archived_at: string | null
  created_at: string
  updated_at: string
}

/** worktree workspace 的元数据（序列化进 worktree_meta_json） */
export interface WorktreeMeta {
  baseRepoRoot: string
  branch: string
  baseBranch: string
  /** 来源（基）workspace id：用于侧边栏把 worktree 会话归到原项目分组下 */
  baseWorkspaceId?: string
}

/** 创建 Workspace 的参数 */
export interface CreateWorkspaceParams {
  id: string
  name: string
  rootPath: string
  projectKind?: string
  relocatedFrom?: string[]
  worktreeMeta?: WorktreeMeta
}

export interface RelocateWorkspaceParams {
  rootPath: string
  relocatedFrom?: string[]
}

/**
 * Workspace Repository
 *
 * 管理 workspaces 表的数据访问
 */
export class WorkspaceRepository extends BaseRepository {
  constructor(db: SparkDatabase) {
    super(db, 'workspaces')
  }

  /** 创建新工作区 */
  create(params: CreateWorkspaceParams): WorkspaceRow {
    const now = new Date().toISOString()
    const stmt = this.raw.prepare(`
      INSERT INTO workspaces (id, name, root_path, spark_config_path, agent_runtime_path, project_kind, relocated_from_json, worktree_meta_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)

    stmt.run(
      params.id,
      params.name,
      params.rootPath,
      `${params.rootPath}/.spark`,
      `${params.rootPath}/.agent_spark`,
      params.projectKind ?? 'generic',
      params.relocatedFrom ? this.toJson(params.relocatedFrom) : null,
      params.worktreeMeta ? this.toJson(params.worktreeMeta) : null,
      now,
      now,
    )

    return this.findByIdOrFail(params.id)
  }

  /** 根据 ID 查找工作区 */
  get(id: string): WorkspaceRow | null {
    return this.findById<WorkspaceRow>(id)
  }

  /** 根据 ID 查找，找不到则抛异常 */
  findByIdOrFail(id: string): WorkspaceRow {
    const row = this.get(id)
    if (row == null) {
      throw new Error(`Workspace not found: ${id}`)
    }
    return row
  }

  /** 根据 rootPath 查找工作区 */
  findByRootPath(rootPath: string): WorkspaceRow | null {
    const stmt = this.raw.prepare('SELECT * FROM workspaces WHERE root_path = ?')
    return (stmt.get(rootPath) as WorkspaceRow | undefined) ?? null
  }

  /** 解析某 workspace 的 worktree 元数据，非 worktree 返回 null */
  getWorktreeMeta(id: string): WorktreeMeta | null {
    const row = this.get(id)
    if (row == null || row.worktree_meta_json == null) return null
    return this.fromJson<WorktreeMeta | null>(row.worktree_meta_json, null)
  }

  /** 查找某主仓库下已注册为 workspace 的所有 worktree */
  findWorktreesByBaseRepo(baseRepoRoot: string): WorkspaceRow[] {
    const stmt = this.raw.prepare(`SELECT * FROM workspaces WHERE worktree_meta_json IS NOT NULL`)
    const rows = stmt.all() as WorkspaceRow[]
    return rows.filter((r) => {
      const meta = this.fromJson<WorktreeMeta | null>(r.worktree_meta_json, null)
      return meta?.baseRepoRoot === baseRepoRoot
    })
  }

  /** 更新工作区名称 */
  updateName(id: string, name: string): void {
    const now = new Date().toISOString()
    const stmt = this.raw.prepare('UPDATE workspaces SET name = ?, updated_at = ? WHERE id = ?')
    stmt.run(name, now, id)
  }

  /** 迁移工作区根目录 */
  relocate(id: string, params: RelocateWorkspaceParams): void {
    const now = new Date().toISOString()
    const current = this.findByIdOrFail(id)
    const relocatedFrom = params.relocatedFrom ?? this.fromJson<string[]>(current.relocated_from_json, [])
    const stmt = this.raw.prepare(`
      UPDATE workspaces
      SET root_path = ?, spark_config_path = ?, agent_runtime_path = ?, relocated_from_json = ?, updated_at = ?
      WHERE id = ?
    `)
    stmt.run(
      params.rootPath,
      `${params.rootPath}/.spark`,
      `${params.rootPath}/.agent_spark`,
      this.toJson(relocatedFrom),
      now,
      id,
    )
  }

  /** 更新工作区元数据 */
  update(id: string, params: { name?: string; projectKind?: string; pinnedAt?: string | null; archivedAt?: string | null }): void {
    const fields: string[] = []
    const values: unknown[] = []

    if (params.name !== undefined) {
      fields.push('name = ?')
      values.push(params.name)
    }

    if (params.projectKind !== undefined) {
      fields.push('project_kind = ?')
      values.push(params.projectKind)
    }

    if (params.pinnedAt !== undefined) {
      fields.push('pinned_at = ?')
      values.push(params.pinnedAt)
    }

    if (params.archivedAt !== undefined) {
      fields.push('archived_at = ?')
      values.push(params.archivedAt)
    }

    if (fields.length === 0) {
      return
    }

    fields.push('updated_at = ?')
    values.push(new Date().toISOString())
    values.push(id)

    const stmt = this.raw.prepare(`UPDATE workspaces SET ${fields.join(', ')} WHERE id = ?`)
    stmt.run(...values)
  }

  /** 删除工作区记录 */
  delete(id: string): boolean {
    return this.deleteById(id)
  }

  /** 列出所有工作区（置顶优先，按最近更新排序） */
  listAll(limit = 50, offset = 0, params: { includeArchived?: boolean } = {}): WorkspaceRow[] {
    const whereClause = params.includeArchived === true ? '' : 'WHERE archived_at IS NULL'
    const stmt = this.raw.prepare(`
      SELECT * FROM workspaces
      ${whereClause}
      ORDER BY pinned_at IS NULL ASC, pinned_at DESC, updated_at DESC
      LIMIT ? OFFSET ?
    `)
    return stmt.all(limit, offset) as WorkspaceRow[]
  }

  /** 统计工作区总数 */
  countAll(params: { includeArchived?: boolean } = {}): number {
    if (params.includeArchived === true) {
      return this.count()
    }

    const stmt = this.raw.prepare('SELECT COUNT(*) as count FROM workspaces WHERE archived_at IS NULL')
    const row = stmt.get() as { count: number }
    return row.count
  }
}

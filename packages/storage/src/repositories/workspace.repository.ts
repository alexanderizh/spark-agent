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
  created_at: string
  updated_at: string
}

/** 创建 Workspace 的参数 */
export interface CreateWorkspaceParams {
  id: string
  name: string
  rootPath: string
  projectKind?: string
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
      INSERT INTO workspaces (id, name, root_path, spark_config_path, agent_runtime_path, project_kind, relocated_from_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)

    stmt.run(
      params.id,
      params.name,
      params.rootPath,
      `${params.rootPath}/.spark`,
      `${params.rootPath}/.agent_spark`,
      params.projectKind ?? 'generic',
      params.relocatedFrom ? this.toJson(params.relocatedFrom) : null,
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

  /** 更新工作区名称 */
  updateName(id: string, name: string): void {
    const now = new Date().toISOString()
    const stmt = this.raw.prepare('UPDATE workspaces SET name = ?, updated_at = ? WHERE id = ?')
    stmt.run(name, now, id)
  }

  /** 列出所有工作区（按最近更新排序） */
  listAll(limit = 50, offset = 0): WorkspaceRow[] {
    const stmt = this.raw.prepare(
      'SELECT * FROM workspaces ORDER BY updated_at DESC LIMIT ? OFFSET ?',
    )
    return stmt.all(limit, offset) as WorkspaceRow[]
  }
}

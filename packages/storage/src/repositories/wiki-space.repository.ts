/**
 * @module wiki-space.repository
 *
 * 知识库空间（wiki_space）仓储 — 空间 CRUD 与按 scope 查询。
 *
 * 空间是知识库容器：scope（user/project/agent/team）× space_type（manual/repo）
 * 两个正交维度决定归属 Tab 与生命周期。team 枚举首期只保留值，不建功能。
 *
 * 写入闸门约束：本仓储只做纯 SQL；业务写入（含配额、幂等）由
 * agent-runtime 的 wiki 服务层统一走 WikiWriteService，不直连本类。
 */

import { BaseRepository } from './base.repository.js'
import type { SparkDatabase } from '../database.js'

export type WikiScope = 'user' | 'project' | 'agent' | 'team'
export type WikiSpaceType = 'manual' | 'repo'

export interface WikiSpaceRow {
  id: string
  scope: WikiScope
  scope_ref: string | null
  space_type: WikiSpaceType
  name: string
  description: string
  icon: string | null
  visibility: 'private' | 'shared'
  repo_path: string | null
  repo_rev: string | null
  created_by: string | null
  archived: number
  created_at: number
  updated_at: number
}

/** insert 入参：时间戳由仓储自动填充 */
export type WikiSpaceInsert = Omit<WikiSpaceRow, 'created_at' | 'updated_at'>

export class WikiSpaceRepository extends BaseRepository {
  constructor(db: SparkDatabase) {
    super(db, 'wiki_space')
  }

  insert(row: WikiSpaceInsert): WikiSpaceRow {
    const now = Date.now()
    this.raw
      .prepare(
        `INSERT INTO wiki_space
           (id, scope, scope_ref, space_type, name, description, icon, visibility,
            repo_path, repo_rev, created_by, archived, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        row.id,
        row.scope,
        row.scope_ref,
        row.space_type,
        row.name,
        row.description,
        row.icon,
        row.visibility,
        row.repo_path,
        row.repo_rev,
        row.created_by,
        row.archived,
        now,
        now,
      )
    return this.findById<WikiSpaceRow>(row.id)!
  }

  getById(id: string): WikiSpaceRow | null {
    return this.findById<WikiSpaceRow>(id)
  }

  /**
   * 按名称找活跃空间（同 scope + scope_ref + space_type 内唯一，
   * 归档空间释放唯一槽位 —— 部分索引 WHERE archived = 0）。
   */
  findByName(
    scope: WikiScope,
    scopeRef: string | null,
    spaceType: WikiSpaceType,
    name: string,
  ): WikiSpaceRow | null {
    const row = this.raw
      .prepare(
        `SELECT * FROM wiki_space
         WHERE scope = ? AND scope_ref IS ? AND space_type = ? AND name = ? AND archived = 0`,
      )
      .get(scope, scopeRef, spaceType, name) as WikiSpaceRow | undefined
    return row ?? null
  }

  /**
   * 列出 scope 集合内的活跃空间。默认排除归档；Repo Wiki Tab 用
   * spaceType 过滤；Agent 侧调用必须传 scopes（服务端裁剪访问范围）。
   */
  listByScopes(
    scopes: Array<{ scope: WikiScope; scopeRef: string | null }>,
    opts?: { spaceType?: WikiSpaceType; includeArchived?: boolean },
  ): WikiSpaceRow[] {
    if (scopes.length === 0) return []
    const conditions: string[] = [`(${scopes.map(() => '(scope = ? AND scope_ref IS ?)').join(' OR ')})`]
    const values: unknown[] = []
    for (const s of scopes) {
      values.push(s.scope, s.scopeRef)
    }
    if (opts?.spaceType != null) {
      conditions.push('space_type = ?')
      values.push(opts.spaceType)
    }
    if (!opts?.includeArchived) {
      conditions.push('archived = 0')
    }
    return this.raw
      .prepare(
        `SELECT * FROM wiki_space WHERE ${conditions.join(' AND ')} ORDER BY updated_at DESC`,
      )
      .all(...values) as WikiSpaceRow[]
  }

  /** 更新空间元数据（name/description/icon/repo 关联）；刷新 updated_at。 */
  update(
    id: string,
    patch: Partial<Pick<WikiSpaceRow, 'name' | 'description' | 'icon' | 'repo_path' | 'repo_rev'>>,
  ): WikiSpaceRow {
    const existing = this.findById<WikiSpaceRow>(id)
    if (existing == null) throw new Error(`Wiki space not found: ${id}`)
    const fields: string[] = []
    const values: unknown[] = []
    for (const key of ['name', 'description', 'icon', 'repo_path', 'repo_rev'] as const) {
      if (key in patch) {
        fields.push(`${key} = ?`)
        values.push(patch[key])
      }
    }
    if (fields.length === 0) return existing
    fields.push('updated_at = ?')
    values.push(Date.now(), id)
    this.raw.prepare(`UPDATE wiki_space SET ${fields.join(', ')} WHERE id = ?`).run(...values)
    return this.findById<WikiSpaceRow>(id)!
  }

  /** 归档（软删除）：释放唯一名槽位，页面数据保留。 */
  archive(id: string): void {
    this.raw
      .prepare(`UPDATE wiki_space SET archived = 1, updated_at = ? WHERE id = ?`)
      .run(Date.now(), id)
  }

  /** 每个空间的活跃页面计数（列表视图 kind 统计用，一次查询取全）。 */
  countActivePagesBySpace(spaceIds: readonly string[]): Map<string, number> {
    const result = new Map<string, number>()
    if (spaceIds.length === 0) return result
    const placeholders = spaceIds.map(() => '?').join(', ')
    const rows = this.raw
      .prepare(
        `SELECT space_id, COUNT(*) as count FROM wiki_page
         WHERE space_id IN (${placeholders}) AND status != 'archived'
         GROUP BY space_id`,
      )
      .all(...spaceIds) as Array<{ space_id: string; count: number }>
    for (const r of rows) result.set(r.space_id, r.count)
    return result
  }
}

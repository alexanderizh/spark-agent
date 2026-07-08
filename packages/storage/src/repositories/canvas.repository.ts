/**
 * @module canvas.repository
 *
 * 无限画布持久化 Repository —— canvas_projects + canvas_snapshots 表。
 *
 * 设计（见 migration 027 + docs/multimedia-model-providers.md §4）：
 *   - canvas_projects：项目元数据，支持列表 / 排序 / 软删除（status='deleted'）
 *   - canvas_snapshots：每个项目一行完整 JSON 快照，渲染端即时读写 localStorage，
 *     关键变更后异步 upsert 到此处，保证数据落 SQLite（可备份 / 跨窗口一致）。
 */

import { BaseRepository } from './base.repository.js'
import type { SparkDatabase } from '../database.js'

/** canvas_projects 表行类型 */
export interface CanvasProjectRow {
  id: string
  user_id: number
  title: string
  description: string | null
  status: 'active' | 'archived' | 'deleted'
  cover_asset_id: string | null
  /** 项目封面图 safe-file:// URL（独立于画布 asset，列表卡片直接展示） */
  cover_url: string | null
  /** 是否置顶（1=置顶，列表里优先展示） */
  pinned: number
  /** 置顶时间（置顶内部排序） */
  pinned_at: string | null
  node_count: number
  asset_count: number
  task_count: number
  root_path: string | null
  last_opened_at: string | null
  created_at: string
  updated_at: string
}

export interface UpsertCanvasProjectParams {
  id: string
  userId?: number
  title: string
  description?: string | null
  status?: 'active' | 'archived' | 'deleted'
  coverAssetId?: string | null
  coverUrl?: string | null
  /** 是否置顶；upsert 未传则保留原值 */
  pinned?: boolean
  /** 置顶时间 ISO 字符串；pinned=true 时若未传则用当前时间，pinned=false 时清空 */
  pinnedAt?: string | null
  nodeCount?: number
  assetCount?: number
  taskCount?: number
  rootPath?: string | null
  lastOpenedAt?: string | null
  createdAt?: string
}

/** canvas_snapshots 表行类型 */
export interface CanvasSnapshotRow {
  project_id: string
  user_id: number
  snapshot_json: string
  updated_at: string
}

export class CanvasProjectRepository extends BaseRepository {
  constructor(db: SparkDatabase) {
    super(db, 'canvas_projects')
  }

  upsert(params: UpsertCanvasProjectParams): CanvasProjectRow {
    const now = new Date().toISOString()
    const existing = this.findById<CanvasProjectRow>(params.id)
    const row: CanvasProjectRow = {
      id: params.id,
      user_id: params.userId ?? existing?.user_id ?? 0,
      title: params.title,
      description: params.description ?? existing?.description ?? null,
      status: params.status ?? existing?.status ?? 'active',
      cover_asset_id: params.coverAssetId ?? existing?.cover_asset_id ?? null,
      cover_url: params.coverUrl !== undefined ? params.coverUrl : (existing?.cover_url ?? null),
      pinned:
        params.pinned !== undefined
          ? params.pinned
            ? 1
            : 0
          : (existing?.pinned ?? 0),
      pinned_at:
        params.pinned !== undefined
          ? params.pinned
            ? (params.pinnedAt ?? new Date().toISOString())
            : null
          : (existing?.pinned_at ?? null),
      node_count: params.nodeCount ?? existing?.node_count ?? 0,
      asset_count: params.assetCount ?? existing?.asset_count ?? 0,
      task_count: params.taskCount ?? existing?.task_count ?? 0,
      root_path: params.rootPath ?? existing?.root_path ?? null,
      last_opened_at: params.lastOpenedAt ?? existing?.last_opened_at ?? null,
      created_at: params.createdAt ?? existing?.created_at ?? now,
      updated_at: now,
    }
    this.raw
      .prepare(
        `INSERT INTO canvas_projects
           (id, user_id, title, description, status, cover_asset_id, cover_url, pinned, pinned_at, node_count, asset_count, task_count, root_path, last_opened_at, created_at, updated_at)
         VALUES (@id, @user_id, @title, @description, @status, @cover_asset_id, @cover_url, @pinned, @pinned_at, @node_count, @asset_count, @task_count, @root_path, @last_opened_at, @created_at, @updated_at)
         ON CONFLICT(id) DO UPDATE SET
           user_id=excluded.user_id, title=excluded.title, description=excluded.description,
           status=excluded.status, cover_asset_id=excluded.cover_asset_id, cover_url=excluded.cover_url,
           pinned=excluded.pinned, pinned_at=excluded.pinned_at,
           node_count=excluded.node_count, asset_count=excluded.asset_count, task_count=excluded.task_count,
           root_path=excluded.root_path,
           last_opened_at=excluded.last_opened_at, updated_at=excluded.updated_at`,
      )
      .run(row)
    return row
  }

  list(userId = 0, includeDeleted = false): CanvasProjectRow[] {
    // 置顶优先；置顶内部按 pinned_at 倒序，未置顶按最近打开时间倒序。
    const order = `ORDER BY pinned DESC, datetime(pinned_at) DESC, datetime(last_opened_at) DESC`
    const sql = includeDeleted
      ? `SELECT * FROM canvas_projects WHERE user_id = ? ${order}`
      : `SELECT * FROM canvas_projects WHERE user_id = ? AND status != 'deleted' ${order}`
    return this.raw.prepare(sql).all(userId) as CanvasProjectRow[]
  }

  get(id: string): CanvasProjectRow | null {
    return this.findById<CanvasProjectRow>(id)
  }

  /** 软删除：status 置为 deleted（保留可恢复） */
  softDelete(id: string): void {
    this.raw
      .prepare(`UPDATE canvas_projects SET status = 'deleted', updated_at = ? WHERE id = ?`)
      .run(new Date().toISOString(), id)
  }

  /** 物理删除项目 + 其快照 */
  hardDelete(id: string): void {
    this.raw.prepare(`DELETE FROM canvas_snapshots WHERE project_id = ?`).run(id)
    this.raw.prepare(`DELETE FROM canvas_projects WHERE id = ?`).run(id)
  }
}

export class CanvasSnapshotRepository extends BaseRepository {
  constructor(db: SparkDatabase) {
    super(db, 'canvas_snapshots')
  }

  /** upsert 完整快照 JSON */
  save(projectId: string, userId: number, snapshotJson: string): void {
    const now = new Date().toISOString()
    this.raw
      .prepare(
        `INSERT INTO canvas_snapshots (project_id, user_id, snapshot_json, updated_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(project_id) DO UPDATE SET
           user_id=excluded.user_id, snapshot_json=excluded.snapshot_json, updated_at=excluded.updated_at`,
      )
      .run(projectId, userId, snapshotJson, now)
  }

  get(projectId: string): CanvasSnapshotRow | null {
    const row = this.raw
      .prepare(`SELECT * FROM canvas_snapshots WHERE project_id = ?`)
      .get(projectId) as CanvasSnapshotRow | undefined
    return row ?? null
  }

  exists(projectId: string): boolean {
    const row = this.raw
      .prepare(`SELECT 1 AS hit FROM canvas_snapshots WHERE project_id = ?`)
      .get(projectId) as { hit: number } | undefined
    return row != null
  }
}

/**
 * @module wiki-repo-enrichment.repository
 *
 * Repo Wiki AI 导读缓存仓储（wiki_repo_enrichment，migration 119）。
 *
 * 语义（方案 §5.2 / §5.3）：
 *   - 主键 (space_id, slug, repo_rev)：rev 前进即新键空间，天然全量重生成；
 *   - `upsert` 幂等：重试 failed 行 / 手动单页重跑都走同一覆盖语义；
 *   - `ready` 行是缓存命中（差集计划跳过）；`failed` 行留待下次运行重试；
 *   - `deleteStaleRevs` 在成功跑完一个新 rev 后回收旧 rev 行，缓存体积上限
 *     = 单空间单 rev 的页面数；
 *   - `error` 只存失败原因分类（machine readable），绝不存正文片段
 *     （脱敏纪律：与 wiki_extraction_state 同一口径）。
 */

import { BaseRepository } from './base.repository.js'
import type { SparkDatabase } from '../database.js'

/** 导读行状态：ready=缓存可用；failed=上次生成失败（可重试） */
export type WikiRepoEnrichmentStatus = 'ready' | 'failed'

export interface WikiRepoEnrichmentRow {
  space_id: string
  slug: string
  repo_rev: string
  section: string
  status: WikiRepoEnrichmentStatus
  error: string | null
  model: string | null
  provider: string | null
  created_at: number
  updated_at: number
}

export interface WikiRepoEnrichmentUpsert {
  spaceId: string
  slug: string
  repoRev: string
  /** AI 导读 markdown 段（status='failed' 时为空串） */
  section: string
  status: WikiRepoEnrichmentStatus
  /** 失败原因分类（仅 status='failed' 时携带） */
  error?: string | null
  model?: string | null
  provider?: string | null
  now?: number
}

export class WikiRepoEnrichmentRepository extends BaseRepository {
  constructor(db: SparkDatabase) {
    super(db, 'wiki_repo_enrichment')
  }

  /** 写入或覆盖一行（同键二次写覆盖：重试 failed / 手动重跑共用此语义）。 */
  upsert(row: WikiRepoEnrichmentUpsert): WikiRepoEnrichmentRow {
    const at = row.now ?? Date.now()
    this.raw
      .prepare(
        `INSERT INTO wiki_repo_enrichment
           (space_id, slug, repo_rev, section, status, error, model, provider,
            created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(space_id, slug, repo_rev) DO UPDATE SET
           section   = excluded.section,
           status     = excluded.status,
           error      = excluded.error,
           model      = excluded.model,
           provider   = excluded.provider,
           updated_at = excluded.updated_at`,
      )
      .run(
        row.spaceId,
        row.slug,
        row.repoRev,
        row.section,
        row.status,
        row.error ?? null,
        row.model ?? null,
        row.provider ?? null,
        at,
        at,
      )
    // 刚写入即读回：失败只可能是存储层异常（fail-loud，不静默返回旧值）
    const saved = this.get(row.spaceId, row.slug, row.repoRev)
    if (saved == null) throw new Error('wiki_repo_enrichment upsert 后读取失败（不应发生）')
    return saved
  }

  get(spaceId: string, slug: string, repoRev: string): WikiRepoEnrichmentRow | null {
    return (
      (this.raw
        .prepare(
          `SELECT * FROM wiki_repo_enrichment WHERE space_id = ? AND slug = ? AND repo_rev = ?`,
        )
        .get(spaceId, slug, repoRev) as WikiRepoEnrichmentRow | undefined) ?? null
    )
  }

  /** 某空间在某 rev 下的全部行（差集计算与进度统计用）。 */
  getBySpace(spaceId: string, repoRev: string): WikiRepoEnrichmentRow[] {
    return this.raw
      .prepare(`SELECT * FROM wiki_repo_enrichment WHERE space_id = ? AND repo_rev = ?`)
      .all(spaceId, repoRev) as WikiRepoEnrichmentRow[]
  }

  /** 某空间全部行（跨 rev；空间级进度与排查用）。 */
  getStatusBySpace(spaceId: string): WikiRepoEnrichmentRow[] {
    return this.raw
      .prepare(
        `SELECT * FROM wiki_repo_enrichment WHERE space_id = ? ORDER BY updated_at DESC`,
      )
      .all(spaceId) as WikiRepoEnrichmentRow[]
  }

  /** 回收旧 rev 行（成功跑完一个新 rev 后调用；keepRev=当前生效 rev）。 */
  deleteStaleRevs(spaceId: string, keepRev: string): number {
    const result = this.raw
      .prepare(`DELETE FROM wiki_repo_enrichment WHERE space_id = ? AND repo_rev != ?`)
      .run(spaceId, keepRev)
    return result.changes
  }

  /** 空间归档 / 删除时清理（接线见方案 S3；先备 API）。 */
  deleteBySpace(spaceId: string): number {
    const result = this.raw
      .prepare(`DELETE FROM wiki_repo_enrichment WHERE space_id = ?`)
      .run(spaceId)
    return result.changes
  }
}

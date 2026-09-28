/**
 * @module wiki-revision.repository
 *
 * Wiki 版本历史（wiki_revision）仓储 — 每次有效写入的版本快照索引。
 *
 * body_snapshot_path 指向受控命名空间下的旧正文快照文件（由
 * agent-runtime 的 WikiStoreService 在提交前写好，本仓储只记路径）。
 * INSERT OR IGNORE 幂等：同 (page_id, version) 重复保留（重试路径）静默跳过。
 */

import { BaseRepository } from './base.repository.js'
import type { SparkDatabase } from '../database.js'

export type WikiRevisionChangeKind = 'create' | 'edit' | 'restore' | 'delete'

export interface WikiRevisionRow {
  id: number
  page_id: string
  version: number
  content_hash: string
  title: string
  summary: string
  body_snapshot_path: string | null
  change_kind: WikiRevisionChangeKind
  change_note: string | null
  actor: string | null
  created_at: number
}

export interface WikiRevisionInsert {
  page_id: string
  version: number
  content_hash: string
  title: string
  summary: string
  body_snapshot_path?: string | null
  change_kind: WikiRevisionChangeKind
  change_note?: string | null
  actor?: string | null
}

export class WikiRevisionRepository extends BaseRepository {
  constructor(db: SparkDatabase) {
    super(db, 'wiki_revision')
  }

  /** 幂等写入一条版本记录（同 page+version 重复写入静默跳过）。 */
  insert(row: WikiRevisionInsert): void {
    this.raw
      .prepare(
        `INSERT OR IGNORE INTO wiki_revision
           (page_id, version, content_hash, title, summary, body_snapshot_path,
            change_kind, change_note, actor, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        row.page_id,
        row.version,
        row.content_hash,
        row.title,
        row.summary,
        row.body_snapshot_path ?? null,
        row.change_kind,
        row.change_note ?? null,
        row.actor ?? null,
        Date.now(),
      )
  }

  /** 某页面的版本历史（新→旧）。 */
  listByPage(pageId: string, limit = 50): WikiRevisionRow[] {
    return this.raw
      .prepare(
        `SELECT * FROM wiki_revision WHERE page_id = ? ORDER BY version DESC LIMIT ?`,
      )
      .all(pageId, limit) as WikiRevisionRow[]
  }

  /** 取某个历史版本（还原用）。 */
  getByVersion(pageId: string, version: number): WikiRevisionRow | null {
    const row = this.raw
      .prepare(`SELECT * FROM wiki_revision WHERE page_id = ? AND version = ?`)
      .get(pageId, version) as WikiRevisionRow | undefined
    return row ?? null
  }

  /** 物理删除页面时清理版本记录（删除屏障，WikiWriteService 专用）。 */
  deleteByPage(pageId: string): void {
    this.raw.prepare(`DELETE FROM wiki_revision WHERE page_id = ?`).run(pageId)
  }
}

/**
 * @module wiki-search.repository
 *
 * Wiki 检索层仓储 — FTS5 全文索引维护 / BM25 查询 / 存量回填。
 *
 * 范式对齐 memory-search.repository（S0 不做向量 RRF 与实体扩展，S5 可加）：
 *   - wiki_fts 是 contentless FTS5 表（content='' + contentless_delete=1），
 *     rowid 与 wiki_page 的隐式 rowid 对齐。
 *   - 写入/查询两侧统一走 segmentCjk / buildFtsMatchQuery（CJK 逐字预分词，
 *     两侧不一致会导致查不到）。
 *   - FTS 行维护由 WikiPageRepository 在 insert/update/archive/delete 的同一
 *     事务内调用本模块低层函数（upsertWikiFtsRow / deleteWikiFtsRow）。
 */

import { createLogger } from '@spark/shared'
import { BaseRepository } from './base.repository.js'
import type { SqliteDatabase } from './base.repository.js'
import type { SparkDatabase } from '../database.js'
import type { WikiPageRow } from './wiki-page.repository.js'
import { segmentCjk, buildFtsMatchQuery } from '../segment-cjk.js'

const log = createLogger('storage:wiki-search')

// ─── 低层 FTS 维护函数（供 WikiPageRepository 在同一事务内调用） ─────────

/**
 * 写入/更新一条 FTS 行（先删后插，contentless_delete=1 支持按 rowid 直接删）。
 * 必须在调用方事务内执行；本函数不吞异常，由调用方决定降级策略。
 */
export function upsertWikiFtsRow(
  raw: SqliteDatabase,
  pageId: string,
  fields: { title: string; summary: string; body?: string },
): void {
  const rowidRow = raw.prepare('SELECT rowid FROM wiki_page WHERE id = ?').get(pageId) as
    | { rowid: number | bigint }
    | undefined
  if (rowidRow == null) return
  raw.prepare('DELETE FROM wiki_fts WHERE rowid = ?').run(rowidRow.rowid)
  raw
    .prepare('INSERT INTO wiki_fts(rowid, title, summary, body) VALUES (?, ?, ?, ?)')
    .run(
      rowidRow.rowid,
      segmentCjk(fields.title),
      segmentCjk(fields.summary),
      segmentCjk(fields.body ?? ''),
    )
}

/** 删除一条 FTS 行（归档/物理删除时调用；页面行仍存在以解析 rowid）。 */
export function deleteWikiFtsRow(raw: SqliteDatabase, pageId: string): void {
  const rowidRow = raw.prepare('SELECT rowid FROM wiki_page WHERE id = ?').get(pageId) as
    | { rowid: number | bigint }
    | undefined
  if (rowidRow == null) return
  raw.prepare('DELETE FROM wiki_fts WHERE rowid = ?').run(rowidRow.rowid)
}

/** wiki_fts 表是否存在（migration 未跑到时降级用） */
export function wikiFtsTableExists(raw: SqliteDatabase): boolean {
  const row = raw
    .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'wiki_fts'`)
    .get()
  return row != null
}

// ─── Repository ───────────────────────────────────────────────────────────

const FTS_BACKFILL_FLAG_CATEGORY = 'wiki'
const FTS_BACKFILL_FLAG_KEY = 'ftsBackfillDone'

export interface WikiFtsSearchHit {
  page: WikiPageRow
  /** bm25 原始分（越小越相关） */
  bm25: number
}

export class WikiSearchRepository extends BaseRepository {
  /** FTS 表存在性缓存（写入回执 indexReady 判定） */
  private ftsAvailable: boolean | null = null

  constructor(db: SparkDatabase) {
    super(db, 'wiki_fts')
  }

  /** wiki_fts 是否可用（migration 未跑到的旧库降级为不可检索，回执如实标注）。 */
  isFtsAvailable(): boolean {
    if (this.ftsAvailable == null) this.ftsAvailable = wikiFtsTableExists(this.raw)
    return this.ftsAvailable
  }

  /**
   * BM25 全文检索（限定空间集合 + 活跃页面）。
   * top-K 上限由调用方（WikiContextBudget）强制裁剪，本层只取原始 limit。
   *
   * @returns 命中列表（bm25 升序 = 相关度降序）；查询为空时返回 []
   */
  searchBm25(
    query: string,
    opts?: { spaceIds?: string[]; kind?: string; limit?: number },
  ): WikiFtsSearchHit[] {
    const match = buildFtsMatchQuery(query)
    if (match == null) return []
    if (opts?.spaceIds != null && opts.spaceIds.length === 0) return []

    const conditions: string[] = [`p.status != 'archived'`]
    const values: unknown[] = [match]
    if (opts?.spaceIds != null && opts.spaceIds.length > 0) {
      const placeholders = opts.spaceIds.map(() => '?').join(', ')
      conditions.push(`p.space_id IN (${placeholders})`)
      values.push(...opts.spaceIds)
    }
    if (opts?.kind != null) {
      conditions.push('p.kind = ?')
      values.push(opts.kind)
    }
    const limit = opts?.limit ?? 20
    values.push(limit)

    const rows = this.raw
      .prepare(
        `SELECT p.*, bm25(wiki_fts) AS __bm25
         FROM wiki_fts
         JOIN wiki_page p ON p.rowid = wiki_fts.rowid
         WHERE wiki_fts MATCH ? AND ${conditions.join(' AND ')}
         ORDER BY __bm25 ASC
         LIMIT ?`,
      )
      .all(...values) as Array<WikiPageRow & { __bm25: number }>

    return rows.map((r) => {
      const { __bm25, ...page } = r
      return { page: page as WikiPageRow, bm25: __bm25 }
    })
  }

  /**
   * 存量页面 FTS 回填（幂等）。
   * migration 只建表；分词必须走 JS 侧 segmentCjk，因此回填在代码侧执行，
   * 用 app_settings(wiki / ftsBackfillDone) 标记完成状态。
   *
   * @returns 本次回填的行数（已回填过则为 0）
   */
  backfillFtsIfNeeded(): number {
    const flag = this.raw
      .prepare('SELECT value FROM app_settings WHERE category = ? AND key = ?')
      .get(FTS_BACKFILL_FLAG_CATEGORY, FTS_BACKFILL_FLAG_KEY) as { value: string } | undefined
    if (flag != null && flag.value === 'true') return 0

    const pages = this.raw
      .prepare(
        `SELECT id, title, summary, file_path FROM wiki_page WHERE status != 'archived'`,
      )
      .all() as Array<{ id: string; title: string; summary: string; file_path: string }>

    const tx = this.raw.transaction(() => {
      // S0 回填 title + summary（body 在文件里，此处不读文件；
      // 后续任何一次写入会带 body 重建该行，与 memory 同策略）。
      for (const p of pages) {
        upsertWikiFtsRow(this.raw, p.id, { title: p.title, summary: p.summary })
      }
      this.raw
        .prepare(
          `INSERT INTO app_settings (category, key, value, updated_at) VALUES (?, ?, ?, ?)
           ON CONFLICT(category, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
        )
        .run(FTS_BACKFILL_FLAG_CATEGORY, FTS_BACKFILL_FLAG_KEY, 'true', new Date().toISOString())
    })
    tx()

    if (pages.length > 0) log.info(`wiki FTS backfill complete: ${pages.length} pages indexed`)
    return pages.length
  }
}

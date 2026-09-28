/**
 * @module wiki-link.repository
 *
 * Wiki 链接（wiki_link）仓储 — 双链（[[标题]]）与显式关联（reference）的读写。
 *
 * 两种边：
 *   - link_type='wiki'      ：正文内 [[标题]] 解析结果，由 WikiLinkService 在
 *                             页面提交后整体重建（先删该页出边再插新边）。
 *   - link_type='reference' ：用户 / Agent 显式建立的关联（wiki_link 工具）。
 *
 * 红链（red link）语义：目标页不存在时 to_page 为 NULL，但 to_title 保留原始
 * 文本；目标页创建后由 resolveRedLinks() 回填 to_page，无需重写来源页。
 *
 * 写入闸门约束：本仓储只做纯 SQL；业务写入口统一走 agent-runtime 的
 * WikiWriteService / WikiLinkService。
 */

import { randomUUID } from 'node:crypto'
import { BaseRepository } from './base.repository.js'
import type { SparkDatabase } from '../database.js'

export type WikiLinkType = 'wiki' | 'reference'

export interface WikiLinkRow {
  id: string
  space_id: string
  from_page: string
  to_page: string | null
  to_title: string
  link_type: WikiLinkType
  created_at: number
}

/** 反向链接命中（含来源页展示信息，避免调用方二次查询） */
export interface WikiBacklinkHit {
  fromPage: string
  fromTitle: string
  fromKind: string
  linkType: WikiLinkType
  createdAt: number
}

/** generateId 同约定：前缀 + uuid 前 8 hex */
function generateId(prefix: string): string {
  return `${prefix}_${randomUUID().replace(/-/g, '').slice(0, 8)}`
}

export class WikiLinkRepository extends BaseRepository {
  constructor(db: SparkDatabase) {
    super(db, 'wiki_link')
  }

  /**
   * 整体重建某页的 [[双链]] 出边（先删后插，同一事务）。
   *
   * 语义：正文是双链的唯一权威来源 —— 每次提交都按新正文全量重算，避免
   * 「增量 diff」在重命名/删段落时残留幽灵边。显式关联（reference）不受影响。
   *
   * @returns 实际写入的边数
   */
  replaceWikiLinks(
    spaceId: string,
    fromPage: string,
    links: Array<{ toPage: string | null; toTitle: string }>,
  ): number {
    const now = Date.now()
    const tx = this.raw.transaction(() => {
      this.raw
        .prepare(`DELETE FROM wiki_link WHERE from_page = ? AND link_type = 'wiki'`)
        .run(fromPage)
      const insert = this.raw.prepare(
        `INSERT INTO wiki_link (id, space_id, from_page, to_page, to_title, link_type, created_at)
         VALUES (?, ?, ?, ?, ?, 'wiki', ?)`,
      )
      for (const link of links) {
        insert.run(generateId('wlnk'), spaceId, fromPage, link.toPage, link.toTitle, now)
      }
      return links.length
    })
    return tx()
  }

  /** 某页的出边（含红链）。 */
  listOutgoing(fromPage: string, linkType?: WikiLinkType): WikiLinkRow[] {
    const sql =
      linkType != null
        ? `SELECT * FROM wiki_link WHERE from_page = ? AND link_type = ? ORDER BY created_at ASC`
        : `SELECT * FROM wiki_link WHERE from_page = ? ORDER BY created_at ASC`
    return (
      linkType != null
        ? this.raw.prepare(sql).all(fromPage, linkType)
        : this.raw.prepare(sql).all(fromPage)
    ) as WikiLinkRow[]
  }

  /**
   * 反向链接（谁指向我）。排除已归档来源页与自环；同一来源页多边去重。
   * 排序：显式关联优先，其次按建立时间新→旧（用户关心的关联靠前）。
   */
  listBacklinks(toPage: string, limit = 50): WikiBacklinkHit[] {
    const rows = this.raw
      .prepare(
        `SELECT l.from_page AS fromPage, p.title AS fromTitle, p.kind AS fromKind,
                l.link_type AS linkType, l.created_at AS createdAt
         FROM wiki_link l
         JOIN wiki_page p ON p.id = l.from_page
         WHERE l.to_page = ? AND l.from_page != ? AND p.status != 'archived'
         GROUP BY l.from_page
         ORDER BY (l.link_type = 'reference') DESC, l.created_at DESC
         LIMIT ?`,
      )
      .all(toPage, toPage, limit) as WikiBacklinkHit[]
    return rows
  }

  /** 反向链接计数（预算层与 UI badge 用）。 */
  countBacklinks(toPage: string): number {
    const row = this.raw
      .prepare(
        `SELECT COUNT(DISTINCT l.from_page) AS count
         FROM wiki_link l
         JOIN wiki_page p ON p.id = l.from_page
         WHERE l.to_page = ? AND l.from_page != ? AND p.status != 'archived'`,
      )
      .get(toPage, toPage) as { count: number }
    return row.count
  }

  /**
   * 回填红链：目标页创建/改名后，把空间内指向它的 NULL 边补上 to_page。
   *
   * 匹配口径与 WikiLinkService 的解析一致 —— slug 或 title（大小写不敏感），
   * 两者都试，保证「用户写 [[标题]]」与「用户写 [[slug]]」都能连上。
   *
   * @returns 本次回填的边数
   */
  resolveRedLinks(spaceId: string, pageId: string, slug: string, title: string): number {
    const result = this.raw
      .prepare(
        `UPDATE wiki_link SET to_page = ?
         WHERE space_id = ? AND to_page IS NULL AND from_page != ?
           AND (LOWER(to_title) = LOWER(?) OR LOWER(to_title) = LOWER(?))`,
      )
      .run(pageId, spaceId, pageId, slug, title)
    return result.changes
  }

  /** 引用某标题的页面数（供 UI 提示「改名会影响 N 处引用」）。 */
  countReferrersByTitle(spaceId: string, title: string, slug: string): number {
    const row = this.raw
      .prepare(
        `SELECT COUNT(DISTINCT from_page) AS count FROM wiki_link
         WHERE space_id = ? AND (LOWER(to_title) = LOWER(?) OR LOWER(to_title) = LOWER(?))`,
      )
      .get(spaceId, title, slug) as { count: number }
    return row.count
  }

  // ─── 显式关联（reference 边） ─────────────────────────────────────────

  /** 建立显式关联（幂等：同 from/to 已存在则返回 false）。 */
  insertReference(spaceId: string, fromPage: string, toPage: string, toTitle: string): boolean {
    const existing = this.raw
      .prepare(
        `SELECT id FROM wiki_link WHERE from_page = ? AND to_page = ? AND link_type = 'reference'`,
      )
      .get(fromPage, toPage) as { id: string } | undefined
    if (existing != null) return false
    this.raw
      .prepare(
        `INSERT INTO wiki_link (id, space_id, from_page, to_page, to_title, link_type, created_at)
         VALUES (?, ?, ?, ?, ?, 'reference', ?)`,
      )
      .run(generateId('wlnk'), spaceId, fromPage, toPage, toTitle, Date.now())
    return true
  }

  /** 移除显式关联（幂等：不存在返回 false）。 */
  removeReference(fromPage: string, toPage: string): boolean {
    const result = this.raw
      .prepare(
        `DELETE FROM wiki_link WHERE from_page = ? AND to_page = ? AND link_type = 'reference'`,
      )
      .run(fromPage, toPage)
    return result.changes > 0
  }

  /**
   * 目标页归档时把入边降级为红链（to_page = NULL，保留 to_title）。
   *
   * 归档 ≠ 目标存在：入边不应再指向归档页；但来源页正文里的 [[标题]] 文本
   * 仍然存在，保留 to_title 才能在目标页还原时自动重新连上（resolveRedLinks）。
   */
  unpointIncoming(toPage: string): number {
    const result = this.raw
      .prepare(`UPDATE wiki_link SET to_page = NULL WHERE to_page = ?`)
      .run(toPage)
    return result.changes
  }

  /**
   * 移除某页的全部出边（归档时调用：页面内容退出图谱，出边即失效）。
   */
  deleteOutgoing(pageId: string): number {
    const result = this.raw.prepare(`DELETE FROM wiki_link WHERE from_page = ?`).run(pageId)
    return result.changes
  }

  /**
   * 物理删除页面时清理其全部边（双向）。删除屏障的一部分：
   * 不保留被删页面的标题副本，避免「已删除内容」经 to_title 泄漏。
   */
  deleteByPage(pageId: string): void {
    this.raw.prepare(`DELETE FROM wiki_link WHERE from_page = ? OR to_page = ?`).run(pageId, pageId)
  }
}

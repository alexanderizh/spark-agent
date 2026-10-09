/**
 * @module wiki-page.repository
 *
 * 知识页面（wiki_page）仓储 — 页面 CRUD、目录树、CAS 版本更新、FTS 同事务维护。
 *
 * 范式对齐 memory.repository（S1B.1）：
 *   - version 单调递增做 CAS 乐观锁；content_hash 为正文 SHA-256 守卫。
 *   - FTS（wiki_fts，contentless）在 insert/update/archive/delete 的同一事务内
 *     维护：先删后插（contentless_delete=1），写入前过 segmentCjk()。
 *   - fail-loud 闸门：title/summary/body 任一文本字段变更必须携带完整 body ——
 *     contentless FTS 不支持部分更新，缺 body 会以空串重建行、旧正文检索永久丢失。
 *   - 归档释放 slug 唯一槽位（部分索引 WHERE status != 'archived'）。
 *
 * 写入闸门约束：业务写入口统一走 agent-runtime 的 WikiWriteService（版本提交 +
 * 闸门 + 索引就绪回执）；本仓储只提供纯 SQL 原语。
 */

import { createHash } from 'node:crypto'
import { createLogger } from '@spark/shared'
import { BaseRepository } from './base.repository.js'
import type { SparkDatabase } from '../database.js'
import { upsertWikiFtsRow, deleteWikiFtsRow, wikiFtsTableExists } from './wiki-search.repository.js'

const log = createLogger('storage:wiki')

/**
 * 页面类型。folder 是无正文、不进 FTS、不同步双链的纯结构容器节点
 * （migration 118 放宽 CHECK 后入库），目录树 / 拖拽 / 归档等机制与页面共用。
 */
export type WikiPageKind = 'knowledge' | 'experience' | 'pattern' | 'reference' | 'note' | 'folder'
export type WikiPageStatus = 'draft' | 'published' | 'archived'

export interface WikiPageRow {
  id: string
  space_id: string
  parent_id: string | null
  kind: WikiPageKind
  title: string
  slug: string
  summary: string
  file_path: string
  tags_json: string
  status: WikiPageStatus
  confidence: number
  version: number
  content_hash: string | null
  sort_order: number
  /** 置顶标记（0/1）：纯展示元数据，toggle 不推进 version、不留历史版本 */
  pinned: number
  source_type: string | null
  source_session_id: string | null
  author_role: string | null
  hit_count: number
  last_hit_at: number | null
  valid_from: number | null
  invalid_at: number | null
  created_at: number
  updated_at: number
}

/** insert 入参：version 从 1 起、时间戳与 content_hash 由仓储填充；pinned 走列默认 0 */
export type WikiPageInsert = Omit<
  WikiPageRow,
  'created_at' | 'updated_at' | 'version' | 'content_hash' | 'pinned'
>

/** update 时文本字段变更必须带 body（fail-loud，见模块注释） */
export interface WikiPageUpdatePatch extends Partial<
  Omit<WikiPageRow, 'id' | 'created_at' | 'version' | 'content_hash'>
> {}

/** 正文守卫哈希口径：去尾部换行后 SHA-256（与 memory 的 hashBodyForGuard 同约定） */
export function hashWikiBody(body: string): string {
  return createHash('sha256').update(body.replace(/\n+$/, ''), 'utf8').digest('hex')
}

export class WikiPageRepository extends BaseRepository {
  /** wiki_fts 表存在性缓存（migration 未跑到的旧库降级为不维护 FTS） */
  private ftsAvailable: boolean | null = null

  constructor(db: SparkDatabase) {
    super(db, 'wiki_page')
  }

  /**
   * 新建页面（version=1）。body 仅用于 FTS 索引与 content_hash 守卫；
   * 正文本体在文件系统（WikiStoreService 先写文件再调此处）。
   */
  insert(row: WikiPageInsert, body: string): WikiPageRow {
    const now = Date.now()
    const tx = this.raw.transaction(() => {
      this.raw
        .prepare(
          `INSERT INTO wiki_page
             (id, space_id, parent_id, kind, title, slug, summary, file_path, tags_json,
              status, confidence, version, content_hash, sort_order, source_type,
              source_session_id, author_role, hit_count, last_hit_at, valid_from, invalid_at,
              created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, 0, NULL, ?, NULL, ?, ?)`,
        )
        .run(
          row.id,
          row.space_id,
          row.parent_id,
          row.kind,
          row.title,
          row.slug,
          row.summary,
          row.file_path,
          row.tags_json,
          row.status,
          row.confidence,
          hashWikiBody(body),
          row.sort_order,
          row.source_type,
          row.source_session_id,
          row.author_role,
          row.valid_from ?? now,
          now,
          now,
        )
      if (row.kind !== 'folder') {
        this.maintainFts('upsert', row.id, {
          title: row.title,
          summary: row.summary,
          body,
        })
      }
    })
    tx()
    return this.findById<WikiPageRow>(row.id)!
  }

  /** folder 节点无正文：不进 FTS（upsert/delete 一律跳过，防 contentless 空行噪声）。 */
  private static isFolder(row: { kind: string } | null | undefined): boolean {
    return row?.kind === 'folder'
  }

  /**
   * 更新页面字段。文本字段（title/summary）变更必须带 body（fail-loud）；
   * 每次有效更新 version +1；带 body 时同步刷新守卫哈希。
   */
  update(id: string, patch: WikiPageUpdatePatch, body?: string): WikiPageRow {
    const existing = this.findById<WikiPageRow>(id)
    if (existing == null) throw new Error(`Wiki page not found: ${id}`)

    const fields: string[] = []
    const values: unknown[] = []
    const updatable = [
      'parent_id',
      'kind',
      'title',
      'slug',
      'summary',
      'file_path',
      'tags_json',
      'status',
      'confidence',
      'sort_order',
      'source_type',
      'source_session_id',
      'author_role',
      'valid_from',
      'invalid_at',
    ] as const
    for (const key of updatable) {
      if (key in patch) {
        fields.push(`${key} = ?`)
        values.push((patch as Record<string, unknown>)[key])
      }
    }
    // 无字段变更且未携带正文（纯空 patch）→ 无操作；只带 body 仍要走完整
    // 更新路径（version+1、守卫哈希刷新、FTS 重建）。
    if (fields.length === 0 && body == null) return existing

    fields.push('version = version + 1')
    if (body != null) {
      fields.push('content_hash = ?')
      values.push(hashWikiBody(body))
    }
    fields.push('updated_at = ?')
    values.push(Date.now(), id)

    const next = { ...existing, ...patch }
    const becomesArchived = next.status === 'archived'
    const textChanged =
      body != null ||
      ('title' in patch && patch.title !== existing.title) ||
      ('summary' in patch && patch.summary !== existing.summary)

    const tx = this.raw.transaction(() => {
      this.raw.prepare(`UPDATE wiki_page SET ${fields.join(', ')} WHERE id = ?`).run(...values)
      // folder 无正文、从未进 FTS：文本变更不走 fail-loud 闸门也不维护索引
      // （重命名文件夹不该被「必须带完整正文」拦住）。
      if (WikiPageRepository.isFolder(existing)) return
      if (becomesArchived) {
        this.maintainFts('delete', id)
      } else if (textChanged) {
        if (body == null) {
          // fail-loud：拒绝以空串重建 FTS 行（旧正文检索会永久丢失）
          throw new Error(
            `WikiPageRepository.update: 文本字段变更但未提供 body（id=${id}）——` +
              `改 title/summary 请同时传入完整正文；仅改元数据则不要传文本字段。`,
          )
        }
        this.maintainFts('upsert', id, {
          title: next.title,
          summary: next.summary,
          body,
        })
      }
    })
    tx()
    return this.findById<WikiPageRow>(id)!
  }

  /**
   * 置顶开关：直接列更新，不推进 version、不写历史版本、不触发 FTS，
   * 也不刷新 updated_at（置顶不是内容更新，不应扰动「最近更新」排序）。
   * 页面不存在时返回 null（调用方转结构化错误，不抛裸异常）。
   */
  setPinned(id: string, pinned: boolean): WikiPageRow | null {
    const existing = this.findById<WikiPageRow>(id)
    if (existing == null) return null
    if (existing.pinned === (pinned ? 1 : 0)) return existing
    this.raw.prepare('UPDATE wiki_page SET pinned = ? WHERE id = ?').run(pinned ? 1 : 0, id)
    return this.findById<WikiPageRow>(id)
  }

  /**
   * CAS 式条件更新：仅当 version === expectedVersion 且页面未归档时应用，
   * 否则返回 null（调用方丢弃或重读重试，绝不覆盖当前状态）。
   * 原子性依据：better-sqlite3 同步 API + Node 单线程，检查与执行间无并发窗口。
   */
  compareAndSwap(
    id: string,
    expectedVersion: number,
    patch: WikiPageUpdatePatch,
    body?: string,
  ): WikiPageRow | null {
    const existing = this.findById<WikiPageRow>(id)
    if (existing == null) return null
    if (existing.version !== expectedVersion || existing.status === 'archived') {
      log.info(
        `wiki page CAS miss: id=${id} expected=${expectedVersion} actual=${existing.version} archived=${existing.status === 'archived'}`,
      )
      return null
    }
    return this.update(id, patch, body)
  }

  getById(id: string): WikiPageRow | null {
    return this.findById<WikiPageRow>(id)
  }

  /** 按 slug 找空间内活跃页面（[[双链]] 解析键；归档释放槽位） */
  getBySlug(spaceId: string, slug: string): WikiPageRow | null {
    const row = this.raw
      .prepare(`SELECT * FROM wiki_page WHERE space_id = ? AND slug = ? AND status != 'archived'`)
      .get(spaceId, slug) as WikiPageRow | undefined
    return row ?? null
  }

  /**
   * 按 slug 或标题找空间内活跃页面（[[双链]] 解析的兜底口径）。
   *
   * slugifyTitle 会小写并剥离标点，因此 [[FTS5 Contentless]] 能命中
   * slug='fts5-contentless'；但用户也可能直接写 [[fts5-contentless]]，
   * 或正文标题含 slug 无法表达的字符——两条口径都试，命中即返回。
   */
  findBySlugOrTitle(spaceId: string, slug: string, title: string): WikiPageRow | null {
    const row = this.raw
      .prepare(
        `SELECT * FROM wiki_page
         WHERE space_id = ? AND status != 'archived'
           AND (LOWER(slug) = LOWER(?) OR LOWER(title) = LOWER(?))
         ORDER BY (LOWER(slug) = LOWER(?)) DESC
         LIMIT 1`,
      )
      .get(spaceId, slug, title, slug) as WikiPageRow | undefined
    return row ?? null
  }

  /** 空间内全部活跃页面的 (id, slug, title) 轻量索引（批量解析双链用，避免 N 次查询）。 */
  listLinkIndex(spaceId: string): Array<{ id: string; slug: string; title: string }> {
    return this.raw
      .prepare(`SELECT id, slug, title FROM wiki_page WHERE space_id = ? AND status != 'archived'`)
      .all(spaceId) as Array<{ id: string; slug: string; title: string }>
  }

  /** 列出空间内页面（目录树/分页基础查询；Agent 侧输出必须再过预算裁剪层） */
  listBySpace(
    spaceId: string,
    opts?: {
      parentId?: string | null
      kind?: WikiPageKind
      includeArchived?: boolean
      limit?: number
    },
  ): WikiPageRow[] {
    const conditions: string[] = ['space_id = ?']
    const values: unknown[] = [spaceId]
    if (opts?.parentId !== undefined) {
      conditions.push('parent_id IS ?')
      values.push(opts.parentId)
    }
    if (opts?.kind != null) {
      conditions.push('kind = ?')
      values.push(opts.kind)
    }
    if (!opts?.includeArchived) {
      conditions.push(`status != 'archived'`)
    }
    const limit = opts?.limit != null && opts.limit > 0 ? Math.min(opts.limit, 2000) : 500
    return this.raw
      .prepare(
        `SELECT * FROM wiki_page WHERE ${conditions.join(' AND ')}
         ORDER BY sort_order ASC, created_at ASC LIMIT ${limit}`,
      )
      .all(...values) as WikiPageRow[]
  }

  /** 批量统计子节点数（目录树 hasChildren 标记用，一次查询取全层）。 */
  countChildrenByParent(spaceId: string, parentIds: readonly string[]): Map<string, number> {
    const result = new Map<string, number>()
    if (parentIds.length === 0) return result
    const placeholders = parentIds.map(() => '?').join(', ')
    const rows = this.raw
      .prepare(
        `SELECT parent_id, COUNT(*) AS count FROM wiki_page
         WHERE space_id = ? AND status != 'archived' AND parent_id IN (${placeholders})
         GROUP BY parent_id`,
      )
      .all(spaceId, ...parentIds) as Array<{ parent_id: string; count: number }>
    for (const row of rows) result.set(row.parent_id, row.count)
    return result
  }

  /** 活跃页面计数（配额闸门用） */
  countActive(spaceId: string): number {
    const row = this.raw
      .prepare(
        `SELECT COUNT(*) as count FROM wiki_page WHERE space_id = ? AND status != 'archived'`,
      )
      .get(spaceId) as { count: number }
    return row.count
  }

  /**
   * 把某父节点的全部直接子节点上移一级（文件夹删除专用）。
   * 包含已归档子节点（归档态的行同样需要正确的父指针）；
   * 纯结构元数据批量修正，不逐个推进 version / 写历史版本。
   * @returns 上移的子节点数量
   */
  reparentChildren(spaceId: string, fromParentId: string, toParentId: string | null): number {
    const info = this.raw
      .prepare(
        `UPDATE wiki_page SET parent_id = ?, updated_at = ? WHERE space_id = ? AND parent_id = ?`,
      )
      .run(toParentId, Date.now(), spaceId, fromParentId)
    return Number(info.changes)
  }

  /** 命中统计：刻意不刷新 updated_at（避免检索热度抬升时间衰减权重，同 memory） */
  bumpHit(id: string): void {
    this.raw
      .prepare(`UPDATE wiki_page SET hit_count = hit_count + 1, last_hit_at = ? WHERE id = ?`)
      .run(Date.now(), id)
  }

  /** 归档（软删除）：同事务移除 FTS 行，释放 slug 槽位（folder 无 FTS 行，跳过）。 */
  archive(id: string): void {
    const existing = this.findById<WikiPageRow>(id)
    const tx = this.raw.transaction(() => {
      this.raw
        .prepare(`UPDATE wiki_page SET status = 'archived', updated_at = ? WHERE id = ?`)
        .run(Date.now(), id)
      if (!WikiPageRepository.isFolder(existing)) this.maintainFts('delete', id)
    })
    tx()
  }

  /**
   * 物理删除（删除屏障终态，仅 WikiWriteService 可调用）。
   * 顺序：先清 FTS 索引（依赖主行 rowid），再删主行（folder 无 FTS 行，跳过）。
   */
  delete(id: string): void {
    const existing = this.findById<WikiPageRow>(id)
    const tx = this.raw.transaction(() => {
      if (!WikiPageRepository.isFolder(existing)) this.maintainFts('delete', id)
      this.raw.prepare(`DELETE FROM wiki_page WHERE id = ?`).run(id)
    })
    tx()
  }

  // ─── FTS 同步维护 ──────────────────────────────────────────────────────

  /**
   * 写路径事务内维护 wiki_fts。
   * 降级策略与 memory 一致：FTS 表不存在（旧库）时静默跳过；FTS 操作失败
   * 只 log 不上抛 —— 主行写入优先于索引一致性（索引可 backfill 重建）。
   */
  private maintainFts(
    op: 'upsert' | 'delete',
    pageId: string,
    fields?: { title: string; summary: string; body?: string },
  ): void {
    try {
      if (this.ftsAvailable == null) this.ftsAvailable = wikiFtsTableExists(this.raw)
      if (!this.ftsAvailable) return
      if (op === 'upsert' && fields != null) {
        upsertWikiFtsRow(this.raw, pageId, fields)
      } else if (op === 'delete') {
        deleteWikiFtsRow(this.raw, pageId)
      }
    } catch (err) {
      log.warn(
        `wiki_fts maintenance failed (${op} ${pageId}): ${err instanceof Error ? err.message : String(err)}`,
      )
    }
  }
}

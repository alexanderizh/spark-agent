/**
 * @module memory-search.repository
 *
 * Memory V2 检索层 Repository — FTS5 全文索引维护/查询 + sqlite-vec 向量表管理/KNN
 *
 * 设计要点：
 *   - memory_fts 是 contentless FTS5 表（content='' + contentless_delete=1），
 *     rowid 与 memory_entry 的隐式 rowid 对齐。
 *   - 写入/查询两侧统一走 segmentCjk / buildFtsMatchQuery（中文逐字预分词，
 *     两侧不一致会导致查不到，见 segment-cjk 模块注释）。
 *   - FTS 行维护由 MemoryRepository 在 insert/update/archive/delete 的同一事务内
 *     调用本模块的低层函数（upsertFtsRow / deleteFtsRow），保证索引一致性。
 *   - memory_vec 是 sqlite-vec 的 vec0 虚拟表，维度取决于用户配置的 embedding
 *     模型，因此不在 migration 里建表，而是运行时 ensureVecTable(dim) 惰性创建，
 *     维度记录在 app_settings(memory / vecDimension)。
 *   - better-sqlite3 是同步 API：本类除 loadVecExtension 外全部同步；
 *     事务内严禁 await（embed 结果必须在事务外算好再进来）。
 */

import { createLogger } from '@spark/shared'
import { BaseRepository } from './base.repository.js'
import type { SqliteDatabase } from './base.repository.js'
import type { SparkDatabase } from '../database.js'
import type { MemoryEntryRow } from './memory.repository.js'
import { segmentCjk, buildFtsMatchQuery } from '../segment-cjk.js'

const log = createLogger('storage:memory-search')

// ─── Types ────────────────────────────────────────────────────────────────

/** 检索允许的 scope 组合（一次会话的三层：user / project / agent） */
export interface MemoryScopeFilter {
  scope: 'user' | 'project' | 'agent'
  scopeRef: string | null
}

export interface FtsSearchOptions {
  scopes?: MemoryScopeFilter[]
  type?: string
  limit?: number
}

export interface FtsSearchHit {
  entry: MemoryEntryRow
  /** bm25 原始分（越小越相关） */
  bm25: number
}

export interface VecSearchHit {
  entry: MemoryEntryRow
  /** 向量距离（越小越相关） */
  distance: number
}

// ─── 低层 FTS 维护函数（供 MemoryRepository 在同一事务内调用） ─────────────

/**
 * 写入/更新一条 FTS 行（先删后插，contentless_delete=1 支持按 rowid 直接删）。
 *
 * 必须在调用方事务内执行；本函数不吞异常，由调用方决定降级策略。
 */
export function upsertFtsRow(
  raw: SqliteDatabase,
  entryId: string,
  fields: { name: string; description: string; body?: string },
): void {
  const rowidRow = raw
    .prepare('SELECT rowid FROM memory_entry WHERE id = ?')
    .get(entryId) as { rowid: number | bigint } | undefined
  if (rowidRow == null) return
  raw.prepare('DELETE FROM memory_fts WHERE rowid = ?').run(rowidRow.rowid)
  raw
    .prepare('INSERT INTO memory_fts(rowid, name, description, body) VALUES (?, ?, ?, ?)')
    .run(
      rowidRow.rowid,
      segmentCjk(fields.name),
      segmentCjk(fields.description),
      segmentCjk(fields.body ?? ''),
    )
}

/**
 * 删除一条 FTS 行（归档/失效/物理删除时调用）。
 * rowid 需在 memory_entry 行仍存在时预先取出，故接受 entryId 或显式 rowid。
 */
export function deleteFtsRow(raw: SqliteDatabase, entryId: string): void {
  const rowidRow = raw
    .prepare('SELECT rowid FROM memory_entry WHERE id = ?')
    .get(entryId) as { rowid: number | bigint } | undefined
  if (rowidRow == null) return
  raw.prepare('DELETE FROM memory_fts WHERE rowid = ?').run(rowidRow.rowid)
}

/** memory_fts 表是否存在（migration 未跑到时降级用） */
export function ftsTableExists(raw: SqliteDatabase): boolean {
  const row = raw
    .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'memory_fts'`)
    .get()
  return row != null
}

// ─── Repository ───────────────────────────────────────────────────────────

const FTS_BACKFILL_FLAG_CATEGORY = 'memory'
const FTS_BACKFILL_FLAG_KEY = 'ftsBackfillDone'
const VEC_DIMENSION_CATEGORY = 'memory'
const VEC_DIMENSION_KEY = 'vecDimension'

export class MemorySearchRepository extends BaseRepository {
  private vecLoaded = false
  private vecLoadFailed = false
  /** 最近一次 sqlite-vec 加载失败的真实错误（成功后清空）。供上层把根因透到 UI。 */
  private lastVecLoadError: string | null = null

  constructor(db: SparkDatabase) {
    super(db, 'memory_fts')
  }

  /** 取回最近一次 sqlite-vec 加载失败的真实错误（无则 null）。 */
  getLastVecLoadError(): string | null {
    return this.lastVecLoadError
  }

  // ─── FTS 查询 ─────────────────────────────────────────────────────────

  /**
   * BM25 全文检索。默认只召回未归档且仍有效（invalid_at IS NULL）的条目。
   *
   * @returns 命中列表（bm25 升序 = 相关度降序）；查询为空时返回 []
   */
  searchBm25(query: string, opts?: FtsSearchOptions): FtsSearchHit[] {
    const match = buildFtsMatchQuery(query)
    if (match == null) return []

    const conditions: string[] = ['m.archived = 0', 'm.invalid_at IS NULL']
    const values: unknown[] = [match]

    if (opts?.scopes != null && opts.scopes.length > 0) {
      const scopeClauses = opts.scopes.map(() => '(m.scope = ? AND m.scope_ref IS ?)')
      conditions.push(`(${scopeClauses.join(' OR ')})`)
      for (const s of opts.scopes) {
        values.push(s.scope, s.scopeRef)
      }
    }
    if (opts?.type != null) {
      conditions.push('m.type = ?')
      values.push(opts.type)
    }

    const limit = opts?.limit ?? 20
    values.push(limit)

    const rows = this.raw
      .prepare(
        `SELECT m.*, bm25(memory_fts) AS __bm25
         FROM memory_fts
         JOIN memory_entry m ON m.rowid = memory_fts.rowid
         WHERE memory_fts MATCH ? AND ${conditions.join(' AND ')}
         ORDER BY __bm25 ASC
         LIMIT ?`,
      )
      .all(...values) as Array<MemoryEntryRow & { __bm25: number }>

    return rows.map((r) => {
      const { __bm25, ...entry } = r
      return { entry: entry as MemoryEntryRow, bm25: __bm25 }
    })
  }

  /**
   * 存量条目 FTS 回填（幂等）。
   *
   * migration 只建表；分词必须走 JS 侧 segmentCjk，因此回填在代码侧执行，
   * 用 app_settings 标记完成状态。回填 name + description（body 在 markdown
   * 文件里，此处不读文件；后续任何一次写入会带 body 重建该行）。
   *
   * @returns 本次回填的行数（已回填过则为 0）
   */
  backfillFtsIfNeeded(): number {
    const flag = this.raw
      .prepare('SELECT value FROM app_settings WHERE category = ? AND key = ?')
      .get(FTS_BACKFILL_FLAG_CATEGORY, FTS_BACKFILL_FLAG_KEY) as { value: string } | undefined
    if (flag != null && flag.value === 'true') return 0

    const entries = this.raw
      .prepare('SELECT id, name, description FROM memory_entry WHERE archived = 0')
      .all() as Array<{ id: string; name: string; description: string }>

    const tx = this.raw.transaction(() => {
      for (const e of entries) {
        upsertFtsRow(this.raw, e.id, { name: e.name, description: e.description })
      }
      this.raw
        .prepare(
          `INSERT INTO app_settings (category, key, value, updated_at) VALUES (?, ?, ?, ?)
           ON CONFLICT(category, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
        )
        .run(FTS_BACKFILL_FLAG_CATEGORY, FTS_BACKFILL_FLAG_KEY, 'true', new Date().toISOString())
    })
    tx()

    if (entries.length > 0) log.info(`FTS backfill complete: ${entries.length} entries indexed`)
    return entries.length
  }

  // ─── sqlite-vec ───────────────────────────────────────────────────────

  /**
   * 加载 sqlite-vec 扩展（进程内幂等）。
   *
   * 扩展是纯 sqlite 扩展、与 better-sqlite3 ABI 无关，Node / Electron 双环境
   * 均已实测可加载。失败时返回 false（全链路降级 FTS-only），不抛异常。
   *
   * 打包形态注意：better-sqlite3 的 loadExtension 走 C 层 sqlite3_load_extension
   * → 直接 dlopen，不经 Node fs / Electron asar 钩子。因此 sqlite-vec 的 vec0
   * 二进制必须从 app.asar.unpacked 加载；require.resolve 在 unpacked 标记存在
   * 时通常能解析到真实路径，但不同 sqlite-vec / better-sqlite3 版本组合下不可
   * 靠（曾在打包后命中 app.asar 归档内路径，errno=20 ENOTDIR）。这里统一兜底：
   * 把解析出的路径里独立出现的 app.asar 段改写为 app.asar.unpacked（已是 unpacked
   * 路径或 dev 路径则原样不动）。
   */
  async loadVecExtension(): Promise<boolean> {
    if (this.vecLoaded) return true
    if (this.vecLoadFailed) return false
    try {
      const sqliteVec = await import('sqlite-vec')
      // \b 边界 + 否定前瞻确保只替换独立的 app.asar 段，不误伤 app.asar.unpacked
      const vecPath = (sqliteVec.getLoadablePath() as string).replace(
        /\bapp\.asar\b(?!\.unpacked)/,
        'app.asar.unpacked',
      )
      this.raw.loadExtension(vecPath)
      this.vecLoaded = true
      this.lastVecLoadError = null
      log.info(`sqlite-vec extension loaded: ${vecPath}`)
      return true
    } catch (err) {
      this.vecLoadFailed = true
      const msg = err instanceof Error ? err.message : String(err)
      this.lastVecLoadError = msg
      log.warn(`sqlite-vec load failed, vector search disabled: ${msg}`)
      return false
    }
  }

  /** memory_vec 表是否已存在 */
  vecTableExists(): boolean {
    const row = this.raw
      .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'memory_vec'`)
      .get()
    return row != null
  }

  /** 读取 settings 中记录的向量维度（未确定时 null） */
  getVecDimension(): number | null {
    const row = this.raw
      .prepare('SELECT value FROM app_settings WHERE category = ? AND key = ?')
      .get(VEC_DIMENSION_CATEGORY, VEC_DIMENSION_KEY) as { value: string } | undefined
    if (row == null) return null
    const dim = Number(JSON.parse(row.value))
    return Number.isFinite(dim) && dim > 0 ? dim : null
  }

  /**
   * 确保 memory_vec 表存在且维度匹配。
   *
   * 维度首次确定时写入 settings；维度变化（更换 embedding 模型）时
   * 重建表（rebuildVecTable），旧向量丢弃、由懒回填队列重新生成。
   *
   * 前置条件：loadVecExtension() 已成功。
   */
  ensureVecTable(dimension: number): void {
    const recorded = this.getVecDimension()
    if (this.vecTableExists() && recorded === dimension) return
    if (this.vecTableExists() && recorded !== dimension) {
      log.warn(`vec dimension changed ${recorded} -> ${dimension}, rebuilding memory_vec`)
      this.rebuildVecTable(dimension)
      return
    }
    this.createVecTable(dimension)
  }

  /**
   * 重建 memory_vec 表（维度变化 / 数据修复入口）。
   * 旧向量全部丢弃，调用方应随后触发懒回填。
   */
  rebuildVecTable(dimension: number): void {
    const tx = this.raw.transaction(() => {
      this.raw.exec('DROP TABLE IF EXISTS memory_vec')
    })
    tx()
    this.createVecTable(dimension)
    log.info(`memory_vec rebuilt with dimension ${dimension}`)
  }

  private createVecTable(dimension: number): void {
    this.raw.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS memory_vec USING vec0(embedding float[${Math.floor(dimension)}])`)
    this.raw
      .prepare(
        `INSERT INTO app_settings (category, key, value, updated_at) VALUES (?, ?, ?, ?)
         ON CONFLICT(category, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      )
      .run(VEC_DIMENSION_CATEGORY, VEC_DIMENSION_KEY, JSON.stringify(Math.floor(dimension)), new Date().toISOString())
  }

  /**
   * 写入/更新一条向量（rowid 对齐 memory_entry rowid）。
   * 向量必须在事务外算好（embed 是异步 IO，事务内禁 await）。
   */
  upsertVec(entryId: string, vector: number[]): void {
    const rowidRow = this.raw
      .prepare('SELECT rowid FROM memory_entry WHERE id = ?')
      .get(entryId) as { rowid: number | bigint } | undefined
    if (rowidRow == null) return
    const rowid = BigInt(rowidRow.rowid)
    const buf = Buffer.from(new Float32Array(vector).buffer)
    const tx = this.raw.transaction(() => {
      this.raw.prepare('DELETE FROM memory_vec WHERE rowid = ?').run(rowid)
      this.raw.prepare('INSERT INTO memory_vec(rowid, embedding) VALUES (?, ?)').run(rowid, buf)
    })
    tx()
  }

  /** 删除一条向量（归档/失效/删除时调用；表不存在时静默跳过） */
  deleteVec(entryId: string): void {
    if (!this.vecTableExists()) return
    const rowidRow = this.raw
      .prepare('SELECT rowid FROM memory_entry WHERE id = ?')
      .get(entryId) as { rowid: number | bigint } | undefined
    if (rowidRow == null) return
    this.raw.prepare('DELETE FROM memory_vec WHERE rowid = ?').run(BigInt(rowidRow.rowid))
  }

  /**
   * KNN 向量检索 + 结构化过滤。
   *
   * vec0 的 KNN 查询（embedding MATCH ? AND k = ?）不能直接 join 过滤，
   * 因此先取 topN 候选，再按 rowid 回表过滤 scope/type/archived/invalid。
   */
  searchKnn(vector: number[], opts?: FtsSearchOptions): VecSearchHit[] {
    if (!this.vecTableExists()) return []
    const k = Math.max((opts?.limit ?? 20) * 3, 20) // 过滤会损耗候选，多取一些
    const buf = Buffer.from(new Float32Array(vector).buffer)
    const knnRows = this.raw
      .prepare('SELECT rowid, distance FROM memory_vec WHERE embedding MATCH ? AND k = ?')
      .all(buf, k) as Array<{ rowid: number | bigint; distance: number }>
    if (knnRows.length === 0) return []

    const distanceByRowid = new Map<string, number>()
    for (const r of knnRows) distanceByRowid.set(String(r.rowid), r.distance)

    const placeholders = knnRows.map(() => '?').join(', ')
    const conditions: string[] = ['m.archived = 0', 'm.invalid_at IS NULL']
    const values: unknown[] = knnRows.map((r) => r.rowid)

    if (opts?.scopes != null && opts.scopes.length > 0) {
      const scopeClauses = opts.scopes.map(() => '(m.scope = ? AND m.scope_ref IS ?)')
      conditions.push(`(${scopeClauses.join(' OR ')})`)
      for (const s of opts.scopes) {
        values.push(s.scope, s.scopeRef)
      }
    }
    if (opts?.type != null) {
      conditions.push('m.type = ?')
      values.push(opts.type)
    }

    const rows = this.raw
      .prepare(
        `SELECT m.*, m.rowid AS __rowid FROM memory_entry m
         WHERE m.rowid IN (${placeholders}) AND ${conditions.join(' AND ')}`,
      )
      .all(...values) as Array<MemoryEntryRow & { __rowid: number | bigint }>

    const hits: VecSearchHit[] = rows.map((r) => {
      const { __rowid, ...entry } = r
      return { entry: entry as MemoryEntryRow, distance: distanceByRowid.get(String(__rowid)) ?? Number.MAX_VALUE }
    })
    hits.sort((a, b) => a.distance - b.distance)
    return hits.slice(0, opts?.limit ?? 20)
  }

  /**
   * 列出尚未向量化的有效条目（懒回填队列消费）。
   * memory_vec 不存在时返回全部有效条目。
   */
  listEntriesMissingVec(limit: number): MemoryEntryRow[] {
    if (!this.vecTableExists()) {
      return this.raw
        .prepare('SELECT * FROM memory_entry WHERE archived = 0 AND invalid_at IS NULL LIMIT ?')
        .all(limit) as MemoryEntryRow[]
    }
    return this.raw
      .prepare(
        `SELECT m.* FROM memory_entry m
         LEFT JOIN memory_vec v ON v.rowid = m.rowid
         WHERE m.archived = 0 AND m.invalid_at IS NULL AND v.rowid IS NULL
         LIMIT ?`,
      )
      .all(limit) as MemoryEntryRow[]
  }
}

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
import { EMBEDDING_PREPROCESSOR_VERSION, hashEmbeddingInput } from './memory-index-hash.js'

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
  const rowidRow = raw.prepare('SELECT rowid FROM memory_entry WHERE id = ?').get(entryId) as
    | { rowid: number | bigint }
    | undefined
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
  const rowidRow = raw.prepare('SELECT rowid FROM memory_entry WHERE id = ?').get(entryId) as
    | { rowid: number | bigint }
    | undefined
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
/** S1B.2：向量索引配置代际（JSON：dimension/provider/model/generation），取代仅记录维度 */
const VEC_CONFIG_CATEGORY = 'memory'
const VEC_CONFIG_KEY = 'vecConfig'

/**
 * 向量索引配置（S1B.2 索引新鲜度）。
 * generation 单调递增：dimension / provider / model 任一变化即重建表并 +1，
 * memory_index_meta 里的旧代际向量整体失效（同维度模型切换不混用旧向量）。
 */
export interface VecIndexConfig {
  dimension: number
  provider: string | null
  model: string | null
  generation: number
}

/** ensureVecTable / rebuildVecTable 的索引来源描述（当前 embedding 配置） */
export interface VecIndexSource {
  provider?: string | null
  model?: string | null
}

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

  /** 读取 settings 中记录的向量维度（未确定时 null）。S1B.2 起仅供旧配置回退与诊断。 */
  getVecDimension(): number | null {
    return this.getVecConfig()?.dimension ?? null
  }

  /**
   * 读取向量索引配置（S1B.2）。
   *
   * 优先读 `app_settings(memory/vecConfig)` JSON；旧库无此键时回退读
   * `vecDimension` 构造 {provider:null, model:null, generation:1}；
   * 两者皆无（从未建过向量索引）返回 null。
   */
  getVecConfig(): VecIndexConfig | null {
    const row = this.raw
      .prepare('SELECT value FROM app_settings WHERE category = ? AND key = ?')
      .get(VEC_CONFIG_CATEGORY, VEC_CONFIG_KEY) as { value: string } | undefined
    if (row != null) {
      try {
        const parsed = JSON.parse(row.value) as Partial<VecIndexConfig>
        if (
          typeof parsed.dimension === 'number' &&
          Number.isFinite(parsed.dimension) &&
          parsed.dimension > 0 &&
          typeof parsed.generation === 'number'
        ) {
          return {
            dimension: Math.floor(parsed.dimension),
            provider: typeof parsed.provider === 'string' ? parsed.provider : null,
            model: typeof parsed.model === 'string' ? parsed.model : null,
            generation: parsed.generation,
          }
        }
      } catch {
        /* 损坏的 JSON 走回退 */
      }
    }
    // 旧配置回退：只有 vecDimension（S1B.2 之前的库）
    const legacy = this.raw
      .prepare('SELECT value FROM app_settings WHERE category = ? AND key = ?')
      .get(VEC_DIMENSION_CATEGORY, VEC_DIMENSION_KEY) as { value: string } | undefined
    if (legacy == null) return null
    const dim = Number(JSON.parse(legacy.value))
    return Number.isFinite(dim) && dim > 0
      ? { dimension: Math.floor(dim), provider: null, model: null, generation: 1 }
      : null
  }

  /**
   * 确保 memory_vec 表存在且配置匹配（S1B.2：比代际+维度+来源，不再只比维度）。
   *
   * 首次建表写入配置（generation=1）；dimension / provider / model 任一变化
   * （含同维度模型切换）→ rebuildVecTable 重建并递增 generation，旧向量整体
   * 失效、由懒回填队列按新代际重新生成。
   *
   * source 缺省（未传 provider/model）时只比维度——与旧调用方兼容；
   * 生产路径（EmbeddingService）总是传当前配置。
   *
   * 前置条件：loadVecExtension() 已成功。
   */
  ensureVecTable(dimension: number, source?: VecIndexSource): void {
    const recorded = this.getVecConfig()
    const tableExists = this.vecTableExists()
    if (!tableExists) {
      this.createVecTable(dimension, source, 1)
      return
    }
    if (recorded == null) {
      // 表存在但配置缺失（settings 被清）：重建并建立代际基线
      log.warn('memory_vec exists but config missing, rebuilding to establish generation baseline')
      this.rebuildVecTable(dimension, source)
      return
    }
    const sourceChanged =
      (source?.provider ?? null) !== recorded.provider || (source?.model ?? null) !== recorded.model
    if (recorded.dimension === dimension && !sourceChanged) return
    log.warn(
      `vec config changed (dim ${recorded.dimension}->${dimension}, ` +
        `provider ${recorded.provider}->${source?.provider ?? null}, ` +
        `model ${recorded.model}->${source?.model ?? null}), rebuilding memory_vec`,
    )
    this.rebuildVecTable(dimension, source)
  }

  /**
   * 重建 memory_vec 表（配置变化 / 人工数据修复入口）。
   *
   * 旧向量全部丢弃，generation 在当前配置基础上 +1（无当前配置则从 1 起），
   * 并清空 memory_index_meta 的全部 vec 行（kind='fts' 的 FTS 摘要不受影响）。
   * 调用方应随后触发懒回填。
   */
  rebuildVecTable(dimension: number, source?: VecIndexSource): void {
    const current = this.getVecConfig()
    const nextGeneration = (current?.generation ?? 0) + 1
    const tx = this.raw.transaction(() => {
      this.raw.exec('DROP TABLE IF EXISTS memory_vec')
      this.raw.prepare(`DELETE FROM memory_index_meta WHERE index_kind = 'vec'`).run()
    })
    tx()
    this.createVecTable(dimension, source, nextGeneration)
    log.info(
      `memory_vec rebuilt with dimension ${dimension}, generation ${nextGeneration}` +
        ` (provider=${source?.provider ?? null}, model=${source?.model ?? null})`,
    )
  }

  private createVecTable(
    dimension: number,
    source: VecIndexSource | undefined,
    generation: number,
  ): void {
    this.raw.exec(
      `CREATE VIRTUAL TABLE IF NOT EXISTS memory_vec USING vec0(embedding float[${Math.floor(dimension)}])`,
    )
    const config: VecIndexConfig = {
      dimension: Math.floor(dimension),
      provider: source?.provider ?? null,
      model: source?.model ?? null,
      generation,
    }
    this.raw
      .prepare(
        `INSERT INTO app_settings (category, key, value, updated_at) VALUES (?, ?, ?, ?)
         ON CONFLICT(category, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      )
      .run(VEC_CONFIG_CATEGORY, VEC_CONFIG_KEY, JSON.stringify(config), new Date().toISOString())
    // 兼容保留：旧维度键同步刷新（旧版本 CLI 读这个键判断表是否匹配）
    this.raw
      .prepare(
        `INSERT INTO app_settings (category, key, value, updated_at) VALUES (?, ?, ?, ?)
         ON CONFLICT(category, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      )
      .run(
        VEC_DIMENSION_CATEGORY,
        VEC_DIMENSION_KEY,
        JSON.stringify(Math.floor(dimension)),
        new Date().toISOString(),
      )
  }

  /**
   * 写入/更新一条向量（rowid 对齐 memory_entry rowid）。
   * 向量必须在事务外算好（embed 是异步 IO，事务内禁 await）。
   *
   * 【S1B.2 晚到防护（E6）】传入 inputHash（embed 请求时的输入摘要）时，
   * 事务内先重读条目当前文本算哈希比对：失配（回填期间文本被更新）→
   * 拒绝写入返回 false，晚到旧文本向量不占位，条目留在回填队列等下轮重算。
   * 成功写入时同步 upsert memory_index_meta（kind=vec）记录输入摘要与
   * 当前配置代际。inputHash 缺省时不做防护也不写 meta（旧调用兼容）。
   */
  upsertVec(entryId: string, vector: number[], inputHash?: string): boolean {
    const entryRow = this.raw
      .prepare('SELECT rowid, name, description FROM memory_entry WHERE id = ?')
      .get(entryId) as { rowid: number | bigint; name: string; description: string } | undefined
    if (entryRow == null) return false
    if (inputHash != null) {
      const currentHash = hashEmbeddingInput(entryRow.name, entryRow.description)
      if (currentHash !== inputHash) {
        log.info(
          `upsertVec rejected (stale input): id=${entryId} — embedding 请求时的文本已被更新，` +
            `丢弃晚到向量，条目留在回填队列`,
        )
        return false
      }
    }
    const rowid = BigInt(entryRow.rowid)
    const buf = Buffer.from(new Float32Array(vector).buffer)
    const config = this.getVecConfig()
    const tx = this.raw.transaction(() => {
      this.raw.prepare('DELETE FROM memory_vec WHERE rowid = ?').run(rowid)
      this.raw.prepare('INSERT INTO memory_vec(rowid, embedding) VALUES (?, ?)').run(rowid, buf)
      if (inputHash != null) {
        this.raw
          .prepare(
            `INSERT INTO memory_index_meta
               (memory_id, index_kind, input_hash, provider, model, model_revision,
                preprocessor_version, config_generation, built_at)
             VALUES (?, 'vec', ?, ?, ?, NULL, ?, ?, ?)
             ON CONFLICT(memory_id, index_kind) DO UPDATE SET
               input_hash = excluded.input_hash, provider = excluded.provider,
               model = excluded.model, model_revision = excluded.model_revision,
               preprocessor_version = excluded.preprocessor_version,
               config_generation = excluded.config_generation, built_at = excluded.built_at`,
          )
          .run(
            entryId,
            inputHash,
            config?.provider ?? null,
            config?.model ?? null,
            EMBEDDING_PREPROCESSOR_VERSION,
            config?.generation ?? 0,
            Date.now(),
          )
      }
    })
    tx()
    return true
  }

  /** 删除一条向量及其索引元数据（归档/失效/删除时调用；表不存在时静默跳过） */
  deleteVec(entryId: string): void {
    if (!this.vecTableExists()) return
    const rowidRow = this.raw
      .prepare('SELECT rowid FROM memory_entry WHERE id = ?')
      .get(entryId) as { rowid: number | bigint } | undefined
    if (rowidRow == null) return
    const tx = this.raw.transaction(() => {
      this.raw.prepare('DELETE FROM memory_vec WHERE rowid = ?').run(BigInt(rowidRow.rowid))
      this.raw
        .prepare(`DELETE FROM memory_index_meta WHERE memory_id = ? AND index_kind = 'vec'`)
        .run(entryId)
    })
    tx()
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
      return {
        entry: entry as MemoryEntryRow,
        distance: distanceByRowid.get(String(__rowid)) ?? Number.MAX_VALUE,
      }
    })
    hits.sort((a, b) => a.distance - b.distance)
    return hits.slice(0, opts?.limit ?? 20)
  }

  /**
   * 列出向量索引已过期/缺失的有效条目（懒回填队列消费，S1B.2 新鲜度判定）。
   *
   * 判定依据 memory_index_meta（kind=vec），一条记忆"缺向量"当且仅当：
   *   1. 无 meta 行（从未建过 / 文本更新后被清理 / 重建后整体失效）；或
   *   2. meta.input_hash ≠ 当前条目文本哈希（文本已变，旧向量语义过期，E5）；或
   *   3. meta.config_generation ≠ 当前配置代际（模型切换/重建后旧代际向量，E9）。
   * 哈希比对在 JS 侧完成（SQLite 无法算 SHA-256）；有效条目量级为配额上限
   * （数百），全量取出再过滤无性能问题。
   * memory_vec 表不存在时返回全部有效条目（与旧行为一致）。
   */
  listEntriesMissingVec(limit: number): MemoryEntryRow[] {
    if (!this.vecTableExists()) {
      return this.raw
        .prepare('SELECT * FROM memory_entry WHERE archived = 0 AND invalid_at IS NULL LIMIT ?')
        .all(limit) as MemoryEntryRow[]
    }
    const generation = this.getVecConfig()?.generation ?? 1
    const rows = this.raw
      .prepare(
        `SELECT m.*, meta.input_hash AS meta_input_hash, meta.config_generation AS meta_generation
         FROM memory_entry m
         LEFT JOIN memory_index_meta meta
           ON meta.memory_id = m.id AND meta.index_kind = 'vec'
         WHERE m.archived = 0 AND m.invalid_at IS NULL`,
      )
      .all() as Array<
      MemoryEntryRow & { meta_input_hash: string | null; meta_generation: number | null }
    >
    return rows
      .filter((r) => {
        if (r.meta_input_hash == null) return true
        if (r.meta_generation !== generation) return true
        return r.meta_input_hash !== hashEmbeddingInput(r.name, r.description)
      })
      .slice(0, limit)
  }
}

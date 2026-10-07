/**
 * @module memory.repository
 *
 * Agent Memory Repository — SQLite CRUD for long-term memory entries.
 *
 * 每条记忆由 markdown 文件（人类可读）+ SQLite 索引行组成。
 * 本 Repository 仅管理 SQLite 侧；文件操作由 MemoryStoreService 负责。
 *
 * 三层记忆模型：
 *   - user    : scope_ref = NULL，跨项目复用
 *   - project : scope_ref = workspaceId
 *   - agent   : scope_ref = agentId
 */

import { createHash } from 'node:crypto'
import { createLogger } from '@spark/shared'
import { BaseRepository } from './base.repository.js'
import type { SparkDatabase } from '../database.js'
import { upsertFtsRow, deleteFtsRow, ftsTableExists } from './memory-search.repository.js'
import { FTS_PREPROCESSOR_VERSION, hashFtsInput } from './memory-index-hash.js'

const log = createLogger('storage:memory')

/**
 * update 时保留被覆盖版本到 memory_revision（S2.2）。
 * oldBody 由调用方在写新正文快照之前读出（文件会被原子替换，事务内已读不到）。
 */
export interface UpdateRevisionCapture {
  oldBody: string
  kind: 'update' | 'merge' | 'supersede' | 'retract'
  successorId?: string | null
  note?: string | null
}

export interface MemoryEntryRow {
  id: string
  scope: 'user' | 'project' | 'agent'
  scope_ref: string | null
  type: 'user' | 'feedback' | 'project' | 'reference'
  name: string
  description: string
  file_path: string
  confidence: number
  hit_count: number
  last_hit_at: number | null
  source_session_id: string | null
  archived: number
  created_at: number
  updated_at: number
  /** 事实生效时间（bi-temporal，默认 = created_at）。V2 之前的行由 migration 回填。 */
  valid_from: number | null
  /** 事实失效时间；NULL = 仍有效。失效不删文件（M2 演化机制写入）。 */
  invalid_at: number | null
  /**
   * 有效期结束（S2.6 / N5，半开区间 [valid_from, valid_until)）。NULL = 长期。
   * 到期 ≠ 失效：条目保留、历史可查（N10 标注），只是不再作为当前事实注入。
   */
  valid_until: number | null
  /**
   * valid_until 的精度/时区表达（S2.6，migration 110）：JSON
   * {"precision":"instant"} 或 {"precision":"date","timezone":"Asia/Shanghai"}。
   * NULL = instant（存量行语义）。date 精度写入侧已换算为本地日结束（exclusive）
   * 的 UTC 瞬时，meta 保留原始表达供展示层如实说明。
   */
  valid_until_meta: string | null
  /** 被哪条记忆取代（memory_entry.id） */
  superseded_by: string | null
  /**
   * 单调递增版本号（S1B.1，migration 104）。每次有效写入 +1，存量回填 1。
   * CAS 条件提交依据：UPDATE ... WHERE id=? AND version=expected。
   */
  version: number
  /**
   * 当前权威正文 SHA-256 hex（S1B.1）。NULL = 尚未建立守卫（存量行，
   * 首次写入时补齐）。读取托管正文时校验，失配拒绝采信（方案 B 守卫）。
   */
  content_hash: string | null
  /**
   * 真实事件引用（S2.1，migration 107）：agent_events.id，承载来源对话的事件。
   * 由系统侧从事件流取得，不进抽取 prompt —— LLM candidate 无来源注入点。
   * NULL = 旧数据/无法确定（已知部分不补造）。
   */
  source_event_id: string | null
  /** 来源 turn 引用（agent_events.turn_id）。同 turn 重试据此识别（N2 幂等基础）。 */
  source_turn_id: string | null
  /**
   * 内容作者的真实装配角色（S2.1），枚举 'host_agent' | 'team_member' |
   * 'consolidation' | 'manual_user' | 'sync_import'。与 LLM 自报无关。
   */
  author_role: string | null
  /** 真实装配身份 id（host agentId / member.id），与 LLM 自报无关。 */
  author_agent_id: string | null
  /** 产生路径枚举（S2.1）：'turn_extraction' | 'consolidation' | 'manual' | 'sync_import'。 */
  extraction_kind: string | null
  /** 实际调用的提取模型 id（settings / fallback 真实值，S2.1）。 */
  extraction_model: string | null
  /**
   * 证据状态（S2.1）：'available' | 'unavailable'。来源会话删除后置
   * 'unavailable' 并保留 source_session_id 引用（不伪造"无来源"）。
   */
  evidence_status: string
}

/** insert 的入参：时间戳/bi-temporal/版本列由 repository 自动填充 */
export type MemoryEntryInsert = Omit<
  MemoryEntryRow,
  | 'created_at'
  | 'updated_at'
  | 'valid_from'
  | 'invalid_at'
  | 'valid_until'
  | 'valid_until_meta'
  | 'superseded_by'
  | 'version'
  | 'content_hash'
  | 'source_event_id'
  | 'source_turn_id'
  | 'author_role'
  | 'author_agent_id'
  | 'extraction_kind'
  | 'extraction_model'
  | 'evidence_status'
> &
  Partial<
    Pick<
      MemoryEntryRow,
      | 'valid_from'
      | 'invalid_at'
      | 'valid_until'
      | 'valid_until_meta'
      | 'superseded_by'
      | 'source_event_id'
      | 'source_turn_id'
      | 'author_role'
      | 'author_agent_id'
      | 'extraction_kind'
      | 'extraction_model'
      | 'evidence_status'
    >
  >

/**
 * 到期未过条件（S2.6 / N5）：valid_until 为空 = 长期有效；否则须 >= 当前时刻。
 * 半开区间 [valid_from, valid_until) —— 到期即不再作为当前事实返回。
 */
const NOT_EXPIRED_SQL = '(valid_until IS NULL OR valid_until >= ?)'

export class MemoryRepository extends BaseRepository {
  /** memory_fts 表存在性缓存（migration 未跑到的旧库降级为不维护 FTS） */
  private ftsAvailable: boolean | null = null

  constructor(db: SparkDatabase) {
    super(db, 'memory_entry')
  }

  /**
   * Insert a new memory entry.
   * Timestamps (created_at, updated_at) are auto-set to now; valid_from defaults to now.
   *
   * @param body markdown 正文（仅用于 FTS 索引；正文本体在文件系统）。
   *             与 memory_entry 写入同一事务维护 memory_fts。
   */
  insert(row: MemoryEntryInsert, body?: string): MemoryEntryRow {
    const now = Date.now()
    const tx = this.raw.transaction(() => {
      this.raw
        .prepare(
          `INSERT INTO memory_entry
           (id, scope, scope_ref, type, name, description, file_path,
            confidence, hit_count, last_hit_at, source_session_id,
            archived, created_at, updated_at, valid_from, invalid_at, valid_until, valid_until_meta,
            superseded_by, version, content_hash,
            source_event_id, source_turn_id, author_role, author_agent_id,
            extraction_kind, extraction_model, evidence_status)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          row.id,
          row.scope,
          row.scope_ref,
          row.type,
          row.name,
          row.description,
          row.file_path,
          row.confidence,
          row.hit_count,
          row.last_hit_at,
          row.source_session_id,
          row.archived,
          now,
          now,
          row.valid_from ?? now,
          row.invalid_at ?? null,
          row.valid_until ?? null,
          row.valid_until_meta ?? null,
          row.superseded_by ?? null,
          body != null ? hashBodyForGuard(body) : null,
          row.source_event_id ?? null,
          row.source_turn_id ?? null,
          row.author_role ?? null,
          row.author_agent_id ?? null,
          row.extraction_kind ?? null,
          row.extraction_model ?? null,
          row.evidence_status ?? 'available',
        )
      this.maintainFts('upsert', row.id, {
        name: row.name,
        description: row.description,
        ...(body != null ? { body } : {}),
      })
    })
    tx()
    return this.findById<MemoryEntryRow>(row.id)!
  }

  /**
   * Update specific fields of a memory entry.
   * Always refreshes updated_at.
   */
  update(
    id: string,
    patch: Partial<Omit<MemoryEntryRow, 'id' | 'created_at'>>,
    body?: string,
    revision?: UpdateRevisionCapture,
  ): MemoryEntryRow {
    const existing = this.findById<MemoryEntryRow>(id)
    if (existing == null) throw new Error(`Memory entry not found: ${id}`)

    const fields: string[] = []
    const values: unknown[] = []

    const updatable = [
      'scope',
      'scope_ref',
      'type',
      'name',
      'description',
      'file_path',
      'confidence',
      'hit_count',
      'last_hit_at',
      'source_session_id',
      'archived',
      'valid_from',
      'invalid_at',
      'valid_until',
      'valid_until_meta',
      'superseded_by',
      // 来源绑定字段（source_event_id/author_role 等）原则不可变，不进手工
      // update 白名单；evidence_status 例外 —— 来源会话删除/恢复需要改写。
      'evidence_status',
    ] as const

    for (const key of updatable) {
      if (key in patch) {
        fields.push(`${key} = ?`)
        values.push((patch as Record<string, unknown>)[key])
      }
    }

    if (fields.length === 0) return existing

    // 【S1B.1】每次有效写入版本 +1；带 body 时同步刷新正文守卫哈希
    fields.push('version = version + 1')
    if (body != null) {
      fields.push('content_hash = ?')
      values.push(hashBodyForGuard(body))
    }
    fields.push('updated_at = ?')
    values.push(Date.now())
    values.push(id)

    const next = { ...existing, ...patch }
    // 归档或失效 → 从 FTS 移除；否则文本字段有变化（或带了 body）时重建 FTS 行
    const becomesInactive = next.archived === 1 || next.invalid_at != null
    const textChanged =
      body != null ||
      ('name' in patch && patch.name !== existing.name) ||
      ('description' in patch && patch.description !== existing.description)

    const tx = this.raw.transaction(() => {
      // 【S2.2】同事务保留被覆盖版本（调用方在写新快照前已读出旧正文）。
      // INSERT OR IGNORE 幂等：同版本重复保留（重试路径）静默跳过。
      if (revision != null) {
        this.raw
          .prepare(
            `INSERT OR IGNORE INTO memory_revision
               (memory_id, version, type, name, description, body, content_hash, confidence,
                author_role, source_event_id, valid_from, superseded_at, supersede_kind,
                successor_id, note)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            existing.id,
            existing.version,
            existing.type,
            existing.name,
            existing.description,
            revision.oldBody,
            existing.content_hash ?? '',
            existing.confidence,
            existing.author_role,
            existing.source_event_id,
            existing.updated_at,
            Date.now(),
            revision.kind,
            revision.successorId ?? null,
            revision.note ?? null,
          )
      }
      this.raw.prepare(`UPDATE memory_entry SET ${fields.join(', ')} WHERE id = ?`).run(...values)
      if (becomesInactive) {
        this.maintainFts('delete', id)
        this.cleanupIndexOnInactive(id)
      } else if (textChanged) {
        // 【S1A.3 fail-loud】文本字段（name/description）变更必须带 body：
        // contentless FTS 不支持部分更新，缺 body 的 upsert 会以空串重建行，
        // 旧正文检索永久丢失（评估反例 E4）。调用方显式选择：
        // ①改文本 → 必须传完整正文（name+description+body）；
        // ②仅改元数据（confidence/hit_count/生命周期列等）→ 不动 FTS，无需 body。
        if (body == null) {
          throw new Error(
            `MemoryRepository.update: 文本字段变更但未提供 body（id=${id}）——` +
              `拒绝以空串重建 FTS 行（正文检索会丢失）。` +
              `改 name/description 请同时传入完整正文；仅改元数据则不要传文本字段。`,
          )
        }
        this.maintainFts('upsert', id, {
          name: next.name,
          description: next.description,
          body,
        })
        // 【S1B.2 / E5】文本已变 → 向量语义过期：删向量行与索引元数据，
        // 条目重新进入懒回填队列（旧实现只重建 FTS，向量永久滞留旧文本语义）
        this.invalidateVecIndex(id)
      }
    })
    tx()

    return this.findById<MemoryEntryRow>(id)!
  }

  /**
   * CAS 式条件更新（S1B.1）：仅当当前 version === expectedVersion 时应用 patch，
   * 否则不动任何数据并返回 null（调用方据此丢弃或重新排队，不覆盖当前状态）。
   *
   * 语义与 update() 相同（含 S1A.3 fail-loud、FTS 维护、版本自增、哈希刷新），
   * 额外要求：目标必须仍为有效条目（archived=0 且 invalid_at IS NULL）——
   * 已归档/失效/删除的目标版本不提交（晚到结果保护，S1B.3 依赖）。
   *
   * 原子性依据：better-sqlite3 同步 API + Node 单线程 —— findById 检查与
   * update 执行之间不存在 await，无并发交错窗口；SQLite 单写者保证事务串行。
   *
   * @returns 成功返回新行；版本失配/条目不存在/已失效返回 null。
   */
  compareAndSwap(
    id: string,
    expectedVersion: number,
    patch: Partial<Omit<MemoryEntryRow, 'id' | 'created_at'>>,
    body?: string,
    revision?: UpdateRevisionCapture,
  ): MemoryEntryRow | null {
    const existing = this.findById<MemoryEntryRow>(id)
    if (existing == null) return null
    if (
      existing.version !== expectedVersion ||
      existing.archived === 1 ||
      existing.invalid_at != null
    ) {
      log.info(
        `compareAndSwap miss: id=${id} expectedVersion=${expectedVersion} ` +
          `actual=${existing.version} archived=${existing.archived} invalid=${existing.invalid_at != null}`,
      )
      return null
    }
    return this.update(id, patch, body, revision)
  }

  /**
   * Get a single entry by id.
   */
  getById(id: string): MemoryEntryRow | null {
    return this.findById<MemoryEntryRow>(id)
  }

  /**
   * Find an active (non-archived, non-invalidated) entry by exact (scope, scope_ref, name).
   * 失效条目释放唯一索引槽位（见 044 migration），findByName 不返回失效条目。
   *
   * 【审查修复 D1】已到期条目（valid_until <= now）同样不返回 —— 到期即不再是
   * "当前事实"，不得占用去重/撞名判定：同名新事实应走新建（顶替语义，见
   * findExpiredByName），而不是合入到期条目后随其一起对所有检索隐身。
   */
  findByName(scope: string, scopeRef: string | null, name: string): MemoryEntryRow | null {
    const stmt = this.raw.prepare(
      `SELECT * FROM memory_entry WHERE scope = ? AND scope_ref IS ? AND name = ? AND archived = 0
         AND invalid_at IS NULL AND (valid_until IS NULL OR valid_until > ?)`,
    )
    return (stmt.get(scope, scopeRef, name, Date.now()) as MemoryEntryRow | undefined) ?? null
  }

  /**
   * 【审查修复 D1】查同 scope 同名且已到期、但尚未失效/归档的条目 —— 唯一索引
   * uniq_mem_name 不感知 valid_until，到期条目仍占槽位；新建同名前须先失效旧条目
   * 释放槽位（"新事实顶替过期事实，旧事实转历史"），否则 insert 撞 UNIQUE。
   */
  findExpiredByName(scope: string, scopeRef: string | null, name: string): MemoryEntryRow | null {
    const stmt = this.raw.prepare(
      `SELECT * FROM memory_entry WHERE scope = ? AND scope_ref IS ? AND name = ? AND archived = 0
         AND invalid_at IS NULL AND valid_until IS NOT NULL AND valid_until <= ?`,
    )
    return (stmt.get(scope, scopeRef, name, Date.now()) as MemoryEntryRow | undefined) ?? null
  }

  /**
   * List entries by scope。默认只返回有效条目（archived=0 且 invalid_at IS NULL），
   * 这与 FTS/vec 检索层、recall 失效标注保持一致 —— 失效条目不裸注入 prompt。
   * 传 includeInvalid:true 可查看含失效的历史（UI/审计用）。
   */
  listByScope(
    scope: string,
    scopeRef: string | null,
    opts?: {
      type?: string
      includeArchived?: boolean
      includeInvalid?: boolean
      limit?: number
      matchAnyScopeRef?: boolean
    },
  ): MemoryEntryRow[] {
    // scope_ref 精确匹配契约（reader.buildScopes / writer.passDedupGate / countByScope /
    // findEvictionCandidates 都依赖此语义，不可改）。project/agent 留空查不到的场景由
    // MemoryPanel 的"浏览全部项目/助手记忆"场景，必须显式传 matchAnyScopeRef:true 才会放宽。
    const matchAnyScopeRef = opts?.matchAnyScopeRef === true && scope !== 'user'
    const conditions: string[] = ['scope = ?']
    const values: unknown[] = [scope]

    if (!matchAnyScopeRef) {
      conditions.push('scope_ref IS ?')
      values.push(scopeRef)
    }

    if (opts?.type) {
      conditions.push('type = ?')
      values.push(opts.type)
    }

    if (!opts?.includeArchived) {
      conditions.push('archived = 0')
    }
    if (!opts?.includeInvalid) {
      conditions.push('invalid_at IS NULL')
      // 【S2.6 / N5】到期 ≠ 失效：默认同样不作为当前事实返回（含失效视图
      // 供审计/历史查询 —— N7：旧临时约束到期后不自动恢复）
      conditions.push(NOT_EXPIRED_SQL)
      values.push(Date.now())
    }

    // 安全 LIMIT（审查 HIGH#8）：默认 500，防极端库（数千条）一次性载入打满 IPC / 渲染。
    // 前端 MemoryPanel 已加文本搜索框二次过滤；完整游标分页 / 虚拟滚动作为后续优化。
    const limit = opts?.limit != null && opts.limit > 0 ? Math.min(opts.limit, 2000) : 500
    const stmt = this.raw.prepare(
      `SELECT * FROM memory_entry WHERE ${conditions.join(' AND ')} ORDER BY updated_at DESC LIMIT ${limit}`,
    )
    return stmt.all(...values) as MemoryEntryRow[]
  }

  /**
   * Increment hit_count and update last_hit_at for an entry.
   * 刻意不刷新 updated_at —— updated_at 驱动时间衰减重排与 V1 优先级，
   * 若 recall 刷 updated_at 会造成"热门记忆马太效应"（越搜越新越排前）。
   */
  bumpHit(id: string): void {
    this.raw
      .prepare(`UPDATE memory_entry SET hit_count = hit_count + 1, last_hit_at = ? WHERE id = ?`)
      .run(Date.now(), id)
  }

  /**
   * Archive an entry (soft delete)。同一事务内从 FTS/vec/entity_link 移除。
   */
  archive(id: string): void {
    const tx = this.raw.transaction(() => {
      this.raw
        .prepare(`UPDATE memory_entry SET archived = 1, updated_at = ? WHERE id = ?`)
        .run(Date.now(), id)
      this.maintainFts('delete', id)
      this.cleanupIndexOnInactive(id)
    })
    tx()
  }

  /**
   * Restore an archived entry —— archive 的逆操作。同一事务内清 archived 位并
   * 重建 FTS 行，逐项镜像 archive 的副作用：
   *
   * - 归档改了 archived/updated_at → 恢复时同样只动这两列；invalid_at 等
   *   生命周期列不碰（先失效后归档的条目恢复归档后仍保持失效，语义不变）。
   * - 归档从 FTS 删除了行 → 恢复时重新 upsert。文本构造口径照抄 insert：
   *   name/description 取行内当前值，body 由调用方从权威文件读出传入；
   *   缺 body 时以 name+description 重建（正文检索缺失，可由 backfill 补齐）。
   * - version 不自增 —— 与 archive 一致（生命周期位翻转不走有效写入路径）。
   * - 向量索引不立即重建：vec 为懒回填设计（见 invalidateVecIndex / E5），
   *   条目回到有效集后由回填队列重新覆盖；entity_link 在归档时已物理清理，
   *   不在本层恢复。
   *
   * @returns 恢复后的行；条目不存在返回 null；已是非归档状态幂等返回现值。
   */
  unarchive(id: string, body?: string): MemoryEntryRow | null {
    const existing = this.findById<MemoryEntryRow>(id)
    if (existing == null) return null
    if (existing.archived !== 1) return existing
    const tx = this.raw.transaction(() => {
      this.raw
        .prepare(`UPDATE memory_entry SET archived = 0, updated_at = ? WHERE id = ?`)
        .run(Date.now(), id)
      this.maintainFts('upsert', id, {
        name: existing.name,
        description: existing.description,
        ...(body != null ? { body } : {}),
      })
    })
    tx()
    return this.findById<MemoryEntryRow>(id)!
  }

  /**
   * Permanently delete an entry。同一事务内从 FTS/vec/entity_link 移除。
   * 顺序：先清索引（依赖主行 rowid 映射），再删主行。
   */
  delete(id: string): void {
    const tx = this.raw.transaction(() => {
      this.maintainFts('delete', id)
      this.cleanupIndexOnInactive(id)
      this.raw.prepare(`DELETE FROM memory_entry WHERE id = ?`).run(id)
    })
    tx()
  }

  /**
   * Count active entries (non-archived, non-invalidated) in a scope —— 配额只对有效条目计数。
   */
  countByScope(scope: string, scopeRef: string | null): number {
    const stmt = this.raw.prepare(
      `SELECT COUNT(*) as count FROM memory_entry WHERE scope = ? AND scope_ref IS ? AND archived = 0 AND invalid_at IS NULL`,
    )
    const row = stmt.get(scope, scopeRef) as { count: number }
    return row.count
  }

  /**
   * Find entries eligible for eviction (lowest score first) in a scope。只考虑有效条目。
   * Score = hit_count * 0.5 + recency(0~1) * 0.3 + confidence * 0.2
   */
  findEvictionCandidates(scope: string, scopeRef: string | null, limit: number): MemoryEntryRow[] {
    const stmt = this.raw.prepare(
      `SELECT * FROM memory_entry
       WHERE scope = ? AND scope_ref IS ? AND archived = 0 AND invalid_at IS NULL
       ORDER BY (hit_count * 0.5 + (1.0 - ((? - COALESCE(updated_at, created_at)) / 86400000.0)) * 0.3 + confidence * 0.2) ASC
       LIMIT ?`,
    )
    return stmt.all(scope, scopeRef, Date.now(), limit) as MemoryEntryRow[]
  }

  // ─── FTS 同步维护 ──────────────────────────────────────────────────────

  /**
   * 在写路径事务内维护 memory_fts。
   *
   * 降级策略：FTS 表不存在（旧库未跑 042 migration）时静默跳过；
   * FTS 操作抛错只 log 不上抛 —— 记忆主行写入永远优先于索引一致性
   * （索引可通过 backfill 重建，主数据不能丢）。
   */
  private maintainFts(
    op: 'upsert' | 'delete',
    entryId: string,
    fields?: { name: string; description: string; body?: string },
  ): void {
    try {
      if (this.ftsAvailable == null) this.ftsAvailable = ftsTableExists(this.raw)
      if (!this.ftsAvailable) return
      if (op === 'upsert' && fields != null) {
        upsertFtsRow(this.raw, entryId, fields)
        // 【S1B.2】FTS 输入摘要落 memory_index_meta（无模型依赖，generation=0；
        // 供迁移清单校验与"索引是否反映当前文本"诊断）
        this.upsertFtsIndexMeta(entryId, fields)
      } else if (op === 'delete') {
        deleteFtsRow(this.raw, entryId)
        this.deleteIndexMetaRow(entryId, 'fts')
      }
    } catch (err) {
      log.warn(
        `memory_fts maintenance failed (${op} ${entryId}): ${err instanceof Error ? err.message : String(err)}`,
      )
    }
  }

  private upsertFtsIndexMeta(
    entryId: string,
    fields: { name: string; description: string; body?: string },
  ): void {
    try {
      this.raw
        .prepare(
          `INSERT INTO memory_index_meta
             (memory_id, index_kind, input_hash, provider, model, model_revision,
              preprocessor_version, config_generation, built_at)
           VALUES (?, 'fts', ?, NULL, NULL, NULL, ?, 0, ?)
           ON CONFLICT(memory_id, index_kind) DO UPDATE SET
             input_hash = excluded.input_hash,
             preprocessor_version = excluded.preprocessor_version,
             built_at = excluded.built_at`,
        )
        .run(
          entryId,
          hashFtsInput(fields.name, fields.description, fields.body ?? ''),
          FTS_PREPROCESSOR_VERSION,
          Date.now(),
        )
    } catch (err) {
      // meta 表由 migration 105 建；此处置信度低于 FTS 行本身，失败不阻断主流程
      log.warn(
        `memory_index_meta(fts) maintenance failed (${entryId}): ${err instanceof Error ? err.message : String(err)}`,
      )
    }
  }

  private deleteIndexMetaRow(entryId: string, kind: 'vec' | 'fts'): void {
    try {
      this.raw
        .prepare(`DELETE FROM memory_index_meta WHERE memory_id = ? AND index_kind = ?`)
        .run(entryId, kind)
    } catch {
      /* memory_index_meta 表不存在（migration 105 未跑）→ 静默 */
    }
  }

  /**
   * 失效条目的向量索引（E5）：删向量行与 vec 索引元数据，使条目重新进入
   * 懒回填队列。memory_vec 为运行时惰性建表，不存在时仅清 meta。
   */
  private invalidateVecIndex(entryId: string): void {
    try {
      const rowidRow = this.raw
        .prepare('SELECT rowid FROM memory_entry WHERE id = ?')
        .get(entryId) as { rowid?: number | bigint } | undefined
      if (rowidRow?.rowid != null) {
        this.raw.prepare('DELETE FROM memory_vec WHERE rowid = ?').run(rowidRow.rowid)
      }
    } catch {
      /* memory_vec 表不存在（sqlite-vec 未加载 / 未 ensureVecTable）→ 跳过 */
    }
    this.deleteIndexMetaRow(entryId, 'vec')
  }

  /**
   * 失效/归档/删除时清理 vec + entity_link 索引（与 FTS 移除对称）。
   *
   * best-effort：memory_vec（vec0 虚拟表，惰性建）与 memory_entity_link（043 普通
   * 表）任一不存在（旧库未跑到对应 migration）时静默跳过，绝不抛 —— 索引清理失败
   * 不应回滚主行状态。vec 按 rowid 删（rowid 来自主行，须在主行删除前调用）。
   */
  private cleanupIndexOnInactive(entryId: string): void {
    try {
      this.raw.prepare('DELETE FROM memory_entity_link WHERE memory_id = ?').run(entryId)
    } catch {
      /* memory_entity_link 表不存在（043 未跑）→ 静默 */
    }
    try {
      const rowidRow = this.raw
        .prepare('SELECT rowid FROM memory_entry WHERE id = ?')
        .get(entryId) as { rowid?: number | bigint } | undefined
      if (rowidRow?.rowid != null) {
        this.raw.prepare('DELETE FROM memory_vec WHERE rowid = ?').run(rowidRow.rowid)
      }
    } catch {
      /* memory_vec 表不存在（sqlite-vec 未加载 / 未 ensureVecTable）→ 静默 */
    }
    // 【S1B.2】索引元数据随索引一并清理（vec+fts；fts 行由 maintainFts('delete') 先删）
    this.deleteIndexMetaRow(entryId, 'vec')
    this.deleteIndexMetaRow(entryId, 'fts')
  }
}

/** 正文内容哈希（S1B.1 守卫）：SHA-256 hex */
function sha256Hex(text: string): string {
  return createHash('sha256').update(text, 'utf-8').digest('hex')
}

/**
 * 守卫哈希的统一口径（S1B.1）：先去掉尾部换行再哈希。
 * 写入侧（repo.insert/update 的 body）与读取侧（reader.readFile 的返回值，
 * renderMemoryFile 会在 body 后追加一个换行）共用本函数，保证两侧可比。
 */
export function hashBodyForGuard(body: string): string {
  return sha256Hex(normalizeBodyForGuard(body))
}

/**
 * 正文守卫规范化口径（S2.2 起 revision 历史同口径）：去尾部换行。
 * readFile 返回 render 追加的尾部 "\n"，写入侧哈希与历史正文都按本口径统一。
 */
export function normalizeBodyForGuard(body: string): string {
  return body.replace(/\n+$/, '')
}

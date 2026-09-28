/**
 * @module memory-revision.repository
 *
 * 记忆 revision 历史与派生边 repository（S2.2）—— memory_revision /
 * memory_derivation 两表的持久化访问。
 *
 * 语义约定（见 migration 108 与主计划 S2 切片 2）：
 *   - 当前版本以 memory_entry 行 + 正文文件为权威；被替代/作废的版本才进
 *     memory_revision（supersede_kind 区分去向）。
 *   - 旧历史不补造：migration 108 启用前的版本不存在，历史查询须返回
 *     coverage 说明，不伪造完整版本链。
 *   - 派生边不级联：来源撤回时沿边找到派生条目标记待复核，不自动删除。
 */

import { BaseRepository } from './base.repository.js'
import type { SparkDatabase } from '../database.js'

/** 版本被替代/作废的去向（显式 delete 物理清理全部历史，不产生快照） */
export type MemoryRevisionKind = 'update' | 'merge' | 'supersede' | 'retract'

/** 派生关系类型 */
export type MemoryDerivationKind = 'merge' | 'elevate' | 'supersede'

export interface MemoryRevisionRow {
  id: number
  memory_id: string
  version: number
  type: string
  name: string
  description: string
  body: string
  content_hash: string
  confidence: number
  author_role: string | null
  source_event_id: string | null
  /** 该版本生效时刻（写入 memory_entry 时的 updated_at） */
  valid_from: number
  /** 被替代/作废/删除时刻 */
  superseded_at: number
  supersede_kind: MemoryRevisionKind
  /** supersede/merge 时的替代条目 id；retract/delete 为 NULL */
  successor_id: string | null
  note: string | null
}

export interface InsertMemoryRevisionParams {
  memoryId: string
  version: number
  type: string
  name: string
  description: string
  body: string
  contentHash: string
  confidence: number
  authorRole: string | null
  sourceEventId: string | null
  validFrom: number
  supersededAt: number
  kind: MemoryRevisionKind
  successorId?: string | null
  note?: string | null
}

export interface MemoryDerivationRow {
  id: number
  source_id: string
  derived_id: string
  kind: MemoryDerivationKind
  created_at: number
}

/** revision 记录启用时刻（migration 108，2026-09-27 UTC） */
export const REVISION_TRACKING_SINCE_ISO = '2026-09-27'

/** 历史覆盖说明（N10：仅返回可证实历史，不完整就明确说明） */
export interface RevisionCoverage {
  since: string
  complete: boolean
  note: string
}

/**
 * 构造历史覆盖说明。reader 的 getRevisionHistory 与桌面 memory:history
 * IPC 共用本函数，保证两端口径一致。
 *
 * 保守口径：无 revision 记录时一律 complete=false（无法证实"从未有更早
 * 版本"——version=1 且零记录的存量行与启用后新建未更新的行不可区分，
 * 不伪造完整链）。
 */
export function buildRevisionCoverage(
  entry: { version: number },
  revisions: MemoryRevisionRow[],
): RevisionCoverage {
  const first = revisions[0]
  if (revisions.length === 0) {
    return {
      since: REVISION_TRACKING_SINCE_ISO,
      complete: false,
      note: 'revision 记录自 2026-09-27（migration 108）启用；此前版本不存在是已知事实，不补造',
    }
  }
  if (first != null && first.version > 1) {
    return {
      since: REVISION_TRACKING_SINCE_ISO,
      complete: false,
      note: `版本 1–${first.version - 1} 早于 revision 记录启用（2026-09-27），不补造`,
    }
  }
  return {
    since: REVISION_TRACKING_SINCE_ISO,
    complete: revisions.length === entry.version - 1,
    note: '全部历史版本均有记录',
  }
}

export class MemoryRevisionRepository extends BaseRepository {
  constructor(db: SparkDatabase) {
    super(db, 'memory_revision')
  }

  /**
   * 保留一个历史版本。UNIQUE(memory_id, version) 冲突时静默跳过 ——
   * 同版本重复保留（如重试路径）不是错误，历史表幂等收录。
   */
  insertRevision(params: InsertMemoryRevisionParams): void {
    this.raw
      .prepare(
        `INSERT OR IGNORE INTO memory_revision
           (memory_id, version, type, name, description, body, content_hash, confidence,
            author_role, source_event_id, valid_from, superseded_at, supersede_kind,
            successor_id, note)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        params.memoryId,
        params.version,
        params.type,
        params.name,
        params.description,
        params.body,
        params.contentHash,
        params.confidence,
        params.authorRole,
        params.sourceEventId,
        params.validFrom,
        params.supersededAt,
        params.kind,
        params.successorId ?? null,
        params.note ?? null,
      )
  }

  /** 某条目的版本链（旧 → 新）。不含当前版本（当前版本在 memory_entry）。 */
  listRevisions(memoryId: string): MemoryRevisionRow[] {
    return this.raw
      .prepare('SELECT * FROM memory_revision WHERE memory_id = ? ORDER BY version ASC')
      .all(memoryId) as MemoryRevisionRow[]
  }

  /** 记录一条派生边（source → derived）。UNIQUE 冲突幂等跳过。 */
  insertDerivation(sourceId: string, derivedId: string, kind: MemoryDerivationKind): void {
    this.raw
      .prepare(
        `INSERT OR IGNORE INTO memory_derivation (source_id, derived_id, kind, created_at)
         VALUES (?, ?, ?, ?)`,
      )
      .run(sourceId, derivedId, kind, Date.now())
  }

  /** 从某条目派生出的条目（撤回来源时找待复核的下游） */
  listDerivationsFrom(sourceId: string): MemoryDerivationRow[] {
    return this.raw
      .prepare('SELECT * FROM memory_derivation WHERE source_id = ? ORDER BY created_at')
      .all(sourceId) as MemoryDerivationRow[]
  }

  /** 某条目的来源边（它由哪些条目派生而来） */
  listDerivationsOf(derivedId: string): MemoryDerivationRow[] {
    return this.raw
      .prepare('SELECT * FROM memory_derivation WHERE derived_id = ? ORDER BY created_at')
      .all(derivedId) as MemoryDerivationRow[]
  }

  /**
   * 物理删除条目时清理其全部历史与派生边（delete 是用户明确意愿，
   * 与 retract/supersede 保留历史不同）。来源边一并清除 —— 上游已删，
   * 边指向不存在的条目没有意义。
   */
  deleteAllForMemory(memoryId: string): void {
    this.raw.prepare('DELETE FROM memory_revision WHERE memory_id = ?').run(memoryId)
    this.raw
      .prepare('DELETE FROM memory_derivation WHERE source_id = ? OR derived_id = ?')
      .run(memoryId, memoryId)
  }
}

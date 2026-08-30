/**
 * @module memory-entity.repository
 *
 * 实体关联图 SQLite CRUD — memory_entity（规范化去重的实体）+ memory_entity_link（记忆↔实体多对多）。
 *
 * 实体来源：抽取 prompt 的 entities 字段（人名/库名/模块名/系统名）。
 * 规范化：lowercase + trim + 常见别名映射（如 "arco design" → "arco"），同 scope 内
 * 按 normalized_name 去重，使"Arco"/"arco design"归一。
 *
 * 一跳扩展检索：命中记忆 → 取其实体集合 → 反查共享这些实体的其他记忆（≤ limit）。
 */

import { BaseRepository } from './base.repository.js'
import type { SparkDatabase } from '../database.js'
import type { MemoryEntryRow } from './memory.repository.js'

export interface MemoryEntityRow {
  id: string
  scope: 'user' | 'project' | 'agent'
  scope_ref: string | null
  name: string
  normalized_name: string
  created_at: number
}

/**
 * 常见别名映射（写入与查询两侧共用）。新增别名直接加在这里。
 * key/value 均为小写。未命中别名时直接用 lowercase(trim(name))。
 */
const ENTITY_ALIASES: Record<string, string> = {
  'arco design': 'arco',
  'arco-design': 'arco',
  '@arco-design/web-react': 'arco',
  'react.js': 'react',
  'reactjs': 'react',
  'vue.js': 'vue',
  'vuejs': 'vue',
  'node.js': 'node',
  'typescript': 'ts',
  'javascript': 'js',
  'postgres': 'postgresql',
  'sqlite3': 'sqlite',
  'github copilot': 'copilot',
}

/**
 * 实体名规范化：trim → lowercase → 折叠空白 → 别名映射。
 * 导出供检索/展示侧复用，确保写入与查询两侧一致。
 */
export function normalizeEntityName(raw: string): string {
  let n = raw.trim().toLowerCase().replace(/\s+/g, ' ')
  if (n.length === 0) return n
  if (ENTITY_ALIASES[n] != null) n = ENTITY_ALIASES[n]!
  return n
}

export class MemoryEntityRepository extends BaseRepository {
  constructor(db: SparkDatabase) {
    super(db, 'memory_entity')
  }

  /**
   * 用一组实体名（原始写法）登记某条记忆的实体链接：
   *   - 规范化 → 按 (scope, scopeRef, normalized) upsert memory_entity（已存在则复用 id）
   *   - 清除该 memoryId 的旧链接，重新插入（全量替换，反映本轮抽取结果）
   * 必须在调用方事务内？——此处自带事务，便于独立调用；与 memory_entry 写入分离。
   */
  upsertEntitiesForMemory(
    memoryId: string,
    scope: 'user' | 'project' | 'agent',
    scopeRef: string | null,
    names: string[],
  ): void {
    const normalized = new Map<string, string>() // normalized → original
    for (const raw of names) {
      const n = normalizeEntityName(raw)
      if (n.length === 0 || n.length > 80) continue
      if (!normalized.has(n)) normalized.set(n, raw.trim())
    }
    if (normalized.size === 0) {
      // 无实体也要清旧链接（记忆可能本轮没抽到实体）
      this.raw.prepare('DELETE FROM memory_entity_link WHERE memory_id = ?').run(memoryId)
      return
    }

    const tx = this.raw.transaction(() => {
      this.raw.prepare('DELETE FROM memory_entity_link WHERE memory_id = ?').run(memoryId)
      const findEnt = this.raw.prepare(
        'SELECT id FROM memory_entity WHERE scope = ? AND scope_ref IS ? AND normalized_name = ?',
      )
      const insEnt = this.raw.prepare(
        `INSERT INTO memory_entity (id, scope, scope_ref, name, normalized_name, created_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO NOTHING`,
      )
      const link = this.raw.prepare(
        'INSERT OR IGNORE INTO memory_entity_link (memory_id, entity_id) VALUES (?, ?)',
      )
      const now = Date.now()
      for (const [norm, orig] of normalized) {
        let ent = findEnt.get(scope, scopeRef, norm) as { id: string } | undefined
        if (ent == null) {
          const id = `ent_${norm.replace(/[^a-z0-9]/g, '_').slice(0, 20)}_${now.toString(36)}${Math.random().toString(36).slice(2, 5)}`
          insEnt.run(id, scope, scopeRef, orig, norm, now)
          ent = { id }
        }
        link.run(memoryId, ent.id)
      }
    })
    tx()
  }

  /**
   * 一跳扩展：给定一条记忆，找共享任意实体的其他有效记忆（去原条目，未归档未失效）。
   * @returns 关联记忆列表（按共享实体数降序，tie-break 按 updated_at desc）
   */
  findRelated(memoryId: string, limit: number): MemoryEntryRow[] {
    return this.raw
      .prepare(
        `SELECT m.*, COUNT(DISTINCT le.entity_id) AS shared
         FROM memory_entity_link le
         JOIN memory_entity_link re ON re.entity_id = le.entity_id AND re.memory_id != le.memory_id
         JOIN memory_entry m ON m.id = re.memory_id
         WHERE le.memory_id = ? AND m.archived = 0 AND m.invalid_at IS NULL
         GROUP BY m.id
         ORDER BY shared DESC, m.updated_at DESC
         LIMIT ?`,
      )
      .all(memoryId, limit) as MemoryEntryRow[]
  }

  /** 删除某条记忆的全部实体链接（物理删除记忆时调用，避免悬挂边） */
  clearLinksForMemory(memoryId: string): void {
    this.raw.prepare('DELETE FROM memory_entity_link WHERE memory_id = ?').run(memoryId)
  }
}

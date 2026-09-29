/**
 * @module wiki-skill-proposal.repository
 *
 * Wiki 技能提议区（wiki_skill_proposal）仓储 — 知识 → 技能的提议状态机。
 *
 * 核心不变量（方案 §4 设计原则 1「知识永不随技能回滚」）：
 *   - 提议只是**草案**：pending 状态不创建任何技能，也不改动 wiki_page；
 *   - 接受（accepted）才落地技能，且 `skill_id` 回填建立双向溯源；
 *   - 拒绝（rejected）只记原因，**源知识页原样保留** —— 下一轮提议可读
 *     既往拒绝原因，避免重蹈覆辙（`findRejectionHistory`）；
 *   - 同名新提议把旧 pending 置为 superseded：不堆积重复草案，历史可追溯。
 *
 * 与 memory 的差异：memory 的候选是"内容晋级"；这里是"能力晋级"，
 * 因此拒绝的成本更高（用户已明确表态），必须留档。
 */

import { randomUUID } from 'node:crypto'
import { BaseRepository } from './base.repository.js'
import type { SparkDatabase } from '../database.js'

/** 提议状态（与 migration 112 的 CHECK 约束一致） */
export type WikiSkillProposalStatus = 'pending' | 'accepted' | 'rejected' | 'superseded'

/** 技能草稿载荷（accept 时按此生成 SKILL.md + 注册技能） */
export interface WikiSkillProposalDraft {
  /** SKILL.md 全文（Markdown，含 frontmatter） */
  skillMd: string
  /** 一句话说明这个技能做什么（进 skills.manifest_json 的 description） */
  description: string
  /** 建议的触发词 / 使用场景（manifest metadata，UI 展示） */
  triggers: string[]
}

export interface WikiSkillProposalRow {
  id: string
  scope: string
  scope_ref: string | null
  name: string
  purpose: string
  skill_draft_json: string
  source_page_ids_json: string
  status: WikiSkillProposalStatus
  reject_reason: string | null
  skill_id: string | null
  created_at: number
  decided_at: number | null
}

export interface InsertWikiSkillProposalParams {
  id: string
  scope: string
  scopeRef: string | null
  name: string
  purpose: string
  draft: WikiSkillProposalDraft
  /** 溯源页面 id（至少一个；空数组的提议没有知识依据，拒绝入库） */
  sourcePageIds: string[]
}

/** 提议 id：前缀 wskp_ + uuid 前 8 hex（与 memory / wiki 其他表同约定） */
export function generateWikiSkillProposalId(): string {
  return `wskp_${randomUUID().replace(/-/g, '').slice(0, 8)}`
}

/** 技能名归一化：去首尾空白、压缩连续空白；用于同名判定（大小写不敏感） */
export function normalizeSkillName(name: string): string {
  return name.trim().replace(/\s+/g, ' ').toLowerCase()
}

export class WikiSkillProposalRepository extends BaseRepository {
  constructor(db: SparkDatabase) {
    super(db, 'wiki_skill_proposal')
  }

  /** 解析技能草稿（JSON 损坏或字段缺失时返回 null —— 不采信不可解析内容） */
  parseDraft(row: WikiSkillProposalRow): WikiSkillProposalDraft | null {
    try {
      const parsed = JSON.parse(row.skill_draft_json) as Partial<WikiSkillProposalDraft>
      if (
        typeof parsed.skillMd === 'string' &&
        parsed.skillMd.trim().length > 0 &&
        typeof parsed.description === 'string' &&
        Array.isArray(parsed.triggers) &&
        parsed.triggers.every((t) => typeof t === 'string')
      ) {
        return {
          skillMd: parsed.skillMd,
          description: parsed.description,
          triggers: parsed.triggers,
        }
      }
      return null
    } catch {
      return null
    }
  }

  /** 解析溯源页面 id 列表（损坏时返回空数组，调用方据此判"无溯源"） */
  parseSourcePageIds(row: WikiSkillProposalRow): string[] {
    try {
      const parsed = JSON.parse(row.source_page_ids_json) as unknown
      if (Array.isArray(parsed)) return parsed.filter((v): v is string => typeof v === 'string')
      return []
    } catch {
      return []
    }
  }

  /**
   * 征集一条提议（pending）。
   *
   * 事务内两步：把同 scope 同名（归一化）的**旧 pending** 置为 superseded
   * （不堆积重复草案）→ 插入新 pending。已接受 / 已拒绝的历史不动：
   * 拒绝史正是"下一轮避免重蹈"的输入。
   */
  insert(params: InsertWikiSkillProposalParams, now?: number): WikiSkillProposalRow {
    const at = now ?? Date.now()
    const row = this.raw.transaction(() => {
      this.raw
        .prepare(
          `UPDATE wiki_skill_proposal SET status = 'superseded', decided_at = ?
             WHERE scope = ? AND scope_ref IS ? AND status = 'pending'
               AND name = ? COLLATE NOCASE`,
        )
        .run(at, params.scope, params.scopeRef, params.name)

      this.raw
        .prepare(
          `INSERT INTO wiki_skill_proposal
               (id, scope, scope_ref, name, purpose, skill_draft_json,
                source_page_ids_json, status, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?)`,
        )
        .run(
          params.id,
          params.scope,
          params.scopeRef,
          params.name,
          params.purpose,
          JSON.stringify(params.draft),
          JSON.stringify(params.sourcePageIds),
          at,
        )
      return this.getById(params.id)
    })()
    return row!
  }

  getById(id: string): WikiSkillProposalRow | null {
    return this.findById<WikiSkillProposalRow>(id)
  }

  /** 列出指定状态的提议（新→旧）；scope 缺省查全部（提议区管理视图） */
  listByStatus(
    status: WikiSkillProposalStatus,
    scope?: { scope: string; scopeRef: string | null },
    limit = 200,
  ): WikiSkillProposalRow[] {
    if (scope != null) {
      return this.raw
        .prepare(
          `SELECT * FROM wiki_skill_proposal
           WHERE status = ? AND scope = ? AND scope_ref IS ?
           ORDER BY created_at DESC LIMIT ?`,
        )
        .all(status, scope.scope, scope.scopeRef, limit) as WikiSkillProposalRow[]
    }
    return this.raw
      .prepare(
        `SELECT * FROM wiki_skill_proposal WHERE status = ? ORDER BY created_at DESC LIMIT ?`,
      )
      .all(status, limit) as WikiSkillProposalRow[]
  }

  countPending(scope: string, scopeRef: string | null): number {
    const row = this.raw
      .prepare(
        `SELECT COUNT(*) AS n FROM wiki_skill_proposal
         WHERE scope = ? AND scope_ref IS ? AND status = 'pending'`,
      )
      .get(scope, scopeRef) as { n: number }
    return row.n
  }

  /**
   * 同名技能的既往决策史（最近优先）—— 提议生成时读它，把"上次为何被拒"
   * 带给模型，避免同一思路反复被拒。只取已决断行（accepted / rejected），
   * superseded 是内部状态对用户无意义。
   */
  findDecisionHistory(
    scope: string,
    scopeRef: string | null,
    name: string,
    limit = 5,
  ): WikiSkillProposalRow[] {
    return this.raw
      .prepare(
        `SELECT * FROM wiki_skill_proposal
         WHERE scope = ? AND scope_ref IS ? AND name = ? COLLATE NOCASE
           AND status IN ('accepted', 'rejected')
         ORDER BY created_at DESC LIMIT ?`,
      )
      .all(scope, scopeRef, name, limit) as WikiSkillProposalRow[]
  }

  /**
   * 用户接受（一次性状态迁移）：pending → accepted。
   *
   * 顺序对齐候选区范式（wiki-candidate.repository#confirm）：**先迁移状态，
   * 再由调用方落地技能并回填 skill_id**。这样并发/重复接受只有一次能成功；
   * 落地失败时用 `revertToPendingIfUnregistered` 回滚，不留
   * "已接受但无技能"的死角。`WHERE status='pending'` 保证一次性。
   */
  accept(id: string, now?: number): { ok: boolean; row: WikiSkillProposalRow | null } {
    const at = now ?? Date.now()
    const result = this.raw
      .prepare(
        `UPDATE wiki_skill_proposal
         SET status = 'accepted', decided_at = ?, reject_reason = NULL
         WHERE id = ? AND status = 'pending'`,
      )
      .run(at, id)
    if (result.changes === 0) return { ok: false, row: this.getById(id) }
    return { ok: true, row: this.getById(id) }
  }

  /** 接受后回填生成的技能 id（幂等；只在 accepted 行上写，不复活已决断行）。 */
  attachSkill(id: string, skillId: string): boolean {
    const result = this.raw
      .prepare(
        `UPDATE wiki_skill_proposal SET skill_id = ?
         WHERE id = ? AND status = 'accepted' AND skill_id IS NULL`,
      )
      .run(skillId, id)
    return result.changes > 0
  }

  /**
   * 用户拒绝（pending → rejected）。原因必填（≤500 字）：这是留给下一轮
   * 提议的唯一反馈信号，空原因等于丢弃信息。
   */
  reject(
    id: string,
    reason: string,
    now?: number,
  ): { ok: boolean; row: WikiSkillProposalRow | null } {
    const at = now ?? Date.now()
    const result = this.raw
      .prepare(
        `UPDATE wiki_skill_proposal
         SET status = 'rejected', decided_at = ?, reject_reason = ?
         WHERE id = ? AND status = 'pending'`,
      )
      .run(at, reason, id)
    return { ok: result.changes > 0, row: this.getById(id) }
  }

  /**
   * 条件回滚为 pending（接受后技能落地失败时）：
   * 仅当行处于 accepted 且 skill_id 仍为 NULL 才回滚；已成功注册技能的行
   * 不受影响（回滚它会造成"技能存在但提议还挂着 pending"的幽灵态）。
   */
  revertToPendingIfUnregistered(id: string): boolean {
    const result = this.raw
      .prepare(
        `UPDATE wiki_skill_proposal
         SET status = 'pending', decided_at = NULL
         WHERE id = ? AND status = 'accepted' AND skill_id IS NULL`,
      )
      .run(id)
    return result.changes > 0
  }
}

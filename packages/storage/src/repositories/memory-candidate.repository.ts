/**
 * @module memory-candidate.repository
 *
 * 记忆候选确认区 repository（S2.3）—— memory_candidate 表的持久化访问。
 *
 * 语义约定（见 migration 109 与主计划 S2 切片 3）：
 *   - 推断行为规则晋级（ELEVATE）先入候选区（pending），不自动写入稳定
 *     feedback；晋级须真实用户结构化确认（candidate id + 内容摘要）。
 *   - 同 scope 同 content_digest 的既往候选（任意状态）不再重复征集 ——
 *     同一建议经多次总结/整合不生成独立证据票数（N1/N2）。
 *   - 候选生命周期（pending/confirmed/rejected/expired）与条目生命周期
 *     分开：过期与容量淘汰只改候选状态，不触碰 memory_entry。
 *   - 确认是一次性状态迁移（UPDATE ... WHERE status='pending' 原子保证）；
 *     decided_via 固定 'user_ipc' —— 模型无可达通道（N12）。
 */

import { BaseRepository } from './base.repository.js'
import type { SparkDatabase } from '../database.js'
import { hashIndexInput } from './memory-index-hash.js'

/** 候选状态 */
export type MemoryCandidateStatus = 'pending' | 'confirmed' | 'rejected' | 'expired'

/** ELEVATE 提议的完整载荷（确认时按原文落库 —— 展示什么就存什么） */
export interface MemoryCandidatePayload {
  type: 'user' | 'feedback' | 'project' | 'reference'
  name: string
  description: string
  body: string
  confidence: number
  /** LLM 抽取的实体（确认时随条目落库）；可缺省 */
  entities?: unknown
  /** 升华来源条目 id（确认时记派生边）；至少 2 条才成候选 */
  sourceIds: string[]
  /**
   * 【P2-A 冲突性写入】候选动作：缺省 'create'（既有 ELEVATE 晋级新建）；
   * 'update' / 'delete' 为演化判定对"用户明确表达/手动创建"条目的改写提议，
   * 确认时对 targetId 指向的既有条目执行而非新建；'merge' 仅预留枚举
   * （MERGE 预确认由后续任务实现，confirm 侧 unsupported_action 拒绝）。
   */
  action?: 'create' | 'update' | 'delete' | 'merge'
  /** action 为 update/delete 时的目标条目 id（memory_entry.id） */
  targetId?: string
}

export interface MemoryCandidateRow {
  id: number
  scope: 'user' | 'project' | 'agent'
  scope_ref: string | null
  content_digest: string
  payload_json: string
  status: MemoryCandidateStatus
  created_at: number
  expires_at: number
  decided_at: number | null
  decided_via: string | null
  entry_id: string | null
  confirmed_digest: string | null
}

export interface InsertMemoryCandidateParams {
  scope: 'user' | 'project' | 'agent'
  scopeRef: string | null
  payload: MemoryCandidatePayload
}

/** 确认结果：失败带机器可读原因（结构化拒绝，评估按类别断言） */
export type ConfirmCandidateResult =
  | { ok: true; candidate: MemoryCandidateRow }
  | {
      ok: false
      reason: 'not_found' | 'not_pending' | 'expired' | 'digest_mismatch' | 'payload_unreadable'
      candidate?: MemoryCandidateRow | undefined
    }

/** 候选容量与过期上限（主计划："候选过期和容量有上限"） */
export const MAX_PENDING_CANDIDATES_PER_SCOPE = 20
export const CANDIDATE_TTL_MS = 30 * 86_400_000

/** 候选展示内容摘要：确认请求与候选行共用本口径 */
export function hashCandidateContent(name: string, description: string, body: string): string {
  return hashIndexInput([name, description, body])
}

/** 【P2-A】候选动作合法枚举守卫（parsePayload 校验用；非法值按缺省 create 处理） */
function isCandidateAction(value: unknown): value is NonNullable<MemoryCandidatePayload['action']> {
  return value === 'create' || value === 'update' || value === 'delete' || value === 'merge'
}

export class MemoryCandidateRepository extends BaseRepository {
  constructor(db: SparkDatabase) {
    super(db, 'memory_candidate')
  }

  /** 解析候选载荷（payload_json 损坏时返回 null —— 不采信不可解析内容） */
  parsePayload(row: MemoryCandidateRow): MemoryCandidatePayload | null {
    try {
      const parsed = JSON.parse(row.payload_json) as Partial<MemoryCandidatePayload>
      if (
        typeof parsed.name === 'string' &&
        typeof parsed.description === 'string' &&
        typeof parsed.body === 'string' &&
        typeof parsed.confidence === 'number' &&
        Array.isArray(parsed.sourceIds) &&
        parsed.sourceIds.every((id) => typeof id === 'string')
      ) {
        // 【P2-A】action/targetId 透传校验：action 非四值之一按缺省（create）
        // 处理，不 throw（解析健壮性优先）仅 warn 留痕；targetId 非 string 丢弃。
        if (parsed.action != null && !isCandidateAction(parsed.action)) {
          console.warn(
            `[memory-candidate] parsePayload: 非法 action ${JSON.stringify(parsed.action)}，` +
              `按缺省 create 处理（row id=${row.id}）`,
          )
        }
        const action = isCandidateAction(parsed.action) ? parsed.action : undefined
        const targetId = typeof parsed.targetId === 'string' ? parsed.targetId : undefined
        return {
          type:
            parsed.type === 'feedback' || parsed.type === 'project' || parsed.type === 'reference'
              ? parsed.type
              : 'user',
          name: parsed.name,
          description: parsed.description,
          body: parsed.body,
          confidence: parsed.confidence,
          ...(parsed.entities != null ? { entities: parsed.entities } : {}),
          sourceIds: parsed.sourceIds,
          ...(action != null ? { action } : {}),
          ...(targetId != null ? { targetId } : {}),
        }
      }
      return null
    } catch {
      return null
    }
  }

  /**
   * 征集一条候选（pending）。
   *
   * 幂等去重：同 scope 同 content_digest 已存在任意状态的候选 → 跳过返回
   * 既有行（含 decided 状态 —— 用户拒绝过的提议不重复打扰，N1/N2 防票数
   * 累积）。插入前统一清理：过期 pending → expired；超出容量上限的最早
   * pending → expired。
   */
  insertPending(
    params: InsertMemoryCandidateParams,
    opts?: { maxPending?: number; ttlMs?: number; now?: number },
  ): { inserted: boolean; row: MemoryCandidateRow | null } {
    const now = opts?.now ?? Date.now()
    const maxPending = opts?.maxPending ?? MAX_PENDING_CANDIDATES_PER_SCOPE
    const ttlMs = opts?.ttlMs ?? CANDIDATE_TTL_MS
    const digest = hashCandidateContent(
      params.payload.name,
      params.payload.description,
      params.payload.body,
    )

    const existing = this.findByDigest(params.scope, params.scopeRef, digest)
    if (existing != null) return { inserted: false, row: existing }

    const tx = this.raw.transaction(() => {
      // 1) 过期清扫：pending 且 expires_at < now → expired
      this.raw
        .prepare(
          `UPDATE memory_candidate SET status = 'expired'
           WHERE scope = ? AND scope_ref IS ? AND status = 'pending' AND expires_at < ?`,
        )
        .run(params.scope, params.scopeRef, now)
      // 2) 容量淘汰：为即将插入的候选腾位（插入后 pending 总数 ≤ maxPending），
      //    按 created_at 淘汰最早者
      const overCount = this.countPending(params.scope, params.scopeRef) + 1 - maxPending
      if (overCount > 0) {
        this.raw
          .prepare(
            `UPDATE memory_candidate SET status = 'expired' WHERE id IN (
               SELECT id FROM memory_candidate
               WHERE scope = ? AND scope_ref IS ? AND status = 'pending'
               ORDER BY created_at ASC LIMIT ?
             )`,
          )
          .run(params.scope, params.scopeRef, overCount)
      }
      // 3) 插入新候选
      const result = this.raw
        .prepare(
          `INSERT INTO memory_candidate
             (scope, scope_ref, content_digest, payload_json, status, created_at, expires_at)
           VALUES (?, ?, ?, ?, 'pending', ?, ?)`,
        )
        .run(
          params.scope,
          params.scopeRef,
          digest,
          JSON.stringify(params.payload),
          now,
          now + ttlMs,
        )
      return this.getById(Number(result.lastInsertRowid))
    })
    const row = tx()
    return { inserted: true, row }
  }

  getById(id: number): MemoryCandidateRow | null {
    return (
      (this.raw.prepare(`SELECT * FROM memory_candidate WHERE id = ?`).get(id) as
        | MemoryCandidateRow
        | undefined) ?? null
    )
  }

  /** 列出指定状态的候选（新→旧）；scope 缺省查全部（管理视图） */
  listByStatus(
    status: MemoryCandidateStatus,
    scope?: { scope: 'user' | 'project' | 'agent'; scopeRef: string | null },
  ): MemoryCandidateRow[] {
    if (scope != null) {
      return this.raw
        .prepare(
          `SELECT * FROM memory_candidate WHERE status = ? AND scope = ? AND scope_ref IS ?
           ORDER BY created_at DESC`,
        )
        .all(status, scope.scope, scope.scopeRef) as MemoryCandidateRow[]
    }
    return this.raw
      .prepare(`SELECT * FROM memory_candidate WHERE status = ? ORDER BY created_at DESC`)
      .all(status) as MemoryCandidateRow[]
  }

  private findByDigest(
    scope: 'user' | 'project' | 'agent',
    scopeRef: string | null,
    digest: string,
  ): MemoryCandidateRow | null {
    return (
      (this.raw
        .prepare(
          `SELECT * FROM memory_candidate WHERE scope = ? AND scope_ref IS ? AND content_digest = ?
           ORDER BY id DESC LIMIT 1`,
        )
        .get(scope, scopeRef, digest) as MemoryCandidateRow | undefined) ?? null
    )
  }

  private countPending(scope: 'user' | 'project' | 'agent', scopeRef: string | null): number {
    const row = this.raw
      .prepare(
        `SELECT COUNT(*) AS n FROM memory_candidate
         WHERE scope = ? AND scope_ref IS ? AND status = 'pending'`,
      )
      .get(scope, scopeRef) as { n: number }
    return row.n
  }

  /**
   * 用户确认（一次性状态迁移）。
   *
   * 校验顺序：存在 → pending → 未过期 → 摘要一致。摘要一致性双重比对：
   * expectedDigest 必须等于候选行 content_digest（UI 展示时的摘要）**且**
   * 等于按当前 payload 原文重算的摘要 —— 载荷被改写（摘要列未同步）后，
   * 旧摘要确认失配拒绝（"新内容不能继承旧确认"）。载荷不可解析同样拒绝。
   * 状态迁移用 `UPDATE ... WHERE status='pending'` 原子保证一次性（并发或
   * 重复确认影响 0 行 → not_pending）。
   */
  confirm(id: number, expectedDigest: string, now?: number): ConfirmCandidateResult {
    const at = now ?? Date.now()
    const candidate = this.getById(id)
    if (candidate == null) return { ok: false, reason: 'not_found' }
    if (candidate.status !== 'pending') {
      return { ok: false, reason: 'not_pending', candidate }
    }
    if (candidate.expires_at < at) {
      // 【审查修复 D5】过期标记同样限定 pending 行 —— 防并发下把刚 confirmed
      // 的行（基于旧 pending 读数走此分支）覆盖回 expired，破坏一次性语义
      this.raw
        .prepare(`UPDATE memory_candidate SET status = 'expired' WHERE id = ? AND status = 'pending'`)
        .run(id)
      return { ok: false, reason: 'expired', candidate: this.getById(id) ?? undefined }
    }
    const payload = this.parsePayload(candidate)
    if (payload == null) {
      return { ok: false, reason: 'payload_unreadable', candidate }
    }
    const recomputed = hashCandidateContent(payload.name, payload.description, payload.body)
    if (candidate.content_digest !== expectedDigest || recomputed !== expectedDigest) {
      return { ok: false, reason: 'digest_mismatch', candidate }
    }
    const result = this.raw
      .prepare(
        `UPDATE memory_candidate
         SET status = 'confirmed', decided_at = ?, decided_via = 'user_ipc',
             confirmed_digest = ?
         WHERE id = ? AND status = 'pending'`,
      )
      .run(at, expectedDigest, id)
    if (result.changes === 0) {
      return { ok: false, reason: 'not_pending', candidate: this.getById(id) ?? undefined }
    }
    return { ok: true, candidate: this.getById(id)! }
  }

  /**
   * 条件回滚为 pending（确认后条目写入失败时的悬状态恢复）：
   * 仅当行处于 confirmed 且 entry_id 仍为 NULL（确认了但没条目）才回滚，
   * 已成功晋级（entry_id 已回填）或用户已拒绝/过期的行不受影响。
   * 回滚后用户可重试确认或拒绝 —— 不留"已确认但无条目"的死角。
   */
  revertToPendingIfUnattached(id: number): boolean {
    const result = this.raw
      .prepare(
        `UPDATE memory_candidate
         SET status = 'pending', decided_at = NULL, decided_via = NULL, confirmed_digest = NULL
         WHERE id = ? AND status = 'confirmed' AND entry_id IS NULL`,
      )
      .run(id)
    return result.changes > 0
  }

  /** 用户拒绝（pending → rejected；非 pending 幂等返回当前行） */
  reject(id: number, now?: number): { ok: boolean; row: MemoryCandidateRow | null } {
    const at = now ?? Date.now()
    const result = this.raw
      .prepare(
        `UPDATE memory_candidate SET status = 'rejected', decided_at = ?, decided_via = 'user_ipc'
         WHERE id = ? AND status = 'pending'`,
      )
      .run(at, id)
    return { ok: result.changes > 0, row: this.getById(id) }
  }

  /** 确认晋级后回填创建的条目 id（幂等） */
  attachEntry(id: number, entryId: string): void {
    this.raw.prepare(`UPDATE memory_candidate SET entry_id = ? WHERE id = ?`).run(entryId, id)
  }

  /**
   * 确认是否仍覆盖条目当前版本：确认摘要 vs 当前条目内容的同口径摘要。
   * 条目被更新（v2+）后失配 → 确认过时（"确认只覆盖指定版本"，展示层
   * 依此显示可解释状态，新版本不继承旧确认）。
   */
  isConfirmationCurrent(
    candidate: MemoryCandidateRow,
    entry: {
      name: string
      description: string
      body: string
    },
  ): boolean {
    if (candidate.status !== 'confirmed' || candidate.confirmed_digest == null) return false
    return (
      hashCandidateContent(entry.name, entry.description, entry.body) === candidate.confirmed_digest
    )
  }
}

/** （保持与既有模块一致的导出形态；digest 计算不依赖实例） */
export function candidateDigestOf(payload: MemoryCandidatePayload): string {
  return hashCandidateContent(payload.name, payload.description, payload.body)
}

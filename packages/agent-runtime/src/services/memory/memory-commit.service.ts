/**
 * @module memory-commit.service
 *
 * 记忆提交原语（S1B.1：版本提交、索引新鲜度和本地遗忘 · 切片 1）
 *
 * 统一托管条目的写入提交：先写正文快照文件（原子 tmp→rename），再在 DB 事务内
 * 校验版本并切换引用（CAS：UPDATE ... WHERE version = expected）。校验失败不
 * 得覆盖旧正文 —— 文件已写而 DB 未提交的状态是"可识别孤儿"（DB 行的
 * content_hash 与新文件失配，读取守卫拒绝采信），由 S1B.4 删除协调的快照
 * 枚举清理。
 *
 * 设计依据：docs/plans/2026-09-25-memory-lifecycle-hardening-plan.md §3.1/§4.5/S1B.1；
 * 目录布局采用方案 B（不迁目录，content_hash 即守卫）。
 *
 * 接入范围（§4.5 六入口矩阵）：
 *   1. 自动提取（writer V1 去重/V2 演化）   → commitWrite / commitCasUpdate
 *   2. 手工创建（memory:create → manualWrite）→ commitWrite
 *   3. 手工编辑（memory:update）             → 计划收编；当前走 repo.update（遗留项）
 *   4. 整合（consolidation MERGE/ELEVATE）    → commitCasUpdate
 *   5. 同步导入（sync-adapters applyMemory）  → S1B.5 专项（版本语义随同步协议传递）
 *   6. 归档/删除（lifecycle）                 → S1B.4（memory_operation 协调）
 */

import { createLogger } from '@spark/shared'
import type { MemoryEntryRow } from '@spark/storage'
import { MemoryRepository } from '@spark/storage'
import { MemoryStoreService } from './memory-store.service.js'
import type { MemoryFileMeta } from './memory-store.service.js'

const log = createLogger('memory:commit')

/** ID 前缀（与 writer.generateId 同约定） */
const SCOPE_PREFIX: Record<string, string> = { user: 'usr', project: 'prj', agent: 'agt' }

export interface CommitWriteInput {
  /** 目标条目 id；缺省 = 新建（内部生成） */
  entryId?: string
  /** 更新时的 CAS 期望版本（新建忽略）。缺省且 entryId 存在 = 以当前版本无条件更新（非并发路径） */
  expectedVersion?: number
  scope: 'user' | 'project' | 'agent'
  scopeRef: string | null
  type: 'user' | 'feedback' | 'project' | 'reference'
  name: string
  description: string
  confidence: number
  body: string
  sourceSessionId?: string | null
  links?: string[]
  /** 保留字段（更新时延续旧行的命中统计等） */
  preserveFrom?: MemoryEntryRow
}

export type CommitWriteResult =
  | { ok: true; row: MemoryEntryRow; created: boolean }
  | {
      ok: false
      reason: 'version_conflict' | 'already_exists' | 'validation'
      message: string
      /** 当前行的实际版本（version_conflict 时供调用方重读重试） */
      currentVersion?: number
    }

export class MemoryCommitService {
  constructor(
    private readonly repo: MemoryRepository,
    private readonly store: MemoryStoreService,
  ) {}

  /**
   * 托管写入：新建或 CAS 更新，统一"先文件后 DB"顺序。
   *
   * 新建：写文件 → insert（version=1，content_hash 补齐）。
   * 更新：读当前行 → 写新快照文件 → compareAndSwap(expectedVersion, patch, body)；
   *       版本失配返回 version_conflict（此时文件已为新内容，DB content_hash
   *       失配形成可识别孤儿，日志标注待 S1B.4 清理，读取守卫拒绝错配正文）。
   */
  async commitWrite(input: CommitWriteInput): Promise<CommitWriteResult> {
    if (input.entryId != null) {
      return this.commitUpdate(input.entryId, input)
    }
    return this.commitCreate(input)
  }

  /** 新建托管条目（版本 1 起点） */
  async commitCreate(input: CommitWriteInput): Promise<CommitWriteResult> {
    const id = generateId(input.scope)
    const now = Date.now()
    const meta: MemoryFileMeta = {
      id,
      scope: input.scope,
      scopeRef: input.scopeRef,
      type: input.type,
      name: input.name,
      description: input.description,
      confidence: input.confidence,
      createdAt: now,
      updatedAt: now,
      hitCount: input.preserveFrom?.hit_count ?? 0,
      lastHitAt: input.preserveFrom?.last_hit_at ?? null,
      sourceSessionId: input.sourceSessionId ?? null,
      links: input.links ?? [],
      archived: false,
    }

    // 1. 先写正文快照（原子替换）；失败则中止，DB 不动
    const filePath = await this.store.writeFile({ meta, body: input.body })

    // 2. DB 提交（同事务维护 FTS；insert 带 body 写入 content_hash）
    try {
      const row = this.repo.insert(
        {
          id,
          scope: input.scope,
          scope_ref: input.scopeRef,
          type: input.type,
          name: input.name,
          description: input.description,
          file_path: filePath,
          confidence: input.confidence,
          hit_count: meta.hitCount,
          last_hit_at: meta.lastHitAt,
          source_session_id: meta.sourceSessionId,
          archived: 0,
        },
        input.body,
      )
      return { ok: true, row, created: true }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      // 唯一索引冲突（同 scope 同名有效条目）是最常见的业务性失败
      if (msg.includes('uniq_mem_name') || msg.includes('UNIQUE')) {
        return { ok: false, reason: 'already_exists', message: msg }
      }
      log.warn(`commitCreate DB 提交失败（文件已写，成为待清理孤儿 ${filePath}）：${msg}`)
      throw err
    }
  }

  /**
   * CAS 更新托管条目。
   * expectedVersion 缺省时以"读到的当前版本"提交（等价无条件更新，供单线程
   * 本地路径使用）；显式传入时形成晚到保护（S1B.3）。
   */
  async commitUpdate(entryId: string, input: CommitWriteInput): Promise<CommitWriteResult> {
    const existing = this.repo.getById(entryId)
    if (existing == null) {
      return { ok: false, reason: 'validation', message: `Memory entry not found: ${entryId}` }
    }
    if (existing.archived === 1 || existing.invalid_at != null) {
      return {
        ok: false,
        reason: 'version_conflict',
        message: `Memory entry ${entryId} is archived or invalidated; refuse to commit`,
        currentVersion: existing.version,
      }
    }

    const expected = input.expectedVersion ?? existing.version
    const meta: MemoryFileMeta = {
      id: existing.id,
      scope: existing.scope,
      scopeRef: existing.scope_ref,
      type: input.type,
      name: input.name,
      description: input.description,
      confidence: input.confidence,
      createdAt: existing.created_at,
      updatedAt: Date.now(),
      hitCount: existing.hit_count,
      lastHitAt: existing.last_hit_at,
      sourceSessionId: input.sourceSessionId ?? existing.source_session_id,
      links: input.links ?? [],
      archived: false,
    }

    // 1. 先写新快照（原子替换旧文件）
    const filePath = await this.store.writeFile({ meta, body: input.body })

    // 2. CAS 提交：版本失配（或写入间隙被归档/失效/删除）→ 不覆盖当前状态
    const next = this.repo.compareAndSwap(
      entryId,
      expected,
      {
        type: input.type,
        name: input.name,
        description: input.description,
        file_path: filePath,
        confidence: input.confidence,
      },
      input.body,
    )
    if (next == null) {
      const current = this.repo.getById(entryId)
      log.warn(
        `commitUpdate CAS 失配：id=${entryId} expected=${expected} ` +
          `actual=${current?.version ?? '(gone)'} —— 新快照文件成为待清理孤儿（content_hash 失配，` +
          `读取守卫将拒绝错配正文），待 S1B.4 删除协调枚举清理`,
      )
      return {
        ok: false,
        reason: 'version_conflict',
        message: `version mismatch for ${entryId}: expected ${expected}`,
        ...(current?.version != null ? { currentVersion: current.version } : {}),
      }
    }
    return { ok: true, row: next, created: false }
  }
}

function generateId(scope: string): string {
  const prefix = SCOPE_PREFIX[scope] ?? 'mem'
  return `${prefix}_${crypto.randomUUID().replace(/-/g, '').slice(0, 8)}`
}

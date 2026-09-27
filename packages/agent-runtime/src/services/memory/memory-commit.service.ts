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
import { MemoryRepository, hashBodyForGuard, normalizeBodyForGuard } from '@spark/storage'
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
  /**
   * 来源绑定（S2.1，migration 107）。全部由系统侧填充 —— 写入口的调用方
   * （session.service / consolidation / IPC / sync）携带真实装配上下文；
   * LLM candidate 中不存在任何来源字段，无注入点。
   */
  sourceEventId?: string | null
  sourceTurnId?: string | null
  /** 'host_agent' | 'team_member' | 'consolidation' | 'manual_user' | 'sync_import' */
  authorRole?: string | null
  /** 真实装配身份 id（host agentId / member.id） */
  authorAgentId?: string | null
  /** 'turn_extraction' | 'consolidation' | 'manual' | 'sync_import' */
  extractionKind?: string | null
  /** 实际调用的提取模型 id */
  extractionModel?: string | null
  /**
   * 【S2.6 / N5】有效期（半开区间右端，UTC ms）：到期不再作为当前事实，
   * 条目保留可查历史。调用方经 memory-temporal.resolveValidUntil 规范化。
   */
  validUntil?: number | null
  /** 精度/时区原始表达（JSON，见 ValidUntilMeta）；供展示层如实说明 */
  validUntilMeta?: string | null
  links?: string[]
  /**
   * 【审查修复】更新时 revision 历史的收录分类（S2.2）：缺省 'update'；
   * 整合 MERGE 传 'merge'（consolidation 经本服务提交时区分）。
   */
  revisionKind?: 'update' | 'merge' | 'supersede'
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
          source_event_id: input.sourceEventId ?? null,
          source_turn_id: input.sourceTurnId ?? null,
          author_role: input.authorRole ?? null,
          author_agent_id: input.authorAgentId ?? null,
          extraction_kind: input.extractionKind ?? null,
          extraction_model: input.extractionModel ?? null,
          evidence_status: 'available',
          // 【S2.6 / N5】有效期与精度/时区表达（调用方经 resolveValidUntil 规范化）
          ...(input.validUntil != null
            ? { valid_until: input.validUntil, valid_until_meta: input.validUntilMeta ?? null }
            : {}),
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
   *
   * 失配处理（审查修复）：先用读取时的旧正文尽力恢复被覆盖的权威文件
   * （条件与限制见下方恢复注释），再返回 version_conflict。
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
    // 【S2.2】新快照会原子替换旧文件 —— 被覆盖版本的正文必须在写新快照之前
    // 读出，随 CAS 同事务进 memory_revision。读不到（文件缺失/损坏）时如实
    // 以空正文入历史并在 note 标注，不中断提交。
    let oldBody = ''
    let oldBodyNote: string | null = null
    try {
      // 守卫哈希同款规范化（去 render 追加的尾部换行），revision 正文与 content_hash 口径一致
      oldBody = normalizeBodyForGuard(await this.store.readFile(existing.file_path))
    } catch {
      oldBodyNote = 'previous body unreadable at commit time; archived empty'
      log.warn(`commitUpdate: 旧正文读取失败（历史版本将以空正文入档）：${existing.file_path}`)
    }

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

    // 2. CAS 提交：版本失配（或写入间隙被归档/失效/删除）→ 不覆盖当前状态。
    //    成功路径同事务保留被覆盖版本（S2.2 revision 历史）。
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
      { oldBody, kind: input.revisionKind ?? 'update', note: oldBodyNote },
    )
    if (next == null) {
      const current = this.repo.getById(entryId)
      log.warn(
        `commitUpdate CAS 失配：id=${entryId} expected=${expected} ` +
          `actual=${current?.version ?? '(gone)'} —— 尝试恢复被覆盖的权威正文`,
      )
      // 【审查修复】CAS 失配恢复：写新快照时已原子替换旧文件，若不处理，
      // DB 行仍持旧 content_hash 而文件是新正文 → 守卫拒绝 → 条目降级不可读
      // 直到下次成功提交（旧实现把该状态称为"可识别孤儿"，但违反验收矩阵
      // "文件修改、DB 提交失败 → 旧权威版本仍完整"——旧正文确实被覆盖了）。
      // 恢复条件（保守）：行仍在，且行的 content_hash 与我们读取时的旧正文
      // 一致（或 NULL 存量行无哈希）——说明我们覆盖的就是该版本的权威正文，
      // 用读到的 oldBody 原样写回即恢复；行已被进一步推进（hash 不一致）时
      // 我们没有该版本正文，无法安全恢复，保持守卫拒绝态待下次提交自愈。
      // 旧正文读取失败（oldBodyNote 非空）不恢复——避免把空串写回清空文件。
      if (
        current != null &&
        oldBodyNote == null &&
        (current.content_hash == null || current.content_hash === hashBodyForGuard(oldBody))
      ) {
        try {
          await this.store.writeFile({
            meta: {
              id: current.id,
              scope: current.scope,
              scopeRef: current.scope_ref,
              type: current.type,
              name: current.name,
              description: current.description,
              confidence: current.confidence,
              createdAt: current.created_at,
              updatedAt: current.updated_at,
              hitCount: current.hit_count,
              lastHitAt: current.last_hit_at,
              sourceSessionId: current.source_session_id,
              links: [],
              // 归档状态如实写回（行与 frontmatter 一致，旧 CLI 不复活/不误删）
              archived: current.archived === 1,
            },
            body: oldBody,
          })
          log.info(`commitUpdate CAS 失配后已恢复权威正文：${entryId}`)
        } catch (restoreErr) {
          log.warn(
            `commitUpdate CAS 失配后恢复正文失败（守卫拒绝态待下次提交自愈）：${entryId} — ` +
              `${restoreErr instanceof Error ? restoreErr.message : String(restoreErr)}`,
          )
        }
      }
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

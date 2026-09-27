/**
 * @module memory-lifecycle.service
 *
 * 记忆生命周期协调服务（S1B.4 删除协调操作）—— 删除/归档的唯一收敛入口。
 *
 * 删除/归档是跨存储介质的协调操作（DB+FTS+vec / 磁盘 markdown / MEMORY.md
 * 投影），此前桌面 IPC 直接调 repository：DB 清了但磁盘 markdown 残留
 * （E3）、MEMORY.md 投影残留（F4）、归档状态不写回文件 frontmatter 导致旧
 * CLI 跨端复活（E1）。本服务按主计划切片 4 的状态机执行：
 *
 *   pending → barrier_set（DB 屏障：行删除/归档，检索与晚到写入立即不可见）
 *           → cleaning（磁盘 markdown 清理 + MEMORY.md 投影刷新 / 归档写回）
 *           → local_purge_complete（本地完成；sync_pending 留给 S1B.5）
 *           ↘ failed（清理失败：目标路径与意图保留在 memory_operation，
 *              保持待清理，重启或手动重试幂等继续）
 *
 * 屏障先行保证：晚到的异步结果（embedding 回填、整合 CAS、writer 去重）
 * 因目标行不存在/已归档被上游拒绝（S1B.3 条件提交），不会复活已删内容。
 * 每一步幂等：文件不存在视为已清、投影按当前有效条目整体重写、
 * repo.archive 重复调用无害。
 */

import crypto from 'node:crypto'
import { createLogger } from '@spark/shared'
import type {
  MemoryEntryRow,
  MemoryOperationRow,
  MemoryOperationRepository,
  MemoryRepository,
  MemoryRevisionRepository,
} from '@spark/storage'
import { normalizeBodyForGuard } from '@spark/storage'
import type { MemoryStoreService } from './memory-store.service.js'

const log = createLogger('memory:lifecycle')

/** 删除/归档操作的结果（UI 据此展示 pending/complete/blocked_locally） */
export interface LifecycleResult {
  /** complete=本地清理全部完成；blocked_locally=清理失败保持待清理（可重试）；not_found=目标不存在（幂等成功） */
  status: 'complete' | 'blocked_locally' | 'not_found'
  operationId: string | null
  error?: string
}

/** supersede/retract 操作结果（轻量语义操作，不走 memory_operation 状态机） */
export interface SemanticsResult {
  ok: boolean
  status: 'complete' | 'not_found' | 'conflict'
  error?: string
}

export class MemoryLifecycleService {
  constructor(
    private readonly memoryRepo: MemoryRepository,
    private readonly storeService: MemoryStoreService,
    private readonly opRepo: MemoryOperationRepository,
    /**
     * 【S2.2】revision 历史与派生边：supersede/retract 保留当前版本进历史、
     * 记录派生边；delete 物理清理全部历史。缺省 null = 不记录（降级可用）。
     */
    private readonly revisionRepo?: MemoryRevisionRepository | null,
    /**
     * 按 scope 解析 store（project scope 的文件与投影在 workspace 目录下，
     * 需 per-workspace 构造；缺省统一用 storeService——user/agent 单例场景）。
     * 文件清理按行内绝对 file_path 直删不受影响，投影刷新与归档写回依赖它。
     */
    private readonly resolveStore?: (
      scope: 'user' | 'project' | 'agent',
      scopeRef: string | null,
    ) => MemoryStoreService,
  ) {}

  /** 本次操作应使用的 store：scope 感知（project → workspace store） */
  private storeFor(
    scope: 'user' | 'project' | 'agent',
    scopeRef: string | null,
  ): MemoryStoreService {
    return this.resolveStore != null ? this.resolveStore(scope, scopeRef) : this.storeService
  }

  /**
   * 删除一条记忆：DB 屏障 → 磁盘 markdown 清理 → MEMORY.md 投影刷新。
   * 目标不存在时幂等成功（not_found）。
   */
  async deleteEntry(entryId: string): Promise<LifecycleResult> {
    const entry = this.memoryRepo.getById(entryId)
    if (entry == null) {
      log.info(`delete: entry not found (idempotent ok): ${entryId}`)
      return { status: 'not_found', operationId: null }
    }

    const op = this.opRepo.insert({
      id: generateOperationId(),
      kind: 'delete',
      targetId: entryId,
      targetVersion: entry.version,
      targetsJson: JSON.stringify({
        filePath: entry.file_path,
        scope: entry.scope,
        scopeRef: entry.scope_ref,
      }),
    })

    // 1. 屏障：DB+FTS+vec 同事务清除（repo.delete 内含索引清理）。
    // 晚到异步写入（回填/整合/去重）此后因目标行不存在被拒绝。
    // 【S2.2】显式删除是物理清除意愿：revision 历史与派生边一并清理
    //（与 supersede/retract 保留历史相对）
    this.memoryRepo.delete(entryId)
    this.revisionRepo?.deleteAllForMemory(entryId)
    this.opRepo.updateStatus(op.id, 'barrier_set')

    // 2. 磁盘清理 + 投影刷新
    return this.purgeLocalArtifacts(op.id, entry)
  }

  /**
   * 归档一条记忆：DB 屏障（archived=1，检索不可见）→ 归档状态写回文件
   * frontmatter（E1：旧 CLI 以文件为唯一信号，不写回会跨端复活）→
   * MEMORY.md 投影移除（F4）。已归档条目重复归档幂等（补做文件写回与投影）。
   */
  async archiveEntry(entryId: string): Promise<LifecycleResult> {
    const entry = this.memoryRepo.getById(entryId)
    if (entry == null) {
      log.info(`archive: entry not found (idempotent ok): ${entryId}`)
      return { status: 'not_found', operationId: null }
    }

    const op = this.opRepo.insert({
      id: generateOperationId(),
      kind: 'archive',
      targetId: entryId,
      targetVersion: entry.version,
      targetsJson: JSON.stringify({
        filePath: entry.file_path,
        scope: entry.scope,
        scopeRef: entry.scope_ref,
      }),
    })

    // 1. 屏障：archived=1（listByScope/检索/recall 均过滤；writer 去重候选排除）
    this.memoryRepo.archive(entryId)
    this.opRepo.updateStatus(op.id, 'barrier_set')

    // 2. 归档写回文件 + 投影刷新（幂等：上次失败残留的文件态这次补齐）
    this.opRepo.updateStatus(op.id, 'cleaning')
    try {
      await this.writeArchivedToFile(entry)
      await this.refreshProjection(entry.scope, entry.scope_ref)
      this.opRepo.updateStatus(op.id, 'local_purge_complete')
      log.info(`archive complete: ${entryId}（frontmatter 已写回，投影已刷新）`)
      return { status: 'complete', operationId: op.id }
    } catch (err) {
      return this.markFailed(op, err)
    }
  }

  /**
   * 【S2.2】显式替代：oldEntry 的当前版本进 revision 历史（successor 指向
   * newEntry）→ 置 invalid_at + superseded_by → 记派生边 → 投影刷新。
   * 与 delete 的区别：条目与正文文件保留（历史可查），仅停止作为当前事实。
   */
  async supersedeEntry(oldId: string, newId: string, note?: string): Promise<SemanticsResult> {
    const old = this.memoryRepo.getById(oldId)
    if (old == null) return { ok: true, status: 'not_found' }
    if (old.invalid_at != null || old.archived === 1) {
      return { ok: false, status: 'conflict', error: 'entry already inactive' }
    }
    const successor = this.memoryRepo.getById(newId)
    if (successor == null) {
      return { ok: false, status: 'not_found', error: `successor entry not found: ${newId}` }
    }

    let oldBody = ''
    try {
      // 守卫哈希同款规范化，revision 正文口径统一
      oldBody = normalizeBodyForGuard(
        await this.storeFor(old.scope, old.scope_ref).readFile(old.file_path),
      )
    } catch {
      log.warn(`supersede: 旧正文读取失败（历史版本以空正文入档）：${old.file_path}`)
    }

    this.memoryRepo.update(oldId, { invalid_at: Date.now(), superseded_by: newId }, undefined, {
      oldBody,
      kind: 'supersede',
      successorId: newId,
      note: note ?? 'explicit supersede',
    })
    this.revisionRepo?.insertDerivation(oldId, newId, 'supersede')
    await this.refreshProjection(old.scope, old.scope_ref)
    log.info(`supersede complete: ${oldId} → ${newId}`)
    return { ok: true, status: 'complete' }
  }

  /**
   * 【S2.2】撤回作废：条目停止作为当前事实使用（invalid_at，不指向替代者），
   * 当前版本进 revision 历史（kind='retract'）+ 投影刷新。显式历史查询仍可
   * 展示"已作废"（N10），不能以热度复活；正文文件保留。
   */
  async retractEntry(entryId: string, note?: string): Promise<SemanticsResult> {
    const entry = this.memoryRepo.getById(entryId)
    if (entry == null) return { ok: true, status: 'not_found' }
    if (entry.invalid_at != null || entry.archived === 1) {
      // 已失效/归档的重复撤回幂等成功（语义已达成）
      return { ok: true, status: 'complete' }
    }

    let oldBody = ''
    try {
      // 守卫哈希同款规范化，revision 正文口径统一
      oldBody = normalizeBodyForGuard(
        await this.storeFor(entry.scope, entry.scope_ref).readFile(entry.file_path),
      )
    } catch {
      log.warn(`retract: 正文读取失败（历史版本以空正文入档）：${entry.file_path}`)
    }

    this.memoryRepo.update(entryId, { invalid_at: Date.now() }, undefined, {
      oldBody,
      kind: 'retract',
      note: note ?? 'explicit retract',
    })
    await this.refreshProjection(entry.scope, entry.scope_ref)
    log.info(`retract complete: ${entryId}`)
    return { ok: true, status: 'complete' }
  }

  /**
   * 重启恢复：扫描非终态操作逐个幂等重试（清理失败或进程中断的残留）。
   * failed 是终态（不自动重试，避免每次启动重复必然失败的操作），
   * 由 retryFailed() 显式重试。单条失败不阻断其余；返回处理的记录数。
   */
  async resumeUnfinished(): Promise<number> {
    const unfinished = this.opRepo.listUnfinished()
    if (unfinished.length === 0) return 0
    log.info(`resume: ${unfinished.length} unfinished lifecycle operation(s)`)

    for (const op of unfinished) {
      try {
        await this.resumeOne(op)
      } catch (err) {
        // resumeOne 内部已置 failed；此处兜底防止循环中断
        log.warn(
          `resume operation ${op.id} threw (kept failed): ${err instanceof Error ? err.message : String(err)}`,
        )
      }
    }
    return unfinished.length
  }

  /** 显式重试全部 failed 操作（UI 重试入口 / 用户手动触发） */
  async retryFailed(): Promise<number> {
    const failed = this.opRepo.listFailed()
    for (const op of failed) {
      try {
        await this.resumeOne(op)
      } catch (err) {
        log.warn(
          `retry operation ${op.id} threw (kept failed): ${err instanceof Error ? err.message : String(err)}`,
        )
      }
    }
    return failed.length
  }

  // ─── 内部步骤 ─────────────────────────────────────────────────────────

  /** 删除路径的磁盘清理：markdown 文件 + MEMORY.md 投影（幂等） */
  private async purgeLocalArtifacts(opId: string, entry: MemoryEntryRow): Promise<LifecycleResult> {
    this.opRepo.updateStatus(opId, 'cleaning')
    const op = this.opRepo.getById(opId)!
    try {
      // 2a. 删磁盘 markdown（deleteFile 幂等：不存在视为已清）
      await this.storeFor(entry.scope, entry.scope_ref).deleteFile(entry.file_path)
      // 2b. MEMORY.md 投影按当前有效条目整体重写（条目已删，自然移除）
      await this.refreshProjection(entry.scope, entry.scope_ref)
      this.opRepo.updateStatus(opId, 'local_purge_complete')
      log.info(`delete complete: ${entry.id}（文件与投影已清理）`)
      return { status: 'complete', operationId: opId }
    } catch (err) {
      return this.markFailed(op, err)
    }
  }

  /** 单条非终态操作的幂等重试（按 kind 分派；屏障可能已设或未设均安全） */
  private async resumeOne(op: MemoryOperationRow): Promise<void> {
    const targets = parseTargets(op.targets_json)
    if (op.kind === 'delete') {
      // 屏障幂等：行已删时 delete 无害跳过；行仍在（屏障未设完即中断）则补删
      if (this.memoryRepo.getById(op.target_id) != null) {
        this.memoryRepo.delete(op.target_id)
        this.revisionRepo?.deleteAllForMemory(op.target_id)
      }
      this.opRepo.updateStatus(op.id, 'barrier_set')
      await this.purgeLocalArtifacts(op.id, {
        file_path: targets.filePath,
        scope: targets.scope,
        scope_ref: targets.scopeRef,
      } as MemoryEntryRow)
      return
    }
    if (op.kind === 'archive') {
      const entry = this.memoryRepo.getById(op.target_id)
      if (entry == null) {
        // 行已不存在（归档后又被物理删除）：文件清理即终态
        await this.storeFor(targets.scope, targets.scopeRef).deleteFile(targets.filePath)
        this.opRepo.updateStatus(op.id, 'local_purge_complete')
        return
      }
      this.memoryRepo.archive(op.target_id)
      this.opRepo.updateStatus(op.id, 'barrier_set')
      this.opRepo.updateStatus(op.id, 'cleaning')
      try {
        await this.writeArchivedToFile(entry)
        await this.refreshProjection(entry.scope, entry.scope_ref)
        this.opRepo.updateStatus(op.id, 'local_purge_complete')
      } catch (err) {
        this.markFailed(op, err)
      }
      return
    }
    // purge_orphan（孤儿快照清理，S1B.1 失配孤儿枚举接入时启用）：暂无重试动作
    log.debug(`resume: kind=${op.kind} has no resume action yet, skip (${op.id})`)
  }

  /** 归档状态写回文件 frontmatter：读当前正文，meta.archived=true 重写（原子 .tmp→rename） */
  private async writeArchivedToFile(entry: MemoryEntryRow): Promise<void> {
    const store = this.storeFor(entry.scope, entry.scope_ref)
    let body: string
    try {
      body = await store.readFile(entry.file_path)
    } catch {
      /* 文件缺失：写回无从谈起，但归档屏障已在 DB 生效；投影刷新照做 */
      log.warn(
        `archive: file missing, skip frontmatter write-back (DB barrier in effect): ${entry.file_path}`,
      )
      return
    }
    await store.writeFile({
      meta: {
        id: entry.id,
        scope: entry.scope,
        scopeRef: entry.scope_ref,
        type: entry.type,
        name: entry.name,
        description: entry.description,
        confidence: entry.confidence,
        createdAt: entry.created_at,
        updatedAt: Date.now(),
        hitCount: entry.hit_count,
        lastHitAt: entry.last_hit_at,
        sourceSessionId: entry.source_session_id,
        links: [],
        archived: true,
      },
      body,
    })
  }

  /** MEMORY.md 投影按当前有效条目整体重写（delete/archive 后条目不在列表，自然移除） */
  private async refreshProjection(
    scope: 'user' | 'project' | 'agent',
    scopeRef: string | null,
  ): Promise<void> {
    await this.storeFor(scope, scopeRef).updateIndexFile(
      scope,
      scopeRef,
      this.memoryRepo
        .listByScope(scope, scopeRef)
        .map((e) => ({ name: e.name, description: e.description, id: e.id })),
    )
  }

  private markFailed(op: MemoryOperationRow, err: unknown): LifecycleResult {
    const message = err instanceof Error ? err.message : String(err)
    this.opRepo.updateStatus(op.id, 'failed', message)
    log.warn(
      `lifecycle operation ${op.id} (${op.kind} ${op.target_id}) blocked locally: ${message}` +
        `（目标与待清理位置已保留在 memory_operation，可重试）`,
    )
    return { status: 'blocked_locally', operationId: op.id, error: message }
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────

function generateOperationId(): string {
  return `op_${crypto.randomBytes(6).toString('hex')}`
}

interface OperationTargets {
  filePath: string
  scope: 'user' | 'project' | 'agent'
  scopeRef: string | null
}

function parseTargets(json: string): OperationTargets {
  try {
    const parsed = JSON.parse(json) as Partial<OperationTargets>
    return {
      filePath: typeof parsed.filePath === 'string' ? parsed.filePath : '',
      scope: parsed.scope === 'project' || parsed.scope === 'agent' ? parsed.scope : 'user',
      scopeRef: typeof parsed.scopeRef === 'string' ? parsed.scopeRef : null,
    }
  } catch {
    return { filePath: '', scope: 'user', scopeRef: null }
  }
}

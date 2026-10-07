/**
 * @module memory-candidate.service
 *
 * 记忆候选确认服务（S2.3）—— 推断行为规则晋级的唯一确认入口。
 *
 * 设计依据：docs/plans/2026-09-25-memory-lifecycle-hardening-plan.md S2 切片 3
 * 与验收矩阵：
 *   - ELEVATE 提议只入候选区（consolidation 侧改调 candidateRepo.insertPending），
 *     本服务的 confirm() 是唯一的晋级通道，且只能由桌面 IPC（可信界面 /
 *     真实用户操作）触达 —— LLM 工具面不存在该入口（N12：模型自称确认被
 *     结构性拒绝）。
 *   - 确认绑定 candidate id + 内容摘要（content_digest）：候选内容被改写后
 *     旧摘要确认失配拒绝；确认是一次性状态迁移（repo 原子 UPDATE 保证）。
 *   - 确认只覆盖指定版本：条目创建后任何更新（v2+）与确认摘要失配，
 *     isConfirmationCurrent 如实报告过时（新版本不继承旧确认）。
 *   - 同 scope 同摘要不重复征集：重复总结/整合不累积候选票数（N1/N2）。
 */

import { createLogger } from '@spark/shared'
import type {
  MemoryCandidatePayload,
  MemoryCandidateRow,
  MemoryCandidateRepository,
  MemoryEntityRepository,
  MemoryEntryRow,
  MemoryRepository,
  MemoryRevisionRepository,
} from '@spark/storage'
import { hashCandidateContent, normalizeBodyForGuard } from '@spark/storage'
import { MemoryCommitService } from './memory-commit.service.js'
import type { CommitWriteResult } from './memory-commit.service.js'
import { executeMemoryMerge } from './memory-merge-executor.js'
import { appendUpdateHistory, stripTrailingHistorySection } from './memory-body-history.js'
import { isMemorySensitive } from './sanitizer.js'
import type { MemoryStoreService } from './memory-store.service.js'

const log = createLogger('memory:candidate')

const SOURCE_TAG = 'consolidation'

/** 确认失败的结构化原因（IPC 原样透出，UI 按类别提示） */
export type ConfirmFailure =
  | 'not_found'
  | 'not_pending'
  | 'expired'
  | 'digest_mismatch'
  | 'payload_unreadable'
  | 'sensitive_content'
  | 'name_collision'
  | 'commit_failed'
  /** 【P2-A】update 确认时 commitWrite 版本失配（目标被并发更新，可重试） */
  | 'version_conflict'
  /**
   * 【P2-A】枚举预留；P2-B 起 merge 已实现真实路由（confirmMerge），confirm
   * 不再产生该原因（保留枚举兼容既有消费方 / UI 映射）
   */
  | 'unsupported_action'

export type CandidateConfirmResult =
  | { ok: true; candidate: MemoryCandidateRow; entryId: string }
  | { ok: false; reason: ConfirmFailure; message: string }

/** 候选列表的视图行（payload 已解析，解析失败如实标注） */
export interface CandidateViewRow {
  id: number
  scope: 'user' | 'project' | 'agent'
  scopeRef: string | null
  status: string
  createdAt: number
  expiresAt: number
  /** 展示与确认绑定用：候选摘要（UI 确认请求必须原样带回） */
  contentDigest: string
  /** 确认晋级创建的条目 id（未确认为 null） */
  entryId: string | null
  payload: MemoryCandidatePayload | null
}

export class MemoryCandidateService {
  constructor(
    private readonly candidateRepo: MemoryCandidateRepository,
    private readonly commitService: MemoryCommitService,
    private readonly memoryRepo: MemoryRepository,
    private readonly revisionRepo: MemoryRevisionRepository | null,
    private readonly store: MemoryStoreService,
    private readonly entityRepo: MemoryEntityRepository | null = null,
    /**
     * 【审查修复 F1】按 scope 解析 store（project scope 的正文文件在 workspace
     * 目录下，appHome 单例 store 写 project 路径会抛 VALIDATION_FAILED →
     * project 候选确认必失败）。缺省 null = 全部走构造时的默认 store（测试/
     * 单 workspace 场景）。与 lifecycle 服务的 resolveStore 同构。
     */
    private readonly resolveStore: ((scope: 'user' | 'project' | 'agent', scopeRef: string | null) => MemoryStoreService) | null = null,
  ) {}

  /** 按行 scope 解析 store：project → workspace store，其余 → 默认 */
  private storeFor(scope: 'user' | 'project' | 'agent', scopeRef: string | null): MemoryStoreService {
    return this.resolveStore != null ? this.resolveStore(scope, scopeRef) : this.store
  }

  /** 按行 scope 解析 commitService（commit 原语绑定 store，project 须用 workspace store） */
  private commitServiceFor(
    scope: 'user' | 'project' | 'agent',
    scopeRef: string | null,
  ): MemoryCommitService {
    if (this.resolveStore == null) return this.commitService
    return new MemoryCommitService(this.memoryRepo, this.storeFor(scope, scopeRef))
  }

  /** 待确认候选列表（新→旧；payload 损坏行如实返回 null payload） */
  listPending(): CandidateViewRow[] {
    return this.candidateRepo.listByStatus('pending').map((row) => this.toViewRow(row))
  }

  /**
   * 确认晋级：结构化校验（全部通过才做状态迁移）→ 按候选原文创建条目 →
   * 派生边 → 投影刷新。校验失败时候选保持 pending（用户可拒绝处理），
   * 不产生"已确认但无条目"的悬状态。
   */
  async confirm(candidateId: number, expectedDigest: string): Promise<CandidateConfirmResult> {
    // 前置校验（不迁移状态）：存在性 / 载荷可解析 / 敏感内容
    const rowPre = this.candidateRepo.getById(candidateId)
    if (rowPre == null) {
      return { ok: false, reason: 'not_found', message: `候选不存在：${candidateId}` }
    }
    const payloadPre = this.candidateRepo.parsePayload(rowPre)
    if (payloadPre == null) {
      log.warn(`candidate payload unreadable, refusing to promote: id=${candidateId}`)
      return {
        ok: false,
        reason: 'payload_unreadable',
        message: `候选内容不可解析，未创建条目（可在候选区拒绝该条）`,
      }
    }
    // 【S2.4 统一写入不变量】晋级落库前的敏感内容二道防线：用户确认不豁免
    // 敏感闸门（密钥/凭证即使经确认也不落库）
    if (isMemorySensitive(payloadPre.description, payloadPre.body)) {
      log.warn(
        `candidate confirm blocked (rejection_code=sensitive): id=${candidateId} — ` +
          `载荷含敏感信息，拒绝晋级`,
      )
      return {
        ok: false,
        reason: 'sensitive_content',
        message: '候选内容含敏感信息（疑似密钥/凭证），已拒绝保存。',
      }
    }

    // 【P2-A/P2-B】按 payload.action 路由：缺省 create 走既有晋级新建；
    // update/delete/merge 为冲突性写入的确认执行（对 targetId 指向的既有
    // 条目改写 / 合并，见下方分发）。
    const action = payloadPre.action ?? 'create'

    // 【审查修复 F2】崩溃残留恢复：confirm 状态迁移成功但条目 attach 前进程
    // 中断（或 attachSafely 两次重试均失败），行停在 confirmed + entry_id=NULL。
    // 重试会在下方 repo.confirm 处被 not_pending 挡回（旧版自愈分支不可达）——
    // 这里先识别该悬状态：同名有效条目内容确属本候选 → 补 attach 收尾；
    // 不匹配/不存在 → 回滚 pending 走正常重试（届时撞名走 name_collision）。
    if (rowPre.status === 'confirmed' && rowPre.entry_id == null) {
      // 【P2-A/P2-B】update/delete/merge 悬状态不按晋级产物匹配恢复：执行
      // 本身幂等（update 重读目标当前版本 CAS / delete 失效幂等 / merge 重读
      // keep+drops 现势执行），回滚 pending 让用户重试即可安全收敛，不会错绑
      // 无关条目。
      if (action !== 'create') {
        const reverted = this.candidateRepo.revertToPendingIfUnattached(candidateId)
        log.warn(
          `candidate ${action} 确认中断残留，回滚待确认：id=${candidateId}` +
            `${reverted ? '' : '（回滚未生效，请检查行状态）'}`,
        )
        return {
          ok: false,
          reason: 'not_pending',
          message: `确认中断${reverted ? '，候选已恢复为待确认，可重试' : ''}。`,
        }
      }
      return await this.recoverDanglingConfirmed(candidateId, rowPre, payloadPre)
    }

    // 【审查修复 F3】同名预检：候选 pending 期间（TTL 30 天）其他写入方可能已
    // 建立同名有效条目（自动抽取/手工创建/同步导入）。先检出并给出可区分的
    // name_collision（不迁移状态）——不能等到 commitWrite 撞唯一索引后再
    // "自愈"，那会把用户确认的候选正文静默替换为无关同名条目（错绑）。
    // 【P2-A】仅 create 需要预检：update 更新目标自身不构成撞名（候选名是
    // 演化候选名，落库保留目标名），delete 的 findByName 命中即目标自身，
    // 预检都会误拦。
    if (rowPre.status === 'pending' && action === 'create') {
      const collision = this.memoryRepo.findByName(rowPre.scope, rowPre.scope_ref, payloadPre.name)
      if (collision != null) {
        return {
          ok: false,
          reason: 'name_collision',
          message:
            `已存在同名记忆「${payloadPre.name}」（${collision.id}）。` +
            `请先处理该记忆（改名或删除）后再确认本候选，或直接拒绝本候选。`,
        }
      }
    }

    // 状态迁移（一次性；摘要双重比对见 repo.confirm）
    const confirmed = this.candidateRepo.confirm(candidateId, expectedDigest)
    if (!confirmed.ok) {
      const messages: Record<string, string> = {
        not_found: `候选不存在：${candidateId}`,
        not_pending: `候选不在待确认状态（可能已确认/拒绝/过期）：${candidateId}`,
        expired: `候选已过期：${candidateId}`,
        digest_mismatch: `内容摘要失配：候选内容与确认时不一致（改写后不能沿用旧确认）`,
      }
      return {
        ok: false,
        reason: confirmed.reason,
        message: messages[confirmed.reason] ?? confirmed.reason,
      }
    }
    const row = confirmed.candidate
    const payload = payloadPre

    // 【P2-A/P2-B】冲突性写入的确认执行：对 payload.targetId 指向的既有条目
    // 改写/合并（目标行在各自路由内重读；执行口径分别对齐 writer.updateEntry、
    // lifecycle.retractEntry 与 consolidation.applyMerge）。缺 targetId（merge
    // 还包括缺 sourceIds/dropIds）属于载荷残缺（写入侧总是成对写入），回滚
    // pending 如实相告。
    if (action === 'update' || action === 'delete' || action === 'merge') {
      if (payload.targetId == null || (action === 'merge' && payload.sourceIds.length === 0)) {
        const missing = payload.targetId == null ? '目标条目' : '合并来源条目'
        const actionLabel = action === 'update' ? '更新' : action === 'delete' ? '删除' : '合并'
        const reverted = this.candidateRepo.revertToPendingIfUnattached(candidateId)
        log.warn(`candidate ${action} 缺少${missing}，拒绝执行：id=${candidateId}`)
        return {
          ok: false,
          reason: 'payload_unreadable',
          message: `候选缺少${missing}，无法执行${actionLabel}（可拒绝该条）${
            reverted ? '；候选已恢复为待确认' : ''
          }。`,
        }
      }
      return action === 'update'
        ? await this.confirmUpdate(candidateId, row, payload, payload.targetId)
        : action === 'delete'
          ? await this.confirmDelete(candidateId, row, payload, payload.targetId)
          : await this.confirmMerge(candidateId, row, payload, payload.targetId)
    }

    const body = buildPromotedBody(payload)
    // 【审查修复 F1】project scope 的正文文件在 workspace 目录下——按行 scope
    // 解析 commit 原语的 store（appHome 单例写 project 路径会抛错，候选必失败）
    const committed = await this.commitServiceFor(row.scope, row.scope_ref).commitWrite({
      scope: row.scope,
      scopeRef: row.scope_ref,
      type: payload.type,
      name: payload.name,
      description: payload.description,
      confidence: payload.confidence,
      body,
      sourceSessionId: SOURCE_TAG,
      authorRole: SOURCE_TAG,
      extractionKind: SOURCE_TAG,
    })
    let entryId = committed.ok ? committed.row.id : null
    // 可区分联合 narrow 后的失败视图（reason/message 仅失败分支存在）
    const failure: Extract<CommitWriteResult, { ok: false }> | null = committed.ok
      ? null
      : committed
    if (failure != null && failure.reason === 'already_exists') {
      // 【审查修复 F3】预检与 insert 之间的并发窗口兜底：撞唯一索引时仅当同名
      // 条目内容确属本候选晋级产物（正文摘要比对，见 matchesPromotedEntry）才
      // 补 attach；内容不符说明是并发建立的无关条目——不得错绑，回滚 pending
      // 并以 name_collision 如实相告（用户看到的候选正文未被保存）。
      const existing = this.memoryRepo.findByName(row.scope, row.scope_ref, payload.name)
      const isOwn = existing != null && (await this.matchesPromotedEntry(payload, existing, row))
      if (isOwn && existing != null) {
        log.info(
          `candidate promote 命中此前晋级产物（内容校验通过），自愈 attach：candidate=${candidateId} → entry=${existing.id}`,
        )
        entryId = existing.id
      } else {
        const reverted = this.candidateRepo.revertToPendingIfUnattached(candidateId)
        log.warn(
          `candidate promote 撞名且内容不属本候选（拒绝错绑）：candidate=${candidateId}` +
            `${reverted ? '，已回滚为待确认' : ''}`,
        )
        return {
          ok: false,
          reason: 'name_collision',
          message:
            `已存在同名记忆「${payload.name}」且内容与候选不符，候选内容未保存` +
            `${reverted ? '；候选已恢复为待确认，可改名后重试或拒绝' : ''}。`,
        }
      }
    }
    if (entryId == null) {
      // 【审查修复】条目写入失败时回滚候选状态：repo.confirm 已把状态迁移为
      // confirmed，若不回滚会留下"已确认但无条目"（entry_id=NULL）的悬状态——
      // 用户既不能重试（not_pending）也不能拒绝（reject 只对 pending）。
      // 条件回滚只作用于 entry_id 未回填的 confirmed 行，不误伤已晋级候选。
      const reverted = this.candidateRepo.revertToPendingIfUnattached(candidateId)
      log.warn(
        `candidate promote commit failed (${failure?.reason ?? 'unknown'}): candidate=${candidateId}` +
          `${reverted ? '，已回滚为待确认（可重试）' : ''}`,
      )
      return {
        ok: false,
        reason: 'commit_failed',
        message: `晋级写入失败（${failure?.reason ?? 'unknown'}）：${failure?.message ?? ''}${
          reverted ? '；候选已恢复为待确认，可重试或忽略' : ''
        }`,
      }
    }

    await this.finishPromotion(candidateId, row, payload, entryId)
    return {
      ok: true,
      candidate: this.candidateRepo.getById(candidateId)!,
      entryId,
    }
  }

  /**
   * 【审查修复 F2】恢复 confirmed + entry_id=NULL 的悬状态（崩溃残留）。
   * 同名条目内容确属本候选 → 补 attach 并收尾（返回 ok）；否则回滚 pending
   * 返回 name_collision（用户可重试/拒绝，不再死锁）。
   */
  private async recoverDanglingConfirmed(
    candidateId: number,
    row: MemoryCandidateRow,
    payload: MemoryCandidatePayload,
  ): Promise<CandidateConfirmResult> {
    const existing = this.memoryRepo.findByName(row.scope, row.scope_ref, payload.name)
    if (existing != null && (await this.matchesPromotedEntry(payload, existing, row))) {
      log.info(
        `candidate 崩溃残留恢复：补齐 attach：candidate=${candidateId} → entry=${existing.id}`,
      )
      await this.finishPromotion(candidateId, row, payload, existing.id)
      return { ok: true, candidate: this.candidateRepo.getById(candidateId)!, entryId: existing.id }
    }
    const reverted = this.candidateRepo.revertToPendingIfUnattached(candidateId)
    log.warn(
      `candidate 悬状态无法匹配到晋级产物，回滚待确认：candidate=${candidateId}` +
        `${reverted ? '' : '（回滚未生效，请检查行状态）'}`,
    )
    return {
      ok: false,
      reason: 'name_collision',
      message: `此前确认中断且无法匹配到已保存的条目${
        reverted ? '，候选已恢复为待确认，可重试' : ''
      }。`,
    }
  }

  /**
   * 【P2-A】冲突性 UPDATE 的确认执行：对 targetId 指向的既有条目做 CAS 更新，
   * 口径对齐 writer.updateEntry —— 保留目标 name 与命中统计（preserveFrom），
   * 正文用候选暂存的演化后正文，来源固定 consolidation（改写经用户确认）。
   * 目标不存在/已归档 → not_found；版本失配（目标被并发更新）→ 透传
   * version_conflict；失败均回滚 pending 可重试，不留"已确认但未执行"悬状态。
   */
  private async confirmUpdate(
    candidateId: number,
    row: MemoryCandidateRow,
    payload: MemoryCandidatePayload,
    targetId: string,
  ): Promise<CandidateConfirmResult> {
    const target = this.memoryRepo.getById(targetId)
    if (target == null || target.archived === 1) {
      const reverted = this.candidateRepo.revertToPendingIfUnattached(candidateId)
      log.warn(
        `candidate update 目标不存在或已归档：candidate=${candidateId} target=${targetId}` +
          `${reverted ? '，已回滚为待确认（可拒绝处理）' : ''}`,
      )
      return {
        ok: false,
        reason: 'not_found',
        message: `目标记忆不存在或已归档${reverted ? '，候选已恢复为待确认，可直接拒绝' : ''}。`,
      }
    }
    // 【审查修复】History 段挪到确认落库时合成：候选征集时正文保持无时间戳
    // 的稳定口径（digest 去重依赖），此处与自动 updateEntry 同口径追加旧正文
    // 摘录（stamp 取确认时刻 —— 更新实际发生于此）。读不到旧正文时降级为
    // 候选暂存原文，不阻断确认。
    const oldBody = await this.storeFor(target.scope, target.scope_ref)
      .readFile(target.file_path)
      .catch(() => '')
    const body = appendUpdateHistory(
      payload.body,
      oldBody,
      payload.name,
      new Date().toISOString(),
    )
    const committed = await this.commitServiceFor(target.scope, target.scope_ref).commitWrite({
      entryId: target.id,
      expectedVersion: target.version,
      scope: target.scope,
      scopeRef: target.scope_ref,
      type: payload.type,
      name: target.name,
      description: payload.description,
      confidence: payload.confidence,
      body,
      sourceSessionId: SOURCE_TAG,
      authorRole: SOURCE_TAG,
      extractionKind: SOURCE_TAG,
      preserveFrom: target,
    })
    if (!committed.ok) {
      const reverted = this.candidateRepo.revertToPendingIfUnattached(candidateId)
      log.warn(
        `candidate update commit failed (${committed.reason}): candidate=${candidateId} ` +
          `target=${targetId}${reverted ? '，已回滚为待确认（可重试）' : ''}`,
      )
      return {
        ok: false,
        reason: committed.reason === 'version_conflict' ? 'version_conflict' : 'commit_failed',
        message:
          `更新写入失败（${committed.reason}）：${committed.message}` +
          `${reverted ? '；候选已恢复为待确认，可重试' : ''}`,
      }
    }
    await this.finishPromotion(candidateId, row, payload, target.id, 'updated')
    return { ok: true, candidate: this.candidateRepo.getById(candidateId)!, entryId: target.id }
  }

  /**
   * 【P2-A】冲突性 DELETE 的确认执行：标记 targetId 指向的既有条目失效
   * （bi-temporal，不物理删除），口径对齐 lifecycle.retractEntry —— 当前版本
   * 进 revision 历史（kind='retract'），FTS/索引随 update 事务清理，收尾复用
   * finishPromotion（attach + 投影刷新）。目标已失效/归档视为幂等成功
   * （删除语义已达成）。
   */
  private async confirmDelete(
    candidateId: number,
    row: MemoryCandidateRow,
    payload: MemoryCandidatePayload,
    targetId: string,
  ): Promise<CandidateConfirmResult> {
    const target = this.memoryRepo.getById(targetId)
    if (target == null) {
      const reverted = this.candidateRepo.revertToPendingIfUnattached(candidateId)
      log.warn(
        `candidate delete 目标不存在：candidate=${candidateId} target=${targetId}` +
          `${reverted ? '，已回滚为待确认' : ''}`,
      )
      return {
        ok: false,
        reason: 'not_found',
        message: `目标记忆不存在${reverted ? '，候选已恢复为待确认，可直接拒绝' : ''}。`,
      }
    }
    if (target.invalid_at == null && target.archived === 0) {
      let oldBody = ''
      try {
        // 守卫哈希同款规范化，revision 正文口径统一（与 retractEntry 一致）
        oldBody = normalizeBodyForGuard(
          await this.storeFor(target.scope, target.scope_ref).readFile(target.file_path),
        )
      } catch {
        log.warn(`candidate delete: 正文读取失败（历史版本以空正文入档）：${target.file_path}`)
      }
      this.memoryRepo.update(targetId, { invalid_at: Date.now(), superseded_by: null }, undefined, {
        oldBody,
        kind: 'retract',
        note: '候选确认删除',
      })
    }
    await this.finishPromotion(candidateId, row, payload, target.id, 'deleted')
    return { ok: true, candidate: this.candidateRepo.getById(candidateId)!, entryId: target.id }
  }

  /**
   * 【P2-B】冲突性 MERGE 的确认执行：对 targetId（keep）执行候选暂存的合并 —
   * 描述/正文用候选征集时的合并产物（确认绑定 content_digest，"展示什么就
   * 存什么"），执行段与 consolidation.applyMerge 共用 executeMemoryMerge
   * （commitWrite revisionKind='merge' + drops 失效指向 keep + 派生边）。
   *
   * 目标不存在/已归档 → not_found；keep 被并发修改 → version_conflict；失败
   * 均回滚 pending 可重试，不留"已确认但未执行"悬状态。drops（sourceIds）
   * 确认时逐个重读现势：部分失效 → 只合并仍有效的；全部失效/不存在 → 幂等
   * 成功（合并语义已达成，keep 视为已合并直接收尾）。
   */
  private async confirmMerge(
    candidateId: number,
    row: MemoryCandidateRow,
    payload: MemoryCandidatePayload,
    targetId: string,
  ): Promise<CandidateConfirmResult> {
    const keep = this.memoryRepo.getById(targetId)
    if (keep == null || keep.archived === 1) {
      const reverted = this.candidateRepo.revertToPendingIfUnattached(candidateId)
      log.warn(
        `candidate merge 目标不存在或已归档：candidate=${candidateId} target=${targetId}` +
          `${reverted ? '，已回滚为待确认（可拒绝处理）' : ''}`,
      )
      return {
        ok: false,
        reason: 'not_found',
        message: `合并目标记忆不存在或已归档${reverted ? '，候选已恢复为待确认，可直接拒绝' : ''}。`,
      }
    }

    // 重读 drops（sourceIds = dropIds）：只合并仍有效的（与 applyMerge 同过滤
    // 口径：不存在/已失效/自引用跳过）；正文按守卫规范口径现读，随 supersede
    // revision 入档
    const drops: MemoryEntryRow[] = []
    const dropBodies = new Map<string, string>()
    for (const dropId of payload.sourceIds) {
      const drop = this.memoryRepo.getById(dropId)
      if (drop == null || drop.invalid_at != null || drop.id === keep.id) continue
      drops.push(drop)
      try {
        dropBodies.set(
          drop.id,
          normalizeBodyForGuard(
            await this.storeFor(drop.scope, drop.scope_ref).readFile(drop.file_path).catch(() => ''),
          ),
        )
      } catch {
        /* 读不到也继续（supersede 历史以空正文入档） */
      }
    }

    if (drops.length > 0) {
      const merged = await executeMemoryMerge({
        keep,
        drops,
        mergedDescription: payload.description,
        mergedBody: payload.body,
        dropBodies,
        commitService: this.commitServiceFor(keep.scope, keep.scope_ref),
        memoryRepo: this.memoryRepo,
        revisionRepo: this.revisionRepo,
        note: '候选确认合并',
      })
      if (!merged.ok) {
        const reverted = this.candidateRepo.revertToPendingIfUnattached(candidateId)
        log.warn(
          `candidate merge commit failed (${merged.reason}): candidate=${candidateId} ` +
            `keep=${targetId}${reverted ? '，已回滚为待确认（可重试）' : ''}`,
        )
        return {
          ok: false,
          reason: merged.reason,
          message:
            `合并写入失败（${merged.reason}）：${merged.message}` +
            `${reverted ? '；候选已恢复为待确认，可重试或拒绝' : ''}`,
        }
      }
    }

    // 全部 drop 已失效/不存在（drops.length === 0）→ 幂等成功：keep 视为已合并
    await this.finishPromotion(candidateId, row, payload, keep.id, 'merged')
    return { ok: true, candidate: this.candidateRepo.getById(candidateId)!, entryId: keep.id }
  }

  /**
   * 晋级收尾（confirm 成功路径与崩溃恢复共用）：attach → 派生边 → 实体 →
   * 投影刷新。全部幂等，可安全重复执行。
   */
  private async finishPromotion(
    candidateId: number,
    row: MemoryCandidateRow,
    payload: MemoryCandidatePayload,
    entryId: string,
    /** 收尾日志的动作标签（create=promoted / update / delete / merge；其余行为一致） */
    logAction: 'promoted' | 'updated' | 'deleted' | 'merged' = 'promoted',
  ): Promise<void> {
    this.attachSafely(candidateId, entryId)
    // 派生边：来源条目 → 晋级条目（elevate）—— H2 纠正影响传播可沿边追溯。
    // 【P2-B】merge 候选的 sourceIds 是合并依据（drop → keep），派生边已由
    // executeMemoryMerge 以 kind='merge' 记录，不在此重复记 elevate 边。
    if ((payload.action ?? 'create') !== 'merge') {
      for (const sourceId of payload.sourceIds) {
        try {
          if (this.memoryRepo.getById(sourceId) != null) {
            this.revisionRepo?.insertDerivation(sourceId, entryId, 'elevate')
          }
        } catch (err) {
          log.warn(
            `derivation edge insert failed (non-fatal): ${sourceId} → ${entryId}: ` +
              `${err instanceof Error ? err.message : String(err)}`,
          )
        }
      }
    }
    // 实体落库（ELEVATE 抽取结果随确认生效）
    if (this.entityRepo != null && Array.isArray(payload.entities)) {
      try {
        this.entityRepo.upsertEntitiesForMemory(entryId, row.scope, row.scope_ref, payload.entities)
      } catch (err) {
        log.warn(
          `candidate entities upsert failed (non-fatal): ${err instanceof Error ? err.message : String(err)}`,
        )
      }
    }
    await this.refreshIndex(row.scope, row.scope_ref)
    log.info(
      `candidate ${logAction}: id=${candidateId} → entry=${entryId} ` +
        `(${row.scope}/${row.scope_ref ?? '∅'} "${payload.name}")`,
    )
  }

  /**
   * 【审查修复 F3】同名条目是否确属本候选的晋级产物：按候选晋级正文口径
   * （buildPromotedBody）与条目当前 name/description/文件正文做摘要比对。
   * 读取失败按不匹配处理（不采信不可读正文）。
   */
  private async matchesPromotedEntry(
    payload: MemoryCandidatePayload,
    entry: { id: string; file_path: string; name: string; description: string },
    row: MemoryCandidateRow,
  ): Promise<boolean> {
    let fileBody: string
    try {
      fileBody = normalizeBodyForGuard(
        await this.storeFor(row.scope, row.scope_ref).readFile(entry.file_path),
      )
    } catch {
      return false
    }
    const expected = hashCandidateContent(
      payload.name,
      payload.description,
      normalizeBodyForGuard(buildConfirmedBodyForCurrency(payload)),
    )
    const actual = hashCandidateContent(entry.name, entry.description, fileBody)
    return expected === actual
  }

  /** 用户拒绝（幂等；非 pending 返回当前状态） */
  reject(candidateId: number): { ok: boolean; row: MemoryCandidateRow | null } {
    const result = this.candidateRepo.reject(candidateId)
    if (result.ok) {
      log.info(`candidate rejected by user: id=${candidateId}`)
    }
    return result
  }

  /**
   * 【审查修复】attach 容错：entry_id 回填是幂等 UPDATE，但同步 DB 调用仍可能
   * 抛瞬时异常——若放任传播，条目已创建而候选悬在 confirmed 无 entry_id。
   * 失败重试一次；仍失败仅记日志（候选行保持 confirmed 无 entry_id，用户重试
   * 确认会经 recoverDanglingConfirmed 悬状态恢复路径补齐 attach，不死锁）。
   */
  private attachSafely(candidateId: number, entryId: string): void {
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        this.candidateRepo.attachEntry(candidateId, entryId)
        return
      } catch (err) {
        log.warn(
          `candidate attachEntry 失败（attempt ${attempt}/2，重试可经 already_exists 自愈）：` +
            `candidate=${candidateId} entry=${entryId} — ` +
            `${err instanceof Error ? err.message : String(err)}`,
        )
      }
    }
  }

  /**
   * 确认是否仍覆盖条目当前版本：候选确认后条目被更新（v2+）→ false，
   * 展示层据此显示"确认已过时"而非继承（确认只覆盖指定版本）。
   * 口径：晋级时的规范正文（payload 原文 + 升华来源段，与 confirm 落库
   * 格式一致）vs 条目当前 name/description + 文件正文；读取失败按过时
   * 处理（不采信不可读正文）。
   */
  async isConfirmationCurrent(candidateId: number): Promise<boolean> {
    const row = this.candidateRepo.getById(candidateId)
    if (row == null || row.entry_id == null) return false
    const entry = this.memoryRepo.getById(row.entry_id)
    if (entry == null) return false
    const payload = this.candidateRepo.parsePayload(row)
    if (payload == null) return false
    let fileBody: string
    try {
      // 守卫哈希同款规范化（去 render 追加的尾部换行），与写入侧口径一致；
      // store 按行 scope 解析（project → workspace store）
      fileBody = normalizeBodyForGuard(
        await this.storeFor(row.scope, row.scope_ref).readFile(entry.file_path),
      )
    } catch {
      return false
    }
    // 【审查修复】货币性比对口径按动作分化：create 比对晋级正文（含升华来源
    // 段）；update/merge 按候选暂存正文原样落库，须用 buildConfirmedBodyForCurrency
    // （此前误用 buildPromotedBody，确认后必误报"过时"）。name：update/merge
    // 落库保留目标名（confirmUpdate/confirmMerge 传 keep/target.name），候选
    // payload.name 是演化建议名、从未落库，且确认时目标名无快照可回溯 ——
    // name 不参与该类候选的货币性比对（后续任何改写都会更新正文文件，由
    // body 比对覆盖）。
    const action = payload.action ?? 'create'
    const expected = hashCandidateContent(
      action === 'create' ? payload.name : entry.name,
      payload.description,
      normalizeBodyForGuard(buildConfirmedBodyForCurrency(payload)),
    )
    // update 确认落库会追加 History 尾段（含确认时刻时间戳，比对侧无法重建）：
    // 剥掉首个 History 标记之后的内容还原确认口径。后续演化产生的新正文位于
    // 最前，剥后与暂存正文必不相等，仍能正确判"过时"。
    const fileBodyForCompare =
      action === 'update' ? stripTrailingHistorySection(fileBody) : fileBody
    const current = hashCandidateContent(entry.name, entry.description, fileBodyForCompare)
    return expected === current
  }

  private toViewRow(row: MemoryCandidateRow): CandidateViewRow {
    return {
      id: row.id,
      scope: row.scope,
      scopeRef: row.scope_ref,
      status: row.status,
      createdAt: row.created_at,
      expiresAt: row.expires_at,
      contentDigest: row.content_digest,
      entryId: row.entry_id,
      payload: this.candidateRepo.parsePayload(row),
    }
  }

  private async refreshIndex(
    scope: 'user' | 'project' | 'agent',
    scopeRef: string | null,
  ): Promise<void> {
    try {
      const entries = this.memoryRepo.listByScope(scope, scopeRef)
      await this.storeFor(scope, scopeRef).updateIndexFile(
        scope,
        scopeRef,
        entries.map((e) => ({ name: e.name, description: e.description, id: e.id })),
      )
    } catch (err) {
      log.warn(
        `refreshIndex failed for ${scope}: ${err instanceof Error ? err.message : String(err)}`,
      )
    }
  }
}

/** 晋级落库的规范正文：候选原文 + 升华来源段（confirm 与确认货币性校验共用口径） */
function buildPromotedBody(payload: MemoryCandidatePayload): string {
  return `${payload.body}\n\n## 升华来源\n${payload.sourceIds.map((id) => `- [${id}]`).join('\n')}`
}

/**
 * 确认货币性比对的落库口径：create 晋级正文带升华来源段（buildPromotedBody）；
 * 【P2-A/P2-B】update/merge 按候选暂存正文原样落库（confirmUpdate/confirmMerge
 * 不追加来源段），非 create 一律按 payload.body 比对 —— 否则合并/更新确认后
 * isConfirmationCurrent 会立即误报"确认已过时"。
 */
function buildConfirmedBodyForCurrency(payload: MemoryCandidatePayload): string {
  return (payload.action ?? 'create') === 'create' ? buildPromotedBody(payload) : payload.body
}

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
  MemoryRepository,
  MemoryRevisionRepository,
} from '@spark/storage'
import { hashCandidateContent, normalizeBodyForGuard } from '@spark/storage'
import { MemoryCommitService } from './memory-commit.service.js'
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
  | 'commit_failed'

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
  ) {}

  /** 待确认候选列表（新→旧；payload 损坏行如实返回 null payload） */
  listPending(): CandidateViewRow[] {
    return this.candidateRepo.listByStatus('pending').map((row) => this.toViewRow(row))
  }

  /** 确认晋级：结构化校验 → 按候选原文创建条目 → 派生边 → 投影刷新 */
  async confirm(candidateId: number, expectedDigest: string): Promise<CandidateConfirmResult> {
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
    const payload = this.candidateRepo.parsePayload(row)
    if (payload == null) {
      // 载荷不可解析：不按不可读内容创建条目，候选置回可拒绝态由用户处理
      log.warn(`candidate payload unreadable, refusing to promote: id=${candidateId}`)
      return {
        ok: false,
        reason: 'payload_unreadable',
        message: `候选内容不可解析，未创建条目（可在候选区拒绝该条）`,
      }
    }

    const body = buildPromotedBody(payload)
    const committed = await this.commitService.commitWrite({
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
    if (!committed.ok) {
      log.warn(`candidate promote commit failed (${committed.reason}): candidate=${candidateId}`)
      return {
        ok: false,
        reason: 'commit_failed',
        message: `晋级写入失败（${committed.reason}）：${committed.message}`,
      }
    }

    this.candidateRepo.attachEntry(candidateId, committed.row.id)
    // 派生边：来源条目 → 晋级条目（elevate）—— H2 纠正影响传播可沿边追溯
    for (const sourceId of payload.sourceIds) {
      try {
        if (this.memoryRepo.getById(sourceId) != null) {
          this.revisionRepo?.insertDerivation(sourceId, committed.row.id, 'elevate')
        }
      } catch (err) {
        log.warn(
          `derivation edge insert failed (non-fatal): ${sourceId} → ${committed.row.id}: ` +
            `${err instanceof Error ? err.message : String(err)}`,
        )
      }
    }
    // 实体落库（ELEVATE 抽取结果随确认生效）
    if (this.entityRepo != null && Array.isArray(payload.entities)) {
      try {
        this.entityRepo.upsertEntitiesForMemory(
          committed.row.id,
          row.scope,
          row.scope_ref,
          payload.entities,
        )
      } catch (err) {
        log.warn(
          `candidate entities upsert failed (non-fatal): ${err instanceof Error ? err.message : String(err)}`,
        )
      }
    }
    await this.refreshIndex(row.scope, row.scope_ref)
    log.info(
      `candidate promoted: id=${candidateId} → entry=${committed.row.id} ` +
        `(${row.scope}/${row.scope_ref ?? '∅'} "${payload.name}")`,
    )
    return {
      ok: true,
      candidate: this.candidateRepo.getById(candidateId)!,
      entryId: committed.row.id,
    }
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
      // 守卫哈希同款规范化（去 render 追加的尾部换行），与写入侧口径一致
      fileBody = normalizeBodyForGuard(await this.store.readFile(entry.file_path))
    } catch {
      return false
    }
    const expected = hashCandidateContent(
      payload.name,
      payload.description,
      normalizeBodyForGuard(buildPromotedBody(payload)),
    )
    const current = hashCandidateContent(entry.name, entry.description, fileBody)
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
      await this.store.updateIndexFile(
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

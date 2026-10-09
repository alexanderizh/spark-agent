/**
 * @module dream-memory-sink
 *
 * 记忆轨梦境提案执行器：把通过校验的 DreamMemoryProposal 落进既有候选管线。
 *
 * 路径（复用 memory-candidate 全链路，不另造写通道）：
 *   create/update/merge/delete → candidateRepo.insertPending（action/targetId 语义
 *   由候选管线原生支持）→ outcome='auto-applied' 时立即 candidateService.confirm
 *   （服务端按用户配置阈值代确认，author 来源仍是候选管线既定行为，非 LLM
 *   自称确认）；'pending-review' 时留在候选区等真实用户人审。
 *
 * N12 红线对齐：confirm() 的「只能由可信界面触达」约束针对 LLM 工具面——
 * 本 sink 是服务端编排器代码，依据是用户显式配置的 autoApplyThreshold
 * （配置即预授权），且 auto-applied 全程写审计日志（dream runId 溯源）。
 *
 * S1 范围：记忆轨梦境整理 user scope（全局记忆层，会话注入的主战场）；
 * project/agent scope 扩展留后续版本（进度追踪表已注明）。
 */

import { createLogger } from '@spark/shared'
import type {
  DreamMemoryProposal,
  DreamProposalOutcome,
  DreamProposalResult,
} from '@spark/protocol'
import type {
  MemoryCandidateRepository,
  MemoryCandidateRow,
  MemoryRepository,
} from '@spark/storage'
import type { MemoryCandidateService } from '../memory/memory-candidate.service.js'

const log = createLogger('dream:memory-sink')

/** 记忆轨梦境固定落在 user scope（全局层） */
const DREAM_MEMORY_SCOPE = 'user' as const

export interface DreamMemorySinkDeps {
  candidateRepo: MemoryCandidateRepository
  candidateService: MemoryCandidateService
  memoryRepo: MemoryRepository
}

export class DreamMemoryProposalSink {
  private readonly deps: DreamMemorySinkDeps

  constructor(deps: DreamMemorySinkDeps) {
    this.deps = deps
  }

  /** Orient 现状快照：user scope 活跃条目的索引摘要（id/类型/名称/置信度/更新时间） */
  buildOrientDigest(limit: number): string {
    const entries = this.deps.memoryRepo
      .listByScope(DREAM_MEMORY_SCOPE, null)
      .filter((e) => e.invalid_at == null)
    if (entries.length === 0) {
      return '（记忆库 user 层当前为空——首次整理，重点从回看窗口的会话中提取沉淀。）'
    }
    const lines = entries.slice(0, limit).map((e) => {
      const updated = new Date(e.updated_at ?? e.created_at ?? Date.now())
      const ymd = `${updated.getFullYear()}-${String(updated.getMonth() + 1).padStart(2, '0')}-${String(updated.getDate()).padStart(2, '0')}`
      return `- [${e.id}] (${e.type}) ${e.name} — 更新于 ${ymd}`
    })
    const overflow =
      entries.length > limit ? `\n…（共 ${entries.length} 条，仅列前 ${limit} 条）` : ''
    return `user 层活跃记忆共 ${entries.length} 条：\n${lines.join('\n')}${overflow}`
  }

  async apply(
    proposal: DreamMemoryProposal,
    outcome: DreamProposalOutcome,
  ): Promise<DreamProposalResult> {
    if (proposal.kind !== 'memory') {
      return { outcome: 'rejected-invalid', note: '记忆轨 sink 收到 wiki 提案' }
    }

    // 目标存在性前置校验：update/merge/delete 的 targetId、merge 的 mergeTargetId
    // 必须指向现存条目，防梦境幻觉 id 直接制造悬空候选（confirm 时会失败，
    // 提前拒收给人看清楚原因）
    if (proposal.targetId != null) {
      const target = this.deps.memoryRepo.getById(proposal.targetId)
      if (target == null || target.invalid_at != null) {
        return {
          outcome: 'rejected-invalid',
          note: `目标条目 ${proposal.targetId} 不存在或已失效`,
        }
      }
    }
    if (proposal.op === 'merge' && proposal.mergeTargetId != null) {
      const keep = this.deps.memoryRepo.getById(proposal.mergeTargetId)
      if (keep == null || keep.invalid_at != null) {
        return {
          outcome: 'rejected-invalid',
          note: `合并保留条目 ${proposal.mergeTargetId} 不存在或已失效`,
        }
      }
    }

    // merge 提案必须携带合并后的完整 body：memory 候选管线的 confirmMerge 以
    // payload.body 作为合并后正文整体落 keep —— 缺 body 时若回退 rationale 摘要，
    // 确认执行会用一句 200 字摘要覆盖保留条目全部正文，宁拒勿糊。
    if (proposal.op === 'merge' && (proposal.payload?.body ?? '').trim().length === 0) {
      return {
        outcome: 'rejected-invalid',
        note: 'merge 提案必须携带 payload.body（合并后的完整正文）',
      }
    }

    const referencedMemoryIds = proposal.sourceRefs
      .filter((r) => r.kind === 'memory')
      .map((r) => r.id)
    const digestNote = `dream:${proposal.rationale.slice(0, 200)}`

    // 【语义翻译】dream 提案：targetId=被并方（失效）、mergeTargetId=保留方；
    // memory 候选管线：targetId=keep（保留）、sourceIds=drops（被并失效）——
    // 两套约定方向相反，必须翻译后再进候选，否则 confirmMerge 会把保留方
    // 当被并方失效，合并方向整体颠倒。
    let candidateTargetId = proposal.targetId
    let sourceIds: string[]
    if (proposal.op === 'merge' && proposal.mergeTargetId != null) {
      candidateTargetId = proposal.mergeTargetId
      sourceIds = Array.from(
        new Set(
          referencedMemoryIds.filter(
            (id) => id !== proposal.mergeTargetId && id !== proposal.targetId,
          ),
        ),
      )
      if (proposal.targetId != null) sourceIds.unshift(proposal.targetId)
    } else {
      sourceIds = referencedMemoryIds.filter((id) => id !== proposal.targetId)
    }

    const { inserted, row } = this.deps.candidateRepo.insertPending(
      {
        scope: DREAM_MEMORY_SCOPE,
        scopeRef: null,
        payload: {
          type: proposal.payload?.type ?? 'user',
          name: proposal.payload?.name ?? proposal.rationale.slice(0, 60),
          description: proposal.payload?.description ?? `自动整编提案（${proposal.op}）`,
          body: proposal.payload?.body ?? digestNote,
          confidence: proposal.confidence,
          sourceIds,
          action: proposal.op,
          ...(candidateTargetId != null ? { targetId: candidateTargetId } : {}),
        },
      },
      // 【容量保护】dream 与会话抽取共用 user scope，缺省 maxPending=20 会让
      // 梦境批量落候选（batchLimit 默认 50）按 created_at 挤掉用户待审候选。
      // dream 插入按 200 配额腾位；用户抽取路径仍按 20 上限——双向挤压中被
      // 淘汰的只可能是 dream 自己的早期候选（价值密度低于用户实时抽取）。
      { maxPending: 200 },
    )

    if (!inserted || row == null) {
      // 同摘要候选已存在（pending/confirmed/rejected/expired 均算）——不重复征集
      return {
        outcome: 'rejected-invalid',
        note: '同内容候选已存在（digest 去重命中），未重复征集',
        ...(row != null ? { refId: `candidate:${row.id}` } : {}),
      }
    }

    if (outcome !== 'auto-applied') {
      return { outcome: 'pending-review', refId: `candidate:${row.id}` }
    }

    // 服务端代确认（用户阈值预授权）：失败时候选保持 pending 落人审，不丢提案
    const confirmResult = await this.deps.candidateService.confirm(row.id, row.content_digest)
    if (confirmResult.ok) {
      log.info(
        `dream memory proposal auto-applied: candidate=${row.id} op=${proposal.op} ` +
          `target=${proposal.targetId ?? '-'} entry=${confirmResult.entryId}`,
      )
      return { outcome: 'auto-applied', refId: `candidate:${row.id}` }
    }
    log.warn(
      `dream auto-confirm fell back to pending: candidate=${row.id} ` +
        `reason=${confirmResult.reason} (${confirmResult.message})`,
    )
    return {
      outcome: 'pending-review',
      refId: `candidate:${row.id}`,
      note: `自动确认未成功（${confirmResult.reason}），转人审`,
    }
  }
}

/** 便于编排器类型收窄：候选行 id 提取（审计/跳转用） */
export function candidateRefId(row: MemoryCandidateRow | null): string | undefined {
  return row != null ? `candidate:${row.id}` : undefined
}

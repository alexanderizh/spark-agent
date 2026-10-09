/**
 * @module dream-wiki-sink
 *
 * 知识库轨梦境提案执行器：把通过校验的 DreamWikiProposal 落进 wiki 候选管线。
 *
 * 路径（复用 wiki-candidate 全链路 + action 扩展路由，不另造写通道）：
 *   create → insertPending（候选管线原生）→ auto-applied 时 confirm（服务端按
 *   用户阈值预授权代确认）；update/delete/merge → insertPending（payload.action
 *   扩展，wiki-candidate.service.confirmPageAction 执行；delete 走 archivePage
 *   软删可恢复）。
 *
 * S2 范围：wiki 轨梦境整理 user scope 空间（与记忆轨 user 层对齐——两条轨的
 * 全局层是会话注入的主战场）；project/agent/team 空间扩展留后续版本。
 */

import { createLogger } from '@spark/shared'
import type { DreamProposalOutcome, DreamProposalResult, DreamWikiProposal } from '@spark/protocol'
import type {
  WikiCandidateRepository,
  WikiPageRepository,
  WikiSpaceRepository,
} from '@spark/storage'
import type { WikiCandidateService } from '../wiki/wiki-candidate.service.js'

const log = createLogger('dream:wiki-sink')

/** wiki 轨梦境固定落在 user scope */
const DREAM_WIKI_SCOPE = 'user' as const

export interface DreamWikiSinkDeps {
  candidateService: WikiCandidateService
  candidateRepo: WikiCandidateRepository
  spaceRepo: WikiSpaceRepository
  pageRepo: WikiPageRepository
}

export class DreamWikiProposalSink {
  private readonly deps: DreamWikiSinkDeps

  constructor(deps: DreamWikiSinkDeps) {
    this.deps = deps
  }

  /** Orient 现状快照：user scope 空间列表 + 每空间根页面标题树（截断限流） */
  buildOrientDigest(limit: number): string {
    const spaces = this.deps.spaceRepo.listByScopes([{ scope: DREAM_WIKI_SCOPE, scopeRef: null }])
    if (spaces.length === 0) {
      return '（知识库 user 层当前没有空间——重点从回看窗口的会话中提取新知识沉淀，create 提案可省略 spaceId 由确认时兜底创建默认空间。）'
    }
    const lines: string[] = [`user 层共 ${spaces.length} 个空间：`]
    for (const space of spaces.slice(0, 12)) {
      const pages = this.deps.pageRepo
        .listBySpace(space.id, { parentId: null, limit })
        .filter((p) => p.status !== 'archived')
      lines.push(`- 空间「${space.name}」（${space.id}）：${pages.length} 个根页面`)
      for (const p of pages.slice(0, limit)) {
        lines.push(`  - [${p.id}] ${p.title}（${p.kind}，v${p.version}）`)
      }
    }
    return lines.join('\n')
  }

  async apply(
    proposal: DreamWikiProposal,
    outcome: DreamProposalOutcome,
  ): Promise<DreamProposalResult> {
    if (proposal.kind !== 'wiki') {
      return { outcome: 'rejected-invalid', note: 'wiki 轨 sink 收到 memory 提案' }
    }

    // 目标存在性前置校验：防梦境幻觉页面 id 制造悬空候选
    if (proposal.targetId != null) {
      const target = this.deps.pageRepo.getById(proposal.targetId)
      if (target == null || target.status === 'archived') {
        return { outcome: 'rejected-invalid', note: `目标页面 ${proposal.targetId} 不存在或已归档` }
      }
    }
    if (proposal.op === 'merge' && proposal.mergeTargetId != null) {
      const keep = this.deps.pageRepo.getById(proposal.mergeTargetId)
      if (keep == null || keep.status === 'archived') {
        return {
          outcome: 'rejected-invalid',
          note: `合并保留页 ${proposal.mergeTargetId} 不存在或已归档`,
        }
      }
    }

    // delete/merge 无 payload：从目标页读现状填充候选展示字段（人审要看到删的是什么）
    let title = proposal.payload?.title ?? ''
    let summary = proposal.payload?.summary ?? ''
    let body = proposal.payload?.body ?? ''
    const tags = proposal.payload?.tags ?? []
    if (proposal.op === 'delete' && proposal.targetId != null) {
      const target = this.deps.pageRepo.getById(proposal.targetId)
      if (target != null) {
        title = title || target.title
        summary = summary || target.summary
        body = body || `（删除提案：目标页面当前 v${target.version}，详见溯源）`
      }
    }

    // 溯源映射：sessionId 字段语义是真实会话 id（wiki_source 表 + UI 跳转依据），
    // 只有 session 引用能直接落；memory/wiki 引用映射成伪 id 会污染溯源数据
    // （UI 跳转指向不存在的会话）——改为在 excerpt 前缀标注来源类型。
    const sources = proposal.sourceRefs.map((ref) => {
      const isSession = ref.kind === 'session'
      const excerptBase = ref.note ?? proposal.rationale
      return {
        sessionId: isSession ? ref.id : `dream-ref:${ref.kind}:${ref.id}`,
        turnIndex: 1,
        excerpt: (isSession ? excerptBase : `[${ref.kind}] ${excerptBase}`).slice(0, 200),
      }
    })

    const { inserted, row } = this.deps.candidateRepo.insertPending({
      scope: DREAM_WIKI_SCOPE,
      scopeRef: null,
      ...(proposal.spaceId != null ? { spaceId: proposal.spaceId } : {}),
      payload: {
        kind: proposal.payload?.kind ?? 'knowledge',
        title,
        summary,
        body,
        tags,
        confidence: proposal.confidence,
        sources,
        rationale: `【${proposal.op}】${proposal.rationale}`.slice(0, 600),
        ...(proposal.op !== 'create'
          ? {
              action: proposal.op,
              ...(proposal.targetId != null ? { targetId: proposal.targetId } : {}),
              ...(proposal.op === 'merge' && proposal.mergeTargetId != null
                ? { mergeTargetId: proposal.mergeTargetId }
                : {}),
            }
          : {}),
      },
    })

    if (!inserted || row == null) {
      return {
        outcome: 'rejected-invalid',
        note: '同内容候选已存在（digest 去重命中），未重复征集',
        ...(row != null ? { refId: `candidate:${row.id}` } : {}),
      }
    }

    if (outcome !== 'auto-applied') {
      return { outcome: 'pending-review', refId: `candidate:${row.id}` }
    }

    const confirmResult = await this.deps.candidateService.confirm({
      id: row.id,
      digest: row.content_digest,
      ...(proposal.spaceId != null ? { spaceId: proposal.spaceId } : {}),
    })
    if (confirmResult.ok) {
      log.info(
        `dream wiki proposal auto-applied: candidate=${row.id} op=${proposal.op} ` +
          `page=${confirmResult.pageId ?? '-'}`,
      )
      return { outcome: 'auto-applied', refId: `candidate:${row.id}` }
    }
    log.warn(
      `dream wiki auto-confirm fell back to pending: candidate=${row.id} (${confirmResult.message ?? 'unknown'})`,
    )
    return {
      outcome: 'pending-review',
      refId: `candidate:${row.id}`,
      note: `自动确认未成功（${confirmResult.message ?? '未知原因'}），转人审`,
    }
  }
}

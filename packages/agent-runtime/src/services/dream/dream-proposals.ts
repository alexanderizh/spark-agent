/**
 * @module dream-proposals
 *
 * 梦境最终输出的提案解析与分流执行（计划 §7）。
 *
 * 提案通道说明（S1 架构决策）：梦境 Agent 不携带任何写入类工具，四阶段整理的
 * 产出以「最终回复末尾的 ```dream-proposals JSON 代码块」表达；本模块负责从
 * 终态 assistant 消息中解析、经 protocol 层 validateDreamProposal 逐条校验、
 * 再按置信度分流（resolveDreamProposalOutcome）交给轨道 sink 执行。
 *
 * 两道闸：提示词纪律（dream-prompt）+ 服务端结构化校验（本模块）——提示词被
 * 注入绕过时，非法提案在这里整条拒绝并进审计日志。
 */

import { createLogger } from '@spark/shared'
import { resolveDreamProposalOutcome, validateDreamProposal } from '@spark/protocol'
import type {
  DreamProposal,
  DreamProposalOp,
  DreamProposalOutcome,
  DreamProposalResult,
  DreamRunStats,
} from '@spark/protocol'

const log = createLogger('dream:proposals')

/** dream-proposals fenced 代码块标记 */
const FENCE_TAG = 'dream-proposals'

export interface ParsedDreamProposals {
  /** 通过 schema 校验的提案（保持模型输出顺序） */
  proposals: DreamProposal[]
  /** 未通过校验的原始条目与拒绝原因（进审计日志与运行报告）；
   * rawKind/rawOp 为尽力提取的原始字段（形态非法时缺省）——审计与报告不应
   * 把 wiki 轨的非法条目记成虚构的 memory/create。 */
  invalid: Array<{
    index: number
    reason: string
    rawKind?: 'memory' | 'wiki'
    rawOp?: DreamProposalOp
  }>
  /** 终态文本中一个 dream-proposals 块都没找到 */
  missing: boolean
}

/**
 * 从梦境 Agent 的终态回复中提取提案数组。
 * 容错策略：收集全部 dream-proposals 块合并（模型可能分段输出）；单块 JSON
 * 解析失败按整块拒收记录原因，不影响其他块。
 */
export function parseDreamProposals(finalText: string): ParsedDreamProposals {
  const blocks = extractFencedBlocks(finalText)
  if (blocks.length === 0) {
    return { proposals: [], invalid: [], missing: true }
  }
  const proposals: DreamProposal[] = []
  const invalid: Array<{ index: number; reason: string }> = []
  let index = 0
  for (const block of blocks) {
    let raws: unknown[]
    try {
      const parsed = JSON.parse(block) as unknown
      raws = Array.isArray(parsed) ? parsed : [parsed]
    } catch (err) {
      log.warn(`dream-proposals block is not valid JSON: ${errText(err)}`)
      invalid.push({ index, reason: `代码块不是合法 JSON：${errText(err)}` })
      index += 1
      continue
    }
    for (const raw of raws) {
      const check = validateDreamProposal(raw)
      if (check.ok && check.proposal != null) {
        proposals.push(check.proposal)
      } else {
        const rawObj =
          typeof raw === 'object' && raw != null ? (raw as Record<string, unknown>) : null
        const rawKind = rawObj?.kind
        const rawOp = rawObj?.op
        invalid.push({
          index,
          reason: check.message ?? '未知原因',
          ...(rawKind === 'memory' || rawKind === 'wiki' ? { rawKind } : {}),
          ...(typeof rawOp === 'string' && ['create', 'update', 'merge', 'delete'].includes(rawOp)
            ? { rawOp: rawOp as DreamProposalOp }
            : {}),
        })
      }
      index += 1
    }
  }
  return { proposals, invalid, missing: false }
}

function extractFencedBlocks(text: string): string[] {
  const blocks: string[] = []
  // fenced 代码块：```dream-proposals ... ```（容忍前后空白与语言标记大小写）。
  // 开闭围栏都锚定行首：JSON 字符串值里内嵌的 ```（如模型引用 markdown 示例）
  // 不会出现在行首（JSON 字符串不允许裸换行），行首锚定即可与内容内嵌 ``` 区分，
  // 惰性匹配不会提前截断。闭合围栏缺失（模型输出被截断）时回退到文本末尾，
  // 能救回多少提案就救回多少。
  const re =
    /(?:^|\r?\n)[ \t]*```[ \t]*dream-proposals[ \t]*\r?\n([\s\S]*?)(?:\r?\n[ \t]*```(?=\s|$)|$)/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) != null) {
    blocks.push(m[1] ?? '')
  }
  return blocks
}

// ─── 分流执行 ───────────────────────────────────────────────────────────────

export interface DreamProposalDispatchParams {
  proposals: DreamProposal[]
  /** parseDreamProposals 的非法条目（可缺省 = 无非法条目）；rawKind/rawOp
   * 为尽力提取的原始字段，审计与报告不把 wiki 轨非法条目记成 memory/create */
  invalid?: Array<{
    index: number
    reason: string
    rawKind?: 'memory' | 'wiki'
    rawOp?: DreamProposalOp
  }>
  batchLimit: number
  autoApplyThresholdPct: number
  autoDeleteEnabled: boolean
  /** 轨道 sink：执行单条提案（落候选 / 代确认 / 软删等），返回执行结果 */
  applyProposal: (
    proposal: DreamProposal,
    outcome: DreamProposalOutcome,
  ) => Promise<DreamProposalResult>
  /** 审计日志 sink（每条提案无论去向都记一行；实现方保证不抛） */
  audit: (entry: DreamAuditEntry) => void
}

export interface DreamAuditEntry {
  runId: string
  kind: 'memory' | 'wiki'
  op: DreamProposalOp
  targetId?: string
  confidence: number
  outcome: DreamProposalOutcome
  note?: string
}

export interface DreamDispatchSummary {
  stats: DreamRunStats
  results: Array<{
    op: DreamProposalOp
    kind: 'memory' | 'wiki'
    targetId?: string
    confidence: number
    outcome: DreamProposalOutcome
  }>
}

/**
 * 逐条分流执行：校验失败的先记审计；超过 batchLimit 的丢弃记审计；其余按
 * resolveDreamProposalOutcome 分流后交 sink。sink 异常按 rejected-invalid 计
 * （不中断批次，剩余提案继续）。
 */
export async function dispatchDreamProposals(
  params: DreamProposalDispatchParams & { runId: string },
): Promise<DreamDispatchSummary> {
  const invalid = params.invalid ?? []
  const stats: DreamRunStats = {
    proposals: params.proposals.length + invalid.length,
    autoApplied: 0,
    pendingReview: 0,
    rejectedInvalid: invalid.length,
    droppedByLimit: 0,
  }
  const results: DreamDispatchSummary['results'] = []

  for (const item of invalid) {
    const kind = item.rawKind ?? 'memory'
    const op = item.rawOp ?? 'create'
    params.audit({
      runId: params.runId,
      kind,
      op,
      confidence: 0,
      outcome: 'rejected-invalid',
      note: `第 ${item.index} 条提案未通过校验：${item.reason}`,
    })
    results.push({ op, kind, confidence: 0, outcome: 'rejected-invalid' })
  }

  let accepted = 0
  for (const proposal of params.proposals) {
    if (accepted >= params.batchLimit) {
      stats.droppedByLimit += 1
      params.audit({
        runId: params.runId,
        kind: proposal.kind,
        op: proposal.op,
        ...(proposal.targetId != null ? { targetId: proposal.targetId } : {}),
        confidence: proposal.confidence,
        outcome: 'dropped-by-limit',
        note: `超过单次提案上限 ${params.batchLimit}，丢弃`,
      })
      results.push({
        op: proposal.op,
        kind: proposal.kind,
        ...(proposal.targetId != null ? { targetId: proposal.targetId } : {}),
        confidence: proposal.confidence,
        outcome: 'dropped-by-limit',
      })
      continue
    }
    accepted += 1
    const outcome = resolveDreamProposalOutcome({
      op: proposal.op,
      confidence: proposal.confidence,
      autoApplyThresholdPct: params.autoApplyThresholdPct,
      autoDeleteEnabled: params.autoDeleteEnabled,
    })
    let result: DreamProposalResult
    try {
      result = await params.applyProposal(proposal, outcome)
    } catch (err) {
      log.warn(`apply proposal failed (op=${proposal.op}): ${errText(err)}`)
      result = { outcome: 'rejected-invalid', note: `执行失败：${errText(err)}` }
    }
    switch (result.outcome) {
      case 'auto-applied':
        stats.autoApplied += 1
        break
      case 'pending-review':
        stats.pendingReview += 1
        break
      case 'rejected-invalid':
        stats.rejectedInvalid += 1
        break
      case 'dropped-by-limit':
        stats.droppedByLimit += 1
        break
    }
    params.audit({
      runId: params.runId,
      kind: proposal.kind,
      op: proposal.op,
      ...(proposal.targetId != null ? { targetId: proposal.targetId } : {}),
      confidence: proposal.confidence,
      outcome: result.outcome,
      ...(result.note != null ? { note: result.note } : {}),
    })
    results.push({
      op: proposal.op,
      kind: proposal.kind,
      ...(proposal.targetId != null ? { targetId: proposal.targetId } : {}),
      confidence: proposal.confidence,
      outcome: result.outcome,
    })
  }
  return { stats, results }
}

function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/**
 * @module memory-evolution.service
 *
 * 记忆演化决策服务 — 取代 V1 的 merge/replace/skip 去重闸门（Mem0 模式）。
 *
 * 对每个通过置信度/敏感词/瞬时闸门的候选：
 *   1. 用 FTS（同 scope）召回相似已有条目 top5（同步、不需 embed，writer 后台路径够用）
 *   2. 喂给小模型 buildEvolutionPrompt，返回 ADD / UPDATE / DELETE / NOOP + targetId
 *   3. 调用方（writer）按决策执行（ADD=新建、UPDATE=更新 target 保 id/hit_count+History、
 *      DELETE=使 target 失效（bi-temporal invalid_at）、NOOP=丢弃）
 *
 * 设计要点：
 *   - 仅做决策，不执行写入（执行在 writer，保持单一写入入口 + 配额闸门统一）
 *   - FTS 不可用（旧库未跑 migration）或 LLM 失败 → 默认 ADD（宁可多存，由整合 job 合并）
 *   - 决策结果带 reason 便于 log/审计
 */

import { createLogger } from '@spark/shared'
import type { MemorySearchRepository } from '@spark/storage'
import type { MemoryCandidate } from './memory-writer.service.js'
import { buildEvolutionPrompt } from './memory-extraction.prompt.js'

const log = createLogger('memory:evolution')

export type EvolutionDecision = 'ADD' | 'UPDATE' | 'DELETE' | 'NOOP'

export interface EvolutionVerdict {
  decision: EvolutionDecision
  /** UPDATE/DELETE 的目标条目 id；ADD/NOOP 为 null */
  targetId: string | null
  /** LLM 给的一句话理由（log/审计用） */
  reason: string
}

/** FTS 召回相似条目数 */
const SIMILAR_LIMIT = 5

export class MemoryEvolutionService {
  constructor(
    private readonly searchRepo: MemorySearchRepository,
    /** 小模型补全（与 writer 同一通道，writer 传入） */
    private readonly callLLM: (prompt: string) => Promise<string>,
  ) {}

  /**
   * 对一条候选记忆做演化决策。
   *
   * FTS 召回相似条目（同 scope，未归档未失效）→ LLM 判定。
   * 任何环节失败（FTS 异常 / LLM 异常 / 解析失败）默认返回 ADD（保守，不丢信息）。
   */
  async decide(
    candidate: MemoryCandidate,
    scope: 'user' | 'project' | 'agent',
    scopeRef: string | null,
  ): Promise<EvolutionVerdict> {
    const similar = this.recallSimilar(candidate, scope, scopeRef)

    // 没有相似条目 → 直接 ADD，省一次 LLM 调用
    if (similar.length === 0) {
      return { decision: 'ADD', targetId: null, reason: 'no similar existing memory' }
    }

    try {
      const prompt = buildEvolutionPrompt(
        {
          name: candidate.name,
          description: candidate.description,
          body: candidate.body,
          type: candidate.type,
        },
        similar.map((e) => ({ id: e.id, name: e.name, description: e.description, type: e.type })),
      )
      const raw = await this.callLLM(prompt)
      const parsed = parseVerdict(raw, similar)
      if (parsed != null) return parsed

      // 解析失败 → 保守 ADD
      log.warn(`evolution verdict unparseable, defaulting to ADD: ${raw.slice(0, 200)}`)
      return { decision: 'ADD', targetId: null, reason: 'verdict unparseable, conservative ADD' }
    } catch (err) {
      log.warn(
        `evolution decide failed, defaulting to ADD: ${err instanceof Error ? err.message : String(err)}`,
      )
      return { decision: 'ADD', targetId: null, reason: 'decide failed, conservative ADD' }
    }
  }

  /**
   * FTS 召回同 scope 相似条目（用候选的 name + description 作查询）。
   * searchRepo.searchBm25 内部已 segmentCjk 分词；FTS 表不存在时返回 []（旧库降级）。
   */
  private recallSimilar(
    candidate: MemoryCandidate,
    scope: 'user' | 'project' | 'agent',
    scopeRef: string | null,
  ) {
    try {
      const query = `${candidate.name} ${candidate.description}`.trim()
      if (query.length === 0) return []
      const hits = this.searchRepo.searchBm25(query, {
        scopes: [{ scope, scopeRef }],
        limit: SIMILAR_LIMIT,
      })
      return hits.map((h) => h.entry)
    } catch (err) {
      log.warn(
        `evolution FTS recall failed (defaulting to ADD): ${err instanceof Error ? err.message : String(err)}`,
      )
      return []
    }
  }
}

/**
 * 解析 LLM 演化决策输出。
 * 校验：decision ∈ {ADD,UPDATE,DELETE,NOOP}；UPDATE/DELETE 的 targetId 必须在相似条目列表里。
 * 返回 null 表示无法解析（调用方保守 ADD）。
 */
function parseVerdict(
  raw: string,
  similar: Array<{ id: string }>,
): EvolutionVerdict | null {
  try {
    let json = raw.trim()
    const match = json.match(/\{[\s\S]*\}/)
    if (match) json = match[0]!
    const obj = JSON.parse(json) as { decision?: unknown; targetId?: unknown; reason?: unknown }

    const decision = typeof obj.decision === 'string' ? obj.decision.toUpperCase() : ''
    if (decision !== 'ADD' && decision !== 'UPDATE' && decision !== 'DELETE' && decision !== 'NOOP') {
      return null
    }

    const validIds = new Set(similar.map((e) => e.id))
    let targetId: string | null = null
    if (decision === 'UPDATE' || decision === 'DELETE') {
      const id = typeof obj.targetId === 'string' ? obj.targetId.trim() : ''
      if (!validIds.has(id)) {
        // targetId 不在召回列表 → 无法安全执行 UPDATE/DELETE，退化为 ADD（保守）
        return { decision: 'ADD', targetId: null, reason: `targetId "${id}" not in similar list, fallback ADD` }
      }
      targetId = id
    }

    return {
      decision,
      targetId,
      reason: typeof obj.reason === 'string' ? obj.reason.slice(0, 200) : '',
    }
  } catch {
    return null
  }
}

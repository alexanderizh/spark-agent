/**
 * @module memory eval types
 *
 * 记忆系统确定性黄金评测集的类型定义。
 *
 * 两类用例（均不依赖真 LLM，CI 可跑，作回归门槛）：
 *   - GateCase：写入闸门 + 演化决策执行（mock callLLM + mock evolution），验证落库状态
 *   - SearchCase：FTS 检索召回（无 embedding，纯 BM25），验证召回集合
 *
 * 抽取 prompt 的真 LLM 评测（extraction-cases）单独提供，默认 skip（需配置 extraction 模型）。
 */

import type { MemoryCandidate } from '../memory-writer.service.js'
import type { MemoryEntryInsert } from '@spark/storage'

export type GateOutcome =
  | 'written' // ADD：新增一条
  | 'noop' // 演化 NOOP：无变化
  | 'updated' // 演化 UPDATE：existing[targetIndex] 被更新（保 id）
  | 'invalidated' // 演化 DELETE：existing[targetIndex] 被置 invalid_at
  | 'rejected-transient' // 闸门0 瞬时数据拒绝
  | 'rejected-confidence' // 闸门1 置信度 < 0.6 拒绝
  | 'rejected-sensitive' // 闸门4 敏感词拒绝

export interface GateExisting {
  row: MemoryEntryInsert
  body?: string
}

export interface GateEvolutionMock {
  decision: 'ADD' | 'UPDATE' | 'DELETE' | 'NOOP'
  /** 指向 existing 数组的下标（UPDATE/DELETE 用）。ADD/NOOP 无需。 */
  targetIndex?: number
}

export interface GateCase {
  id: string
  desc: string
  candidate: MemoryCandidate
  /** 预置已有记忆（供演化召回/UPDATE/DELETE target）。无则空。 */
  existing?: GateExisting[]
  /**
   * mock 演化决策。不提供 → writer 用 evolutionService=null 走 V1 闸门路径（只过瞬时/置信度/敏感）。
   * 提供则注入返回固定 verdict 的 evolution service（targetIndex 解析为 existing 的真实 id）。
   */
  evolution?: GateEvolutionMock
  expect: { outcome: GateOutcome }
}

export interface SearchSeed {
  row: MemoryEntryInsert
  body?: string
}

export interface SearchCase {
  id: string
  desc: string
  seed: SearchSeed[]
  query: string
  opts?: { type?: string; limit?: number }
  /**
   * 期望被召回的 id 集合（FTS-only，无 embedding）。
   * 判定：期望集 ⊆ 实际召回集（recall）—— 即期望的必须被召回，允许实际召回更多。
   * 若需严格相等，把 expectExact 置 true。
   */
  expectIds: string[]
  expectExact?: boolean
}

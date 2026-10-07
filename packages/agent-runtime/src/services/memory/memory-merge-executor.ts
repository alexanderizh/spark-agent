/**
 * @module memory-merge-executor
 *
 * MERGE 执行段（P2-B 抽取）—— consolidation 自动合并与候选确认合并的共用形状。
 *
 * 职责（与抽取前 consolidation.applyMerge 执行段语义逐行等价）：
 *   1. commitWrite 提交 keep 的新版本（expectedVersion = 调用方读取时版本，
 *      失配不覆盖当前状态；revisionKind='merge'；合并去重不升置信）。
 *   2. drops 逐个失效指向 keep（当前版本随 supersede revision 入档，successor=keep）。
 *   3. 记派生边 drop → keep（kind='merge'，来源撤回时可沿边追溯派生条目）。
 *
 * 调用方：
 *   - MemoryConsolidationService.applyMerge（全自动合并原路径）
 *   - MemoryCandidateService.confirmMerge（P2-B MERGE 预确认，用户结构化确认后执行）
 *
 * 独立模块函数而非服务互调：避免 candidate ↔ consolidation 循环依赖；
 * repo / commit 原语由调用方注入（候选侧按行 scope 解析 project workspace store）。
 */

import type { MemoryEntryRow, MemoryRepository, MemoryRevisionRepository } from '@spark/storage'
import type { MemoryCommitService } from './memory-commit.service.js'

export interface MemoryMergeExecuteParams {
  /** 保留条目（调用方刚重读的当前行；CAS 用其 version） */
  keep: MemoryEntryRow
  /** 被合并条目（已过滤无效/自引用；执行后失效指向 keep） */
  drops: MemoryEntryRow[]
  /** 合并后的描述（CAS 写入 keep） */
  mergedDescription: string
  /** 合并后的正文（CAS 写入 keep） */
  mergedBody: string
  /** drop 正文（守卫规范化口径；随 supersede revision 入档，缺省按空串） */
  dropBodies: Map<string, string>
  /** 提交原语（按 keep 所属 scope 解析：project 须用 workspace store） */
  commitService: MemoryCommitService
  memoryRepo: MemoryRepository
  /** revision 历史与派生边；缺省 null 不记录（与两服务现状一致） */
  revisionRepo: MemoryRevisionRepository | null
  /** supersede revision 的 note 标注（区分 consolidation / 候选确认来源） */
  note: string
}

export type MemoryMergeExecuteResult =
  | { ok: true }
  | { ok: false; reason: 'version_conflict' | 'commit_failed'; message: string }

/**
 * 执行 MERGE 写入段。失败仅返回结构化结果（不抛出、不记日志 —— 上下文
 * 相关的 warn/debug 由调用方按各自口径记录）。
 */
export async function executeMemoryMerge(
  params: MemoryMergeExecuteParams,
): Promise<MemoryMergeExecuteResult> {
  const { keep, drops, mergedDescription, mergedBody, dropBodies, commitService } = params
  // 【S2.5】合并重复不升置信：多条同义条目合并成一个槽位是去重，不是
  // 多份独立证据（"十篇转载不算十份独立证据"）；keep 维持自身评估。
  // 【审查修复】经提交原语 CAS 更新（先写文件后 CAS 的顺序不变，但失配时
  // 会尽力恢复被覆盖的权威正文）。expectedVersion 持读取时版本，执行期间
  // keep 被并发更新/归档时失配丢弃，不覆盖当前状态；被覆盖的 keep 版本进
  // revision 历史（kind='merge'）。
  const committed = await commitService.commitWrite({
    entryId: keep.id,
    expectedVersion: keep.version,
    scope: keep.scope,
    scopeRef: keep.scope_ref,
    type: keep.type,
    name: keep.name,
    description: mergedDescription,
    confidence: keep.confidence,
    body: mergedBody,
    preserveFrom: keep,
    revisionKind: 'merge',
  })
  if (!committed.ok) {
    return {
      ok: false,
      reason: committed.reason === 'version_conflict' ? 'version_conflict' : 'commit_failed',
      message: committed.message,
    }
  }

  // dropIds 失效，指向 keep。【S2.2】每个 drop 的当前版本进 revision 历史
  //（kind='supersede'，successor 指向 keep）+ 记录派生边 drop → keep
  //（来源撤回时可沿边找到派生条目，H2 纠正影响传播）
  // 【审查修复】update/insertDerivation 的 DB 异常同样收敛为结构化结果
  //（守住"不抛出"契约）：keep 已提交，返回失败让调用方走重试口径 ——
  // 候选侧重试时 drops 重读现势（已失效的跳过），consolidation 下轮同过滤，
  // 两侧均幂等收敛，不会卡死在"keep 已并、drops 半失效"的中间态。
  const now = Date.now()
  for (const drop of drops) {
    try {
      params.memoryRepo.update(drop.id, { invalid_at: now, superseded_by: keep.id }, undefined, {
        oldBody: dropBodies.get(drop.id) ?? '',
        kind: 'supersede',
        successorId: keep.id,
        note: params.note,
      })
      params.revisionRepo?.insertDerivation(drop.id, keep.id, 'merge')
    } catch (err) {
      return {
        ok: false,
        reason: 'commit_failed',
        message:
          `drop ${drop.id} 失效写入失败：` +
          `${err instanceof Error ? err.message : String(err)}` +
          `（keep ${keep.id} 已并入合并正文，未失效的 drops 可经重试收敛）`,
      }
    }
  }
  return { ok: true }
}

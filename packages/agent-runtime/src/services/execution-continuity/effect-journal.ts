/**
 * @module effect-journal
 *
 * EffectJournal — 为可能产生副作用的工具维护 write-ahead 记录、幂等键、
 * 外部收据和重放策略（方案 §5.1/§6.4/§8）。
 *
 * 使用协议：
 *   1. prepare()     — 派发前登记 prepared Effect + planned/running Step
 *   2. markDispatching() — 越过外部调用边界前强制提交（lease fencing 由调用方核对）
 *   3. confirm()/fail() — 与步骤 Checkpoint 同事务提交
 *   4. reconcileUnknown() — 中断后或用户确认后的调和
 *
 * dispatching 是保守的 write-ahead sent-intent：进程中断后一律调和为 unknown，
 * 不得恢复成"未发送"并自动重跑。
 */

import crypto from 'node:crypto'
import {
  ExecutionEffectRepository,
  ExecutionStepRepository,
  type ExecutionStepCreateParams,
} from '@spark/storage'
import type { SparkDatabase } from '@spark/storage'
import type { ExecutionEffectRecord, ToolRecoveryPolicy } from '@spark/protocol'
import { getToolRecoveryPolicy } from './tool-recovery-registry.js'
import { createLogger } from '@spark/shared'

const log = createLogger('execution-continuity.effect-journal')

/** 规范化请求 → hash：移除 Provider 临时 ID、统一 key 顺序（方案 §6.2）。 */
export function normalizeRequestHash(input: Record<string, unknown>): string {
  const canonical = stableStringify(stripVolatileKeys(input))
  return crypto.createHash('sha256').update(canonical).digest('hex')
}

const VOLATILE_REQUEST_KEYS = new Set([
  'toolCallId',
  'tool_use_id',
  'requestId',
  'call_id',
  '_meta',
])

function stripVolatileKeys(value: unknown, depth = 0): unknown {
  if (depth > 8 || value == null || typeof value !== 'object') return value
  if (Array.isArray(value)) return value.map((item) => stripVolatileKeys(item, depth + 1))
  const result: Record<string, unknown> = {}
  for (const key of Object.keys(value as Record<string, unknown>).sort()) {
    if (VOLATILE_REQUEST_KEYS.has(key)) continue
    result[key] = stripVolatileKeys((value as Record<string, unknown>)[key], depth + 1)
  }
  return result
}

function stableStringify(value: unknown): string {
  return JSON.stringify(value)
}

export interface EffectPrepareInput {
  runId: string
  stepKey: string
  stepKind?: ExecutionStepCreateParams['kind']
  toolName: string
  toolSource?: 'builtin' | 'mcp'
  toolVersion?: string
  toolCallId: string
  toolInput: Record<string, unknown>
}

export interface PreparedEffect {
  effect: ExecutionEffectRecord
  created: boolean
}

export class EffectJournal {
  constructor(private readonly db: SparkDatabase) {}

  /** 解析策略（供 UI/Planner 展示与统一入口复用）。 */
  policyFor(toolName: string, source?: 'builtin' | 'mcp'): ToolRecoveryPolicy {
    return getToolRecoveryPolicy(toolName, source)
  }

  /**
   * 派发前登记：幂等创建 Step（stableKey）+ Effect（prepared）。
   * 同一 toolCallId 重复登记时返回既有 Effect（created=false），不重复创建。
   */
  prepare(input: EffectPrepareInput): PreparedEffect {
    const stepRepo = new ExecutionStepRepository(this.db)
    const effectRepo = new ExecutionEffectRepository(this.db)
    const policy = this.policyFor(input.toolName, input.toolSource)
    const requestHash = normalizeRequestHash(input.toolInput)

    const existing = effectRepo.findByToolCallId(input.runId, input.toolCallId)
    if (existing != null) return { effect: existing, created: false }

    const step = stepRepo.ensure({
      id: `est_${crypto.randomUUID()}`,
      runId: input.runId,
      stableKey: input.stepKey,
      kind: input.stepKind ?? 'tool',
      inputHash: requestHash,
      replayPolicy: policy.replayPolicy,
    })
    const effect = effectRepo.create({
      id: `eef_${crypto.randomUUID()}`,
      runId: input.runId,
      stepId: step.id,
      toolName: input.toolName,
      toolVersion: input.toolVersion,
      toolCallId: input.toolCallId,
      requestHash,
      replayPolicy: policy.replayPolicy,
    })
    log.debug('effect prepared', {
      runId: input.runId,
      toolName: input.toolName,
      replayPolicy: policy.replayPolicy,
      sideEffect: policy.sideEffect,
    })
    return { effect, created: true }
  }

  /**
   * 越过外部调用边界前的强制提交：prepared → dispatching + step running。
   * 调用方必须先核对租约（supervisor.assertLease）。
   * 返回 false 表示 Effect 已不是 prepared（可能已被并发调和）——调用方必须中止派发。
   */
  markDispatching(runId: string, effectId: string): boolean {
    const effectRepo = new ExecutionEffectRepository(this.db)
    const stepRepo = new ExecutionStepRepository(this.db)
    const effect = effectRepo.get(effectId)
    if (effect == null) return false
    const ok = effectRepo.markDispatching(effectId)
    if (ok) stepRepo.markRunning(effect.stepId)
    if (!ok) {
      log.warn('effect dispatch rejected (not prepared)', { runId, effectId, phase: effect.phase })
    }
    return ok
  }

  /** 成功收口：dispatching/prepared → confirmed；resultRef 与外部收据一并落库。 */
  confirm(runId: string, effectId: string, resultRef: string | null, externalReceiptRef?: string | null): boolean {
    const ok = new ExecutionEffectRepository(this.db).markConfirmed(effectId, resultRef, externalReceiptRef)
    if (ok) log.debug('effect confirmed', { runId, effectId })
    return ok
  }

  /** 明确失败收口（未越过边界或外部明确拒绝）。 */
  fail(runId: string, effectId: string): boolean {
    return new ExecutionEffectRepository(this.db).markFailed(effectId)
  }

  /** 幂等键（供支持 Idempotency-Key 的外部系统使用）。 */
  idempotencyKeyFor(runId: string, effectId: string): string {
    return `spark-${runId}-${effectId}`
  }

  /** 按 Run 列出全部 Effect（恢复中心/Planner）。 */
  listByRun(runId: string): ExecutionEffectRecord[] {
    return new ExecutionEffectRepository(this.db).listByRun(runId)
  }
}

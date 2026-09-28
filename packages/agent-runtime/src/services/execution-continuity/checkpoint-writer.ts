/**
 * @module checkpoint-writer
 *
 * CheckpointWriter — 在稳定边界保存逻辑状态、游标、运行时绑定、等待请求
 * 和工作区快照引用（方案 §5.1/§7）。
 *
 * 步骤提交使用同一事务完成（方案 §7）：
 *   step.result committed + effect confirmed + checkpoint inserted
 *   + run.latest_checkpoint_id advanced + durable outbox event inserted
 */

import crypto from 'node:crypto'
import {
  ExecutionCheckpointRepository,
  ExecutionEffectRepository,
  ExecutionOutboxRepository,
  ExecutionRunRepository,
  ExecutionStepRepository,
  ExecutionWaitRepository,
} from '@spark/storage'
import type { SparkDatabase } from '@spark/storage'
import type {
  CheckpointReason,
  ExecutionCheckpointV1,
  RecoveryLevel,
} from '@spark/protocol'
import { createLogger } from '@spark/shared'

const log = createLogger('execution-continuity.checkpoint-writer')

export interface CheckpointCursorInput {
  phase: string
  nextStepKey?: string
  graphNodeId?: string
  goalIteration?: number
}

export interface RuntimeBindingInput {
  engine: string
  providerProfileId?: string
  modelId?: string
  nativeSessionId?: string
  nativeThreadId?: string
}

export interface WriteCheckpointInput {
  runId: string
  reason: CheckpointReason
  cursor: CheckpointCursorInput
  /** 逻辑状态（capsule/摘要）的内容寻址引用；空串表示尚无 capsule。 */
  logicalStateRef?: string
  /** 会话事件 seq 水位；-1 表示沿用上一 Checkpoint 的水位。 */
  messageWaterline?: number
  runtimeBinding: RuntimeBindingInput
  openWaitIds?: string[]
  workspaceSnapshotSetId?: string
  definitionFingerprint?: string
  /** 同事务提交的步骤（step → committed + resultRef）。 */
  commitStep?: { stepId: string; resultRef: string }
}

export class CheckpointWriter {
  constructor(private readonly db: SparkDatabase) {}

  /**
   * 原子写入一个逻辑 Checkpoint；可选地在同一事务内提交步骤、推进
   * run.latest_checkpoint_id 并追加 durable outbox 事件。
   */
  write(input: WriteCheckpointInput): ExecutionCheckpointV1 {
    const runRepo = new ExecutionRunRepository(this.db)
    const checkpointRepo = new ExecutionCheckpointRepository(this.db)
    const stepRepo = new ExecutionStepRepository(this.db)
    const outboxRepo = new ExecutionOutboxRepository(this.db)

    const writeTx = (): ExecutionCheckpointV1 => {
      const run = runRepo.get(input.runId)
      if (run == null) throw new Error(`Cannot checkpoint unknown run: ${input.runId}`)

      const latest = checkpointRepo.parseAndValidate(checkpointRepo.getLatest(input.runId))
      const sequence = checkpointRepo.nextSequence(input.runId)
      const checkpointId = `ecp_${crypto.randomUUID()}`
      const envelopeInput: Omit<ExecutionCheckpointV1, 'checksum'> = {
        schemaVersion: 1,
        checkpointId,
        runId: input.runId,
        sequence,
        reason: input.reason,
        cursor: input.cursor,
        logicalStateRef: input.logicalStateRef ?? latest?.logicalStateRef ?? '',
        messageWaterline:
          input.messageWaterline != null && input.messageWaterline >= 0
            ? input.messageWaterline
            : (latest?.messageWaterline ?? 0),
        runtimeBinding: input.runtimeBinding,
        openWaitIds: input.openWaitIds ?? [],
        workspaceSnapshotSetId: input.workspaceSnapshotSetId ?? latest?.workspaceSnapshotSetId,
        definitionFingerprint:
          input.definitionFingerprint ?? run.definitionFingerprint ?? latest?.definitionFingerprint ?? '',
        createdAt: new Date().toISOString(),
      }
      const checksum = ExecutionCheckpointRepository.checksum(envelopeInput)
      const envelope: ExecutionCheckpointV1 = { ...envelopeInput, checksum }

      checkpointRepo.insert(envelope)
      if (input.commitStep != null) {
        stepRepo.commit(input.commitStep.stepId, input.commitStep.resultRef)
      }
      runRepo.advanceCheckpointRef(input.runId, checkpointId)
      outboxRepo.enqueue({
        id: `eox_${crypto.randomUUID()}`,
        runId: input.runId,
        eventType: 'checkpoint_committed',
        payload: { checkpointId, sequence, reason: input.reason },
      })
      return envelope
    }

    const envelope = this.db.raw.transaction(writeTx)() as ExecutionCheckpointV1
    log.debug('checkpoint committed', {
      runId: input.runId,
      checkpointId: envelope.checkpointId,
      sequence: envelope.sequence,
      reason: envelope.reason,
    })
    return envelope
  }

  /**
   * Run 终态收口：遗留 in-flight Effect → unknown、open Wait → cancelled、终态 checkpoint 不再写。
   * fence：Worker 路径传当前租约（epoch fencing）；宿主权威路径不传。
   */
  finalizeRun(
    runId: string,
    status: 'completed' | 'failed' | 'cancelled',
    reason: string | null,
    fence?: { owner: string; epoch: number } | null,
  ): boolean {
    const runRepo = new ExecutionRunRepository(this.db)
    const effectRepo = new ExecutionEffectRepository(this.db)
    const waitRepo = new ExecutionWaitRepository(this.db)
    const outboxRepo = new ExecutionOutboxRepository(this.db)
    const tx = (): boolean => {
      const effectsUnknown = effectRepo.reconcileInflightToUnknown(runId)
      const waitsCancelled = waitRepo.cancelOpenByRun(runId)
      const ok = runRepo.finishTerminal(runId, status, reason, fence ?? null)
      if (ok) {
        outboxRepo.enqueue({
          id: `eox_${crypto.randomUUID()}`,
          runId,
          eventType: 'run_status_changed',
          payload: { status, reason, effectsUnknown, waitsCancelled },
        })
      }
      return ok
    }
    const result = this.db.raw.transaction(tx)() as boolean
    if (result) {
      log.info('run finalized', { runId, status, reason })
    }
    return result
  }

  /** 读取 Run 当前保证等级（恢复等级单调下降由 runRepo.lowerGuaranteedLevel 保证）。 */
  currentGuaranteedLevel(runId: string): RecoveryLevel {
    const run = new ExecutionRunRepository(this.db).get(runId)
    return run?.currentGuaranteedLevel ?? 0
  }
}

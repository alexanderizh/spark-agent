/**
 * @module execution-checkpoint.repository
 *
 * execution_checkpoints 仓储 — 版本化逻辑 Checkpoint 信封。
 *
 * 写入时校验 schemaVersion 与 checksum；latest_checkpoint_id 只能指向
 * 同一 Run 中 checksum 有效且已提交的 Checkpoint（跨表不变量由
 * CheckpointWriter 的事务顺序保证）。
 */

import crypto from 'node:crypto'
import { BaseRepository } from '../base.repository.js'
import type { SparkDatabase } from '../../database.js'
import { stableJsonStringify } from '../../canonical-json.js'
import type { ExecutionCheckpointRow, ExecutionCheckpointV1 } from '@spark/protocol'

export class ExecutionCheckpointRepository extends BaseRepository {
  constructor(db: SparkDatabase) {
    super(db, 'execution_checkpoints')
  }

  /**
   * 计算 Checkpoint 信封的 canonical checksum（幂等：同信封同 checksum）。
   * 使用稳定序列化覆盖全部嵌套层级（cursor/runtimeBinding 等），
   * 不能用数组型 replacer 的 JSON.stringify（嵌套内容会塌缩为 `{}`）。
   */
  static checksum(envelope: Omit<ExecutionCheckpointV1, 'checksum'>): string {
    const canonical = stableJsonStringify(envelope)
    return crypto.createHash('sha256').update(canonical).digest('hex')
  }

  /** 插入 Checkpoint（sequence 由调用方在事务内递增分配）。 */
  insert(envelope: ExecutionCheckpointV1): void {
    if (envelope.schemaVersion !== 1) {
      throw new Error(`Unsupported checkpoint schemaVersion: ${envelope.schemaVersion}`)
    }
    this.raw
      .prepare(
        `
      INSERT INTO execution_checkpoints (id, run_id, sequence, reason, envelope_json, checksum, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `,
      )
      .run(
        envelope.checkpointId,
        envelope.runId,
        envelope.sequence,
        envelope.reason,
        JSON.stringify(envelope),
        envelope.checksum,
        envelope.createdAt,
      )
  }

  get(id: string): ExecutionCheckpointRow | null {
    return this.findById<ExecutionCheckpointRow>(id)
  }

  getLatest(runId: string): ExecutionCheckpointRow | null {
    const row = this.raw
      .prepare(
        `SELECT * FROM execution_checkpoints WHERE run_id = ? ORDER BY sequence DESC LIMIT 1`,
      )
      .get(runId) as ExecutionCheckpointRow | undefined
    return row ?? null
  }

  listByRun(runId: string, limit = 50): ExecutionCheckpointRow[] {
    return this.raw
      .prepare(
        `SELECT * FROM execution_checkpoints WHERE run_id = ? ORDER BY sequence DESC LIMIT ?`,
      )
      .all(runId, limit) as ExecutionCheckpointRow[]
  }

  nextSequence(runId: string): number {
    const row = this.raw
      .prepare(
        `SELECT COALESCE(MAX(sequence), 0) as max_seq FROM execution_checkpoints WHERE run_id = ?`,
      )
      .get(runId) as { max_seq: number }
    return row.max_seq + 1
  }

  /** 校验并解析：checksum 与 schemaVersion 不匹配时返回 null（不得展示为可恢复点）。 */
  parseAndValidate(row: ExecutionCheckpointRow | null): ExecutionCheckpointV1 | null {
    if (row == null) return null
    try {
      const envelope = JSON.parse(row.envelope_json) as ExecutionCheckpointV1
      if (envelope.schemaVersion !== 1) return null
      if (envelope.checkpointId !== row.id) return null
      const { checksum: _omit, ...rest } = envelope
      if (ExecutionCheckpointRepository.checksum(rest) !== row.checksum) return null
      return envelope
    } catch {
      return null
    }
  }
}

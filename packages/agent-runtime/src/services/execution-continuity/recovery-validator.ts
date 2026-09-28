/**
 * @module recovery-validator
 *
 * 恢复环境校验（方案 §9.3）— 恢复前比较 runtime/engine、Provider、定义
 * fingerprint 与 Checkpoint 有效性，输出环境 fingerprint 与不匹配清单。
 *
 * Phase 1 范围：Checkpoint schema/checksum 校验 + runtime binding 存在性 +
 * 定义 fingerprint 对比（会话/引擎维度）。Workspace 漂移检测复用
 * CheckpointGitService 的 tree 校验，不在此处重复实现。
 */

import {
  ExecutionCheckpointRepository,
  ExecutionRunRepository,
  stableJsonStringify,
} from '@spark/storage'
import type { SparkDatabase } from '@spark/storage'
import type { ExecutionCheckpointV1 } from '@spark/protocol'
import crypto from 'node:crypto'

export interface EnvironmentFingerprintInput {
  runtimeKind: string
  engine?: string | undefined
  providerProfileId?: string | undefined
  modelId?: string | undefined
  definitionFingerprint?: string | undefined
  appVersion?: string | undefined
}

export interface CheckpointValidationResult {
  valid: boolean
  /** null 表示 Run 尚无任何 Checkpoint。 */
  envelope: ExecutionCheckpointV1 | null
  invalidCause?: 'schema_mismatch' | 'checksum_mismatch' | 'missing'
}

export interface EnvironmentComparison {
  fingerprint: string
  matches: boolean
  mismatches: string[]
}

export function computeEnvironmentFingerprint(input: EnvironmentFingerprintInput): string {
  // 稳定序列化覆盖全部字段（键序无关）；不能用数组型 replacer —— 会把
  // 所有字段从 canonical 串中剔除，使 fingerprint 退化为常量。
  const canonical = stableJsonStringify({
    runtimeKind: input.runtimeKind,
    engine: input.engine ?? '',
    providerProfileId: input.providerProfileId ?? '',
    modelId: input.modelId ?? '',
    definitionFingerprint: input.definitionFingerprint ?? '',
  })
  return crypto.createHash('sha256').update(canonical).digest('hex')
}

export class RecoveryValidator {
  constructor(private readonly db: SparkDatabase) {}

  /** 校验 Run 最新 Checkpoint：schema/checksum/引用一致性（方案 §9.1 步骤 3）。 */
  validateLatestCheckpoint(runId: string): CheckpointValidationResult {
    const checkpointRepo = new ExecutionCheckpointRepository(this.db)
    const latest = checkpointRepo.getLatest(runId)
    if (latest == null) return { valid: false, envelope: null, invalidCause: 'missing' }
    const envelope = checkpointRepo.parseAndValidate(latest)
    if (envelope == null) {
      return {
        valid: false,
        envelope: null,
        invalidCause: latest == null ? 'missing' : 'checksum_mismatch',
      }
    }
    return { valid: true, envelope }
  }

  /** 对比当前环境与 Checkpoint 记录的 runtime binding（方案 §9.3）。 */
  compareEnvironment(
    runId: string,
    current: EnvironmentFingerprintInput,
  ): EnvironmentComparison {
    const runRepo = new ExecutionRunRepository(this.db)
    const run = runRepo.get(runId)
    const fingerprint = computeEnvironmentFingerprint(current)
    const mismatches: string[] = []
    const binding = run?.runtimeBindingJson as Record<string, unknown> | null
    if (run != null && binding != null) {
      if (
        typeof binding.providerProfileId === 'string' &&
        binding.providerProfileId !== '' &&
        current.providerProfileId != null &&
        binding.providerProfileId !== current.providerProfileId
      ) {
        mismatches.push('provider_profile_changed')
      }
      if (
        typeof binding.modelId === 'string' &&
        binding.modelId !== '' &&
        current.modelId != null &&
        binding.modelId !== current.modelId
      ) {
        mismatches.push('model_changed')
      }
    }
    if (
      run != null &&
      run.definitionFingerprint !== '' &&
      current.definitionFingerprint != null &&
      run.definitionFingerprint !== current.definitionFingerprint
    ) {
      mismatches.push('definition_changed')
    }
    return { fingerprint, matches: mismatches.length === 0, mismatches }
  }
}

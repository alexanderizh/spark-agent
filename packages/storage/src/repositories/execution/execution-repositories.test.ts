/**
 * 执行连续性仓储测试 — 状态机守卫、CAS 租约（epoch fencing）、
 * Checkpoint checksum、Wait CAS 回答、Effect 相位转换。
 * 对应方案 §6.6 跨表不变量与 §16.2「Repository 状态机与 CAS/lease tests」。
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { join } from 'node:path'
import { mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { SparkDatabase } from '../../database.js'
import { SessionRepository } from '../session.repository.js'
import {
  ExecutionRunRepository,
  ExecutionStepRepository,
  ExecutionCheckpointRepository,
  ExecutionEffectRepository,
  ExecutionWaitRepository,
  ExecutionOutboxRepository,
  ExecutionRecoveryPlanRepository,
} from './index.js'

function createTestDb(testDir: string): SparkDatabase {
  const dbPath = join(testDir, 'test.db')
  const migrationsDir = join(process.cwd(), 'migrations')
  const db = new SparkDatabase(dbPath)
  db.runMigrations(migrationsDir)
  return db
}

describe('execution continuity repositories', () => {
  let db: SparkDatabase
  let testDir: string
  let runs: ExecutionRunRepository
  let steps: ExecutionStepRepository
  let checkpoints: ExecutionCheckpointRepository
  let effects: ExecutionEffectRepository
  let waits: ExecutionWaitRepository
  let outbox: ExecutionOutboxRepository
  let plans: ExecutionRecoveryPlanRepository

  const seedRun = (id = 'run-1', overrides: Record<string, unknown> = {}) =>
    runs.create({
      id,
      sessionId: 'sess-exec',
      rootTurnId: 'turn-1',
      kind: 'turn',
      runtimeKind: 'claude',
      capabilityCeiling: 2,
      ...overrides,
    })

  beforeEach(() => {
    testDir = join(tmpdir(), `spark-exec-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    mkdirSync(testDir, { recursive: true })
    db = createTestDb(testDir)
    new SessionRepository(db).create({
      id: 'sess-exec',
      kind: 'agent',
      title: 'Exec',
      status: 'idle',
      projectId: 'default',
    })
    runs = new ExecutionRunRepository(db)
    steps = new ExecutionStepRepository(db)
    checkpoints = new ExecutionCheckpointRepository(db)
    effects = new ExecutionEffectRepository(db)
    waits = new ExecutionWaitRepository(db)
    outbox = new ExecutionOutboxRepository(db)
    plans = new ExecutionRecoveryPlanRepository(db)
  })

  afterEach(() => {
    db.close()
    rmSync(testDir, { recursive: true, force: true })
  })

  describe('execution_runs 状态机守卫', () => {
    it('accepted → running → completed；终态不可回退', () => {
      seedRun()
      expect(runs.markRunning('run-1')).toBe(true)
      // 已 running 时再从 accepted 转换失败
      expect(runs.markRunning('run-1', ['accepted'])).toBe(false)
      expect(runs.finishTerminal('run-1', 'completed', null)).toBe(true)
      const done = runs.get('run-1')
      expect(done?.status).toBe('completed')
      expect(done?.completedAt).not.toBeNull()
      // 终态后任何转换被拒
      expect(runs.markRunning('run-1', ['accepted', 'recovering'])).toBe(false)
      expect(runs.markPaused('run-1', null)).toBe(false)
      expect(runs.finishTerminal('run-1', 'failed', 'again')).toBe(false)
    })

    it('running → orphaned → recovering；非活动状态不能 orphaned', () => {
      seedRun()
      runs.markRunning('run-1')
      expect(runs.markOrphaned('run-1', 'lease_expired')).toBe(true)
      expect(runs.markRecovering('run-1')).toBe(true)
      // completed 不能 orphaned
      runs.markRunning('run-1', ['recovering'])
      runs.finishTerminal('run-1', 'completed', null)
      expect(runs.markOrphaned('run-1', null)).toBe(false)
    })

    it('guaranteed level 只能单调下降', () => {
      seedRun()
      expect(runs.lowerGuaranteedLevel('run-1', 1)).toBe(true)
      expect(runs.lowerGuaranteedLevel('run-1', 0)).toBe(true)
      // 回升被拒
      expect(runs.lowerGuaranteedLevel('run-1', 2)).toBe(false)
      expect(runs.get('run-1')?.currentGuaranteedLevel).toBe(0)
    })
  })

  describe('CAS 租约与 epoch fencing', () => {
    it('领取租约递增 epoch；旧 epoch 不能续租/提交', () => {
      seedRun()
      runs.markRunning('run-1')
      const first = runs.acquireLease('run-1', 'worker-a', 60_000, ['running'])
      expect(first.ok).toBe(true)
      if (!first.ok) return
      const epoch1 = first.record.leaseEpoch
      expect(epoch1).toBeGreaterThan(0)

      // 新 worker 接管（模拟租约过期后的 CAS 抢占：先转回可领取状态语义）
      runs.markOrphaned('run-1', 'test')
      const second = runs.acquireLease('run-1', 'worker-b', 60_000, ['orphaned'])
      expect(second.ok).toBe(true)
      if (!second.ok) return
      expect(second.record.leaseEpoch).toBe(epoch1 + 1)

      // 旧 worker 的续租被 fencing 拒绝
      expect(runs.renewLease('run-1', 'worker-a', epoch1, 60_000)).toBe(false)
      expect(runs.isLeaseValid('run-1', 'worker-a', epoch1)).toBe(false)
      // 新 worker 有效
      expect(runs.isLeaseValid('run-1', 'worker-b', second.record.leaseEpoch)).toBe(true)
      // 旧 worker 释放租约无效
      expect(runs.releaseLease('run-1', 'worker-a', epoch1)).toBe(false)
      expect(runs.get('run-1')?.leaseOwner).toBe('worker-b')
    })

    it('过期租约不能续租', () => {
      seedRun()
      runs.markRunning('run-1')
      const lease = runs.acquireLease('run-1', 'worker-a', -1, ['running'])
      expect(lease.ok).toBe(true)
      // leaseDurationMs=-1 → 已过期
      expect(runs.renewLease('run-1', 'worker-a', lease.ok ? lease.record.leaseEpoch : 0, 60_000)).toBe(false)
    })
  })

  describe('execution_checkpoints 校验', () => {
    it('checksum 不匹配的信封解析被拒', () => {
      seedRun()
      const envelope = {
        schemaVersion: 1 as const,
        checkpointId: 'ecp-1',
        runId: 'run-1',
        sequence: 1,
        reason: 'accepted' as const,
        cursor: { phase: 'turn_started' },
        logicalStateRef: '',
        messageWaterline: 10,
        runtimeBinding: { engine: 'claude' },
        openWaitIds: [],
        definitionFingerprint: '',
        checksum: 'deadbeef',
        createdAt: new Date().toISOString(),
      }
      checkpoints.insert(envelope)
      const row = checkpoints.get('ecp-1')
      expect(row).not.toBeNull()
      // 篡改的 checksum 不能通过校验
      expect(checkpoints.parseAndValidate(row)).toBeNull()
    })

    it('同 sequence 幂等冲突被 UNIQUE 拒绝', () => {
      seedRun()
      const make = (checksum: string) => ({
        schemaVersion: 1 as const,
        checkpointId: `ecp-${checksum}`,
        runId: 'run-1',
        sequence: 1,
        reason: 'accepted' as const,
        cursor: { phase: 'x' },
        logicalStateRef: '',
        messageWaterline: 0,
        runtimeBinding: { engine: 'claude' },
        openWaitIds: [],
        definitionFingerprint: '',
        checksum,
        createdAt: new Date().toISOString(),
      })
      checkpoints.insert(make('a'))
      expect(() => checkpoints.insert(make('b'))).toThrow()
    })
  })

  describe('execution_steps 幂等与守卫', () => {
    it('UNIQUE(run, stableKey, attempt) 幂等创建', () => {
      seedRun()
      const first = steps.ensure({ id: 'st-1', runId: 'run-1', stableKey: 'tool:t1', kind: 'tool' })
      const second = steps.ensure({ id: 'st-2', runId: 'run-1', stableKey: 'tool:t1', kind: 'tool' })
      expect(second.id).toBe(first.id)
      expect(steps.listByRun('run-1')).toHaveLength(1)
    })

    it('planned → running → committed；committed 不能回 running', () => {
      seedRun()
      const step = steps.ensure({ id: 'st-1', runId: 'run-1', stableKey: 'tool:t1', kind: 'tool' })
      expect(steps.markRunning(step.id)).toBe(true)
      expect(steps.commit(step.id, 'ref-1')).toBe(true)
      expect(steps.markRunning(step.id)).toBe(false)
      expect(steps.markUncertain(step.id)).toBe(false)
      expect(steps.get(step.id)?.status).toBe('committed')
    })

    it('running → uncertain 允许（在途不明）', () => {
      seedRun()
      const step = steps.ensure({ id: 'st-1', runId: 'run-1', stableKey: 'tool:t1', kind: 'tool' })
      steps.markRunning(step.id)
      expect(steps.markUncertain(step.id)).toBe(true)
    })
  })

  describe('execution_effects 相位守卫', () => {
    const seedEffect = () => {
      seedRun()
      const step = steps.ensure({ id: 'st-1', runId: 'run-1', stableKey: 'tool:t1', kind: 'tool' })
      return effects.create({
        id: 'ef-1',
        runId: 'run-1',
        stepId: step.id,
        toolName: 'Bash',
        toolCallId: 'tc-1',
        requestHash: 'h1',
        replayPolicy: 'confirm',
      })
    }

    it('prepared → dispatching → confirmed', () => {
      seedEffect()
      expect(effects.markDispatching('ef-1')).toBe(true)
      expect(effects.markConfirmed('ef-1', 'res', 'receipt-1')).toBe(true)
      // confirmed 后不能再次 dispatching
      expect(effects.markDispatching('ef-1')).toBe(false)
      const effect = effects.get('ef-1')
      expect(effect?.phase).toBe('confirmed')
      expect(effect?.externalReceiptRef).toBe('receipt-1')
    })

    it('dispatching 禁止无条件自动重放：中断后调和为 unknown，再由 unknown 走确认', () => {
      seedEffect()
      effects.markDispatching('ef-1')
      // 崩溃模拟：仍在 dispatching 时调和为 unknown
      expect(effects.markUnknown('ef-1')).toBe(true)
      // unknown 不能直接重放（markDispatching 拒绝）
      expect(effects.markDispatching('ef-1')).toBe(false)
      // 用户确认后转 confirmed
      expect(effects.reconcileUnknown('ef-1', 'confirmed')).toBe(true)
    })

    it('Run 终态收口：in-flight 全部转 unknown', () => {
      seedEffect()
      effects.markDispatching('ef-1')
      const step2 = steps.ensure({ id: 'st-2', runId: 'run-1', stableKey: 'tool:t2', kind: 'tool' })
      void effects.create({
        id: 'ef-2',
        runId: 'run-1',
        stepId: step2.id,
        toolName: 'Write',
        toolCallId: 'tc-2',
        requestHash: 'h2',
        replayPolicy: 'confirm',
      })
      expect(effects.reconcileInflightToUnknown('run-1')).toBe(2)
      expect(effects.get('ef-2')?.phase).toBe('unknown')
    })
  })

  describe('execution_waits 幂等与 CAS 回答', () => {
    it('同 (run, step, type) 幂等创建；重复回答返回原结果不重复唤醒', () => {
      seedRun()
      const first = waits.ensureOpen({
        id: 'wt-1',
        runId: 'run-1',
        stepId: null,
        type: 'question',
        requestJson: { q: 'continue?' },
      })
      const second = waits.ensureOpen({
        id: 'wt-2',
        runId: 'run-1',
        stepId: null,
        type: 'question',
        requestJson: { q: 'continue?' },
      })
      expect(second.id).toBe(first.id)

      const answer1 = waits.answer(first.id, 'answered', { choice: 'yes' })
      expect(answer1.changed).toBe(true)
      const answer2 = waits.answer(first.id, 'answered', { choice: 'no' })
      // 第二次回答不改状态（CAS 只允许 open → answered）
      expect(answer2.changed).toBe(false)
      expect((answer2.record?.answerJson as { choice: string }).choice).toBe('yes')
      expect(waits.listOpen('run-1')).toHaveLength(0)
    })

    it('Run 终态收口：open Wait 全部取消', () => {
      seedRun()
      waits.ensureOpen({ id: 'wt-1', runId: 'run-1', stepId: null, type: 'permission', requestJson: {} })
      waits.ensureOpen({ id: 'wt-2', runId: 'run-1', stepId: null, type: 'question', requestJson: {} })
      expect(waits.cancelOpenByRun('run-1')).toBe(2)
    })

    it('到期扫描：deadline 已过的 open Wait 转 expired', () => {
      seedRun()
      waits.ensureOpen({
        id: 'wt-1',
        runId: 'run-1',
        stepId: null,
        type: 'question',
        requestJson: {},
        deadlineAt: '2000-01-01T00:00:00.000Z',
      })
      expect(waits.expireOverdue()).toBe(1)
      expect(waits.get('wt-1')?.status).toBe('expired')
    })
  })

  describe('execution_recovery_plans 幂等', () => {
    it('同 run+checkpoint+env 只有一个有效计划；旧计划被 superseded', () => {
      seedRun()
      const makePlan = (id: string) => ({
        schemaVersion: 1 as const,
        planId: id,
        runId: 'run-1',
        checkpointId: null,
        environmentFingerprint: 'env-1',
        decision: 'needs_confirmation' as const,
        achievedLevel: 1 as const,
        degradationReasons: ['no_side_effect_proof'],
        stepDecisions: [],
        recoveryMethod: 'continuity_capsule' as const,
        plannerVersion: 'test',
        createdAt: new Date().toISOString(),
      })
      const first = plans.upsertActive(makePlan('plan-1'))
      expect(first.created).toBe(true)
      const dup = plans.upsertActive(makePlan('plan-2'))
      expect(dup.created).toBe(false)
      expect(dup.row.id).toBe('plan-1')
      // 新 env fingerprint 创建新计划，旧的被 superseded
      const plan3 = makePlan('plan-3')
      plan3.environmentFingerprint = 'env-2'
      const third = plans.upsertActive(plan3)
      expect(third.created).toBe(true)
      plans.supersedeActiveForRun('run-1', 'plan-3')
      expect(plans.get('plan-1')?.status).toBe('superseded')
    })
  })

  describe('execution_outbox', () => {
    it('enqueue → takePending → markPublished', () => {
      seedRun()
      outbox.enqueue({ id: 'ox-1', runId: 'run-1', eventType: 'run_accepted' })
      outbox.enqueue({ id: 'ox-2', runId: 'run-1', eventType: 'checkpoint_committed' })
      const pending = outbox.takePending(10)
      expect(pending).toHaveLength(2)
      expect(outbox.markPublished(pending.map((e) => e.id))).toBe(2)
      expect(outbox.takePending(10)).toHaveLength(0)
    })
  })

  describe('跨表不变量：finalizeRun 组合', () => {
    it('终态化同时调和 in-flight Effect、取消 open Wait、释放租约', () => {
      seedRun()
      runs.markRunning('run-1')
      const lease = runs.acquireLease('run-1', 'w', 60_000, ['running'])
      expect(lease.ok).toBe(true)
      const step = steps.ensure({ id: 'st-1', runId: 'run-1', stableKey: 'tool:t1', kind: 'tool' })
      const effect = effects.create({
        id: 'ef-1',
        runId: 'run-1',
        stepId: step.id,
        toolName: 'Bash',
        toolCallId: 'tc-1',
        requestHash: 'h',
        replayPolicy: 'confirm',
      })
      effects.markDispatching(effect.id)
      waits.ensureOpen({ id: 'wt-1', runId: 'run-1', stepId: null, type: 'question', requestJson: {} })

      expect(runs.finishTerminal('run-1', 'cancelled', 'user')).toBe(true)
      const after = runs.get('run-1')
      expect(after?.status).toBe('cancelled')
      expect(after?.leaseOwner).toBeNull()
      // finishTerminal 不自动调和 effect/wait（由 CheckpointWriter.finalizeRun 事务负责）；
      // 仓储各自守卫仍可独立调用：
      expect(effects.reconcileInflightToUnknown('run-1')).toBe(1)
      expect(waits.cancelOpenByRun('run-1')).toBe(1)
    })
  })

  describe('提交前复审回归（2026-09-29 审查修复）', () => {
    it('checksum 覆盖嵌套字段：仅 cursor.nextStepKey 不同 → checksum 不同；篡改嵌套字段被拒', () => {
      seedRun()
      const makeEnvelope = (nextStepKey: string) => ({
        schemaVersion: 1 as const,
        checkpointId: 'ecp-nested',
        runId: 'run-1',
        sequence: 1,
        reason: 'accepted' as const,
        cursor: { phase: 'turn_started', nextStepKey },
        logicalStateRef: '',
        messageWaterline: 0,
        runtimeBinding: { engine: 'claude', nativeSessionId: 'sess-111' },
        openWaitIds: [],
        workspaceSnapshotSetId: undefined,
        definitionFingerprint: '',
        createdAt: '2026-09-29T00:00:00.000Z',
      })
      expect(ExecutionCheckpointRepository.checksum(makeEnvelope('A'))).not.toBe(
        ExecutionCheckpointRepository.checksum(makeEnvelope('B')),
      )
      // 落库后篡改嵌套 runtimeBinding → parseAndValidate 拒绝
      const envelope = { ...makeEnvelope('A'), checksum: ExecutionCheckpointRepository.checksum(makeEnvelope('A')) }
      checkpoints.insert(envelope)
      const row = checkpoints.get('ecp-nested')
      expect(row).not.toBeNull()
      const tampered = JSON.parse(row!.envelope_json) as { runtimeBinding: { nativeSessionId: string } }
      tampered.runtimeBinding.nativeSessionId = 'sess-222'
      const tamperedRow = { ...row!, envelope_json: JSON.stringify(tampered) }
      expect(checkpoints.parseAndValidate(tamperedRow)).toBeNull()
      expect(checkpoints.parseAndValidate(row)).not.toBeNull()
    })

    it('finishTerminal fence：旧 epoch 终态写入被拒；新 epoch 成功；无 fence 走宿主权威路径', () => {
      seedRun()
      runs.markRunning('run-1')
      const first = runs.acquireLease('run-1', 'worker-a', -1, ['running'])
      expect(first.ok).toBe(true)
      if (!first.ok) return
      const staleEpoch = first.record.leaseEpoch
      // 租约过期后新 worker 接管（orphaned 可直接领取）
      runs.markOrphaned('run-1', 'lease_expired')
      const second = runs.acquireLease('run-1', 'worker-b', 60_000, ['orphaned'])
      expect(second.ok).toBe(true)
      if (!second.ok) return
      runs.markRecovering('run-1')
      runs.markRunning('run-1', ['recovering'])
      // 旧 epoch 的终态写入被 fence 拒绝，Run 保持活跃
      expect(runs.finishTerminal('run-1', 'failed', 'stale', { owner: 'worker-a', epoch: staleEpoch })).toBe(false)
      expect(runs.get('run-1')?.status).toBe('running')
      // 新 epoch 成功
      expect(
        runs.finishTerminal('run-1', 'completed', null, {
          owner: 'worker-b',
          epoch: second.record.leaseEpoch,
        }),
      ).toBe(true)
      expect(runs.get('run-1')?.status).toBe('completed')
    })

    it('acquireLease：未过期的有效租约不可抢占；orphaned 状态可直接接管', () => {
      seedRun()
      runs.markRunning('run-1')
      const first = runs.acquireLease('run-1', 'worker-a', 60_000, ['running'])
      expect(first.ok).toBe(true)
      // 活租约被拒（即使状态允许）
      expect(runs.acquireLease('run-1', 'worker-b', 60_000, ['running']).ok).toBe(false)
      expect(runs.get('run-1')?.leaseOwner).toBe('worker-a')
      // orphaned 语义 = 原 Worker 已消失，可立即接管（无需等过期）
      runs.markOrphaned('run-1', 'lease_expired')
      expect(runs.acquireLease('run-1', 'worker-b', 60_000, ['orphaned']).ok).toBe(true)
    })

    it('advanceCheckpointRef / advanceRecoveryPlanRef：终态 Run 不再推进', () => {
      seedRun()
      runs.finishTerminal('run-1', 'completed', null)
      expect(runs.advanceCheckpointRef('run-1', 'ecp-x')).toBe(false)
      expect(runs.advanceRecoveryPlanRef('run-1', 'erp-x')).toBe(false)
      expect(runs.get('run-1')?.latestCheckpointId).toBeNull()
    })

    it('ensureOpen：同类等待关闭后新开一行；同时至多一个 open', () => {
      seedRun()
      const w1 = waits.ensureOpen({ id: 'wt-1', runId: 'run-1', stepId: null, type: 'permission', requestJson: {} })
      expect(w1.status).toBe('open')
      // open 期间幂等：返回同一行
      const w1again = waits.ensureOpen({ id: 'wt-1b', runId: 'run-1', stepId: null, type: 'permission', requestJson: {} })
      expect(w1again.id).toBe(w1.id)
      expect(waits.answer(w1.id, 'answered', { a: 1 }).changed).toBe(true)
      // 关闭后同类等待新开一行（不再复用已答行）
      const w2 = waits.ensureOpen({ id: 'wt-2', runId: 'run-1', stepId: null, type: 'permission', requestJson: {} })
      expect(w2.id).not.toBe(w1.id)
      expect(w2.status).toBe('open')
      expect(waits.listByRun('run-1')).toHaveLength(2)
    })

    it('恢复计划：hasExecutingPlan / settleActiveForRun 生命周期', () => {
      seedRun()
      const plan = {
        schemaVersion: 1 as const,
        planId: 'erp-fence-1',
        runId: 'run-1',
        checkpointId: null,
        environmentFingerprint: 'fp-1',
        decision: 'auto_resume' as const,
        achievedLevel: 1 as const,
        degradationReasons: [],
        stepDecisions: [],
        recoveryMethod: 'fresh_context' as const,
        plannerVersion: 'test',
        createdAt: '2026-09-29T00:00:00.000Z',
      }
      plans.upsertActive(plan)
      expect(plans.hasExecutingPlan('run-1')).toBe(false)
      expect(plans.updateStatus('erp-fence-1', 'executing')).toBe(true)
      expect(plans.hasExecutingPlan('run-1')).toBe(true)
      // 同键 upsert 幂等返回既有 executing 计划
      const again = plans.upsertActive({ ...plan, createdAt: '2026-09-29T01:00:00.000Z' })
      expect(again.created).toBe(false)
      expect(again.row.status).toBe('executing')
      expect(plans.settleActiveForRun('run-1', 'completed')).toBe(1)
      expect(plans.hasExecutingPlan('run-1')).toBe(false)
    })
  })
})

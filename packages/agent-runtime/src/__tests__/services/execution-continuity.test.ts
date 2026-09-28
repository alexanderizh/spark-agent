/**
 * 执行连续性运行时测试 — RecoveryPlanner 表驱动决策、EffectJournal
 * write-ahead 协议、副作用证明检查器、Supervisor 启动扫描与 drain。
 * 对应方案 §16.2「RecoveryPlanner 表驱动 / EffectJournal 幂等与 unknown」。
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { join } from 'node:path'
import { mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import {
  SparkDatabase,
  SessionRepository,
  EventRepository,
  ExecutionRunRepository,
  ExecutionStepRepository,
  ExecutionEffectRepository,
  ExecutionWaitRepository,
  ExecutionCheckpointRepository,
  ExecutionRecoveryPlanRepository,
} from '@spark/storage'
import {
  RecoveryPlanner,
  EffectJournal,
  normalizeRequestHash,
  inspectTurnSideEffects,
  ExecutionSupervisor,
} from '../../services/execution-continuity/index.js'
import { computeEnvironmentFingerprint } from '../../services/execution-continuity/recovery-validator.js'

function createTestDb(testDir: string): SparkDatabase {
  const db = new SparkDatabase(join(testDir, 'test.db'))
  db.runMigrations(join(process.cwd(), '../storage/migrations'))
  return db
}

describe('execution continuity runtime', () => {
  let db: SparkDatabase
  let testDir: string
  let runRepo: ExecutionRunRepository

  const seedRun = (overrides: Record<string, unknown> = {}) =>
    runRepo.create({
      id: 'run-1',
      sessionId: 'sess-1',
      rootTurnId: 'turn-1',
      kind: 'turn',
      runtimeKind: 'claude',
      capabilityCeiling: 2,
      ...overrides,
    })

  beforeEach(() => {
    testDir = join(
      tmpdir(),
      `spark-exec-rt-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    )
    mkdirSync(testDir, { recursive: true })
    db = createTestDb(testDir)
    runRepo = new ExecutionRunRepository(db)
    new SessionRepository(db).create({
      id: 'sess-1',
      kind: 'agent',
      title: 'T',
      status: 'idle',
      projectId: 'default',
    })
  })

  afterEach(() => {
    db.close()
    rmSync(testDir, { recursive: true, force: true })
  })

  describe('RecoveryPlanner 表驱动决策', () => {
    const cases: Array<{
      name: string
      setup: () => void
      input: Partial<Parameters<RecoveryPlanner['plan']>[0]>
      expected: { decision: string; achievedLevel?: number }
    }> = [
      {
        name: '未派发任何工具 + auto 配置 → auto_resume（无 checkpoint 时诚实降为 L1 fresh）',
        setup: () => seedRun(),
        input: {
          sideEffectProof: { kind: 'no_tools_dispatched' },
          supportsNativeResume: true,
          autoRecoveryEnabled: true,
        },
        expected: { decision: 'auto_resume', achievedLevel: 1 },
      },
      {
        name: '只有查询类工具 + 无 capsule → auto_resume L1 fresh',
        setup: () => seedRun(),
        input: {
          sideEffectProof: { kind: 'query_tools_only', toolNames: ['Read', 'Grep'] },
          supportsNativeResume: false,
          hasContinuityCapsule: false,
          autoRecoveryEnabled: true,
        },
        expected: { decision: 'auto_resume', achievedLevel: 1 },
      },
      {
        name: '存在不可验证工具 → needs_confirmation（不自动 fresh resume）',
        setup: () => seedRun(),
        input: {
          sideEffectProof: {
            kind: 'unknown',
            toolNames: ['Bash', 'mcp__x__send'],
            riskyTools: ['Bash', 'mcp__x__send'],
          },
          supportsNativeResume: true,
          autoRecoveryEnabled: true,
        },
        expected: { decision: 'needs_confirmation', achievedLevel: 1 },
      },
      {
        name: 'requestedRecoveryMode=manual → needs_confirmation',
        setup: () => seedRun({ requestedRecoveryMode: 'manual' }),
        input: {
          sideEffectProof: { kind: 'no_tools_dispatched' },
          supportsNativeResume: true,
          autoRecoveryEnabled: true,
          requestedRecoveryMode: 'manual',
        },
        expected: { decision: 'needs_confirmation' },
      },
      {
        name: '配置白名单关闭 → needs_confirmation',
        setup: () => seedRun(),
        input: {
          sideEffectProof: { kind: 'no_tools_dispatched' },
          supportsNativeResume: true,
          autoRecoveryEnabled: false,
        },
        expected: { decision: 'needs_confirmation' },
      },
      {
        name: '无副作用证明（非 turn kind）→ needs_confirmation',
        setup: () => seedRun(),
        input: {
          supportsNativeResume: true,
          autoRecoveryEnabled: true,
        },
        expected: { decision: 'needs_confirmation' },
      },
    ]

    for (const tc of cases) {
      it(tc.name, () => {
        tc.setup()
        const planner = new RecoveryPlanner(db)
        const result = planner.plan({
          run: runRepo.get('run-1')!,
          current: { runtimeKind: 'claude', engine: 'claude' },
          supportsNativeResume: false,
          hasContinuityCapsule: false,
          requestedRecoveryMode: 'auto',
          autoRecoveryEnabled: true,
          ...tc.input,
        })
        expect(result.decision).toBe(tc.expected.decision)
        if (tc.expected.achievedLevel != null) {
          expect(result.plan.achievedLevel).toBe(tc.expected.achievedLevel)
        }
      })
    }

    it('计划幂等：同 run+checkpoint+env 重复规划返回同一计划', () => {
      seedRun()
      const planner = new RecoveryPlanner(db)
      const input = {
        run: runRepo.get('run-1')!,
        current: { runtimeKind: 'claude', engine: 'claude' } as const,
        sideEffectProof: { kind: 'no_tools_dispatched' } as const,
        supportsNativeResume: true,
        hasContinuityCapsule: false,
        requestedRecoveryMode: 'auto' as const,
        autoRecoveryEnabled: true,
      }
      const first = planner.plan(input)
      const second = planner.plan(input)
      expect(second.created).toBe(false)
      expect(second.plan.planId).toBe(first.plan.planId)
    })

    it('unknown Effect 强制降级为 needs_confirmation，即使证明安全', () => {
      seedRun()
      // 造一个 dispatching Effect（模拟崩溃前 write-ahead 已提交）
      const journal = new EffectJournal(db)
      const prepared = journal.prepare({
        runId: 'run-1',
        stepKey: 'tool:tc-9',
        toolName: 'Bash',
        toolCallId: 'tc-9',
        toolInput: { command: 'x' },
      })
      journal.markDispatching('run-1', prepared.effect.id)
      new ExecutionEffectRepository(db).markUnknown(prepared.effect.id)

      const planner = new RecoveryPlanner(db)
      const result = planner.plan({
        run: runRepo.get('run-1')!,
        current: { runtimeKind: 'claude', engine: 'claude' },
        sideEffectProof: { kind: 'no_tools_dispatched' },
        supportsNativeResume: true,
        hasContinuityCapsule: false,
        requestedRecoveryMode: 'auto',
        autoRecoveryEnabled: true,
      })
      expect(result.decision).toBe('needs_confirmation')
      expect(result.plan.degradationReasons).toContain('effects_unknown')
    })
  })

  describe('EffectJournal write-ahead 协议', () => {
    it('prepare 幂等（同 toolCallId 返回既有信封）；confirmed 后不可重放', () => {
      seedRun()
      const journal = new EffectJournal(db)
      const first = journal.prepare({
        runId: 'run-1',
        stepKey: 'tool:t1',
        toolName: 'Bash',
        toolCallId: 'tc-1',
        toolInput: { command: 'ls' },
      })
      expect(first.created).toBe(true)
      expect(first.effect.replayPolicy).toBe('confirm') // Bash → workspace+confirm
      const dup = journal.prepare({
        runId: 'run-1',
        stepKey: 'tool:t1',
        toolName: 'Bash',
        toolCallId: 'tc-1',
        toolInput: { command: 'ls' },
      })
      expect(dup.created).toBe(false)
      expect(dup.effect.id).toBe(first.effect.id)

      expect(journal.markDispatching('run-1', first.effect.id)).toBe(true)
      expect(journal.confirm('run-1', first.effect.id, 'res')).toBe(true)
      // confirmed 后再 dispatching 被拒（防重放）
      expect(journal.markDispatching('run-1', first.effect.id)).toBe(false)
    })

    it('normalizeRequestHash 剔除易变键并规范化 key 顺序', () => {
      const a = normalizeRequestHash({ toolCallId: 'x1', command: 'ls', cwd: '/a' })
      const b = normalizeRequestHash({ cwd: '/a', command: 'ls', requestId: 'y2' })
      expect(a).toBe(b)
      expect(normalizeRequestHash({ command: 'ls' })).not.toBe(
        normalizeRequestHash({ command: 'rm -rf /' }),
      )
    })

    it('读取类工具的派发标记被 policy 拒绝（policyFor sideEffect=none 不建信封）', () => {
      const journal = new EffectJournal(db)
      expect(journal.policyFor('Read').sideEffect).toBe('none')
      expect(journal.policyFor('unknown_mcp_tool', 'mcp').sideEffect).toBe('external_irreversible')
      expect(journal.policyFor('unknown_mcp_tool', 'mcp').replayPolicy).toBe('confirm')
    })
  })

  describe('副作用证明检查器', () => {
    it('无工具事件 → no_tools_dispatched；查询工具 → query_tools_only；副作用工具 → unknown', async () => {
      seedRun()
      const eventRepo = new EventRepository(db)
      const insert = (id: string, toolName: string, source: 'builtin' | 'mcp') => {
        const seqRow = db.raw
          .prepare(`SELECT COALESCE(MAX(seq),0)+1 AS s FROM agent_events WHERE session_id = ?`)
          .get('sess-1') as { s: number }
        eventRepo.insert({
          id,
          sessionId: 'sess-1',
          turnId: 'turn-1',
          eventType: 'tool_call',
          eventJson: JSON.stringify({
            id,
            type: 'tool_call',
            sessionId: 'sess-1',
            turnId: 'turn-1',
            seq: seqRow.s,
            timestamp: new Date().toISOString(),
            toolCallId: id,
            toolName,
            toolInput: {},
            source,
          }),
        })
      }

      // 1. 无事件
      expect(
        inspectTurnSideEffects({ db, sessionId: 'sess-1', turnId: 'turn-1' }),
      ).toEqual({ kind: 'no_tools_dispatched' })

      // 2. 只有查询工具
      insert('ev-1', 'Read', 'builtin')
      insert('ev-2', 'Grep', 'builtin')
      expect(inspectTurnSideEffects({ db, sessionId: 'sess-1', turnId: 'turn-1' })).toEqual({
        kind: 'query_tools_only',
        toolNames: ['Read', 'Grep'],
      })

      // 3. 出现副作用工具
      insert('ev-3', 'Bash', 'builtin')
      const proof = inspectTurnSideEffects({ db, sessionId: 'sess-1', turnId: 'turn-1' })
      expect(proof.kind).toBe('unknown')
      if (proof.kind === 'unknown') expect(proof.riskyTools).toEqual(['Bash'])
    })
  })

  describe('ExecutionSupervisor 启动扫描与 drain', () => {
    it('过期租约的 running run → orphaned → 规划；不可证明 → needs_attention', () => {
      seedRun()
      const supervisor = new ExecutionSupervisor(db)
      runRepo.markRunning('run-1')
      // 直接把租约写成过去（模拟崩溃后重启）
      runRepo.acquireLease('run-1', 'dead-worker', -1, ['running'])

      const summary = supervisor.startupScan()
      expect(summary.totalActiveRuns).toBe(1)
      const run = runRepo.get('run-1')
      // turn run 无事件流证据外的副作用证明材料 + 无 delegate → 保守 needs_attention
      expect(run?.status).toBe('needs_attention')
      supervisor.dispose()
    })

    it('drain：活跃 run 写 shutdown checkpoint 并转 paused，释放租约', () => {
      seedRun()
      const supervisor = new ExecutionSupervisor(db)
      supervisor.onTurnStarted('turn-1', { engine: 'claude' })
      expect(runRepo.get('run-1')?.status).toBe('running')

      const result = supervisor.drainSync('test_shutdown')
      expect(result.paused).toBe(1)
      const run = runRepo.get('run-1')
      expect(run?.status).toBe('paused')
      expect(run?.interruptionReason).toBe('test_shutdown')
      expect(run?.leaseOwner).toBeNull()
      // shutdown checkpoint 已写入
      const latest = new ExecutionCheckpointRepository(db).getLatest('run-1')
      expect(latest?.reason).toBe('shutdown')
      supervisor.dispose()
    })

    it('resolveRun：确认未知副作用 → effects 转 confirmed；abandon → cancelled', () => {
      seedRun()
      const supervisor = new ExecutionSupervisor(db)
      const journal = supervisor.getEffectJournal()
      const prepared = journal.prepare({
        runId: 'run-1',
        stepKey: 'tool:tc-1',
        toolName: 'Bash',
        toolCallId: 'tc-1',
        toolInput: {},
      })
      journal.markDispatching('run-1', prepared.effect.id)
      // 模拟崩溃调和
      new ExecutionEffectRepository(db).markUnknown(prepared.effect.id)

      const confirmed = supervisor.resolveRun('run-1', 'confirm_unknown_effects')
      expect(confirmed.ok).toBe(true)
      expect(new ExecutionEffectRepository(db).get(prepared.effect.id)?.phase).toBe('confirmed')

      const abandoned = supervisor.resolveRun('run-1', 'abandon_keep_state')
      expect(abandoned.ok).toBe(true)
      expect(runRepo.get('run-1')?.status).toBe('cancelled')
      supervisor.dispose()
    })

    it('wait 记录：open → answered CAS；openWaits 计数出现在 summary', () => {
      seedRun()
      const supervisor = new ExecutionSupervisor(db)
      const waitId = supervisor.recordWaitOpened('turn-1', 'question', { q: 1 })
      expect(waitId).not.toBeNull()
      // 幂等：同 stepKey 重复打开返回同一 wait
      const waitId2 = supervisor.recordWaitOpened('turn-1', 'question', { q: 2 })
      expect(waitId2).toBe(waitId)
      const summary = supervisor.listRunSummaries({ activeOnly: true })[0]
      expect(summary?.openWaits).toBe(1)
      supervisor.recordWaitAnswered(waitId!, 'answered', { a: 1 })
      expect(supervisor.listRunSummaries({ activeOnly: true })[0]?.openWaits).toBe(0)
      supervisor.dispose()
    })
  })

  describe('提交前复审回归（2026-09-29 审查修复）', () => {
    it('启动扫描跳过 accepted turn Run：不派恢复、不改状态（防与 turn_request 重放双执行）', () => {
      seedRun() // status accepted
      const supervisor = new ExecutionSupervisor(db)
      supervisor.startupScan()
      const run = runRepo.get('run-1')
      expect(run?.status).toBe('accepted')
      expect(run?.interruptionReason).toBeNull()
      supervisor.dispose()
    })

    it('启动扫描：租约仍有效的 running run → needs_attention（不自动恢复）', () => {
      seedRun()
      const supervisor = new ExecutionSupervisor(db)
      runRepo.markRunning('run-1')
      runRepo.acquireLease('run-1', 'other-worker', 60_000, ['running'])
      supervisor.startupScan()
      const run = runRepo.get('run-1')
      expect(run?.status).toBe('needs_attention')
      expect(run?.interruptionReason).toBe('lease_still_valid_at_startup')
      supervisor.dispose()
    })

    it('恢复 Turn 终态闭环原 Run：parent 随恢复结果终态化（防每重启重复派发）', () => {
      seedRun()
      const supervisor = new ExecutionSupervisor(db)
      runRepo.markRunning('run-1')
      runRepo.markOrphaned('run-1', 'lease_expired')
      runRepo.markRecovering('run-1')
      // 恢复 Turn 的 Run 挂 parentRunId = 原崩溃 Run
      supervisor.ensureTurnRun({
        turnId: 'turn-rec',
        sessionId: 'sess-1',
        runtimeKind: 'claude',
        parentRunId: 'run-1',
      })
      supervisor.onTurnStarted('turn-rec', { engine: 'claude' })
      supervisor.onTurnTerminal('turn-rec', 'completed', null)
      expect(runRepo.get('erun_turn-rec')?.status).toBe('completed')
      expect(runRepo.get('run-1')?.status).toBe('completed')
      supervisor.dispose()
    })

    it('executing 计划在途：启动扫描不重复派发（Run 保持 orphaned）', () => {
      seedRun()
      const supervisor = new ExecutionSupervisor(db)
      runRepo.markRunning('run-1')
      runRepo.markOrphaned('run-1', 'lease_expired')
      const planRepo = new ExecutionRecoveryPlanRepository(db)
      planRepo.upsertActive({
        schemaVersion: 1,
        planId: 'erp-scan-1',
        runId: 'run-1',
        checkpointId: null,
        environmentFingerprint: 'fp',
        decision: 'auto_resume',
        achievedLevel: 1,
        degradationReasons: [],
        stepDecisions: [],
        recoveryMethod: 'fresh_context',
        plannerVersion: 'test',
        createdAt: new Date().toISOString(),
      })
      planRepo.updateStatus('erp-scan-1', 'executing')
      supervisor.startupScan()
      // 无 delegate 时正常路径会转 needs_attention(no_resume_executor)；
      // executing 计划在途 → 直接跳过，状态不动
      expect(runRepo.get('run-1')?.status).toBe('orphaned')
      supervisor.dispose()
    })

    it('resolveRun restart_from_checkpoint：running 活租约状态拒绝（防双执行器与租约抢占）', () => {
      seedRun()
      const supervisor = new ExecutionSupervisor(db)
      supervisor.onTurnStarted('turn-1', { engine: 'claude' })
      expect(runRepo.get('run-1')?.status).toBe('running')
      const res = supervisor.resolveRun('run-1', 'restart_from_checkpoint')
      expect(res.ok).toBe(false)
      expect(res.message).toContain('不支持')
      expect(runRepo.get('run-1')?.status).toBe('running')
      supervisor.dispose()
    })

    it('computeEnvironmentFingerprint：随环境变化且稳定（非常量）', () => {
      const a = computeEnvironmentFingerprint({ runtimeKind: 'claude', modelId: 'model-a' })
      const b = computeEnvironmentFingerprint({ runtimeKind: 'claude', modelId: 'model-b' })
      expect(a).not.toBe(b)
      expect(computeEnvironmentFingerprint({ runtimeKind: 'claude', modelId: 'model-a' })).toBe(a)
    })
  })
})

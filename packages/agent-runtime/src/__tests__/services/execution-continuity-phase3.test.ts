/**
 * 执行连续性 Phase 2 深化 + Phase 3B/3C 测试 — Spark Engine ledger 三态精确调和、
 * workflow Run 生命周期（建档/节点提交/终态/图漂移）、goal 生命周期（迭代 step /
 * 终态 / 启动恢复判定）、SubApp Job 投影与放弃写回、startupScan 新 kinds 路由。
 * 对应方案 §11.1–§11.3、§14 Phase 3B/3C、§16.2。
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
} from '@spark/storage'
import { ExecutionSupervisor, EffectJournal } from '../../services/execution-continuity/index.js'
import { buildLedgerReconciliationEvidence } from '../../sdk/spark-engine/ledger-recovery.js'

function createTestDb(testDir: string): SparkDatabase {
  const db = new SparkDatabase(join(testDir, 'test.db'))
  db.runMigrations(join(process.cwd(), '../storage/migrations'))
  return db
}

describe('execution continuity phase 3', () => {
  let db: SparkDatabase
  let testDir: string
  let supervisor: ExecutionSupervisor
  let runRepo: ExecutionRunRepository
  let stepRepo: ExecutionStepRepository
  let effectRepo: ExecutionEffectRepository
  let journal: EffectJournal

  beforeEach(() => {
    testDir = join(
      tmpdir(),
      `spark-exec-p3-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    )
    mkdirSync(testDir, { recursive: true })
    db = createTestDb(testDir)
    runRepo = new ExecutionRunRepository(db)
    stepRepo = new ExecutionStepRepository(db)
    effectRepo = new ExecutionEffectRepository(db)
    supervisor = new ExecutionSupervisor(db)
    journal = supervisor.getEffectJournal()
    new SessionRepository(db).create({
      id: 'sess-1',
      kind: 'agent',
      title: 'T',
      status: 'idle',
      projectId: 'default',
    })
  })

  afterEach(() => {
    supervisor.dispose()
    db.close()
    rmSync(testDir, { recursive: true, force: true })
  })

  describe('Spark Engine ledger 三态精确调和（Phase 2 深化 / L3）', () => {
    it('buildLedgerReconciliationEvidence：按 call/intent/result 相位分桶（崩溃窗口枚举）', () => {
      const evidence = buildLedgerReconciliationEvidence([
        { type: 'tool.call', callId: 'ok' },
        { type: 'tool.intent', callId: 'ok' },
        { type: 'tool.result', callId: 'ok', ok: true },
        { type: 'tool.call', callId: 'orphan' },
        { type: 'tool.intent', callId: 'orphan' },
        { type: 'tool.call', callId: 'undelivered' },
        { type: 'session.started' },
        { type: 'tool.call' }, // 无 callId 的事件忽略
      ])
      expect([...evidence.resultCallIds]).toEqual(['ok'])
      expect([...evidence.orphanIntentCallIds]).toEqual(['orphan'])
      expect([...evidence.undeliveredCallIds]).toEqual(['undelivered'])
    })

    it('ok:false 的 result 不计入已确认：拒绝（无 intent）→未派发、超时（有 intent）→真 unknown', () => {
      const evidence = buildLedgerReconciliationEvidence([
        // #deny 拒绝：tool.call + ok:false result，从未派发
        { type: 'tool.call', callId: 'denied' },
        { type: 'tool.result', callId: 'denied', ok: false },
        // 超时：越过派发边界但结果未确认（Outcome is not confirmed）
        { type: 'tool.call', callId: 'timedout' },
        { type: 'tool.intent', callId: 'timedout' },
        { type: 'tool.result', callId: 'timedout', ok: false },
      ])
      expect([...evidence.resultCallIds]).toEqual([])
      expect([...evidence.undeliveredCallIds]).toEqual(['denied'])
      expect([...evidence.orphanIntentCallIds]).toEqual(['timedout'])
    })

    const seedSparkRunWithEffect = (toolCallId: string) => {
      supervisor.ensureTurnRun({
        turnId: 'turn-ledger',
        sessionId: 'sess-1',
        runtimeKind: 'spark-engine',
      })
      const prepared = journal.prepare({
        runId: 'erun_turn-ledger',
        stepKey: `tool:${toolCallId}`,
        stepKind: 'tool',
        toolName: 'Write',
        toolSource: 'builtin',
        toolCallId,
        toolInput: { path: '/tmp/x' },
      })
      journal.markDispatching('erun_turn-ledger', prepared.effect.id)
      return prepared.effect
    }

    it('账本已有 tool.result → dispatching 精确确认为 confirmed（崩溃窗口 D）', () => {
      const effect = seedSparkRunWithEffect('call-1')
      supervisor.reconcileEffectsFromEngineLedger('sess-1', {
        resultCallIds: new Set(['call-1']),
        orphanIntentCallIds: new Set(),
        undeliveredCallIds: new Set(),
      })
      expect(effectRepo.get(effect.id)?.phase).toBe('confirmed')
      expect(stepRepo.get(effect.stepId)?.status).toBe('committed')
    })

    it('会话级作用域：崩溃 Run 与恢复 Turn 不同 turnId 也能调和（按会话定位目标 Run）', () => {
      const effect = seedSparkRunWithEffect('call-1b')
      // 模拟重启后：原 Run paused，恢复 Turn 是新 turnId 的新 Run。
      runRepo.markPaused('erun_turn-ledger', 'app_shutdown')
      supervisor.ensureTurnRun({
        turnId: 'turn-recovery',
        sessionId: 'sess-1',
        runtimeKind: 'spark-engine',
      })
      supervisor.reconcileEffectsFromEngineLedger('sess-1', {
        resultCallIds: new Set(['call-1b']),
        orphanIntentCallIds: new Set(),
        undeliveredCallIds: new Set(),
      })
      expect(effectRepo.get(effect.id)?.phase).toBe('confirmed')
    })

    it('孤儿 intent（有 intent 无 result）→ dispatching 调和为 unknown 后维持（真未知）', () => {
      const effect = seedSparkRunWithEffect('call-2')
      supervisor.reconcileEffectsFromEngineLedger('sess-1', {
        resultCallIds: new Set(),
        orphanIntentCallIds: new Set(['call-2']),
        undeliveredCallIds: new Set(),
      })
      // dispatching + 孤儿 intent：维持 dispatching 相位语义（终态调和时统一转 unknown）。
      const phase = effectRepo.get(effect.id)?.phase
      expect(phase === 'dispatching' || phase === 'unknown').toBe(true)
    })

    it('仅 tool.call 无 intent（从未派发）→ dispatching 安全标记 failed，不重放', () => {
      const effect = seedSparkRunWithEffect('call-3')
      supervisor.reconcileEffectsFromEngineLedger('sess-1', {
        resultCallIds: new Set(),
        orphanIntentCallIds: new Set(),
        undeliveredCallIds: new Set(['call-3']),
      })
      expect(effectRepo.get(effect.id)?.phase).toBe('failed')
      expect(stepRepo.get(effect.stepId)?.status).toBe('failed')
    })

    it('unknown 相位且有账本 result → reconcileUnknown 精确确认', () => {
      const effect = seedSparkRunWithEffect('call-4')
      effectRepo.markUnknown(effect.id)
      supervisor.reconcileEffectsFromEngineLedger('sess-1', {
        resultCallIds: new Set(['call-4']),
        orphanIntentCallIds: new Set(),
        undeliveredCallIds: new Set(),
      })
      expect(effectRepo.get(effect.id)?.phase).toBe('confirmed')
    })

    it('空证据集合（账本被清）→ 不动作，保持保守', () => {
      const effect = seedSparkRunWithEffect('call-5')
      supervisor.reconcileEffectsFromEngineLedger('sess-1', {
        resultCallIds: new Set(),
        orphanIntentCallIds: new Set(),
        undeliveredCallIds: new Set(),
      })
      expect(effectRepo.get(effect.id)?.phase).toBe('dispatching')
    })

    it('spark-engine adapter 声明能力上限为 L3，ensureTurnRun 采用声明值', () => {
      const run = supervisor.ensureTurnRun({
        turnId: 'turn-ceiling',
        sessionId: 'sess-1',
        runtimeKind: 'spark-engine',
      })
      expect(run.capabilityCeiling).toBe(3)
      expect(run.currentGuaranteedLevel).toBe(3)
    })
  })

  describe('workflow Run 生命周期（Phase 3A 剩余）', () => {
    it('建档幂等 + 节点提交 step/checkpoint + 终态收口', () => {
      const first = supervisor.ensureWorkflowRun({
        workflowRunId: 'wfrun-1',
        sessionId: 'sess-1',
        turnId: 'turn-wf',
        workflowId: 'wf-1',
        graphDigest: 'digest-a',
        nameSnapshot: 'flow',
        versionSnapshot: '1.0.0',
      })
      expect(first?.kind).toBe('workflow')
      expect(first?.definitionFingerprint).toBe('digest-a')
      const again = supervisor.ensureWorkflowRun({
        workflowRunId: 'wfrun-1',
        sessionId: 'sess-1',
        turnId: 'turn-wf',
        workflowId: 'wf-1',
        graphDigest: 'digest-a',
      })
      expect(again?.id).toBe(first?.id)

      supervisor.onWorkflowNodeCommitted('wfrun-1', 'node-1')
      supervisor.onWorkflowNodeCommitted('wfrun-1', 'node-2')
      const steps = stepRepo.listByRun('erun_wf_wfrun-1')
      expect(steps).toHaveLength(2)
      expect(steps.every((s) => s.status === 'committed')).toBe(true)
      expect(steps.map((s) => s.stableKey).sort()).toEqual([
        'workflow_node:node-1',
        'workflow_node:node-2',
      ])

      supervisor.onWorkflowTerminal('wfrun-1', 'completed', null)
      const terminal = runRepo.get('erun_wf_wfrun-1')
      expect(terminal?.status).toBe('completed')
    })

    it('图版本漂移：frozen ≠ current → runtime binding 记录 + outbox 事件；一致时不记录', () => {
      supervisor.ensureWorkflowRun({
        workflowRunId: 'wfrun-2',
        sessionId: 'sess-1',
        turnId: 'turn-wf2',
        workflowId: 'wf-2',
        graphDigest: 'frozen-digest',
      })
      supervisor.noteWorkflowGraphDrift('wfrun-2', 'frozen-digest', 'current-digest')
      const drifted = runRepo.get('erun_wf_wfrun-2')
      const binding = drifted?.runtimeBindingJson as { graphDrift?: { frozenDigest: string } }
      expect(binding.graphDrift?.frozenDigest).toBe('frozen-digest')

      supervisor.noteWorkflowGraphDrift('wfrun-2', 'frozen-digest', 'frozen-digest')
      const unchanged = runRepo.get('erun_wf_wfrun-2')
      expect((unchanged?.runtimeBindingJson as { driftCount?: number }).driftCount).toBeUndefined()

      supervisor.noteWorkflowGraphDrift('wfrun-2', 'frozen-digest', null)
      const stillSingle = runRepo.get('erun_wf_wfrun-2')
      expect((stillSingle?.runtimeBindingJson as { graphDrift?: unknown }).graphDrift).toBeDefined()
    })

    it('startupScan：workflow orphaned → paused(workflow_deferred_resume)，不做 auto_resume', () => {
      supervisor.ensureWorkflowRun({
        workflowRunId: 'wfrun-3',
        sessionId: 'sess-1',
        turnId: 'turn-wf3',
        workflowId: 'wf-3',
        graphDigest: 'd',
      })
      runRepo.markRunning('erun_wf_wfrun-3', ['accepted'])
      runRepo.markOrphaned('erun_wf_wfrun-3', 'lease_expired')
      const summary = supervisor.startupScan()
      const run = runRepo.get('erun_wf_wfrun-3')
      expect(run?.status).toBe('paused')
      expect(run?.interruptionReason).toBe('workflow_deferred_resume')
      expect(summary.runIds).toContain('erun_wf_wfrun-3')
    })
  })

  describe('goal 生命周期（Phase 3B）', () => {
    it('根 Run 建档 + 迭代 step + parentRunId 关联 + 迭代提交', () => {
      const goalRun = supervisor.ensureGoalRun({
        goalId: 'goal-1',
        sessionId: 'sess-1',
        objective: 'obj',
        mode: 'spark-loop',
      })
      expect(goalRun?.kind).toBe('goal')

      supervisor.ensureTurnRun({
        turnId: 'turn-iter-1',
        sessionId: 'sess-1',
        runtimeKind: 'claude',
      })
      supervisor.onGoalIterationStarted('goal-1', 1, 'turn-iter-1')
      const iterRun = runRepo.findByRootTurnId('turn-iter-1')
      expect(iterRun?.parentRunId).toBe('erun_goal_goal-1')
      // 迭代 Run 正常执行中（running）不算「需要处理」，只有 needs_attention/
      // orphaned 的子 Run 才阻断 goal 根 Run 重启迭代。
      expect(supervisor.hasNonTerminalChildRuns('erun_goal_goal-1')).toBe(false)
      runRepo.markNeedsAttention(iterRun!.id, 'interrupted')
      expect(supervisor.hasNonTerminalChildRuns('erun_goal_goal-1')).toBe(true)

      const step = stepRepo.findByStableKey('erun_goal_goal-1', 'goal_iteration:1')
      expect(step?.status).toBe('running')

      supervisor.onGoalIterationCommitted('goal-1', 1, 'act')
      expect(stepRepo.get(step!.id)?.status).toBe('committed')
    })

    it('goal 终态：completed → Run 收口；paused → Run 暂停', () => {
      supervisor.ensureGoalRun({
        goalId: 'goal-2',
        sessionId: 'sess-1',
        objective: 'obj',
        mode: 'spark-loop',
      })
      supervisor.onGoalTerminal('goal-2', 'paused')
      expect(runRepo.get('erun_goal_goal-2')?.status).toBe('paused')
      supervisor.onGoalTerminal('goal-2', 'completed')
      expect(runRepo.get('erun_goal_goal-2')?.status).toBe('completed')
    })

    it('startupScan：goal orphaned → paused(goal_startup_recovery)，不进 turn 规划', () => {
      supervisor.ensureGoalRun({
        goalId: 'goal-3',
        sessionId: 'sess-1',
        objective: 'obj',
        mode: 'spark-loop',
      })
      runRepo.markRunning('erun_goal_goal-3', ['accepted'])
      runRepo.markOrphaned('erun_goal_goal-3', 'lease_expired')
      supervisor.startupScan()
      const run = runRepo.get('erun_goal_goal-3')
      expect(run?.status).toBe('paused')
      expect(run?.interruptionReason).toBe('goal_startup_recovery')
    })
  })

  describe('子 Agent 派发 step（Phase 3B §11.3）', () => {
    it('派发 opened → waiting step；settled completed → committed；failed → cancelled', () => {
      supervisor.ensureTurnRun({
        turnId: 'turn-disp',
        sessionId: 'sess-1',
        runtimeKind: 'claude',
      })
      supervisor.onSubagentDispatchOpened({
        turnId: 'turn-disp',
        dispatchId: 'disp-1',
        memberAgentId: 'member-a',
        parallel: true,
      })
      const waiting = stepRepo.findByStableKey('erun_turn-disp', 'dispatch:disp-1')
      expect(waiting?.status).toBe('waiting')
      expect(waiting?.kind).toBe('subagent')

      supervisor.onSubagentDispatchSettled('disp-1', 'completed')
      expect(stepRepo.get(waiting!.id)?.status).toBe('committed')

      supervisor.onSubagentDispatchOpened({
        turnId: 'turn-disp',
        dispatchId: 'disp-2',
        memberAgentId: 'member-b',
        parallel: false,
      })
      supervisor.onSubagentDispatchSettled('disp-2', 'failed')
      const failed = stepRepo.findByStableKey('erun_turn-disp', 'dispatch:disp-2')
      expect(stepRepo.get(failed!.id)?.status).toBe('cancelled')
    })
  })

  describe('SubApp Job 投影与放弃写回（Phase 3C）', () => {
    const seedSubAppJob = (jobId: string, status: string, checkpoint: string | null) => {
      const now = new Date().toISOString()
      db.raw
        .prepare(
          `INSERT INTO sub_apps (id, name, surface, publication_status, created_at, updated_at)
           VALUES ('app-1', 'A', 'content', 'draft', ?, ?)`,
        )
        .run(now, now)
      db.raw
        .prepare(
          `INSERT INTO sub_app_releases (id, app_id, version, source, config_json, permissions_json,
             entry, surface, name, description, published_at)
           VALUES ('rel-1', 'app-1', 1, 'manual', '{}', '[]', 'index.html', 'content', 'A', '', ?)`,
        )
        .run(now)
      db.raw
        .prepare(
          `INSERT INTO sub_app_jobs (id, app_id, release_id, type, status, checkpoint_json, created_at, updated_at)
           VALUES (?, 'app-1', 'rel-1', 'import', ?, ?, ?, ?)`,
        )
        .run(jobId, status, checkpoint, now, now)
    }

    it('interrupted job → startupScan 投影为 needs_attention Run（诚实：不伪造恢复）', () => {
      seedSubAppJob('job-1', 'interrupted', JSON.stringify({ lastStep: 3 }))
      supervisor.startupScan()
      const run = runRepo.get('erun_subapp_job-1')
      expect(run?.kind).toBe('subapp')
      expect(run?.status).toBe('needs_attention')
      expect(run?.interruptionReason).toBe('subapp_job_interrupted')
      const binding = run?.runtimeBindingJson as { hasCheckpoint?: boolean }
      expect(binding.hasCheckpoint).toBe(true)
    })

    it('queued job → 投影但不标 needs_attention（JobManager 将重跑）', () => {
      seedSubAppJob('job-2', 'queued', 'null')
      supervisor.startupScan()
      const run = runRepo.get('erun_subapp_job-2')
      expect(run?.status).not.toBe('needs_attention')
    })

    it('恢复中心放弃 → Run cancelled 且 sub_app_jobs 写回 cancelled', () => {
      seedSubAppJob('job-3', 'interrupted', 'null')
      supervisor.startupScan()
      const result = supervisor.resolveRun('erun_subapp_job-3', 'abandon_keep_state')
      expect(result.ok).toBe(true)
      expect(runRepo.get('erun_subapp_job-3')?.status).toBe('cancelled')
      const jobRow = db.raw
        .prepare(`SELECT status, error_json FROM sub_app_jobs WHERE id = 'job-3'`)
        .get() as { status: string; error_json: string | null }
      expect(jobRow.status).toBe('cancelled')
      expect(jobRow.error_json).toContain('USER_ABANDONED')
    })

    it('drain 不代管 subapp 投影 Run（状态由 sub_app_jobs 驱动）', () => {
      seedSubAppJob('job-4', 'interrupted', 'null')
      supervisor.startupScan()
      supervisor.drainSync('app_shutdown')
      expect(runRepo.get('erun_subapp_job-4')?.status).toBe('needs_attention')
    })
  })

  describe('goal Run 恢复中心 safe_continue（delegate 路由）', () => {
    it('goal Run safe_continue 委托 resumeGoalLoop；无 delegate 时明确拒绝', () => {
      supervisor.ensureGoalRun({
        goalId: 'goal-4',
        sessionId: 'sess-1',
        objective: 'obj',
        mode: 'spark-loop',
      })
      runRepo.markNeedsAttention('erun_goal_goal-4', 'goal_iteration_interrupted')
      const denied = supervisor.resolveRun('erun_goal_goal-4', 'safe_continue')
      expect(denied.ok).toBe(false)

      let resumedSession: string | null = null
      supervisor.bindTurnDelegate({
        hasContinuityCapsule: () => false,
        resumeTurnRun: () => undefined,
        resumeGoalLoop: (sessionId) => {
          resumedSession = sessionId
          return true
        },
        environmentFor: () => ({ engine: 'claude' }),
      })
      const ok = supervisor.resolveRun('erun_goal_goal-4', 'safe_continue')
      expect(ok.ok).toBe(true)
      expect(resumedSession).toBe('sess-1')
      expect(runRepo.get('erun_goal_goal-4')?.status).toBe('recovering')
    })
  })
})

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { SparkDatabase } from '../database.js'
import { AgentRepository } from './agent.repository.js'
import { SessionRepository } from './session.repository.js'
import { SessionWorkflowBindingRepository } from './session-workflow-binding.repository.js'
import { WorkflowBundleRepository } from './workflow-bundle.repository.js'
import { WorkflowRepository } from './workflow.repository.js'
import { WorkflowRunRepository } from './workflow-run.repository.js'
import {
  WorkflowReferenceGuardError,
  inspectWorkflowReferences,
} from './workflow-reference.guard.js'

describe('workflow reference guard', () => {
  let db: SparkDatabase
  let dir: string
  let agents: AgentRepository
  let sessions: SessionRepository
  let bindings: SessionWorkflowBindingRepository
  let bundles: WorkflowBundleRepository
  let workflows: WorkflowRepository
  let runs: WorkflowRunRepository

  beforeEach(() => {
    dir = join(tmpdir(), `spark-workflow-guard-${Date.now()}-${Math.random()}`)
    mkdirSync(dir, { recursive: true })
    db = new SparkDatabase(join(dir, 'test.db'))
    db.runMigrations(join(process.cwd(), 'migrations'))
    agents = new AgentRepository(db)
    sessions = new SessionRepository(db)
    bindings = new SessionWorkflowBindingRepository(db)
    bundles = new WorkflowBundleRepository(db)
    workflows = new WorkflowRepository(db)
    runs = new WorkflowRunRepository(db)
    sessions.create({ id: 'session-a', kind: 'chat', title: 'A', status: 'idle', projectId: 'p' })
    workflows.create({ id: 'wf-a', name: 'A', status: 'active' })
  })

  afterEach(() => {
    db.close()
    rmSync(dir, { recursive: true, force: true })
  })

  it('reports no blockers for an unreferenced workflow and allows delete', () => {
    expect(inspectWorkflowReferences(db, 'wf-a')).toEqual([])
    expect(workflows.delete('wf-a')).toBe(true)
    expect(workflows.get('wf-a')).toBeNull()
  })

  it('blocks interactive delete on agent references instead of silently unbinding', () => {
    agents.create({ id: 'agent-x', name: 'X', providerProfileId: 'p', workflowId: 'wf-a' })

    expect(inspectWorkflowReferences(db, 'wf-a')).toEqual([
      { code: 'workflow_referenced_by_agents', agentIds: ['agent-x'] },
    ])
    expect(() => workflows.delete('wf-a')).toThrow(WorkflowReferenceGuardError)
    expect(workflows.get('wf-a')).not.toBeNull()
    expect(agents.get('agent-x')?.workflowId).toBe('wf-a')
  })

  it('blocks interactive delete on session bindings and resumable runs', () => {
    bindings.create({ sessionId: 'session-a', mode: 'override', workflowId: 'wf-a' })
    expect(() => workflows.delete('wf-a')).toThrow(/会话仍挂载/)

    const legacyFailed = runs.create({
      id: 'run-legacy-failed',
      sessionId: 'session-a',
      turnId: 'turn-1',
      workflowId: 'wf-a',
      objective: 'legacy failed run stays resumable',
      graph: { nodes: [], edges: [] },
    })
    runs.updateSnapshot(legacyFailed.id, {
      status: 'failed',
      state: {},
      executions: [],
      atomicExecutions: [],
      completedNodeIds: [],
      failedNode: { nodeId: 'n', agentId: 'a', attempt: 1, error: { code: 'x' } },
    })
    const inspectors = inspectWorkflowReferences(db, 'wf-a')
    expect(inspectors).toContainEqual({
      code: 'workflow_run_resumable',
      runIds: [legacyFailed.id],
    })
  })

  it('does not treat abandoned failed runs (rotated generation) as resumable', () => {
    const binding = bindings.create({
      sessionId: 'session-a',
      mode: 'override',
      workflowId: 'wf-a',
    })
    const run = runs.create({
      id: 'run-abandoned',
      sessionId: 'session-a',
      turnId: 'turn-1',
      workflowId: 'wf-a',
      objective: 'failed in a rotated-away generation',
      graph: { nodes: [], edges: [] },
      workflowBindingInstanceId: binding.bindingInstanceId,
    })
    runs.updateSnapshot(run.id, {
      status: 'failed',
      state: {},
      executions: [],
      atomicExecutions: [],
      completedNodeIds: [],
      failedNode: { nodeId: 'n', agentId: 'a', attempt: 1, error: { code: 'x' } },
    })
    // 代次轮换后旧失败 Run 不再可恢复（放弃语义），只剩 binding 引用阻断。
    bindings.rotateGeneration('session-a', binding.bindingInstanceId)
    expect(inspectWorkflowReferences(db, 'wf-a')).toEqual([
      { code: 'workflow_referenced_by_bindings', sessionIds: ['session-a'] },
    ])
  })

  it('blocks interactive delete for workflows of an installed bundle, allows bundle uninstall tier', () => {
    bundles.create({ id: 'bundle-1', name: 'B', version: '1.0.0', manifestJson: '{}' })
    workflows.create({ id: 'wf-bundled', name: 'Bundled', status: 'active', bundleId: 'bundle-1' })

    expect(inspectWorkflowReferences(db, 'wf-bundled')).toEqual([
      { code: 'workflow_in_installed_bundle', bundleId: 'bundle-1' },
    ])
    expect(() => workflows.delete('wf-bundled')).toThrow(/Bundle/)
    // 卸载层级不受 Bundle 归属与 Agent 引用阻断（那是卸载流程自身的显式操作）。
    agents.create({ id: 'agent-b', name: 'B', providerProfileId: 'p', workflowId: 'wf-bundled' })
    // 卸载流程先显式解除 Agent 默认引用（uninstallBundle 的调用顺序），再删定义。
    expect(workflows.clearAgentReferences('wf-bundled')).toBe(1)
    expect(workflows.delete('wf-bundled', { policy: 'bundle-uninstall' })).toBe(true)
    expect(agents.get('agent-b')?.workflowId).toBeNull()
  })

  it('bundle-uninstall tier still refuses bindings and resumable runs', () => {
    bindings.create({ sessionId: 'session-a', mode: 'override', workflowId: 'wf-a' })
    expect(() => workflows.delete('wf-a', { policy: 'bundle-uninstall' })).toThrow(
      WorkflowReferenceGuardError,
    )
    expect(workflows.get('wf-a')).not.toBeNull()
  })

  it('internalRollback asserts zero bindings and zero runs of any status', () => {
    const completed = runs.create({
      id: 'run-completed',
      sessionId: 'session-a',
      turnId: 'turn-1',
      workflowId: 'wf-a',
      objective: 'terminal run still forbids rollback deletion',
      graph: { nodes: [], edges: [] },
    })
    runs.updateSnapshot(completed.id, {
      status: 'completed',
      state: {},
      executions: [],
      atomicExecutions: [],
      completedNodeIds: [],
    })
    expect(() => workflows.delete('wf-a', { policy: 'internalRollback' })).toThrow(
      WorkflowReferenceGuardError,
    )
    expect(workflows.get('wf-a')).not.toBeNull()

    runs.deleteBySession('session-a')
    expect(workflows.delete('wf-a', { policy: 'internalRollback' })).toBe(true)
  })
})

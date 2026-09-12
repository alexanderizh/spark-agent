import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fileURLToPath } from 'node:url'
import {
  AgentRepository,
  SessionRepository,
  SessionWorkflowBindingRepository,
  SettingsRepository,
  SparkDatabase,
  TurnRequestRepository,
  WorkflowRepository,
  WorkflowRunRepository,
} from '@spark/storage'
import {
  WorkflowBindingService,
  type WorkflowBindingServiceHost,
} from './workflow-binding.service.js'

describe('WorkflowBindingService', () => {
  let db: SparkDatabase
  let host: WorkflowBindingServiceHost
  let service: WorkflowBindingService
  let blockers: WorkflowBindingServiceHost['getInMemoryChangeBlockers'] extends (
    sessionId: string,
  ) => infer T
    ? T
    : never

  beforeEach(() => {
    db = new SparkDatabase(':memory:')
    db.runMigrations(fileURLToPath(new URL('../../../../storage/migrations', import.meta.url)))
    new AgentRepository(db).create({
      id: 'agent-a',
      name: 'Agent A',
      workflowId: null,
      providerProfileId: 'provider-a',
      agentAdapter: 'claude-sdk',
    })
    new SessionRepository(db).create({
      id: 'session-a',
      kind: 'agent',
      title: 'A',
      status: 'idle',
      projectId: 'default',
      providerProfileId: 'provider-a',
      agentId: 'agent-a',
      agentAdapter: 'claude-sdk',
    })
    blockers = []
    host = {
      getInMemoryChangeBlockers: () => blockers,
      onBindingChanged: vi.fn(),
    }
    service = new WorkflowBindingService(db, host)
  })

  afterEach(() => db.close())

  it('defaults both trusted feature flags off and rejects writes', () => {
    expect(service.get('session-a').features).toEqual({
      writeEnabled: false,
      runtimeRequested: false,
      runtimeEnabled: false,
    })
    expect(() =>
      service.set({
        sessionId: 'session-a',
        mode: 'inherit',
        expectedBindingInstanceId: null,
      }),
    ).toThrow('尚未启用')
    expect(new SessionWorkflowBindingRepository(db).get('session-a')).toBeNull()
  })

  it('keeps the trusted write and runtime feature switches independent', () => {
    const settings = new SettingsRepository(db)
    settings.set('sessionWorkflowBinding', 'runtimeEnabled', true)
    expect(service.get('session-a').features).toEqual({
      writeEnabled: false,
      runtimeRequested: true,
      runtimeEnabled: true,
    })
    expect(() =>
      service.set({
        sessionId: 'session-a',
        mode: 'disabled',
        expectedBindingInstanceId: null,
      }),
    ).toThrow('尚未启用')

    settings.set('sessionWorkflowBinding', 'runtimeEnabled', false)
    settings.set('sessionWorkflowBinding', 'writeEnabled', true)
    const response = service.set({
      sessionId: 'session-a',
      mode: 'disabled',
      expectedBindingInstanceId: null,
    })
    expect(response.changed).toBe(true)
    expect(service.get('session-a').features).toEqual({
      writeEnabled: true,
      runtimeRequested: false,
      runtimeEnabled: false,
    })
  })

  it('sets, reads, and idempotently preserves a valid override generation', () => {
    enableFlags(db)
    new WorkflowRepository(db).create({
      id: 'workflow-a',
      name: 'Workflow A',
      status: 'active',
      enabled: true,
      graph: {
        nodes: [{ id: 'step', kind: 'input', title: 'Step', config: {} }],
        edges: [],
      },
    })

    const first = service.set({
      sessionId: 'session-a',
      mode: 'override',
      workflowId: 'workflow-a',
      expectedBindingInstanceId: null,
    })
    expect(first.binding).not.toBeNull()
    if (first.binding == null) throw new Error('expected binding')
    const repeated = service.set({
      sessionId: 'session-a',
      mode: 'override',
      workflowId: 'workflow-a',
      expectedBindingInstanceId: first.binding.bindingInstanceId,
    })
    expect(repeated.binding).not.toBeNull()
    if (repeated.binding == null) throw new Error('expected repeated binding')

    expect(first).toMatchObject({
      changed: true,
      effective: { source: 'session-override', workflowId: 'workflow-a' },
      preflight: { ok: true, issues: [], warnings: [] },
    })
    expect(repeated.changed).toBe(false)
    expect(repeated.binding.bindingInstanceId).toBe(first.binding.bindingInstanceId)
    expect(host.onBindingChanged).toHaveBeenCalledTimes(1)
  })

  it('rejects stale generations and active in-memory gates', () => {
    enableFlags(db)
    const first = service.set({
      sessionId: 'session-a',
      mode: 'inherit',
      expectedBindingInstanceId: null,
    })
    expect(first.binding).not.toBeNull()
    if (first.binding == null) throw new Error('expected binding')
    const bindingInstanceId = first.binding.bindingInstanceId
    expect(
      service.set({
        sessionId: 'session-a',
        mode: 'disabled',
        expectedBindingInstanceId: 'stale',
      }).error,
    ).toEqual({ code: 'binding_conflict' })

    blockers = [{ code: 'question_pending' }]
    expect(
      service.set({
        sessionId: 'session-a',
        mode: 'disabled',
        expectedBindingInstanceId: bindingInstanceId,
      }).error,
    ).toEqual({ code: 'question_pending' })
  })

  it('rejects a change after a durable turn request has been accepted', () => {
    enableFlags(db)
    new TurnRequestRepository(db).create({
      id: 'turn-a',
      sessionId: 'session-a',
      payloadJson: '{}',
      createdAt: '2026-09-12T00:00:00.000Z',
    })

    expect(
      service.set({
        sessionId: 'session-a',
        mode: 'disabled',
        expectedBindingInstanceId: null,
      }).error,
    ).toEqual({ code: 'turn_queue_not_empty' })
    expect(new SessionWorkflowBindingRepository(db).get('session-a')).toBeNull()
  })

  it('observes a turn accepted between the in-memory gate and the transactional durable check', () => {
    enableFlags(db)
    const turnRequests = new TurnRequestRepository(db)
    let accepted = false
    service = new WorkflowBindingService(db, {
      getInMemoryChangeBlockers: () => {
        if (!accepted) {
          accepted = true
          turnRequests.create({
            id: 'turn-interleaved',
            sessionId: 'session-a',
            payloadJson: '{}',
            createdAt: '2026-09-12T00:00:00.000Z',
          })
        }
        return []
      },
      onBindingChanged: vi.fn(),
    })

    expect(
      service.set({
        sessionId: 'session-a',
        mode: 'inherit',
        expectedBindingInstanceId: null,
      }).error,
    ).toEqual({ code: 'turn_queue_not_empty' })
    expect(new SessionWorkflowBindingRepository(db).get('session-a')).toBeNull()
  })

  it('allows only one of two windows to replace the same binding generation', () => {
    enableFlags(db)
    const initial = service.set({
      sessionId: 'session-a',
      mode: 'inherit',
      expectedBindingInstanceId: null,
    })
    if (initial.binding == null) throw new Error('expected initial binding')
    const initialBindingInstanceId = initial.binding.bindingInstanceId

    const winner = service.set({
      sessionId: 'session-a',
      mode: 'disabled',
      expectedBindingInstanceId: initialBindingInstanceId,
    })
    expect(winner.changed).toBe(true)
    expect(
      service.set({
        sessionId: 'session-a',
        mode: 'inherit',
        expectedBindingInstanceId: initialBindingInstanceId,
      }).error,
    ).toEqual({ code: 'binding_conflict' })
    expect(new SessionWorkflowBindingRepository(db).get('session-a')).toMatchObject({
      mode: 'disabled',
      bindingInstanceId: winner.binding?.bindingInstanceId,
    })
  })

  it('fails preflight for unavailable definitions, graph cycles, and dependencies', () => {
    enableFlags(db)
    new WorkflowRepository(db).create({
      id: 'workflow-bad',
      name: 'Bad',
      status: 'active',
      enabled: true,
      graph: {
        nodes: [
          {
            id: 'a',
            kind: 'agent',
            title: 'A',
            config: {
              agentId: 'missing-agent',
              skillIds: ['missing-skill'],
              mcpServerIds: ['missing-mcp'],
            },
          },
          { id: 'b', kind: 'agent', title: 'B', config: {} },
          { id: 'unknown', kind: 'future-node', title: 'Future', config: {} },
          {
            id: 'tool',
            kind: 'tool',
            title: 'Tool',
            config: { toolIds: ['NotARealTool'] },
          },
          {
            id: 'loop',
            kind: 'loop',
            title: 'Loop',
            config: {
              body: {
                nodes: [
                  {
                    id: 'nested',
                    kind: 'loop',
                    title: 'Nested',
                    config: { body: { nodes: [], edges: [] } },
                  },
                ],
                edges: [],
              },
            },
          },
        ],
        edges: [
          { id: 'a-b', from: 'a', to: 'b', condition: { op: 'truthy', key: 'missing_key' } },
          { id: 'b-a', from: 'b', to: 'a' },
        ],
      },
    })

    const response = service.set({
      sessionId: 'session-a',
      mode: 'override',
      workflowId: 'workflow-bad',
      expectedBindingInstanceId: null,
    })
    expect(response.preflight).toMatchObject({
      ok: false,
      issues: expect.arrayContaining([
        expect.objectContaining({ code: 'graph_cycle' }),
        expect.objectContaining({ code: 'invalid_condition_reference' }),
        expect.objectContaining({ code: 'unsupported_node_kind', nodeId: 'unknown' }),
        expect.objectContaining({ code: 'invalid_loop_body', nodeId: 'nested' }),
        expect.objectContaining({
          code: 'missing_agent',
          nodeId: 'a',
          dependencyId: 'missing-agent',
        }),
        expect.objectContaining({
          code: 'missing_required_skill',
          nodeId: 'a',
          dependencyId: 'missing-skill',
        }),
        expect.objectContaining({
          code: 'missing_required_mcp',
          nodeId: 'a',
          dependencyId: 'missing-mcp',
        }),
        expect.objectContaining({
          code: 'missing_required_tool',
          nodeId: 'tool',
          dependencyId: 'NotARealTool',
        }),
      ]),
    })
    expect(new SessionWorkflowBindingRepository(db).get('session-a')).toBeNull()
  })

  it('returns every stage-3 definition and agent availability preflight code', () => {
    enableFlags(db)
    const workflows = new WorkflowRepository(db)
    new AgentRepository(db).create({ id: 'agent-disabled', name: 'Disabled', enabled: false })
    workflows.create({
      id: 'workflow-disabled',
      name: 'Disabled',
      status: 'active',
      enabled: false,
      graph: { nodes: [], edges: [] },
    })
    workflows.create({
      id: 'workflow-draft',
      name: 'Draft',
      status: 'draft',
      enabled: true,
      graph: { nodes: [], edges: [] },
    })
    workflows.create({
      id: 'workflow-disabled-agent',
      name: 'Disabled Agent',
      status: 'active',
      enabled: true,
      graph: {
        nodes: [
          {
            id: 'disabled-agent-node',
            kind: 'agent',
            title: 'Disabled agent',
            config: { agentId: 'agent-disabled' },
          },
        ],
        edges: [],
      },
    })

    const inspect = (workflowId: string) =>
      service.set({
        sessionId: 'session-a',
        mode: 'override',
        workflowId,
        expectedBindingInstanceId: null,
      }).preflight

    expect(inspect('missing-workflow').issues).toContainEqual({ code: 'workflow_not_found' })
    expect(inspect('workflow-disabled').issues).toContainEqual({ code: 'workflow_disabled' })
    expect(inspect('workflow-draft').issues).toContainEqual({
      code: 'workflow_not_active',
      params: { status: 'draft' },
    })
    expect(inspect('workflow-disabled-agent').issues).toContainEqual({
      code: 'disabled_agent',
      nodeId: 'disabled-agent-node',
      dependencyId: 'agent-disabled',
    })
    expect(new SessionWorkflowBindingRepository(db).get('session-a')).toBeNull()
  })

  it('preflights the Host default workflow for inherit while disabled bypasses it', () => {
    enableFlags(db)
    new WorkflowRepository(db).create({
      id: 'workflow-host-draft',
      name: 'Host Draft',
      status: 'draft',
      enabled: true,
      graph: {
        nodes: [
          {
            id: 'missing-host-tool',
            kind: 'tool',
            title: 'Missing tool',
            config: { toolIds: ['NotARealTool'] },
          },
        ],
        edges: [],
      },
    })
    new AgentRepository(db).update('agent-a', { workflowId: 'workflow-host-draft' })

    const inherited = service.set({
      sessionId: 'session-a',
      mode: 'inherit',
      expectedBindingInstanceId: null,
    })
    expect(inherited.preflight).toMatchObject({
      ok: false,
      issues: expect.arrayContaining([
        expect.objectContaining({ code: 'workflow_not_active' }),
        expect.objectContaining({
          code: 'missing_required_tool',
          nodeId: 'missing-host-tool',
        }),
      ]),
    })
    expect(new SessionWorkflowBindingRepository(db).get('session-a')).toBeNull()

    const disabled = service.set({
      sessionId: 'session-a',
      mode: 'disabled',
      expectedBindingInstanceId: null,
    })
    expect(disabled).toMatchObject({ changed: true, error: null, preflight: { ok: true } })
  })

  it('abandons the failed run of the current generation and rotates the binding', () => {
    enableFlags(db)
    new WorkflowRepository(db).create({
      id: 'workflow-a',
      name: 'Workflow A',
      status: 'active',
      enabled: true,
      graph: { nodes: [{ id: 'step', kind: 'input', title: 'Step', config: {} }], edges: [] },
    })
    const set = service.set({
      sessionId: 'session-a',
      mode: 'override',
      workflowId: 'workflow-a',
      expectedBindingInstanceId: null,
    })
    if (set.binding == null) throw new Error('expected binding')
    const runs = new WorkflowRunRepository(db)
    const run = runs.create({
      sessionId: 'session-a',
      turnId: 'turn-1',
      workflowId: 'workflow-a',
      objective: 'first attempt',
      graph: { nodes: [], edges: [] },
      workflowBindingInstanceId: set.binding.bindingInstanceId,
    })
    runs.updateSnapshot(run.id, {
      status: 'failed',
      state: {},
      executions: [],
      atomicExecutions: [],
      completedNodeIds: [],
      failedNode: { nodeId: 'step', agentId: 'agent-a', attempt: 1, error: { code: 'x' } },
    })
    expect(service.get('session-a').resumableRun?.id).toBe(run.id)

    const abandoned = service.abandonRun({
      sessionId: 'session-a',
      expectedBindingInstanceId: set.binding.bindingInstanceId,
      runId: run.id,
    })
    expect(abandoned).toMatchObject({
      changed: true,
      abandonedRunId: run.id,
      error: null,
      resumableRun: null,
    })
    expect(abandoned.binding).not.toBeNull()
    if (abandoned.binding == null) throw new Error('expected rotated binding')
    expect(abandoned.binding.bindingInstanceId).not.toBe(set.binding.bindingInstanceId)
    expect(abandoned.binding.mode).toBe('override')
    expect(abandoned.binding.workflowId).toBe('workflow-a')

    const canceled = runs.get(run.id)
    expect(canceled).toMatchObject({ status: 'canceled', ended_at: expect.any(String) })
    // 历史保留 + 新代次不再自动恢复旧 Run。
    expect(
      runs.findLatestResumableByBinding('session-a', abandoned.binding.bindingInstanceId),
    ).toBeNull()
    expect(host.onBindingChanged).toHaveBeenCalledWith(
      'session-a',
      abandoned.binding.bindingInstanceId,
    )
  })

  it('refuses to abandon a working run, stale views, and busy sessions', () => {
    enableFlags(db)
    new WorkflowRepository(db).create({
      id: 'workflow-a',
      name: 'Workflow A',
      status: 'active',
      enabled: true,
      graph: { nodes: [{ id: 'step', kind: 'input', title: 'Step', config: {} }], edges: [] },
    })
    const set = service.set({
      sessionId: 'session-a',
      mode: 'override',
      workflowId: 'workflow-a',
      expectedBindingInstanceId: null,
    })
    if (set.binding == null) throw new Error('expected binding')
    const runs = new WorkflowRunRepository(db)
    const working = runs.create({
      sessionId: 'session-a',
      turnId: 'turn-1',
      workflowId: 'workflow-a',
      objective: 'still running',
      graph: { nodes: [], edges: [] },
      workflowBindingInstanceId: set.binding.bindingInstanceId,
    })
    const response = service.abandonRun({
      sessionId: 'session-a',
      expectedBindingInstanceId: set.binding.bindingInstanceId,
      runId: working.id,
    })
    expect(response).toMatchObject({
      changed: false,
      abandonedRunId: null,
      error: { code: 'workflow_run_working' },
    })
    expect(runs.get(working.id)?.status).toBe('working')

    const stale = service.abandonRun({
      sessionId: 'session-a',
      expectedBindingInstanceId: set.binding.bindingInstanceId,
      runId: 'run-that-vanished',
    })
    expect(stale).toMatchObject({ changed: false, error: { code: 'binding_conflict' } })

    runs.updateSnapshot(working.id, {
      status: 'failed',
      state: {},
      executions: [],
      atomicExecutions: [],
      completedNodeIds: [],
      failedNode: { nodeId: 'step', agentId: 'agent-a', attempt: 1, error: { code: 'x' } },
    })
    blockers.push({ code: 'turn_queue_not_empty' })
    const busy = service.abandonRun({
      sessionId: 'session-a',
      expectedBindingInstanceId: set.binding.bindingInstanceId,
      runId: working.id,
    })
    expect(busy).toMatchObject({
      changed: false,
      error: { code: 'turn_queue_not_empty' },
    })
    expect(runs.get(working.id)?.status).toBe('failed')
    expect(set.binding.bindingInstanceId).toBe(
      new SessionWorkflowBindingRepository(db).get('session-a')?.bindingInstanceId,
    )
  })

  it('rejects abandoning without the trusted write switch', () => {
    expect(() =>
      service.abandonRun({
        sessionId: 'session-a',
        expectedBindingInstanceId: 'missing',
        runId: 'run-1',
      }),
    ).toThrow('尚未启用')
  })
})

function enableFlags(db: SparkDatabase): void {
  const settings = new SettingsRepository(db)
  settings.set('sessionWorkflowBinding', 'writeEnabled', true)
  settings.set('sessionWorkflowBinding', 'runtimeEnabled', true)
}

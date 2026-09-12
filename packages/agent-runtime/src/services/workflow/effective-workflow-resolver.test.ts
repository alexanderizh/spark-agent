import { afterEach, describe, expect, it, vi } from 'vitest'
import { fileURLToPath } from 'node:url'
import type { AgentItem, WorkflowItem, WorkflowRunRow } from '@spark/storage'
import { SparkDatabase } from '@spark/storage'
import { normalizeWorkflowGraph } from '../workflow-executor.js'
import {
  buildWorkflowRuntimeIdentitySnapshot,
  buildWorkflowMemberExecutionSignatures,
  compareLegacyWorkflowResolution,
  digestNormalizedWorkflowGraph,
  EffectiveWorkflowResolver,
  observeEffectiveWorkflowResolutionShadow,
  type EffectiveWorkflowExecutionContext,
  type LegacyWorkflowResolutionSnapshot,
} from './effective-workflow-resolver.js'
import { resolveWorkflowExecutionModeCapability } from './workflow-execution-mode.js'
import { ResumeGateManager } from '../session-resume-gate.js'
import {
  buildCodexNativeThreadIdentityScope,
  scopeCodexNativeThreadBindingKey,
  scopeRuntimeSessionIdentity,
} from '../session/codex-native-thread-binding.js'

function runtimeIdentityInput(
  agentAdapter: 'claude' | 'claude-sdk' | 'codex' | 'spark' = 'claude-sdk',
) {
  const gate = new ResumeGateManager()
  return {
    makeRuntimeSessionId: gate.makeRuntimeSessionId.bind(gate),
    sessionId: 'session-a',
    providerProfileId: 'provider-a',
    model: 'model-a',
    agentAdapter,
    turnId: 'turn-a',
    nativeThreadGeneration: 0,
    agentId: 'agent-a',
    isMentionTurn: false,
  }
}

function makeWorkflow(id: string): WorkflowItem {
  return {
    id,
    scope: 'system',
    name: `Workflow ${id}`,
    version: '1.0.0',
    description: 'test workflow',
    status: 'active',
    tags: [],
    enabled: true,
    graph: {
      nodes: [
        {
          id: 'step-a',
          kind: 'agent',
          title: 'Step A',
          config: { prompt: 'Execute A', retryCount: 1 },
        },
      ],
      edges: [],
    },
    bundleId: null,
    createdAt: '2026-09-12T00:00:00.000Z',
    updatedAt: '2026-09-12T00:00:00.000Z',
  }
}

function makeMember(id: string, overrides: Partial<AgentItem> = {}): AgentItem {
  return {
    id,
    name: id,
    description: '',
    prompt: '',
    builtIn: false,
    enabled: true,
    isDefault: false,
    providerProfileId: 'provider-a',
    modelId: 'model-a',
    agentAdapter: 'claude-sdk',
    permissionMode: 'claude-auto-edits',
    reasoningEffort: 'max',
    skillIds: ['skill-a'],
    disabledSkillIds: [],
    mcpServerIds: ['mcp-a'],
    ruleIds: [],
    hookConfig: {},
    workflowId: null,
    metadata: { toolIds: ['tool-a'] },
    createdAt: '2026-09-12T00:00:00.000Z',
    updatedAt: '2026-09-12T00:00:00.000Z',
    ...overrides,
  }
}

function makeBinding(mode: 'inherit' | 'override' | 'disabled', workflowId: string | null) {
  return {
    sessionId: 'session-a',
    bindingInstanceId: `binding-${mode}`,
    mode,
    workflowId,
    createdAt: '2026-09-12T00:00:00.000Z',
    updatedAt: '2026-09-12T00:00:00.000Z',
  }
}

describe('EffectiveWorkflowResolver', () => {
  it('matches the legacy Agent workflow selection when no Binding row exists', () => {
    const workflow = makeWorkflow('workflow-agent')
    const bindingReader = { get: vi.fn(() => null) }
    const workflowReader = { get: vi.fn(() => workflow) }
    const result = new EffectiveWorkflowResolver(bindingReader, workflowReader).resolve({
      sessionId: 'session-a',
      hostAgent: { id: 'agent-a', workflowId: workflow.id },
      isMentionTurn: false,
      agentAdapter: 'claude-sdk',
      resolveWorkflowMembers: () => [makeMember('worker-a')],
      runtimeIdentity: runtimeIdentityInput(),
    })

    expect(result).toMatchObject({
      source: 'legacy-agent',
      bindingInstanceId: null,
      hostAgentId: 'agent-a',
      workflowId: workflow.id,
      workflowName: workflow.name,
      workflowVersion: workflow.version,
      workflowStatus: workflow.status,
      workflowEnabled: workflow.enabled,
      graphSource: 'definition',
      resumableRunId: null,
      executionMode: 'workflow_run',
    })
    if (result.graph == null) throw new Error('expected normalized workflow graph')
    expect(result.graphDigest).toBe(digestNormalizedWorkflowGraph(result.graph))
    expect(bindingReader.get).toHaveBeenCalledOnce()
    expect(workflowReader.get).toHaveBeenCalledWith(workflow.id)
  })

  it('reuses the already-read legacy definition during shadow resolution', () => {
    const workflow = makeWorkflow('workflow-agent')
    const workflowReader = { get: vi.fn(() => null) }
    const result = new EffectiveWorkflowResolver({ get: () => null }, workflowReader).resolve({
      sessionId: 'session-a',
      hostAgent: { id: 'agent-a', workflowId: workflow.id },
      isMentionTurn: false,
      agentAdapter: 'codex',
      resolveWorkflowMembers: () => [makeMember('worker-a')],
      runtimeIdentity: runtimeIdentityInput('codex'),
      legacyWorkflow: workflow,
    })

    expect(result.workflowName).toBe(workflow.name)
    expect(result.executionMode).toBe('codex_guided')
    expect(workflowReader.get).not.toHaveBeenCalled()
  })

  it.each([
    ['inherit', null, 'workflow-agent', 'session-inherit'],
    ['override', 'workflow-override', 'workflow-override', 'session-override'],
  ] as const)(
    'resolves %s Binding without mutating it',
    (mode, boundWorkflowId, expectedWorkflowId, expectedSource) => {
      const workflow = makeWorkflow(expectedWorkflowId)
      const resolver = new EffectiveWorkflowResolver(
        { get: () => makeBinding(mode, boundWorkflowId) },
        { get: () => workflow },
      )
      const result = resolver.resolve({
        sessionId: 'session-a',
        hostAgent: { id: 'agent-a', workflowId: 'workflow-agent' },
        isMentionTurn: false,
        agentAdapter: 'spark',
        resolveWorkflowMembers: () => [makeMember('worker-a')],
        runtimeIdentity: runtimeIdentityInput('spark'),
      })

      expect(result).toMatchObject({
        source: expectedSource,
        bindingInstanceId: `binding-${mode}`,
        workflowId: expectedWorkflowId,
        executionMode: 'codex_guided',
      })
    },
  )

  it('resolves disabled as an explicit no-workflow context', () => {
    const workflowReader = { get: vi.fn(() => makeWorkflow('unexpected')) }
    const result = new EffectiveWorkflowResolver(
      { get: () => makeBinding('disabled', null) },
      workflowReader,
    ).resolve({
      sessionId: 'session-a',
      hostAgent: { id: 'agent-a', workflowId: 'workflow-agent' },
      isMentionTurn: false,
      agentAdapter: 'claude-sdk',
      resolveWorkflowMembers: () => [],
      runtimeIdentity: runtimeIdentityInput(),
    })

    expect(result).toEqual({
      source: 'session-disabled',
      bindingInstanceId: 'binding-disabled',
      hostAgentId: 'agent-a',
      workflowId: null,
      workflowName: null,
      workflowVersion: null,
      workflowStatus: null,
      workflowEnabled: null,
      workflowSnapshot: null,
      graph: null,
      graphDigest: null,
      graphSource: 'none',
      resumableRunId: null,
      executionMode: 'none',
      workflowMemberSignatures: [],
      runtimeIdentity: buildWorkflowRuntimeIdentitySnapshot(
        runtimeIdentityInput(),
        'binding-disabled',
      ),
    })
    expect(workflowReader.get).not.toHaveBeenCalled()
  })

  it('ignores Session Binding reads for mention turns', () => {
    const workflow = makeWorkflow('workflow-mentioned-agent')
    const bindingReader = {
      get: vi.fn(() => {
        throw new Error('mention must not read Session Binding')
      }),
    }
    const result = new EffectiveWorkflowResolver(bindingReader, { get: () => workflow }).resolve({
      sessionId: 'session-a',
      hostAgent: { id: 'mentioned-agent', workflowId: workflow.id },
      isMentionTurn: true,
      agentAdapter: 'claude-sdk',
      resolveWorkflowMembers: () => [makeMember('worker-a')],
      runtimeIdentity: {
        ...runtimeIdentityInput(),
        agentId: 'mentioned-agent',
        isMentionTurn: true,
      },
    })

    expect(result.source).toBe('legacy-agent')
    expect(result.bindingInstanceId).toBeNull()
    expect(result.executionMode).toBe('guided')
    expect(bindingReader.get).not.toHaveBeenCalled()
  })

  it('produces a stable digest while preserving array order', () => {
    const first = normalizeWorkflowGraph({
      nodes: [
        {
          id: 'a',
          kind: 'agent',
          title: 'A',
          config: { prompt: 'A', retryCount: 1 },
        },
        { id: 'b', kind: 'agent', title: 'B', config: {} },
      ],
      edges: [],
    })
    const reorderedKeys = normalizeWorkflowGraph({
      edges: [],
      nodes: [
        {
          title: 'A',
          config: { retryCount: 1, prompt: 'A' },
          kind: 'agent',
          id: 'a',
        },
        { config: {}, title: 'B', id: 'b', kind: 'agent' },
      ],
    })
    const reversedNodes = { ...first, nodes: [...first.nodes].reverse() }

    expect(digestNormalizedWorkflowGraph(first)).toBe(digestNormalizedWorkflowGraph(reorderedKeys))
    expect(digestNormalizedWorkflowGraph(first)).not.toBe(
      digestNormalizedWorkflowGraph(reversedNodes),
    )
  })

  it('computes execution capability from the selected override graph and members', () => {
    const legacy = makeWorkflow('workflow-agent')
    legacy.graph = { nodes: [], edges: [] }
    const override = makeWorkflow('workflow-override')
    const result = new EffectiveWorkflowResolver(
      { get: () => makeBinding('override', override.id) },
      { get: (id) => (id === override.id ? override : legacy) },
    ).resolve({
      sessionId: 'session-a',
      hostAgent: { id: 'agent-a', workflowId: legacy.id },
      isMentionTurn: false,
      agentAdapter: 'claude-sdk',
      resolveWorkflowMembers: (graph) =>
        graph.nodes.some((node) => node.id === 'step-a') ? [makeMember('override-worker')] : [],
      runtimeIdentity: runtimeIdentityInput(),
      legacyWorkflow: legacy,
      legacyGraph: normalizeWorkflowGraph(legacy.graph),
    })

    expect(result.workflowId).toBe(override.id)
    expect(result.workflowMemberSignatures).toHaveLength(1)
    expect(result.executionMode).toBe('workflow_run')
  })

  it('returns domain mode none when no workflow is selected', () => {
    const result = new EffectiveWorkflowResolver({ get: () => null }, { get: () => null }).resolve({
      sessionId: 'session-a',
      hostAgent: { id: 'agent-a', workflowId: null },
      isMentionTurn: false,
      agentAdapter: 'codex',
      resolveWorkflowMembers: () => [],
      runtimeIdentity: runtimeIdentityInput('codex'),
      legacyWorkflow: null,
      legacyGraph: null,
    })

    expect(result.source).toBe('none')
    expect(result.executionMode).toBe('none')
  })

  it('returns none for inherit without a Host workflow but guided for an existing empty graph', () => {
    const inheritedNone = new EffectiveWorkflowResolver(
      { get: () => makeBinding('inherit', null) },
      { get: () => null },
    ).resolve({
      sessionId: 'session-a',
      hostAgent: { id: 'agent-a', workflowId: null },
      isMentionTurn: false,
      agentAdapter: 'claude-sdk',
      resolveWorkflowMembers: () => [],
      runtimeIdentity: runtimeIdentityInput(),
    })
    const emptyWorkflow = makeWorkflow('workflow-empty')
    emptyWorkflow.graph = { nodes: [], edges: [] }
    const existingEmptyGraph = new EffectiveWorkflowResolver(
      { get: () => makeBinding('inherit', null) },
      { get: () => emptyWorkflow },
    ).resolve({
      sessionId: 'session-a',
      hostAgent: { id: 'agent-a', workflowId: emptyWorkflow.id },
      isMentionTurn: false,
      agentAdapter: 'claude-sdk',
      resolveWorkflowMembers: () => [],
      runtimeIdentity: runtimeIdentityInput(),
    })

    expect(inheritedNone).toMatchObject({
      source: 'session-inherit',
      workflowId: null,
      executionMode: 'none',
    })
    expect(existingEmptyGraph).toMatchObject({
      source: 'session-inherit',
      workflowId: emptyWorkflow.id,
      executionMode: 'guided',
    })
  })

  it('fails closed with a stable issue when a bound resumable graph snapshot is corrupt', () => {
    const workflow = makeWorkflow('workflow-corrupt-snapshot')
    const corruptRun = {
      id: 'run-corrupt-snapshot',
      session_id: 'session-a',
      turn_id: 'turn-a',
      workflow_id: workflow.id,
      status: 'failed',
      objective: 'resume safely',
      graph_json: '{not-json',
      state_json: '{}',
      executions_json: '[]',
      atomic_executions_json: '[]',
      completed_node_ids_json: '[]',
      skipped_node_ids_json: '[]',
      failed_node_json: null,
      started_at: '2026-09-12T00:00:00.000Z',
      updated_at: '2026-09-12T00:01:00.000Z',
      ended_at: '2026-09-12T00:01:00.000Z',
      workflow_binding_instance_id: 'binding-corrupt',
      workflow_graph_digest: 'digest-corrupt',
      workflow_name_snapshot: workflow.name,
      workflow_version_snapshot: workflow.version,
      binding_source: 'session-override',
    } satisfies WorkflowRunRow

    const resolver = new EffectiveWorkflowResolver(
      { get: () => makeBinding('override', workflow.id) },
      { get: () => workflow },
      {
        findLatestResumable: () => null,
        findLatestResumableByBinding: () => corruptRun,
      },
    )

    let caught: unknown
    try {
      resolver.resolve({
        sessionId: 'session-a',
        hostAgent: { id: 'agent-a', workflowId: null },
        isMentionTurn: false,
        agentAdapter: 'claude-sdk',
        resolveWorkflowMembers: () => [],
        runtimeIdentity: runtimeIdentityInput(),
      })
    } catch (error) {
      caught = error
    }

    expect(caught).toMatchObject({
      name: 'SparkError',
      code: 'VALIDATION_FAILED',
      context: {
        issues: [
          {
            code: 'workflow_run_snapshot_invalid',
            params: { runId: 'run-corrupt-snapshot' },
          },
        ],
      },
    })
  })

  it('fails closed when a structurally valid snapshot digest does not match the frozen graph', () => {
    const workflow = makeWorkflow('workflow-digest-mismatch')
    // 合法 JSON 但 digest 被篡改：必须命中 digest 比对分支，而不是 JSON 解析分支。
    const tamperedRun = {
      id: 'run-digest-mismatch',
      session_id: 'session-a',
      turn_id: 'turn-a',
      workflow_id: workflow.id,
      status: 'failed',
      objective: 'resume safely',
      graph_json: JSON.stringify(workflow.graph),
      state_json: '{}',
      executions_json: '[]',
      atomic_executions_json: '[]',
      completed_node_ids_json: '[]',
      skipped_node_ids_json: '[]',
      failed_node_json: null,
      started_at: '2026-09-12T00:00:00.000Z',
      updated_at: '2026-09-12T00:01:00.000Z',
      ended_at: '2026-09-12T00:01:00.000Z',
      workflow_binding_instance_id: 'binding-digest',
      workflow_graph_digest: 'digest-tampered',
      workflow_name_snapshot: workflow.name,
      workflow_version_snapshot: workflow.version,
      binding_source: 'session-override',
    } satisfies WorkflowRunRow

    const resolver = new EffectiveWorkflowResolver(
      { get: () => makeBinding('override', workflow.id) },
      { get: () => workflow },
      {
        findLatestResumable: () => null,
        findLatestResumableByBinding: () => tamperedRun,
      },
    )

    let caught: unknown
    try {
      resolver.resolve({
        sessionId: 'session-a',
        hostAgent: { id: 'agent-a', workflowId: null },
        isMentionTurn: false,
        agentAdapter: 'claude-sdk',
        resolveWorkflowMembers: () => [],
        runtimeIdentity: runtimeIdentityInput(),
      })
    } catch (error) {
      caught = error
    }

    expect(caught).toMatchObject({
      name: 'SparkError',
      code: 'VALIDATION_FAILED',
      context: {
        issues: [
          {
            code: 'workflow_run_snapshot_invalid',
            params: { runId: 'run-digest-mismatch' },
          },
        ],
      },
    })
  })

  it.each(['draft', 'archived'] as const)(
    'does not start a new Run for a bound %s workflow',
    (status) => {
      const workflow = makeWorkflow(`workflow-${status}`)
      workflow.status = status
      const resolver = new EffectiveWorkflowResolver(
        { get: () => makeBinding('override', workflow.id) },
        { get: () => workflow },
        {
          findLatestResumable: () => null,
          findLatestResumableByBinding: () => null,
        },
      )

      expect(() =>
        resolver.resolve({
          sessionId: 'session-a',
          hostAgent: { id: 'agent-a', workflowId: null },
          isMentionTurn: false,
          agentAdapter: 'claude-sdk',
          resolveWorkflowMembers: () => [],
          runtimeIdentity: runtimeIdentityInput(),
        }),
      ).toThrowError(
        expect.objectContaining({
          code: 'VALIDATION_FAILED',
          context: {
            issues: [{ code: 'workflow_not_active', params: { status } }],
          },
        }),
      )
    },
  )

  it('allows an archived bound workflow to restore an existing frozen Run', () => {
    const workflow = makeWorkflow('workflow-archived-resume')
    workflow.status = 'archived'
    const graph = normalizeWorkflowGraph(workflow.graph)
    const run = {
      id: 'run-archived-resume',
      session_id: 'session-a',
      turn_id: 'turn-a',
      workflow_id: workflow.id,
      status: 'failed',
      objective: 'resume archived workflow',
      graph_json: JSON.stringify(graph),
      state_json: '{}',
      executions_json: '[]',
      atomic_executions_json: '[]',
      completed_node_ids_json: '[]',
      skipped_node_ids_json: '[]',
      failed_node_json: null,
      started_at: '2026-09-12T00:00:00.000Z',
      updated_at: '2026-09-12T00:01:00.000Z',
      ended_at: '2026-09-12T00:01:00.000Z',
      workflow_binding_instance_id: 'binding-override',
      workflow_graph_digest: digestNormalizedWorkflowGraph(graph),
      workflow_name_snapshot: workflow.name,
      workflow_version_snapshot: workflow.version,
      binding_source: 'session-override',
    } satisfies WorkflowRunRow
    const result = new EffectiveWorkflowResolver(
      { get: () => makeBinding('override', workflow.id) },
      { get: () => workflow },
      {
        findLatestResumable: () => null,
        findLatestResumableByBinding: () => run,
      },
    ).resolve({
      sessionId: 'session-a',
      hostAgent: { id: 'agent-a', workflowId: null },
      isMentionTurn: false,
      agentAdapter: 'claude-sdk',
      resolveWorkflowMembers: () => [],
      runtimeIdentity: runtimeIdentityInput(),
    })

    expect(result.graphSource).toBe('resumable-run')
    expect(result.resumableRunId).toBe(run.id)
  })

  it.each([
    [false, 0],
    [false, 2],
    [true, 0],
    [true, 2],
  ] as const)(
    'matches the legacy identity oracle for mention=%s generation=%s',
    (isMentionTurn, nativeThreadGeneration) => {
      const gate = new ResumeGateManager()
      const input = {
        ...runtimeIdentityInput('codex'),
        makeRuntimeSessionId: gate.makeRuntimeSessionId.bind(gate),
        isMentionTurn,
        nativeThreadGeneration,
      }
      const stableScope = scopeRuntimeSessionIdentity(
        isMentionTurn ? `mention:${input.agentId}` : undefined,
        nativeThreadGeneration,
      )
      const stableSdkSessionId = gate.makeRuntimeSessionId(
        input.sessionId,
        input.providerProfileId,
        input.model,
        input.agentAdapter,
        stableScope,
      )
      const turnSdkSessionId = gate.makeRuntimeSessionId(
        input.sessionId,
        input.providerProfileId,
        input.model,
        input.agentAdapter,
        isMentionTurn ? `mention:${input.agentId}:${input.turnId}` : input.turnId,
      )
      const codexNativeThreadBindingKey = scopeCodexNativeThreadBindingKey(
        gate.makeRuntimeSessionId(
          input.sessionId,
          input.providerProfileId,
          input.model,
          input.agentAdapter,
          buildCodexNativeThreadIdentityScope({ agentId: input.agentId, isMentionTurn }),
        ),
        nativeThreadGeneration,
      )

      expect(buildWorkflowRuntimeIdentitySnapshot(input)).toEqual({
        stableSdkSessionId,
        turnSdkSessionId,
        codexNativeThreadBindingKey,
        sparkLedgerBindingKey: stableSdkSessionId,
      })
    },
  )

  it('changes every binding-sensitive identity field for a future Binding generation', () => {
    const input = runtimeIdentityInput('spark')
    const legacy = buildWorkflowRuntimeIdentitySnapshot(input)
    const bound = buildWorkflowRuntimeIdentitySnapshot(input, 'binding-a')

    expect(bound.stableSdkSessionId).not.toBe(legacy.stableSdkSessionId)
    expect(bound.turnSdkSessionId).not.toBe(legacy.turnSdkSessionId)
    expect(bound.codexNativeThreadBindingKey).not.toBe(legacy.codexNativeThreadBindingKey)
    expect(bound.sparkLedgerBindingKey).toBe(bound.stableSdkSessionId)
  })

  it('changes member execution signatures for every effective execution field group', () => {
    const base = makeMember('worker-a')
    const variants = [
      makeMember('worker-a', { name: 'renamed worker' }),
      makeMember('worker-a', { description: 'new role' }),
      makeMember('worker-a', { prompt: 'new prompt' }),
      makeMember('worker-a', { providerProfileId: 'provider-b' }),
      makeMember('worker-a', { modelId: 'model-b' }),
      makeMember('worker-a', { agentAdapter: 'codex' }),
      makeMember('worker-a', { permissionMode: 'codex-default' }),
      makeMember('worker-a', { reasoningEffort: 'high' }),
      makeMember('worker-a', { ruleIds: ['rule-b'] }),
      makeMember('worker-a', { skillIds: ['skill-b'] }),
      makeMember('worker-a', { disabledSkillIds: ['skill-a'] }),
      makeMember('worker-a', { mcpServerIds: ['mcp-b'] }),
      makeMember('worker-a', { metadata: { toolIds: ['tool-b'] } }),
      makeMember('worker-a', { metadata: { workflowCapability: 'worker' } }),
      makeMember('worker-a', { metadata: { workflowMcpSelectionConfigured: true } }),
      makeMember('worker-a', { metadata: { reasoningBudgetTokens: 4096 } }),
      makeMember('worker-a', { metadata: { maxTurnCount: 8 } }),
      makeMember('worker-a', { hookConfig: { PreToolUse: [{ matcher: 'Bash', hooks: [] }] } }),
    ]
    const baseSignature = buildWorkflowMemberExecutionSignatures([base])

    for (const variant of variants) {
      expect(buildWorkflowMemberExecutionSignatures([variant])).not.toEqual(baseSignature)
    }
  })

  it('ignores only non-execution timestamps in member signatures', () => {
    const base = makeMember('worker-a')
    const timestampOnly = makeMember('worker-a', {
      createdAt: '2030-01-01T00:00:00.000Z',
      updatedAt: '2030-01-02T00:00:00.000Z',
    })

    expect(buildWorkflowMemberExecutionSignatures([timestampOnly])).toEqual(
      buildWorkflowMemberExecutionSignatures([base]),
    )
  })
})

describe('workflow execution mode capability matrix', () => {
  it.each([
    ['claude', true, true, false, 'workflow_run'],
    ['claude-sdk', true, true, false, 'workflow_run'],
    ['codex', true, true, false, 'codex_guided'],
    ['spark', true, true, false, 'codex_guided'],
    ['claude-sdk', false, true, false, 'guided'],
    ['claude-sdk', true, false, false, 'guided'],
    ['claude-sdk', true, true, true, 'guided'],
    ['codex', false, false, true, 'guided'],
  ] as const)(
    '%s + graph=%s + managed=%s + mention=%s => %s',
    (agentAdapter, hasWorkflowGraph, managedExecutorAvailable, isMentionTurn, expected) => {
      expect(
        resolveWorkflowExecutionModeCapability({
          agentAdapter,
          hasWorkflowGraph,
          managedExecutorAvailable,
          isMentionTurn,
        }),
      ).toBe(expected)
    },
  )
})

describe('effective workflow shadow observation', () => {
  let db: SparkDatabase | undefined

  afterEach(() => db?.close())

  it('observes no-Binding equality without changing the legacy result', () => {
    db = new SparkDatabase(':memory:')
    db.runMigrations(fileURLToPath(new URL('../../../../storage/migrations', import.meta.url)))
    const observer = { debug: vi.fn(), warn: vi.fn() }
    const result = observeEffectiveWorkflowResolutionShadow({
      db,
      sessionId: 'session-a',
      hostAgent: { id: 'agent-a', workflowId: null },
      isMentionTurn: false,
      agentAdapter: 'spark',
      legacyWorkflowMembers: [],
      resolveWorkflowMembers: () => [],
      runtimeIdentity: runtimeIdentityInput('spark'),
      legacyRuntimeIdentity: buildWorkflowRuntimeIdentitySnapshot(runtimeIdentityInput('spark')),
      legacyWorkflow: null,
      legacyGraph: null,
      legacyExecutionMode: 'guided',
      observer,
    })

    expect(result).toEqual({ status: 'equivalent', mismatchFields: [] })
    expect(observer.debug).toHaveBeenCalledWith(
      'workflow resolver shadow matched legacy resolution',
      { sessionId: 'session-a', source: 'none' },
    )
    expect(observer.warn).not.toHaveBeenCalled()
  })

  it('reports only mismatch field names', () => {
    const legacy: LegacyWorkflowResolutionSnapshot = {
      source: 'legacy-agent',
      hostAgentId: 'agent-a',
      workflowId: 'workflow-a',
      workflowName: 'A',
      workflowVersion: '1.0.0',
      workflowStatus: 'active',
      workflowEnabled: true,
      graphDigest: 'digest-a',
      graphSource: 'definition',
      executionMode: 'workflow_run',
      workflowMemberSignatures: ['worker-signature-a'],
      runtimeIdentity: {
        stableSdkSessionId: 'stable-a',
        turnSdkSessionId: 'turn-a',
        codexNativeThreadBindingKey: 'codex-a',
        sparkLedgerBindingKey: 'stable-a',
      },
    }
    const shadow = {
      ...legacy,
      bindingInstanceId: null,
      workflowSnapshot: null,
      graph: null,
      resumableRunId: null,
      workflowVersion: '2.0.0',
      graphDigest: 'digest-b',
    } satisfies EffectiveWorkflowExecutionContext

    expect(compareLegacyWorkflowResolution(legacy, shadow)).toEqual([
      'workflowVersion',
      'graphDigest',
    ])
  })

  it('reports member and structured identity mismatches without values', () => {
    const legacy: LegacyWorkflowResolutionSnapshot = {
      source: 'legacy-agent',
      hostAgentId: 'agent-a',
      workflowId: 'workflow-a',
      workflowName: 'A',
      workflowVersion: '1.0.0',
      workflowStatus: 'active',
      workflowEnabled: true,
      graphDigest: 'digest-a',
      graphSource: 'definition',
      executionMode: 'workflow_run',
      workflowMemberSignatures: ['legacy-member-signature'],
      runtimeIdentity: {
        stableSdkSessionId: 'legacy-stable',
        turnSdkSessionId: 'legacy-turn',
        codexNativeThreadBindingKey: 'legacy-codex',
        sparkLedgerBindingKey: 'legacy-spark',
      },
    }
    const shadow = {
      ...legacy,
      bindingInstanceId: null,
      workflowSnapshot: null,
      graph: null,
      resumableRunId: null,
      workflowMemberSignatures: ['shadow-member-signature'],
      runtimeIdentity: {
        stableSdkSessionId: 'shadow-stable',
        turnSdkSessionId: 'shadow-turn',
        codexNativeThreadBindingKey: 'shadow-codex',
        sparkLedgerBindingKey: 'shadow-spark',
      },
    } satisfies EffectiveWorkflowExecutionContext

    expect(compareLegacyWorkflowResolution(legacy, shadow)).toEqual([
      'workflowMemberSignatures',
      'runtimeIdentity.stableSdkSessionId',
      'runtimeIdentity.turnSdkSessionId',
      'runtimeIdentity.codexNativeThreadBindingKey',
      'runtimeIdentity.sparkLedgerBindingKey',
    ])
  })

  it('fails open for the active legacy path without logging error contents', () => {
    db = new SparkDatabase(':memory:')
    db.close()
    const observer = { debug: vi.fn(), warn: vi.fn() }
    const result = observeEffectiveWorkflowResolutionShadow({
      db,
      sessionId: 'session-a',
      hostAgent: { id: 'agent-a', workflowId: null },
      isMentionTurn: false,
      agentAdapter: 'codex',
      legacyWorkflowMembers: [],
      resolveWorkflowMembers: () => [],
      runtimeIdentity: runtimeIdentityInput('codex'),
      legacyRuntimeIdentity: buildWorkflowRuntimeIdentitySnapshot(runtimeIdentityInput('codex')),
      legacyWorkflow: null,
      legacyGraph: null,
      legacyExecutionMode: 'guided',
      observer,
    })

    expect(result).toEqual({ status: 'failed', errorName: 'Error' })
    expect(observer.warn).toHaveBeenCalledWith(
      'workflow resolver shadow failed; legacy result remains authoritative',
      { sessionId: 'session-a', errorName: 'Error' },
    )
  })
})

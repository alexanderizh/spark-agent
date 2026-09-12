import { expect, it, vi } from 'vitest'
import type { AgentEvent } from '@spark/protocol'

type WorkflowRunRow = {
  id: string
  session_id: string
  turn_id: string
  workflow_id: string
  status: 'working' | 'completed' | 'failed' | 'canceled'
  objective: string
  graph_json: string
  state_json: string
  executions_json: string
  atomic_executions_json: string
  completed_node_ids_json: string
  skipped_node_ids_json: string
  failed_node_json: string | null
  started_at: string
  updated_at: string
  ended_at: string | null
}

type RuntimeState = {
  sdkConfigs: Array<Record<string, unknown>>
  workflowRuns: Map<string, WorkflowRunRow>
  nextSdkTurnErrors: string[]
  eventRows: Array<{ event_type: string; event_json: string }>
}

type SessionServiceHarness = {
  createSession(input: {
    providerProfileId: string
    agentId: string
    agentAdapter: 'claude-sdk' | 'codex' | 'spark'
    permissionMode: 'claude-plan' | 'codex-default'
    title: string
  }): Promise<{ sessionId: string }>
  sendTurn(input: { sessionId: string; message: string }): Promise<unknown>
}

type WorkflowToolResult = {
  structuredContent: {
    status: string
    state: Record<string, unknown>
    executions: Array<{ nodeId: string }>
    atomicExecutions: Array<{ nodeId: string }>
    skippedNodeIds: string[]
  }
}

type RegisterOptions = {
  state: RuntimeState
  createService: (onEvent: (event: AgentEvent) => void) => SessionServiceHarness
  seedOpenAiProvider: (id: string) => void
  setAgent: (
    id: string,
    input: {
      workflowId: string
      providerProfileId: string
      agentAdapter: 'claude-sdk' | 'codex' | 'spark'
      permissionMode: 'claude-plan' | 'codex-default'
    },
  ) => void
  setWorkflow: (
    id: string,
    graph: { nodes: Array<Record<string, unknown>>; edges: Array<Record<string, unknown>> },
  ) => void
}

function getInProcessWorkflowTool(config: Record<string, unknown>) {
  const server = (config.mcpServers as Record<string, unknown> | undefined)?.spark_team as
    | {
        instance?: { tools?: Array<{ name: string; handler: (args: unknown) => Promise<unknown> }> }
      }
    | undefined
  const tool = server?.instance?.tools?.find((candidate) => candidate.name === 'workflow_run')
  if (tool == null) throw new Error('expected in-process workflow_run tool')
  return tool
}

export function registerSessionWorkflowRuntimeBaselineTests(options: RegisterOptions): void {
  it('reuses the failed workflow run on the next Host turn with frozen progress state', async () => {
    const workflowId = 'workflow-resume-baseline'
    const hostId = 'workflow-resume-host'
    const workerId = 'workflow-resume-worker'
    options.setAgent(hostId, {
      workflowId,
      providerProfileId: 'tencent-provider',
      agentAdapter: 'claude-sdk',
      permissionMode: 'claude-plan',
    })
    options.setAgent(workerId, {
      workflowId: '',
      providerProfileId: 'tencent-provider',
      agentAdapter: 'claude-sdk',
      permissionMode: 'claude-plan',
    })
    options.setWorkflow(workflowId, {
      nodes: [
        {
          id: 'completed-input',
          kind: 'input',
          title: 'Completed input',
          config: { execution: 'static', value: 'persisted-state', outputKey: 'seed' },
        },
        {
          id: 'skipped-branch',
          kind: 'plan',
          title: 'Skipped branch',
          config: { execution: 'static', value: 'must-not-run', outputKey: 'skipped' },
        },
        {
          id: 'remaining-work',
          kind: 'agent',
          title: 'Remaining work',
          config: { agentId: workerId, outputKey: 'result' },
        },
      ],
      edges: [
        {
          id: 'input-skipped',
          from: 'completed-input',
          to: 'skipped-branch',
          condition: { op: 'equals', key: 'seed', value: 'never' },
        },
        { id: 'input-work', from: 'completed-input', to: 'remaining-work' },
      ],
    })

    const service = options.createService(() => undefined)
    const { sessionId } = await service.createSession({
      providerProfileId: 'tencent-provider',
      agentId: hostId,
      agentAdapter: 'claude-sdk',
      permissionMode: 'claude-plan',
      title: 'Workflow resume baseline',
    })

    await service.sendTurn({ sessionId, message: 'prepare the workflow' })
    await vi.waitFor(() => expect(options.state.sdkConfigs).toHaveLength(1))
    const failedRunId = 'workflow-run-failed-baseline'
    options.state.workflowRuns.set(failedRunId, {
      id: failedRunId,
      session_id: sessionId,
      turn_id: 'previous-host-turn',
      workflow_id: workflowId,
      status: 'failed',
      objective: 'resume baseline',
      graph_json: JSON.stringify({}),
      state_json: JSON.stringify({ seed: 'persisted-state' }),
      executions_json: '[]',
      atomic_executions_json: JSON.stringify([
        {
          nodeId: 'completed-input',
          kind: 'input',
          state: 'completed',
          outputKey: 'seed',
          content: 'persisted-state',
        },
      ]),
      completed_node_ids_json: JSON.stringify(['completed-input']),
      skipped_node_ids_json: JSON.stringify(['skipped-branch']),
      failed_node_json: JSON.stringify({
        nodeId: 'remaining-work',
        agentId: workerId,
        attempt: 1,
        error: { message: 'transient worker failure' },
      }),
      started_at: '2026-09-11T00:00:00.000Z',
      updated_at: '2026-09-11T00:01:00.000Z',
      ended_at: '2026-09-11T00:01:00.000Z',
    })

    await service.sendTurn({ sessionId, message: 'continue the workflow' })
    await vi.waitFor(() => expect(options.state.sdkConfigs).toHaveLength(2))
    const secondHostConfig = [...options.state.sdkConfigs].reverse().find((config) => {
      try {
        getInProcessWorkflowTool(config)
        return true
      } catch {
        return false
      }
    })
    if (secondHostConfig == null) throw new Error('expected second Host workflow config')
    const secondResult = (await getInProcessWorkflowTool(secondHostConfig).handler({
      objective: 'resume baseline',
    })) as WorkflowToolResult

    expect(options.state.workflowRuns.size).toBe(1)
    const resumedRun = [...options.state.workflowRuns.values()][0]
    if (resumedRun == null) throw new Error('expected resumed workflow run')
    expect(resumedRun).toMatchObject({
      id: failedRunId,
      status: 'completed',
    })
    expect(JSON.parse(resumedRun.state_json)).toMatchObject({ seed: 'persisted-state' })
    expect(JSON.parse(resumedRun.completed_node_ids_json)).toEqual([
      'completed-input',
      'remaining-work',
    ])
    expect(JSON.parse(resumedRun.skipped_node_ids_json)).toEqual(['skipped-branch'])
    expect(secondResult.structuredContent).toMatchObject({
      status: 'completed',
      state: { seed: 'persisted-state' },
      skippedNodeIds: ['skipped-branch'],
    })
    expect(secondResult.structuredContent.atomicExecutions).toEqual([])
    expect(secondResult.structuredContent.executions.map((item) => item.nodeId)).toEqual([
      'remaining-work',
    ])
    const progressEvents = options.state.eventRows
      .filter((row) => row.event_type === 'workflow_progress')
      .map((row) => JSON.parse(row.event_json) as { runId?: string })
    expect(progressEvents.length).toBeGreaterThan(0)
    expect(progressEvents.every((event) => event.runId === failedRunId)).toBe(true)
  })

  it.each(['codex', 'spark'] as const)(
    'selects codex_guided through the real %s Host path while mounting workflow_run',
    async (agentAdapter) => {
      const providerId = `workflow-mode-${agentAdapter}-provider`
      const workflowId = `workflow-mode-${agentAdapter}`
      const hostId = `workflow-mode-${agentAdapter}-host`
      options.seedOpenAiProvider(providerId)
      options.setAgent(hostId, {
        workflowId,
        providerProfileId: providerId,
        agentAdapter,
        permissionMode: 'codex-default',
      })
      options.setWorkflow(workflowId, {
        nodes: [
          {
            id: 'phase',
            kind: 'input',
            title: 'Phase',
            config: { execution: 'static', value: 'phase' },
          },
        ],
        edges: [],
      })

      const service = options.createService(() => undefined)
      const { sessionId } = await service.createSession({
        providerProfileId: providerId,
        agentId: hostId,
        agentAdapter,
        permissionMode: 'codex-default',
        title: `${agentAdapter} workflow mode baseline`,
      })
      await service.sendTurn({ sessionId, message: 'follow the workflow' })
      await vi.waitFor(() => expect(options.state.sdkConfigs).toHaveLength(1))

      const config = options.state.sdkConfigs[0]
      if (config == null) throw new Error('expected Host runtime config')
      expect(String(config.systemPrompt)).toContain(
        'This runtime does not expose `workflow_run`. Execute the active workflow phases yourself',
      )
      expect(String(config.systemPrompt)).not.toContain(
        'call `mcp__spark_team__workflow_run` exactly once',
      )
      expect((config.mcpServers as Record<string, { type?: string }>).spark_team).toMatchObject({
        type: 'http',
      })
      if (agentAdapter === 'spark') {
        expect(config.allowedTools).toEqual(
          expect.arrayContaining(['mcp__spark_team__workflow_run']),
        )
      }
    },
  )
}

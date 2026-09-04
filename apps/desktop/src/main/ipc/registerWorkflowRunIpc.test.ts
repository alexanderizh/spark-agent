import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { WorkflowRunRepository, WorkflowRunRow } from '@spark/storage'

const harness = vi.hoisted(() => ({
  handlers: new Map<string, (request: any) => Promise<any>>(),
}))

vi.mock('./typed-ipc.js', () => ({
  typedIpcHandle: (channel: string, handler: (request: any) => Promise<any>) => {
    harness.handlers.set(channel, handler)
  },
}))

vi.mock('../db.js', () => ({
  getDatabase: vi.fn(),
}))

import { registerWorkflowRunIpc } from './registerWorkflowRunIpc.js'

function makeRow(overrides: Partial<WorkflowRunRow> = {}): WorkflowRunRow {
  return {
    id: 'run-1',
    session_id: 'sess-1',
    turn_id: 'turn-1',
    workflow_id: 'wf-1',
    status: 'failed',
    objective: 'ship it',
    graph_json: JSON.stringify({
      nodes: [
        { id: 'plan', kind: 'agent', title: '规划', config: { agentId: 'planner' } },
        { id: 'build', kind: 'agent', title: '构建', config: {} },
      ],
      edges: [],
    }),
    state_json: '{}',
    executions_json: JSON.stringify([
      {
        nodeId: 'plan',
        agentId: 'planner',
        instruction: 'make a plan',
        inputs: {},
        attempt: 1,
        state: 'completed',
        content: '这是规划输出，足够长以便验证输出预览。',
        startedAt: '2026-09-05T00:00:00.000Z',
        endedAt: '2026-09-05T00:00:05.000Z',
      },
    ]),
    atomic_executions_json: '[]',
    completed_node_ids_json: JSON.stringify(['plan']),
    skipped_node_ids_json: '[]',
    failed_node_json: JSON.stringify({
      nodeId: 'build',
      agentId: 'builder',
      attempt: 2,
      error: { code: 'dispatch_failed', message: 'worker 不可用' },
    }),
    started_at: '2026-09-05T00:00:00.000Z',
    updated_at: '2026-09-05T00:00:08.000Z',
    ended_at: '2026-09-05T00:00:08.000Z',
    ...overrides,
  }
}

function register(rows: WorkflowRunRow[], summaries: Array<Record<string, unknown>> = []): void {
  const repository = {
    listByWorkflow: vi.fn().mockReturnValue(summaries),
    get: vi.fn((_id: string) => rows[0] ?? null),
  } as unknown as WorkflowRunRepository
  registerWorkflowRunIpc({ repository })
}

beforeEach(() => {
  harness.handlers.clear()
})

describe('registerWorkflowRunIpc', () => {
  it('workflow:runs maps summary rows with parsed counts and failed node', async () => {
    register(
      [],
      [
        {
          id: 'run-1',
          session_id: 'sess-1',
          status: 'failed',
          objective: 'ship it',
          started_at: '2026-09-05T00:00:00.000Z',
          updated_at: '2026-09-05T00:00:08.000Z',
          ended_at: '2026-09-05T00:00:08.000Z',
          completed_node_ids_json: JSON.stringify(['a', 'b']),
          skipped_node_ids_json: JSON.stringify(['c']),
          failed_node_json: JSON.stringify({ nodeId: 'build' }),
        },
      ],
    )

    const response = await harness.handlers.get('workflow:runs')!({ workflowId: 'wf-1' })
    expect(response.runs).toHaveLength(1)
    expect(response.runs[0]).toMatchObject({
      id: 'run-1',
      sessionId: 'sess-1',
      status: 'failed',
      completedCount: 2,
      skippedCount: 1,
      failedNodeId: 'build',
    })
  })

  it('workflow:run-detail rebuilds node details consistent with live progress', async () => {
    register([makeRow()])

    const response = await harness.handlers.get('workflow:run-detail')!({ runId: 'run-1' })
    const run = response.run
    expect(run).not.toBeNull()
    expect(run.status).toBe('failed')

    const plan = run.nodes.find((node: { nodeId: string }) => node.nodeId === 'plan')
    expect(plan.status).toBe('completed')
    expect(plan.agentId).toBe('planner')
    expect(plan.outputPreview).toContain('规划输出')
    expect(plan.startedAt).toBe('2026-09-05T00:00:00.000Z')
    expect(plan.endedAt).toBe('2026-09-05T00:00:05.000Z')

    const build = run.nodes.find((node: { nodeId: string }) => node.nodeId === 'build')
    expect(build.status).toBe('failed')
    expect(build.error).toMatchObject({ code: 'dispatch_failed', message: 'worker 不可用' })
  })

  it('workflow:run-detail returns null for missing runs', async () => {
    register([])
    const response = await harness.handlers.get('workflow:run-detail')!({ runId: 'gone' })
    expect(response).toEqual({ run: null })
  })

  it('workflow:run-detail survives corrupted JSON and missing graph nodes', async () => {
    register([
      makeRow({
        status: 'completed',
        graph_json: 'not-json',
        executions_json: JSON.stringify([
          {
            nodeId: 'orphan',
            agentId: 'worker',
            instruction: 'x',
            inputs: {},
            attempt: 1,
            state: 'completed',
            content: '输出',
          },
        ]),
        completed_node_ids_json: JSON.stringify(['orphan']),
        failed_node_json: null,
      }),
    ])

    const response = await harness.handlers.get('workflow:run-detail')!({ runId: 'run-1' })
    expect(response.run.status).toBe('completed')
    // 图损坏时从执行记录合成节点明细，历史不丢。
    expect(response.run.nodes).toHaveLength(1)
    expect(response.run.nodes[0]).toMatchObject({ nodeId: 'orphan', status: 'completed' })
  })

  it('workflow:run-detail omits output preview for legacy working rows', async () => {
    register([
      makeRow({
        status: 'working',
        failed_node_json: null,
      }),
    ])

    const response = await harness.handlers.get('workflow:run-detail')!({ runId: 'run-1' })
    const plan = response.run.nodes.find((node: { nodeId: string }) => node.nodeId === 'plan')
    expect(plan.status).toBe('completed')
    // 非终态快照不携带输出预览（与 workflow_progress 契约一致）。
    expect(plan.outputPreview).toBeUndefined()
  })
})

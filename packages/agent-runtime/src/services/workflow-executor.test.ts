import { describe, expect, it } from 'vitest'
import {
  buildWorkflowNodeInputs,
  executeWorkflowAgentPlan,
  getWorkflowAgentWorkerIds,
  normalizeWorkflowGraph,
  orderWorkflowNodes,
} from './workflow-executor.js'

describe('workflow-executor graph helpers', () => {
  it('normalizes valid nodes and drops malformed nodes and edges', () => {
    const graph = normalizeWorkflowGraph({
      nodes: [
        { id: 'input', kind: 'input', title: 'Input', config: { outputKey: 'brief' } },
        { id: 'agent-a', kind: 'agent', title: 'Agent A', config: { agentId: 'agent-1' } },
        { id: '', kind: 'agent', title: 'Bad', config: {} },
        null,
      ],
      edges: [
        { id: 'e1', from: 'input', to: 'agent-a' },
        { id: 'bad', from: 'missing', to: 'agent-a' },
        { from: 'agent-a', to: '' },
      ],
    })

    expect(graph.nodes.map((node) => node.id)).toEqual(['input', 'agent-a'])
    expect(graph.edges).toEqual([{ id: 'e1', from: 'input', to: 'agent-a' }])
  })

  it('normalizes safe edge conditions and drops unsupported condition objects', () => {
    const graph = normalizeWorkflowGraph({
      nodes: [
        { id: 'a', kind: 'agent', title: 'A', config: { agentId: 'a' } },
        { id: 'b', kind: 'agent', title: 'B', config: { agentId: 'b' } },
      ],
      edges: [
        { id: 'valid', from: 'a', to: 'b', condition: { op: 'equals', key: 'route', value: 'yes' } },
        { id: 'invalid', from: 'a', to: 'b', condition: { op: 'runCode', expression: 'process.exit()' } },
      ],
    })

    expect(graph.edges).toEqual([
      { id: 'valid', from: 'a', to: 'b', condition: { op: 'equals', key: 'route', value: 'yes' } },
      { id: 'invalid', from: 'a', to: 'b' },
    ])
  })

  it('orders workflow nodes topologically and preserves declared order for cycles', () => {
    const ordered = orderWorkflowNodes(
      [
        { id: 'review', kind: 'review', title: 'Review', config: {} },
        { id: 'input', kind: 'input', title: 'Input', config: {} },
        { id: 'build', kind: 'agent', title: 'Build', config: {} },
      ],
      [
        { id: 'e1', from: 'input', to: 'build' },
        { id: 'e2', from: 'build', to: 'review' },
      ],
    )
    expect(ordered.map((node) => node.id)).toEqual(['input', 'build', 'review'])

    const cyclic = orderWorkflowNodes(
      [
        { id: 'a', kind: 'agent', title: 'A', config: {} },
        { id: 'b', kind: 'agent', title: 'B', config: {} },
      ],
      [
        { id: 'a-b', from: 'a', to: 'b' },
        { id: 'b-a', from: 'b', to: 'a' },
      ],
    )
    expect(cyclic.map((node) => node.id)).toEqual(['a', 'b'])
  })

  it('extracts workflow worker ids from agent and subagent nodes only', () => {
    const graph = normalizeWorkflowGraph({
      nodes: [
        { id: 'a', kind: 'agent', title: 'Agent A', config: { agentId: 'agent-1' } },
        { id: 'b', kind: 'agent', title: 'Agent B', config: { agentId: ' ' } },
        { id: 's', kind: 'subagent', title: 'Temp', config: { agentId: 'temp-agent' } },
        { id: 'generated', kind: 'subagent', title: 'Generated', config: {} },
        {
          id: 'loop-1',
          kind: 'loop',
          title: 'Loop',
          config: {
            body: {
              nodes: [
                { id: 'loop-agent', kind: 'agent', title: 'Loop Agent', config: { agentId: 'loop-worker' } },
                { id: 'loop-subagent', kind: 'subagent', title: 'Loop Subagent', config: {} },
              ],
              edges: [],
            },
          },
        },
      ],
      edges: [],
    })

    expect(getWorkflowAgentWorkerIds(graph.nodes)).toEqual(new Set([
      'agent-1',
      'temp-agent',
      'workflow-subagent:generated',
      'loop-worker',
      'workflow-subagent:loop-subagent',
    ]))
  })

  it('builds node inputs from upstream output keys only', () => {
    const graph = normalizeWorkflowGraph({
      nodes: [
        { id: 'research', kind: 'agent', title: 'Research', config: { outputKey: 'researchNotes' } },
        { id: 'write', kind: 'agent', title: 'Write', config: { outputKey: 'draft' } },
        { id: 'review', kind: 'review', title: 'Review', config: {} },
      ],
      edges: [
        { id: 'r-w', from: 'research', to: 'write' },
        { id: 'w-r', from: 'write', to: 'review' },
      ],
    })
    const state = {
      researchNotes: 'facts',
      draft: 'article',
      ignored: 'not connected',
    }

    expect(buildWorkflowNodeInputs('write', graph, state)).toEqual({ researchNotes: 'facts' })
    expect(buildWorkflowNodeInputs('review', graph, state)).toEqual({ draft: 'article' })
  })

  it('keeps normalized node shape compatible with the current prompt renderer', () => {
    const graph = normalizeWorkflowGraph({
      nodes: [
        { id: 'review', kind: 'review', title: 'Review', config: { retryCount: 2 } },
        { id: 'input', kind: 'input', title: 'Input', config: { prompt: 'Read request' } },
      ],
      edges: [{ id: 'i-r', from: 'input', to: 'review' }],
    })

    const ordered = orderWorkflowNodes(graph.nodes, graph.edges)

    expect(ordered).toEqual([
      { id: 'input', kind: 'input', title: 'Input', config: { prompt: 'Read request' } },
      { id: 'review', kind: 'review', title: 'Review', config: { retryCount: 2 } },
    ])
  })
})

describe('executeWorkflowAgentPlan', () => {
  it('executes agent nodes topologically and passes upstream output to downstream agents', async () => {
    const graph = normalizeWorkflowGraph({
      nodes: [
        {
          id: 'write',
          kind: 'agent',
          title: 'Write',
          config: { agentId: 'writer', prompt: 'Write the answer', outputKey: 'draft' },
        },
        {
          id: 'research',
          kind: 'agent',
          title: 'Research',
          config: { agentId: 'researcher', prompt: 'Find the facts', outputKey: 'notes' },
        },
      ],
      edges: [{ id: 'research-write', from: 'research', to: 'write' }],
    })
    const initialState = { seed: 'keep me' }

    const result = await executeWorkflowAgentPlan({
      graph,
      objective: 'Prepare a launch brief',
      initialState,
      dispatch: async (request) => ({
        content: request.nodeId === 'research' ? 'verified facts' : `draft from ${String(request.inputs.notes)}`,
      }),
    })

    expect(result.executions).toEqual([
      {
        nodeId: 'research',
        agentId: 'researcher',
        instruction: 'Find the facts\n\n[Workflow objective]\nPrepare a launch brief',
        inputs: {},
        attempt: 1,
        state: 'completed',
        content: 'verified facts',
      },
      {
        nodeId: 'write',
        agentId: 'writer',
        instruction: 'Write the answer\n\n[Workflow objective]\nPrepare a launch brief',
        inputs: { notes: 'verified facts' },
        attempt: 1,
        state: 'completed',
        content: 'draft from verified facts',
      },
    ])
    expect(result.status).toBe('completed')
    expect(result.state).toEqual({ seed: 'keep me', notes: 'verified facts', draft: 'draft from verified facts' })
    expect(initialState).toEqual({ seed: 'keep me' })
  })

  it('does not write replies without an output key and trims blank instruction to title', async () => {
    // 旧版本会静默剔除 workerId 为空的 agent 节点；现在改为显式失败（见任务 2），
    // 所以本测试聚焦在非 dispatchable 行为：input 原子节点正常透传，没有 outputKey 的节点
    // 不写状态，prompt 空白时 instruction 回落到 title。
    const graph = normalizeWorkflowGraph({
      nodes: [
        { id: 'input', kind: 'input', title: 'Input', config: { value: 'parsed brief' } },
        { id: 'run', kind: 'agent', title: 'Fallback instruction', config: { agentId: 'worker', prompt: '  ' } },
      ],
      edges: [{ id: 'input-run', from: 'input', to: 'run' }],
    })

    const result = await executeWorkflowAgentPlan({
      graph,
      objective: '  ',
      dispatch: async () => ({ content: 'unpersisted reply' }),
    })

    expect(result.executions).toEqual([
      {
        nodeId: 'run',
        agentId: 'worker',
        instruction: 'Fallback instruction',
        inputs: {},
        attempt: 1,
        state: 'completed',
        content: 'unpersisted reply',
      },
    ])
    expect(result.status).toBe('completed')
    expect(result.state).toEqual({})
  })

  it('retries a failed agent node up to retryCount and records attempts', async () => {
    const graph = normalizeWorkflowGraph({
      nodes: [{
        id: 'research',
        kind: 'agent',
        title: 'Research',
        config: { agentId: 'researcher', retryCount: 2, outputKey: 'notes' },
      }],
      edges: [],
    })
    let attempts = 0

    const result = await executeWorkflowAgentPlan({
      graph,
      objective: 'Find facts',
      dispatch: async () => {
        attempts += 1
        if (attempts < 3) {
          return {
            state: 'failed',
            content: '',
            error: { code: 'transient', message: `temporary failure ${attempts}` },
          }
        }
        return { state: 'completed', content: 'facts' }
      },
    })

    expect(result.status).toBe('completed')
    expect(result.executions.map((item) => item.attempt)).toEqual([1, 2, 3])
    expect(result.executions.map((item) => item.state)).toEqual(['failed', 'failed', 'completed'])
    expect(result.state).toEqual({ notes: 'facts' })
  })

  it('stops after an exhausted agent retry and returns the failed node', async () => {
    const graph = normalizeWorkflowGraph({
      nodes: [
        {
          id: 'research',
          kind: 'agent',
          title: 'Research',
          config: { agentId: 'researcher', retryCount: 1, outputKey: 'notes' },
        },
        {
          id: 'write',
          kind: 'agent',
          title: 'Write',
          config: { agentId: 'writer', outputKey: 'draft' },
        },
      ],
      edges: [{ id: 'research-write', from: 'research', to: 'write' }],
    })

    const result = await executeWorkflowAgentPlan({
      graph,
      objective: 'Prepare brief',
      dispatch: async (request) => ({
        state: 'failed',
        content: '',
        error: { code: 'worker_failed', message: `${request.nodeId} failed` },
      }),
    })

    expect(result.status).toBe('failed')
    expect(result.failedNode).toEqual({
      nodeId: 'research',
      agentId: 'researcher',
      attempt: 2,
      error: { code: 'worker_failed', message: 'research failed' },
    })
    expect(result.executions.map((item) => item.nodeId)).toEqual(['research', 'research'])
    expect(result.state).toEqual({})
  })

  it('skips agent nodes behind inactive conditional edges and their descendants', async () => {
    const graph = normalizeWorkflowGraph({
      nodes: [
        {
          id: 'route',
          kind: 'agent',
          title: 'Route',
          config: { agentId: 'router', outputKey: 'route' },
        },
        {
          id: 'review',
          kind: 'agent',
          title: 'Review',
          config: { agentId: 'reviewer', outputKey: 'reviewNotes' },
        },
        {
          id: 'publish',
          kind: 'agent',
          title: 'Publish',
          config: { agentId: 'publisher', outputKey: 'publication' },
        },
      ],
      edges: [
        { id: 'route-review', from: 'route', to: 'review', condition: { op: 'equals', key: 'route', value: 'review' } },
        { id: 'review-publish', from: 'review', to: 'publish' },
      ],
    })

    const result = await executeWorkflowAgentPlan({
      graph,
      objective: 'Choose a branch',
      dispatch: async (request) => ({
        content: request.nodeId === 'route' ? 'skip' : `unexpected ${request.nodeId}`,
      }),
    })

    expect(result.status).toBe('completed')
    expect(result.executions.map((item) => item.nodeId)).toEqual(['route'])
    expect(result.state).toEqual({ route: 'skip' })
  })

  it('executes agent nodes behind active conditional edges and passes active upstream inputs', async () => {
    const graph = normalizeWorkflowGraph({
      nodes: [
        {
          id: 'route',
          kind: 'agent',
          title: 'Route',
          config: { agentId: 'router', outputKey: 'route' },
        },
        {
          id: 'review',
          kind: 'agent',
          title: 'Review',
          config: { agentId: 'reviewer', outputKey: 'reviewNotes' },
        },
      ],
      edges: [
        { id: 'route-review', from: 'route', to: 'review', condition: { op: 'equals', key: 'route', value: 'review' } },
      ],
    })

    const result = await executeWorkflowAgentPlan({
      graph,
      objective: 'Choose a branch',
      dispatch: async (request) => ({
        content: request.nodeId === 'route' ? 'review' : `notes for ${String(request.inputs.route)}`,
      }),
    })

    expect(result.status).toBe('completed')
    expect(result.executions.map((item) => ({ nodeId: item.nodeId, inputs: item.inputs }))).toEqual([
      { nodeId: 'route', inputs: {} },
      { nodeId: 'review', inputs: { route: 'review' } },
    ])
    expect(result.state).toEqual({ route: 'review', reviewNotes: 'notes for review' })
  })

  it('dispatches independent ready agent nodes in the same wave before joining downstream', async () => {
    const graph = normalizeWorkflowGraph({
      nodes: [
        {
          id: 'research',
          kind: 'agent',
          title: 'Research',
          config: { agentId: 'researcher', outputKey: 'facts' },
        },
        {
          id: 'outline',
          kind: 'agent',
          title: 'Outline',
          config: { agentId: 'outliner', outputKey: 'outline' },
        },
        {
          id: 'write',
          kind: 'agent',
          title: 'Write',
          config: { agentId: 'writer', outputKey: 'draft' },
        },
      ],
      edges: [
        { id: 'research-write', from: 'research', to: 'write' },
        { id: 'outline-write', from: 'outline', to: 'write' },
      ],
    })
    const started: string[] = []
    const releases = new Map<string, (content: string) => void>()

    const resultPromise = executeWorkflowAgentPlan({
      graph,
      objective: 'Prepare a brief',
      dispatch: async (request) => {
        started.push(request.nodeId)
        if (request.nodeId === 'write') {
          return { content: `${String(request.inputs.facts)} + ${String(request.inputs.outline)}` }
        }
        return new Promise((resolve) => {
          releases.set(request.nodeId, (content) => resolve({ content }))
        })
      },
    })

    // Two ticks: the wave now emits a "running" snapshot (one microtask hop through
    // input.onSnapshot?.()) before Promise.all actually invokes dispatch for each node.
    await Promise.resolve()
    await Promise.resolve()
    expect(started).toEqual(['research', 'outline'])

    releases.get('research')?.('verified facts')
    releases.get('outline')?.('tight outline')
    const result = await resultPromise

    expect(result.status).toBe('completed')
    expect(started).toEqual(['research', 'outline', 'write'])
    expect(result.state).toEqual({
      facts: 'verified facts',
      outline: 'tight outline',
      draft: 'verified facts + tight outline',
    })
  })

  it('executes subagent nodes as workflow workers and passes their outputs downstream', async () => {
    const graph = normalizeWorkflowGraph({
      nodes: [
        {
          id: 'draft-temp',
          kind: 'subagent',
          title: 'Draft Temp',
          config: { prompt: 'Draft a section', outputKey: 'section' },
        },
        {
          id: 'review',
          kind: 'agent',
          title: 'Review',
          config: { agentId: 'reviewer', outputKey: 'reviewed' },
        },
      ],
      edges: [{ id: 'draft-review', from: 'draft-temp', to: 'review' }],
    })

    const result = await executeWorkflowAgentPlan({
      graph,
      objective: 'Prepare docs',
      dispatch: async (request) => ({
        content: request.nodeId === 'draft-temp'
          ? `drafted by ${request.agentId}`
          : `reviewed ${String(request.inputs.section)}`,
      }),
    })

    expect(result.status).toBe('completed')
    expect(result.executions.map((item) => ({
      nodeId: item.nodeId,
      agentId: item.agentId,
      inputs: item.inputs,
    }))).toEqual([
      { nodeId: 'draft-temp', agentId: 'workflow-subagent:draft-temp', inputs: {} },
      {
        nodeId: 'review',
        agentId: 'reviewer',
        inputs: { section: 'drafted by workflow-subagent:draft-temp' },
      },
    ])
    expect(result.state).toEqual({
      section: 'drafted by workflow-subagent:draft-temp',
      reviewed: 'reviewed drafted by workflow-subagent:draft-temp',
    })
  })

  it('executes input atomic nodes and passes their output to downstream workers', async () => {
    const graph = normalizeWorkflowGraph({
      nodes: [
        {
          id: 'input',
          kind: 'input',
          title: 'Input',
          config: { prompt: 'Parsed brief', outputKey: 'brief' },
        },
        {
          id: 'write',
          kind: 'agent',
          title: 'Write',
          config: { agentId: 'writer', outputKey: 'draft' },
        },
      ],
      edges: [{ id: 'input-write', from: 'input', to: 'write' }],
    })

    const result = await executeWorkflowAgentPlan({
      graph,
      objective: 'Prepare docs',
      dispatch: async (request) => ({ content: `draft from ${String(request.inputs.brief)}` }),
    })

    expect(result.status).toBe('completed')
    expect(result.atomicExecutions).toEqual([
      {
        nodeId: 'input',
        kind: 'input',
        state: 'completed',
        outputKey: 'brief',
        content: 'Parsed brief',
      },
    ])
    expect(result.executions[0]?.inputs).toEqual({ brief: 'Parsed brief' })
    expect(result.state).toEqual({ brief: 'Parsed brief', draft: 'draft from Parsed brief' })
  })

  it('stops when an atomic verify node fails', async () => {
    const graph = normalizeWorkflowGraph({
      nodes: [
        {
          id: 'write',
          kind: 'agent',
          title: 'Write',
          config: { agentId: 'writer', outputKey: 'draft' },
        },
        {
          id: 'verify',
          kind: 'verify',
          title: 'Verify',
          config: { verifyCommands: ['pnpm test'], outputKey: 'verification' },
        },
      ],
      edges: [{ id: 'write-verify', from: 'write', to: 'verify' }],
    })

    const result = await executeWorkflowAgentPlan({
      graph,
      objective: 'Prepare docs',
      dispatch: async () => ({ content: 'draft' }),
      executeAtomicNode: async () => ({
        state: 'failed',
        content: 'tests failed',
        error: { code: 'verify_failed', message: 'pnpm test failed' },
      }),
    })

    expect(result.status).toBe('failed')
    expect(result.atomicExecutions).toEqual([
      {
        nodeId: 'verify',
        kind: 'verify',
        state: 'failed',
        outputKey: 'verification',
        content: 'tests failed',
        error: { code: 'verify_failed', message: 'pnpm test failed' },
      },
    ])
    expect(result.failedNode).toEqual({
      nodeId: 'verify',
      agentId: 'verify',
      attempt: 1,
      error: { code: 'verify_failed', message: 'pnpm test failed' },
    })
    expect(result.state).toEqual({ draft: 'draft' })
  })

  it('retries a failed verify node up to retryCount before giving up', async () => {
    // Previously atomic nodes (verify/approval/etc) never retried at all, even with
    // retryCount configured — a transient failure (flaky test run, network blip during a
    // verify command) killed the whole plan outright, unlike agent/subagent nodes which
    // already retried. This closes that gap for verify specifically.
    const graph = normalizeWorkflowGraph({
      nodes: [
        {
          id: 'verify',
          kind: 'verify',
          title: 'Verify',
          config: { verifyCommands: ['pnpm test'], outputKey: 'verification', retryCount: 2 },
        },
      ],
      edges: [],
    })
    let attempts = 0
    const result = await executeWorkflowAgentPlan({
      graph,
      objective: 'Verify build',
      dispatch: async () => ({ content: 'unused' }),
      executeAtomicNode: async () => {
        attempts += 1
        return attempts < 3
          ? { state: 'failed', content: 'flaky', error: { message: 'transient failure' } }
          : { content: 'all green' }
      },
    })
    expect(attempts).toBe(3)
    expect(result.status).toBe('completed')
    expect(result.state).toEqual({ verification: 'all green' })
  })

  it('does not retry a rejected approval node even with retryCount configured', async () => {
    // Approval "failed" means the user explicitly declined (or the question channel broke) —
    // retrying would mean silently re-asking or, worse, re-auto-approving in unattended mode
    // after an explicit rejection. That must never happen regardless of retryCount.
    const graph = normalizeWorkflowGraph({
      nodes: [
        {
          id: 'approval',
          kind: 'approval',
          title: 'Confirm deploy',
          config: { outputKey: 'approval', retryCount: 3 },
        },
      ],
      edges: [],
    })
    let attempts = 0
    const result = await executeWorkflowAgentPlan({
      graph,
      objective: 'Deploy to prod',
      dispatch: async () => ({ content: 'unused' }),
      executeAtomicNode: async () => {
        attempts += 1
        return { state: 'failed', content: '', error: { code: 'denied', message: 'User declined' } }
      },
    })
    expect(attempts).toBe(1)
    expect(result.status).toBe('failed')
  })

  it('forwards attachments to dispatched agent/subagent nodes', async () => {
    const graph = normalizeWorkflowGraph({
      nodes: [{ id: 'A', kind: 'agent', title: 'Review', config: { agentId: 'reviewer' } }],
      edges: [],
    })
    let receivedAttachments: unknown
    await executeWorkflowAgentPlan({
      graph,
      objective: 'Review the attached screenshot',
      attachments: [{ type: 'image_ref', value: '/tmp/screenshot.png' }],
      dispatch: async (request) => {
        receivedAttachments = request.attachments
        return { content: 'looks fine' }
      },
    })
    expect(receivedAttachments).toEqual([{ type: 'image_ref', value: '/tmp/screenshot.png' }])
  })

  it('resumes a run by skipping nodes seeded in initialCompletedNodeIds', async () => {
    const graph = normalizeWorkflowGraph({
      nodes: [
        {
          id: 'A',
          kind: 'agent',
          title: 'Research',
          config: { agentId: 'researcher', outputKey: 'notes' },
        },
        {
          id: 'B',
          kind: 'agent',
          title: 'Write',
          config: { agentId: 'writer', outputKey: 'draft' },
        },
      ],
      edges: [{ id: 'A-B', from: 'A', to: 'B' }],
    })
    const dispatched: string[] = []

    const result = await executeWorkflowAgentPlan({
      graph,
      objective: 'Resume the brief',
      initialState: { notes: 'verified facts' },
      initialCompletedNodeIds: ['A'],
      dispatch: async (request) => {
        dispatched.push(request.nodeId)
        return { content: `draft from ${String(request.inputs.notes)}` }
      },
    })

    expect(dispatched).toEqual(['B'])
    expect(result.status).toBe('completed')
    expect(result.executions.map((item) => item.nodeId)).toEqual(['B'])
    expect(result.state).toEqual({ notes: 'verified facts', draft: 'draft from verified facts' })
  })

  it('emits cumulative progress snapshots per node and a final completed snapshot', async () => {
    const graph = normalizeWorkflowGraph({
      nodes: [
        {
          id: 'research',
          kind: 'agent',
          title: 'Research',
          config: { agentId: 'researcher', outputKey: 'notes' },
        },
        {
          id: 'write',
          kind: 'agent',
          title: 'Write',
          config: { agentId: 'writer', outputKey: 'draft' },
        },
      ],
      edges: [{ id: 'research-write', from: 'research', to: 'write' }],
    })
    const snapshots: Array<{ status: string; completedNodeIds: string[]; runningNodeIds: string[] }> = []

    const result = await executeWorkflowAgentPlan({
      graph,
      objective: 'Track progress',
      dispatch: async (request) => ({
        content: request.nodeId === 'research' ? 'facts' : `draft from ${String(request.inputs.notes)}`,
      }),
      onSnapshot: (snapshot) => {
        snapshots.push({
          status: snapshot.status,
          completedNodeIds: [...snapshot.completedNodeIds],
          runningNodeIds: [...snapshot.runningNodeIds],
        })
      },
    })

    expect(result.status).toBe('completed')
    // Each node now emits a "started" snapshot (runningNodeIds populated, for live progress UI)
    // in addition to the existing "completed" snapshot.
    expect(snapshots).toEqual([
      { status: 'working', completedNodeIds: [], runningNodeIds: ['research'] },
      { status: 'working', completedNodeIds: ['research'], runningNodeIds: [] },
      { status: 'working', completedNodeIds: ['research'], runningNodeIds: ['write'] },
      { status: 'working', completedNodeIds: ['research', 'write'], runningNodeIds: [] },
      { status: 'completed', completedNodeIds: ['research', 'write'], runningNodeIds: [] },
    ])
  })

  it('reports running node ids for a parallel wave before they complete', async () => {
    const graph = normalizeWorkflowGraph({
      nodes: [
        { id: 'a', kind: 'agent', title: 'A', config: { agentId: 'agent-a', outputKey: 'a' } },
        { id: 'b', kind: 'agent', title: 'B', config: { agentId: 'agent-b', outputKey: 'b' } },
      ],
      edges: [],
    })
    const runningSnapshots: string[][] = []

    await executeWorkflowAgentPlan({
      graph,
      objective: 'Parallel',
      dispatch: async () => ({ content: 'done' }),
      onSnapshot: (snapshot) => {
        runningSnapshots.push([...snapshot.runningNodeIds].sort())
      },
    })

    // The snapshot emitted right before the Promise.all wave should show both nodes running
    // simultaneously — this is what a live progress UI needs to render "in progress" state.
    expect(runningSnapshots).toContainEqual(['a', 'b'])
  })

  it('fails instead of reporting success when pending nodes are deadlocked', async () => {
    const graph = normalizeWorkflowGraph({
      nodes: [
        {
          id: 'A',
          kind: 'agent',
          title: 'A',
          config: { agentId: 'worker-a', outputKey: 'a' },
        },
        {
          id: 'B',
          kind: 'agent',
          title: 'B',
          config: { agentId: 'worker-b', outputKey: 'b' },
        },
      ],
      edges: [
        { id: 'A-B', from: 'A', to: 'B' },
        { id: 'B-A', from: 'B', to: 'A' },
      ],
    })

    const result = await executeWorkflowAgentPlan({
      graph,
      objective: 'Do the impossible',
      dispatch: async () => ({ content: 'unreachable' }),
    })

    expect(result.status).toBe('failed')
    expect(result.failedNode).toEqual({
      nodeId: 'A',
      agentId: 'worker-a',
      attempt: 0,
      error: {
        code: 'workflow_deadlock',
        message: 'Workflow blocked with unresolved nodes: A, B',
      },
    })
  })

  it('fans out a subagent node with parallelism=3 and aggregates branches into outputKey', async () => {
    const graph = normalizeWorkflowGraph({
      nodes: [
        {
          id: 'draft',
          kind: 'subagent',
          title: 'Draft',
          config: { parallelism: 3, outputKey: 'draft' },
        },
      ],
      edges: [],
    })
    let dispatchCount = 0

    const result = await executeWorkflowAgentPlan({
      graph,
      objective: 'Draft three options',
      dispatch: async () => {
        dispatchCount += 1
        return { content: `option ${dispatchCount}` }
      },
    })

    expect(dispatchCount).toBe(3)
    expect(result.status).toBe('completed')
    expect(result.state.draft).toBe('--- branch 1 ---\noption 1\n\n--- branch 2 ---\noption 2\n\n--- branch 3 ---\noption 3')
    expect(result.executions).toHaveLength(3)
    expect(result.executions.map((item) => item.attempt)).toEqual([1, 1, 1])
    expect(result.executions.map((item) => item.state)).toEqual(['completed', 'completed', 'completed'])
  })

  it('fails the node when one fan-out branch fails, recording all branches', async () => {
    const graph = normalizeWorkflowGraph({
      nodes: [
        {
          id: 'draft',
          kind: 'subagent',
          title: 'Draft',
          config: { parallelism: 3, retryCount: 0, outputKey: 'draft' },
        },
      ],
      edges: [],
    })
    let dispatchCount = 0

    const result = await executeWorkflowAgentPlan({
      graph,
      objective: 'Draft with one bad branch',
      dispatch: async () => {
        dispatchCount += 1
        if (dispatchCount === 2) {
          return {
            state: 'failed',
            content: '',
            error: { code: 'branch_down', message: 'branch 2 exploded' },
          }
        }
        return { content: `branch ${dispatchCount} ok` }
      },
    })

    expect(dispatchCount).toBe(3)
    expect(result.status).toBe('failed')
    expect(result.failedNode).toEqual({
      nodeId: 'draft',
      agentId: 'workflow-subagent:draft',
      attempt: 1,
      error: { code: 'branch_down', message: 'branch 2 exploded' },
    })
    expect(result.executions).toHaveLength(3)
    expect(result.state).toEqual({})
  })

  it('dispatches once when parallelism is unset or <= 1 for subagent', async () => {
    const graph = normalizeWorkflowGraph({
      nodes: [
        {
          id: 'solo',
          kind: 'subagent',
          title: 'Solo',
          config: { outputKey: 'solo' },
        },
      ],
      edges: [],
    })
    let dispatchCount = 0

    const result = await executeWorkflowAgentPlan({
      graph,
      objective: 'Single path',
      dispatch: async () => {
        dispatchCount += 1
        return { content: 'solo output' }
      },
    })

    expect(dispatchCount).toBe(1)
    expect(result.status).toBe('completed')
    expect(result.state.solo).toBe('solo output')
    expect(result.executions).toHaveLength(1)
  })

  it('fails an agent node with missing_agent_id when its config.agentId is empty', async () => {
    const graph = normalizeWorkflowGraph({
      nodes: [
        {
          id: 'unbound',
          kind: 'agent',
          title: 'Unbound Agent',
          config: { outputKey: 'out' },
        },
      ],
      edges: [],
    })

    const result = await executeWorkflowAgentPlan({
      graph,
      objective: 'Should fail loudly',
      dispatch: async () => ({ content: 'should not be called' }),
    })

    expect(result.status).toBe('failed')
    expect(result.failedNode).toEqual({
      nodeId: 'unbound',
      agentId: '',
      attempt: 1,
      error: {
        code: 'missing_agent_id',
        message: 'agent 节点「Unbound Agent」未绑定 Agent（config.agentId 为空），无法派发。',
      },
    })
    expect(result.executions).toHaveLength(1)
    expect(result.executions[0]?.state).toBe('failed')
    expect(result.state).toEqual({})
  })

  it('falls back to the host agent when an agent node is unbound or points at an unavailable worker', async () => {
    const graph = normalizeWorkflowGraph({
      nodes: [
        {
          id: 'unbound',
          kind: 'agent',
          title: 'Unbound Agent',
          config: { outputKey: 'a' },
        },
        {
          id: 'stale',
          kind: 'agent',
          title: 'Stale Agent',
          config: { agentId: 'deleted-worker', outputKey: 'b' },
        },
      ],
      edges: [{ id: 'a-b', from: 'unbound', to: 'stale' }],
    })

    const result = await executeWorkflowAgentPlan({
      graph,
      objective: 'Use host fallback',
      fallbackAgentId: 'host-agent',
      availableWorkerIds: new Set(['host-agent']),
      dispatch: async (request) => ({ content: `${request.agentId}:${request.nodeId}` }),
    })

    expect(result.status).toBe('completed')
    expect(result.executions.map((item) => ({
      nodeId: item.nodeId,
      agentId: item.agentId,
      inputs: item.inputs,
    }))).toEqual([
      { nodeId: 'unbound', agentId: 'host-agent', inputs: {} },
      { nodeId: 'stale', agentId: 'host-agent', inputs: { a: 'host-agent:unbound' } },
    ])
    expect(result.state).toEqual({
      a: 'host-agent:unbound',
      b: 'host-agent:stale',
    })
  })

  it('terminates the whole workflow when one agent has empty agentId alongside healthy nodes', async () => {
    const graph = normalizeWorkflowGraph({
      nodes: [
        {
          id: 'healthy',
          kind: 'agent',
          title: 'Healthy',
          config: { agentId: 'worker-a', outputKey: 'a' },
        },
        {
          id: 'unbound',
          kind: 'agent',
          title: 'Unbound',
          config: { outputKey: 'b' },
        },
      ],
      edges: [],
    })
    const dispatched: string[] = []

    const result = await executeWorkflowAgentPlan({
      graph,
      objective: 'Mixed wave',
      dispatch: async (request) => {
        dispatched.push(request.nodeId)
        return { content: `${request.nodeId} ok` }
      },
    })

    // Both ready nodes are dispatched in the same wave; the unbound one short-circuits to
    // missing_agent_id without calling dispatch, the healthy one runs normally. The wave
    // then fails on the unbound node.
    expect(dispatched).toEqual(['healthy'])
    expect(result.status).toBe('failed')
    expect(result.failedNode?.nodeId).toBe('unbound')
    expect(result.failedNode?.error.code).toBe('missing_agent_id')
    // healthy still wrote its output before the wave failed
    expect(result.state.a).toBe('healthy ok')
  })

  it('executes a loop body until breakCondition matches and writes the last iteration result', async () => {
    const graph = normalizeWorkflowGraph({
      nodes: [
        {
          id: 'loop-1',
          kind: 'loop',
          title: 'Improve draft',
          config: {
            outputKey: 'finalDraft',
            maxIterations: 5,
            resultKey: 'draft',
            breakCondition: { op: 'equals', key: 'verdict', value: 'pass' },
            body: {
              nodes: [
                { id: 'draft', kind: 'input', title: 'Draft', config: { outputKey: 'draft' } },
                { id: 'judge', kind: 'input', title: 'Judge', config: { outputKey: 'verdict' } },
              ],
              edges: [{ id: 'draft-judge', from: 'draft', to: 'judge' }],
            },
          },
        },
      ],
      edges: [],
    })
    let iteration = 0

    const result = await executeWorkflowAgentPlan({
      graph,
      objective: 'Refine until accepted',
      dispatch: async () => ({ content: 'unused' }),
      executeAtomicNode: async (request) => {
        if (request.nodeId === 'draft') {
          iteration += 1
          return { content: `draft ${iteration}` }
        }
        return {
          content: request.inputs.draft === 'draft 3' ? 'pass' : 'retry',
        }
      },
    })

    expect(iteration).toBe(3)
    expect(result.status).toBe('completed')
    expect(result.atomicExecutions).toEqual([
      {
        nodeId: 'loop-1',
        kind: 'loop',
        state: 'completed',
        outputKey: 'finalDraft',
        content: 'draft 3',
      },
    ])
    expect(result.state).toEqual({ finalDraft: 'draft 3' })
  })

  it('caps loop maxIterations at 50 and aggregates every iteration when collectAll is true', async () => {
    const graph = normalizeWorkflowGraph({
      nodes: [
        {
          id: 'loop-1',
          kind: 'loop',
          title: 'Collect options',
          config: {
            outputKey: 'history',
            maxIterations: 99,
            collectAll: true,
            resultKey: 'option',
            body: {
              nodes: [
                { id: 'option', kind: 'input', title: 'Option', config: { outputKey: 'option' } },
              ],
              edges: [],
            },
          },
        },
      ],
      edges: [],
    })
    let iteration = 0

    const result = await executeWorkflowAgentPlan({
      graph,
      objective: 'Collect options',
      dispatch: async () => ({ content: 'unused' }),
      executeAtomicNode: async () => {
        iteration += 1
        return { content: `option ${iteration}` }
      },
    })

    expect(iteration).toBe(50)
    expect(result.status).toBe('completed')
    expect(result.state.history).toContain('--- iteration 1 ---\noption 1')
    expect(result.state.history).toContain('--- iteration 50 ---\noption 50')
  })

  it('fails a loop node with a clear error when its body contains a nested loop', async () => {
    const graph = normalizeWorkflowGraph({
      nodes: [
        {
          id: 'outer-loop',
          kind: 'loop',
          title: 'Outer loop',
          config: {
            outputKey: 'result',
            body: {
              nodes: [
                {
                  id: 'inner-loop',
                  kind: 'loop',
                  title: 'Inner loop',
                  config: { body: { nodes: [], edges: [] } },
                },
              ],
              edges: [],
            },
          },
        },
      ],
      edges: [],
    })

    const result = await executeWorkflowAgentPlan({
      graph,
      objective: 'Nested loops are not supported in v1',
      dispatch: async () => ({ content: 'unused' }),
      executeAtomicNode: async () => ({ content: 'should not run' }),
    })

    expect(result.status).toBe('failed')
    expect(result.failedNode).toEqual({
      nodeId: 'outer-loop',
      agentId: 'loop',
      attempt: 1,
      error: {
        code: 'workflow_loop_nested',
        message: 'Loop node outer-loop contains nested loop node inner-loop, which is not supported in v1.',
      },
    })
  })
})

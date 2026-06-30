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
      ],
      edges: [],
    })

    expect(getWorkflowAgentWorkerIds(graph.nodes)).toEqual(new Set([
      'agent-1',
      'temp-agent',
      'workflow-subagent:generated',
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

  it('skips ineligible nodes and does not write replies without an output key', async () => {
    const graph = normalizeWorkflowGraph({
      nodes: [
        { id: 'input', kind: 'input', title: 'Input', config: { agentId: 'ignored' } },
        { id: 'missing', kind: 'agent', title: 'Missing agent', config: {} },
        { id: 'blank', kind: 'agent', title: 'Blank agent', config: { agentId: '  ' } },
        { id: 'run', kind: 'agent', title: 'Fallback instruction', config: { agentId: 'worker', prompt: '  ' } },
      ],
      edges: [],
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
})

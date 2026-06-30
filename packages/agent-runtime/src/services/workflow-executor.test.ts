import { describe, expect, it } from 'vitest'
import {
  buildWorkflowNodeInputs,
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

  it('extracts explicit agent worker ids from agent nodes only', () => {
    const graph = normalizeWorkflowGraph({
      nodes: [
        { id: 'a', kind: 'agent', title: 'Agent A', config: { agentId: 'agent-1' } },
        { id: 'b', kind: 'agent', title: 'Agent B', config: { agentId: ' ' } },
        { id: 's', kind: 'subagent', title: 'Temp', config: { agentId: 'temp-agent' } },
      ],
      edges: [],
    })

    expect(getWorkflowAgentWorkerIds(graph.nodes)).toEqual(new Set(['agent-1']))
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
})

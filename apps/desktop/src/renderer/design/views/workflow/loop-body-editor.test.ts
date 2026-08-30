import { describe, expect, it } from 'vitest'
import type { WorkflowGraph, WorkflowNodeKind } from '@spark/protocol'
import {
  completeWorkflowEditorGraph,
  commitLoopBodyGraph,
  createScopedWorkflowNodeId,
  defaultLoopBodyGraph,
  openLoopBodyGraph,
  summarizeLoopBodyGraph,
  validateLoopBodyGraph,
  validateWorkflowLoopBodies,
} from './loop-body-editor'

function node(id: string, kind: WorkflowNodeKind = 'agent'): WorkflowGraph['nodes'][number] {
  return { id, kind, title: id, x: 80, y: 120, config: { outputKey: `${id}_output` } }
}

function rootGraph(body: WorkflowGraph = defaultLoopBodyGraph()): WorkflowGraph {
  return {
    orientation: 'vertical',
    nodes: [
      node('input', 'input'),
      {
        id: 'loop-1',
        kind: 'loop',
        title: '实现与自检',
        x: 320,
        y: 120,
        config: { outputKey: 'loop_result', body },
      },
      node('sibling', 'review'),
    ],
    edges: [
      { id: 'input-loop', from: 'input', to: 'loop-1' },
      { id: 'loop-sibling', from: 'loop-1', to: 'sibling' },
    ],
  }
}

describe('workflow loop body editor helpers', () => {
  it('opens an existing loop body and commits it without changing sibling nodes', () => {
    const body: WorkflowGraph = {
      orientation: 'vertical',
      nodes: [node('body-agent')],
      edges: [],
    }
    const root = rootGraph(body)

    const opened = openLoopBodyGraph(root, 'loop-1', defaultLoopBodyGraph())
    expect(opened).toEqual({ graph: body, loopTitle: '实现与自检', usedFallback: false })
    expect(opened.graph).not.toBe(body)

    const changed: WorkflowGraph = {
      ...opened.graph,
      orientation: 'horizontal',
      nodes: [...opened.graph.nodes, node('body-review', 'review')],
    }
    const committed = commitLoopBodyGraph(root, 'loop-1', changed)

    expect(committed.nodes.find((item) => item.id === 'loop-1')?.config.body).toEqual(changed)
    expect(committed.nodes.find((item) => item.id === 'sibling')).toBe(
      root.nodes.find((item) => item.id === 'sibling'),
    )
    expect(root.nodes.find((item) => item.id === 'loop-1')?.config.body).toEqual(body)
  })

  it('composes the currently edited child graph into the complete root graph', () => {
    const root = rootGraph()
    const changedBody: WorkflowGraph = {
      orientation: 'vertical',
      nodes: [node('changed-body')],
      edges: [],
    }

    expect(
      completeWorkflowEditorGraph(
        {
          kind: 'loop-body',
          loopNodeId: 'loop-1',
          loopTitle: '实现与自检',
          rootGraph: root,
        },
        changedBody,
      ).nodes.find((item) => item.id === 'loop-1')?.config.body,
    ).toEqual(changedBody)
    expect(completeWorkflowEditorGraph({ kind: 'root' }, changedBody)).toBe(changedBody)
  })

  it('uses a cloned fallback body when a loop has no body', () => {
    const fallback = defaultLoopBodyGraph()
    const root = rootGraph()
    const loop = root.nodes.find((item) => item.id === 'loop-1')
    if (loop == null) throw new Error('fixture loop missing')
    loop.config = { outputKey: 'loop_result' }

    const opened = openLoopBodyGraph(root, 'loop-1', fallback)

    expect(opened.graph).toEqual(fallback)
    expect(opened.graph).not.toBe(fallback)
    expect(opened.usedFallback).toBe(true)
  })

  it('rejects malformed graph members before they reach the React Flow adapter', () => {
    expect(
      openLoopBodyGraph(
        rootGraph({ nodes: [null], edges: [] } as unknown as WorkflowGraph),
        'loop-1',
        defaultLoopBodyGraph(),
      ).usedFallback,
    ).toBe(true)
    expect(
      openLoopBodyGraph(
        rootGraph({ nodes: [], edges: [{ id: 'broken' }] } as unknown as WorkflowGraph),
        'loop-1',
        defaultLoopBodyGraph(),
      ).usedFallback,
    ).toBe(true)
    expect(
      openLoopBodyGraph(
        rootGraph({
          nodes: [node('source'), node('target')],
          edges: [
            {
              id: 'bad-op',
              from: 'source',
              to: 'target',
              condition: { op: 'unknown', key: 'status' },
            },
          ],
        } as unknown as WorkflowGraph),
        'loop-1',
        defaultLoopBodyGraph(),
      ).usedFallback,
    ).toBe(true)
  })

  it('summarizes nodes, edges, conditional edges and orientation', () => {
    const body: WorkflowGraph = {
      orientation: 'vertical',
      nodes: [node('draft'), node('judge', 'review')],
      edges: [
        {
          id: 'draft-judge',
          from: 'draft',
          to: 'judge',
          condition: { op: 'equals', key: 'draft_output', value: 'ready' },
        },
      ],
    }

    expect(summarizeLoopBodyGraph(body)).toEqual({
      nodeCount: 2,
      edgeCount: 1,
      conditionalEdgeCount: 1,
      orientation: 'vertical',
    })
  })

  it('reports empty, nested loop, collision, dangling edge, invalid condition and cycle errors', () => {
    const root = rootGraph()
    const invalid: WorkflowGraph = {
      nodes: [
        node('input'),
        node('duplicate'),
        node('duplicate', 'review'),
        node('inner-loop', 'loop'),
        node('cycle-a'),
        node('cycle-b'),
      ],
      edges: [
        { id: 'dangling', from: 'missing', to: 'input' },
        {
          id: 'bad-condition',
          from: 'input',
          to: 'duplicate',
          condition: { op: 'truthy', key: '   ' },
        },
        { id: 'cycle-a-b', from: 'cycle-a', to: 'cycle-b' },
        { id: 'cycle-b-a', from: 'cycle-b', to: 'cycle-a' },
      ],
    }

    expect(validateLoopBodyGraph({ nodes: [], edges: [] }, root, 'loop-1')).toContainEqual({
      code: 'empty_body',
      message: '循环体至少需要一个节点。',
    })
    expect(validateLoopBodyGraph(invalid, root, 'loop-1').map((error) => error.code)).toEqual([
      'node_id_collision',
      'duplicate_node_id',
      'nested_loop',
      'dangling_edge',
      'invalid_condition',
      'cycle',
    ])
  })

  it('validates every root loop body before the complete workflow is saved', () => {
    const root = rootGraph()
    const target = root.nodes.find((item) => item.id === 'loop-1')
    if (target == null) throw new Error('fixture loop missing')
    target.config.body = { nodes: [], edges: [] }
    root.nodes.push({
      id: 'loop-2',
      kind: 'loop',
      title: '损坏循环',
      x: 640,
      y: 120,
      config: { body: { nodes: [null], edges: [] } as unknown as WorkflowGraph },
    })

    expect(validateWorkflowLoopBodies(root).map((error) => error.code)).toEqual([
      'empty_body',
      'invalid_body',
    ])
  })

  it('creates deterministic scoped ids that avoid both root and body collisions', () => {
    const existing = new Set(['loop-1__agent-1', 'loop-1__agent-2'])
    let sequence = 0

    const id = createScopedWorkflowNodeId('loop-1', 'agent', existing, () => {
      sequence += 1
      return sequence.toString(36)
    })

    expect(id).toBe('loop-1__agent-3')
  })

  it('throws a useful error when the target is not a loop node', () => {
    expect(() => openLoopBodyGraph(rootGraph(), 'input', defaultLoopBodyGraph())).toThrow(
      'Loop node input not found.',
    )
  })
})

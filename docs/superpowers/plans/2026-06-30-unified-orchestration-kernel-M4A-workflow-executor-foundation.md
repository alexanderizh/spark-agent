# M4A Workflow Executor Foundation Implementation Plan

> 状态: [实施中] | 最后核对: 2026-06-30

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create the tested workflow execution foundation that M4 can build on before wiring real dispatch into `SessionService`.

**Architecture:** Keep the first M4 cut outside the `session.service.ts` hot path by extracting workflow graph normalization, topological ordering, agent worker discovery, and node input construction into a small pure module. Then refactor the existing prompt-flattening helpers to use the module without changing runtime behavior. Real dispatch, run persistence, parallelism, conditions, and resume are separate follow-up cuts.

**Tech Stack:** TypeScript ESM, Vitest, existing `@spark/protocol` workflow types, existing `TeamDispatchService` worker id semantics.

---

## File Structure

- Create: `packages/agent-runtime/src/services/workflow-executor.ts`
  - Pure workflow graph helpers and planning types for M4.
  - No database access, no SDK calls, no dispatch side effects.
- Test: `packages/agent-runtime/src/services/workflow-executor.test.ts`
  - Focused unit tests for graph normalization, topological ordering, worker id extraction, and input construction.
- Modify: `packages/agent-runtime/src/services/session.service.ts`
  - Replace local `normalizeWorkflowGraph` / `orderWorkflowNodes` helper definitions with imports from `workflow-executor.ts`.
  - Keep `buildWorkflowSystemPrompt` behavior equivalent for this cut.

## Task 1: Pure Workflow Graph Helpers

**Files:**
- Create: `packages/agent-runtime/src/services/workflow-executor.ts`
- Test: `packages/agent-runtime/src/services/workflow-executor.test.ts`

- [ ] **Step 1: Write failing tests**

Add `packages/agent-runtime/src/services/workflow-executor.test.ts`:

```ts
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
```

- [ ] **Step 2: Run the tests and verify RED**

Run:

```bash
pnpm --filter @spark/agent-runtime exec vitest run src/services/workflow-executor.test.ts
```

Expected: FAIL because `workflow-executor.ts` does not exist.

- [ ] **Step 3: Implement the pure helper module**

Create `packages/agent-runtime/src/services/workflow-executor.ts`:

```ts
import type { WorkflowGraph, WorkflowNodeKind } from '@spark/protocol'

export type WorkflowState = Record<string, unknown>

export type NormalizedWorkflowNode = {
  id: string
  kind: WorkflowNodeKind
  title: string
  config: Record<string, unknown>
}

export type NormalizedWorkflowEdge = {
  id: string
  from: string
  to: string
}

export type NormalizedWorkflowGraph = {
  nodes: NormalizedWorkflowNode[]
  edges: NormalizedWorkflowEdge[]
}

const WORKFLOW_NODE_KINDS = new Set<WorkflowNodeKind>([
  'input',
  'plan',
  'agent',
  'subagent',
  'skill',
  'tool',
  'mcp',
  'approval',
  'verify',
  'review',
  'artifact',
])

export function normalizeWorkflowGraph(graph: WorkflowGraph | Record<string, unknown>): NormalizedWorkflowGraph {
  const rawNodes = Array.isArray(graph.nodes) ? graph.nodes : []
  const nodes = rawNodes.flatMap((node): NormalizedWorkflowNode[] => {
    if (node == null || typeof node !== 'object') return []
    const record = node as Record<string, unknown>
    const id = typeof record.id === 'string' ? record.id.trim() : ''
    if (id.length === 0) return []
    const rawKind = typeof record.kind === 'string' ? record.kind : 'agent'
    const kind = WORKFLOW_NODE_KINDS.has(rawKind as WorkflowNodeKind)
      ? rawKind as WorkflowNodeKind
      : 'agent'
    return [{
      id,
      kind,
      title: typeof record.title === 'string' && record.title.trim().length > 0 ? record.title : id,
      config: record.config != null && typeof record.config === 'object'
        ? record.config as Record<string, unknown>
        : {},
    }]
  })

  const nodeIds = new Set(nodes.map((node) => node.id))
  const rawEdges = Array.isArray(graph.edges) ? graph.edges : []
  const edges = rawEdges.flatMap((edge, index): NormalizedWorkflowEdge[] => {
    if (edge == null || typeof edge !== 'object') return []
    const record = edge as Record<string, unknown>
    const from = typeof record.from === 'string' ? record.from.trim() : ''
    const to = typeof record.to === 'string' ? record.to.trim() : ''
    if (!nodeIds.has(from) || !nodeIds.has(to)) return []
    const id = typeof record.id === 'string' && record.id.trim().length > 0
      ? record.id
      : `${from}->${to}:${index}`
    return [{ id, from, to }]
  })

  return { nodes, edges }
}

export function orderWorkflowNodes(
  nodes: NormalizedWorkflowNode[],
  edges: NormalizedWorkflowEdge[],
): NormalizedWorkflowNode[] {
  const byId = new Map(nodes.map((node) => [node.id, node]))
  const incoming = new Map(nodes.map((node) => [node.id, 0]))
  const outgoing = new Map<string, string[]>()
  for (const edge of edges) {
    if (!byId.has(edge.from) || !byId.has(edge.to)) continue
    incoming.set(edge.to, (incoming.get(edge.to) ?? 0) + 1)
    outgoing.set(edge.from, [...(outgoing.get(edge.from) ?? []), edge.to])
  }

  const queue = nodes.filter((node) => (incoming.get(node.id) ?? 0) === 0)
  const ordered: NormalizedWorkflowNode[] = []
  while (queue.length > 0) {
    const node = queue.shift()!
    ordered.push(node)
    for (const to of outgoing.get(node.id) ?? []) {
      const next = (incoming.get(to) ?? 0) - 1
      incoming.set(to, next)
      if (next === 0) {
        const target = byId.get(to)
        if (target != null) queue.push(target)
      }
    }
  }

  return ordered.length === nodes.length ? ordered : nodes
}

export function getWorkflowAgentWorkerIds(nodes: NormalizedWorkflowNode[]): Set<string> {
  const ids = new Set<string>()
  for (const node of nodes) {
    if (node.kind !== 'agent') continue
    const agentId = typeof node.config.agentId === 'string' ? node.config.agentId.trim() : ''
    if (agentId.length > 0) ids.add(agentId)
  }
  return ids
}

export function buildWorkflowNodeInputs(
  nodeId: string,
  graph: NormalizedWorkflowGraph,
  state: WorkflowState,
): Record<string, unknown> {
  const byId = new Map(graph.nodes.map((node) => [node.id, node]))
  const inputs: Record<string, unknown> = {}
  for (const edge of graph.edges) {
    if (edge.to !== nodeId) continue
    const upstream = byId.get(edge.from)
    const outputKey = typeof upstream?.config.outputKey === 'string' ? upstream.config.outputKey.trim() : ''
    if (outputKey.length === 0 || !(outputKey in state)) continue
    inputs[outputKey] = state[outputKey]
  }
  return inputs
}
```

- [ ] **Step 4: Run the helper tests and verify GREEN**

Run:

```bash
pnpm --filter @spark/agent-runtime exec vitest run src/services/workflow-executor.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/agent-runtime/src/services/workflow-executor.ts \
        packages/agent-runtime/src/services/workflow-executor.test.ts
git commit -m "feat(orchestration): add workflow executor graph foundation"
```

## Task 2: Refactor Existing Workflow Prompt Helpers To Use The Module

**Files:**
- Modify: `packages/agent-runtime/src/services/session.service.ts`
- Test: `packages/agent-runtime/src/services/workflow-executor.test.ts`

- [ ] **Step 1: Add a regression test for prompt-compatible ordering**

Append to `workflow-executor.test.ts`:

```ts
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
```

- [ ] **Step 2: Run the tests and verify they pass before refactor**

Run:

```bash
pnpm --filter @spark/agent-runtime exec vitest run src/services/workflow-executor.test.ts
```

Expected: PASS.

- [ ] **Step 3: Refactor imports in `session.service.ts`**

Add to the import section:

```ts
import {
  normalizeWorkflowGraph,
  orderWorkflowNodes,
  type NormalizedWorkflowEdge,
  type NormalizedWorkflowNode,
} from './workflow-executor.js'
```

Delete the local `type NormalizedWorkflowNode`, `type NormalizedWorkflowEdge`, `normalizeWorkflowGraph`, and `orderWorkflowNodes` definitions near the bottom of `session.service.ts`.

- [ ] **Step 4: Run scoped tests**

Run:

```bash
pnpm --filter @spark/agent-runtime exec vitest run src/services/workflow-executor.test.ts src/__tests__/services/session-runtime-config.test.ts
```

Expected: PASS. Existing warning logs from `session-runtime-config.test.ts` are acceptable unless this task adds new failures.

- [ ] **Step 5: Commit**

```bash
git add packages/agent-runtime/src/services/session.service.ts \
        packages/agent-runtime/src/services/workflow-executor.test.ts
git commit -m "refactor(orchestration): share workflow graph helpers"
```

## Self-Review

- Spec coverage: This plan covers the M4 foundation only: graph normalization, topo ordering, agent worker discovery, and upstream state input projection. It intentionally does not claim full M4 completion.
- Placeholder scan: No TBD/TODO placeholders are used.
- Type consistency: The exported helper names match the test imports and the planned `session.service.ts` imports.

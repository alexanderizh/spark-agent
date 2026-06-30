# M4D Workflow Conditional Edges Implementation Plan

> 状态: [实施中] | 最后核对: 2026-06-30

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a safe, data-only condition subset to workflow edges so explicit `agent` nodes can be skipped when their incoming edge conditions do not match workflow state.

**Architecture:** Extend the protocol edge shape with an optional JSON condition object, normalize it in `workflow-executor.ts`, and evaluate conditions only against workflow state. M4D intentionally avoids arbitrary expressions, code execution, UI editing, persistence, and parallel branch semantics.

**Tech Stack:** TypeScript, Vitest, GitNexus impact/detect gates.

---

## Scope Boundaries

- Included: optional edge condition schema, condition normalization, safe condition evaluation, conditional input projection, and skip-on-inactive-incoming-edge behavior for explicit `agent` nodes.
- Deferred: UI authoring controls for conditions, OR/merge semantics for complex branch joins, parallel dispatch, persistence/resume, audit events, and non-agent node execution.
- Supported condition operations:
  - `{ op: 'exists', key: 'foo' }`
  - `{ op: 'equals', key: 'foo', value: 'bar' }`
  - `{ op: 'not_equals', key: 'foo', value: 'bar' }`
  - `{ op: 'truthy', key: 'foo' }`
  - `{ op: 'falsy', key: 'foo' }`

### Task 1: Protocol and Normalization

**Files:**
- Modify: `packages/protocol/src/ipc/index.ts`
- Modify: `packages/agent-runtime/src/services/workflow-executor.ts`
- Test: `packages/agent-runtime/src/services/workflow-executor.test.ts`

- [ ] **Step 1: Write failing normalization test**

Add a test asserting `normalizeWorkflowGraph` preserves valid conditions and drops invalid condition objects:

```ts
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
```

- [ ] **Step 2: Run executor tests and verify RED**

Run:

```bash
cd packages/agent-runtime
pnpm exec vitest run src/services/workflow-executor.test.ts
```

Expected: FAIL because normalized edges do not retain `condition`.

- [ ] **Step 3: Add protocol and normalized condition types**

In `packages/protocol/src/ipc/index.ts`, add `WorkflowEdgeCondition` and optional `condition?: WorkflowEdgeCondition` to `WorkflowEdge`.

In `workflow-executor.ts`, import `WorkflowEdgeCondition`, add it to `NormalizedWorkflowEdge`, and normalize only the five supported operations. Condition `value` must be limited to `string | number | boolean | null`.

- [ ] **Step 4: Run executor tests and verify GREEN**

Run the Task 1 command.

### Task 2: Condition Evaluation During Agent Execution

**Files:**
- Modify: `packages/agent-runtime/src/services/workflow-executor.ts`
- Test: `packages/agent-runtime/src/services/workflow-executor.test.ts`

- [ ] **Step 1: Write failing execution tests**

Add tests showing:
- an agent behind a false conditional edge is not dispatched;
- a true conditional edge allows dispatch and passes upstream `outputKey` input;
- descendants of a skipped agent are also skipped through normal dependency checks.

- [ ] **Step 2: Run executor tests and verify RED**

Run the Task 1 command. Expected: FAIL because conditions are not evaluated.

- [ ] **Step 3: Implement condition evaluation**

Add exported helpers:

```ts
export function evaluateWorkflowEdgeCondition(condition: WorkflowEdgeCondition | undefined, state: WorkflowState): boolean
export function isWorkflowNodeReady(nodeId: string, graph: NormalizedWorkflowGraph, state: WorkflowState, completedNodeIds: ReadonlySet<string>): boolean
```

In `executeWorkflowAgentPlan`, skip an eligible agent node unless `isWorkflowNodeReady(...)` is true. Mark completed agent nodes in a local `completedNodeIds` set after successful completion.

- [ ] **Step 4: Run scoped tests**

Run:

```bash
cd packages/agent-runtime
pnpm exec vitest run src/services/workflow-executor.test.ts src/__tests__/services/session-runtime-config.test.ts
```

Expected: all tests pass.

## Self-Review

- Spec coverage: covers the safe condition subset only.
- Placeholder scan: no placeholder implementation steps.
- Type consistency: protocol `WorkflowEdgeCondition` and runtime `NormalizedWorkflowEdge.condition` match.

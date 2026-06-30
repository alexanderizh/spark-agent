# M4B Workflow Agent Dispatch Implementation Plan

> 状态: [实施中] | 最后核对: 2026-06-30

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Execute a workflow's explicitly bound `agent` nodes through `TeamDispatchService` in topological order and pass completed node output through `outputKey` state.

**Architecture:** Add a deterministic async executor to `workflow-executor.ts` with an injected dispatch callback. Expose that executor through a `workflow_run` tool on the existing in-process `spark_team` MCP server whenever the managed agent's workflow resolves at least one enabled agent worker; the existing team-only path remains unchanged.

**Tech Stack:** TypeScript, Vitest, Claude Agent SDK in-process MCP, `TeamDispatchService`.

---

## Scope Boundaries

- Included: sequential topological execution, explicit `config.agentId`, dispatch through the existing service, `outputKey` state writes, downstream `inputs`, workflow-only and team-only runtime injection.
- Deferred to M4C+: subagent nodes, retries, parallel branches, conditions, persistence/resume, node model override, atomic non-agent node execution.
- A workflow with no enabled explicit agent worker keeps the current flattened-prompt fallback and receives no host tool restriction.

### Task 1: Deterministic Agent-Node Executor

**Files:**
- Modify: `packages/agent-runtime/src/services/workflow-executor.ts`
- Test: `packages/agent-runtime/src/services/workflow-executor.test.ts`

- [ ] **Step 1: Write failing executor tests**

Add tests that call `executeWorkflowAgentPlan` with a fake dispatch callback and assert:

```ts
const result = await executeWorkflowAgentPlan({
  graph: normalizeWorkflowGraph({
    nodes: [
      { id: 'research', kind: 'agent', title: 'Research', config: { agentId: 'researcher', prompt: 'Find facts', outputKey: 'facts' } },
      { id: 'write', kind: 'agent', title: 'Write', config: { agentId: 'writer', prompt: 'Write draft', outputKey: 'draft' } },
    ],
    edges: [{ id: 'e1', from: 'research', to: 'write' }],
  }),
  objective: 'Prepare a release note',
  dispatch: async (request) => ({ content: request.agentId === 'researcher' ? 'verified facts' : 'final draft' }),
})

expect(result.executions.map((item) => item.agentId)).toEqual(['researcher', 'writer'])
expect(result.executions[1]?.inputs).toEqual({ facts: 'verified facts' })
expect(result.state).toEqual({ facts: 'verified facts', draft: 'final draft' })
```

Also assert that non-agent nodes and agent nodes without a nonblank `agentId` are skipped, and a node without `outputKey` does not write state.

- [ ] **Step 2: Run the tests and verify RED**

Run:

```bash
cd packages/agent-runtime
pnpm exec vitest run src/services/workflow-executor.test.ts
```

Expected: FAIL because `executeWorkflowAgentPlan` is not exported.

- [ ] **Step 3: Implement the minimal executor**

Add exported request/result types and `executeWorkflowAgentPlan`. It must use `orderWorkflowNodes`, `buildWorkflowNodeInputs`, and this dispatch request shape:

```ts
export type WorkflowAgentDispatchRequest = {
  nodeId: string
  agentId: string
  instruction: string
  inputs: Record<string, unknown>
}

export async function executeWorkflowAgentPlan(input: {
  graph: NormalizedWorkflowGraph
  objective: string
  initialState?: WorkflowState
  dispatch: (request: WorkflowAgentDispatchRequest) => Promise<{ content: string }>
}): Promise<{
  state: WorkflowState
  executions: Array<WorkflowAgentDispatchRequest & { content: string }>
}> {
  // Iterate ordered explicit agent nodes, dispatch, and project outputKey into state.
}
```

Instruction composition is deterministic: node `config.prompt` when nonblank, otherwise node title; append a `[Workflow objective]` section when the objective is nonblank.

- [ ] **Step 4: Run the helper tests and verify GREEN**

Run the Task 1 command. Expected: all workflow-executor tests pass.

- [ ] **Step 5: Commit Task 1**

```bash
git add packages/agent-runtime/src/services/workflow-executor.ts packages/agent-runtime/src/services/workflow-executor.test.ts
git commit -m "feat(orchestration): execute workflow agent node plans"
```

### Task 2: Runtime MCP Integration

**Files:**
- Modify: `packages/agent-runtime/src/services/session.service.ts`
- Modify: `packages/agent-runtime/src/__tests__/services/session-runtime-config.test.ts`
- Test: `packages/agent-runtime/src/services/workflow-executor.test.ts`

- [ ] **Step 1: Write a failing runtime injection test**

Extend the storage mock with `WorkflowRepository`, add a workflow map to `mockState`, and seed a managed host whose workflow contains an enabled explicit worker. After `sendTurn`, assert the SDK config contains `mcpServers.spark_team`, its tools contain `workflow_run`, and host `disallowedTools` contains the existing orchestrator restrictions. Add a sibling test showing a workflow whose `agentId` is missing/disabled gets no MCP server and no new restrictions.

- [ ] **Step 2: Run the runtime test and verify RED**

Run:

```bash
cd packages/agent-runtime
pnpm exec vitest run src/__tests__/services/session-runtime-config.test.ts
```

Expected: FAIL because workflow workers do not currently create an MCP server or `workflow_run` tool.

- [ ] **Step 3: Wire workflow workers into `createTeamMcpServer`**

In `startTurn`, normalize the managed workflow, collect explicit worker IDs, resolve only enabled agents, and create the in-process server when either enabled team members or enabled workflow workers exist. Preserve the real team roster prompt and use a synthetic non-nesting `TeamModeConfig` only for a workflow-only session.

Extend `createTeamMcpServer` context with optional normalized workflow data and allowed workflow worker IDs. Add `workflow_run` only when workflow data is present. Its handler calls `executeWorkflowAgentPlan`; each injected dispatch callback builds a `TeamA2ATask`, calls the existing `runSingleDispatch`, requires a completed reply, and returns `reply.content`. Pass `allowedWorkerIds` into `TeamDispatchService.run` so workflow-bound agents need not belong to the team roster.

Update `buildWorkflowSystemPrompt` to tell the host to call `mcp__spark_team__workflow_run` exactly once with the current user objective for this M4B path. Keep the existing rendered node list for auditability.

- [ ] **Step 4: Run scoped regression tests**

Run:

```bash
cd packages/agent-runtime
pnpm exec vitest run \
  src/services/workflow-executor.test.ts \
  src/__tests__/services/session-runtime-config.test.ts \
  src/services/team-dispatch.service.test.ts \
  src/services/team-roster-prompt.test.ts
```

Expected: all tests pass; existing non-fatal storage mock warnings are acceptable.

- [ ] **Step 5: Commit Task 2**

```bash
git add packages/agent-runtime/src/services/session.service.ts \
  packages/agent-runtime/src/__tests__/services/session-runtime-config.test.ts
git commit -m "feat(orchestration): dispatch workflow agent nodes"
```

## Self-Review

- Spec coverage: covers M4B's explicit-agent happy path, true dispatch, topological order, and `outputKey` state; all broader M4 features are explicitly deferred.
- Placeholder scan: no TBD/TODO implementation placeholders.
- Type consistency: executor dispatch requests map directly to `TeamA2ATask` fields (`memberAgentId`, `instruction`, `inputs`) at the runtime boundary.

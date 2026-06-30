# M4C Workflow Retry and Failure Semantics Implementation Plan

> 状态: [实施中] | 最后核对: 2026-06-30

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make explicit workflow `agent` execution honor per-node `config.retryCount` and return structured failure results instead of losing workflow context through an uncaught tool exception.

**Architecture:** Keep retry and failure semantics in `workflow-executor.ts` first, where they are deterministic and easy to test. Then adapt `session.service.ts`'s `workflow_run` tool to translate `TeamA2AReply` failures into executor failure records and user-readable MCP output. This keeps M4C narrowly scoped and leaves parallelism, conditions, resume persistence, subagent nodes, and node-level model switching for later M4 slices.

**Tech Stack:** TypeScript, Vitest, Claude Agent SDK in-process MCP, existing `TeamDispatchService`.

---

## Scope Boundaries

- Included: per-agent-node `retryCount`, attempt numbering in execution records, stop-on-failed-node semantics, structured error details, and `workflow_run` MCP response text for failed workflow runs.
- Not included in this slice: retry backoff, retry events, parallel branches, condition evaluation, workflow-run storage, resume, subagent temporary workers, node-level model/provider overrides, or non-agent atomic nodes.
- `retryCount` means additional attempts after the first attempt. `retryCount: 2` allows at most 3 total dispatch attempts for that node.
- Invalid retry values are clamped: non-number, negative, non-finite, or fractional values become `0`; values above `3` become `3` for this M4C safety slice.

### Task 1: Deterministic Executor Retry and Failure Result

**Files:**
- Modify: `packages/agent-runtime/src/services/workflow-executor.ts`
- Test: `packages/agent-runtime/src/services/workflow-executor.test.ts`

- [ ] **Step 1: Write failing executor tests**

Add tests under `describe('executeWorkflowAgentPlan', ...)`:

```ts
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
```

Update the two existing happy-path tests to expect `status: 'completed'`, `state`, and executions with `attempt: 1` and `state: 'completed'`.

- [ ] **Step 2: Run executor tests and verify RED**

Run:

```bash
cd packages/agent-runtime
pnpm exec vitest run src/services/workflow-executor.test.ts
```

Expected: FAIL because `executeWorkflowAgentPlan` still returns only `{ state, executions }`, dispatch replies only accept `{ content }`, and execution records have no attempt/state fields.

- [ ] **Step 3: Implement minimal executor retry/failure types**

In `workflow-executor.ts`, add these exported types near `WorkflowAgentDispatchRequest`:

```ts
export type WorkflowAgentDispatchReply =
  | { state?: 'completed'; content: string }
  | { state: 'failed' | 'canceled'; content: string; error?: { code?: string; message: string } }

export type WorkflowAgentExecutionRecord = WorkflowAgentDispatchRequest & {
  attempt: number
  state: 'completed' | 'failed' | 'canceled'
  content: string
  error?: { code?: string; message: string }
}

export type WorkflowAgentPlanResult = {
  status: 'completed' | 'failed' | 'canceled'
  state: WorkflowState
  executions: WorkflowAgentExecutionRecord[]
  failedNode?: {
    nodeId: string
    agentId: string
    attempt: number
    error: { code?: string; message: string }
  }
}
```

Change `executeWorkflowAgentPlan` to use:

```ts
dispatch: (request: WorkflowAgentDispatchRequest) => Promise<WorkflowAgentDispatchReply>
```

For each eligible agent node:
- calculate `maxAttempts = 1 + getWorkflowNodeRetryCount(node)`;
- dispatch the same request with `attempt` recorded per result;
- treat missing `reply.state` as `'completed'` for M4B compatibility;
- write `outputKey` only for completed replies;
- stop immediately on the last failed/canceled attempt and return `status` plus `failedNode`;
- continue to the next node only after a completed reply.

Add a private helper:

```ts
function getWorkflowNodeRetryCount(node: NormalizedWorkflowNode): number {
  const raw = node.config.retryCount
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return 0
  return Math.max(0, Math.min(3, Math.floor(raw)))
}
```

- [ ] **Step 4: Run executor tests and verify GREEN**

Run the Task 1 test command. Expected: all workflow-executor tests pass.

- [ ] **Step 5: Commit Task 1**

```bash
git add packages/agent-runtime/src/services/workflow-executor.ts packages/agent-runtime/src/services/workflow-executor.test.ts
git commit --only packages/agent-runtime/src/services/workflow-executor.ts packages/agent-runtime/src/services/workflow-executor.test.ts -m "feat(orchestration): add workflow agent retry results"
```

### Task 2: Runtime workflow_run Failure Response

**Files:**
- Modify: `packages/agent-runtime/src/services/session.service.ts`
- Modify: `packages/agent-runtime/src/__tests__/services/session-runtime-config.test.ts`
- Test: `packages/agent-runtime/src/services/workflow-executor.test.ts`

- [ ] **Step 1: Write failing runtime response test**

Extend the mocked SDK MCP server test coverage by invoking the `workflow_run` tool handler directly. In `session-runtime-config.test.ts`, add a test after the workflow_run exposure tests:

```ts
  it('returns a structured failed workflow_run result when a workflow worker fails', async () => {
    mockState.agents.set('workflow-host', makeAgent({
      id: 'workflow-host',
      name: 'Workflow Host',
      providerProfileId: 'tencent-provider',
      workflowId: 'workflow-fail',
    }))
    mockState.agents.set('workflow-worker', makeAgent({
      id: 'workflow-worker',
      name: 'Workflow Worker',
      providerProfileId: 'tencent-provider',
    }))
    mockState.workflows.set('workflow-fail', {
      id: 'workflow-fail',
      name: 'Failing workflow',
      description: 'Exercise failed worker responses.',
      graph: {
        nodes: [{
          id: 'work',
          kind: 'agent',
          title: 'Do the work',
          config: { agentId: 'workflow-worker', retryCount: 1, outputKey: 'result' },
        }],
        edges: [],
      },
    })
    const service = new SessionService({} as never, (event) => events.push(event))
    const { sessionId } = await service.createSession({
      providerProfileId: 'tencent-provider',
      agentId: 'workflow-host',
      agentAdapter: 'claude-sdk',
      permissionMode: 'claude-plan',
      title: 'Workflow failure session',
    })

    await service.sendTurn({ sessionId, message: 'run the workflow' })

    await vi.waitFor(() => {
      expect(mockState.sdkConfigs).toHaveLength(1)
    })
    const tool = ((mockState.sdkConfigs[0]?.mcpServers as {
      spark_team: { instance: { tools: Array<{ name: string; handler: (args: Record<string, unknown>) => Promise<{ content: Array<{ text: string }>; structuredContent: unknown }> }> } }
    }).spark_team.instance.tools).find((item) => item.name === 'workflow_run')
    if (tool == null) throw new Error('expected workflow_run tool')

    const response = await tool.handler({ objective: 'attempt failed workflow' })

    expect(response.content[0]?.text).toContain('Workflow failed at node work after 2 attempt(s)')
    expect(response.structuredContent).toMatchObject({
      status: 'failed',
      failedNode: {
        nodeId: 'work',
        agentId: 'workflow-worker',
        attempt: 2,
      },
    })
  })
```

Use the test harness' existing `runClaudeSdkTurn` mock behavior to force member output into a failed reply if an existing hook is available. If the harness cannot force a member failure without broad changes, add a narrow mock hook to the fake SDK executor state such as `nextSdkTurnError?: Error` and consume it only in the mocked executor callback.

- [ ] **Step 2: Run runtime test and verify RED**

Run:

```bash
cd packages/agent-runtime
pnpm exec vitest run src/__tests__/services/session-runtime-config.test.ts
```

Expected: FAIL because `workflow_run` currently throws on a failed worker reply and does not return a structured failed result.

- [ ] **Step 3: Convert worker replies into executor replies and format failed workflow output**

In `session.service.ts`'s `workflow_run` handler:

```ts
const reply = await runSingleDispatch(...)
if (reply.state !== 'completed') {
  return {
    state: reply.state,
    content: reply.content,
    error: {
      code: reply.error?.code,
      message: reply.error?.message ?? `Workflow worker ${request.agentId} did not complete successfully.`,
    },
  }
}
return { state: 'completed', content: reply.content }
```

After `executeWorkflowAgentPlan`, return text based on `result.status`:

```ts
const text = result.status === 'completed'
  ? `Workflow completed ${result.executions.length} agent node attempt(s). Final state: ${JSON.stringify(result.state)}`
  : `Workflow ${result.status} at node ${result.failedNode?.nodeId ?? 'unknown'} after ${result.failedNode?.attempt ?? 0} attempt(s). Error: ${result.failedNode?.error.message ?? 'Unknown error'}. Final state: ${JSON.stringify(result.state)}`
```

Keep `structuredContent: result as unknown`.

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
git commit --only packages/agent-runtime/src/services/session.service.ts packages/agent-runtime/src/__tests__/services/session-runtime-config.test.ts -m "feat(orchestration): return workflow run failures"
```

## Self-Review

- Spec coverage: covers M4C's retry/failure slice for explicit `agent` nodes without expanding into parallel, conditions, resume, or subagent execution.
- Placeholder scan: no placeholder implementation steps; each task includes concrete tests, commands, and expected behavior.
- Type consistency: executor dispatch replies, execution records, and runtime MCP structuredContent all use `status`, `executions`, `state`, and `failedNode`.

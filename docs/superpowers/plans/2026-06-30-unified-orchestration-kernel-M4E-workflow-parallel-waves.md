# M4E Workflow Parallel Agent Waves Implementation Plan

> 状态: [已落地] | 最后核对: 2026-06-30

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Execute independent ready workflow `agent` nodes concurrently while preserving dependency ordering, retry/failure semantics, and existing sequential behavior for dependent nodes.

**Architecture:** Keep the scheduler in `workflow-executor.ts` as the source of truth. The executor forms waves of ready `agent` nodes, dispatches same-wave nodes concurrently, marks completed outputs after the wave settles, and stops on the first failed/canceled node in topological order. `session.service.ts` only forwards an executor-provided `parallel` hint into the existing team dispatch path so parallel waves can bypass the per-turn serial queue.

**Tech Stack:** TypeScript, Vitest, GitNexus impact/detect gates.

---

## Scope Boundaries

- Included: parallel execution of independent ready `agent` nodes, dependency-safe wave scheduling, `parallel` dispatch hint, and focused runtime handoff into `workflow_run`.
- Preserved: dependent nodes stay ordered; retries still happen per node; failed/canceled workflow still returns structured failure.
- Deferred: subagent temporary workers, atomic non-agent node execution, checkpoint persistence/resume, complex join policies, UI controls for per-workflow parallelism.

### Task 1: Executor Wave Scheduling

**Files:**
- Modify: `packages/agent-runtime/src/services/workflow-executor.ts`
- Test: `packages/agent-runtime/src/services/workflow-executor.test.ts`

- [x] **Step 1: Write failing parallel wave test**

Add a test proving two independent ready `agent` nodes are dispatched before either is resolved, then their downstream join node runs after both outputs are available.

- [x] **Step 2: Run executor tests and verify RED**

Run:

```bash
cd packages/agent-runtime
pnpm exec vitest run src/services/workflow-executor.test.ts
```

Expected: FAIL because the current executor dispatches one node at a time.

- [x] **Step 3: Implement wave scheduler**

Refactor `executeWorkflowAgentPlan` to maintain pending eligible agent nodes, find all currently ready nodes, execute each ready wave concurrently, and mark completions after the wave settles. Preserve existing retry and failed/canceled result shape.

- [x] **Step 4: Run executor tests and verify GREEN**

Run the Task 1 command.

### Task 2: Runtime Parallel Dispatch Hint

**Files:**
- Modify: `packages/agent-runtime/src/services/session.service.ts`
- Test: `packages/agent-runtime/src/__tests__/services/session-runtime-config.test.ts`

- [x] **Step 1: Extend dispatch callback shape**

Allow executor dispatch calls to include `{ parallel?: boolean }`.

- [x] **Step 2: Forward the hint from `workflow_run`**

In `createTeamMcpServer`, pass `options.parallel === true` into the existing `runSingleDispatch(..., parallel)` helper.

- [x] **Step 3: Run scoped tests**

Run:

```bash
cd packages/agent-runtime
pnpm exec vitest run src/services/workflow-executor.test.ts src/__tests__/services/session-runtime-config.test.ts
```

Expected: all tests pass.

## Self-Review

- Spec coverage: covers M4 parallel branch execution for explicit `agent` nodes only.
- Hotspot control: `session.service.ts` change is limited to the `workflow_run` dispatch callback.
- Backward compatibility: callers that ignore the optional dispatch options keep current behavior.

## Verification

- 2026-06-30: `pnpm exec vitest run src/services/workflow-executor.test.ts` -> 13 tests passed.
- 2026-06-30: `pnpm exec vitest run src/services/workflow-executor.test.ts src/__tests__/services/session-runtime-config.test.ts` -> 28 tests passed.

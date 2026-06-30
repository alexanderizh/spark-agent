# M4I Workflow Verify Runtime Implementation Plan

> 状态: [已落地] | 最后核对: 2026-06-30

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire `verify` atomic workflow nodes to runtime command execution through `workflow_run`, so configured `verifyCommands` produce structured completion or failure results.

**Architecture:** Keep command execution out of the pure executor. `workflow-executor.ts` exposes an `executeAtomicNode` hook; `session.service.ts` supplies a runtime implementation for `verify` nodes only. Other atomic nodes keep the safe default executor behavior.

**Tech Stack:** TypeScript, Vitest, GitNexus impact/detect gates.

---

## Scope Boundaries

- Included: runtime execution of `verify` node `config.verifyCommands`, command output aggregation, and failed workflow result when a command exits non-zero.
- Preserved: host SDK tool restrictions still apply; verify commands are run by the trusted runtime because the workflow explicitly configured them.
- Deferred: interactive approvals before verify commands, UI progress streaming for individual verify commands, persistent workflow-run resume.

### Task 1: Runtime Verify Test

**Files:**
- Test: `packages/agent-runtime/src/__tests__/services/session-runtime-config.test.ts`

- [x] **Step 1: Write failing test**

Add a test that invokes `workflow_run` for a workflow containing a `verify` node with `verifyCommands`, then asserts `structuredContent.atomicExecutions` contains the command output.

- [x] **Step 2: Run test and verify RED**

Run:

```bash
cd packages/agent-runtime
pnpm exec vitest run src/__tests__/services/session-runtime-config.test.ts
```

Expected: FAIL because `workflow_run` currently does not pass an atomic runtime hook.

### Task 2: Runtime Hook

**Files:**
- Modify: `packages/agent-runtime/src/services/session.service.ts`

- [x] **Step 1: Implement verify command runner**

Add a small helper that runs each configured command in the workflow workspace root, captures stdout/stderr, returns completed content when all commands pass, and returns failed content/error on the first failing command.

- [x] **Step 2: Attach hook to `workflow_run`**

Pass `executeAtomicNode` into `executeWorkflowAgentPlan` and handle only `kind === 'verify'`; return default content for other atomic nodes by leaving them to the executor default.

- [x] **Step 3: Run scoped tests**

Run:

```bash
cd packages/agent-runtime
pnpm exec vitest run src/services/workflow-executor.test.ts src/__tests__/services/session-runtime-config.test.ts
```

Expected: all tests pass.

## Self-Review

- Hotspot control: only `workflow_run` runtime hook changes.
- Safety: command execution is scoped to explicit workflow `verifyCommands`.
- Compatibility: workflows without verify commands keep default atomic behavior.

## Verification

- 2026-06-30: `pnpm exec vitest run src/__tests__/services/session-runtime-config.test.ts` -> 18 tests passed.
- 2026-06-30: `pnpm exec vitest run src/services/workflow-executor.test.ts src/__tests__/services/session-runtime-config.test.ts` -> 34 tests passed.

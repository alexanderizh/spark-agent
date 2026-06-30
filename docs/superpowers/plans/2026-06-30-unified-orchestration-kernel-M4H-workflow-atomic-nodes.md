# M4H Workflow Atomic Nodes Implementation Plan

> 状态: [已落地] | 最后核对: 2026-06-30

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make non-worker workflow nodes participate in execution instead of being silently ignored, so `input`, `verify`, `review`, `artifact`, `plan`, `skill`, `tool`, `mcp`, and `approval` nodes can gate downstream workers and project `outputKey` state.

**Architecture:** Extend the pure workflow scheduler to keep a pending set for all nodes. Dispatchable `agent`/`subagent` nodes still use the existing worker dispatch path. Atomic nodes complete through an injected `executeAtomicNode` hook, with safe default content for simple nodes. Downstream nodes wait for every upstream node, not just worker nodes.

**Tech Stack:** TypeScript, Vitest, GitNexus impact/detect gates.

---

## Scope Boundaries

- Included: atomic node completion records, dependency gating through atomic nodes, `outputKey` state projection, and injected hook support for `verify`/future runtime implementations.
- Preserved: existing worker dispatch behavior, retry/failure result shape, conditional edge evaluation, and parallel worker waves.
- Deferred: rich implementations for tool/mcp/approval UI workflows, persistent workflow-run resume, and full shell-command verification runtime.

### Task 1: Executor Atomic Scheduling

**Files:**
- Modify: `packages/agent-runtime/src/services/workflow-executor.ts`
- Test: `packages/agent-runtime/src/services/workflow-executor.test.ts`

- [x] **Step 1: Write failing tests**

Add tests proving:
- an `input` atomic node with `outputKey` projects state into a downstream worker input;
- a failed `verify` atomic hook stops the workflow with `failedNode`.

- [x] **Step 2: Run executor tests and verify RED**

Run:

```bash
cd packages/agent-runtime
pnpm exec vitest run src/services/workflow-executor.test.ts
```

- [x] **Step 3: Implement atomic scheduling**

Track all pending nodes, execute ready atomic nodes through `executeAtomicNode`, mark them completed, and require every upstream node to be completed before downstream execution. Preserve existing dispatchable worker wave behavior.

- [x] **Step 4: Run scoped tests**

Run:

```bash
cd packages/agent-runtime
pnpm exec vitest run src/services/workflow-executor.test.ts src/__tests__/services/session-runtime-config.test.ts
```

Expected: all tests pass.

## Self-Review

- Hotspot control: first cut is pure executor only.
- Compatibility: existing workflows without atomic dependencies still run.
- Safety: default atomic execution does not run shell commands or external tools.

## Verification

- 2026-06-30: `pnpm exec vitest run src/services/workflow-executor.test.ts` -> 16 tests passed.
- 2026-06-30: `pnpm exec vitest run src/services/workflow-executor.test.ts src/__tests__/services/session-runtime-config.test.ts` -> 33 tests passed.

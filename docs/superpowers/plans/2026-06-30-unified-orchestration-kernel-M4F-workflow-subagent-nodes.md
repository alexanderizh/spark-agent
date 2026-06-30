# M4F Workflow Subagent Nodes Implementation Plan

> 状态: [已落地] | 最后核对: 2026-06-30

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow workflow `subagent` nodes to run as temporary workers derived from node config, without requiring a persisted Agent record.

**Architecture:** Treat `agent` and `subagent` nodes as dispatchable workflow worker nodes in the pure executor. At runtime, keep persisted `agent` nodes resolved through `AgentRepository`, and synthesize temporary `AgentItem` objects for `subagent` nodes so the existing `TeamDispatchService` and `executeMemberTurn` path remains the only dispatch engine.

**Tech Stack:** TypeScript, Vitest, GitNexus impact/detect gates.

---

## Scope Boundaries

- Included: executor support for `subagent` nodes, deterministic temporary worker ids, runtime synthesis of enabled temporary workflow members, and scoped tests.
- Preserved: persisted `agent` node behavior and fallback flattened workflow prompt when no executable workers exist.
- Deferred: UI authoring for subagent config, persistent subagent registry, checkpointing, node-level model override enforcement beyond fields already present on `AgentItem`.

### Task 1: Executor Dispatchability

**Files:**
- Modify: `packages/agent-runtime/src/services/workflow-executor.ts`
- Test: `packages/agent-runtime/src/services/workflow-executor.test.ts`

- [x] **Step 1: Write failing tests**

Add tests proving:
- `getWorkflowAgentWorkerIds` includes deterministic ids for `subagent` nodes;
- `executeWorkflowAgentPlan` dispatches `subagent` nodes and passes their outputs downstream.

- [x] **Step 2: Run executor tests and verify RED**

Run:

```bash
cd packages/agent-runtime
pnpm exec vitest run src/services/workflow-executor.test.ts
```

- [x] **Step 3: Implement dispatchable worker helpers**

Add helper logic that returns a worker id for `agent` nodes from `config.agentId`, and for `subagent` nodes from `config.agentId` or deterministic `workflow-subagent:${node.id}`. Reuse it in worker id collection and execution.

- [x] **Step 4: Run executor tests and verify GREEN**

Run the Task 1 command.

### Task 2: Runtime Temporary Members

**Files:**
- Modify: `packages/agent-runtime/src/services/session.service.ts`
- Test: `packages/agent-runtime/src/__tests__/services/session-runtime-config.test.ts`

- [x] **Step 1: Write failing runtime test**

Add a test proving a managed workflow with only an enabled `subagent` node exposes `workflow_run` instead of falling back to flattened prompt.

- [x] **Step 2: Synthesize temporary `AgentItem` members**

When resolving managed workflow workers, include deterministic temporary members for `subagent` nodes, carrying config fields such as `prompt`, `role`, `modelId`, `providerProfileId`, `permissionMode`, `skillIds`, `disabledSkillIds`, `mcpServerIds`, and `ruleIds`.

- [x] **Step 3: Run scoped tests**

Run:

```bash
cd packages/agent-runtime
pnpm exec vitest run src/services/workflow-executor.test.ts src/__tests__/services/session-runtime-config.test.ts
```

Expected: all tests pass.

## Self-Review

- Hotspot control: `session.service.ts` changes are limited to workflow worker/member resolution.
- Backward compatibility: persisted `agent` nodes keep using stored Agent records.
- Safety: temporary workers are enabled only for the current workflow turn and are not persisted.

## Verification

- 2026-06-30: `pnpm exec vitest run src/services/workflow-executor.test.ts` -> 14 tests passed.
- 2026-06-30: `pnpm exec vitest run src/services/workflow-executor.test.ts src/__tests__/services/session-runtime-config.test.ts` -> 30 tests passed.

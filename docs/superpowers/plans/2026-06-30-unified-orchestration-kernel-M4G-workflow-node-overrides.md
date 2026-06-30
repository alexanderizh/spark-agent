# M4G Workflow Node Runtime Overrides Implementation Plan

> 状态: [已落地] | 最后核对: 2026-06-30

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Honor workflow node-level runtime overrides for dispatchable `agent` nodes so a workflow can select provider, model, permission, tools, skills, MCP servers, rules, and prompt for that node without mutating the persisted Agent record.

**Architecture:** Reuse the existing `AgentItem` execution path. During workflow member resolution, overlay safe node config fields onto a cloned persisted `AgentItem` for that workflow turn only. `subagent` nodes already synthesize temporary `AgentItem` objects and remain compatible with the same override semantics.

**Tech Stack:** TypeScript, Vitest, GitNexus impact/detect gates.

---

## Scope Boundaries

- Included: node-level overrides for `agent` nodes: `prompt`, `role`, `modelId`, `providerProfileId`, `agentAdapter`, `permissionMode`, `reasoningEffort`, `skillIds`, `disabledSkillIds`, `mcpServerIds`, and `ruleIds`.
- Preserved: persisted Agent records are not updated; team-mode members outside workflow keep their stored config.
- Deferred: UI editing affordances, per-node provider validation before run, checkpoint persistence/resume.

### Task 1: Runtime Override Test

**Files:**
- Test: `packages/agent-runtime/src/__tests__/services/session-runtime-config.test.ts`

- [x] **Step 1: Write failing test**

Add a test that invokes `workflow_run` for an `agent` node whose persisted worker has one model/permission/prompt while node config overrides those fields. Assert the member SDK config uses the node override values and includes node prompt text.

- [x] **Step 2: Run test and verify RED**

Run:

```bash
cd packages/agent-runtime
pnpm exec vitest run src/__tests__/services/session-runtime-config.test.ts
```

Expected: FAIL because persisted Agent config currently wins.

### Task 2: Overlay Node Config

**Files:**
- Modify: `packages/agent-runtime/src/services/session.service.ts`

- [x] **Step 1: Implement workflow member override overlay**

When resolving workflow members for persisted `agent` nodes, clone the resolved member and overlay safe node config fields for the current workflow turn.

- [x] **Step 2: Run scoped tests**

Run:

```bash
cd packages/agent-runtime
pnpm exec vitest run src/services/workflow-executor.test.ts src/__tests__/services/session-runtime-config.test.ts
```

Expected: all tests pass.

## Self-Review

- Hotspot control: only workflow member resolution changes.
- Data safety: no persisted Agent rows are mutated.
- Compatibility: workflow nodes without overrides preserve current behavior.

## Verification

- 2026-06-30: `pnpm exec vitest run src/__tests__/services/session-runtime-config.test.ts` -> 17 tests passed.
- 2026-06-30: `pnpm exec vitest run src/services/workflow-executor.test.ts src/__tests__/services/session-runtime-config.test.ts` -> 31 tests passed.

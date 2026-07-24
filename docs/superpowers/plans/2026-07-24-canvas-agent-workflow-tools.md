# Canvas Agent Workflow Tools Implementation Plan

> 状态: 实施中 | 最后核对: 2026-07-24
> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 将无限画布工作流的查询、CRUD、选区提取、展开、运行和运行控制接入画布 Agent 的现有 `spark_canvas` 工具桥。

**Architecture:** 新增独立的 `canvasWorkflowAgentTools.ts`，只负责工作流工具描述、参数校验和调用现有 `canvasWorkflowApi`/画布 actions；`canvas.tools.ts` 只合并工具注册表。`CanvasWorkspaceView` 仅把已有的工作流运行闭包暴露给 Agent，物化继续复用 store 的 `materializeWorkflow`，不新增 UI 或来源绑定。

**Tech Stack:** React renderer, TypeScript, Vitest, `@spark/protocol`, existing canvas workflow IPC/API/runtime.

---

### Task 1: Define the Agent workflow tool contract

**Files:**
- Create: `apps/desktop/src/renderer/design/views/canvas/canvasWorkflowAgentTools.ts`
- Test: `apps/desktop/src/renderer/design/views/canvas/canvasWorkflowAgentTools.test.ts`
- Modify: `apps/desktop/src/renderer/design/views/canvas/canvas.tools.ts`

- [x] Write failing tests for tool schemas, read-only list/get, confirmation responses for delete/apply/run, and scope separation from app workflows.
- [x] Run `pnpm --filter @spark/desktop exec vitest run src/renderer/design/views/canvas/canvasWorkflowAgentTools.test.ts` and observe the missing-module failure.
- [x] Implement descriptors for `canvas_workflow_list`, `get`, `create`, `update`, `extract_selection`, `delete`, `apply`, `run`, `run_list`, `run_get`, `cancel`, `retry`, and `resume`. Return a structured confirmation object unless `confirmed === true` for destructive or executable actions.
- [x] Append the descriptors to the existing `canvas.tools.ts` registry and add the current-project workflow actions to `CanvasWorkspaceActions`.
- [x] Re-run the focused tests and existing `canvas.tools.test.ts`.

### Task 2: Wire materialization and execution into the current canvas

**Files:**
- Modify: `apps/desktop/src/renderer/design/views/canvas/CanvasWorkspaceView.tsx`
- Modify: `apps/desktop/src/renderer/design/views/canvas/CanvasAgentModal.tsx`
- Create: `apps/desktop/src/renderer/design/views/canvas/canvasAgentMessageContext.ts`
- Test: `apps/desktop/src/renderer/design/views/canvas/canvasAgentMessageContext.test.ts`
- Test: `apps/desktop/src/renderer/design/views/canvas/canvasWorkflowAgentTools.test.ts`

- [x] Add a typed `runCanvasWorkflow` action that delegates to the existing `executeCanvasWorkflow` closure with an `AbortSignal`.
- [x] Pass `materializeWorkflow` and `runCanvasWorkflow` through the existing Agent workspace object without adding controls to the panel.
- [x] Verify confirmed apply returns newly created node ids and confirmed run returns the final `CanvasWorkflowRun` summary.
- [x] Keep output nodes independent after apply: no workflow id/version/provenance is written.
- [x] Include the current canvas selection in Agent messages when no explicit node references were added.

### Task 3: Verify the complete Agent path

**Files:**
- Modify: `docs/superpowers/specs/2026-07-21-canvas-workflow-design.md`
- Modify: `.agents/memory/canvas-workflow-vs-app-workflow.md`

- [x] Add the Agent tool boundary and confirmation semantics to the existing design and memory documents.
- [x] Run desktop focused tests, protocol tests, typecheck, lint, production build, and `git diff --check` without starting another dev/Electron instance. The parallel desktop suite had two unrelated renderer interference failures; both involved files pass when run individually.
- [x] Run `npx gitnexus analyze` after implementation and inspect the updated index status.
- [x] Run `npx gitnexus detect-changes` or the repository equivalent before any future commit; do not push.

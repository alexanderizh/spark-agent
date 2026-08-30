# Canvas Agent Reusable Workflow Graph Implementation Plan

> 状态: 已落地 | 最后核对: 2026-07-25
> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** 为无限画布 Agent 增加可原子创建、自动连线、自动布局并校验输入输出的可复用工作流图能力。

**Architecture:** 新增独立纯函数模块负责语义图规范化、工作流子图校验和 DAG 布局，再由独立 Agent 工具模块把合法蓝图通过现有 `applyTemplate` 落到当前画布。`canvas.tools.ts` 只合并描述符并扩展最小 workspace action，避免继续扩大已很长的 `CanvasWorkspaceView.tsx`。

**Tech Stack:** TypeScript, Vitest, existing Canvas tool registry, `canvasApi.applyTemplate`, Canvas capability contracts.

---

### Task 1: Define reusable graph contracts and validation

**Files:**
- Create: `apps/desktop/src/renderer/design/views/canvas/canvasAgentWorkflowGraph.ts`
- Test: `apps/desktop/src/renderer/design/views/canvas/canvasAgentWorkflowGraph.test.ts`

- [x] **Step 1: Write failing tests for graph semantics**

  Cover duplicate refs, missing endpoints, self edges, cycles, disconnected operation nodes, valid independent `note` nodes, multiple inputs/outputs, and an empty image input placeholder connected to an image operation.

- [x] **Step 2: Run the focused test and verify the missing implementation failure**

  Run: `pnpm --filter @spark/desktop exec vitest run src/renderer/design/views/canvas/canvasAgentWorkflowGraph.test.ts`

- [x] **Step 3: Implement semantic graph types and pure validation**

  Define `CanvasAgentWorkflowNodeSpec`, `CanvasWorkflowGraphDiagnostic`, `validateCanvasAgentWorkflowGraph`, and `buildCanvasAgentWorkflowBlueprint`. Treat `input` and `operation` nodes as flow nodes; allow `note` nodes to remain disconnected. Require every operation node to be reachable from a declared input and able to reach a terminal output operation.

- [x] **Step 4: Run the focused tests and confirm they pass**

  Run the Task 1 Vitest command and expect all graph semantic cases to pass.

### Task 2: Add deterministic DAG layout and placeholder materialization

**Files:**
- Modify: `apps/desktop/src/renderer/design/views/canvas/canvasAgentWorkflowGraph.ts`
- Modify: `apps/desktop/src/renderer/design/views/canvas/canvasAgentWorkflowGraph.test.ts`

- [x] **Step 1: Add failing layout tests**

  Assert input nodes occupy the first layer, outputs the last layer, branches do not overlap, merge nodes follow their deepest dependency, repeated planning is deterministic, and the whole graph moves beyond supplied obstacle rectangles.

- [x] **Step 2: Run the focused test and verify layout assertions fail**

  Run the Task 1 Vitest command.

- [x] **Step 3: Implement layout and typed empty placeholders**

  Use topological depth for horizontal layers and stable ref ordering within layers. Emit `NodeBlueprint` values for empty image/video/audio inputs with placeholder metadata and default media dimensions; preserve prompt/text content and operation configuration. Emit handled `used_as_input` edges from semantic dependencies.

- [x] **Step 4: Run focused tests and confirm semantic and layout suites pass**

  Run the Task 1 Vitest command.

### Task 3: Expose atomic create and read-only validate Agent tools

**Files:**
- Create: `apps/desktop/src/renderer/design/views/canvas/canvasAgentWorkflowGraphTools.ts`
- Create: `apps/desktop/src/renderer/design/views/canvas/canvasAgentWorkflowGraphTools.test.ts`
- Modify: `apps/desktop/src/renderer/design/views/canvas/canvas.tools.ts`

- [x] **Step 1: Write failing tool tests**

  Verify registration and schemas for `canvas_create_reusable_workflow_graph` and `canvas_validate_workflow_graph`; assert invalid graphs never call `applyTemplate`, valid graphs call it once with nodes and edges, and post-create validation returns created ids plus input/output summaries.

- [x] **Step 2: Run tests and verify missing descriptors fail**

  Run: `pnpm --filter @spark/desktop exec vitest run src/renderer/design/views/canvas/canvasAgentWorkflowGraphTools.test.ts src/renderer/design/views/canvas/canvas.tools.test.ts`

- [x] **Step 3: Implement descriptors and minimal workspace action**

  Add `applyTemplate` to `CanvasWorkspaceActions`, build obstacles from current-board nodes, prevalidate and plan the graph, call `workspace.applyTemplate` once, identify newly created nodes by snapshot diff, and postvalidate only that created subgraph. For validate, use explicit node ids or the current selected ids from tool context and return structured diagnostics.

- [x] **Step 4: Prefer the high-level tool in tool descriptions**

  Update relevant low-level create/batch/connect tool descriptions to state that complete reusable workflows should use `canvas_create_reusable_workflow_graph`; low-level tools are for targeted edits.

- [x] **Step 5: Run focused tool and graph tests**

  Run both Task 3 test files plus `canvasWorkflowAgentTools.test.ts` to catch registry regressions.

### Task 4: Wire the existing template action into the Agent host

**Files:**
- Modify: `apps/desktop/src/renderer/design/views/canvas/CanvasWorkspaceView.tsx`
- Modify: `apps/desktop/src/renderer/design/views/canvas/canvas-tool-host.ts`
- Test: `apps/desktop/src/renderer/design/views/canvas/canvasAgentWorkflowGraphTools.test.ts`

- [x] **Step 1: Add a failing host contract assertion**

  Assert the tool context exposes `applyTemplate` and that create returns a real post-mutation snapshot.

- [x] **Step 2: Run the focused test and observe the missing workspace action**

  Run the Task 3 Vitest command.

- [x] **Step 3: Pass the existing store `applyTemplate` action through the workspace object**

  Make only a thin property addition in `CanvasWorkspaceView.tsx`; do not add UI or another workflow panel.

- [x] **Step 4: Re-run focused tests**

  Run the Task 3 Vitest command.

### Task 5: Documentation, regression verification, and index refresh

**Files:**
- Modify: `docs/superpowers/specs/2026-07-24-canvas-agent-workflow-tools-design.md`
- Modify: `.agents/memory/canvas-workflow-vs-app-workflow.md`

- [x] **Step 1: Document the high-level construction and validation tools**

  Record that creation defaults to real canvas nodes, does not auto-save, permits independent notes, and validates only the selected/created workflow subgraph.

- [x] **Step 2: Run focused and broad verification without starting dev/Electron**

  Run focused Vitest files, desktop TypeScript, lint, production build, and `git diff --check`. Do not start another development server because the user already has one running.

- [x] **Step 3: Refresh GitNexus and inspect change scope**

  Run `npx gitnexus analyze`, then `npx gitnexus detect-changes` if supported. If unavailable, use `rg` call-site checks and `git diff --stat` per repository degradation rules.

- [x] **Step 4: Commit without pushing**

  Stage only files belonging to this feature and create a local commit. Do not push.

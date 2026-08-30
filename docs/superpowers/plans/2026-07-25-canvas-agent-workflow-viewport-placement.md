# Canvas Agent Workflow Viewport Placement Implementation Plan

> 状态: 已落地 | 最后核对: 2026-07-25

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Canvas Agent-created workflow graphs prefer free space inside the user's current viewport and automatically focus newly created graphs when they must be placed outside it.

**Architecture:** Add a pure viewport placement module that converts the live React Flow viewport to canvas bounds, scans deterministic in-view candidates, and checks post-creation visibility. Extend the Canvas tool context with live viewport and reveal callbacks, then let the reusable workflow graph tool choose the origin and request UI focus only when needed.

**Tech Stack:** TypeScript, React, React Flow viewport controls, Vitest, existing Canvas MCP tool bridge.

---

### Task 1: Pure Viewport Placement Policy

**Files:**

- Create: `apps/desktop/src/renderer/design/views/canvas/canvasAgentWorkflowViewport.ts`
- Create: `apps/desktop/src/renderer/design/views/canvas/canvasAgentWorkflowViewport.test.ts`

- [x] Write tests proving a graph is placed inside an empty viewport, avoids in-view obstacles, falls back when the graph cannot fit, and reports whether created nodes are fully visible.
- [x] Run `pnpm --filter @spark/desktop exec vitest run src/renderer/design/views/canvas/canvasAgentWorkflowViewport.test.ts` and verify the missing module/functions fail.
- [x] Implement viewport-to-canvas bounds conversion, deterministic candidate scanning, obstacle collision checks, and complete visibility checks.
- [x] Re-run the focused test and verify all viewport policy tests pass.

### Task 2: Canvas Tool Context and UI Reveal Bridge

**Files:**

- Modify: `apps/desktop/src/renderer/design/views/canvas/canvas.tools.ts`
- Modify: `apps/desktop/src/renderer/design/views/canvas/canvas-tool-host.ts`
- Modify: `apps/desktop/src/renderer/design/views/canvas/canvas-tool-host.test.tsx`
- Modify: `apps/desktop/src/renderer/design/views/canvas/CanvasAgentModal.tsx`
- Modify: `apps/desktop/src/renderer/design/views/canvas/CanvasWorkspaceView.tsx`

- [x] Extend `CanvasToolContext` and `CanvasToolHostOptions` with optional `getViewport()` and `revealNodes(nodeIds)` callbacks.
- [x] Pass the live `canvasViewportRef.current` through `CanvasAgentModal` to the tool host.
- [x] Implement `revealNodes` in `CanvasWorkspaceView`: select all created nodes, then focus them after React Flow receives the refreshed snapshot.
- [x] Update the tool host test to prove refreshed viewport/reveal callbacks are visible to tool execution without reattaching the session.

### Task 3: Reusable Workflow Placement and Focus

**Files:**

- Modify: `apps/desktop/src/renderer/design/views/canvas/canvasAgentWorkflowGraphTools.ts`
- Modify: `apps/desktop/src/renderer/design/views/canvas/canvasAgentWorkflowGraphTools.test.ts`

- [x] Add a failing test where free viewport space changes the `applyTemplate` origin and does not call `revealNodes`.
- [x] Add a failing test where a crowded/small viewport uses the fallback origin and calls `revealNodes` with every created node id.
- [x] Use the pure placement policy before `applyTemplate`, then check created-node visibility against a fresh viewport after materialization.
- [x] Return placement metadata (`placement: viewport | canvas_outside`, `focusedAfterCreate`) for diagnostics and testing.
- [x] Run workflow graph tool tests and verify both placement branches pass.

### Task 4: Agent Guidance and Verification

**Files:**

- Modify: `apps/desktop/resources/skills/canvas-studio/SKILL.md`
- Modify: `docs/superpowers/specs/2026-07-25-canvas-agent-reusable-workflow-graph-design.md`

- [x] Add guidance that complete workflows should be created near the current viewport and that the program will focus outside placements; the Agent must not invent absolute coordinates to force placement.
- [x] Run focused viewport, workflow graph, tool host, and Canvas tool tests.
- [x] Run desktop typecheck, targeted lint, production build, `git diff --check`, and GitNexus staged change detection.
- [x] Mark this plan `已落地`, commit the scoped files, and do not push.

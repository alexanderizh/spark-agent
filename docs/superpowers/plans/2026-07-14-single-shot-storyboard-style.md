# Single-shot Storyboard Style Implementation Plan

> 状态: 已落地 | 最后核对: 2026-07-14

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a storyboard node produced by “按镜拆分” reuse the same table presentation, node chrome, size rules, and editor as the original multi-shot storyboard node.

**Architecture:** Centralize the presentation-only “renderable storyboard” rule around explicit storyboard text recognition plus at least one parsed shot. Reuse that rule in the canvas node, node chrome, sizing, operation-output preview, and both editor entry points; keep the stricter multi-shot checks used by pipeline actions unchanged.

**Tech Stack:** React 19, TypeScript, Vitest, React Flow, Less.

---

### Task 1: Reproduce the single-shot presentation mismatch

**Files:**
- Modify: `apps/desktop/src/renderer/design/views/canvas/canvasNodeChrome.test.ts`
- Modify: `apps/desktop/src/renderer/design/views/canvas/canvasNodeSize.test.ts`
- Modify: `apps/desktop/src/renderer/design/views/canvas/canvasOperationOutputPresentation.test.ts`

- [x] **Step 1: Add a single-row storyboard fixture to the chrome test**

Assert that a text node containing a valid `镜号` table with one data row does not receive the ordinary content-title height.

- [x] **Step 2: Add a single-row storyboard fixture to the size test**

Assert that `pickTextNodeSize` and `pickCanvasNodeMinSize` return the existing storyboard sizes for the same one-row table.

- [x] **Step 3: Add a single-row storyboard operation-output fixture**

Assert that the existing operation-output resolver returns the storyboard presentation with exactly one row.

- [x] **Step 4: Run the focused tests and verify RED**

Run: `pnpm --filter @spark/desktop test:unit -- canvasNodeChrome.test.ts canvasNodeSize.test.ts canvasOperationOutputPresentation.test.ts`

Expected: the new single-shot assertions fail because the current presentation checks require at least two parsed rows.

### Task 2: Centralize and apply the one-or-more-shot presentation rule

**Files:**
- Create: `apps/desktop/src/renderer/design/views/canvas/canvasShotScriptPresentation.ts`
- Modify: `apps/desktop/src/renderer/design/views/canvas/CanvasNode.tsx`
- Modify: `apps/desktop/src/renderer/design/views/canvas/canvasNodeChrome.ts`
- Modify: `apps/desktop/src/renderer/design/views/canvas/canvasNodeSize.ts`
- Modify: `apps/desktop/src/renderer/design/views/canvas/canvasOperationOutputPresentation.ts`
- Modify: `apps/desktop/src/renderer/design/views/canvas/CanvasNodeEditModal.tsx`
- Modify: `apps/desktop/src/renderer/design/views/canvas/CanvasWorkspaceView.tsx`

- [x] **Step 1: Add the shared presentation helper**

Implement `readRenderableShotScriptRows(text)` so it returns parsed rows only when `isShotScriptText(text)` is true and at least one valid row exists; implement `isRenderableShotScriptText(text)` as its boolean wrapper.

- [x] **Step 2: Replace presentation-specific two-row thresholds**

Use the shared helper for node-body rendering, canvas chrome height, storyboard default/minimum sizing, operation-output preview, and editor selection. Do not change the two-row thresholds that decide pipeline operations or automatic task behavior.

- [x] **Step 3: Run focused tests and verify GREEN**

Run: `pnpm --filter @spark/desktop test:unit -- canvasNodeChrome.test.ts canvasNodeSize.test.ts canvasStoryboardNodeSplit.test.ts canvasOperationOutputPresentation.test.ts`

Expected: all focused tests pass.

### Task 3: Review, verify, and commit

**Files:**
- Modify: `docs/superpowers/plans/2026-07-14-single-shot-storyboard-style.md`

- [x] **Step 1: Run static verification**

Run: `pnpm --filter @spark/desktop typecheck`

Expected: TypeScript exits with code 0.

- [x] **Step 2: Review the pending frontend changes**

Inspect `git diff --check`, `git diff`, affected imports, React memoization, and the exact set of remaining `rows.length >= 2` checks. Confirm the remaining strict checks belong to pipeline/action classification rather than presentation.

- [x] **Step 3: Refresh plan status**

Change this document status to `已落地` and keep `最后核对` at `2026-07-14`.

- [x] **Step 4: Commit the verified fix**

Run: `git add apps/desktop/src/renderer/design/views/canvas/CanvasNode.tsx apps/desktop/src/renderer/design/views/canvas/CanvasNodeEditModal.tsx apps/desktop/src/renderer/design/views/canvas/CanvasWorkspaceView.tsx apps/desktop/src/renderer/design/views/canvas/canvasNodeChrome.ts apps/desktop/src/renderer/design/views/canvas/canvasNodeChrome.test.ts apps/desktop/src/renderer/design/views/canvas/canvasNodeSize.ts apps/desktop/src/renderer/design/views/canvas/canvasNodeSize.test.ts apps/desktop/src/renderer/design/views/canvas/canvasOperationOutputPresentation.ts apps/desktop/src/renderer/design/views/canvas/canvasOperationOutputPresentation.test.ts apps/desktop/src/renderer/design/views/canvas/canvasShotScriptPresentation.ts docs/superpowers/plans/2026-07-14-single-shot-storyboard-style.md` followed by `git commit -m "fix(desktop): unify single-shot storyboard styling"`.

Expected: commit succeeds and `git status --short` is clean.

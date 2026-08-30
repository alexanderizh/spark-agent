# Canvas Full-Bleed Image Node Implementation Plan

> 状态: 已落地 | 最后核对: 2026-07-18

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render loaded image nodes at the source image aspect ratio with overlaid top chrome and one merged translucent bottom bar, without changing empty image or non-image nodes.

**Architecture:** Add a focused image-presentation helper that owns eligibility and source-dimension sizing. CanvasStage supplies asset dimensions, CanvasNode selects the full-bleed rendering branch, and the V4 node stylesheet overlays chrome without affecting layout.

**Tech Stack:** React 19, TypeScript, @xyflow/react, Less, Vitest.

---

### Task 1: Lock the image sizing contract

**Files:**
- Modify: `apps/desktop/src/renderer/design/views/canvas/canvasNodeSize.test.ts`
- Modify: `apps/desktop/src/renderer/design/views/canvas/canvasNodeSize.ts`

- [x] Change image sizing expectations so known image dimensions return the image body ratio without meta height.
- [x] Run the focused Vitest file and verify the new assertions fail against the old implementation.
- [x] Remove meta-height addition and independent minimum-height clamping from known-dimension image fitting while preserving the unknown-dimension fallback.
- [x] Run the focused test again and verify it passes.

### Task 2: Define full-bleed eligibility and view sizing

**Files:**
- Create: `apps/desktop/src/renderer/design/views/canvas/canvasImageNodePresentation.ts`
- Create: `apps/desktop/src/renderer/design/views/canvas/canvasImageNodePresentation.test.ts`
- Modify: `apps/desktop/src/renderer/design/views/canvas/canvasNodeChrome.ts`
- Modify: `apps/desktop/src/renderer/design/views/canvas/canvasNodeChrome.test.ts`

- [x] Add failing tests proving only image nodes with a non-empty URL are full-bleed, source dimensions correct existing node height, missing dimensions preserve current height, and full-bleed nodes add zero chrome height.
- [x] Run the two focused test files and verify the failures describe the missing behavior.
- [x] Implement `isFullBleedCanvasImageNode` and `resolveCanvasImageNodePresentationSize`, then reuse eligibility from `canvasNodeChromeExtraHeight`.
- [x] Run the focused tests and verify they pass.

### Task 3: Feed source dimensions into React Flow

**Files:**
- Modify: `apps/desktop/src/renderer/design/views/canvas/CanvasStage.tsx`
- Test: `apps/desktop/src/renderer/design/views/canvas/canvasImageNodeStageIntegration.test.ts`

- [x] Add a failing stage-integration test for asset-dimension plumbing and overlay-aware auto layout.
- [x] Build one memoized asset map, pass image dimensions into `toFlowNode`, and use the image-presentation helper before operation-node presentation sizing.
- [x] Reuse rendered node width/height as the synchronization fingerprint, avoiding redundant dimension fields in flow-node data.
- [x] Run stage layout and presentation helper tests.

### Task 4: Render merged overlaid chrome

**Files:**
- Modify: `apps/desktop/src/renderer/design/views/canvas/CanvasNode.tsx`
- Modify: `apps/desktop/src/renderer/design/views/canvas/uiux-v4/nodes.less`
- Modify: `apps/desktop/src/renderer/design/views/canvas/canvasUiuxV4Integration.test.ts`

- [x] Add failing source-integration assertions for the full-bleed modifier, merged bottom overlay, and scoped overlay styles.
- [x] Run the integration test and verify it fails before implementation.
- [x] Add the full-bleed modifier only for loaded image nodes, suppress their separate title/footer rows, and render one bottom overlay containing title, status, and edit action.
- [x] Add scoped top/bottom translucent overlay styling, full-area image fill, and subview-button clearance.
- [x] Run the integration and related node tests.

### Task 5: Verify scope and quality

**Files:**
- Modify: `docs/superpowers/specs/2026-07-18-canvas-full-bleed-image-node-design.md`
- Modify: `docs/superpowers/plans/2026-07-18-canvas-full-bleed-image-node.md`

- [x] Run focused Vitest files for sizing, chrome, presentation, stage layout, asset insertion, materialization, and V4 integration.
- [x] Run `pnpm --filter @spark/desktop typecheck`.
- [x] Run ESLint on the touched TypeScript/TSX files.
- [x] Run a production build with an 8GB Node heap after the default 4GB heap proved insufficient for the 16,557-module renderer bundle.
- [x] Inspect `git diff --check` and the final scoped diff, then update both document statuses to `已落地`.

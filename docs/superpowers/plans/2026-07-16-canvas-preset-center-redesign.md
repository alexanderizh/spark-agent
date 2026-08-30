# Canvas Preset Center Redesign Implementation Plan

> 状态: 已落地 | 最后核对: 2026-07-16

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the node-first preset modal with task defaults plus explicit node overrides while preserving existing data.

**Architecture:** Add a focused task-default store beside the existing per-target store, then merge it below target overrides. Extract task-card and override-list presentation from the modal; reuse existing Agent and model pickers so Provider/model icons and capability filtering remain consistent.

**Tech Stack:** React, TypeScript, Ant Design, `@lobehub/ui`, Less, Vitest.

---

### Task 1: Task-default model

**Files:**

- Create: `apps/desktop/src/renderer/design/views/canvas/canvasTaskDefaults.ts`
- Test: `apps/desktop/src/renderer/design/views/canvas/canvasTaskDefaults.test.ts`
- Modify: `apps/desktop/src/renderer/design/views/canvas/canvasOperationPresets.ts`
- Test: `apps/desktop/src/renderer/design/views/canvas/canvasOperationPresets.test.ts`

- [ ] Write failing tests for the four task kinds, audio exclusion, normalization and node-override precedence.
- [ ] Run `pnpm --filter @spark/desktop test:unit -- canvasTaskDefaults.test.ts canvasOperationPresets.test.ts` and confirm expected failure.
- [ ] Implement versioned storage plus mapping and merge helpers.
- [ ] Extend preset resolution with optional `{ hasImageInput }` context.
- [ ] Run the focused tests and confirm pass.

### Task 2: Contextual image-understanding runtime

**Files:**

- Modify: `apps/desktop/src/renderer/design/views/canvas/canvas.api.ts`
- Test: `apps/desktop/src/renderer/design/views/canvas/canvasOperationInheritance.test.ts`

- [ ] Add a failing test proving a text task with image input uses the image-understanding default.
- [ ] Pass image-input context from text-task creation into preset resolution.
- [ ] Run the focused inheritance test and confirm pass.

### Task 3: Presentation model and task cards

**Files:**

- Create: `apps/desktop/src/renderer/design/views/canvas/canvasPresetCenterModel.ts`
- Test: `apps/desktop/src/renderer/design/views/canvas/canvasPresetCenterModel.test.ts`
- Create: `apps/desktop/src/renderer/design/views/canvas/CanvasPresetTaskCards.tsx`
- Test: `apps/desktop/src/renderer/design/views/canvas/CanvasPresetTaskCards.test.tsx`

- [ ] Add failing tests for card order, multimodal filtering, grouped targets and Agent/model execution modes.
- [ ] Implement pure card and grouping definitions.
- [ ] Implement controlled task cards with existing icon-bearing pickers.
- [ ] Run focused tests and confirm pass.

### Task 4: Node overrides

**Files:**

- Create: `apps/desktop/src/renderer/design/views/canvas/CanvasPresetNodeOverrides.tsx`
- Test: `apps/desktop/src/renderer/design/views/canvas/CanvasPresetNodeOverrides.test.tsx`

- [ ] Add failing tests for group order, inheritance status, selecting a row and restoring inheritance.
- [ ] Implement controlled rows and editor boundary.
- [ ] Run focused tests and confirm pass.

### Task 5: Recompose modal

**Files:**

- Modify: `apps/desktop/src/renderer/design/views/canvas/CanvasOperationPresetModal.tsx`
- Test: `apps/desktop/src/renderer/design/views/canvas/CanvasOperationPresetModal.test.tsx`

- [ ] Replace old structure assertions with failing tests for title, tabs, four cards, override count and unified save.
- [ ] Remove the bulk section and permanent node sidebar.
- [ ] Wire task-default drafts and existing target drafts into one save operation.
- [ ] Preserve load, error, dirty-close and keyboard-save behavior.
- [ ] Run modal and preset tests.

### Task 6: Focused styling

**Files:**

- Create: `apps/desktop/src/renderer/design/views/canvas/CanvasPresetCenter.less`
- Modify: `apps/desktop/src/renderer/design/views/canvas/CanvasWorkspaceView.less`

- [ ] Move preset-center styles into the focused stylesheet.
- [ ] Implement approved two-column cards, one-accent theme, focus/hover states and single-column breakpoint.
- [ ] Run focused component tests and desktop typecheck.

### Task 7: Verification

- [ ] Run all affected Vitest files.
- [ ] Run `pnpm --filter @spark/desktop typecheck`.
- [ ] Run `git diff --check`, direct-caller searches and `git diff --stat`.
- [ ] Change both document status lines to `已落地` after all verification succeeds.

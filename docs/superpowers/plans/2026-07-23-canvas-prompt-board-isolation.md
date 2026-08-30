# Canvas Prompt and Board Isolation Implementation Plan

> 状态: 已落地 | 最后核对: 2026-07-23

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent cross-project Prompt leakage and keep canvas tasks scoped to the active board.

**Architecture:** Separate globally reusable runtime preferences from project/node Prompt state. Sanitize only provably inherited generic preset prompts, preserve explicit functional prompts, and pass board identity through every media/text task creation boundary.

**Tech Stack:** TypeScript, React, Electron IPC, Vitest, canvas hot storage/SQLite snapshots.

---

### Task 1: Lock Prompt isolation with regression tests

**Files:**

- Modify: `apps/desktop/src/renderer/design/views/canvas/canvasOperationInheritance.test.ts`
- Modify: `apps/desktop/src/renderer/design/views/canvas/canvasOperationPresets.test.ts`
- Modify: `apps/desktop/src/renderer/design/views/canvas/canvasOperationPresets.ts`
- Modify: `apps/desktop/src/renderer/design/views/canvas/canvas.api.ts`

- [x] Add a test that writes a generic `text_to_image` preset Prompt, creates a node in another project, and expects no inherited `systemPrompt`.
- [x] Run the focused test and verify it fails because the preset Prompt is currently persisted on the node/task.
- [x] Add a pure sanitizer that removes a generic preset Prompt only when it exactly matches the stored node value.
- [x] Stop passing generic operation preset Prompt into `buildCanvasOperationSystemPrompt`; retain it for dedicated pipeline targets.
- [x] Run focused tests and verify generic isolation plus dedicated pipeline behavior.

### Task 2: Clean already-polluted generic operation nodes

**Files:**

- Modify: `apps/desktop/src/renderer/design/views/canvas/canvas.api.ts`
- Test: `apps/desktop/src/renderer/design/views/canvas/canvasOperationInheritance.test.ts`

- [x] Add a test that runs an existing generic node whose `systemPrompt` equals the generic preset and asserts the IPC request omits that text.
- [x] Verify the test fails with the old preset in the outgoing request.
- [x] Sanitize the node/task System Prompt in `runOperationNode` before request construction and persist the cleaned runtime state.
- [x] Add a preservation test for a non-matching explicit System Prompt.
- [x] Run the focused test file and verify both cases pass.

### Task 3: Preserve active board identity

**Files:**

- Modify: `apps/desktop/src/renderer/design/views/canvas/canvas.store.ts`
- Modify: `apps/desktop/src/renderer/design/views/canvas/canvas.api.ts`
- Test: `apps/desktop/src/renderer/design/views/canvas/canvasOperationInheritance.test.ts`
- Test: `apps/desktop/src/renderer/design/views/canvas/canvas.store.test.ts`

- [x] Add failing tests for media/text task creation on a non-default active board.
- [x] Add a failing snapshot test asserting tasks from other boards are absent.
- [x] Pass `boardId` from store to media/text APIs and validate it belongs to the project.
- [x] For bound operation nodes, use the node board as the authoritative board.
- [x] Filter workspace snapshot tasks by active `boardId` and rerun focused tests.
- [x] Keep an empty valid board isolated; only use the legacy node fallback when every node points to a deleted board.

### Task 4: Documentation, verification, and review

**Files:**

- Modify: `docs/design/canvas-task-observability.md`
- Modify: `docs/superpowers/specs/2026-07-23-canvas-prompt-board-isolation-design.md`
- Modify: `docs/superpowers/plans/2026-07-23-canvas-prompt-board-isolation.md`

- [x] Document Prompt provenance and board-scoped task queue behavior; refresh the document status date.
- [x] Run all canvas Prompt/task tests, desktop typecheck, lint for changed source, and desktop build.
- [x] Review `git diff` across correctness, readability, architecture, security, and performance.
- [x] Resolve every required review finding and rerun affected verification.
- [x] Run `npx gitnexus analyze`; if unavailable, record the project-approved degradation and verify scope with `rg` plus `git diff`.

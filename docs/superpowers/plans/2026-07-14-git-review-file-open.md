# Git Review File Open Implementation Plan

> 状态: 已落地 | 最后核对: 2026-07-14

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add default-app and selectable-app file opening to both Git review file surfaces without changing diff selection behavior.

**Architecture:** Reuse `SessionFileOpenPicker`. Pass the reviewed workspace root into `GitReviewPanel`, resolve each Git-relative path once, and render the picker as a sibling of the existing row button. Keep the new wrapper layout in a focused `ChatGitReview.less` module because the existing `ChatView.less` file is already over 3,000 lines.

**Tech Stack:** React, TypeScript, Vitest, Electron typed IPC, Less.

---

### Task 1: Define review file open behavior

**Files:**
- Modify: `apps/desktop/src/renderer/design/views/chat/ChatGitUtils.ts`
- Test: `apps/desktop/src/renderer/design/views/chat/ChatGitUtils.test.ts`

- [x] Add failing tests for workspace-relative path resolution and deleted Git statuses.
- [x] Run `pnpm --filter @spark/desktop test:unit -- src/renderer/design/views/chat/ChatGitUtils.test.ts` and confirm the new assertions fail for missing exports.
- [x] Add minimal helpers that join the workspace root with a Git path and reject statuses where the working-tree file is deleted.
- [x] Re-run the focused test and confirm it passes.

### Task 2: Add both file-opening entry points

**Files:**
- Modify: `apps/desktop/src/renderer/design/views/chat/ChatGitReview.test.tsx`
- Modify: `apps/desktop/src/renderer/design/views/chat/ChatGitReview.tsx`
- Create: `apps/desktop/src/renderer/design/views/chat/ChatGitReview.less`
- Modify: `apps/desktop/src/renderer/design/views/ChatView.tsx`

- [x] Mock `SessionFileOpenPicker` and add a failing test asserting two pickers receive the reviewed workspace's absolute file path.
- [x] Add a regression test asserting a deleted file renders no picker.
- [x] Run `pnpm --filter @spark/desktop test:unit -- src/renderer/design/views/chat/ChatGitReview.test.tsx` and confirm the new entry-point test fails for missing controls.
- [x] Pass `gitWorkspace.rootPath` into `GitReviewPanel`.
- [x] Render compact picker controls beside, not inside, the list and tree row buttons.
- [x] Adjust the review grids for the sibling controls and hover/focus visibility.
- [x] Re-run both focused test files and confirm they pass.

### Task 3: Verify, review, and commit

**Files:**
- Review all files listed above plus this spec and plan.

- [x] Run the focused Vitest files.
- [x] Run the desktop TypeScript check discovered in `apps/desktop/package.json`.
- [x] Inspect `git diff --check`, `git diff --stat`, and direct call sites because GitNexus MCP is unavailable.
- [x] Request an independent code review and address its documentation and test-quality findings.
- [x] Stage only the Git review feature files and documentation.
- [x] Commit with `feat(desktop): open files from git review`.

## Verification Record

- Focused Vitest: 2 files, 9 tests passed.
- Desktop TypeScript: renderer and node configurations passed.
- Targeted ESLint: 0 errors; remaining warnings predate this change.
- Full desktop suite: feature tests passed, while unrelated existing sidebar, IPC namespace, and development-package smoke tests still fail.

# Local Branch Git Review Detection Implementation Plan

> 状态: 已落地 | 最后核对: 2026-07-14

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Detect committed but unpushed changes on local branches in both Git status surfaces.

**Architecture:** Extract Git status collection from the oversized IPC registry into a focused module. Resolve a merge-base against upstream or the remote default branch, then build the review snapshot from that base while preserving worktree-only commit counts.

**Tech Stack:** Electron main process, Node.js child processes, Git CLI, TypeScript, Vitest.

---

### Task 1: Reproduce with a real repository

**Files:**

- Create: `apps/desktop/src/main/ipc/workspace-git-status.test.ts`

- [x] Create a bare remote and working repository in a temporary directory.
- [x] Push the base `master`, commit a file on an unpushed feature branch, and call the desired status API.
- [x] Assert the committed file, comparison branch, ahead count, pending counts, and file diff.
- [x] Run the focused test and confirm it fails because the extracted module does not exist.

### Task 2: Extract and fix Git status collection

**Files:**

- Create: `apps/desktop/src/main/ipc/workspace-git-status.ts`
- Modify: `apps/desktop/src/main/ipc/index.ts`
- Test: `apps/desktop/src/main/ipc/git-status-utils.test.ts`

- [x] Move the Git helper group from `index.ts` into the focused module without changing handler contracts.
- [x] Resolve comparison refs using upstream, remote HEAD, remote main/master, then HEAD fallback.
- [x] Merge baseline diff entries with porcelain flags and untracked statistics.
- [x] Keep pending counts based on porcelain entries and compute ahead/behind against the comparison ref.
- [x] Preserve porcelain leading spaces so unstaged files are not misclassified as staged.
- [x] Load file diffs from the comparison base with HEAD fallback for net-zero branch changes.
- [x] Run the real-repository and existing Git utility tests.

### Task 3: Label committed review entries

**Files:**

- Modify: `apps/desktop/src/renderer/design/views/chat/ChatGitUtils.ts`
- Modify: `apps/desktop/src/renderer/design/views/chat/ChatGitUtils.test.ts`
- Modify: `apps/desktop/src/renderer/design/views/chat/ChatGitReview.less`

- [x] Add a failing test for the committed stage label and tree class.
- [x] Return `已提交` / `committed` when all pending flags are false.
- [x] Add the committed stage-dot color alongside existing Git review styles.
- [x] Run the focused renderer tests.

### Task 4: Verify, review, and commit

**Files:**

- Review all files above plus this spec and plan.

- [x] Run focused main-process and renderer tests.
- [x] Run desktop typecheck and targeted ESLint.
- [x] Run `git diff --check` and direct call-site scope checks because GitNexus MCP is unavailable.
- [x] Review comparison fallback, pending-count compatibility, path handling, and IPC extraction scope.
- [x] Commit only this fix with `fix(desktop): detect unpushed branch changes`.

## Verification Record

- Focused Vitest: 4 files, 15 tests passed, including two real temporary-repository scenarios.
- Desktop TypeScript: renderer and node configurations passed.
- Targeted ESLint: 0 errors; three pre-existing non-null assertion warnings remain in `ChatGitUtils.test.ts`.
- Full desktop suite: new tests passed; the same unrelated sidebar, IPC namespace, and development-package smoke failures seen before this fix remain.

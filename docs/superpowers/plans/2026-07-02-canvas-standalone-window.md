# Canvas Standalone Window Implementation Plan

> 状态: 已落地 | 最后核对: 2026-07-02

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the canvas workspace/detail editor out of the main app shell into a singleton standalone Electron window, while keeping the main app canvas view as the project list.

**Architecture:** Add a main-process canvas window service that owns one `BrowserWindow`, opens/focuses it for a project, and loads the existing renderer in a standalone canvas mode. Make stream delivery multi-window aware so canvas task and agent events reach the standalone renderer, and make window controls operate on the sender window instead of the main window. Keep `CanvasWorkspaceView` mostly intact by wrapping it in a small standalone renderer entry component.

**Tech Stack:** Electron `BrowserWindow`, `electron-vite`, React 19, existing `window.spark` IPC bridge, Vitest.

---

## Baseline On Worktree Creation

- Worktree: `/Users/zhangyang/spark_ai_project/Spark-Agent/.worktrees/codex-canvas-standalone-window`
- Branch: `codex/canvas-standalone-window`
- Base: local `develop` at `9d62b17a`
- `pnpm install --offline`: completed; Node engine warning because current Node is `v24.14.0` while repo asks for `>=22.14.0 <23`.
- `pnpm --filter @spark/desktop test:unit`: failed before any code changes. Failures include Node 24 JSON import attributes, missing `ToastProvider` in existing renderer tests, platform-sensitive Windows path tests, namespace expectation drift, and package metadata expectation drift.
- `pnpm --filter @spark/desktop typecheck`: failed before any code changes in `packages/agent-runtime/src/services/session.service.ts` around `exactOptionalPropertyTypes`.

## Impact Analysis Policy

Before editing an existing exported function, class, or React component, run:

```bash
npx gitnexus impact <symbol> --direction upstream --repo /Users/zhangyang/spark_ai_project/Spark-Agent
```

If GitNexus reports stale index, run:

```bash
npx gitnexus analyze
```

## Tasks

### Task 1: Canvas Window Service And IPC Contract

**Files:**
- Create: `apps/desktop/src/main/services/CanvasWindowService.ts`
- Modify: `apps/desktop/src/main/ipc/index.ts`
- Modify: `packages/protocol/src/ipc/index.ts`
- Modify: `packages/protocol/src/schemas/index.ts`
- Test: `apps/desktop/src/main/services/__tests__/CanvasWindowService.test.ts`

- [x] Add protocol channel `canvas:window:open`.
- [x] Add a singleton canvas window service with create, focus, close, and project switching behavior.
- [x] Register an IPC handler that delegates to the service.
- [x] Test that a second open call reuses the existing window and updates the active project.

### Task 2: Multi-Window Stream Routing

**Files:**
- Modify: `apps/desktop/src/main/windows/index.ts`
- Modify: `apps/desktop/src/main/ipc/typed-ipc.ts`
- Modify: `apps/desktop/src/main/ipc/index.ts`
- Test: `apps/desktop/src/main/windows/index.test.ts`

- [x] Replace main-window-only stream sending with helpers for main-only, broadcast, and targeted webContents delivery.
- [x] Route canvas task completion streams to all app renderer windows, with renderer-side project filtering preserved.
- [x] Keep global app streams working for the main window.
- [x] Verify canvas task streams and session agent events can reach the standalone canvas window.

### Task 3: Standalone Canvas Renderer Mode

**Files:**
- Create: `apps/desktop/src/renderer/CanvasWindowApp.tsx`
- Modify: `apps/desktop/src/renderer/main.tsx`
- Modify: `apps/desktop/src/renderer/design/views/canvas/CanvasWorkspaceView.tsx`
- Test: `apps/desktop/src/renderer/design/views/canvas/CanvasWindowApp.test.tsx`

- [x] Detect `?window=canvas&projectId=...` in the renderer entry.
- [x] Render `CanvasWorkspaceView` inside existing app providers without the main sidebar shell.
- [x] Make the workspace back button close or hide the standalone window instead of returning to an in-window project list.
- [x] Keep canvas dirty-state and running-task close guards available in standalone mode.

### Task 4: Main Window Project List Behavior

**Files:**
- Modify: `apps/desktop/src/renderer/design/views/canvas/CanvasProjectsView.tsx`
- Modify: `apps/desktop/src/renderer/design/views/canvas/canvas.store.ts`
- Test: `apps/desktop/src/renderer/design/views/canvas/CanvasProjectsView.test.tsx`

- [x] Change project card open and create/import success paths to call `canvas:window:open`.
- [x] Remove direct workspace rendering from `CanvasProjectsView`.
- [x] Subscribe the project list to canvas project change streams and refresh stale counts, covers, and timestamps.
- [x] Preserve project create, edit, archive, pin, delete, import, export, and open-folder actions.

### Task 5: Sender-Scoped Window Controls

**Files:**
- Modify: `apps/desktop/src/main/ipc/index.ts`
- Test: `apps/desktop/src/main/ipc/__tests__/window-controls.test.ts`

- [x] Change minimize, maximize, close, and is-maximized handlers to act on `BrowserWindow.fromWebContents(event.sender)`.
- [x] Keep fallback behavior for cases where no sender window exists.
- [x] Verify standalone canvas window controls no longer affect the main window.

### Task 6: Docs And Verification

**Files:**
- Modify: `docs/multimedia-agent-canvas-infrastructure-plan.md`
- Modify: `docs/superpowers/plans/2026-07-02-canvas-standalone-window.md`

- [x] Refresh canvas docs with the standalone-window behavior and singleton constraint.
- [x] Run focused unit tests added by this plan.
- [x] Run `pnpm --filter @spark/desktop typecheck` and record whether baseline errors remain.
- [x] Run `npx gitnexus detect-changes --scope unstaged --repo /Users/zhangyang/spark_ai_project/Spark-Agent` before final review.

Verification note: `pnpm --filter @spark/desktop typecheck` now only fails on the pre-existing baseline error in `packages/agent-runtime/src/services/session.service.ts:1255` (`worktreeMeta` with `exactOptionalPropertyTypes`). The standalone canvas window changes do not add typecheck errors.

Full desktop unit note: `pnpm --filter @spark/desktop test:unit` still fails on the known baseline failure buckets: Node 24 JSON import attributes, existing renderer tests missing `ToastProvider` / stale `AppContext` mock exports, Windows path assertions, IPC namespace expectation drift, and package metadata expectation drift. Focused standalone-window tests pass.

GitNexus note: `npx gitnexus detect-changes --scope unstaged --repo /Users/zhangyang/spark_ai_project/Spark-Agent` reports HIGH risk because this feature intentionally touches high fan-out IPC/window routing symbols (`registerAllIpcHandlers`, `pushStreamEvent`, `sendToMainWindow`/window registry). The compatibility strategy is to preserve existing main-window send behavior, add broadcast routing for stream events, and scope window controls by IPC sender with main-window fallback.

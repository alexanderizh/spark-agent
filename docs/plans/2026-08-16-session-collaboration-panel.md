# Session Collaboration Panel Implementation Plan

> 状态: 已落地 | 最后核对: 2026-08-16

**Goal:** 将会话协作信息从会话头部提示迁移到现有环境信息面板，并明确区分会话协作关系与 Git 分支。

**Architecture:** 保留现有 `session:get-lineage` 数据链路，将 lineage、来源会话、子会话和当前 Git 分支作为显示数据传给 `GitEnvPanel`。环境面板默认显示“会话协作”行，点击后在同一面板容器内切换到详情视图，避免新增顶部入口和被会话头部遮挡。

**Tech Stack:** Electron renderer, React 19, TypeScript strict 思路, Vitest/jsdom, Less。

---

### Task 1: Lock the collaboration panel behavior with a renderer test

**Files:**

- Modify: `apps/desktop/src/renderer/design/views/chat/ChatGitEnv.test.tsx`

- [x] **Step 1: Add a failing test** for the environment panel rendering a “会话协作” row and revealing a detail view with “Git 分支” after clicking it.
- [x] **Step 2: Run the focused test** and verify it fails because the new entry/detail view is not implemented.

### Task 2: Move session lineage into the environment panel

**Files:**

- Modify: `apps/desktop/src/renderer/design/views/chat/ChatGitEnv.tsx`
- Modify: `apps/desktop/src/renderer/design/views/chat/SessionLineageBar.tsx`
- Modify: `apps/desktop/src/renderer/design/views/chat/SessionLineageBar.less`
- Modify: `apps/desktop/src/renderer/design/views/ChatView.tsx`
- Modify: `apps/desktop/src/renderer/design/views/ChatView.less`

- [x] **Step 1:** Add typed collaboration data props to `GitEnvPanel` and render the row only when a lineage or child collaboration exists.
- [x] **Step 2:** Implement an in-panel detail view with back navigation, explicit “协作会话”/“Git 分支” labels, source-session navigation, and child-session navigation.
- [x] **Step 3:** Remove the old header-level `SessionLineageBar` mount and pass lineage data through `ChatView` to `GitEnvPanel`.
- [x] **Step 4:** Keep existing panel anchoring and scrolling styles, adding only detail-view layout styles and focus/hover states.

### Task 3: Verify the changed renderer surface

**Files:**

- Verify: `apps/desktop/src/renderer/design/views/chat/ChatGitEnv.test.tsx`
- Verify: `apps/desktop/src/renderer/design/views/chat/git-env-panel-layout.test.ts`
- Verify: `apps/desktop/src/renderer/design/views/chat/ChatTabbar.test.tsx`

- [x] **Step 1:** Run the focused renderer tests and confirm all pass.
- [x] **Step 2:** Run `pnpm --filter @spark/desktop typecheck`.
- [x] **Step 3:** Inspect `git diff` and direct call-point search to confirm only the expected UI files changed.

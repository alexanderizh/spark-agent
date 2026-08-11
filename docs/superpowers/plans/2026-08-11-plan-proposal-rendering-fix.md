# 会话计划方案与执行进度分离实施计划

> 状态: 已落地 | 最后核对: 2026-08-11

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 `plan_proposed` 始终按完整审批方案展示，让 `todo_write` / `update_plan` 独立承担可变执行进度，并保证计划文件经过 `Edit` 后提交的是最终版本。

**Architecture:** 将侧栏计划数据改成 `proposal | progress` 判别联合，审批方案保留原始 Markdown，不再转换成带完成率的任务项。把超长 `ChatView.tsx` 中的计划展示职责拆到小型组件；运行时用“文件路径 + 当前内容”重放同一计划文件的 Write/Edit 操作。

**Tech Stack:** React、TypeScript strict、Vitest、Claude SDK 事件映射。

---

### Task 1: 方案与进度数据分型

**Files:**

- Modify: `apps/desktop/src/renderer/design/views/chat/ChatInspectorUtils.ts`
- Modify: `apps/desktop/src/renderer/design/views/chat/ChatInspectorUtils.test.ts`

- [x] **Step 1: 写失败测试**

验证 `extractPlans()` 对 `plan_proposed` 返回 `{ kind: 'proposal', rawPlan }`，且不会把普通 Markdown 列表伪装成待办；对 `todo_write` / `update_plan` 返回 `{ kind: 'progress', items }`。

- [x] **Step 2: 运行测试确认 RED**

Run: `pnpm --filter @spark/desktop test:unit -- src/renderer/design/views/chat/ChatInspectorUtils.test.ts`

Expected: FAIL，因为当前 `SidebarPlan` 没有 `kind`，且 `plan_proposed` 会调用 `parsePlanToItems()`。

- [x] **Step 3: 最小实现**

把 `SidebarPlan` 改成判别联合；`plan_proposed` 只保留原始 Markdown，工具计划才生成状态项；删除不再有调用方的 `parsePlanToItems()`。

- [x] **Step 4: 运行测试确认 GREEN**

Run: `pnpm --filter @spark/desktop test:unit -- src/renderer/design/views/chat/ChatInspectorUtils.test.ts`

Expected: PASS。

### Task 2: 拆分并修正计划展示

**Files:**

- Create: `apps/desktop/src/renderer/design/views/chat/PlanSummary.tsx`
- Create: `apps/desktop/src/renderer/design/views/chat/PlanSidePanel.tsx`
- Create: `apps/desktop/src/renderer/design/views/chat/PlanRendering.test.tsx`
- Modify: `apps/desktop/src/renderer/design/views/chat/ChatInspectorPanel.tsx`
- Modify: `apps/desktop/src/renderer/design/views/ChatView.tsx`

- [x] **Step 1: 写失败测试**

验证内联方案块渲染标题和完整 Markdown、没有“已完成 0/N”；验证侧栏把进度放在“执行进度”、原始方案放在“历史方案”。

- [x] **Step 2: 运行测试确认 RED**

Run: `pnpm --filter @spark/desktop test:unit -- src/renderer/design/views/chat/PlanRendering.test.tsx`

Expected: FAIL，因为独立组件尚不存在。

- [x] **Step 3: 最小实现**

内联 `plan_proposed` 使用 Markdown 方案块；`PlanSummary` 对 proposal 渲染原文、对 progress 渲染状态项；从超过 3000 行的 `ChatView.tsx` 移出 `PlanSidePanel` / `PlanApprovalPanel`。

- [x] **Step 4: 运行测试确认 GREEN**

Run: `pnpm --filter @spark/desktop test:unit -- src/renderer/design/views/chat/PlanRendering.test.tsx src/renderer/design/views/chat/ChatInspectorUtils.test.ts`

Expected: PASS。

### Task 3: 重放计划文件 Edit

**Files:**

- Modify: `packages/agent-runtime/src/sdk/event-mapper.ts`
- Modify: `packages/agent-runtime/src/sdk/event-mapper.test.ts`

- [x] **Step 1: 写失败测试**

构造 `Write(plan v1) → Edit(old_string/new_string) → ExitPlanMode`，断言 `plan_proposed.plan` 是 v2。

- [x] **Step 2: 运行测试确认 RED**

Run: `pnpm --filter @spark/agent-runtime exec vitest run src/sdk/event-mapper.test.ts`

Expected: FAIL，当前 fallback 仍返回 Write 的旧内容。

- [x] **Step 3: 最小实现**

追踪最后计划文件的路径与内容；同一路径 Edit 时应用 `old_string/new_string`（兼容 camelCase 和 `replace_all`），无法安全重放时保留已知内容。

- [x] **Step 4: 运行测试确认 GREEN**

Run: `pnpm --filter @spark/agent-runtime exec vitest run src/sdk/event-mapper.test.ts`

Expected: PASS。

### Task 4: 验证与复核

**Files:**

- Modify: `docs/superpowers/plans/2026-08-11-plan-proposal-rendering-fix.md`

- [x] **Step 1: 运行聚焦测试与类型检查**

Run: `pnpm --filter @spark/desktop test:unit -- src/renderer/design/views/chat/PlanRendering.test.tsx src/renderer/design/views/chat/ChatInspectorUtils.test.ts`

Run: `pnpm --filter @spark/agent-runtime exec vitest run src/sdk/event-mapper.test.ts`

Run: `pnpm --filter @spark/desktop typecheck`

Run: `pnpm --filter @spark/agent-runtime typecheck`

- [x] **Step 2: 三遍差异复核**

依次核对职责边界、调用点与类型、最终 `git diff`；确认无关工作树改动未被触碰，文档状态改为“已落地”。

## 验证结果

- Desktop 计划渲染与 Inspector 聚焦测试：14/14 通过。
- Agent runtime event-mapper 聚焦测试：30/30 通过。
- Agent runtime typecheck：通过。
- 目标文件 ESLint：0 error；既有大文件仍有历史 warning。
- Desktop 全量 typecheck：被并行多媒体改动中的 `providerMediaConfig.ts` 缺少 `volcengine-speech` 映射阻断；TypeScript 未报告本计划相关文件错误。
- 三遍复核：职责边界、调用/审批链、最终差异与工作树隔离均已核对。
